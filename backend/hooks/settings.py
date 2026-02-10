"""Claude Code settings.json management."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from backend.hooks.config import HookType


def _is_cade_hook(command: str) -> bool:
    """Check whether a hook command belongs to CADE.

    Recognizes both the old one-liner style (contains 'api/view') and
    the new script-based style (contains 'view_file.py').

    Args:
        command: The hook command string to check.

    Returns:
        True if the command is a CADE hook.
    """
    return "api/view" in command or "view_file.py" in command


class ClaudeSettings:
    """Manages Claude Code settings.json file.

    Provides methods for loading, modifying, and saving Claude Code settings,
    with special focus on hook configuration.
    """

    def __init__(self, settings_path: Path) -> None:
        """Initialize settings manager.

        Args:
            settings_path: Path to the settings.json file.
        """
        self._path = settings_path
        self._data: dict[str, Any] = {}

    @property
    def path(self) -> Path:
        """Return the settings file path."""
        return self._path

    @property
    def data(self) -> dict[str, Any]:
        """Return the current settings data."""
        return self._data

    def load(self) -> None:
        """Load settings from the settings file.

        If the file doesn't exist or is invalid JSON, initializes with empty dict.

        Raises:
            json.JSONDecodeError: If the file contains invalid JSON.
        """
        if self._path.exists():
            self._data = json.loads(self._path.read_text())
        else:
            self._data = {}

    def save(self, create_backup: bool = True) -> None:
        """Save settings to the settings file.

        Args:
            create_backup: If True and file exists, create a .backup before saving.
        """
        if create_backup and self._path.exists():
            backup_path = self._path.parent / "settings.json.backup"
            shutil.copy2(self._path, backup_path)

        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, indent=2) + "\n")

    def add_hook(
        self,
        hook_type: HookType,
        hook: dict[str, Any],
    ) -> bool:
        """Add or update a hook in settings.

        If a hook with the same matcher already exists and contains 'api/view'
        in its command, it will be updated. Otherwise, the hook is appended.

        Args:
            hook_type: The type of hook (PreToolUse or PostToolUse).
            hook: The hook configuration dict with 'matcher' and 'hooks' keys.

        Returns:
            True if an existing hook was updated, False if a new hook was added.
        """
        if "hooks" not in self._data:
            self._data["hooks"] = {}

        hook_type_key = hook_type.value
        if hook_type_key not in self._data["hooks"]:
            self._data["hooks"][hook_type_key] = []

        existing_hooks = self._data["hooks"][hook_type_key]
        matcher = hook.get("matcher")

        for i, existing in enumerate(existing_hooks):
            if existing.get("matcher") == matcher:
                hook_cmds = existing.get("hooks", [])
                for cmd in hook_cmds:
                    if _is_cade_hook(cmd.get("command", "")):
                        existing_hooks[i] = hook
                        return True

        existing_hooks.append(hook)
        return False

    def has_cade_hook(self, hook_type: HookType) -> bool:
        """Check if a CADE hook already exists for the given type.

        Args:
            hook_type: The type of hook to check.

        Returns:
            True if a CADE hook (old or new style) is already configured.
        """
        for existing in self.get_hooks(hook_type):
            for cmd in existing.get("hooks", []):
                if _is_cade_hook(cmd.get("command", "")):
                    return True
        return False

    def remove_hook(
        self,
        hook_type: HookType,
        matcher: str,
    ) -> bool:
        """Remove a hook matching the given matcher.

        Args:
            hook_type: The type of hook to search in.
            matcher: The matcher pattern to find.

        Returns:
            True if a hook was removed, False if not found.
        """
        if "hooks" not in self._data:
            return False

        hook_type_key = hook_type.value
        if hook_type_key not in self._data["hooks"]:
            return False

        existing_hooks = self._data["hooks"][hook_type_key]
        for i, hook in enumerate(existing_hooks):
            if hook.get("matcher") == matcher:
                existing_hooks.pop(i)
                return True

        return False

    def get_hooks(self, hook_type: HookType) -> list[dict[str, Any]]:
        """Get all hooks of a specific type.

        Args:
            hook_type: The type of hooks to retrieve.

        Returns:
            List of hook configuration dicts.
        """
        if "hooks" not in self._data:
            return []

        return self._data["hooks"].get(hook_type.value, [])
