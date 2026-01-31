"""WSL integration: health checks, path translation, and command building."""

from backend.wsl.commands import build_wsl_command, resolve_command, windows_to_wsl_path
from backend.wsl.health import (
    check_wsl_health,
    check_wsl_network,
    ensure_wsl_ready,
    is_wsl_error,
    restart_wsl,
    wait_for_wsl_network,
)
from backend.wsl.paths import (
    get_default_wsl_distro,
    get_wsl_home_as_windows_path,
    is_wsl_path,
    wsl_mount_to_windows_path,
    wsl_to_windows_path,
)
from backend.wsl.session_unifier import unify_sessions

__all__ = [
    "build_wsl_command",
    "check_wsl_health",
    "check_wsl_network",
    "ensure_wsl_ready",
    "get_default_wsl_distro",
    "get_wsl_home_as_windows_path",
    "is_wsl_error",
    "is_wsl_path",
    "resolve_command",
    "restart_wsl",
    "unify_sessions",
    "wait_for_wsl_network",
    "windows_to_wsl_path",
    "wsl_mount_to_windows_path",
    "wsl_to_windows_path",
]
