package app.openframe

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * `media.db` (SPEC §6). One row per media file on any volume.
 * Rows on an unplugged removable volume stay (available = 0) so hidden flags and
 * per-photo settings survive re-insertion.
 */
class MediaDb(context: Context) : SQLiteOpenHelper(context, "media.db", null, VERSION) {

    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE media (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              path TEXT NOT NULL UNIQUE,
              source TEXT NOT NULL,          -- internal | removable | immich | ha
              volume TEXT NOT NULL,          -- 'internal' or 'removable:<fs uuid>'
              type TEXT NOT NULL,            -- photo | video
              mime TEXT,
              size INTEGER NOT NULL,
              mtime INTEGER NOT NULL,
              width INTEGER,                 -- after EXIF rotation
              height INTEGER,
              duration_ms INTEGER,
              taken_at INTEGER,              -- epoch ms; null if unknown
              added_at INTEGER NOT NULL,
              lat REAL,
              lon REAL,
              place TEXT,
              comment TEXT,
              hidden INTEGER NOT NULL DEFAULT 0,
              fit_override TEXT,             -- null | fit | fill
              crop_x REAL,                   -- manual crop center, 0..1 per axis (Phase 9); null = automatic
              crop_y REAL,
              face_x0 REAL,                  -- union of detected faces, normalized 0..1
              face_y0 REAL,
              face_x1 REAL,
              face_y1 REAL,
              display_w INTEGER,
              display_h INTEGER,
              rev INTEGER NOT NULL DEFAULT 0, -- bumps when the display copy is regenerated
              status TEXT NOT NULL,          -- pending | ok | unsupported | too_large | error
              status_detail TEXT,
              available INTEGER NOT NULL DEFAULT 1,
              seen_gen INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX media_volume ON media(volume)")
        db.execSQL("CREATE INDEX media_playable ON media(status, available, hidden, type)")
        db.execSQL(
            """
            CREATE TABLE volumes (
              id TEXT PRIMARY KEY,
              label TEXT,
              first_seen INTEGER NOT NULL,
              last_seen INTEGER NOT NULL
            )
            """.trimIndent()
        )
    }

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        // Comments sent with an upload, waiting for the indexer to create the file's row (Phase 7).
        // Created here rather than in onCreate so existing databases get it without a migration.
        if (!db.isReadOnly) {
            db.execSQL("CREATE TABLE IF NOT EXISTS pending_comments (path TEXT PRIMARY KEY, comment TEXT NOT NULL)")
            // Deleted internal files waiting 30 days in FrameMedia/.trash (Library).
            db.execSQL("CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY AUTOINCREMENT, original_path TEXT NOT NULL, " +
                "trash_path TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, comment TEXT, deleted_at INTEGER NOT NULL)")
            // Per-photo fit and position travel through the trash too (Phase 9): columns added in place.
            val trashCols = db.rawQuery("PRAGMA table_info(trash)", null).use { c ->
                val out = HashSet<String>()
                while (c.moveToNext()) out += c.getString(c.getColumnIndexOrThrow("name"))
                out
            }
            if ("fit_override" !in trashCols) db.execSQL("ALTER TABLE trash ADD COLUMN fit_override TEXT")
            if ("crop_x" !in trashCols) db.execSQL("ALTER TABLE trash ADD COLUMN crop_x REAL")
            if ("crop_y" !in trashCols) db.execSQL("ALTER TABLE trash ADD COLUMN crop_y REAL")
            // Fit and position of a file restored from the trash, waiting for its row like pending_comments.
            db.execSQL("CREATE TABLE IF NOT EXISTS pending_settings (path TEXT PRIMARY KEY, fit_override TEXT, crop_x REAL, crop_y REAL)")
            // Per-photo zoom for each direction (SPEC §15, 2026-10-26): JSON text, MediaEdits; null = none.
            for (t in listOf("media", "trash", "pending_settings")) {
                if ("view" !in columns(db, t)) db.execSQL("ALTER TABLE $t ADD COLUMN view TEXT")
            }
            // Date taken and place sent with an upload (Phase 12: the Shortcut's videos lose their own).
            // Kept per path, so processing the file again keeps them (UploadMeta, SPEC §17).
            db.execSQL("CREATE TABLE IF NOT EXISTS sent_meta (path TEXT PRIMARY KEY, taken_at INTEGER, lat REAL, lon REAL)")
            // Precise place names (SPEC §8): the iPhone's (sent_meta.place) or an OpenStreetMap lookup, cached per
            // file with the coordinates it was made for; media.place_name: null = not decided yet, "" = none.
            if ("place" !in columns(db, "sent_meta")) db.execSQL("ALTER TABLE sent_meta ADD COLUMN place TEXT")
            if ("place_name" !in columns(db, "media")) db.execSQL("ALTER TABLE media ADD COLUMN place_name TEXT")
            // A location the user typed for a photo without GPS (2026-10-19); kept when the file is processed again.
            if ("place_label" !in columns(db, "media")) db.execSQL("ALTER TABLE media ADD COLUMN place_label TEXT")
            // The private place a photo was added to by hand (its key, ConfigStore.PrivatePlace.key).
            if ("private_key" !in columns(db, "media")) db.execSQL("ALTER TABLE media ADD COLUMN private_key TEXT")
            // A position the user gave a photo without GPS (typed or from an address): sent_meta lat/lon, flagged.
            if ("user_coords" !in columns(db, "sent_meta")) db.execSQL("ALTER TABLE sent_meta ADD COLUMN user_coords INTEGER NOT NULL DEFAULT 0")
            // Before the user's first change: the photo's position (file or Shortcut) and what sent_meta held, to restore.
            if ("orig_lat" !in columns(db, "sent_meta")) {
                for (c in listOf("orig_lat", "orig_lon", "prev_lat", "prev_lon")) db.execSQL("ALTER TABLE sent_meta ADD COLUMN $c REAL")
            }
            db.execSQL("CREATE TABLE IF NOT EXISTS place_lookups (path TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, " +
                "name TEXT NOT NULL, looked_up_at INTEGER NOT NULL)")
        }
    }

    private fun columns(db: SQLiteDatabase, table: String): Set<String> =
        db.rawQuery("PRAGMA table_info($table)", null).use { c ->
            val out = HashSet<String>()
            while (c.moveToNext()) out += c.getString(c.getColumnIndexOrThrow("name"))
            out
        }

    /** Remembers [comment] for a just-uploaded file; [insertPending] attaches it when the file is indexed. */
    fun setPendingComment(path: String, comment: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO pending_comments (path, comment) VALUES (?, ?)", arrayOf(path, comment))
    }

    /** The date and place sent with an upload of [path] (none: forgets any earlier ones for that name). */
    fun setSentMeta(path: String, sent: UploadMeta.Sent) {
        if (sent.isEmpty) {
            writableDatabase.execSQL("DELETE FROM sent_meta WHERE path = ?", arrayOf(path))
            return
        }
        writableDatabase.execSQL("INSERT OR REPLACE INTO sent_meta (path, taken_at, lat, lon, place) VALUES (?, ?, ?, ?, ?)",
            arrayOf<Any?>(path, sent.takenAt, sent.lat, sent.lon, sent.place))
    }

    /** A place name sent again for an existing file (a duplicate upload); true if it changed anything. */
    fun setSentPlace(path: String, place: String): Boolean {
        val db = writableDatabase
        val old = db.rawQuery("SELECT place FROM sent_meta WHERE path = ?", arrayOf(path)).use { c ->
            if (c.moveToFirst()) (if (c.isNull(0)) "" else c.getString(0)) else null
        }
        if (old == place) return false
        if (old == null) db.execSQL("INSERT INTO sent_meta (path, place) VALUES (?, ?)", arrayOf(path, place))
        else db.execSQL("UPDATE sent_meta SET place = ? WHERE path = ?", arrayOf(place, path))
        db.execSQL("UPDATE media SET place_name = NULL WHERE path = ?", arrayOf(path))
        return true
    }

    /**
     * After processing: what was sent with the upload wins over what the file says (or doesn't), except a
     * photo's own date taken (the Shortcut once sent the first photo's date for a whole batch; videos lose theirs).
     */
    fun applySentMeta(id: Long) {
        writableDatabase.execSQL(
            """
            UPDATE media SET
              taken_at = CASE WHEN type = 'photo' AND taken_at IS NOT NULL THEN taken_at
                ELSE COALESCE((SELECT s.taken_at FROM sent_meta s WHERE s.path = media.path), taken_at) END,
              lat = COALESCE((SELECT s.lat FROM sent_meta s WHERE s.path = media.path AND s.lon IS NOT NULL), lat),
              lon = COALESCE((SELECT s.lon FROM sent_meta s WHERE s.path = media.path AND s.lat IS NOT NULL), lon)
            WHERE id = ? AND EXISTS (SELECT 1 FROM sent_meta s WHERE s.path = media.path)
            """.trimIndent(), arrayOf<Any>(id))
    }

    /** Remembers fit and position for a file restored from the trash; [insertPending] applies them. */
    fun setPendingSettings(path: String, fit: String?, cropX: Double?, cropY: Double?, view: String? = null) {
        if (fit == null && cropX == null && cropY == null && view == null) return
        writableDatabase.execSQL("INSERT OR REPLACE INTO pending_settings (path, fit_override, crop_x, crop_y, view) VALUES (?, ?, ?, ?, ?)",
            arrayOf<Any?>(path, fit, cropX, cropY, view))
    }

    /** Paths of available items with exactly [size] bytes (duplicate check for uploads). */
    fun pathsWithSize(size: Long): List<String> {
        val out = ArrayList<String>()
        readableDatabase.rawQuery("SELECT path FROM media WHERE size = ? AND available = 1", arrayOf(size.toString())).use { c ->
            while (c.moveToNext()) out += c.getString(0)
        }
        return out
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // No migrations yet (schema version 1).
    }

    data class Known(val id: Long, val size: Long, val mtime: Long)

    data class Playable(val id: Long, val takenKey: Long, val addedAt: Long)

    data class Item(
        val id: Long, val path: String, val source: String, val volume: String, val type: String,
        val width: Int?, val height: Int?, val takenAt: Long?, val addedAt: Long, val mtime: Long,
        val lat: Double?, val lon: Double?, val fitOverride: String?, val cropX: Double?, val cropY: Double?,
        val place: String? = null,
        val face: FloatArray?, val displayW: Int?, val displayH: Int?, val rev: Int,
        val status: String, val statusDetail: String?,
        val available: Boolean = true, val hidden: Boolean = false, val comment: String? = null, val size: Long = 0,
        val durationMs: Long? = null,
        val placeName: String? = null,
        val placeLabel: String? = null,
        val privateKey: String? = null,
        val view: String? = null,
    )

    data class Pending(val id: Long, val path: String, val type: String)

    // ---- Volumes ----

    /** Records a volume as seen; returns true if this is the first time it has ever been seen. */
    fun touchVolume(id: String, label: String?, now: Long): Boolean {
        val db = writableDatabase
        val existed = db.rawQuery("SELECT 1 FROM volumes WHERE id = ?", arrayOf(id)).use { it.moveToFirst() }
        val cv = ContentValues().apply { put("label", label); put("last_seen", now) }
        if (existed) {
            db.update("volumes", cv, "id = ?", arrayOf(id))
        } else {
            cv.put("id", id); cv.put("first_seen", now)
            db.insert("volumes", null, cv)
        }
        return !existed
    }

    // ---- Scan bookkeeping ----

    fun knownOnVolume(volume: String): Map<String, Known> {
        val out = HashMap<String, Known>()
        readableDatabase.rawQuery("SELECT path, id, size, mtime FROM media WHERE volume = ?", arrayOf(volume)).use { c ->
            while (c.moveToNext()) out[c.getString(0)] = Known(c.getLong(1), c.getLong(2), c.getLong(3))
        }
        return out
    }

    fun insertPending(path: String, source: String, volume: String, type: String, size: Long, mtime: Long, now: Long, gen: Long): Long {
        val cv = ContentValues().apply {
            put("path", path); put("source", source); put("volume", volume); put("type", type)
            put("size", size); put("mtime", mtime); put("added_at", now)
            put("status", STATUS_PENDING); put("seen_gen", gen)
        }
        val db = writableDatabase
        db.rawQuery("SELECT comment FROM pending_comments WHERE path = ?", arrayOf(path)).use { c ->
            if (c.moveToFirst()) cv.put("comment", c.getString(0))
        }
        var settings = false
        db.rawQuery("SELECT fit_override, crop_x, crop_y, view FROM pending_settings WHERE path = ?", arrayOf(path)).use { c ->
            if (c.moveToFirst()) {
                settings = true
                if (!c.isNull(0)) cv.put("fit_override", c.getString(0))
                if (!c.isNull(1)) cv.put("crop_x", c.getDouble(1))
                if (!c.isNull(2)) cv.put("crop_y", c.getDouble(2))
                if (!c.isNull(3)) cv.put("view", c.getString(3))
            }
        }
        val id = db.insertOrThrow("media", null, cv)
        if (cv.containsKey("comment")) db.execSQL("DELETE FROM pending_comments WHERE path = ?", arrayOf(path))
        if (settings) db.execSQL("DELETE FROM pending_settings WHERE path = ?", arrayOf(path))
        return id
    }

    fun markChanged(id: Long, size: Long, mtime: Long, gen: Long) {
        writableDatabase.execSQL(
            "UPDATE media SET size = ?, mtime = ?, status = ?, status_detail = NULL, seen_gen = ? WHERE id = ?",
            arrayOf<Any>(size, mtime, STATUS_PENDING, gen, id)
        )
    }

    fun markSeen(ids: Collection<Long>, gen: Long) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        val stmt = db.compileStatement("UPDATE media SET seen_gen = ? WHERE id = ?")
        for (id in ids) {
            stmt.bindLong(1, gen); stmt.bindLong(2, id); stmt.executeUpdateDelete()
        }
    }

    /** Deletes rows on [volume] not seen in scan [gen]; returns their ids (for cache cleanup). */
    fun deleteUnseen(volume: String, gen: Long): List<Long> {
        val db = writableDatabase
        val ids = ArrayList<Long>()
        db.rawQuery("SELECT id FROM media WHERE volume = ? AND seen_gen < ?", arrayOf(volume, gen.toString())).use { c ->
            while (c.moveToNext()) ids += c.getLong(0)
        }
        if (ids.isNotEmpty()) db.delete("media", "volume = ? AND seen_gen < ?", arrayOf(volume, gen.toString()))
        return ids
    }

    fun setAvailability(mountedVolumes: Set<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("UPDATE media SET available = 0")
            for (v in mountedVolumes) db.execSQL("UPDATE media SET available = 1 WHERE volume = ?", arrayOf(v))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun <T> inTransaction(block: () -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val r = block()
            db.setTransactionSuccessful()
            return r
        } finally {
            db.endTransaction()
        }
    }

    // ---- Processing ----

    /** Re-queues failed items (e.g. after an app update that may have fixed the cause). Returns count. */
    fun requeueFailed(): Int = writableDatabase.compileStatement(
        "UPDATE media SET status = '$STATUS_PENDING', status_detail = NULL WHERE status IN ('$STATUS_ERROR', '$STATUS_TOO_LARGE')"
    ).executeUpdateDelete()

    fun nextPending(limit: Int): List<Pending> {
        val out = ArrayList<Pending>()
        readableDatabase.rawQuery(
            "SELECT id, path, type FROM media WHERE status = ? AND available = 1 ORDER BY mtime DESC LIMIT $limit",
            arrayOf(STATUS_PENDING)
        ).use { c -> while (c.moveToNext()) out += Pending(c.getLong(0), c.getString(1), c.getString(2)) }
        return out
    }

    fun savePhotoResult(id: Long, r: ImageProcessor.PhotoResult) {
        val cv = ContentValues().apply {
            put("mime", r.mime); put("width", r.width); put("height", r.height)
            put("taken_at", r.takenAt); put("lat", r.lat); put("lon", r.lon); putNull("place"); putNull("place_name")
            put("display_w", r.displayW); put("display_h", r.displayH)
            val f = r.face
            put("face_x0", f?.get(0)); put("face_y0", f?.get(1)); put("face_x1", f?.get(2)); put("face_y1", f?.get(3))
            put("status", STATUS_OK); putNull("status_detail")
        }
        writableDatabase.update("media", cv, "id = ?", arrayOf(id.toString()))
        writableDatabase.execSQL("UPDATE media SET rev = rev + 1 WHERE id = ?", arrayOf<Any>(id))
    }

    fun saveVideoResult(id: Long, r: ImageProcessor.VideoResult) {
        val cv = ContentValues().apply {
            put("mime", r.mime); put("width", r.width); put("height", r.height); put("duration_ms", r.durationMs)
            put("taken_at", r.takenAt); put("lat", r.lat); put("lon", r.lon); putNull("place"); putNull("place_name")
            // The poster (one frame) is the video's display copy (SPEC §6).
            put("display_w", r.displayW); put("display_h", r.displayH)
            val f = r.face
            put("face_x0", f?.get(0)); put("face_y0", f?.get(1)); put("face_x1", f?.get(2)); put("face_y1", f?.get(3))
            put("status", STATUS_OK); putNull("status_detail")
        }
        writableDatabase.update("media", cv, "id = ?", arrayOf(id.toString()))
        writableDatabase.execSQL("UPDATE media SET rev = rev + 1 WHERE id = ?", arrayOf<Any>(id))
    }

    /** Photos that came with a sent date get processed again, so their own EXIF date replaces it (SPEC §17). */
    fun requeueSentPhotos(): Int = writableDatabase.compileStatement(
        "UPDATE media SET status = '$STATUS_PENDING', status_detail = NULL WHERE type = 'photo' AND status = '$STATUS_OK' " +
            "AND path IN (SELECT path FROM sent_meta WHERE taken_at IS NOT NULL)"
    ).executeUpdateDelete()

    /** Videos get processed again (the playability rules, poster, or metadata reading changed; SPEC §6). */
    fun requeueVideos(): Int = writableDatabase.compileStatement(
        "UPDATE media SET status = '$STATUS_PENDING', status_detail = NULL " +
            "WHERE type = 'video' AND status IN ('$STATUS_OK', '$STATUS_UNSUPPORTED')"
    ).executeUpdateDelete()

    fun setStatus(id: Long, status: String, detail: String?, mime: String? = null) {
        val cv = ContentValues().apply {
            put("status", status); put("status_detail", detail)
            if (mime != null) put("mime", mime)
        }
        writableDatabase.update("media", cv, "id = ?", arrayOf(id.toString()))
    }

    // ---- Queries for the slideshow and API ----

    /**
     * Photos (and videos with a poster, if [videos]) ready to show. `takenKey` falls back to file mtime
     * when the file has no date.
     */
    fun playable(videos: Boolean): List<Playable> {
        val out = ArrayList<Playable>()
        val types = if (videos) "(type = 'photo' OR (type = 'video' AND display_w IS NOT NULL))" else "type = 'photo'"
        readableDatabase.rawQuery(
            "SELECT id, COALESCE(taken_at, mtime), added_at FROM media " +
                "WHERE status = ? AND available = 1 AND hidden = 0 AND $types",
            arrayOf(STATUS_OK)
        ).use { c -> while (c.moveToNext()) out += Playable(c.getLong(0), c.getLong(1), c.getLong(2)) }
        return out
    }

    fun item(id: Long): Item? =
        readableDatabase.rawQuery("SELECT * FROM media WHERE id = ?", arrayOf(id.toString())).use { c ->
            if (c.moveToFirst()) c.toItem() else null
        }

    fun counts(): Map<String, Int> {
        val out = LinkedHashMap<String, Int>()
        readableDatabase.rawQuery(
            "SELECT type || ':' || status || ':' || available, COUNT(*) FROM media GROUP BY type, status, available", null
        ).use { c -> while (c.moveToNext()) out[c.getString(0)] = c.getInt(1) }
        return out
    }

    fun countsByVolume(): Map<String, Int> {
        val out = HashMap<String, Int>()
        readableDatabase.rawQuery("SELECT volume, COUNT(*) FROM media GROUP BY volume", null).use { c ->
            while (c.moveToNext()) out[c.getString(0)] = c.getInt(1)
        }
        return out
    }

    // ---- Library (Settings → Photos → Library) ----

    /** all = shown or showable here; problems = can't be shown; hidden = hidden by the user. */
    private fun libraryWhere(filter: String): Pair<String, Array<String>> = when (filter) {
        "problems" -> "status IN (?, ?, ?) AND available = 1 AND hidden = 0" to arrayOf(STATUS_UNSUPPORTED, STATUS_TOO_LARGE, STATUS_ERROR)
        "hidden" -> "hidden = 1" to emptyArray()
        else -> "available = 1 AND hidden = 0" to emptyArray()
    }

    fun library(filter: String, offset: Int, limit: Int): List<Item> {
        val (where, args) = libraryWhere(filter)
        val out = ArrayList<Item>()
        readableDatabase.rawQuery("SELECT * FROM media WHERE $where ORDER BY added_at DESC, id DESC LIMIT $limit OFFSET $offset", args)
            .use { c -> while (c.moveToNext()) out += c.toItem() }
        return out
    }

    fun libraryCount(filter: String): Int {
        val (where, args) = libraryWhere(filter)
        return readableDatabase.rawQuery("SELECT COUNT(*) FROM media WHERE $where", args).use { c -> c.moveToFirst(); c.getInt(0) }
    }

    /** Files that can't be shown and aren't hidden (the warning system's count). */
    fun unshowableCount(): Int = libraryCount("problems")

    fun setHidden(id: Long, hidden: Boolean) {
        writableDatabase.execSQL("UPDATE media SET hidden = ? WHERE id = ?", arrayOf<Any>(if (hidden) 1 else 0, id))
    }

    /** Applies the per-photo settings present in [e] (SPEC §15). Returns false if there is no such row. */
    fun applyEdits(id: Long, e: MediaEdits): Boolean {
        val cv = ContentValues()
        if (e.setFit) cv.put("fit_override", e.fit)
        if (e.setCrop) { cv.put("crop_x", e.cropX); cv.put("crop_y", e.cropY) }
        if (e.setView || e.setFit) cv.put("view", e.viewAfter(item(id)?.view))
        if (e.setComment) cv.put("comment", e.comment)
        if (cv.size() == 0) return item(id) != null
        return writableDatabase.update("media", cv, "id = ?", arrayOf(id.toString())) > 0
    }

    /** Items with GPS whose place name hasn't been looked up yet ([Places]). */
    fun withoutPlace(limit: Int): List<Triple<Long, Double, Double>> {
        val out = ArrayList<Triple<Long, Double, Double>>()
        readableDatabase.rawQuery(
            "SELECT id, lat, lon FROM media WHERE place IS NULL AND lat IS NOT NULL AND lon IS NOT NULL AND status = ? LIMIT $limit",
            arrayOf(STATUS_OK)
        ).use { c -> while (c.moveToNext()) out += Triple(c.getLong(0), c.getDouble(1), c.getDouble(2)) }
        return out
    }

    /** Town names without the state or country ("Seattle" instead of "Seattle, WA"): named again by [Places]. */
    fun clearTownsWithoutRegion(): Int = writableDatabase.compileStatement(
        "UPDATE media SET place = NULL WHERE place != '' AND instr(place, ', ') = 0").executeUpdateDelete()

    /** City name for the caption; "" = looked up, nothing near. */
    fun setPlace(id: Long, place: String) {
        writableDatabase.execSQL("UPDATE media SET place = ? WHERE id = ?", arrayOf<Any>(place, id))
    }

    /**
     * An item whose precise place name isn't decided yet ([PlaceLookup]): its town, the name the iPhone sent,
     * and an earlier OpenStreetMap answer for the same spot (null = none).
     */
    class NameTodo(val id: Long, val path: String, val lat: Double, val lon: Double, val town: String,
        val sent: String?, val cached: String?, val typed: Boolean = false, val privateKey: String? = null)

    /** Items with GPS and a town lookup done, whose precise name isn't decided yet. */
    fun withoutPlaceName(limit: Int): List<NameTodo> {
        val out = ArrayList<NameTodo>()
        readableDatabase.rawQuery(
            """
            SELECT m.id, m.path, m.lat, m.lon, m.place, s.place,
              (SELECT l.name FROM place_lookups l WHERE l.path = m.path AND abs(l.lat - m.lat) < 1e-5 AND abs(l.lon - m.lon) < 1e-5),
              m.place_label IS NOT NULL AND trim(m.place_label) != '', m.private_key
            FROM media m LEFT JOIN sent_meta s ON s.path = m.path
            WHERE m.place_name IS NULL AND m.place IS NOT NULL AND m.lat IS NOT NULL AND m.lon IS NOT NULL AND m.status = ?
            ORDER BY m.added_at DESC LIMIT $limit
            """.trimIndent(), arrayOf(STATUS_OK)
        ).use { c ->
            while (c.moveToNext()) out += NameTodo(c.getLong(0), c.getString(1), c.getDouble(2), c.getDouble(3),
                c.getString(4), if (c.isNull(5)) null else c.getString(5), if (c.isNull(6)) null else c.getString(6), c.getInt(7) == 1,
                if (c.isNull(8)) null else c.getString(8))
        }
        return out
    }

    /** How many items still wait for a precise name (the Settings progress). */
    fun withoutPlaceNameCount(): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM media WHERE place_name IS NULL AND place IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL AND status = ?",
        arrayOf(STATUS_OK)).use { c -> c.moveToFirst(); c.getInt(0) }

    /** Settings: (items with GPS, of them with a precise name). */
    fun placeNameCounts(): Pair<Int, Int> = readableDatabase.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(place_name IS NOT NULL AND place_name NOT IN ('', '${PlaceNames.SKIPPED}')), 0) FROM media " +
            "WHERE lat IS NOT NULL AND lon IS NOT NULL AND status = ? AND available = 1",
        arrayOf(STATUS_OK)).use { c -> c.moveToFirst(); c.getInt(0) to c.getInt(1) }

    /** The precise name for the caption ("" = no named place there). */
    fun setPlaceName(id: Long, name: String) {
        writableDatabase.execSQL("UPDATE media SET place_name = ? WHERE id = ?", arrayOf<Any>(name, id))
    }

    /** Names kept before [PlaceNames.isPrecise] learned to refuse them (placeholders): decided again. */
    fun clearPlaceNames(lowercaseNames: Collection<String>): Int {
        if (lowercaseNames.isEmpty()) return 0
        val marks = lowercaseNames.joinToString(",") { "?" }
        return writableDatabase.compileStatement("UPDATE media SET place_name = NULL WHERE lower(trim(place_name)) IN ($marks)").run {
            lowercaseNames.forEachIndexed { i, s -> bindString(i + 1, s) }
            executeUpdateDelete()
        }
    }

    /** The location typed for this one photo (null = none: its automatic name is decided again, from the cache if known). */
    fun setPlaceLabel(id: Long, label: String?) {
        writableDatabase.execSQL("UPDATE media SET place_label = ?, place_name = NULL WHERE id = ?", arrayOf<Any?>(label, id))
    }

    /** Adds the photo to a private place by hand (null: takes it out). */
    fun setPrivateKey(id: Long, key: String?) {
        writableDatabase.execSQL("UPDATE media SET private_key = ?, place_name = NULL WHERE id = ?", arrayOf<Any?>(key, id))
    }

    /** Whether the photo's position was given by the user ([setUserCoords]). */
    fun hasUserCoords(path: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM sent_meta WHERE path = ? AND user_coords = 1", arrayOf(path)).use { it.moveToFirst() }

    /**
     * A position the user gave a photo (null: removes it). Kept in sent_meta like the Shortcut's, so it wins
     * over the file and survives processing it again; the town and place name are decided again.
     */
    fun setUserCoords(id: Long, path: String, lat: Double?, lon: Double?) = inTransaction {
        val db = writableDatabase
        val exists = db.rawQuery("SELECT 1 FROM sent_meta WHERE path = ?", arrayOf(path)).use { it.moveToFirst() }
        if (!exists) db.execSQL("INSERT INTO sent_meta (path) VALUES (?)", arrayOf(path))
        val userSet = hasUserCoords(path)
        if (lat != null) {
            // First change: remember the photo's own position and the sent one, for "Back to the photo's own position".
            if (!userSet) db.execSQL(
                "UPDATE sent_meta SET prev_lat = lat, prev_lon = lon, orig_lat = (SELECT m.lat FROM media m WHERE m.id = ?), " +
                    "orig_lon = (SELECT m.lon FROM media m WHERE m.id = ?) WHERE path = ?", arrayOf<Any?>(id, id, path))
            db.execSQL("UPDATE sent_meta SET lat = ?, lon = ?, user_coords = 1 WHERE path = ?", arrayOf<Any?>(lat, lon, path))
            db.execSQL("UPDATE media SET lat = ?, lon = ?, place = NULL, place_name = NULL WHERE id = ?", arrayOf<Any?>(lat, lon, id))
        } else if (userSet) {
            db.execSQL("UPDATE media SET lat = (SELECT s.orig_lat FROM sent_meta s WHERE s.path = ?), " +
                "lon = (SELECT s.orig_lon FROM sent_meta s WHERE s.path = ?), place = NULL, place_name = NULL WHERE id = ?",
                arrayOf<Any?>(path, path, id))
            db.execSQL("UPDATE sent_meta SET lat = prev_lat, lon = prev_lon, user_coords = 0, orig_lat = NULL, orig_lon = NULL, " +
                "prev_lat = NULL, prev_lon = NULL WHERE path = ?", arrayOf<Any?>(path))
        }
    }

    /** The position the photo had before the user changed it (null: none, or not changed). */
    fun originalCoords(path: String): Pair<Double, Double>? = readableDatabase.rawQuery(
        "SELECT orig_lat, orig_lon FROM sent_meta WHERE path = ? AND user_coords = 1 AND orig_lat IS NOT NULL AND orig_lon IS NOT NULL",
        arrayOf(path)).use { c -> if (c.moveToFirst()) c.getDouble(0) to c.getDouble(1) else null }

    /** Private places or places left out changed: items skipped for them are decided again. */
    fun resetSkippedPlaceNames(): Int = writableDatabase.compileStatement(
        "UPDATE media SET place_name = NULL WHERE place_name = '${PlaceNames.SKIPPED}'").executeUpdateDelete()

    /** Every OpenStreetMap answer so far (lat, lon, name), for photos taken at the same spot ([PlaceNames.sameSpot]). */
    fun allLookups(): MutableList<Triple<Double, Double, String>> {
        val out = ArrayList<Triple<Double, Double, String>>()
        readableDatabase.rawQuery("SELECT lat, lon, name FROM place_lookups", null).use { c ->
            while (c.moveToNext()) out += Triple(c.getDouble(0), c.getDouble(1), c.getString(2))
        }
        return out
    }

    /** An OpenStreetMap answer for [path] at these coordinates ("" = nothing named there). */
    fun saveLookup(path: String, lat: Double, lon: Double, name: String, now: Long) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO place_lookups (path, lat, lon, name, looked_up_at) VALUES (?, ?, ?, ?, ?)",
            arrayOf<Any>(path, lat, lon, name, now))
    }

    /**
     * Settings → Photo caption → look up place names again: [all] = every item without a name from the iPhone
     * (the complete re-run), else only those where nothing was found. Returns how many will be looked up.
     */
    fun resetPlaceNames(all: Boolean): Int = inTransaction {
        val db = writableDatabase
        if (all) {
            db.execSQL("DELETE FROM place_lookups")
            db.execSQL("UPDATE media SET place_name = NULL")
        } else {
            db.execSQL("DELETE FROM place_lookups WHERE name = ''")
            db.execSQL("UPDATE media SET place_name = NULL WHERE place_name = ''")
        }
        withoutPlaceNameCount()
    }

    fun deleteRow(id: Long) {
        writableDatabase.execSQL("DELETE FROM media WHERE id = ?", arrayOf<Any>(id))
    }

    data class TrashItem(
        val id: Long, val originalPath: String, val trashPath: String, val type: String, val size: Long,
        val comment: String?, val deletedAt: Long,
        val fitOverride: String? = null, val cropX: Double? = null, val cropY: Double? = null, val view: String? = null,
    )

    fun addTrash(originalPath: String, trashPath: String, item: Item, deletedAt: Long): Long {
        val cv = ContentValues().apply {
            put("original_path", originalPath); put("trash_path", trashPath); put("type", item.type)
            put("size", item.size); put("comment", item.comment); put("deleted_at", deletedAt)
            put("fit_override", item.fitOverride); put("crop_x", item.cropX); put("crop_y", item.cropY); put("view", item.view)
        }
        return writableDatabase.insertOrThrow("trash", null, cv)
    }

    fun trash(olderThan: Long? = null): List<TrashItem> {
        val out = ArrayList<TrashItem>()
        val (where, args) = if (olderThan != null) "WHERE deleted_at < ?" to arrayOf(olderThan.toString()) else "" to emptyArray()
        readableDatabase.rawQuery("SELECT * FROM trash $where ORDER BY deleted_at DESC, id DESC", args).use { c ->
            fun str(n: String) = c.getColumnIndexOrThrow(n).let { if (c.isNull(it)) null else c.getString(it) }
            fun dbl(n: String) = c.getColumnIndexOrThrow(n).let { if (c.isNull(it)) null else c.getDouble(it) }
            while (c.moveToNext()) {
                out += TrashItem(c.getLong(c.getColumnIndexOrThrow("id")), str("original_path")!!, str("trash_path")!!,
                    str("type")!!, c.getLong(c.getColumnIndexOrThrow("size")), str("comment"),
                    c.getLong(c.getColumnIndexOrThrow("deleted_at")), str("fit_override"), dbl("crop_x"), dbl("crop_y"), str("view"))
            }
        }
        return out
    }

    fun removeTrash(id: Long) {
        writableDatabase.execSQL("DELETE FROM trash WHERE id = ?", arrayOf<Any>(id))
    }

    fun problems(limit: Int): List<Item> {
        val out = ArrayList<Item>()
        readableDatabase.rawQuery(
            "SELECT * FROM media WHERE status IN (?, ?, ?) AND hidden = 0 ORDER BY path LIMIT $limit",
            arrayOf(STATUS_UNSUPPORTED, STATUS_TOO_LARGE, STATUS_ERROR)
        ).use { c -> while (c.moveToNext()) out += c.toItem() }
        return out
    }

    fun volumeLabels(): Map<String, String?> {
        val out = HashMap<String, String?>()
        readableDatabase.rawQuery("SELECT id, label FROM volumes", null).use { c ->
            while (c.moveToNext()) out[c.getString(0)] = c.getString(1)
        }
        return out
    }

    private fun Cursor.toItem(): Item {
        fun str(n: String) = getColumnIndexOrThrow(n).let { if (isNull(it)) null else getString(it) }
        fun int(n: String) = getColumnIndexOrThrow(n).let { if (isNull(it)) null else getInt(it) }
        fun long(n: String) = getColumnIndexOrThrow(n).let { if (isNull(it)) null else getLong(it) }
        fun dbl(n: String) = getColumnIndexOrThrow(n).let { if (isNull(it)) null else getDouble(it) }
        val fx0 = dbl("face_x0")
        val face = if (fx0 == null) null else floatArrayOf(
            fx0.toFloat(), dbl("face_y0")!!.toFloat(), dbl("face_x1")!!.toFloat(), dbl("face_y1")!!.toFloat()
        )
        return Item(
            id = long("id")!!, path = str("path")!!, source = str("source")!!, volume = str("volume")!!,
            type = str("type")!!, width = int("width"), height = int("height"), takenAt = long("taken_at"),
            addedAt = long("added_at")!!, mtime = long("mtime")!!, lat = dbl("lat"), lon = dbl("lon"),
            fitOverride = str("fit_override"), cropX = dbl("crop_x"), cropY = dbl("crop_y"), place = str("place"), face = face, displayW = int("display_w"), displayH = int("display_h"),
            rev = int("rev")!!, status = str("status")!!, statusDetail = str("status_detail"),
            available = int("available") == 1, hidden = int("hidden") == 1, comment = str("comment"), size = long("size") ?: 0,
            durationMs = long("duration_ms"), placeName = str("place_name"), placeLabel = str("place_label"), privateKey = str("private_key"),
            view = str("view"),
        )
    }

    companion object {
        private const val VERSION = 1
        const val STATUS_PENDING = "pending"
        const val STATUS_OK = "ok"
        const val STATUS_UNSUPPORTED = "unsupported"
        const val STATUS_TOO_LARGE = "too_large"
        const val STATUS_ERROR = "error"
    }
}
