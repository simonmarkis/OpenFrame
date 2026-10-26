package app.openframe

import android.util.Log
import java.io.File

/**
 * One-time move of the app's data into a fresh install (SPEC §16; the V1.0.0 switch to the user's own
 * signing key, 2026-10-19). Android lets a build signed with another key in only after an uninstall,
 * which wipes the app's private data; the old data is copied from the PC to [FOLDER] beforehand, with a
 * [READY] marker written last.
 *
 * - Runs only when the marker is there and this install has no settings yet: it never overwrites data.
 * - Copies `files/`, `databases/`, `shared_prefs/` into the app's data folder, `files/config.json` last, so
 *   a start interrupted halfway copies again next time.
 * - Then deletes [FOLDER]: it holds the secrets (PIN, upload key, calendar links) on shared storage.
 */
object DataMove {
    const val FOLDER = "OpenFrame/move-in"
    const val READY = "READY"
    private val TREES = listOf("files", "databases", "shared_prefs")
    private const val LAST = "files/config.json"

    sealed class Result {
        object NotAsked : Result()
        object SkippedHasData : Result()
        data class Moved(val files: Int) : Result()
        data class Failed(val message: String) : Result()
    }

    fun run(source: File, dataDir: File): Result {
        if (!File(source, READY).isFile) return Result.NotAsked
        if (File(dataDir, LAST).isFile) return Result.SkippedHasData
        return try {
            var n = 0
            var last: File? = null
            for (tree in TREES) {
                val from = File(source, tree)
                if (!from.isDirectory) continue
                // SQLite rebuilds its -shm index from the WAL; an old one could be stale.
                from.walkTopDown().filter { it.isFile && !it.name.endsWith("-shm") }.forEach { f ->
                    val rel = f.relativeTo(source).invariantSeparatorsPath
                    if (rel == LAST) { last = f; return@forEach }
                    copy(f, File(dataDir, rel))
                    n++
                }
            }
            val config = last ?: return Result.Failed("The folder has no settings file ($LAST)")
            copy(config, File(dataDir, LAST))
            Result.Moved(n + 1)
        } catch (e: Exception) {
            Result.Failed("${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun copy(from: File, to: File) {
        to.parentFile?.mkdirs()
        val tmp = File(to.parentFile, to.name + ".moving")
        from.copyTo(tmp, overwrite = true)
        if (!tmp.renameTo(to)) {
            to.delete()
            if (!tmp.renameTo(to)) throw java.io.IOException("Could not place ${to.name}")
        }
    }

    /** At start-up, before anything opens the settings or the database. Logs counts only, never contents. */
    fun runAtStart(app: OpenFrameApp) {
        @Suppress("DEPRECATION")
        val source = File(android.os.Environment.getExternalStorageDirectory(), FOLDER)
        when (val r = run(source, File(app.applicationInfo.dataDir))) {
            Result.NotAsked -> return
            Result.SkippedHasData -> Log.w(TAG, "Data move: this install already has settings; left them as they are")
            is Result.Moved -> Log.i(TAG, "Data move: ${r.files} files moved in")
            is Result.Failed -> { Log.e(TAG, "Data move failed: ${r.message}"); return } // folder kept: it can be tried again
        }
        if (!source.deleteRecursively()) Log.e(TAG, "Data move: could not delete $FOLDER (it holds secrets: delete it by hand)")
    }
}
