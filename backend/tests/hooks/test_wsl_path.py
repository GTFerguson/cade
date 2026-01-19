"""Tests for WSL path detection."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.hooks.wsl_path import get_wsl_settings_path


class TestGetWslSettingsPath:
    """Tests for get_wsl_settings_path function."""

    @patch("backend.hooks.wsl_path.sys.platform", "linux")
    def test_linux_uses_home(self) -> None:
        """Linux uses ~/.claude/settings.json."""
        with patch.object(Path, "home", return_value=Path("/home/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("/home/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "darwin")
    def test_macos_uses_home(self) -> None:
        """macOS uses ~/.claude/settings.json."""
        with patch.object(Path, "home", return_value=Path("/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_with_wsl(self, mock_run: MagicMock) -> None:
        """Windows writes to WSL UNC path when WSL is available."""
        # Mock WSL distro list
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="Ubuntu\n"),  # wsl -l -q
            MagicMock(returncode=0, stdout="testuser\n"),  # wsl whoami
        ]

        path, is_wsl = get_wsl_settings_path()

        assert "wsl$" in str(path).lower() or "wsl.localhost" in str(path).lower()
        assert "Ubuntu" in str(path)
        assert "testuser" in str(path)
        assert ".claude" in str(path)
        assert is_wsl is True

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_no_wsl_distro(self, mock_run: MagicMock) -> None:
        """Windows falls back when no WSL distro found."""
        mock_run.return_value = MagicMock(returncode=0, stdout="\n\n")

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_wsl_command_fails(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL command fails."""
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_wsl_timeout(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL command times out."""
        import subprocess

        mock_run.side_effect = subprocess.TimeoutExpired(cmd="wsl", timeout=5)

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_wsl_not_installed(self, mock_run: MagicMock) -> None:
        """Windows falls back when WSL is not installed."""
        mock_run.side_effect = FileNotFoundError()

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False

    @patch("backend.hooks.wsl_path.sys.platform", "win32")
    @patch("backend.hooks.wsl_path.subprocess.run")
    def test_windows_wsl_whoami_fails(self, mock_run: MagicMock) -> None:
        """Windows falls back when getting WSL username fails."""
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="Ubuntu\n"),  # wsl -l -q succeeds
            MagicMock(returncode=1, stdout=""),  # wsl whoami fails
        ]

        with patch.object(Path, "home", return_value=Path("C:/Users/testuser")):
            path, is_wsl = get_wsl_settings_path()

        assert path == Path("C:/Users/testuser/.claude/settings.json")
        assert is_wsl is False
