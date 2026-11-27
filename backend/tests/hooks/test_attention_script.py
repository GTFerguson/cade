"""The generated attention hook script, run as Claude Code runs it."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from backend.hooks.attention_hook import ATTENTION_SCRIPT


def test_a_permission_request_hook_prints_nothing(tmp_path: Path):
    # Anything a PermissionRequest hook prints is read as its decision on
    # the dialog, so the script must stay silent even when CADE is away.
    script = tmp_path / "attention.py"
    script.write_text(ATTENTION_SCRIPT)
    home = tmp_path / "home"
    (home / ".cade").mkdir(parents=True)
    # Nothing listens on this port, so the POST fails.
    (home / ".cade" / "port").write_text("9")
    payload = {
        "hook_event_name": "PermissionRequest",
        "tool_name": "Bash",
        "tool_input": {"command": "touch a.txt"},
        "cwd": str(tmp_path),
    }
    result = subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        timeout=10,
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
