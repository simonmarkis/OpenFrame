package app.openframe

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Sleep, wake, and brightness (SPEC §18). Runs on the main thread.
 *
 * - Sleep is real Android sleep (screen off) through device admin `lockNow()`; a swipe wakes the
 *   screen, a tap doesn't. The admin is activated from a computer, with the user's approval.
 * - Schedules ([SleepSchedule]): at sleep time the frame sleeps, unless someone touched it within the
 *   "sleep again after" time; woken during sleep hours, it sleeps again after that long without a touch
 *   (user decision 2026-10-13). At wake time it turns the screen on.
 * - Manual sleep (quick menu, `POST /api/power/sleep`) lasts until the next scheduled wake-up or a swipe.
 * - While the screen is off, a partial wake lock keeps the CPU up: the frame is mains-powered, and the
 *   HTTP server (uploads), calendar sync, and later Home Assistant must keep working at night.
 * - Brightness: Android's system setting, like Frameo (needs WRITE_SETTINGS, granted with adb).
 * - At 3:30 AM, if the screen is off, the UI reloads, so each day starts with a fresh page.
 * - Schedules act only while OpenFrame's UI is running ([CrashGuard.uiAlive]): a background OpenFrame
 *   process (started at boot while Frameo is the home app) leaves the screen alone.
 */
class PowerController(private val app: OpenFrameApp) {

    private val pm = app.getSystemService(PowerManager::class.java)
    private val dpm = app.getSystemService(DevicePolicyManager::class.java)
    private val alarms = app.getSystemService(AlarmManager::class.java)
    private val admin = ComponentName(app, SleepAdminReceiver::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val asleepLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenFrame:asleep")
        .apply { setReferenceCounted(false) }

    @Volatile private var manualSleep = false
    @Volatile private var lastTouchAt = SystemClock.elapsedRealtime()
    /** Start of the sleep window already acted on, so each window's start is handled once. */
    private var handledWindowStart = 0L
    private var brightnessWarned = false

    val adminActive: Boolean get() = dpm.isAdminActive(admin)
    val canWriteBrightness: Boolean get() = Settings.System.canWrite(app)

    fun start() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        app.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    Intent.ACTION_SCREEN_ON -> onScreenOn()
                    Intent.ACTION_SCREEN_OFF -> onScreenOff()
                    else -> { evaluate(); scheduleNightly() }
                }
            }
        }, filter)
        app.config.addListener { handler.post { applyBrightness(); evaluate() } }
        applyBrightness()
        updateAsleepLock()
        evaluate()
        scheduleNightly()
        Log.i(TAG, "Power: device admin ${if (adminActive) "active" else "not active"}, " +
            "brightness permission ${if (canWriteBrightness) "granted" else "not granted"}")
    }

    /** A touch on the frame (MainActivity, the return button's screen). Main thread. */
    fun onUserActivity() {
        lastTouchAt = SystemClock.elapsedRealtime()
    }

    /** MainActivity created: the schedule applies from now on. */
    fun onUiStarted() {
        handler.post {
            updateAsleepLock()
            evaluate()
        }
    }

    // ---- requests (any thread) ----

    /** Manual sleep. @return false if sleep isn't set up (no device admin). */
    fun sleepNow(): Boolean {
        if (!adminActive) return false
        handler.post {
            manualSleep = true
            currentWindow()?.let { handledWindowStart = it.start }
            goToSleep("manual")
        }
        return true
    }

    fun wakeNow() {
        handler.post {
            manualSleep = false
            wakeScreen("request")
        }
    }

    /** Turns sleep off (Settings → Display and sleep); it comes back only by activating it from a computer. */
    fun removeAdmin() {
        if (adminActive) {
            dpm.removeActiveAdmin(admin)
            Log.i(TAG, "Device admin removal requested from settings")
        }
    }

    fun onAlarm(intent: Intent) {
        when (intent.action) {
            ACTION_SCHEDULE -> {
                if (intent.getStringExtra(EXTRA_KIND) == "wake") {
                    manualSleep = false
                    if (CrashGuard.uiAlive) {
                        if (!pm.isInteractive) wakeScreen("schedule")
                        // Frameo's own schedule (while installed) wakes the frame at the same moment and
                        // puts its slideshow on top: bring OpenFrame forward now and once more shortly after.
                        bringToFront()
                        handler.postDelayed({ bringToFront() }, REFRONT_MS)
                    }
                }
                evaluate()
            }
            ACTION_NIGHTLY -> nightly()
        }
    }

    // ---- state ----

    private fun zone(): ZoneId = ZoneId.systemDefault()

    private fun currentWindow() = SleepSchedule.windowAt(app.config.sleep.schedules, System.currentTimeMillis(), zone())

    private fun idleMs() = SystemClock.elapsedRealtime() - lastTouchAt

    private fun wokenTimeoutMs() = app.config.sleep.wokenTimeoutMin * 60_000L

    /** Applies the schedule now (alarm, config or time change, start) and sets the next alarm. */
    private fun evaluate() {
        val now = System.currentTimeMillis()
        val schedules = app.config.sleep.schedules
        scheduleNext(now, schedules)
        val window = SleepSchedule.windowAt(schedules, now, zone())
        if (!CrashGuard.uiAlive || window == null) {
            handler.removeCallbacks(idleCheck)
        } else if (window.start != handledWindowStart) {
            handledWindowStart = window.start
            if (pm.isInteractive) {
                // Sleep time. Sleep now, unless someone is using the frame or the window began before this
                // check (app restarted, schedule just changed): then as if woken, sleep after no touch.
                if (now - window.start < ON_TIME_MS && idleMs() >= wokenTimeoutMs()) goToSleep("schedule")
                else armIdleCheck()
            }
        } else if (pm.isInteractive) {
            armIdleCheck()
        }
    }

    private val idleCheck = Runnable {
        if (!CrashGuard.uiAlive || !pm.isInteractive || currentWindow() == null) return@Runnable
        if (idleMs() >= wokenTimeoutMs()) goToSleep("no touch during sleep hours") else armIdleCheck()
    }

    private fun armIdleCheck() {
        handler.removeCallbacks(idleCheck)
        handler.postDelayed(idleCheck, maxOf(wokenTimeoutMs() - idleMs(), 1_000L))
    }

    /** CPU stays up while the screen is off, but only while OpenFrame is the frame's screen. */
    private fun updateAsleepLock() {
        if (!pm.isInteractive && CrashGuard.uiAlive) asleepLock.acquire()
        else if (asleepLock.isHeld) asleepLock.release()
    }

    private fun onScreenOff() {
        updateAsleepLock()
        handler.removeCallbacks(idleCheck)
        Log.i(TAG, "Screen off (manual sleep: $manualSleep)")
    }

    private fun onScreenOn() {
        updateAsleepLock()
        lastTouchAt = SystemClock.elapsedRealtime() // the swipe that woke it
        val window = currentWindow()
        manualSleep = false // woken by a swipe (or at the wake time): manual sleep is over
        if (window != null && CrashGuard.uiAlive) {
            handledWindowStart = window.start
            armIdleCheck() // woken during sleep hours
        }
        Log.i(TAG, "Screen on${if (window != null) " during sleep hours" else ""}")
    }

    private fun goToSleep(reason: String): Boolean {
        if (!adminActive) {
            Log.w(TAG, "Can't sleep ($reason): device admin is not active")
            return false
        }
        return try {
            Log.i(TAG, "Going to sleep ($reason)")
            dpm.lockNow()
            true
        } catch (e: SecurityException) {
            Log.e(TAG, "Sleep failed ($reason)", e)
            false
        }
    }

    @Suppress("DEPRECATION") // the documented way to turn the screen on from an alarm on API 27
    private fun wakeScreen(reason: String) {
        Log.i(TAG, "Waking the screen ($reason)")
        pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or
            PowerManager.ON_AFTER_RELEASE, "OpenFrame:wake").acquire(WAKE_HOLD_MS)
        // OpenFrame's window keeps the screen on from here.
    }

    /** OpenFrame in front (only while its UI exists: never over Frameo as the chosen home app). */
    private fun bringToFront() {
        if (CrashGuard.uiAlive) {
            app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    // ---- alarms ----

    private fun pending(action: String, kind: String? = null): PendingIntent {
        val i = Intent(app, PowerAlarmReceiver::class.java).setAction(action)
        if (kind != null) i.putExtra(EXTRA_KIND, kind)
        return PendingIntent.getBroadcast(app, 0, i, PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun scheduleNext(now: Long, schedules: List<SleepSchedule.Entry>) {
        val next = SleepSchedule.nextChange(schedules, now, zone())
        if (next == null) {
            alarms.cancel(pending(ACTION_SCHEDULE))
            return
        }
        // A boundary after which it's waking time is a wake-up.
        val kind = if (SleepSchedule.windowAt(schedules, next, zone()) == null) "wake" else "sleep"
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next + ALARM_SLACK_MS, pending(ACTION_SCHEDULE, kind))
    }

    private fun scheduleNightly() {
        val now = ZonedDateTime.now(zone())
        var at = now.toLocalDate().atTime(NIGHTLY_RELOAD).atZone(zone())
        if (!at.isAfter(now)) at = now.toLocalDate().plusDays(1).atTime(NIGHTLY_RELOAD).atZone(zone())
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.toInstant().toEpochMilli(), pending(ACTION_NIGHTLY))
    }

    private fun nightly() {
        scheduleNightly()
        if (pm.isInteractive) {
            Log.i(TAG, "Nightly UI reload skipped: the screen is on")
            return
        }
        val reload = app.server.onReloadRequested ?: return
        Log.i(TAG, "Nightly UI reload")
        reload()
    }

    // ---- brightness ----

    private fun applyBrightness() {
        val pct = app.config.display.brightness ?: return
        if (!canWriteBrightness) {
            if (!brightnessWarned) Log.w(TAG, "Brightness $pct% not applied: WRITE_SETTINGS not granted")
            brightnessWarned = true
            return
        }
        brightnessWarned = false
        val level = levelFor(pct)
        try {
            val cr = app.contentResolver
            if (Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, -1) != level) {
                Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, level)
                Log.i(TAG, "Brightness set to $pct% ($level/255)")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Brightness not applied", e)
        }
    }

    private fun systemBrightnessPercent(): Int? =
        Settings.System.getInt(app.contentResolver, Settings.System.SCREEN_BRIGHTNESS, -1)
            .takeIf { it >= 0 }?.let { (it * 100 + 127) / 255 }

    /** `GET /api/power` */
    fun json(): JSONObject {
        val now = System.currentTimeMillis()
        val schedules = app.config.sleep.schedules
        val z = zone()
        return JSONObject()
            .put("adminActive", adminActive)
            .put("screenOn", pm.isInteractive)
            .put("manualSleep", manualSleep)
            .put("inSleepWindow", SleepSchedule.windowAt(schedules, now, z) != null)
            .put("nextSleepAt", SleepSchedule.nextSleep(schedules, now, z) ?: JSONObject.NULL)
            .put("nextWakeAt", SleepSchedule.nextWake(schedules, now, z) ?: JSONObject.NULL)
            .put("brightness", JSONObject()
                .put("canWrite", canWriteBrightness)
                .put("systemPercent", systemBrightnessPercent() ?: JSONObject.NULL))
    }

    companion object {
        const val ACTION_SCHEDULE = "app.openframe.action.SLEEP_SCHEDULE"
        const val ACTION_NIGHTLY = "app.openframe.action.NIGHTLY"
        private const val EXTRA_KIND = "kind"
        /** A window's alarm that fires within this of its start counts as on time. */
        private const val ON_TIME_MS = 60_000L
        private const val ALARM_SLACK_MS = 500L
        private const val WAKE_HOLD_MS = 5_000L
        private const val REFRONT_MS = 15_000L
        private val NIGHTLY_RELOAD: LocalTime = LocalTime.of(3, 30)

        /** Percent of the system scale → Android's 0–255 brightness level. */
        fun levelFor(percent: Int) = (percent * 255 + 50) / 100
    }
}

/** Sleep and wake alarms (scheduled by [PowerController]). */
class PowerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        (context.applicationContext as OpenFrameApp).power.onAlarm(intent)
    }
}

/** Device admin with the one policy sleep needs (`force-lock`, i.e. `lockNow()`); SPEC §18. */
class SleepAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin activated: sleep is available")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin removed: sleep is unavailable")
    }
}
