"""Tests for FileToolExecutor — covers read_file, read_files, list_directory.

Write/edit/delete paths are integration-tested via the permission flow
elsewhere; these tests focus on the read-side tools and argument handling.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.tools.file_tools import (
    _ALL_DEFINITIONS,
    _READ_FILES_TOTAL_CAP,
    _READ_ONLY_COUNT,
    FileToolExecutor,
)


@pytest.fixture
def executor(temp_dir: Path) -> FileToolExecutor:
    return FileToolExecutor(temp_dir, connection_id="test-conn")


class TestToolDefinitions:
    async def test_read_only_count_covers_expected_tools(self):
        names = [d.name for d in _ALL_DEFINITIONS[:_READ_ONLY_COUNT]]
        assert "read_file" in names
        assert "read_files" in names
        assert "list_directory" in names

    async def test_write_tools_come_after_read_tools(self):
        write_names = {"write_file", "edit_file", "delete_file"}
        for i, defn in enumerate(_ALL_DEFINITIONS):
            if defn.name in write_names:
                assert i >= _READ_ONLY_COUNT, (
                    f"{defn.name} must come after read-only tools so mode "
                    "filtering works"
                )


class TestReadFile:
    async def test_reads_whole_file(self, executor, temp_dir):
        p = temp_dir / "a.txt"
        p.write_text("line1\nline2\nline3\n")
        out = await executor.execute_async("read_file", {"path": "a.txt"})
        assert "1\tline1" in out
        assert "3\tline3" in out

    async def test_offset_and_limit(self, executor, temp_dir):
        p = temp_dir / "a.txt"
        p.write_text("\n".join(f"l{i}" for i in range(1, 11)))
        out = await executor.execute_async("read_file", {
            "path": "a.txt", "offset": 3, "limit": 2,
        })
        assert "3\tl3" in out
        assert "4\tl4" in out
        assert "l5" not in out
        assert "l2" not in out

    async def test_missing_file_returns_error(self, executor):
        out = await executor.execute_async("read_file", {"path": "nope.txt"})
        assert out.startswith("Error:")
        assert "not found" in out


class TestReadFiles:
    async def test_reads_multiple_files(self, executor, temp_dir):
        (temp_dir / "a.txt").write_text("alpha\n")
        (temp_dir / "b.txt").write_text("beta\n")
        out = await executor.execute_async("read_files", {
            "paths": ["a.txt", "b.txt"],
        })
        assert "===== " in out
        assert "a.txt" in out
        assert "b.txt" in out
        assert "1\talpha" in out
        assert "1\tbeta" in out

    async def test_missing_files_reported_not_fatal(self, executor, temp_dir):
        (temp_dir / "a.txt").write_text("alpha\n")
        out = await executor.execute_async("read_files", {
            "paths": ["a.txt", "ghost.txt"],
        })
        assert "1\talpha" in out
        assert "=== missing ===" in out
        assert "ghost.txt" in out

    async def test_empty_paths_is_error(self, executor):
        out = await executor.execute_async("read_files", {"paths": []})
        assert out.startswith("Error:")

    async def test_offset_and_limit_apply_per_file(self, executor, temp_dir):
        content = "\n".join(f"l{i}" for i in range(1, 11))
        (temp_dir / "a.txt").write_text(content)
        (temp_dir / "b.txt").write_text(content)
        out = await executor.execute_async("read_files", {
            "paths": ["a.txt", "b.txt"], "offset": 2, "limit": 2,
        })
        # Each file shows lines 2-3
        assert out.count("2\tl2") == 2
        assert out.count("3\tl3") == 2
        assert "l1" not in out
        assert "l5" not in out

    async def test_truncation_marker_when_cap_exceeded(self, executor, temp_dir):
        # Write three files where the second pushes past the cap
        big = "x" * (_READ_FILES_TOTAL_CAP // 2 + 1000)
        (temp_dir / "a.txt").write_text(big)
        (temp_dir / "b.txt").write_text(big)
        (temp_dir / "c.txt").write_text("small\n")
        out = await executor.execute_async("read_files", {
            "paths": ["a.txt", "b.txt", "c.txt"],
        })
        assert "(truncated)" in out
        assert "c.txt" not in out or "===== " + str(temp_dir / "c.txt") not in out


class TestMultiEdit:
    async def test_applies_edits_in_order(self, executor, temp_dir):
        p = temp_dir / "f.py"
        p.write_text("alpha\nbeta\ngamma\n")
        out = await executor.execute_async("multi_edit", {
            "path": "f.py",
            "edits": [
                {"old_str": "alpha", "new_str": "ALPHA"},
                {"old_str": "beta",  "new_str": "BETA"},
            ],
        })
        assert "2 edit(s)" in out
        assert p.read_text() == "ALPHA\nBETA\ngamma\n"

    async def test_atomic_failure_no_partial_write(self, executor, temp_dir):
        p = temp_dir / "f.py"
        original = "alpha\nbeta\ngamma\n"
        p.write_text(original)
        out = await executor.execute_async("multi_edit", {
            "path": "f.py",
            "edits": [
                {"old_str": "alpha",   "new_str": "ALPHA"},
                {"old_str": "MISSING", "new_str": "X"},   # will fail
            ],
        })
        assert "Error" in out
        assert "edit 2" in out
        assert p.read_text() == original  # unchanged

    async def test_ambiguous_old_str_returns_error(self, executor, temp_dir):
        p = temp_dir / "f.py"
        p.write_text("foo\nfoo\nbar\n")
        out = await executor.execute_async("multi_edit", {
            "path": "f.py",
            "edits": [{"old_str": "foo", "new_str": "baz"}],
        })
        assert "Error" in out
        assert "ambiguous" in out

    async def test_second_edit_sees_first_edit_result(self, executor, temp_dir):
        p = temp_dir / "f.py"
        p.write_text("original\n")
        out = await executor.execute_async("multi_edit", {
            "path": "f.py",
            "edits": [
                {"old_str": "original", "new_str": "step1"},
                {"old_str": "step1",    "new_str": "step2"},
            ],
        })
        assert "2 edit(s)" in out
        assert p.read_text() == "step2\n"

    async def test_empty_edits_is_error(self, executor, temp_dir):
        (temp_dir / "f.py").write_text("x\n")
        out = await executor.execute_async("multi_edit", {"path": "f.py", "edits": []})
        assert out.startswith("Error:")

    async def test_missing_file_is_error(self, executor):
        out = await executor.execute_async("multi_edit", {
            "path": "ghost.py",
            "edits": [{"old_str": "x", "new_str": "y"}],
        })
        assert out.startswith("Error:")


class TestMoveFile:
    async def test_moves_file(self, executor, temp_dir):
        src = temp_dir / "a.txt"
        src.write_text("hello")
        out = await executor.execute_async("move_file", {"src": "a.txt", "dst": "b.txt"})
        assert "Moved" in out
        assert not src.exists()
        assert (temp_dir / "b.txt").read_text() == "hello"

    async def test_renames_into_subdirectory(self, executor, temp_dir):
        src = temp_dir / "a.txt"
        src.write_text("data")
        out = await executor.execute_async("move_file", {"src": "a.txt", "dst": "sub/a.txt"})
        assert "Moved" in out
        assert (temp_dir / "sub" / "a.txt").read_text() == "data"

    async def test_creates_parent_dirs(self, executor, temp_dir):
        (temp_dir / "a.txt").write_text("x")
        await executor.execute_async("move_file", {"src": "a.txt", "dst": "new/deep/a.txt"})
        assert (temp_dir / "new" / "deep" / "a.txt").exists()

    async def test_missing_source_is_error(self, executor):
        out = await executor.execute_async("move_file", {"src": "nope.txt", "dst": "out.txt"})
        assert out.startswith("Error:")
        assert "not found" in out

    async def test_directory_destination_is_error(self, executor, temp_dir):
        (temp_dir / "a.txt").write_text("x")
        (temp_dir / "subdir").mkdir()
        out = await executor.execute_async("move_file", {"src": "a.txt", "dst": "subdir"})
        assert out.startswith("Error:")


class TestListDirectory:
    async def test_lists_entries(self, executor, temp_dir):
        (temp_dir / "file.txt").write_text("x")
        (temp_dir / "sub").mkdir()
        out = await executor.execute_async("list_directory", {})
        assert "file.txt" in out
        assert "sub/" in out
