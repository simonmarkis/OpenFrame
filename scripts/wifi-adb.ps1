# Switches the frame's debugging over Wi-Fi on: run it with only the USB cable connected, after every restart of the
# frame (Android turns it off then). Afterwards the other scripts work without the cable once OPENFRAME_WIFI is set.
# Only computers the frame already knows can connect (ro.adb.secure=1).
#   .\scripts\wifi-adb.ps1
$env:OPENFRAME_WIFI = $null # the cable, for this script
. "$PSScriptRoot\env.ps1"

$ip = (adb shell ip -4 addr show wlan0 | Select-String -Pattern 'inet (\d+\.\d+\.\d+\.\d+)').Matches[0].Groups[1].Value
if (-not $ip) { throw 'The frame has no Wi-Fi address (is Wi-Fi on?)' }
adb tcpip 5555 | Out-Null
Start-Sleep -Seconds 3
& $AdbExe connect "${ip}:5555"
Write-Output "Debugging over Wi-Fi is on until the frame restarts. For the other scripts: `$env:OPENFRAME_WIFI = '${ip}:5555'"
