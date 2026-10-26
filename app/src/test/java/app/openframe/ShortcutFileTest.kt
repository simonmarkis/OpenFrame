package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ShortcutFileTest {

    private fun bytes(head: String, size: Int = 512) = head.toByteArray(Charsets.US_ASCII).copyOf(size)

    @Test fun signedAndPlistShortcutsAreAccepted() {
        assertNull(ShortcutFile.problem(bytes("AEA1")))      // iOS 15+ signed export
        assertNull(ShortcutFile.problem(bytes("bplist00")))  // older, unsigned
    }

    @Test fun otherFilesAreRefused() {
        assertNotNull(ShortcutFile.problem(bytes("ÿØÿàJFIF")))
        assertNotNull(ShortcutFile.problem(bytes("PK\u0003\u0004")))
        assertNotNull(ShortcutFile.problem(bytes("-12.3456", 8)))
        assertEquals("That isn't a Shortcut file.", ShortcutFile.problem(bytes("AEA1", 20)))
    }
}
