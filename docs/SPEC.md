# OpenFrame — design overview

How OpenFrame is put together and what it does, as built. For building and installing, see the README.

## 1. Goals

A reliable, subscription-free home screen for a Frameo-based photo frame: a photo and video slideshow with any
number of colour-coded Google calendars, a clock and weather, and settings that work from the frame and from any
phone or computer on the home network.

- **Works offline**: cached calendars, cached weather and local photos keep showing with no internet. No account,
  cloud service, or other server is needed.
- **Starts on boot**, fully usable by touch, and **recovers from crashes** on its own.
- **Light on memory**: the target frame has ~950 MB of RAM (~590 MB free at idle). One WebView, pre-resized images.
- **Reversible**: Frameo stays installed (only disabled); OpenFrame can be removed at any time
  (`docs/return-frameo.md`).

Not included: Frameo's friends, codes and cloud, two-way calendar editing.

## 2. The frame

Built and tested on a Pastigio "Frame 156" (internally M15R4): Rockchip RK3326, **Android 8.1 (API 27)** with a
32-bit userspace, 1366×768 screen that rotates to portrait, WebView 106. Facts that shaped the design:

- `ro.config.low_ram=true`: the WebView runs in the app's process, so a renderer crash kills the app; recovery is a
  process restart.
- SystemUI and the launcher are disabled from the factory: no status bar, Back or Home button. OpenFrame is the
  HOME app and brings its own way back from Android screens (§12).
- No Play Services, calendar provider, or document picker (apps can't write to SD cards or USB drives).
- Video: Rockchip's own `MediaPlayer` plays H.264 and HEVC up to 1080p at 30 and 60 fps; 4K plays corrupt without an
  error and 10-bit fails, so the frame checks every video itself. `MediaMetadataRetriever` returns no date or place
  for videos; OpenFrame reads the `moov` box.
- No battery-backed clock: after a restart the time is stale until network time arrives (~30 s); the clock shows
  "--" until then.
- ADB and the USB port share one controller: a USB drive works only with the PC cable unplugged. FAT32 and NTFS
  drives mount; exFAT doesn't.
- Root (`su`) exists from the factory. The app uses it for one thing only: Shut down and Restart in the quick menu.

## 3. Architecture

A **thin native Kotlin shell** hosts a **local web UI** (HTML/CSS/JS, no build step) in one full-screen WebView.
The UI talks to the shell over HTTP on `127.0.0.1:8080`; other devices on the home network use the same server
behind a PIN. Runtime dependency: NanoHTTPD only (no AndroidX, no Play Services).

Shell (`app/src/main/java/app/openframe/`):

| Class | Role |
|---|---|
| `MainActivity` | Full-screen WebView limited to the local server; reached as HOME through the `.HomeActivity` alias. |
| `LocalServer` | NanoHTTPD on port 8080: UI files, JSON API, media, uploads, the PIN gate, security headers. |
| `MediaIndexer`, `MediaDb`, `ImageProcessor` | Index `FrameMedia/` and removable drives, display copies, face crop, SQLite `media.db`. |
| `VideoCheck`, `Mp4Meta`, `VideoStrip`, `VideoPlayer` | What the frame can play; a video's date and place; scrub previews; native playback behind the WebView. |
| `Slideshow` | Order, shuffle deck, history; survives reloads and restarts. |
| `CalendarSync`, `IcsTrimmer` | Download, cache and trim ICS feeds; retries before warning. |
| `WeatherSync` | Open-Meteo forecast and place search. |
| `ConfigStore`, `ConfigHistory`, `ConfigBackup`, `SecretsStore` | Validated `config.json`, snapshots, export/import, `secrets.json`. |
| `WebAccess`, `PinGuard` | Web access PIN, sessions, upload key. |
| `WarningRules`, `WarningCenter`, `UploadRefusals` | What counts as a problem; popups and their dismissals. |
| `UploadReceiver`, `UploadNames`, `UploadMeta` | `POST /api/upload` with date and place sent by the phone. |
| `Library`, `MediaEdits` | Thumbnails, delete to Trash / hide, restore, forget a drive; per-photo fit, zoom, position, comment. |
| `PlaceIndex`, `Places`, `PlaceNames`, `PlaceLookup` | Offline town names; precise place names from OpenStreetMap; private places. |
| `PowerController`, `SleepSchedule`, `SleepAdminReceiver`, `PowerAlarmReceiver`, `PowerOff`, `PowerLog` | Sleep and wake, schedules, brightness, Shut down / Restart. |
| `FrameService` | Foreground service while the UI exists, so night-time work keeps running. |
| `SoundController` | Media and click volumes, reminder chimes on the alarm volume. |
| `CrashGuard`, `RestartReceiver`, `HomeApp`, `BootReceiver` | Restart after crashes, start on boot, HOME checks. |
| `ReturnOverlay` | "Back to OpenFrame" button over Android's Wi-Fi screen. |
| `MdnsName`, `ShortcutFile` | The frame's network name `openframe.local`; the Shortcut file and the address the Shortcut sends to. |
| `ClockTrust`, `SystemInfo`, `Diagnostics` | Whether the clock can be trusted yet; Settings → System facts and set-up checks. |

Web UI (`app/src/main/assets/web/`): `app.js` (layouts, quick menu, pages), `slideshow.js`, `photo-menu.js`,
`caption.js`, `clock.js`, `calendar-day.js`, `calendar-full.js` + `calendar-timegrid.js` + `calendar-month.js` +
`calendar-sheet.js`, `reminders.js`, `warnings.js`, `layout-editor.js`, `settings.js`, `theme.js` + `dark.css`;
pages `settings.html`, `upload.html`, `shortcut.html`, `pin.html`. Pure logic lives in `lib/` and is shared with
the Node tests. Vendored: ical.js, Leaflet, fonts (`docs/THIRD_PARTY.md`). Targets Chromium 106. A small JS bridge is
used only where HTTP can't do the job (placing the native video).

A test build serves the UI from `/sdcard/OpenFrame/ui-dev/` when present (`scripts/push-ui.ps1`, marked "DEV UI");
release builds always use the bundled UI.

## 4. Storage

```
/sdcard/FrameMedia/          photos and videos (reachable over USB/MTP)
  uploads/                   sent from phones
  .trash/                    deleted files, kept 30 days
```

- Any file copied into `FrameMedia/` is picked up; dot folders are skipped.
- SD cards and USB drives are read **read-only**, the whole drive or one folder. An unplugged drive's items are
  remembered (comments, hidden marks, zoom) until it is forgotten in Settings.
- App-private: `config.json`, `config-history/`, `secrets.json`, `media.db`, caches for display copies, thumbnails,
  calendars and weather.

## 5. Photos and videos

- **Photos**: JPEG, PNG, WebP (HEIC can't be decoded on Android 8.1 and is reported). Each gets a display copy big
  enough to fill the screen in either orientation (long edge ≤ 2048) and a tiny blurred background copy. EXIF date
  and GPS are read. Fill crops are centred on faces (Android's `FaceDetector`, frontal faces only).
- **Videos**: MP4/MOV with H.264 or HEVC up to 1920×1088, 8-bit; anything else is listed under "Can't be shown" with
  a plain reason. The first frame is the poster. Playback is native (`MediaPlayer` on a `SurfaceView` behind a
  transparent WebView), so the clock, caption and menus stay on top. Play once and continue (default), play once and
  wait, or loop; a video is never cut off. A preview strip makes the seek bar smooth.
- **Slideshow**: shuffle (every item once before repeating), date taken or date added, reversible; new items jump
  the queue. Interval 30 s by default; fit or fill; blur, black or colour background; cross-fade. Swipe for
  next/previous, tap for the menu. Only the frame advances; other browsers mirror it. Paused while the screen is off.

## 6. On the screen

- **Layouts**: Hybrid (photo with a calendar column beside it in landscape, below it in portrait), Pictures only,
  Calendar only, or a custom layout from the **layout editor** (boxes for photo, clock and weather, day panel,
  calendar, caption, status). More pages are optional and switched with dots or the menu.
- **Clock and weather**: as a panel or over the photo in a chosen corner; 12/24 h, date format, time zone; current
  temperature, high/low, condition, feels like, chance of rain, next days (Open-Meteo).
- **Photo caption**: comment, place and date taken in a bubble, one or two lines. Places come from GPS: offline town
  names (GeoNames, bundled) and, if switched on, precise names (a park, church, building) looked up on OpenStreetMap
  with only the photo's position sent. **Private places** (like home) are named locally and never looked up.
  Towns can be left out of captions.
- **Text style**: font, bold, colour (automatic picks white or dark by the photo under it), shadow, outline,
  opacity, overall and per item.
- **Dark mode**: light, dark, or automatic (sunset to sunrise, around sleep hours, or between two times); photos are
  never changed. The calendar panel can follow it or keep its own look.

## 7. Calendars

- Any number of Google calendars by their **secret iCal link** (write-only in the UI: never shown again), each with
  a colour. Feeds are trimmed on the frame and cached; the frame shows them offline.
- **Day panel** with the next days, a **Now** badge on the event in progress, past events faded; a full-screen
  calendar with **Day, Week and Month** views (overlapping events cascade, 24-hour events as all-day bars).
- **Reminders** per calendar: a card with a chime some minutes before an event, closing itself after 2 minutes;
  quiet during sleep hours. Bundled chimes, with their own volume.
- Events can be **hidden** on the frame; with an email set for a calendar, events that address declined are
  crossed out.
- A failing calendar is retried (after 1 minute three times, then 5 minutes twice) before it becomes a warning.

## 8. Touch, menus and the photo library

- **Tap the photo** for the quick menu: Settings, Sleep, Power (Shut down / Restart), Pages, and the photo's own
  actions: Fit or Fill, **Position** (drag, pinch or slider from the whole photo to 2× fill, separately for landscape
  and portrait), Comment, Location, Mark private, Hide, Delete (Undo for 10 s).
- **Library** (Settings): every photo and video as a grid, with filters for hidden ones and ones that can't be shown;
  select several to hide or delete. Deleting on the frame moves files to the **Trash** for 30 days; on SD cards and
  USB drives the frame can only hide.
- Inactivity returns to the home layout after a set time.

## 9. Settings

Settings opens over the photo page on the frame, and at `http://<frame-ip>:8080/settings` from other devices.
Changes save instantly; another device's changes show up within 10 s.

- Laid out like a phone's settings: a **search box**, then short pages in four groups, each with a coloured icon and
  its current value: Slideshow, Videos, Photo caption, Library, Add from your phone · Calendars, Sound and reminders ·
  Layout, Clock and weather, Dark mode, Text style, Brightness and sleep · Warnings, Backup and restore, System, Help.
- Rows show their value beside the name and open a list; two or three short choices are buttons. Rarely used
  settings are on pages of their own. Previews show the home layout as the frame draws it.
- **Snapshots**: the settings before each change (one per burst, last 20), restorable. **Export/import** as a file
  from a phone or computer; calendar links only if asked for. Restore and import never remove calendars.
- `config.json` holds everything that isn't secret; `secrets.json` holds calendar links, the PIN, the session key,
  and the upload key.

## 10. Web access PIN and uploads

- Every request from another device needs a signed-in session (4–8 digit PIN, sessions last a day). The frame itself
  (loopback) never asks. Until a PIN is set, other devices can't open anything. PIN, cookie and keys are compared in
  constant time.
- **Uploads**: the upload page (`/upload`, behind the PIN) or the **iPhone Shortcut** (`docs/ios-shortcut.md`) with
  its own **upload key** that can only add photos and videos. The Shortcut sends the date taken and place; videos
  larger than 1080p or 10-bit are refused with a reason. Exact duplicates are skipped.
- **The frame's name**: the frame answers to **`openframe.local`** (`openframe-2.local` and so on if the name is taken),
  so the Shortcut keeps working when the router gives the frame a new IP. Android's own mDNS daemon (`mdnsd`) already
  holds the mDNS port, so the app registers an A record with it through its local socket (`/dev/socket/mdnsd`, the
  messages of `DNSServiceRegisterRecord`; no root), again when the IP changes or the daemon restarts, and holds a
  Wi-Fi multicast lock so lookups still arrive while the screen is off. Settings → iPhone Shortcut shows the name and
  the address the Shortcut really sends to (the `Host` of the last upload with the key); the set-up guide uses the
  name, with the IP as a backup for networks that block names.
- Every response carries `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` and `nosniff`. Plain HTTP on the
  home network: never forward port 8080 on the router.

## 11. Sleep, power and recovery

- **Sleep schedules** (several, by weekday): the screen really turns off through a device admin that may only lock
  the screen; a **swipe** wakes it, a tap doesn't. Woken during sleep hours, it sleeps again after a few minutes
  without a touch. **Sleep now** in the menu.
- **Brightness** through Android's own setting (needs `WRITE_SETTINGS`).
- **Shut down / Restart** from the menu (frame only, with a confirmation; after Shut down only the power button
  starts it). Presses are logged across restarts so an unexpected restart can be told apart.
- **Crash recovery**: a watchdog restarts the app after a crash (bypassing Android's crash dialog) and logs it; the UI
  reloads nightly. OpenFrame comes to the front after boot.

## 12. Warnings and Android screens

- Problems (a calendar that keeps failing, a refused upload, a Shortcut still sending to an IP the frame no longer
  has, photos that can't be shown, storage, sleep set-up,
  repeated restarts) show a small icon; calendar and upload problems also pop up once. Popups close themselves after
  60 s. Offline shows only an offline icon.
- Android's Wi-Fi screen opens with a **"Back to OpenFrame"** button over it (needs `SYSTEM_ALERT_WINDOW`), since the
  frame has no Back or Home button.

## 13. One-time set-up and how to undo it

Granted over adb; each can be undone.

| What | Set up | Undo |
|---|---|---|
| OpenFrame as HOME | `adb shell pm enable app.openframe/.HomeActivity`, then `adb shell cmd package set-home-activity app.openframe/.HomeActivity` | `adb shell cmd package set-home-activity net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted` (see `docs/return-frameo.md`) |
| Sleep (device admin, lock only) | `adb shell dpm set-active-admin app.openframe/.SleepAdminReceiver` | Settings → Brightness and sleep → Sleep set-up → Turn off sleep |
| Brightness | `adb shell appops set app.openframe WRITE_SETTINGS allow` | `... WRITE_SETTINGS deny` |
| "Back to OpenFrame" button | `adb shell appops set app.openframe SYSTEM_ALERT_WINDOW allow` | `... SYSTEM_ALERT_WINDOW deny` |
| USB debugging switch in Settings | `adb shell pm grant app.openframe android.permission.WRITE_SECURE_SETTINGS` | `adb shell pm revoke ...` |
| Emergency launcher | | `adb shell pm enable com.android.launcher3` |

Updates can go over Wi-Fi: `scripts\wifi-adb.ps1` with the cable once after each restart of the frame, then set
`OPENFRAME_WIFI` to the address it prints.

## 14. API

From other devices every endpoint needs the PIN session (uploads may use the upload key instead).

| Area | Endpoints |
|---|---|
| Pages | `/`, `/settings`, `/upload`, `/shortcut`, `/pin.html` |
| Status | `GET /api/status`, `GET /api/system`, `GET /api/network`, `POST /api/ui/reload` |
| Power | `GET /api/power`, `POST /api/power/sleep`, `POST /api/power/wake`, `POST /api/power/off {action}` (frame only) |
| Config | `GET`/`PATCH /api/config`, `GET /api/config/history`, `POST /api/config/history/<id>/restore`, `GET /api/config/export[?secrets=1]`, `POST /api/config/import` |
| Auth | `GET /api/auth/state`, `POST /api/auth/login`, `GET`/`POST /api/auth/pin`, `POST /api/auth/logout` |
| Media | `GET /api/media`, `POST /api/media/rescan`, `GET`/`PATCH /api/media/<id>`, `GET /api/slideshow/{current,next,prev}`, `/media/display/<id>.jpg`, `/media/thumb/<id>.jpg`, `/media/video/<id>` |
| Library | `GET /api/library`, `POST /api/library/delete\|hide\|unhide`, `GET /api/trash`, `POST /api/trash/restore\|delete`, `DELETE /api/volumes/<id>` |
| Sound | `GET /api/sound`, `POST /api/sound/test`, `POST /api/sound/reminder` |
| Upload | `POST /api/upload?name=&comment=&taken=&lat=&lon=&place=`, `POST /api/upload/key/renew`, `GET`/`POST`/`DELETE /api/shortcut` |
| Calendars | `GET`/`POST /api/calendars`, `GET`/`PATCH`/`DELETE /api/calendars/<id>`, `POST /api/calendars/refresh` |
| Weather | `GET /api/weather`, `POST /api/weather/refresh`, `GET /api/weather/geocode?q=` |
| Places | `GET /api/places/search?q=`, `GET`/`POST /api/places/names`, `GET /api/places/address?q=`, `GET /api/places/nearby`, `POST /api/places/coords\|label\|private` |
| Warnings | `GET /api/warnings`, `POST /api/warnings/dismiss` |

## 15. Testing

- Node tests for the web UI's pure logic: `node --test "tests/**/*.test.mjs"` (calendar fixtures are synthetic).
- JVM tests for the shell's pure classes (sleep schedules, media edits, place index and names, video checks, MP4
  metadata, warnings, config validation): `scripts\build.ps1 testDebugUnitTest`, or `scripts\deploy.ps1 -Test`.
- On the frame: `scripts\shot.ps1` (screenshot), `scripts\logs.ps1`, `scripts\mem.ps1`, and
  `node scripts/frame-js.mjs "<expr>"` to run JavaScript in the frame's WebView (test builds only).
- Synthetic test media: `scripts/test-media/make-synthetic.ps1` and `make-videos.ps1`.
