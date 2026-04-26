"""Dashboard config loading and validation.

Reads .cade/dashboard.yml from a project root, validates the structure,
and returns typed dataclasses the handler and frontend can consume.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


# Component types the renderer knows about
KNOWN_COMPONENTS = frozenset({
    "cards",
    "checklist",
    "timeline",
    "kanban",
    "key_value",
    "table",
    "markdown",
    "grouped_cards",
    "feedback_list",
    "post_preview",
})

CONFIG_FILENAMES = ("dashboard.yml", "dashboard.yaml")


class DashboardConfigError(Exception):
    """Raised when a dashboard config is invalid."""


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EntityConfig:
    id_field: str = "id"
    statuses: list[str] = field(default_factory=list)
    transitions: dict[str, list[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class DataSourceConfig:
    name: str
    type: str  # rest, json_file, directory, markdown, vault, model_usage
    endpoint: str | None = None
    path: str | None = None
    parse: str | None = None
    entity: EntityConfig | None = None
    headers: dict[str, str] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)
    # Seconds between automatic re-fetches. Only useful for sources that
    # don't benefit from file watching (e.g. REST endpoints). Omit or set
    # to 0 to disable polling — file-based sources refresh via watchfiles.
    refresh_interval: int = 0


@dataclass(frozen=True)
class StatConfig:
    id: str
    label: str
    source: str
    format: str | None = None


@dataclass(frozen=True)
class PanelConfig:
    component: str
    id: str | None = None
    title: str | None = None
    source: str | dict[str, Any] | None = None
    fields: list[str] = field(default_factory=list)
    columns: list[str | dict[str, Any]] = field(default_factory=list)
    badges: list[str] = field(default_factory=list)
    filter: dict[str, Any] = field(default_factory=dict)
    limit: int | None = None
    layout: str | None = None
    sortable: bool = False
    filterable: list[str] = field(default_factory=list)
    searchable: list[str] = field(default_factory=list)
    inline_edit: list[str] = field(default_factory=list)
    expandable: dict[str, Any] | None = None
    options: dict[str, Any] = field(default_factory=dict)
    detail: dict[str, Any] | None = None
    # Interaction handlers
    on_click: str | dict[str, Any] | None = None
    on_check: dict[str, Any] | None = None
    on_move: dict[str, Any] | None = None
    # Catchall for component-specific config
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ViewConfig:
    id: str
    title: str
    layout: str | None = None
    hidden: bool = False
    group: str | None = None
    panels: list[PanelConfig] = field(default_factory=list)
    sidebar_filters: list[dict[str, Any]] = field(default_factory=list)
    tab_filter: dict[str, Any] | None = None
    detail: dict[str, Any] | None = None
    actions_by_status: dict[str, list[dict[str, Any]]] | None = None


@dataclass(frozen=True)
class DashboardMeta:
    title: str
    subtitle: str | None = None
    theme: str | None = None


@dataclass(frozen=True)
class WatchConfig:
    name: str
    watch: str           # glob pattern relative to project root
    run: str             # shell command to execute
    exclude: str | None = None  # glob pattern for paths to skip


@dataclass(frozen=True)
class ExtraRootConfig:
    name: str
    path: str
    label: str | None = None
    default: bool = False


@dataclass(frozen=True)
class DashboardConfig:
    dashboard: DashboardMeta
    data_sources: dict[str, DataSourceConfig]
    views: list[ViewConfig]
    stats: list[StatConfig] = field(default_factory=list)
    watches: list[WatchConfig] = field(default_factory=list)
    extra_roots: list[ExtraRootConfig] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_entity(raw: dict[str, Any] | None) -> EntityConfig | None:
    if raw is None:
        return None
    return EntityConfig(
        id_field=raw.get("id_field", "id"),
        statuses=raw.get("statuses", []),
        transitions=raw.get("transitions", {}),
    )


_DATA_SOURCE_KNOWN_FIELDS = {"type", "endpoint", "path", "parse", "entity", "headers", "refresh_interval"}


def _parse_data_source(name: str, raw: dict[str, Any]) -> DataSourceConfig:
    src_type = raw.get("type")
    if not src_type:
        raise DashboardConfigError(f"data_sources.{name}: missing 'type'")
    extra = {k: v for k, v in raw.items() if k not in _DATA_SOURCE_KNOWN_FIELDS}
    return DataSourceConfig(
        name=name,
        type=src_type,
        endpoint=raw.get("endpoint"),
        path=raw.get("path"),
        parse=raw.get("parse"),
        entity=_parse_entity(raw.get("entity")),
        headers=raw.get("headers", {}),
        extra=extra,
        refresh_interval=int(raw.get("refresh_interval", 0)),
    )


_PANEL_SIMPLE_FIELDS = {
    "component", "id", "title", "source", "fields", "columns", "badges",
    "filter", "limit", "layout", "sortable", "filterable", "searchable",
    "inline_edit", "expandable", "options", "detail",
    "on_click", "on_check", "on_move",
}


def _parse_panel(raw: dict[str, Any], view_id: str, idx: int) -> PanelConfig:
    component = raw.get("component")
    if not component:
        raise DashboardConfigError(f"views[{view_id}].panels[{idx}]: missing 'component'")

    extra = {k: v for k, v in raw.items() if k not in _PANEL_SIMPLE_FIELDS}
    return PanelConfig(
        component=component,
        id=raw.get("id"),
        title=raw.get("title"),
        source=raw.get("source"),
        fields=raw.get("fields", []),
        columns=raw.get("columns", []),
        badges=raw.get("badges", []),
        filter=raw.get("filter", {}),
        limit=raw.get("limit"),
        layout=raw.get("layout"),
        sortable=raw.get("sortable", False),
        filterable=raw.get("filterable", []),
        searchable=raw.get("searchable", []),
        inline_edit=raw.get("inline_edit", []),
        expandable=raw.get("expandable"),
        options=raw.get("options", {}),
        detail=raw.get("detail"),
        on_click=raw.get("on_click"),
        on_check=raw.get("on_check"),
        on_move=raw.get("on_move"),
        extra=extra,
    )


def _parse_view(raw: dict[str, Any], idx: int) -> ViewConfig:
    view_id = raw.get("id")
    if not view_id:
        raise DashboardConfigError(f"views[{idx}]: missing 'id'")
    title = raw.get("title")
    if not title:
        raise DashboardConfigError(f"views[{idx}]: missing 'title'")

    panels = [
        _parse_panel(p, view_id, i)
        for i, p in enumerate(raw.get("panels", []))
    ]

    return ViewConfig(
        id=view_id,
        title=title,
        layout=raw.get("layout"),
        hidden=bool(raw.get("hidden", False)),
        group=raw.get("group") or None,
        panels=panels,
        sidebar_filters=raw.get("sidebar_filters", []),
        tab_filter=raw.get("tab_filter"),
        detail=raw.get("detail"),
        actions_by_status=raw.get("actions_by_status"),
    )


def _parse_stat(raw: dict[str, Any], idx: int) -> StatConfig:
    stat_id = raw.get("id")
    if not stat_id:
        raise DashboardConfigError(f"stats[{idx}]: missing 'id'")
    label = raw.get("label")
    if not label:
        raise DashboardConfigError(f"stats[{idx}]: missing 'label'")
    source = raw.get("source")
    if not source:
        raise DashboardConfigError(f"stats[{idx}]: missing 'source'")
    return StatConfig(id=stat_id, label=label, source=source, format=raw.get("format"))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_config(raw: dict[str, Any]) -> DashboardConfig:
    """Validate a parsed YAML dict and return a typed DashboardConfig.

    Raises DashboardConfigError with a human-readable message on failure.
    """
    # Dashboard metadata
    dash_raw = raw.get("dashboard")
    if not dash_raw:
        raise DashboardConfigError("missing top-level 'dashboard' key")
    if not isinstance(dash_raw, dict):
        raise DashboardConfigError("'dashboard' must be a mapping")
    title = dash_raw.get("title")
    if not title:
        raise DashboardConfigError("dashboard.title is required")
    dashboard = DashboardMeta(
        title=title,
        subtitle=dash_raw.get("subtitle"),
        theme=dash_raw.get("theme"),
    )

    # Data sources
    sources_raw = raw.get("data_sources", {})
    if not isinstance(sources_raw, dict):
        raise DashboardConfigError("'data_sources' must be a mapping")
    data_sources = {
        name: _parse_data_source(name, cfg)
        for name, cfg in sources_raw.items()
    }

    # Views
    views_raw = raw.get("views", [])
    if not isinstance(views_raw, list):
        raise DashboardConfigError("'views' must be a list")
    if not views_raw:
        raise DashboardConfigError("at least one view is required")
    views = [_parse_view(v, i) for i, v in enumerate(views_raw)]

    # Validate source references in panels.
    # push_sources lists sources sent by the server over WebSocket (no data_sources entry needed).
    push_sources_raw = raw.get("push_sources", [])
    push_sources = set(push_sources_raw) if isinstance(push_sources_raw, list) else set()
    source_names = set(data_sources.keys()) | push_sources
    for view in views:
        for panel in view.panels:
            if isinstance(panel.source, str) and panel.source not in source_names:
                raise DashboardConfigError(
                    f"views[{view.id}].panels[{panel.id or panel.component}]: "
                    f"unknown source '{panel.source}' "
                    f"(available: {', '.join(sorted(source_names)) or 'none'})"
                )

    # Stats (optional)
    stats_raw = raw.get("stats", [])
    stats = [_parse_stat(s, i) for i, s in enumerate(stats_raw)]

    # Watches (optional)
    watches_raw = raw.get("watches", [])
    if not isinstance(watches_raw, list):
        raise DashboardConfigError("'watches' must be a list")
    watches: list[WatchConfig] = []
    for i, w in enumerate(watches_raw):
        if not isinstance(w, dict):
            raise DashboardConfigError(f"watches[{i}]: must be a mapping")
        watch_pat = w.get("watch")
        if not watch_pat:
            raise DashboardConfigError(f"watches[{i}]: missing 'watch'")
        run = w.get("run")
        if not run:
            raise DashboardConfigError(f"watches[{i}]: missing 'run'")
        watches.append(WatchConfig(
            name=w.get("name") or f"watch-{i}",
            watch=watch_pat,
            run=run,
            exclude=w.get("exclude"),
        ))

    # Extra roots (optional) — additional directories the file tree can switch to
    extra_roots_raw = raw.get("extra_roots", [])
    extra_roots: list[ExtraRootConfig] = []
    if isinstance(extra_roots_raw, list):
        for i, er in enumerate(extra_roots_raw):
            if not isinstance(er, dict):
                raise DashboardConfigError(f"extra_roots[{i}]: must be a mapping")
            er_name = er.get("name")
            er_path = er.get("path")
            if not er_name:
                raise DashboardConfigError(f"extra_roots[{i}]: missing 'name'")
            if not er_path:
                raise DashboardConfigError(f"extra_roots[{i}]: missing 'path'")
            extra_roots.append(ExtraRootConfig(
                name=er_name,
                path=er_path,
                label=er.get("label"),
                default=bool(er.get("default", False)),
            ))

    return DashboardConfig(
        dashboard=dashboard,
        data_sources=data_sources,
        views=views,
        stats=stats,
        watches=watches,
        extra_roots=extra_roots,
    )


def load_dashboard_config(
    project_root: Path,
    filename: str | None = None,
) -> DashboardConfig | None:
    """Load and validate a dashboard config file from a project.

    Without ``filename``, probes the default locations
    (``.cade/dashboard.yml`` and ``.cade/dashboard.yaml``) in order.

    With ``filename``, loads that exact path (relative to the project
    root, or absolute). Useful for projects that ship multiple dashboard
    configs selected by the launch preset — e.g. a player-mode dashboard
    that's completely separate from a GM-mode dashboard.

    Returns None if no config file exists.
    Raises DashboardConfigError if the file exists but is invalid.
    """
    config_path: Path | None = None

    if filename:
        candidate = Path(filename)
        if not candidate.is_absolute():
            candidate = project_root / candidate
        if candidate.is_file():
            config_path = candidate
    else:
        cade_dir = project_root / ".cade"
        for name in CONFIG_FILENAMES:
            candidate = cade_dir / name
            if candidate.is_file():
                config_path = candidate
                break

    if config_path is None:
        return None

    try:
        text = config_path.read_text(encoding="utf-8")
    except OSError as e:
        raise DashboardConfigError(f"failed to read {config_path}: {e}") from e

    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise DashboardConfigError(f"invalid YAML in {config_path}: {e}") from e

    if not isinstance(raw, dict):
        raise DashboardConfigError(f"{config_path}: expected a YAML mapping at top level")

    return validate_config(raw)


def config_to_dict(config: DashboardConfig) -> dict[str, Any]:
    """Serialize a DashboardConfig to a plain dict for JSON transport."""
    import dataclasses
    return dataclasses.asdict(config)
