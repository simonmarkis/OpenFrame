package app.openframe

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * Full-screen immersive WebView showing the local web UI (SPEC §3).
 * Follows the system orientation; rotation is handled in place (configChanges) so the
 * page just receives a resize instead of the WebView being torn down.
 */
class MainActivity : Activity() {

    private lateinit var container: FrameLayout
    private lateinit var video: VideoPlayer
    private var webView: WebView? = null
    private var uiUrl = UI_URL

    private val app get() = application as OpenFrameApp
    private val server get() = app.server

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashGuard.onUiStarted(this, intent, restored = savedInstanceState != null) // watchdog while the UI exists (SPEC §18)
        FrameService.start(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        container = FrameLayout(this)
        // Black behind the (transparent) WebView; videos play below it through a hole (SPEC §6).
        container.setBackgroundColor(0xFF000000.toInt())
        setContentView(container)
        video = VideoPlayer(app, container) { detail ->
            webView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('ofvideo',{detail:$detail}))", null)
        }

        if (isDebuggable) WebView.setWebContentsDebuggingEnabled(true)
        uiUrl = urlFor(intent)
        createWebView()

        server.onReloadRequested = { runOnUiThread { reloadUi() } }
        app.power.onUiStarted()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = urlFor(intent)
        if (url != uiUrl) {
            uiUrl = url
            reloadUi()
        }
    }

    /** Debug builds: `am start ... --es path /some-page.html` opens another local page (dev/testing). */
    private fun urlFor(intent: Intent?): String {
        val path = intent?.getStringExtra("path")
        if (!isDebuggable || path == null || !path.startsWith("/") || path.startsWith("//")) return UI_URL
        return "http://127.0.0.1:$SERVER_PORT$path"
    }

    private val isDebuggable get() = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    override fun onResume() {
        super.onResume()
        app.overlay.hide() // back from an Android screen (SPEC §19)
        webView?.onResume()
    }

    /** Every touch-down: sleep hours use it to tell whether someone is using the frame (SPEC §18). */
    override fun onUserInteraction() {
        super.onUserInteraction()
        app.power.onUserActivity()
    }

    override fun onPause() {
        video.stop("paused") // screen off or an Android screen in front; the page plays it again when visible
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        video.stop("destroyed")
        CrashGuard.onUiStopped(this)
        FrameService.stop(this)
        server.onReloadRequested = null
        destroyWebView()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun enterImmersive() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val wv = WebView(this)
        wv.setBackgroundColor(0) // transparent: a playing video shows through (SPEC §6)
        wv.addJavascriptInterface(video.Bridge(), "OpenFrameVideo")
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // Marks the frame's own WebView: only it drives the slideshow; LAN browsers mirror.
            userAgentString = "$userAgentString $UA_MARKER"
        }
        wv.webViewClient = UiClient()
        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "console ${msg.messageLevel()}: ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }
        container.addView(wv, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = wv
        wv.loadUrl(uiUrl)
        Log.i(TAG, "WebView created, loading $uiUrl (devUi=${server.isDevUi})")
    }

    private fun destroyWebView() {
        video.stop("page gone")
        webView?.let {
            container.removeView(it)
            it.destroy()
        }
        webView = null
    }

    private fun reloadUi() {
        Log.i(TAG, "UI reload requested (devUi=${server.isDevUi})")
        webView?.loadUrl(uiUrl) ?: createWebView()
    }

    private inner class UiClient : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            video.stop("navigation") // a new page (settings, reload) never inherits a playing video
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // The main WebView only ever shows local content (SPEC §3).
            val uri = request.url
            val local = uri.host == "127.0.0.1" && uri.port == SERVER_PORT
            if (!local) Log.w(TAG, "Blocked navigation away from local UI: ${uri.scheme}://${uri.host}")
            return !local
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "WebView renderer gone (crashed=${detail.didCrash()}); recreating")
            CrashGuard.record(this@MainActivity, "renderer", "The WebView renderer stopped (crashed=${detail.didCrash()}); display recreated")
            if (view === webView) {
                destroyWebView()
                createWebView()
            }
            return true
        }
    }

    private companion object {
        const val UI_URL = "http://127.0.0.1:$SERVER_PORT/"
        const val UA_MARKER = "OpenFrameShell"
    }
}
