package app.openframe

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class SleepScheduleTest {

    private val la = ZoneId.of("America/Los_Angeles")
    private val everyDay = (0..6).toSet()

    /** Epoch ms of a wall-clock time in Los Angeles. */
    private fun t(y: Int, mo: Int, d: Int, h: Int, mi: Int = 0) = ZonedDateTime.of(y, mo, d, h, mi, 0, 0, la).toInstant().toEpochMilli()

    private fun entry(sleep: String, wake: String, days: Set<Int> = everyDay, enabled: Boolean = true) =
        SleepSchedule.Entry(enabled, LocalTime.parse(sleep), LocalTime.parse(wake), days)

    private val night = listOf(entry("21:30", "07:00")) // the user's Frameo schedule

    @Test fun parsesTheDefaultSchedule() {
        val list = SleepSchedule.parse(JSONArray("""[{"enabled":true,"sleep":"21:30","wake":"07:00","days":[0,1,2,3,4,5,6]}]"""))
        assertEquals(night, list)
    }

    @Test fun rejectsBadSchedules() {
        val bad = listOf(
            """[{"enabled":true,"sleep":"9:30","wake":"07:00","days":[0]}]""",
            """[{"enabled":true,"sleep":"24:00","wake":"07:00","days":[0]}]""",
            """[{"enabled":true,"sleep":"07:00","wake":"07:00","days":[0]}]""",
            """[{"enabled":true,"sleep":"21:30","wake":"07:00","days":[7]}]""",
            """[{"enabled":true,"sleep":"21:30","wake":"07:00","days":[1,1]}]""",
            """[{"enabled":"yes","sleep":"21:30","wake":"07:00","days":[1]}]""",
            """[{"enabled":true,"sleep":"21:30","wake":"07:00"}]""",
            """[1]""",
            JSONArray((0..SleepSchedule.MAX_SCHEDULES).map { org.json.JSONObject("""{"enabled":true,"sleep":"21:30","wake":"07:00","days":[0]}""") }).toString(),
        )
        for (s in bad) {
            try {
                SleepSchedule.parse(JSONArray(s))
                fail("accepted $s")
            } catch (e: IllegalArgumentException) {
                assertTrue(e.message!!.isNotEmpty())
            }
        }
        assertEquals(emptyList<SleepSchedule.Entry>(), SleepSchedule.parse(JSONArray()))
    }

    @Test fun overnightWindowRunsFromEveningToMorning() {
        val w = SleepSchedule.windowAt(night, t(2026, 10, 13, 22), la)
        assertEquals(SleepSchedule.Window(t(2026, 10, 13, 21, 30), t(2026, 10, 14, 7)), w)
        assertEquals(w, SleepSchedule.windowAt(night, t(2026, 10, 14, 6, 59), la))
        assertNull(SleepSchedule.windowAt(night, t(2026, 10, 14, 7), la))
        assertNull(SleepSchedule.windowAt(night, t(2026, 10, 13, 21, 29), la))
        assertEquals(t(2026, 10, 13, 21, 30), SleepSchedule.windowAt(night, t(2026, 10, 13, 21, 30), la)!!.start)
    }

    @Test fun aDayMeansTheNightThatStartsThatDay() {
        val friday = listOf(entry("22:00", "08:00", setOf(5))) // 2026-10-16 is a Friday
        assertTrue(SleepSchedule.windowAt(friday, t(2026, 10, 16, 23), la) != null)
        assertTrue(SleepSchedule.windowAt(friday, t(2026, 10, 17, 7), la) != null) // Saturday morning
        assertNull(SleepSchedule.windowAt(friday, t(2026, 10, 17, 23), la))
        assertNull(SleepSchedule.windowAt(friday, t(2026, 10, 16, 7), la)) // Thursday night wasn't scheduled
    }

    @Test fun sameDayWindow() {
        val nap = listOf(entry("13:00", "15:00"))
        assertTrue(SleepSchedule.windowAt(nap, t(2026, 10, 13, 14), la) != null)
        assertNull(SleepSchedule.windowAt(nap, t(2026, 10, 13, 16), la))
    }

    @Test fun nextChangeAlternatesBetweenSleepAndWake() {
        assertEquals(t(2026, 10, 13, 21, 30), SleepSchedule.nextChange(night, t(2026, 10, 13, 20), la))
        assertEquals(t(2026, 10, 14, 7), SleepSchedule.nextChange(night, t(2026, 10, 13, 22), la))
        assertEquals(t(2026, 10, 14, 7), SleepSchedule.nextChange(night, t(2026, 10, 13, 21, 30), la))
        assertNull(SleepSchedule.nextChange(emptyList(), t(2026, 10, 13, 20), la))
        assertNull(SleepSchedule.nextChange(listOf(entry("21:30", "07:00", enabled = false)), t(2026, 10, 13, 20), la))
        assertNull(SleepSchedule.nextChange(listOf(entry("21:30", "07:00", days = emptySet())), t(2026, 10, 13, 20), la))
    }

    @Test fun nextSleepAndWake() {
        val evening = t(2026, 10, 13, 20)
        assertEquals(t(2026, 10, 13, 21, 30), SleepSchedule.nextSleep(night, evening, la))
        assertEquals(t(2026, 10, 14, 7), SleepSchedule.nextWake(night, evening, la))
        val late = t(2026, 10, 13, 23)
        assertNull(SleepSchedule.nextSleep(night, late, la))
        assertEquals(t(2026, 10, 14, 7), SleepSchedule.nextWake(night, late, la))
        // Manual sleep on a weekday afternoon with only a Friday schedule: wakes Saturday 8:00.
        val friday = listOf(entry("22:00", "08:00", setOf(5)))
        assertEquals(t(2026, 10, 17, 8), SleepSchedule.nextWake(friday, t(2026, 10, 13, 14), la))
    }

    @Test fun overlappingSchedulesMerge() {
        val two = listOf(entry("21:00", "23:00"), entry("22:00", "07:00"))
        assertEquals(SleepSchedule.Window(t(2026, 10, 13, 21), t(2026, 10, 14, 7)),
            SleepSchedule.windowAt(two, t(2026, 10, 13, 21, 30), la))
        // Back-to-back schedules make one window with no wake-up in between.
        val chain = listOf(entry("21:00", "07:00"), entry("07:00", "09:00"))
        assertEquals(t(2026, 10, 14, 9), SleepSchedule.nextChange(chain, t(2026, 10, 13, 22), la))
    }

    @Test fun daylightSavingChanges() {
        // Spring forward, Sunday 2027-03-14: 2:30 AM doesn't exist and moves to 3:30 AM PDT.
        val early = listOf(entry("02:30", "07:00", setOf(0)))
        val w = SleepSchedule.windowAt(early, t(2027, 3, 14, 5), la)!!
        assertEquals(ZonedDateTime.of(2027, 3, 14, 3, 30, 0, 0, la).toInstant().toEpochMilli(), w.start)
        // Fall back, the night of Saturday 2026-10-31: one hour longer than usual.
        val fall = SleepSchedule.windowAt(night, t(2026, 10, 31, 23), la)!!
        assertEquals(10.5 * 3600_000, (fall.end - fall.start).toDouble(), 0.0)
        assertEquals(t(2026, 11, 1, 7), fall.end)
    }
}
