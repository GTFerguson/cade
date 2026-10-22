"""Tests for FileTreeCache invalidation scope."""

from __future__ import annotations

from pathlib import Path

from backend.files.tree import FileTreeCache


def _project(tmp_path: Path) -> Path:
    root = tmp_path.resolve() / "proj"
    (root / "output" / "run" / "sub" / "deeper").mkdir(parents=True)
    (root / "README.md").write_text("x")
    return root


# A tree fetched two levels deep cannot show a file four levels down, so a
# project whose eval runs write deep under output/ must not have every tab's
# tree rebuilt for each written file.
def test_change_below_what_the_tree_shows_keeps_the_cache(tmp_path: Path):
    root = _project(tmp_path)
    cache = FileTreeCache()
    first = cache.get(root, max_depth=2)

    cache.invalidate(root / "output" / "run" / "sub" / "deeper" / "scores.json")

    assert cache.get(root, max_depth=2) is first


# Directories on the deepest shown level carry a has_more flag computed from
# their children, so a change one level below that still alters the tree.
def test_change_just_below_the_deepest_shown_level_invalidates(tmp_path: Path):
    root = _project(tmp_path)
    cache = FileTreeCache()
    first = cache.get(root, max_depth=2)

    cache.invalidate(root / "output" / "run" / "sub" / "first.txt")

    assert cache.get(root, max_depth=2) is not first


def test_change_at_the_root_invalidates(tmp_path: Path):
    root = _project(tmp_path)
    cache = FileTreeCache()
    first = cache.get(root, max_depth=2)

    cache.invalidate(root / ".aws")

    assert cache.get(root, max_depth=2) is not first


def test_deep_change_still_invalidates_a_deeper_tree(tmp_path: Path):
    root = _project(tmp_path)
    cache = FileTreeCache()
    first = cache.get(root, max_depth=10)

    cache.invalidate(root / "output" / "run" / "sub" / "deeper" / "scores.json")

    assert cache.get(root, max_depth=10) is not first


def test_change_outside_the_project_keeps_the_cache(tmp_path: Path):
    root = _project(tmp_path)
    (tmp_path / "elsewhere").mkdir()
    cache = FileTreeCache()
    first = cache.get(root, max_depth=2)

    cache.invalidate(tmp_path.resolve() / "elsewhere" / "x.txt")

    assert cache.get(root, max_depth=2) is first
