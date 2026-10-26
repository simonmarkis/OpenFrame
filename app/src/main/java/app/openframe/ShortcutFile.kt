package app.openframe

import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * The user's exported "Send to Frame" Shortcut, kept on the frame so phones can download it from the
 * set-up guide (SPEC §17, user request 2026-10-15). The file has the upload key and the frame's address
 * built in, so it lives in app-private storage only (never in the project, logs, or config backups) and
 * is served behind the web access PIN. It remembers which key (as a hash) and address were current when
 * it was uploaded, so the guide can say when it needs exporting again.
 */
class ShortcutFile(private val dir: File) {
    private val file = File(dir, "send-to-frame.shortcut")
    private val meta = File(dir, "send-to-frame.json")

    val exists: Boolean get() = file.isFile

    fun file(): File? = file.takeIf { it.isFile }

    /** What the guide and Settings show: whether there is a file and whether it is out of date. */
    fun info(currentKey: String, currentHost: String?): JSONObject {
        if (!file.isFile) return JSONObject().put("hasFile", false)
        val m = runCatching { JSONObject(meta.readText()) }.getOrDefault(JSONObject())
        val host = m.optString("host").takeIf { it.isNotEmpty() }
        return JSONObject()
            .put("hasFile", true)
            .put("size", file.length())
            .put("uploadedAt", m.optLong("uploadedAt", file.lastModified()))
            .put("keyChanged", m.optString("keyHash") != hash(currentKey))
            .put("addressChanged", host != null && currentHost != null && host != currentHost)
    }

    /** Saves a new file from a raw upload. Returns null when saved, else the reason in words. */
    fun save(input: InputStream, length: Long, currentKey: String, currentHost: String?): String? {
        if (length <= 0) return "The file is empty."
        if (length > MAX_BYTES) return "That's too big for a Shortcut (over ${MAX_BYTES / 1_000_000} MB)."
        val bytes = ByteArray(length.toInt())
        var n = 0
        while (n < bytes.size) {
            val r = input.read(bytes, n, bytes.size - n)
            if (r < 0) break
            n += r
        }
        if (n < bytes.size) return "The upload stopped early. Try again."
        problem(bytes)?.let { return it }
        dir.mkdirs()
        val tmp = File(dir, "send-to-frame.part")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(file)) { tmp.delete(); return "Couldn't save the file on the frame." }
        meta.writeText(JSONObject().put("uploadedAt", System.currentTimeMillis())
            .put("keyHash", hash(currentKey)).put("host", currentHost ?: "").toString())
        Log.i(TAG, "Shortcut file saved (${bytes.size / 1024} KB)")
        return null
    }

    fun delete() {
        file.delete()
        meta.delete()
        Log.i(TAG, "Shortcut file removed")
    }

    companion object {
        private const val TAG = "OpenFrame"
        const val MAX_BYTES = 5_000_000L
        /** The name phones save it under (the Shortcuts app shows the Shortcut's own name). */
        const val DOWNLOAD_NAME = "Send to Frame.shortcut"

        /**
         * Why bytes aren't a Shortcut file (null = they are). Shortcuts exported from iOS 15+ are signed
         * Apple Encrypted Archives ("AEA1"); older or unsigned ones are binary property lists ("bplist00").
         */
        fun problem(bytes: ByteArray): String? {
            if (bytes.size < 64) return "That isn't a Shortcut file."
            val head = String(bytes, 0, 8, Charsets.US_ASCII)
            if (!head.startsWith("AEA1") && head != "bplist00") {
                return "That isn't a Shortcut file. In the Shortcuts app, share the Shortcut → Save to Files, and upload that .shortcut file."
            }
            return null
        }

        private fun hash(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
