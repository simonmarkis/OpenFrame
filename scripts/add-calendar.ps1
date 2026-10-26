# Add Google calendars to the frame without the secret link touching anything but the frame.
# Run it yourself in a terminal (it prompts with Read-Host):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\add-calendar.ps1
#   ... -Server http://<frame IP>:8080    (over Wi-Fi instead of adb forward)
#
# The link is read as a SecureString (not shown, not kept in PowerShell history), sent once in the
# POST body to /api/calendars, then cleared. It is never printed, logged, or written to disk here;
# the frame stores it in its private secrets.json and the API only ever returns the host.
param([string]$Server)
. "$PSScriptRoot\env.ps1"

if (-not $Server) {
    adb forward tcp:8080 tcp:8080 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb forward failed ($LASTEXITCODE). Is the frame connected?" }
    $Server = 'http://127.0.0.1:8080'
}
$Server = $Server.TrimEnd('/')

try { Invoke-RestMethod "$Server/api/status" -TimeoutSec 10 | Out-Null }
catch { throw "OpenFrame is not reachable at $Server. Start the app on the frame and try again." }

$Palette = [ordered]@{
    '1' = @('Blue',   '#4285f4'); '2' = @('Red',    '#d50000'); '3' = @('Green',  '#0b8043')
    '4' = @('Yellow', '#f6bf26'); '5' = @('Purple', '#8e24aa'); '6' = @('Orange', '#f4511e')
    '7' = @('Teal',   '#039be5'); '8' = @('Pink',   '#e67c73'); '9' = @('Gray',   '#616161')
}

function Read-Color {
    Write-Host 'Colors:' -NoNewline
    foreach ($k in $Palette.Keys) { Write-Host " $k=$($Palette[$k][0])" -NoNewline }
    Write-Host ''
    while ($true) {
        $c = (Read-Host 'Color (number, or #RRGGBB)').Trim()
        if ($Palette.Contains($c)) { return $Palette[$c][1] }
        if ($c -match '^#[0-9a-fA-F]{6}$') { return $c.ToLower() }
        Write-Host '  Enter 1-9 or a hex color like #33b679.'
    }
}

function Read-SecretLink {
    while ($true) {
        $secure = Read-Host 'Secret address in iCal format (input hidden)' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if ($plain -notmatch '^(https|webcal)://') {
            Write-Host '  That does not look like a link (must start with https:// or webcal://). Try again.'
            continue
        }
        # Hints only; the link itself is never echoed.
        if ($plain -match 'calendar\.google\.com' -and $plain -notmatch '/private-') {
            Write-Host '  Note: this looks like the PUBLIC address. It only works if the calendar is public;'
            Write-Host '  use "Secret address in iCal format" for a private calendar.'
            if ((Read-Host '  Use it anyway? (y/N)') -notmatch '^[yY]') { continue }
        }
        return $plain
    }
}

do {
    Write-Host ''
    $name = ''
    while ($name.Length -lt 1 -or $name.Length -gt 60) { $name = (Read-Host 'Calendar name (shown on the frame)').Trim() }
    $color = Read-Color
    $busy = (Read-Host 'Show as "Busy" (hide event titles)? (y/N)') -match '^[yY]'
    $link = Read-SecretLink

    $body = [ordered]@{ name = $name; color = $color; busy = $busy; url = $link } | ConvertTo-Json -Compress
    $link = $null
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $body = $null

    try {
        $cal = Invoke-RestMethod "$Server/api/calendars" -Method Post -Body $bytes `
            -ContentType 'application/json; charset=utf-8' -TimeoutSec 20
    } catch {
        # Report only the status and the server's message (which never contains the link).
        $status = $_.Exception.Response.StatusCode.value__
        $msg = $null
        try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
        if (-not $msg) { $msg = 'request failed' }
        Write-Host "  Not added (HTTP $status): $msg"
        $cal = $null
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }

    if ($cal) {
        Write-Host "  Added '$($cal.name)' ($($cal.id), host $($cal.host)). Waiting for the first sync..."
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Seconds 3
            $cal = Invoke-RestMethod "$Server/api/calendars/$($cal.id)" -TimeoutSec 10
        } while ($cal.status -eq 'never_synced' -and (Get-Date) -lt $deadline)
        switch ($cal.status) {
            'ok'           { Write-Host "  Synced: $($cal.events) events." }
            'never_synced' { Write-Host '  Not synced yet; it will retry on the normal schedule.' }
            default        { Write-Host "  Sync error ($($cal.errorKind), HTTP $($cal.httpStatus)): $($cal.error)" }
        }
    }
} while ((Read-Host "`nAdd another calendar? (y/N)") -match '^[yY]')

Write-Host 'Done. Check all calendars with: Invoke-RestMethod http://127.0.0.1:8080/api/calendars'
