"""Tests for build_graph_message and the /api/memory/graph endpoint."""

from __future__ import annotations

import json
import sqlite3
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from backend.config import Config, set_config
from backend.main import create_app
from backend.terminal.sessions import SessionRegistry, set_registry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def test_config(temp_dir: Path) -> Config:
    return Config(
        port=0,
        host="127.0.0.1",
        working_dir=temp_dir,
        shell_command="bash",
        auto_start_claude=False,
        auto_open_browser=False,
        dummy_mode=True,
    )


@pytest.fixture
def app(test_config: Config, temp_dir: Path):
    set_config(test_config)
    registry = SessionRegistry()
    set_registry(registry)
    return create_app(test_config)


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture
def project_with_graph(tmp_path: Path) -> Path:
    """Create a minimal project with .cade/graph.ttl and knowledge_base.db."""
    cade_dir = tmp_path / ".cade"
    cade_dir.mkdir()
    staging_dir = cade_dir / "staging"
    staging_dir.mkdir()

    # Minimal graph.ttl (just needs to exist)
    (cade_dir / "graph.ttl").write_text("# placeholder\n", encoding="utf-8")

    # SQLite DB with one symbol
    db_path = staging_dir / "knowledge_base.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE files (id INTEGER PRIMARY KEY, repository_name TEXT, "
        "path TEXT, hash TEXT DEFAULT '', lang TEXT DEFAULT 'python', "
        "stable_id TEXT, tombstoned_at TEXT)"
    )
    conn.execute(
        "CREATE TABLE symbols (id INTEGER PRIMARY KEY, repository_name TEXT, "
        "fqn TEXT, kind TEXT, file_id INTEGER, line_start INTEGER, line_end INTEGER, "
        "byte_start INTEGER DEFAULT 0, byte_end INTEGER DEFAULT 0, "
        "signature_json TEXT DEFAULT '{}', doc_hash TEXT DEFAULT '', "
        "stable_id TEXT, tombstoned_at TEXT)"
    )
    conn.execute(
        "INSERT INTO files VALUES (1, 'default', 'backend/auth.py', 'abc', 'python', NULL, NULL)"
    )
    conn.execute(
        "INSERT INTO symbols VALUES (1, 'default', 'backend.auth.AuthService', 'class', "
        "1, 10, 100, 0, 0, '{}', '', 'abc123', NULL)"
    )
    conn.commit()
    conn.close()

    # Memory file
    memory_dir = cade_dir / "memory"
    memory_dir.mkdir()
    (memory_dir / "2026-05-01-use-jwt.md").write_text(
        textwrap.dedent("""\
            ---
            type: decision
            applies_to:
              - "[[AuthService]]"
            authored_by: "agent:claude"
            created: "2026-05-01"
            tags:
              - auth
            ---

            JWT chosen over session tokens for stateless auth.
        """),
        encoding="utf-8",
    )
    return tmp_path


# ---------------------------------------------------------------------------
# Unit tests for build_graph_message
# ---------------------------------------------------------------------------

class TestBuildGraphMessage:
    def test_empty_when_no_graph_file(self, tmp_path: Path):
        from backend.memory.api import build_graph_message
        result = build_graph_message(tmp_path)
        assert result["type"] == "nkrdn-graph"
        assert result["modules"] == []
        assert result["stats"]["symbols"] == 0

    def test_empty_when_nkrdn_not_found(self, project_with_graph: Path):
        from backend.memory.api import build_graph_message
        with patch("shutil.which", return_value=None):
            result = build_graph_message(project_with_graph)
        assert result["modules"] == []

    def test_empty_when_nkrdn_returns_empty_list(self, project_with_graph: Path):
        from backend.memory.api import build_graph_message
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="[]")
            result = build_graph_message(project_with_graph)
        assert result["modules"] == []

    def test_builds_module_tree_for_resolved_entry(self, project_with_graph: Path):
        """An entry with a resolved applies_to URI should appear in the module tree."""
        from backend.memory.api import build_graph_message

        nkrdn_output = json.dumps([{
            "uri": "http://nkrdn.knowledge/memory#2026-05-01-use-jwt",
            "type": "decision",
            "content": "JWT chosen over session tokens.",
            "tags": ["auth"],
            "authored_by": "agent:claude",
            "applies_to": [
                "http://nkrdn.knowledge/code#repo/default/class/abc123"
            ],
            "source_file": str(
                project_with_graph / ".cade" / "memory" / "2026-05-01-use-jwt.md"
            ),
            "archived": False,
        }])

        with patch("subprocess.run") as mock_run, patch("shutil.which", return_value="/usr/local/bin/nkrdn"):
            mock_run.return_value = MagicMock(returncode=0, stdout=nkrdn_output)
            result = build_graph_message(project_with_graph)

        assert result["type"] == "nkrdn-graph"
        assert result["stats"]["symbols"] == 1
        assert result["stats"]["memories"] == 1
        assert len(result["modules"]) == 1

        module = result["modules"][0]
        assert module["name"] == "backend"
        assert len(module["children"]) == 1
        sym = module["children"][0]
        assert sym["name"] == "AuthService"
        assert sym["kind"] == "class"
        assert len(sym["memories"]) == 1
        mem = sym["memories"][0]
        assert mem["type"] == "decision"
        assert mem["title"] == "use jwt"  # derived from filename stem

    def test_orphan_for_unresolved_entry(self, project_with_graph: Path):
        """An entry with no matching symbol goes into orphans."""
        from backend.memory.api import build_graph_message

        nkrdn_output = json.dumps([{
            "uri": "http://nkrdn.knowledge/memory#2026-05-01-orphan",
            "type": "note",
            "content": "Orphaned note.",
            "tags": [],
            "authored_by": "agent:claude",
            "applies_to": [],
            "source_file": str(
                project_with_graph / ".cade" / "memory" / "2026-05-01-use-jwt.md"
            ),
            "archived": False,
        }])

        with patch("subprocess.run") as mock_run, patch("shutil.which", return_value="/usr/local/bin/nkrdn"):
            mock_run.return_value = MagicMock(returncode=0, stdout=nkrdn_output)
            # Inject an unresolved_link so it counts as orphan
            import backend.memory.api as api_mod
            orig_enrich = api_mod._enrich_entry

            def enrich_with_unresolved(raw):
                e = orig_enrich(raw)
                e["unresolved_links"] = ["OldAuthService"]
                return e

            with patch.object(api_mod, "_enrich_entry", side_effect=enrich_with_unresolved):
                result = build_graph_message(project_with_graph)

        assert result["stats"]["orphans"] == 1
        assert result["orphans"][0]["applies_to_name"] == "OldAuthService"


# ---------------------------------------------------------------------------
# Unit tests for retarget_memory
# ---------------------------------------------------------------------------

class TestRetargetMemory:
    def test_retarget_updates_applies_to(self, tmp_path: Path):
        from backend.memory.api import retarget_memory

        memory_dir = tmp_path / ".cade" / "memory"
        memory_dir.mkdir(parents=True)
        md_file = memory_dir / "2026-05-01-use-jwt.md"
        md_file.write_text(
            textwrap.dedent("""\
                ---
                type: decision
                applies_to:
                  - "[[OldAuthService]]"
                created: "2026-05-01"
                ---

                Some body text.
            """),
            encoding="utf-8",
        )

        uri = "http://nkrdn.knowledge/memory#2026-05-01-use-jwt"
        retarget_memory(tmp_path, uri, "NewAuthService")

        text = md_file.read_text(encoding="utf-8")
        assert "NewAuthService" in text
        assert "OldAuthService" not in text

    def test_retarget_raises_for_missing_file(self, tmp_path: Path):
        from backend.memory.api import retarget_memory

        (tmp_path / ".cade" / "memory").mkdir(parents=True)
        with pytest.raises(FileNotFoundError):
            retarget_memory(tmp_path, "http://nkrdn.knowledge/memory#nonexistent", "SomeSym")


# ---------------------------------------------------------------------------
# Endpoint tests
# ---------------------------------------------------------------------------

class TestMemoryGraphEndpoint:
    def test_returns_empty_for_nonexistent_project(self, client: TestClient, tmp_path: Path):
        res = client.post(
            "/api/memory/graph",
            json={"project": str(tmp_path / "no-such-dir")},
        )
        assert res.status_code == 400

    def test_returns_empty_message_for_project_without_graph(
        self, client: TestClient, tmp_path: Path
    ):
        res = client.post("/api/memory/graph", json={"project": str(tmp_path)})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "nkrdn-graph"
        assert data["modules"] == []


class TestMemoryArchiveEndpoint:
    def test_returns_503_when_nkrdn_unavailable(self, client: TestClient, tmp_path: Path):
        with patch("backend.nkrdn_service._NKRDN_BIN", None):
            res = client.post(
                "/api/memory/archive",
                json={"project": str(tmp_path), "uri": "http://nkrdn.knowledge/memory#foo"},
            )
        assert res.status_code == 503

    def test_returns_400_for_invalid_project(self, client: TestClient, tmp_path: Path):
        with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"):
            res = client.post(
                "/api/memory/archive",
                json={
                    "project": str(tmp_path / "no-such-dir"),
                    "uri": "http://nkrdn.knowledge/memory#foo",
                },
            )
        assert res.status_code == 400

    def test_invokes_nkrdn_retire_on_success(self, client: TestClient, tmp_path: Path):
        from unittest.mock import AsyncMock

        proc = MagicMock()
        proc.returncode = 0
        proc.communicate = AsyncMock(return_value=(b"", b""))

        async def fake_exec(*args, **kwargs):
            fake_exec.captured = args
            return proc

        uri = "http://nkrdn.knowledge/memory#2026-05-05-test-decision"

        with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
             patch("asyncio.create_subprocess_exec", fake_exec):
            res = client.post(
                "/api/memory/archive",
                json={"project": str(tmp_path), "uri": uri},
            )

        assert res.status_code == 200
        assert res.json() == {"ok": True}
        assert fake_exec.captured == ("/usr/bin/nkrdn", "memory", "retire", uri)

    def test_returns_502_when_nkrdn_retire_fails(self, client: TestClient, tmp_path: Path):
        from unittest.mock import AsyncMock

        proc = MagicMock()
        proc.returncode = 1
        proc.communicate = AsyncMock(return_value=(b"", b"no such memory"))

        async def fake_exec(*args, **kwargs):
            return proc

        with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
             patch("asyncio.create_subprocess_exec", fake_exec):
            res = client.post(
                "/api/memory/archive",
                json={
                    "project": str(tmp_path),
                    "uri": "http://nkrdn.knowledge/memory#bogus",
                },
            )

        assert res.status_code == 502
        body = res.json()
        assert body["error"] == "retire failed"
        assert "no such memory" in body["stderr"]
