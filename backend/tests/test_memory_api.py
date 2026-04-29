"""Tests for the /api/memory/search endpoint.

The endpoint shells out to `nkrdn memory search` via asyncio. These tests
mock the subprocess so they don't depend on a real nkrdn install or graph.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from backend.config import Config, set_config
from backend.main import create_app
from backend.terminal.sessions import SessionRegistry, set_registry


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
def app(test_config: Config):
    set_config(test_config)
    set_registry(SessionRegistry())
    with patch("backend.main.unify_sessions"):
        with patch("backend.main._check_wsl_health_async", new_callable=AsyncMock):
            yield create_app(test_config)
    set_registry(SessionRegistry())


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


def _mock_proc(stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0):
    """Build a fake asyncio subprocess whose .communicate() returns our bytes."""
    proc = MagicMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    return proc


# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------

def test_returns_503_when_nkrdn_not_installed(client: TestClient, temp_dir: Path):
    with patch("backend.nkrdn_service._NKRDN_BIN", None):
        resp = client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "anything",
        })
    assert resp.status_code == 503
    assert "nkrdn CLI not available" in resp.json()["error"]


def test_returns_400_when_project_path_invalid(client: TestClient, tmp_path: Path):
    nonexistent = tmp_path / "nope"
    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"):
        resp = client.post("/api/memory/search", json={
            "project": str(nonexistent),
            "query": "x",
        })
    assert resp.status_code == 400
    assert "not a directory" in resp.json()["error"]


def test_subprocess_nonzero_exit_returns_502(client: TestClient, temp_dir: Path):
    proc = _mock_proc(stdout=b"", stderr=b"boom", returncode=1)
    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
            patch("asyncio.create_subprocess_exec",
                  AsyncMock(return_value=proc)):
        resp = client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "x",
        })
    assert resp.status_code == 502
    payload = resp.json()
    assert payload["exit_code"] == 1
    assert "boom" in payload["stderr"]


def test_unparseable_stdout_returns_502(client: TestClient, temp_dir: Path):
    proc = _mock_proc(stdout=b"not json", returncode=0)
    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
            patch("asyncio.create_subprocess_exec",
                  AsyncMock(return_value=proc)):
        resp = client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "x",
        })
    assert resp.status_code == 502
    assert "not json" in resp.json()["raw"]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_successful_search_returns_parsed_payload(client: TestClient, temp_dir: Path):
    expected = {
        "query": "auth jwt",
        "rounds": 0,
        "memories": [
            {"uri": "mem:#d-1", "type": "decision", "score": 0.84,
             "content": "Use JWT", "tags": ["auth"]},
        ],
    }
    proc = _mock_proc(stdout=json.dumps(expected).encode("utf-8"))

    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
            patch("asyncio.create_subprocess_exec",
                  AsyncMock(return_value=proc)) as mock_exec:
        resp = client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "auth jwt",
        })

    assert resp.status_code == 200
    assert resp.json() == expected

    # Verify the subprocess was invoked with the expected arguments.
    args, kwargs = mock_exec.call_args
    assert args[0] == "/usr/bin/nkrdn"
    assert "memory" in args
    assert "search" in args
    assert "auth jwt" in args
    assert "--json" in args
    assert "--direct" in args  # default direct=True
    assert kwargs["cwd"] == str(temp_dir.resolve())


def test_uri_filter_is_passed_through(client: TestClient, temp_dir: Path):
    proc = _mock_proc(stdout=b'{"query":"x","rounds":0,"memories":[]}')
    target_uri = "http://nkrdn.knowledge/code#repo/x/Class/y"

    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
            patch("asyncio.create_subprocess_exec",
                  AsyncMock(return_value=proc)) as mock_exec:
        client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "x",
            "uri": target_uri,
            "limit": 5,
        })

    args, _ = mock_exec.call_args
    assert "--uri" in args
    assert target_uri in args
    assert "--limit" in args
    assert "5" in args


def test_direct_false_omits_flag_and_runs_llm_path(client: TestClient, temp_dir: Path):
    proc = _mock_proc(stdout=b'{"query":"x","rounds":2,"memories":[]}')

    with patch("backend.nkrdn_service._NKRDN_BIN", "/usr/bin/nkrdn"), \
            patch("asyncio.create_subprocess_exec",
                  AsyncMock(return_value=proc)) as mock_exec:
        client.post("/api/memory/search", json={
            "project": str(temp_dir),
            "query": "x",
            "direct": False,
        })

    args, _ = mock_exec.call_args
    assert "--direct" not in args
