package app.openframe

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Config snapshots in `config-history/` (SPEC §16): the config as it was *before* a change.
 *
 * - Changes within [coalesceMs] of the previous change share one snapshot (instant-save settings:
 *   dragging a slider must not use up the history). Restore and import always snapshot ([force]).
 * - Keeps the newest [keep] snapshots.
 * - Pure JVM (no Android APIs) so it is unit-tested on the PC.
 */
class ConfigHistory(
    private val dir: File,
    private val keep: Int = 20,
    private val coalesceMs: Long = 60_000,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private var lastChangeAt = Long.MIN_VALUE / 2

    /**
     * Called before the config changes from [previous]. Returns the new snapshot's id, or null when
     * the change joined the previous snapshot (or [previous] equals the newest snapshot already).
     */
    @Synchronized
    fun record(previous: JSONObject, force: Boolean = false): Long? {
        val now = clock()
        val recent = now - lastChangeAt < coalesceMs
        lastChangeAt = now
        if (recent && !force) return null
        val ids = ids()
        if (ids.isNotEmpty() && read(ids.last())?.let { canonical(it) == canonical(previous) } == true) return null

        dir.mkdirs()
        var id = maxOf(now, (ids.lastOrNull() ?: 0) + 1)
        while (File(dir, "$id.json").exists()) id++
        val tmp = File(dir, "$id.json.tmp")
        tmp.writeText(previous.toString(2))
        if (!tmp.renameTo(File(dir, "$id.json"))) throw IllegalStateException("Could not save config snapshot")
        (ids + id).dropLast(keep).forEach { File(dir, "$it.json").delete() }
        return id
    }

    @Synchronized
    fun get(id: Long): JSONObject? = read(id)

    /**
     * Newest first: `{ id, savedAt, changed: [top-level sections that differ in the state after it] }`.
     * The state after the newest snapshot is [current].
     */
    @Synchronized
    fun list(current: JSONObject): JSONArray {
        val ids = ids()
        val configs = ids.map { read(it) }
        val out = JSONArray()
        for (i in ids.indices.reversed()) {
            val snap = configs[i] ?: continue
            val after = (i + 1 until ids.size).firstNotNullOfOrNull { configs[it] } ?: current
            out.put(JSONObject()
                .put("id", ids[i])
                .put("savedAt", ids[i])
                .put("changed", JSONArray(changedSections(snap, after))))
        }
        return out
    }

    private fun ids(): List<Long> =
        (dir.listFiles() ?: emptyArray())
            .mapNotNull { f -> f.name.removeSuffix(".json").takeIf { f.name.endsWith(".json") }?.toLongOrNull() }
            .sorted()

    private fun read(id: Long): JSONObject? = try {
        File(dir, "$id.json").takeIf { it.isFile }?.let { JSONObject(it.readText()) }
    } catch (e: Exception) {
        null // a damaged snapshot is skipped, not fatal
    }

    companion object {
        fun changedSections(a: JSONObject, b: JSONObject): List<String> =
            (a.keys().asSequence() + b.keys().asSequence()).toSortedSet()
                .filter { canonical(a.opt(it)) != canonical(b.opt(it)) }

        /** Key-order-independent JSON text, for comparing configs. */
        fun canonical(v: Any?): String = when (v) {
            null, JSONObject.NULL -> "null"
            is JSONObject -> v.keys().asSequence().sorted()
                .joinToString(",", "{", "}") { "${JSONObject.quote(it)}:${canonical(v.opt(it))}" }
            is JSONArray -> (0 until v.length()).joinToString(",", "[", "]") { canonical(v.opt(it)) }
            is String -> JSONObject.quote(v)
            is Number -> JSONObject.numberToString(v)
            else -> v.toString()
        }
    }
}
