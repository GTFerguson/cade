"""CADE shares nkrdn's own .nkrdn/ graph instead of keeping a .cade/ copy.

CADE used to rebuild into .cade/graph.ttl with explicit path overrides while
manual runs and the editor hook wrote .nkrdn/, so every repo carried two
graphs that drifted apart. CADE now runs exactly what they run and reads
from where nkrdn writes, resolving the repo root the way nkrdn does.
"""

from pathlib import Path
from unittest.mock import patch

from backend import nkrdn_service
from backend.nkrdn_service import nkrdn_db_path, nkrdn_graph_path, nkrdn_root


def test_root_is_the_enclosing_git_repo(tmp_path):
    (tmp_path / ".git").mkdir()
    sub = tmp_path / "pkg" / "inner"
    sub.mkdir(parents=True)
    assert nkrdn_root(sub) == tmp_path
    assert nkrdn_graph_path(sub) == tmp_path / ".nkrdn" / "graph.ttl"
    assert nkrdn_db_path(sub) == tmp_path / ".nkrdn" / "knowledge_base.db"


def test_root_falls_back_to_project_dir_outside_git(tmp_path):
    assert nkrdn_root(tmp_path) == tmp_path


def test_rebuild_runs_plain_nkrdn_rebuild_from_the_repo_root(tmp_path):
    (tmp_path / ".git").mkdir()
    sub = tmp_path / "app"
    sub.mkdir()
    with patch.object(nkrdn_service, "_NKRDN_BIN", "nkrdn"), \
         patch.object(nkrdn_service, "_wrap_with_resource_caps", lambda c: c), \
         patch.object(nkrdn_service.subprocess, "run") as run:
        nkrdn_service._run_nkrdn_rebuild(sub)
    args, kwargs = run.call_args
    assert args[0] == ["nkrdn", "rebuild"]
    assert Path(kwargs["cwd"]) == tmp_path
