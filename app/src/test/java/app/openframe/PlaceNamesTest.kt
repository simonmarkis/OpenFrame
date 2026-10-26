package app.openframe

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaceNamesTest {

    private fun osm(name: String, category: String, type: String) =
        JSONObject().put("name", name).put("category", category).put("type", type)

    @Test fun captionJoinsNameAndTown() {
        assertEquals("Hope Fellowship, Springfield", PlaceNames.caption("Hope Fellowship", "Springfield"))
        assertEquals("Springfield", PlaceNames.caption(null, "Springfield"))
        assertEquals("Springfield", PlaceNames.caption("", "Springfield"))
        assertEquals("Space Needle", PlaceNames.caption("Space Needle", null))
        assertEquals("Space Needle", PlaceNames.caption("Space Needle", ""))
        assertNull(PlaceNames.caption(null, null))
    }

    @Test fun townsWithTheirState() {
        assertEquals("Space Needle, Seattle, WA", PlaceNames.caption("Space Needle", "Seattle, WA"))
        assertEquals("Seattle Center, WA", PlaceNames.caption("Seattle Center", "Seattle, WA"))
        assertEquals("Seattle, WA", PlaceNames.caption("Seattle", "Seattle, WA"))
        assertEquals("Seattle, WA", PlaceNames.caption(null, "Seattle, WA"))
        assertEquals("Home", PlaceNames.labelCaption("Home", "Springfield, IL"))
        assertEquals("Colosseo, Rome, IT", PlaceNames.caption("Colosseo", "Rome, IT"))
    }

    @Test fun typedNamesAreShownAsTyped() {
        assertEquals("Home, Springfield, IL", PlaceNames.typedCaption("Home", "Springfield, IL"))
        assertEquals("Grace Church, Shelbyville, IL", PlaceNames.typedCaption("Grace Church", "Shelbyville, IL"))
        assertEquals("Grandma's", PlaceNames.typedCaption("Grandma's", null))
    }

    @Test fun nameThatIsTheTownOrHoldsItShowsOnce() {
        assertEquals("Seattle", PlaceNames.caption("seattle", "Seattle"))
        assertEquals("Seattle Center", PlaceNames.caption("Seattle Center", "Seattle"))
    }

    @Test fun addressesAreNotNames() {
        assertTrue(PlaceNames.looksLikeAddress("1234 E Main St"))
        assertTrue(PlaceNames.looksLikeAddress("12B Main Street"))
        assertFalse(PlaceNames.looksLikeAddress("7-Eleven"))
        assertFalse(PlaceNames.looksLikeAddress("Pike Place Market"))
        assertEquals("Shelbyville", PlaceNames.caption("1234 E Main St", "Shelbyville"))
    }

    @Test fun placeholdersAreNotNames() {
        assertEquals("Springfield", PlaceNames.caption("Location", "Springfield"))
        assertEquals("Springfield", PlaceNames.caption("Current Location", "Springfield"))
        assertFalse(PlaceNames.isPrecise("location", "Springfield"))
    }

    @Test fun longNamesAreCut() {
        val c = PlaceNames.caption("The Very Long Name of a Community Church Fellowship Hall", "Shelbyville")!!
        assertTrue(c, c.endsWith("…, Shelbyville"))
        assertEquals(PlaceNames.MAX_NAME, c.removeSuffix(", Shelbyville").length)
    }

    @Test fun sentNamesAreTidied() {
        assertEquals("Hope Fellowship", PlaceNames.cleanSent("  Hope\n   Fellowship "))
        assertNull(PlaceNames.cleanSent("   "))
        assertNull(PlaceNames.cleanSent(null))
        assertEquals(120, PlaceNames.cleanSent("x".repeat(300))!!.length)
    }

    private fun area(m2: Double, vararg tags: Pair<String, String>) = PlaceNames.Area(mapOf(*tags), m2)

    @Test fun smallestNamedAreaWins() {
        val needle = area(1118.0, "name" to "Space Needle", "building" to "tower", "tourism" to "attraction")
        val center = area(304309.0, "name" to "Seattle Center", "leisure" to "park")
        assertEquals("Space Needle", PlaceNames.fromAreas(listOf(center, needle)))
        assertEquals("Hope Fellowship Church",
            PlaceNames.fromAreas(listOf(area(50000.0, "name" to "Hope Fellowship Church", "landuse" to "religious"))))
    }

    @Test fun areasThatDontNameAPlace() {
        assertEquals("", PlaceNames.fromAreas(listOf(area(9e5, "name" to "Maple Grove", "landuse" to "residential"))))
        assertEquals("", PlaceNames.fromAreas(listOf(area(200.0, "name" to "Smith Home", "building" to "house"))))
        assertEquals("", PlaceNames.fromAreas(listOf(area(3e9, "name" to "Example National Forest", "landuse" to "forest"))))
        assertEquals("", PlaceNames.fromAreas(listOf(area(1e8, "name" to "Seattle", "boundary" to "administrative"))))
        assertEquals("Springfield Mall",
            PlaceNames.fromAreas(listOf(area(9e4, "name" to "Springfield Mall", "shop" to "mall", "building" to "retail"))))
        assertEquals("Riverside", PlaceNames.fromAreas(listOf(area(9e4, "name" to "Riverside Valley Medical Center",
            "short_name" to "Riverside", "amenity" to "hospital"))))
    }

    private fun near(m2: Double, d: Double, vararg tags: Pair<String, String>) = PlaceNames.Area(mapOf(*tags), m2, d)

    @Test fun aSpotJustOutsideANamedPlaceTakesTheNearestWithin25m() {
        // A photo 6 m outside Market Square, a named retail building.
        val square = near(12000.0, 6.0, "name" to "Market Square", "building" to "retail")
        val place = near(2500.0, 30.0, "name" to "Harbor Place", "building" to "commercial")
        assertEquals("Market Square", PlaceNames.fromAreas(listOf(place, square)))
        // Farther than 25 m: nothing.
        assertEquals("", PlaceNames.fromAreas(listOf(place)))
        // Inside a place wins over a nearer-looking one outside, whatever their sizes.
        val park = near(304309.0, 0.0, "name" to "Seattle Center", "leisure" to "park")
        assertEquals("Seattle Center", PlaceNames.fromAreas(listOf(square, park)))
        // Named office and commercial buildings are places; retail or commercial land use is a zone, not a place.
        assertEquals("Acme Tower", PlaceNames.fromAreas(listOf(near(1500.0, 0.0, "name" to "Acme Tower", "building" to "office"))))
        assertEquals("", PlaceNames.fromAreas(listOf(near(9e5, 0.0, "name" to "Downtown", "landuse" to "retail"))))
        assertEquals("", PlaceNames.fromAreas(listOf(near(9000.0, 5.0, "name" to "Harbor Place", "building" to "apartments"))))
    }

    @Test fun postpassAnswersCarryTheDistance() {
        val pp = JSONObject("""{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,
            "properties":{"name":"Market Square","building":"retail","m2":12000,"d":6}}]}""")
        val a = PlaceNames.areasFromPostpass(pp).single()
        assertEquals(6.0, a.distanceM, 1e-9)
        assertFalse("d" in a.tags)
        assertEquals("Market Square", PlaceNames.fromAreas(listOf(a)))
    }

    @Test fun postpassAndOverpassAnswers() {
        val pp = JSONObject("""{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,
            "properties":{"name":"Seattle Center","leisure":"park","amenity":null,"m2":304309}}]}""")
        val a = PlaceNames.areasFromPostpass(pp).single()
        assertEquals("park", a.tags["leisure"]); assertFalse("amenity" in a.tags); assertEquals(304309.0, a.squareMeters, 0.1)
        val op = JSONObject("""{"elements":[{"type":"way","bounds":{"minlat":47.62,"minlon":-122.35,"maxlat":47.621,"maxlon":-122.349},
            "tags":{"name":"Space Needle","building":"tower"}}]}""")
        val b = PlaceNames.areasFromOverpass(op).single()
        assertEquals("Space Needle", b.tags["name"]); assertTrue(b.squareMeters in 5_000.0..20_000.0)
    }

    @Test fun namesAreShortened() {
        assertEquals("Hope Fellowship", PlaceNames.shorten("Hope Fellowship Church"))
        assertEquals("First Baptist", PlaceNames.shorten("First Baptist Church"))
        assertEquals("Grace Church", PlaceNames.shorten("Grace Church"))
        assertEquals("Riverside Valley", PlaceNames.shorten("Riverside Valley Medical Center & Research Institute"))
        assertEquals("Lincoln Elementary", PlaceNames.shorten("Lincoln Elementary School"))
        assertEquals("Riverside Valley", PlaceNames.shorten("Riverside Valley Medical Center and Research Institute"))
        assertEquals("Barnes & Noble", PlaceNames.shorten("Barnes & Noble"))
        assertEquals("Barnes and Noble", PlaceNames.shorten("Barnes and Noble"))
        assertEquals("Seattle Center", PlaceNames.shorten("Seattle Center"))
        assertEquals("Hope Fellowship, Springfield", PlaceNames.caption("Hope Fellowship Church", "Springfield"))
    }

    @Test fun privatePlaces() {
        // ~0.00054° latitude ≈ 60 m.
        val home = ConfigStore.PrivatePlace("Home", 40.00000, -100.00000, 60)
        val street = ConfigStore.PrivatePlace("", 40.00000, -100.00000, 300)
        assertEquals(home, PlaceNames.privateAt(40.00040, -100.00000, listOf(street, home))) // ~44 m: the smaller wins
        assertEquals(street, PlaceNames.privateAt(40.00100, -100.00000, listOf(street, home))) // ~111 m
        assertNull(PlaceNames.privateAt(40.01000, -100.00000, listOf(street, home))) // ~1.1 km
        assertEquals("Home", PlaceNames.labelCaption("Home", "Springfield"))
        assertEquals("Springfield", PlaceNames.labelCaption("", "Springfield"))
        assertEquals("Home", PlaceNames.labelCaption("Home", null))
    }

    @Test fun sameSpotReusesTheNearestAnswerWithin50m() {
        val earlier = listOf(Triple(40.00000, -100.00000, "Hope Fellowship Church"), Triple(40.00030, -100.00000, ""))
        assertEquals("", PlaceNames.sameSpot(40.00035, -100.00000, earlier)) // nearest: ~6 m from the second
        assertEquals("Hope Fellowship Church", PlaceNames.sameSpot(39.99990, -100.00000, earlier))
        assertNull(PlaceNames.sameSpot(40.00100, -100.00000, earlier)) // ~78 m from the nearest
    }

    @Test fun nominatimNamedPlacesOnly() {
        assertEquals("The Loupe Lounge", PlaceNames.fromNominatim(osm("The Loupe Lounge", "amenity", "bar")))
        assertEquals("Space Needle", PlaceNames.fromNominatim(osm("Space Needle", "man_made", "tower")))
        assertEquals("King Street Station", PlaceNames.fromNominatim(osm("King Street Station", "railway", "station")))
        assertEquals("", PlaceNames.fromNominatim(osm("", "amenity", "bicycle_parking")))
        assertEquals("", PlaceNames.fromNominatim(osm("Lot 4", "amenity", "parking")))
        assertEquals("", PlaceNames.fromNominatim(osm("Post Alley", "highway", "pedestrian")))
        assertEquals("", PlaceNames.fromNominatim(osm("Seattle", "place", "city")))
        assertEquals("", PlaceNames.fromNominatim(osm("Smith House", "building", "house")))
        assertEquals("", PlaceNames.fromNominatim(osm("Maple Grove Estates", "landuse", "residential")))
        assertEquals("", PlaceNames.fromNominatim(osm("85 Pike Street", "building", "yes")))
        assertEquals("", PlaceNames.fromNominatim(JSONObject().put("error", "Unable to geocode")))
    }
}
