"""Tests for configuration loading from TOML files."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator
from unittest.mock import patch

import pytest

from backend.config import (
    _apply_colors_config,
    _apply_file_tree_behavior_config,
    _apply_fonts_config,
    _apply_global_keybindings_config,
    _apply_layout_behavior_config,
    _apply_misc_keybindings_config,
    _apply_pane_keybindings_config,
    _apply_session_behavior_config,
    _apply_tab_keybindings_config,
    _apply_terminal_appearance_config,
    _load_appearance_config,
    _load_behavior_config,
    _load_keybindings_config,
    _load_toml_file,
    _merge_dict,
    get_project_config_path,
    get_user_config_paths,
    load_user_config,
)
from backend.user_config import (
    ColorsConfig,
    FileTreeBehaviorConfig,
    FontsConfig,
    GlobalKeybindingsConfig,
    LayoutBehaviorConfig,
    MiscKeybindingsConfig,
    PaneKeybindingsConfig,
    SessionBehaviorConfig,
    TabKeybindingsConfig,
    TerminalAppearanceConfig,
)


@pytest.fixture
def temp_config_dir(temp_dir: Path) -> Path:
    """Create a temporary config directory structure."""
    config_dir = temp_dir / "config" / "ccplus"
    config_dir.mkdir(parents=True)
    return config_dir


@pytest.fixture
def temp_project_dir(temp_dir: Path) -> Path:
    """Create a temporary project directory with .ccplus folder."""
    project_dir = temp_dir / "project"
    project_dir.mkdir(parents=True)
    ccplus_dir = project_dir / ".ccplus"
    ccplus_dir.mkdir()
    return project_dir


class TestMergeDict:
    """Tests for _merge_dict function."""

    def test_simple_merge(self) -> None:
        """Simple non-overlapping merge."""
        base = {"a": 1, "b": 2}
        override = {"c": 3}
        result = _merge_dict(base, override)
        assert result == {"a": 1, "b": 2, "c": 3}

    def test_override_values(self) -> None:
        """Override should replace base values."""
        base = {"a": 1, "b": 2}
        override = {"b": 3}
        result = _merge_dict(base, override)
        assert result == {"a": 1, "b": 3}

    def test_deep_merge(self) -> None:
        """Nested dictionaries should be merged recursively."""
        base = {"outer": {"a": 1, "b": 2}}
        override = {"outer": {"b": 3, "c": 4}}
        result = _merge_dict(base, override)
        assert result == {"outer": {"a": 1, "b": 3, "c": 4}}

    def test_deeply_nested_merge(self) -> None:
        """Multiple levels of nesting should work."""
        base = {"l1": {"l2": {"a": 1}}}
        override = {"l1": {"l2": {"b": 2}}}
        result = _merge_dict(base, override)
        assert result == {"l1": {"l2": {"a": 1, "b": 2}}}

    def test_original_unchanged(self) -> None:
        """Original dictionaries should not be modified."""
        base = {"a": 1}
        override = {"b": 2}
        _merge_dict(base, override)
        assert base == {"a": 1}
        assert override == {"b": 2}


class TestLoadTomlFile:
    """Tests for _load_toml_file function."""

    def test_load_valid_toml(self, temp_dir: Path) -> None:
        """Should load valid TOML file."""
        toml_file = temp_dir / "test.toml"
        toml_file.write_text('[section]\nkey = "value"\n')
        result = _load_toml_file(toml_file)
        assert result == {"section": {"key": "value"}}

    def test_load_missing_file(self, temp_dir: Path) -> None:
        """Should return empty dict for missing file."""
        missing_file = temp_dir / "missing.toml"
        result = _load_toml_file(missing_file)
        assert result == {}

    def test_load_invalid_toml(self, temp_dir: Path) -> None:
        """Should return empty dict for invalid TOML."""
        invalid_file = temp_dir / "invalid.toml"
        invalid_file.write_text("this is not [valid toml")
        result = _load_toml_file(invalid_file)
        assert result == {}

    def test_load_empty_file(self, temp_dir: Path) -> None:
        """Should return empty dict for empty file."""
        empty_file = temp_dir / "empty.toml"
        empty_file.write_text("")
        result = _load_toml_file(empty_file)
        assert result == {}


class TestApplyColorsConfig:
    """Tests for _apply_colors_config function."""

    def test_apply_all_colors(self) -> None:
        """Should apply all color values."""
        data = {
            "bg-primary": "#000000",
            "accent-blue": "#ff0000",
            "text-muted": "#888888",
        }
        config = _apply_colors_config(data)
        assert config.bg_primary == "#000000"
        assert config.accent_blue == "#ff0000"
        assert config.text_muted == "#888888"

    def test_partial_colors(self) -> None:
        """Should apply only provided colors, keep defaults for others."""
        data = {"bg-primary": "#111111"}
        config = _apply_colors_config(data)
        assert config.bg_primary == "#111111"
        assert config.accent_blue == "#0a9dff"  # default

    def test_empty_data(self) -> None:
        """Should return defaults for empty data."""
        config = _apply_colors_config({})
        assert config.bg_primary == "#1c1b1a"


class TestApplyFontsConfig:
    """Tests for _apply_fonts_config function."""

    def test_apply_all_fonts(self) -> None:
        """Should apply all font values."""
        data = {
            "mono": "Fira Code",
            "mono-size": "16px",
            "sans": "Arial",
        }
        config = _apply_fonts_config(data)
        assert config.mono == "Fira Code"
        assert config.mono_size == "16px"
        assert config.sans == "Arial"

    def test_partial_fonts(self) -> None:
        """Should apply only provided fonts."""
        data = {"mono": "Consolas"}
        config = _apply_fonts_config(data)
        assert config.mono == "Consolas"
        assert config.mono_size == "14px"  # default


class TestApplyTerminalAppearanceConfig:
    """Tests for _apply_terminal_appearance_config function."""

    def test_apply_all_settings(self) -> None:
        """Should apply all terminal settings."""
        data = {"font-size": "12px", "scrollback": 5000}
        config = _apply_terminal_appearance_config(data)
        assert config.font_size == "12px"
        assert config.scrollback == 5000


class TestApplyGlobalKeybindingsConfig:
    """Tests for _apply_global_keybindings_config function."""

    def test_apply_prefix(self) -> None:
        """Should apply prefix key."""
        data = {"prefix": "C-b", "prefix-timeout": 2000}
        config = _apply_global_keybindings_config(data)
        assert config.prefix == "C-b"
        assert config.prefix_timeout == 2000


class TestApplyPaneKeybindingsConfig:
    """Tests for _apply_pane_keybindings_config function."""

    def test_apply_all_pane_keys(self) -> None:
        """Should apply all pane keybindings."""
        data = {
            "focus-left": "j",
            "focus-right": "k",
            "resize-left": "C-j",
            "resize-right": "C-k",
        }
        config = _apply_pane_keybindings_config(data)
        assert config.focus_left == "j"
        assert config.focus_right == "k"
        assert config.resize_left == "C-j"
        assert config.resize_right == "C-k"


class TestApplyTabKeybindingsConfig:
    """Tests for _apply_tab_keybindings_config function."""

    def test_apply_all_tab_keys(self) -> None:
        """Should apply all tab keybindings."""
        data = {"next": "n", "previous": "p", "create": "a", "close": "d"}
        config = _apply_tab_keybindings_config(data)
        assert config.next == "n"
        assert config.previous == "p"
        assert config.create == "a"
        assert config.close == "d"


class TestApplyMiscKeybindingsConfig:
    """Tests for _apply_misc_keybindings_config function."""

    def test_apply_all_misc_keys(self) -> None:
        """Should apply all misc keybindings."""
        data = {"help": "h", "toggle-terminal": "t"}
        config = _apply_misc_keybindings_config(data)
        assert config.help == "h"
        assert config.toggle_terminal == "t"


class TestApplySessionBehaviorConfig:
    """Tests for _apply_session_behavior_config function."""

    def test_apply_all_settings(self) -> None:
        """Should apply all session settings."""
        data = {
            "auto-start-claude": False,
            "auto-save": False,
            "save-interval": 60,
        }
        config = _apply_session_behavior_config(data)
        assert config.auto_start_claude is False
        assert config.auto_save is False
        assert config.save_interval == 60


class TestApplyFileTreeBehaviorConfig:
    """Tests for _apply_file_tree_behavior_config function."""

    def test_apply_all_settings(self) -> None:
        """Should apply all file tree settings."""
        data = {"show-hidden": True, "default-expand-depth": 3}
        config = _apply_file_tree_behavior_config(data)
        assert config.show_hidden is True
        assert config.default_expand_depth == 3


class TestApplyLayoutBehaviorConfig:
    """Tests for _apply_layout_behavior_config function."""

    def test_apply_all_settings(self) -> None:
        """Should apply all layout settings."""
        data = {
            "default-file-tree": 0.25,
            "default-terminal": 0.45,
            "default-viewer": 0.30,
        }
        config = _apply_layout_behavior_config(data)
        assert config.file_tree == 0.25
        assert config.terminal == 0.45
        assert config.viewer == 0.30


class TestGetUserConfigPaths:
    """Tests for get_user_config_paths function."""

    def test_linux_paths(self) -> None:
        """Should return XDG config path on Linux."""
        with patch("backend.config.sys.platform", "linux"):
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": "/home/user/.config"}):
                paths = get_user_config_paths()
                assert Path("/home/user/.config/ccplus") in paths

    def test_linux_default_xdg(self) -> None:
        """Should use default ~/.config when XDG_CONFIG_HOME not set."""
        with patch("backend.config.sys.platform", "linux"):
            with patch.dict(os.environ, {}, clear=True):
                with patch("backend.config.Path.home", return_value=Path("/home/user")):
                    paths = get_user_config_paths()
                    assert Path("/home/user/.config/ccplus") in paths

    def test_windows_paths(self) -> None:
        """Should return APPDATA path on Windows."""
        with patch("backend.config.sys.platform", "win32"):
            with patch.dict(os.environ, {"APPDATA": "C:\\Users\\user\\AppData\\Roaming"}):
                paths = get_user_config_paths()
                # Path separators vary by platform running the test
                path_strs = [str(p) for p in paths]
                assert any("ccplus" in p and "AppData" in p for p in path_strs)


class TestGetProjectConfigPath:
    """Tests for get_project_config_path function."""

    def test_returns_ccplus_dir(self) -> None:
        """Should return .ccplus subdirectory."""
        result = get_project_config_path(Path("/path/to/project"))
        assert result == Path("/path/to/project/.ccplus")


class TestLoadAppearanceConfig:
    """Tests for _load_appearance_config function."""

    def test_load_from_single_path(self, temp_config_dir: Path) -> None:
        """Should load config from a single path."""
        appearance_file = temp_config_dir / "appearance.toml"
        appearance_file.write_text('[colors]\nbg-primary = "#222222"\n')

        config = _load_appearance_config([temp_config_dir])
        assert config.colors.bg_primary == "#222222"

    def test_merge_multiple_paths(self, temp_dir: Path) -> None:
        """Should merge configs from multiple paths."""
        user_dir = temp_dir / "user"
        user_dir.mkdir()
        (user_dir / "appearance.toml").write_text(
            '[colors]\nbg-primary = "#111111"\naccentblue = "#aaaaaa"\n'
        )

        project_dir = temp_dir / "project"
        project_dir.mkdir()
        (project_dir / "appearance.toml").write_text(
            '[colors]\nbg-primary = "#222222"\n'
        )

        config = _load_appearance_config([user_dir, project_dir])
        # Project overrides user
        assert config.colors.bg_primary == "#222222"

    def test_empty_paths(self) -> None:
        """Should return defaults for empty paths."""
        config = _load_appearance_config([])
        assert config.colors.bg_primary == "#1c1b1a"


class TestLoadKeybindingsConfig:
    """Tests for _load_keybindings_config function."""

    def test_load_from_single_path(self, temp_config_dir: Path) -> None:
        """Should load keybindings from a single path."""
        keybindings_file = temp_config_dir / "keybindings.toml"
        keybindings_file.write_text('[global]\nprefix = "C-b"\n')

        config = _load_keybindings_config([temp_config_dir])
        assert config.globals.prefix == "C-b"


class TestLoadBehaviorConfig:
    """Tests for _load_behavior_config function."""

    def test_load_from_single_path(self, temp_config_dir: Path) -> None:
        """Should load behavior from a single path."""
        behavior_file = temp_config_dir / "behavior.toml"
        behavior_file.write_text("[session]\nauto-start-claude = false\n")

        config = _load_behavior_config([temp_config_dir])
        assert config.session.auto_start_claude is False


class TestLoadUserConfig:
    """Tests for load_user_config function."""

    def test_load_default_config(self) -> None:
        """Should return default config when no files exist."""
        config = load_user_config(None)
        assert config.appearance.colors.bg_primary == "#1c1b1a"
        assert config.keybindings.globals.prefix == "C-a"
        assert config.behavior.session.auto_start_claude is True

    def test_load_with_project_config(self, temp_project_dir: Path) -> None:
        """Should load project-local config."""
        ccplus_dir = temp_project_dir / ".ccplus"
        (ccplus_dir / "appearance.toml").write_text('[colors]\nbg-primary = "#333333"\n')

        # Mock user config paths to return empty list
        with patch("backend.config.get_user_config_paths", return_value=[]):
            config = load_user_config(temp_project_dir)
            assert config.appearance.colors.bg_primary == "#333333"

    def test_environment_variable_override(self) -> None:
        """Should respect CCPLUS_AUTO_START_CLAUDE env var."""
        with patch.dict(os.environ, {"CCPLUS_AUTO_START_CLAUDE": "false"}):
            with patch("backend.config.get_user_config_paths", return_value=[]):
                config = load_user_config(None)
                assert config.behavior.session.auto_start_claude is False

    def test_full_config_merge(self, temp_dir: Path) -> None:
        """Should properly merge all config sources."""
        # Create user config directory
        user_dir = temp_dir / "user_config"
        user_dir.mkdir()
        (user_dir / "appearance.toml").write_text('[colors]\nbg-primary = "#111111"\n')
        (user_dir / "keybindings.toml").write_text('[global]\nprefix = "C-b"\n')

        # Create project config directory
        project_dir = temp_dir / "project"
        project_dir.mkdir()
        ccplus_dir = project_dir / ".ccplus"
        ccplus_dir.mkdir()
        (ccplus_dir / "appearance.toml").write_text('[colors]\nbg-secondary = "#222222"\n')

        with patch("backend.config.get_user_config_paths", return_value=[user_dir]):
            config = load_user_config(project_dir)
            # User config
            assert config.appearance.colors.bg_primary == "#111111"
            assert config.keybindings.globals.prefix == "C-b"
            # Project config override
            assert config.appearance.colors.bg_secondary == "#222222"


class TestInvalidConfigHandling:
    """Tests for handling invalid configuration values."""

    def test_invalid_toml_syntax(self, temp_config_dir: Path) -> None:
        """Should handle invalid TOML syntax gracefully."""
        (temp_config_dir / "appearance.toml").write_text("this is not [valid toml")
        config = _load_appearance_config([temp_config_dir])
        # Should return defaults
        assert config.colors.bg_primary == "#1c1b1a"

    def test_wrong_value_types_ignored(self, temp_config_dir: Path) -> None:
        """Should handle wrong value types by using them as-is (no type checking)."""
        # TOML parser will handle type coercion, but our code doesn't validate
        (temp_config_dir / "appearance.toml").write_text('[colors]\nbg-primary = 123\n')
        config = _load_appearance_config([temp_config_dir])
        # Value is stored as-is (TOML parsed as int)
        assert config.colors.bg_primary == 123

    def test_unknown_keys_ignored(self, temp_config_dir: Path) -> None:
        """Should ignore unknown configuration keys."""
        (temp_config_dir / "appearance.toml").write_text(
            '[colors]\nbg-primary = "#111111"\nunknown-key = "value"\n'
        )
        config = _load_appearance_config([temp_config_dir])
        assert config.colors.bg_primary == "#111111"
        # unknown-key is simply not mapped to anything


class TestConfigCaching:
    """Tests for configuration caching behavior."""

    def test_get_user_config_returns_cached(self) -> None:
        """get_user_config should return cached config on subsequent calls."""
        from backend.config import get_user_config, set_user_config, user_config
        from backend.user_config import UserConfig

        # Reset global state
        import backend.config
        backend.config.user_config = None

        # First call loads config
        config1 = get_user_config(None)

        # Second call returns same instance
        config2 = get_user_config(None)
        assert config1 is config2

        # Reset for other tests
        backend.config.user_config = None

    def test_reload_user_config_forces_reload(self, temp_config_dir: Path) -> None:
        """reload_user_config should force fresh load."""
        from backend.config import reload_user_config, get_user_config
        import backend.config

        # Reset global state
        backend.config.user_config = None

        # Initial load
        with patch("backend.config.get_user_config_paths", return_value=[temp_config_dir]):
            config1 = get_user_config(None)

            # Modify file
            (temp_config_dir / "appearance.toml").write_text('[colors]\nbg-primary = "#999999"\n')

            # Regular get returns cached
            config2 = get_user_config(None)
            assert config1 is config2

            # Reload forces fresh load
            config3 = reload_user_config(None)
            assert config3.appearance.colors.bg_primary == "#999999"

        # Reset for other tests
        backend.config.user_config = None
