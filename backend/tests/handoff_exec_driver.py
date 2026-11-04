"""Two program images for the upgrade handoff test.

``phase1`` builds a session registry with a live shell, writes a handoff
manifest and execs this same interpreter into ``phase2``, which adopts the
manifest and proves the shell is still responsive, with its scrollback and
sequence numbers intact. The exec is real, so this covers descriptor
inheritance, child ownership across the image change, and the manifest
round trip in one go.

Usage: python handoff_exec_driver.py phase1 <manifest-path> <workdir>
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend import upgrade  # noqa: E402
from backend.models import TerminalSize  # noqa: E402
from backend.terminal.sessions import SessionRegistry  # noqa: E402

SHELL = "bash --norc --noprofile"


async def _wait_for(predicate, timeout: float = 10.0) -> None:
    for _ in range(int(timeout / 0.05)):
        if predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("timed out waiting for terminal output")


async def phase1(manifest_path: Path, workdir: Path) -> None:
    registry = SessionRegistry()
    session, _ = await registry.get_or_create(
        "tab-1", workdir, SHELL, TerminalSize(cols=80, rows=24),
    )
    session.label = "carried label"
    await session.pty.write("echo before_$((40+2))\n")
    await _wait_for(lambda: "before_42" in session.get_scrollback())
    seq_before = session.terminals["claude"].last_seq

    sessions = await upgrade.export_sessions(registry)
    manifest = upgrade.Manifest(
        sessions=sessions,
        chat={"tab-1": {"provider_name": "p", "messages": [{"role": "user", "content": "hi"}]}},
        listener_fd=None,
        old_meipass=None,
    )
    for fd in manifest.inherited_fds:
        os.set_inheritable(fd, True)
    upgrade.write_manifest(manifest, manifest_path)
    # Hand phase2 what it needs to check continuity.
    (manifest_path.parent / "expect.json").write_text(json.dumps({"seq_before": seq_before}))
    os.execv(sys.executable, [sys.executable, __file__, "phase2", str(manifest_path), str(workdir)])


async def phase2(manifest_path: Path, workdir: Path) -> None:
    expect = json.loads((manifest_path.parent / "expect.json").read_text())
    manifest = upgrade.read_manifest(manifest_path)
    registry = SessionRegistry()
    adopted = upgrade.import_sessions(manifest, registry)
    assert adopted == 1, adopted

    session = registry.get("tab-1")
    assert session is not None
    assert session.label == "carried label"
    assert session.project_path == workdir
    terminal = session.terminals["claude"]
    assert "before_42" in session.get_scrollback(), session.get_scrollback()
    assert terminal.last_seq == expect["seq_before"], (terminal.last_seq, expect)
    assert session.pty.is_alive()
    assert manifest.chat["tab-1"]["messages"][0]["content"] == "hi"

    await session.pty.write("echo after_$((50+5))\n")
    await _wait_for(lambda: "after_55" in session.get_scrollback())
    assert terminal.last_seq > expect["seq_before"]

    await registry.stop()
    assert not session.pty.is_alive()
    print("HANDOFF_OK")


def main(argv: list[str]) -> int:
    phase, manifest_path, workdir = argv[0], Path(argv[1]), Path(argv[2])
    asyncio.run({"phase1": phase1, "phase2": phase2}[phase](manifest_path, workdir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
