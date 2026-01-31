# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

import os
import sys
from pathlib import Path

# Get project root and paths
project_root = Path(os.path.abspath(SPECPATH)).parent
backend_dir = project_root / 'backend'
frontend_dist = project_root / 'frontend' / 'dist'

# Collect all Python modules from backend
backend_modules = []
for root, dirs, files in os.walk(backend_dir):
    for file in files:
        if file.endswith('.py'):
            rel_path = os.path.relpath(os.path.join(root, file), project_root)
            module = rel_path.replace(os.sep, '.').replace('.py', '')
            backend_modules.append(module)

# Hidden imports for dependencies that PyInstaller might miss
hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'fastapi.staticfiles',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'watchfiles',
    'watchfiles.main',
    'pexpect',
    'ptyprocess',
]

# Add Windows-specific imports
if sys.platform == 'win32':
    hiddenimports.extend([
        'pywinpty',
        'winpty',
    ])

# Collect frontend dist files as data
datas = []
if frontend_dist.exists():
    datas.append((str(frontend_dist), 'frontend/dist'))

# Bundle winpty native binaries (DLLs and executables) that PyInstaller
# doesn't discover through hidden imports alone
binaries = []
if sys.platform == 'win32':
    winpty_dir = Path(sys.prefix) / 'Lib' / 'site-packages' / 'winpty'
    if winpty_dir.exists():
        for name in ['winpty.dll', 'winpty-agent.exe', 'conpty.dll', 'OpenConsole.exe']:
            fp = winpty_dir / name
            if fp.exists():
                binaries.append((str(fp), 'winpty'))

a = Analysis(
    [str(backend_dir / 'main.py')],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='cade-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
