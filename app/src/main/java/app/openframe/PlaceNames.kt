package app.openframe

import org.json.JSONObject

/**
 * Precise place names for the caption (SPEC §8): the name the iPhone sent (`&place=`) or an OpenStreetMap
 * reverse lookup ([PlaceLookup]), shown as "Name, Town". Pure, unit-tested.
 */
object PlaceNames {

    /** Longest name part shown; longer ones are cut with "…". */
    const val MAX_NAME = 32

    /** Longest name kept from an upload. */
    private const val MAX_SENT = 120

    /** A name sent with an upload, tidied (null when there is none). */
    fun cleanSent(raw: String?): String? {
        val s = raw?.replace(Regex("[\\p{Cntrl}\\s]+"), " ")?.trim().orEmpty()
        return s.takeIf { it.isNotEmpty() }?.take(MAX_SENT)
    }

    /** A street address ("1234 E Main St"), not a place's name: the caption shows just the town then. */
    fun looksLikeAddress(name: String): Boolean = Regex("^\\d+[A-Za-z]?(-\\d+)?\\s+\\S").containsMatchIn(name)

    /** Placeholders, not names: the iPhone Shortcut sent "Location" for a photo (2026-10-19). Lower case. */
    val GENERIC = setOf("location", "current location", "unknown location", "photo location", "unknown", "untitled", "home")

    /** `media.place_name` for an item at a private place or a place left out: not looked up (decided again when those change). */
    const val SKIPPED = "-"

    /** [name] names a place of its own (not empty, not an address, not a placeholder, not just the town). */
    fun isPrecise(name: String?, town: String?): Boolean {
        val n = name?.trim().orEmpty()
        if (n.isEmpty() || n == SKIPPED || looksLikeAddress(n) || n.lowercase() in GENERIC) return false
        return town.isNullOrEmpty() || !n.equals(townName(town), ignoreCase = true)
    }

    /** "Seattle, WA" → "Seattle". */
    private fun townName(town: String) = town.substringBefore(", ").trim()

    /** "Name" with the town: "Space Needle, Seattle, WA"; a name that holds the town gets only the rest ("Seattle Center, WA"). */
    private fun withTown(name: String, town: String?): String {
        if (town == null) return name
        val t = townName(town)
        if (!name.contains(t, ignoreCase = true)) return "$name, $town"
        val rest = town.substringAfter(", ", "").trim()
        return if (rest.isEmpty()) name else "$name, $rest"
    }

    /** Kinds of OpenStreetMap objects whose name is a place worth showing (also the tags asked from Postpass). */
    val CATEGORIES = setOf(
        "amenity", "tourism", "leisure", "historic", "shop", "building", "man_made", "natural", "waterway",
        "aeroway", "railway", "office", "club", "healthcare", "sport", "landuse", "craft",
    )

    /** Small things or homes: their name (if any) isn't where the photo was taken. */
    private val SKIP_TYPES = setOf(
        "bench", "waste_basket", "waste_disposal", "bicycle_parking", "motorcycle_parking", "parking", "parking_space",
        "parking_entrance", "toilets", "atm", "vending_machine", "post_box", "letter_box", "parcel_locker", "telephone",
        "drinking_water", "charging_station", "recycling", "shelter", "bicycle_rental", "car_sharing", "grit_bin",
        "clock", "picnic_table", "bbq", "loading_dock", "hunting_stand", "street_lamp", "utility_pole", "manhole",
        "house", "residential", "apartments", "detached", "semidetached_house", "terrace", "garage", "garages",
        "shed", "farm", "farmyard", "commercial", "industrial", "retail", "construction", "grass", "meadow",
        "farmland", "brownfield", "greenfield", "allotments", "rail", "level_crossing", "switch", "signal",
        "buffer_stop", "crossing", "tree", "survey_point", "flagpole", "mast", "pole", "tower:communication",
    )

    /** Homes: never a photo's place name, even when named. */
    private val HOMES = setOf("house", "residential", "apartments", "detached", "semidetached_house", "terrace", "farm", "farmyard")

    /** The name in a Nominatim `format=jsonv2` reverse answer, or "" when there is no named place there. */
    fun fromNominatim(json: JSONObject): String {
        val name = json.optString("name").trim()
        if (name.isEmpty() || looksLikeAddress(name)) return ""
        val category = json.optString("category")
        val type = json.optString("type")
        if (category !in CATEGORIES || type in SKIP_TYPES) return ""
        if (category == "railway" && type != "station" && type != "halt") return ""
        return name.take(MAX_SENT)
    }

    /**
     * A named area at or near the photo's spot (Postpass or Overpass): its OpenStreetMap tags, size, and how far
     * the spot is from it (0 = inside).
     */
    class Area(val tags: Map<String, String>, val squareMeters: Double, val distanceM: Double = 0.0)

    /**
     * A spot inside no named place takes the nearest one this close: a phone's GPS is often 10–30 m off
     * (a photo can land a few meters outside a named building's outline).
     */
    const val NEAR_M = 25.0

    /** Named buildings of these kinds are places ("Market Square", building=retail); as land use they are zones. */
    private val NAMED_BUILDINGS = setOf("retail", "commercial", "office", "industrial")

    /** Biggest area worth naming a photo after (a large park or campus; not a forest or a county). */
    private const val MAX_AREA_M2 = 20_000_000.0

    /** Area kinds whose name is a place worth showing (the rest: neighborhoods, farmland, homes…). */
    private val AREA_LANDUSE = setOf("religious", "cemetery", "recreation_ground", "education", "winter_sports")

    /**
     * The smallest named area the spot is inside that names a place (a church's grounds, a park, a school, a named
     * building such as the Space Needle), else the nearest such area within [NEAR_M], or "" when none does. Its
     * `short_name` wins when it has one.
     */
    fun fromAreas(areas: List<Area>): String {
        val places = areas.filter { a ->
            val t = a.tags
            val name = t["name"]?.trim().orEmpty()
            if (name.isEmpty() || looksLikeAddress(name) || a.squareMeters > MAX_AREA_M2) return@filter false
            if ("boundary" in t || "place" in t || "highway" in t || "admin_level" in t) return@filter false
            // A mall is shop=mall with building=retail: one kind that names a place is enough, unless it's a home.
            val kinds = CATEGORIES.filter { it in t && (t[it] !in SKIP_TYPES || (it == "building" && t[it] in NAMED_BUILDINGS)) }
                .filter { it != "landuse" || t["landuse"] in AREA_LANDUSE }
            kinds.isNotEmpty() && CATEGORIES.none { t[it] in HOMES }
        }
        val best = places.filter { it.distanceM <= 0.5 }.minByOrNull { it.squareMeters }
            ?: places.filter { it.distanceM <= NEAR_M }.minByOrNull { it.distanceM }
            ?: return ""
        val short = best.tags["short_name"]?.trim().orEmpty()
        return (if (short.isNotEmpty() && !looksLikeAddress(short)) short else best.tags["name"]!!.trim()).take(MAX_SENT)
    }

    /** Postpass's GeoJSON answer (properties: the tags asked for, plus `m2` and `d`, meters from the spot). */
    fun areasFromPostpass(json: JSONObject): List<Area> {
        val features = json.optJSONArray("features") ?: return emptyList()
        return (0 until features.length()).mapNotNull { i ->
            val p = features.optJSONObject(i)?.optJSONObject("properties") ?: return@mapNotNull null
            val tags = HashMap<String, String>()
            for (k in p.keys()) if (k != "m2" && k != "d" && !p.isNull(k)) tags[k] = p.optString(k)
            Area(tags, p.optDouble("m2", Double.MAX_VALUE), p.optDouble("d", 0.0))
        }
    }

    /** Overpass's `out tags bb` answer: the size is estimated from each area's bounding box. */
    fun areasFromOverpass(json: JSONObject): List<Area> {
        val elements = json.optJSONArray("elements") ?: return emptyList()
        return (0 until elements.length()).mapNotNull { i ->
            val e = elements.optJSONObject(i) ?: return@mapNotNull null
            val t = e.optJSONObject("tags") ?: return@mapNotNull null
            val tags = HashMap<String, String>()
            for (k in t.keys()) tags[k] = t.optString(k)
            val b = e.optJSONObject("bounds")
            val m2 = if (b == null) Double.MAX_VALUE else {
                val midLat = Math.toRadians((b.optDouble("minlat") + b.optDouble("maxlat")) / 2)
                val h = (b.optDouble("maxlat") - b.optDouble("minlat")) * 111_320.0
                val w = (b.optDouble("maxlon") - b.optDouble("minlon")) * 111_320.0 * Math.cos(midLat)
                h * w
            }
            Area(tags, m2)
        }
    }

    /** Words that only say what kind of place it is ("we know it's a church"); dropped from the end of a name. */
    private val KIND_SUFFIXES = listOf(
        "Medical Center", "Medical Centre", "Hospital", "Church", "Chapel", "Cathedral", "Parish", "School",
    )

    /** Where a long name may be cut ("Riverside Valley Medical Center & Research Institute"). */
    private val SEPARATORS = listOf(" & ", " and ", " – ", " — ", " - ", " (", ", ", " / ", ": ", " | ")

    /** Names longer than this are cut at a separator. */
    private const val CUT_AT = 24

    /**
     * A shorter name for the caption: cut at a separator when long, then without a last word that only says
     * what kind of place it is, when at least two words are left ("Hope Fellowship Church" → "Hope
     * Fellowship"; "Grace Church" stays).
     */
    fun shorten(name: String): String {
        var n = name.trim()
        if (n.length > CUT_AT) {
            val cut = SEPARATORS.mapNotNull { s -> n.indexOf(s).takeIf { it >= 4 } }.minOrNull()
            if (cut != null) n = n.substring(0, cut).trim()
        }
        for (suffix in KIND_SUFFIXES) {
            if (n.endsWith(" $suffix", ignoreCase = true)) {
                val rest = n.dropLast(suffix.length + 1).trimEnd(' ', ',', '-')
                if (rest.split(' ').count { it.isNotBlank() } >= 2) n = rest
                break
            }
        }
        return n
    }

    /** The private place (home) a spot is in: the smallest one that holds it, or null. */
    fun privateAt(lat: Double, lon: Double, places: List<ConfigStore.PrivatePlace>): ConfigStore.PrivatePlace? =
        places.filter { PlaceIndex.distanceKm(lat, lon, it.lat, it.lon) * 1000 <= it.radiusM }.minByOrNull { it.radiusM }

    /** A name typed for one photo, as typed (no filters, no shortening), with the town: "Backyard, Springfield, IL". */
    fun typedCaption(label: String, town: String?): String = withTown(label.trim(), town?.trim()?.takeIf { it.isNotEmpty() })

    /** A name the user gave a place ("Home"): just that name (user request 2026-10-19); no name: the town. */
    fun labelCaption(label: String?, town: String?): String? =
        label?.trim()?.takeIf { it.isNotEmpty() } ?: town?.trim()?.takeIf { it.isNotEmpty() }

    /** Within this distance of an earlier lookup, its answer is used again (user decision 2026-10-19). */
    const val SAME_SPOT_M = 50.0

    /** An earlier answer within [SAME_SPOT_M] of the spot (the nearest), or null. */
    fun sameSpot(lat: Double, lon: Double, earlier: List<Triple<Double, Double, String>>): String? =
        earlier.map { (la, lo, name) -> PlaceIndex.distanceKm(lat, lon, la, lo) * 1000 to name }
            .filter { it.first <= SAME_SPOT_M }.minByOrNull { it.first }?.second

    /** The caption's location: "Name, Town", just the name when it already says the town, or just the town. */
    fun caption(name: String?, town: String?): String? {
        val t = town?.trim()?.takeIf { it.isNotEmpty() }
        val n = name?.trim()?.takeIf { isPrecise(it, t) }?.let { shorten(it) }?.takeIf { isPrecise(it, t) } ?: return t
        val shown = if (n.length <= MAX_NAME) n else n.take(MAX_NAME - 1).trimEnd(' ', ',', '-', '–', '.', ';', ':') + "…"
        return withTown(shown, t) // a cut name that lost the town gets the whole town back
    }
}
