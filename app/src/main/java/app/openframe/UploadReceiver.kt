package app.openframe

import android.os.StatFs
import android.util.Log
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Receives one uploaded file (SPEC §17): `POST /api/upload?name=&comment=` with the file as the raw
 * request body (not multipart: one file per request streams straight to disk, which suits both the
 * upload page and the iPhone Shortcut and keeps big videos out of memory).
 *
 * - The type is checked from the content, not the name; only formats the frame can show are kept.
 * - Exact copies of something already on the frame (same size and SHA-256) are not saved again.
 * - The file lands in `FrameMedia/uploads/`, where the indexer picks it up; new items jump the
 *   slideshow queue. A comment is attached when the indexer creates the row.
 */
class UploadReceiver(private val app: OpenFrameApp) {

    sealed class Result {
        data class Saved(val name: String, val type: String) : Result()
        data class Duplicate(val existing: String) : Result()
        /** [what]: "photo", "video", or "file" (type unknown), for the warning (SPEC §13). */
        data class Rejected(val http: Int, val message: String, val what: String = "file") : Result()
    }

    private val uploads = File(app.indexer.internalRoot, "uploads")
    private val incoming = File(uploads, ".incoming") // dot folder: the indexer and its watchers skip it
    private val lock = Any()

    fun receive(
        input: InputStream, length: Long, rawName: String?, rawComment: String?,
        sent: UploadMeta.Sent = UploadMeta.Sent(null, null, null),
    ): Result = synchronized(lock) {
        if (length <= 0) return Result.Rejected(411, "The upload is empty or its size is missing.")
        if (length > MAX_BYTES) return Result.Rejected(413, "Files over ${MAX_BYTES shr 30} GB can't be uploaded.")
        incoming.mkdirs()
        val free = runCatching { StatFs(uploads.path).availableBytes }.getOrDefault(Long.MAX_VALUE)
        if (free - length < KEEP_FREE_BYTES) {
            drain(input, length)
            return Result.Rejected(507, "The frame is almost out of storage.")
        }

        // First bytes decide the type.
        val head = ByteArray(16)
        var n = 0
        while (n < head.size && n < length) {
            val r = input.read(head, n, head.size - n)
            if (r < 0) break
            n += r
        }
        val mime = ImageProcessor.sniffHeader(head, n)
        val ext = UploadNames.extFor(mime)
        if (ext == null) {
            // What arrived instead (size and first bytes), so a misconfigured Shortcut can be diagnosed.
            val start = (0 until n).joinToString(" ") { "%02x".format(head[it]) }
            val text = String(head, 0, n, Charsets.US_ASCII).map { if (it in ' '..'~') it else '.' }.joinToString("")
            Log.i(TAG, "Upload refused: ${mime ?: "unknown type"}, $length bytes, starts $start ($text)")
            drain(input, length - n)
            // A few bytes of plain text: the Shortcut's body points at the wrong variable (seen: the longitude).
            val shortText = mime == null && length < 200 && (0 until n).all { head[it] in 9..126 }
            return Result.Rejected(415, if (shortText) UploadNames.SHORT_TEXT else UploadNames.rejectReason(mime), whatFor(mime))
        }

        val tmp = File(incoming, "${System.nanoTime()}.part")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            tmp.outputStream().buffered(BUF).use { out ->
                out.write(head, 0, n)
                digest.update(head, 0, n)
                var remaining = length - n
                val buf = ByteArray(BUF)
                while (remaining > 0) {
                    val r = input.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
                    if (r < 0) break
                    out.write(buf, 0, r)
                    digest.update(buf, 0, r)
                    remaining -= r
                }
                if (remaining > 0) {
                    tmp.delete()
                    return Result.Rejected(400, "The upload stopped before the whole file arrived.")
                }
            }
            val hash = digest.digest()

            findCopy(length, hash)?.let { existing ->
                tmp.delete()
                Log.i(TAG, "Upload skipped: identical to ${existing.name}")
                // Sent again with the location's name (a newer Shortcut): the caption gets it (SPEC §8).
                if (sent.place != null && app.mediaDb.setSentPlace(existing.path, sent.place)) app.placeLookup.request()
                return Result.Duplicate(existing.name)
            }

            // A video the frame can't play (4K, 10-bit HDR, other codecs) isn't kept: nothing could show it (SPEC §6).
            if (mime!!.startsWith("video/")) ImageProcessor.videoProblem(tmp)?.let { why ->
                tmp.delete()
                Log.i(TAG, "Upload refused: $why")
                return Result.Rejected(415, why, "video")
            }

            val name = UploadNames.unique(UploadNames.safeBase(rawName), ext) { File(uploads, it).exists() }
            val target = File(uploads, name)
            rawComment?.trim()?.take(MediaEdits.MAX_COMMENT)?.takeIf { it.isNotEmpty() }?.let { app.mediaDb.setPendingComment(target.path, it) }
            app.mediaDb.setSentMeta(target.path, sent)
            if (!tmp.renameTo(target)) {
                tmp.delete()
                return Result.Rejected(500, "The frame couldn't save the file.")
            }
            Log.i(TAG, "Upload saved: $name (${length / 1024} KB)")
            app.indexer.requestScan("upload", 0)
            return Result.Saved(name, if (mime.startsWith("video/")) "video" else "photo")
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }

    private fun whatFor(mime: String?) = when {
        mime == null -> "file"
        mime.startsWith("video/") -> "video"
        mime.startsWith("image/") -> "photo"
        else -> "file"
    }

    /** An existing file with the same size and content: indexed items, plus uploads not indexed yet. */
    private fun findCopy(size: Long, hash: ByteArray): File? {
        val candidates = LinkedHashSet<File>()
        app.mediaDb.pathsWithSize(size).forEach { candidates += File(it) }
        uploads.listFiles()?.filter { it.isFile && it.length() == size }?.forEach { candidates += it }
        return candidates.firstOrNull { f ->
            f.isFile && f.length() == size && runCatching { MessageDigest.isEqual(sha256(f), hash) }.getOrDefault(false)
        }
    }

    private fun sha256(f: File): ByteArray {
        val d = MessageDigest.getInstance("SHA-256")
        f.inputStream().buffered(BUF).use { input ->
            val buf = ByteArray(BUF)
            while (true) {
                val r = input.read(buf)
                if (r < 0) break
                d.update(buf, 0, r)
            }
        }
        return d.digest()
    }

    /** Reads and discards the rest of a refused body, so the client gets the answer instead of a broken connection. */
    private fun drain(input: InputStream, count: Long) {
        var remaining = count
        val buf = ByteArray(BUF)
        while (remaining > 0) {
            val r = input.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
            if (r < 0) break
            remaining -= r
        }
    }

    private companion object {
        const val MAX_BYTES = 2L shl 30
        const val KEEP_FREE_BYTES = 300L shl 20
        const val BUF = 64 * 1024
    }
}
