"""Tests for dashboard config validation and the warnings it reports.

Real project configs depend on this schema, so most problems are reported
as warnings that travel with the config instead of failing the load. A
config that fails to load shows the user nothing at all.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from core.backend.dashboard.adapters import _ADAPTERS, fetch_all_sources
from core.backend.dashboard.config import (
    KNOWN_COMPONENTS,
    SOURCE_EXTRA_KEYS,
    DashboardConfigError,
    config_to_dict,
    validate_config,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_REGISTRY = REPO_ROOT / "frontend" / "src" / "dashboard" / "registry.ts"


def _config(panels: list[dict] | None = None, sources: dict | None = None, **extra) -> dict:
    return {
        "dashboard": {"title": "Test"},
        "data_sources": sources if sources is not None else {"items": {"type": "json_file", "path": "x.json"}},
        "views": [{"id": "v", "title": "V", "panels": panels or []}],
        **extra,
    }


def _warnings_matching(cfg, pattern: str) -> list[str]:
    return [w for w in cfg.warnings if re.search(pattern, w)]


# ---------------------------------------------------------------------------
# Component names
# ---------------------------------------------------------------------------

def test_known_components_match_the_frontend_registry():
    """The Python list and the renderer's registry must name the same components."""
    text = FRONTEND_REGISTRY.read_text(encoding="utf-8")
    body = text[text.index("function createDefaultRegistry"):]
    registered = set(re.findall(r'registry\.register\(\s*"([a-z_]+)"', body))
    assert registered, "no registrations found; the registry file format changed"
    assert registered == set(KNOWN_COMPONENTS)


def test_unknown_component_is_reported_with_the_valid_names():
    cfg = validate_config(_config([{"component": "tabel", "source": "items"}]))
    matches = _warnings_matching(cfg, r"unknown component 'tabel'")
    assert len(matches) == 1
    for name in ("table", "cards", "kanban"):
        assert name in matches[0]


def test_known_component_produces_no_warning():
    cfg = validate_config(_config([{"component": "table", "source": "items", "columns": ["a"]}]))
    assert cfg.warnings == []


# ---------------------------------------------------------------------------
# Fields that are accepted and not rendered
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw, key", [
    ({"dashboard": {"title": "T", "theme": "dark"}}, "theme"),
    ({"views": [{"id": "v", "title": "V", "sidebar_filters": [{"field": "x"}]}]}, "sidebar_filters"),
    ({"views": [{"id": "v", "title": "V", "tab_filter": {"field": "x"}}]}, "tab_filter"),
    ({"views": [{"id": "v", "title": "V", "actions_by_status": {"new": []}}]}, "actions_by_status"),
])
def test_unrendered_fields_load_with_a_warning(raw, key):
    cfg = validate_config({**_config(), **raw})
    matches = _warnings_matching(cfg, rf"'{key}'.*not yet rendered")
    assert len(matches) == 1


def test_on_move_and_transitions_are_not_reported():
    cfg = validate_config(_config(
        [{
            "component": "kanban", "source": "items",
            "columns": [{"status": "a", "label": "A"}],
            "on_move": {"action": "patch", "patch": {"status": "$column"}},
        }],
        sources={"items": {
            "type": "json_file", "path": "x.json",
            "entity": {"statuses": ["a", "b"], "transitions": {"a": ["b"]}},
        }},
    ))
    assert cfg.warnings == []


# ---------------------------------------------------------------------------
# Unknown keys
# ---------------------------------------------------------------------------

def test_source_extra_keys_cover_every_adapter():
    assert set(SOURCE_EXTRA_KEYS) == set(_ADAPTERS)


@pytest.mark.parametrize("source", [
    {"type": "stream", "channel": "c", "buffer": 10},
    {"type": "json_file_array", "path": "x.json", "array_field": "a.b"},
    {"type": "json_directory", "path": "d/", "merge_suffix": "-map", "exclude": ["a.json"]},
    {"type": "json_directory_expand", "path": "d/", "expand_field": "rooms", "exclude": "a.json"},
    {"type": "model_usage", "path": "log", "window": "7d", "static_quotas": {}},
])
def test_type_specific_source_keys_are_accepted(source):
    cfg = validate_config(_config(sources={"s": source}))
    assert cfg.warnings == []


def test_unknown_source_key_is_reported():
    cfg = validate_config(_config(sources={"s": {"type": "rest", "endpoint": "http://x", "refresh_intervl": 5}}))
    matches = _warnings_matching(cfg, r"data_sources\.s.*'refresh_intervl'")
    assert len(matches) == 1


def test_unknown_source_type_is_reported_with_the_valid_types():
    cfg = validate_config(_config(sources={"s": {"type": "file", "path": "README.md"}}))
    matches = _warnings_matching(cfg, r"unknown type 'file'")
    assert len(matches) == 1
    assert "markdown" in matches[0]
    assert "parse: raw" in matches[0]


def test_unknown_panel_key_is_reported():
    cfg = validate_config(_config([{"component": "cards", "source": "items", "filterble": ["x"]}]))
    matches = _warnings_matching(cfg, r"'filterble'.*cards")
    assert len(matches) == 1


@pytest.mark.parametrize("component, key", [
    ("cards", "page_size"),
    ("cards", "group_by"),
    ("cards_paged", "target_size"),
    ("cards_paged", "stale_ms"),
])
def test_component_specific_panel_keys_are_accepted(component, key):
    cfg = validate_config(_config([{"component": component, "source": "items", key: 1}]))
    assert cfg.warnings == []


def test_component_keys_under_extra_are_read_as_panel_keys():
    """`extra: {page_size: 25}` is how the docs and real configs write it."""
    cfg = validate_config(_config([{"component": "cards_paged", "source": "items", "extra": {"page_size": 25}}]))
    assert cfg.warnings == []
    assert cfg.views[0].panels[0].extra == {"page_size": 25}


def test_panel_keys_of_an_unknown_component_are_not_checked():
    """Another renderer may register the component, so its keys are unknown here."""
    cfg = validate_config(_config([{"component": "party", "source": "items", "slots": 4}]))
    assert len(cfg.warnings) == 1
    assert "unknown component 'party'" in cfg.warnings[0]


def test_unknown_on_move_key_is_reported():
    cfg = validate_config(_config([{
        "component": "kanban", "source": "items", "columns": [],
        "on_move": {"action": "patch", "field": "status"},
    }]))
    matches = _warnings_matching(cfg, r"on_move.*'field'")
    assert len(matches) == 1


def test_unknown_on_check_key_is_reported():
    cfg = validate_config(_config([{
        "component": "checklist", "source": "items",
        "on_check": {"action": "patch", "field": "done", "value": True},
    }]))
    assert len(_warnings_matching(cfg, r"on_check.*'field'")) == 1
    assert len(_warnings_matching(cfg, r"on_check.*'value'")) == 1


def test_unknown_view_key_is_reported():
    raw = _config()
    raw["views"][0]["default"] = True
    cfg = validate_config(raw)
    assert len(_warnings_matching(cfg, r"views\[v\].*'default'")) == 1


def test_unknown_dashboard_and_top_level_keys_are_reported():
    raw = {**_config(), "dashbord_extra": 1}
    raw["dashboard"] = {"title": "T", "colour": "red"}
    cfg = validate_config(raw)
    assert len(_warnings_matching(cfg, r"'dashbord_extra'")) == 1
    assert len(_warnings_matching(cfg, r"dashboard.*'colour'")) == 1


def test_top_level_keys_read_elsewhere_are_accepted():
    """`hide_tree` and `kiosk_mode` are read by the launch preset, `push_sources` here."""
    cfg = validate_config({**_config(), "hide_tree": True, "kiosk_mode": True, "push_sources": ["live"]})
    assert cfg.warnings == []


# ---------------------------------------------------------------------------
# A mapping as a panel's source
# ---------------------------------------------------------------------------

def test_inline_source_is_registered_under_a_generated_name():
    raw = _config([{"id": "doc", "component": "markdown", "source": {"type": "markdown", "path": "a.md", "parse": "raw"}}])
    cfg = validate_config(raw)
    panel = cfg.views[0].panels[0]
    assert isinstance(panel.source, str)
    src = cfg.data_sources[panel.source]
    assert src.type == "markdown"
    assert src.path == "a.md"
    assert src.parse == "raw"


def test_inline_source_names_do_not_collide_with_declared_sources():
    raw = _config(
        [
            {"component": "markdown", "source": {"type": "markdown", "path": "a.md"}},
            {"component": "markdown", "source": {"type": "markdown", "path": "b.md"}},
        ],
    )
    cfg = validate_config(raw)
    first, second = (p.source for p in cfg.views[0].panels)
    assert first != second
    assert first not in ("items",) and second not in ("items",)
    assert {cfg.data_sources[first].path, cfg.data_sources[second].path} == {"a.md", "b.md"}


def test_inline_source_without_type_is_an_error():
    with pytest.raises(DashboardConfigError, match="missing 'type'"):
        validate_config(_config([{"component": "markdown", "source": {"path": "a.md"}}]))


def test_panel_source_of_another_shape_is_an_error():
    with pytest.raises(DashboardConfigError, match="source must be"):
        validate_config(_config([{"component": "markdown", "source": ["a.md"]}]))


async def test_inline_source_rows_are_fetched(tmp_path: Path):
    (tmp_path / "a.md").write_text("# Hello\n", encoding="utf-8")
    raw = _config(
        [{"id": "doc", "component": "markdown", "source": {"type": "markdown", "path": "a.md", "parse": "raw"}}],
        sources={},
    )
    cfg = validate_config(raw)
    data = await fetch_all_sources(cfg, tmp_path)
    assert data[cfg.views[0].panels[0].source] == [{"content": "# Hello\n"}]


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

def test_warnings_are_sent_with_the_config():
    cfg = validate_config({**_config(), "dashboard": {"title": "T", "theme": "dark"}})
    payload = config_to_dict(cfg)
    assert payload["warnings"] == cfg.warnings
    assert payload["warnings"]


def test_frontend_types_name_the_schema_file_they_mirror():
    types_ts = REPO_ROOT / "frontend" / "src" / "dashboard" / "types.ts"
    match = re.search(r"Mirrors (\S+\.py)", types_ts.read_text(encoding="utf-8"))
    assert match, "types.ts no longer says which schema file it mirrors"
    assert (REPO_ROOT / match.group(1)).is_file()


def test_a_panel_that_is_not_a_mapping_is_an_error():
    with pytest.raises(DashboardConfigError, match=r"panels\[0\]: must be a mapping"):
        validate_config(_config(["cards"]))  # type: ignore[list-item]
