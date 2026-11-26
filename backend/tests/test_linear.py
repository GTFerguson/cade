"""Reading tickets from Linear (backend/linear.py). No request leaves the machine."""

from __future__ import annotations

from typing import Any

from backend import linear


def node(ident: str, *, state: str = "In Progress", kind: str = "started", parent: str | None = None):
    team, _ = ident.split("-")
    return {
        "identifier": ident, "title": f"Title of {ident}", "url": f"https://tracker.test/{ident}",
        "updatedAt": "2026-11-26T10:00:00Z", "state": {"name": state, "type": kind},
        "parent": {"identifier": parent} if parent else None, "team": {"key": team},
    }


class FakeLinear:
    """Answers the two queries the module sends, from a set of tickets."""

    def __init__(self, assigned: list[dict], others: list[dict] | None = None, page: int = 100):
        self.assigned = assigned
        self.all = {n["identifier"]: n for n in [*assigned, *(others or [])]}
        self.page = page
        self.calls: list[dict[str, Any]] = []

    async def post(self, query: str, variables: dict[str, Any]):
        self.calls.append(variables)
        if "assignedIssues" in query:
            start = int(variables.get("after") or 0)
            chunk = self.assigned[start:start + self.page]
            more = start + self.page < len(self.assigned)
            return {"viewer": {"assignedIssues": {
                "pageInfo": {"hasNextPage": more, "endCursor": str(start + self.page)}, "nodes": chunk,
            }}}
        wanted = {f"{variables['team']}-{int(n)}" for n in variables["numbers"]}
        return {"issues": {"nodes": [n for i, n in self.all.items() if i in wanted]}}


def test_a_ticket_is_reduced_to_what_the_board_uses():
    assert linear.normalise(node("WRK-2", state="In Review", parent="WRK-1")) == {
        "ticket": "WRK-2", "title": "Title of WRK-2", "url": "https://tracker.test/WRK-2",
        "status": "In Review", "statusType": "started", "parent": "WRK-1",
        "updated": "2026-11-26T10:00:00Z",
    }
    assert linear.normalise({"identifier": "WRK-3"})["parent"] is None


async def test_reads_every_page_of_the_owners_unfinished_tickets():
    fake = FakeLinear([node(f"WRK-{i}") for i in range(1, 8)], page=3)
    found = await linear.assigned_open(fake.post)
    assert [t["ticket"] for t in found] == [f"WRK-{i}" for i in range(1, 8)]
    assert [c.get("after") for c in fake.calls] == [None, "3", "6"]


async def test_asks_for_named_tickets_once_per_team():
    fake = FakeLinear([], [node("WRK-1"), node("WRK-2"), node("OPS-9"), node("WRK-3")])
    found = await linear.by_id({"WRK-1", "WRK-2", "OPS-9", "not a ticket"}, fake.post)
    assert sorted(t["ticket"] for t in found) == ["OPS-9", "WRK-1", "WRK-2"]
    assert [(c["team"], c["numbers"]) for c in fake.calls] == [("OPS", [9]), ("WRK", [1, 2])]


async def test_gathers_my_tickets_the_named_ones_and_the_parents_above_them():
    fake = FakeLinear(
        [node("WRK-10", parent="WRK-5")],
        [node("WRK-5", parent="WRK-1"), node("WRK-1"), node("WRK-20", state="Done", kind="completed"), node("WRK-99")],
    )
    known = await linear.tickets({"WRK-10", "WRK-20"}, fake.post)
    assert sorted(known) == ["WRK-1", "WRK-10", "WRK-20", "WRK-5"]
    assert known["WRK-10"]["mine"] is True
    assert known["WRK-20"]["mine"] is False and known["WRK-20"]["statusType"] == "completed"
    # The parents were followed up the chain, and nothing unasked-for was read.
    assert known["WRK-5"]["parent"] == "WRK-1"
    assert "WRK-99" not in known


async def test_does_not_chase_a_chain_of_parents_for_ever():
    chain = [node(f"WRK-{i}", parent=f"WRK-{i + 1}") for i in range(1, 12)]
    fake = FakeLinear([chain[0]], chain[1:])
    known = await linear.tickets(set(), fake.post)
    assert len(known) == 1 + linear.PARENT_LEVELS + 1


async def test_a_tracker_that_cannot_be_read_gives_none():
    async def down(_query: str, _variables: dict[str, Any]):
        return None

    assert await linear.tickets({"WRK-1"}, down) is None


async def test_with_no_key_nothing_is_sent(monkeypatch, tmp_path):
    monkeypatch.delenv("LINEAR_API_KEY", raising=False)
    monkeypatch.setattr(linear.Path, "home", classmethod(lambda cls: tmp_path))
    assert linear.read_key() is None
    assert await linear.tickets({"WRK-1"}) is None


def test_reads_the_key_from_the_environment_or_the_users_file(monkeypatch, tmp_path):
    monkeypatch.setattr(linear.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.delenv("LINEAR_API_KEY", raising=False)
    (tmp_path / ".cade").mkdir()
    (tmp_path / ".cade" / ".env").write_text("OTHER=1\nLINEAR_API_KEY=from-file\n")
    assert linear.read_key() == "from-file"
    monkeypatch.setenv("LINEAR_API_KEY", "from-env")
    assert linear.read_key() == "from-env"
