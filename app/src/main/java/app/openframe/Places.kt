package app.openframe

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log

/**
 * Photo locations for the caption (SPEC §8): fills `media.place` with the city name for photos
 * with GPS, in the background, and answers place searches (Settings → Photo caption → places to
 * leave out). The city list ([PlaceIndex], ~1 MB in memory) is loaded only while needed and
 * released after [IDLE_RELEASE_MS].
 */
class Places(private val app: OpenFrameApp) {

    private val thread = HandlerThread("OpenFrame-places", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)
    private val lock = Any()
    private var index: PlaceIndex? = null
    private val release = Runnable { synchronized(lock) { index = null } }

    fun start() {
        handler.post {
            // Towns named before the state was added ("Seattle"): named again ("Seattle, WA").
            try { app.mediaDb.clearTownsWithoutRegion() } catch (e: Exception) { Log.e(TAG, "Places: reset failed", e) }
        }
        handler.postDelayed({ fill() }, START_DELAY_MS)
    }

    /** New photos may have GPS: look them up soon (coalesced). */
    fun requestFill() {
        handler.removeCallbacks(fillRunnable)
        handler.postDelayed(fillRunnable, FILL_DELAY_MS)
    }

    private val fillRunnable = Runnable { fill() }

    fun search(query: String, limit: Int): List<PlaceIndex.Place> = withIndex { it.search(query, limit) }

    private fun <T> withIndex(block: (PlaceIndex) -> T): T {
        val idx = synchronized(lock) {
            handler.removeCallbacks(release)
            index ?: load().also { index = it }
        }
        try {
            return block(idx)
        } finally {
            handler.postDelayed(release, IDLE_RELEASE_MS)
        }
    }

    private fun load(): PlaceIndex {
        val t0 = System.currentTimeMillis()
        val idx = app.assets.open("geo/cities.tsv").bufferedReader().useLines { PlaceIndex(it) }
        Log.i(TAG, "Places: ${idx.size} places loaded in ${System.currentTimeMillis() - t0} ms")
        return idx
    }

    private fun fill() {
        try {
            val todo = app.mediaDb.withoutPlace(BATCH)
            if (todo.isEmpty()) { app.placeLookup.request(); return } // towns done: the precise names next
            withIndex { idx ->
                for ((id, lat, lon) in todo) {
                    // "" = looked up, nothing near (or no valid GPS): don't look again.
                    // "Seattle, WA" (the US state, else the country code: "Rome, IT"; user request 2026-10-19).
                    app.mediaDb.setPlace(id, idx.nearest(lat, lon)?.let { p -> if (p.region.isEmpty()) p.name else "${p.name}, ${p.region}" } ?: "")
                }
            }
            Log.i(TAG, "Places: ${todo.size} photo location(s) named")
            if (todo.size == BATCH) requestFill() else app.placeLookup.request()
        } catch (e: Exception) {
            Log.e(TAG, "Places: naming photo locations failed", e)
        }
    }

    companion object {
        private const val START_DELAY_MS = 30_000L
        private const val FILL_DELAY_MS = 5_000L
        private const val IDLE_RELEASE_MS = 120_000L
        private const val BATCH = 500

        /**
         * The photo's location: at a private place its name ("Home, Springfield") or the town; otherwise
         * "Name, Town" ([PlaceNames.caption]). Detailed location off: the town only. Null without GPS.
         */
        fun fullPlace(item: MediaDb.Item, caption: ConfigStore.CaptionConfig): String? {
            val label = item.placeLabel?.trim()?.takeIf { it.isNotEmpty() } // typed for this photo: wins over all
            // Added to a private place by hand: its name (unnamed: the town).
            val added = caption.privatePlaces.firstOrNull { it.key == item.privateKey }
            if (!PlaceIndex.validGps(item.lat, item.lon)) return label ?: added?.name?.takeIf { it.isNotEmpty() }
            if (!caption.detailedPlace) return item.place?.takeIf { it.isNotEmpty() }
            if (label != null) return PlaceNames.typedCaption(label, item.place)
            if (added != null) return PlaceNames.labelCaption(added.name, item.place)
            PlaceNames.privateAt(item.lat!!, item.lon!!, caption.privatePlaces)?.let { return PlaceNames.labelCaption(it.name, item.place) }
            return PlaceNames.caption(item.placeName, item.place)
        }

        /** Within the radius of a place left out (the caption shows no location there). */
        fun leftOut(lat: Double, lon: Double, caption: ConfigStore.CaptionConfig): Boolean {
            val radiusKm = caption.ignoreRadiusMi * PlaceIndex.KM_PER_MILE
            return caption.ignoredPlaces.any { PlaceIndex.distanceKm(lat, lon, it.lat, it.lon) <= radiusKm }
        }

        /** The caption's location for a photo: [fullPlace], unless within the radius of a place left out. */
        fun shownPlace(item: MediaDb.Item, caption: ConfigStore.CaptionConfig): String? {
            val place = fullPlace(item, caption) ?: return null
            if (!PlaceIndex.validGps(item.lat, item.lon)) return place
            return if (leftOut(item.lat!!, item.lon!!, caption)) null else place
        }
    }
}
