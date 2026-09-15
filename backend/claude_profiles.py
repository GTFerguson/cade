"""Claude Code account profiles: which Claude config directory a project uses.

Claude Code keeps its login, session history and plan files inside its config
directory (``~/.claude`` unless ``CLAUDE_CONFIG_DIR`` says otherwise). Pointing
some projects at a second directory is how one machine runs two accounts — an
employer's enterprise login for work repos and a personal one everywhere else.

Profiles are declared in ``claude.toml`` in the CADE user config directory::

    [[profile]]
    name = "work"
    config-dir = "~/.claude-work"
    paths = ["~/projects/client"]

A project under one of a profile's paths has its terminal started with
``CLAUDE_CONFIG_DIR`` set to that profile's directory, and CADE looks there for
that project's sessions and plans. Doing this in CADE rather than the user's
shell matters because CADE starts the agent with ``command claude``, which
bypasses shell functions, and a login shell's PATH ordering is not CADE's to
rely on.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

logger = logging.getLogger(__name__)

PROFILES_FILENAME = "claude.toml"


@dataclass(frozen=True)
class ClaudeProfile:
    name: str
    config_dir: Path
    paths: tuple[Path, ...]


def _profiles_file() -> Path | None:
    from backend.config import get_user_config_paths

    config_paths = get_user_config_paths()
    if not config_paths:
        return None
    return config_paths[0] / PROFILES_FILENAME


def _expand(path: str) -> Path:
    return Path(path).expanduser()


def load_profiles() -> list[ClaudeProfile]:
    """Read profiles from claude.toml. Invalid entries are skipped with a warning.

    Read on every call rather than cached: the file is tiny, and a profile added
    while CADE is running should apply to the next tab without a restart.
    """
    path = _profiles_file()
    if path is None or not path.exists():
        return []
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except Exception as e:  # noqa: BLE001 — a bad file must not stop tabs opening
        logger.warning("Failed to load %s: %s (no Claude profiles applied)", path, e)
        return []

    entries = data.get("profile", [])
    if not isinstance(entries, list):
        logger.warning("Ignoring %s: 'profile' must be an array of tables", path)
        return []

    profiles: list[ClaudeProfile] = []
    for index, entry in enumerate(entries, start=1):
        config_dir = entry.get("config-dir") if isinstance(entry, dict) else None
        paths = entry.get("paths") if isinstance(entry, dict) else None
        if (
            not isinstance(config_dir, str)
            or not config_dir
            or not isinstance(paths, list)
            or not all(isinstance(p, str) and p for p in paths)
        ):
            logger.warning(
                "Ignoring profile %d in %s: needs 'config-dir' and a list of 'paths'",
                index,
                path,
            )
            continue
        profiles.append(
            ClaudeProfile(
                name=str(entry.get("name") or f"profile-{index}"),
                config_dir=_expand(config_dir),
                paths=tuple(_expand(p) for p in paths),
            )
        )
    return profiles


def default_claude_dir() -> Path:
    """The directory Claude Code uses when no profile applies to a project."""
    env_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    if env_dir:
        return _expand(env_dir)

    if sys.platform == "win32":
        # On Windows, Claude Code likely runs in WSL, whose home is a UNC path
        from backend.wsl.paths import get_wsl_home_as_windows_path

        wsl_home = get_wsl_home_as_windows_path()
        if wsl_home:
            return Path(wsl_home) / ".claude"

    return Path.home() / ".claude"


def profile_for(project_path: Path | str) -> ClaudeProfile | None:
    """The profile whose paths contain the project, or None.

    The most specific path wins, so a profile for ``~/work/client`` can sit
    inside one for ``~/work``.
    """
    project = _expand(str(project_path))
    best: ClaudeProfile | None = None
    best_depth = -1
    for profile in load_profiles():
        for root in profile.paths:
            if project.is_relative_to(root) and len(root.parts) > best_depth:
                best, best_depth = profile, len(root.parts)
    return best


def claude_dir_for(project_path: Path | str) -> Path:
    profile = profile_for(project_path)
    return profile.config_dir if profile is not None else default_claude_dir()


def profile_dirs() -> list[Path]:
    """Config directories declared by profiles, without duplicates."""
    seen: list[Path] = []
    for profile in load_profiles():
        if profile.config_dir not in seen:
            seen.append(profile.config_dir)
    return seen


def terminal_env(project_path: Path | str) -> dict[str, str]:
    """Environment a project's terminal needs so Claude Code uses its profile.

    Empty when no profile applies, leaving Claude Code on whatever directory the
    shell would give it anyway.
    """
    profile = profile_for(project_path)
    if profile is None:
        return {}
    return {"CLAUDE_CONFIG_DIR": str(profile.config_dir)}


def is_plan_file(path: Path | str) -> bool:
    """True for a plan file Claude Code wrote into any known config directory."""
    normalized = str(path).replace("\\", "/")
    # The default location, matched textually so WSL UNC spellings still count
    if "/.claude/plans/" in normalized:
        return True
    parent = Path(path).parent
    return any(parent == config_dir / "plans" for config_dir in profile_dirs())
