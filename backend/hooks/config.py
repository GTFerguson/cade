"""Configuration types for CADE hook setup."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class HookType(Enum):
    """Types of Claude Code hooks."""

    PRE_TOOL_USE = "PreToolUse"
    POST_TOOL_USE = "PostToolUse"
    NOTIFICATION = "Notification"
    STOP = "Stop"
    USER_PROMPT_SUBMIT = "UserPromptSubmit"
    PERMISSION_REQUEST = "PermissionRequest"


# Event-level hooks that feed CADE's attention state (see attention_hook.py).
ATTENTION_HOOK_TYPES = (
    HookType.NOTIFICATION,
    HookType.STOP,
    HookType.USER_PROMPT_SUBMIT,
    # A finished tool call shows the turn is still running, which is the
    # only signal that work resumed after a permission prompt was answered.
    HookType.POST_TOOL_USE,
    # Fires as a permission dialog appears, naming the tool and its input;
    # the Notification for the same dialog comes about six seconds later
    # and says neither. A hook that prints nothing leaves the dialog alone.
    HookType.PERMISSION_REQUEST,
)


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
