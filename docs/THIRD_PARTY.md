# Third-party components

Everything ships inside the APK (no CDN, works offline). Listed in Settings → System → About.

| Component | Version | License | Where | Notes |
|---|---|---|---|---|
| [NanoHTTPD](https://github.com/NanoHttpd/nanohttpd) | 2.3.1 | BSD-3-Clause | Gradle dependency | Embedded HTTP server |
| [ical.js](https://github.com/kewisch/ical.js) | 2.2.1 | MPL-2.0 | `app/src/main/assets/web/lib/ical.js` (+ `ical.js.LICENSE.txt`) | Unmodified `dist/ical.js` from npm; tarball sha512 `yK/UlPbEs316igb/tjRgbFA8ZV75rCsBJp/hWOatpyaPNlgw0dGDmU+FoicOcwX4xXkeXOkYiOmCqNPFpNPkQg==`; file sha256 `396c1349c899974b1048460e3c7495ec394ff1a86941ab5bf6291b272b8d53c2` |
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | `app/src/main/assets/web/lib/leaflet/` (`leaflet.js`, `leaflet.css`, three marker images, `LICENSE`) | Unmodified `dist/` files from npm `leaflet@1.9.4` (2023-05-18; downloaded 2026-10-19 with the user's OK); tarball sha512 `nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==`; `leaflet.js` sha256 `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a`, `leaflet.css` sha256 `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6`. The location editor's map (loaded when it opens). |
| [GeoNames](https://www.geonames.org/) cities5000 (places with more than 5,000 people) | downloaded 2026-10-14 | CC BY 4.0 | `app/src/main/assets/geo/cities.tsv` | Trimmed by `scripts/geo/make-cities.mjs` to name, coordinates, country, US state, population (64,505 places; sha256 `fcb9a2fed7bc719071ed60b222ac68cbd8664be1a81916db1fa06811a71d5624`). Photo caption locations and places left out (`PlaceIndex`). Credited in Settings → System → Licenses. |
| Fonts: Roboto (Light, Regular, Bold), Roboto Condensed (Regular, Bold), Coming Soon | as on the frame (Android 8.1) | Apache-2.0 | `app/src/main/assets/web/fonts/` (+ `LICENSES.txt`) | Copied from the frame's `/system/fonts` (no download); licenses from its `/system/etc/NOTICE.xml.gz`. Text styles (`fonts.css`; the frame uses its installed copies via `local()`). |
| Fonts: Noto Serif (Regular, Bold), Dancing Script (Regular, Bold), Cutive Mono | as on the frame (Android 8.1) | OFL-1.1 | `app/src/main/assets/web/fonts/` (+ `LICENSES.txt`) | Same source. Credited in Settings → System → Licenses. |
| Material Design icons (a few paths) | — | Apache-2.0 | inline SVG in `settings.js`, `app.js`, `photo-menu.js`, `warnings.js`, `calendar-full.js`, `pin.html`, `upload.html` | Settings (incl. sleep cards), quick menu (Wi-Fi, sleep, arrows), status icons, calendar toolbar |
| Reminder chimes (5; 10 until 2026-10-26, when the user removed `bell-2…4`, `glass`, `rise`): "Interface Sounds" by [Kenney](https://kenney.nl/assets/interface-sounds) (`confirmation_002/004`, `question_001`), "[Pleasing Bell](https://opengameart.org/content/pleasing-bell-sound-effect)" by Spring Spring, "[Bell dings/chimes](https://opengameart.org/node/53288)" by PWL (`bell_ding1`) | downloaded 2026-10-16 (user approved) | CC0-1.0 | `app/src/main/assets/web/sounds/*.m4a` | Converted with ffmpeg to mono AAC 96 kb/s (peak about −1 dB; the bell boosted 22 dB); names: `confirm-1/2`, `question`, `vibraphone`, `bell-1`. Credited in Settings → System → About (not required by CC0). |
| Reminder chime "Music box" | BigSoundBank #1867 "Music box, C #1" by Joseph Sardin, downloaded 2026-10-26 | CC0-1.0 | `app/src/main/assets/web/sounds/music-box.wav` | Mono 16-bit, trimmed, peak −1 dB. Credited in Settings → System → About. |
| JUnit | 4.13.2 | EPL-1.0 | test only | Not shipped |
| [JSON-java](https://github.com/stleary/JSON-java) (`org.json:json`) | 20240303 | Public domain | test only | Real `org.json` for JVM unit tests (android.jar has stubs). Not shipped |

The calendar panel icons and the weather icons (`web/lib/weather-icons.js`) are hand-drawn inline SVG (no icon font).

## Data services

| Service | License / terms | Notes |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) forecast API | Data CC BY 4.0; free for non-commercial use, no key | `WeatherSync`, every 30 min (~1.2 KB). Attributed in Settings → System → About. |
| [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) | Based on GeoNames, CC BY 4.0 | Place search for the weather location (`/api/weather/geocode`). Attributed in Settings → System → About. |
| [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) (`tile.openstreetmap.org`) | © OpenStreetMap contributors (ODbL), tile usage policy | The location editor's map (2026-10-19): pictures load only while the user has the map open; attribution on the map. |
| [Postpass](https://postpass.geofabrik.de/) (Geofabrik's public OSM PostGIS) | Data © OpenStreetMap contributors, ODbL 1.0; no published usage policy yet ("no guarantees") | `PlaceLookup` (2026-10-19): the smallest named area a photo's spot is inside (one SQL query per photo, ≥ 2 s apart), same privacy rule as below. Attributed in Settings → System → About. |
| [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (overpass-api.de, overpass.private.coffee) | Data © OpenStreetMap contributors, ODbL 1.0; main server's guidance: well under 10,000 queries a day (÷100 for scheduled use) | `PlaceLookup`: fallback when Postpass can't answer, and a check when it finds no area; ≥ 10 s apart. Attributed in Settings → System → About. |
| [OpenStreetMap Nominatim](https://nominatim.org/) reverse geocoding (`nominatim.openstreetmap.org/reverse`) | Data © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright); [usage policy](https://operations.osmfoundation.org/policies/nominatim/) | `PlaceLookup` (2026-10-19): precise place names for the caption, only for photos with GPS and no name from the iPhone (or all on the user's re-run); at most 1 request a second, User-Agent "OpenFrame/<version> (Android photo frame)", answers cached per file in `media.db`. Attributed in Settings → System → About. |
