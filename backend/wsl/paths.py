"""WSL path translation utilities.

Converts WSL paths to Windows UNC paths for cross-environment file access.
"""

from __future__ import annotations

import logging
import subprocess
from functools import lru_cache

from backend.subprocess_utils import run_silent

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_default_wsl_distro() -> str | None:
    """
    Get the default WSL distribution name.

    Uses `wsl -l -q` which outputs distros with the default first.

    Returns:
        Distribution name or None if WSL is not available.
    """
    try:
        result = run_silent(
            ["wsl", "-l", "-q"],
            capture_output=True,
            timeout=5.0,
        )
        if result.returncode != 0:
            logger.warning("wsl -l -q failed: %s", result.stderr)
            return None

        # Output is UTF-16-LE encoded with null bytes between chars
        # First line is the default distro
        output = result.stdout.decode("utf-16-le", errors="ignore")
        lines = [line.strip("\x00\r\n ") for line in output.split("\n")]
        lines = [line for line in lines if line]

        if not lines:
            logger.warning("No WSL distributions found")
            return None

        distro = lines[0]
        logger.debug("Default WSL distro: %s", distro)
        return distro

    except subprocess.TimeoutExpired:
        logger.warning("WSL distro detection timed out")
        return None
    except FileNotFoundError:
        logger.debug("WSL not installed")
        return None
    except Exception as e:
        logger.warning("Failed to get WSL distro: %s", e)
        return None


def wsl_to_windows_path(wsl_path: str) -> str:
    """
    Convert a WSL path to a Windows UNC path.

    WSL paths like `/home/user/file.md` become
    `\\\\wsl.localhost\\<distro>\\home\\user\\file.md`

    Args:
        wsl_path: Path starting with `/` (WSL absolute path)

    Returns:
        Windows UNC path if conversion succeeds, original path otherwise.
    """
    if not wsl_path.startswith("/"):
        # Not a WSL path, return as-is
        return wsl_path

    distro = get_default_wsl_distro()
    if distro is None:
        logger.warning("Cannot convert WSL path: no distro detected")
        return wsl_path

    # Convert forward slashes to backslashes for Windows
    windows_subpath = wsl_path.replace("/", "\\")

    # Build UNC path: \\wsl.localhost\<distro>\path
    unc_path = f"\\\\wsl.localhost\\{distro}{windows_subpath}"
    logger.debug("Converted WSL path: %s -> %s", wsl_path, unc_path)

    return unc_path


def is_wsl_path(path: str) -> bool:
    """Check if a path appears to be a WSL absolute path."""
    return path.startswith("/") and not path.startswith("//")


def wsl_mount_to_windows_path(wsl_path: str) -> str:
    """Convert a WSL-mounted Windows path to native Windows format.

    Converts paths like `/mnt/c/Users/foo` to `C:\\Users\\foo`.
    Also handles Windows-style paths like `\\mnt\\c\\Users\\foo`.

    Args:
        wsl_path: Path starting with `/mnt/<drive>/...` or `\\mnt\\<drive>\\...`

    Returns:
        Windows path if it's a mounted path, original path otherwise.
    """
    import re

    # Normalize to forward slashes for matching
    normalized = wsl_path.replace("\\", "/")

    # Match /mnt/<single-letter-drive>/...
    match = re.match(r"^/mnt/([a-zA-Z])(/.*)?$", normalized)
    if not match:
        return wsl_path

    drive_letter = match.group(1).upper()
    rest_of_path = match.group(2) or ""

    # Convert forward slashes to backslashes
    windows_path = rest_of_path.replace("/", "\\")

    result = f"{drive_letter}:{windows_path}"
    logger.debug("Converted WSL mount path: %s -> %s", wsl_path, result)
    return result


@lru_cache(maxsize=1)
def get_wsl_home_as_windows_path() -> str | None:
    """
    Get the WSL home directory as a Windows UNC path.

    Returns:
        Windows UNC path like `\\\\wsl.localhost\\Ubuntu\\home\\user`
        or None if WSL is not available.
    """
    distro = get_default_wsl_distro()
    if distro is None:
        return None

    try:
        # Get WSL username
        result = run_silent(
            ["wsl", "-d", distro, "whoami"],
            capture_output=True,
            text=True,
            timeout=5.0,
        )
        if result.returncode != 0:
            logger.warning("Failed to get WSL username: %s", result.stderr)
            return None

        username = result.stdout.strip()
        if not username:
            logger.warning("Empty WSL username")
            return None

        # Build UNC path to home directory
        unc_path = f"\\\\wsl.localhost\\{distro}\\home\\{username}"
        logger.debug("WSL home path: %s", unc_path)
        return unc_path

    except subprocess.TimeoutExpired:
        logger.warning("WSL home detection timed out")
        return None
    except Exception as e:
        logger.warning("Failed to get WSL home: %s", e)
        return None
