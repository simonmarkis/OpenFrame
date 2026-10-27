package app.openframe

import android.app.Application
import android.util.Log
import java.io.IOException

const val TAG = "OpenFrame"
const val SERVER_PORT = 8080

class OpenFrameApp : Application() {

    lateinit var config: ConfigStore
        private set
    lateinit var mediaDb: MediaDb
        private set
    lateinit var slideshow: Slideshow
        private set
    lateinit var indexer: MediaIndexer
        private set
    lateinit var secrets: SecretsStore
        private set
    lateinit var calendarSync: CalendarSync
        private set
    lateinit var weatherSync: WeatherSync
        private set
    lateinit var library: Library
        private set
    lateinit var server: LocalServer
        private set
    lateinit var power: PowerController
        private set
    lateinit var overlay: ReturnOverlay
        private set
    lateinit var places: Places
        private set
    lateinit var placeLookup: PlaceLookup
        private set
    lateinit var sound: SoundController
        private set
    /** The frame's name on the network, openframe.local (SPEC §17). */
    lateinit var mdnsName: MdnsName
        private set
    /** The last refused upload, for its warning (SPEC §13). */
    val uploadRefusals by lazy { UploadRefusals(filesDir) }
    /** The user's exported Shortcut and the address it sends to (SPEC §17). */
    val shortcutFile by lazy { ShortcutFile(java.io.File(filesDir, "shortcut")) }

    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this) // first: a crash during start-up restarts too (SPEC §18)
        DataMove.runAtStart(this) // a fresh install taking over the old one's data (once; SPEC §16)
        config = ConfigStore(this)
        secrets = SecretsStore(this)
        calendarSync = CalendarSync(this, config, secrets)
        calendarSync.start()
        weatherSync = WeatherSync(this, config)
        weatherSync.start()
        mediaDb = MediaDb(this)
        slideshow = Slideshow(this, mediaDb, config)
        places = Places(this)
        placeLookup = PlaceLookup(this)
        indexer = MediaIndexer(this, mediaDb, config, object : MediaIndexer.Listener {
            override fun onLibraryChanged() = slideshow.onLibraryChanged()
            override fun onItemReady(id: Long, isNew: Boolean) {
                slideshow.onItemReady(id, isNew)
                places.requestFill()
            }
        })
        indexer.start()
        places.start()
        library = Library(this)
        library.start()
        power = PowerController(this)
        overlay = ReturnOverlay(this)
        sound = SoundController(this)
        sound.start()

        mdnsName = MdnsName(this) // before the server: /api/system and the warnings read it
        server = LocalServer(this, SERVER_PORT)
        try {
            server.start(SOCKET_READ_TIMEOUT_MS, false)
            Log.i(TAG, "LocalServer listening on 0.0.0.0:$SERVER_PORT")
        } catch (e: IOException) {
            Log.e(TAG, "LocalServer failed to start on port $SERVER_PORT", e)
        }
        power.start() // after the server: the nightly reload goes through it
        mdnsName.start()
    }

    private companion object {
        const val SOCKET_READ_TIMEOUT_MS = 15_000
    }
}
