package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IcsTrimmerTest {

    private fun cal(vararg events: String) =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles\r\nEND:VTIMEZONE\r\n" +
            events.joinToString("") { "BEGIN:VEVENT\r\n$it\r\nEND:VEVENT\r\n" } + "END:VCALENDAR\r\n"

    @Test fun keepsFutureAndOngoing_dropsPast() {
        val r = IcsTrimmer.trim(cal(
            "UID:past\r\nDTSTART:20240101T100000Z\r\nDTEND:20240101T110000Z",
            "UID:future\r\nDTSTART;TZID=America/Los_Angeles:20261020T100000\r\nDTEND;TZID=America/Los_Angeles:20261020T110000",
            "UID:ongoing\r\nDTSTART;VALUE=DATE:20260601\r\nDTEND;VALUE=DATE:20261231",
            "UID:noend\r\nDTSTART;VALUE=DATE:20260715",
        ), cutoff = "20260713")
        assertEquals(3, r.kept)
        assertEquals(1, r.dropped)
        assertFalse(r.text.contains("UID:past"))
        assertTrue(r.text.contains("UID:future") && r.text.contains("UID:ongoing") && r.text.contains("UID:noend"))
        assertTrue("non-event components kept", r.text.contains("BEGIN:VTIMEZONE"))
        assertTrue(r.text.startsWith("BEGIN:VCALENDAR") && r.text.trimEnd().endsWith("END:VCALENDAR"))
    }

    @Test fun recurringSeries() {
        val r = IcsTrimmer.trim(cal(
            "UID:open\r\nDTSTART:20200101T100000Z\r\nRRULE:FREQ=WEEKLY",
            "UID:ended\r\nDTSTART:20200101T100000Z\r\nRRULE:FREQ=WEEKLY;UNTIL=20210101T000000Z",
            "UID:endslater\r\nDTSTART:20200101T100000Z\r\nRRULE:FREQ=DAILY;UNTIL=20270101",
            "UID:counted\r\nDTSTART:20200101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3",
            "UID:rdate\r\nDTSTART:20200101T100000Z\r\nRDATE:20200301T100000Z",
        ), cutoff = "20260713")
        assertEquals(listOf("open", "endslater", "counted", "rdate"),
            Regex("UID:(\\w+)").findAll(r.text).map { it.groupValues[1] }.toList())
    }

    @Test fun overridesFollowTheirOwnDates() {
        val r = IcsTrimmer.trim(cal(
            "UID:s\r\nRECURRENCE-ID:20240105T100000Z\r\nDTSTART:20240105T120000Z\r\nDTEND:20240105T130000Z",
            "UID:s\r\nRECURRENCE-ID:20261012T100000Z\r\nDTSTART:20261012T120000Z\r\nDTEND:20261012T130000Z",
        ), cutoff = "20260713")
        assertEquals(1, r.kept)
        assertTrue(r.text.contains("RECURRENCE-ID:20261012"))
    }

    @Test fun foldedLinesAndQuotedParams() {
        val ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:A very long\r\n  folded title\r\n" +
            "DTSTART;X-NOTE=\"a:b\":20261020T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        val r = IcsTrimmer.trim(ics, cutoff = "20260713")
        assertEquals(1, r.kept)
        assertTrue(r.text.contains("SUMMARY:A very long folded title"))
    }

    @Test fun lfLineEndingsAndBlankLines() {
        val ics = "BEGIN:VCALENDAR\n\nBEGIN:VEVENT\nUID:old\nDTSTART:20200101\nEND:VEVENT\nEND:VCALENDAR\n"
        val r = IcsTrimmer.trim(ics, cutoff = "20260713")
        assertEquals(0, r.kept)
        assertEquals("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", r.text)
    }
}
