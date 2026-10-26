package app.openframe

import java.io.File
import java.io.RandomAccessFile
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException

/**
 * Date taken and location of an MP4/MOV video, read from its `moov` box (SPEC §6). Needed because this
 * frame's MediaMetadataRetriever (Rockchip's) returns no date and "+0.0000-180.0000" for every video.
 *
 * Sources, best first: the iPhone's QuickTime keys (`com.apple.quicktime.creationdate`, with the local
 * offset; `com.apple.quicktime.location.ISO6709`), then `udta/©xyz` (location), then `mvhd`'s creation
 * time (UTC; 0 = unset). Pure (no Android), unit-tested.
 */
object Mp4Meta {

    class Result(val takenAt: Long?, val lat: Double?, val lon: Double?)

    private const val MAX_MOOV = 16L * 1024 * 1024
    /** Seconds from 1904-01-01 (QuickTime's epoch) to 1970-01-01. */
    private const val EPOCH_1904 = 2_082_844_800L
    private const val KEY_DATE = "com.apple.quicktime.creationdate"
    private const val KEY_LOCATION = "com.apple.quicktime.location.ISO6709"
    private val XYZ = String(byteArrayOf(0xA9.toByte(), 'x'.code.toByte(), 'y'.code.toByte(), 'z'.code.toByte()), Charsets.ISO_8859_1)

    fun read(file: File, zone: ZoneId = ZoneId.systemDefault()): Result {
        val moov = RandomAccessFile(file, "r").use { topLevel(it, "moov") } ?: return Result(null, null, null)
        return parseMoov(moov, zone)
    }

    /** The body of the first top-level box of [type] (the moov is often at the end of the file). */
    private fun topLevel(raf: RandomAccessFile, type: String): ByteArray? {
        val len = raf.length()
        val h = ByteArray(16)
        var pos = 0L
        while (pos + 8 <= len) {
            raf.seek(pos)
            raf.readFully(h, 0, 8)
            var size = u32(h, 0)
            var header = 8
            if (size == 1L) { raf.readFully(h, 8, 8); size = u64(h, 8); header = 16 } else if (size == 0L) size = len - pos
            if (size < header) return null
            if (String(h, 4, 4, Charsets.ISO_8859_1) == type) {
                val body = size - header
                if (body > MAX_MOOV || pos + size > len) return null
                return ByteArray(body.toInt()).also { raf.readFully(it) }
            }
            pos += size
        }
        return null
    }

    fun parseMoov(moov: ByteArray, zone: ZoneId): Result {
        var created: Long? = null
        var appleDate: Long? = null
        var appleLoc: Pair<Double, Double>? = null
        var xyz: Pair<Double, Double>? = null
        for (b in boxes(moov, 0, moov.size)) {
            when (b.type) {
                "mvhd" -> created = mvhdCreated(moov, b)
                "udta" -> for (c in boxes(moov, b.body, b.end)) {
                    if (c.type == XYZ && c.end - c.body > 4) {
                        val n = minOf(u16(moov, c.body), c.end - c.body - 4)
                        xyz = parseIso6709(String(moov, c.body + 4, n, Charsets.UTF_8))
                    }
                }
                "meta" -> {
                    val keys = appleKeys(moov, b)
                    keys[KEY_DATE]?.let { appleDate = parseDate(it, zone) }
                    keys[KEY_LOCATION]?.let { appleLoc = parseIso6709(it) }
                }
            }
        }
        val loc = appleLoc ?: xyz
        return Result(appleDate ?: created, loc?.first, loc?.second)
    }

    private class Box(val type: String, val body: Int, val end: Int)

    private fun boxes(buf: ByteArray, start: Int, end: Int): List<Box> {
        val out = ArrayList<Box>()
        var p = start
        while (p + 8 <= end) {
            var size = u32(buf, p)
            var header = 8
            if (size == 1L && p + 16 <= end) { size = u64(buf, p + 8); header = 16 } else if (size == 0L) size = (end - p).toLong()
            if (size < header || p + size > end) break
            out += Box(String(buf, p + 4, 4, Charsets.ISO_8859_1), p + header, (p + size).toInt())
            p += size.toInt()
        }
        return out
    }

    private fun mvhdCreated(buf: ByteArray, b: Box): Long? {
        if (b.end - b.body < 12) return null
        val secs = if (buf[b.body].toInt() == 1) u64(buf, b.body + 4) else u32(buf, b.body + 4)
        val unix = secs - EPOCH_1904
        return if (unix > 31_536_000L) unix * 1000 else null // 0 and other "unset" values land before 1971
    }

    /** QuickTime metadata: `meta` → `keys` (names) + `ilst` (values by 1-based key index); text values only. */
    private fun appleKeys(buf: ByteArray, meta: Box): Map<String, String> {
        // QuickTime's meta has no version/flags; MP4's (full box) does. Find where the children start.
        val known = setOf("hdlr", "keys", "ilst")
        val start = when {
            meta.end - meta.body >= 8 && String(buf, meta.body + 4, 4, Charsets.ISO_8859_1) in known -> meta.body
            meta.end - meta.body >= 12 && String(buf, meta.body + 8, 4, Charsets.ISO_8859_1) in known -> meta.body + 4
            else -> return emptyMap()
        }
        val children = boxes(buf, start, meta.end)
        val names = ArrayList<String>()
        children.firstOrNull { it.type == "keys" }?.let { k ->
            var p = k.body + 8 // version/flags, entry count
            while (p + 8 <= k.end) {
                val size = u32(buf, p).toInt()
                if (size < 8 || p + size > k.end) break
                names += String(buf, p + 8, size - 8, Charsets.UTF_8)
                p += size
            }
        }
        val out = HashMap<String, String>()
        children.firstOrNull { it.type == "ilst" }?.let { ilst ->
            var p = ilst.body
            while (p + 8 <= ilst.end) {
                val size = u32(buf, p).toInt()
                if (size < 8 || p + size > ilst.end) break
                val index = u32(buf, p + 4).toInt()
                val name = names.getOrNull(index - 1)
                if (name != null) {
                    boxes(buf, p + 8, p + size).firstOrNull { it.type == "data" && it.end - it.body >= 8 }?.let { d ->
                        if (u32(buf, d.body) == 1L) out[name] = String(buf, d.body + 8, d.end - d.body - 8, Charsets.UTF_8) // 1 = UTF-8
                    }
                }
                p += size
            }
        }
        return out
    }

    /** "2025-07-04T11:30:00-0700" (iPhone), "…-07:00", "…Z", or without an offset (local time in [zone]). */
    fun parseDate(raw: String, zone: ZoneId): Long? {
        val s = raw.trim().replace(Regex("([+-]\\d{2})(\\d{2})$"), "$1:$2")
        return try {
            OffsetDateTime.parse(s).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            try {
                LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
            } catch (e2: DateTimeParseException) {
                null
            }
        }
    }

    /** "+37.4219-122.0840/" or "+47.6062-122.3321+012.000/" → (lat, lon); null if unreadable. */
    fun parseIso6709(raw: String): Pair<Double, Double>? {
        val m = Regex("^([+-]\\d+(?:\\.\\d+)?)([+-]\\d+(?:\\.\\d+)?)").find(raw.trim()) ?: return null
        val lat = m.groupValues[1].toDoubleOrNull() ?: return null
        val lon = m.groupValues[2].toDoubleOrNull() ?: return null
        return lat to lon
    }

    private fun u16(b: ByteArray, p: Int) = ((b[p].toInt() and 0xFF) shl 8) or (b[p + 1].toInt() and 0xFF)

    private fun u32(b: ByteArray, p: Int): Long =
        ((b[p].toLong() and 0xFF) shl 24) or ((b[p + 1].toLong() and 0xFF) shl 16) or
            ((b[p + 2].toLong() and 0xFF) shl 8) or (b[p + 3].toLong() and 0xFF)

    private fun u64(b: ByteArray, p: Int): Long = (u32(b, p) shl 32) or u32(b, p + 4)
}
