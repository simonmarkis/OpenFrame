package app.openframe

import android.content.Context
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.net.wifi.WifiManager
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import android.system.StructTimeval
import android.util.Log
import java.io.Closeable
import java.io.FileDescriptor
import java.io.IOException
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.nio.ByteBuffer

/**
 * The frame's own name on the home network, `openframe.local` (V1.0.2, SPEC §17), so the iPhone Shortcut (and
 * later Home Assistant) still finds the frame when the router hands it a new IP.
 *
 * Android's own mDNS daemon (mdnsd, the one behind NsdManager) already holds UDP 5353 and answers for the
 * generic `android.local`, so the frame asks it to answer for our name too: an A record registered through
 * its dns_sd socket (`/dev/socket/mdnsd`, group inet), the messages Apple's `DNSServiceCreateConnection` and
 * `DNSServiceRegisterRecord` send. The record lives as long as the connection: when mdnsd restarts or the IP
 * changes, it is registered again. If another device already has the name: `openframe-2.local`, `-3`, ….
 */
class MdnsName(private val context: Context) {

    /** The name the frame answers to (e.g. "openframe.local"), null while it has none. */
    @Volatile var name: String? = null
        private set

    /** Why there is no name (for Settings and the log), null when there is one or no try yet. */
    @Volatile var problem: String? = null
        private set

    private var nsd: Any? = null
    private var multicast: WifiManager.MulticastLock? = null

    fun start() {
        // Holding NsdManager makes OpenFrame a client of Android's NsdService, which keeps mdnsd running.
        nsd = runCatching { context.getSystemService(Context.NSD_SERVICE) }.getOrNull()
        // With the screen off, Wi-Fi drops multicast (name lookups arrive that way) unless someone holds this.
        multicast = runCatching {
            (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                .createMulticastLock("OpenFrame name").apply { setReferenceCounted(false); acquire() }
        }.onFailure { Log.w(TAG, "Network name: no multicast lock (${it.message})") }.getOrNull()
        Thread({ loop() }, "MdnsName").apply { isDaemon = true }.start()
    }

    private fun loop() {
        var failures = 0
        while (true) {
            val ip = SystemInfo.ipv4()
            if (ip == null) {
                name = null
                Thread.sleep(CHECK_MS.toLong())
                continue
            }
            try {
                Session().use { s ->
                    val got = s.register(InetAddress.getByName(ip) as Inet4Address)
                    name = got
                    problem = null
                    failures = 0
                    Log.i(TAG, "Network name: $got ($ip)")
                    while (true) {
                        val error = s.awaitReply(CHECK_MS)
                        if (error != null) {
                            // Someone else claimed the name later (mdnsd then dropped ours): pick one again.
                            Log.w(TAG, "Network name $got lost (${errorText(error)}); registering again")
                            break
                        }
                        val now = SystemInfo.ipv4()
                        if (now != ip) {
                            Log.i(TAG, "Network name: the frame's address changed to ${now ?: "none"}")
                            break
                        }
                    }
                }
            } catch (e: IOException) {
                name = null
                problem = e.message
                failures++
                Log.w(TAG, "Network name: ${e.message}")
                Thread.sleep(minOf(RETRY_MAX_MS, CHECK_MS * failures).toLong())
            }
        }
    }

    /** One connection to mdnsd; closing it removes the record. */
    private class Session : Closeable {
        private val sock = LocalSocket()
        private val input: InputStream
        private var context = 0L
        private var index = 0

        init {
            try {
                sock.connect(LocalSocketAddress("mdnsd", LocalSocketAddress.Namespace.RESERVED))
            } catch (e: IOException) {
                throw IOException("Android's name service isn't running (${e.message})")
            }
            sock.soTimeout = REPLY_MS
            input = sock.inputStream
            sock.outputStream.write(header(OP_CONNECTION, 0, ++context, 0))
            val err = readInt(input)
            if (err != 0) throw IOException("Android's name service refused the connection (${errorText(err)})")
        }

        /** Registers the first free name; returns it. */
        fun register(ip: Inet4Address): String {
            for (n in 1..MAX_TRIES) {
                val candidate = candidate(n)
                val err = send(regRecordBody("$candidate.", ip.address), index++)
                if (err != 0) throw IOException("Android's name service refused $candidate (${errorText(err)})")
                val result = awaitReply(PROBE_MS) ?: throw IOException("No answer for $candidate")
                if (result == 0) return candidate
                if (result != ERR_NAME_CONFLICT) throw IOException("Couldn't register $candidate (${errorText(result)})")
                Log.i(TAG, "Network name: $candidate is taken on this network")
            }
            throw IOException("Names up to ${candidate(MAX_TRIES)} are all taken")
        }

        /**
         * A reg_record request. mdnsd answers its error code on a separate socket that comes with the message's
         * last byte (SCM_RIGHTS), as the dns_sd client library does; the body starts with an empty path for it.
         */
        private fun send(body: ByteArray, regIndex: Int): Int {
            val msg = header(OP_REG_RECORD, body.size, ++context, regIndex) + body
            val mine = FileDescriptor()
            val theirs = FileDescriptor()
            try {
                Os.socketpair(OsConstants.AF_UNIX, OsConstants.SOCK_STREAM, 0, mine, theirs)
                Os.setsockoptTimeval(mine, OsConstants.SOL_SOCKET, OsConstants.SO_RCVTIMEO, StructTimeval.fromMillis(REPLY_MS.toLong()))
                val out = sock.outputStream
                out.write(msg, 0, msg.size - 1)
                sock.setFileDescriptorsForSend(arrayOf(theirs))
                try { out.write(msg, msg.size - 1, 1) } finally { sock.setFileDescriptorsForSend(null) }
                Os.close(theirs)
                val b = ByteArray(4)
                var n = 0
                while (n < 4) {
                    val r = Os.read(mine, b, n, 4 - n)
                    if (r <= 0) throw IOException("Android's name service closed the answer socket")
                    n += r
                }
                return ByteBuffer.wrap(b).int
            } catch (e: ErrnoException) {
                throw IOException("Talking to Android's name service failed (${e.message})")
            } finally {
                if (theirs.valid()) runCatching { Os.close(theirs) }
                if (mine.valid()) runCatching { Os.close(mine) }
            }
        }

        /** Waits up to [ms] for a reg_record reply; its error code (0 = registered), or null if none came. */
        fun awaitReply(ms: Int): Int? {
            val pfd = StructPollfd().apply { fd = sock.fileDescriptor; events = OsConstants.POLLIN.toShort() }
            val ready = try { Os.poll(arrayOf(pfd), ms) } catch (e: ErrnoException) {
                if (e.errno == OsConstants.EINTR) return null
                throw IOException("Waiting for Android's name service failed (${e.message})")
            }
            if (ready == 0) return null
            val head = readFully(input, HEADER_BYTES)
            val h = ByteBuffer.wrap(head)
            h.int // version
            val dataLen = h.int
            h.int // ipc flags
            val op = h.int
            if (dataLen < 0 || dataLen > 4096) throw IOException("Android's name service sent a bad message")
            val data = readFully(input, dataLen)
            if (op != OP_REG_RECORD_REPLY) return null // nothing else is asked for on this connection
            return parseReplyError(data)
        }

        override fun close() {
            runCatching { sock.close() }
        }
    }

    companion object {
        private const val CHECK_MS = 15_000
        private const val RETRY_MAX_MS = 300_000
        private const val REPLY_MS = 5_000
        /** Probing takes about 0.75 s; give a busy network room. */
        private const val PROBE_MS = 10_000
        private const val MAX_TRIES = 9

        const val BASE_NAME = "openframe"
        const val HEADER_BYTES = 28
        const val OP_CONNECTION = 1
        const val OP_REG_RECORD = 2
        const val OP_REG_RECORD_REPLY = 69
        const val FLAG_UNIQUE = 0x20
        const val ERR_NAME_CONFLICT = -65548
        const val TTL_SECONDS = 120

        /** openframe.local, then openframe-2.local, …. */
        fun candidate(n: Int) = if (n <= 1) "$BASE_NAME.local" else "$BASE_NAME-$n.local"

        /** The dns_sd IPC header (dnssd_ipc.h, version 1, network byte order; the context is opaque). */
        fun header(op: Int, dataLen: Int, context: Long, regIndex: Int): ByteArray =
            ByteBuffer.allocate(HEADER_BYTES).putInt(1).putInt(dataLen).putInt(0).putInt(op)
                .putLong(context).putInt(regIndex).array()

        /**
         * DNSServiceRegisterRecord's body: an empty error-return path (the socket goes by SCM_RIGHTS), flags
         * (unique: mdnsd probes for a conflict first), interface 0 (all), the name, type A, class IN, the four
         * address bytes, and the TTL.
         */
        fun regRecordBody(fullName: String, address: ByteArray): ByteArray {
            val nameBytes = fullName.toByteArray(Charsets.UTF_8)
            val b = ByteBuffer.allocate(1 + 4 + 4 + nameBytes.size + 1 + 6 + address.size + 4)
            b.put(0)
            b.putInt(FLAG_UNIQUE).putInt(0)
            b.put(nameBytes).put(0)
            b.putShort(1).putShort(1).putShort(address.size.toShort()).put(address)
            b.putInt(TTL_SECONDS)
            return b.array()
        }

        /** A reg_record reply's body is flags, interface index, error code. */
        fun parseReplyError(data: ByteArray): Int? =
            if (data.size < 12) null else ByteBuffer.wrap(data, 8, 4).int

        fun errorText(code: Int) = when (code) {
            ERR_NAME_CONFLICT -> "name conflict"
            -65537 -> "unknown error"
            -65540 -> "bad parameter"
            -65563 -> "service not running"
            else -> "error $code"
        }

        private fun readInt(input: InputStream) = ByteBuffer.wrap(readFully(input, 4)).int

        private fun readFully(input: InputStream, n: Int): ByteArray {
            val b = ByteArray(n)
            var got = 0
            while (got < n) {
                val r = input.read(b, got, n - got)
                if (r < 0) throw IOException("Android's name service closed the connection")
                got += r
            }
            return b
        }
    }
}
