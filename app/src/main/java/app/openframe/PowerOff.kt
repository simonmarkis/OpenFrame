package app.openframe

import android.util.Log
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Shut down or restart the frame from the quick menu's Power chip (SPEC §18). The one approved use of
 * root (CLAUDE.md Safety rule 5): `su -c 'reboot -p'` or `su -c reboot`, nothing else. Android shuts down
 * cleanly either way (init's sys.powerctl), so open files are flushed.
 */
object PowerOff {
    private const val TAG = "OpenFrame"
    private const val SU = "/system/xbin/su"

    enum class Action(val command: String, val label: String) {
        SHUTDOWN("reboot -p", "Shut down"),
        RESTART("reboot", "Restart"),
    }

    fun parse(name: String?): Action? = when (name) {
        "shutdown" -> Action.SHUTDOWN
        "restart" -> Action.RESTART
        else -> null
    }

    /**
     * Runs [action]. On success the frame goes down within a few seconds and this call usually never
     * returns; it returns an error message when su is missing, refused, or the command failed.
     */
    fun run(action: Action): String? {
        if (!File(SU).canExecute()) {
            Log.e(TAG, "${action.label}: $SU is missing or not executable")
            return "This frame can't be shut down from OpenFrame (no root tool found)."
        }
        Log.i(TAG, "${action.label} requested from the quick menu")
        return try {
            val p = ProcessBuilder(SU, "-c", action.command).redirectErrorStream(true).start()
            if (!p.waitFor(15, TimeUnit.SECONDS)) {
                // reboot normally doesn't come back; if it hangs this long, something is wrong.
                Log.e(TAG, "${action.label}: '${action.command}' still running after 15 s")
                "The frame didn't respond. Try again, or use the power button on its back."
            } else if (p.exitValue() == 0) {
                null // accepted; Android is going down
            } else {
                val out = p.inputStream.bufferedReader().readText().trim().take(200)
                Log.e(TAG, "${action.label}: '${action.command}' exited ${p.exitValue()}: $out")
                "Couldn't ${action.label.lowercase()} the frame (code ${p.exitValue()})."
            }
        } catch (e: Exception) {
            Log.e(TAG, "${action.label}: couldn't run su", e)
            "Couldn't ${action.label.lowercase()} the frame: ${e.javaClass.simpleName}."
        }
    }
}
