package app.openframe

import android.util.Log
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import java.security.SecureRandom
import java.util.Base64

/**
 * Web access PIN (SPEC §16a). Requests from the frame itself (loopback: its WebView, the shell's own
 * fetches, adb port forwarding) never need it. Every other device must sign in with the PIN first,
 * and is blocked entirely until a PIN has been set on the frame.
 *
 * The PIN is kept readable in `secrets.json` because the user wants to see it in Settings.
 * Sessions are signed cookies valid for 1 day; changing the PIN rotates the key, ending all sessions.
 */
class WebAccess(private val secrets: SecretsStore) {

    private val guard = PinGuard()

    val pin: String? get() = secrets.get(PIN_KEY)

    fun isLocal(session: IHTTPSession): Boolean = session.remoteIpAddress in LOOPBACK

    fun allowed(session: IHTTPSession): Boolean =
        isLocal(session) || (pin != null && guard.verify(session.cookies.read(COOKIE), key()))

    fun login(session: IHTTPSession, attempt: String): PinGuard.Login {
        val r = guard.login(session.remoteIpAddress ?: "?", attempt.trim(), pin, key())
        when (r) {
            is PinGuard.Login.Ok -> Log.i(TAG, "Web sign-in from ${session.remoteIpAddress}")
            is PinGuard.Login.Locked -> Log.w(TAG, "Web sign-in locked for ${session.remoteIpAddress} (${r.seconds} s)")
            else -> Unit
        }
        return r
    }

    /** Sets a new PIN and ends every session. Returns a fresh token for the browser that changed it. */
    fun setPin(newPin: String): String {
        require(PinGuard.PIN_FORMAT.matches(newPin)) { "The PIN must be 4 to 8 digits" }
        val newKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
        secrets.put(mapOf(PIN_KEY to newPin, KEY_KEY to Base64.getEncoder().encodeToString(newKey)))
        Log.i(TAG, "Web access PIN changed; all browser sessions ended")
        return guard.token(newKey)
    }

    /**
     * Upload key for the iPhone Shortcut (user decision): allows `POST /api/upload` only, nothing else.
     * Created on first use; renewing it invalidates the old one. Sent as `X-Upload-Key` (or `?key=`).
     */
    fun uploadKey(): String = secrets.get(UPLOAD_KEY_KEY) ?: renewUploadKey()

    fun renewUploadKey(): String {
        val rnd = SecureRandom()
        val key = (1..26).map { KEY_ALPHABET[rnd.nextInt(KEY_ALPHABET.length)] }.joinToString("")
        secrets.put(mapOf(UPLOAD_KEY_KEY to key))
        Log.i(TAG, "Upload key renewed")
        return key
    }

    fun uploadKeyMatches(session: IHTTPSession): Boolean {
        val sent = session.headers["x-upload-key"] ?: session.parameters["key"]?.firstOrNull() ?: return false
        val key = secrets.get(UPLOAD_KEY_KEY) ?: return false
        return java.security.MessageDigest.isEqual(sent.trim().toByteArray(), key.toByteArray())
    }

    fun cookieHeader(token: String?): String =
        if (token == null) "$COOKIE=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"
        else "$COOKIE=$token; Max-Age=${SESSION_SEC}; Path=/; HttpOnly; SameSite=Strict"

    private fun key(): ByteArray {
        secrets.get(KEY_KEY)?.let { return Base64.getDecoder().decode(it) }
        val k = ByteArray(32).also { SecureRandom().nextBytes(it) }
        secrets.put(mapOf(KEY_KEY to Base64.getEncoder().encodeToString(k)))
        return k
    }

    private companion object {
        const val PIN_KEY = "webPin"
        const val KEY_KEY = "webSessionKey"
        const val UPLOAD_KEY_KEY = "uploadKey"
        const val KEY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789" // no l/o/0/1: easy to read and type
        const val COOKIE = "of_session"
        const val SESSION_SEC = 86_400
        val LOOPBACK = setOf("127.0.0.1", "::1", "0:0:0:0:0:0:0:1")
    }
}
