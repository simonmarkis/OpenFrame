package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class WarningRulesTest {

    private val now = 2_000_000_000_000L
    private val okWeather = WarningRules.Weather(true, "ok", null, now - 60_000)

    private fun feed(kind: String?, streak: Int = 1, enabled: Boolean = true, status: String = "error") =
        WarningRules.Feed("c1", "Family", enabled, status, kind, "It broke.", streak, now - 3_600_000)

    private fun input(
        online: Boolean = true, feeds: List<WarningRules.Feed> = emptyList(), weather: WarningRules.Weather = okWeather,
        files: Int = 0, free: Long? = 10L shl 30,
    ) = WarningRules.Input(online, now, feeds, weather, files, free)

    private fun ids(i: WarningRules.Input) = WarningRules.evaluate(i).map { it.id }

    @Test fun nothingWrongMeansNoWarnings() {
        assertEquals(emptyList<String>(), ids(input(feeds = listOf(feed(null, 0, status = "ok")))))
    }

    @Test fun brokenLinkWarnsAtOnceWithPopup() {
        for (kind in listOf("parse", "config")) {
            val w = WarningRules.evaluate(input(feeds = listOf(feed(kind, streak = 1))))
            assertEquals(listOf("calendar:c1"), w.map { it.id })
            assertTrue(w[0].canPopup)
            assertTrue(w[0].title.contains("\"Family\""))
            assertTrue(w[0].detail.contains("keeps showing the events it saved"))
        }
    }

    @Test fun hiccupsWarnOnlyWhenTheLastRetryFailed() {
        for (kind in listOf("http", "network", "tls")) {
            for (streak in 1..5) assertEquals(emptyList<String>(), ids(input(feeds = listOf(feed(kind, streak)))))
            val w = WarningRules.evaluate(input(feeds = listOf(feed(kind, streak = 6))))
            assertEquals(listOf("calendar:c1"), w.map { it.id })
            assertTrue(w[0].canPopup)
        }
    }

    @Test fun hiccupsAreRetriedAfterOneMinuteThreeTimesThenFiveMinutesTwice() {
        for (kind in listOf("http", "network", "tls")) {
            assertEquals(listOf(60_000L, 60_000L, 60_000L, 300_000L, 300_000L, null),
                (1..6).map { WarningRules.retryDelayMs(kind, it) })
        }
        for (kind in listOf("parse", "config")) assertEquals(null, WarningRules.retryDelayMs(kind, 1))
        assertEquals(null, WarningRules.retryDelayMs("http", 0)) // offline failures don't count
    }

    @Test fun offlineSilencesCalendarsAndWeatherButNotFilesOrStorage() {
        val badWeather = WarningRules.Weather(true, "error", "timeout", now - 5 * 3_600_000)
        val i = input(online = false, feeds = listOf(feed("parse")), weather = badWeather, files = 3, free = 100L shl 20)
        assertEquals(listOf("media", "storage"), ids(i))
    }

    @Test fun disabledCalendarsAreIgnored() {
        assertEquals(emptyList<String>(), ids(input(feeds = listOf(feed("parse", enabled = false)))))
    }

    @Test fun weatherWarnsOnlyWhenStaleAndNeverPopsUp() {
        val recent = WarningRules.Weather(true, "error", "HTTP 500", now - 3_600_000)
        assertEquals(emptyList<String>(), ids(input(weather = recent)))
        val stale = WarningRules.Weather(true, "error", "HTTP 500", now - WarningRules.WEATHER_STALE_MS)
        val w = WarningRules.evaluate(input(weather = stale))
        assertEquals(listOf("weather"), w.map { it.id })
        assertFalse(w[0].canPopup)
        val notConfigured = WarningRules.Weather(false, "error", "x", 0)
        assertEquals(emptyList<String>(), ids(input(weather = notConfigured)))
    }

    @Test fun filesAndStorageSummaries() {
        val w = WarningRules.evaluate(input(files = 1, free = 512L shl 20))
        assertEquals("1 file can't be shown", w[0].title)
        assertEquals("Storage almost full", w[1].title)
        assertTrue(w[1].detail.contains("512 MB"))
        assertEquals(emptyList<String>(), ids(input(free = null)))
    }

    @Test fun sleepHomeAndRestartsAreIconOnly() {
        val base = input(online = false)
        assertEquals(emptyList<String>(), ids(base))
        val w = WarningRules.evaluate(base.copy(sleepNeedsAdmin = true, homeLost = true, restartsToday = 3))
        assertEquals(listOf("sleep", "home", "restarts"), w.map { it.id })
        assertTrue(w.none { it.canPopup })
        assertEquals("OpenFrame restarted 3 times today", w[2].title)
        assertEquals(emptyList<String>(), ids(base.copy(restartsToday = WarningRules.RESTARTS_WARN - 1)))
    }

    @Test fun dismissedPopupStaysAwayUntilTheProblemChangesOrReturns() {
        val file = File(Files.createTempDirectory("warn").toFile(), "d.json")
        val d = WarningDismissals(file)
        val first = WarningRules.evaluate(input(feeds = listOf(feed("http", streak = 6))))[0]
        assertTrue(d.shouldPopup(first))
        d.dismiss(first)
        assertFalse(d.shouldPopup(first))
        assertFalse(WarningDismissals(file).shouldPopup(first)) // survives a restart

        // A different error for the same calendar pops up again.
        val changed = first.copy(signature = "http|Other error.")
        assertTrue(d.shouldPopup(changed))

        // Cleared, then broken again the same way: pops up again.
        d.prune(emptyList())
        assertTrue(d.shouldPopup(first))
    }

    @Test fun refusedUploadWarnsWithPopupUntilCleared() {
        val r = WarningRules.Refused(now, "video", "HDR (10-bit) HEVC video; the frame plays standard 8-bit video.")
        val w = WarningRules.evaluate(input().copy(refusedUpload = r, zone = java.time.ZoneId.of("America/Los_Angeles")))
        assertEquals(listOf("upload"), w.map { it.id })
        assertTrue(w[0].canPopup)
        assertEquals("A video sent to the frame was refused", w[0].title)
        assertTrue(w[0].detail.startsWith("HDR (10-bit)"))
        assertTrue(w[0].detail.contains("Sent May 17, 8:33 PM."))
        // A later refusal is a new problem: it pops up again even if the first was dismissed.
        val later = WarningRules.evaluate(input().copy(refusedUpload = r.copy(at = now + 1)))[0]
        assertTrue(later.signature != w[0].signature)
        assertEquals(emptyList<String>(), ids(input())) // cleared: no warning
    }
}
