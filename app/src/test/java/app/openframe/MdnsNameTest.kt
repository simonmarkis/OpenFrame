package app.openframe

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.ByteBuffer

class MdnsNameTest {

    @Test fun namesCountUpFromTwo() {
        assertEquals("openframe.local", MdnsName.candidate(1))
        assertEquals("openframe-2.local", MdnsName.candidate(2))
        assertEquals("openframe-9.local", MdnsName.candidate(9))
    }

    @Test fun headerIsBigEndianVersionOne() {
        val h = MdnsName.header(MdnsName.OP_REG_RECORD, 31, 7L, 3)
        assertEquals(MdnsName.HEADER_BYTES, h.size)
        val b = ByteBuffer.wrap(h)
        assertEquals(1, b.int)            // version
        assertEquals(31, b.int)           // data length
        assertEquals(0, b.int)            // ipc flags
        assertEquals(2, b.int)            // reg_record_request
        assertEquals(7L, b.long)          // client context
        assertEquals(3, b.int)            // record index
    }

    @Test fun regRecordBodyIsAnARecord() {
        val body = MdnsName.regRecordBody("openframe.local.", byteArrayOf(192.toByte(), 168.toByte(), 1, 20))
        val b = ByteBuffer.wrap(body)
        assertEquals(0, b.get().toInt())                 // empty error-return path
        assertEquals(MdnsName.FLAG_UNIQUE, b.int)
        assertEquals(0, b.int)                           // all interfaces
        val name = ByteArray(16).also { b.get(it) }
        assertEquals("openframe.local.", String(name))
        assertEquals(0, b.get().toInt())                 // C string end
        assertEquals(1, b.short.toInt())                 // A
        assertEquals(1, b.short.toInt())                 // IN
        assertEquals(4, b.short.toInt())
        assertArrayEquals(byteArrayOf(192.toByte(), 168.toByte(), 1, 20), ByteArray(4).also { b.get(it) })
        assertEquals(MdnsName.TTL_SECONDS, b.int)
        assertEquals(0, b.remaining())
    }

    @Test fun replyErrorIsTheThirdWord() {
        val ok = ByteBuffer.allocate(12).putInt(0).putInt(3).putInt(0).array()
        val taken = ByteBuffer.allocate(12).putInt(0).putInt(3).putInt(MdnsName.ERR_NAME_CONFLICT).array()
        assertEquals(0, MdnsName.parseReplyError(ok))
        assertEquals(MdnsName.ERR_NAME_CONFLICT, MdnsName.parseReplyError(taken))
        assertNull(MdnsName.parseReplyError(ByteArray(4)))
    }
}
