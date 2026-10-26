# Generates synthetic test media for the photo pipeline (SPEC §23): EXIF rotations, sizes,
# PNG, corrupt/truncated files, a fake HEIC header, and files that must be ignored.
# No real photos, no personal data.
#   .\scripts\test-media\make-synthetic.ps1 -Out <dir>
#   then: adb push <dir>\. /sdcard/FrameMedia/test-synthetic/
param([Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force $Out | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Out '.hidden') | Out-Null

function New-Prop([int]$id, [int16]$type, [byte[]]$value) {
    $p = [System.Runtime.Serialization.FormatterServices]::GetUninitializedObject([System.Drawing.Imaging.PropertyItem])
    $p.Id = $id; $p.Type = $type; $p.Len = $value.Length; $p.Value = $value
    return $p
}

function New-Card([int]$w, [int]$h, [string]$label, [System.Drawing.Color]$c1, [System.Drawing.Color]$c2) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAlias'
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45
    $g.FillRectangle($brush, $rect)
    $edge = [Math]::Max(4, [int]($w / 200))
    $g.DrawRectangle((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $edge), $edge, $edge, $w - 2 * $edge, $h - 2 * $edge)
    $size = [Math]::Max(10, [int]([Math]::Min($w, $h) / 12))
    $font = New-Object System.Drawing.Font 'Arial', $size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $white = [System.Drawing.Brushes]::White
    $g.DrawString("^ TOP ^", $font, $white, (New-Object System.Drawing.RectangleF 0, 0, $w, ($size * 2.5)), $fmt)
    $g.DrawString($label, $font, $white, (New-Object System.Drawing.RectangleF 0, 0, $w, $h), $fmt)
    $g.DrawString("${w}x${h}", $font, $white, (New-Object System.Drawing.RectangleF 0, ($h - $size * 2.5), $w, ($size * 2.5)), $fmt)
    # Off-center marker in the top-left quadrant, to check fill crops.
    $g.FillEllipse([System.Drawing.Brushes]::Yellow, [int]($w * 0.15), [int]($h * 0.2), [int]($size * 1.5), [int]($size * 1.5))
    $g.Dispose()
    return $bmp
}

function Save-Jpeg($bmp, [string]$name, [int]$orientation = 0, [string]$taken = $null) {
    if ($orientation -gt 0) { $bmp.SetPropertyItem((New-Prop 0x0112 3 ([BitConverter]::GetBytes([uint16]$orientation)))) }
    if ($taken) {
        $bytes = [Text.Encoding]::ASCII.GetBytes($taken + [char]0)
        $bmp.SetPropertyItem((New-Prop 0x9003 2 $bytes))
    }
    $bmp.Save((Join-Path $Out $name), [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
}

$C = [System.Drawing.Color]
Save-Jpeg (New-Card 4032 3024 'LANDSCAPE 4:3' $C::SteelBlue $C::SeaGreen) 'land-4x3.jpg' -taken '2019:07:04 12:00:00'
Save-Jpeg (New-Card 3024 4032 'PORTRAIT 3:4' $C::Purple $C::Crimson) 'portrait-3x4.jpg' -taken '2021:12:25 09:30:00'
Save-Jpeg (New-Card 4000 1000 'PANORAMA 4:1' $C::DarkOrange $C::Gold) 'pano-4x1.jpg' -taken '2015:01:01 08:00:00'
Save-Jpeg (New-Card 320 240 'TINY 320' $C::Teal $C::Navy) 'tiny-320.jpg'
Save-Jpeg (New-Card 8000 6000 'HUGE 48MP' $C::Maroon $C::Olive) 'huge-8000.jpg'

# EXIF rotations: pixels stored rotated; a correct viewer shows "^ TOP ^" at the top.
$b = New-Card 3000 2000 'EXIF 6 (rot 90 CW)' $C::DarkSlateGray $C::CadetBlue
$b.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone); Save-Jpeg $b 'exif-6.jpg' 6
$b = New-Card 3000 2000 'EXIF 3 (rot 180)' $C::DarkGreen $C::YellowGreen
$b.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone); Save-Jpeg $b 'exif-3.jpg' 3
$b = New-Card 3000 2000 'EXIF 8 (rot 270 CW)' $C::Indigo $C::MediumOrchid
$b.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone); Save-Jpeg $b 'exif-8.jpg' 8

$png = New-Card 1600 1200 'PNG' $C::SlateBlue $C::HotPink
$png.Save((Join-Path $Out 'image.png'), [System.Drawing.Imaging.ImageFormat]::Png); $png.Dispose()

# Broken files: must be flagged, never crash.
$rnd = New-Object byte[] 50000; (New-Object Random 42).NextBytes($rnd)
[IO.File]::WriteAllBytes((Join-Path $Out 'corrupt-random.jpg'), $rnd)
$full = [IO.File]::ReadAllBytes((Join-Path $Out 'land-4x3.jpg'))
[IO.File]::WriteAllBytes((Join-Path $Out 'truncated.jpg'), $full[0..2047])
$heic = [byte[]](0,0,0,0x18) + [Text.Encoding]::ASCII.GetBytes('ftypheic') + [byte[]](0,0,0,0) +
        [Text.Encoding]::ASCII.GetBytes('mif1heic') + (New-Object byte[] 1000)
[IO.File]::WriteAllBytes((Join-Path $Out 'fake-iphone.heic'), $heic)

# Must be ignored: non-media and hidden folders.
Set-Content (Join-Path $Out 'notes.txt') 'not media'
Copy-Item (Join-Path $Out 'tiny-320.jpg') (Join-Path $Out '.hidden\should-not-index.jpg')

Get-ChildItem -Recurse -File $Out | Select-Object @{n='File';e={$_.FullName.Substring($Out.Length + 1)}}, Length
