"""Tests for the ClaudeSettings class."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.hooks.config import HookType
from backend.hooks.settings import ClaudeSettings


class TestClaudeSettings:
    """Tests for ClaudeSettings class."""

    def test_load_empty_file(self, temp_dir: Path) -> None:
        """Non-existent settings creates empty dict."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings = ClaudeSettings(settings_path)
        settings.load()

        assert settings.data == {}

    def test_load_existing_settings(self, temp_dir: Path) -> None:
        """Existing settings.json is loaded correctly."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        existing_data = {"someKey": "someValue", "hooks": {}}
        settings_path.write_text(json.dumps(existing_data))

        settings = ClaudeSettings(settings_path)
        settings.load()

        assert settings.data == existing_data

    def test_add_hook_creates_structure(self, temp_dir: Path) -> None:
        """Adding hook to empty settings creates hooks.PostToolUse."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings = ClaudeSettings(settings_path)
        settings.load()

        hook = {
            "matcher": "Edit|Write",
            "hooks": [{"type": "command", "command": "echo test"}],
        }
        updated = settings.add_hook(HookType.POST_TOOL_USE, hook)

        assert not updated  # New hook, not updated
        assert "hooks" in settings.data
        assert "PostToolUse" in settings.data["hooks"]
        assert len(settings.data["hooks"]["PostToolUse"]) == 1
        assert settings.data["hooks"]["PostToolUse"][0] == hook

    def test_add_hook_updates_existing(self, temp_dir: Path) -> None:
        """Existing hook with same matcher and api/view is updated, not duplicated."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        existing_data = {
            "hooks": {
                "PostToolUse": [
                    {
                        "matcher": "Edit|Write",
                        "hooks": [
                            {
                                "type": "command",
                                "command": "curl http://old/api/view",
                            }
                        ],
                    }
                ]
            }
        }
        settings_path.write_text(json.dumps(existing_data))

        settings = ClaudeSettings(settings_path)
        settings.load()

        new_hook = {
            "matcher": "Edit|Write",
            "hooks": [
                {
                    "type": "command",
                    "command": "curl http://new/api/view",
                }
            ],
        }
        updated = settings.add_hook(HookType.POST_TOOL_USE, new_hook)

        assert updated  # Should update existing
        assert len(settings.data["hooks"]["PostToolUse"]) == 1  # Not duplicated
        assert settings.data["hooks"]["PostToolUse"][0] == new_hook

    def test_add_hook_appends_different_matcher(self, temp_dir: Path) -> None:
        """Hook with different matcher is appended, not updated."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        existing_data = {
            "hooks": {
                "PostToolUse": [
                    {
                        "matcher": "Read",
                        "hooks": [{"type": "command", "command": "echo read"}],
                    }
                ]
            }
        }
        settings_path.write_text(json.dumps(existing_data))

        settings = ClaudeSettings(settings_path)
        settings.load()

        new_hook = {
            "matcher": "Edit|Write",
            "hooks": [{"type": "command", "command": "curl api/view"}],
        }
        updated = settings.add_hook(HookType.POST_TOOL_USE, new_hook)

        assert not updated  # Should append, not update
        assert len(settings.data["hooks"]["PostToolUse"]) == 2

    def test_save_creates_backup(self, temp_dir: Path) -> None:
        """Saving creates .backup file when original exists."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text('{"original": true}')

        settings = ClaudeSettings(settings_path)
        settings.load()
        settings._data["modified"] = True
        settings.save(create_backup=True)

        backup_path = temp_dir / ".claude" / "settings.json.backup"
        assert backup_path.exists()

        backup_content = json.loads(backup_path.read_text())
        assert backup_content == {"original": True}

    def test_save_creates_directory(self, temp_dir: Path) -> None:
        """Saving creates parent directories if needed."""
        settings_path = temp_dir / "new" / "path" / "settings.json"
        settings = ClaudeSettings(settings_path)
        settings.load()
        settings._data["test"] = True
        settings.save(create_backup=False)

        assert settings_path.exists()
        content = json.loads(settings_path.read_text())
        assert content == {"test": True}

    def test_remove_hook(self, temp_dir: Path) -> None:
        """Test removing a hook by matcher."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        existing_data = {
            "hooks": {
                "PostToolUse": [
                    {"matcher": "Edit|Write", "hooks": []},
                    {"matcher": "Read", "hooks": []},
                ]
            }
        }
        settings_path.write_text(json.dumps(existing_data))

        settings = ClaudeSettings(settings_path)
        settings.load()

        removed = settings.remove_hook(HookType.POST_TOOL_USE, "Edit|Write")

        assert removed
        assert len(settings.data["hooks"]["PostToolUse"]) == 1
        assert settings.data["hooks"]["PostToolUse"][0]["matcher"] == "Read"

    def test_remove_hook_not_found(self, temp_dir: Path) -> None:
        """Removing non-existent hook returns False."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings = ClaudeSettings(settings_path)
        settings.load()

        removed = settings.remove_hook(HookType.POST_TOOL_USE, "NonExistent")

        assert not removed

    def test_get_hooks(self, temp_dir: Path) -> None:
        """Test getting hooks by type."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        hooks = [
            {"matcher": "Edit", "hooks": []},
            {"matcher": "Write", "hooks": []},
        ]
        existing_data = {"hooks": {"PostToolUse": hooks}}
        settings_path.write_text(json.dumps(existing_data))

        settings = ClaudeSettings(settings_path)
        settings.load()

        result = settings.get_hooks(HookType.POST_TOOL_USE)
        assert result == hooks

    def test_get_hooks_empty(self, temp_dir: Path) -> None:
        """Getting hooks when none exist returns empty list."""
        settings_path = temp_dir / ".claude" / "settings.json"
        settings = ClaudeSettings(settings_path)
        settings.load()

        result = settings.get_hooks(HookType.POST_TOOL_USE)
        assert result == []
