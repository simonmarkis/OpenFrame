package app.openframe

import org.junit.Assert.assertEquals
import org.junit.Test

class SoundLevelsTest {

    @Test fun zeroIsSilent() {
        assertEquals(0, SoundController.levelFor(0, 15))
        assertEquals(0, SoundController.levelFor(0, 7))
    }

    @Test fun anyVolumeAboveZeroIsAudible() {
        assertEquals(1, SoundController.levelFor(1, 15))
        assertEquals(1, SoundController.levelFor(1, 7))
        assertEquals(1, SoundController.levelFor(5, 7))
    }

    @Test fun roundsToTheNearestStep() {
        assertEquals(8, SoundController.levelFor(50, 15)) // 7.5
        assertEquals(4, SoundController.levelFor(50, 7))  // 3.5
        assertEquals(5, SoundController.levelFor(71, 7))  // the frame's clicks today: 5 of 7
    }

    @Test fun fullIsMax() {
        assertEquals(15, SoundController.levelFor(100, 15))
        assertEquals(7, SoundController.levelFor(100, 7))
    }
}
