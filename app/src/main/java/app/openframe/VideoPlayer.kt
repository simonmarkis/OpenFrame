package app.openframe

import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import org.json.JSONObject
import java.io.File
import kotlin.math.abs

/**
 * Native video playback (SPEC §6): Android's [MediaPlayer] on a [SurfaceView] placed *behind* the
 * WebView, which is transparent where the video shows, so the clock, caption, menus, and swipes stay
 * in the web UI on top. Decoding runs in Android's media server, not in this process (a decoder
 * crash doesn't take the single-process WebView down with it).
 *
 * Driven by the page through [Bridge] (`window.OpenFrameVideo`); events go back as
 * `window.dispatchEvent(new CustomEvent('ofvideo', { detail }))` with the play's token:
 * `started` (first frame on screen), `ended`, `error`. Main thread only.
 */
class VideoPlayer(
    private val app: OpenFrameApp,
    private val container: FrameLayout,
    private val emit: (JSONObject) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val surface = SurfaceView(container.context)
    private var surfaceReady = false
    private var player: MediaPlayer? = null
    private val tokens = java.util.concurrent.atomic.AtomicInteger()
    private var token = 0 // the current play (main thread)
    private var pendingStart: (() -> Unit)? = null
    private var muted = true
    private var currentId = 0L
    private var prepared = false
    private var pausedNow = false
    private var pauseAtStart = false
    private var ended = false
    private var seeking = false
    private var pendingSeek: Int? = null
    private var peeking = false
    private var seekStartedAt = 0L
    /** Where a paused picture is, in ms (-1: unknown or playing); see [seek]. */
    private var shownMs = -1
    private var seekTarget = 0
    private var playTo = -1
    private var peekTo = -1
    private var peekSeenBelow = false
    private var peekDeadline = 0L
    /** Playback failures per media id since the app started; at [MAX_FAILURES] the video is listed as a problem. */
    private val failures = HashMap<Long, Int>()

    init {
        surface.visibility = View.GONE
        // Below the WebView (index 0): the window gets a hole here that the page can show through.
        container.addView(surface, 0, FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.START))
        surface.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceReady = true
                pendingStart?.let { pendingStart = null; it() }
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surfaceReady = false
                // The surface goes away when the screen turns off or the view is hidden: playback can't go on.
                if (player != null) stop("surface")
            }
        })
    }

    /** Plays media [id] in [rect] (device px, window coordinates) as play [t]; failures arrive as an `error` event. */
    fun play(t: Int, id: Long, rect: Rect, loop: Boolean, mute: Boolean) {
        stop("replaced")
        token = t
        currentId = id
        val item = app.mediaDb.item(id)
        if (item == null || item.type != "video" || item.status != MediaDb.STATUS_OK || !File(item.path).isFile) {
            Log.w(TAG, "Video $id can't be played (missing or not ready)")
            event(t, "error", JSONObject().put("what", -1).put("reason", "missing"))
            return
        }
        muted = mute
        place(rect)
        surface.visibility = View.VISIBLE
        val mp = MediaPlayer()
        player = mp
        mp.setAudioStreamType(AudioManager.STREAM_MUSIC)
        prepared = false
        pausedNow = false
        pauseAtStart = false
        ended = false
        seeking = false
        pendingSeek = null
        peeking = false
        shownMs = -1
        mp.setOnPreparedListener {
            if (player === it && token == t) {
                prepared = true
                it.start()
            }
        }
        mp.setOnInfoListener { p, what, _ ->
            if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START && token == t) {
                // Paused before it was ready (a tap as it started): hold the first frame.
                if (pauseAtStart && !pausedNow) {
                    p.pause()
                    pausedNow = true
                    shownMs = 0
                    Log.i(TAG, "Video paused at its first frame (token $t)")
                }
                event(t, "started")
            }
            false
        }
        mp.setOnCompletionListener { if (token == t) { ended = true; event(t, "ended") } }
        mp.setOnSeekCompleteListener { p ->
            if (token != t || player !== p || !seeking) return@setOnSeekCompleteListener
            Log.d(TAG, "Video seek complete at ${p.currentPosition} ms (token $t)")
            seekDone(p)
        }
        mp.setOnErrorListener { _, what, extra ->
            Log.e(TAG, "Video $id: playback error what=$what extra=$extra")
            if (token == t) {
                event(t, "error", JSONObject().put("what", what).put("extra", extra))
                stop("error")
                failed(id, "error $what/$extra")
            }
            true
        }
        try {
            mp.setDataSource(item.path)
            mp.isLooping = loop
            applyVolume()
        } catch (e: Exception) {
            Log.e(TAG, "Video $id: can't open ${File(item.path).name}", e)
            event(t, "error", JSONObject().put("what", -1).put("reason", "open"))
            stop("error")
            return
        }
        val begin = {
            if (player === mp) {
                try {
                    mp.setDisplay(surface.holder)
                    mp.prepareAsync()
                } catch (e: Exception) {
                    Log.e(TAG, "Video $id: can't start", e)
                    event(t, "error", JSONObject().put("what", -1))
                    stop("error")
                }
            }
        }
        if (surfaceReady) begin() else pendingStart = begin
        Log.i(TAG, "Video $id: playing ${File(item.path).name} (token $t, loop=$loop, muted=$mute)")
    }

    /** Moves the video (rotation, layout change). */
    fun move(t: Int, rect: Rect) {
        if (t == token && player != null) place(rect)
    }

    // Rockchip's player doesn't report isPlaying reliably, so the state is tracked here; pause() or
    // start() before it is prepared would be an error (-38) that counts as a failure, so a pause asked
    // for that early is applied at the first frame instead.
    fun pause(t: Int) {
        val mp = player ?: return
        if (t != token || pausedNow) return
        if (!prepared) { pauseAtStart = true; return }
        mp.pause()
        pausedNow = true
        shownMs = try { mp.currentPosition } catch (e: IllegalStateException) { -1 } // real: it was playing
        Log.i(TAG, "Video paused (token $t)")
    }

    fun resume(t: Int) {
        val mp = player ?: return
        if (t != token) return
        pauseAtStart = false
        if (!prepared || !pausedNow) return
        if (peeking) { main.removeCallbacks(peekEnd); peeking = false } // already running: just keep going
        mp.start()
        pausedNow = false
        shownMs = -1
        applyVolume()
        // A spot still waiting from the seek bar: playing, the player performs it right away.
        pendingSeek?.let { pendingSeek = null; try { mp.seekTo(it.toLong(), MediaPlayer.SEEK_CLOSEST) } catch (e: IllegalStateException) { } }
        Log.i(TAG, "Video resumed (token $t)")
    }

    /**
     * Seek bar (quick menu): jumps to [ms]. Drags send many: one seek at a time, the latest wins.
     * After the end, the player pauses there first, so Play continues from the new spot.
     *
     * Rockchip's player, measured 2026-10-14 with a paused video: it reports a seek done at once but only
     * performs it when it plays again, only the first seek since it last played, and it ignores a seek
     * within about a second of where it is; its position just echoes the request, and a short play after
     * a seek may end before it has decoded from the keyframe to the spot. So the picture always gets
     * there by playing muted up to the spot ([peek] with playTo), watching the player's position:
     * - a little forward (under [NEAR_MS]): no seek, just play up to it;
     * - a little back: seek to [NEAR_MS] before it (far enough to be honored), then play up to it;
     * - farther: seek to [LEAD_MS] before it, then play up to it.
     * The next seek waits until that play is over; [shownMs] tracks where the paused picture is.
     */
    fun seek(t: Int, ms: Int) {
        val mp = player ?: return
        if (t != token || !prepared) return
        // Busy (a seek not reported done yet, or its peek still playing): the latest spot waits its turn.
        // A seek never reported done counts as done after SEEK_TIMEOUT_MS, so it can't block the bar.
        if ((seeking && SystemClock.uptimeMillis() - seekStartedAt < SEEK_TIMEOUT_MS) || peeking) { pendingSeek = ms; return }
        if (!pausedNow && ended) { mp.pause(); pausedNow = true; shownMs = mp.duration }
        ended = false
        val here = shownMs
        if (pausedNow && here >= 0 && abs(ms - here) < PEEK_SLACK_MS * 3) { position(t); return } // already there
        if (pausedNow && here >= 0 && ms >= here && ms - here < NEAR_MS) {
            shownMs = ms
            peek(mp, (ms - here).toLong(), playTo = ms, noSeek = true)
            return
        }
        var target = ms
        playTo = -1
        if (pausedNow) {
            target = maxOf(0, ms - if (here >= 0 && ms < here && here - ms < NEAR_MS) NEAR_MS else LEAD_MS)
            playTo = ms
        }
        shownMs = if (pausedNow) ms else -1
        seeking = true
        seekStartedAt = SystemClock.uptimeMillis()
        main.removeCallbacks(seekWatch)
        main.postDelayed(seekWatch, SEEK_TIMEOUT_MS)
        seekTarget = target
        try {
            mp.seekTo(target.toLong(), MediaPlayer.SEEK_CLOSEST)
            Log.d(TAG, "Video seek to $target ms for $ms (token $t)")
        } catch (e: IllegalStateException) {
            seeking = false
            Log.w(TAG, "Video: seek failed", e)
        }
    }

    /** No "seek complete" in time: carry on as if it came (the last requested spot, then the peek). */
    private val seekWatch = Runnable {
        val mp = player
        if (!seeking || mp == null) return@Runnable
        Log.d(TAG, "Video seek: no completion after $SEEK_TIMEOUT_MS ms (token $token)")
        seekDone(mp)
    }

    private fun seekDone(mp: MediaPlayer) {
        main.removeCallbacks(seekWatch)
        seeking = false
        // Performs and draws it; the next seek follows the peek.
        if (pausedNow) { if (playTo >= 0) peek(mp, (playTo - seekTarget).toLong(), playTo) else peek(mp, PEEK_MS); return }
        val next = pendingSeek
        pendingSeek = null
        if (next != null) { seek(token, next); return }
        position(token)
    }

    /**
     * Plays muted, then pauses again: for [PEEK_MS], which performs a seek and draws it; or, with [playTo],
     * until the player's position reaches that spot (counted only once it has been seen below it: right
     * after a seek it may still echo an old spot), at most [ms] + [PEEK_GRACE_MS]. See [seek].
     */
    private fun peek(mp: MediaPlayer, ms: Long, playTo: Int = -1, noSeek: Boolean = false) {
        peeking = true
        peekTo = playTo
        peekSeenBelow = noSeek // without a seek there is no stale echo to wait out
        peekDeadline = SystemClock.uptimeMillis() + maxOf(ms, PEEK_MS) + (if (playTo >= 0) PEEK_GRACE_MS else 0L)
        mp.setVolume(0f, 0f)
        mp.start()
        main.postDelayed(peekEnd, if (playTo >= 0) PEEK_CHECK_MS else PEEK_MS)
    }

    private val peekEnd = object : Runnable {
        override fun run() {
            if (!peeking) return
            if (peekTo >= 0 && SystemClock.uptimeMillis() < peekDeadline) {
                val pos = try { player?.currentPosition ?: -1 } catch (e: IllegalStateException) { -1 }
                if (pos in 0 until peekTo - PEEK_SLACK_MS) peekSeenBelow = true
                if (pos >= 0 && !(peekSeenBelow && pos >= peekTo + LAND_AHEAD_MS)) {
                    main.postDelayed(this, PEEK_CHECK_MS)
                    return
                }
            }
            endPeek()
        }
    }

    private fun endPeek() {
        main.removeCallbacks(peekEnd)
        if (!peeking) return
        peeking = false
        player?.let { if (pausedNow) it.pause() }
        applyVolume()
        val next = pendingSeek
        pendingSeek = null
        if (next != null) seek(token, next) else position(token)
    }

    /** Reports the play position as a `position` event (the menu asks a few times a second; never waits). */
    fun position(t: Int) {
        val mp = player ?: return
        if (t != token || !prepared) return
        // Paused after the seek bar: where the picture is (the player's own position only echoes requests).
        val pos = if (pausedNow && shownMs >= 0) shownMs else mp.currentPosition
        event(t, "position", JSONObject().put("pos", pos).put("dur", mp.duration))
    }

    fun setMuted(t: Int, mute: Boolean) {
        if (t != token) return
        muted = mute
        applyVolume()
    }

    /** Stops and releases the player; the hole closes (the SurfaceView is hidden). */
    fun stop(reason: String) {
        pendingStart = null
        main.removeCallbacks(peekEnd)
        main.removeCallbacks(seekWatch)
        peeking = false
        seeking = false
        pendingSeek = null
        val mp = player ?: run { surface.visibility = View.GONE; return }
        player = null
        try { mp.release() } catch (e: Exception) { Log.w(TAG, "Video: release failed", e) }
        surface.visibility = View.GONE
        Log.i(TAG, "Video stopped ($reason, token $token)")
    }

    /** The second failure lists the video under "Can't be shown" (retried after an app update). */
    private fun failed(id: Long, why: String) {
        val n = (failures[id] ?: 0) + 1
        failures[id] = n
        Log.w(TAG, "Video $id failed to play ($why), $n time(s)")
        if (n < MAX_FAILURES) return
        app.mediaDb.setStatus(id, MediaDb.STATUS_ERROR, "This video couldn't be played on the frame ($why).")
        app.slideshow.onLibraryChanged()
    }

    private fun applyVolume() {
        val v = if (muted) 0f else 1f // the level itself is Android's media volume (SoundController)
        player?.setVolume(v, v)
    }

    private fun place(r: Rect) {
        val lp = surface.layoutParams as FrameLayout.LayoutParams
        if (lp.width == r.w && lp.height == r.h && lp.leftMargin == r.x && lp.topMargin == r.y) return
        lp.width = r.w; lp.height = r.h; lp.leftMargin = r.x; lp.topMargin = r.y
        surface.layoutParams = lp
    }

    private fun event(t: Int, type: String, extra: JSONObject? = null) {
        val detail = (extra ?: JSONObject()).put("token", t).put("type", type)
        main.post { emit(detail) }
    }

    data class Rect(val x: Int, val y: Int, val w: Int, val h: Int) {
        companion object {
            fun of(j: JSONObject) = Rect(j.getInt("x"), j.getInt("y"), j.getInt("w").coerceAtLeast(1), j.getInt("h").coerceAtLeast(1))
        }
    }

    /**
     * `window.OpenFrameVideo` (the frame's own WebView only). Called on the WebView's bridge thread;
     * never waits for the main thread (the single-process WebView's drawing can wait for the page).
     */
    // Every call names the player explicitly: Bridge's methods share names with VideoPlayer's, and an
    // unqualified pause(t) inside a Bridge lambda would post Bridge.pause again, forever.
    inner class Bridge {
        private val p = this@VideoPlayer

        @android.webkit.JavascriptInterface
        fun play(json: String): Int {
            val j = JSONObject(json)
            val t = tokens.incrementAndGet()
            val rect = Rect.of(j.getJSONObject("rect"))
            main.post { p.play(t, j.getLong("id"), rect, j.optBoolean("loop"), j.optBoolean("muted", true)) }
            return t
        }

        @android.webkit.JavascriptInterface
        fun move(t: Int, rectJson: String) { val r = Rect.of(JSONObject(rectJson)); main.post { p.move(t, r) } }

        @android.webkit.JavascriptInterface
        fun pause(t: Int) { main.post { p.pause(t) } }

        @android.webkit.JavascriptInterface
        fun resume(t: Int) { main.post { p.resume(t) } }

        @android.webkit.JavascriptInterface
        fun setMuted(t: Int, mute: Boolean) { main.post { p.setMuted(t, mute) } }

        @android.webkit.JavascriptInterface
        fun seek(t: Int, ms: Int) { main.post { p.seek(t, ms) } }

        @android.webkit.JavascriptInterface
        fun position(t: Int) { main.post { p.position(t) } }

        @android.webkit.JavascriptInterface
        fun stop(t: Int) { main.post { if (t == p.token) p.stop("page") } }

        /** The page gave up on play [t] (no picture in time, or it never ended): counts as a failure. */
        @android.webkit.JavascriptInterface
        fun stalled(t: Int) { main.post { if (t == p.token) { p.stop("stalled"); p.failed(p.currentId, "no picture") } } }
    }

    private companion object {
        const val MAX_FAILURES = 2
        /** How long a paused video plays after a seek so the new spot gets decoded and drawn (see [peek]). */
        const val PEEK_MS = 120L
        /** Closer than this to where a paused video is, the player ignores a seek (see [seek]). */
        const val NEAR_MS = 2000
        /** A far seek goes this much before the spot, then plays up to it (see [seek]). */
        const val LEAD_MS = 500
        /** Stops this far past the spot: the picture shown lags the player's position by about that. */
        const val LAND_AHEAD_MS = 100
        const val PEEK_CHECK_MS = 30L
        const val PEEK_GRACE_MS = 1500L
        const val PEEK_SLACK_MS = 20
        const val SEEK_TIMEOUT_MS = 600L
    }
}
