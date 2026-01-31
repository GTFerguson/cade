"""WSL/Windows Claude Code session unification."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def is_wsl() -> bool:
    """Check if running in WSL."""
    if os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop"):
        return True
    version_path = Path("/proc/version")
    if version_path.exists():
        return "microsoft" in version_path.read_text().lower()
    return False


def is_wsl_mounted_path(path: Path) -> bool:
    """Check if path is WSL mount of Windows drive."""
    resolved = str(path.resolve())
    return resolved.startswith("/mnt/") and len(resolved) > 5 and resolved[5].isalpha()


def wsl_to_windows_path(wsl_path: Path) -> str | None:
    """Convert WSL path to Windows path using wslpath."""
    try:
        result = subprocess.run(
            ["wslpath", "-w", str(wsl_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def encode_wsl_session_dirname(wsl_path: Path) -> str:
    """Encode to Claude Code WSL format: /mnt/c/foo -> -mnt-c-foo"""
    return str(wsl_path.resolve()).replace("/", "-").replace(".", "-")


def encode_windows_session_dirname(windows_path: str) -> str:
    """Encode to Claude Code Windows format: C:\\foo -> C--foo"""
    if len(windows_path) >= 2 and windows_path[1] == ":":
        encoded = windows_path[0] + "-" + windows_path[2:]
    else:
        encoded = windows_path
    return encoded.replace("\\", "-").replace(".", "-")


def get_windows_user_home(windows_path: str) -> str | None:
    """Extract Windows user home from path like C:\\Users\\name\\..."""
    parts = windows_path.split("\\")
    if len(parts) >= 3 and parts[1].lower() == "users":
        return "\\".join(parts[:3])
    return None


def unify_sessions(working_dir: Path) -> bool:
    """Create symlink from WSL to Windows session dir if applicable.

    Returns True if symlink was created or already correct, False otherwise.
    """
    if not is_wsl():
        return False

    if not is_wsl_mounted_path(working_dir):
        return False

    windows_path = wsl_to_windows_path(working_dir)
    if not windows_path:
        logger.debug("Could not convert path to Windows format")
        return False

    windows_home = get_windows_user_home(windows_path)
    if not windows_home:
        logger.debug("Could not determine Windows user home")
        return False

    wsl_session_name = encode_wsl_session_dirname(working_dir)
    windows_session_name = encode_windows_session_dirname(windows_path)

    wsl_session_dir = Path.home() / ".claude" / "projects" / wsl_session_name

    # Convert Windows .claude path to WSL accessible path
    drive_letter = windows_home[0].lower()
    windows_home_wsl = f"/mnt/{drive_letter}" + windows_home[2:].replace("\\", "/")
    windows_session_dir = Path(windows_home_wsl) / ".claude" / "projects" / windows_session_name

    # Also check lowercase variant (Windows paths can vary in case)
    windows_session_dir_lower = (
        Path(windows_home_wsl) / ".claude" / "projects" / windows_session_name.lower()
    )

    target_dir = None
    if windows_session_dir.exists():
        target_dir = windows_session_dir
    elif windows_session_dir_lower.exists():
        target_dir = windows_session_dir_lower

    if not target_dir:
        logger.debug("Windows session directory not found: %s", windows_session_dir)
        return False

    if wsl_session_dir.exists():
        if wsl_session_dir.is_symlink():
            current_target = wsl_session_dir.resolve()
            if current_target == target_dir.resolve():
                logger.debug("Session symlink already correct")
                return True
            wsl_session_dir.unlink()
        else:
            # Merge WSL sessions into Windows directory
            logger.info("Merging WSL sessions into Windows directory")
            for item in wsl_session_dir.iterdir():
                dest = target_dir / item.name
                if not dest.exists():
                    if item.is_dir():
                        shutil.copytree(item, dest)
                    else:
                        shutil.copy2(item, dest)
                    logger.debug("Copied %s to Windows sessions", item.name)

            # Remove WSL directory after successful merge
            shutil.rmtree(wsl_session_dir)
            logger.info("Removed WSL session directory after merge")

    wsl_session_dir.parent.mkdir(parents=True, exist_ok=True)

    wsl_session_dir.symlink_to(target_dir)
    logger.info("Unified Claude sessions: %s -> %s", wsl_session_dir, target_dir)
    return True
