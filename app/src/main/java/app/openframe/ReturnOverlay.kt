package app.openframe

import android.app.ActivityManager
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.TextView

/**
 * "Back to OpenFrame" button over Android's own screens (SPEC §19). The frame has no Back or Home
 * (SystemUI is disabled from the factory), so an Android screen opens only under this floating button.
 * Needs SYSTEM_ALERT_WINDOW (`adb shell appops set app.openframe SYSTEM_ALERT_WINDOW allow`, with the
 * user's approval). Without a touch for the inactivity time, it returns by itself.
 */
class ReturnOverlay(private val app: OpenFrameApp) {

    private val wm = app.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var button: View? = null
    private var lastTouchAt = 0L

    val allowed: Boolean get() = Settings.canDrawOverlays(app)

    /** Opens an Android screen (a key of [SCREENS]) under the button. @return false if not allowed. */
    fun open(screen: String): Boolean {
        val action = SCREENS[screen] ?: return false
        if (!allowed) return false
        handler.post {
            show()
            try {
                app.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                Log.i(TAG, "Opened Android screen \"$screen\" with the return button")
            } catch (e: Exception) {
                Log.e(TAG, "Could not open Android screen \"$screen\"", e)
                hide()
            }
        }
        return true
    }

    /** OpenFrame is in front again (MainActivity.onResume). Main thread. */
    fun hide() {
        handler.removeCallbacks(idleCheck)
        val b = button ?: return
        button = null
        try {
            wm.removeView(b)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Return button was already gone")
        }
    }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, app.resources.displayMetrics)

    private fun show() {
        lastTouchAt = SystemClock.elapsedRealtime()
        if (button != null) return
        val b = TextView(app).apply {
            text = "‹  Back to OpenFrame"
            setTextColor(0xFFFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_DIP, 24f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(32f).toInt(), dp(18f).toInt(), dp(32f).toInt(), dp(18f).toInt())
            background = GradientDrawable().apply {
                cornerRadius = dp(40f)
                setColor(0xF01A73E8.toInt())
            }
            elevation = dp(8f)
            setOnClickListener { returnToApp("button") }
            // Touches anywhere else on the Android screen arrive as ACTION_OUTSIDE (without coordinates):
            // enough to know someone is still using it.
            setOnTouchListener { _, e ->
                if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) {
                    lastTouchAt = SystemClock.elapsedRealtime()
                    app.power.onUserActivity()
                }
                false
            }
        }
        val lp = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(28f).toInt()
        }
        wm.addView(b, lp)
        button = b
        handler.postDelayed(idleCheck, IDLE_CHECK_MS)
    }

    private val idleCheck = object : Runnable {
        override fun run() {
            if (button == null) return
            val timeout = app.config.layout.inactivityReturnSec * 1000L
            val idle = SystemClock.elapsedRealtime() - lastTouchAt
            if (idle >= timeout) returnToApp("no touch for ${timeout / 1000} s")
            else handler.postDelayed(this, minOf(timeout - idle, IDLE_CHECK_MS))
        }
    }

    private fun returnToApp(reason: String) {
        Log.i(TAG, "Back to OpenFrame ($reason)")
        hide()
        app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        // Free the Android screen's memory once it is in the background.
        handler.postDelayed({
            app.getSystemService(ActivityManager::class.java).killBackgroundProcesses(SETTINGS_PACKAGE)
        }, 2_000)
    }

    companion object {
        /** The Android screens OpenFrame may open (SPEC §19). */
        val SCREENS = mapOf("wifi" to Settings.ACTION_WIFI_SETTINGS)
        private const val SETTINGS_PACKAGE = "com.android.settings"
        private const val IDLE_CHECK_MS = 15_000L
    }
}
