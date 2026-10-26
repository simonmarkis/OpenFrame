package app.openframe

/**
 * What the frame can play (SPEC §6), measured with synthetic clips on 2026-10-14: H.264 and HEVC,
 * 8-bit, up to 1920×1088 in either orientation, up to 1080p60. 4K "plays" corrupt without an error and
 * 10-bit HEVC fails, so both are refused here. Pure (no Android), unit-tested.
 */
object VideoCheck {

    class Track(
        val mime: String,
        val width: Int,
        val height: Int,
        /** null if the file doesn't say. */
        val frameRate: Int?,
        /** H.264 profile_idc or HEVC general_profile_idc, from the format or the SPS; null if unknown. */
        val profileIdc: Int?,
        /** HDR transfer (PQ or HLG) flagged in the file. */
        val hdr: Boolean,
    )

    private const val MAX_LONG = 1920
    private const val MAX_SHORT = 1088
    /** 1080p60 in 16×16 blocks per second (the H.264 decoder's declared limit; HEVC 1080p60 measured fine). */
    private const val MAX_BLOCKS_PER_SEC = 489_600L
    private const val SHORTCUT = "The iPhone Shortcut converts videos so the frame can play them."

    /** A plain reason the frame can't play [t], or null if it can. */
    fun problem(t: Track): String? {
        val codec = when (t.mime) {
            "video/avc" -> "H.264"
            "video/hevc" -> "HEVC"
            else -> return "Video format not supported (${t.mime.removePrefix("video/")}); the frame plays H.264 and HEVC. $SHORTCUT"
        }
        val long = maxOf(t.width, t.height)
        val short = minOf(t.width, t.height)
        if (long > MAX_LONG || short > MAX_SHORT) {
            val name = if (long >= 3800) " (4K)" else if (long > 2500) " (larger than 1080p)" else ""
            return "This video is ${t.width}×${t.height}$name; the frame plays videos up to 1080p. $SHORTCUT"
        }
        if (tenBit(t)) return "HDR (10-bit) $codec video; the frame plays standard 8-bit video. $SHORTCUT"
        if (t.hdr) return "HDR video; the frame plays standard (SDR) video. $SHORTCUT"
        val fps = t.frameRate
        if (fps != null && blocks(t.width) * blocks(t.height) * fps > MAX_BLOCKS_PER_SEC * 105 / 100) {
            return "This video is $fps frames per second at ${t.width}×${t.height}; the frame plays up to 60 at 1080p. $SHORTCUT"
        }
        return null
    }

    private fun blocks(px: Int) = ((px + 15) / 16).toLong()

    private fun tenBit(t: Track): Boolean {
        val p = t.profileIdc ?: return false
        return when (t.mime) {
            // 1 Main, 3 Main Still Picture; 2 Main 10; 4+ range extensions (10-bit and 4:2:2/4:4:4).
            "video/hevc" -> p != 1 && p != 3
            // 66 Baseline, 77 Main, 88 Extended, 100 High; 110 High 10, 122 High 4:2:2, 244 High 4:4:4.
            "video/avc" -> p > 100
            else -> false
        }
    }

    /**
     * profile_idc from the SPS in a codec-specific-data buffer (Annex B: start codes, then NAL units),
     * as Android's MediaExtractor gives it in `csd-0`. null if there is no SPS.
     */
    fun profileFromCsd(mime: String, csd: ByteArray): Int? {
        var i = 0
        while (i + 3 < csd.size) {
            // Find a start code (00 00 01; a 4-byte 00 00 00 01 ends the same way).
            if (csd[i] == 0.toByte() && csd[i + 1] == 0.toByte() && csd[i + 2] == 1.toByte()) {
                val nal = i + 3
                if (nal >= csd.size) return null
                val h = csd[nal].toInt() and 0xFF
                when (mime) {
                    // HEVC: 2-byte header, type 33 = SPS; then 1 byte (vps id, sub-layers), then
                    // profile_space(2) tier(1) profile_idc(5).
                    "video/hevc" -> if ((h shr 1) and 0x3F == 33 && nal + 3 < csd.size) {
                        return csd[nal + 3].toInt() and 0x1F
                    }
                    // H.264: 1-byte header, type 7 = SPS; the next byte is profile_idc.
                    "video/avc" -> if (h and 0x1F == 7 && nal + 1 < csd.size) {
                        return csd[nal + 1].toInt() and 0xFF
                    }
                }
                i = nal
            } else {
                i++
            }
        }
        return null
    }
}
