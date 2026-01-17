"""Configuration management for ccplus backend."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Application configuration loaded from environment variables."""

    port: int = 3000
    host: str = "localhost"
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
            CCPLUS_PORT: Server port (default: 3000)
            CCPLUS_HOST: Server host (default: localhost)
            CCPLUS_WORKING_DIR: Working directory (default: cwd)
            CCPLUS_SHELL_COMMAND: Shell command to run (default: wsl)
            CCPLUS_AUTO_START_CLAUDE: Auto-run claude on shell start (default: true)
            CCPLUS_AUTO_OPEN_BROWSER: Open browser on start (default: true)
            CCPLUS_DEBUG: Enable debug mode (default: false)
            CCPLUS_DUMMY_MODE: Show fake Claude UI for development (default: false)
        """
        return cls(
            port=int(os.getenv("CCPLUS_PORT", "3000")),
            host=os.getenv("CCPLUS_HOST", "localhost"),
            working_dir=Path(os.getenv("CCPLUS_WORKING_DIR", str(Path.cwd()))),
            shell_command=os.getenv("CCPLUS_SHELL_COMMAND", "wsl"),
            auto_start_claude=os.getenv("CCPLUS_AUTO_START_CLAUDE", "true").lower() == "true",
            auto_open_browser=os.getenv("CCPLUS_AUTO_OPEN_BROWSER", "true").lower() == "true",
            debug=os.getenv("CCPLUS_DEBUG", "false").lower() == "true",
            dummy_mode=os.getenv("CCPLUS_DUMMY_MODE", "false").lower() == "true",
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
