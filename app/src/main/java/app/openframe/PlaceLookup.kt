package app.openframe

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * Precise place names for the caption (SPEC §8), in the background, after [Places] has named the town:
 * the name the iPhone sent wins; otherwise OpenStreetMap is asked, **only for items with no precise name at
 * all** (or all of them on the complete re-run from Settings): the named area the spot is inside (Postpass;
 * Overpass as fallback and check), else the nearest named place (Nominatim). Requests well spaced, a User-Agent
 * naming OpenFrame, answers cached per file in `media.db` (`place_lookups`). Offline or refused: tried again
 * later. Off with `caption.detailedPlace` (towns only). Coordinates and names are never logged.
 */
class PlaceLookup(private val app: OpenFrameApp) {

    private val thread = HandlerThread("OpenFrame-placenames", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)
    private val userAgent: String

    // Progress for Settings (written on the worker thread).
    @Volatile private var running = false
    @Volatile private var runTotal = 0
    @Volatile private var runDone = 0
    @Volatile private var runFound = 0
    @Volatile private var problem: String? = null
    @Volatile private var lastRunAt = 0L
    @Volatile private var lastCaption: ConfigStore.CaptionConfig? = null

    init {
        @Suppress("DEPRECATION")
        val version = app.packageManager.getPackageInfo(app.packageName, 0).versionName
        userAgent = "OpenFrame/$version (Android photo frame)"
        lastCaption = app.config.caption
        // Detailed location, private places, or places left out changed: skipped items are decided again
        // (still private ones are skipped again; nothing is asked for them), and what waits is looked up.
        app.config.addListener {
            val c = app.config.caption
            if (c == lastCaption) return@addListener
            lastCaption = c
            handler.post {
                try { app.mediaDb.resetSkippedPlaceNames() } catch (e: Exception) { Log.e(TAG, "Place names: reset failed", e) }
            }
            request()
        }
        handler.post {
            try {
                val n = app.mediaDb.clearPlaceNames(PlaceNames.GENERIC)
                if (n > 0) Log.i(TAG, "Place names: $n placeholder name(s) to decide again")
            } catch (e: Exception) {
                Log.e(TAG, "Place names: clearing placeholder names failed", e)
            }
        }
    }

    private val runnable = Runnable { run() }

    /** Something may need a name (new items named by [Places], a re-run): look soon (coalesced). */
    fun request(delayMs: Long = REQUEST_DELAY_MS) {
        handler.removeCallbacks(runnable)
        handler.postDelayed(runnable, delayMs)
    }

    /** Settings: look up again ([all] = the complete re-run). Returns how many items will be looked up. */
    fun rerun(all: Boolean): Int {
        val n = app.mediaDb.resetPlaceNames(all)
        Log.i(TAG, "Place names: ${if (all) "complete re-run" else "missing names"} asked, $n item(s)")
        handler.post { running = false; problem = null } // a fresh count for the progress
        request(0)
        return n
    }

    fun json(): JSONObject {
        val (located, named) = app.mediaDb.placeNameCounts()
        return progressJson().put("located", located).put("named", named)
    }

    private fun progressJson(): JSONObject = JSONObject()
        .put("running", running)
        .put("waiting", app.mediaDb.withoutPlaceNameCount())
        .put("done", runDone)
        .put("total", runTotal)
        .put("found", runFound)
        .put("problem", problem ?: JSONObject.NULL)
        .put("lastRunAt", lastRunAt)

    private fun run() {
        val caption = app.config.caption
        if (!caption.detailedPlace) { running = false; return } // towns only: nothing is looked up
        val todo = try { app.mediaDb.withoutPlaceName(BATCH) } catch (e: Exception) {
            Log.e(TAG, "Place names: reading the library failed", e); return
        }
        if (todo.isEmpty()) { running = false; return }
        if (!running) { running = true; runDone = 0; runFound = 0; runTotal = app.mediaDb.withoutPlaceNameCount() }
        val earlier = app.mediaDb.allLookups() // answers for the same spot (within 50 m) are used again
        var asked = 0
        var reused = 0
        var skipped = 0
        var found = 0
        for (t in todo) {
            val name = when {
                !PlaceIndex.validGps(t.lat, t.lon) -> ""
                t.typed -> { skipped++; PlaceNames.SKIPPED } // a name typed for this photo: nothing to look up
                caption.privatePlaces.any { it.key == t.privateKey } -> { skipped++; PlaceNames.SKIPPED } // added to a private place
                // Home and places left out: never sent anywhere; the caption shows the private name or the town.
                PlaceNames.privateAt(t.lat, t.lon, caption.privatePlaces) != null || Places.leftOut(t.lat, t.lon, caption) -> {
                    skipped++; PlaceNames.SKIPPED
                }
                PlaceNames.isPrecise(t.sent, t.town) -> t.sent!! // the iPhone's name wins
                t.cached != null -> t.cached
                PlaceNames.sameSpot(t.lat, t.lon, earlier) != null -> { reused++; PlaceNames.sameSpot(t.lat, t.lon, earlier)!! }
                else -> {
                    val r = try { ask(t.lat, t.lon) } catch (e: Refused) {
                        stop("OpenStreetMap is busy; trying again later.", RETRY_REFUSED_MS, e.message); return
                    } catch (e: IOException) {
                        stop("Can't reach OpenStreetMap (no internet?); trying again later.", RETRY_MS, e.javaClass.simpleName); return
                    }
                    asked++
                    app.mediaDb.saveLookup(t.path, t.lat, t.lon, r, System.currentTimeMillis())
                    earlier += Triple(t.lat, t.lon, r)
                    r
                }
            }
            val precise = PlaceNames.isPrecise(name, t.town)
            app.mediaDb.setPlaceName(t.id, if (precise || name == PlaceNames.SKIPPED) name else "")
            runDone++
            if (precise) { runFound++; found++ }
        }
        problem = null
        lastRunAt = System.currentTimeMillis()
        Log.i(TAG, "Place names: ${todo.size} item(s) done, $asked asked online, $reused from the same spot, $skipped private, $found named")
        if (todo.size == BATCH) request(0) else running = false
    }

    private fun stop(message: String, retryMs: Long, detail: String?) {
        running = false
        problem = message
        lastRunAt = System.currentTimeMillis()
        Log.w(TAG, "Place names: lookup stopped ($detail); retry in ${retryMs / 60000} min")
        request(retryMs)
    }

    private class Refused(message: String) : IOException(message)

    private val searchLock = Any()
    private var lastSearchAt = 0L // under searchLock

    /**
     * Settings → Private places → Search an address (the user types it; it is sent to Nominatim once, by their
     * choice): up to 5 matches `{ label, lat, lon }`. Runs on the calling server thread, ≥ 1.1 s apart.
     */
    fun searchAddress(query: String): org.json.JSONArray = search(query, "limit=5", "address search")

    /**
     * Location editor → Find a place nearby: businesses and places named like [query] within ~1 km of the pin
     * (Nominatim, `viewbox` + `bounded`; sent only when the user searches). Up to 8 `{ name, label, lat, lon }`.
     */
    fun searchNearby(query: String, lat: Double, lon: Double): org.json.JSONArray {
        val dLat = 0.009 // ≈ 1 km
        val dLon = 0.009 / Math.max(0.2, Math.cos(Math.toRadians(lat)))
        val box = String.format(Locale.US, "viewbox=%.5f,%.5f,%.5f,%.5f&bounded=1&limit=8", lon - dLon, lat + dLat, lon + dLon, lat - dLat)
        val found = search(query, box, "nearby search")
        // Nearest first, with the distance ("120 m away").
        val list = (0 until found.length()).map { found.getJSONObject(it) }.map { r ->
            r.put("distanceM", Math.round(PlaceIndex.distanceKm(lat, lon, r.getDouble("lat"), r.getDouble("lon")) * 1000))
        }.sortedBy { it.getLong("distanceM") }
        return org.json.JSONArray().also { a -> list.forEach { a.put(it) } }
    }

    private fun search(query: String, params: String, what: String): org.json.JSONArray = synchronized(searchLock) {
        val wait = lastSearchAt + NOMINATIM_GAP_MS - System.currentTimeMillis()
        if (wait > 0) Thread.sleep(wait)
        lastSearchAt = System.currentTimeMillis()
        val url = "https://nominatim.openstreetmap.org/search?format=jsonv2&$params&accept-language=en&q=" +
            java.net.URLEncoder.encode(query, "UTF-8")
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode !in 200..299) throw IOException("nominatim HTTP ${conn.responseCode}")
            val list = try {
                org.json.JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
            } catch (e: JSONException) { throw IOException("unreadable answer") }
            val out = org.json.JSONArray()
            for (i in 0 until list.length()) {
                val r = list.optJSONObject(i) ?: continue
                val lat = r.optString("lat").toDoubleOrNull() ?: continue
                val lon = r.optString("lon").toDoubleOrNull() ?: continue
                out.put(JSONObject().put("name", r.optString("name")).put("label", r.optString("display_name")).put("lat", lat).put("lon", lon))
            }
            Log.i(TAG, "Place names: $what, ${out.length()} result(s)") // never the query or the position
            return out
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * The place's name at this spot, or "" when nothing named is there: the smallest named area it is inside, else
     * the nearest within [PlaceNames.NEAR_M] (Postpass; Overpass, inside only, when Postpass can't answer, and as a
     * check when Postpass finds none), else the nearest
     * named place (Nominatim). Throws when no area service could be asked (tried again later).
     */
    private fun ask(lat: Double, lon: Double): String {
        var postpassAnswered = true
        val areas = try {
            postpass(lat, lon)
        } catch (e: IOException) {
            Log.w(TAG, "Place names: Postpass unavailable (${e.message}); asking Overpass")
            postpassAnswered = false
            overpass(lat, lon)
        }
        PlaceNames.fromAreas(areas).takeIf { it.isNotEmpty() }?.let { return it }
        if (postpassAnswered) {
            // A check with Overpass when it is free; busy or down: Nominatim alone decides.
            val checked = try { overpass(lat, lon) } catch (e: IOException) { emptyList() }
            PlaceNames.fromAreas(checked).takeIf { it.isNotEmpty() }?.let { return it }
        }
        return nominatim(lat, lon)
    }

    private val lastAt = HashMap<String, Long>() // worker thread only: per service, for the gaps between requests

    private fun postpass(lat: Double, lon: Double): List<PlaceNames.Area> {
        val cols = (listOf("name", "short_name") + PlaceNames.CATEGORIES).joinToString(", ") { "tags->>'$it' AS \"$it\"" }
        val point = String.format(Locale.US, "ST_SetSRID(ST_MakePoint(%.5f, %.5f), 4326)", lon, lat)
        // Areas the spot is inside or within NEAR_M of (the box first, so the index is used); d = 0 inside.
        val near = String.format(Locale.US, "%.1f", PlaceNames.NEAR_M)
        val sql = "SELECT $cols, round(ST_Area(geom::geography)) AS m2, round(ST_Distance(geom::geography, $point::geography)) AS d, " +
            "ST_PointOnSurface(geom) AS geom FROM postpass_polygon " +
            "WHERE tags ? 'name' AND NOT tags ? 'boundary' AND NOT tags ? 'place' AND NOT tags ? 'highway' " +
            "AND geom && ST_Expand($point, 0.0006) AND ST_DWithin(geom::geography, $point::geography, $near) " +
            "ORDER BY d, ST_Area(geom) LIMIT 25"
        val body = get("postpass", "$POSTPASS?data=${java.net.URLEncoder.encode(sql, "UTF-8")}", POSTPASS_GAP_MS)
        return PlaceNames.areasFromPostpass(json(body))
    }

    /** Overpass: the main server, then private.coffee (same interface). */
    private fun overpass(lat: Double, lon: Double): List<PlaceNames.Area> {
        val q = String.format(Locale.US, "[out:json][timeout:20];is_in(%.5f,%.5f)->.a;(way(pivot.a)[name];rel(pivot.a)[name];);out tags bb;", lat, lon)
        val data = "data=" + java.net.URLEncoder.encode(q, "UTF-8")
        var last: IOException? = null
        for (server in OVERPASS) {
            try {
                return PlaceNames.areasFromOverpass(json(get("overpass", "$server?$data", OVERPASS_GAP_MS)))
            } catch (e: IOException) {
                last = e
            }
        }
        throw last ?: IOException("no Overpass server")
    }

    private fun nominatim(lat: Double, lon: Double): String {
        val url = String.format(Locale.US, "%s?format=jsonv2&lat=%.5f&lon=%.5f&zoom=18&accept-language=en", NOMINATIM, lat, lon)
        return PlaceNames.fromNominatim(json(get("nominatim", url, NOMINATIM_GAP_MS, refusals = true)))
    }

    private fun json(body: String): JSONObject = try { JSONObject(body) } catch (e: JSONException) { throw IOException("unreadable answer") }

    /** One GET, at least [gapMs] after the last one to the same [service]. [refusals]: 403/429 mean "wait longer". */
    private fun get(service: String, url: String, gapMs: Long, refusals: Boolean = false): String {
        val wait = (lastAt[service] ?: 0L) + gapMs - System.currentTimeMillis()
        if (wait > 0) Thread.sleep(wait)
        lastAt[service] = System.currentTimeMillis()
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 25_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (refusals && (code == 429 || code == 403)) throw Refused("$service HTTP $code")
            if (code !in 200..299) throw IOException("$service HTTP $code")
            return conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8192)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_BYTES) throw IOException("$service answer too large")
                }
                out.toString("UTF-8")
            }
        } finally {
            conn?.disconnect()
        }
    }

    companion object {
        private const val NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
        private const val POSTPASS = "https://postpass.geofabrik.de/api/interpreter"
        private val OVERPASS = listOf("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter")
        private const val REQUEST_DELAY_MS = 2_000L
        private const val NOMINATIM_GAP_MS = 1_100L // Nominatim's policy: at most one request a second
        private const val POSTPASS_GAP_MS = 2_000L // no published limit yet: stay gentle
        private const val OVERPASS_GAP_MS = 10_000L
        private const val RETRY_MS = 15 * 60_000L
        private const val RETRY_REFUSED_MS = 60 * 60_000L
        private const val BATCH = 50
        private const val MAX_BYTES = 256 * 1024
    }
}
