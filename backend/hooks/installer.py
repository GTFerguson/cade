"""Hook script installer.

Writes the generated hook script to ~/.cade/hooks/ so Claude Code
can invoke it via a simple `python3 ~/.cade/hooks/view_file.py` command.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import TYPE_CHECKING

from backend.hooks.commands import generate_hook_script
from backend.hooks.wsl_path import get_wsl_cade_dir

if TYPE_CHECKING:
    from backend.hooks.config import CADEHookOptions

SCRIPT_FILENAME = "view_file.py"


def install_hook_script(
    options: "CADEHookOptions",
    dry_run: bool = False,
) -> Path:
    """Install the hook script to ~/.cade/hooks/.

    Generates the script with the correct filter mode and writes it.
    Creates the hooks directory if it doesn't exist.

    Args:
        options: Hook configuration options (controls filter mode).
        dry_run: If True, return the path without writing anything.

    Returns:
        Path where the script was (or would be) written.
    """
    cade_dir = get_wsl_cade_dir()
    hooks_dir = cade_dir / "hooks"
    script_path = hooks_dir / SCRIPT_FILENAME

    if dry_run:
        return script_path

    hooks_dir.mkdir(parents=True, exist_ok=True)

    script_content = generate_hook_script(options)
    script_path.write_text(script_content, encoding="utf-8")

    # Try to make executable — may fail on UNC paths from Windows,
    # which is fine since we invoke with `python3` explicitly
    try:
        script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    except OSError:
        pass

    return script_path
