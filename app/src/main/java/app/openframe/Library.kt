package app.openframe

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import java.io.File

/**
 * Photo library management (Settings → Photos → Library and Trash; user request 2026-10-13,
 * brought forward from Phase 9).
 *
 * - Delete on internal storage moves the file to `FrameMedia/.trash/` (a dot folder the indexer
 *   skips) for [TRASH_DAYS] days; restore moves it back. Removable media is read-only for apps on
 *   Android 8.1 (no document picker on this frame), so there "delete" hides (user decision).
 * - Small thumbnails (≤ [THUMB_EDGE] px) are made on demand from the display copies, so the grid
 *   stays light on the frame.
 */
class Library(private val app: OpenFrameApp) {

    data class Result(val trashed: Int, val hidden: Int, val failed: List<String>)

    private val thumbs = File(app.cacheDir, "thumbs").apply { mkdirs() }
    private val trashDir = File(app.indexer.internalRoot, ".trash")
    private val lock = Any()
    private val thread = HandlerThread("OpenFrame-library", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)

    fun start() {
        val purge = object : Runnable {
            override fun run() {
                runCatching { purgeExpired() }.onFailure { Log.e(TAG, "Trash purge failed", it) }
                handler.postDelayed(this, 6 * 3600_000L)
            }
        }
        handler.postDelayed(purge, 60_000)
    }

    /**
     * Settings → Unplugged drives → Forget (user 2026-10-27): the frame drops a drive it remembers, with its items'
     * settings and the copies it made of them (display copies, thumbnails, strips). The drive's files stay as they are;
     * plugged in again, it is read as a new drive. Returns how many items were forgotten.
     */
    fun forgetVolume(volume: String): Int = synchronized(lock) {
        val ids = app.mediaDb.forgetVolume(volume)
        for (id in ids) {
            app.indexer.deleteDerived(id)
            File(thumbs, "$id.jpg").delete()
        }
        app.slideshow.onLibraryChanged()
        Log.i(TAG, "Library: a drive was forgotten, ${ids.size} item(s)")
        ids.size
    }

    // ---- thumbnails ----

    fun thumbFor(item: MediaDb.Item): File? {
        val display = app.indexer.displayFile(item.id)
        // Photos, and videos by their poster (SPEC §6).
        if (item.status != MediaDb.STATUS_OK || !display.isFile) return null
        val thumb = File(thumbs, "${item.id}.jpg")
        if (thumb.isFile && thumb.lastModified() >= display.lastModified()) return thumb
        return if (makeThumb(display, thumb)) thumb else null
    }

    fun trashThumb(trashId: Long): File = File(thumbs, "t$trashId.jpg")

    private fun makeThumb(src: File, dst: File): Boolean = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= THUMB_EDGE) sample *= 2
        val bmp = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("decode failed")
        try {
            val tmp = File(dst.parentFile, dst.name + ".tmp")
            tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            tmp.renameTo(dst)
        } finally {
            bmp.recycle()
        }
    } catch (e: Exception) {
        Log.w(TAG, "Thumbnail failed for ${src.name}: ${e.message}")
        false
    }

    // ---- delete / hide / restore ----

    fun delete(ids: List<Long>): Result = synchronized(lock) {
        var trashed = 0
        var hidden = 0
        val failed = ArrayList<String>()
        for (id in ids) {
            val item = app.mediaDb.item(id) ?: continue
            val name = File(item.path).name
            if (item.source != "internal") {
                app.mediaDb.setHidden(id, true)
                hidden++
                continue
            }
            val file = File(item.path)
            if (file.exists()) {
                trashDir.mkdirs()
                val now = System.currentTimeMillis()
                val target = File(trashDir, "$now-$name")
                // Keep a thumbnail for the trash list before the display copy goes.
                val thumb = thumbFor(item)
                if (!file.renameTo(target)) {
                    failed += name
                    continue
                }
                val tid = app.mediaDb.addTrash(item.path, target.path, item, now)
                thumb?.renameTo(trashThumb(tid))
            }
            app.mediaDb.deleteRow(id)
            app.indexer.displayFile(id).delete()
            app.indexer.backgroundFile(id).delete()
            File(thumbs, "$id.jpg").delete()
            trashed++
        }
        app.slideshow.onLibraryChanged()
        Log.i(TAG, "Library: $trashed moved to trash, $hidden hidden, ${failed.size} failed")
        Result(trashed, hidden, failed)
    }

    fun unhide(ids: List<Long>): Int = synchronized(lock) {
        ids.forEach { app.mediaDb.setHidden(it, false) }
        app.slideshow.onLibraryChanged()
        ids.size
    }

    /** Hides photos on any storage (the photo menu's Hide, and the first step of its Delete). */
    fun hide(ids: List<Long>): Int = synchronized(lock) {
        ids.forEach { app.mediaDb.setHidden(it, true) }
        app.slideshow.onLibraryChanged()
        ids.size
    }

    /** Moves files back to where they were (renamed if that name is taken again); returns how many. */
    fun restore(trashIds: List<Long>): Int = synchronized(lock) {
        var n = 0
        val byId = app.mediaDb.trash().associateBy { it.id }
        for (tid in trashIds) {
            val t = byId[tid] ?: continue
            val src = File(t.trashPath)
            if (!src.isFile) { app.mediaDb.removeTrash(tid); continue }
            val orig = File(t.originalPath)
            orig.parentFile?.mkdirs()
            val base = orig.nameWithoutExtension
            val ext = orig.extension
            var target = orig
            var k = 2
            while (target.exists()) target = File(orig.parentFile, "$base ($k).$ext").also { k++ }
            t.comment?.let { app.mediaDb.setPendingComment(target.path, it) }
            app.mediaDb.setPendingSettings(target.path, t.fitOverride, t.cropX, t.cropY, t.view)
            if (src.renameTo(target)) {
                app.mediaDb.removeTrash(tid)
                trashThumb(tid).delete()
                n++
            }
        }
        if (n > 0) app.indexer.requestScan("restore from trash", 0)
        Log.i(TAG, "Library: $n restored from trash")
        n
    }

    /** Deletes trash entries for good: [trashIds], or all when null. */
    fun purge(trashIds: List<Long>?): Int = synchronized(lock) {
        val items = app.mediaDb.trash().filter { trashIds == null || it.id in trashIds }
        items.forEach { purgeOne(it) }
        if (items.isNotEmpty()) Log.i(TAG, "Library: ${items.size} deleted from trash for good")
        items.size
    }

    private fun purgeExpired() = synchronized(lock) {
        val old = app.mediaDb.trash(olderThan = System.currentTimeMillis() - TRASH_DAYS * 86_400_000L)
        old.forEach { purgeOne(it) }
        if (old.isNotEmpty()) Log.i(TAG, "Library: ${old.size} trash items older than $TRASH_DAYS days removed")
    }

    private fun purgeOne(t: MediaDb.TrashItem) {
        File(t.trashPath).delete()
        trashThumb(t.id).delete()
        app.mediaDb.removeTrash(t.id)
    }

    companion object {
        const val TRASH_DAYS = 30
        const val THUMB_EDGE = 240
    }
}
