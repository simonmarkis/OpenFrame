package app.openframe

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** File naming for uploads (SPEC §17). Pure JVM, unit-tested. */
object UploadNames {

    /** Extension for a sniffed type the frame can show; null for anything else (rejected). */
    fun extFor(mime: String?): String? = when (mime) {
        "image/jpeg" -> "jpg"
        "image/png" -> "png"
        "image/webp" -> "webp"
        "video/mp4" -> "mp4"
        "video/quicktime" -> "mov"
        else -> null
    }

    /** A few bytes of text arrived instead of a file: the Shortcut sends the wrong variable. */
    const val SHORT_TEXT = "The Shortcut sent text instead of the photo or video. In its last action " +
        "(Get Contents of URL), set Request Body → File to If Result."

    /** Why a sniffed type is refused, in words for the uploader. */
    fun rejectReason(mime: String?): String = when (mime) {
        "image/heic", "image/avif" -> "HEIC/AVIF photos can't be shown on this frame. Send it as JPEG " +
            "(the iPhone Shortcut and the upload page in Safari convert automatically)."
        "audio/mp4" -> "That's an audio file, not a photo or video."
        else -> "That isn't a photo or video the frame can use (JPEG, PNG, WebP, MP4, or MOV)."
    }

    /**
     * A safe base name from what the client sent: no folders, no extension, only letters, digits,
     * spaces and - _ ( ) ., at most 80 characters. Empty → "upload-<date>-<time>".
     */
    fun safeBase(raw: String?, now: Long = System.currentTimeMillis()): String {
        val name = raw.orEmpty().substringAfterLast('/').substringAfterLast('\\')
        val noExt = if (name.lastIndexOf('.') > 0) name.substring(0, name.lastIndexOf('.')) else name
        val cleaned = noExt.replace(Regex("[^\\p{L}\\p{N} ._()-]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim(' ', '.', '_')
            .take(80)
            .trim(' ', '.')
        return cleaned.ifEmpty { "upload-" + SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(now)) }
    }

    /** "name.jpg", or "name (2).jpg", "name (3).jpg", ... if taken. */
    fun unique(base: String, ext: String, taken: (String) -> Boolean): String {
        var candidate = "$base.$ext"
        var n = 2
        while (taken(candidate)) candidate = "$base ($n).${ext}".also { n++ }
        return candidate
    }
}
