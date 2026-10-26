package app.openframe

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Non-secret settings in app-private `config.json` (SPEC §16).
 * Every change first snapshots the previous config into `config-history/` ([ConfigHistory]).
 * Calendar URLs are secrets and live in [SecretsStore], never here.
 */
class ConfigStore(context: Context) {

    data class SlideshowConfig(
        val intervalSec: Int,
        val order: String,
        val reverse: Boolean,
        val fit: String,
        val background: String,
        val backgroundColor: String,
        val transitionMs: Int,
    )

    data class RemovableConfig(val enabled: Boolean, val subfolder: String)

    data class CalendarSettings(val syncIntervalMin: Int)

    data class LayoutConfig(val preset: String, val inactivityReturnSec: Int)

    /** [brightness]: percent of the system scale, or null to leave Android's brightness as it is. */
    data class DisplayConfig(val brightness: Int?)

    /** Main volume (SPEC §6, Sound): [volume] percent, or null to leave Android's levels as they are. */
    data class SoundConfig(val volume: Int?, val clicks: Boolean, val reminders: ReminderSound = ReminderSound())

    /**
     * Event reminders' sound (SPEC §11): [chime] (a file in web/sounds), played once ([repeatSec] 0) or every
     * 15/20/30 s; [volume] percent of Android's alarm volume, null = leave Android's level as it is.
     */
    data class ReminderSound(val chime: String = "bell-1", val repeatSec: Int = 0, val volume: Int? = null)

    /** Videos (SPEC §6); the shell reads [include], the web UI the rest. */
    data class VideoConfig(val include: Boolean, val autoplay: Boolean, val playback: String, val muted: Boolean, val autoMute: Boolean)

    /** [wokenTimeoutMin]: woken during sleep hours, sleep again after this long without a touch. */
    data class IgnoredPlace(val name: String, val lat: Double, val lon: Double)

    /** A private spot (home): never looked up online; [name] ("" = the town) for photos within [radiusM]. */
    data class PrivatePlace(val name: String, val lat: Double, val lon: Double, val radiusM: Int) {
        /** Stable reference for photos added to this place (its position never changes; name and size do). */
        val key: String get() = String.format(java.util.Locale.US, "%.5f,%.5f", lat, lon)
    }

    /** Photo caption (SPEC §8); the display options are read by the web UI, these by the shell. */
    data class CaptionConfig(
        val ignoreRadiusMi: Double, val ignoredPlaces: List<IgnoredPlace>, val detailedPlace: Boolean = true,
        val privatePlaces: List<PrivatePlace> = emptyList(),
    )

    data class SleepConfig(val schedules: List<SleepSchedule.Entry>, val wokenTimeoutMin: Int)

    /** Weather location is unset (null) until chosen; [units] only affects display (data is fetched in °C). */
    data class WeatherConfig(
        val latitude: Double?,
        val longitude: Double?,
        val place: String,
        val units: String,
        val refreshMin: Int,
    )

    data class CalendarMeta(
        val id: String,
        val name: String,
        val color: String,
        val enabled: Boolean,
        val busy: Boolean,
        /** The user's address as a guest in this calendar ("" = unknown): their declined events are crossed out. */
        val email: String = "",
        /** Event reminders on the frame (SPEC §11): on/off and minutes before (5/10/15/30/60, several allowed). */
        val remindersOn: Boolean = false,
        val reminderMinutes: List<Int> = listOf(10),
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("id", id).put("name", name).put("color", color).put("enabled", enabled).put("busy", busy)
            .put("email", email)
            .put("reminders", JSONObject().put("enabled", remindersOn).put("minutes", org.json.JSONArray(reminderMinutes)))

        /** Reminder settings from `{enabled, minutes}` (null or missing parts: unchanged). Checked by validateCalendar. */
        fun withReminders(r: JSONObject?): CalendarMeta {
            if (r == null) return this
            val minutes = r.optJSONArray("minutes")?.let { a -> (0 until a.length()).map { a.optInt(it, -1) } } ?: reminderMinutes
            return copy(remindersOn = r.optBoolean("enabled", remindersOn), reminderMinutes = minutes)
        }
    }

    private class Parsed(
        val slideshow: SlideshowConfig,
        val removable: RemovableConfig,
        val calendar: CalendarSettings,
        val calendars: List<CalendarMeta>,
        val layout: LayoutConfig,
        val weather: WeatherConfig,
        val display: DisplayConfig,
        val sleep: SleepConfig,
        val caption: CaptionConfig,
        val sound: SoundConfig,
        val video: VideoConfig,
    )

    private val file = File(context.filesDir, "config.json")
    private val snapshots = ConfigHistory(File(context.filesDir, "config-history"))
    private val listeners = mutableListOf<() -> Unit>()

    @Volatile private var current: JSONObject
    @Volatile private var parsed: Parsed

    init {
        val (json, p) = load()
        current = json
        parsed = p
    }

    val slideshow: SlideshowConfig get() = parsed.slideshow
    val removable: RemovableConfig get() = parsed.removable
    val calendar: CalendarSettings get() = parsed.calendar
    val calendars: List<CalendarMeta> get() = parsed.calendars
    val layout: LayoutConfig get() = parsed.layout
    val weather: WeatherConfig get() = parsed.weather
    val display: DisplayConfig get() = parsed.display
    val sleep: SleepConfig get() = parsed.sleep
    val caption: CaptionConfig get() = parsed.caption
    val sound: SoundConfig get() = parsed.sound
    val video: VideoConfig get() = parsed.video

    fun json(): JSONObject = JSONObject(current.toString())

    fun addListener(listener: () -> Unit) = synchronized(listeners) { listeners += listener }

    /**
     * Deep-merges [patch] into the config, validates the result, and saves it.
     * @throws IllegalArgumentException with a user-readable message if invalid.
     */
    fun patch(patch: JSONObject): JSONObject {
        val next = synchronized(this) {
            val next = JSONObject(current.toString())
            deepMerge(next, patch, DEFAULTS, "", strict = true)
            commit(next)
            next
        }
        Log.i(TAG, "Config updated: ${patch.keys().asSequence().toList()}")
        notifyListeners()
        return JSONObject(next.toString())
    }

    /**
     * Replaces all settings with [source] (a snapshot or an imported file; unknown keys are ignored,
     * missing ones get defaults) and the calendar list with [calendars]. Always snapshots first.
     * @throws IllegalArgumentException with a user-readable message if invalid.
     */
    fun replaceAll(source: JSONObject, calendars: List<CalendarMeta>) {
        synchronized(this) { commit(replacement(source, calendars), forceSnapshot = true) }
        Log.i(TAG, "Config replaced (restore or import)")
        notifyListeners()
    }

    /** Checks what [replaceAll] would save, without saving. @throws IllegalArgumentException */
    fun validateReplacement(source: JSONObject, calendars: List<CalendarMeta>) {
        parse(replacement(source, calendars))
    }

    private fun replacement(source: JSONObject, calendars: List<CalendarMeta>): JSONObject {
        val next = JSONObject(DEFAULTS.toString())
        val settings = JSONObject(source.toString()).apply { remove("calendars") }
        deepMerge(next, settings, DEFAULTS, "", strict = false)
        next.put("calendars", JSONArray(calendars.map { it.toJson() }))
        return next
    }

    /** Snapshots, newest first (see [ConfigHistory.list]). */
    fun history(): JSONArray = snapshots.list(current)

    fun snapshot(id: Long): JSONObject? = snapshots.get(id)

    /** Replaces the calendar list (managed through /api/calendars). Validates like [patch]. */
    fun updateCalendars(transform: (MutableList<CalendarMeta>) -> Unit) {
        synchronized(this) {
            val list = parsed.calendars.toMutableList()
            transform(list)
            val next = JSONObject(current.toString())
            next.put("calendars", JSONArray(list.map { it.toJson() }))
            commit(next)
        }
        notifyListeners()
    }

    private fun commit(next: JSONObject, forceSnapshot: Boolean = false) {
        val p = parse(next)
        if (ConfigHistory.canonical(next) != ConfigHistory.canonical(current)) {
            try {
                snapshots.record(current, forceSnapshot)
            } catch (e: Exception) {
                Log.e(TAG, "Config snapshot failed; saving the change anyway", e)
            }
        }
        writeAtomically(next)
        current = next
        parsed = p
    }

    private fun notifyListeners() = synchronized(listeners) { listeners.toList() }.forEach { it() }

    private fun load(): Pair<JSONObject, Parsed> {
        val base = JSONObject(DEFAULTS.toString())
        if (file.isFile) {
            try {
                val saved = JSONObject(file.readText())
                // Phase 11: "current only" weather became the high/low switch.
                saved.optJSONObject("clock")?.let { c ->
                    if (c.optString("weatherDetail") == "current" && !c.has("weatherShow")) {
                        c.put("weatherShow", JSONObject().put("highLow", false))
                    }
                }
                // Phase 11: the clock's text shadow became the text style's (once, before "text" exists).
                if (!saved.has("text")) saved.optJSONObject("clock")?.opt("shadow")?.let { s ->
                    if (s is Number) saved.put("text", JSONObject().put("shadow", s))
                }
                deepMerge(base, saved, DEFAULTS, "", strict = false)
                return base to parse(base)
            } catch (e: Exception) {
                // Keep the bad file for diagnosis and fall back to defaults.
                Log.e(TAG, "config.json unreadable or invalid; using defaults", e)
                file.renameTo(File(file.parentFile, "config.invalid-${System.currentTimeMillis()}.json"))
            }
        }
        val defaults = JSONObject(DEFAULTS.toString())
        return defaults to parse(defaults)
    }

    private fun writeAtomically(json: JSONObject) {
        val tmp = File(file.parentFile, "config.json.tmp")
        tmp.writeText(json.toString(2))
        if (!tmp.renameTo(file)) throw IllegalStateException("Could not save config.json")
    }

    private fun deepMerge(target: JSONObject, patch: JSONObject, schema: JSONObject, path: String, strict: Boolean) {
        for (key in patch.keys()) {
            val keyPath = if (path.isEmpty()) key else "$path.$key"
            if (!schema.has(key)) {
                if (strict) throw IllegalArgumentException("Unknown setting: $keyPath")
                continue
            }
            if (strict && keyPath == "calendars") {
                throw IllegalArgumentException("Calendars are changed through /api/calendars")
            }
            val value = patch.get(key)
            val schemaValue = schema.get(key)
            if (schemaValue is JSONObject) {
                if (value !is JSONObject) throw IllegalArgumentException("$keyPath must be an object")
                deepMerge(target.getJSONObject(key), value, schemaValue, keyPath, strict)
            } else {
                target.put(key, value)
            }
        }
    }

    companion object {
        private val DEFAULTS: JSONObject = JSONObject(
            """
            {
              "slideshow": {
                "intervalSec": 30,
                "order": "shuffle",
                "reverse": false,
                "fit": "fit",
                "background": "blur",
                "backgroundColor": "#000000",
                "transitionMs": 1000
              },
              "media": {
                "removable": { "enabled": true, "subfolder": "" }
              },
              "calendar": {
                "syncIntervalMin": 15,
                "defaultView": "week",
                "firstDay": 0,
                "startOnToday": false,
                "fadePast": true,
                "weekNumbers": false,
                "nowTimeLeft": false
              },
              "calendars": [],
              "hiddenEvents": [],
              "layout": {
                "preset": "hybrid",
                "pages": [],
                "home": "",
                "inactivityReturnSec": 120,
                "hybridCalendar": { "landscape": "right", "portrait": "bottom" },
                "custom": null
              },
              "clock": {
                "showClock": true,
                "showDate": true,
                "showWeather": true,
                "hour12": true,
                "dateFormat": "long",
                "corner": "top-right",
                "size": "medium",
                "timeZone": "",
                "showAmPm": true,
                "weatherLayout": "stacked",
                "weatherShow": { "icon": true, "current": true, "highLow": true, "condition": false, "feelsLike": false, "rain": false },
                "forecastDays": 0,
                "iconStyle": "color"
              },
              "theme": {
                "mode": "dark",
                "auto": "sun",
                "from": "19:00",
                "to": "07:00",
                "panel": "follow"
              },
              "text": {
                "font": "roboto",
                "bold": false,
                "color": "#ffffff",
                "shadow": 0.6,
                "outline": false,
                "opacity": 1,
                "clock": { "font": null, "color": null, "bold": null },
                "date": { "font": null, "color": null, "bold": null },
                "weather": { "font": null, "color": null, "bold": null },
                "caption": { "font": null, "color": null, "bold": null },
                "calendar": { "font": null, "size": "medium" }
              },
              "caption": {
                "showComment": true,
                "showLocation": true,
                "detailedPlace": true,
                "showDate": true,
                "lines": "two",
                "corner": "bottom-left",
                "size": "medium",
                "background": 0.45,
                "ignoreRadiusMi": 8,
                "ignoredPlaces": [],
                "privatePlaces": []
              },
              "weather": {
                "latitude": null,
                "longitude": null,
                "place": "",
                "units": "fahrenheit",
                "refreshMin": 30
              },
              "display": {
                "brightness": null
              },
              "sound": {
                "volume": null,
                "clicks": true,
                "reminders": { "chime": "bell-1", "repeatSec": 0, "volume": null }
              },
              "video": {
                "include": true,
                "autoplay": true,
                "playback": "continue",
                "muted": true,
                "autoMute": false
              },
              "sleep": {
                "schedules": [
                  { "enabled": true, "sleep": "21:30", "wake": "07:00", "days": [0, 1, 2, 3, 4, 5, 6] }
                ],
                "wokenTimeoutMin": 5
              }
            }
            """.trimIndent()
        )

        private val ORDERS = setOf("shuffle", "date_taken", "date_added")
        private val FITS = setOf("fit", "fill")
        private val BACKGROUNDS = setOf("black", "blur", "color")
        private val PRESETS = LayoutPages.PRESETS
        private val CORNERS = setOf("top-left", "top-right", "bottom-left", "bottom-right")
        private val SIZES = setOf("small", "medium", "large")
        private val DATE_FORMATS = setOf("long", "short")
        private val WEATHER_LAYOUTS = setOf("stacked", "line")
        private val ICON_STYLES = setOf("color", "text")
        private val WEATHER_PARTS = listOf("icon", "current", "highLow", "condition", "feelsLike", "rain")
        private val CAPTION_LINES = setOf("two", "one")
        private val THEME_MODES = setOf("light", "dark", "auto")
        private val THEME_AUTO = setOf("sun", "sleep", "hours")
        private val THEME_PANEL = setOf("follow", "light", "dark")
        private val HM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
        private val FONTS = setOf("roboto", "roboto-condensed", "noto-serif", "dancing-script", "coming-soon", "cutive-mono")
        private val TEXT_ITEMS = listOf("clock", "date", "weather", "caption")
        private const val MAX_IGNORED_PLACES = 20
        private const val MAX_PRIVATE_PLACES = 20
        /** Private place sizes in meters (≈ 200, 500, 1,000 ft); new ones start at the first (user decision 2026-10-19). */
        val PRIVATE_RADII = listOf(60, 150, 300)
        private val UNITS = setOf("fahrenheit", "celsius")
        private val CALENDAR_VIEWS = setOf("day", "week", "month")
        val COLOR = Regex("^#[0-9a-fA-F]{6}$")
        val CALENDAR_ID = Regex("^c[0-9a-f]{8}$")
        /** Reminder chimes bundled in web/sounds (CC0, docs/THIRD_PARTY.md); the web UI has the same list. */
        // .m4a, .wav, or .mp3 files: SoundController finds them by name.
        val CHIMES = listOf("bell-1", "vibraphone", "confirm-1", "confirm-2", "question", "music-box")
        /** Chimes no longer bundled; a config naming one gets the first bell. */
        private val REMOVED_CHIMES = setOf("bell-2", "bell-3", "bell-4", "glass", "rise")
        private val REMINDER_REPEATS = setOf(0, 15, 20, 30)
        /** Minutes before an event a reminder can be (user 2026-10-16). */
        val REMINDER_MINUTES = setOf(5, 10, 15, 30, 60)
        val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

        private fun parse(root: JSONObject): Parsed {
            parseClock(root) // UI-only settings: validated here, read by the web UI from /api/config
            parseText(root)
            parseTheme(root)
            return Parsed(parseSlideshow(root), parseRemovable(root), parseCalendarSettings(root), parseCalendars(root),
                parseLayout(root), parseWeather(root), parseDisplay(root), parseSleep(root), parseCaption(root),
                parseSound(root), parseVideo(root))
        }

        private val PLAYBACK = setOf("once", "continue", "loop")

        private fun parseVideo(root: JSONObject): VideoConfig {
            val v = root.getJSONObject("video")
            for (k in listOf("include", "autoplay", "muted", "autoMute")) requireBool(v, k, "video")
            require(v.optString("playback") in PLAYBACK) { "video.playback must be one of $PLAYBACK" }
            return VideoConfig(v.getBoolean("include"), v.getBoolean("autoplay"), v.getString("playback"),
                v.getBoolean("muted"), v.getBoolean("autoMute"))
        }

        private fun parseSound(root: JSONObject): SoundConfig {
            val s = root.getJSONObject("sound")
            val v = s.opt("volume")
            requireBool(s, "clicks", "sound")
            val r = s.getJSONObject("reminders")
            // A chime the user removed (2026-10-26) in an older config, backup, or snapshot: the first bell instead.
            if (r.optString("chime") in REMOVED_CHIMES) r.put("chime", CHIMES.first())
            require(r.optString("chime") in CHIMES) { "sound.reminders.chime must be one of $CHIMES" }
            require(r.opt("repeatSec") in REMINDER_REPEATS) { "sound.reminders.repeatSec must be one of $REMINDER_REPEATS" }
            val rv = r.opt("volume")
            require(rv == null || rv == JSONObject.NULL || (rv is Int && rv in 0..100)) { "sound.reminders.volume must be 0–100 or null" }
            val reminders = ReminderSound(r.getString("chime"), r.getInt("repeatSec"), (rv as? Int))
            if (v == null || v == JSONObject.NULL) return SoundConfig(null, s.getBoolean("clicks"), reminders)
            require(v is Int && v in 0..100) { "sound.volume must be 0–100 (percent) or null" }
            return SoundConfig(v, s.getBoolean("clicks"), reminders)
        }

        private fun parseCaption(root: JSONObject): CaptionConfig {
            val c = root.getJSONObject("caption")
            for (k in listOf("showComment", "showLocation", "detailedPlace", "showDate")) requireBool(c, k, "caption")
            require(c.optString("lines") in CAPTION_LINES) { "caption.lines must be one of $CAPTION_LINES" }
            require(c.optString("corner") in CORNERS) { "caption.corner must be one of $CORNERS" }
            require(c.optString("size") in SIZES) { "caption.size must be one of $SIZES" }
            val bg = c.opt("background")
            require(bg is Number && bg.toDouble() in 0.0..1.0) { "caption.background must be a number from 0 to 1" }
            val radius = c.opt("ignoreRadiusMi")
            require(radius is Number && radius.toDouble() in 0.5..100.0) { "caption.ignoreRadiusMi must be 0.5–100 miles" }
            val arr = c.opt("ignoredPlaces") as? JSONArray ?: throw IllegalArgumentException("caption.ignoredPlaces must be a list")
            require(arr.length() <= MAX_IGNORED_PLACES) { "At most $MAX_IGNORED_PLACES places can be left out" }
            val places = (0 until arr.length()).map { i ->
                val p = arr.opt(i) as? JSONObject ?: throw IllegalArgumentException("caption.ignoredPlaces[$i] must be {name, lat, lon}")
                val name = p.opt("name")
                require(name is String && name.isNotBlank() && name.length <= 100) { "caption.ignoredPlaces[$i].name must be text" }
                val lat = p.opt("lat")
                val lon = p.opt("lon")
                require(lat is Number && lat.toDouble() in -90.0..90.0 && lon is Number && lon.toDouble() in -180.0..180.0) {
                    "caption.ignoredPlaces[$i] needs lat and lon"
                }
                IgnoredPlace(name, lat.toDouble(), lon.toDouble())
            }
            val priv = c.opt("privatePlaces") as? JSONArray ?: throw IllegalArgumentException("caption.privatePlaces must be a list")
            require(priv.length() <= MAX_PRIVATE_PLACES) { "At most $MAX_PRIVATE_PLACES private places" }
            val privates = (0 until priv.length()).map { i ->
                val p = priv.opt(i) as? JSONObject ?: throw IllegalArgumentException("caption.privatePlaces[$i] must be {name, lat, lon, radiusM}")
                val name = p.opt("name")
                require(name is String && name.length <= 40) { "caption.privatePlaces[$i].name must be text of at most 40 characters" }
                val lat = p.opt("lat")
                val lon = p.opt("lon")
                require(lat is Number && lat.toDouble() in -90.0..90.0 && lon is Number && lon.toDouble() in -180.0..180.0) {
                    "caption.privatePlaces[$i] needs lat and lon"
                }
                val r = p.opt("radiusM")
                require(r is Number && r.toInt() in PRIVATE_RADII) { "caption.privatePlaces[$i].radiusM must be one of $PRIVATE_RADII" }
                PrivatePlace(name.trim(), lat.toDouble(), lon.toDouble(), r.toInt())
            }
            return CaptionConfig(radius.toDouble(), places, c.getBoolean("detailedPlace"), privates)
        }

        private fun parseDisplay(root: JSONObject): DisplayConfig {
            val b = root.getJSONObject("display").opt("brightness")
            if (b == null || b == JSONObject.NULL) return DisplayConfig(null)
            require(b is Int && b in 5..100) { "display.brightness must be 5–100 (percent) or null" }
            return DisplayConfig(b)
        }

        private fun parseSleep(root: JSONObject): SleepConfig {
            val s = root.getJSONObject("sleep")
            val schedules = SleepSchedule.parse(s.opt("schedules") as? JSONArray)
            val woken = s.opt("wokenTimeoutMin")
            require(woken is Int && woken in 1..120) { "sleep.wokenTimeoutMin must be 1–120 minutes" }
            return SleepConfig(schedules, woken)
        }

        private fun requireBool(o: JSONObject, key: String, path: String) =
            require(o.opt(key) is Boolean) { "$path.$key must be true or false" }

        private fun parseLayout(root: JSONObject): LayoutConfig {
            val l = root.getJSONObject("layout")
            val preset = l.optString("preset")
            require(preset in PRESETS) { "layout.preset must be one of $PRESETS" }
            val inactivity = l.optInt("inactivityReturnSec", -1)
            require(inactivity in 10..3_600) { "layout.inactivityReturnSec must be 10–3600 seconds" }
            val pages = l.opt("pages") as? JSONArray ?: throw IllegalArgumentException("layout.pages must be a list")
            val home = l.opt("home") as? String ?: throw IllegalArgumentException("layout.home must be text")
            LayoutPages.validate(pages, home)
            // Hybrid: the calendar column's side in landscape, above or below the photo in portrait (2026-10-16).
            val side = l.getJSONObject("hybridCalendar")
            require(side.optString("landscape") in setOf("left", "right")) { "layout.hybridCalendar.landscape must be left or right" }
            require(side.optString("portrait") in setOf("top", "bottom")) { "layout.hybridCalendar.portrait must be top or bottom" }
            // The last custom layout, kept while a built-in one is shown (one tap switches back; 2026-10-16).
            val custom = l.opt("custom")
            if (custom != null && custom != JSONObject.NULL) {
                val c = custom as? JSONObject ?: throw IllegalArgumentException("layout.custom must be an object or null")
                LayoutPages.validate(JSONArray().put(JSONObject().put("id", "custom").put("name", "Custom")
                    .put("landscape", c.opt("landscape")).put("portrait", c.opt("portrait"))), "custom")
            }
            return LayoutConfig(preset, inactivity)
        }

        /** Dark mode (SPEC §9): light / dark / auto (by sunset, around sleep, or between two times). */
        private fun parseTheme(root: JSONObject) {
            val t = root.getJSONObject("theme")
            require(t.optString("mode") in THEME_MODES) { "theme.mode must be one of $THEME_MODES" }
            require(t.optString("auto") in THEME_AUTO) { "theme.auto must be one of $THEME_AUTO" }
            for (k in listOf("from", "to")) require(HM.matches(t.optString(k))) { "theme.$k must look like 19:00" }
            // The day panel and clock panel (Hybrid's right-hand column) can keep their own look (2026-10-16).
            require(t.optString("panel", "follow") in THEME_PANEL) { "theme.panel must be one of $THEME_PANEL" }
        }

        /** Text style (SPEC §9): default style plus per-item overrides (null = same as the default). */
        private fun parseText(root: JSONObject) {
            val t = root.getJSONObject("text")
            fun font(o: JSONObject, path: String, nullable: Boolean) {
                val v = o.opt("font")
                require((nullable && (v == null || v == JSONObject.NULL)) || v in FONTS) { "$path.font must be one of $FONTS" }
            }
            fun color(o: JSONObject, path: String, nullable: Boolean) {
                val v = o.opt("color")
                require((nullable && (v == null || v == JSONObject.NULL)) || v == "auto" || (v is String && COLOR.matches(v))) {
                    "$path.color must be \"auto\" or look like #RRGGBB"
                }
            }
            font(t, "text", false)
            color(t, "text", false)
            requireBool(t, "bold", "text")
            requireBool(t, "outline", "text")
            val shadow = t.opt("shadow")
            require(shadow is Number && shadow.toDouble() in 0.0..1.0) { "text.shadow must be a number from 0 to 1" }
            val opacity = t.opt("opacity")
            require(opacity is Number && opacity.toDouble() in 0.3..1.0) { "text.opacity must be a number from 0.3 to 1" }
            for (item in TEXT_ITEMS) {
                val o = t.getJSONObject(item)
                font(o, "text.$item", true)
                color(o, "text.$item", true)
                val b = o.opt("bold")
                require(b == null || b == JSONObject.NULL || b is Boolean) { "text.$item.bold must be true, false or null" }
            }
            val cal = t.getJSONObject("calendar")
            font(cal, "text.calendar", true)
            require(cal.optString("size") in SIZES) { "text.calendar.size must be one of $SIZES" }
        }

        private fun parseClock(root: JSONObject) {
            val c = root.getJSONObject("clock")
            for (k in listOf("showClock", "showDate", "showWeather", "hour12")) requireBool(c, k, "clock")
            require(c.optString("dateFormat") in DATE_FORMATS) { "clock.dateFormat must be one of $DATE_FORMATS" }
            require(c.optString("corner") in CORNERS) { "clock.corner must be one of $CORNERS" }
            require(c.optString("size") in SIZES) { "clock.size must be one of $SIZES" }
            requireBool(c, "showAmPm", "clock")
            require(c.optString("weatherLayout") in WEATHER_LAYOUTS) { "clock.weatherLayout must be one of $WEATHER_LAYOUTS" }
            require(c.optString("iconStyle") in ICON_STYLES) { "clock.iconStyle must be one of $ICON_STYLES" }
            val show = c.getJSONObject("weatherShow")
            for (k in WEATHER_PARTS) requireBool(show, k, "clock.weatherShow")
            val days = c.opt("forecastDays")
            require(days is Int && days in 0..5) { "clock.forecastDays must be 0–5" }
            val tz = c.opt("timeZone")
            require(tz is String && (tz.isEmpty() || tz in java.util.TimeZone.getAvailableIDs())) {
                "clock.timeZone must be empty (use the frame's time zone) or a zone like America/Los_Angeles"
            }
        }

        private fun parseWeather(root: JSONObject): WeatherConfig {
            val w = root.getJSONObject("weather")
            fun coord(key: String, max: Double): Double? = when (val v = w.opt(key)) {
                null, JSONObject.NULL -> null
                is Number -> v.toDouble().also { require(it in -max..max) { "weather.$key must be between -$max and $max" } }
                else -> throw IllegalArgumentException("weather.$key must be a number or null")
            }
            val lat = coord("latitude", 90.0)
            val lon = coord("longitude", 180.0)
            require((lat == null) == (lon == null)) { "weather.latitude and weather.longitude must be set together" }
            val place = w.opt("place")
            require(place is String && place.length <= 100) { "weather.place must be text (up to 100 characters)" }
            val units = w.optString("units")
            require(units in UNITS) { "weather.units must be one of $UNITS" }
            val refresh = w.optInt("refreshMin", -1)
            require(refresh in 10..360) { "weather.refreshMin must be 10–360 minutes" }
            return WeatherConfig(lat, lon, place, units, refresh)
        }

        private fun parseSlideshow(root: JSONObject): SlideshowConfig {
            val s = root.getJSONObject("slideshow")
            val interval = s.optInt("intervalSec", -1)
            require(interval in 5..86_400) { "slideshow.intervalSec must be 5–86400 seconds" }
            val order = s.optString("order")
            require(order in ORDERS) { "slideshow.order must be one of $ORDERS" }
            val fit = s.optString("fit")
            require(fit in FITS) { "slideshow.fit must be one of $FITS" }
            val bg = s.optString("background")
            require(bg in BACKGROUNDS) { "slideshow.background must be one of $BACKGROUNDS" }
            val color = s.optString("backgroundColor")
            require(COLOR.matches(color)) { "slideshow.backgroundColor must look like #RRGGBB" }
            val transition = s.optInt("transitionMs", -1)
            require(transition in 0..5_000) { "slideshow.transitionMs must be 0–5000" }
            require(s.opt("reverse") is Boolean) { "slideshow.reverse must be true or false" }
            return SlideshowConfig(interval, order, s.getBoolean("reverse"), fit, bg, color, transition)
        }

        private fun parseRemovable(root: JSONObject): RemovableConfig {
            val r = root.getJSONObject("media").getJSONObject("removable")
            require(r.opt("enabled") is Boolean) { "media.removable.enabled must be true or false" }
            val sub = r.optString("subfolder").trim('/')
            require(sub.split('/').none { it == ".." }) { "media.removable.subfolder must not contain .." }
            return RemovableConfig(r.getBoolean("enabled"), sub)
        }

        private fun parseCalendarSettings(root: JSONObject): CalendarSettings {
            val c = root.getJSONObject("calendar")
            val interval = c.optInt("syncIntervalMin", -1)
            require(interval in 5..1_440) { "calendar.syncIntervalMin must be 5–1440 minutes" }
            // Full-screen calendar view settings (read by the web UI).
            require(c.optString("defaultView") in CALENDAR_VIEWS) { "calendar.defaultView must be one of $CALENDAR_VIEWS" }
            val firstDay = c.opt("firstDay")
            require(firstDay is Int && firstDay in 0..6) { "calendar.firstDay must be 0 (Sunday) to 6 (Saturday)" }
            for (k in listOf("startOnToday", "fadePast", "weekNumbers", "nowTimeLeft")) requireBool(c, k, "calendar")
            validateHiddenEvents(root)
            return CalendarSettings(interval)
        }

        private const val MAX_HIDDEN_EVENTS = 1_000

        /** Events hidden by the user (read by the web UI, SPEC §11): `[{ key: "o|…" or "s|…", title }]`. */
        private fun validateHiddenEvents(root: JSONObject) {
            val arr = root.opt("hiddenEvents") as? JSONArray ?: throw IllegalArgumentException("hiddenEvents must be a list")
            require(arr.length() <= MAX_HIDDEN_EVENTS) { "At most $MAX_HIDDEN_EVENTS hidden events" }
            for (i in 0 until arr.length()) {
                val h = arr.opt(i) as? JSONObject ?: throw IllegalArgumentException("hiddenEvents[$i] must be {key, title}")
                val key = h.opt("key")
                require(key is String && key.length in 3..600 && (key.startsWith("o|") || key.startsWith("s|"))) {
                    "hiddenEvents[$i].key is invalid"
                }
                val title = h.opt("title")
                require(title == null || title == JSONObject.NULL || (title is String && title.length <= 200)) { "hiddenEvents[$i].title is too long" }
            }
        }

        private fun parseCalendars(root: JSONObject): List<CalendarMeta> {
            val arr = root.optJSONArray("calendars") ?: throw IllegalArgumentException("calendars must be a list")
            val out = ArrayList<CalendarMeta>()
            for (i in 0 until arr.length()) {
                val c = arr.getJSONObject(i)
                val id = c.optString("id")
                require(CALENDAR_ID.matches(id)) { "calendars[$i].id is invalid" }
                require(out.none { it.id == id }) { "calendars[$i].id is duplicated" }
                out += validateCalendar(
                    CalendarMeta(id, c.optString("name"), c.optString("color"),
                        c.optBoolean("enabled", true), c.optBoolean("busy", false), c.optString("email"))
                        .withReminders(c.optJSONObject("reminders")),
                    "calendars[$i]",
                )
            }
            return out
        }

        fun validateCalendar(c: CalendarMeta, where: String = "calendar"): CalendarMeta {
            val name = c.name.trim()
            require(name.length in 1..60) { "$where.name must be 1–60 characters" }
            require(COLOR.matches(c.color)) { "$where.color must look like #RRGGBB" }
            val email = c.email.trim().lowercase()
            require(email.isEmpty() || (email.length <= 254 && EMAIL.matches(email))) { "$where.email doesn't look like an email address" }
            require(c.reminderMinutes.all { it in REMINDER_MINUTES }) { "$where.reminders.minutes must be among $REMINDER_MINUTES" }
            return c.copy(name = name, color = c.color.lowercase(), email = email, reminderMinutes = c.reminderMinutes.distinct().sorted())
        }
    }
}
