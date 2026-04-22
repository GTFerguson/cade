"""Dashboard WebSocket message handler.

Manages config loading, data fetching, and interaction handling for
a single project connection.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from watchfiles import Change, awatch

from core.backend.dashboard.adapters import AdapterError, fetch_all_sources, get_adapter
from core.backend.dashboard.config import (
    CONFIG_FILENAMES,
    DashboardConfig,
    DashboardConfigError,
    WatchConfig,
    config_to_dict,
    load_dashboard_config,
)
from core.backend.models import FileChangeEvent
from backend.protocol import MessageType
from core.backend.providers.base import BaseProvider

logger = logging.getLogger(__name__)

SendFn = Callable[[dict[str, Any]], Awaitable[None]]


class DashboardHandler:
    """Handles dashboard operations for a single WebSocket connection."""

    def __init__(
        self,
        working_dir: Path,
        send: SendFn,
        config_filename: str | None = None,
        provider: BaseProvider | None = None,
    ) -> None:
        self._working_dir = working_dir
        self._send = send
        # If set, overrides the default .cade/dashboard.yml probe with
        # a specific filename (useful for project-local launch presets
        # that want to select between multiple dashboard configs —
        # e.g. a player-mode dashboard alongside a GM-mode one).
        self._config_filename = config_filename
        # Optional — required only for panels that emit `provider_message`
        # actions (interactive dashboards that dispatch frames through
        # the provider's persistent engine channel).
        self._provider = provider
        self._config: DashboardConfig | None = None
        self._watch_task: asyncio.Task | None = None
        self._poll_tasks: list[asyncio.Task] = []
        self._stop_event = asyncio.Event()
        # Debounce: track last script run time per watch name to avoid
        # thrashing when a tool writes many files at once.
        self._watch_last_run: dict[str, float] = {}
        self._WATCH_DEBOUNCE_S = 2.0

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

        Two action types today:
        - `patch`: direct mutation of a data source (REST / markdown / directory).
          Handler applies the patch and pushes a refreshed snapshot.
        - `provider_message`: forward a freeform frame through the active
          provider's engine channel (e.g. trade commit, macro trigger).
          Fire-and-forget — server-side effects drive dashboard refresh
          through the normal file-watch loop.
        """
        if self._config is None:
            return

        action_type = data.get("action")

        if action_type == "patch":
            await self._handle_patch_action(data)
        elif action_type == "provider_message":
            await self._handle_provider_message(data)
        else:
            logger.warning("Dashboard action: unknown action type '%s'", action_type)

    async def _handle_patch_action(self, data: dict[str, Any]) -> None:
        """Apply a direct mutation to a data source and refresh it."""
        assert self._config is not None
        source_name = data.get("source")
        entity_id = data.get("entityId")
        patch = data.get("patch", {})

        if not source_name or source_name not in self._config.data_sources:
            logger.warning("Dashboard patch action: unknown source '%s'", source_name)
            return

        src = self._config.data_sources[source_name]
        await self._apply_patch(src, entity_id, patch)

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

    async def _handle_provider_message(self, data: dict[str, Any]) -> None:
        """Forward a freeform frame through the active provider to the engine.

        The panel is responsible for assembling the frame shape from its
        config (e.g. barter → `{type: "trade_commit", basket: {...}}`).
        The handler does not validate the shape — the engine is the arbiter.
        """
        if self._provider is None:
            logger.warning(
                "Dashboard provider_message action requires an active provider; "
                "none registered on this connection"
            )
            return

        message = data.get("message")
        if not isinstance(message, dict):
            logger.warning("Dashboard provider_message: `message` must be a dict")
            return

        try:
            await self._provider.send_frame(message)
        except NotImplementedError as e:
            logger.warning("Dashboard provider_message rejected: %s", e)
        except Exception as e:  # noqa: BLE001
            logger.exception("Dashboard provider_message failed: %s", e)

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
        """Start watching .cade/ for config changes and kick off any polling loops."""
        self._watch_task = asyncio.create_task(self._config_watch_loop())
        self._start_polling()

    async def _config_watch_loop(self) -> None:
        """Watch for dashboard config file creation, changes, and deletion.

        Watches the project root (not just .cade/) so that creating the file
        from scratch — including creating the .cade/ directory itself — is
        detected without needing to reconnect.
        """
        # Watch the default config filenames AND any filename explicitly
        # overridden via the launch preset.
        config_names = set(CONFIG_FILENAMES)
        if self._config_filename:
            config_names.add(Path(self._config_filename).name)

        def _is_config(change: Change, path: str) -> bool:
            p = Path(path)
            return p.name in config_names and p.parent.name == ".cade"

        try:
            async for changes in awatch(
                self._working_dir,
                stop_event=self._stop_event,
                ignore_permission_denied=True,
                watch_filter=_is_config,
            ):
                for change_type, path_str in changes:
                    if change_type == Change.deleted:
                        logger.info("Dashboard config deleted")
                        await self.send_cleared()
                    else:
                        logger.info("Dashboard config changed, reloading")
                        # Cancel old poll tasks before loading the new config
                        # so stale intervals don't linger.
                        for t in self._poll_tasks:
                            t.cancel()
                        self._poll_tasks.clear()
                        await self.load_and_send_config()
                        await self.load_and_send_data()
                        self._start_polling()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("Dashboard config watcher error: %s", e)

    def on_data_source_file_change(self, event: FileChangeEvent) -> None:
        """Called by the main file watcher when a project file changes.

        Checks if the changed file is referenced by any data source and
        triggers a data refresh if so. Also fires any matching watch rules.
        """
        if self._config is None:
            return

        path = event.path
        for src in self._config.data_sources.values():
            if src.path and path.startswith(src.path.rstrip("/")):
                asyncio.create_task(self._refresh_source(src.name))
                return

        for watch in self._config.watches:
            if self._watch_matches(watch, path):
                now = time.monotonic()
                if now - self._watch_last_run.get(watch.name, 0) >= self._WATCH_DEBOUNCE_S:
                    self._watch_last_run[watch.name] = now
                    asyncio.create_task(self._run_watch_script(watch))

    @staticmethod
    def _watch_matches(watch: WatchConfig, path: str) -> bool:
        p = Path(path)
        if not p.match(watch.watch):
            return False
        if watch.exclude and p.match(watch.exclude):
            return False
        return True

    async def _run_watch_script(self, watch: WatchConfig) -> None:
        logger.info("Watch '%s' triggered, running: %s", watch.name, watch.run)
        try:
            proc = await asyncio.create_subprocess_shell(
                watch.run,
                cwd=self._working_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    "Watch '%s' script exited %d: %s",
                    watch.name, proc.returncode,
                    stdout.decode(errors="replace").strip(),
                )
            else:
                logger.info("Watch '%s' completed", watch.name)
        except Exception as e:
            logger.warning("Watch '%s' failed to run: %s", watch.name, e)

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
    # Polling — periodic refresh for REST sources
    # ------------------------------------------------------------------

    def _start_polling(self) -> None:
        """Spawn one background task per source that has refresh_interval > 0."""
        if self._config is None:
            return
        for src in self._config.data_sources.values():
            if src.refresh_interval > 0:
                task = asyncio.create_task(self._poll_source_loop(src.name, src.refresh_interval))
                self._poll_tasks.append(task)

    async def _poll_source_loop(self, source_name: str, interval: int) -> None:
        """Sleep for interval, then refresh the source, forever."""
        try:
            while not self._stop_event.is_set():
                try:
                    await asyncio.wait_for(
                        asyncio.shield(self._stop_event.wait()),
                        timeout=float(interval),
                    )
                    return  # stop_event fired
                except asyncio.TimeoutError:
                    pass  # interval elapsed — time to refresh
                await self._refresh_source(source_name)
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Stop watching and clean up."""
        self._stop_event.set()
        if self._watch_task is not None:
            self._watch_task.cancel()
        for task in self._poll_tasks:
            task.cancel()
        self._poll_tasks.clear()
