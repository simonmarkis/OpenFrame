package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinGuardTest {

    private var now = 1_000_000_000L
    private val key = ByteArray(32) { it.toByte() }
    private val guard = PinGuard(sessionMs = 86_400_000L, clock = { now })

    @Test fun correctPinGivesAWorkingOneDaySession() {
        val r = guard.login("10.0.0.2", "1234", "1234", key)
        assertTrue(r is PinGuard.Login.Ok)
        val token = (r as PinGuard.Login.Ok).token
        assertTrue(guard.verify(token, key))
        now += 86_400_000L - 1
        assertTrue(guard.verify(token, key))
        now += 2
        assertFalse(guard.verify(token, key))
    }

    @Test fun newKeyEndsSessionsAndForgedTokensFail() {
        val token = (guard.login("ip", "1234", "1234", key) as PinGuard.Login.Ok).token
        assertFalse(guard.verify(token, ByteArray(32) { 7 }))
        assertFalse(guard.verify("${now + 1000}.deadbeef", key))
        assertFalse(guard.verify("garbage", key))
        assertFalse(guard.verify(null, key))
        // Extending the expiry invalidates the signature.
        val sig = token.substringAfter('.')
        assertFalse(guard.verify("${now + 3_600_000}.$sig", key))
    }

    @Test fun noPinMeansBlocked() {
        assertEquals(PinGuard.Login.NoPin, guard.login("ip", "1234", null, key))
    }

    @Test fun fiveWrongTriesLockTheAddressWithGrowingLockouts() {
        for (left in 4 downTo 1) assertEquals(PinGuard.Login.Wrong(left), guard.login("a", "0000", "1234", key))
        assertEquals(PinGuard.Login.Locked(60), guard.login("a", "0000", "1234", key))
        // Even the right PIN is refused while locked; other addresses are not affected.
        assertTrue(guard.login("a", "1234", "1234", key) is PinGuard.Login.Locked)
        assertEquals(PinGuard.Login.Wrong(4), guard.login("b", "0000", "1234", key))
        now += 60_000
        repeat(4) { guard.login("a", "0000", "1234", key) }
        assertEquals(PinGuard.Login.Locked(120), guard.login("a", "0000", "1234", key))
        now += 120_000
        assertTrue(guard.login("a", "1234", "1234", key) is PinGuard.Login.Ok)
        assertEquals(PinGuard.Login.Wrong(4), guard.login("a", "0000", "1234", key)) // reset after success
    }

    @Test fun manyFailuresFromManyAddressesLockEveryone() {
        var locked = false
        for (i in 0 until 40) {
            if (guard.login("10.0.0.$i", "0000", "1234", key) is PinGuard.Login.Locked) { locked = true; break }
        }
        assertTrue(locked)
        assertTrue(guard.login("10.9.9.9", "1234", "1234", key) is PinGuard.Login.Locked)
        now += PinGuard.GLOBAL_LOCK_MS
        assertTrue(guard.login("10.9.9.9", "1234", "1234", key) is PinGuard.Login.Ok)
    }

    @Test fun pinFormat() {
        assertTrue(PinGuard.PIN_FORMAT.matches("1234"))
        assertTrue(PinGuard.PIN_FORMAT.matches("12345678"))
        assertFalse(PinGuard.PIN_FORMAT.matches("123"))
        assertFalse(PinGuard.PIN_FORMAT.matches("123456789"))
        assertFalse(PinGuard.PIN_FORMAT.matches("12a4"))
    }
}
