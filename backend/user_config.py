"""User configuration dataclasses and defaults.

Defines the structure for user-configurable settings loaded from TOML files:
- appearance.toml: Colors, fonts, theme
- keybindings.toml: Prefix key, shortcuts
- behavior.toml: Auto-start, file tree defaults, etc.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ColorsConfig:
    """Color theme overrides - maps to CSS variables."""

    bg_primary: str = "#1c1b1a"
    bg_secondary: str = "#242321"
    bg_tertiary: str = "#35322d"
    bg_hover: str = "#45413b"
    bg_selected: str = "#45413b"

    text_primary: str = "#f8f6f2"
    text_secondary: str = "#d9cec3"
    text_muted: str = "#857f78"

    accent_blue: str = "#0a9dff"
    accent_green: str = "#aeee00"
    accent_orange: str = "#ffa724"
    accent_yellow: str = "#fade3e"
    accent_purple: str = "#ff9eb8"
    accent_red: str = "#ff2c4b"
    accent_cyan: str = "#8cffba"

    border_color: str = "#45413b"
    border_focus: str = "#aeee00"

    scrollbar_bg: str = "#1c1b1a"
    scrollbar_thumb: str = "#45413b"
    scrollbar_thumb_hover: str = "#857f78"


@dataclass
class FontsConfig:
    """Font settings."""

    mono: str = "JetBrains Mono"
    mono_size: str = "14px"
    sans: str = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"


@dataclass
class TerminalAppearanceConfig:
    """Terminal-specific appearance settings."""

    font_size: str = "14px"
    scrollback: int = 10000


@dataclass
class AppearanceConfig:
    """Appearance configuration."""

    colors: ColorsConfig = field(default_factory=ColorsConfig)
    fonts: FontsConfig = field(default_factory=FontsConfig)
    terminal: TerminalAppearanceConfig = field(default_factory=TerminalAppearanceConfig)


@dataclass
class GlobalKeybindingsConfig:
    """Global keybinding settings."""

    prefix: str = "C-a"
    prefix_timeout: int = 1500


@dataclass
class PaneKeybindingsConfig:
    """Pane navigation keybindings (used after prefix)."""

    focus_left: str = "h"
    focus_right: str = "l"
    resize_left: str = "C-h"
    resize_right: str = "C-l"


@dataclass
class TabKeybindingsConfig:
    """Tab navigation keybindings (used after prefix)."""

    next: str = "f"
    previous: str = "d"
    create: str = "c"
    close: str = "x"


@dataclass
class MiscKeybindingsConfig:
    """Miscellaneous keybindings (used after prefix)."""

    help: str = "?"
    toggle_terminal: str = "s"
    toggle_viewer: str = "v"


@dataclass
class KeybindingsConfig:
    """Keybindings configuration."""

    globals: GlobalKeybindingsConfig = field(default_factory=GlobalKeybindingsConfig)
    pane: PaneKeybindingsConfig = field(default_factory=PaneKeybindingsConfig)
    tab: TabKeybindingsConfig = field(default_factory=TabKeybindingsConfig)
    misc: MiscKeybindingsConfig = field(default_factory=MiscKeybindingsConfig)


@dataclass
class SessionBehaviorConfig:
    """Session behavior settings."""

    auto_start_claude: bool = True
    auto_save: bool = True
    save_interval: int = 300


@dataclass
class FileTreeBehaviorConfig:
    """File tree behavior settings."""

    show_hidden: bool = False
    show_ignored: bool = True
    default_expand_depth: int = 1


@dataclass
class LayoutBehaviorConfig:
    """Default layout proportions (as fractions)."""

    file_tree: float = 0.20
    terminal: float = 0.50
    viewer: float = 0.30


@dataclass
class SplashBehaviorConfig:
    """Splash screen behavior settings."""

    mode: str = "auto"  # "auto" | "always" | "never"
    idle_threshold: int = 1800  # seconds (30 min default)
    health_check_timeout: int = 3  # seconds


@dataclass
class BehaviorConfig:
    """Behavior configuration."""

    session: SessionBehaviorConfig = field(default_factory=SessionBehaviorConfig)
    file_tree: FileTreeBehaviorConfig = field(default_factory=FileTreeBehaviorConfig)
    layout: LayoutBehaviorConfig = field(default_factory=LayoutBehaviorConfig)
    splash: SplashBehaviorConfig = field(default_factory=SplashBehaviorConfig)


@dataclass
class UserConfig:
    """Complete user configuration."""

    appearance: AppearanceConfig = field(default_factory=AppearanceConfig)
    keybindings: KeybindingsConfig = field(default_factory=KeybindingsConfig)
    behavior: BehaviorConfig = field(default_factory=BehaviorConfig)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "appearance": {
                "colors": {
                    "bgPrimary": self.appearance.colors.bg_primary,
                    "bgSecondary": self.appearance.colors.bg_secondary,
                    "bgTertiary": self.appearance.colors.bg_tertiary,
                    "bgHover": self.appearance.colors.bg_hover,
                    "bgSelected": self.appearance.colors.bg_selected,
                    "textPrimary": self.appearance.colors.text_primary,
                    "textSecondary": self.appearance.colors.text_secondary,
                    "textMuted": self.appearance.colors.text_muted,
                    "accentBlue": self.appearance.colors.accent_blue,
                    "accentGreen": self.appearance.colors.accent_green,
                    "accentOrange": self.appearance.colors.accent_orange,
                    "accentYellow": self.appearance.colors.accent_yellow,
                    "accentPurple": self.appearance.colors.accent_purple,
                    "accentRed": self.appearance.colors.accent_red,
                    "accentCyan": self.appearance.colors.accent_cyan,
                    "borderColor": self.appearance.colors.border_color,
                    "borderFocus": self.appearance.colors.border_focus,
                    "scrollbarBg": self.appearance.colors.scrollbar_bg,
                    "scrollbarThumb": self.appearance.colors.scrollbar_thumb,
                    "scrollbarThumbHover": self.appearance.colors.scrollbar_thumb_hover,
                },
                "fonts": {
                    "mono": self.appearance.fonts.mono,
                    "monoSize": self.appearance.fonts.mono_size,
                    "sans": self.appearance.fonts.sans,
                },
                "terminal": {
                    "fontSize": self.appearance.terminal.font_size,
                    "scrollback": self.appearance.terminal.scrollback,
                },
            },
            "keybindings": {
                "global": {
                    "prefix": self.keybindings.globals.prefix,
                    "prefixTimeout": self.keybindings.globals.prefix_timeout,
                },
                "pane": {
                    "focusLeft": self.keybindings.pane.focus_left,
                    "focusRight": self.keybindings.pane.focus_right,
                    "resizeLeft": self.keybindings.pane.resize_left,
                    "resizeRight": self.keybindings.pane.resize_right,
                },
                "tab": {
                    "next": self.keybindings.tab.next,
                    "previous": self.keybindings.tab.previous,
                    "create": self.keybindings.tab.create,
                    "close": self.keybindings.tab.close,
                },
                "misc": {
                    "help": self.keybindings.misc.help,
                    "toggleTerminal": self.keybindings.misc.toggle_terminal,
                    "toggleViewer": self.keybindings.misc.toggle_viewer,
                },
            },
            "behavior": {
                "session": {
                    "autoStartClaude": self.behavior.session.auto_start_claude,
                    "autoSave": self.behavior.session.auto_save,
                    "saveInterval": self.behavior.session.save_interval,
                },
                "fileTree": {
                    "showHidden": self.behavior.file_tree.show_hidden,
                    "showIgnored": self.behavior.file_tree.show_ignored,
                    "defaultExpandDepth": self.behavior.file_tree.default_expand_depth,
                },
                "layout": {
                    "fileTree": self.behavior.layout.file_tree,
                    "terminal": self.behavior.layout.terminal,
                    "viewer": self.behavior.layout.viewer,
                },
                "splash": {
                    "mode": self.behavior.splash.mode,
                    "idleThreshold": self.behavior.splash.idle_threshold,
                    "healthCheckTimeout": self.behavior.splash.health_check_timeout,
                },
            },
        }


def get_default_user_config() -> UserConfig:
    """Return a UserConfig with all default values."""
    return UserConfig()
