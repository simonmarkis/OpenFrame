package app.openframe

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.media.ExifInterface
import android.media.FaceDetector
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import java.io.File
import java.io.FileOutputStream
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Photo/video metadata and display-copy generation (SPEC §6).
 *
 * Display copy: oriented upright, sized to *fill* the 1366×768 screen in either orientation
 * (short edge ≥ 1366 where the source allows), long edge capped at [MAX_LONG_EDGE].
 * Background copy: tiny, pre-blurred, darkened JPEG for the "blur" background option, so the
 * WebView never has to run a CSS blur filter.
 */
object ImageProcessor {

    class Unsupported(val status: String, message: String, val mime: String? = null) : Exception(message)

    class PhotoResult(
        val mime: String, val width: Int, val height: Int, val takenAt: Long?,
        val lat: Double?, val lon: Double?, val displayW: Int, val displayH: Int, val face: FloatArray?,
    )

    /** [width]/[height] as shown (after the rotation flag); the display size is the poster's. */
    class VideoResult(
        val mime: String?, val width: Int?, val height: Int?, val durationMs: Long?,
        val takenAt: Long?, val lat: Double?, val lon: Double?,
        val displayW: Int, val displayH: Int, val face: FloatArray?,
    )

    private const val SCREEN_LONG = 1366
    private const val SCREEN_SHORT = 768
    private const val MAX_LONG_EDGE = 2048
    private const val JPEG_QUALITY = 85
    private const val BG_LONG_EDGE = 48
    private const val FACE_MAX_WIDTH = 480
    private const val MAX_FACES = 8
    private const val JPEG_TAIL_WINDOW = 64 * 1024

    val PHOTO_EXTS = setOf("jpg", "jpeg", "png", "webp", "heic", "heif")
    val VIDEO_EXTS = setOf("mp4", "mov", "m4v")
    /** Recognized as video so they get reported, but not playable (no MP4/MOV container, or unsupported container). */
    private val UNSUPPORTED_VIDEO_EXTS = setOf("hevc", "h265", "265", "h264", "264", "mkv", "avi", "wmv", "webm")

    fun typeForName(name: String): String? {
        val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
        return when (ext) {
            in PHOTO_EXTS -> "photo"
            in VIDEO_EXTS, in UNSUPPORTED_VIDEO_EXTS -> "video"
            else -> null
        }
    }

    // ---- Format sniffing ----

    private fun sniff(file: File): String? {
        val h = ByteArray(16)
        val n = file.inputStream().use { it.read(h) }
        return sniffHeader(h, n)
    }

    /** Media type from the first 12–16 bytes (content, not extension); null if not a known format. */
    fun sniffHeader(h: ByteArray, n: Int): String? {
        if (n < 12) return null
        fun ascii(from: Int, to: Int) = String(h, from, to - from, Charsets.US_ASCII)
        return when {
            h[0] == 0xFF.toByte() && h[1] == 0xD8.toByte() && h[2] == 0xFF.toByte() -> "image/jpeg"
            h[0] == 0x89.toByte() && ascii(1, 4) == "PNG" -> "image/png"
            ascii(0, 4) == "RIFF" && ascii(8, 12) == "WEBP" -> "image/webp"
            ascii(4, 8) == "ftyp" -> when (ascii(8, 12)) {
                "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1" -> "image/heic"
                "avif", "avis" -> "image/avif"
                "qt  " -> "video/quicktime"
                "M4A ", "M4B ", "M4P " -> "audio/mp4"
                else -> "video/mp4"
            }
            else -> null
        }
    }

    /**
     * True if the JPEG's tail contains an EOI marker (FF D9). Entropy-coded data can't contain
     * FF D9, so a file cut off mid-scan won't match; some cameras append data after EOI, hence the window.
     */
    private fun jpegHasEnd(file: File): Boolean {
        val len = file.length()
        val window = min(len, JPEG_TAIL_WINDOW.toLong()).toInt()
        val tail = ByteArray(window)
        java.io.RandomAccessFile(file, "r").use { raf ->
            raf.seek(len - window)
            raf.readFully(tail)
        }
        for (i in window - 2 downTo 0) {
            if (tail[i] == 0xFF.toByte() && tail[i + 1] == 0xD9.toByte()) return true
        }
        return false
    }

    // ---- Photos ----

    fun processPhoto(src: File, displayOut: File, bgOut: File): PhotoResult {
        val mime = sniff(src)
        when (mime) {
            "image/heic" -> throw Unsupported(MediaDb.STATUS_UNSUPPORTED,
                "HEIC photos can't be decoded on Android 8.1. Convert to JPEG (the iOS Shortcut does this).", mime)
            "image/avif" -> throw Unsupported(MediaDb.STATUS_UNSUPPORTED, "AVIF photos are not supported.", mime)
            "image/jpeg", "image/png", "image/webp" -> Unit
            else -> throw Unsupported(MediaDb.STATUS_ERROR, "Not a readable image (corrupt or unknown format).", mime)
        }
        // Android decodes partial JPEGs (gray fill), so check for the end-of-image marker explicitly.
        if (mime == "image/jpeg" && !jpegHasEnd(src)) {
            throw Unsupported(MediaDb.STATUS_ERROR, "Image file is incomplete (truncated copy?).", mime)
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        val rawW = bounds.outWidth
        val rawH = bounds.outHeight
        if (rawW <= 0 || rawH <= 0) {
            throw Unsupported(MediaDb.STATUS_ERROR, "Image could not be decoded (corrupt file?).", mime)
        }

        val exif = if (mime == "image/jpeg") readExif(src) else null
        val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            ?: ExifInterface.ORIENTATION_NORMAL
        val swaps = orientation in setOf(
            ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE,
        )
        val w = if (swaps) rawH else rawW
        val h = if (swaps) rawW else rawH

        val scale = displayScale(w, h)
        val tw = max(1, (w * scale).roundToInt())
        val th = max(1, (h * scale).roundToInt())

        // Decode with the largest power-of-two subsample that keeps us at or above target size.
        val targetRawW = if (swaps) th else tw
        val targetRawH = if (swaps) tw else th
        var sample = 1
        while (rawW / (sample * 2) >= targetRawW && rawH / (sample * 2) >= targetRawH) sample *= 2

        val decoded = try {
            BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            })
        } catch (e: OutOfMemoryError) {
            throw Unsupported(MediaDb.STATUS_TOO_LARGE, "Image is too large to decode (${rawW}×${rawH}).", mime)
        } ?: throw Unsupported(MediaDb.STATUS_ERROR, "Image could not be decoded (corrupt file?).", mime)

        val m = orientationMatrix(orientation)
        m.postScale(tw.toFloat() / (if (swaps) decoded.height else decoded.width),
            th.toFloat() / (if (swaps) decoded.width else decoded.height))
        val display = try {
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        } catch (e: Throwable) {
            decoded.recycle()
            throw e
        }
        // createBitmap returns the source itself when the matrix is identity.
        if (display !== decoded) decoded.recycle()

        try {
            val face = writeCopies(display, displayOut, bgOut)

            val latLong = FloatArray(2)
            val hasGps = exif?.getLatLong(latLong) == true
            return PhotoResult(
                mime = mime, width = w, height = h, takenAt = exif?.let(::exifTakenAt),
                lat = if (hasGps) latLong[0].toDouble() else null,
                lon = if (hasGps) latLong[1].toDouble() else null,
                displayW = display.width, displayH = display.height, face = face,
            )
        } finally {
            display.recycle()
        }
    }

    /** Display copy, blurred background copy, and face box from an upright display-size bitmap. */
    private fun writeCopies(display: Bitmap, displayOut: File, bgOut: File): FloatArray? {
        writeJpeg(display, displayOut, JPEG_QUALITY)
        writeBackground(display, bgOut)
        return detectFaces(display)
    }

    /** Scale (≤ 1) so the oriented image can *fill* the screen in landscape and in portrait. */
    private fun displayScale(w: Int, h: Int): Float {
        val coverLandscape = max(SCREEN_LONG.toFloat() / w, SCREEN_SHORT.toFloat() / h)
        val coverPortrait = max(SCREEN_SHORT.toFloat() / w, SCREEN_LONG.toFloat() / h)
        val cap = MAX_LONG_EDGE.toFloat() / max(w, h)
        return min(1f, min(cap, max(coverLandscape, coverPortrait)))
    }

    private fun orientationMatrix(orientation: Int): Matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(-90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(-90f)
        }
    }

    private fun readExif(file: File): ExifInterface? = try {
        ExifInterface(file.path)
    } catch (e: Exception) {
        null
    }

    private fun exifTakenAt(exif: ExifInterface): Long? {
        val raw = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
            ?: exif.getAttribute(ExifInterface.TAG_DATETIME) ?: return null
        val fmt = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).apply { isLenient = false }
        // Without an offset tag, EXIF times are local wall-clock time; interpret in the frame's zone.
        fmt.timeZone = TimeZone.getDefault()
        return try {
            fmt.parse(raw.trim())?.time?.takeIf { it > 0 }
        } catch (e: ParseException) {
            null
        }
    }

    private fun writeJpeg(bmp: Bitmap, out: File, quality: Int) {
        out.parentFile?.mkdirs()
        val tmp = File(out.parentFile, out.name + ".tmp")
        FileOutputStream(tmp).use { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }
        if (!tmp.renameTo(out)) throw IllegalStateException("Could not write ${out.name}")
    }

    private fun writeBackground(display: Bitmap, out: File) {
        // Halve repeatedly (with filtering) for a smooth tiny image, then box-blur and darken.
        var cur = display
        while (max(cur.width, cur.height) / 2 >= BG_LONG_EDGE) {
            val next = Bitmap.createScaledBitmap(cur, max(1, cur.width / 2), max(1, cur.height / 2), true)
            if (cur !== display) cur.recycle()
            cur = next
        }
        val small = if (cur === display) cur.copy(Bitmap.Config.ARGB_8888, true) else cur
        val blurred = boxBlur(small, radius = 2, passes = 3)
        if (small !== blurred) small.recycle()

        val dark = Bitmap.createBitmap(blurred.width, blurred.height, Bitmap.Config.ARGB_8888)
        Canvas(dark).drawBitmap(blurred, 0f, 0f, Paint().apply {
            colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setScale(0.6f, 0.6f, 0.6f, 1f) })
        })
        blurred.recycle()
        try {
            writeJpeg(dark, out, 80)
        } finally {
            dark.recycle()
        }
    }

    private fun boxBlur(src: Bitmap, radius: Int, passes: Int): Bitmap {
        val w = src.width
        val h = src.height
        var px = IntArray(w * h).also { src.getPixels(it, 0, w, 0, 0, w, h) }
        var tmp = IntArray(w * h)
        repeat(passes) {
            blurLine(px, tmp, w, h, radius, horizontal = true)
            blurLine(tmp, px, w, h, radius, horizontal = false)
        }
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }

    private fun blurLine(src: IntArray, dst: IntArray, w: Int, h: Int, r: Int, horizontal: Boolean) {
        val lines = if (horizontal) h else w
        val len = if (horizontal) w else h
        for (line in 0 until lines) {
            for (i in 0 until len) {
                var rs = 0; var gs = 0; var bs = 0; var n = 0
                for (k in -r..r) {
                    val j = (i + k).coerceIn(0, len - 1)
                    val p = if (horizontal) src[line * w + j] else src[j * w + line]
                    rs += (p shr 16) and 0xFF; gs += (p shr 8) and 0xFF; bs += p and 0xFF; n++
                }
                val idx = if (horizontal) line * w + i else i * w + line
                dst[idx] = (0xFF shl 24) or ((rs / n) shl 16) or ((gs / n) shl 8) or (bs / n)
            }
        }
    }

    /** Union box of detected faces, normalized [x0, y0, x1, y1], or null. Offline, built into Android. */
    private fun detectFaces(display: Bitmap): FloatArray? {
        val scale = min(1f, FACE_MAX_WIDTH.toFloat() / display.width)
        var fw = max(2, (display.width * scale).roundToInt())
        if (fw % 2 != 0) fw -= 1 // FaceDetector requires an even width
        val fh = max(1, (display.height * fw.toFloat() / display.width).roundToInt())
        val scaled = Bitmap.createScaledBitmap(display, fw, fh, true)
        val rgb565 = scaled.copy(Bitmap.Config.RGB_565, false)
        if (scaled !== display) scaled.recycle()
        try {
            val faces = arrayOfNulls<FaceDetector.Face>(MAX_FACES)
            val found = FaceDetector(fw, fh, MAX_FACES).findFaces(rgb565, faces)
            var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -1f; var y1 = -1f
            val mid = PointF()
            var used = 0
            for (i in 0 until found) {
                val f = faces[i] ?: continue
                if (f.confidence() < FaceDetector.Face.CONFIDENCE_THRESHOLD) continue
                f.getMidPoint(mid)
                val d = f.eyesDistance()
                // Approximate face box from eye midpoint and eye distance.
                x0 = min(x0, mid.x - d * 1.1f); x1 = max(x1, mid.x + d * 1.1f)
                y0 = min(y0, mid.y - d * 1.2f); y1 = max(y1, mid.y + d * 1.7f)
                used++
            }
            if (used == 0) return null
            return floatArrayOf(
                (x0 / fw).coerceIn(0f, 1f), (y0 / fh).coerceIn(0f, 1f),
                (x1 / fw).coerceIn(0f, 1f), (y1 / fh).coerceIn(0f, 1f),
            )
        } finally {
            rgb565.recycle()
        }
    }

    // ---- Videos (SPEC §6): playability check, metadata, and a poster ----

    /**
     * Checks that the frame can play [src] ([VideoCheck]), reads its metadata, and turns its first frame
     * into a poster: display copy, blurred background, and face box, exactly like a photo's.
     */
    fun processVideo(src: File, displayOut: File, bgOut: File): VideoResult {
        val mime = sniff(src)
        if (mime != "video/mp4" && mime != "video/quicktime") {
            val ext = src.extension.lowercase(Locale.US)
            val reason = if (ext in setOf("hevc", "h265", "265", "h264", "264"))
                "Raw video stream without a container; re-save as MP4 or MOV (the iOS Shortcut does this)."
            else "Video format not supported; use MP4 or MOV (H.264 or HEVC)."
            throw Unsupported(MediaDb.STATUS_UNSUPPORTED, reason, mime)
        }
        val track = try {
            videoTrack(src)
        } catch (e: Exception) {
            throw Unsupported(MediaDb.STATUS_ERROR, "Video could not be read (${e.javaClass.simpleName}).", mime)
        } ?: throw Unsupported(MediaDb.STATUS_UNSUPPORTED, "No video picture in this file (sound only?).", mime)
        VideoCheck.problem(track)?.let { throw Unsupported(MediaDb.STATUS_UNSUPPORTED, it, track.mime) }

        val mmr = MediaMetadataRetriever()
        try {
            mmr.setDataSource(src.path)
            val rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            var w = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: track.width
            var h = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: track.height
            if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
            val duration = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            // Date and place from the file itself: this frame's retriever returns none (Mp4Meta).
            val meta = try { Mp4Meta.read(src) } catch (e: Exception) { Mp4Meta.Result(null, null, null) }
            val date = meta.takenAt ?: mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE)?.let(::parseVideoDate)
            val loc = if (meta.lat != null && meta.lon != null) meta.lat to meta.lon
                else mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION)?.let(Mp4Meta::parseIso6709)

            // The first frame, so the poster matches what playback starts with. Rockchip's retriever
            // sometimes returns nothing for it (seen once on a 2 s 640×360 clip): try a little later.
            val frame = posterFrame(mmr, src.name)
                ?: throw Unsupported(MediaDb.STATUS_ERROR, "No picture could be read from this video.", track.mime)
            val upright = upright(frame, rot, w, h)
            val scale = displayScale(w, h)
            val tw = max(1, (w * scale).roundToInt())
            val th = max(1, (h * scale).roundToInt())
            val display = if (upright.width == tw && upright.height == th) upright
                else Bitmap.createScaledBitmap(upright, tw, th, true).also { upright.recycle() }
            try {
                val face = writeCopies(display, displayOut, bgOut)
                return VideoResult(track.mime, w, h, duration, date, loc?.first, loc?.second, display.width, display.height, face)
            } finally {
                display.recycle()
            }
        } catch (e: Unsupported) {
            throw e
        } catch (e: RuntimeException) {
            throw Unsupported(MediaDb.STATUS_ERROR, "Video could not be read (${e.javaClass.simpleName}).", track.mime)
        } finally {
            mmr.release()
        }
    }

    /** Why the frame can't play the video in [file], or null if it can (or it can't be read: the indexer reports that). */
    fun videoProblem(file: File): String? {
        val track = try { videoTrack(file) } catch (e: Exception) { return null }
        return if (track == null) "No video picture in this file (sound only?)." else VideoCheck.problem(track)
    }

    /** The first video track's codec, coded size, frame rate, profile, and HDR flag (MediaExtractor). */
    private fun videoTrack(src: File): VideoCheck.Track? {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(src.path)
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val m = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (!m.startsWith("video/")) continue
                fun int(key: String) = if (f.containsKey(key)) try { f.getInteger(key) } catch (e: ClassCastException) {
                    f.getFloat(key).roundToInt()
                } else null
                val csd = f.getByteBuffer("csd-0")?.let { b -> ByteArray(b.remaining()).also { b.duplicate().get(it) } }
                val profile = csd?.let { VideoCheck.profileFromCsd(m, it) }
                val transfer = int(MediaFormat.KEY_COLOR_TRANSFER)
                val hdr = transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer == MediaFormat.COLOR_TRANSFER_HLG
                return VideoCheck.Track(m, int(MediaFormat.KEY_WIDTH) ?: 0, int(MediaFormat.KEY_HEIGHT) ?: 0,
                    int(MediaFormat.KEY_FRAME_RATE), profile, hdr)
            }
            return null
        } finally {
            ex.release()
        }
    }

    private fun posterFrame(mmr: MediaMetadataRetriever, name: String): Bitmap? {
        val tries = listOf(
            0L to MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
            0L to MediaMetadataRetriever.OPTION_NEXT_SYNC,
            500_000L to MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
            -1L to MediaMetadataRetriever.OPTION_CLOSEST_SYNC, // any frame the retriever likes
        )
        tries.forEachIndexed { i, (us, option) ->
            val f = try { mmr.getFrameAtTime(us, option) } catch (e: RuntimeException) { null }
            if (f != null) {
                if (i > 0) android.util.Log.w(TAG, "Video $name: poster from try ${i + 1} (${us / 1000} ms)")
                return f
            }
        }
        return null
    }

    /** Turns a frame as stored into the video's shown orientation, if Android didn't already. */
    private fun upright(frame: Bitmap, rot: Int, w: Int, h: Int): Bitmap {
        if (rot != 90 && rot != 270) return frame // 180 (rare): left as Android gives it
        if ((frame.width >= frame.height) == (w >= h)) return frame // Android already turned it
        val m = Matrix().apply { postRotate(rot.toFloat()) }
        return Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, m, true).also { if (it !== frame) frame.recycle() }
    }

    private fun parseVideoDate(raw: String): Long? {
        val fmt = SimpleDateFormat("yyyyMMdd'T'HHmmss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return try {
            fmt.parse(raw)?.time?.takeIf { it > 86_400_000L } // 1904/1970 epochs mean "unset"
        } catch (e: ParseException) {
            null
        }
    }
}
