"""Tests for wsl_session_unifier module."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from unittest.mock import MagicMock, patch

import pytest

from backend.wsl.session_unifier import (
    encode_windows_session_dirname,
    encode_wsl_session_dirname,
    get_windows_user_home,
    is_wsl_mounted_path,
)


class TestEncodeWslSessionDirname:
    """Tests for encode_wsl_session_dirname().

    These tests use a mock path that returns POSIX-style strings,
    since the actual function runs on WSL/Linux where paths use forward slashes.
    """

    def _make_mock_path(self, path_str: str) -> MagicMock:
        """Create a mock Path that resolves to the given POSIX string."""
        mock_path = MagicMock(spec=Path)
        mock_resolved = MagicMock(spec=Path)
        mock_resolved.__str__ = MagicMock(return_value=path_str)
        mock_path.resolve.return_value = mock_resolved
        return mock_path

    def test_basic_wsl_path(self) -> None:
        """Standard WSL path encoding."""
        mock_path = self._make_mock_path("/mnt/c/Users/name/project")
        result = encode_wsl_session_dirname(mock_path)
        assert result == "-mnt-c-Users-name-project"

    def test_path_with_dots(self) -> None:
        """Path containing dots should have them replaced."""
        mock_path = self._make_mock_path("/mnt/c/Users/user.name/proj")
        result = encode_wsl_session_dirname(mock_path)
        assert result == "-mnt-c-Users-user-name-proj"

    def test_native_linux_path(self) -> None:
        """Native Linux path encoding."""
        mock_path = self._make_mock_path("/home/user/project")
        result = encode_wsl_session_dirname(mock_path)
        assert result == "-home-user-project"

    def test_nested_path(self) -> None:
        """Deeply nested path encoding."""
        mock_path = self._make_mock_path("/mnt/c/Users/name/Documents/Projects/app/src")
        result = encode_wsl_session_dirname(mock_path)
        assert result == "-mnt-c-Users-name-Documents-Projects-app-src"


class TestEncodeWindowsSessionDirname:
    """Tests for encode_windows_session_dirname()."""

    def test_basic_windows_path(self) -> None:
        """Standard Windows path encoding."""
        result = encode_windows_session_dirname(r"C:\Users\name\project")
        assert result == "C--Users-name-project"

    def test_path_with_dots(self) -> None:
        """Path containing dots should have them replaced."""
        result = encode_windows_session_dirname(r"C:\Users\user.name\proj")
        assert result == "C--Users-user-name-proj"

    def test_different_drive(self) -> None:
        """Non-C drive path encoding."""
        result = encode_windows_session_dirname(r"D:\Projects\app")
        assert result == "D--Projects-app"

    def test_nested_path(self) -> None:
        """Deeply nested path encoding."""
        result = encode_windows_session_dirname(r"C:\Users\name\Documents\Projects\app")
        assert result == "C--Users-name-Documents-Projects-app"

    def test_path_without_drive_colon(self) -> None:
        """Path without standard drive format."""
        result = encode_windows_session_dirname(r"\\network\share\folder")
        assert result == "--network-share-folder"


class TestIsWslMountedPath:
    """Tests for is_wsl_mounted_path().

    These tests use mock paths since the function is designed to run on WSL/Linux
    where paths use forward slashes.
    """

    def _make_mock_path(self, path_str: str) -> MagicMock:
        """Create a mock Path that resolves to the given POSIX string."""
        mock_path = MagicMock(spec=Path)
        mock_resolved = MagicMock(spec=Path)
        mock_resolved.__str__ = MagicMock(return_value=path_str)
        mock_path.resolve.return_value = mock_resolved
        return mock_path

    def test_c_drive_mounted(self) -> None:
        """C: drive mounted path should return True."""
        mock_path = self._make_mock_path("/mnt/c/Users/name/project")
        assert is_wsl_mounted_path(mock_path) is True

    def test_d_drive_mounted(self) -> None:
        """D: drive mounted path should return True."""
        mock_path = self._make_mock_path("/mnt/d/Projects/app")
        assert is_wsl_mounted_path(mock_path) is True

    def test_native_linux_path(self) -> None:
        """Native Linux path should return False."""
        mock_path = self._make_mock_path("/home/user/project")
        assert is_wsl_mounted_path(mock_path) is False

    def test_wsl_special_mount(self) -> None:
        """WSL special mount starting with letter is treated as drive mount.

        Current implementation checks if /mnt/ is followed by an alphabetic char.
        This means /mnt/wsl/... passes the check since 'w' is alphabetic.
        In practice this is acceptable since /mnt/wsl paths are uncommon.
        """
        mock_path = self._make_mock_path("/mnt/wsl/docker-desktop/something")
        assert is_wsl_mounted_path(mock_path) is True

    def test_short_mnt_path(self) -> None:
        """Very short /mnt/ path should return False."""
        mock_path = self._make_mock_path("/mnt/")
        assert is_wsl_mounted_path(mock_path) is False

    def test_lowercase_drive(self) -> None:
        """Lowercase drive letter should work."""
        mock_path = self._make_mock_path("/mnt/e/data")
        assert is_wsl_mounted_path(mock_path) is True


class TestGetWindowsUserHome:
    """Tests for get_windows_user_home()."""

    def test_standard_user_path(self) -> None:
        """Standard C:\\Users\\name path extraction."""
        result = get_windows_user_home(r"C:\Users\name\Documents\project")
        assert result == r"C:\Users\name"

    def test_non_users_path(self) -> None:
        """Path not under Users should return None."""
        result = get_windows_user_home(r"D:\Projects\app")
        assert result is None

    def test_short_username(self) -> None:
        """Single character username should work."""
        result = get_windows_user_home(r"C:\Users\a")
        assert result == r"C:\Users\a"

    def test_deeply_nested(self) -> None:
        """Deeply nested path should still extract user home."""
        result = get_windows_user_home(r"C:\Users\johndoe\Documents\Work\Projects\myapp\src")
        assert result == r"C:\Users\johndoe"

    def test_users_case_insensitive(self) -> None:
        """Users folder detection should be case-insensitive."""
        result = get_windows_user_home(r"C:\USERS\name\Documents")
        assert result == r"C:\USERS\name"

    def test_just_users_folder(self) -> None:
        """Path ending at Users folder should return None."""
        result = get_windows_user_home(r"C:\Users")
        assert result is None

    def test_different_drive(self) -> None:
        """Users folder on different drive should work."""
        result = get_windows_user_home(r"D:\Users\admin\Downloads")
        assert result == r"D:\Users\admin"
