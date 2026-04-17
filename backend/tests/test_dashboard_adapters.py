"""Tests for dashboard data source adapters."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from core.backend.dashboard.adapters import (
    AdapterError,
    VaultAdapter,
    _parse_frontmatter,
    _strip_frontmatter,
    get_adapter,
)
from core.backend.dashboard.config import DataSourceConfig


# ---------------------------------------------------------------------------
# Frontmatter helpers
# ---------------------------------------------------------------------------

def test_parse_frontmatter_basic():
    text = "---\ntitle: Hello\ntags: [a, b]\n---\nbody"
    assert _parse_frontmatter(text) == {"title": "Hello", "tags": ["a", "b"]}


def test_parse_frontmatter_missing_returns_empty():
    assert _parse_frontmatter("no frontmatter here") == {}


def test_parse_frontmatter_unterminated_returns_empty():
    # Opening --- but no closing --- on its own line
    assert _parse_frontmatter("---\ntitle: Hello\nno end") == {}


def test_parse_frontmatter_invalid_yaml_returns_empty():
    assert _parse_frontmatter("---\n: : :\n---\nbody") == {}


def test_strip_frontmatter_removes_block():
    text = "---\ntitle: Hello\n---\n\n# Body\n\ncontent"
    assert _strip_frontmatter(text) == "# Body\n\ncontent"


def test_strip_frontmatter_no_block_returns_input():
    assert _strip_frontmatter("just body") == "just body"


# ---------------------------------------------------------------------------
# VaultAdapter
# ---------------------------------------------------------------------------

def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _fetch(config: DataSourceConfig, root: Path) -> list[dict]:
    return asyncio.run(VaultAdapter().fetch(config, root))


def test_vault_adapter_recurses_into_subfolders(temp_dir: Path):
    _write(temp_dir / "vault/Characters/Aela.md", "---\ntitle: Aela\n---\n# Aela\nbody")
    _write(
        temp_dir / "vault/Characters/Deities/Essentia.md",
        "---\ntitle: Essentia\n---\nbody",
    )
    _write(
        temp_dir / "vault/Locations/Padarax.md",
        "---\ntitle: Padarax\ntype: Planet\n---\nbody",
    )

    config = DataSourceConfig(name="vault", type="vault", path="vault")
    rows = _fetch(config, temp_dir)

    assert len(rows) == 3
    ids = sorted(r["id"] for r in rows)
    assert ids == ["Characters/Aela", "Characters/Deities/Essentia", "Locations/Padarax"]


def test_vault_adapter_exposes_frontmatter_and_helpers(temp_dir: Path):
    _write(
        temp_dir / "vault/Characters/Aela.md",
        "---\ntitle: Aela\nalignment: [Lawful, Good]\n---\n# Aela\n\nHer body.",
    )
    config = DataSourceConfig(name="v", type="vault", path="vault")
    rows = _fetch(config, temp_dir)

    assert len(rows) == 1
    row = rows[0]
    assert row["title"] == "Aela"
    assert row["alignment"] == ["Lawful", "Good"]
    assert row["_file"] == "vault/Characters/Aela.md"
    assert row["_path"] == "Characters/Aela.md"
    assert row["_folder"] == "Characters"
    assert row["_filename"] == "Aela"
    assert "Her body." in row["_body"]
    assert row["_body"].startswith("# Aela")


def test_vault_adapter_skips_readme_and_dotfiles(temp_dir: Path):
    _write(temp_dir / "vault/README.md", "---\ntitle: Hub\n---\n")
    _write(temp_dir / "vault/Characters/README.md", "---\ntitle: Chars\n---\n")
    _write(temp_dir / "vault/.obsidian/config.md", "---\ntitle: Nope\n---\n")
    _write(temp_dir / "vault/Characters/Aela.md", "---\ntitle: Aela\n---\n")

    config = DataSourceConfig(name="v", type="vault", path="vault")
    rows = _fetch(config, temp_dir)

    assert len(rows) == 1
    assert rows[0]["title"] == "Aela"


def test_vault_adapter_handles_file_without_frontmatter(temp_dir: Path):
    _write(temp_dir / "vault/Locations/Unknown.md", "# Unknown\n\nno frontmatter")

    config = DataSourceConfig(name="v", type="vault", path="vault")
    rows = _fetch(config, temp_dir)

    assert len(rows) == 1
    row = rows[0]
    assert row["title"] == "Unknown"  # falls back to filename
    assert row["id"] == "Locations/Unknown"
    assert row["_body"].startswith("# Unknown")


def test_vault_adapter_top_level_folder_is_empty_string(temp_dir: Path):
    _write(temp_dir / "vault/Padarax.md", "---\ntitle: Padarax\n---\n")

    config = DataSourceConfig(name="v", type="vault", path="vault")
    rows = _fetch(config, temp_dir)

    assert rows[0]["_folder"] == ""


def test_vault_adapter_missing_path_raises(temp_dir: Path):
    config = DataSourceConfig(name="v", type="vault", path=None)
    with pytest.raises(AdapterError, match="missing 'path'"):
        _fetch(config, temp_dir)


def test_vault_adapter_missing_directory_returns_empty(temp_dir: Path):
    config = DataSourceConfig(name="v", type="vault", path="nonexistent")
    rows = _fetch(config, temp_dir)
    assert rows == []


def test_vault_adapter_registered_in_registry():
    adapter = get_adapter("vault")
    assert isinstance(adapter, VaultAdapter)
