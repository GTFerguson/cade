"""Shared pytest fixtures for ccplus backend tests."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Generator

import pytest


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
