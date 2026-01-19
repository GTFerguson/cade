"""Configuration types for CADE hook setup."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class HookType(Enum):
    """Types of Claude Code hooks."""

    PRE_TOOL_USE = "PreToolUse"
    POST_TOOL_USE = "PostToolUse"


@dataclass
class CADEHookOptions:
    """Options for configuring CADE hooks.

    Attributes:
        port: The port CADE server listens on.
        all_files: If True, hook triggers for all file edits.
                   If False, only triggers for plan files (plans/*.md).
    """

    port: int = 3001
    all_files: bool = False
