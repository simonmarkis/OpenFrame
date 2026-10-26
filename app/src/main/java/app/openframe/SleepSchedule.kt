package app.openframe

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Sleep schedules (SPEC §18), pure logic, unit-tested. Like Frameo's cards: a schedule goes to sleep
 * at [Entry.sleep] on each of its days (0 = Sunday … 6 = Saturday) and wakes at the next
 * [Entry.wake]: the same day if that is later, else the next morning. Overlapping windows merge.
 * Times are wall-clock in the frame's time zone; a time skipped by a DST change moves forward.
 */
object SleepSchedule {
    const val MAX_SCHEDULES = 10
    private val HM = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")
    private const val DAY_MS = 86_400_000L

    data class Entry(val enabled: Boolean, val sleep: LocalTime, val wake: LocalTime, val days: Set<Int>)

    /** Sleep window in epoch ms, [start, end). */
    data class Window(val start: Long, val end: Long)

    /** Parses `sleep.schedules`. @throws IllegalArgumentException with a user-readable message. */
    fun parse(arr: JSONArray?): List<Entry> {
        require(arr != null) { "sleep.schedules must be a list" }
        require(arr.length() <= MAX_SCHEDULES) { "Up to $MAX_SCHEDULES sleep schedules" }
        return (0 until arr.length()).map { i ->
            val o = arr.opt(i) as? JSONObject ?: throw IllegalArgumentException("sleep.schedules[$i] must be an object")
            val where = "sleep.schedules[$i]"
            require(o.opt("enabled") is Boolean) { "$where.enabled must be true or false" }
            val sleep = time(o.opt("sleep"), "$where.sleep")
            val wake = time(o.opt("wake"), "$where.wake")
            require(sleep != wake) { "Sleep and wake-up times must be different" }
            val days = o.opt("days") as? JSONArray ?: throw IllegalArgumentException("$where.days must be a list")
            val set = LinkedHashSet<Int>()
            for (d in 0 until days.length()) {
                val v = days.opt(d)
                require(v is Int && v in 0..6) { "$where.days must hold numbers 0 (Sunday) to 6 (Saturday)" }
                require(set.add(v)) { "$where.days has a day twice" }
            }
            Entry(o.getBoolean("enabled"), sleep, wake, set)
        }
    }

    private fun time(v: Any?, where: String): LocalTime {
        val m = (v as? String)?.let { HM.matchEntire(it) } ?: throw IllegalArgumentException("$where must look like 21:30")
        return LocalTime.of(m.groupValues[1].toInt(), m.groupValues[2].toInt())
    }

    /** Merged windows of the enabled schedules that overlap [from, to), sorted. */
    fun windows(entries: List<Entry>, from: Long, to: Long, zone: ZoneId): List<Window> {
        val raw = ArrayList<Window>()
        // One extra day before: a window that started yesterday evening may still be running.
        var day = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(from), zone).toLocalDate().minusDays(1)
        val last = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(to), zone).toLocalDate()
        while (!day.isAfter(last)) {
            val dow = day.dayOfWeek.value % 7 // java.time: Monday = 1 … Sunday = 7
            for (e in entries) {
                if (!e.enabled || dow !in e.days) continue
                val start = at(day, e.sleep, zone)
                val end = at(if (e.wake.isAfter(e.sleep)) day else day.plusDays(1), e.wake, zone)
                if (end > from && start < to && end > start) raw += Window(start, end)
            }
            day = day.plusDays(1)
        }
        raw.sortBy { it.start }
        val merged = ArrayList<Window>()
        for (w in raw) {
            val prev = merged.lastOrNull()
            if (prev != null && w.start <= prev.end) merged[merged.size - 1] = Window(prev.start, maxOf(prev.end, w.end))
            else merged += w
        }
        return merged
    }

    private fun at(day: LocalDate, t: LocalTime, zone: ZoneId): Long = ZonedDateTime.of(day, t, zone).toInstant().toEpochMilli()

    // Windows can chain across days (e.g. one schedule for the night, one for the day), so look a week
    // each way; the cost is a few dozen date computations.
    private fun around(entries: List<Entry>, now: Long, zone: ZoneId) =
        windows(entries, now - 8 * DAY_MS, now + 8 * DAY_MS, zone)

    /** The sleep window [now] is in, or null when it is waking time. */
    fun windowAt(entries: List<Entry>, now: Long, zone: ZoneId): Window? =
        around(entries, now, zone).firstOrNull { now >= it.start && now < it.end }

    /** The next moment sleep starts or ends after [now], or null with no enabled schedule. */
    fun nextChange(entries: List<Entry>, now: Long, zone: ZoneId): Long? =
        around(entries, now, zone).flatMap { listOf(it.start, it.end) }.filter { it > now }.minOrNull()

    /** Next scheduled sleep start after [now] (null inside a window: it is already sleep time). */
    fun nextSleep(entries: List<Entry>, now: Long, zone: ZoneId): Long? {
        val ws = around(entries, now, zone)
        if (ws.any { now >= it.start && now < it.end }) return null
        return ws.map { it.start }.filter { it > now }.minOrNull()
    }

    /** When the frame next wakes on its own: the end of the current window, else of the next one. */
    fun nextWake(entries: List<Entry>, now: Long, zone: ZoneId): Long? =
        around(entries, now, zone).firstOrNull { it.end > now }?.end
}
