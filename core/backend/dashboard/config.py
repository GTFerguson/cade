"""Dashboard config loading and validation.

Reads .cade/dashboard.yml from a project root, validates the structure,
and returns typed dataclasses the handler and frontend can consume.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


# Component names the CADE renderer registers in
# `frontend/src/dashboard/registry.ts:createDefaultRegistry`. A test compares
# the two lists. `claims` and `split_markdown` are listed although the prompt
# module does not teach them: they are general components that Padarax
# configs use.
KNOWN_COMPONENTS = frozenset({
    "basket",
    "cards",
    "cards_paged",
    "checklist",
    "claims",
    "entity_detail",
    "graph",
    "kanban",
    "key_value",
    "markdown",
    "model_stats",
    "split_markdown",
    "table",
    "timeline",
})

# Panel keys outside the common panel fields that a component reads from
# `panel.extra`. Any other extra key on a known component is reported as a
# warning, because nothing reads it.
COMPONENT_EXTRA_KEYS: dict[str, frozenset[str]] = {
    "cards": frozenset({
        "favourite_field", "group_by", "inline_preview", "page_size",
        "sort", "view_file_preview",
    }),
    "cards_paged": frozenset({
        "buffer_size", "favourite_field", "page_size", "stale_ms", "target_size",
    }),
}

# Source keys outside the common source fields that each adapter reads from
# `DataSourceConfig.extra`, keyed by source type. The keys of this map are the
# valid source types; a test checks them against the adapter registry.
SOURCE_EXTRA_KEYS: dict[str, frozenset[str]] = {
    "directory": frozenset(),
    "json_directory": frozenset({"exclude", "merge_suffix"}),
    "json_directory_expand": frozenset({"exclude", "expand_field"}),
    "json_file": frozenset(),
    "json_file_array": frozenset({"array_field"}),
    "markdown": frozenset(),
    "model_usage": frozenset({
        "inputs", "label", "model_providers", "quota_endpoints",
        "static_quotas", "window",
    }),
    "rest": frozenset(),
    "stream": frozenset({"buffer", "channel"}),
    "vault": frozenset(),
}

# Keys read by the kanban's `on_move` and the checklist's `on_check`.
_HANDLER_KEYS = frozenset({"action", "patch"})

# Fields the schema accepts so existing configs keep loading, and that no
# renderer reads yet.
_NOT_RENDERED_VIEW_KEYS = ("sidebar_filters", "tab_filter", "actions_by_status")
_NOT_RENDERED = "is accepted and not yet rendered, so it has no effect"

_TOP_LEVEL_KEYS = frozenset({
    "dashboard", "data_sources", "views", "stats", "watches", "extra_roots",
    "push_sources",
    # Read by backend/launch_preset.py from the active dashboard file.
    "hide_tree", "kiosk_mode",
})
_DASHBOARD_KEYS = frozenset({"title", "subtitle", "theme"})
_VIEW_KEYS = frozenset({
    "id", "title", "layout", "hidden", "group", "panels", "detail",
    *_NOT_RENDERED_VIEW_KEYS,
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
    # Always a source name. A mapping written here in YAML is registered as
    # a source under a generated name during validation.
    source: str | None = None
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
    # Problems that do not stop the config loading, such as keys nothing
    # reads. They travel to the client with the config so whoever wrote it
    # can see them.
    warnings: list[str] = field(default_factory=list)


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


def _parse_data_source(
    name: str,
    raw: Any,
    warnings: list[str],
    where: str | None = None,
) -> DataSourceConfig:
    where = where or f"data_sources.{name}"
    if not isinstance(raw, dict):
        raise DashboardConfigError(f"{where}: must be a mapping")
    src_type = raw.get("type")
    if not src_type:
        raise DashboardConfigError(f"{where}: missing 'type'")
    extra = {k: v for k, v in raw.items() if k not in _DATA_SOURCE_KNOWN_FIELDS}

    allowed = SOURCE_EXTRA_KEYS.get(src_type)
    if allowed is None:
        message = (
            f"{where}: unknown type '{src_type}' "
            f"(available: {', '.join(sorted(SOURCE_EXTRA_KEYS))}); it will load no rows"
        )
        if src_type == "file":
            message += ". To read one markdown file, use type: markdown with parse: raw"
        warnings.append(message)
    else:
        for key in extra:
            if key not in allowed:
                warnings.append(
                    f"{where}: key '{key}' is not read by type '{src_type}' and has no effect"
                )

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
    "on_click", "on_check", "on_move", "extra",
}


def _panel_where(view_id: str, raw: dict[str, Any], idx: int) -> str:
    return f"views[{view_id}].panels[{raw.get('id') or idx}]"


def _check_handler_keys(where: str, key: str, value: Any, warnings: list[str]) -> None:
    if not isinstance(value, dict):
        return
    for k in value:
        if k not in _HANDLER_KEYS:
            warnings.append(
                f"{where}: {key} key '{k}' is not read and has no effect "
                f"(read: {', '.join(sorted(_HANDLER_KEYS))})"
            )


def _parse_panel(raw: Any, view_id: str, idx: int, warnings: list[str]) -> PanelConfig:
    if not isinstance(raw, dict):
        raise DashboardConfigError(f"views[{view_id}].panels[{idx}]: must be a mapping")
    where = _panel_where(view_id, raw, idx)
    component = raw.get("component")
    if not component:
        raise DashboardConfigError(f"views[{view_id}].panels[{idx}]: missing 'component'")

    source = raw.get("source")
    if source is not None and not isinstance(source, str):
        raise DashboardConfigError(
            f"{where}: source must be the name of a source under data_sources, "
            "or a mapping that declares one"
        )

    extra = {k: v for k, v in raw.items() if k not in _PANEL_SIMPLE_FIELDS}
    # Docs and configs write component options both on the panel and under
    # an `extra:` mapping, so both forms land in the same place. A key on
    # the panel wins over the same key under `extra:`.
    nested = raw.get("extra")
    if isinstance(nested, dict):
        extra = {**nested, **extra}
    elif nested is not None:
        warnings.append(f"{where}: 'extra' must be a mapping; it was ignored")

    if component not in KNOWN_COMPONENTS:
        # A warning, not an error: another renderer, such as Padarax's, may
        # register components that CADE's registry lacks.
        warnings.append(
            f"{where}: unknown component '{component}' "
            f"(valid: {', '.join(sorted(KNOWN_COMPONENTS))}); "
            "CADE shows the panel as not available"
        )
    else:
        allowed = COMPONENT_EXTRA_KEYS.get(component, frozenset())
        for key in extra:
            if key not in allowed:
                warnings.append(
                    f"{where}: key '{key}' is not read by component '{component}' "
                    "and has no effect"
                )

    _check_handler_keys(where, "on_move", raw.get("on_move"), warnings)
    _check_handler_keys(where, "on_check", raw.get("on_check"), warnings)

    return PanelConfig(
        component=component,
        id=raw.get("id"),
        title=raw.get("title"),
        source=source,
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


def _parse_view(raw: Any, idx: int, warnings: list[str]) -> ViewConfig:
    if not isinstance(raw, dict):
        raise DashboardConfigError(f"views[{idx}]: must be a mapping")
    view_id = raw.get("id")
    if not view_id:
        raise DashboardConfigError(f"views[{idx}]: missing 'id'")
    title = raw.get("title")
    if not title:
        raise DashboardConfigError(f"views[{idx}]: missing 'title'")

    for key in raw:
        if key not in _VIEW_KEYS:
            warnings.append(f"views[{view_id}]: key '{key}' is not read and has no effect")
    for key in _NOT_RENDERED_VIEW_KEYS:
        if key in raw:
            warnings.append(f"views[{view_id}]: '{key}' {_NOT_RENDERED}")

    panels = [
        _parse_panel(p, view_id, i, warnings)
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


def _lift_inline_sources(
    views_raw: list[Any],
    taken: set[str],
) -> tuple[list[Any], dict[str, tuple[str, dict[str, Any]]]]:
    """Move each mapping given as a panel's `source` out of the panel.

    Returns copies of the views in which every such mapping is replaced by
    a generated source name, and the lifted sources keyed by that name,
    each with a label that points back at the panel for messages.
    """
    lifted: dict[str, tuple[str, dict[str, Any]]] = {}
    new_views: list[Any] = []
    for v_idx, view in enumerate(views_raw):
        if not isinstance(view, dict) or not isinstance(view.get("panels"), list):
            new_views.append(view)
            continue
        view_id = view.get("id") or v_idx
        new_panels: list[Any] = []
        for p_idx, panel in enumerate(view["panels"]):
            if isinstance(panel, dict) and isinstance(panel.get("source"), dict):
                base = f"_inline:{view_id}:{panel.get('id') or p_idx}"
                name = base
                n = 2
                while name in taken:
                    name = f"{base}:{n}"
                    n += 1
                taken.add(name)
                where = f"{_panel_where(str(view_id), panel, p_idx)}.source"
                lifted[name] = (where, panel["source"])
                panel = {**panel, "source": name}
            new_panels.append(panel)
        new_views.append({**view, "panels": new_panels})
    return new_views, lifted


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

    Raises DashboardConfigError with a human-readable message when the
    config cannot be used. Problems that leave it usable, such as keys
    nothing reads, are collected in ``DashboardConfig.warnings`` instead,
    so configs written against a looser schema keep loading.
    """
    warnings: list[str] = []

    for key in raw:
        if key not in _TOP_LEVEL_KEYS:
            warnings.append(f"top-level key '{key}' is not read and has no effect")

    # Dashboard metadata
    dash_raw = raw.get("dashboard")
    if not dash_raw:
        raise DashboardConfigError("missing top-level 'dashboard' key")
    if not isinstance(dash_raw, dict):
        raise DashboardConfigError("'dashboard' must be a mapping")
    title = dash_raw.get("title")
    if not title:
        raise DashboardConfigError("dashboard.title is required")
    for key in dash_raw:
        if key not in _DASHBOARD_KEYS:
            warnings.append(f"dashboard: key '{key}' is not read and has no effect")
    if "theme" in dash_raw:
        warnings.append(f"dashboard: 'theme' {_NOT_RENDERED}")
    dashboard = DashboardMeta(
        title=title,
        subtitle=dash_raw.get("subtitle"),
        theme=dash_raw.get("theme"),
    )

    sources_raw = raw.get("data_sources", {})
    if not isinstance(sources_raw, dict):
        raise DashboardConfigError("'data_sources' must be a mapping")

    views_raw = raw.get("views", [])
    if not isinstance(views_raw, list):
        raise DashboardConfigError("'views' must be a list")
    if not views_raw:
        raise DashboardConfigError("at least one view is required")

    # Data sources, including any declared inline on a panel
    views_raw, inline_sources = _lift_inline_sources(views_raw, set(sources_raw))
    data_sources = {
        name: _parse_data_source(name, cfg, warnings)
        for name, cfg in sources_raw.items()
    }
    for name, (where, cfg) in inline_sources.items():
        data_sources[name] = _parse_data_source(name, cfg, warnings, where=where)

    views = [_parse_view(v, i, warnings) for i, v in enumerate(views_raw)]

    # Validate source references in panels.
    # push_sources lists sources sent by the server over WebSocket (no data_sources entry needed).
    push_sources_raw = raw.get("push_sources", [])
    push_sources = set(push_sources_raw) if isinstance(push_sources_raw, list) else set()
    source_names = set(data_sources.keys()) | push_sources
    declared_names = sorted(n for n in source_names if n not in inline_sources)
    for view in views:
        for panel in view.panels:
            if panel.source is not None and panel.source not in source_names:
                raise DashboardConfigError(
                    f"views[{view.id}].panels[{panel.id or panel.component}]: "
                    f"unknown source '{panel.source}' "
                    f"(available: {', '.join(declared_names) or 'none'})"
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
        warnings=warnings,
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
