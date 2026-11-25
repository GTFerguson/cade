"""Pull request state for a session's branch (backend/pull_requests.py)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend import pull_requests as prs
from backend.pull_requests import PullRequestMonitor, by_branch, checks_state, summarise


def run(status=None, conclusion=None):
    return {"__typename": "CheckRun", "status": status, "conclusion": conclusion}


def status(state):
    return {"__typename": "StatusContext", "state": state}


class TestChecks:
    def test_no_checks_is_no_state(self):
        assert checks_state([]) is None
        assert checks_state(None) is None

    def test_all_finished_and_green_is_passing(self):
        assert checks_state([run("COMPLETED", "SUCCESS"), status("SUCCESS")]) == "passing"

    def test_skipped_and_neutral_checks_do_not_fail_it(self):
        assert checks_state([run("COMPLETED", "SKIPPED"), run("COMPLETED", "NEUTRAL")]) == "passing"

    def test_anything_unfinished_is_running(self):
        assert checks_state([run("COMPLETED", "SUCCESS"), run("IN_PROGRESS")]) == "running"
        assert checks_state([run("QUEUED")]) == "running"
        assert checks_state([status("PENDING")]) == "running"

    @pytest.mark.parametrize("conclusion", ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"])
    def test_a_failed_run_is_failing(self, conclusion):
        assert checks_state([run("COMPLETED", conclusion)]) == "failing"

    def test_a_failed_commit_status_is_failing(self):
        assert checks_state([status("ERROR")]) == "failing"
        assert checks_state([status("FAILURE")]) == "failing"

    def test_a_failure_outranks_checks_still_running(self):
        assert checks_state([run("IN_PROGRESS"), run("COMPLETED", "FAILURE")]) == "failing"

    def test_junk_entries_are_ignored(self):
        assert checks_state(["nonsense", run("COMPLETED", "SUCCESS")]) == "passing"


class TestSummary:
    def test_carries_what_a_tab_shows(self):
        summary = summarise({
            "number": 12,
            "title": "Add a thing",
            "url": "https://example.test/pr/12",
            "headRefName": "feature",
            "isDraft": True,
            "reviewDecision": "CHANGES_REQUESTED",
            "mergeable": "CONFLICTING",
            "statusCheckRollup": [run("COMPLETED", "SUCCESS")],
        })
        assert summary == {
            "number": 12,
            "title": "Add a thing",
            "url": "https://example.test/pr/12",
            "draft": True,
            "checks": "passing",
            "review": "changes",
            "conflicts": True,
        }

    @pytest.mark.parametrize(
        ("decision", "review"),
        [("APPROVED", "approved"), ("REVIEW_REQUIRED", "required"), ("", None), (None, None)],
    )
    def test_review_decisions(self, decision, review):
        assert summarise({"reviewDecision": decision})["review"] == review

    def test_only_a_known_conflict_counts(self):
        assert summarise({"mergeable": "MERGEABLE"})["conflicts"] is False
        assert summarise({"mergeable": "UNKNOWN"})["conflicts"] is False

    def test_the_newest_pull_request_for_a_branch_wins(self):
        found = by_branch([
            {"number": 9, "headRefName": "feature"},
            {"number": 4, "headRefName": "feature"},
            {"number": 5, "headRefName": "other"},
            {"number": 6},
        ])
        assert {b: p["number"] for b, p in found.items()} == {"feature": 9, "other": 5}


class TestLocating:
    async def test_names_the_repository_and_branch(self, tmp_path: Path):
        subprocess.run(["git", "init", "-q", "-b", "trunk", str(tmp_path)], check=True)
        sub = tmp_path / "pkg"
        sub.mkdir()
        assert await prs.repo_and_branch(sub) == (tmp_path.resolve(), "trunk")

    async def test_is_none_outside_a_repository(self, tmp_path_factory):
        # /tmp can itself be inside a stray repository; a folder with its own
        # .git file that points nowhere is reliably not one.
        folder = tmp_path_factory.mktemp("plain")
        (folder / ".git").write_text("gitdir: /nonexistent\n")
        assert await prs.repo_and_branch(folder) is None

    async def test_a_command_that_is_not_installed_gives_none(self, tmp_path: Path):
        assert await prs._run(["cade-no-such-command"], tmp_path) is None


def session(sid: str, path: str, *, alive: bool = True, pr=None):
    return SimpleNamespace(
        id=sid, project_path=Path(path), pull_request=pr, is_alive=lambda: alive
    )


class FakeGitHub:
    """Where each folder is checked out and what each repository has open."""

    def __init__(self, checkouts: dict[str, tuple[str, str]], prs: dict[str, dict | None]):
        self.checkouts = checkouts
        self.prs = prs
        self.fetched: list[str] = []
        self.announced: list[str] = []

    async def locate(self, path: Path):
        where = self.checkouts.get(str(path))
        return (Path(where[0]), where[1]) if where else None

    async def fetch(self, repo: Path):
        self.fetched.append(str(repo))
        found = self.prs.get(str(repo))
        return None if found is None else by_branch(found)

    async def announce(self, s) -> None:
        self.announced.append(s.id)

    def monitor(self, sessions: list) -> PullRequestMonitor:
        return PullRequestMonitor(
            lambda: sessions, locate=self.locate, fetch=self.fetch, announce=self.announce
        )


def pr(number: int, branch: str, **more):
    return {"number": number, "headRefName": branch, **more}


class TestMonitor:
    async def test_gives_each_session_the_pull_request_of_its_branch(self):
        a, b = session("a", "/r/one"), session("b", "/r/one-wt")
        hub = FakeGitHub(
            {"/r/one": ("/r/one", "feature"), "/r/one-wt": ("/r/one-wt", "main")},
            {"/r/one": [pr(7, "feature")], "/r/one-wt": [pr(7, "feature")]},
        )
        await hub.monitor([a, b]).poll_once()
        assert a.pull_request["number"] == 7
        assert b.pull_request is None
        assert hub.announced == ["a"]

    async def test_asks_once_per_repository_however_many_sessions_share_it(self):
        sessions = [session("a", "/r/one"), session("b", "/r/one/pkg")]
        hub = FakeGitHub(
            {"/r/one": ("/r/one", "feature"), "/r/one/pkg": ("/r/one", "feature")},
            {"/r/one": [pr(7, "feature")]},
        )
        await hub.monitor(sessions).poll_once()
        assert hub.fetched == ["/r/one"]
        assert [s.pull_request["number"] for s in sessions] == [7, 7]

    async def test_announces_only_a_change(self):
        a = session("a", "/r/one")
        hub = FakeGitHub({"/r/one": ("/r/one", "feature")}, {"/r/one": [pr(7, "feature")]})
        monitor = hub.monitor([a])
        await monitor.poll_once()
        await monitor.poll_once()
        assert hub.announced == ["a"]

        hub.prs["/r/one"] = [pr(7, "feature", reviewDecision="APPROVED")]
        await monitor.poll_once()
        assert hub.announced == ["a", "a"]
        assert a.pull_request["review"] == "approved"

    async def test_clears_a_pull_request_that_has_closed(self):
        a = session("a", "/r/one")
        hub = FakeGitHub({"/r/one": ("/r/one", "feature")}, {"/r/one": [pr(7, "feature")]})
        monitor = hub.monitor([a])
        await monitor.poll_once()
        hub.prs["/r/one"] = []
        await monitor.poll_once()
        assert a.pull_request is None
        assert hub.announced == ["a", "a"]

    async def test_follows_the_session_to_another_branch(self):
        a = session("a", "/r/one")
        hub = FakeGitHub(
            {"/r/one": ("/r/one", "feature")},
            {"/r/one": [pr(7, "feature"), pr(8, "other")]},
        )
        monitor = hub.monitor([a])
        await monitor.poll_once()
        hub.checkouts["/r/one"] = ("/r/one", "other")
        await monitor.poll_once()
        assert a.pull_request["number"] == 8

    async def test_keeps_what_it_had_when_github_cannot_be_reached(self):
        a = session("a", "/r/one")
        hub = FakeGitHub({"/r/one": ("/r/one", "feature")}, {"/r/one": [pr(7, "feature")]})
        monitor = hub.monitor([a])
        await monitor.poll_once()
        hub.prs["/r/one"] = None
        await monitor.poll_once()
        assert a.pull_request["number"] == 7
        assert hub.announced == ["a"]

    async def test_a_session_outside_any_repository_has_none(self):
        a = session("a", "/plain", pr={"number": 1})
        hub = FakeGitHub({}, {})
        await hub.monitor([a]).poll_once()
        assert a.pull_request is None
        assert hub.fetched == []

    async def test_skips_sessions_whose_shell_has_gone(self):
        a = session("a", "/r/one", alive=False)
        hub = FakeGitHub({"/r/one": ("/r/one", "feature")}, {"/r/one": [pr(7, "feature")]})
        await hub.monitor([a]).poll_once()
        assert hub.fetched == []

    async def test_says_when_checks_are_still_running(self):
        a = session("a", "/r/one")
        running = [{"status": "IN_PROGRESS"}]
        hub = FakeGitHub(
            {"/r/one": ("/r/one", "feature")},
            {"/r/one": [pr(7, "feature", statusCheckRollup=running)]},
        )
        monitor = hub.monitor([a])
        assert await monitor.poll_once() is True
        hub.prs["/r/one"] = [pr(7, "feature", statusCheckRollup=[{"status": "COMPLETED", "conclusion": "SUCCESS"}])]
        assert await monitor.poll_once() is False
