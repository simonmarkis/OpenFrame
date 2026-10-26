# OpenFrame

A replacement home screen for a Frameo-based digital photo frame (built and tested on a Pastigio "Frame 156",
Rockchip RK3326, Android 8.1): a photo and video slideshow with a family calendar, clock, and weather, set up from
a phone or computer on the home network. It works fully offline once set up, and needs no account or cloud service.
This app has been mostly vibe-coded so use at your own discretion. 

## What it does

- **Slideshow** of photos and videos from the frame, an SD card, or a USB drive; per-photo fit, zoom, and position;
  captions with comment, date, and place (offline town names, optional precise names from OpenStreetMap).
- **Calendars** from Google "secret address in iCal format" links: day panel, full-screen day / week / month views,
  reminders with chimes, hidden events, declined events crossed out.
- **Layouts**: presets (Hybrid, Pictures, Calendar) or your own, edited on the frame or from a phone.
- **Settings** from any browser on the home network, behind a PIN; backups and restore; warnings when something
  needs attention; dark mode; sleep schedules and brightness.
- **Uploads** from a phone's browser or an iPhone Shortcut (`docs/ios-shortcut.md`), I don't own an android 🤷‍♂️.

## How it is built

A thin Kotlin shell (no AndroidX, no Play Services) hosts a local web UI (plain HTML/CSS/JS, no build step) in one
WebView and serves it with an embedded HTTP server on port 8080. Details, decisions, and the phase history are in
[`docs/SPEC.md`](docs/SPEC.md); bundled third-party components and data services in
[`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md).

## Building

- Android Studio's JDK, the Android SDK, and the Gradle wrapper in this repository (`minSdk 27`, `compileSdk 36`).
- `scripts\build.ps1` builds a debug APK; `scripts\deploy.ps1 [-Test]` installs it over USB (adb) and starts it;
  `scripts\build-release.ps1` builds a release APK signed with your own key (`scripts\signing-setup.ps1`).
- Web UI and logic tests run with Node: `node --test "tests/**/*.test.mjs"`; JVM tests with
  `scripts\build.ps1 testDebugUnitTest`.

Making OpenFrame the frame's home screen, sleep, and brightness need one-time permissions granted over adb;
`docs/SPEC.md` lists each with its rollback, and `docs/return-frameo.md` explains how to go back to Frameo.
**Use at your own risk**: this replaces the frame's normal interface.

## License

MIT (see [`LICENSE`](LICENSE)). Bundled third-party components keep their own licenses, listed in
[`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md).
