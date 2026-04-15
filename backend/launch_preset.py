"""Project-local launch preset — read .cade/launch.yml on project open.

Allows a project to ship a small YAML file that configures how CADE
behaves when the project is opened. URL query params on the CADE
frontend override any value in launch.yml, so launch.yml is the
"sensible default" and URL params are the "one-off override."

Supported keys (all optional):

    enhanced: bool    — toggle enhanced-mode ChatPane on connect
    spawn: string     — shell command to run in the terminal pane after connect
    view: string      — dashboard view id to preselect on open
    hide_tree: bool   — collapse the file tree on startup

Missing file is not an error — returns an empty dict.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_KNOWN_KEYS = frozenset({"enhanced", "spawn", "view", "hide_tree"})


def load_launch_preset(project_dir: Path) -> dict[str, Any]:
    """Read .cade/launch.yml and return known fields as a dict.

    Silent degradation: a missing file, malformed YAML, or a non-mapping
    top-level all return {}. Unknown keys are dropped with a debug log.
    """
    preset_path = project_dir / ".cade" / "launch.yml"
    if not preset_path.exists():
        return {}

    try:
        with preset_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except (yaml.YAMLError, OSError) as e:
        logger.warning("Failed to read %s: %s", preset_path, e)
        return {}

    if not isinstance(raw, dict):
        logger.warning("%s is not a YAML mapping — ignoring", preset_path)
        return {}

    preset: dict[str, Any] = {}
    if raw.get("enhanced") is True:
        preset["enhanced"] = True
    if isinstance(raw.get("spawn"), str):
        value = raw["spawn"].strip()
        if value:
            preset["spawn"] = value
    if isinstance(raw.get("view"), str):
        value = raw["view"].strip()
        if value:
            preset["view"] = value
    if raw.get("hide_tree") is True:
        preset["hide_tree"] = True

    unknown = set(raw.keys()) - _KNOWN_KEYS
    if unknown:
        logger.debug("%s: ignoring unknown keys %s", preset_path, sorted(unknown))

    return preset
