"""Integration test: memory write → FileWatcher → nkrdn rebuild trigger.

Verifies that when the memory writer drops a markdown file into
.cade/memory/, the NkrdnService.on_file_change handler treats it as a
rebuild-triggering event. The rebuild itself is mocked — we only check the
trigger path is wired correctly.

True end-to-end coverage (write → rebuild → /api/memory/search returns the
entry) requires a live nkrdn install + graph and is run manually; see the
roundtrip notes in test_memory_writer.py::test_written_file_parses_under_nkrdn_parser.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.memory.writer import MemoryWriter
from backend.nkrdn_service import NkrdnService
from core.backend.models import FileChangeEvent


@pytest.fixture
def project(temp_dir: Path) -> Path:
    """A scratch project root with a `.cade/memory/` ready to be written into."""
    return temp_dir


def test_memory_md_write_triggers_rebuild(project: Path):
    """Memory markdown writes must fire the rebuild scheduler."""
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        # Simulate the writer producing a file
        writer = MemoryWriter(project)
        result = writer.record_decision(
            rationale="Choose JWT for stateless scaling.",
            alternatives=["session cookies"],
            applies_to=["AuthService"],
            importance=7,
        )
        # FileWatcher would deliver this event after the write
        service.on_file_change(FileChangeEvent(event="created", path=str(result.path)))
        mock_schedule.assert_called_once()


def test_non_memory_md_does_not_trigger_rebuild(project: Path):
    """README.md / other markdown writes must NOT fire the rebuild."""
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        readme = project / "README.md"
        readme.write_text("# Project\n")
        service.on_file_change(FileChangeEvent(event="created", path=str(readme)))
        mock_schedule.assert_not_called()


def test_code_file_still_triggers_rebuild(project: Path):
    """The original code-file rebuild path must keep working."""
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        py_path = project / "module.py"
        py_path.write_text("x = 1\n")
        service.on_file_change(FileChangeEvent(event="modified", path=str(py_path)))
        mock_schedule.assert_called_once()


def test_memory_dir_path_substring_matches_in_subprojects(project: Path):
    """Filter accepts .cade/memory/* even when nested deep in the tree."""
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        nested = project / "subproject" / ".cade" / "memory" / "2026-04-29-x.md"
        nested.parent.mkdir(parents=True, exist_ok=True)
        nested.write_text("---\ntype: note\n---\n\nbody")
        service.on_file_change(FileChangeEvent(event="created", path=str(nested)))
        mock_schedule.assert_called_once()


def test_md_outside_memory_dir_ignored(project: Path):
    """Markdown writes elsewhere in the project must NOT trigger rebuild."""
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        doc = project / "docs" / "guide.md"
        doc.parent.mkdir(parents=True, exist_ok=True)
        doc.write_text("# Guide\n")
        service.on_file_change(FileChangeEvent(event="created", path=str(doc)))
        mock_schedule.assert_not_called()


def test_unrelated_extension_ignored(project: Path):
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        unrelated = project / "data.json"
        unrelated.write_text("{}")
        service.on_file_change(FileChangeEvent(event="modified", path=str(unrelated)))
        mock_schedule.assert_not_called()


def test_writer_creates_file_at_path_watcher_recognises(project: Path):
    """End-to-end shape: the path the writer produces is one the watcher accepts."""
    writer = MemoryWriter(project)
    result = writer.record_note(
        observation="quirk worth keeping",
        applies_to=["X"],
        importance=2,
    )
    # The watcher path filter must accept this file. Build a service and check.
    service = NkrdnService(project)
    with patch.object(service, "_schedule_rebuild") as mock_schedule:
        service.on_file_change(FileChangeEvent(event="created", path=str(result.path)))
        mock_schedule.assert_called_once()
