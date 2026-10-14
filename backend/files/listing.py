"""Flat listing of a project's files, for fuzzy search on devices where a
tree is too fiddly to browse. Uses the same ignore rules as the tree so the
two never disagree about what exists."""

from __future__ import annotations

import os
from pathlib import Path

from backend.files.tree import _load_gitignore, _matches_gitignore, _should_ignore

# Enough for any project a phone will search; beyond this the list is
# truncated and the response says so.
DEFAULT_FILE_LIMIT = 20_000


def list_project_files(root: Path, limit: int = DEFAULT_FILE_LIMIT) -> tuple[list[str], bool]:
    """Relative POSIX paths of every non-ignored file under ``root``.

    Returns the sorted list and whether it was cut off at ``limit``.
    """
    root = root.resolve()
    patterns = _load_gitignore(root)
    files: list[str] = []
    truncated = False

    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        # Prune ignored directories in place so os.walk never enters them.
        dirnames[:] = sorted(
            d for d in dirnames
            if not _should_ignore(current / d)
            and not _matches_gitignore(current / d, root, patterns)
        )
        for name in filenames:
            path = current / name
            if _should_ignore(path) or _matches_gitignore(path, root, patterns):
                continue
            files.append(path.relative_to(root).as_posix())
            if len(files) >= limit:
                truncated = True
                break
        if truncated:
            break

    files.sort()
    return files, truncated
