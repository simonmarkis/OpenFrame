package app.openframe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Environment
import android.os.FileObserver
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.os.storage.StorageManager
import android.util.Log
import java.io.File

/**
 * Finds media on internal storage (`/sdcard/FrameMedia/`) and on mounted SD cards / USB drives
 * (read-only), keeps `media.db` in sync, and creates display copies (SPEC §5, §6).
 *
 * Everything runs on one background thread. Processing is done in small batches so that
 * mount/unmount events and rescans are never stuck behind a long initial index.
 */
class MediaIndexer(
    private val context: Context,
    private val db: MediaDb,
    private val config: ConfigStore,
    private val listener: Listener,
) {
    interface Listener {
        /** Library membership or availability changed (scan finished). */
        fun onLibraryChanged()
        /** A photo finished processing and can be shown. [isNew] = newly added to an already-known volume. */
        fun onItemReady(id: Long, isNew: Boolean)
    }

    data class Volume(val id: String, val source: String, val label: String, val mountPath: String, val scanRoot: File)

    val internalRoot = File(Environment.getExternalStorageDirectory(), "FrameMedia")
    val displayDir = File(context.filesDir, "cache/display")

    private val thread = HandlerThread("OpenFrame-indexer", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)
    private val observers = mutableListOf<FileObserver>()

    /** Ids inserted during the current scan that count as "new" (shown soon by the slideshow). */
    private val newIds = HashSet<Long>()

    @Volatile var volumes: List<Volume> = emptyList()
        private set
    @Volatile var isBusy = false
        private set
    @Volatile var lastScanAt = 0L
        private set

    private val scanRunnable = Runnable { scan() }
    private val processRunnable = Runnable { processBatch() }
    private val periodicRunnable = object : Runnable {
        override fun run() {
            requestScan("periodic", 0)
            handler.postDelayed(this, PERIODIC_SCAN_MS)
        }
    }

    fun start() {
        handler.post { requeueFailedAfterUpdate() }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_MEDIA_MOUNTED)
            addAction(Intent.ACTION_MEDIA_UNMOUNTED)
            addAction(Intent.ACTION_MEDIA_EJECT)
            addAction(Intent.ACTION_MEDIA_REMOVED)
            addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
            addDataScheme("file")
        }
        context.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                Log.i(TAG, "Storage event ${intent.action} ${intent.data}")
                requestScan("storage event", 1_000)
            }
        }, filter, null, handler)

        config.addListener { requestScan("config changed", 500) }
        handler.post(periodicRunnable)
    }

    /** Coalesces scan requests; the latest delay wins. */
    fun requestScan(reason: String, delayMs: Long = 2_000) {
        Log.d(TAG, "Media scan requested: $reason")
        handler.removeCallbacks(scanRunnable)
        handler.postDelayed(scanRunnable, delayMs)
    }

    fun displayFile(id: Long) = File(displayDir, "$id.jpg")
    fun backgroundFile(id: Long) = File(displayDir, "${id}_bg.jpg")

    // Preview strips for the seek bar (VideoStrip, SPEC §6): made when a video is indexed, or on first request.
    private val stripDir = File(context.filesDir, "cache/strips")
    fun stripFile(id: Long) = File(stripDir, "$id.jpg")
    private fun stripMeta(id: Long) = File(stripDir, "$id.json")
    private val stripLock = Any()

    /** The strip's description (with its file current), building it first if needed; null if it can't be made. */
    fun strip(id: Long, video: File): org.json.JSONObject? = synchronized(stripLock) {
        val img = stripFile(id)
        val meta = stripMeta(id)
        if (img.isFile && meta.isFile && img.lastModified() >= video.lastModified()) {
            runCatching { org.json.JSONObject(meta.readText()) }.getOrNull()
                ?.takeIf { it.optInt("v") == VideoStrip.VERSION }?.let { return it }
        }
        VideoStrip.build(video, img)?.also { meta.writeText(it.toString()) }
    }

    private fun deleteDerived(id: Long) {
        displayFile(id).delete()
        backgroundFile(id).delete()
        stripFile(id).delete()
        stripMeta(id).delete()
    }

    private fun requeueFailedAfterUpdate() {
        val prefs = context.getSharedPreferences("indexer", Context.MODE_PRIVATE)
        if (prefs.getInt("videoRules", 0) != VIDEO_RULES) {
            Log.i(TAG, "Video rules changed: checking ${db.requeueVideos()} video(s) again")
            prefs.edit().putInt("videoRules", VIDEO_RULES).apply()
        }
        if (!prefs.getBoolean("photoOwnDates", false)) {
            Log.i(TAG, "Photos keep their own date: checking ${db.requeueSentPhotos()} uploaded photo(s) again")
            prefs.edit().putBoolean("photoOwnDates", true).apply()
        }
        @Suppress("DEPRECATION")
        val version = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
        // lastUpdateTime changes on every install, so debug reinstalls retry too.
        val installed = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        val key = "$version:$installed"
        if (prefs.getString("build", null) == key) return
        val n = db.requeueFailed()
        if (n > 0) Log.i(TAG, "App updated; retrying $n previously failed item(s)")
        prefs.edit().putString("build", key).apply()
    }

    // ---- Scan (runs on the indexer thread) ----

    private fun scan() {
        isBusy = true
        val started = SystemClock.elapsedRealtime()
        val now = System.currentTimeMillis()
        val gen = now
        try {
            ensureInternalFolders()
            val vols = discoverVolumes()
            volumes = vols

            var added = 0; var changed = 0; var removed = 0
            for (v in vols) {
                val firstTime = db.touchVolume(v.id, v.label, now)
                val r = scanVolume(v, gen, now, treatAsNew = !firstTime)
                added += r.first; changed += r.second; removed += r.third
            }
            db.setAvailability(vols.map { it.id }.toSet())
            watchInternalFolders()
            lastScanAt = System.currentTimeMillis()
            Log.i(TAG, "Media scan: ${vols.size} volume(s), +$added ~$changed -$removed " +
                "in ${SystemClock.elapsedRealtime() - started} ms")
            listener.onLibraryChanged()
        } catch (e: Exception) {
            Log.e(TAG, "Media scan failed", e)
        } finally {
            handler.removeCallbacks(processRunnable)
            handler.post(processRunnable)
        }
    }

    /** Returns (added, changed, removed). */
    private fun scanVolume(v: Volume, gen: Long, now: Long, treatAsNew: Boolean): Triple<Int, Int, Int> {
        if (!v.scanRoot.isDirectory) {
            Log.w(TAG, "Scan root missing for ${v.id}: ${v.scanRoot}")
            return Triple(0, 0, 0)
        }
        val known = db.knownOnVolume(v.id)
        val seen = ArrayList<Long>()
        var added = 0; var changed = 0
        var walkComplete = true
        var unsettled = false

        db.inTransaction {
            walkComplete = walk(v.scanRoot, depth = 0) { file, type ->
                val size = file.length()
                val mtime = file.lastModified()
                val k = known[file.path]
                when {
                    // Still being written (copy/upload in progress): leave it for a follow-up scan.
                    now - mtime in 0 until SETTLE_MS -> {
                        k?.let { seen += it.id }
                        unsettled = true
                    }
                    k == null -> {
                        val id = db.insertPending(file.path, v.source, v.id, type, size, mtime, now, gen)
                        if (treatAsNew) newIds += id // photos and videos alike (videos only once they have a poster)
                        added++
                    }
                    k.size != size || k.mtime != mtime -> {
                        db.markChanged(k.id, size, mtime, gen)
                        changed++
                    }
                    else -> seen += k.id
                }
            }
            db.markSeen(seen, gen)
        }
        if (unsettled) requestScan("files still being written", SETTLE_MS)

        // Only prune when the whole tree was walked and the volume is still there; a drive
        // pulled mid-scan must not wipe its rows.
        var removed = 0
        if (walkComplete && v.scanRoot.isDirectory) {
            val gone = db.deleteUnseen(v.id, gen)
            gone.forEach { deleteDerived(it) }
            removed = gone.size
        }
        return Triple(added, changed, removed)
    }

    /** Depth-first walk; returns false if a directory could not be listed. */
    private fun walk(dir: File, depth: Int, onFile: (File, String) -> Unit): Boolean {
        if (depth > MAX_DEPTH) return true
        val children = dir.listFiles() ?: return false
        var ok = true
        for (f in children) {
            val name = f.name
            if (name.startsWith('.') || name in SKIP_DIRS) continue
            if (f.isDirectory) {
                ok = walk(f, depth + 1, onFile) && ok
            } else {
                val type = ImageProcessor.typeForName(name) ?: continue
                onFile(f, type)
            }
        }
        return ok
    }

    private fun ensureInternalFolders() {
        val uploads = File(internalRoot, "uploads")
        if (!uploads.isDirectory && !uploads.mkdirs()) {
            Log.e(TAG, "Could not create $uploads (storage permission missing?)")
        }
    }

    private fun discoverVolumes(): List<Volume> {
        val out = mutableListOf(Volume("internal", "internal", "Internal storage", internalRoot.path, internalRoot))
        val rm = config.removable
        if (!rm.enabled) return out
        val sm = context.getSystemService(StorageManager::class.java)
        for (sv in sm.storageVolumes) {
            if (!sv.isRemovable) continue
            val state = sv.state
            if (state != Environment.MEDIA_MOUNTED && state != Environment.MEDIA_MOUNTED_READ_ONLY) continue
            val uuid = sv.uuid ?: continue
            // StorageVolume.getPath() is hidden but reachable on API 27 (no hidden-API restrictions until 28).
            val path = try {
                StorageVolume_getPath.invoke(sv) as String
            } catch (e: Exception) {
                Log.e(TAG, "Cannot resolve path for removable volume $uuid", e)
                continue
            }
            val root = if (rm.subfolder.isEmpty()) File(path) else File(path, rm.subfolder)
            out += Volume("removable:$uuid", "removable", sv.getDescription(context) ?: uuid, path, root)
        }
        return out
    }

    private fun watchInternalFolders() {
        observers.forEach { it.stopWatching() }
        observers.clear()
        val dirs = ArrayList<File>()
        fun collect(d: File, depth: Int) {
            if (depth > MAX_DEPTH) return
            dirs += d
            d.listFiles()?.forEach { if (it.isDirectory && !it.name.startsWith('.')) collect(it, depth + 1) }
        }
        if (internalRoot.isDirectory) collect(internalRoot, 0)
        val mask = FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or FileObserver.MOVED_FROM or
            FileObserver.DELETE or FileObserver.CREATE
        for (d in dirs.take(MAX_WATCHED_DIRS)) {
            @Suppress("DEPRECATION")
            val obs = object : FileObserver(d.path, mask) {
                override fun onEvent(event: Int, path: String?) {
                    if (path == null || path.startsWith('.') || path.endsWith(".tmp")) return
                    requestScan("file change in ${d.name}", 3_000)
                }
            }
            obs.startWatching()
            observers += obs
        }
    }

    // ---- Processing (display copies), in batches ----

    private fun processBatch() {
        val batch = db.nextPending(BATCH_SIZE)
        if (batch.isEmpty()) {
            isBusy = false
            newIds.clear()
            return
        }
        isBusy = true
        for (p in batch) processOne(p)
        handler.post(processRunnable)
    }

    private fun processOne(p: MediaDb.Pending) {
        val file = File(p.path)
        val started = SystemClock.elapsedRealtime()
        try {
            if (!file.isFile) {
                db.setStatus(p.id, MediaDb.STATUS_ERROR, "File disappeared before it could be processed.")
                return
            }
            if (p.type == "photo") {
                val r = ImageProcessor.processPhoto(file, displayFile(p.id), backgroundFile(p.id))
                db.savePhotoResult(p.id, r)
                db.applySentMeta(p.id)
                Log.d(TAG, "Indexed photo #${p.id} ${file.name} ${r.width}×${r.height} → ${r.displayW}×${r.displayH}" +
                    " faces=${r.face != null} in ${SystemClock.elapsedRealtime() - started} ms")
                listener.onItemReady(p.id, p.id in newIds)
            } else {
                val r = ImageProcessor.processVideo(file, displayFile(p.id), backgroundFile(p.id))
                db.saveVideoResult(p.id, r)
                db.applySentMeta(p.id) // the Shortcut's date and place (its conversion drops the file's own)
                Log.d(TAG, "Indexed video #${p.id} ${file.name} ${r.width}×${r.height} ${r.durationMs} ms → poster " +
                    "${r.displayW}×${r.displayH} faces=${r.face != null} in ${SystemClock.elapsedRealtime() - started} ms")
                // The seek bar's preview strip, before the slideshow learns of the video (a new one plays at once,
                // and two decoders at a time are best avoided): about 1 s per 4 s of video.
                stripFile(p.id).delete() // an older strip of a replaced file
                strip(p.id, file)
                listener.onItemReady(p.id, p.id in newIds)
            }
        } catch (e: ImageProcessor.Unsupported) {
            Log.w(TAG, "Media #${p.id} ${file.name}: ${e.status}: ${e.message}")
            db.setStatus(p.id, e.status, e.message, e.mime)
        } catch (e: Exception) {
            Log.e(TAG, "Processing failed for #${p.id} ${file.path}", e)
            db.setStatus(p.id, MediaDb.STATUS_ERROR, "Processing failed: ${e.javaClass.simpleName}")
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "Out of memory processing #${p.id} ${file.path}", e)
            db.setStatus(p.id, MediaDb.STATUS_TOO_LARGE, "Image is too large to process.")
        }
        if (db.item(p.id)?.status != MediaDb.STATUS_OK) {
            // Don't leave a copy from an earlier successful run of a now-broken file.
            deleteDerived(p.id)
        }
    }

    private companion object {
        const val PERIODIC_SCAN_MS = 5 * 60_000L
        const val SETTLE_MS = 5_000L
        const val MAX_DEPTH = 12
        const val MAX_WATCHED_DIRS = 64
        const val BATCH_SIZE = 4
        /** Bump when videos must be processed again: 1 posters and playability, 2 date and place from the file. */
        const val VIDEO_RULES = 2
        val SKIP_DIRS = setOf("LOST.DIR", "System Volume Information", "\$RECYCLE.BIN", "Android")

        @Suppress("ObjectPropertyName")
        val StorageVolume_getPath: java.lang.reflect.Method =
            android.os.storage.StorageVolume::class.java.getMethod("getPath")
    }
}
