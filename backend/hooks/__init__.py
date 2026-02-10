"""CADE hooks module for Claude Code integration.

This module provides tools for configuring Claude Code hooks that
integrate with CADE's file viewing capabilities.

Public API:
    setup_cade_hooks: Configure hooks in Claude Code settings
    CADEHookOptions: Options for hook configuration
    HookType: Types of Claude Code hooks
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from backend.hooks.commands import build_hook_config
from backend.hooks.config import CADEHookOptions, HookType
from backend.hooks.installer import install_hook_script
from backend.hooks.settings import ClaudeSettings
from backend.hooks.wsl_path import get_wsl_settings_path

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "CADEHookOptions",
    "HookType",
    "SetupResult",
    "setup_cade_hooks",
]


@dataclass
class SetupResult:
    """Result of hook setup operation.

    Attributes:
        success: Whether the operation succeeded.
        settings_path: Path to the settings file.
        script_path: Path to the installed hook script.
        is_wsl: Whether writing to WSL from Windows.
        hook_updated: Whether an existing hook was updated (vs. new).
        backup_created: Whether a backup was created.
        message: Human-readable result message.
    """

    success: bool
    settings_path: "Path"
    script_path: "Path | None"
    is_wsl: bool
    hook_updated: bool
    backup_created: bool
    message: str


def setup_cade_hooks(
    options: CADEHookOptions | None = None,
    dry_run: bool = False,
) -> SetupResult:
    """Configure Claude Code hooks for CADE file viewing.

    Sets up a PostToolUse hook that sends edited files to CADE's
    view endpoint. Can be configured to trigger for all files or
    only plan files.

    Args:
        options: Hook configuration options. Uses defaults if None.
        dry_run: If True, don't modify settings, just return what would happen.

    Returns:
        SetupResult with details of the operation.

    Raises:
        json.JSONDecodeError: If existing settings.json is invalid JSON.
    """
    if options is None:
        options = CADEHookOptions()

    settings_path, is_wsl = get_wsl_settings_path()
    settings = ClaudeSettings(settings_path)

    try:
        settings.load()
    except Exception as e:
        return SetupResult(
            success=False,
            settings_path=settings_path,
            script_path=None,
            is_wsl=is_wsl,
            hook_updated=False,
            backup_created=False,
            message=f"Failed to load settings: {e}",
        )

    # Install the hook script to ~/.cade/hooks/
    script_path = install_hook_script(options, dry_run=dry_run)

    hook_config = build_hook_config(options)
    hook_updated = settings.add_hook(HookType.POST_TOOL_USE, hook_config)

    if dry_run:
        action = "update" if hook_updated else "add"
        return SetupResult(
            success=True,
            settings_path=settings_path,
            script_path=script_path,
            is_wsl=is_wsl,
            hook_updated=hook_updated,
            backup_created=False,
            message=f"Would {action} PostToolUse hook (dry run)",
        )

    backup_created = settings_path.exists()
    settings.save(create_backup=backup_created)

    action = "Updated" if hook_updated else "Added"
    file_filter = "all file edits" if options.all_files else "plan files (plans/*.md)"

    return SetupResult(
        success=True,
        settings_path=settings_path,
        script_path=script_path,
        is_wsl=is_wsl,
        hook_updated=hook_updated,
        backup_created=backup_created,
        message=f"{action} PostToolUse hook for {file_filter}",
    )
