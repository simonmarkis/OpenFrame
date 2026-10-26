package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class UploadMetaTest {

    private val la = ZoneId.of("America/Los_Angeles")
    private val july4 = Instant.parse("2025-07-04T18:30:00Z").toEpochMilli()
    private val now = Instant.parse("2026-10-14T20:00:00Z").toEpochMilli()

    @Test fun iso8601FromShortcuts() {
        assertEquals(july4, UploadMeta.parseTaken("2025-07-04T11:30:00-07:00", la))
        assertEquals(july4, UploadMeta.parseTaken("2025-07-04T20:30:00+02:00", la))
        assertEquals(july4, UploadMeta.parseTaken("2025-07-04T20:30:00 02:00", la)) // "+" lost in the URL
        assertEquals(july4, UploadMeta.parseTaken("2025-07-04T18:30:00Z", la))
    }

    @Test fun shortcutsDefaultTextAndEpochs() {
        assertEquals(july4, UploadMeta.parseTaken("Jul 4, 2025 at 11:30 AM", la))
        assertEquals(july4, UploadMeta.parseTaken("Jul 4, 2025 at 11:30 AM", la))
        assertEquals(july4, UploadMeta.parseTaken("1751653800", la))
        assertEquals(july4, UploadMeta.parseTaken("1751653800000", la))
        assertNull(UploadMeta.parseTaken("", la))
        assertNull(UploadMeta.parseTaken("someday", la))
    }

    @Test fun placeNeedsBothAndSaneValues() {
        val s = UploadMeta.parse("2025-07-04T11:30:00-07:00", "47.6062", "-122.3321", la, now)
        assertEquals(july4, s.takenAt)
        assertEquals(47.6062, s.lat!!, 1e-9)
        assertEquals(-122.3321, s.lon!!, 1e-9)
        assertNull(UploadMeta.parse(null, "47.6", "", la, now).lat)
        assertNull(UploadMeta.parse(null, "0", "0", la, now).lat)
        assertNull(UploadMeta.parse(null, "95", "10", la, now).lat)
        assertEquals(47.6, UploadMeta.parse(null, "47,6", "-122,3", la, now).lat!!, 1e-9) // decimal comma
        assertTrue(UploadMeta.parse("", "", "", la, now).isEmpty)
    }

    @Test fun placeNameIsKept() {
        val s = UploadMeta.parse(null, "40.0", "-100.0", la, now, name = " Hope Fellowship ")
        assertEquals("Hope Fellowship", s.place)
        assertTrue(!UploadMeta.parse(null, null, null, la, now, name = "Home").isEmpty)
        assertNull(UploadMeta.parse(null, null, null, la, now, name = "  ").place)
    }

    @Test fun futureAndAncientDatesAreIgnored() {
        assertNull(UploadMeta.parse("2030-01-01T00:00:00Z", null, null, la, now).takenAt)
        assertNull(UploadMeta.parse("1904-01-01T00:00:00Z", null, null, la, now).takenAt)
    }
}
