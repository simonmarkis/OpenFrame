package app.openframe

import android.content.Context
import android.os.storage.StorageManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Read-only storage diagnostics, reachable over Wi-Fi (`GET /api/diagnostics/storage`).
 * USB drives and ADB share the frame's single USB controller, so drive problems can
 * only be debugged without ADB.
 */
object Diagnostics {

    fun storage(context: Context, indexer: MediaIndexer): JSONObject {
        val volumes = JSONArray()
        val sm = context.getSystemService(StorageManager::class.java)
        for (sv in sm.storageVolumes) {
            val path = try { sv.javaClass.getMethod("getPath").invoke(sv) as String } catch (e: Exception) { null }
            volumes.put(JSONObject()
                .put("description", sv.getDescription(context))
                .put("uuid", sv.uuid ?: JSONObject.NULL)
                .put("state", sv.state)
                .put("removable", sv.isRemovable)
                .put("primary", sv.isPrimary)
                .put("path", path ?: JSONObject.NULL))
        }

        val usb = JSONArray()
        File("/sys/bus/usb/devices").listFiles()?.sortedBy { it.name }?.forEach { d ->
            val vid = readSmall(File(d, "idVendor")) ?: return@forEach
            usb.put(JSONObject()
                .put("device", d.name)
                .put("id", "$vid:${readSmall(File(d, "idProduct"))}")
                .put("product", readSmall(File(d, "product")) ?: JSONObject.NULL)
                .put("class", readSmall(File(d, "bDeviceClass")) ?: JSONObject.NULL))
        }

        return JSONObject()
            .put("time", System.currentTimeMillis())
            .put("storageVolumes", volumes)
            .put("indexedVolumes", JSONArray(indexer.volumes.map { "${it.id} -> ${it.scanRoot}" }))
            .put("usbDevices", usb)
            .put("usbRole", readSmall(File("/sys/devices/platform/ff2c0000.syscon/ff2c0000.syscon:usb2-phy@100/otg_mode"))
                ?: JSONObject.NULL)
            .put("blockDevices", JSONArray(readLines("/proc/partitions").filter { Regex("\\bsd[a-z]\\d*$").containsMatchIn(it) }))
            .put("mounts", JSONArray(readLines("/proc/mounts").filter { "/mnt/media_rw" in it || "/storage/" in it }))
            .put("filesystems", JSONArray(readLines("/proc/filesystems").filter { !it.startsWith("nodev") }.map { it.trim() }))
    }

    private fun readSmall(f: File): String? = try { f.readText().trim().take(200) } catch (e: Exception) { null }

    private fun readLines(path: String): List<String> = try { File(path).readLines() } catch (e: Exception) { emptyList() }
}
