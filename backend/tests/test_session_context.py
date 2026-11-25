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


class TestReadingAProject:
    async def test_reads_the_branch_and_pending_files_of_a_real_repository(self, tmp_path: Path):
        subprocess.run(["git", "init", "-q", "-b", "trunk", str(tmp_path)], check=True)
        (tmp_path / "a.txt").write_text("one")
        git(tmp_path, "add", "a.txt")
        git(tmp_path, "commit", "-q", "-m", "first")
        (tmp_path / "a.txt").write_text("two")
        (tmp_path / "b.txt").write_text("new")

        found = await ctx.session_context(tmp_path)
        assert found == {"branch": "trunk", "uncommitted": 2, "unpushed": None, "handoff": None}

    async def test_names_the_newest_handoff(self, tmp_path: Path):
        folder = tmp_path / "docs" / "plans" / "handoff"
        folder.mkdir(parents=True)
        old = folder / "first-pass.md"
        old.write_text("# First pass\n")
        os.utime(old, (1_000, 1_000))
        new = folder / "second-pass.md"
        new.write_text("---\ntitle: Second pass\n---\n")
        os.utime(new, (2_000, 2_000))
        (folder / "README.md").write_text("# index\n")

        handoff = ctx.latest_handoff(tmp_path)
        assert handoff == {
            "name": "second-pass",
            "relPath": "docs/plans/handoff/second-pass.md",
            "title": "Second pass",
            "modified": 2_000,
        }

    async def test_a_folder_with_neither_has_no_context(self, tmp_path_factory):
        folder = tmp_path_factory.mktemp("plain")
        (folder / ".git").write_text("gitdir: /nonexistent\n")
        assert await ctx.session_context(folder) is None

    async def test_a_handoff_outside_a_repository_still_counts(self, tmp_path_factory):
        folder = tmp_path_factory.mktemp("plain")
        (folder / ".git").write_text("gitdir: /nonexistent\n")
        handoffs = folder / "docs" / "plans" / "handoff"
        handoffs.mkdir(parents=True)
        (handoffs / "notes.md").write_text("# Notes\n")
        found = await ctx.session_context(folder)
        assert found["branch"] is None
        assert found["handoff"]["name"] == "notes"


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

        async def read(path: Path):
            self.read.append(str(path))
            return answers.get(str(path))

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
