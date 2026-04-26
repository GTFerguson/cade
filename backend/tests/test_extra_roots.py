"""Tests for extra_roots config parsing, resolution, and root switching."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.backend.dashboard.config import (
    DashboardConfigError,
    ExtraRootConfig,
    validate_config,
)
from core.backend.dashboard.handler import DashboardHandler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _minimal_config(**extra) -> dict:
    """Return a minimal valid dashboard config dict, with optional overrides."""
    return {
        "dashboard": {"title": "Test"},
        "data_sources": {},
        "views": [{"id": "v", "title": "V", "panels": []}],
        **extra,
    }


# ---------------------------------------------------------------------------
# extra_roots parsing
# ---------------------------------------------------------------------------

def test_extra_roots_absent_defaults_to_empty():
    cfg = validate_config(_minimal_config())
    assert cfg.extra_roots == []


def test_extra_roots_single_entry():
    raw = _minimal_config(extra_roots=[
        {"name": "common-knowledge", "path": "../common-knowledge"},
    ])
    cfg = validate_config(raw)
    assert len(cfg.extra_roots) == 1
    er = cfg.extra_roots[0]
    assert er.name == "common-knowledge"
    assert er.path == "../common-knowledge"
    assert er.label is None
    assert er.default is False


def test_extra_roots_label_and_default():
    raw = _minimal_config(extra_roots=[
        {"name": "ck", "path": "../common-knowledge", "label": "Common Knowledge", "default": True},
    ])
    cfg = validate_config(raw)
    er = cfg.extra_roots[0]
    assert er.label == "Common Knowledge"
    assert er.default is True


def test_extra_roots_multiple():
    raw = _minimal_config(extra_roots=[
        {"name": "shared", "path": "../shared"},
        {"name": "docs", "path": "../docs-site", "label": "Docs"},
    ])
    cfg = validate_config(raw)
    assert len(cfg.extra_roots) == 2
    assert cfg.extra_roots[0].name == "shared"
    assert cfg.extra_roots[1].label == "Docs"


def test_extra_roots_missing_name_raises():
    raw = _minimal_config(extra_roots=[{"path": "../foo"}])
    with pytest.raises(DashboardConfigError, match="missing 'name'"):
        validate_config(raw)


def test_extra_roots_missing_path_raises():
    raw = _minimal_config(extra_roots=[{"name": "foo"}])
    with pytest.raises(DashboardConfigError, match="missing 'path'"):
        validate_config(raw)


def test_extra_roots_non_list_is_ignored():
    # A non-list value simply produces no entries (same as absent)
    raw = _minimal_config(extra_roots="not-a-list")
    cfg = validate_config(raw)
    assert cfg.extra_roots == []


def test_extra_roots_non_dict_entry_raises():
    raw = _minimal_config(extra_roots=["not-a-dict"])
    with pytest.raises(DashboardConfigError, match="must be a mapping"):
        validate_config(raw)


# ---------------------------------------------------------------------------
# config_to_dict round-trips extra_roots
# ---------------------------------------------------------------------------

def test_config_to_dict_includes_extra_roots():
    from core.backend.dashboard.config import config_to_dict
    raw = _minimal_config(extra_roots=[
        {"name": "ck", "path": "../common-knowledge", "label": "CK", "default": True},
    ])
    cfg = validate_config(raw)
    d = config_to_dict(cfg)
    assert d["extra_roots"] == [
        {"name": "ck", "path": "../common-knowledge", "label": "CK", "default": True}
    ]


# ---------------------------------------------------------------------------
# DashboardHandler.get_allowed_extra_roots
# ---------------------------------------------------------------------------

def test_get_allowed_extra_roots_no_config(tmp_path: Path):
    handler = DashboardHandler(working_dir=tmp_path, send=None)  # type: ignore[arg-type]
    assert handler.get_allowed_extra_roots() == {}


def test_get_allowed_extra_roots_nonexistent_path(tmp_path: Path):
    """Paths that don't exist on disk are excluded from allowed roots."""
    handler = DashboardHandler(working_dir=tmp_path, send=None)  # type: ignore[arg-type]
    handler._config = validate_config(_minimal_config(extra_roots=[
        {"name": "ghost", "path": "../does-not-exist-xyz"},
    ]))
    assert handler.get_allowed_extra_roots() == {}


def test_get_allowed_extra_roots_existing_path(tmp_path: Path):
    """Paths that exist are returned with their resolved absolute path."""
    extra = tmp_path.parent / "sibling-dir"
    extra.mkdir()
    handler = DashboardHandler(working_dir=tmp_path, send=None)  # type: ignore[arg-type]
    handler._config = validate_config(_minimal_config(extra_roots=[
        {"name": "sibling", "path": "../sibling-dir"},
    ]))
    roots = handler.get_allowed_extra_roots()
    assert "sibling" in roots
    assert roots["sibling"] == extra.resolve()


def test_get_allowed_extra_roots_mixed(tmp_path: Path):
    """Only existing directories appear; missing ones are silently dropped."""
    real = tmp_path.parent / "real-extra"
    real.mkdir()
    handler = DashboardHandler(working_dir=tmp_path, send=None)  # type: ignore[arg-type]
    handler._config = validate_config(_minimal_config(extra_roots=[
        {"name": "real", "path": "../real-extra"},
        {"name": "fake", "path": "../totally-missing"},
    ]))
    roots = handler.get_allowed_extra_roots()
    assert set(roots.keys()) == {"real"}


# ---------------------------------------------------------------------------
# _resolve_root (tested via ConnectionHandler logic)
# ---------------------------------------------------------------------------

class _FakeConnectionHandler:
    """Minimal stub that replicates _resolve_root without full WS machinery."""

    def __init__(self, working_dir: Path, extra_roots: dict[str, Path]) -> None:
        self._working_dir = working_dir
        self._extra_roots = extra_roots

    def _resolve_root(self, root_name: str | None) -> Path:
        if root_name and root_name in self._extra_roots:
            return self._extra_roots[root_name]
        return self._working_dir


def test_resolve_root_none_returns_working_dir(tmp_path: Path):
    h = _FakeConnectionHandler(tmp_path, {})
    assert h._resolve_root(None) == tmp_path


def test_resolve_root_known_name_returns_extra(tmp_path: Path):
    extra = tmp_path / "other"
    h = _FakeConnectionHandler(tmp_path, {"other": extra})
    assert h._resolve_root("other") == extra


def test_resolve_root_unknown_name_falls_back_to_working_dir(tmp_path: Path):
    """An unrecognised root name (not in allowed list) falls back safely."""
    extra = tmp_path / "legit"
    h = _FakeConnectionHandler(tmp_path, {"legit": extra})
    assert h._resolve_root("../../etc/passwd") == tmp_path
    assert h._resolve_root("unknown") == tmp_path


def test_resolve_root_empty_string_falls_back(tmp_path: Path):
    h = _FakeConnectionHandler(tmp_path, {"ck": tmp_path / "ck"})
    assert h._resolve_root("") == tmp_path
