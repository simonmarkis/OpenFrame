package app.openframe

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.Locale
import javax.net.ssl.SSLException
import kotlin.math.abs

/**
 * Open-Meteo forecast for the configured location (SPEC §12), cached in `cache/weather.json`.
 *
 * - Always fetched in °C (the UI converts), so changing units works offline.
 * - Refreshes every `weather.refreshMin` (default 30 min), right away when the location changes,
 *   and when the network comes back. A failed fetch never replaces a good cache.
 * - The cache is only served while it matches the configured location.
 * - Status: never_synced | ok | error (+ errorKind: network | tls | http | parse).
 */
class WeatherSync(private val context: Context, private val config: ConfigStore) {

    private val cacheFile = File(context.filesDir, "cache/weather.json")
    private val thread = HandlerThread("OpenFrame-weather", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)
    private val userAgent: String

    /** { fetchedAt, latitude, longitude, forecast } — latitude/longitude are the requested ones. */
    @Volatile private var cache: JSONObject? = null
    @Volatile private var status = "never_synced"
    @Volatile private var errorKind: String? = null
    @Volatile private var error: String? = null
    @Volatile private var httpStatus: Int? = null
    @Volatile private var lastAttemptAt = 0L
    private var attemptedFor: Pair<Double, Double>? = null // worker thread only
    @Volatile var online = true
        private set

    init {
        @Suppress("DEPRECATION")
        val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName
        userAgent = "OpenFrame/$version (Android photo frame)"
    }

    fun start() {
        cacheFile.parentFile?.mkdirs()
        loadCache()
        val cm = context.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION")
        online = cm.activeNetworkInfo?.isConnected == true
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val wasOffline = !online
                online = true
                if (wasOffline) handler.postDelayed({ tick(minAgeMs = RETRY_MS) }, 3_000)
            }

            override fun onLost(network: Network) {
                @Suppress("DEPRECATION")
                online = cm.activeNetworkInfo?.isConnected == true
            }
        })
        // Any config change: refetch if the location changed, and re-plan the next refresh.
        config.addListener { handler.post { tick() } }
        handler.postDelayed({ tick() }, 4_000)
    }

    /** Manual refresh (debounced). */
    fun requestRefresh() = handler.post { tick(minAgeMs = 30_000, force = true) }

    fun json(): JSONObject {
        val w = config.weather
        val c = cache?.takeIf { matches(it, w) }
        return JSONObject()
            .put("configured", w.latitude != null)
            .put("latitude", w.latitude ?: JSONObject.NULL)
            .put("longitude", w.longitude ?: JSONObject.NULL)
            .put("place", w.place)
            .put("units", w.units)
            .put("online", online)
            .put("status", if (w.latitude == null) "not_configured" else status)
            .put("errorKind", errorKind ?: JSONObject.NULL)
            .put("error", error ?: JSONObject.NULL)
            .put("httpStatus", httpStatus ?: JSONObject.NULL)
            .put("lastAttemptAt", lastAttemptAt)
            .put("lastSuccessAt", c?.optLong("fetchedAt") ?: 0L)
            .put("forecast", c?.optJSONObject("forecast") ?: JSONObject.NULL)
    }

    /**
     * Place search for the settings UI (Open-Meteo geocoding; runs on the calling server thread).
     * Returns `{ results: [{ name, admin1, country, countryCode, latitude, longitude }] }`.
     * @throws IOException with a user-readable message.
     */
    fun geocode(query: String): JSONObject {
        val url = "$GEOCODE_API?name=${java.net.URLEncoder.encode(query.trim(), "UTF-8")}&count=10&language=en&format=json"
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("The place search returned HTTP $code.")
            val body = JSONObject(String(readLimited(conn.inputStream), Charsets.UTF_8))
            val results = org.json.JSONArray()
            val list = body.optJSONArray("results") ?: org.json.JSONArray()
            for (i in 0 until list.length()) {
                val r = list.optJSONObject(i) ?: continue
                if (!r.has("latitude") || !r.has("longitude")) continue
                results.put(JSONObject()
                    .put("name", r.optString("name"))
                    .put("admin1", r.optString("admin1"))
                    .put("country", r.optString("country"))
                    .put("countryCode", r.optString("country_code"))
                    .put("latitude", r.getDouble("latitude"))
                    .put("longitude", r.getDouble("longitude")))
            }
            return JSONObject().put("results", results)
        } catch (e: UnknownHostException) {
            throw IOException("Can't reach the place search (no internet?).")
        } catch (e: SocketTimeoutException) {
            throw IOException("The place search timed out.")
        } catch (e: SSLException) {
            throw IOException("Secure connection to the place search failed.")
        } catch (e: JSONException) {
            throw IOException("The place search returned an unreadable response.")
        } finally {
            conn?.disconnect()
        }
    }

    // ---- worker thread ----

    private val periodic = Runnable { tick() }

    /**
     * @param minAgeMs fetch if the cache is at least this old (network regained); null = normal schedule
     * @param force manual refresh: fetch unless the last attempt was under [minAgeMs] ago
     */
    private fun tick(minAgeMs: Long? = null, force: Boolean = false) {
        val w = config.weather
        if (w.latitude != null && w.longitude != null && online) {
            val c = cache
            val now = System.currentTimeMillis()
            val refreshMs = w.refreshMin * 60_000L
            val age = if (c != null && matches(c, w)) now - c.optLong("fetchedAt") else Long.MAX_VALUE
            // Error back-off only applies to the location that failed.
            val sinceAttempt = if (attemptedFor == w.latitude to w.longitude) now - lastAttemptAt else Long.MAX_VALUE
            val due = when {
                force -> sinceAttempt >= (minAgeMs ?: 0)
                minAgeMs != null -> age >= minAgeMs
                else -> age >= refreshMs - 30_000 && (status != "error" || sinceAttempt >= RETRY_MS)
            }
            if (due) fetch(w.latitude, w.longitude)
        }
        scheduleNext()
    }

    private fun scheduleNext() {
        handler.removeCallbacks(periodic)
        val w = config.weather
        val refreshMs = w.refreshMin * 60_000L
        val c = cache?.takeIf { matches(it, w) }
        val delay = when {
            w.latitude == null -> refreshMs // nothing to do; a config change calls tick()
            status == "error" || c == null -> minOf(RETRY_MS, refreshMs)
            else -> (c.optLong("fetchedAt") + refreshMs - System.currentTimeMillis()).coerceIn(60_000, refreshMs)
        }
        handler.postDelayed(periodic, delay)
    }

    private fun fetch(lat: Double, lon: Double) {
        lastAttemptAt = System.currentTimeMillis()
        attemptedFor = lat to lon
        val url = String.format(Locale.US, "%s?latitude=%.5f&longitude=%.5f&%s", API, lat, lon, QUERY)
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 20_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                // Open-Meteo explains errors as {"error":true,"reason":"..."}.
                val reason = runCatching {
                    JSONObject(String(readLimited(conn.errorStream ?: return@runCatching null), Charsets.UTF_8)).optString("reason")
                }.getOrNull()?.take(200)?.takeIf { it.isNotEmpty() } ?: conn.responseMessage ?: "error"
                fail("http", "Weather service returned HTTP $code ($reason).", code)
                return
            }
            val forecast = JSONObject(String(readLimited(conn.inputStream), Charsets.UTF_8))
            if (forecast.optJSONObject("current") == null || forecast.optJSONObject("daily") == null) {
                fail("parse", "Weather service returned an unexpected response.", code)
                return
            }
            val entry = JSONObject()
                .put("fetchedAt", System.currentTimeMillis())
                .put("latitude", lat)
                .put("longitude", lon)
                .put("forecast", forecast)
            writeAtomically(entry)
            cache = entry
            status = "ok"
            errorKind = null
            error = null
            httpStatus = null
            Log.i(TAG, "Weather updated (code ${forecast.getJSONObject("current").optInt("weather_code")})")
        } catch (e: UnknownHostException) {
            fail("network", "Can't reach the weather service (no internet or DNS).", null)
        } catch (e: SocketTimeoutException) {
            fail("network", "The weather service timed out.", null)
        } catch (e: SSLException) {
            fail("tls", "Secure connection to the weather service failed (${e.javaClass.simpleName}).", null)
        } catch (e: JSONException) {
            fail("parse", "Weather service returned an unreadable response.", null)
        } catch (e: IOException) {
            fail("network", "Weather download failed (${e.javaClass.simpleName}).", null)
        } finally {
            conn?.disconnect()
        }
    }

    private fun fail(kind: String, message: String, http: Int?) {
        // The cached forecast (if any) stays in place and keeps being served.
        status = "error"
        errorKind = kind
        error = message
        httpStatus = http
        Log.w(TAG, "Weather fetch failed [$kind]: $message")
    }

    private fun matches(c: JSONObject, w: ConfigStore.WeatherConfig): Boolean =
        w.latitude != null && w.longitude != null &&
            abs(c.optDouble("latitude") - w.latitude) < 1e-4 && abs(c.optDouble("longitude") - w.longitude) < 1e-4

    private fun readLimited(input: java.io.InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        input.use {
            val buf = ByteArray(16 * 1024)
            while (true) {
                val n = it.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > MAX_BYTES) throw IOException("Weather response too large")
            }
        }
        return out.toByteArray()
    }

    private fun loadCache() {
        if (!cacheFile.isFile) return
        try {
            val c = JSONObject(cacheFile.readText())
            if (c.optJSONObject("forecast") != null) {
                cache = c
                status = "ok"
            }
        } catch (e: Exception) {
            Log.e(TAG, "weather.json unreadable; will refetch", e)
        }
    }

    private fun writeAtomically(json: JSONObject) {
        val tmp = File(cacheFile.parentFile, cacheFile.name + ".tmp")
        tmp.writeText(json.toString())
        if (!tmp.renameTo(cacheFile)) throw IOException("Could not write weather.json")
    }

    private companion object {
        const val API = "https://api.open-meteo.com/v1/forecast"
        const val GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search"
        const val QUERY = "current=temperature_2m,apparent_temperature,weather_code,is_day" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
            "&timezone=auto&forecast_days=7"
        const val RETRY_MS = 5 * 60_000L
        const val MAX_BYTES = 256 * 1024
    }
}
