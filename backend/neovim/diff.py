"""Diff utilities for Neovim change highlighting.

Computes line-level hunks between old and new file content for
display as Neovim buffer highlights after agent file edits.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher


@dataclass
class Hunk:
    tag: str        # "insert" | "replace" | "delete"
    old_start: int  # 0-indexed, in old file
    old_end: int
    new_start: int  # 0-indexed, in new file
    new_end: int


def compute_hunks(old_content: str, new_content: str) -> list[Hunk]:
    """Return non-equal opcodes between old and new file content."""
    old_lines = old_content.splitlines()
    new_lines = new_content.splitlines()
    sm = SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    return [
        Hunk(tag, i1, i2, j1, j2)
        for tag, i1, i2, j1, j2 in sm.get_opcodes()
        if tag != "equal"
    ]
