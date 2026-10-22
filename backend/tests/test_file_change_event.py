"""The file-changes wire format carries what a client needs to patch its tree."""

from core.backend.models import FileChangeEvent


def test_wire_format_includes_kind_and_ignored_flags():
    event = FileChangeEvent(event="created", path="src/new.py", is_dir=False, ignored=False)
    assert event.to_dict() == {
        "event": "created", "path": "src/new.py", "isDir": False, "ignored": False,
    }


def test_defaults_keep_plain_events_valid():
    assert FileChangeEvent(event="deleted", path="gone.txt").to_dict()["isDir"] is None
