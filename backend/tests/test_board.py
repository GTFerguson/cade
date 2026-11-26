"""The project board: tickets joined to handoffs, worktrees and pull requests."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from backend import board
from backend.board import assemble, parse_board, verdict

BOARD = """\
---
title: Work board
---

# Work board

Prose that is not a table | with a pipe in it.

## Active tickets

| Ticket | Title | Linear | Handoff | Worktree / branch / PR | Next |
|---|---|---|---|---|---|
| [WRK-214](https://tracker.test/WRK-214) | Make the metrics page explorable | In Progress (25 Nov readback; parent WRK-100) | [[handoff/model-metrics]] | `platform-metrics` / `gary/metrics`, `2197884a8`; merged [#1559](https://example.test/pull/1559) | Repair the release; see handoff |
| [WRK-230](https://tracker.test/WRK-230) | Possessions with selective pose | Backlog | [[handoff/shooter-assist#Parked work|parked]] | no worktree yet | |
| not a ticket | Something else | | | | |

## Deferred tickets

| Ticket | Linear | Handoff | Next |
|---|---|---|---|
| WRK-150 | Todo | — | Wait for the camera work |

## Handoffs needing mapping

| Handoff | Notes |
|---|---|
| [[handoff/orphan]] | mentions WRK-999 but is not a ticket row |

## Coming streams

| Stream | Ticket | State | Source |
|---|---|---|---|
| Voice tagging | WRK-301 | agreed | chat |
"""


class TestParsingTheBoardFile:
    def test_reads_ticket_rows_from_every_table_that_has_a_ticket_column(self):
        rows = parse_board(BOARD)
        assert [r["ticket"] for r in rows] == ["WRK-214", "WRK-230", "WRK-150", "WRK-301"]
        assert [r["section"] for r in rows] == [
            "Active tickets", "Active tickets", "Deferred tickets", "Coming streams",
        ]

    def test_takes_the_fields_by_column_name(self):
        row = parse_board(BOARD)[0]
        assert row["url"] == "https://tracker.test/WRK-214"
        assert row["title"] == "Make the metrics page explorable"
        assert row["status"] == "In Progress"
        assert row["statusDetail"] == "25 Nov readback; parent WRK-100"
        assert row["handoff"] == "model-metrics"
        assert row["names"] == ["platform-metrics", "gary/metrics", "2197884a8"]
        assert row["prs"] == [1559]
        assert row["next"] == "Repair the release; see handoff"

    def test_a_handoff_link_to_a_heading_still_names_the_handoff(self):
        assert parse_board(BOARD)[1]["handoff"] == "shooter-assist"

    def test_tables_of_other_shapes_fill_what_they_have(self):
        deferred, coming = parse_board(BOARD)[2:]
        assert (deferred["status"], deferred["handoff"], deferred["next"]) == (
            "Todo", None, "Wait for the camera work",
        )
        assert deferred["url"] is None
        assert coming["title"] == "Voice tagging"

    def test_skips_rows_and_tables_with_no_ticket(self):
        tickets = {r["ticket"] for r in parse_board(BOARD)}
        assert "WRK-999" not in tickets

    def test_no_board_file_is_no_rows(self):
        assert parse_board("") == []


class TestVerdict:
    MERGED = {"state": "merged", "head": "abc"}

    def test_no_pull_request_is_local(self):
        assert verdict(None, "abc", 0) == board.LOCAL

    def test_open_and_closed_pull_requests(self):
        assert verdict({"state": "open"}, "abc", 0) == board.IN_REVIEW
        assert verdict({"state": "closed"}, "abc", 0) == board.CLOSED

    def test_merged_clean_and_untouched_since_is_finished(self):
        assert verdict(self.MERGED, "abc", 0) == board.FINISHED

    def test_uncommitted_work_keeps_a_merged_worktree_from_finished(self):
        assert verdict(self.MERGED, "abc", 2) == board.MERGED_DIRTY

    def test_commits_after_the_merge_keep_it_from_finished(self):
        assert verdict(self.MERGED, "def", 0) == board.MERGED_DIRTY

    def test_a_worktree_behind_the_merged_head_is_finished(self):
        assert verdict(self.MERGED, "old", 0, contained=True) == board.FINISHED
        assert verdict(self.MERGED, "old", 1, contained=True) == board.MERGED_DIRTY

    def test_an_unknown_head_is_never_finished(self):
        assert verdict(self.MERGED, None, 0) == board.MERGED_DIRTY
        assert verdict({"state": "merged", "head": None}, None, 0) == board.MERGED_DIRTY


def node(number: int, state: str, **more):
    return {"number": number, "title": f"PR {number}", "url": f"https://example.test/{number}",
            "state": state, "headRefOid": f"sha{number}", "mergedAt": None, **more}


def answer(**aliases):
    return {"data": {"repository": {k: {"nodes": v} for k, v in aliases.items()}}}


class TestAskingGitHubByBranch:
    def test_asks_about_each_branch_under_its_own_alias(self):
        query = board.branch_query(["gary/metrics", 'odd"name'])
        assert 'b0: pullRequests(headRefName:"gary/metrics"' in query
        assert 'b1: pullRequests(headRefName:"odd\\"name"' in query
        assert query.startswith("query($owner:String!,$name:String!)")

    def test_reads_an_open_pull_request_in_full(self):
        open_pr = node(
            7, "OPEN", isDraft=True, reviewDecision="CHANGES_REQUESTED", mergeable="CONFLICTING",
            commits={"nodes": [{"commit": {"statusCheckRollup": {"state": "FAILURE"}}}]},
        )
        (pr,) = board.prs_from_answer(answer(b0=[open_pr]), ["feature"]).values()
        assert pr == {
            "number": 7, "title": "PR 7", "url": "https://example.test/7", "state": "open",
            "head": "sha7", "mergedAt": None,
            "draft": True, "checks": "failing", "review": "changes", "conflicts": True,
        }

    def test_checks_still_running_and_none_at_all(self):
        running = node(7, "OPEN", commits={"nodes": [{"commit": {"statusCheckRollup": {"state": "PENDING"}}}]})
        none = node(8, "OPEN", commits={"nodes": [{"commit": {"statusCheckRollup": None}}]})
        found = board.prs_from_answer(answer(b0=[running], b1=[none]), ["a", "b"])
        assert (found["a"]["checks"], found["b"]["checks"]) == ("running", None)

    def test_an_open_pull_request_stands_for_the_branch_before_a_merged_or_closed_one(self):
        nodes = [node(9, "CLOSED"), node(8, "MERGED", mergedAt="2026-11-01T00:00:00Z"), node(7, "OPEN")]
        assert board.prs_from_answer(answer(b0=nodes), ["f"])["f"]["number"] == 7
        assert board.prs_from_answer(answer(b0=nodes[:2]), ["f"])["f"]["state"] == "merged"
        assert board.prs_from_answer(answer(b0=nodes[:1]), ["f"])["f"]["state"] == "closed"

    def test_a_branch_with_no_pull_request_is_left_out(self):
        assert board.prs_from_answer(answer(b0=[], b1=[node(3, "MERGED")]), ["a", "b"]).keys() == {"b"}

    def test_an_answer_with_nothing_in_it_is_no_pull_requests(self):
        assert board.prs_from_answer({"data": {"repository": None}}, ["a"]) == {}
        assert board.prs_from_answer(None, ["a"]) == {}


def handoff(name: str, modified: float = 1.0):
    return {"name": f"{name}.md", "relPath": f"docs/plans/handoff/{name}.md", "title": name.title(), "modified": modified}


def tree(name: str, branch: str | None, pr: dict | None = None, v: str = board.LOCAL):
    return {"name": name, "path": f"/w/{name}", "repo": "platform", "branch": branch,
            "uncommitted": 0, "unpushed": 0, "pr": pr, "verdict": v}


class TestAssembling:
    def setup_method(self):
        self.rows = parse_board(BOARD)
        self.handoffs = [handoff("model-metrics"), handoff("orphan")]
        self.metrics = tree("platform-metrics", "gary/metrics", {"number": 1559, "state": "merged"}, board.FINISHED)
        self.stray = tree("platform-stray", "gary/stray")
        self.result = assemble(Path("/w"), self.rows, self.handoffs, [self.metrics, self.stray])

    def stream(self, ticket: str):
        return next(s for s in self.result["streams"] if s["ticket"] == ticket)

    def test_joins_a_ticket_to_its_handoff_and_worktree(self):
        s = self.stream("WRK-214")
        assert s["handoff"]["relPath"] == "docs/plans/handoff/model-metrics.md"
        assert [t["name"] for t in s["worktrees"]] == ["platform-metrics"]

    def test_a_worktree_named_twice_in_a_row_appears_once(self):
        # The row names the folder, the branch and the pull request.
        assert len(self.stream("WRK-214")["worktrees"]) == 1

    def test_finds_a_worktree_by_its_pull_request_alone(self):
        rows = [{**self.rows[0], "names": []}]
        result = assemble(Path("/w"), rows, [], [self.metrics])
        assert [t["name"] for t in result["streams"][0]["worktrees"]] == ["platform-metrics"]

    def test_says_when_a_row_names_a_handoff_that_is_not_there(self):
        s = self.stream("WRK-230")
        assert s["handoff"] is None
        assert s["missingHandoff"] == "shooter-assist"

    def test_returns_the_handoffs_and_worktrees_no_ticket_names(self):
        assert [h["name"] for h in self.result["handoffs"]] == ["orphan"]
        assert [t["name"] for t in self.result["worktrees"]] == ["platform-stray"]

    def test_with_no_board_file_everything_is_unassigned(self):
        result = assemble(Path("/w"), [], self.handoffs, [self.metrics])
        assert result["hasBoardFile"] is False
        assert result["streams"] == []
        assert len(result["handoffs"]) == 2 and len(result["worktrees"]) == 1


def git(repo: Path, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.test",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.test",
    }
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


class TestGatheringFromDisk:
    """Real git, no GitHub: the repositories have no remote, so `gh` says nothing."""

    async def test_reads_a_project_with_a_clone_and_its_worktrees(self, tmp_path: Path):
        project = tmp_path / "work"
        main = project / "repos" / "platform"
        main.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "-b", "main", str(main)], check=True)
        (main / "a.txt").write_text("one")
        git(main, "add", "a.txt")
        git(main, "commit", "-q", "-m", "first")
        git(main, "worktree", "add", "-q", "-b", "gary/metrics", str(project / "repos" / "platform-metrics"))
        (project / "repos" / "platform-metrics" / "new.txt").write_text("x")

        handoffs = project / "docs" / "plans" / "handoff"
        handoffs.mkdir(parents=True)
        (handoffs / "model-metrics.md").write_text("# Metrics\n")
        (project / "docs" / "plans" / "work-board.md").write_text(BOARD)

        result = await board.gather(project)

        s = next(x for x in result["streams"] if x["ticket"] == "WRK-214")
        assert s["handoff"]["name"] == "model-metrics"
        (wt,) = s["worktrees"]
        assert (wt["name"], wt["branch"], wt["repo"]) == ("platform-metrics", "gary/metrics", "platform")
        assert wt["uncommitted"] == 1
        assert wt["verdict"] == board.LOCAL
        # The clone's own checkout is a worktree nobody named.
        assert [t["name"] for t in result["worktrees"]] == ["platform"]

    async def test_a_plain_folder_gives_an_empty_board(self, tmp_path_factory):
        folder = tmp_path_factory.mktemp("plain")
        (folder / ".git").write_text("gitdir: /nonexistent\n")
        result = await board.gather(folder)
        assert (result["streams"], result["handoffs"], result["worktrees"]) == ([], [], [])

    async def test_the_quick_board_is_tickets_and_handoffs_marked_partial(self, tmp_path: Path):
        project = tmp_path / "quick"
        (project / "docs" / "plans" / "handoff").mkdir(parents=True)
        (project / "docs" / "plans" / "handoff" / "model-metrics.md").write_text("# Metrics\n")
        (project / "docs" / "plans" / "work-board.md").write_text(BOARD)

        result = await board.quick(project)
        assert result["partial"] is True
        assert result["worktrees"] == []
        first = next(s for s in result["streams"] if s["ticket"] == "WRK-214")
        assert first["handoff"]["name"] == "model-metrics" and first["worktrees"] == []

    async def test_the_quick_board_is_the_last_full_one_when_there_is_one(self, tmp_path_factory, monkeypatch):
        folder = tmp_path_factory.mktemp("warm")
        (folder / ".git").write_text("gitdir: /nonexistent\n")
        full = await board.board(folder)
        assert full["partial"] is False
        assert await board.quick(folder) is full

    async def test_serves_a_gathered_board_again_without_looking(self, tmp_path_factory, monkeypatch):
        folder = tmp_path_factory.mktemp("cached")
        calls = 0

        async def fake(project: Path):
            nonlocal calls
            calls += 1
            return {"project": str(project), "n": calls}

        monkeypatch.setattr(board, "gather", fake)
        first = await board.board(folder)
        assert await board.board(folder) is first
        assert (await board.board(folder, fresh=True))["n"] == 2


class TestRoute:
    def client(self, tmp_path: Path):
        from unittest.mock import AsyncMock, patch

        from fastapi.testclient import TestClient

        from backend.config import Config, set_config
        from backend.main import create_app

        config = Config(
            port=0, host="127.0.0.1", working_dir=tmp_path, shell_command="bash",
            auto_start_claude=False, auto_open_browser=False, dummy_mode=True,
        )
        set_config(config)
        with patch("backend.main.unify_sessions"), patch(
            "backend.main._check_wsl_health_async", new_callable=AsyncMock
        ):
            return TestClient(create_app(config))

    def test_serves_a_projects_board(self, tmp_path: Path):
        project = tmp_path / "work"
        (project / "docs" / "plans" / "handoff").mkdir(parents=True)
        (project / "docs" / "plans" / "handoff" / "notes.md").write_text("# Notes\n")
        (project / "docs" / "plans" / "work-board.md").write_text(BOARD)
        (project / ".git").write_text("gitdir: /nonexistent\n")

        res = self.client(tmp_path).get("/api/board", params={"path": str(project)})
        assert res.status_code == 200
        body = res.json()
        assert body["project"] == str(project)
        assert [s["ticket"] for s in body["streams"]][:2] == ["WRK-214", "WRK-230"]
        assert [h["name"] for h in body["handoffs"]] == ["notes"]

    def test_a_folder_that_is_not_there_is_404(self, tmp_path: Path):
        res = self.client(tmp_path).get("/api/board", params={"path": str(tmp_path / "nope")})
        assert res.status_code == 404
