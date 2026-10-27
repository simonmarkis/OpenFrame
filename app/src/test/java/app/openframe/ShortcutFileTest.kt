package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShortcutFileTest {

    private fun bytes(head: String, size: Int = 512) = head.toByteArray(Charsets.US_ASCII).copyOf(size)

    @Test fun signedAndPlistShortcutsAreAccepted() {
        assertNull(ShortcutFile.problem(bytes("AEA1")))      // iOS 15+ signed export
        assertNull(ShortcutFile.problem(bytes("bplist00")))  // older, unsigned
    }

    @Test fun hostsAreCleanedAndLoopbackSkipped() {
        assertEquals("openframe.local", ShortcutFile.cleanHost("OpenFrame.local:8080"))
        assertEquals("192.168.1.20", ShortcutFile.cleanHost("192.168.1.20:8080"))
        assertNull(ShortcutFile.cleanHost("127.0.0.1:8080"))   // the frame itself, adb forward
        assertNull(ShortcutFile.cleanHost("localhost"))
        assertNull(ShortcutFile.cleanHost("evil/../x"))
        assertNull(ShortcutFile.cleanHost(null))
    }

    @Test fun onlyAnOldIpIsOutOfDate() {
        assertTrue(ShortcutFile.addressChanged("192.168.1.20", "192.168.1.21"))
        assertFalse(ShortcutFile.addressChanged("192.168.1.20", "192.168.1.20"))
        assertFalse(ShortcutFile.addressChanged("openframe.local", "192.168.1.21")) // a name follows the frame
        assertFalse(ShortcutFile.addressChanged("192.168.1.20", null))              // no network right now
        assertFalse(ShortcutFile.addressChanged(null, "192.168.1.21"))
    }

    @Test fun lastSendIsRememberedAndWarnsAfterAnIpChange() {
        val dir = java.nio.file.Files.createTempDirectory("shortcut").toFile()
        try {
            val f = ShortcutFile(dir)
            assertNull(f.lastSend())
            f.recordSend("127.0.0.1:8080", now = 1)
            assertNull(f.lastSend())
            f.recordSend("192.168.1.20:8080", now = 5)
            assertEquals("192.168.1.20" to 5L, f.lastSend())
            assertNull(f.movedFrom("192.168.1.20"))
            assertEquals("192.168.1.20", f.movedFrom("192.168.1.21"))
            f.recordSend("openframe.local:8080", now = 9)
            assertNull(f.movedFrom("192.168.1.21"))
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun otherFilesAreRefused() {
        assertNotNull(ShortcutFile.problem(bytes("ÿØÿàJFIF")))
        assertNotNull(ShortcutFile.problem(bytes("PK\u0003\u0004")))
        assertNotNull(ShortcutFile.problem(bytes("-12.3456", 8)))
        assertEquals("That isn't a Shortcut file.", ShortcutFile.problem(bytes("AEA1", 20)))
    }
}
