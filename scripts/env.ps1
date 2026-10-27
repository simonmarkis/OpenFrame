# Shared settings for the OpenFrame helper scripts. Dot-source it: . "$PSScriptRoot\env.ps1"
# Override any of these with environment variables before running a script.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
# Optional: "<frame-ip>:5555" to use debugging over Wi-Fi when no cable is plugged in (scripts\wifi-adb.ps1).
$WifiAddress = $env:OPENFRAME_WIFI

$AdbExe = if ($env:ADB) { $env:ADB } else {
    $onPath = Get-Command adb -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { $onPath.Source } else { "$env:USERPROFILE\Downloads\platform-tools-latest-windows\platform-tools\adb.exe" }
}
if (-not (Test-Path $AdbExe)) { throw "adb not found at $AdbExe. Set `$env:ADB to its full path." }

# The frame: OPENFRAME_SERIAL, else a device on the cable, else debugging over Wi-Fi (OPENFRAME_WIFI), else the one
# device adb sees. Wi-Fi debugging goes off at every restart of the frame: plug the cable in once and run wifi-adb.ps1.
function Resolve-Frame {
    if ($env:OPENFRAME_SERIAL) { return $env:OPENFRAME_SERIAL }
    if (-not $WifiAddress) { return '' }
    $listed = @(& $AdbExe devices 2>$null)
    $usb = $listed | Where-Object { $_ -match '^\S+\s+device$' -and $_ -notmatch ':' } | Select-Object -First 1
    if ($usb) { return ($usb -split '\s+')[0] }
    if (-not ($listed -match "^$([regex]::Escape($WifiAddress))\s+device")) { & $AdbExe connect $WifiAddress | Out-Null }
    return $WifiAddress
}
$Serial = Resolve-Frame

if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

$Apk = Join-Path $Root 'app\build\outputs\apk\debug\app-debug.apk'
$ReleaseApk = Join-Path $Root 'app\build\outputs\apk\release\app-release.apk'

# The user's signing key (scripts/signing-setup.ps1), for this script's Gradle run only. The password is kept with
# Windows DPAPI (this account on this PC) and handed to Gradle as an environment variable; never printed.
$SigningDir = Join-Path $env:USERPROFILE '.openframe'
if (-not $env:OPENFRAME_KEYSTORE -and (Test-Path (Join-Path $SigningDir 'keystore-path.txt')) -and (Test-Path (Join-Path $SigningDir 'keystore-password.dat'))) {
    $env:OPENFRAME_KEYSTORE = (Get-Content (Join-Path $SigningDir 'keystore-path.txt') -Raw).Trim()
    $secure = (Get-Content (Join-Path $SigningDir 'keystore-password.dat') -Raw).Trim() | ConvertTo-SecureString
    $env:OPENFRAME_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    $secure = $null
}
$Package = 'app.openframe'

function adb { if ($Serial) { & $AdbExe -s $Serial @args } else { & $AdbExe @args } }
