# Dev loop (SPEC §4): push a web UI folder to /sdcard/OpenFrame/ui-dev/ and reload the WebView.
# While ui-dev/index.html exists the frame serves that folder and shows a "DEV UI" badge.
#   .\scripts\push-ui.ps1                  push app\src\main\assets\web
#   .\scripts\push-ui.ps1 -Source <dir>    push another folder
#   .\scripts\push-ui.ps1 -Off             remove ui-dev, back to the bundled UI
param(
    [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'app\src\main\assets\web'),
    [switch]$Off
)
. "$PSScriptRoot\env.ps1"

$remote = '/sdcard/OpenFrame/ui-dev'
adb shell rm -rf $remote
if (-not $Off) {
    adb shell mkdir -p $remote
    # Push folder contents (trailing \. ) so files land directly in ui-dev/.
    adb push "$Source\." "$remote/"
    if ($LASTEXITCODE -ne 0) { throw "adb push failed ($LASTEXITCODE)" }
}

adb forward tcp:8080 tcp:8080 | Out-Null
try {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/ui/reload' | Out-Null
    Write-Output ("Reloaded UI ({0})" -f $(if ($Off) { 'bundled' } else { 'dev' }))
} catch {
    Write-Warning "Reload request failed: $($_.Exception.Message). Is OpenFrame running?"
}
