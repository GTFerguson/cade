"""Tests for the hook script installer."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from backend.hooks.config import CADEHookOptions
from backend.hooks.installer import SCRIPT_FILENAME, install_hook_script


class TestInstallHookScript:
    """Tests for install_hook_script()."""

    def test_dry_run_returns_path_without_writing(self, temp_dir: Path) -> None:
        """Dry run returns the target path but creates no files."""
        options = CADEHookOptions()

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=True)

        assert path == temp_dir / "hooks" / SCRIPT_FILENAME
        assert not path.exists()

    def test_creates_hooks_directory(self, temp_dir: Path) -> None:
        """Installer creates the hooks/ directory if missing."""
        options = CADEHookOptions()

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        assert (temp_dir / "hooks").is_dir()
        assert path.exists()

    def test_writes_valid_python(self, temp_dir: Path) -> None:
        """Installed script is valid Python."""
        options = CADEHookOptions()

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        source = path.read_text(encoding="utf-8")
        compile(source, str(path), "exec")

    def test_plans_only_filter(self, temp_dir: Path) -> None:
        """Default options produce plans_only filter in the script."""
        options = CADEHookOptions(all_files=False)

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        source = path.read_text(encoding="utf-8")
        assert 'FILTER_MODE = "plans_only"' in source

    def test_all_files_filter(self, temp_dir: Path) -> None:
        """--all-files produces all_files filter in the script."""
        options = CADEHookOptions(all_files=True)

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        source = path.read_text(encoding="utf-8")
        assert 'FILTER_MODE = "all_files"' in source

    def test_overwrites_existing_script(self, temp_dir: Path) -> None:
        """Re-running installer overwrites the previous script."""
        hooks_dir = temp_dir / "hooks"
        hooks_dir.mkdir()
        old_script = hooks_dir / SCRIPT_FILENAME
        old_script.write_text("# old version")

        options = CADEHookOptions(all_files=True)

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        source = path.read_text(encoding="utf-8")
        assert "# old version" not in source
        assert "FILTER_MODE" in source

    def test_script_filename(self, temp_dir: Path) -> None:
        """Installed script has the expected filename."""
        options = CADEHookOptions()

        with patch("backend.hooks.installer.get_wsl_cade_dir", return_value=temp_dir):
            path = install_hook_script(options, dry_run=False)

        assert path.name == "view_file.py"
