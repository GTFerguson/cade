"""Walks of a project's files that skip what the file tree skips.

The tree, the flat listing for phone search, and the "is there anything to
index here?" probes all need the same answer to "which directories count",
or they disagree about what the project contains. Ignored directories are
pruned before they are entered: a probe that recursed into a gitignored
vendor tree holding a million files took seconds on the event loop.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from backend.files.tree import _load_gitignore, _matches_gitignore, _should_ignore

# Enough for any project a phone will search; beyond this the list is
# truncated and the response says so.
DEFAULT_FILE_LIMIT = 20_000


def walk_project(root: Path, *, max_dirs: int | None = None) -> Iterator[tuple[Path, list[str]]]:
    """Yield ``(directory, filenames)`` for each non-ignored directory under ``root``.

    Directories are visited top-down with ignored and gitignored entries
    pruned, so nothing inside them is ever listed. Filenames are the
    non-ignored files directly in that directory. With ``max_dirs`` the walk
    stops after that many directories, for probes that only need a bounded
    look.
    """
    root = root.resolve()
    patterns = _load_gitignore(root)
    visited = 0

    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        # Prune ignored directories in place so os.walk never enters them.
        dirnames[:] = sorted(
            d for d in dirnames
            if not _should_ignore(current / d)
            and not _matches_gitignore(current / d, root, patterns)
        )
        kept = [
            name for name in filenames
            if not _should_ignore(current / name)
            and not _matches_gitignore(current / name, root, patterns)
        ]
        yield current, kept
        visited += 1
        if max_dirs is not None and visited >= max_dirs:
            return


def has_file_with_suffix(root: Path, suffixes: frozenset[str] | set[str], *, max_dirs: int) -> bool:
    """Whether some non-ignored file under ``root`` has one of ``suffixes``.

    Looks at no more than ``max_dirs`` directories and answers True once the
    limit is reached: a project that large is worth handing to the indexer,
    which has its own notion of what to skip, rather than walking in full
    here just to decide whether to start it.
    """
    seen = 0
    for _directory, filenames in walk_project(root, max_dirs=max_dirs):
        seen += 1
        if any(os.path.splitext(name)[1] in suffixes for name in filenames):
            return True
    return seen >= max_dirs


def list_project_files(root: Path, limit: int = DEFAULT_FILE_LIMIT) -> tuple[list[str], bool]:
    """Relative POSIX paths of every non-ignored file under ``root``.

    Returns the sorted list and whether it was cut off at ``limit``.
    """
    root = root.resolve()
    files: list[str] = []
    truncated = False

    for directory, filenames in walk_project(root):
        for name in filenames:
            files.append((directory / name).relative_to(root).as_posix())
            if len(files) >= limit:
                truncated = True
                break
        if truncated:
            break

    files.sort()
    return files, truncated
