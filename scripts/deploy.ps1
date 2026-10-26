# Build the debug APK, install it on the frame, and launch OpenFrame.
# Does not change the HOME app; Frameo stays the launcher.
#   .\scripts\deploy.ps1            build + install + start
#   .\scripts\deploy.ps1 -Test      also run JVM unit tests (install only if they pass)
#   .\scripts\deploy.ps1 -NoBuild   install the existing APK + start
#   .\scripts\deploy.ps1 -Release   install the release APK built by build-release.ps1 (no build here) + start
param([switch]$NoBuild, [switch]$Test, [switch]$Release)
. "$PSScriptRoot\env.ps1"

if ($Release) {
    # -r keep data, -g grant runtime permissions; not -t (a release build isn't test-only).
    if (-not (Test-Path $ReleaseApk)) { throw "No release APK at ${ReleaseApk}: run build-release.ps1 first." }
    adb install -r -g $ReleaseApk
    if ($LASTEXITCODE -ne 0) { throw "adb install failed ($LASTEXITCODE)" }
    adb shell am start -n "$Package/.MainActivity"
    return
}

if (-not $NoBuild) {
    $extra = @()
    if ($Test) { $extra += 'testDebugUnitTest' }
    & "$PSScriptRoot\build.ps1" @extra   # throws on failure, so nothing below runs
}

# -r keep data, -t test-only debug build (sleep admin removable, SPEC §18), -g grant runtime permissions.
adb install -r -t -g $Apk
if ($LASTEXITCODE -ne 0) { throw "adb install failed ($LASTEXITCODE)" }
adb shell am start -n "$Package/.MainActivity"
