package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaceIndexTest {

    // Synthetic places in cities.tsv's format (largest first): a big city, a mid-size neighbor
    // 15 km east, a small town 10 km past it, a town abroad, and a town near the date line.
    private val index = PlaceIndex(sequenceOf(
        "Bigtown\t44.0000\t-100.4300\tUS\tSD\t250000",
        "Midvale\t44.0100\t-100.2400\tUS\tSD\t100000",
        "Smallton\t44.0160\t-100.1200\tUS\tSD\t10000",
        "Città Nuova\t43.0000\t12.0000\tIT\t\t12000",
        "Edge Bay\t-16.5000\t179.9000\tFJ\t\t6000",
        "broken line",
        "Nowhere\tx\ty\tUS\tWA\t1",
    ))

    @Test fun loadsValidLinesOnly() {
        assertEquals(5, index.size)
    }

    @Test fun nearestPlaceWithinReach() {
        assertEquals("Smallton", index.nearest(44.016, -100.11)?.name)
        assertNull(index.nearest(42.34, -100.4)) // ~185 km south: nothing near
    }

    @Test fun aBiggerPlaceAlmostAsNearWins() {
        // 6.4 km from Midvale's center but only 8.8 km from Bigtown's (within 1.5×): Bigtown.
        assertEquals("Bigtown", index.nearest(44.005, -100.32)?.name)
        // Halfway-ish but clearly nearer Midvale (2.4 km vs 12.8 km): Midvale.
        assertEquals("Midvale", index.nearest(44.008, -100.27)?.name)
    }

    @Test fun regionIsTheStateInTheUsElseTheCountry() {
        assertEquals("SD", index.nearest(44.0, -100.43)?.region)
        assertEquals("IT", index.nearest(43.0, 12.0)?.region)
    }

    @Test fun lookupsWrapAroundTheDateLine() {
        assertEquals("Edge Bay", index.nearest(-16.5, -179.95)?.name)
    }

    @Test fun invalidGpsHasNoPlace() {
        assertFalse(PlaceIndex.validGps(0.0, 0.0))
        assertFalse(PlaceIndex.validGps(0.0, -180.0))
        assertFalse(PlaceIndex.validGps(null, 10.0))
        assertTrue(PlaceIndex.validGps(44.0, -100.43))
        assertNull(index.nearest(0.0, -180.0))
    }

    @Test fun searchMatchesNameStartsAndWordsIgnoringCaseAndAccents() {
        assertEquals(listOf("Bigtown"), index.search("big").map { it.name })
        assertEquals(listOf("Città Nuova"), index.search("citta").map { it.name })
        assertEquals(listOf("Città Nuova"), index.search("nuova").map { it.name })
        assertTrue(index.search("zzz").isEmpty())
        assertTrue(index.search(" ").isEmpty())
    }

    @Test fun distanceIsGreatCircle() {
        // One degree of latitude ≈ 111.2 km.
        assertEquals(111.2, PlaceIndex.distanceKm(47.0, -107.0, 48.0, -107.0), 0.1)
        assertEquals(0.0, PlaceIndex.distanceKm(47.0, -107.0, 47.0, -107.0), 1e-9)
    }
}
