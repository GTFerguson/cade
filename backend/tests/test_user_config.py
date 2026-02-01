"""Tests for user_config module."""

from __future__ import annotations

import pytest

from backend.files.user_config import (
    AppearanceConfig,
    BehaviorConfig,
    ColorsConfig,
    FileTreeBehaviorConfig,
    FontsConfig,
    GlobalKeybindingsConfig,
    KeybindingsConfig,
    LayoutBehaviorConfig,
    MiscKeybindingsConfig,
    PaneKeybindingsConfig,
    SessionBehaviorConfig,
    TabKeybindingsConfig,
    TerminalAppearanceConfig,
    UserConfig,
    get_default_user_config,
)


class TestColorsConfig:
    """Tests for ColorsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default colors should match badwolf theme."""
        config = ColorsConfig()
        assert config.bg_primary == "#1c1b1a"
        assert config.accent_blue == "#0a9dff"
        assert config.text_primary == "#f8f6f2"

    def test_custom_values(self) -> None:
        """Custom color values should be stored correctly."""
        config = ColorsConfig(bg_primary="#000000", accent_blue="#ff0000")
        assert config.bg_primary == "#000000"
        assert config.accent_blue == "#ff0000"


class TestFontsConfig:
    """Tests for FontsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default fonts should be set."""
        config = FontsConfig()
        assert config.mono == "JetBrains Mono"
        assert config.mono_size == "14px"

    def test_custom_values(self) -> None:
        """Custom font values should be stored correctly."""
        config = FontsConfig(mono="Fira Code", mono_size="16px")
        assert config.mono == "Fira Code"
        assert config.mono_size == "16px"


class TestTerminalAppearanceConfig:
    """Tests for TerminalAppearanceConfig dataclass."""

    def test_default_values(self) -> None:
        """Default terminal settings should be set."""
        config = TerminalAppearanceConfig()
        assert config.font_size == "14px"
        assert config.scrollback == 10000

    def test_custom_values(self) -> None:
        """Custom terminal values should be stored correctly."""
        config = TerminalAppearanceConfig(font_size="12px", scrollback=5000)
        assert config.font_size == "12px"
        assert config.scrollback == 5000


class TestAppearanceConfig:
    """Tests for AppearanceConfig dataclass."""

    def test_default_nested_configs(self) -> None:
        """Default appearance should have nested configs."""
        config = AppearanceConfig()
        assert isinstance(config.colors, ColorsConfig)
        assert isinstance(config.fonts, FontsConfig)
        assert isinstance(config.terminal, TerminalAppearanceConfig)

    def test_custom_nested_configs(self) -> None:
        """Custom nested configs should be used."""
        custom_colors = ColorsConfig(bg_primary="#111111")
        config = AppearanceConfig(colors=custom_colors)
        assert config.colors.bg_primary == "#111111"


class TestGlobalKeybindingsConfig:
    """Tests for GlobalKeybindingsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default prefix key should be Ctrl+a."""
        config = GlobalKeybindingsConfig()
        assert config.prefix == "C-a"
        assert config.prefix_timeout == 1500

    def test_custom_values(self) -> None:
        """Custom prefix key should be stored."""
        config = GlobalKeybindingsConfig(prefix="C-b", prefix_timeout=2000)
        assert config.prefix == "C-b"
        assert config.prefix_timeout == 2000


class TestPaneKeybindingsConfig:
    """Tests for PaneKeybindingsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default pane keybindings should be vim-style."""
        config = PaneKeybindingsConfig()
        assert config.focus_left == "h"
        assert config.focus_right == "l"
        assert config.resize_left == "A-h"
        assert config.resize_right == "A-l"


class TestTabKeybindingsConfig:
    """Tests for TabKeybindingsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default tab keybindings should be set."""
        config = TabKeybindingsConfig()
        assert config.next == "f"
        assert config.previous == "d"
        assert config.create == "c"
        assert config.create_remote == "C"
        assert config.close == "x"

    def test_create_and_create_remote_are_distinct(self) -> None:
        """create and create_remote must differ so the frontend can distinguish them."""
        config = TabKeybindingsConfig()
        assert config.create != config.create_remote


class TestMiscKeybindingsConfig:
    """Tests for MiscKeybindingsConfig dataclass."""

    def test_default_values(self) -> None:
        """Default misc keybindings should be set."""
        config = MiscKeybindingsConfig()
        assert config.help == "?"
        assert config.toggle_terminal == "s"


class TestKeybindingsConfig:
    """Tests for KeybindingsConfig dataclass."""

    def test_default_nested_configs(self) -> None:
        """Default keybindings should have nested configs."""
        config = KeybindingsConfig()
        assert isinstance(config.globals, GlobalKeybindingsConfig)
        assert isinstance(config.pane, PaneKeybindingsConfig)
        assert isinstance(config.tab, TabKeybindingsConfig)
        assert isinstance(config.misc, MiscKeybindingsConfig)


class TestSessionBehaviorConfig:
    """Tests for SessionBehaviorConfig dataclass."""

    def test_default_values(self) -> None:
        """Default session behavior should be set."""
        config = SessionBehaviorConfig()
        assert config.auto_start_claude is True
        assert config.auto_save is True
        assert config.save_interval == 300


class TestFileTreeBehaviorConfig:
    """Tests for FileTreeBehaviorConfig dataclass."""

    def test_default_values(self) -> None:
        """Default file tree behavior should be set."""
        config = FileTreeBehaviorConfig()
        assert config.show_hidden is False
        assert config.default_expand_depth == 1


class TestLayoutBehaviorConfig:
    """Tests for LayoutBehaviorConfig dataclass."""

    def test_default_values(self) -> None:
        """Default layout proportions should sum to 1.0."""
        config = LayoutBehaviorConfig()
        assert config.file_tree == 0.20
        assert config.terminal == 0.50
        assert config.viewer == 0.30
        assert config.file_tree + config.terminal + config.viewer == 1.0


class TestBehaviorConfig:
    """Tests for BehaviorConfig dataclass."""

    def test_default_nested_configs(self) -> None:
        """Default behavior should have nested configs."""
        config = BehaviorConfig()
        assert isinstance(config.session, SessionBehaviorConfig)
        assert isinstance(config.file_tree, FileTreeBehaviorConfig)
        assert isinstance(config.layout, LayoutBehaviorConfig)


class TestUserConfig:
    """Tests for UserConfig dataclass."""

    def test_default_nested_configs(self) -> None:
        """Default user config should have all nested configs."""
        config = UserConfig()
        assert isinstance(config.appearance, AppearanceConfig)
        assert isinstance(config.keybindings, KeybindingsConfig)
        assert isinstance(config.behavior, BehaviorConfig)

    def test_to_dict_structure(self) -> None:
        """to_dict should return properly structured dictionary."""
        config = UserConfig()
        result = config.to_dict()

        # Check top-level keys
        assert "appearance" in result
        assert "keybindings" in result
        assert "behavior" in result

        # Check nested structure uses camelCase
        assert "bgPrimary" in result["appearance"]["colors"]
        assert "prefixTimeout" in result["keybindings"]["global"]
        assert "autoStartClaude" in result["behavior"]["session"]

    def test_to_dict_includes_create_remote(self) -> None:
        """to_dict must include createRemote in tab keybindings.

        Without this, the frontend receives a config missing createRemote,
        causing matchesBinding(e, undefined) to throw a TypeError.
        """
        config = UserConfig()
        result = config.to_dict()
        tab_bindings = result["keybindings"]["tab"]
        assert "createRemote" in tab_bindings
        assert tab_bindings["createRemote"] == "C"

    def test_to_dict_tab_keys_match_frontend_expectations(self) -> None:
        """All tab keybinding keys the frontend expects must be present."""
        config = UserConfig()
        tab_bindings = config.to_dict()["keybindings"]["tab"]
        expected_keys = {"next", "previous", "create", "createRemote", "close"}
        assert set(tab_bindings.keys()) == expected_keys

    def test_to_dict_values(self) -> None:
        """to_dict should preserve actual values."""
        config = UserConfig()
        result = config.to_dict()

        assert result["appearance"]["colors"]["bgPrimary"] == "#1c1b1a"
        assert result["keybindings"]["global"]["prefix"] == "C-a"
        assert result["behavior"]["session"]["autoStartClaude"] is True

    def test_to_dict_custom_values(self) -> None:
        """to_dict should preserve custom values."""
        custom_colors = ColorsConfig(bg_primary="#000000")
        custom_appearance = AppearanceConfig(colors=custom_colors)
        config = UserConfig(appearance=custom_appearance)
        result = config.to_dict()

        assert result["appearance"]["colors"]["bgPrimary"] == "#000000"


class TestGetDefaultUserConfig:
    """Tests for get_default_user_config function."""

    def test_returns_user_config(self) -> None:
        """Should return a UserConfig instance."""
        config = get_default_user_config()
        assert isinstance(config, UserConfig)

    def test_returns_fresh_instance(self) -> None:
        """Each call should return a new instance."""
        config1 = get_default_user_config()
        config2 = get_default_user_config()
        assert config1 is not config2

    def test_has_default_values(self) -> None:
        """Returned config should have default values."""
        config = get_default_user_config()
        assert config.appearance.colors.bg_primary == "#1c1b1a"
        assert config.keybindings.globals.prefix == "C-a"
        assert config.behavior.session.auto_start_claude is True
