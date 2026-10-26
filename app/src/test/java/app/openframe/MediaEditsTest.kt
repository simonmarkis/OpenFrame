package app.openframe

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaEditsTest {

    private fun parse(json: String) = MediaEdits.parse(JSONObject(json))

    private fun rejects(json: String) {
        assertThrows(IllegalArgumentException::class.java) { parse(json) }
    }

    @Test fun onlyKeysPresentChange() {
        val e = parse("""{"fit":"fill"}""")
        assertTrue(e.setFit)
        assertEquals("fill", e.fit)
        assertFalse(e.setCrop)
        assertFalse(e.setComment)
        assertTrue(parse("{}").isEmpty)
    }

    @Test fun fitIsFitFillOrNull() {
        assertEquals("fit", parse("""{"fit":"fit"}""").fit)
        val auto = parse("""{"fit":null}""")
        assertTrue(auto.setFit)
        assertNull(auto.fit)
        rejects("""{"fit":"stretch"}""")
        rejects("""{"fit":1}""")
    }

    @Test fun cropAxesAreFractionsOrAutomatic() {
        val both = parse("""{"crop":{"x":0.25,"y":1}}""")
        assertEquals(0.25, both.cropX!!, 0.0)
        assertEquals(1.0, both.cropY!!, 0.0)
        val yOnly = parse("""{"crop":{"x":null,"y":0.4}}""")
        assertNull(yOnly.cropX)
        assertEquals(0.4, yOnly.cropY!!, 0.0)
        val reset = parse("""{"crop":null}""")
        assertTrue(reset.setCrop)
        assertNull(reset.cropX)
        assertNull(reset.cropY)
        rejects("""{"crop":{"x":1.5}}""")
        rejects("""{"crop":{"x":-0.1}}""")
        rejects("""{"crop":{"x":"0.5"}}""")
        rejects("""{"crop":[0.5,0.5]}""")
    }

    @Test fun commentsAreTrimmedAndLimited() {
        assertEquals("Picnic", parse("""{"comment":"  Picnic \n"}""").comment)
        val cleared = parse("""{"comment":"   "}""")
        assertTrue(cleared.setComment)
        assertNull(cleared.comment)
        assertNull(parse("""{"comment":null}""").comment)
        assertEquals(500, parse(JSONObject().put("comment", "x".repeat(500)).toString()).comment!!.length)
        rejects(JSONObject().put("comment", "x".repeat(501)).toString())
        rejects("""{"comment":5}""")
    }

    @Test fun unknownKeysAreRejected() {
        rejects("""{"hidden":true}""")
    }

    @Test fun viewIsZoomAndCenterPerDirection() {
        val e = parse("""{"view":{"landscape":{"zoom":0.6,"x":0.3,"y":0.7}}}""")
        assertTrue(e.setView)
        assertFalse(e.setFit)
        val after = JSONObject(e.viewAfter(null)!!)
        assertEquals(0.6, after.getJSONObject("landscape").getDouble("zoom"), 1e-9)
        assertEquals(0.3, after.getJSONObject("landscape").getDouble("x"), 1e-9)
        assertFalse(after.has("portrait"))
        // A center left out is the middle.
        assertEquals(0.5, JSONObject(parse("""{"view":{"portrait":{"zoom":2}}}""").viewAfter(null)!!)
            .getJSONObject("portrait").getDouble("y"), 1e-9)
        rejects("""{"view":{"landscape":{"zoom":2.5}}}""")
        rejects("""{"view":{"landscape":{"zoom":-0.1}}}""")
        rejects("""{"view":{"landscape":{"x":0.5}}}""")
        rejects("""{"view":{"landscape":{"zoom":1,"x":1.5}}}""")
        rejects("""{"view":{"sideways":{"zoom":1}}}""")
        rejects("""{"view":[1]}""")
    }

    @Test fun viewChangesOnlyTheDirectionsGiven() {
        val stored = """{"landscape":{"zoom":0.5,"x":0.5,"y":0.5},"portrait":{"zoom":1.5,"x":0.2,"y":0.5}}"""
        val cleared = JSONObject(parse("""{"view":{"landscape":null}}""").viewAfter(stored)!!)
        assertFalse(cleared.has("landscape"))
        assertEquals(1.5, cleared.getJSONObject("portrait").getDouble("zoom"), 1e-9)
        // Clearing the last direction leaves nothing stored.
        assertNull(parse("""{"view":{"landscape":null,"portrait":null}}""").viewAfter(stored))
        // Other edits keep the view.
        assertEquals(stored, parse("""{"comment":"hi"}""").viewAfter(stored))
    }

    @Test fun showAsClearsTheZoom() {
        val stored = """{"landscape":{"zoom":0.5,"x":0.5,"y":0.5}}"""
        assertNull(parse("""{"fit":"fit"}""").viewAfter(stored))
        assertNull(parse("""{"fit":null}""").viewAfter(stored))
        // Unless the same change sets one.
        val both = JSONObject(parse("""{"fit":"fill","view":{"portrait":{"zoom":1}}}""").viewAfter(stored)!!)
        assertFalse(both.has("landscape"))
        assertTrue(both.has("portrait"))
    }
}
