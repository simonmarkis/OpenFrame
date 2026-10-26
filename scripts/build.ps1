# Build the debug APK (sets JAVA_HOME / ANDROID_HOME from env.ps1).
#   .\scripts\build.ps1 [extra gradle args]
. "$PSScriptRoot\env.ps1"

Push-Location $Root
try {
    & .\gradlew.bat assembleDebug --console=plain @args
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed ($LASTEXITCODE)" }
    Write-Output "APK: $Apk"
} finally { Pop-Location }
