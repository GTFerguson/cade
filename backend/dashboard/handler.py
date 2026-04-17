"""Dashboard WebSocket message handler.

Manages config loading, data fetching, and interaction handling for
a single project connection.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from watchfiles import Change, awatch

from backend.dashboard.adapters import AdapterError, fetch_all_sources, get_adapter
from backend.dashboard.config import (
    CONFIG_FILENAMES,
    DashboardConfig,
    DashboardConfigError,
    config_to_dict,
    load_dashboard_config,
)
from backend.models import FileChangeEvent
from backend.protocol import MessageType

logger = logging.getLogger(__name__)

SendFn = Callable[[dict[str, Any]], Awaitable[None]]


class DashboardHandler:
    """Handles dashboard operations for a single WebSocket connection."""

    def __init__(
        self,
        working_dir: Path,
        send: SendFn,
        config_filename: str | None = None,
    ) -> None:
        self._working_dir = working_dir
        self._send = send
        # If set, overrides the default .cade/dashboard.yml probe with
        # a specific filename (useful for project-local launch presets
        # that want to select between multiple dashboard configs —
        # e.g. a player-mode dashboard alongside a GM-mode one).
        self._config_filename = config_filename
        self._config: DashboardConfig | None = None
        self._watch_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    @property
    def has_config(self) -> bool:
        return self._config is not None

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    async def load_and_send_config(self) -> None:
        """Load dashboard config from disk and push to client."""
        try:
            self._config = load_dashboard_config(
                self._working_dir,
                filename=self._config_filename,
            )
        except DashboardConfigError as e:
            logger.warning("Dashboard config error: %s", e)
            await self._send({
                "type": MessageType.ERROR,
                "code": "dashboard-config-error",
                "message": str(e),
            })
            return

        if self._config is None:
            return

        await self._send({
            "type": MessageType.DASHBOARD_CONFIG,
            "config": config_to_dict(self._config),
        })
        logger.info("Dashboard config loaded: %s", self._config.dashboard.title)

    async def load_and_send_data(self) -> None:
        """Fetch all data sources and push to client."""
        if self._config is None:
            return

        sources = await fetch_all_sources(self._config, self._working_dir)
        await self._send({
            "type": MessageType.DASHBOARD_DATA,
            "sources": sources,
        })

    async def send_cleared(self) -> None:
        """Notify client that dashboard config was removed."""
        self._config = None
        await self._send({"type": MessageType.DASHBOARD_CLEARED})

    # ------------------------------------------------------------------
    # Interactions (Tier 1)
    # ------------------------------------------------------------------

    async def handle_action(self, data: dict[str, Any]) -> None:
        """Handle a user interaction from the dashboard.

        Tier 1 actions are direct mutations — the handler applies them
        and pushes updated data back to the client.
        """
        if self._config is None:
            return

        action_type = data.get("action")
        source_name = data.get("source")
        entity_id = data.get("entityId")
        patch = data.get("patch", {})

        if not source_name or source_name not in self._config.data_sources:
            logger.warning("Dashboard action: unknown source '%s'", source_name)
            return

        src = self._config.data_sources[source_name]

        if action_type == "patch":
            await self._apply_patch(src, entity_id, patch)
        else:
            logger.warning("Dashboard action: unknown action type '%s'", action_type)
            return

        # Re-fetch the affected source and push updated data
        try:
            adapter = get_adapter(src.type)
            updated = await adapter.fetch(src, self._working_dir)
        except AdapterError as e:
            logger.warning("Dashboard data refresh failed: %s", e)
            return

        await self._send({
            "type": MessageType.DASHBOARD_DATA,
            "sources": {source_name: updated},
        })

    async def _apply_patch(
        self, src: DataSourceConfig, entity_id: str | None, patch: dict[str, Any]
    ) -> None:
        """Apply a patch mutation to a data source."""
        if src.type == "rest" and src.endpoint:
            import httpx
            url = f"{src.endpoint}/{entity_id}" if entity_id else src.endpoint
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.patch(url, json=patch, headers=src.headers)
                resp.raise_for_status()

        elif src.type in ("directory", "markdown"):
            await self._patch_file_source(src, entity_id, patch)

        elif src.type == "json_file" and src.path:
            await self._patch_json_file(src, entity_id, patch)

    async def _patch_file_source(
        self, src: DataSourceConfig, entity_id: str | None, patch: dict[str, Any]
    ) -> None:
        """Patch a file-based source by updating YAML frontmatter."""
        if not src.path or not entity_id:
            return

        import yaml

        dir_path = self._working_dir / src.path

        # Find the file matching entity_id
        target: Path | None = None
        for f in dir_path.iterdir():
            if f.stem == entity_id and f.suffix in (".md", ".yml", ".yaml"):
                target = f
                break

        if target is None:
            logger.warning("Patch: file not found for entity '%s' in %s", entity_id, dir_path)
            return

        def _update():
            text = target.read_text(encoding="utf-8")
            if not text.startswith("---"):
                return
            end = text.find("\n---", 3)
            if end == -1:
                return
            fm_text = text[3:end].strip()
            fm = yaml.safe_load(fm_text)
            if not isinstance(fm, dict):
                return
            fm.update(patch)
            new_fm = yaml.dump(fm, default_flow_style=False).strip()
            new_text = f"---\n{new_fm}\n---{text[end + 4:]}"
            target.write_text(new_text, encoding="utf-8")

        await asyncio.to_thread(_update)

    async def _patch_json_file(
        self, src: DataSourceConfig, entity_id: str | None, patch: dict[str, Any]
    ) -> None:
        """Patch a JSON file source by updating a matching entity."""
        if not src.path:
            return

        import json
        file_path = self._working_dir / src.path
        id_field = src.entity.id_field if src.entity else "id"

        def _update():
            text = file_path.read_text(encoding="utf-8")
            data = json.loads(text)
            if not isinstance(data, list):
                return
            for item in data:
                if isinstance(item, dict) and str(item.get(id_field)) == str(entity_id):
                    item.update(patch)
                    break
            file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

        await asyncio.to_thread(_update)

    # ------------------------------------------------------------------
    # File watching for .cade/ directory
    # ------------------------------------------------------------------

    def start_watching(self) -> None:
        """Start watching .cade/ for config changes."""
        self._watch_task = asyncio.create_task(self._config_watch_loop())

    async def _config_watch_loop(self) -> None:
        """Watch .cade/ directory for dashboard config changes."""
        cade_dir = self._working_dir / ".cade"
        if not cade_dir.is_dir():
            return

        # Watch the default config filenames AND any filename explicitly
        # overridden via the launch preset. Both trigger a reload.
        config_names = set(CONFIG_FILENAMES)
        if self._config_filename:
            config_names.add(Path(self._config_filename).name)

        try:
            async for changes in awatch(
                cade_dir,
                stop_event=self._stop_event,
                ignore_permission_denied=True,
            ):
                for change_type, path_str in changes:
                    filename = Path(path_str).name
                    if filename not in config_names:
                        continue

                    if change_type == Change.deleted:
                        logger.info("Dashboard config deleted")
                        await self.send_cleared()
                    else:
                        logger.info("Dashboard config changed, reloading")
                        await self.load_and_send_config()
                        await self.load_and_send_data()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("Dashboard config watcher error: %s", e)

    def on_data_source_file_change(self, event: FileChangeEvent) -> None:
        """Called by the main file watcher when a project file changes.

        Checks if the changed file is referenced by any data source and
        triggers a data refresh if so.
        """
        if self._config is None:
            return

        path = event.path
        for src in self._config.data_sources.values():
            if src.path and path.startswith(src.path.rstrip("/")):
                asyncio.create_task(self._refresh_source(src.name))
                return

    async def _refresh_source(self, source_name: str) -> None:
        """Re-fetch a single data source and push to client."""
        if self._config is None or source_name not in self._config.data_sources:
            return

        src = self._config.data_sources[source_name]
        try:
            adapter = get_adapter(src.type)
            data = await adapter.fetch(src, self._working_dir)
        except AdapterError as e:
            logger.warning("Dashboard source refresh failed: %s", e)
            return

        await self._send({
            "type": MessageType.DASHBOARD_DATA,
            "sources": {source_name: data},
        })

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Stop watching and clean up."""
        self._stop_event.set()
        if self._watch_task is not None:
            self._watch_task.cancel()
