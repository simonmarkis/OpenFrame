package app.openframe

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Every Shut down / Restart press from the quick menu's Power chip (SPEC §18), kept across reboots in
 * `power-log.json` (user request 2026-10-19: a restart someone asked for should not look like a problem).
 * Each entry holds Android's boot count at the press, so the next start can tell it came right after it
 * (the clock is no help: the frame has no battery clock, and a shut-down frame may stay off for days).
 */
class PowerLog(dir: File) {
    private val file = File(dir, "power-log.json")

    /** Written before the command runs: a reboot that works never comes back to say so. */
    @Synchronized
    fun record(action: String, bootCount: Int?, result: String, now: Long = System.currentTimeMillis()) {
        try {
            val arr = list()
            arr.put(JSONObject().put("at", now).put("action", action).put("result", result)
                .put("bootCount", bootCount ?: JSONObject.NULL))
            val keep = JSONArray()
            for (i in maxOf(0, arr.length() - MAX) until arr.length()) keep.put(arr.get(i))
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(keep.toString())
            if (!tmp.renameTo(file)) Log.e(TAG, "Could not save the power log")
        } catch (e: Exception) {
            Log.e(TAG, "Could not record the ${action} press", e)
        }
    }

    @Synchronized
    fun list(): JSONArray = try {
        if (file.isFile) JSONArray(file.readText()) else JSONArray()
    } catch (e: Exception) {
        JSONArray()
    }

    /**
     * The latest press, and whether this start of the frame came right after a press (`startedAfter`): any
     * accepted one in the previous start counts, also when a slow reboot was reported as failed meanwhile.
     */
    fun summary(bootCount: Int?): JSONObject {
        val arr = list()
        val all = (0 until arr.length()).map { arr.getJSONObject(it) }
        return JSONObject()
            .put("last", all.lastOrNull() ?: JSONObject.NULL)
            .put("startedAfter", all.any { startedAfter(it, bootCount) })
    }

    companion object {
        private const val TAG = "OpenFrame"
        private const val MAX = 20

        /** This boot is the one right after [entry]'s press: it was accepted and one boot has happened since. */
        fun startedAfter(entry: JSONObject, bootCount: Int?): Boolean {
            if (bootCount == null || entry.optString("result") != "requested" || entry.isNull("bootCount")) return false
            return bootCount == entry.optInt("bootCount") + 1
        }
    }
}
