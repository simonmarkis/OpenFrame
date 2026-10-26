# Stream OpenFrame, WebView, and crash logs.
#   .\scripts\logs.ps1          follow
#   .\scripts\logs.ps1 -Dump    print what's buffered and exit
param([switch]$Dump)
. "$PSScriptRoot\env.ps1"

$extra = if ($Dump) { @('-d') } else { @() }
adb logcat -v time @extra -s OpenFrame:V chromium:V cr_AwContents:V AndroidRuntime:E
