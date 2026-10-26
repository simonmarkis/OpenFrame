package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadNamesTest {

    @Test fun extensionsComeFromTheContentType() {
        assertEquals("jpg", UploadNames.extFor("image/jpeg"))
        assertEquals("png", UploadNames.extFor("image/png"))
        assertEquals("webp", UploadNames.extFor("image/webp"))
        assertEquals("mp4", UploadNames.extFor("video/mp4"))
        assertEquals("mov", UploadNames.extFor("video/quicktime"))
        assertNull(UploadNames.extFor("image/heic"))
        assertNull(UploadNames.extFor("audio/mp4"))
        assertNull(UploadNames.extFor(null))
    }

    @Test fun rejectReasonsAreSpecific() {
        assertTrue(UploadNames.rejectReason("image/heic").contains("JPEG"))
        assertTrue(UploadNames.rejectReason("audio/mp4").contains("audio"))
        assertTrue(UploadNames.rejectReason(null).contains("isn't a photo or video"))
    }

    @Test fun namesAreCleanedAndLoseFoldersAndExtension() {
        assertEquals("IMG_1234", UploadNames.safeBase("IMG_1234.HEIC"))
        assertEquals("passwd", UploadNames.safeBase("../../etc/passwd"))
        assertEquals("evil", UploadNames.safeBase("C:\\Users\\x\\evil.jpg"))
        assertEquals("Grandma's party".replace('\'', '_'), UploadNames.safeBase("Grandma's party.jpg"))
        assertEquals("Café 2024 (1)", UploadNames.safeBase("Café  2024 (1).jpeg"))
        assertEquals("x".repeat(80), UploadNames.safeBase("x".repeat(200) + ".jpg"))
        assertEquals(".hidden".trimStart('.'), UploadNames.safeBase(".hidden"))
    }

    @Test fun emptyNamesGetADatedName() {
        val now = 1_791_900_000_000L
        assertTrue(UploadNames.safeBase(null, now).matches(Regex("upload-\\d{8}-\\d{6}")))
        assertTrue(UploadNames.safeBase("...", now).startsWith("upload-"))
        assertTrue(UploadNames.safeBase("<>|?.jpg", now).startsWith("upload-"))
    }

    @Test fun takenNamesGetANumber() {
        val taken = setOf("a.jpg", "a (2).jpg")
        assertEquals("b.jpg", UploadNames.unique("b", "jpg") { it in taken })
        assertEquals("a (3).jpg", UploadNames.unique("a", "jpg") { it in taken })
    }
}
