"""Tests for WSL path detection.

Linux/macOS tests run natively on those platforms.
Windows/WSL tests are mocked and only run on Windows (or are skipped).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.hooks.wsl_path import get_wsl_settings_path


# ---------------------------------------------------------------------------
# Native platform tests (Linux / macOS) — run on the actual platform
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform == "win32", reason="Linux/macOS only")
class TestNativePlatform:
    """Tests for native Linux/macOS path resolution."""

    def test_returns_home_claude_path(self) -> None:
        """Should return ~/.claude/settings.json on Linux/macOS."""
        path, is_wsl = get_wsl_settings_path()

        assert path == Path.home() / ".claude" / "settings.json"
        assert is_wsl is False


# ---------------------------------------------------------------------------
# Windows/WSL tests — mocked, skip on non-Windows
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform != "win32", reason="Windows-only WSL tests")
class TestWindowsWslPath:
    """Tests for Windows WSL path detection — only run on Windows."""

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_with_wsl(self, mock_run: MagicMock) -> None:
        """Windows writes to WSL UNC path when WSL is available."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="Ubuntu\n"),
            MagicMock(returncode=0, stdout="testuser\n"),
        ]

        path, is_wsl = get_wsl_settings_path()

        assert "wsl$" in str(path).lower() or "wsl.localhost" in str(path).lower()
        assert "Ubuntu" in str(path)
        assert "testuser" in str(path)
        assert ".claude" in str(path)
        assert is_wsl is True

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_no_wsl_distro(self, mock_run: MagicMock) -> None:
        """Windows falls back when no WSL distro found."""
        mock_run.return_value = MagicMock(returncode=0, stdout="\n\n")

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_wsl_command_fails(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL command fails."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_wsl_timeout(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL command times out."""
        import subprocess

        mock_run.side_effect = subprocess.TimeoutExpired(cmd="wsl", timeout=5)

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_wsl_not_installed(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL is not installed."""
        mock_run.side_effect = FileNotFoundError()

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.run_silent")
    def test_windows_wsl_whoami_fails(self, mock_run: MagicMock) -> None:
        """Windows falls back when getting WSL username fails."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="Ubuntu\n"),
            MagicMock(returncode=1, stdout=""),
        ]

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False
