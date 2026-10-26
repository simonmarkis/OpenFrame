package app.openframe

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Offline place names for photo GPS (SPEC §8): the bundled GeoNames list of places with more than
 * 5,000 people (`assets/geo/cities.tsv`, built by `scripts/geo/make-cities.mjs`), one line per place:
 * `name, lat, lon, country code, US state, population`, largest first. Pure Kotlin (unit-tested).
 *
 * Kept compact for the frame's memory: coordinates in float arrays, names and regions in one UTF-8
 * blob, and a 1° grid for nearest-place lookups.
 */
class PlaceIndex(lines: Sequence<String>) {

    /** [region]: the US state ("WA"), else the country code ("IT"). */
    data class Place(val name: String, val region: String, val lat: Double, val lon: Double, val population: Int)

    private val lat: FloatArray
    private val lon: FloatArray
    private val pop: IntArray
    private val text: ByteArray        // "name\tregion" per place, back to back
    private val textStart: IntArray    // size + 1
    private val cellStart = IntArray(CELLS + 1)
    private val cellItems: IntArray

    val size: Int get() = lat.size

    init {
        val lats = FloatList()
        val lons = FloatList()
        val pops = ArrayList<Int>()
        val blob = java.io.ByteArrayOutputStream()
        val starts = ArrayList<Int>()
        for (line in lines) {
            val f = line.split('\t')
            if (f.size < 6) continue
            val la = f[1].toFloatOrNull() ?: continue
            val lo = f[2].toFloatOrNull() ?: continue
            if (f[0].isBlank() || la !in -90f..90f || lo !in -180f..180f) continue
            lats.add(la)
            lons.add(lo)
            pops += f[5].trim().toIntOrNull() ?: 0
            starts += blob.size()
            blob.write("${f[0]}\t${f[4].ifEmpty { f[3] }}".toByteArray(Charsets.UTF_8))
        }
        starts += blob.size()
        lat = lats.toArray()
        lon = lons.toArray()
        pop = pops.toIntArray()
        text = blob.toByteArray()
        textStart = starts.toIntArray()

        // Counting sort of places into 1° cells.
        val counts = IntArray(CELLS)
        for (i in lat.indices) counts[cellOf(lat[i].toDouble(), lon[i].toDouble())]++
        for (c in 0 until CELLS) cellStart[c + 1] = cellStart[c] + counts[c]
        val fill = cellStart.copyOf(CELLS)
        cellItems = IntArray(lat.size)
        for (i in lat.indices) cellItems[fill[cellOf(lat[i].toDouble(), lon[i].toDouble())]++] = i
    }

    fun place(i: Int): Place {
        val s = String(text, textStart[i], textStart[i + 1] - textStart[i], Charsets.UTF_8)
        val tab = s.indexOf('\t')
        return Place(s.substring(0, tab), s.substring(tab + 1), lat[i].toDouble(), lon[i].toDouble(), pop[i])
    }

    private fun name(i: Int): String {
        var end = textStart[i]
        while (end < textStart[i + 1] && text[end] != '\t'.code.toByte()) end++
        return String(text, textStart[i], end - textStart[i], Charsets.UTF_8)
    }

    /**
     * The place a photo taken at [latDeg], [lonDeg] is "in": the nearest place within [MAX_KM], except
     * that a bigger place almost as near wins (a point in a city's outskirts is often nearer the
     * center of a small neighbor). Null when nothing is near (sea, wilderness) or the GPS is invalid.
     */
    fun nearest(latDeg: Double, lonDeg: Double): Place? {
        if (!validGps(latDeg, lonDeg)) return null
        val cands = ArrayList<Pair<Int, Double>>()
        val r0 = floor(latDeg).toInt()
        val c0 = floor(lonDeg).toInt()
        for (dr in -1..1) for (dc in -1..1) {
            val r = r0 + dr
            if (r < -90 || r >= 90) continue
            val c = Math.floorMod(c0 + dc + 180, 360) - 180
            val cell = (r + 90) * 360 + (c + 180)
            for (k in cellStart[cell] until cellStart[cell + 1]) {
                val i = cellItems[k]
                val d = distanceKm(latDeg, lonDeg, lat[i].toDouble(), lon[i].toDouble())
                if (d <= MAX_KM) cands += i to d
            }
        }
        val best = cands.minByOrNull { it.second } ?: return null
        val limit = maxOf(best.second * NEAR_FACTOR, best.second + NEAR_SLACK_KM)
        val chosen = cands.filter { it.second <= limit }.maxWithOrNull(compareBy({ pop[it.first] }, { -it.second }))!!
        return place(chosen.first)
    }

    // Names without case and accents, for search; built on the first search (a few seconds on the
    // frame, so a search compares bytes instead of converting 64,000 names each time).
    private class Folded(val text: ByteArray, val start: IntArray)

    private val folded: Folded by lazy {
        val blob = java.io.ByteArrayOutputStream(text.size)
        val starts = IntArray(lat.size + 1)
        for (i in lat.indices) {
            starts[i] = blob.size()
            val ascii = (textStart[i] until textStart[i + 1]).all { text[it] >= 0 }
            if (ascii) {
                var k = textStart[i]
                while (k < textStart[i + 1] && text[k] != TAB) { blob.write(lower(text[k].toInt())); k++ }
            } else {
                blob.write(fold(name(i)).toByteArray(Charsets.UTF_8))
            }
        }
        starts[lat.size] = blob.size()
        Folded(blob.toByteArray(), starts)
    }

    /** Places whose name (or a word in it) starts with [query], ignoring case and accents; biggest first. */
    fun search(query: String, limit: Int = 20): List<Place> {
        val q = fold(query.trim()).toByteArray(Charsets.UTF_8)
        if (q.isEmpty()) return emptyList()
        val out = ArrayList<Place>()
        for (i in lat.indices) { // already sorted by population
            if (matches(i, q)) {
                out += place(i)
                if (out.size >= limit) break
            }
        }
        return out
    }

    private fun matches(i: Int, q: ByteArray): Boolean {
        val f = folded
        val start = f.start[i]
        val end = f.start[i + 1]
        var k = start
        while (k + q.size <= end) {
            if (k == start || f.text[k - 1] == SPACE || f.text[k - 1] == DASH) {
                var j = 0
                while (j < q.size && f.text[k + j] == q[j]) j++
                if (j == q.size) return true
            }
            k++
        }
        return false
    }

    private class FloatList {
        private var a = FloatArray(1024)
        private var n = 0
        fun add(v: Float) { if (n == a.size) a = a.copyOf(n * 2); a[n++] = v }
        fun toArray(): FloatArray = a.copyOf(n)
    }

    companion object {
        private const val CELLS = 180 * 360
        const val MAX_KM = 40.0
        private const val NEAR_FACTOR = 1.5
        private const val NEAR_SLACK_KM = 1.0
        private const val EARTH_KM = 6371.0
        const val KM_PER_MILE = 1.609344

        private fun cellOf(latDeg: Double, lonDeg: Double): Int {
            val r = floor(latDeg).toInt().coerceIn(-90, 89)
            val c = floor(lonDeg).toInt().coerceIn(-180, 179)
            return (r + 90) * 360 + (c + 180)
        }

        /** GPS that means "no fix": 0/0, and longitude ±180 (seen on a GoPro video). */
        fun validGps(latDeg: Double?, lonDeg: Double?): Boolean {
            if (latDeg == null || lonDeg == null || latDeg.isNaN() || lonDeg.isNaN()) return false
            if (latDeg !in -90.0..90.0 || lonDeg !in -180.0..180.0) return false
            if (latDeg == 0.0 && lonDeg == 0.0) return false
            return kotlin.math.abs(lonDeg) != 180.0
        }

        fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val p1 = Math.toRadians(lat1)
            val p2 = Math.toRadians(lat2)
            val dp = p2 - p1
            val dl = Math.toRadians(lon2 - lon1)
            val h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
            return 2 * EARTH_KM * asin(sqrt(h.coerceIn(0.0, 1.0)))
        }

        private const val TAB = '\t'.code.toByte()
        private const val SPACE = ' '.code.toByte()
        private const val DASH = '-'.code.toByte()

        private fun lower(c: Int): Int = if (c in 'A'.code..'Z'.code) c + 32 else c

        /** Lowercase without accents ("Città" → "citta"). */
        private fun fold(s: String): String {
            val n = java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD)
            val sb = StringBuilder(n.length)
            for (ch in n) if (Character.getType(ch) != Character.NON_SPACING_MARK.toInt()) sb.append(ch)
            return sb.toString()
        }
    }
}
