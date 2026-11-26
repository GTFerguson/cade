"""A session's branch, pending work and latest handoff (backend/session_context.py)."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

from backend import session_context as ctx
from backend.session_context import SessionContextMonitor, parse_status


class TestParsingStatus:
    def test_a_clean_branch_level_with_its_upstream(self):
        text = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n"
        assert parse_status(text) == {"branch": "main", "uncommitted": 0, "unpushed": 0}

    def test_counts_commits_not_yet_pushed(self):
        text = "# branch.head feature\n# branch.upstream origin/feature\n# branch.ab +3 -1\n"
        assert parse_status(text)["unpushed"] == 3

    def test_a_branch_with_no_upstream_has_no_unpushed_count(self):
        assert parse_status("# branch.oid abc\n# branch.head feature\n")["unpushed"] is None

    def test_counts_changed_renamed_conflicted_and_untracked_files(self):
        text = (
            "# branch.head main\n"
            "1 .M N... 100644 100644 100644 a b src/a.py\n"
            "2 R. N... 100644 100644 100644 a b R100 new.py\told.py\n"
            "u UU N... 100644 100644 100644 100644 a b c both.py\n"
            "? notes.txt\n"
            "! ignored.log\n"
        )
        assert parse_status(text)["uncommitted"] == 4

    def test_a_detached_head_is_no_branch(self):
        assert parse_status("# branch.oid abc\n# branch.head (detached)\n") is None


def git(repo: Path, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.test",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.test",
    }
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


def tab(project: Path, *, sid: str = "s1", handoff: str | None = None, label: str | None = None):
    return SimpleNamespace(id=sid, project_path=project, handoff=handoff, label=label)


def make_handoffs(project: Path, *names: str) -> None:
    folder = project / "docs" / "plans" / "handoff"
    folder.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(names):
        path = folder / f"{name}.md"
        path.write_text(f"# About {name}\n")
        os.utime(path, (1_000 + i, 1_000 + i))


async def no_board(_project: Path):
    return None


class TestWhichHandoffATabIsOn:
    def handoffs(self, project: Path):
        from backend.projects import list_handoffs

        return list_handoffs(project)

    def test_the_one_it_was_opened_on_comes_first(self, tmp_path: Path, monkeypatch):
        make_handoffs(tmp_path, "model-metrics", "shot-precision")
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        s = tab(tmp_path, handoff="docs/plans/handoff/shot-precision.md", label="Review model metrics handoff")
        found, how = ctx.session_handoff(s, self.handoffs(tmp_path))
        assert (found["relPath"], how) == ("docs/plans/handoff/shot-precision.md", ctx.CHOSEN)

    def test_then_the_one_its_agent_last_wrote(self, tmp_path: Path, monkeypatch):
        make_handoffs(tmp_path, "model-metrics", "shot-precision")
        home = tmp_path / "home"
        (home / ctx.OWNED_DIR).mkdir(parents=True)
        (home / ctx.OWNED_DIR / "owned-s1").write_text(str(tmp_path / "docs/plans/handoff/model-metrics.md"))
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: home))
        found, how = ctx.session_handoff(tab(tmp_path, label="Review shot precision"), self.handoffs(tmp_path))
        assert (Path(found["name"]).stem, how) == ("model-metrics", ctx.WRITTEN)

    def test_a_handoff_written_in_another_project_is_not_this_tabs(self, tmp_path: Path, monkeypatch):
        project, other = tmp_path / "a", tmp_path / "b"
        make_handoffs(project, "model-metrics")
        make_handoffs(other, "elsewhere")
        home = tmp_path / "home"
        (home / ctx.OWNED_DIR).mkdir(parents=True)
        (home / ctx.OWNED_DIR / "owned-s1").write_text(str(other / "docs/plans/handoff/elsewhere.md"))
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: home))
        assert ctx.session_handoff(tab(project), self.handoffs(project)) is None

    def test_then_the_one_its_title_names(self, tmp_path: Path, monkeypatch):
        make_handoffs(tmp_path, "model-metrics", "shot-precision")
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        found, how = ctx.session_handoff(tab(tmp_path, label="Review model metrics handoff | work"), self.handoffs(tmp_path))
        assert (Path(found["name"]).stem, how) == ("model-metrics", ctx.TITLED)

    def test_a_tab_that_names_none_has_none(self, tmp_path: Path, monkeypatch):
        make_handoffs(tmp_path, "model-metrics")
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        assert ctx.session_handoff(tab(tmp_path, label="Clean up handoffs"), self.handoffs(tmp_path)) is None
        assert ctx.session_handoff(tab(tmp_path), self.handoffs(tmp_path)) is None

    def test_a_handoff_that_has_been_deleted_is_not_returned(self, tmp_path: Path, monkeypatch):
        make_handoffs(tmp_path, "model-metrics")
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        s = tab(tmp_path, handoff="docs/plans/handoff/gone.md")
        assert ctx.session_handoff(s, self.handoffs(tmp_path)) is None


class TestAHandoffNamedInATitle:
    NAMES = ["model-metrics", "shot", "shot-precision", "maker-shooter-attribution-assist", "live-cv-audition"]

    def test_finds_the_name_written_in_words(self):
        assert ctx.handoff_named_in("Review model metrics handoff | airplai", self.NAMES) == "model-metrics"
        assert ctx.handoff_named_in("Review live CV audition handoff", self.NAMES) == "live-cv-audition"

    def test_the_longest_name_wins(self):
        assert ctx.handoff_named_in("Tighten shot precision threshold", self.NAMES) == "shot-precision"

    def test_a_one_word_name_is_never_matched(self):
        assert ctx.handoff_named_in("One more shot at it", self.NAMES) is None

    def test_the_words_must_be_together_and_in_order(self):
        assert ctx.handoff_named_in("metrics for the model", self.NAMES) is None
        assert ctx.handoff_named_in("shooter attribution by a maker", self.NAMES) is None

    def test_a_title_that_drops_the_names_last_word_still_counts(self):
        assert ctx.handoff_named_in("Review maker-shooter attribution | work", self.NAMES) == "maker-shooter-attribution-assist"

    def test_the_start_of_a_name_must_be_at_least_three_words(self):
        assert ctx.handoff_named_in("Look at the maker shooter", self.NAMES) is None

    def test_two_names_matched_equally_well_are_no_match(self):
        names = ["maker-shooter-attribution-assist", "maker-shooter-attribution-eval"]
        assert ctx.handoff_named_in("Review maker shooter attribution", names) is None

    def test_a_whole_name_beats_the_start_of_another(self):
        names = ["court-solve-speed", "court-solve-speed-followups"]
        assert ctx.handoff_named_in("Review court solve speed", names) == "court-solve-speed"

    def test_no_title_names_none(self):
        assert ctx.handoff_named_in("", self.NAMES) is None


def board_with(handoff_name: str, **stream):
    base = {
        "ticket": "WRK-1", "title": "Title", "url": "u", "status": "In Progress", "statusType": "started",
        "handoff": {"name": handoff_name}, "worktrees": [],
    }
    return {"streams": [{**base, **stream}]}


def wt(name: str, pr_state: str | None = None, **over):
    return {"name": name, "path": f"/w/{name}", "branch": f"gary/{name}", "uncommitted": 0, "unpushed": 0,
            "pr": {"number": 7, "state": pr_state} if pr_state else None, **over}


class TestTheStreamAHandoffCarries:
    def test_gives_its_tickets_and_the_worktree_and_pull_request_that_stand_for_it(self):
        b = board_with("model-metrics", worktrees=[wt("old", "merged"), wt("live", "open", uncommitted=3)])
        b["streams"].append({**b["streams"][0], "ticket": "WRK-2", "status": "Done", "statusType": "completed"})
        stream = ctx.stream_for(b, "model-metrics")
        assert [t["ticket"] for t in stream["tickets"]] == ["WRK-1", "WRK-2"]
        assert stream["worktree"] == {
            "name": "live", "path": "/w/live", "branch": "gary/live", "uncommitted": 3, "unpushed": 0,
        }
        assert stream["pr"]["state"] == "open"

    def test_a_merged_pull_request_stands_for_it_when_none_is_open(self):
        stream = ctx.stream_for(board_with("m", worktrees=[wt("plain"), wt("done", "merged")]), "m")
        assert stream["worktree"]["name"] == "done"

    def test_a_stream_with_no_worktree_has_tickets_only(self):
        stream = ctx.stream_for(board_with("m"), "m")
        assert (stream["worktree"], stream["pr"]) == (None, None)

    def test_a_handoff_no_ticket_names_has_no_stream(self):
        assert ctx.stream_for(board_with("m"), "other") is None


class TestReadingASession:
    async def test_reads_the_folder_when_the_tab_has_no_handoff(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        subprocess.run(["git", "init", "-q", "-b", "trunk", str(project)], check=True)
        (project / "a.txt").write_text("one")
        git(project, "add", "a.txt")
        git(project, "commit", "-q", "-m", "first")
        (project / "b.txt").write_text("new")

        found = await ctx.session_context(tab(project), read_board=no_board)
        assert found == {
            "branch": "trunk", "uncommitted": 1, "unpushed": None,
            "handoff": None, "tickets": [], "worktree": None, "pr": None,
        }

    async def test_a_tab_on_a_handoff_gets_its_stream_from_the_board(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        make_handoffs(project, "model-metrics", "other")
        (project / ".git").write_text("gitdir: /nonexistent\n")
        asked: list[Path] = []

        async def read_board(p: Path):
            asked.append(p)
            return board_with("model-metrics", worktrees=[wt("metrics", "open")])

        s = tab(project, handoff="docs/plans/handoff/model-metrics.md")
        found = await ctx.session_context(s, read_board=read_board)
        assert asked == [project]
        assert found["handoff"]["name"] == "model-metrics"
        assert found["handoff"]["source"] == ctx.CHOSEN
        assert [t["ticket"] for t in found["tickets"]] == ["WRK-1"]
        assert found["worktree"]["branch"] == "gary/metrics"
        assert "path" not in found["worktree"]
        assert found["pr"]["number"] == 7

    async def test_reads_what_is_pending_in_the_streams_own_worktree(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        make_handoffs(project, "model-metrics")
        (project / ".git").write_text("gitdir: /nonexistent\n")
        worktree = tmp_path / "wt"
        subprocess.run(["git", "init", "-q", "-b", "gary/metrics", str(worktree)], check=True)
        (worktree / "a.txt").write_text("x")
        (worktree / "b.txt").write_text("y")

        async def read_board(_p: Path):
            # As a light board gives it: which worktree, nothing about its state.
            tree = {**wt("metrics", "open"), "path": str(worktree), "uncommitted": None, "unpushed": None}
            return board_with("model-metrics", worktrees=[tree])

        s = tab(project, handoff="docs/plans/handoff/model-metrics.md")
        found = await ctx.session_context(s, read_board=read_board)
        assert found["worktree"] == {"name": "metrics", "branch": "gary/metrics", "uncommitted": 2, "unpushed": None}

    async def test_tabs_on_one_folder_share_its_reads_within_a_poll(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        make_handoffs(project, "model-metrics")
        (project / ".git").write_text("gitdir: /nonexistent\n")
        counts = {"board": 0, "tree": 0}

        async def read_board(_p: Path):
            counts["board"] += 1
            return board_with("model-metrics")

        real_tree = ctx.working_tree

        async def counting_tree(path: Path):
            counts["tree"] += 1
            return await real_tree(path)

        monkeypatch.setattr(ctx, "working_tree", counting_tree)
        shared = ctx.Shared()
        tabs = [tab(project, sid=f"s{i}", handoff="docs/plans/handoff/model-metrics.md") for i in range(5)]
        for t in tabs:
            await ctx.session_context(t, read_board=read_board, shared=shared)
        assert counts == {"board": 1, "tree": 1}

    async def test_the_board_is_not_read_for_a_tab_with_no_handoff(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        make_handoffs(project, "model-metrics")
        (project / ".git").write_text("gitdir: /nonexistent\n")

        async def read_board(_p: Path):
            raise AssertionError("the board was read for a tab that is on no handoff")

        assert await ctx.session_context(tab(project, label="Something else"), read_board=read_board) is None

    async def test_a_handoff_with_no_board_row_still_names_the_handoff(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(ctx.Path, "home", classmethod(lambda cls: tmp_path / "home"))
        project = tmp_path / "p"
        make_handoffs(project, "model-metrics")
        (project / ".git").write_text("gitdir: /nonexistent\n")
        s = tab(project, handoff="docs/plans/handoff/model-metrics.md")
        found = await ctx.session_context(s, read_board=no_board)
        assert found["handoff"]["name"] == "model-metrics"
        assert (found["tickets"], found["worktree"], found["pr"]) == ([], None, None)


def session(sid: str, path: str, *, alive: bool = True, clients: int = 1, context=None):
    return SimpleNamespace(
        id=sid,
        project_path=Path(path),
        context=context,
        is_alive=lambda: alive,
        connected_clients=set(range(clients)),
    )


class TestMonitor:
    def monitor(self, sessions, answers):
        self.read: list[str] = []
        self.announced: list[str] = []

        async def read(s, _shared=None):
            self.read.append(str(s.project_path))
            return answers.get(str(s.project_path))

        async def announce(s) -> None:
            self.announced.append(s.id)

        return SessionContextMonitor(lambda: sessions, read=read, announce=announce)

    async def test_gives_a_session_its_context_and_announces_a_change_only(self):
        a = session("a", "/r/one")
        answers = {"/r/one": {"branch": "main", "uncommitted": 0}}
        monitor = self.monitor([a], answers)
        await monitor.poll_once()
        await monitor.poll_once()
        assert a.context == {"branch": "main", "uncommitted": 0}
        assert self.announced == ["a"]

        answers["/r/one"] = {"branch": "main", "uncommitted": 2}
        await monitor.poll_once()
        assert self.announced == ["a", "a"]

    async def test_does_not_look_at_a_session_nobody_is_attached_to(self):
        a = session("a", "/r/one", clients=0)
        await self.monitor([a], {"/r/one": {"branch": "main"}}).poll_once()
        assert self.read == []

    async def test_skips_a_session_whose_shell_has_gone(self):
        a = session("a", "/r/one", alive=False)
        await self.monitor([a], {"/r/one": {"branch": "main"}}).poll_once()
        assert self.read == []

    async def test_clears_context_that_no_longer_applies(self):
        a = session("a", "/r/one", context={"branch": "main"})
        await self.monitor([a], {}).poll_once()
        assert a.context is None
        assert self.announced == ["a"]

    async def test_reads_a_session_at_once_when_asked_while_running(self):
        import asyncio

        a = session("a", "/r/one")
        monitor = self.monitor([], {"/r/one": {"branch": "main"}})
        monitor.start()
        try:
            monitor.refresh_soon(a)
            await asyncio.sleep(0.01)
            assert a.context == {"branch": "main"}
        finally:
            await monitor.stop()

    async def test_does_not_start_a_read_while_stopped(self):
        import asyncio

        a = session("a", "/r/one")
        monitor = self.monitor([], {"/r/one": {"branch": "main"}})
        monitor.refresh_soon(a)
        await asyncio.sleep(0.01)
        assert a.context is None
        assert self.read == []
