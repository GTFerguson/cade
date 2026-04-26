# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the nkrdn CLI.

Run from the nkrdn venv:
    <nkrdn-venv>/bin/python -m PyInstaller scripts/pyinstaller-nkrdn.spec --noconfirm

The build-backend-sidecar.py script does this automatically.
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

import nkrdn as _nkrdn_mod  # noqa: E402 — available because we run from nkrdn venv

_nkrdn_pkg = Path(_nkrdn_mod.__file__).parent
_bin_dir = Path(sys.executable).parent
_entry = _bin_dir / "nkrdn"

datas = []
datas += collect_data_files("nkrdn")
datas += collect_data_files("rdflib")

# tiktoken is pulled in transitively by some langchain components
try:
    datas += collect_data_files("tiktoken")
    datas += collect_data_files("tiktoken_ext")
except Exception:
    pass

hiddenimports = []
hiddenimports += collect_submodules("nkrdn")
hiddenimports += collect_submodules("langchain")
hiddenimports += collect_submodules("langchain_core")
hiddenimports += collect_submodules("rdflib")
hiddenimports += [
    "tree_sitter_cpp",
    "tree_sitter_javascript",
    "tree_sitter_typescript",
    "tree_sitter_rust",
]

try:
    hiddenimports += collect_submodules("tiktoken_ext")
except Exception:
    pass

a = Analysis(
    [str(_entry)],
    pathex=[str(_bin_dir.parent)],
    binaries=[],
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
    name="nkrdn",
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
