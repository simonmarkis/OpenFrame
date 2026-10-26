package app.openframe

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Secrets (calendar feed URLs, later API keys) in app-private `secrets.json` (SPEC §16).
 * Values are never logged, never returned by the API, and excluded from config export by default.
 */
class SecretsStore(context: Context) {

    private val file = File(context.filesDir, "secrets.json")
    private val lock = Any()
    private var data: JSONObject = load()

    fun calendarUrl(id: String): String? = synchronized(lock) {
        data.optJSONObject(CALENDAR_URLS)?.optString(id)?.takeIf { it.isNotEmpty() }
    }

    /** All calendar URLs by calendar id (for an export the user opted into). */
    fun calendarUrls(): Map<String, String> = synchronized(lock) {
        val urls = data.optJSONObject(CALENDAR_URLS) ?: return@synchronized emptyMap()
        urls.keys().asSequence().associateWith { urls.optString(it) }.filterValues { it.isNotEmpty() }
    }

    fun setCalendarUrl(id: String, url: String?) = synchronized(lock) {
        val next = JSONObject(data.toString())
        val urls = next.optJSONObject(CALENDAR_URLS) ?: JSONObject().also { next.put(CALENDAR_URLS, it) }
        if (url == null) urls.remove(id) else urls.put(id, url)
        save(next)
        data = next
    }

    /** Other secrets by name (web PIN, session key). */
    fun get(key: String): String? = synchronized(lock) { data.optString(key).takeIf { it.isNotEmpty() } }

    fun put(values: Map<String, String?>) = synchronized(lock) {
        val next = JSONObject(data.toString())
        for ((k, v) in values) if (v == null) next.remove(k) else next.put(k, v)
        save(next)
        data = next
    }

    private fun load(): JSONObject = try {
        if (file.isFile) JSONObject(file.readText()) else JSONObject()
    } catch (e: Exception) {
        // Contents are secret: log only the failure type.
        Log.e(TAG, "secrets.json unreadable (${e.javaClass.simpleName}); starting empty")
        file.renameTo(File(file.parentFile, "secrets.invalid-${System.currentTimeMillis()}.json"))
        JSONObject()
    }

    private fun save(json: JSONObject) {
        val tmp = File(file.parentFile, "secrets.json.tmp")
        tmp.writeText(json.toString())
        if (!tmp.renameTo(file)) throw IllegalStateException("Could not save secrets.json")
    }

    private companion object {
        const val CALENDAR_URLS = "calendarUrls"
    }
}
