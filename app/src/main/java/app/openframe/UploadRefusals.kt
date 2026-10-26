package app.openframe

import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * The last upload the frame turned away (SPEC §13, §17; user request 2026-10-19: an HDR video from the
 * Shortcut was refused and nobody on the frame saw why). Kept in `upload-refused.json` until the next
 * upload that works ([clear]), so the warning survives restarts. Only what and why, never names or places.
 */
class UploadRefusals(dir: File) {
    private val file = File(dir, "upload-refused.json")

    @Synchronized
    fun record(what: String, reason: String, now: Long = System.currentTimeMillis()) {
        try {
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(JSONObject().put("at", now).put("what", what).put("reason", reason.take(300)).toString())
            if (!tmp.renameTo(file)) Log.e(TAG, "Could not save the refused upload")
        } catch (e: Exception) {
            Log.e(TAG, "Could not record the refused upload", e)
        }
    }

    @Synchronized
    fun clear() {
        if (file.isFile && !file.delete()) Log.e(TAG, "Could not clear the refused upload")
    }

    @Synchronized
    fun current(): WarningRules.Refused? = try {
        if (!file.isFile) null else JSONObject(file.readText()).let {
            WarningRules.Refused(it.getLong("at"), it.optString("what", "file"), it.optString("reason"))
        }
    } catch (e: Exception) {
        null // a damaged file only loses the warning
    }
}
