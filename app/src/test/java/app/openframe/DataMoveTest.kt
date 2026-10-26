package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class DataMoveTest {

    private fun dirs(): Pair<File, File> {
        val root = Files.createTempDirectory("move").toFile()
        return File(root, "source").apply { mkdirs() } to File(root, "data").apply { mkdirs() }
    }

    private fun write(base: File, rel: String, text: String) = File(base, rel).apply { parentFile.mkdirs(); writeText(text) }

    private fun source(s: File) {
        write(s, "files/config.json", "{\"c\":1}")
        write(s, "files/secrets.json", "{\"s\":1}")
        write(s, "files/shortcut/send-to-frame.shortcut", "AEA1")
        write(s, "databases/media.db", "db")
        write(s, "databases/media.db-wal", "wal")
        write(s, "shared_prefs/clock.xml", "<map/>")
        write(s, "other/ignored.txt", "x") // only the three app folders
    }

    @Test fun nothingWithoutTheMarker() {
        val (s, d) = dirs()
        source(s)
        assertEquals(DataMove.Result.NotAsked, DataMove.run(s, d))
        assertFalse(File(d, "files/config.json").exists())
    }

    @Test fun movesEverythingIntoAFreshInstall() {
        val (s, d) = dirs()
        source(s)
        write(s, DataMove.READY, "")
        write(d, "files/restarts.json", "[]") // a fresh install may already have written a little
        val r = DataMove.run(s, d)
        assertEquals(DataMove.Result.Moved(6), r)
        assertEquals("{\"c\":1}", File(d, "files/config.json").readText())
        assertEquals("AEA1", File(d, "files/shortcut/send-to-frame.shortcut").readText())
        assertEquals("wal", File(d, "databases/media.db-wal").readText())
        assertEquals("<map/>", File(d, "shared_prefs/clock.xml").readText())
        assertEquals("[]", File(d, "files/restarts.json").readText())
        assertFalse(File(d, "other/ignored.txt").exists())
        assertTrue(d.walkTopDown().none { it.name.endsWith(".moving") })
    }

    @Test fun neverOverwritesAnInstallThatHasSettings() {
        val (s, d) = dirs()
        source(s)
        write(s, DataMove.READY, "")
        write(d, "files/config.json", "{\"mine\":1}")
        assertEquals(DataMove.Result.SkippedHasData, DataMove.run(s, d))
        assertEquals("{\"mine\":1}", File(d, "files/config.json").readText())
        assertFalse(File(d, "files/secrets.json").exists())
    }

    @Test fun noSettingsFileIsAFailure() {
        val (s, d) = dirs()
        write(s, "databases/media.db", "db")
        write(s, DataMove.READY, "")
        assertTrue(DataMove.run(s, d) is DataMove.Result.Failed)
        assertFalse(File(d, "files/config.json").exists())
    }
}
