package app.openframe

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Preview strip for scrubbing (SPEC §6, user request 2026-10-15): small pictures of a video at regular
 * steps (1 s, or longer for long videos), side by side in one JPEG, so the seek bar can show the picture
 * under the finger instantly; the player seeks once, on release.
 *
 * The frame's MediaMetadataRetriever (Rockchip's) can't be used: it ignores the requested time and
 * returns the first picture (measured 2026-10-15). So the video is decoded here with MediaCodec (the
 * hardware decoder), one keyframe per step: seek the extractor to the keyframe at or before the step,
 * feed samples until the decoder hands back a picture, sample it down from YUV, flush, next step.
 */
object VideoStrip {
    private const val TAG = "OpenFrame"
    const val TILE_H = 180 // px: every picture is this tall; its width follows the video's shape (320 for 16:9)
    /** Bumped when strips change; older ones are made again on request. */
    const val VERSION = 6
    private const val MAX_TILES = 100
    private const val FEED_LIMIT = 60 // samples fed per step before giving up on a picture
    private const val TIMEOUT_US = 10_000L
    private var logged = false // the decoder's buffer layout is logged once per run

    /**
     * Builds the strip for [video] into [out] (JPEG). Returns its description
     * `{ count, stepMs, tileW, tileH, durationMs }`, or null if the video can't be decoded here.
     */
    fun build(video: File, out: File): JSONObject? {
        val started = SystemClock.uptimeMillis()
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            ex.setDataSource(video.path)
            val track = (0 until ex.trackCount).firstOrNull {
                ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            } ?: return null
            ex.selectTrack(track)
            val fmt = ex.getTrackFormat(track)
            val mime = fmt.getString(MediaFormat.KEY_MIME) ?: return null
            val durUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
            if (durUs <= 0) return null
            val rotation = if (fmt.containsKey("rotation-degrees")) fmt.getInteger("rotation-degrees") else 0
            val step = maxOf(1_000_000L, (durUs + MAX_TILES - 1) / MAX_TILES)
            val count = ((durUs + step - 1) / step).toInt().coerceIn(1, MAX_TILES)

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(fmt, null, null, 0)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var strip: Bitmap? = null
            var tileW = 0
            var tileH = 0
            var made = 0
            for (i in 0 until count) {
                val t = i * step
                ex.seekTo(t, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                val tile = decodeOne(codec, ex, info, rotation) ?: continue
                if (strip == null) {
                    tileW = tile.width
                    tileH = tile.height
                    strip = Bitmap.createBitmap(tileW * count, tileH, Bitmap.Config.RGB_565)
                }
                Canvas(strip!!).drawBitmap(tile, (i * tileW).toFloat(), 0f, null)
                tile.recycle()
                made++
                codec.flush()
            }
            val s = strip ?: return null
            out.parentFile?.mkdirs()
            val tmp = File(out.path + ".part")
            FileOutputStream(tmp).use { s.compress(Bitmap.CompressFormat.JPEG, 70, it) }
            s.recycle()
            if (!tmp.renameTo(out)) return null
            Log.i(TAG, "Video strip for ${video.name}: $made of $count pictures, ${tileW}×$tileH, " +
                "${out.length() / 1024} KB in ${SystemClock.uptimeMillis() - started} ms")
            return JSONObject().put("v", VERSION).put("count", count).put("stepMs", step / 1000).put("tileW", tileW)
                .put("tileH", tileH).put("durationMs", durUs / 1000)
        } catch (e: Exception) {
            Log.w(TAG, "Video strip for ${video.name} failed", e)
            return null
        } finally {
            try { codec?.stop() } catch (e: Exception) { }
            try { codec?.release() } catch (e: Exception) { }
            ex.release()
        }
    }

    /** Feeds samples from the extractor's position until the decoder returns a picture; that picture, small. */
    private fun decodeOne(codec: MediaCodec, ex: MediaExtractor, info: MediaCodec.BufferInfo, rotation: Int): Bitmap? {
        var fed = 0
        var inputDone = false
        while (true) {
            if (!inputDone && fed < FEED_LIMIT) {
                val inIx = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inIx >= 0) {
                    val buf = codec.getInputBuffer(inIx)!!
                    val size = ex.readSampleData(buf, 0)
                    if (size < 0) {
                        codec.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(inIx, 0, size, ex.sampleTime, 0)
                        ex.advance()
                        fed++
                    }
                }
            }
            val outIx = codec.dequeueOutputBuffer(info, TIMEOUT_US)
            when {
                outIx >= 0 -> {
                    val img = codec.getOutputImage(outIx)
                    val of = codec.outputFormat
                    val slice = if (of.containsKey("slice-height")) of.getInteger("slice-height") else 0
                    val bmp = img?.let { toSmallBitmap(it, rotation, slice) }
                    img?.close()
                    codec.releaseOutputBuffer(outIx, false)
                    if (bmp != null) return bmp
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return null
                }
                outIx == MediaCodec.INFO_TRY_AGAIN_LATER && (inputDone || fed >= FEED_LIMIT) -> return null
            }
        }
    }

    /**
     * YUV_420_888 picture → a small upright RGB bitmap (nearest-neighbour sampling of the crop area).
     *
     * Rockchip's decoder (measured 2026-10-15, iPhone HEVC coded 1920×1088 shown 1080): the Image says
     * 1920×1080 and places the colour plane right after 1080 rows of brightness, but the decoder wrote it
     * after 1088 (its slice height, though it reports 1080). Read as given, the first 8 colour rows are filler
     * (value 100) and the top band comes out green. So colour rows are read that padding further on, in
     * colour rows: the decoder's "slice-height" when it reports one above the height, else the height
     * rounded up to 16.
     */
    private fun toSmallBitmap(img: android.media.Image, rotation: Int, sliceHeight: Int): Bitmap? {
        val crop = img.cropRect
        val cw = crop.width()
        val ch = crop.height()
        if (cw <= 0 || ch <= 0) return null
        val turned = rotation == 90 || rotation == 270
        // Shown size TILE_H tall; sampled in the stored orientation, then turned upright.
        val shownW = if (turned) ch else cw
        val shownH = if (turned) cw else ch
        val outW = (TILE_H.toLong() * shownW / shownH).toInt().coerceAtLeast(8)
        val w = if (turned) TILE_H else outW
        val h = if (turned) outW else TILE_H
        val yP = img.planes[0]; val uP = img.planes[1]; val vP = img.planes[2]
        val yB = yP.buffer; val uB = uP.buffer; val vB = vP.buffer
        val coded = if (sliceHeight > img.height) sliceHeight else (img.height + 15) / 16 * 16
        // Colour rows to skip: the padding's bytes, in colour rows (measured: 8 rows of filler, value 100, then colour).
        val shift = (coded - img.height) * yP.rowStride / uP.rowStride
        // The last colour row the buffers hold (the shifted plane's tail lies beyond them: reuse that row).
        val lastRow = minOf(
            (uB.capacity() - 1 - (cw / 2 - 1) * uP.pixelStride) / uP.rowStride,
            (vB.capacity() - 1 - (cw / 2 - 1) * vP.pixelStride) / vP.rowStride,
        )
        if (!logged) {
            logged = true
            Log.d(TAG, "Strip decoder layout: image ${img.width}×${img.height}, slice $sliceHeight, colour shift $shift rows, " +
                "Y ${yP.rowStride}/${yP.pixelStride}, U ${uP.rowStride}/${uP.pixelStride}")
        }
        val px = IntArray(w * h)
        for (y in 0 until h) {
            val sy = crop.top + ((2 * y + 1) * ch / (2 * h)).coerceIn(0, ch - 1) // pixel centres: no edge rows
            for (x in 0 until w) {
                val sx = crop.left + ((2 * x + 1) * cw / (2 * w)).coerceIn(0, cw - 1)
                val yy = (yB.get(sy * yP.rowStride + sx * yP.pixelStride).toInt() and 0xff) - 16
                val cr = minOf(sy / 2 + shift, lastRow)
                val u = (uB.get(cr * uP.rowStride + (sx / 2) * uP.pixelStride).toInt() and 0xff) - 128
                val v = (vB.get(cr * vP.rowStride + (sx / 2) * vP.pixelStride).toInt() and 0xff) - 128
                val c = 1192 * maxOf(0, yy)
                val r = ((c + 1634 * v) shr 10).coerceIn(0, 255)
                val g = ((c - 833 * v - 400 * u) shr 10).coerceIn(0, 255)
                val b = ((c + 2066 * u) shr 10).coerceIn(0, 255)
                px[y * w + x] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
        if (!turned) return bmp
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        return Bitmap.createBitmap(bmp, 0, 0, w, h, m, true).also { if (it !== bmp) bmp.recycle() }
    }
}
