package app.openframe

import org.json.JSONObject

/**
 * Per-photo settings sent to `PATCH /api/media/<id>` (SPEC §15, Phase 9). Only the keys present in
 * the body change:
 *
 * - `fit`: `"fit"`, `"fill"`, or `null` (follow the slideshow setting). Changing it clears the zoom
 *   (`view`) unless the same body sets one: Show as means that look.
 * - `crop`: `{ "x": 0..1 | null, "y": 0..1 | null }` or `null`. The point of the photo to keep in the
 *   middle when it fills the screen; a `null` axis stays automatic (faces, else the center). One
 *   point serves every layout: landscape screens mostly crop top and bottom (y), portrait the sides (x).
 * - `view` (zoom, 2026-10-26): `{ "landscape": V | null, "portrait": V | null }`, only the directions given
 *   change; V = `{ "zoom": 0..[MAX_ZOOM], "x": 0..1, "y": 0..1 }` (0 = the whole photo, 1 = Fill,
 *   2 = twice Fill; x, y = the point kept in the middle). A direction's view wins over fit and crop there.
 * - `comment`: text up to [MAX_COMMENT] characters, or `null` / empty to remove it.
 */
class MediaEdits private constructor(
    val setFit: Boolean, val fit: String?,
    val setCrop: Boolean, val cropX: Double?, val cropY: Double?,
    val setComment: Boolean, val comment: String?,
    /** Direction → its new view (null = back to automatic); directions not given keep theirs. */
    val view: Map<String, JSONObject?>? = null,
) {
    val setView: Boolean get() = view != null
    val isEmpty: Boolean get() = !setFit && !setCrop && !setComment && !setView

    /** The `view` column after these edits, from the stored [current] (JSON text or null). */
    fun viewAfter(current: String?): String? {
        if (!setView) return if (setFit) null else current
        val base = if (setFit) JSONObject() else try { JSONObject(current ?: "{}") } catch (e: Exception) { JSONObject() }
        for ((dir, v) in view!!) if (v == null) base.remove(dir) else base.put(dir, v)
        return if (base.length() == 0) null else base.toString()
    }

    companion object {
        const val MAX_COMMENT = 500
        const val MAX_ZOOM = 2.0
        val DIRECTIONS = setOf("landscape", "portrait")

        /** Validates [body]; throws [IllegalArgumentException] with a message for the user. */
        fun parse(body: JSONObject): MediaEdits {
            for (k in body.keys()) require(k in setOf("fit", "crop", "comment", "view")) { "Unknown setting: $k" }

            val setFit = body.has("fit")
            val fit = if (setFit && !body.isNull("fit")) body.opt("fit") else null
            require(fit == null || fit == "fit" || fit == "fill") { "fit must be \"fit\", \"fill\" or null" }

            val setCrop = body.has("crop")
            var x: Double? = null
            var y: Double? = null
            if (setCrop && !body.isNull("crop")) {
                val c = body.opt("crop") as? JSONObject ?: throw IllegalArgumentException("crop must be {x, y} or null")
                x = fraction(c, "x", "crop")
                y = fraction(c, "y", "crop")
            }

            val setComment = body.has("comment")
            var comment: String? = null
            if (setComment && !body.isNull("comment")) {
                val raw = body.opt("comment") as? String ?: throw IllegalArgumentException("comment must be text or null")
                comment = raw.trim().takeIf { it.isNotEmpty() }
                require(comment == null || comment.length <= MAX_COMMENT) { "The comment is too long (at most $MAX_COMMENT characters)" }
            }

            var view: Map<String, JSONObject?>? = null
            if (body.has("view")) {
                val v = body.opt("view") as? JSONObject ?: throw IllegalArgumentException("view must be {landscape, portrait}")
                view = v.keys().asSequence().associateWith { dir ->
                    require(dir in DIRECTIONS) { "view.$dir: only landscape and portrait" }
                    if (v.isNull(dir)) null else direction(v.opt(dir) as? JSONObject
                        ?: throw IllegalArgumentException("view.$dir must be {zoom, x, y} or null"), "view.$dir")
                }
            }
            return MediaEdits(setFit, fit as String?, setCrop, x, y, setComment, comment, view)
        }

        private fun direction(d: JSONObject, name: String): JSONObject {
            for (k in d.keys()) require(k in setOf("zoom", "x", "y")) { "$name: unknown key $k" }
            val zoom = d.opt("zoom") as? Number ?: throw IllegalArgumentException("$name.zoom must be a number from 0 to 2")
            require(zoom.toDouble().isFinite() && zoom.toDouble() in 0.0..MAX_ZOOM) { "$name.zoom must be a number from 0 to 2" }
            return JSONObject().put("zoom", zoom.toDouble())
                .put("x", fraction(d, "x", name) ?: 0.5).put("y", fraction(d, "y", name) ?: 0.5)
        }

        private fun fraction(c: JSONObject, key: String, name: String): Double? {
            if (!c.has(key) || c.isNull(key)) return null
            val v = c.opt(key) as? Number ?: throw IllegalArgumentException("$name.$key must be a number from 0 to 1")
            val d = v.toDouble()
            require(d.isFinite() && d in 0.0..1.0) { "$name.$key must be a number from 0 to 1" }
            return d
        }
    }
}
