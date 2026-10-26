package app.openframe

import android.app.ActivityManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Debug
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.TimeZone

/** Read-only facts for Settings → System (`GET /api/system`). */
object SystemInfo {

    fun json(app: OpenFrameApp, uiSource: String): JSONObject {
        val pkg = app.packageManager.getPackageInfo(app.packageName, 0)
        val am = app.getSystemService(ActivityManager::class.java)
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val pss = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }.totalPss // KB, includes the WebView (single-process)

        return JSONObject()
            .put("version", pkg.versionName)
            .put("uiSource", uiSource)
            .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("android", Build.VERSION.RELEASE)
            .put("timeZone", TimeZone.getDefault().id)
            .put("uptimeMs", SystemClock.elapsedRealtime())
            .put("memory", JSONObject()
                .put("appPssKb", pss)
                .put("availableBytes", mem.availMem)
                .put("totalBytes", mem.totalMem))
            .put("storage", JSONObject()
                .put("internal", space(Environment.getExternalStorageDirectory()))
                .put("app", space(app.filesDir)))
            .put("network", network(app))
            .put("checks", checks(app))
            .put("restarts", restarts(app))
            .put("power", PowerLog(app.filesDir).summary(bootCount(app)))
    }

    /** Android's count of starts (Settings.Global.BOOT_COUNT); null if it isn't kept. */
    fun bootCount(app: OpenFrameApp): Int? =
        runCatching { Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()

    /** Frame set-up (SPEC §18): what should be in place before the user turns Frameo off. */
    private fun checks(app: OpenFrameApp): JSONObject {
        val cr = app.contentResolver
        return JSONObject()
            .put("home", HomeApp.current(app))
            .put("homeEntry", HomeApp.aliasEnabled(app))
            .put("frameoEnabled", HomeApp.frameoEnabled(app))
            .put("sleepAdmin", app.power.adminActive)
            .put("brightnessPermission", app.power.canWriteBrightness)
            .put("returnButton", app.overlay.allowed)
            .put("autoRotate", Settings.System.getInt(cr, Settings.System.ACCELEROMETER_ROTATION, 0) == 1)
            .put("autoTime", Settings.Global.getInt(cr, Settings.Global.AUTO_TIME, 0) == 1)
            .put("usbDebugging", usbDebugging(app))
            .put("usbDebuggingCanChange", canChangeUsbDebugging(app))
    }

    // ---- USB debugging (Settings → System, like Frameo) ----

    fun usbDebugging(app: OpenFrameApp) = Settings.Global.getInt(app.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1

    fun canChangeUsbDebugging(app: OpenFrameApp) =
        app.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** @return false without the permission. Turning it off ends any computer's adb connection. */
    fun setUsbDebugging(app: OpenFrameApp, on: Boolean): Boolean {
        if (!canChangeUsbDebugging(app)) return false
        android.util.Log.i(TAG, "USB debugging turned ${if (on) "on" else "off"} from settings")
        return Settings.Global.putInt(app.contentResolver, Settings.Global.ADB_ENABLED, if (on) 1 else 0)
    }

    /** Restarts after a problem (CrashGuard): count this week and the latest. */
    private fun restarts(app: OpenFrameApp): JSONObject {
        val all = CrashGuard.list(app)
        return JSONObject()
            .put("lastWeek", CrashGuard.count(app, null, 7 * 86_400_000L))
            .put("last", if (all.length() > 0) all.getJSONObject(all.length() - 1) else JSONObject.NULL)
    }

    private fun space(dir: File): JSONObject = try {
        val s = StatFs(dir.path)
        JSONObject().put("freeBytes", s.availableBytes).put("totalBytes", s.totalBytes)
    } catch (e: IllegalArgumentException) {
        JSONObject()
    }

    fun network(app: OpenFrameApp): JSONObject {
        val out = JSONObject().put("online", app.calendarSync.online)
        out.put("ip", ipv4() ?: JSONObject.NULL)
        val wifi = app.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val info = runCatching { wifi?.connectionInfo }.getOrNull()
        // Android may hide the network name ("<unknown ssid>"); show nothing rather than that.
        val ssid = info?.ssid?.trim('"')?.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
        out.put("wifiName", ssid ?: JSONObject.NULL)
        out.put("wifiSignal", info?.takeIf { it.networkId != -1 }?.let { WifiManager.calculateSignalLevel(it.rssi, 5) }
            ?: JSONObject.NULL)
        return out
    }

    /** The frame's address on the LAN, if it has one. */
    fun ipv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
    }.getOrNull()
}
