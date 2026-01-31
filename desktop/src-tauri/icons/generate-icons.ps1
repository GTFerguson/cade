# Generate proper icons using .NET Graphics
Add-Type -AssemblyName System.Drawing

# Create a 512x512 icon
$size = 512
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# Fill with blue background
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 120, 212))
$graphics.FillRectangle($brush, 0, 0, $size, $size)

# Add white text "C"
$font = New-Object System.Drawing.Font("Arial", 300, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$graphics.DrawString("C", $font, $textBrush, 100, 50)

# Save as PNG
$iconPath = "$PSScriptRoot\app-icon.png"
$bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)

Write-Host "Created app-icon.png"

# Cleanup
$graphics.Dispose()
$bitmap.Dispose()
$brush.Dispose()
$textBrush.Dispose()
$font.Dispose()

# Now use Tauri CLI to generate all icon formats
Write-Host "Generating icons using Tauri CLI..."
cd $PSScriptRoot\..
npx @tauri-apps/cli icon icons\app-icon.png

Write-Host "Icons generated successfully!"
