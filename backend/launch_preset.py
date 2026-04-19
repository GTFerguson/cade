"""Project-local launch preset — read .cade/launch.yml on project open.

Allows a project to ship a small YAML file that configures how CADE
behaves when the project is opened. URL query params on the CADE
frontend override any *frontend* value in launch.yml, so launch.yml
is the sensible default and URL params are the one-off override.

Supported top-level keys (all optional):

    enhanced: bool        — toggle enhanced-mode ChatPane on connect
    spawn: string         — shell command to run in the manual terminal
    view: string          — dashboard view id to preselect on open
    hide_tree: bool       — collapse the file tree on startup
    provider: map         — register a project-local chat provider (see below)
    dashboard_file: str   — path to a dashboard config file to load instead
                            of the default .cade/dashboard.yml probe. Useful
                            for projects that ship multiple dashboards and
                            want launch mode to pick which one is active
                            (e.g. a player dashboard separate from a GM
                            dashboard). Relative paths resolve against the
                            project root; absolute paths are used as-is.

The ``provider`` block defines a chat provider that CADE registers on
connect and sets as the default for the session. Supports any provider
type the registry handles; the typical case is a ``subprocess`` provider
that wraps a CLI tool. Example:

.. code-block:: yaml

    provider:
      name: padarax
      type: subprocess
      command:
        - ./scripts/play.sh
        - --command
        - "{message}"
        - --load
        - "{state}"
        - --save
        - "{state}"
      state_file: .cade/padarax-session.json
      cwd: .

Missing file is not an error — returns an empty dict.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

# Keys we surface to the frontend via the launchPreset WebSocket field.
# provider is NOT in this set because it's consumed entirely on the backend
# (registered in the handler's provider registry) and the frontend never
# needs to see the full config.
_FRONTEND_KEYS = frozenset({"enhanced", "spawn", "view", "hide_tree"})


def load_launch_preset(project_dir: Path) -> dict[str, Any]:
    """Read .cade/launch.yml and return the raw parsed dict.

    Silent degradation: a missing file, malformed YAML, or a non-mapping
    top-level all return {}.
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

    return raw


def extract_frontend_preset(raw: dict[str, Any]) -> dict[str, Any]:
    """Filter the raw preset to only the keys the frontend needs.

    Coerces types and drops unknowns. Returns {} if no frontend-visible
    fields are set.
    """
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
    if isinstance(raw.get("hide_tree"), bool):
        preset["hide_tree"] = raw["hide_tree"]
    viewers_raw = raw.get("viewers")
    if isinstance(viewers_raw, list) and viewers_raw:
        viewers = [
            {"pattern": str(v["pattern"]), "viewer": str(v["viewer"])}
            for v in viewers_raw
            if isinstance(v, dict) and "pattern" in v and "viewer" in v
        ]
        if viewers:
            preset["viewers"] = viewers
    return preset


def extract_dashboard_filename(raw: dict[str, Any]) -> str | None:
    """Extract the ``dashboard_file`` top-level key from launch.yml if set.

    Returns the string (unchanged) on a valid non-empty value, else None.
    The dashboard config loader resolves relative paths against the
    project root at load time.
    """
    value = raw.get("dashboard_file")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def extract_auth_config(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Extract the ``auth:`` block from launch.yml.

    Returns ``{"provider": "google", "client_id": "..."}`` if the project
    declares Google auth, else ``None``. Any other provider name is rejected
    with a warning — the only supported value today is ``"google"``.

    The caller is responsible for enforcement (rejecting connections when
    auth is required but no valid token is present).
    """
    auth_raw = raw.get("auth")
    if auth_raw is None:
        return None
    if not isinstance(auth_raw, dict):
        logger.warning("launch.yml: 'auth' must be a mapping — ignoring")
        return None

    provider = auth_raw.get("provider")
    if provider != "google":
        logger.warning(
            "launch.yml: unsupported auth.provider %r (only 'google' today) — ignoring", provider,
        )
        return None

    client_id = auth_raw.get("client_id")
    if not isinstance(client_id, str) or not client_id.strip():
        logger.warning("launch.yml: auth.client_id is required when auth.provider is set")
        return None

    return {"provider": "google", "client_id": client_id.strip()}


def extract_provider_config(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Extract and validate the ``provider:`` block from a parsed launch.yml.

    Returns a dict with keys suitable for constructing a ``ProviderConfig``
    (``name``, ``type``, ``model``, ``region``, ``api_key``, ``extra``),
    or ``None`` if the block is missing or malformed.
    """
    provider_raw = raw.get("provider")
    if provider_raw is None:
        return None
    if not isinstance(provider_raw, dict):
        logger.warning("launch.yml: 'provider' must be a mapping — ignoring")
        return None

    name = provider_raw.get("name")
    ptype = provider_raw.get("type")
    if not isinstance(name, str) or not name.strip():
        logger.warning("launch.yml: 'provider.name' is required and must be a non-empty string")
        return None
    if not isinstance(ptype, str) or not ptype.strip():
        logger.warning("launch.yml: 'provider.type' is required and must be a non-empty string")
        return None

    # Split into known ProviderConfig fields vs extra kwargs.
    known_top_keys = {"name", "type", "model", "region", "api_key"}
    result = {
        "name": name.strip(),
        "type": ptype.strip(),
        "model": str(provider_raw.get("model", "")),
        "region": str(provider_raw.get("region", "")),
        "api_key": str(provider_raw.get("api_key", "")),
    }
    extra = {k: v for k, v in provider_raw.items() if k not in known_top_keys}
    result["extra"] = extra
    return result
