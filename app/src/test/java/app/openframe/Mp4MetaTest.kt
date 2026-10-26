package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.time.Instant
import java.time.ZoneId

/** Synthetic MP4 boxes only. */
class Mp4MetaTest {

    private val la = ZoneId.of("America/Los_Angeles")

    private fun box(type: String, vararg parts: ByteArray): ByteArray {
        val body = parts.fold(ByteArray(0)) { a, b -> a + b }
        return ByteBuffer.allocate(8 + body.size).putInt(8 + body.size).put(type.toByteArray(Charsets.ISO_8859_1)).put(body).array()
    }

    private fun u32(v: Long) = ByteBuffer.allocate(4).putInt(v.toInt()).array()
    private fun u16(v: Int) = ByteBuffer.allocate(2).putShort(v.toShort()).array()
    private fun utf8(s: String) = s.toByteArray(Charsets.UTF_8)

    /** mvhd version 0 with a creation time in seconds since 1904. */
    private fun mvhd(secs1904: Long) = box("mvhd", u32(0), u32(secs1904), u32(secs1904), u32(600), u32(6000))

    private fun xyz(s: String) = box("©xyz", u16(utf8(s).size), u16(0x15C7), utf8(s))

    /** QuickTime meta (no version/flags): hdlr, keys, ilst with UTF-8 values. */
    private fun appleMeta(vararg kv: Pair<String, String>): ByteArray {
        val keys = kv.map { (k, _) -> box("mdta", utf8(k)) }
        val items = kv.mapIndexed { i, (_, v) ->
            val data = box("data", u32(1), u32(0), utf8(v))
            ByteBuffer.allocate(8 + data.size).putInt(8 + data.size).putInt(i + 1).put(data).array()
        }
        return box("meta",
            box("hdlr", u32(0), u32(0), utf8("mdta"), ByteArray(12), ByteArray(1)),
            box("keys", u32(0), u32(kv.size.toLong()), *keys.toTypedArray()),
            box("ilst", *items.toTypedArray()))
    }

    private fun moovBody(vararg children: ByteArray) = children.fold(ByteArray(0)) { a, b -> a + b }

    private val sec1904 = { iso: String -> Instant.parse(iso).epochSecond + 2_082_844_800L }

    @Test fun iphoneKeysWin() {
        val moov = moovBody(
            mvhd(sec1904("2026-10-14T15:22:00Z")), // conversion time
            box("udta", xyz("+40.0000-100.0000/")),
            appleMeta(
                "com.apple.quicktime.location.ISO6709" to "+47.6062-122.3321+012.000/",
                "com.apple.quicktime.creationdate" to "2025-07-04T11:30:00-0700",
            ),
        )
        val r = Mp4Meta.parseMoov(moov, la)
        assertEquals(Instant.parse("2025-07-04T18:30:00Z").toEpochMilli(), r.takenAt)
        assertEquals(47.6062, r.lat!!, 1e-9)
        assertEquals(-122.3321, r.lon!!, 1e-9)
    }

    @Test fun fallsBackToMvhdAndXyz() {
        val r = Mp4Meta.parseMoov(moovBody(mvhd(sec1904("2025-07-04T18:30:00Z")), box("udta", xyz("+47.6062-122.3321/"))), la)
        assertEquals(Instant.parse("2025-07-04T18:30:00Z").toEpochMilli(), r.takenAt)
        assertEquals(47.6062, r.lat!!, 1e-9)
    }

    @Test fun unsetCreationTimeIsNoDate() {
        val r = Mp4Meta.parseMoov(moovBody(mvhd(0)), la)
        assertNull(r.takenAt)
        assertNull(r.lat)
    }

    @Test fun readsMoovAtTheEndOfAFile() {
        val f = File.createTempFile("mp4meta", ".mov")
        try {
            val out = ByteArrayOutputStream()
            out.write(box("ftyp", utf8("qt  "), u32(0), utf8("qt  ")))
            out.write(box("mdat", ByteArray(5000)))
            out.write(box("moov", mvhd(sec1904("2024-12-25T08:00:00Z"))))
            f.writeBytes(out.toByteArray())
            assertEquals(Instant.parse("2024-12-25T08:00:00Z").toEpochMilli(), Mp4Meta.read(f, la).takenAt)
        } finally {
            f.delete()
        }
    }

    @Test fun datesWithAndWithoutOffsets() {
        val utc = Instant.parse("2025-07-04T18:30:00Z").toEpochMilli()
        assertEquals(utc, Mp4Meta.parseDate("2025-07-04T11:30:00-0700", la))
        assertEquals(utc, Mp4Meta.parseDate("2025-07-04T11:30:00-07:00", la))
        assertEquals(utc, Mp4Meta.parseDate("2025-07-04T18:30:00Z", la))
        assertEquals(utc, Mp4Meta.parseDate("2025-07-04T11:30:00", la)) // local time, PDT
        assertNull(Mp4Meta.parseDate("yesterday", la))
    }

    @Test fun iso6709() {
        assertEquals(37.4219 to -122.084, Mp4Meta.parseIso6709("+37.4219-122.0840/"))
        assertNull(Mp4Meta.parseIso6709("nowhere"))
    }
}
