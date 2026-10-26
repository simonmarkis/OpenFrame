package app.openframe

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class PowerLogTest {

    private fun entry(result: String, boot: Int?) =
        JSONObject().put("at", 1L).put("action", "restart").put("result", result).put("bootCount", boot ?: JSONObject.NULL)

    @Test fun theNextBootFollowsAnAcceptedPress() {
        assertTrue(PowerLog.startedAfter(entry("requested", 33), 34))
    }

    @Test fun otherBootsDoNot() {
        assertFalse(PowerLog.startedAfter(entry("requested", 33), 33)) // still the same start (it failed, or not yet)
        assertFalse(PowerLog.startedAfter(entry("requested", 33), 35)) // another start came in between
        assertFalse(PowerLog.startedAfter(entry("failed: no root", 33), 34))
        assertFalse(PowerLog.startedAfter(entry("requested", null), 34))
        assertFalse(PowerLog.startedAfter(entry("requested", 33), null))
    }

    @Test fun keepsTheLatestTwentyAcrossInstances() {
        val dir = Files.createTempDirectory("powerlog").toFile()
        try {
            repeat(25) { PowerLog(dir).record("shutdown", it, "requested", now = it.toLong()) }
            val list = PowerLog(dir).list()
            assertEquals(20, list.length())
            assertEquals(5L, list.getJSONObject(0).getLong("at"))
            val s = PowerLog(dir).summary(25)
            assertEquals(24, s.getJSONObject("last").getInt("bootCount"))
            assertTrue(s.getBoolean("startedAfter"))
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun aSlowRebootReportedAsFailedStillCounts() {
        val dir = Files.createTempDirectory("powerlog").toFile()
        try {
            val log = PowerLog(dir)
            log.record("restart", 40, "requested", now = 1)
            log.record("restart", 40, "failed: The frame didn't respond.", now = 2)
            assertTrue(log.summary(41).getBoolean("startedAfter"))
            assertFalse(log.summary(40).getBoolean("startedAfter"))
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun noFileMeansNoPress() {
        val dir = Files.createTempDirectory("powerlog").toFile()
        try {
            val s = PowerLog(dir).summary(3)
            assertTrue(s.isNull("last"))
            assertFalse(s.getBoolean("startedAfter"))
        } finally {
            dir.deleteRecursively()
        }
    }
}
