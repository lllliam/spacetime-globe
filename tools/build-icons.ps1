# 从已经选定的图标母版生成网站/PWA尺寸。仅用于维护图标，应用运行不需要此脚本。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$iconMaster = Join-Path $projectRoot 'assets/icon-master.png'
$sourceImage = [System.Drawing.Image]::FromFile($iconMaster)
try {
  foreach ($spec in @(@('icon.png', 180), @('icon-192.png', 192), @('icon-512.png', 512), @('favicon.png', 64))) {
    $size = [int]$spec[1]
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
    try {
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $sourceImage.Width, $sourceImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
      $bitmap.Save((Join-Path $projectRoot $spec[0]), [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output ($spec[0] + ' ' + $size + 'x' + $size)
    } finally { $attributes.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $sourceImage.Dispose() }
