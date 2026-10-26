# One-time signing set-up (V1.0.0, 2026-10-19): remembers where the user's OpenFrame key is and its password,
# so build.ps1 / deploy.ps1 / build-release.ps1 can sign without asking. Run it yourself, in your own terminal:
#   .\scripts\signing-setup.ps1 -Keystore "C:\path\to\openframe-release.jks"
# The password is typed here (hidden), checked against the key, and saved with Windows DPAPI in
# %USERPROFILE%\.openframe\keystore-password.dat: only this Windows account on this PC can read it back.
# It never goes into the project, logs, or chat. Delete that folder to forget it.
param([Parameter(Mandatory = $true)][string]$Keystore)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Keystore)) { throw "No key file at $Keystore" }
$keytool = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
$dir = Join-Path $env:USERPROFILE '.openframe'
New-Item -ItemType Directory -Force $dir | Out-Null

$secure = Read-Host 'Password of the OpenFrame key' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try {
    # Check it opens the key (keytool reads the password from an environment variable, not the command line).
    $env:OPENFRAME_CHECK_PASS = $plain
    & $keytool -list -keystore $Keystore -alias openframe -storepass:env OPENFRAME_CHECK_PASS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'That password does not open the key (or the key has no "openframe" entry).' }
} finally {
    Remove-Item Env:OPENFRAME_CHECK_PASS -ErrorAction SilentlyContinue
    $plain = $null
}
$secure | ConvertFrom-SecureString | Set-Content -Encoding ascii (Join-Path $dir 'keystore-password.dat')
(Resolve-Path $Keystore).Path | Set-Content -Encoding utf8 (Join-Path $dir 'keystore-path.txt')
Write-Output "Saved. Builds now sign with $Keystore."
