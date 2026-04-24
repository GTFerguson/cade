"""Tests for DiscoveryToolExecutor — glob and grep."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.tools.discovery_tools import DiscoveryToolExecutor


@pytest.fixture
def executor(temp_dir: Path) -> DiscoveryToolExecutor:
    return DiscoveryToolExecutor(temp_dir)


@pytest.fixture
def populated(temp_dir: Path) -> Path:
    """A small tree of files for search tests."""
    (temp_dir / "src").mkdir()
    (temp_dir / "src" / "main.py").write_text("def hello():\n    return 'world'\n")
    (temp_dir / "src" / "utils.py").write_text("def helper():\n    pass\n# TODO: expand\n")
    (temp_dir / "docs").mkdir()
    (temp_dir / "docs" / "README.md").write_text("# Project\n\nhello world\n")
    (temp_dir / "config.json").write_text('{"key": "value"}\n')
    return temp_dir


class TestGlob:
    async def test_finds_python_files(self, executor, populated):
        out = await executor.execute_async("glob", {"pattern": "**/*.py"})
        assert "main.py" in out
        assert "utils.py" in out
        assert "README.md" not in out

    async def test_finds_md_files(self, executor, populated):
        out = await executor.execute_async("glob", {"pattern": "**/*.md"})
        assert "README.md" in out
        assert "main.py" not in out

    async def test_returns_relative_paths(self, executor, populated):
        out = await executor.execute_async("glob", {"pattern": "**/*.py"})
        for line in out.splitlines():
            assert not line.startswith("/"), f"Expected relative path, got: {line}"

    async def test_no_match_returns_message(self, executor, populated):
        out = await executor.execute_async("glob", {"pattern": "**/*.go"})
        assert "No files matched" in out

    async def test_missing_pattern_is_error(self, executor):
        out = await executor.execute_async("glob", {})
        assert out.startswith("Error:")

    async def test_flat_glob_no_double_star(self, executor, populated):
        out = await executor.execute_async("glob", {"pattern": "*.json"})
        assert "config.json" in out
        assert "main.py" not in out

    async def test_cwd_narrows_search(self, executor, populated, temp_dir):
        out = await executor.execute_async("glob", {
            "pattern": "*.py",
            "cwd": str(temp_dir / "src"),
        })
        assert "main.py" in out
        assert "README.md" not in out

    async def test_truncation_marker_when_over_limit(self, executor, temp_dir):
        from backend.tools.discovery_tools import _GLOB_MAX_RESULTS
        for i in range(_GLOB_MAX_RESULTS + 5):
            (temp_dir / f"f{i}.txt").write_text("x")
        out = await executor.execute_async("glob", {"pattern": "*.txt"})
        assert "more results truncated" in out


class TestGrep:
    async def test_finds_pattern(self, executor, populated):
        out = await executor.execute_async("grep", {"pattern": "def "})
        assert "main.py" in out
        assert "utils.py" in out
        assert "hello" in out

    async def test_no_match_returns_message(self, executor, populated):
        out = await executor.execute_async("grep", {"pattern": "ZZZNOMATCH"})
        assert "No matches" in out

    async def test_case_insensitive(self, executor, populated):
        out_sensitive = await executor.execute_async("grep", {
            "pattern": "TODO", "case_insensitive": False,
        })
        out_insensitive = await executor.execute_async("grep", {
            "pattern": "todo", "case_insensitive": True,
        })
        assert "TODO" in out_sensitive
        assert "TODO" in out_insensitive or "todo" in out_insensitive

    async def test_glob_filter(self, executor, populated):
        out = await executor.execute_async("grep", {"pattern": "hello", "glob": "*.md"})
        assert "README.md" in out
        # main.py also has "hello" but should be filtered out
        assert "main.py" not in out

    async def test_search_in_single_file(self, executor, populated, temp_dir):
        out = await executor.execute_async("grep", {
            "pattern": "helper",
            "path": str(temp_dir / "src" / "utils.py"),
        })
        assert "utils.py" in out
        assert "helper" in out

    async def test_invalid_regex_returns_error(self, executor, populated):
        out = await executor.execute_async("grep", {"pattern": "["})
        assert out.startswith("Error:")

    async def test_missing_pattern_is_error(self, executor):
        out = await executor.execute_async("grep", {})
        assert out.startswith("Error:")

    async def test_result_format_path_lineno_line(self, executor, populated):
        out = await executor.execute_async("grep", {"pattern": "def hello"})
        # Expect at least one line with path:lineno:content format
        lines = [l for l in out.splitlines() if "def hello" in l]
        assert lines, f"Expected match line, got:\n{out}"
        assert ":" in lines[0]

    async def test_max_results_respected(self, executor, temp_dir):
        from backend.tools.discovery_tools import _GREP_MAX_RESULTS
        # Write a file with many matching lines
        (temp_dir / "big.txt").write_text("\n".join("match" for _ in range(_GREP_MAX_RESULTS + 20)))
        out = await executor.execute_async("grep", {"pattern": "match"})
        count = out.count("\n") + 1
        assert count <= _GREP_MAX_RESULTS + 5  # a little slack for any trailing lines
