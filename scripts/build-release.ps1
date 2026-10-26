# Build the release APK (versionName from app/build.gradle.kts), signed with the user's key
# (scripts/signing-setup.ps1 once). Runs the JVM tests first.
#   .\scripts\build-release.ps1
. "$PSScriptRoot\env.ps1"
if (-not $env:OPENFRAME_KEYSTORE) { throw 'No signing key set up: run scripts\signing-setup.ps1 first.' }

Push-Location $Root
try {
    & .\gradlew.bat testDebugUnitTest assembleRelease --console=plain @args
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed ($LASTEXITCODE)" }
    Write-Output "APK: $ReleaseApk"
} finally { Pop-Location }
