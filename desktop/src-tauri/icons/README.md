# Application Icons

This directory should contain the application icons in various formats and sizes for different platforms.

## Required Files

- `32x32.png` - Small icon (32x32 pixels)
- `128x128.png` - Medium icon (128x128 pixels)
- `128x128@2x.png` - High-res medium icon (256x256 pixels)
- `icon.icns` - macOS icon bundle
- `icon.ico` - Windows icon file

## Generating Icons

You can generate these icons from a source image (SVG or high-res PNG) using:

### Option 1: Tauri Icon Tool

```bash
npm install -g @tauri-apps/cli
tauri icon /path/to/source-icon.png
```

This will automatically generate all required icon formats.

### Option 2: Manual Generation

Use tools like:
- [ImageMagick](https://imagemagick.org/) for PNG resizing
- [png2icons](https://github.com/idesis-gmbh/png2icons) for ICO/ICNS creation
- Online converters

## Temporary Placeholder

Until proper icons are designed, Tauri will use default icons. For production builds, replace these placeholders with actual CADE branding.

## Design Guidelines

- Use simple, recognizable design
- Ensure good visibility at small sizes (32x32)
- Use consistent colors matching CADE brand
- Avoid text (hard to read at small sizes)
- Consider dark/light mode visibility
