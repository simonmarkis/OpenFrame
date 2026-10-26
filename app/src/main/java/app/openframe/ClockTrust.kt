package app.openframe

import android.content.Context
import android.util.Log

/**
 * Whether the frame's wall clock can be believed (SPEC §18). The frame has no battery-backed clock: after a
 * reboot it says July 28 (2024) until network time arrives (~30 s with Wi-Fi). A time before this app's last
 * install (done while the clock was right) or before the latest time seen as right is wrong; the UI then
 * shows "--" instead of a wrong time, date, weather day, or calendar (user request 2026-10-16).
 */
object ClockTrust {
    private const val SLACK_MS = 10 * 60_000L
    private const val SAVE_EVERY_MS = 10 * 60_000L
    @Volatile private var lastOk: Boolean? = null

    /** [now] is believable: not (more than a few minutes) before the latest time known to be right. */
    fun trusted(now: Long, lastGood: Long, installed: Long): Boolean = now >= maxOf(lastGood, installed) - SLACK_MS

    fun ok(context: Context): Boolean {
        val now = System.currentTimeMillis()
        val prefs = context.getSharedPreferences("clock", Context.MODE_PRIVATE)
        val lastGood = prefs.getLong("lastGood", 0L)
        val installed = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime }.getOrDefault(0L)
        val ok = trusted(now, lastGood, installed)
        if (ok && now - lastGood >= SAVE_EVERY_MS) prefs.edit().putLong("lastGood", now).apply()
        if (lastOk != ok) {
            lastOk = ok
            Log.i(TAG, if (ok) "Clock looks right" else "Clock not set yet (before ${maxOf(lastGood, installed)}): showing --")
        }
        return ok
    }
}
