package app.openframe

import org.json.JSONArray
import org.json.JSONObject

/**
 * Checks `layout.pages` and `layout.home` (SPEC §14). Mirrors `validatePages` in the web UI's
 * `lib/layout-core.js`; this is the check that guards config.json.
 *
 * A page is built-in (`{ id, name, preset }`) or custom (`{ id, name, landscape, portrait }`, each a
 * 12 × 24 arrangement of grid widgets `{ id, type, x, y, w, h }` and corner overlays
 * `{ id, type, anchor: { corner, over? } }`).
 */
object LayoutPages {
    val PRESETS = setOf("hybrid", "pictures", "calendar")
    private val CORNERS = setOf("top-left", "top-right", "bottom-left", "bottom-right")
    private val TYPES = setOf("photo", "clock_weather", "caption", "calendar_day", "calendar_full", "calendar_icon", "status")
    private val ANCHORED = setOf("caption", "calendar_icon", "status")
    private val GRIDDED = setOf("photo", "calendar_day", "calendar_full")
    private val SINGLE = setOf("photo", "caption", "status", "calendar_full", "calendar_icon")
    private val PAGE_ID = Regex("^[a-z0-9][a-z0-9-]{0,23}$")
    private val WIDGET_ID = Regex("^[a-z0-9][a-z0-9_-]{0,23}$")
    const val COLS = 12
    const val ROWS = 24
    const val MAX_PAGES = 8
    const val MAX_WIDGETS = 16
    const val MAX_DAYS = 5
    private const val MAX_NAME = 40

    /** @throws IllegalArgumentException with a user-readable message if invalid. */
    fun validate(pages: JSONArray, home: String) {
        require(pages.length() <= MAX_PAGES) { "At most $MAX_PAGES pages" }
        val ids = mutableSetOf<String>()
        for (i in 0 until pages.length()) {
            val where = "Page ${i + 1}"
            val p = pages.opt(i) as? JSONObject ?: throw IllegalArgumentException("$where must be an object")
            val id = p.opt("id")
            require(id is String && PAGE_ID.matches(id)) { "$where: bad id" }
            require(ids.add(id)) { "$where: id $id is used twice" }
            val name = p.opt("name")
            require(name is String && name.isNotBlank() && name.length <= MAX_NAME) { "$where needs a name of 1–$MAX_NAME characters" }
            if (p.has("preset")) {
                require(p.opt("preset") in PRESETS) { "$where: unknown preset" }
                require(!p.has("landscape") && !p.has("portrait")) { "$where: a built-in page has no arrangements of its own" }
            } else {
                arrangement(p.opt("landscape"), "$where (landscape)")
                arrangement(p.opt("portrait"), "$where (portrait)")
            }
        }
        require(home.isEmpty() || home in ids) { "layout.home: there is no page $home" }
    }

    private fun arrangement(value: Any?, where: String) {
        val arr = value as? JSONObject ?: throw IllegalArgumentException("$where is missing")
        require(arr.opt("cols") == COLS && arr.opt("rows") == ROWS) { "$where: the grid must be $COLS×$ROWS" }
        val widgets = arr.opt("widgets") as? JSONArray ?: throw IllegalArgumentException("$where needs a list of widgets")
        require(widgets.length() <= MAX_WIDGETS) { "$where: at most $MAX_WIDGETS widgets" }
        val ids = mutableSetOf<String>()
        val gridIds = mutableSetOf<String>()
        val counts = mutableMapOf<String, Int>()
        val boxes = mutableListOf<Pair<String, IntArray>>()
        val overs = mutableListOf<Pair<String, String>>()
        for (i in 0 until widgets.length()) {
            val w = widgets.opt(i) as? JSONObject ?: throw IllegalArgumentException("$where: widget ${i + 1} must be an object")
            val id = w.opt("id")
            require(id is String && WIDGET_ID.matches(id)) { "$where: widget ${i + 1} has a bad id" }
            require(ids.add(id)) { "$where: $id is used twice" }
            val type = w.opt("type")
            require(type is String && type in TYPES) { "$where: $id has an unknown type" }
            counts[type] = (counts[type] ?: 0) + 1
            require((counts[type] ?: 0) <= 1 || type !in SINGLE) { "$where: only one $type per page" }
            val anchor = w.opt("anchor")
            if (anchor != null && anchor != JSONObject.NULL) {
                require(anchor is JSONObject) { "$where: $id has a bad anchor" }
                require(type !in GRIDDED) { "$where: a $type needs a box on the grid" }
                require(anchor.opt("corner") in CORNERS) { "$where: $id needs a corner" }
                val over = anchor.opt("over")
                if (over != null && over != JSONObject.NULL) {
                    require(over is String) { "$where: $id has a bad anchor" }
                    overs += id to over
                }
                if (type == "clock_weather") require(w.opt("style") == "overlay") { "$where: a clock in a corner is an overlay" }
            } else {
                require(type !in ANCHORED) { "$where: a $type must sit in a corner" }
                if (type == "clock_weather") require(w.opt("style") == "panel") { "$where: a clock on the grid is a panel" }
                val box = listOf("x", "y", "w", "h").map { k ->
                    val v = w.opt(k)
                    require(v is Int) { "$where: $id needs whole-number x, y, w and h" }
                    v
                }.toIntArray()
                val (x, y, bw, bh) = box.toList()
                require(bw >= 1 && bh >= 1 && x >= 0 && y >= 0 && x + bw <= COLS && y + bh <= ROWS) {
                    "$where: $id is outside the $COLS×$ROWS grid"
                }
                for ((other, o) in boxes) {
                    require(!(x < o[0] + o[2] && o[0] < x + bw && y < o[1] + o[3] && o[1] < y + bh)) { "$where: $id overlaps $other" }
                }
                boxes += id to box
                gridIds += id
            }
            if (type == "calendar_day" && w.has("days")) require(w.opt("days") in (1..MAX_DAYS).toList()) { "$where: days must be 1 to $MAX_DAYS" }
        }
        for ((id, over) in overs) require(over in gridIds) { "$where: $id sits over $over, which isn't on the page" }
    }
}
