package app.openframe

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ConfigHistoryTest {

    private var now = 1_000_000L
    private val dir: File = Files.createTempDirectory("config-history").toFile()
    private fun history(keep: Int = 20) = ConfigHistory(dir, keep = keep, coalesceMs = 60_000, clock = { now })

    private fun cfg(interval: Int, corner: String = "top-right") =
        JSONObject("""{"slideshow":{"intervalSec":$interval},"clock":{"corner":"$corner","shadow":0.6}}""")

    @Test fun changesWithinAMinuteShareOneSnapshot() {
        val h = history()
        assertNotNull(h.record(cfg(30)))
        now += 20_000
        assertNull(h.record(cfg(31)))
        now += 50_000 // rolling window: 50 s after the last change
        assertNull(h.record(cfg(32)))
        now += 61_000
        assertNotNull(h.record(cfg(33)))
        assertEquals(2, h.list(cfg(34)).length())
    }

    @Test fun forceAlwaysSnapshots() {
        val h = history()
        h.record(cfg(30))
        now += 1_000
        assertNotNull(h.record(cfg(45), force = true))
    }

    @Test fun identicalToNewestIsNotDuplicated() {
        val h = history()
        h.record(cfg(30))
        now += 120_000
        // Same content with keys in another order.
        assertNull(h.record(JSONObject("""{"clock":{"shadow":0.6,"corner":"top-right"},"slideshow":{"intervalSec":30}}""")))
    }

    @Test fun keepsOnlyTheNewest() {
        val h = history(keep = 3)
        for (i in 1..5) {
            h.record(cfg(i))
            now += 120_000
        }
        val list = h.list(cfg(99))
        assertEquals(3, list.length())
        val oldest = list.getJSONObject(2).getLong("id")
        assertEquals(3, h.get(oldest)!!.getJSONObject("slideshow").getInt("intervalSec"))
    }

    @Test fun listNamesTheSectionsChangedAfterEachSnapshot() {
        val h = history()
        h.record(cfg(30))
        now += 120_000
        h.record(cfg(45))
        val list = h.list(cfg(45, corner = "bottom-left"))
        // Newest first: the newest snapshot is followed by the current config (clock changed).
        assertEquals(listOf("clock"), names(list.getJSONObject(0)))
        assertEquals(listOf("slideshow"), names(list.getJSONObject(1)))
    }

    @Test fun canonicalIgnoresKeyOrderAndIntegralDoubles() {
        assertEquals(ConfigHistory.canonical(JSONObject("""{"a":1,"b":[1,2]}""")),
            ConfigHistory.canonical(JSONObject().put("b", org.json.JSONArray().put(1).put(2)).put("a", 1.0)))
    }

    private fun names(o: JSONObject): List<String> {
        val a = o.getJSONArray("changed")
        return (0 until a.length()).map { a.getString(it) }
    }
}
