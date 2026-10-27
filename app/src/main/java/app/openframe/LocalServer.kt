package app.openframe

import android.os.Environment
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.InputStream

/**
 * Embedded HTTP server (SPEC §3, §4). Serves the web UI, media display copies, and the JSON API on 0.0.0.0.
 *
 * UI source: if /sdcard/OpenFrame/ui-dev/index.html exists, the UI is served from that
 * folder (checked per request, so pushing or removing it takes effect on reload);
 * otherwise from the APK's assets/web/.
 */
class LocalServer(private val app: OpenFrameApp, port: Int) : NanoHTTPD(null, port) {

    /** Set by MainActivity while it is alive; called on a server thread. */
    @Volatile var onReloadRequested: (() -> Unit)? = null

    private val backup = ConfigBackup(app)
    private val access = WebAccess(app.secrets)
    private val shortcutFile by lazy { ShortcutFile(File(app.filesDir, "shortcut")) }
    private val powerLog by lazy { PowerLog(app.filesDir) }
    private val warnings = WarningCenter(app)

    private val devRoot = File(Environment.getExternalStorageDirectory(), "OpenFrame/ui-dev")

    /**
     * The dev UI on shared storage (scripts/push-ui.ps1): test builds only. A release build never takes its UI
     * from shared storage, where any app with storage access could put pages that run with the frame's own
     * access (PIN, upload key, calendar links; security check 2026-10-26).
     */
    val isDevUi: Boolean get() = isDebuggable && File(devRoot, "index.html").isFile

    override fun serve(session: IHTTPSession): Response = route(session).apply {
        // Other sites may not show the frame's pages in a frame of theirs (tricking a tap or the PIN), and
        // browsers take the stated types as they are (security check 2026-10-26).
        addHeader("X-Frame-Options", "SAMEORIGIN")
        addHeader("Content-Security-Policy", "frame-ancestors 'self'")
        addHeader("X-Content-Type-Options", "nosniff")
    }

    private fun route(session: IHTTPSession): Response {
        val uri = session.uri
        val m = session.method
        return try {
            when {
                // Web access PIN (SPEC §16a): other devices see only the PIN page until signed in.
                uri == "/api/auth/state" && m == Method.GET -> authState(session)
                uri == "/api/auth/login" && m == Method.POST -> login(session)
                // The iPhone Shortcut's key opens this one endpoint only (SPEC §17).
                uri == "/api/upload" && m == Method.POST && access.uploadKeyMatches(session) -> upload(session)
                !access.allowed(session) -> pinRequired(session, uri, m)
                uri == "/api/upload" && m == Method.POST -> upload(session)
                uri == "/api/upload/key" && m == Method.GET -> json(Response.Status.OK, JSONObject().put("key", access.uploadKey()))
                // The user's exported Shortcut, for phones to download (SPEC §17).
                uri == "/api/shortcut" && m == Method.GET -> json(Response.Status.OK, shortcutFile.info(access.uploadKey(), SystemInfo.ipv4()))
                uri == "/api/shortcut" && m == Method.POST -> saveShortcut(session)
                uri == "/api/shortcut" && m == Method.DELETE -> {
                    shortcutFile.delete()
                    json(Response.Status.OK, JSONObject().put("ok", true))
                }
                uri == "/shortcut/download" && (m == Method.GET || m == Method.HEAD) -> downloadShortcut()
                uri == "/api/upload/key/renew" && m == Method.POST ->
                    json(Response.Status.OK, JSONObject().put("key", access.renewUploadKey()))
                uri == "/api/auth/pin" && m == Method.GET -> json(Response.Status.OK, JSONObject()
                    .put("pin", access.pin ?: JSONObject.NULL).put("local", access.isLocal(session)))
                uri == "/api/auth/pin" && m == Method.POST -> setPin(session)
                uri == "/api/auth/logout" && m == Method.POST ->
                    json(Response.Status.OK, JSONObject().put("ok", true))
                        .apply { addHeader("Set-Cookie", access.cookieHeader(null)) }
                uri == "/api/status" && m == Method.GET -> status()
                uri == "/api/warnings" && m == Method.GET -> json(Response.Status.OK, warnings.json())
                uri == "/api/warnings/dismiss" && m == Method.POST -> dismissWarning(session)
                uri == "/api/ui/reload" && m == Method.POST -> reload()
                uri == "/api/ui/theme" && m == Method.POST -> frameTheme(session)
                uri == "/api/config" && m == Method.GET -> json(Response.Status.OK, app.config.json())
                uri == "/api/config" && m == Method.PATCH -> patchConfig(session)
                uri == "/api/config/history" && m == Method.GET ->
                    json(Response.Status.OK, JSONObject().put("snapshots", app.config.history()))
                uri.startsWith("/api/config/history/") && uri.endsWith("/restore") && m == Method.POST ->
                    restoreSnapshot(uri.removePrefix("/api/config/history/").removeSuffix("/restore"))
                uri == "/api/config/export" && m == Method.GET -> exportConfig(session)
                uri == "/api/config/import" && m == Method.POST -> importConfig(session)
                uri == "/api/system" && m == Method.GET ->
                    json(Response.Status.OK, SystemInfo.json(app, if (isDevUi) "dev" else "bundled"))
                uri == "/api/system/open" && m == Method.POST -> openAndroidScreen(session)
                uri == "/api/system/usb-debugging" && m == Method.POST -> usbDebugging(session)
                uri == "/api/network" && m == Method.GET ->
                    json(Response.Status.OK, SystemInfo.network(app).put("canOpenSettings", app.overlay.allowed))
                // Sleep and wake (SPEC §18)
                uri == "/api/power" && m == Method.GET -> json(Response.Status.OK, app.power.json())
                uri == "/api/power/sleep" && m == Method.POST ->
                    if (app.power.sleepNow()) json(Response.Status.OK, JSONObject().put("ok", true))
                    else error(Response.Status.CONFLICT, "Sleep isn't set up yet: it needs a one-time set-up from a computer.")
                uri == "/api/power/wake" && m == Method.POST -> {
                    app.power.wakeNow()
                    json(Response.Status.OK, JSONObject().put("ok", true))
                }
                uri == "/api/power/off" && m == Method.POST -> powerOff(session)
                uri == "/api/power/admin/remove" && m == Method.POST -> {
                    app.power.removeAdmin()
                    json(Response.Status.OK, JSONObject().put("ok", true))
                }
                // Main volume (SPEC §6, Sound)
                uri == "/api/sound" && m == Method.GET -> json(Response.Status.OK, app.sound.json())
                uri == "/api/sound/reminder" && m == Method.POST -> reminderChime(session)
                uri == "/api/sound/test" && m == Method.POST -> {
                    app.sound.test()
                    json(Response.Status.OK, JSONObject().put("ok", true))
                }
                uri == "/api/slideshow/current" && m == Method.GET -> slide(app.slideshow.current())
                uri == "/api/slideshow/next" && m == Method.POST -> slide(app.slideshow.next())
                uri == "/api/slideshow/prev" && m == Method.POST -> slide(app.slideshow.prev())
                uri == "/api/media" && m == Method.GET -> mediaSummary()
                uri == "/api/media/rescan" && m == Method.POST -> rescan()
                uri.startsWith("/api/media/") -> mediaItem(session, uri.removePrefix("/api/media/"), m)
                uri == "/api/library" && m == Method.GET -> library(session)
                uri == "/api/library/delete" && m == Method.POST -> libraryAction(session) { ids ->
                    val r = app.library.delete(ids)
                    JSONObject().put("trashed", r.trashed).put("hidden", r.hidden).put("failed", JSONArray(r.failed))
                }
                uri == "/api/library/unhide" && m == Method.POST -> libraryAction(session) { ids ->
                    JSONObject().put("unhidden", app.library.unhide(ids))
                }
                uri == "/api/library/hide" && m == Method.POST -> libraryAction(session) { ids ->
                    JSONObject().put("hidden", app.library.hide(ids))
                }
                uri == "/api/trash" && m == Method.GET -> trashList()
                uri == "/api/trash/restore" && m == Method.POST -> libraryAction(session) { ids ->
                    JSONObject().put("restored", app.library.restore(ids))
                }
                uri == "/api/trash/delete" && m == Method.POST -> {
                    val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
                    val ids = if (body.optBoolean("all")) null else idsOf(body)
                    json(Response.Status.OK, JSONObject().put("deleted", app.library.purge(ids)))
                }
                uri.startsWith("/media/thumb/") && m == Method.GET -> thumb(uri)
                uri == "/api/diagnostics/storage" && m == Method.GET ->
                    json(Response.Status.OK, Diagnostics.storage(app, app.indexer))
                uri == "/api/calendars" && m == Method.GET -> listCalendars()
                uri == "/api/calendars" && m == Method.POST -> addCalendar(session)
                uri == "/api/calendars/refresh" && m == Method.POST -> refreshCalendars(session)
                uri.startsWith("/api/calendars/") -> calendarItem(session, uri.removePrefix("/api/calendars/"), m)
                uri == "/api/weather" && m == Method.GET -> json(Response.Status.OK, app.weatherSync.json())
                uri == "/api/weather/refresh" && m == Method.POST -> {
                    app.weatherSync.requestRefresh()
                    json(Response.Status.ACCEPTED, JSONObject().put("ok", true))
                }
                uri == "/api/weather/geocode" && m == Method.GET -> geocode(session)
                uri == "/api/places/search" && m == Method.GET -> searchPlaces(session)
                uri == "/api/places/private" && m == Method.POST -> addPrivatePlace(session)
                uri == "/api/places/private/remove" && m == Method.POST -> removePrivatePlace(session)
                uri == "/api/places/label" && m == Method.POST -> setPlaceLabel(session)
                uri == "/api/places/coords" && m == Method.POST -> setPhotoCoords(session)
                uri == "/api/places/address" && m == Method.GET -> {
                    val q = session.parameters["q"]?.firstOrNull()?.trim().orEmpty()
                    if (q.length < 3 || q.length > 200) return error(Response.Status.BAD_REQUEST, "Type at least 3 letters")
                    try {
                        json(Response.Status.OK, JSONObject().put("results", app.placeLookup.searchAddress(q)))
                    } catch (e: java.io.IOException) {
                        error(Response.Status.SERVICE_UNAVAILABLE, "Can't reach OpenStreetMap (no internet?)")
                    }
                }
                uri == "/api/places/nearby" && m == Method.GET -> {
                    val q = session.parameters["q"]?.firstOrNull()?.trim().orEmpty()
                    val lat = session.parameters["lat"]?.firstOrNull()?.toDoubleOrNull()
                    val lon = session.parameters["lon"]?.firstOrNull()?.toDoubleOrNull()
                    if (q.length < 2 || q.length > 100) return error(Response.Status.BAD_REQUEST, "Type at least 2 letters")
                    if (lat == null || lon == null || !PlaceIndex.validGps(lat, lon)) return error(Response.Status.BAD_REQUEST, "No position to search around")
                    try {
                        json(Response.Status.OK, JSONObject().put("results", app.placeLookup.searchNearby(q, lat, lon)))
                    } catch (e: java.io.IOException) {
                        error(Response.Status.SERVICE_UNAVAILABLE, "Can't reach OpenStreetMap (no internet?)")
                    }
                }
                uri == "/api/places/names" && m == Method.GET -> json(Response.Status.OK, app.placeLookup.json())
                uri == "/api/places/names" && m == Method.POST -> {
                    val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
                    val all = when (body.optString("mode")) {
                        "all" -> true
                        "missing" -> false
                        else -> return error(Response.Status.BAD_REQUEST, "mode must be missing or all")
                    }
                    app.placeLookup.rerun(all)
                    json(Response.Status.ACCEPTED, app.placeLookup.json())
                }
                uri.startsWith("/api/video/") && uri.endsWith("/strip") && m == Method.GET -> videoStrip(uri)
                uri.startsWith("/api/volumes/") && m == Method.DELETE -> forgetVolume(uri)
                uri.startsWith("/api/") -> error(Response.Status.NOT_FOUND, "not found")
                uri == "/settings" && (m == Method.GET || m == Method.HEAD) -> staticFile("/settings.html")
                uri == "/upload" && (m == Method.GET || m == Method.HEAD) -> staticFile("/upload.html")
                uri == "/shortcut" && (m == Method.GET || m == Method.HEAD) -> staticFile("/shortcut.html")
                uri.startsWith("/dev/feeds/") && isDebuggable && m == Method.GET -> devFeed(session, uri)
                uri.startsWith("/media/video/") && (m == Method.GET || m == Method.HEAD) -> videoFile(session, uri)
                uri.startsWith("/media/strip/") && m == Method.GET -> stripFile(uri)
                uri.startsWith("/media/") && (m == Method.GET || m == Method.HEAD) -> mediaFile(uri)
                m == Method.GET || m == Method.HEAD -> staticFile(uri)
                else -> error(Response.Status.METHOD_NOT_ALLOWED, "method not allowed")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Request failed: $m $uri", e)
            error(Response.Status.INTERNAL_ERROR, e.javaClass.simpleName)
        }
    }

    // ---- Upload (SPEC §17) ----

    private fun saveShortcut(session: IHTTPSession): Response {
        val length = session.headers["content-length"]?.toLongOrNull() ?: -1
        shortcutFile.save(session.inputStream, length, access.uploadKey(), SystemInfo.ipv4())?.let {
            return error(Response.Status.BAD_REQUEST, it)
        }
        return json(Response.Status.OK, shortcutFile.info(access.uploadKey(), SystemInfo.ipv4()))
    }

    private fun downloadShortcut(): Response {
        val f = shortcutFile.file() ?: return error(Response.Status.NOT_FOUND, "No Shortcut file on the frame yet.")
        return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", FileInputStream(f), f.length()).apply {
            addHeader("Content-Disposition", "attachment; filename=\"${ShortcutFile.DOWNLOAD_NAME}\"")
            addHeader("Cache-Control", "no-store")
        }
    }

    private val uploader by lazy { UploadReceiver(app) }

    private fun upload(session: IHTTPSession): Response {
        val length = session.headers["content-length"]?.toLongOrNull() ?: -1
        val name = session.parameters["name"]?.firstOrNull()
        val comment = session.parameters["comment"]?.firstOrNull()
        fun param(key: String) = session.parameters[key]?.firstOrNull()
        // Date taken and place, sent by the iPhone Shortcut for videos (SPEC §17).
        val sent = UploadMeta.parse(param("taken"), param("lat"), param("lon"), java.time.ZoneId.systemDefault(), name = param("place"))
        // A place that was sent but couldn't be read: log its shape only (digits → 9, letters → a), never the value.
        if (param("taken") != null && sent.lat == null) {
            fun shape(v: String?) = v?.map { if (it.isDigit()) '9' else if (it.isLetter()) 'a' else it }?.joinToString("") ?: "(none)"
            // Unknown names are masked too: a misplaced "=" puts the value into the name ("lat47.6=").
            val known = setOf("taken", "lat", "lon", "name", "comment", "place")
            val all = session.parameters.entries.joinToString(", ") { (k, v) -> "${if (k in known) k else shape(k)}=${shape(v.firstOrNull())}" }
            Log.i(TAG, "Upload place not readable: lat ${shape(param("lat"))}, lon ${shape(param("lon"))}; parameters: $all")
            // "taken=Oct": the address had a raw space (a date not in ISO 8601), which ends the request's URL there.
            if (param("taken")?.matches(Regex("[A-Za-z]{3,9}")) == true) {
                Log.i(TAG, "Upload address cut at a space: the Shortcut's Date Taken isn't ISO 8601, so lat, lon, and place were lost")
            }
        }
        val r = uploader.receive(session.inputStream, length, name, comment, sent)
        // A refused upload is a warning on the frame until the next one that works (user 2026-10-19).
        if (r is UploadReceiver.Result.Rejected) app.uploadRefusals.record(r.what, r.message) else app.uploadRefusals.clear()
        return when (r) {
            is UploadReceiver.Result.Saved -> json(Response.Status.CREATED, JSONObject()
                .put("ok", true).put("status", "saved").put("name", r.name).put("type", r.type))
            is UploadReceiver.Result.Duplicate -> json(Response.Status.OK, JSONObject()
                .put("ok", true).put("status", "duplicate").put("existing", r.existing)
                .put("message", "Already on the frame"))
            is UploadReceiver.Result.Rejected -> error(httpStatus(r.http), r.message)
        }
    }

    /** NanoHTTPD's Status enum lacks some codes (411, 413, 415, 507). */
    private fun httpStatus(code: Int): Response.IStatus =
        Response.Status.lookup(code) ?: object : Response.IStatus {
            override fun getRequestStatus() = code
            override fun getDescription() = "$code ${UPLOAD_REASONS[code] ?: "Error"}"
        }

    // ---- Web access PIN ----

    private fun authState(session: IHTTPSession): Response = json(Response.Status.OK, JSONObject()
        .put("pinSet", access.pin != null)
        .put("signedIn", access.allowed(session))
        .put("theme", shownTheme() ?: JSONObject.NULL))

    /** The frame's light or dark look as it is now (Automatic is worked out on the frame's page), for the PIN page. */
    @Volatile private var reportedTheme: String? = null

    private fun shownTheme(): String? = reportedTheme
        ?: app.config.json().optJSONObject("theme")?.optString("mode")?.takeIf { it == "light" || it == "dark" }

    /** `{theme: "light"|"dark"}` from the frame's own page whenever its look changes (SPEC §16a). */
    private fun frameTheme(session: IHTTPSession): Response {
        if (!access.isLocal(session)) return error(Response.Status.FORBIDDEN, "Only the frame reports its theme")
        val theme = readJson(session)?.optString("theme")
        if (theme != "light" && theme != "dark") return error(Response.Status.BAD_REQUEST, "theme must be light or dark")
        reportedTheme = theme
        return json(Response.Status.OK, JSONObject().put("ok", true))
    }

    private fun login(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Enter the PIN")
        return when (val r = access.login(session, body.optString("pin"))) {
            is PinGuard.Login.Ok -> json(Response.Status.OK, JSONObject().put("ok", true))
                .apply { addHeader("Set-Cookie", access.cookieHeader(r.token)) }
            is PinGuard.Login.Wrong -> json(Response.Status.UNAUTHORIZED, JSONObject()
                .put("error", "Wrong PIN. ${r.triesLeft} ${if (r.triesLeft == 1) "try" else "tries"} left.")
                .put("triesLeft", r.triesLeft))
            is PinGuard.Login.Locked -> json(Response.Status.FORBIDDEN, JSONObject()
                .put("error", "Too many wrong PINs. Try again in ${lockText(r.seconds)}.")
                .put("lockedSeconds", r.seconds))
            PinGuard.Login.NoPin -> error(Response.Status.FORBIDDEN,
                "No PIN has been set yet. On the frame: tap the photo, then Settings → System → Web access PIN.")
        }
    }

    private fun lockText(seconds: Int) = if (seconds < 90) "$seconds seconds" else "${(seconds + 59) / 60} minutes"

    /** Not signed in: the PIN page for pages, 401 for the API and media. */
    private fun pinRequired(session: IHTTPSession, uri: String, m: Method): Response {
        // Read and discard an unread body (e.g. an upload with a wrong key): closing the socket with
        // data still unread makes TCP reset the connection, and the client never sees this answer.
        val length = session.headers["content-length"]?.toLongOrNull() ?: 0
        if (length in 1..MAX_DRAIN) {
            val buf = ByteArray(64 * 1024)
            var left = length
            while (left > 0) {
                val r = session.inputStream.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (r < 0) break
                left -= r
            }
        }
        if (uri == "/api/upload" && (session.headers.containsKey("x-upload-key") || session.parameters.containsKey("key"))) {
            return error(Response.Status.UNAUTHORIZED,
                "The upload key is wrong. Copy the current one from Settings → Photos → iPhone Shortcut.")
        }
        if (uri.startsWith("/api/") || uri.startsWith("/media/") || uri.startsWith("/dev/") || m != Method.GET) {
            return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "Enter the frame's PIN first").put("pinRequired", true))
        }
        return staticFile("/pin.html").apply { status = Response.Status.UNAUTHORIZED }
    }

    private fun setPin(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        return try {
            val token = access.setPin(body.optString("pin").trim())
            // Every session just ended; keep the browser that made the change signed in.
            json(Response.Status.OK, JSONObject().put("ok", true)).apply {
                if (!access.isLocal(session)) addHeader("Set-Cookie", access.cookieHeader(token))
            }
        } catch (e: IllegalArgumentException) {
            error(Response.Status.BAD_REQUEST, e.message ?: "Invalid PIN")
        }
    }

    // ---- API ----

    private fun status(): Response {
        val pkg = app.packageManager.getPackageInfo(app.packageName, 0)
        val body = JSONObject()
            .put("app", "OpenFrame")
            .put("version", pkg.versionName)
            .put("uiSource", if (isDevUi) "dev" else "bundled")
            // Other browsers draw a small copy of the frame's screen in its orientation.
            .put("portrait", app.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT)
            .put("time", System.currentTimeMillis())
            .put("clockOk", ClockTrust.ok(app)) // false right after a reboot, before network time
        val w = warnings.json()
        body.put("online", w.getBoolean("online")).put("warnings", w.getJSONArray("warnings"))
        return json(Response.Status.OK, body)
    }

    private fun dismissWarning(session: IHTTPSession): Response {
        val id = readJson(session)?.optString("id").orEmpty()
        // Already cleared counts as done: the popup should go away either way.
        return json(Response.Status.OK, JSONObject().put("ok", true).put("found", warnings.dismiss(id)))
    }

    private fun reload(): Response {
        val callback = onReloadRequested ?: return error(Response.Status.SERVICE_UNAVAILABLE, "UI not running")
        callback()
        return json(Response.Status.OK, JSONObject().put("ok", true))
    }

    /** Android screens (Wi-Fi) open on the frame only, under the "Back to OpenFrame" button (SPEC §19). */
    private fun openAndroidScreen(session: IHTTPSession): Response {
        val screen = readJson(session)?.optString("screen").orEmpty()
        if (!access.isLocal(session)) return error(Response.Status.FORBIDDEN, "Android screens open on the frame itself")
        if (screen !in ReturnOverlay.SCREENS) return error(Response.Status.BAD_REQUEST, "Unknown screen")
        if (!app.overlay.open(screen)) {
            return error(Response.Status.CONFLICT,
                "The \"Back to OpenFrame\" button isn't set up yet: it needs a one-time set-up from a computer.")
        }
        return json(Response.Status.OK, JSONObject().put("ok", true))
    }

    /**
     * A reminder chime on the frame's alarm volume (`{chime?}`, default the chosen one; SPEC §11): the frame's
     * popups, and "Play on the frame" in Settings (signed-in phones too, like the volume test beep).
     */
    private fun reminderChime(session: IHTTPSession): Response {
        val body = readJson(session) ?: JSONObject()
        val chime = body.optString("chime").ifEmpty { app.config.sound.reminders.chime }
        if (chime !in ConfigStore.CHIMES) return error(Response.Status.BAD_REQUEST, "Unknown chime")
        val played = app.sound.chime(chime)
        return json(Response.Status.OK, JSONObject().put("ok", true).put("played", played))
    }

    /** Shut down or restart (`{action:"shutdown"|"restart"}`), from the frame itself only (SPEC §18). */
    private fun powerOff(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        if (!access.isLocal(session)) return error(Response.Status.FORBIDDEN, "The frame can be shut down on the frame itself")
        val action = PowerOff.parse(body.optString("action"))
            ?: return error(Response.Status.BAD_REQUEST, "action must be shutdown or restart")
        val name = body.optString("action")
        val boot = SystemInfo.bootCount(app)
        powerLog.record(name, boot, "requested") // before: a reboot that works never returns
        val problem = PowerOff.run(action) ?: return json(Response.Status.OK, JSONObject().put("ok", true))
        powerLog.record(name, boot, "failed: $problem")
        return error(Response.Status.INTERNAL_ERROR, problem)
    }

    /** USB debugging on/off, from the frame itself only (someone has to be at the frame). */
    private fun usbDebugging(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        if (!access.isLocal(session)) return error(Response.Status.FORBIDDEN, "USB debugging can be changed on the frame itself")
        if (body.opt("enabled") !is Boolean) return error(Response.Status.BAD_REQUEST, "enabled must be true or false")
        if (!SystemInfo.setUsbDebugging(app, body.getBoolean("enabled"))) {
            return error(Response.Status.CONFLICT, "This switch needs a one-time set-up from a computer.")
        }
        return json(Response.Status.OK, JSONObject().put("ok", true).put("enabled", SystemInfo.usbDebugging(app)))
    }

    private fun patchConfig(session: IHTTPSession): Response {
        val body = readBody(session) ?: return error(Response.Status.BAD_REQUEST, "Request body required")
        val patch = try {
            JSONObject(body)
        } catch (e: JSONException) {
            return error(Response.Status.BAD_REQUEST, "Body is not a JSON object")
        }
        return try {
            json(Response.Status.OK, app.config.patch(patch))
        } catch (e: IllegalArgumentException) {
            error(Response.Status.BAD_REQUEST, e.message ?: "Invalid setting")
        }
    }

    // ---- Backup and restore (SPEC §16) ----

    private fun restoreSnapshot(rawId: String): Response {
        val id = rawId.toLongOrNull() ?: return error(Response.Status.NOT_FOUND, "No such snapshot")
        return try {
            json(Response.Status.OK, backup.restore(id))
        } catch (e: IllegalArgumentException) {
            error(Response.Status.BAD_REQUEST, e.message ?: "Can't restore that snapshot")
        }
    }

    private fun exportConfig(session: IHTTPSession): Response {
        val withSecrets = session.parameters["secrets"]?.firstOrNull() == "1"
        val date = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
        val name = if (withSecrets) "openframe-settings-$date-with-links.json" else "openframe-settings-$date.json"
        Log.i(TAG, "Config exported (calendar links ${if (withSecrets) "included" else "excluded"})")
        return json(Response.Status.OK, backup.export(withSecrets)).apply {
            addHeader("Content-Disposition", "attachment; filename=\"$name\"")
        }
    }

    private fun importConfig(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "The file isn't valid JSON")
        return try {
            json(Response.Status.OK, backup.import(body))
        } catch (e: IllegalArgumentException) {
            error(Response.Status.BAD_REQUEST, e.message ?: "Can't import that file")
        }
    }

    private fun geocode(session: IHTTPSession): Response {
        val q = session.parameters["q"]?.firstOrNull()?.trim().orEmpty()
        if (q.length < 2 || q.length > 100) return error(Response.Status.BAD_REQUEST, "Type at least 2 letters")
        return try {
            json(Response.Status.OK, app.weatherSync.geocode(q))
        } catch (e: java.io.IOException) {
            error(Response.Status.SERVICE_UNAVAILABLE, e.message ?: "Place search failed")
        }
    }

    /**
     * `POST /api/places/private {mediaId, name?}`: keeps the spot where that photo was taken private (SPEC §8):
     * its GPS position becomes a private place (60 m, or larger if asked), stored in the frame's settings only.
     */
    /** The user's private place for the photo: the one it was added to, else the one it was taken in, or null. */
    private fun myPlace(item: MediaDb.Item): ConfigStore.PrivatePlace? {
        app.config.caption.privatePlaces.firstOrNull { it.key == item.privateKey }?.let { return it }
        val lat = item.lat ?: return null
        val lon = item.lon ?: return null
        if (!PlaceIndex.validGps(lat, lon)) return null
        return PlaceNames.privateAt(lat, lon, app.config.caption.privatePlaces)
    }

    private fun placeJson(p: ConfigStore.PrivatePlace) =
        JSONObject().put("name", p.name).put("lat", p.lat).put("lon", p.lon).put("radiusM", p.radiusM)

    private fun savePlaces(places: List<JSONObject>) {
        val list = JSONArray()
        places.forEach { list.put(it) }
        app.config.patch(JSONObject().put("caption", JSONObject().put("privatePlaces", list)))
    }

    /**
     * `POST /api/places/private {mediaId, name?, radiusM?, update?}`: makes the spot where that photo was taken one
     * of the user's places (SPEC §8): its GPS position, the name (empty = the town), the size (60 m unless given),
     * stored in the frame's settings only. Inside a place already: `update` changes that place, else `already`.
     */
    private fun addPrivatePlace(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        val item = app.mediaDb.item(body.optLong("mediaId", -1)) ?: return error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
        // Added to one of the private places by hand (quick select; any photo, with or without GPS).
        if (body.has("assign")) {
            val key = body.optString("assign")
            if (app.config.caption.privatePlaces.none { it.key == key }) return error(Response.Status.BAD_REQUEST, "That private place no longer exists")
            app.mediaDb.setPrivateKey(item.id, key)
            app.placeLookup.request()
            Log.i(TAG, "Photo added to a private place")
            return json(Response.Status.OK, JSONObject().put("ok", true).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
        }
        // "+ New place": a new private place at the given position (address or coordinates; a photo without GPS)
        // or at the photo's own; the photo is added to it, so it uses this place even inside another one.
        if (body.optBoolean("create")) {
            val lat = if (body.has("lat")) body.optDouble("lat") else item.lat
            val lon = if (body.has("lon")) body.optDouble("lon") else item.lon
            if (lat == null || lon == null || !PlaceIndex.validGps(lat, lon)) {
                return error(Response.Status.BAD_REQUEST, "Pick where the place is: an address or coordinates")
            }
            val place = ConfigStore.PrivatePlace(body.optString("name", "").trim().take(40),
                Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, body.optInt("radiusM", ConfigStore.PRIVATE_RADII.first()))
            if (app.config.caption.privatePlaces.any { it.key == place.key }) return error(Response.Status.BAD_REQUEST, "There's a private place at that spot already")
            return try {
                savePlaces(app.config.caption.privatePlaces.map { placeJson(it) } + placeJson(place))
                app.mediaDb.setPrivateKey(item.id, place.key)
                app.placeLookup.request()
                Log.i(TAG, "Your place created from a photo (${app.config.caption.privatePlaces.size} now)")
                json(Response.Status.OK, JSONObject().put("ok", true).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
            } catch (e: IllegalArgumentException) {
                error(Response.Status.BAD_REQUEST, e.message ?: "Invalid place")
            }
        }
        if (item.lat == null || item.lon == null || !PlaceIndex.validGps(item.lat, item.lon)) {
            return error(Response.Status.BAD_REQUEST, "This photo has no location: pick one of your private places")
        }
        val places = app.config.caption.privatePlaces
        val name = body.optString("name", "").trim().take(40)
        val radius = body.optInt("radiusM", ConfigStore.PRIVATE_RADII.first())
        val here = myPlace(item)
        if (here != null && !body.optBoolean("update")) {
            return json(Response.Status.OK, JSONObject().put("ok", true).put("already", true).put("name", here.name))
        }
        val list = places.map { p -> if (p == here) placeJson(p.copy(name = name, radiusM = radius)) else placeJson(p) }.toMutableList()
        // A new place: the photo's position, rounded to ~1 m (its own precision is no better).
        if (here == null) list += JSONObject().put("name", name).put("lat", Math.round(item.lat * 1e5) / 1e5)
            .put("lon", Math.round(item.lon * 1e5) / 1e5).put("radiusM", radius)
        return try {
            savePlaces(list)
            Log.i(TAG, "Your place ${if (here == null) "added" else "changed"} from a photo (${list.size} now)")
            json(Response.Status.OK, JSONObject().put("ok", true).put("already", false).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
        } catch (e: IllegalArgumentException) {
            error(Response.Status.BAD_REQUEST, e.message ?: "Invalid place")
        }
    }

    /** `POST /api/places/private/remove {mediaId}`: deletes the user's place the photo was taken in. */
    private fun removePrivatePlace(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        val item = app.mediaDb.item(body.optLong("mediaId", -1)) ?: return error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
        val here = myPlace(item) ?: return error(Response.Status.BAD_REQUEST, "This photo isn't in one of your places")
        if (here.key == item.privateKey) {
            app.mediaDb.setPrivateKey(item.id, null) // added by hand: just this photo leaves it
            app.placeLookup.request()
            Log.i(TAG, "Photo taken out of a private place")
        } else {
            savePlaces(app.config.caption.privatePlaces.filter { it != here }.map { placeJson(it) })
            Log.i(TAG, "Your place removed from a photo")
        }
        return json(Response.Status.OK, JSONObject().put("ok", true).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
    }

    /**
     * `POST /api/places/coords {mediaId, lat, lon}` or `{mediaId, clear: true}`: the user's position for a photo
     * (map pin, nearby place, address, typed); it wins over the photo's own, which `clear` brings back. The photo
     * then gets its town and place name again (SPEC §8).
     */
    private fun setPhotoCoords(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        val item = app.mediaDb.item(body.optLong("mediaId", -1)) ?: return error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
        val userSet = app.mediaDb.hasUserCoords(item.path)
        if (body.optBoolean("clear")) {
            if (userSet) app.mediaDb.setUserCoords(item.id, item.path, null, null)
        } else {
            val lat = body.optDouble("lat", Double.NaN)
            val lon = body.optDouble("lon", Double.NaN)
            if (!PlaceIndex.validGps(lat, lon) || lat !in -90.0..90.0 || lon !in -180.0..180.0) {
                return error(Response.Status.BAD_REQUEST, "Those coordinates aren't valid (for example 47.6205, -122.3493)")
            }
            app.mediaDb.setUserCoords(item.id, item.path, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5)
        }
        Log.i(TAG, "Photo position ${if (body.optBoolean("clear")) "removed" else "set"} by the user")
        app.places.requestFill() // the town, then the place name
        return json(Response.Status.OK, JSONObject().put("ok", true).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
    }

    /** `POST /api/places/label {mediaId, name}`: the location typed for this one photo, with or without GPS ("" removes it). */
    private fun setPlaceLabel(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        val item = app.mediaDb.item(body.optLong("mediaId", -1)) ?: return error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
        val name = body.optString("name", "").trim().take(40)
        app.mediaDb.setPlaceLabel(item.id, name.ifEmpty { null })
        app.placeLookup.request() // removed: the photo may need its automatic name again
        return json(Response.Status.OK, JSONObject().put("ok", true).put("slide", photoJson(app.mediaDb.item(item.id)!!)))
    }

    /** Bundled place list search, for Settings → Photo caption → places left out (SPEC §8). */
    private fun searchPlaces(session: IHTTPSession): Response {
        val q = session.parameters["q"]?.firstOrNull()?.trim().orEmpty()
        if (q.length < 2 || q.length > 100) return error(Response.Status.BAD_REQUEST, "Type at least 2 letters")
        val list = JSONArray()
        for (p in app.places.search(q, 15)) {
            list.put(JSONObject().put("name", p.name).put("region", p.region).put("lat", p.lat).put("lon", p.lon)
                .put("population", p.population))
        }
        return json(Response.Status.OK, JSONObject().put("places", list))
    }

    private fun slide(id: Long?): Response {
        val s = app.config.slideshow
        val v = app.config.video
        val settings = JSONObject()
            .put("intervalSec", s.intervalSec).put("fit", s.fit).put("background", s.background)
            .put("backgroundColor", s.backgroundColor).put("transitionMs", s.transitionMs)
            .put("video", JSONObject().put("autoplay", v.autoplay).put("playback", v.playback)
                .put("muted", v.muted).put("autoMute", v.autoMute))
        val item = id?.let { app.mediaDb.item(it) }
        if (item == null) {
            return json(Response.Status.OK, JSONObject()
                .put("empty", true)
                .put("indexing", app.indexer.isBusy)
                .put("settings", settings))
        }
        val body = JSONObject()
            .put("empty", false)
            .put("settings", settings)
            .put("slide", photoJson(item))
        return json(Response.Status.OK, body)
    }

    /** One photo with its per-photo settings: the slideshow's slide and the photo menu (SPEC §15). */
    private fun photoJson(item: MediaDb.Item): JSONObject {
        val v = item.rev
        val ok = hasPicture(item) // a photo's display copy, or a video's poster (SPEC §6)
        val crop = if (item.cropX == null && item.cropY == null) JSONObject.NULL
        else JSONObject().put("x", item.cropX ?: JSONObject.NULL).put("y", item.cropY ?: JSONObject.NULL)
        return JSONObject()
            .put("id", item.id)
            .put("type", item.type)
            .put("name", File(item.path).name)
            .put("source", item.source)
            .put("url", if (ok) "/media/display/${item.id}.jpg?v=$v" else JSONObject.NULL)
            .put("bg", if (ok) "/media/bg/${item.id}.jpg?v=$v" else JSONObject.NULL)
            .put("width", item.displayW)
            .put("height", item.displayH)
            .put("face", item.face?.let { f -> JSONArray(f.map { it.toDouble() }) } ?: JSONObject.NULL)
            .put("fit", item.fitOverride ?: JSONObject.NULL)
            .put("crop", crop)
            .put("view", item.view?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL)
            .put("comment", item.comment ?: JSONObject.NULL)
            .put("place", Places.shownPlace(item, app.config.caption) ?: JSONObject.NULL)
            .put("placeName", Places.fullPlace(item, app.config.caption) ?: JSONObject.NULL)
            .put("hasGps", PlaceIndex.validGps(item.lat, item.lon))
            .put("privatePlace", myPlace(item) != null)
            // For the location editor: the user's place here (name, size), a typed location, the looked-up name.
            .put("myPlace", myPlace(item)?.let { JSONObject().put("key", it.key).put("name", it.name).put("radiusM", it.radiusM)
                .put("added", it.key == item.privateKey) } ?: JSONObject.NULL)
            // Quick-select buttons in the editors: all private places.
            .put("privatePlaces", JSONArray().also { a -> app.config.caption.privatePlaces.forEach { a.put(JSONObject().put("key", it.key).put("name", it.name)) } })
            .put("userCoords", app.mediaDb.hasUserCoords(item.path))
            // For the location editor's map and nearby search (the page is PIN-gated like the photo itself).
            .put("lat", if (PlaceIndex.validGps(item.lat, item.lon)) item.lat else JSONObject.NULL)
            .put("lon", if (PlaceIndex.validGps(item.lat, item.lon)) item.lon else JSONObject.NULL)
            .put("hasOwnPosition", app.mediaDb.originalCoords(item.path) != null)
            .put("placeLabel", item.placeLabel ?: JSONObject.NULL)
            .put("placeTitle", item.placeName?.takeIf { PlaceNames.isPrecise(it, item.place) }?.let { PlaceNames.shorten(it) } ?: JSONObject.NULL)
            .put("hidden", item.hidden)
            .put("takenAt", item.takenAt ?: JSONObject.NULL)
            .put("durationMs", item.durationMs ?: JSONObject.NULL)
    }

    private fun hasPicture(item: MediaDb.Item) =
        item.status == MediaDb.STATUS_OK && (item.type == "photo" || item.displayW != null)

    /** `GET` / `PATCH /api/media/<id>`: one photo's settings (fit, position, comment; [MediaEdits]). */
    private fun mediaItem(session: IHTTPSession, rawId: String, m: Method): Response {
        val id = rawId.toLongOrNull() ?: return error(Response.Status.NOT_FOUND, "not found")
        return when (m) {
            Method.GET -> app.mediaDb.item(id)?.let { json(Response.Status.OK, photoJson(it)) }
                ?: error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
            Method.PATCH -> {
                val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
                val edits = try {
                    MediaEdits.parse(body)
                } catch (e: IllegalArgumentException) {
                    return error(Response.Status.BAD_REQUEST, e.message ?: "Invalid setting")
                }
                if (!app.mediaDb.applyEdits(id, edits)) return error(Response.Status.NOT_FOUND, "This photo is no longer on the frame")
                Log.i(TAG, "Photo $id changed: ${body.keys().asSequence().joinToString()}")
                json(Response.Status.OK, photoJson(app.mediaDb.item(id)!!))
            }
            else -> error(Response.Status.METHOD_NOT_ALLOWED, "method not allowed")
        }
    }

    private fun mediaSummary(): Response {
        val counts = app.mediaDb.counts()
        val byVolume = app.mediaDb.countsByVolume()
        val labels = app.mediaDb.volumeLabels()
        val lastSeen = app.mediaDb.volumeLastSeen()
        val mounted = app.indexer.volumes.associateBy { it.id }

        val totals = JSONObject()
        counts.forEach { (k, n) -> totals.put(k, n) }

        val volumes = JSONArray()
        for (id in (labels.keys + mounted.keys).toSortedSet()) {
            val mv = mounted[id]
            volumes.put(JSONObject()
                .put("id", id)
                .put("label", mv?.label ?: labels[id])
                .put("mounted", mv != null)
                .put("path", mv?.scanRoot?.path ?: JSONObject.NULL)
                .put("items", byVolume[id] ?: 0)
                .put("lastSeen", lastSeen[id] ?: JSONObject.NULL))
        }

        val problems = JSONArray()
        for (p in app.mediaDb.problems(PROBLEM_LIST_LIMIT)) {
            problems.put(JSONObject()
                .put("id", p.id).put("path", p.path).put("type", p.type)
                .put("status", p.status).put("detail", p.statusDetail ?: JSONObject.NULL))
        }

        val body = JSONObject()
            .put("indexing", app.indexer.isBusy)
            .put("lastScanAt", app.indexer.lastScanAt)
            .put("playable", app.slideshow.playableCount())
            .put("counts", totals) // key: type:status:available
            .put("volumes", volumes)
            .put("problems", problems)
        return json(Response.Status.OK, body)
    }

    // ---- Library and trash (Settings → Photos) ----

    private fun library(session: IHTTPSession): Response {
        val filter = session.parameters["filter"]?.firstOrNull()?.takeIf { it in setOf("all", "problems", "hidden") } ?: "all"
        val offset = session.parameters["offset"]?.firstOrNull()?.toIntOrNull()?.coerceAtLeast(0) ?: 0
        val limit = (session.parameters["limit"]?.firstOrNull()?.toIntOrNull() ?: 60).coerceIn(1, 200)
        val labels = app.mediaDb.volumeLabels()
        val items = JSONArray()
        for (it in app.mediaDb.library(filter, offset, limit)) {
            val f = File(it.path)
            items.put(JSONObject()
                .put("id", it.id).put("name", f.name).put("folder", f.parentFile?.name ?: "")
                .put("source", it.source)
                .put("volume", if (it.source == "internal") "Internal storage" else labels[it.volume] ?: "USB drive or SD card")
                .put("type", it.type).put("status", it.status).put("detail", it.statusDetail ?: JSONObject.NULL)
                .put("hidden", it.hidden).put("available", it.available)
                .put("addedAt", it.addedAt).put("takenAt", it.takenAt ?: JSONObject.NULL)
                .put("comment", it.comment ?: JSONObject.NULL)
                .put("durationMs", it.durationMs ?: JSONObject.NULL)
                .put("hasGps", PlaceIndex.validGps(it.lat, it.lon))
                .put("privatePlace", if (it.lat != null && it.lon != null && PlaceIndex.validGps(it.lat, it.lon))
                    PlaceNames.privateAt(it.lat, it.lon, app.config.caption.privatePlaces)?.let { p -> p.name.ifEmpty { "a private place" } } ?: JSONObject.NULL
                    else JSONObject.NULL)
                .put("thumb", if (hasPicture(it)) "/media/thumb/${it.id}.jpg?v=${it.rev}" else JSONObject.NULL))
        }
        return json(Response.Status.OK, JSONObject()
            .put("filter", filter).put("offset", offset).put("total", app.mediaDb.libraryCount(filter))
            .put("counts", JSONObject().put("all", app.mediaDb.libraryCount("all"))
                .put("problems", app.mediaDb.libraryCount("problems")).put("hidden", app.mediaDb.libraryCount("hidden")))
            .put("items", items))
    }

    private fun trashList(): Response {
        val items = JSONArray()
        for (t in app.mediaDb.trash()) {
            items.put(JSONObject()
                .put("id", t.id).put("name", File(t.originalPath).name).put("type", t.type).put("size", t.size)
                .put("deletedAt", t.deletedAt).put("expiresAt", t.deletedAt + Library.TRASH_DAYS * 86_400_000L)
                .put("thumb", if (app.library.trashThumb(t.id).isFile) "/media/thumb/t${t.id}.jpg" else JSONObject.NULL))
        }
        return json(Response.Status.OK, JSONObject().put("days", Library.TRASH_DAYS).put("items", items))
    }

    private fun idsOf(body: JSONObject): List<Long> {
        val arr = body.optJSONArray("ids") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optLong(it, -1).takeIf { id -> id > 0 } }.take(1000)
    }

    private fun libraryAction(session: IHTTPSession, action: (List<Long>) -> JSONObject): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        return json(Response.Status.OK, action(idsOf(body)).put("ok", true))
    }

    private fun thumb(uri: String): Response {
        val m = THUMB_PATH.matchEntire(uri) ?: return text(Response.Status.NOT_FOUND, "Not found")
        val file = if (m.groupValues[1] == "t") app.library.trashThumb(m.groupValues[2].toLong())
        else app.mediaDb.item(m.groupValues[2].toLong())?.let { app.library.thumbFor(it) }
        if (file == null || !file.isFile) return text(Response.Status.NOT_FOUND, "Not found")
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg", FileInputStream(file), file.length()).apply {
            addHeader("Cache-Control", "private, max-age=86400")
        }
    }

    /** `DELETE /api/volumes/<id>`: forget an unplugged drive the frame remembers ([Library.forgetVolume]). */
    private fun forgetVolume(uri: String): Response {
        val id = java.net.URLDecoder.decode(uri.removePrefix("/api/volumes/"), "UTF-8")
        if (!id.startsWith("removable:")) return error(Response.Status.BAD_REQUEST, "Only USB drives and SD cards can be forgotten")
        if (app.indexer.volumes.any { it.id == id }) return error(Response.Status.CONFLICT, "This drive is plugged in: unplug it first")
        if (id !in app.mediaDb.volumeLabels()) return error(Response.Status.NOT_FOUND, "The frame doesn't remember this drive")
        return json(Response.Status.OK, JSONObject().put("ok", true).put("items", app.library.forgetVolume(id)))
    }

    private fun rescan(): Response {
        app.indexer.requestScan("API request", 0)
        return json(Response.Status.OK, JSONObject().put("ok", true))
    }

    // ---- Calendars (SPEC §10). URLs are secrets: accepted on write, never returned. ----

    private fun calendarJson(c: ConfigStore.CalendarMeta): JSONObject {
        val j = c.toJson()
        val url = app.secrets.calendarUrl(c.id)
        j.put("hasUrl", url != null)
        j.put("host", url?.let { runCatching { java.net.URI(it).host }.getOrNull() } ?: JSONObject.NULL)
        val st = app.calendarSync.state(c.id) ?: CalendarSync.FeedState().toJson()
        for (k in st.keys()) j.put(k, st.get(k))
        return j
    }

    private fun listCalendars(): Response = json(Response.Status.OK, JSONObject()
        .put("online", app.calendarSync.online)
        .put("syncing", app.calendarSync.syncing)
        .put("syncIntervalMin", app.config.calendar.syncIntervalMin)
        .put("calendars", JSONArray(app.config.calendars.map(::calendarJson))))

    private fun addCalendar(session: IHTTPSession): Response {
        val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
        val url = ConfigBackup.normalizeFeedUrl(body.optString("url"), isDebuggable) ?: return error(Response.Status.BAD_REQUEST,
            "Calendar link must be an https:// (or webcal://) address")
        val id = newCalendarId()
        val meta = try {
            ConfigStore.validateCalendar(ConfigStore.CalendarMeta(
                id, body.optString("name"), body.optString("color", DEFAULT_CALENDAR_COLOR),
                body.optBoolean("enabled", true), body.optBoolean("busy", false), body.optString("email"))
                .withReminders(body.optJSONObject("reminders")))
        } catch (e: IllegalArgumentException) {
            return error(Response.Status.BAD_REQUEST, e.message ?: "Invalid calendar")
        }
        app.secrets.setCalendarUrl(id, url)
        app.config.updateCalendars { it += meta } // config listener triggers the first sync
        Log.i(TAG, "Calendar $id \"${meta.name}\" added")
        return json(Response.Status.CREATED, calendarJson(meta))
    }

    private fun refreshCalendars(session: IHTTPSession): Response {
        // "force" = manual refresh button; otherwise opening the full calendar (debounced ~30 s).
        val force = session.parameters["force"]?.firstOrNull() == "1"
        app.calendarSync.requestSync(minAgeMs = if (force) 5_000 else 30_000)
        return json(Response.Status.ACCEPTED, JSONObject().put("ok", true))
    }

    private fun calendarItem(session: IHTTPSession, rest: String, m: Method): Response {
        if (rest.endsWith(".ics") && m == Method.GET) {
            val id = rest.removeSuffix(".ics")
            if (!ConfigStore.CALENDAR_ID.matches(id)) return text(Response.Status.NOT_FOUND, "Not found")
            val f = app.calendarSync.trimmedFile(id)
            if (!f.isFile) return text(Response.Status.NOT_FOUND, "Not synced yet")
            return newFixedLengthResponse(Response.Status.OK, "text/calendar; charset=utf-8", FileInputStream(f), f.length())
                .apply { addHeader("Cache-Control", "no-store") }
        }
        val id = rest
        val existing = app.config.calendars.firstOrNull { it.id == id }
            ?: return error(Response.Status.NOT_FOUND, "No such calendar")
        return when (m) {
            Method.PATCH -> {
                val body = readJson(session) ?: return error(Response.Status.BAD_REQUEST, "Body must be a JSON object")
                val updated = try {
                    ConfigStore.validateCalendar(existing.copy(
                        name = body.optString("name", existing.name),
                        color = body.optString("color", existing.color),
                        enabled = body.optBoolean("enabled", existing.enabled),
                        busy = body.optBoolean("busy", existing.busy),
                        email = body.optString("email", existing.email)).withReminders(body.optJSONObject("reminders")))
                } catch (e: IllegalArgumentException) {
                    return error(Response.Status.BAD_REQUEST, e.message ?: "Invalid calendar")
                }
                if (body.has("url")) {
                    val url = ConfigBackup.normalizeFeedUrl(body.optString("url"), isDebuggable) ?: return error(Response.Status.BAD_REQUEST,
                        "Calendar link must be an https:// (or webcal://) address")
                    app.secrets.setCalendarUrl(id, url)
                    app.calendarSync.resetValidators(id)
                }
                app.config.updateCalendars { list -> list.replaceAll { if (it.id == id) updated else it } }
                if (body.has("url") || (updated.enabled && !existing.enabled)) {
                    app.calendarSync.requestSync(minAgeMs = 0, onlyId = id)
                }
                json(Response.Status.OK, calendarJson(updated))
            }
            Method.DELETE -> {
                app.config.updateCalendars { list -> list.removeAll { it.id == id } }
                app.secrets.setCalendarUrl(id, null)
                app.calendarSync.forget(id)
                Log.i(TAG, "Calendar $id \"${existing.name}\" removed")
                json(Response.Status.OK, JSONObject().put("ok", true))
            }
            Method.GET -> json(Response.Status.OK, calendarJson(existing))
            else -> error(Response.Status.METHOD_NOT_ALLOWED, "method not allowed")
        }
    }

    private fun newCalendarId(): String {
        val rnd = java.security.SecureRandom()
        while (true) {
            val id = "c" + "%08x".format(rnd.nextInt())
            if (app.config.calendars.none { it.id == id }) return id
        }
    }

    /** Debug builds only: serves /sdcard/OpenFrame/dev-feeds/<name>.ics with Last-Modified/304, for sync tests. */
    private fun devFeed(session: IHTTPSession, uri: String): Response {
        val name = uri.removePrefix("/dev/feeds/")
        if (!Regex("^[\\w.-]+\\.ics$").matches(name)) return text(Response.Status.NOT_FOUND, "Not found")
        val f = File(Environment.getExternalStorageDirectory(), "OpenFrame/dev-feeds/$name")
        if (!f.isFile) return text(Response.Status.NOT_FOUND, "Not found")
        val etag = "\"${f.length()}-${f.lastModified()}\""
        if (session.headers["if-none-match"] == etag) {
            return newFixedLengthResponse(Response.Status.NOT_MODIFIED, "text/calendar", "")
        }
        return newFixedLengthResponse(Response.Status.OK, "text/calendar; charset=utf-8", FileInputStream(f), f.length())
            .apply { addHeader("ETag", etag) }
    }

    private val isDebuggable: Boolean
        get() = ConfigBackup.isDebuggable(app)

    // ---- Media files ----

    private fun mediaFile(uri: String): Response {
        val match = MEDIA_PATH.matchEntire(uri) ?: return text(Response.Status.NOT_FOUND, "Not found")
        val id = match.groupValues[2].toLong()
        val file = when (match.groupValues[1]) {
            "display" -> app.indexer.displayFile(id)
            else -> app.indexer.backgroundFile(id)
        }
        if (!file.isFile) return text(Response.Status.NOT_FOUND, "Not found")
        // URLs carry ?v=<rev>, so a regenerated copy gets a new URL; safe to cache hard.
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg", FileInputStream(file), file.length()).apply {
            addHeader("Cache-Control", "public, max-age=31536000, immutable")
        }
    }

    /**
     * A video's original file for the phone's Library sheet (`<video>` needs byte ranges; SPEC §6).
     * The frame itself plays videos natively from the file, never through here.
     */
    /**
     * The preview strip of a video for the seek bar (SPEC §6): made when the video is indexed, else on this
     * first request (about 1 s per 4 s of video). `GET /api/video/<id>/strip` → { url, count, stepMs, tileW, tileH, durationMs }.
     */
    private fun videoStrip(uri: String): Response {
        val id = uri.removePrefix("/api/video/").removeSuffix("/strip").toLongOrNull()
            ?: return error(Response.Status.NOT_FOUND, "not found")
        val item = app.mediaDb.item(id)?.takeIf { it.type == "video" && it.status == MediaDb.STATUS_OK }
            ?: return error(Response.Status.NOT_FOUND, "not found")
        val made = app.indexer.strip(id, File(item.path))
            ?: return error(Response.Status.BAD_REQUEST, "No preview for this video")
        val img = app.indexer.stripFile(id)
        return json(Response.Status.OK, JSONObject(made.toString()).put("url", "/media/strip/$id.jpg?v=${img.lastModified()}"))
    }

    private fun stripFile(uri: String): Response {
        val id = uri.removePrefix("/media/strip/").substringBefore('.').toLongOrNull()
            ?: return text(Response.Status.NOT_FOUND, "Not found")
        val f = app.indexer.stripFile(id)
        if (!f.isFile) return text(Response.Status.NOT_FOUND, "Not found")
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg", FileInputStream(f), f.length()).apply {
            addHeader("Cache-Control", "private, max-age=86400")
        }
    }

    private fun videoFile(session: IHTTPSession, uri: String): Response {
        val id = uri.removePrefix("/media/video/").substringBefore('.').toLongOrNull()
            ?: return text(Response.Status.NOT_FOUND, "Not found")
        val item = app.mediaDb.item(id)?.takeIf { it.type == "video" && it.status == MediaDb.STATUS_OK }
        val file = item?.let { File(it.path) }
        if (file == null || !file.isFile) return text(Response.Status.NOT_FOUND, "Not found")
        val mime = if (file.extension.equals("mov", ignoreCase = true)) "video/quicktime" else "video/mp4"
        val total = file.length()
        val m = session.headers["range"]?.let { Regex("^bytes=(\\d*)-(\\d*)$").matchEntire(it.trim()) }
        fun Response.common() = apply {
            addHeader("Accept-Ranges", "bytes")
            addHeader("Cache-Control", "private, max-age=3600")
        }
        if (m == null) return newFixedLengthResponse(Response.Status.OK, mime, FileInputStream(file), total).common()
        val (a, b) = m.destructured
        val start = if (a.isEmpty()) maxOf(0L, total - (b.toLongOrNull() ?: 0L)) else a.toLong()
        val end = if (a.isEmpty() || b.isEmpty()) total - 1 else minOf(b.toLong(), total - 1)
        if (start > end || start >= total) {
            return text(Response.Status.RANGE_NOT_SATISFIABLE, "Range not satisfiable").apply { addHeader("Content-Range", "bytes */$total") }
        }
        val stream = FileInputStream(file).also { it.channel.position(start) }
        return newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mime, stream, end - start + 1).common().apply {
            addHeader("Content-Range", "bytes $start-$end/$total")
        }
    }

    // ---- Static UI ----

    private fun staticFile(rawUri: String): Response {
        val path = rawUri.trimStart('/').ifEmpty { "index.html" }
        if (path.split('/').any { it == ".." || it.isEmpty() }) {
            return text(Response.Status.BAD_REQUEST, "Bad path")
        }
        val dev = isDevUi
        val stream: InputStream = try {
            if (dev) File(devRoot, path).takeIf { it.isFile }?.inputStream() ?: throw FileNotFoundException(path)
            else app.assets.open("web/$path")
        } catch (e: FileNotFoundException) {
            return text(Response.Status.NOT_FOUND, "Not found: /$path")
        }

        val mime = mimeType(path)
        val response = if (dev && path.endsWith(".html")) {
            val html = stream.bufferedReader().use { it.readText() }
            newFixedLengthResponse(Response.Status.OK, mime, injectDevBadge(html))
        } else {
            newChunkedResponse(Response.Status.OK, mime, stream)
        }
        // UI files change often during development; never let the WebView serve stale copies.
        // Fonts don't (and are large for phones): cache them for a day.
        response.addHeader("Cache-Control",
            if (path.startsWith("fonts/") || path.startsWith("sounds/")) "private, max-age=86400" else "no-store")
        return response
    }

    private fun injectDevBadge(html: String): String {
        val badge = "<div style=\"position:fixed;left:6px;bottom:6px;z-index:2147483647;" +
            "padding:2px 6px;border-radius:4px;background:#d32f2f;color:#fff;" +
            "font:bold 11px sans-serif;pointer-events:none\">DEV UI</div>"
        val i = html.lastIndexOf("</body>", ignoreCase = true)
        return if (i >= 0) html.substring(0, i) + badge + html.substring(i) else html + badge
    }

    // ---- helpers ----

    private fun readBody(session: IHTTPSession): String? {
        val len = session.headers["content-length"]?.toIntOrNull() ?: return null
        if (len <= 0 || len > MAX_JSON_BODY) return null
        val buf = ByteArray(len)
        var off = 0
        val input = session.inputStream
        while (off < len) {
            val n = input.read(buf, off, len - off)
            if (n < 0) break
            off += n
        }
        return String(buf, 0, off, Charsets.UTF_8)
    }

    private fun readJson(session: IHTTPSession): JSONObject? =
        readBody(session)?.let { runCatching { JSONObject(it) }.getOrNull() }

    private fun json(status: Response.IStatus, body: JSONObject): Response =
        newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString()).apply {
            addHeader("Cache-Control", "no-store")
        }

    private fun error(status: Response.IStatus, message: String): Response =
        json(status, JSONObject().put("error", message))

    private fun text(status: Response.Status, body: String): Response =
        newFixedLengthResponse(status, "text/plain; charset=utf-8", body)

    private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html; charset=utf-8"
        "js", "mjs" -> "application/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "m4a" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "wav" -> "audio/wav"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "txt" -> "text/plain; charset=utf-8"
        else -> "application/octet-stream"
    }

    private companion object {
        val MEDIA_PATH = Regex("^/media/(display|bg)/(\\d{1,18})\\.jpg$")
        val THUMB_PATH = Regex("^/media/thumb/(t?)(\\d{1,18})\\.jpg$")
        const val MAX_JSON_BODY = 256 * 1024
        const val MAX_DRAIN = 256L shl 20
        const val PROBLEM_LIST_LIMIT = 200
        const val DEFAULT_CALENDAR_COLOR = "#4285f4"
        val UPLOAD_REASONS = mapOf(411 to "Length Required", 413 to "Payload Too Large",
            415 to "Unsupported Media Type", 507 to "Insufficient Storage")
    }
}
