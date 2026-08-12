param(
    [string]$OutDir = "assets\icons"
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function New-Icon($size, $outFile) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # Fondo con gradiente vertical
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $c1 = [System.Drawing.Color]::FromArgb(255, 15, 23, 42)    # #0f172a
    $c2 = [System.Drawing.Color]::FromArgb(255, 30, 41, 59)    # #1e293b
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 90)
    $g.FillRectangle($brush, $rect)

    # Tarjeta blanca rotada
    $w = $size * 0.58; $h = $size * 0.78
    $cx = $size / 2; $cy = $size / 2
    $cardRect = New-Object System.Drawing.RectangleF(($cx - $w/2), ($cy - $h/2), $w, $h)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = $w * 0.12
    $path.AddArc($cardRect.X, $cardRect.Y, $r*2, $r*2, 180, 90)
    $path.AddArc($cardRect.Right - $r*2, $cardRect.Y, $r*2, $r*2, 270, 90)
    $path.AddArc($cardRect.Right - $r*2, $cardRect.Bottom - $r*2, $r*2, $r*2, 0, 90)
    $path.AddArc($cardRect.X, $cardRect.Bottom - $r*2, $r*2, $r*2, 90, 90)
    $path.CloseFigure()

    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform(-8)
    $g.TranslateTransform(-$cx, -$cy)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 248, 250, 252))
    $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
    $g.FillPath($shadow, $path)  # se dibuja bajo la tarjeta (offset aprox)
    $g.TranslateTransform(2, 3); $g.FillPath($shadow, $path); $g.TranslateTransform(-2, -3)
    $g.FillPath($white, $path)

    # Rayo verde (bolt) centrado sobre la tarjeta
    $green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 34, 197, 94)) # #22c55e
    $s = $size
    $pts = @(
        [System.Drawing.PointF]::new(0.50*$s, 0.30*$s),
        [System.Drawing.PointF]::new(0.36*$s, 0.52*$s),
        [System.Drawing.PointF]::new(0.46*$s, 0.52*$s),
        [System.Drawing.PointF]::new(0.42*$s, 0.72*$s),
        [System.Drawing.PointF]::new(0.62*$s, 0.46*$s),
        [System.Drawing.PointF]::new(0.52*$s, 0.46*$s)
    )
    $g.FillPolygon($green, $pts)

    $g.Dispose()
    $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "OK $outFile ($size px)"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Icon 512 (Join-Path $OutDir "icon-512.png")
New-Icon 192 (Join-Path $OutDir "icon-192.png")
New-Icon 64  (Join-Path $OutDir "favicon.png")
