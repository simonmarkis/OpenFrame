package app.openframe

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Snapshot restore and config export/import (SPEC §16).
 *
 * Calendars need care because their links are secrets that live outside the config:
 * - Restore and import never remove calendars. Calendars that still exist get the saved name,
 *   color, and switches; ones that no longer exist come back only if the file carries their link.
 * - Export leaves the links out unless the user opts in (`secrets=1`).
 */
class ConfigBackup(private val app: OpenFrameApp) {

    fun export(includeSecrets: Boolean): JSONObject {
        val out = JSONObject()
            .put("format", FORMAT)
            .put("version", 1)
            .put("exportedAt", System.currentTimeMillis())
            .put("appVersion", app.packageManager.getPackageInfo(app.packageName, 0).versionName)
            .put("config", app.config.json())
        if (includeSecrets) {
            out.put("secrets", JSONObject().put("calendarUrls", JSONObject(app.secrets.calendarUrls())))
        }
        return out
    }

    /** @throws IllegalArgumentException with a user-readable message. */
    fun restore(id: Long): JSONObject {
        val snap = app.config.snapshot(id) ?: throw IllegalArgumentException("That snapshot no longer exists")
        val summary = apply(snap, emptyMap())
        Log.i(TAG, "Config restored from snapshot $id")
        return summary
    }

    /** @throws IllegalArgumentException with a user-readable message. */
    fun import(file: JSONObject): JSONObject {
        if (file.optString("format") != FORMAT) {
            throw IllegalArgumentException("This isn't an OpenFrame settings file")
        }
        val config = file.optJSONObject("config") ?: throw IllegalArgumentException("The file has no settings in it")
        val urls = HashMap<String, String>()
        file.optJSONObject("secrets")?.optJSONObject("calendarUrls")?.let { u ->
            for (k in u.keys()) {
                val url = normalizeFeedUrl(u.optString(k), isDebuggable(app)) ?: continue
                if (ConfigStore.CALENDAR_ID.matches(k)) urls[k] = url
            }
        }
        val summary = apply(config, urls)
        Log.i(TAG, "Config imported (${summary.optInt("calendarsAdded")} calendars added, " +
            "${summary.optJSONArray("calendarsSkipped")?.length() ?: 0} skipped)")
        return summary
    }

    private fun apply(source: JSONObject, urls: Map<String, String>): JSONObject {
        val result = app.config.calendars.toMutableList()
        var updated = 0
        var added = 0
        val skipped = JSONArray()
        val newLinks = ArrayList<String>()
        val saved = source.optJSONArray("calendars") ?: JSONArray()
        for (i in 0 until saved.length()) {
            val c = saved.optJSONObject(i) ?: continue
            val id = c.optString("id")
            val meta = runCatching {
                require(ConfigStore.CALENDAR_ID.matches(id))
                ConfigStore.validateCalendar(ConfigStore.CalendarMeta(id, c.optString("name"),
                    c.optString("color"), c.optBoolean("enabled", true), c.optBoolean("busy", false),
                    c.optString("email")).withReminders(c.optJSONObject("reminders")))
            }.getOrNull()
            if (meta == null) {
                skipped.put(c.optString("name").ifEmpty { "(unnamed)" })
                continue
            }
            val idx = result.indexOfFirst { it.id == id }
            when {
                idx >= 0 -> { result[idx] = meta; updated++ }
                urls.containsKey(id) -> { result += meta; added++ }
                else -> { skipped.put(meta.name); continue }
            }
            if (urls.containsKey(id)) newLinks += id
        }

        // Validate everything before touching secrets: an invalid file changes nothing.
        app.config.validateReplacement(source, result)
        for (id in newLinks) app.secrets.setCalendarUrl(id, urls.getValue(id))
        app.config.replaceAll(source, result)
        for (id in newLinks) {
            app.calendarSync.resetValidators(id)
            app.calendarSync.requestSync(minAgeMs = 0, onlyId = id)
        }
        return JSONObject()
            .put("ok", true)
            .put("calendarsUpdated", updated)
            .put("calendarsAdded", added)
            .put("calendarsSkipped", skipped)
    }

    companion object {
        const val FORMAT = "openframe-config"

        fun isDebuggable(app: OpenFrameApp): Boolean =
            app.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0

        /** https:// (webcal:// is turned into https://) or, in debug builds, the local dev feeds. */
        fun normalizeFeedUrl(raw: String, debuggable: Boolean): String? {
            var url = raw.trim()
            if (url.startsWith("webcal://", ignoreCase = true)) url = "https://" + url.substring("webcal://".length)
            if (url.length > 4096) return null
            val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase()
            // Plain http only for the debug-build dev feeds on this device.
            val allowHttp = debuggable && uri.host == "127.0.0.1"
            if (scheme != "https" && !(scheme == "http" && allowHttp)) return null
            if (uri.host.isNullOrEmpty()) return null
            return url
        }
    }
}
