# Return Frameo

How to bring stock Frameo back after OpenFrame replaced it.
Nothing was uninstalled: Frameo is only **disabled**, with all its photos and settings kept.

## Before you start

- A Windows PC with `adb` (`Downloads\platform-tools-latest-windows\platform-tools\adb.exe`).
- The frame connected by USB cable. If `adb devices` shows nothing (for example after a restart),
  unplug and re-plug the cable.
- Run the commands below in PowerShell from the `platform-tools` folder (or with `adb` on the PATH).

## 1. Turn Frameo back on

```
adb shell pm enable net.frameo.frame
```

## 2. Make Frameo the home app again

```
adb shell cmd package set-home-activity net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted
```

Optional, so Android never offers OpenFrame as a home app:

```
adb shell pm disable app.openframe/.HomeActivity
```

## 3. Show Frameo now

```
adb shell am start -n net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted
```

Frameo's own sleep schedule and settings come back as they were. Check them in Frameo →
Settings → Display → Sleep mode. If OpenFrame stays installed with its sleep schedule on, turn
OpenFrame's sleep off (step 4), or two schedules will run.

## 4. Optional: remove OpenFrame completely

OpenFrame holds a "device admin" for sleep, which blocks uninstalling. Remove it first:

```
adb shell dpm remove-active-admin app.openframe/.SleepAdminReceiver
adb uninstall app.openframe
```

The photos in `/sdcard/FrameMedia/` stay on the frame. OpenFrame's settings, calendar links, and
PIN are deleted with the app.

To keep OpenFrame installed but out of the way, run only the first line (no more sleep control).
Its brightness and "Back to OpenFrame" permissions can be turned off too:

```
adb shell appops set app.openframe WRITE_SETTINGS deny
adb shell appops set app.openframe SYSTEM_ALERT_WINDOW deny
```

## 5. Restart and check

```
adb reboot
```

After the restart (re-plug the cable to use `adb` again), Frameo should come up on its own, with
Wi-Fi connected and the right time.

## If something goes wrong

- **The frame shows "Select a home app"**: tap Frameo, then **Always**.
- **Nothing shows on screen at all** (emergency fallback launcher):
  `adb shell pm enable com.android.launcher3`
- Never re-enable SystemUI and never uninstall Frameo: it is a system app.
