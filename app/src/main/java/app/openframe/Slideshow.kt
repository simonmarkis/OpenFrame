package app.openframe

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.ArrayDeque
import kotlin.random.Random

/**
 * Slideshow order and position (SPEC §7). Lives natively so it survives UI reloads and reboots.
 *
 * - Shuffle: every photo once per cycle (a "deck"), then a fresh permutation.
 * - Date taken / date added: sorted, wrapping; `reverse` flips the direction.
 * - Newly added photos jump the queue (shown next) in every order mode, and are removed from the
 *   current shuffle deck so they aren't shown twice in the cycle.
 * - prev/next walk a bounded history, so "previous" after "previous" goes further back.
 */
class Slideshow(context: Context, private val db: MediaDb, private val config: ConfigStore) {

    private val stateFile = File(context.filesDir, "slideshow.json")
    private val lock = Any()

    private var playable: Map<Long, MediaDb.Playable> = emptyMap()
    private var libraryDirty = true
    private var departed: MediaDb.Playable? = null // last current photo that left the playable set

    private var current: Long? = null
    private val deck = ArrayList<Long>()          // shuffle: remaining ids in this cycle
    private val priority = ArrayDeque<Long>()     // newly added, shown next
    private val back = ArrayDeque<Long>()         // history for prev
    private val forward = ArrayDeque<Long>()      // re-walk after prev
    private var orderKey = ""
    private var lastSave = 0L
    private var videos = config.video.include

    init {
        restore()
        config.addListener {
            synchronized(lock) {
                if (config.video.include != videos) {
                    videos = config.video.include
                    libraryDirty = true
                }
                val key = orderKeyOf(config.slideshow)
                if (key != orderKey) {
                    Log.i(TAG, "Slideshow order changed to $key; resetting deck")
                    orderKey = key
                    deck.clear(); forward.clear()
                    persist(force = true)
                }
            }
        }
    }

    fun onLibraryChanged() = synchronized(lock) { libraryDirty = true }

    fun onItemReady(id: Long, isNew: Boolean) = synchronized(lock) {
        libraryDirty = true
        if (isNew && id !in priority) {
            priority.addLast(id)
            deck.remove(id)
            persist(force = true)
        }
    }

    /** Current slide id; picks one if nothing is current yet. */
    fun current(): Long? = synchronized(lock) {
        refreshIfDirty()
        val c = current
        if (c != null && c in playable) return c
        current = null
        advance()
        current
    }

    fun next(): Long? = synchronized(lock) {
        refreshIfDirty()
        advance()
        current
    }

    fun prev(): Long? = synchronized(lock) {
        refreshIfDirty()
        while (back.isNotEmpty()) {
            val id = back.removeLast()
            if (id !in playable) continue
            current?.let { forward.addLast(it) }
            current = id
            persist()
            return current
        }
        current // nothing earlier: stay put
    }

    fun playableCount(): Int = synchronized(lock) { refreshIfDirty(); playable.size }

    // ---- internals (call with lock held) ----

    private fun advance() {
        val next = pickNext()
        current?.let { prev ->
            if (prev != next) {
                back.addLast(prev)
                while (back.size > HISTORY) back.removeFirst()
            }
        }
        current = next
        persist()
    }

    private fun pickNext(): Long? {
        if (playable.isEmpty()) return null
        while (forward.isNotEmpty()) {
            val id = forward.removeLast()
            if (id in playable) return id
        }
        while (priority.isNotEmpty()) {
            val id = priority.removeFirst()
            if (id in playable) return id
        }
        val s = config.slideshow
        return if (s.order == "shuffle") nextShuffled() else nextSorted(s.order, s.reverse)
    }

    private fun nextShuffled(): Long? {
        while (deck.isNotEmpty()) {
            val id = deck.removeAt(0)
            if (id in playable) return id
        }
        // New cycle: fresh permutation, not starting with what is on screen now.
        val ids = playable.keys.shuffled(Random(SystemClock.elapsedRealtimeNanos()))
        deck.addAll(ids)
        if (deck.size > 1 && deck[0] == current) deck.add(deck.removeAt(0))
        return deck.removeAt(0)
    }

    private fun nextSorted(order: String, reverse: Boolean): Long? {
        val base = when (order) {
            "date_added" -> compareBy<MediaDb.Playable>({ it.addedAt }, { it.id })
            else -> compareBy<MediaDb.Playable>({ it.takenKey }, { it.id })
        }
        val cmp = if (reverse) base.reversed() else base
        val sorted = playable.values.sortedWith(cmp)
        // A current photo that was just hidden or deleted still marks the place in the order.
        val cur = current?.let { playable[it] ?: departed?.takeIf { d -> d.id == it } } ?: return sorted.first().id
        // First item strictly after the current one in this order; wraps at the end.
        val after = sorted.firstOrNull { cmp.compare(it, cur) > 0 }
        return (after ?: sorted.first()).id
    }

    private fun refreshIfDirty() {
        if (!libraryDirty) return
        libraryDirty = false
        val before = current?.let { playable[it] }
        playable = db.playable(videos).associateBy { it.id }
        if (before != null && before.id !in playable) departed = before
    }

    private fun orderKeyOf(s: ConfigStore.SlideshowConfig) = "${s.order}:${s.reverse}"

    // ---- persistence (throttled; the deck can be thousands of ids) ----

    private fun persist(force: Boolean = false) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastSave < SAVE_INTERVAL_MS) return
        lastSave = now
        val json = JSONObject()
            .put("current", current ?: JSONObject.NULL)
            .put("orderKey", orderKey)
            .put("deck", JSONArray(deck))
            .put("priority", JSONArray(priority.toList()))
            .put("back", JSONArray(back.toList()))
        try {
            val tmp = File(stateFile.parentFile, stateFile.name + ".tmp")
            tmp.writeText(json.toString())
            tmp.renameTo(stateFile)
        } catch (e: Exception) {
            Log.e(TAG, "Could not save slideshow state", e)
        }
    }

    private fun restore() {
        orderKey = orderKeyOf(config.slideshow)
        if (!stateFile.isFile) return
        try {
            val j = JSONObject(stateFile.readText())
            if (!j.isNull("current")) current = j.getLong("current")
            fun JSONArray.longs() = (0 until length()).map { getLong(it) }
            if (j.optString("orderKey") == orderKey) deck.addAll(j.getJSONArray("deck").longs())
            priority.addAll(j.optJSONArray("priority")?.longs() ?: emptyList())
            back.addAll(j.optJSONArray("back")?.longs() ?: emptyList())
        } catch (e: Exception) {
            Log.e(TAG, "Slideshow state unreadable; starting fresh", e)
        }
    }

    private companion object {
        const val HISTORY = 100
        const val SAVE_INTERVAL_MS = 60_000L
    }
}
