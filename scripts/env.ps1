# Shared settings for the OpenFrame helper scripts. Dot-source it: . "$PSScriptRoot\env.ps1"
# Override any of these with environment variables before running a script.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Serial = $env:OPENFRAME_SERIAL # empty: the one device adb sees

$AdbExe = if ($env:ADB) { $env:ADB } else {
    $onPath = Get-Command adb -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($onPath) { $onPath.Source } else { "$env:USERPROFILE\Downloads\platform-tools-latest-windows\platform-tools\adb.exe" }
}
if (-not (Test-Path $AdbExe)) { throw "adb not found at $AdbExe. Set `$env:ADB to its full path." }

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
