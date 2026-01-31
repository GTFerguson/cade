# Create placeholder icon files for Tauri
# This creates minimal valid icon files to allow building

$iconsDir = $PSScriptRoot

# Create a simple 1x1 PNG (smallest valid PNG)
$pngData = [System.Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

# Write PNG files
[System.IO.File]::WriteAllBytes("$iconsDir\32x32.png", $pngData)
[System.IO.File]::WriteAllBytes("$iconsDir\128x128.png", $pngData)
[System.IO.File]::WriteAllBytes("$iconsDir\128x128@2x.png", $pngData)

Write-Host "Created PNG placeholders"

# For .ico and .icns, we need actual icon tools or we can just skip them in config
Write-Host ""
Write-Host "Note: .ico and .icns files need proper icon tools to create."
Write-Host "For now, we'll update the Tauri config to only require PNGs."
