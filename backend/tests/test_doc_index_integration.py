"""Integration tests for cadence doc-index in CADE.

Verifies the full pipeline: ensure_setup creates symlinks and rules,
build_project_index produces a valid index with TF-IDF and code_map,
and the DocIndexService lifecycle works end-to-end.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import patch

import pytest

# Ensure cadence is importable for these tests
_CADENCE_ROOT = Path(__file__).parent.parent.parent / "cadence"
if _CADENCE_ROOT.exists() and str(_CADENCE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CADENCE_ROOT))

from backend.doc_index import (
    DOC_INDEX_AVAILABLE,
    DocIndexService,
    build_project_index,
    ensure_setup,
    has_docs,
)

pytestmark = pytest.mark.skipif(
    not DOC_INDEX_AVAILABLE,
    reason="cadence submodule not available",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_DOC = """\
---
title: Authentication Guide
scope: [backend]
status: published
tags: [auth, security]
description: How the auth system works.
---

# Authentication

The auth system lives in [`auth.py`](src/auth.py).

See also `src/middleware/verify.py` for token validation.
"""

SAMPLE_DOC_2 = """\
---
title: Database Layer
scope: [backend]
status: draft
tags: [database, models]
description: ORM models and query patterns.
---

# Database

Models are defined in `src/models.py`.
"""

SAMPLE_DOC_NO_FRONTMATTER = """\
# README

This project has some code in `src/main.py`.
"""


@pytest.fixture
def project_dir() -> Generator[Path, None, None]:
    """Create a temporary project with docs and code files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)

        # Create docs
        docs = root / "docs"
        docs.mkdir()
        (docs / "auth.md").write_text(SAMPLE_DOC)
        (docs / "database.md").write_text(SAMPLE_DOC_2)
        (root / "README.md").write_text(SAMPLE_DOC_NO_FRONTMATTER)

        # Create code files that docs reference
        src = root / "src"
        src.mkdir()
        (src / "auth.py").write_text("# auth module\n")
        (src / "main.py").write_text("# entry point\n")
        (src / "models.py").write_text("# models\n")
        middleware = src / "middleware"
        middleware.mkdir()
        (middleware / "verify.py").write_text("# token verify\n")

        # Create .git dir so find_project_root can detect it
        (root / ".git").mkdir()

        yield root


@pytest.fixture
def empty_project() -> Generator[Path, None, None]:
    """Create a project with no markdown files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        (root / "src").mkdir()
        (root / "src" / "main.py").write_text("print('hello')\n")
        (root / ".git").mkdir()
        yield root


@pytest.fixture
def project_with_config(project_dir: Path) -> Path:
    """Add a .doc-index.yaml config to the project."""
    config = "scan:\n  - docs/\nexclude:\n  - .git/\n  - node_modules/\n"
    (project_dir / ".doc-index.yaml").write_text(config)
    return project_dir


# ---------------------------------------------------------------------------
# has_docs
# ---------------------------------------------------------------------------


class TestHasDocs:
    """Verify markdown detection for projects with and without docs."""

    def test_project_with_docs(self, project_dir: Path):
        assert has_docs(project_dir) is True

    def test_empty_project(self, empty_project: Path):
        assert has_docs(empty_project) is False

    def test_project_with_config_and_docs(self, project_with_config: Path):
        assert has_docs(project_with_config) is True

    def test_project_with_config_wrong_dir(self, project_dir: Path):
        """Config points to scan dir that has no docs."""
        config = "scan:\n  - nonexistent/\n"
        (project_dir / ".doc-index.yaml").write_text(config)
        assert has_docs(project_dir) is False


# ---------------------------------------------------------------------------
# ensure_setup
# ---------------------------------------------------------------------------


class TestEnsureSetup:
    """Verify that ensure_setup creates symlinks and rules idempotently."""

    def test_creates_tools_symlinks(self, project_dir: Path):
        ensure_setup(project_dir)

        pkg_link = project_dir / "tools" / "doc_index"
        bin_link = project_dir / "tools" / "doc-index"

        assert pkg_link.exists(), "tools/doc_index symlink not created"
        assert pkg_link.is_symlink(), "tools/doc_index should be a symlink"
        # Verify the symlink target is the cadence package
        assert (pkg_link / "__main__.py").exists(), "Symlink doesn't point to valid package"

        assert bin_link.exists(), "tools/doc-index symlink not created"
        assert bin_link.is_symlink(), "tools/doc-index should be a symlink"

    def test_creates_gitignore_with_cade(self, project_dir: Path):
        ensure_setup(project_dir)

        gitignore = project_dir / ".gitignore"
        assert gitignore.exists()
        assert ".cade/" in gitignore.read_text()

    def test_appends_to_existing_gitignore(self, project_dir: Path):
        gitignore = project_dir / ".gitignore"
        gitignore.write_text("node_modules/\n*.pyc\n")

        ensure_setup(project_dir)

        content = gitignore.read_text()
        assert "node_modules/" in content, "Existing content should be preserved"
        assert ".cade/" in content, ".cade/ should be appended"

    def test_no_duplicate_gitignore_entries(self, project_dir: Path):
        gitignore = project_dir / ".gitignore"
        gitignore.write_text(".cade/\n")

        ensure_setup(project_dir)

        content = gitignore.read_text()
        assert content.count(".cade/") == 1, "Should not duplicate .cade/ entry"

    def test_idempotent(self, project_dir: Path):
        """Running twice should not error or create duplicate symlinks."""
        ensure_setup(project_dir)
        ensure_setup(project_dir)

        pkg_link = project_dir / "tools" / "doc_index"
        assert pkg_link.is_symlink()

    def test_installs_doc_search_rule(self, project_dir: Path):
        """The doc-search rule should be symlinked to ~/.claude/rules/."""
        # Use a temp home to avoid polluting real home
        with tempfile.TemporaryDirectory() as fake_home:
            with patch("backend.doc_index.Path.home", return_value=Path(fake_home)):
                ensure_setup(project_dir)

            rule = Path(fake_home) / ".claude" / "rules" / "doc-search.md"
            assert rule.exists(), "doc-search.md rule not installed"
            assert rule.is_symlink(), "Rule should be a symlink"
            content = rule.read_text()
            assert "--context" in content, "Rule should reference --context"
            assert "--query" in content, "Rule should reference --query"


# ---------------------------------------------------------------------------
# build_project_index
# ---------------------------------------------------------------------------


class TestBuildProjectIndex:
    """Verify full index build pipeline produces valid output."""

    def test_builds_index(self, project_dir: Path):
        index = build_project_index(project_dir)

        assert index is not None, "Should return index for project with docs"
        assert index["count"] >= 3, f"Expected >= 3 docs, got {index['count']}"
        assert "docs" in index
        assert "graph" in index

    def test_index_contains_expected_docs(self, project_dir: Path):
        index = build_project_index(project_dir)

        paths = {d["path"] for d in index["docs"]}
        assert "docs/auth.md" in paths
        assert "docs/database.md" in paths
        assert "README.md" in paths

    def test_frontmatter_extracted(self, project_dir: Path):
        index = build_project_index(project_dir)

        docs_by_path = {d["path"]: d for d in index["docs"]}
        auth = docs_by_path["docs/auth.md"]
        assert auth["title"] == "Authentication Guide"
        assert auth["status"] == "published"
        assert "auth" in auth["tags"]
        assert "security" in auth["tags"]
        assert "backend" in auth["scope"]

    def test_code_map_built(self, project_dir: Path):
        index = build_project_index(project_dir)

        code_map = index.get("code_map", {})
        assert len(code_map) > 0, "Code map should have entries"

        # auth.py is referenced in docs/auth.md via markdown link
        auth_entries = code_map.get("src/auth.py", [])
        assert len(auth_entries) > 0, "src/auth.py should be mapped to docs/auth.md"
        assert any(e["doc"] == "docs/auth.md" for e in auth_entries)

    def test_code_map_scores(self, project_dir: Path):
        index = build_project_index(project_dir)

        code_map = index.get("code_map", {})
        for code_path, entries in code_map.items():
            for entry in entries:
                assert 0 < entry["score"] <= 1.0, (
                    f"Score out of range for {code_path}: {entry['score']}"
                )

    def test_writes_main_index_file(self, project_dir: Path):
        build_project_index(project_dir)

        index_path = project_dir / ".cade" / "doc-index.json"
        assert index_path.exists(), "Main index JSON not written"

        data = json.loads(index_path.read_text())
        assert data["count"] >= 3
        assert "docs" in data

    def test_writes_tfidf_index(self, project_dir: Path):
        build_project_index(project_dir)

        tfidf_path = project_dir / ".cade" / "doc-index-tfidf.json"
        assert tfidf_path.exists(), "TF-IDF index not written"

        data = json.loads(tfidf_path.read_text())
        assert "idf" in data, "TF-IDF data should contain idf"
        assert "vectors" in data, "TF-IDF data should contain vectors"

    def test_empty_project_returns_none(self, empty_project: Path):
        result = build_project_index(empty_project)
        assert result is None

    def test_graph_has_entries(self, project_dir: Path):
        index = build_project_index(project_dir)

        graph = index.get("graph", {})
        assert len(graph) > 0, "Graph should have entries for indexed docs"

    def test_importance_scores(self, project_dir: Path):
        index = build_project_index(project_dir)

        for doc in index["docs"]:
            assert "_importance" in doc, f"Missing _importance for {doc['path']}"
            assert 0 <= doc["_importance"] <= 1.0, (
                f"Importance out of range for {doc['path']}: {doc['_importance']}"
            )

    def test_with_explicit_config(self, project_with_config: Path):
        """Config with scan: [docs/] should only index docs/ directory."""
        index = build_project_index(project_with_config)

        assert index is not None
        paths = {d["path"] for d in index["docs"]}
        assert "docs/auth.md" in paths
        assert "docs/database.md" in paths
        # README.md is outside docs/ so should NOT be indexed with scan: [docs/]
        assert "README.md" not in paths


# ---------------------------------------------------------------------------
# Index output validity (JSON round-trip)
# ---------------------------------------------------------------------------


class TestIndexValidity:
    """Verify the index JSON is well-formed and can be loaded back."""

    def test_json_roundtrip(self, project_dir: Path):
        build_project_index(project_dir)

        index_path = project_dir / ".cade" / "doc-index.json"
        raw = index_path.read_text()

        # Should be valid JSON
        data = json.loads(raw)

        # Re-serialize and parse again
        reserialized = json.dumps(data, indent=2)
        data2 = json.loads(reserialized)

        assert data["count"] == data2["count"]
        assert len(data["docs"]) == len(data2["docs"])

    def test_no_absolute_paths_in_index(self, project_dir: Path):
        """All paths in the index should be relative to project root."""
        index = build_project_index(project_dir)

        for doc in index["docs"]:
            assert not doc["path"].startswith("/"), (
                f"Absolute path in index: {doc['path']}"
            )

        for code_path, entries in index.get("code_map", {}).items():
            assert not code_path.startswith("/"), (
                f"Absolute code path: {code_path}"
            )
            for entry in entries:
                assert not entry["doc"].startswith("/"), (
                    f"Absolute doc path in code_map: {entry['doc']}"
                )


# ---------------------------------------------------------------------------
# Search via CLI (simulates agent usage)
# ---------------------------------------------------------------------------


class TestSearchIntegration:
    """Verify that search commands work against a built index."""

    def test_query_returns_results(self, project_dir: Path):
        """--query should find docs via hybrid fusion search."""
        from tools.doc_index.builder import build_index
        from tools.doc_index.config import load_config
        from tools.doc_index.search import (
            build_tfidf, save_tfidf, load_tfidf,
            fuzzy_search, semantic_search,
        )
        from tools.doc_index.fusion import reciprocal_rank_fusion

        build_project_index(project_dir)

        config = load_config(project_dir)
        index_path = project_dir / ".cade" / "doc-index.json"
        index = json.loads(index_path.read_text())
        docs = index["docs"]
        docs_by_path = {d["path"]: d for d in docs}

        # Fuzzy search
        fuzzy = fuzzy_search(docs, "authentication", top=len(docs),
                             use_importance=False)
        assert len(fuzzy) > 0, "Fuzzy search should find auth doc"

        # TF-IDF search
        tfidf_path = project_dir / ".cade" / "doc-index-tfidf.json"
        tfidf_data = load_tfidf(tfidf_path)
        assert tfidf_data is not None

        tfidf_results = semantic_search("authentication", tfidf_data, docs,
                                         top=len(docs), use_importance=False)

        # Fusion
        signals = {"fuzzy": fuzzy}
        if tfidf_results:
            signals["tfidf"] = tfidf_results

        results = reciprocal_rank_fusion(signals, docs_by_path, k=60, top=5)
        assert len(results) > 0, "Fusion search should return results"

        # The auth doc should be top-ranked for "authentication"
        assert results[0]["path"] == "docs/auth.md", (
            f"Expected auth.md as top result, got {results[0]['path']}"
        )

    def test_context_search(self, project_dir: Path):
        """--context should find docs relevant to a code file."""
        from tools.doc_index.code_map import context_search

        index = build_project_index(project_dir)

        code_map = index.get("code_map", {})
        docs_by_path = {d["path"]: d for d in index["docs"]}

        results = context_search("src/auth.py", code_map, docs_by_path)
        assert len(results) > 0, "Should find docs for src/auth.py"
        assert any(r["path"] == "docs/auth.md" for r in results)

    def test_context_partial_match(self, project_dir: Path):
        """--context with partial path should still match."""
        from tools.doc_index.code_map import context_search

        index = build_project_index(project_dir)

        code_map = index.get("code_map", {})
        docs_by_path = {d["path"]: d for d in index["docs"]}

        results = context_search("auth.py", code_map, docs_by_path)
        assert len(results) > 0, "Partial path 'auth.py' should match src/auth.py"

    def test_discover_metadata(self, project_dir: Path):
        """--discover should return scopes, tags, and statuses."""
        index = build_project_index(project_dir)

        meta = index.get("meta", {})
        assert "backend" in meta.get("scopes", [])
        assert "auth" in meta.get("tags", [])
        assert "published" in meta.get("statuses", [])


# ---------------------------------------------------------------------------
# DocIndexService lifecycle
# ---------------------------------------------------------------------------


class TestDocIndexService:
    """Test the async service that manages index lifecycle."""

    @pytest.mark.asyncio
    async def test_initial_build(self, project_dir: Path):
        """initial_build should create index files."""
        service = DocIndexService(project_dir)
        await service.initial_build()

        index_path = project_dir / ".cade" / "doc-index.json"
        assert index_path.exists(), "initial_build should create index"

        tfidf_path = project_dir / ".cade" / "doc-index-tfidf.json"
        assert tfidf_path.exists(), "initial_build should create TF-IDF"

    @pytest.mark.asyncio
    async def test_initial_build_creates_symlinks(self, project_dir: Path):
        """initial_build calls ensure_setup before building."""
        service = DocIndexService(project_dir)
        await service.initial_build()

        assert (project_dir / "tools" / "doc_index").exists()

    @pytest.mark.asyncio
    async def test_initial_build_empty_project(self, empty_project: Path):
        """initial_build on empty project should not error."""
        service = DocIndexService(empty_project)
        await service.initial_build()

        # Symlinks should still be created (tooling ready for when docs appear)
        assert (empty_project / "tools" / "doc_index").exists()

        # But no index files
        index_path = empty_project / ".cade" / "doc-index.json"
        assert not index_path.exists()

    @pytest.mark.asyncio
    async def test_on_file_change_filters_non_md(self, project_dir: Path):
        """on_file_change should ignore non-markdown files."""
        from unittest.mock import MagicMock

        service = DocIndexService(project_dir)
        service._schedule_rebuild = MagicMock()

        # Non-md file change
        event = MagicMock()
        event.path = "src/auth.py"
        service.on_file_change(event)
        service._schedule_rebuild.assert_not_called()

        # MD file change
        event.path = "docs/auth.md"
        service.on_file_change(event)
        service._schedule_rebuild.assert_called_once()

    def test_cancel(self, project_dir: Path):
        """cancel should not raise even when no rebuild is pending."""
        service = DocIndexService(project_dir)
        service.cancel()  # Should not raise


# ---------------------------------------------------------------------------
# Exclusion correctness
# ---------------------------------------------------------------------------


class TestExclusions:
    """Verify that exclusion patterns work correctly."""

    def test_git_dir_excluded(self, project_dir: Path):
        """Files in .git/ should never be indexed."""
        # Create a markdown file inside .git
        git_doc = project_dir / ".git" / "hooks" / "readme.md"
        git_doc.parent.mkdir(parents=True, exist_ok=True)
        git_doc.write_text("---\ntitle: Git Hook\n---\n# Hook\n")

        index = build_project_index(project_dir)
        paths = {d["path"] for d in index["docs"]}
        assert not any(".git" in p for p in paths), (
            f"Found .git path in index: {[p for p in paths if '.git' in p]}"
        )

    def test_node_modules_excluded(self, project_dir: Path):
        """Files in node_modules/ should never be indexed."""
        nm_doc = project_dir / "node_modules" / "pkg" / "README.md"
        nm_doc.parent.mkdir(parents=True, exist_ok=True)
        nm_doc.write_text("---\ntitle: Package\n---\n# Pkg\n")

        index = build_project_index(project_dir)
        paths = {d["path"] for d in index["docs"]}
        assert not any("node_modules" in p for p in paths)

    def test_cade_dir_excluded(self, project_dir: Path):
        """Files in .cade/ should never be indexed."""
        cade_doc = project_dir / ".cade" / "notes.md"
        cade_doc.parent.mkdir(parents=True, exist_ok=True)
        cade_doc.write_text("---\ntitle: Notes\n---\n# Notes\n")

        index = build_project_index(project_dir)
        paths = {d["path"] for d in index["docs"]}
        assert not any(".cade" in p for p in paths)

    def test_build_dir_no_false_positive(self, project_dir: Path):
        """'build/' exclusion should not match 'rebuild/' directory."""
        rebuild_doc = project_dir / "rebuild" / "notes.md"
        rebuild_doc.parent.mkdir(parents=True, exist_ok=True)
        rebuild_doc.write_text("---\ntitle: Rebuild Notes\n---\n# Rebuild\n")

        index = build_project_index(project_dir)
        paths = {d["path"] for d in index["docs"]}
        assert "rebuild/notes.md" in paths, (
            f"rebuild/notes.md should NOT be excluded. Got: {paths}"
        )


# ---------------------------------------------------------------------------
# Embeddings (conditional)
# ---------------------------------------------------------------------------


class TestEmbeddings:
    """Test embeddings build — skipped if fastembed not installed."""

    @pytest.fixture(autouse=True)
    def check_fastembed(self):
        try:
            from tools.doc_index.embeddings import FASTEMBED_AVAILABLE
            if not FASTEMBED_AVAILABLE:
                pytest.skip("fastembed not installed")
        except ImportError:
            pytest.skip("fastembed not installed")

    def test_embeddings_built(self, project_dir: Path):
        """build_project_index should create embeddings when fastembed available."""
        build_project_index(project_dir)

        emb_path = project_dir / ".cade" / "doc-index-embeddings.json"
        assert emb_path.exists(), "Embeddings file not created"

        data = json.loads(emb_path.read_text())
        assert len(data) > 0, "Embeddings should have entries"

    def test_embeddings_search(self, project_dir: Path):
        """Embedding search should return ranked results."""
        from tools.doc_index.embeddings import (
            load_embeddings,
            embedding_search,
        )
        from tools.doc_index.config import load_config

        build_project_index(project_dir)

        config = load_config(project_dir)
        emb_path = project_dir / ".cade" / "doc-index-embeddings.json"
        emb_data = load_embeddings(emb_path)

        index_path = project_dir / ".cade" / "doc-index.json"
        index = json.loads(index_path.read_text())

        model = config.get("embedding_model", "BAAI/bge-small-en-v1.5")
        results = embedding_search(
            "authentication security", emb_data, index["docs"],
            model_name=model, top=5,
        )
        assert len(results) > 0, "Embedding search should return results"

    def test_embeddings_cached_on_rebuild(self, project_dir: Path):
        """Second build should reuse cached embeddings."""
        build_project_index(project_dir)

        emb_path = project_dir / ".cade" / "doc-index-embeddings.json"
        first_data = json.loads(emb_path.read_text())

        # Rebuild — should use cache
        build_project_index(project_dir)
        second_data = json.loads(emb_path.read_text())

        assert len(first_data) == len(second_data)
