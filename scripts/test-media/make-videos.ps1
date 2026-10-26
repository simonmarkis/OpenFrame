# Generates synthetic test videos for Phase 12 (SPEC §6, §23) with ffmpeg: H.264 and HEVC, portrait
# (rotated and native), 60 fps, 4K, 10-bit HDR, short, long, silent, high bitrate, and one with a date
# and location. Each clip shows its own name, a frame counter, and plays a beep every second.
# A keyframe every second, like phone videos (the frame's player seeks to keyframes only).
# No real media, no personal data.
#   .\scripts\test-media\make-videos.ps1 [-Out test-video] [-Ffmpeg <path>]
#   then: adb push test-video\. /sdcard/FrameMedia/test-video/
param(
    [string]$Out = 'test-video',
    [string]$Ffmpeg = $(if ($env:FFMPEG) { $env:FFMPEG } else { Join-Path $env:USERPROFILE 'Downloads\ffmpeg\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe' })
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Ffmpeg)) { throw "ffmpeg not found at $Ffmpeg (set -Ffmpeg or `$env:FFMPEG)" }
New-Item -ItemType Directory -Force $Out | Out-Null
$font = "fontfile='C\:/Windows/Fonts/arialbd.ttf'"

function Invoke-Ffmpeg([string[]]$Arguments) {
    & $Ffmpeg -hide_banner -loglevel error -y @Arguments
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed: $($Arguments -join ' ')" }
}

# One clip: test pattern WxH at Fps for Sec seconds, labeled; Video = encoder arguments.
function New-Clip([string]$Name, [int]$W, [int]$H, [int]$Fps, [int]$Sec, [string[]]$Video,
                  [string]$Filter = '', [switch]$Silent, [string[]]$Extra = @(), [string]$Label = $Name) {
    $size = [Math]::Max(24, [int]([Math]::Min($W, $H) / 14))
    $nameText = "drawtext=${font}:text='$Label':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-tw)/2:y=h*0.12"
    $info = "drawtext=${font}:text='${W}x${H} ${Fps} fps  frame %{n}  %{pts\:hms}':fontsize=$([int]($size * 0.7)):fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-tw)/2:y=h*0.80"
    $top = "drawtext=${font}:text='^ TOP ^':fontsize=${size}:fontcolor=white:x=(w-tw)/2:y=10"
    $vf = (@($Filter, $nameText, $info, $top) | Where-Object { $_ }) -join ','
    $a = @('-f', 'lavfi', '-i', "testsrc2=s=${W}x${H}:r=${Fps}:d=${Sec}")
    if (-not $Silent) { $a += @('-f', 'lavfi', '-i', "sine=frequency=660:beep_factor=3:sample_rate=48000:duration=${Sec}") }
    $a += @('-vf', $vf) + $Video + @('-g', "$Fps")
    if (-not $Silent) { $a += @('-c:a', 'aac', '-b:a', '128k', '-shortest') }
    $a += $Extra + @((Join-Path $Out $Name))
    Invoke-Ffmpeg $a
    Write-Host "  $Name"
}

$x264 = @('-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'veryfast')
$x265 = @('-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-x265-params', 'log-level=error')
$fast = @('-movflags', '+faststart')

Write-Host "Making test videos in $Out"
New-Clip 'h264-1080p30.mp4' 1920 1080 30 10 ($x264 + '-b:v', '8M') -Extra $fast
New-Clip 'hevc-1080p30.mov' 1920 1080 30 10 ($x265 + '-b:v', '8M')
# Noise defeats compression, so the bitrate really is ~12 Mbps (the Shortcut's video was 11.7).
New-Clip 'hevc-1080p30-12mbps.mov' 1920 1080 30 10 `
    ('-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-b:v', '12M',
     '-x265-params', 'log-level=error:vbv-maxrate=13000:vbv-bufsize=13000') -Filter 'noise=alls=25:allf=t+u'
New-Clip 'h264-portrait-1080x1920.mp4' 1080 1920 30 8 ($x264 + '-b:v', '8M') -Extra $fast
New-Clip 'h264-1080p60.mp4' 1920 1080 60 8 ($x264 + '-b:v', '10M') -Extra $fast
New-Clip 'hevc-1080p60.mov' 1920 1080 60 8 ($x265 + '-b:v', '10M')
New-Clip 'hevc-4k30.mov' 3840 2160 30 4 ($x265 + '-b:v', '20M')
New-Clip 'hevc-10bit-hlg.mov' 1920 1080 30 5 `
    ('-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le', '-preset', 'fast', '-b:v', '8M',
     '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
     '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc')
New-Clip 'h264-720p-3s.mp4' 1280 720 30 3 ($x264 + '-b:v', '3M') -Extra $fast
New-Clip 'h264-720p-90s.mp4' 1280 720 30 90 ($x264 + '-b:v', '1500k') -Extra $fast
New-Clip 'h264-1080p-silent.mp4' 1920 1080 30 6 ($x264 + '-b:v', '6M') -Silent -Extra $fast
New-Clip 'h264-dated-gps.mov' 1280 720 30 6 ($x264 + '-b:v', '3M') `
    -Extra @('-metadata', 'creation_time=2025-07-04T18:30:00Z', '-metadata', 'location=+47.6062-122.3321/',
             '-metadata', 'location-eng=+47.6062-122.3321/')

# Portrait like an iPhone: a portrait scene stored landscape (1920x1080) plus a 90° rotation flag.
$tmp = Join-Path $Out 'portrait-tmp.mov'
New-Clip 'portrait-tmp.mov' 1080 1920 30 8 ($x265 + '-b:v', '8M') -Label 'hevc-portrait-rotated.mov'
Invoke-Ffmpeg @('-i', $tmp, '-vf', 'transpose=2', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-preset', 'fast',
    '-b:v', '8M', '-g', '30', '-x265-params', 'log-level=error', '-c:a', 'copy', (Join-Path $Out 'portrait-coded.mov'))
Invoke-Ffmpeg @('-display_rotation:v:0', '-90', '-i', (Join-Path $Out 'portrait-coded.mov'), '-c', 'copy', (Join-Path $Out 'hevc-portrait-rotated.mov'))
Remove-Item $tmp, (Join-Path $Out 'portrait-coded.mov')
Write-Host "  hevc-portrait-rotated.mov"
Write-Host 'Done.'
