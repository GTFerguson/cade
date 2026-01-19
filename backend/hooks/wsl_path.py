"""WSL path handling for Claude Code settings."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def get_wsl_settings_path() -> tuple[Path, bool]:
    """Get the Claude Code settings path, handling Windows/WSL correctly.

    When running on Windows, this function detects the default WSL distro
    and returns a UNC path to write settings directly to the WSL filesystem.

    Returns:
        Tuple of (settings_path, is_wsl_via_windows).
        is_wsl_via_windows is True if running on Windows and need to write to WSL.
    """
    if sys.platform != "win32":
        return Path.home() / ".claude" / "settings.json", False

    try:
        result = subprocess.run(
            ["wsl", "-l", "-q"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            print("Warning: Could not detect WSL distro, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        lines = [line.strip().replace("\x00", "") for line in result.stdout.split("\n")]
        distro = next((line for line in lines if line), None)
        if not distro:
            print("Warning: No WSL distro found, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        result = subprocess.run(
            ["wsl", "-d", distro, "whoami"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            print("Warning: Could not get WSL username, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        wsl_user = result.stdout.strip()

        wsl_path = Path(f"\\\\wsl$\\{distro}\\home\\{wsl_user}\\.claude\\settings.json")
        return wsl_path, True

    except subprocess.TimeoutExpired:
        print("Warning: WSL command timed out, using Windows path")
        return Path.home() / ".claude" / "settings.json", False
    except FileNotFoundError:
        print("Warning: WSL not available, using Windows path")
        return Path.home() / ".claude" / "settings.json", False
