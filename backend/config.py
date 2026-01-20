"""Configuration management for CADE backend."""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

from backend.user_config import (
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
    SplashBehaviorConfig,
    TabKeybindingsConfig,
    TerminalAppearanceConfig,
    UserConfig,
)

logger = logging.getLogger(__name__)


@dataclass
class Config:
    """Application configuration loaded from environment variables."""

    port: int = 3000
    host: str = "0.0.0.0"  # Listen on all interfaces for WSL connectivity
    working_dir: Path = field(default_factory=Path.cwd)
    shell_command: str = "wsl"
    auto_start_claude: bool = True
    auto_open_browser: bool = True
    debug: bool = False
    dummy_mode: bool = False

    @classmethod
    def from_env(cls) -> Config:
        """Load configuration from environment variables.

        Environment variables:
            CADE_PORT: Server port (default: 3000)
            CADE_HOST: Server host (default: 0.0.0.0 for WSL connectivity)
            CADE_WORKING_DIR: Working directory (default: cwd)
            CADE_SHELL_COMMAND: Shell command to run (default: wsl)
            CADE_AUTO_START_CLAUDE: Auto-run claude on shell start (default: true)
            CADE_AUTO_OPEN_BROWSER: Open browser on start (default: true)
            CADE_DEBUG: Enable debug mode (default: false)
            CADE_DUMMY_MODE: Show fake Claude UI for development (default: false)
        """
        return cls(
            port=int(os.getenv("CADE_PORT", "3000")),
            host=os.getenv("CADE_HOST", "0.0.0.0"),
            working_dir=Path(os.getenv("CADE_WORKING_DIR", str(Path.cwd()))),
            shell_command=os.getenv("CADE_SHELL_COMMAND", "wsl"),
            auto_start_claude=os.getenv("CADE_AUTO_START_CLAUDE", "true").lower() == "true",
            auto_open_browser=os.getenv("CADE_AUTO_OPEN_BROWSER", "true").lower() == "true",
            debug=os.getenv("CADE_DEBUG", "false").lower() == "true",
            dummy_mode=os.getenv("CADE_DUMMY_MODE", "false").lower() == "true",
        )

    def update_from_args(
        self,
        port: int | None = None,
        host: str | None = None,
        working_dir: str | None = None,
        shell_command: str | None = None,
        auto_start_claude: bool | None = None,
        auto_open_browser: bool | None = None,
        debug: bool | None = None,
        dummy_mode: bool | None = None,
    ) -> Config:
        """Return a new config with CLI argument overrides applied."""
        return Config(
            port=port if port is not None else self.port,
            host=host if host is not None else self.host,
            working_dir=Path(working_dir) if working_dir is not None else self.working_dir,
            shell_command=shell_command if shell_command is not None else self.shell_command,
            auto_start_claude=(
                auto_start_claude if auto_start_claude is not None else self.auto_start_claude
            ),
            auto_open_browser=(
                auto_open_browser if auto_open_browser is not None else self.auto_open_browser
            ),
            debug=debug if debug is not None else self.debug,
            dummy_mode=dummy_mode if dummy_mode is not None else self.dummy_mode,
        )

    @property
    def server_url(self) -> str:
        """Return the full server URL."""
        return f"http://{self.host}:{self.port}"


# Global config instance, initialized at startup
config: Config | None = None


def get_config() -> Config:
    """Get the current configuration, initializing from env if needed."""
    global config
    if config is None:
        config = Config.from_env()
    return config


def set_config(new_config: Config) -> None:
    """Set the global configuration."""
    global config
    config = new_config


# User configuration management
user_config: UserConfig | None = None


def get_user_config_paths() -> list[Path]:
    """Get the paths to search for user configuration files.

    Returns paths in load order (later overrides earlier):
    1. User config directory (~/.config/cade/ on Linux/macOS, %APPDATA%/cade/ on Windows)
    2. Project-local config (.cade/ in working directory)
    """
    paths = []

    # User config directory
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            paths.append(Path(appdata) / "cade")
    else:
        # XDG_CONFIG_HOME or default to ~/.config
        xdg_config = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        paths.append(Path(xdg_config) / "cade")

    return paths


def get_project_config_path(working_dir: Path) -> Path:
    """Get the project-local config path."""
    return working_dir / ".cade"


def _load_toml_file(path: Path) -> dict[str, Any]:
    """Load a TOML file, returning empty dict if not found or invalid."""
    if not path.exists():
        return {}
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except Exception as e:
        logger.warning("Failed to load config file %s: %s (using defaults)", path, e)
        return {}


def _merge_dict(base: dict, override: dict) -> dict:
    """Deep merge two dictionaries, override takes precedence."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_dict(result[key], value)
        else:
            result[key] = value
    return result


def _apply_colors_config(data: dict) -> ColorsConfig:
    """Create ColorsConfig from TOML data."""
    config = ColorsConfig()
    mapping = {
        "bg-primary": "bg_primary",
        "bg-secondary": "bg_secondary",
        "bg-tertiary": "bg_tertiary",
        "bg-hover": "bg_hover",
        "bg-selected": "bg_selected",
        "text-primary": "text_primary",
        "text-secondary": "text_secondary",
        "text-muted": "text_muted",
        "accent-blue": "accent_blue",
        "accent-green": "accent_green",
        "accent-orange": "accent_orange",
        "accent-yellow": "accent_yellow",
        "accent-purple": "accent_purple",
        "accent-red": "accent_red",
        "accent-cyan": "accent_cyan",
        "border-color": "border_color",
        "border-focus": "border_focus",
        "scrollbar-bg": "scrollbar_bg",
        "scrollbar-thumb": "scrollbar_thumb",
        "scrollbar-thumb-hover": "scrollbar_thumb_hover",
    }
    for toml_key, attr_name in mapping.items():
        if toml_key in data:
            setattr(config, attr_name, data[toml_key])
    return config


def _apply_fonts_config(data: dict) -> FontsConfig:
    """Create FontsConfig from TOML data."""
    config = FontsConfig()
    if "mono" in data:
        config.mono = data["mono"]
    if "mono-size" in data:
        config.mono_size = data["mono-size"]
    if "sans" in data:
        config.sans = data["sans"]
    return config


def _apply_terminal_appearance_config(data: dict) -> TerminalAppearanceConfig:
    """Create TerminalAppearanceConfig from TOML data."""
    config = TerminalAppearanceConfig()
    if "font-size" in data:
        config.font_size = data["font-size"]
    if "scrollback" in data:
        config.scrollback = data["scrollback"]
    return config


def _load_appearance_config(paths: list[Path]) -> AppearanceConfig:
    """Load appearance config from multiple paths, merging them."""
    merged: dict[str, Any] = {}
    for base_path in paths:
        file_path = base_path / "appearance.toml"
        data = _load_toml_file(file_path)
        if data:
            merged = _merge_dict(merged, data)

    config = AppearanceConfig()
    if "colors" in merged:
        config.colors = _apply_colors_config(merged["colors"])
    if "fonts" in merged:
        config.fonts = _apply_fonts_config(merged["fonts"])
    if "terminal" in merged:
        config.terminal = _apply_terminal_appearance_config(merged["terminal"])

    return config


def _apply_global_keybindings_config(data: dict) -> GlobalKeybindingsConfig:
    """Create GlobalKeybindingsConfig from TOML data."""
    config = GlobalKeybindingsConfig()
    if "prefix" in data:
        config.prefix = data["prefix"]
    if "prefix-timeout" in data:
        config.prefix_timeout = data["prefix-timeout"]
    return config


def _apply_pane_keybindings_config(data: dict) -> PaneKeybindingsConfig:
    """Create PaneKeybindingsConfig from TOML data."""
    config = PaneKeybindingsConfig()
    mapping = {
        "focus-left": "focus_left",
        "focus-right": "focus_right",
        "resize-left": "resize_left",
        "resize-right": "resize_right",
    }
    for toml_key, attr_name in mapping.items():
        if toml_key in data:
            setattr(config, attr_name, data[toml_key])
    return config


def _apply_tab_keybindings_config(data: dict) -> TabKeybindingsConfig:
    """Create TabKeybindingsConfig from TOML data."""
    config = TabKeybindingsConfig()
    for key in ["next", "previous", "create", "close"]:
        if key in data:
            setattr(config, key, data[key])
    return config


def _apply_misc_keybindings_config(data: dict) -> MiscKeybindingsConfig:
    """Create MiscKeybindingsConfig from TOML data."""
    config = MiscKeybindingsConfig()
    if "help" in data:
        config.help = data["help"]
    if "toggle-terminal" in data:
        config.toggle_terminal = data["toggle-terminal"]
    return config


def _load_keybindings_config(paths: list[Path]) -> KeybindingsConfig:
    """Load keybindings config from multiple paths, merging them."""
    merged: dict[str, Any] = {}
    for base_path in paths:
        file_path = base_path / "keybindings.toml"
        data = _load_toml_file(file_path)
        if data:
            merged = _merge_dict(merged, data)

    config = KeybindingsConfig()
    if "global" in merged:
        config.globals = _apply_global_keybindings_config(merged["global"])
    if "pane" in merged:
        config.pane = _apply_pane_keybindings_config(merged["pane"])
    if "tab" in merged:
        config.tab = _apply_tab_keybindings_config(merged["tab"])
    if "misc" in merged:
        config.misc = _apply_misc_keybindings_config(merged["misc"])

    return config


def _apply_session_behavior_config(data: dict) -> SessionBehaviorConfig:
    """Create SessionBehaviorConfig from TOML data."""
    config = SessionBehaviorConfig()
    if "auto-start-claude" in data:
        config.auto_start_claude = data["auto-start-claude"]
    if "auto-save" in data:
        config.auto_save = data["auto-save"]
    if "save-interval" in data:
        config.save_interval = data["save-interval"]
    return config


def _apply_file_tree_behavior_config(data: dict) -> FileTreeBehaviorConfig:
    """Create FileTreeBehaviorConfig from TOML data."""
    config = FileTreeBehaviorConfig()
    if "show-hidden" in data:
        config.show_hidden = data["show-hidden"]
    if "show-ignored" in data:
        config.show_ignored = data["show-ignored"]
    if "default-expand-depth" in data:
        config.default_expand_depth = data["default-expand-depth"]
    return config


def _apply_layout_behavior_config(data: dict) -> LayoutBehaviorConfig:
    """Create LayoutBehaviorConfig from TOML data."""
    config = LayoutBehaviorConfig()
    if "default-file-tree" in data:
        config.file_tree = data["default-file-tree"]
    if "default-terminal" in data:
        config.terminal = data["default-terminal"]
    if "default-viewer" in data:
        config.viewer = data["default-viewer"]
    return config


def _apply_splash_behavior_config(data: dict) -> SplashBehaviorConfig:
    """Create SplashBehaviorConfig from TOML data."""
    config = SplashBehaviorConfig()
    if "mode" in data:
        config.mode = data["mode"]
    if "idle-threshold" in data:
        config.idle_threshold = data["idle-threshold"]
    if "health-check-timeout" in data:
        config.health_check_timeout = data["health-check-timeout"]
    return config


def _load_behavior_config(paths: list[Path]) -> BehaviorConfig:
    """Load behavior config from multiple paths, merging them."""
    merged: dict[str, Any] = {}
    for base_path in paths:
        file_path = base_path / "behavior.toml"
        data = _load_toml_file(file_path)
        if data:
            merged = _merge_dict(merged, data)

    config = BehaviorConfig()
    if "session" in merged:
        config.session = _apply_session_behavior_config(merged["session"])
    if "file-tree" in merged:
        config.file_tree = _apply_file_tree_behavior_config(merged["file-tree"])
    if "layout" in merged:
        config.layout = _apply_layout_behavior_config(merged["layout"])
    if "splash" in merged:
        config.splash = _apply_splash_behavior_config(merged["splash"])

    return config


def load_user_config(working_dir: Path | None = None) -> UserConfig:
    """Load user configuration from TOML files.

    Load order (later overrides earlier):
    1. Hardcoded defaults
    2. User config (~/.config/cade/)
    3. Project config (.cade/ in working directory)
    4. Environment variables (CADE_*)

    Args:
        working_dir: Working directory for project-local config. If None, only loads user config.

    Returns:
        Merged UserConfig with all settings applied.
    """
    paths = get_user_config_paths()

    # Add project-local config path if working directory is specified
    if working_dir is not None:
        project_path = get_project_config_path(working_dir)
        if project_path.exists():
            paths.append(project_path)

    # Load each config section
    appearance = _load_appearance_config(paths)
    keybindings = _load_keybindings_config(paths)
    behavior = _load_behavior_config(paths)

    # Apply environment variable overrides
    if os.getenv("CADE_AUTO_START_CLAUDE") is not None:
        behavior.session.auto_start_claude = (
            os.getenv("CADE_AUTO_START_CLAUDE", "true").lower() == "true"
        )

    return UserConfig(
        appearance=appearance,
        keybindings=keybindings,
        behavior=behavior,
    )


def get_user_config(working_dir: Path | None = None) -> UserConfig:
    """Get the current user configuration, loading if needed."""
    global user_config
    if user_config is None:
        user_config = load_user_config(working_dir)
    return user_config


def set_user_config(new_config: UserConfig) -> None:
    """Set the global user configuration."""
    global user_config
    user_config = new_config


def reload_user_config(working_dir: Path | None = None) -> UserConfig:
    """Force reload of user configuration from files."""
    global user_config
    user_config = load_user_config(working_dir)
    return user_config
