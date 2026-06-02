"""Shared pytest fixtures for CADE backend tests."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Generator

import pytest


@pytest.fixture(autouse=True)
def _isolate_global_state(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    """Reset process-wide singletons and opt out of CLI orchestrator wiring.

    Without this, any test that drives a connection's ``_setup`` would read the
    developer's real ``~/.cade/providers.toml`` (which may declare a Minimax
    worker), flip on autonomous permissions, and write a real MCP config under
    ``~/.cade`` — coupling unrelated tests to local machine state and leaking
    permission flags into later tests. Tests that exercise the wiring re-enable
    it by clearing ``CADE_CLI_ORCHESTRATOR`` themselves.
    """
    monkeypatch.setenv("CADE_CLI_ORCHESTRATOR", "false")

    import backend.orchestrator.manager as orch_mod
    import backend.permissions.manager as perm_mod
    import core.backend.providers.config as providers_mod

    for mod, attr in (
        (perm_mod, "_manager"),
        (orch_mod, "_instance"),
        (providers_mod, "_providers_config"),
    ):
        setattr(mod, attr, None)
    try:
        yield
    finally:
        for mod, attr in (
            (perm_mod, "_manager"),
            (orch_mod, "_instance"),
            (providers_mod, "_providers_config"),
        ):
            setattr(mod, attr, None)


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_wsl_path() -> Path:
    """Return a mock WSL-mounted Windows path."""
    return Path("/mnt/c/Users/testuser/Documents/project")


@pytest.fixture
def mock_native_path() -> Path:
    """Return a mock native Linux path."""
    return Path("/home/testuser/project")
