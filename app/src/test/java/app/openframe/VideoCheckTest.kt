package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoCheckTest {

    private fun t(mime: String = "video/hevc", w: Int = 1920, h: Int = 1080, fps: Int? = 30, profile: Int? = 1, hdr: Boolean = false) =
        VideoCheck.Track(mime, w, h, fps, profile, hdr)

    private fun bytes(vararg b: Int) = ByteArray(b.size) { b[it].toByte() }

    @Test fun playsWhatWasMeasured() {
        assertNull(VideoCheck.problem(t()))                                    // the Shortcut's HEVC 1080p30
        assertNull(VideoCheck.problem(t(fps = 60)))                            // HEVC 1080p60
        assertNull(VideoCheck.problem(t("video/avc", fps = 60, profile = 100))) // H.264 High 1080p60
        assertNull(VideoCheck.problem(t(w = 1920, h = 1088)))                  // coded height
        assertNull(VideoCheck.problem(t(w = 1080, h = 1920)))                  // native portrait
        assertNull(VideoCheck.problem(t(fps = null, profile = null)))          // unknown: try it
    }

    @Test fun refusesLargerThan1080p() {
        val p = VideoCheck.problem(t(w = 3840, h = 2160))!!
        assertTrue(p, p.contains("3840×2160 (4K)"))
        assertTrue(VideoCheck.problem(t(w = 2160, h = 3840))!!.contains("(4K)"))
        assertTrue(VideoCheck.problem(t(w = 2560, h = 1440)) != null)
        assertTrue(VideoCheck.problem(t(w = 5312, h = 2992))!!.contains("(4K)")) // the GoPro clip
    }

    @Test fun refusesTenBitAndHdr() {
        assertTrue(VideoCheck.problem(t(profile = 2))!!.startsWith("HDR (10-bit) HEVC"))
        assertTrue(VideoCheck.problem(t(profile = 4)) != null)
        assertTrue(VideoCheck.problem(t("video/avc", profile = 110))!!.startsWith("HDR (10-bit) H.264"))
        assertTrue(VideoCheck.problem(t(hdr = true))!!.startsWith("HDR video"))
    }

    @Test fun refusesOtherCodecsAndHighFrameRates() {
        assertTrue(VideoCheck.problem(t("video/mp4v-es"))!!.contains("(mp4v-es)"))
        assertTrue(VideoCheck.problem(t(fps = 120)) != null)                   // 1080p120
        assertNull(VideoCheck.problem(t(w = 1280, h = 720, fps = 120)))       // 720p120: same work as 1080p60
        assertTrue(VideoCheck.problem(t(w = 1280, h = 720, fps = 240)) != null)
    }

    @Test fun readsProfileFromHevcSps() {
        // VPS (type 32), then SPS (type 33 → header 0x42 0x01), byte, profile byte 0x01 (Main) or 0x02 (Main 10).
        val main = bytes(0, 0, 0, 1, 0x40, 0x01, 0x0C, 0, 0, 0, 1, 0x42, 0x01, 0x01, 0x01, 0x60)
        val main10 = bytes(0, 0, 0, 1, 0x42, 0x01, 0x01, 0x02, 0x20)
        assertEquals(1, VideoCheck.profileFromCsd("video/hevc", main))
        assertEquals(2, VideoCheck.profileFromCsd("video/hevc", main10))
        assertNull(VideoCheck.profileFromCsd("video/hevc", bytes(0, 0, 1, 0x40, 0x01)))
    }

    @Test fun readsProfileFromAvcSps() {
        val high = bytes(0, 0, 0, 1, 0x67, 100, 0, 40)
        val high10 = bytes(0, 0, 1, 0x67, 110, 0, 40)
        assertEquals(100, VideoCheck.profileFromCsd("video/avc", high))
        assertEquals(110, VideoCheck.profileFromCsd("video/avc", high10))
        assertNull(VideoCheck.profileFromCsd("video/avc", bytes(0, 0, 0, 1, 0x68, 0xCE)))
    }
}
