package app.openframe

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

/**
 * Foreground service while OpenFrame's screen exists (SPEC §18). With the screen off, Android 8
 * treats even the top app as background and disables its partial wake lock ("no cached wake
 * locks"); a foreground service keeps the process in the foreground class, so the wake lock holds
 * (HTTP server, uploads, and sync keep working at night) and the low-memory killer leaves OpenFrame
 * alone while an Android screen (Wi-Fi) is in front. The notification is invisible: there is no
 * status bar on this frame.
 */
class FrameService : Service() {

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "OpenFrame", NotificationManager.IMPORTANCE_MIN))
        startForeground(NOTIFICATION_ID, Notification.Builder(this, CHANNEL)
            .setContentTitle("OpenFrame")
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setOngoing(true)
            .build())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "openframe"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            context.startForegroundService(Intent(context, FrameService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, FrameService::class.java))
        }
    }
}
