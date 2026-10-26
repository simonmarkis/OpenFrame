package app.openframe

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The frame boots with a stale clock (July 28, 2024) until network time arrives (SPEC §18). */
class ClockTrustTest {
    private fun t(iso: String) = Instant.parse(iso).toEpochMilli()

    private val installed = t("2026-10-16T16:00:00Z")
    private val lastGood = t("2026-10-16T13:50:00Z")

    @Test
    fun staleBootClockIsNotTrusted() {
        assertFalse(ClockTrust.trusted(t("2024-07-28T23:43:00Z"), lastGood, installed))
    }

    @Test
    fun networkTimeIsTrusted() {
        assertTrue(ClockTrust.trusted(t("2026-10-17T14:00:00Z"), lastGood, installed))
    }

    @Test
    fun aFewMinutesBackIsStillTrusted() {
        // NTP corrections and an install time slightly ahead stay fine.
        assertTrue(ClockTrust.trusted(installed - 5 * 60_000L, lastGood, installed))
        assertFalse(ClockTrust.trusted(installed - 60 * 60_000L, lastGood, installed))
    }

    @Test
    fun withoutAnyHistoryTheClockIsTrusted() {
        assertTrue(ClockTrust.trusted(t("2024-07-28T23:43:00Z"), 0L, 0L))
    }
}
