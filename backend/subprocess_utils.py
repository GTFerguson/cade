"""Subprocess utilities for cross-platform window suppression."""

from __future__ import annotations

import subprocess
import sys
from typing import Any


def run_silent(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess:
    """subprocess.run() that suppresses console windows on Windows.

    On Windows, spawning console programs (wsl.exe, nvim.exe) creates a
    visible console window that jumps to the foreground. CREATE_NO_WINDOW
    prevents this while keeping the process functional.
    """
    if sys.platform == "win32":
        kwargs.setdefault("creationflags", subprocess.CREATE_NO_WINDOW)
    return subprocess.run(*args, **kwargs)
