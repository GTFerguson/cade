"""Build the Python backend, nkrdn, and scout-browse, then copy everything to Tauri resources.

Called by Tauri's beforeBuildCommand. Can also be run standalone.

Each tool is built from its own virtualenv so that only that tool's dependencies
are included in the binary. The venvs are discovered by reading the shebang line
of each CLI script (nkrdn, scout-browse) found on PATH.

On Linux, Neovim is downloaded as a portable tarball and Chromium's shared
library dependencies are collected via ldd so the bundle is self-contained on
machines that don't have GTK/NSS/etc. installed.
"""

import re
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
RESOURCES_DIR = PROJECT_ROOT / "desktop" / "src-tauri" / "resources"

TARGET_TRIPLES = {
    ("Windows", "AMD64"): "x86_64-pc-windows-msvc",
    ("Windows", "x86"): "i686-pc-windows-msvc",
    ("Linux", "x86_64"): "x86_64-unknown-linux-gnu",
    ("Darwin", "x86_64"): "x86_64-apple-darwin",
    ("Darwin", "arm64"): "aarch64-apple-darwin",
}

NVIM_VERSION = "v0.11.0"
NVIM_URLS = {
    ("Linux", "x86_64"): f"https://github.com/neovim/neovim/releases/download/{NVIM_VERSION}/nvim-linux-x86_64.tar.gz",
    ("Darwin", "x86_64"): f"https://github.com/neovim/neovim/releases/download/{NVIM_VERSION}/nvim-macos-x86_64.tar.gz",
    ("Darwin", "arm64"):  f"https://github.com/neovim/neovim/releases/download/{NVIM_VERSION}/nvim-macos-arm64.tar.gz",
}

_MS_PLAYWRIGHT_CACHE = Path.home() / ".cache" / "ms-playwright"
_MS_PLAYWRIGHT_CACHE_WIN = Path.home() / "AppData" / "Local" / "ms-playwright"

NODE_VERSION = "22.16.0"
NODE_URLS = {
    ("Linux", "x86_64"):  f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.gz",
    ("Darwin", "x86_64"): f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-x64.tar.gz",
    ("Darwin", "arm64"):  f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-darwin-arm64.tar.gz",
    ("Windows", "AMD64"):  f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip",
}

# Shared libraries that must NOT be bundled — they are glibc components or
# kernel interfaces that must match the host system's ABI exactly.
_GLIBC_PREFIXES = (
    "libc.so",
    "libm.so",
    "libdl.so",
    "libpthread.so",
    "librt.so",
    "libresolv.so",
    "libutil.so",
    "libgcc_s.so",      # GCC runtime — ABI-sensitive, leave to host
    "linux-vdso.so",    # kernel virtual DSO
    "ld-linux",         # dynamic loader — must match glibc
    "ld-musl",          # musl loader
)


# ── Neovim ───────────────────────────────────────────────────────────────────

def _download_neovim(system: str, machine: str) -> None:
    """Download and extract the Neovim portable release to dist/nvim/.

    The pyinstaller.spec already includes dist/nvim/ when it exists, so this
    just needs to run before PyInstaller does.
    """
    url = NVIM_URLS.get((system, machine))
    if not url:
        print(f"[build-sidecar] Neovim: no portable release for {system}/{machine}, skipping")
        return

    nvim_dir = DIST_DIR / "nvim"
    if nvim_dir.is_dir():
        print(f"[build-sidecar] Neovim already at {nvim_dir}, skipping download")
        return

    tarball = DIST_DIR / f"nvim-{system}-{machine}.tar.gz"
    if not tarball.exists():
        print(f"[build-sidecar] Downloading Neovim {NVIM_VERSION}...")
        urllib.request.urlretrieve(url, tarball)

    print(f"[build-sidecar] Extracting Neovim...")
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball, "r:gz") as tf:
        tf.extractall(DIST_DIR)

    # The tarball root is e.g. nvim-linux-x86_64/ or nvim-macos-arm64/
    for candidate in DIST_DIR.iterdir():
        if candidate.is_dir() and candidate.name.startswith("nvim-"):
            candidate.rename(nvim_dir)
            break

    if nvim_dir.is_dir():
        print(f"[build-sidecar] Neovim {NVIM_VERSION} ready at {nvim_dir}")
    else:
        print("[build-sidecar] WARNING: Neovim extraction failed — dist/nvim not found")


# ── Chromium system libraries ─────────────────────────────────────────────────

def _should_exclude_lib(name: str) -> bool:
    return any(name.startswith(p) for p in _GLIBC_PREFIXES)


def _collect_deps_ldd(binary: Path, dest_dir: Path, seen: set[str]) -> None:
    """Recursively copy shared library deps of *binary* to *dest_dir* via ldd."""
    try:
        result = subprocess.run(
            ["ldd", str(binary)],
            capture_output=True, text=True, timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return

    for line in result.stdout.splitlines():
        # "    libfoo.so.1 => /usr/lib/x86_64-linux-gnu/libfoo.so.1 (0x7f...)"
        m = re.search(r"=>\s+(/\S+)", line)
        if not m:
            continue
        lib_path = Path(m.group(1))
        lib_name = lib_path.name

        if lib_name in seen or _should_exclude_lib(lib_name):
            continue
        seen.add(lib_name)

        if not lib_path.exists():
            continue

        dest = dest_dir / lib_name
        if not dest.exists():
            shutil.copy2(str(lib_path), str(dest))

        # Recurse so transitive deps (e.g. libatk → libglib) are also collected
        _collect_deps_ldd(lib_path, dest_dir, seen)


def _bundle_chromium_libs(system: str) -> None:
    """Collect Chromium's .so dependencies into ms-playwright/chromium-libs/.

    On a fresh Linux install, GTK, NSS, DRM, and friends are often missing.
    Copying them alongside Chrome and pointing LD_LIBRARY_PATH there makes the
    bundle self-contained without requiring patchelf or root access.

    macOS and Windows Chromium builds are already self-contained — skipped.
    """
    if system != "Linux":
        return

    ms_playwright = RESOURCES_DIR / "ms-playwright"
    if not ms_playwright.is_dir():
        print("[build-sidecar] Chromium libs: ms-playwright not yet in resources, skipping")
        return

    libs_dir = ms_playwright / "chromium-libs"
    libs_dir.mkdir(exist_ok=True)

    seen: set[str] = set()
    collected = 0

    for ver_dir in sorted(ms_playwright.iterdir()):
        if not (ver_dir.is_dir() and ver_dir.name.startswith("chromium-") and "headless" not in ver_dir.name):
            continue

        chrome = ver_dir / "chrome-linux64" / "chrome"
        if not chrome.exists():
            continue

        print(f"[build-sidecar] Collecting deps for {chrome}...")
        before = len(list(libs_dir.iterdir()))
        _collect_deps_ldd(chrome, libs_dir, seen)
        after = len(list(libs_dir.iterdir()))
        collected += after - before

    if collected:
        total_mb = sum(f.stat().st_size for f in libs_dir.iterdir()) / (1024 * 1024)
        print(f"[build-sidecar] Bundled {collected} Chromium libs ({total_mb:.1f} MB) → {libs_dir}")
    else:
        print("[build-sidecar] Chromium libs: nothing new to collect")


# ── Claude CLI ───────────────────────────────────────────────────────────────

def _bundle_claude(system: str, machine: str) -> None:
    """Bundle Node.js + @anthropic-ai/claude-code for machines that don't have it.

    Structure written to resources/claude-bundle/:
      node[.exe]               — portable Node.js binary
      node_modules/.bin/claude — claude wrapper script
      node_modules/@anthropic-ai/claude-code/  — package source

    At runtime the backend prepends these two dirs to PATH only when the system
    claude is absent, so an existing installation always takes precedence.
    """
    import zipfile

    exe_ext = ".exe" if system == "Windows" else ""
    bundle_dist = DIST_DIR / "claude-bundle"
    node_exe = bundle_dist / f"node{exe_ext}"
    claude_script = bundle_dist / "node_modules" / ".bin" / ("claude.cmd" if system == "Windows" else "claude")

    if node_exe.exists() and claude_script.exists():
        print("[build-sidecar] claude bundle already built, copying to resources")
        _copy_claude_bundle_to_resources()
        return

    bundle_dist.mkdir(parents=True, exist_ok=True)

    # ── 1. Get a portable Node.js binary ────────────────────────────────────
    # Prefer the system node (already the right platform); fall back to download.
    system_node = shutil.which("node")
    if system_node:
        print(f"[build-sidecar] Copying system node from {system_node}")
        shutil.copy2(system_node, str(node_exe))
    else:
        url = NODE_URLS.get((system, machine))
        if not url:
            print(f"[build-sidecar] WARNING: No Node.js URL for {system}/{machine} — cannot bundle claude")
            return

        tarball = DIST_DIR / f"node-{system}-{machine}.{'zip' if system == 'Windows' else 'tar.gz'}"
        if not tarball.exists():
            print(f"[build-sidecar] Downloading Node.js {NODE_VERSION}...")
            urllib.request.urlretrieve(url, tarball)

        print("[build-sidecar] Extracting Node.js binary...")
        if system == "Windows":
            with zipfile.ZipFile(tarball) as zf:
                # Find node.exe inside the zip
                for member in zf.namelist():
                    if member.endswith("/node.exe") or member == "node.exe":
                        with zf.open(member) as src, open(node_exe, "wb") as dst:
                            dst.write(src.read())
                        break
        else:
            with tarfile.open(tarball, "r:gz") as tf:
                for member in tf.getmembers():
                    if member.name.endswith("/bin/node"):
                        f = tf.extractfile(member)
                        if f:
                            node_exe.write_bytes(f.read())
                            node_exe.chmod(0o755)
                        break

    if not node_exe.exists():
        print("[build-sidecar] WARNING: Failed to obtain node binary — skipping claude bundle")
        return

    # ── 2. npm install @anthropic-ai/claude-code ─────────────────────────────
    npm_cmd = shutil.which("npm")
    if not npm_cmd:
        print("[build-sidecar] WARNING: npm not found — cannot install claude package")
        return

    print("[build-sidecar] Installing @anthropic-ai/claude-code...")
    result = subprocess.run(
        [npm_cmd, "install", "@anthropic-ai/claude-code", "--prefix", str(bundle_dist), "--no-save"],
        cwd=str(PROJECT_ROOT),
    )
    if result.returncode != 0:
        print("[build-sidecar] ERROR: npm install failed for claude", file=sys.stderr)
        return

    if not claude_script.exists():
        print(f"[build-sidecar] WARNING: claude script not found at {claude_script} after install")
        return

    size_mb = sum(f.stat().st_size for f in bundle_dist.rglob("*") if f.is_file()) / (1024 * 1024)
    print(f"[build-sidecar] claude bundle ready ({size_mb:.0f} MB)")

    _copy_claude_bundle_to_resources()


def _copy_claude_bundle_to_resources() -> None:
    src = DIST_DIR / "claude-bundle"
    dest = RESOURCES_DIR / "claude-bundle"
    if dest.exists():
        shutil.rmtree(str(dest))
    shutil.copytree(str(src), str(dest))
    print(f"[build-sidecar] claude bundle copied to {dest}")


# ── Generic helpers ───────────────────────────────────────────────────────────

def _find_venv_python(cli_name: str) -> Path | None:
    """Locate the Python interpreter for a CLI tool by reading its shebang line."""
    bin_path = shutil.which(cli_name)
    if not bin_path:
        print(f"[build-sidecar] WARNING: {cli_name!r} not found on PATH — skipping")
        return None

    bin_path = Path(bin_path).resolve()
    try:
        text = bin_path.read_text(errors="replace")
        first_line = text.splitlines()[0] if text else ""
    except OSError:
        first_line = ""

    if first_line.startswith("#!"):
        python_path = Path(first_line[2:].strip())
        if python_path.exists():
            return python_path

    for name in ("python3", "python"):
        candidate = bin_path.parent / name
        if candidate.exists():
            return candidate

    return None


def _build_tool(
    tool_name: str,
    spec_file: Path,
    venv_python: Path,
    system: str,
    triple: str | None,
) -> Path | None:
    """Run PyInstaller for a tool using its dedicated venv Python."""
    exe_ext = ".exe" if system == "Windows" else ""

    print(f"[build-sidecar] Building {tool_name} with {venv_python}...")
    subprocess.run(
        [str(venv_python), "-m", "pip", "install", "pyinstaller", "--quiet"],
        cwd=str(PROJECT_ROOT),
        check=False,
    )

    result = subprocess.run(
        [str(venv_python), "-m", "PyInstaller", str(spec_file), "--noconfirm"],
        cwd=str(PROJECT_ROOT),
    )
    if result.returncode != 0:
        print(f"[build-sidecar] ERROR: PyInstaller failed for {tool_name}", file=sys.stderr)
        return None

    built_exe = DIST_DIR / f"{tool_name}{exe_ext}"
    if not built_exe.exists():
        print(f"[build-sidecar] ERROR: {built_exe} not found after build", file=sys.stderr)
        return None

    size_mb = built_exe.stat().st_size / (1024 * 1024)
    print(f"[build-sidecar] Built {tool_name}: {built_exe} ({size_mb:.1f} MB)")
    return built_exe


def _copy_to_resources(built_exe: Path, tool_name: str, system: str, triple: str | None) -> None:
    """Copy a built executable to Tauri resources with both plain and triple-suffix names."""
    exe_ext = ".exe" if system == "Windows" else ""
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    dest_plain = RESOURCES_DIR / f"{tool_name}{exe_ext}"
    shutil.copy2(str(built_exe), str(dest_plain))
    print(f"[build-sidecar] Copied to {dest_plain}")

    if triple:
        dest_triple = RESOURCES_DIR / f"{tool_name}-{triple}{exe_ext}"
        shutil.copy2(str(built_exe), str(dest_triple))
        print(f"[build-sidecar] Copied to {dest_triple}")


def _copy_chromium(system: str) -> None:
    """Copy the patchright-managed Chromium to Tauri resources/ms-playwright/."""
    cache = _MS_PLAYWRIGHT_CACHE_WIN if system == "Windows" else _MS_PLAYWRIGHT_CACHE
    if not cache.is_dir():
        print(f"[build-sidecar] WARNING: ms-playwright cache not found at {cache}")
        print("[build-sidecar]   Run: python -m patchright install chromium")
        return

    dest = RESOURCES_DIR / "ms-playwright"
    copied = 0
    for entry in sorted(cache.iterdir()):
        if not (entry.is_dir() and entry.name.startswith("chromium-") and "headless" not in entry.name):
            continue
        dest_ver = dest / entry.name
        if dest_ver.exists():
            print(f"[build-sidecar] Chromium already in resources: {dest_ver.name}")
        else:
            print(f"[build-sidecar] Copying {entry.name}...")
            shutil.copytree(str(entry), str(dest_ver))
            size_mb = sum(f.stat().st_size for f in dest_ver.rglob("*") if f.is_file()) / (1024 * 1024)
            print(f"[build-sidecar] Chromium copied ({size_mb:.0f} MB)")
        copied += 1

    if copied == 0:
        print("[build-sidecar] WARNING: No chromium directory found in ms-playwright cache")


def _copy_nkrdn_usage_rule() -> None:
    """Copy nkrdn's usage-rule.md to resources so the bundled backend can install it."""
    venv_python = _find_venv_python("nkrdn")
    if not venv_python:
        return
    result = subprocess.run(
        [str(venv_python), "-c", "import nkrdn, os; print(os.path.dirname(nkrdn.__file__))"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        return
    rule_src = Path(result.stdout.strip()) / "usage-rule.md"
    if not rule_src.exists():
        return
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(rule_src), str(RESOURCES_DIR / "nkrdn-usage-rule.md"))
    print(f"[build-sidecar] Copied nkrdn usage-rule.md")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    system = platform.system()
    machine = platform.machine()
    triple = TARGET_TRIPLES.get((system, machine))
    exe_ext = ".exe" if system == "Windows" else ""

    print(f"[build-sidecar] Platform: {system} {machine}")
    print(f"[build-sidecar] Target triple: {triple or 'unknown'}")

    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # ── 0a. Neovim (must be in dist/ before PyInstaller runs) ────────────────
    print("\n[build-sidecar] === Downloading Neovim ===")
    _download_neovim(system, machine)

    # ── 0b. Claude CLI bundle ─────────────────────────────────────────────────
    print("\n[build-sidecar] === Bundling Claude CLI ===")
    _bundle_claude(system, machine)

    # ── 1. cade-backend ───────────────────────────────────────────────────────
    print("\n[build-sidecar] === Building cade-backend ===")
    spec_file = PROJECT_ROOT / "scripts" / "pyinstaller.spec"
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", str(spec_file), "--noconfirm"],
        cwd=str(PROJECT_ROOT),
    )
    if result.returncode != 0:
        print("[build-sidecar] ERROR: cade-backend PyInstaller failed", file=sys.stderr)
        sys.exit(1)

    built_backend = DIST_DIR / f"cade-backend{exe_ext}"
    if not built_backend.exists():
        print(f"[build-sidecar] ERROR: {built_backend} not found", file=sys.stderr)
        sys.exit(1)

    size_mb = built_backend.stat().st_size / (1024 * 1024)
    print(f"[build-sidecar] Built cade-backend ({size_mb:.1f} MB)")
    _copy_to_resources(built_backend, "cade-backend", system, triple)

    # ── 2. nkrdn ──────────────────────────────────────────────────────────────
    print("\n[build-sidecar] === Building nkrdn ===")
    nkrdn_python = _find_venv_python("nkrdn")
    if nkrdn_python:
        built_nkrdn = _build_tool("nkrdn", PROJECT_ROOT / "scripts" / "pyinstaller-nkrdn.spec", nkrdn_python, system, triple)
        if built_nkrdn:
            _copy_to_resources(built_nkrdn, "nkrdn", system, triple)
        _copy_nkrdn_usage_rule()
    else:
        print("[build-sidecar] nkrdn skipped (not installed)")

    # ── 3. scout-browse + Chromium ────────────────────────────────────────────
    print("\n[build-sidecar] === Building scout-browse ===")
    scout_python = _find_venv_python("scout-browse")
    if scout_python:
        built_scout = _build_tool("scout-browse", PROJECT_ROOT / "scripts" / "pyinstaller-scout-browse.spec", scout_python, system, triple)
        if built_scout:
            _copy_to_resources(built_scout, "scout-browse", system, triple)
        _copy_chromium(system)
        _bundle_chromium_libs(system)
    else:
        print("[build-sidecar] scout-browse skipped (not installed)")

    print("\n[build-sidecar] Done")


if __name__ == "__main__":
    main()
