"""Tests for tab groups: the definitions file, the folder rule, which side
decides a session's group, and the routes that serve the definitions."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.config import Config, set_config
from backend.main import create_app
from backend.protocol import MessageType, SessionKey
from backend.terminal.session_listing import describe_session
from backend.terminal.sessions import PTYSession, SessionRegistry, set_registry
from backend.terminal.tab_groups import (
    DEFAULT_COLOUR,
    MAX_NAME_LENGTH,
    TabGroup,
    TabGroupStore,
    clean_group_name,
    group_for_path,
    parse_groups,
)
from backend.tests.test_multi_client_attach import attach_handler, make_pty, sent


class TestNames:
    def test_whitespace_is_collapsed(self):
        assert clean_group_name("  Air   PLAi ") == "Air PLAi"

    @pytest.mark.parametrize("value", ["", "   ", None, 7, ["a"]])
    def test_non_names_are_rejected(self, value):
        assert clean_group_name(value) is None

    def test_long_names_are_cut(self):
        assert len(clean_group_name("x" * (MAX_NAME_LENGTH + 20))) == MAX_NAME_LENGTH


class TestParse:
    def test_bad_entries_and_repeats_are_dropped(self):
        groups = parse_groups([
            {"name": "Work", "colour": "blue", "paths": ["/w"]},
            {"name": "Work", "colour": "red"},
            {"colour": "red"},
            "nonsense",
        ])
        assert [g.to_dict() for g in groups] == [
            {"name": "Work", "colour": "blue", "paths": ["/w"]},
        ]

    def test_unknown_colour_falls_back(self):
        assert parse_groups([{"name": "A", "colour": "chartreuse"}])[0].colour == DEFAULT_COLOUR

    def test_not_a_list_is_no_groups(self):
        assert parse_groups({"name": "A"}) == []


class TestFolderRule:
    def test_project_under_a_group_folder_joins_it(self, temp_dir: Path):
        groups = [TabGroup("Work", paths=[str(temp_dir / "work")])]
        assert group_for_path(groups, temp_dir / "work" / "repo") == "Work"
        assert group_for_path(groups, temp_dir / "work") == "Work"

    def test_project_elsewhere_joins_nothing(self, temp_dir: Path):
        groups = [TabGroup("Work", paths=[str(temp_dir / "work")])]
        assert group_for_path(groups, temp_dir / "personal") is None

    def test_sibling_with_a_shared_prefix_does_not_match(self, temp_dir: Path):
        groups = [TabGroup("Work", paths=[str(temp_dir / "work")])]
        assert group_for_path(groups, temp_dir / "workshop") is None

    def test_deepest_folder_wins(self, temp_dir: Path):
        groups = [
            TabGroup("Everything", paths=[str(temp_dir)]),
            TabGroup("Repo", paths=[str(temp_dir / "work" / "repo")]),
        ]
        assert group_for_path(groups, temp_dir / "work" / "repo" / "sub") == "Repo"
        assert group_for_path(groups, temp_dir / "other") == "Everything"


class TestStore:
    def test_missing_file_is_no_groups(self, temp_dir: Path):
        assert TabGroupStore(temp_dir).load() == []

    def test_roundtrip(self, temp_dir: Path):
        store = TabGroupStore(temp_dir)
        store.save([TabGroup("Work", "blue", ["/w"])])
        assert store.load() == [TabGroup("Work", "blue", ["/w"])]

    def test_unreadable_file_is_no_groups(self, temp_dir: Path):
        (temp_dir / "tab-groups.json").write_text("{not json")
        assert TabGroupStore(temp_dir).load() == []

    def test_save_leaves_no_temporary_files(self, temp_dir: Path):
        TabGroupStore(temp_dir).save([TabGroup("Work")])
        assert [p.name for p in temp_dir.iterdir()] == ["tab-groups.json"]


def make_session(temp_dir: Path, **kwargs) -> PTYSession:
    session = PTYSession(id="s", project_path=temp_dir, **kwargs)
    session.add_terminal(SessionKey.CLAUDE, make_pty())
    return session


class TestInitialGroup:
    """The session on the backend decides its group, not the tab's saved copy."""

    def _store(self, group: str | None) -> MagicMock:
        store = MagicMock()
        store.group_for_path.return_value = group
        return store

    def test_new_session_takes_the_group_the_tab_asked_for(self, temp_dir: Path):
        session = make_session(temp_dir)
        handler = attach_handler(session, temp_dir, new_session=True)
        handler._requested_group = "Work"
        with patch("backend.websocket.get_tab_group_store", return_value=self._store("Rule")):
            handler._assign_initial_group()
        assert session.group == "Work"

    def test_new_session_without_one_follows_the_folder_rule(self, temp_dir: Path):
        session = make_session(temp_dir)
        handler = attach_handler(session, temp_dir, new_session=True)
        with patch("backend.websocket.get_tab_group_store", return_value=self._store("Rule")):
            handler._assign_initial_group()
        assert session.group == "Rule"

    def test_existing_session_keeps_its_group(self, temp_dir: Path):
        session = make_session(temp_dir, group="Personal")
        handler = attach_handler(session, temp_dir)
        handler._requested_group = "Work"
        with patch("backend.websocket.get_tab_group_store", return_value=self._store("Rule")):
            handler._assign_initial_group()
        assert session.group == "Personal"

    def test_existing_ungrouped_session_stays_ungrouped(self, temp_dir: Path):
        """Removing a tab from its group must survive a reconnect."""
        session = make_session(temp_dir)
        handler = attach_handler(session, temp_dir)
        handler._requested_group = "Work"
        with patch("backend.websocket.get_tab_group_store", return_value=self._store("Rule")):
            handler._assign_initial_group()
        assert session.group is None


class TestSetGroup:
    @pytest.mark.asyncio
    async def test_moves_the_session_and_tells_the_other_clients(self, temp_dir: Path):
        session = make_session(temp_dir)
        mover = attach_handler(session, temp_dir)
        watcher = attach_handler(session, temp_dir)

        await mover._handle_set_group({"group": "  Work "})

        assert session.group == "Work"
        assert sent(watcher._ws, MessageType.GROUP_CHANGED) == [
            {"type": MessageType.GROUP_CHANGED, "sessionId": "s", "group": "Work"},
        ]
        assert sent(mover._ws, MessageType.GROUP_CHANGED) == []

    @pytest.mark.asyncio
    async def test_blank_group_removes_the_session_from_its_group(self, temp_dir: Path):
        session = make_session(temp_dir, group="Work")
        handler = attach_handler(session, temp_dir)
        await handler._handle_set_group({"group": ""})
        assert session.group is None

    @pytest.mark.asyncio
    async def test_unchanged_group_is_not_announced(self, temp_dir: Path):
        session = make_session(temp_dir, group="Work")
        mover = attach_handler(session, temp_dir)
        watcher = attach_handler(session, temp_dir)
        await mover._handle_set_group({"group": "Work"})
        assert sent(watcher._ws, MessageType.GROUP_CHANGED) == []


class TestListing:
    def test_listing_includes_the_group(self, temp_dir: Path):
        session = make_session(temp_dir, group="Work")
        assert describe_session(session, "claude")["group"] == "Work"


@pytest.fixture
def api_client(temp_dir: Path):
    config = Config(
        port=0, host="127.0.0.1", working_dir=temp_dir, shell_command="bash",
        auto_start_claude=False, auto_open_browser=False, dummy_mode=True,
    )
    set_config(config)
    set_registry(SessionRegistry())
    store = TabGroupStore(temp_dir / "cade-home")
    with patch("backend.main.unify_sessions"), patch(
        "backend.main._check_wsl_health_async", new_callable=AsyncMock
    ), patch("backend.terminal.tab_groups.get_tab_group_store", return_value=store):
        yield TestClient(create_app(config)), store
    set_registry(SessionRegistry())


class TestRoutes:
    def test_no_definitions_yet(self, api_client):
        client, _ = api_client
        assert client.get("/api/tab-groups").json() == {"groups": []}

    def test_put_replaces_the_definitions(self, api_client):
        client, store = api_client
        res = client.put("/api/tab-groups", json={"groups": [
            {"name": "Work", "colour": "blue", "paths": ["/w"]},
            {"name": "", "colour": "red"},
        ]})
        expected = {"groups": [{"name": "Work", "colour": "blue", "paths": ["/w"]}]}
        assert res.json() == expected
        assert client.get("/api/tab-groups").json() == expected
        assert store.load() == [TabGroup("Work", "blue", ["/w"])]
