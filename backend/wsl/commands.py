"""WSL command building and path resolution for PTY spawning."""

from __future__ import annotations

import re
import shutil
from pathlib import Path


def windows_to_wsl_path(windows_path: str) -> str | None:
    """Convert a Windows path like C:\\Users\\foo to /mnt/c/Users/foo."""
    normalized = windows_path.replace("\\", "/")
    match = re.match(r"^([a-zA-Z]):/(.*)$", normalized)
    if not match:
        return None
    drive = match.group(1).lower()
    rest = match.group(2)
    return f"/mnt/{drive}/{rest}"


def resolve_command(command: str) -> str:
    """Resolve a command to its full path so WinPTY can find it."""
    resolved = shutil.which(command)
    if resolved:
        return resolved
    resolved = shutil.which(command + ".exe")
    if resolved:
        return resolved
    return command


def build_wsl_command(command: str, cwd: Path) -> str:
    """Build a WSL command with --cd for proper working directory.

    Resolves the wsl binary to its full path so both WinPTY and ConPTY
    can find it regardless of working directory or PATH inheritance.
    """
    resolved = resolve_command(command)
    wsl_path = windows_to_wsl_path(str(cwd))
    if wsl_path:
        return f"{resolved} --cd {wsl_path}"
    return resolved
