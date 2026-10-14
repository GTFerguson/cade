"""Tests for the flat file listing and per-file git diff used by mobile."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.errors import FileError
from backend.files.diff import file_diff
from backend.files.listing import list_project_files


def _git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(root), *args], check=True,
        capture_output=True,
        env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
             "GIT_COMMITTER_EMAIL": "t@t", "HOME": str(root), "PATH": "/usr/bin:/bin"},
    )


class TestListing:
    def test_lists_files_relative_and_sorted(self, temp_dir: Path):
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "b.py").write_text("")
        (temp_dir / "a.md").write_text("")
        files, truncated = list_project_files(temp_dir)
        assert files == ["a.md", "src/b.py"]
        assert truncated is False

    def test_skips_ignored_dirs_and_gitignore(self, temp_dir: Path):
        (temp_dir / "node_modules" / "x").mkdir(parents=True)
        (temp_dir / "node_modules" / "x" / "index.js").write_text("")
        (temp_dir / "build").mkdir()
        (temp_dir / "build" / "out.o").write_text("")
        (temp_dir / "secret.log").write_text("")
        (temp_dir / ".gitignore").write_text("*.log\nsecret.log\n")
        (temp_dir / "keep.py").write_text("")
        files, _ = list_project_files(temp_dir)
        assert files == [".gitignore", "keep.py"]

    def test_truncates_at_limit(self, temp_dir: Path):
        for i in range(5):
            (temp_dir / f"f{i}.txt").write_text("")
        files, truncated = list_project_files(temp_dir, limit=3)
        assert len(files) == 3
        assert truncated is True


class TestDiff:
    @pytest.mark.asyncio
    async def test_modified_tracked_file(self, temp_dir: Path):
        _git(temp_dir, "init", "-q")
        (temp_dir / "a.txt").write_text("one\n")
        _git(temp_dir, "add", "a.txt")
        _git(temp_dir, "commit", "-q", "-m", "init")
        (temp_dir / "a.txt").write_text("one\ntwo\n")

        result = await file_diff(temp_dir, "a.txt")
        assert result["untracked"] is False
        assert "+two" in result["diff"]
        assert "error" not in result

    @pytest.mark.asyncio
    async def test_untracked_file_shows_as_additions(self, temp_dir: Path):
        _git(temp_dir, "init", "-q")
        (temp_dir / "new.txt").write_text("hello\n")
        result = await file_diff(temp_dir, "new.txt")
        assert result["untracked"] is True
        assert "+hello" in result["diff"]

    @pytest.mark.asyncio
    async def test_unchanged_file_has_empty_diff(self, temp_dir: Path):
        _git(temp_dir, "init", "-q")
        (temp_dir / "a.txt").write_text("one\n")
        _git(temp_dir, "add", "a.txt")
        _git(temp_dir, "commit", "-q", "-m", "init")
        result = await file_diff(temp_dir, "a.txt")
        assert result["diff"] == ""

    @pytest.mark.asyncio
    async def test_outside_git_reports_error(self, temp_dir: Path):
        (temp_dir / "a.txt").write_text("one\n")
        result = await file_diff(temp_dir, "a.txt")
        assert result["error"] == "not a git repository"

    @pytest.mark.asyncio
    async def test_rejects_paths_outside_root(self, temp_dir: Path):
        with pytest.raises(FileError):
            await file_diff(temp_dir, "../etc/passwd")
