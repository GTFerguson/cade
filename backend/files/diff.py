"""Git diff of one project file, for reviewing an agent's edit from a phone."""

from __future__ import annotations

import asyncio
from pathlib import Path

from backend.files.operations import validate_path

GIT_TIMEOUT_SECONDS = 10


async def _git(root: Path, *args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        "git", "-C", str(root), *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=GIT_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    return proc.returncode or 0, out.decode("utf-8", errors="replace")


async def file_diff(root: Path, relative_path: str) -> dict:
    """Diff of ``relative_path`` against HEAD.

    An untracked file is diffed against nothing so a brand-new file still
    shows as all additions. Returns ``{path, diff, untracked, error?}``.
    """
    target = validate_path(root, relative_path)
    rel = target.relative_to(root.resolve()).as_posix()
    result: dict = {"path": relative_path, "diff": "", "untracked": False}

    try:
        code, _ = await _git(root, "rev-parse", "--is-inside-work-tree")
    except (FileNotFoundError, asyncio.TimeoutError):
        result["error"] = "git is not available"
        return result
    if code != 0:
        result["error"] = "not a git repository"
        return result

    tracked_code, _ = await _git(root, "ls-files", "--error-unmatch", "--", rel)
    if tracked_code != 0:
        result["untracked"] = True
        if not target.is_file():
            result["error"] = "file not found"
            return result
        # --no-index exits 1 when the files differ, which is the expected case.
        _, out = await _git(root, "diff", "--no-color", "--no-index", "--", "/dev/null", rel)
        result["diff"] = out
        return result

    _, out = await _git(root, "diff", "--no-color", "HEAD", "--", rel)
    result["diff"] = out
    return result
