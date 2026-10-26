package app.openframe

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * HOME (SPEC §18). OpenFrame's home entry is the `.HomeActivity` alias, off by default: an enabled
 * HOME filter changes Android's set of home apps, which drops Frameo's "always" choice. It is switched
 * on from a computer with the user's approval:
 *   adb shell pm enable app.openframe/.HomeActivity
 *   adb shell cmd package set-home-activity app.openframe/.HomeActivity
 * Rollback: adb shell cmd package set-home-activity net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted
 */
object HomeApp {
    const val FRAMEO = "net.frameo.frame"

    fun alias(context: Context) = ComponentName(context.packageName, "app.openframe.HomeActivity")

    fun aliasEnabled(context: Context): Boolean =
        context.packageManager.getComponentEnabledSetting(alias(context)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    /** Which app Android opens as home: "openframe", "frameo", "chooser" (no default among several), a package, or "none". */
    fun current(context: Context): String {
        val ri = context.packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
        val pkg = ri?.activityInfo?.packageName
        return when (pkg) {
            null -> "none"
            context.packageName -> "openframe"
            FRAMEO -> "frameo"
            "android" -> "chooser" // ResolverActivity: Android will ask which home app to use
            else -> pkg
        }
    }

    /** Frameo installed and enabled. */
    fun frameoEnabled(context: Context): Boolean = try {
        context.packageManager.getApplicationInfo(FRAMEO, 0).enabled
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }
}

/**
 * After boot, when OpenFrame is the home app (or Android lost the choice after a crash and would ask),
 * make sure OpenFrame is on screen: Frameo starts itself at boot too. While Frameo is the home app
 * (before the switch, or after a rollback), this does nothing.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext
        val home = HomeApp.current(app)
        Log.i(TAG, "Boot completed; home app: $home")
        if (home != "openframe" && !(home == "chooser" && HomeApp.aliasEnabled(app))) return
        val handler = Handler(Looper.getMainLooper())
        for (delay in BRING_TO_FRONT_MS) {
            handler.postDelayed({
                app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }, delay)
        }
    }

    private companion object {
        /** Frameo's own boot start comes a few seconds after boot; check twice. */
        val BRING_TO_FRONT_MS = longArrayOf(15_000, 45_000)
    }
}
