# Report memory: OpenFrame app process plus the WebView renderer (sandboxed) process.
. "$PSScriptRoot\env.ps1"

Write-Output '== OpenFrame app process =='
adb shell dumpsys meminfo $Package | Select-String -Pattern 'TOTAL|Java Heap|Native Heap|Graphics|Private Other|^\s*$' -Context 0,0

Write-Output ''
Write-Output '== PSS by process (OpenFrame + WebView renderer) =='
adb shell dumpsys meminfo | Select-String -Pattern 'app\.openframe|sandboxed_process|webview'

Write-Output ''
Write-Output '== Device =='
adb shell cat /proc/meminfo | Select-String -Pattern '^(MemTotal|MemAvailable):'
