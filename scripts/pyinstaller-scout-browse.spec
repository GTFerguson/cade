# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the scout-browse CLI.

Run from the scout-engine venv:
    .venv/bin/python -m PyInstaller scripts/pyinstaller-scout-browse.spec --noconfirm

Chromium is NOT bundled here — it is shipped separately as a Tauri resource
under ms-playwright/. At runtime the CADE backend sets PLAYWRIGHT_BROWSERS_PATH
to the resource directory so patchright can locate the browser.
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

import patchright as _pr_mod  # noqa: E402 — available because we run from scout venv

_pr_pkg = Path(_pr_mod.__file__).parent
_bin_dir = Path(sys.executable).parent
_entry = _bin_dir / "scout-browse"

datas = []
datas += collect_data_files("scout")

# patchright driver/package (JS protocol definitions) — NOT the node binary itself
_driver_pkg = _pr_pkg / "driver" / "package"
if _driver_pkg.is_dir():
    datas.append((str(_driver_pkg), "patchright/driver/package"))

# patchright's node binary must be an executable, so add it to binaries
binaries = []
_driver_node = _pr_pkg / "driver" / "node"
if _driver_node.exists():
    binaries.append((str(_driver_node), "patchright/driver"))

hiddenimports = []
hiddenimports += collect_submodules("scout")
hiddenimports += collect_submodules("patchright")
hiddenimports += ["patchright.sync_api", "patchright.async_api"]

a = Analysis(
    [str(_entry)],
    pathex=[str(_bin_dir.parent)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="scout-browse",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
