package app.openframe

import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What counts as a warning (SPEC §13). Pure JVM, unit-tested; [WarningCenter] gathers the inputs.
 *
 * - Offline: no warnings for calendars or weather at all (the UI shows only the offline icon).
 * - Calendar feed failing while online: a warning with a popup. HTTP, network, and TLS failures are often
 *   short hiccups (Google answers 404 now and then), so the feed is retried on [RETRY_DELAYS_MS] and they
 *   count only when the last retry failed too, [RETRY_STREAK] failures in a row (user 2026-10-26; HTTP
 *   errors counted at once before). Non-calendar responses and a missing link count at once.
 * - Weather failing while online with nothing newer than [WEATHER_STALE_MS]: icon only.
 * - Files that can't be shown: one summary, icon only. Low storage: icon only.
 * - Phase 8, icon only: a sleep schedule that can't work (no device admin); the home app choice lost
 *   after a crash (Android would ask at the next start); [RESTARTS_WARN] or more restarts in a day.
 * - An upload the frame refused (2026-10-19): a warning with a popup, until the next upload that works.
 */
object WarningRules {
    /** Retries after a hiccup, by failures so far: 1 min three times, then 5 min twice (user 2026-10-26). */
    val RETRY_DELAYS_MS = listOf(60_000L, 60_000L, 60_000L, 300_000L, 300_000L)
    val RETRY_STREAK = RETRY_DELAYS_MS.size + 1
    const val WEATHER_STALE_MS = 3 * 3600_000L
    const val LOW_STORAGE_BYTES = 1L shl 30
    const val RESTARTS_WARN = 3
    private val HICCUP_KINDS = setOf("http", "network", "tls")

    /** When to try a feed again after its [failStreak]th failure in a row of [kind]; null = the normal schedule. */
    fun retryDelayMs(kind: String, failStreak: Int): Long? =
        if (kind in HICCUP_KINDS && failStreak >= 1) RETRY_DELAYS_MS.getOrNull(failStreak - 1) else null

    data class Feed(
        val id: String, val name: String, val enabled: Boolean, val status: String, val errorKind: String?,
        val error: String?, val failStreak: Int, val lastSuccessAt: Long,
    )

    data class Weather(val configured: Boolean, val status: String, val error: String?, val lastSuccessAt: Long)

    /** The last refused upload: when, "photo" / "video" / "file", and the reason the sender got. */
    data class Refused(val at: Long, val what: String, val reason: String)

    /** The Shortcut still sends to [from], an IP the frame had before; it now has [to] and answers to [name]. */
    data class Moved(val from: String, val to: String, val name: String?)

    data class Input(
        val online: Boolean, val now: Long, val feeds: List<Feed>, val weather: Weather,
        val unshowableFiles: Int, val storageFreeBytes: Long?,
        val sleepNeedsAdmin: Boolean = false, val homeLost: Boolean = false, val restartsToday: Int = 0,
        val refusedUpload: Refused? = null, val zone: ZoneId = ZoneId.systemDefault(),
        val shortcutMoved: Moved? = null,
    )

    /** [canPopup]: may pop up until dismissed; [signature] changes when the problem changes. */
    data class Warning(
        val id: String, val kind: String, val title: String, val detail: String,
        val lastSuccessAt: Long, val canPopup: Boolean, val signature: String,
    )

    fun evaluate(i: Input): List<Warning> {
        val out = ArrayList<Warning>()
        if (i.online) {
            for (f in i.feeds) {
                if (!f.enabled || f.status != "error") continue
                if (f.errorKind in HICCUP_KINDS && f.failStreak < RETRY_STREAK) continue
                val kept = if (f.lastSuccessAt > 0) " The frame keeps showing the events it saved." else ""
                out += Warning("calendar:${f.id}", "calendar", "The \"${f.name}\" calendar can't be updated",
                    (f.error ?: "Unknown error.") + kept, f.lastSuccessAt, canPopup = true,
                    signature = "${f.errorKind}|${f.error}")
            }
            val w = i.weather
            if (w.configured && w.status == "error" &&
                (w.lastSuccessAt == 0L || i.now - w.lastSuccessAt >= WEATHER_STALE_MS)) {
                out += Warning("weather", "weather", "The weather can't be updated", w.error ?: "Unknown error.",
                    w.lastSuccessAt, canPopup = false, signature = w.error ?: "")
            }
        }
        if (i.unshowableFiles > 0) {
            val n = i.unshowableFiles
            out += Warning("media", "media", "$n ${if (n == 1) "file" else "files"} can't be shown",
                "HEIC photos, damaged files, or unsupported videos. Settings → Photos lists them.",
                0, canPopup = false, signature = "$n")
        }
        val free = i.storageFreeBytes
        if (free != null && free < LOW_STORAGE_BYTES) {
            out += Warning("storage", "storage", "Storage almost full",
                "Only ${free / (1L shl 20)} MB free. New photos may not be saved.", 0, canPopup = false, signature = "")
        }
        if (i.sleepNeedsAdmin) {
            out += Warning("sleep", "sleep", "The frame can't go to sleep",
                "A sleep schedule is on, but sleep needs a one-time set-up from a computer.", 0,
                canPopup = false, signature = "")
        }
        if (i.homeLost) {
            out += Warning("home", "home", "OpenFrame is no longer the home app",
                "Android reset the choice after a crash. If the frame asks for a home app after a restart, " +
                    "choose OpenFrame, then Always.", 0, canPopup = false, signature = "")
        }
        if (i.restartsToday >= RESTARTS_WARN) {
            out += Warning("restarts", "restarts", "OpenFrame restarted ${i.restartsToday} times today",
                "It recovered by itself each time. Settings → System shows when and why.", 0,
                canPopup = false, signature = "")
        }
        i.refusedUpload?.let { r ->
            val sent = DateTimeFormatter.ofPattern("MMM d, h:mm a", Locale.US).format(Instant.ofEpochMilli(r.at).atZone(i.zone))
            out += Warning("upload", "upload", "${UPLOAD_WHAT[r.what] ?: "A file"} sent to the frame was refused",
                "${r.reason.trim()} Sent $sent. This goes away after the next upload that works.", 0,
                canPopup = true, signature = r.at.toString())
        }
        i.shortcutMoved?.let { m ->
            // User decision 2026-10-27 (V1.0.2): an "Upload problem" until the Shortcut sends to the frame again.
            val fix = m.name?.let { "change it to $it (Settings → Add from your phone → iPhone Shortcut → set-up guide, step 7)" }
                ?: "change it in the Shortcut's Get Contents of URL"
            out += Warning("shortcut-address", "upload", "The iPhone Shortcut uses an old address",
                "The frame's address changed to ${m.to}. Your iPhone Shortcut still sends to ${m.from}: $fix.", 0,
                canPopup = true, signature = "${m.from}>${m.to}")
        }
        return out
    }

    private val UPLOAD_WHAT = mapOf("photo" to "A photo", "video" to "A video", "file" to "A file")
}

/**
 * Which popups were dismissed, by warning id → signature, in a small JSON file. A dismissal lasts
 * while that exact problem lasts: when the warning clears or changes, it pops up again next time.
 */
class WarningDismissals(private val file: File) {
    private val dismissed: MutableMap<String, String> = load()

    @Synchronized
    fun shouldPopup(w: WarningRules.Warning): Boolean = w.canPopup && dismissed[w.id] != w.signature

    @Synchronized
    fun dismiss(w: WarningRules.Warning) {
        dismissed[w.id] = w.signature
        save()
    }

    /** Forgets dismissals of warnings that cleared or changed. */
    @Synchronized
    fun prune(current: List<WarningRules.Warning>) {
        val keep = current.associate { it.id to it.signature }
        if (dismissed.keys.removeAll { keep[it] != dismissed[it] }) save()
    }

    private fun load(): MutableMap<String, String> = try {
        val j = if (file.isFile) JSONObject(file.readText()) else JSONObject()
        j.keys().asSequence().associateWith { j.optString(it) }.toMutableMap()
    } catch (e: Exception) {
        HashMap() // a damaged file only means a dismissed popup may show once more
    }

    private fun save() {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(JSONObject(dismissed as Map<*, *>).toString())
        tmp.renameTo(file)
    }
}
