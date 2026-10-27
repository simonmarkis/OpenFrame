package app.openframe

import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Gathers the current problems for [WarningRules] and serves them (`GET /api/warnings`, SPEC §13). */
class WarningCenter(private val app: OpenFrameApp) {

    private val dismissals = WarningDismissals(File(app.filesDir, "warnings-dismissed.json"))

    fun current(): List<WarningRules.Warning> {
        val feeds = app.config.calendars.map { c ->
            val st = app.calendarSync.state(c.id) ?: JSONObject()
            WarningRules.Feed(c.id, c.name, c.enabled, st.optString("status", "never_synced"),
                st.optString("errorKind").takeIf { it.isNotEmpty() && it != "null" },
                st.optString("error").takeIf { it.isNotEmpty() && it != "null" },
                st.optInt("failStreak"), st.optLong("lastSuccessAt"))
        }
        val w = app.weatherSync.json()
        val weather = WarningRules.Weather(w.optBoolean("configured"), w.optString("status"),
            w.optString("error").takeIf { it.isNotEmpty() && it != "null" }, w.optLong("lastSuccessAt"))
        val unshowable = app.mediaDb.unshowableCount() // hidden files don't count
        val free = runCatching { StatFs(Environment.getExternalStorageDirectory().path).availableBytes }.getOrNull()
        val sleepOn = app.config.sleep.schedules.any { it.enabled && it.days.isNotEmpty() }
        val homeLost = HomeApp.aliasEnabled(app) && HomeApp.current(app) == "chooser"
        val ip = SystemInfo.ipv4()
        val moved = app.shortcutFile.movedFrom(ip)?.let { WarningRules.Moved(it, ip!!, app.mdnsName.name) }
        val list = WarningRules.evaluate(WarningRules.Input(app.calendarSync.online, System.currentTimeMillis(),
            feeds, weather, unshowable, free,
            sleepNeedsAdmin = sleepOn && !app.power.adminActive, homeLost = homeLost,
            restartsToday = CrashGuard.count(app, null, 24 * 3600_000L), refusedUpload = app.uploadRefusals.current(), shortcutMoved = moved))
        dismissals.prune(list)
        return list
    }

    fun json(): JSONObject {
        val arr = JSONArray()
        for (x in current()) {
            arr.put(JSONObject()
                .put("id", x.id).put("kind", x.kind).put("title", x.title).put("detail", x.detail)
                .put("lastSuccessAt", x.lastSuccessAt)
                .put("popup", dismissals.shouldPopup(x)))
        }
        return JSONObject().put("online", app.calendarSync.online).put("warnings", arr)
    }

    /** @return false if there is no such warning (already cleared). */
    fun dismiss(id: String): Boolean {
        val w = current().firstOrNull { it.id == id } ?: return false
        dismissals.dismiss(w)
        return true
    }
}
