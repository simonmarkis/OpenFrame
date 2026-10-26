package app.openframe

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.net.ssl.SSLException

/**
 * Downloads and caches ICS feeds (SPEC §10).
 *
 * - Conditional requests (ETag / If-Modified-Since); a 304 just refreshes "last success".
 * - Never replaces a good cache with an error response or a non-calendar body.
 * - Serves a trimmed copy to the UI ([IcsTrimmer]); the raw download is kept alongside.
 * - Status per feed: never_synced | ok | error (+ errorKind: network | tls | http | parse | config).
 * Feed URLs are secrets: they're read from [SecretsStore] and never logged.
 */
class CalendarSync(
    private val context: Context,
    private val config: ConfigStore,
    private val secrets: SecretsStore,
) {
    class FeedState {
        var status = "never_synced"
        var errorKind: String? = null
        var error: String? = null
        var httpStatus: Int? = null
        var lastAttemptAt = 0L
        var lastSuccessAt = 0L
        var etag: String? = null
        var lastModified: String? = null
        var rev = 0
        var events = 0
        var bytes = 0L
        /** Failures in a row while the device was online (the warning system ignores single hiccups). */
        var failStreak = 0
        /** Hash of the trimmed feed without DTSTAMP lines (Google rewrites DTSTAMP on every download). */
        var contentHash: String? = null

        fun toJson(includeValidators: Boolean = false): JSONObject = JSONObject()
            .put("status", status)
            .put("errorKind", errorKind ?: JSONObject.NULL)
            .put("error", error ?: JSONObject.NULL)
            .put("httpStatus", httpStatus ?: JSONObject.NULL)
            .put("lastAttemptAt", lastAttemptAt)
            .put("lastSuccessAt", lastSuccessAt)
            .put("rev", rev)
            .put("events", events)
            .put("bytes", bytes)
            .put("failStreak", failStreak)
            .apply {
                if (includeValidators) {
                    put("etag", etag ?: JSONObject.NULL)
                    put("lastModified", lastModified ?: JSONObject.NULL)
                    put("contentHash", contentHash ?: JSONObject.NULL)
                }
            }

        companion object {
            fun fromJson(j: JSONObject) = FeedState().apply {
                status = j.optString("status", status)
                errorKind = j.optString("errorKind").takeIf { it.isNotEmpty() && it != "null" }
                error = j.optString("error").takeIf { it.isNotEmpty() && it != "null" }
                httpStatus = if (j.isNull("httpStatus")) null else j.optInt("httpStatus")
                lastAttemptAt = j.optLong("lastAttemptAt")
                lastSuccessAt = j.optLong("lastSuccessAt")
                etag = j.optString("etag").takeIf { it.isNotEmpty() && it != "null" }
                lastModified = j.optString("lastModified").takeIf { it.isNotEmpty() && it != "null" }
                rev = j.optInt("rev")
                events = j.optInt("events")
                bytes = j.optLong("bytes")
                failStreak = j.optInt("failStreak")
                contentHash = j.optString("contentHash").takeIf { it.isNotEmpty() && it != "null" }
            }
        }
    }

    private val dir = File(context.filesDir, "cache/calendars")
    private val stateFile = File(context.filesDir, "calendar-state.json")
    private val states = HashMap<String, FeedState>()
    private val thread = HandlerThread("OpenFrame-calendar", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)
    private val userAgent: String

    @Volatile var online = true
        private set
    @Volatile var syncing = false
        private set

    init {
        @Suppress("DEPRECATION")
        val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName
        userAgent = "OpenFrame/$version (Android photo frame)"
    }

    fun start() {
        dir.mkdirs()
        loadStates()
        val cm = context.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION")
        online = cm.activeNetworkInfo?.isConnected == true
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val wasOffline = !online
                online = true
                if (wasOffline) {
                    Log.i(TAG, "Network available; syncing calendars")
                    requestSync(minAgeMs = 0, delayMs = 3_000)
                }
            }

            override fun onLost(network: Network) {
                @Suppress("DEPRECATION")
                online = cm.activeNetworkInfo?.isConnected == true
                if (!online) Log.i(TAG, "Network lost; calendars stay on cache")
            }
        })
        config.addListener { handler.post { pruneRemoved() } }
        // Give boot-time Wi-Fi (and the local server, for dev feeds) a moment before the first sync.
        handler.postDelayed(periodic, 5_000)
    }

    private val periodic = object : Runnable {
        override fun run() {
            syncAll(minAgeMs = 60_000)
            handler.postDelayed(this, config.calendar.syncIntervalMin * 60_000L)
        }
    }

    /**
     * Queues a sync of all enabled calendars (or just [onlyId]). Feeds attempted less than
     * [minAgeMs] ago are skipped (SPEC §10: no new download within ~30 s).
     */
    fun requestSync(minAgeMs: Long = 30_000, onlyId: String? = null, delayMs: Long = 0) {
        handler.postDelayed({ syncAll(minAgeMs, onlyId) }, delayMs)
    }

    fun trimmedFile(id: String) = File(dir, "$id.ics")
    private fun rawFile(id: String) = File(dir, "$id.raw.ics")

    fun state(id: String): JSONObject? = synchronized(states) { states[id]?.toJson() }

    /** The feed URL changed: drop validators so the next request is unconditional. */
    fun resetValidators(id: String) = synchronized(states) {
        states[id]?.apply { etag = null; lastModified = null; lastAttemptAt = 0 }
    }

    fun forget(id: String) {
        handler.post {
            synchronized(states) { states.remove(id) }
            trimmedFile(id).delete()
            rawFile(id).delete()
            saveStates()
        }
    }

    // ---- worker thread ----

    private fun syncAll(minAgeMs: Long, onlyId: String? = null) {
        val now = System.currentTimeMillis()
        val due = config.calendars.filter { c ->
            c.enabled && (onlyId == null || c.id == onlyId) &&
                now - (synchronized(states) { states[c.id]?.lastAttemptAt } ?: 0L) >= minAgeMs
        }
        if (due.isEmpty()) return
        syncing = true
        try {
            for (c in due) syncOne(c)
        } finally {
            syncing = false
            saveStates()
        }
    }

    private fun syncOne(c: ConfigStore.CalendarMeta) {
        val st = synchronized(states) { states.getOrPut(c.id) { FeedState() } }
        val url = secrets.calendarUrl(c.id)
        st.lastAttemptAt = System.currentTimeMillis()
        if (url == null) {
            fail(st, c, "config", "No calendar link saved for this calendar.", null)
            return
        }
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "text/calendar, text/plain;q=0.8, */*;q=0.5")
                if (trimmedFile(c.id).isFile) {
                    st.etag?.let { setRequestProperty("If-None-Match", it) }
                    st.lastModified?.let { setRequestProperty("If-Modified-Since", it) }
                }
            }
            val code = conn.responseCode
            when {
                code == HttpURLConnection.HTTP_NOT_MODIFIED -> succeed(st, c, changed = false)
                code in 200..299 -> {
                    val body = readLimited(conn)
                    val text = String(body, Charsets.UTF_8).removePrefix("﻿")
                    val head = text.trimStart()
                    if (!head.startsWith("BEGIN:VCALENDAR", ignoreCase = true) ||
                        !text.contains("END:VCALENDAR", ignoreCase = true)
                    ) {
                        fail(st, c, "parse", "The link didn't return a calendar. It may be wrong or no longer valid.", code)
                        return
                    }
                    val trimmed = IcsTrimmer.trim(text, cutoffDate())
                    val hash = contentHash(trimmed.text)
                    val changed = hash != st.contentHash || !trimmedFile(c.id).isFile
                    if (changed) {
                        writeAtomically(rawFile(c.id), body)
                        writeAtomically(trimmedFile(c.id), trimmed.text.toByteArray(Charsets.UTF_8))
                    }
                    synchronized(states) {
                        st.etag = conn.getHeaderField("ETag")
                        st.lastModified = conn.getHeaderField("Last-Modified")
                        if (changed) {
                            st.events = trimmed.kept
                            st.bytes = body.size.toLong()
                            st.contentHash = hash
                            st.rev++
                        }
                    }
                    succeed(st, c, changed, detail = "${trimmed.kept} events kept, ${trimmed.dropped} past dropped")
                }
                else -> {
                    val reason = conn.responseMessage?.trim()?.takeIf { it.isNotEmpty() } ?: "error"
                    val hint = if (code == 404 || code == 403 || code == 410) " The link may have been reset or revoked." else ""
                    fail(st, c, "http", "Server returned HTTP $code ($reason).$hint", code)
                }
            }
        } catch (e: UnknownHostException) {
            fail(st, c, "network", "Can't reach the calendar server (no internet or DNS).", null)
        } catch (e: SocketTimeoutException) {
            fail(st, c, "network", "The calendar server timed out.", null)
        } catch (e: SSLException) {
            fail(st, c, "tls", "Secure connection failed (${e.javaClass.simpleName}).", null)
        } catch (e: IOException) {
            fail(st, c, "network", "Download failed (${e.javaClass.simpleName}).", null)
        } catch (e: IllegalArgumentException) {
            fail(st, c, "config", "The calendar link is not a valid web address.", null)
        } finally {
            conn?.disconnect()
        }
    }

    private fun succeed(st: FeedState, c: ConfigStore.CalendarMeta, changed: Boolean, detail: String = "") = synchronized(states) {
        st.status = "ok"
        st.errorKind = null
        st.error = null
        st.httpStatus = null
        st.failStreak = 0
        st.lastSuccessAt = System.currentTimeMillis()
        Log.i(TAG, "Calendar ${c.id} \"${c.name}\": ${if (changed) "updated (rev ${st.rev}) $detail" else "unchanged"}")
    }

    private fun fail(st: FeedState, c: ConfigStore.CalendarMeta, kind: String, message: String, http: Int?) = synchronized(states) {
        // The cached copy (if any) stays in place and keeps being served.
        st.status = "error"
        st.errorKind = kind
        st.error = message
        st.httpStatus = http
        if (online) st.failStreak++
        Log.w(TAG, "Calendar ${c.id} \"${c.name}\" sync failed [$kind]: $message")
        // Hiccups are tried again soon; the warning waits for the last retry (SPEC §13).
        if (online) WarningRules.retryDelayMs(kind, st.failStreak)?.let { delay ->
            Log.i(TAG, "Calendar ${c.id}: retry ${st.failStreak} of ${WarningRules.RETRY_DELAYS_MS.size} in ${delay / 1000} s")
            requestSync(minAgeMs = 30_000, onlyId = c.id, delayMs = delay)
        }
    }

    private fun readLimited(conn: HttpURLConnection): ByteArray {
        val out = ByteArrayOutputStream()
        conn.inputStream.use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > MAX_FEED_BYTES) throw IOException("Feed larger than ${MAX_FEED_BYTES / 1_000_000} MB")
            }
        }
        return out.toByteArray()
    }

    private fun contentHash(trimmed: String): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        for (line in IcsTrimmer.unfold(trimmed)) {
            if (line.startsWith("DTSTAMP", ignoreCase = true)) continue
            md.update(line.toByteArray(Charsets.UTF_8))
            md.update(10)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun cutoffDate(): String =
        SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(System.currentTimeMillis() - KEEP_PAST_DAYS * 86_400_000L))

    private fun writeAtomically(target: File, bytes: ByteArray) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(target)) throw IOException("Could not write ${target.name}")
    }

    private fun pruneRemoved() {
        val ids = config.calendars.map { it.id }.toSet()
        val gone = synchronized(states) { states.keys.filter { it !in ids } }
        for (id in gone) {
            synchronized(states) { states.remove(id) }
            trimmedFile(id).delete()
            rawFile(id).delete()
        }
        if (gone.isNotEmpty()) saveStates()
        // Newly added calendars sync right away.
        val fresh = config.calendars.filter { c -> c.enabled && synchronized(states) { states[c.id] } == null }
        for (c in fresh) syncOne(c)
        if (fresh.isNotEmpty()) saveStates()
    }

    private fun loadStates() {
        if (!stateFile.isFile) return
        try {
            val j = JSONObject(stateFile.readText())
            synchronized(states) { for (k in j.keys()) states[k] = FeedState.fromJson(j.getJSONObject(k)) }
        } catch (e: Exception) {
            Log.e(TAG, "calendar-state.json unreadable; feeds will resync", e)
        }
    }

    private fun saveStates() {
        val j = JSONObject()
        synchronized(states) { states.forEach { (k, v) -> j.put(k, v.toJson(includeValidators = true)) } }
        try {
            writeAtomically(stateFile, j.toString().toByteArray(Charsets.UTF_8))
        } catch (e: IOException) {
            Log.e(TAG, "Could not save calendar state", e)
        }
    }

    private companion object {
        const val MAX_FEED_BYTES = 25_000_000
        /** Past window kept for the UI (month view navigation, multi-day events). */
        const val KEEP_PAST_DAYS = 100
    }
}
