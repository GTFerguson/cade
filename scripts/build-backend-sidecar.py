"""Build the Python backend and copy it to Tauri's resources directory.

Called by Tauri's beforeBuildCommand to ensure cade-backend.exe is always
fresh when building the desktop app. Can also be run standalone.
"""

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SPEC_FILE = PROJECT_ROOT / "scripts" / "pyinstaller.spec"
DIST_DIR = PROJECT_ROOT / "dist"
RESOURCES_DIR = PROJECT_ROOT / "desktop" / "src-tauri" / "resources"

TARGET_TRIPLES = {
    ("Windows", "AMD64"): "x86_64-pc-windows-msvc",
    ("Windows", "x86"): "i686-pc-windows-msvc",
    ("Linux", "x86_64"): "x86_64-unknown-linux-gnu",
    ("Darwin", "x86_64"): "x86_64-apple-darwin",
    ("Darwin", "arm64"): "aarch64-apple-darwin",
}


def main() -> None:
    system = platform.system()
    machine = platform.machine()
    triple = TARGET_TRIPLES.get((system, machine))
    exe_ext = ".exe" if system == "Windows" else ""
    exe_name = f"cade-backend{exe_ext}"

    print(f"[build-backend] Platform: {system} {machine}")
    print(f"[build-backend] Target triple: {triple or 'unknown'}")

    # Run PyInstaller
    print(f"[build-backend] Running PyInstaller...")
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", str(SPEC_FILE), "--noconfirm"],
        cwd=str(PROJECT_ROOT),
    )
    if result.returncode != 0:
        print("[build-backend] ERROR: PyInstaller failed", file=sys.stderr)
        sys.exit(1)

    built_exe = DIST_DIR / exe_name
    if not built_exe.exists():
        print(f"[build-backend] ERROR: {built_exe} not found", file=sys.stderr)
        sys.exit(1)

    size_mb = built_exe.stat().st_size / (1024 * 1024)
    print(f"[build-backend] Built: {built_exe} ({size_mb:.1f} MB)")

    # Copy to Tauri resources
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    # Plain name (used by dev-mode path lookup in python.rs)
    dest_plain = RESOURCES_DIR / exe_name
    shutil.copy2(str(built_exe), str(dest_plain))
    print(f"[build-backend] Copied to {dest_plain}")

    # Target-triple name (used by Tauri bundler for externalBin)
    if triple:
        triple_name = f"cade-backend-{triple}{exe_ext}"
        dest_triple = RESOURCES_DIR / triple_name
        shutil.copy2(str(built_exe), str(dest_triple))
        print(f"[build-backend] Copied to {dest_triple}")

    print("[build-backend] Done")


if __name__ == "__main__":
    main()
