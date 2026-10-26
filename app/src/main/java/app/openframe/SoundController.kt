package app.openframe

import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

/**
 * Main volume and click sounds (SPEC §6, Sound). One setting drives two Android volumes:
 * - media (STREAM_MUSIC, 0–15 here): videos, later Home Assistant chimes;
 * - system sounds (STREAM_SYSTEM, 0–7 here): the keyboard's (LatinIME) and Android's screen clicks.
 *   On this frame it moves together with the ring and notification volumes (one alias); level 0
 *   is silent and leaves the ringer Normal, without Do Not Disturb (tested 2026-10-14).
 * Until the volume is first set (null), Android's levels are left as they are, like brightness.
 * Event reminders (SPEC §11) chime on the alarm volume (STREAM_ALARM, 0–7 here), which is its own
 * level on this frame (not tied to media or system sounds): sound.reminders.volume.
 */
class SoundController(private val app: OpenFrameApp) {

    private val audio = app.getSystemService(AudioManager::class.java)
    private val pm = app.getSystemService(PowerManager::class.java)
    private val thread = HandlerThread("OpenFrame-sound").apply { start() }
    private val handler = Handler(thread.looper)

    fun start() {
        app.config.addListener { handler.post(::apply) }
        handler.post(::apply)
    }

    private fun apply() {
        val s = app.config.sound
        s.reminders.volume?.let { set(AudioManager.STREAM_ALARM, "reminders", levelFor(it, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM))) }
        val volume = s.volume ?: return
        val maxMedia = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val maxSystem = audio.getStreamMaxVolume(AudioManager.STREAM_SYSTEM)
        set(AudioManager.STREAM_MUSIC, "media", levelFor(volume, maxMedia))
        set(AudioManager.STREAM_SYSTEM, "system sounds", if (s.clicks) levelFor(volume, maxSystem) else 0)
    }

    private fun set(stream: Int, name: String, level: Int) {
        if (audio.getStreamVolume(stream) == level) return
        try {
            audio.setStreamVolume(stream, level, 0)
            Log.i(TAG, "Volume: $name set to $level/${audio.getStreamMaxVolume(stream)}")
        } catch (e: SecurityException) {
            Log.e(TAG, "Volume: $name not set", e)
        }
    }

    /** A short beep at the media volume, so the level can be heard. Not while the screen is off. */
    fun test() {
        handler.post {
            apply() // the change that triggered the test may still be on its way
            if (!pm.isInteractive) return@post
            var tone: ToneGenerator? = null
            try {
                tone = ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME)
                tone.startTone(ToneGenerator.TONE_PROP_BEEP, TEST_MS)
                Thread.sleep(TEST_MS + 100L)
            } catch (e: RuntimeException) {
                Log.e(TAG, "Volume: test beep failed", e)
            } finally {
                tone?.release()
            }
        }
    }

    private var player: MediaPlayer? = null

    /** Chime files by name: <name>.m4a, or the .wav / .mp3 the user added (2026-10-26). */
    private val chimeFiles: Map<String, String> by lazy {
        (app.assets.list("web/sounds") ?: emptyArray()).associateBy { it.substringBeforeLast('.') }
    }

    private fun chimeFile(name: String) = chimeFiles[name] ?: "$name.m4a"

    /**
     * Plays reminder chime [name] (web/sounds/<name>.m4a, .wav, or .mp3) once on the alarm volume; a chime still playing
     * stops first. Not while the screen is off (quiet during sleep). False if it didn't play.
     */
    fun chime(name: String): Boolean {
        if (!pm.isInteractive) return false
        handler.post {
            apply()
            player?.release()
            player = null
            try {
                val mp = MediaPlayer()
                mp.setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build())
                app.assets.openFd("web/sounds/${chimeFile(name)}").use { fd -> mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }
                mp.setOnCompletionListener { done -> handler.post { if (player === done) player = null; done.release() } }
                mp.prepare()
                mp.start()
                player = mp
            } catch (e: Exception) {
                Log.e(TAG, "Reminder chime $name failed", e)
            }
        }
        return true
    }

    /** `GET /api/sound`: Android's current levels. */
    fun json(): JSONObject {
        fun stream(s: Int) = JSONObject().put("level", audio.getStreamVolume(s)).put("max", audio.getStreamMaxVolume(s))
        return JSONObject()
            .put("media", stream(AudioManager.STREAM_MUSIC))
            .put("system", stream(AudioManager.STREAM_SYSTEM))
            .put("alarm", stream(AudioManager.STREAM_ALARM))
    }

    companion object {
        private const val TEST_MS = 150

        /** Percent → Android level: rounded, but never silent above 0%. */
        fun levelFor(percent: Int, max: Int): Int =
            if (percent <= 0) 0 else ((percent * max + 50) / 100).coerceIn(1, max)
    }
}
