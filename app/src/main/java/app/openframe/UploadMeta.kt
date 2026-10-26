package app.openframe

import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * Date taken and place sent with an upload (`?taken=&lat=&lon=`, SPEC §17): the iPhone Shortcut sends
 * them for videos, whose conversion drops the file's own. Pure, unit-tested.
 */
object UploadMeta {

    /** [place]: the location's name from the iPhone (`&place=`), e.g. "Hope Fellowship" (SPEC §8). */
    class Sent(val takenAt: Long?, val lat: Double?, val lon: Double?, val place: String? = null) {
        val isEmpty get() = takenAt == null && lat == null && place == null
    }

    /** Shortcuts' default (en-US) date text, when ISO 8601 wasn't chosen: "Oct 14, 2026 at 8:22 AM". */
    private val SHORTCUTS_DEFAULT = listOf("MMM d, yyyy 'at' h:mm a", "MMM d, yyyy 'at' h:mm:ss a", "MMMM d, yyyy 'at' h:mm a")
        .map { DateTimeFormatter.ofPattern(it, Locale.US) }

    fun parse(taken: String?, lat: String?, lon: String?, zone: ZoneId, now: Long = System.currentTimeMillis(), name: String? = null): Sent {
        val t = taken?.let { parseTaken(it, zone) }?.takeIf { it in EARLIEST..now + 86_400_000L }
        val la = lat?.trim()?.replace(',', '.')?.toDoubleOrNull()
        val lo = lon?.trim()?.replace(',', '.')?.toDoubleOrNull()
        val place = la != null && lo != null && la in -90.0..90.0 && lo in -180.0..180.0 && !(la == 0.0 && lo == 0.0)
        return Sent(t, if (place) la else null, if (place) lo else null, PlaceNames.cleanSent(name))
    }

    fun parseTaken(raw: String, zone: ZoneId): Long? {
        var s = raw.trim().replace(' ', ' ') // iOS puts a narrow space before AM/PM
        if (s.isEmpty()) return null
        // A "+02:00" offset arrives as " 02:00" when the "+" wasn't escaped in the URL.
        s = s.replace(Regex("(T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?) (\\d{2}:?\\d{2})$"), "$1+$2")
        s.toLongOrNull()?.let { return if (it < 100_000_000_000L) it * 1000 else it } // epoch seconds or ms
        Mp4Meta.parseDate(s, zone)?.let { return it }
        for (f in SHORTCUTS_DEFAULT) {
            try { return LocalDateTime.parse(s, f).atZone(zone).toInstant().toEpochMilli() } catch (e: DateTimeParseException) { }
        }
        return null
    }

    /** 1971-01-01: anything earlier is an unset date. */
    private const val EARLIEST = 31_536_000_000L
}
