package app.openframe

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PIN check with lockouts and signed browser sessions (SPEC §16a). Pure JVM, unit-tested.
 *
 * - Per address: [MAX_TRIES] wrong PINs in a row lock it for 1 min, doubling per lockout up to 15 min.
 *   A correct PIN resets it.
 * - All addresses together: more than [GLOBAL_MAX_FAILS] wrong PINs in 10 min lock everyone for 5 min
 *   (someone cycling addresses).
 * - Session token: "<expiry ms>.<HMAC-SHA256(key, expiry)>". Changing the key (new PIN) ends all sessions.
 */
class PinGuard(
    private val sessionMs: Long = 24 * 3600_000L,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    sealed class Login {
        data class Ok(val token: String) : Login()
        data class Wrong(val triesLeft: Int) : Login()
        data class Locked(val seconds: Int) : Login()
        object NoPin : Login()
    }

    private class Address(var fails: Int = 0, var lockouts: Int = 0, var lockedUntil: Long = 0)

    private val addresses = HashMap<String, Address>()
    private val recentFails = ArrayDeque<Long>()
    private var globalLockedUntil = 0L

    @Synchronized
    fun login(ip: String, attempt: String, pin: String?, key: ByteArray): Login {
        if (pin == null) return Login.NoPin
        val now = clock()
        val a = addresses.getOrPut(ip) { Address() }
        val lockedUntil = maxOf(a.lockedUntil, globalLockedUntil)
        if (now < lockedUntil) return Login.Locked(((lockedUntil - now + 999) / 1000).toInt())

        if (MessageDigest.isEqual(attempt.toByteArray(), pin.toByteArray())) {
            addresses.remove(ip)
            return Login.Ok(token(key))
        }

        while (recentFails.isNotEmpty() && now - recentFails.first() > GLOBAL_WINDOW_MS) recentFails.removeFirst()
        recentFails.addLast(now)
        if (recentFails.size > GLOBAL_MAX_FAILS) {
            globalLockedUntil = now + GLOBAL_LOCK_MS
            recentFails.clear()
            return Login.Locked((GLOBAL_LOCK_MS / 1000).toInt())
        }
        a.fails++
        if (a.fails >= MAX_TRIES) {
            val lockMs = minOf(BASE_LOCK_MS shl a.lockouts, MAX_LOCK_MS)
            a.lockouts++
            a.fails = 0
            a.lockedUntil = now + lockMs
            if (addresses.size > MAX_ADDRESSES) addresses.entries.removeAll { it.value.lockedUntil < now && it.key != ip }
            return Login.Locked((lockMs / 1000).toInt())
        }
        return Login.Wrong(MAX_TRIES - a.fails)
    }

    fun token(key: ByteArray): String {
        val expiry = clock() + sessionMs
        return "$expiry.${sign(key, expiry)}"
    }

    fun verify(token: String?, key: ByteArray): Boolean {
        if (token == null) return false
        val expiry = token.substringBefore('.', "").toLongOrNull() ?: return false
        if (expiry <= clock() || expiry > clock() + sessionMs) return false
        return MessageDigest.isEqual(token.substringAfter('.').toByteArray(), sign(key, expiry).toByteArray())
    }

    private fun sign(key: ByteArray, expiry: Long): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(expiry.toString().toByteArray()).joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val MAX_TRIES = 5
        const val BASE_LOCK_MS = 60_000L
        const val MAX_LOCK_MS = 15 * 60_000L
        const val GLOBAL_MAX_FAILS = 30
        const val GLOBAL_WINDOW_MS = 10 * 60_000L
        const val GLOBAL_LOCK_MS = 5 * 60_000L
        const val MAX_ADDRESSES = 200
        val PIN_FORMAT = Regex("^\\d{4,8}$")
    }
}
