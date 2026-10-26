# Take a screenshot on the frame and pull it to .\shots\ (git-ignored).
#   .\scripts\shot.ps1 [name]
param([string]$Name = (Get-Date -Format 'yyyyMMdd-HHmmss'))
. "$PSScriptRoot\env.ps1"

$dir = Join-Path $Root 'shots'
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "$Name.png"
adb shell mkdir -p /sdcard/OpenFrame
adb shell screencap -p /sdcard/OpenFrame/shot.png
adb pull /sdcard/OpenFrame/shot.png $out | Out-Null
adb shell rm /sdcard/OpenFrame/shot.png
Write-Output $out
