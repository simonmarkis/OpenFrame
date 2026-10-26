package app.openframe

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.system.exitProcess

/**
 * Crash recovery (SPEC §18).
 *
 * - Java crash: logged, recorded in `restarts.json`, and OpenFrame restarts after a growing delay
 *   ([BACKOFF_MS]). The process ends itself instead of going through Android's crash handling, which
 *   would show "OpenFrame has stopped" and, for a home app that isn't a system app, reset the home app.
 * - Anything else that ends the process (a WebView renderer crash — the renderer runs inside this
 *   process on this frame —, the low-memory killer): a watchdog alarm, pushed back every
 *   [WATCHDOG_PERIOD_MS] while the UI is alive, brings it back within [WATCHDOG_MS]. As the home app,
 *   Android usually restarts it first.
 * - Only a running UI is brought back: an OpenFrame process without its screen (started at boot while
 *   Frameo is the home app) never pushes itself to the front.
 * - `am force-stop` cancels the alarms, so stopping OpenFrame on purpose (back to Frameo) still works.
 */
object CrashGuard {
    private const val ACTION_RESTART = "app.openframe.action.RESTART"
    const val WATCHDOG_MS = 90_000L
    private const val WATCHDOG_PERIOD_MS = 30_000L
    private val BACKOFF_MS = longArrayOf(3_000, 10_000, 30_000, 120_000, 300_000)
    private const val BACKOFF_WINDOW_MS = 15 * 60_000L
    private const val LOG_MAX = 30
    /** After boot, the home app starting is normal; later, a home start means the app had ended. */
    private const val BOOT_GRACE_MS = 5 * 60_000L
    private const val UPDATE_GRACE_MS = 2 * 60_000L
    private val LINK = Regex("""(?i)\b(https?|webcal)://\S+""")

    /** MainActivity exists in this process: OpenFrame is the frame's screen. */
    @Volatile var uiAlive = false
        private set

    private val handler = Handler(Looper.getMainLooper())
    private var watchdog: Runnable? = null
    private var uiStartedInProcess = false

    fun install(context: Context) {
        val app = context.applicationContext
        val android = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            try {
                Log.e(TAG, "Uncaught exception on ${thread.name}; restarting OpenFrame", e)
                // Shown in Settings → System: never a calendar link (secret) that an exception message might carry.
                val message = (e.message ?: "").replace(LINK, "<link>")
                record(app, "crash", "${e.javaClass.simpleName}: $message".take(200))
                if (uiAlive) {
                    val recent = count(app, "crash", BACKOFF_WINDOW_MS)
                    val delay = BACKOFF_MS[(recent - 1).coerceIn(0, BACKOFF_MS.size - 1)]
                    Log.i(TAG, "Restarting in ${delay / 1000} s ($recent crashes in 15 min)")
                    scheduleRestart(app, delay, "crash")
                }
            } catch (t: Throwable) {
                android?.uncaughtException(thread, e) // recovery itself failed: let Android handle it
                return@setDefaultUncaughtExceptionHandler
            }
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
    }

    /**
     * MainActivity created (main thread): start the watchdog, and note an unexpected end that Android
     * itself recovered: the first UI of a fresh process either [restored] from saved state (Android
     * relaunches the top activity of a process that died) or launched as home well after boot.
     */
    fun onUiStarted(context: Context, intent: Intent?, restored: Boolean) {
        val app = context.applicationContext
        uiAlive = true
        watchdog?.let { handler.removeCallbacks(it) }
        watchdog = object : Runnable {
            override fun run() {
                scheduleRestart(app, WATCHDOG_MS, "watchdog")
                handler.postDelayed(this, WATCHDOG_PERIOD_MS)
            }
        }.also { it.run() }

        val firstInProcess = !uiStartedInProcess
        uiStartedInProcess = true
        val home = intent?.hasCategory(Intent.CATEGORY_HOME) == true && SystemClock.elapsedRealtime() >= BOOT_GRACE_MS
        if (!firstInProcess || !(restored || home)) return
        val now = System.currentTimeMillis()
        // An update (deploy) ends the old process too: not a problem.
        val updatedAt = runCatching { app.packageManager.getPackageInfo(app.packageName, 0).lastUpdateTime }.getOrDefault(0L)
        if (now - updatedAt < UPDATE_GRACE_MS) return
        val last = list(app).let { if (it.length() > 0) it.optJSONObject(it.length() - 1) else null }
        // A Java crash was already recorded by the handler moments ago.
        if (last != null && now - last.optLong("at") < 60_000) return
        record(app, "stopped", "OpenFrame stopped unexpectedly (WebView crash or low memory); Android restarted it")
    }

    /** MainActivity destroyed (main thread): nothing to bring back. */
    fun onUiStopped(context: Context) {
        uiAlive = false
        watchdog?.let { handler.removeCallbacks(it) }
        watchdog = null
        context.getSystemService(AlarmManager::class.java).cancel(restartIntent(context.applicationContext, "watchdog"))
    }

    private fun restartIntent(context: Context, reason: String): PendingIntent {
        val i = Intent(context, RestartReceiver::class.java).setAction(ACTION_RESTART).putExtra("reason", reason)
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun scheduleRestart(context: Context, delayMs: Long, reason: String) {
        context.getSystemService(AlarmManager::class.java).setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs, restartIntent(context, reason))
    }

    // ---- restart log (app-private restarts.json) ----

    private fun file(context: Context) = File(context.filesDir, "restarts.json")

    @Synchronized
    fun record(context: Context, kind: String, detail: String) {
        try {
            val arr = list(context)
            arr.put(JSONObject().put("at", System.currentTimeMillis()).put("kind", kind).put("detail", detail))
            val keep = JSONArray()
            for (i in maxOf(0, arr.length() - LOG_MAX) until arr.length()) keep.put(arr.get(i))
            val f = file(context)
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(keep.toString())
            tmp.renameTo(f)
        } catch (e: Exception) {
            Log.e(TAG, "Could not record the restart", e)
        }
    }

    @Synchronized
    fun list(context: Context): JSONArray = try {
        val f = file(context)
        if (f.isFile) JSONArray(f.readText()) else JSONArray()
    } catch (e: Exception) {
        JSONArray()
    }

    /** Restarts in the last [withinMs] (all kinds when [kind] is null). */
    fun count(context: Context, kind: String?, withinMs: Long): Int {
        val since = System.currentTimeMillis() - withinMs
        val arr = list(context)
        return (0 until arr.length()).map { arr.getJSONObject(it) }
            .count { it.optLong("at") >= since && (kind == null || it.optString("kind") == kind) }
    }
}

/** Fired by [CrashGuard]'s alarm: shows the UI again if the app had ended. */
class RestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reason = intent.getStringExtra("reason") ?: "watchdog"
        if (CrashGuard.uiAlive) {
            // The watchdog wasn't pushed back in time although the app is running: the main thread was stuck.
            Log.w(TAG, "Restart alarm ($reason) fired while OpenFrame is running")
            return
        }
        if (reason == "watchdog") {
            CrashGuard.record(context, "stopped", "OpenFrame stopped unexpectedly (WebView crash or low memory)")
        }
        Log.i(TAG, "Showing OpenFrame again ($reason)")
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
