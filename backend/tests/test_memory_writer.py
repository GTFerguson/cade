"""Tests for backend/memory/writer.py and the MemoryToolExecutor surface.

Covers:
  - Frontmatter shape matches what nkrdn's memory parser expects
  - Slug generation is stable + collision-safe
  - Idempotency: identical calls return the same URI without rewriting
  - Importance is clamped 1-10
  - Required-field validation surfaces clear errors
  - The tool executor returns parseable JSON status strings
  - The tool executor surfaces validation errors as readable strings

These tests use only the temp_dir fixture from backend/tests/conftest.py;
they don't depend on nkrdn being installed.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pytest

from backend.memory.dedup import TokenJaccardJudge
from backend.memory.tool_executor import MemoryToolExecutor, _ALL_DEFINITIONS
from backend.memory.writer import (
    MEMORY_DIR_NAME,
    MemoryWriter,
    WriteValidationError,
    _slugify,
    _date_stem,
    _resolve_collision,
    _content_hash,
    _extract_hash,
    _format_evidence_list,
)


# ---------------------------------------------------------------------------
# Slug + collision helpers
# ---------------------------------------------------------------------------

def test_slugify_basic():
    assert _slugify("Use JWT for stateless auth") == "use-jwt-for-stateless-auth"


def test_slugify_strips_special_chars():
    assert _slugify("HTTP/2 ↔ gRPC: which?") == "http-2-grpc-which"


def test_slugify_truncates_at_token_boundary():
    long = "this is a very long sentence that absolutely needs truncation because of length"
    slug = _slugify(long, max_len=30)
    assert len(slug) <= 30
    assert not slug.endswith("-")  # no dangling separator


def test_slugify_empty_falls_back():
    assert _slugify("") == "memory"
    assert _slugify("...") == "memory"


def test_date_stem_format():
    stem = _date_stem("Use JWT", today=date(2026, 4, 29))
    assert stem == "2026-04-29-use-jwt"


def test_resolve_collision_returns_base_when_free(temp_dir: Path):
    assert _resolve_collision(temp_dir, "2026-04-29-foo") == "2026-04-29-foo"


def test_resolve_collision_appends_suffix(temp_dir: Path):
    (temp_dir / "2026-04-29-foo.md").write_text("x")
    assert _resolve_collision(temp_dir, "2026-04-29-foo") == "2026-04-29-foo-2"
    (temp_dir / "2026-04-29-foo-2.md").write_text("x")
    assert _resolve_collision(temp_dir, "2026-04-29-foo") == "2026-04-29-foo-3"


# ---------------------------------------------------------------------------
# Content hash
# ---------------------------------------------------------------------------

def test_content_hash_stable_under_alternative_reorder():
    h1 = _content_hash(
        type_="decision",
        primary="rationale",
        alternatives=["a", "b", "c"],
        applies_to=["X"],
    )
    h2 = _content_hash(
        type_="decision",
        primary="rationale",
        alternatives=["c", "a", "b"],
        applies_to=["X"],
    )
    assert h1 == h2


def test_content_hash_changes_with_primary_text():
    h1 = _content_hash(type_="decision", primary="A", alternatives=["x"], applies_to=["S"])
    h2 = _content_hash(type_="decision", primary="B", alternatives=["x"], applies_to=["S"])
    assert h1 != h2


def test_content_hash_distinguishes_types():
    h1 = _content_hash(type_="decision", primary="text", applies_to=["S"])
    h2 = _content_hash(type_="note", primary="text", applies_to=["S"])
    assert h1 != h2


# ---------------------------------------------------------------------------
# Frontmatter shape — must match what nkrdn parser expects
# ---------------------------------------------------------------------------

def _read_memory_file(path: Path) -> tuple[dict, str]:
    """Naive frontmatter reader sufficient for these tests."""
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"missing leading frontmatter delimiter:\n{text}"
    end = text.find("\n---", 4)
    assert end > 0, f"missing trailing frontmatter delimiter:\n{text}"
    fm_block = text[4:end]
    body = text[end + 4 :].lstrip("\n")
    fm: dict = {}
    for line in fm_block.splitlines():
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip()
    return fm, body


def test_decision_writes_expected_frontmatter(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Choose JWT for stateless horizontal scaling.",
        alternatives=["session cookies — requires sticky sessions"],
        applies_to=["AuthService"],
        importance=7,
        tags=["auth", "scaling"],
    )
    assert result.created is True
    fm, body = _read_memory_file(result.path)
    assert fm["type"] == "decision"
    assert fm["applies_to"] == "[[AuthService]]"
    assert fm["authored_by"] == "agent:cade"
    assert fm["importance"] == "7"
    assert fm["tags"] == "[auth, scaling]"
    assert "JWT" in body


def test_decision_emits_considered_options_section(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Reason.",
        alternatives=["alt one", "alt two"],
        applies_to=["X"],
        importance=5,
    )
    body = result.path.read_text(encoding="utf-8")
    assert "## Considered Options" in body
    assert "- alt one" in body
    assert "- alt two" in body


def test_decision_consequences_section(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Reason.",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
        consequences=["positive thing", "negative thing"],
    )
    body = result.path.read_text(encoding="utf-8")
    assert "## Consequences" in body
    assert "- positive thing" in body
    assert "- negative thing" in body


def test_attempt_writes_outcome_section(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_attempt(
        approach="Tried polars instead of pandas.",
        outcome="Lazy frame API didn't fit the streaming use case.",
        applies_to=["DataPipeline"],
        importance=4,
    )
    fm, body = _read_memory_file(result.path)
    assert fm["type"] == "attempt"
    assert "## Outcome" in body
    assert "Lazy frame" in body


# ---------------------------------------------------------------------------
# Evidence formatting + emission
# ---------------------------------------------------------------------------

def test_format_evidence_list_single_wikilink_renders_bare():
    assert _format_evidence_list(["[[agent-memory-systems]]"]) == "[[agent-memory-systems]]"


def test_format_evidence_list_single_url_renders_quoted():
    rendered = _format_evidence_list(["https://arxiv.org/abs/2304.03442"])
    assert rendered == '["https://arxiv.org/abs/2304.03442"]'


def test_format_evidence_list_mixed():
    rendered = _format_evidence_list([
        "[[agent-memory-systems]]",
        "Park et al. 2023",
        "https://arxiv.org/abs/2304.03442",
    ])
    assert rendered == (
        '[[[agent-memory-systems]], '
        'Park et al. 2023, '
        '"https://arxiv.org/abs/2304.03442"]'
    )


# ---------------------------------------------------------------------------
# alternatives → frontmatter (mem:rejectedAlternative triples after ingest)
# ---------------------------------------------------------------------------

def test_decision_emits_alternatives_in_frontmatter(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Use JWT for stateless auth.",
        alternatives=[
            "session cookies — needs sticky sessions",
            "API keys — no expiry semantics",
        ],
        applies_to=["AuthService"],
        importance=7,
    )
    text = result.path.read_text(encoding="utf-8")
    # Frontmatter list — quoted because each item contains ': ' or '—'
    assert (
        'alternatives: ["session cookies — needs sticky sessions", '
        '"API keys — no expiry semantics"]'
    ) in text
    # Body still has Considered Options for human readability
    assert "## Considered Options" in text


def test_attempt_does_not_emit_alternatives(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_attempt(
        approach="Tried polling.",
        outcome="Burned API quota.",
        applies_to=["X"],
        importance=4,
    )
    text = result.path.read_text(encoding="utf-8")
    assert "alternatives:" not in text


def test_note_does_not_emit_alternatives(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="The cache TTL is configured per-deploy, not globally.",
        applies_to=["Cache"],
        importance=3,
    )
    text = result.path.read_text(encoding="utf-8")
    assert "alternatives:" not in text


# ---------------------------------------------------------------------------
# authored_by reflects provider name
# ---------------------------------------------------------------------------

def test_executor_default_author_when_no_provider_name(temp_dir: Path):
    """No provider_name → fall back to DEFAULT_AUTHOR (agent:cade)."""
    executor = MemoryToolExecutor(temp_dir)
    result = executor.execute("record_note", {
        "observation": "x",
        "applies_to": ["Y"],
        "importance": 3,
    })
    payload = json.loads(result)
    text = Path(payload["path"]).read_text(encoding="utf-8")
    assert "authored_by: agent:cade" in text


def test_executor_provider_name_becomes_authored_by(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir, provider_name="cerebras")
    result = executor.execute("record_note", {
        "observation": "x",
        "applies_to": ["Y"],
        "importance": 3,
    })
    payload = json.loads(result)
    text = Path(payload["path"]).read_text(encoding="utf-8")
    assert "authored_by: agent:cerebras" in text


def test_executor_provider_name_lowercased(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir, provider_name="  Mistral  ")
    result = executor.execute("record_note", {
        "observation": "x",
        "applies_to": ["Y"],
        "importance": 3,
    })
    payload = json.loads(result)
    text = Path(payload["path"]).read_text(encoding="utf-8")
    assert "authored_by: agent:mistral" in text


def test_executor_explicit_author_overrides_provider(temp_dir: Path):
    executor = MemoryToolExecutor(
        temp_dir,
        author="agent:custom",
        provider_name="cerebras",
    )
    result = executor.execute("record_note", {
        "observation": "x",
        "applies_to": ["Y"],
        "importance": 3,
    })
    payload = json.loads(result)
    text = Path(payload["path"]).read_text(encoding="utf-8")
    assert "authored_by: agent:custom" in text


def test_decision_emits_evidence_frontmatter(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Use Park et al. triple-score retrieval.",
        alternatives=["pure cosine — loses recency/importance signal"],
        applies_to=["MemoryRetriever"],
        importance=7,
        evidence=[
            "[[agent-memory-systems]]",
            "https://arxiv.org/abs/2304.03442",
        ],
    )
    text = result.path.read_text(encoding="utf-8")
    assert "evidence: [[[agent-memory-systems]], \"https://arxiv.org/abs/2304.03442\"]" in text


def test_decision_omits_evidence_when_empty(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Some rationale.",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    text = result.path.read_text(encoding="utf-8")
    assert "evidence:" not in text


def test_attempt_emits_evidence(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_attempt(
        approach="Tried mocking nkrdn rebuild in tests.",
        outcome="Mocks diverged from real parser; integration tests now hit real nkrdn.",
        applies_to=["MemoryWriter"],
        importance=4,
        evidence=["[[test-driven-debugging]]"],
    )
    text = result.path.read_text(encoding="utf-8")
    assert "evidence: [[test-driven-debugging]]" in text


def test_note_emits_evidence(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="Frontmatter parser splits bracket lists naively on commas.",
        applies_to=["parse_frontmatter"],
        importance=3,
        evidence=["[[agent-memory-capture]]"],
    )
    text = result.path.read_text(encoding="utf-8")
    assert "evidence: [[agent-memory-capture]]" in text


def test_note_minimal(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="The websocket handler swallows CancelledError silently.",
        applies_to=["WebSocketHandler"],
        importance=2,
    )
    fm, body = _read_memory_file(result.path)
    assert fm["type"] == "note"
    assert "websocket" in body.lower()


def test_supersedes_field_emitted(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Switch back to session cookies for HIPAA.",
        alternatives=["keep JWT — fails HIPAA token-storage rules"],
        applies_to=["AuthService"],
        importance=8,
        supersedes="2026-01-12-use-jwt",
    )
    fm, _ = _read_memory_file(result.path)
    assert fm["supersedes"] == "2026-01-12-use-jwt"


def test_multiple_applies_to_renders_as_bracket_list(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Reason.",
        alternatives=["alt"],
        applies_to=["AuthService", "JWTMiddleware"],
        importance=5,
    )
    fm, _ = _read_memory_file(result.path)
    # nkrdn's parser handles both [[Name]] and [Name1, Name2] forms
    assert "AuthService" in fm["applies_to"]
    assert "JWTMiddleware" in fm["applies_to"]


def test_content_hash_embedded_in_file(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="x",
        applies_to=["X"],
        importance=2,
    )
    text = result.path.read_text(encoding="utf-8")
    assert _extract_hash(text) == result.content_hash


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def test_identical_call_is_idempotent(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    first = writer.record_decision(
        rationale="Same rationale.",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    second = writer.record_decision(
        rationale="Same rationale.",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    assert first.created is True
    assert second.created is False
    assert first.path == second.path
    # Only one file should exist
    files = list((temp_dir / MEMORY_DIR_NAME).glob("*.md"))
    assert len(files) == 1


def test_alternative_reorder_is_still_dedup(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    first = writer.record_decision(
        rationale="x",
        alternatives=["a", "b"],
        applies_to=["X"],
        importance=5,
    )
    second = writer.record_decision(
        rationale="x",
        alternatives=["b", "a"],
        applies_to=["X"],
        importance=5,
    )
    assert second.created is False
    assert second.path == first.path


def test_distinct_rationale_creates_distinct_entry(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    first = writer.record_decision(
        rationale="reason one",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    second = writer.record_decision(
        rationale="reason two",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    assert first.created is True
    assert second.created is True
    assert first.path != second.path


def test_different_types_dont_collide(temp_dir: Path):
    """A note and a decision with the same primary text should both write."""
    writer = MemoryWriter(temp_dir)
    note = writer.record_note(
        observation="The same text.",
        applies_to=["X"],
        importance=2,
    )
    decision = writer.record_decision(
        rationale="The same text.",
        alternatives=["alt"],
        applies_to=["X"],
        importance=5,
    )
    assert note.created is True
    assert decision.created is True
    assert note.path != decision.path


# ---------------------------------------------------------------------------
# Importance clamp
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [(-5, 1), (0, 1), (1, 1), (10, 10), (11, 10), (999, 10)])
def test_importance_clamped(temp_dir: Path, raw: int, expected: int):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation=f"importance {raw}",  # vary content to avoid dedup
        applies_to=["X"],
        importance=raw,
    )
    fm, _ = _read_memory_file(result.path)
    assert fm["importance"] == str(expected)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_decision_requires_rationale(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_decision(
            rationale="",
            alternatives=["alt"],
            applies_to=["X"],
            importance=5,
        )


def test_decision_requires_alternatives(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_decision(
            rationale="x",
            alternatives=[],
            applies_to=["X"],
            importance=5,
        )


def test_decision_requires_applies_to(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_decision(
            rationale="x",
            alternatives=["alt"],
            applies_to=[],
            importance=5,
        )


def test_attempt_requires_outcome(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_attempt(
            approach="x",
            outcome="",
            applies_to=["X"],
            importance=3,
        )


def test_note_requires_observation(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_note(
            observation="",
            applies_to=["X"],
            importance=2,
        )


def test_invalid_applies_to_type_rejected(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    with pytest.raises(WriteValidationError):
        writer.record_note(
            observation="x",
            applies_to="not-a-list",  # type: ignore[arg-type]
            importance=2,
        )


# ---------------------------------------------------------------------------
# Filename / location
# ---------------------------------------------------------------------------

def test_files_written_under_dot_cade_memory(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="x",
        applies_to=["X"],
        importance=2,
    )
    assert result.path.is_file()
    assert result.path.parent == (temp_dir / MEMORY_DIR_NAME).resolve()


def test_filename_starts_with_today(temp_dir: Path):
    writer = MemoryWriter(temp_dir)
    result = writer.record_note(
        observation="ymd-prefix-test",
        applies_to=["X"],
        importance=2,
    )
    today = date.today().isoformat()
    assert result.path.name.startswith(today + "-")


# ---------------------------------------------------------------------------
# Tool executor surface
# ---------------------------------------------------------------------------

def test_tool_executor_exposes_four_definitions():
    names = {d.name for d in _ALL_DEFINITIONS}
    assert names == {"record_decision", "record_attempt", "record_note", "record_investigation"}


def test_tool_executor_returns_json_status(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync(
        "record_decision",
        {
            "rationale": "Choose JWT for scaling.",
            "alternatives": ["session cookies"],
            "applies_to": ["AuthService"],
            "importance": 7,
        },
    )
    payload = json.loads(raw)
    assert payload["tool"] == "record_decision"
    assert payload["status"] == "written"
    assert payload["created"] is True
    assert payload["uri_stem"].startswith(date.today().isoformat() + "-")


def test_tool_executor_idempotent_via_status(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    args = {
        "observation": "non-obvious quirk",
        "applies_to": ["X"],
        "importance": 2,
    }
    json.loads(executor._dispatch_sync("record_note", args))
    second_raw = executor._dispatch_sync("record_note", args)
    second = json.loads(second_raw)
    assert second["status"] == "duplicate-skipped"
    assert second["created"] is False


def test_tool_executor_validation_error_surfaces_readably(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync(
        "record_decision",
        {
            # Missing rationale
            "alternatives": ["alt"],
            "applies_to": ["X"],
            "importance": 5,
        },
    )
    assert raw.startswith("Validation error:")
    assert "rationale" in raw


def test_tool_executor_unknown_tool_rejected(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync("not_a_real_tool", {})
    assert raw.startswith("Error:")


def test_tool_definitions_have_required_fields():
    for defn in _ALL_DEFINITIONS:
        schema = defn.parameters_schema
        assert "applies_to" in schema["properties"]
        assert "applies_to" in schema["required"]
        # record_investigation hard-codes importance from verdict; all others expose it
        if defn.name != "record_investigation":
            assert "importance" in schema["properties"]
            assert "importance" in schema["required"]


def test_tool_definitions_returned_by_executor(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    defs = executor.tool_definitions()
    assert {d.name for d in defs} == {d.name for d in _ALL_DEFINITIONS}


@pytest.mark.asyncio
async def test_execute_async_fires_write_broadcast(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir, connection_id="test-conn")

    from backend.memory.tool_executor import register_write_broadcast, unregister_write_broadcast
    received: list[dict] = []

    async def fake_send(msg: dict) -> None:
        received.append(msg)

    register_write_broadcast("test-conn", fake_send)
    try:
        raw = await executor.execute_async(
            "record_decision",
            {
                "rationale": "Use Redis for caching to reduce DB load.",
                "alternatives": ["Memcached"],
                "applies_to": ["CacheLayer"],
                "importance": 6,
            },
        )
        import asyncio
        await asyncio.sleep(0)  # let create_task fire
        payload = json.loads(raw)
        assert payload["action"] == "created"
        assert len(received) == 1
        assert received[0]["type"] == "memory-write"
        assert received[0]["action"] == "created"
        assert received[0]["memory_type"] == "decision"
    finally:
        unregister_write_broadcast("test-conn")


@pytest.mark.asyncio
async def test_execute_async_no_broadcast_on_duplicate(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir, connection_id="test-conn-dup")

    from backend.memory.tool_executor import register_write_broadcast, unregister_write_broadcast
    received: list[dict] = []

    async def fake_send(msg: dict) -> None:
        received.append(msg)

    args = {
        "rationale": "Use Redis for caching to reduce DB load.",
        "alternatives": ["Memcached"],
        "applies_to": ["CacheLayer"],
        "importance": 6,
    }
    register_write_broadcast("test-conn-dup", fake_send)
    try:
        await executor.execute_async("record_decision", args)
        import asyncio
        await asyncio.sleep(0)
        received.clear()
        await executor.execute_async("record_decision", args)  # duplicate
        await asyncio.sleep(0)
        assert received == []  # skipped — no broadcast
    finally:
        unregister_write_broadcast("test-conn-dup")


def test_record_investigation_writes_file(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync(
        "record_investigation",
        {
            "applies_to": "[[ACME Holdings]]",
            "verdict": "legit",
            "confidence": 0.92,
            "signals": ["fca_registered", "established_2010"],
            "specter_snapshot": "ACME Holdings Ltd, founded 2010, FCA-regulated, active.",
            "rationale": "Strong regulatory standing and long operating history.",
            "transaction_id": "tx-042",
        },
    )
    payload = json.loads(raw)
    assert payload["status"] == "written"
    assert payload["created"] is True
    content = Path(payload["path"]).read_text()
    assert "type: investigation" in content
    assert "transaction-triage" in content
    assert "legit" in content
    assert "fca_registered" in content
    assert "tx-042" in content


def test_record_investigation_importance_escalate(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync(
        "record_investigation",
        {
            "applies_to": "[[Dodgy Corp]]",
            "verdict": "block",
            "confidence": 0.95,
            "signals": ["sanctions_hit"],
            "specter_snapshot": "Dodgy Corp, sanctions-listed entity.",
            "rationale": "Sanctions list match — hard block.",
            "transaction_id": "tx-043",
        },
    )
    payload = json.loads(raw)
    assert payload["status"] == "written"
    content = Path(payload["path"]).read_text()
    assert "importance: 7" in content  # block → high importance


def test_record_investigation_missing_applies_to(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    raw = executor._dispatch_sync("record_investigation", {"applies_to": ""})
    assert raw.startswith("Validation error:")


def test_record_investigation_strips_wiki_link_brackets(temp_dir: Path):
    executor = MemoryToolExecutor(temp_dir)
    for form in ("[[ACME Ltd]]", "ACME Ltd"):
        raw = executor._dispatch_sync(
            "record_investigation",
            {
                "applies_to": form,
                "verdict": "legit",
                "confidence": 0.8,
                "signals": [],
                "specter_snapshot": "ACME Ltd, active.",
                "rationale": "Clean record.",
                "transaction_id": f"tx-{form[:4]}",
            },
        )
        payload = json.loads(raw)
        content = Path(payload["path"]).read_text()
        assert "[[ACME Ltd]]" in content  # writer always wraps in wiki-link


# ---------------------------------------------------------------------------
# Schema match with nkrdn parser
# ---------------------------------------------------------------------------

def test_written_file_parses_under_nkrdn_parser(temp_dir: Path):
    """Round-trip: write a memory entry and let the nkrdn parser ingest it.

    Skipped if nkrdn is not importable (the test suite normally runs without
    it). When available, this catches frontmatter shape regressions that
    silently break ingestion.
    """
    pytest.importorskip("nkrdn.parsers.memory.parser")
    from nkrdn.parsers.memory.parser import parse_memory_file

    writer = MemoryWriter(temp_dir)
    result = writer.record_decision(
        rationale="Schema-check decision.",
        alternatives=["alt one"],
        applies_to=["AuthService"],
        importance=7,
        tags=["auth"],
        supersedes="2026-01-01-prior",
    )
    triples = parse_memory_file(result.path)
    # We expect at least: rdf:type, mem:content, mem:unresolvedLink (no
    # resolver passed), mem:supersedes, mem:authoredBy, mem:duringSession,
    # mem:tag (one), mem:importance, mem:createdAt, mem:sourceFile
    assert len(triples) >= 9
    predicates = {str(p) for _, p, _ in triples}
    expected_some = {
        "http://nkrdn.knowledge/memory#content",
        "http://nkrdn.knowledge/memory#supersedes",
        "http://nkrdn.knowledge/memory#authoredBy",
        "http://nkrdn.knowledge/memory#importance",
    }
    assert expected_some.issubset(predicates), f"missing predicates: {expected_some - predicates}"


# ---------------------------------------------------------------------------
# Phase 6 P5: TokenJaccardJudge — refinement (Update) path
# ---------------------------------------------------------------------------


def test_jaccard_judge_skips_exact_match(temp_dir: Path):
    writer = MemoryWriter(temp_dir, dedup_judge=TokenJaccardJudge())
    first = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling everywhere.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    second = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling everywhere.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    assert first.action == "created"
    assert second.action == "skipped"
    assert second.created is False
    assert first.path == second.path


def test_jaccard_judge_updates_in_place_on_high_similarity(temp_dir: Path):
    writer = MemoryWriter(temp_dir, dedup_judge=TokenJaccardJudge(update_threshold=0.6))
    first = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling everywhere in this module.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    refined = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling everywhere in this module and propagate to telemetry.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    assert first.action == "created"
    assert refined.action == "updated"
    assert refined.created is False
    # Same URI/path — the entry was refined in place
    assert refined.path == first.path
    # Only one file should exist on disk
    files = list((temp_dir / MEMORY_DIR_NAME).glob("*.md"))
    assert len(files) == 1
    # The body should now reflect the refined text
    assert "telemetry" in files[0].read_text(encoding="utf-8")


def test_jaccard_judge_creates_new_when_dissimilar(temp_dir: Path):
    writer = MemoryWriter(temp_dir, dedup_judge=TokenJaccardJudge(update_threshold=0.7))
    first = writer.record_decision(
        rationale="Use Result over throwing for auth errors.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    unrelated = writer.record_decision(
        rationale="Token bucket rate limiting because predictable burst tolerance.",
        alternatives=["sliding window"],
        applies_to=["AuthService"],
        importance=5,
    )
    assert first.action == "created"
    assert unrelated.action == "created"
    assert first.path != unrelated.path


def test_jaccard_judge_only_considers_same_target(temp_dir: Path):
    writer = MemoryWriter(temp_dir, dedup_judge=TokenJaccardJudge(update_threshold=0.5))
    first = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling.",
        alternatives=["panic"],
        applies_to=["AuthService"],
        importance=5,
    )
    # Same body but different target — must NOT trigger Update
    elsewhere = writer.record_decision(
        rationale="Use Result over throwing for explicit error handling.",
        alternatives=["panic"],
        applies_to=["RateLimiter"],
        importance=5,
    )
    assert first.action == "created"
    assert elsewhere.action == "created"
    assert first.path != elsewhere.path


# ---------------------------------------------------------------------------
# LLMDedupJudge — conservative fallback + Supersede verdict path
# ---------------------------------------------------------------------------

def test_llm_dedup_judge_falls_back_to_new_on_llm_failure(temp_dir: Path):
    """When the LLM call fails, LLMDedupJudge must return New (not raise)."""
    from backend.memory.dedup import LLMDedupJudge
    from unittest.mock import patch

    # Use a model/key combo that will fail (no real API call in tests)
    judge = LLMDedupJudge(model="nonexistent/model", api_key="bad-key")
    writer = MemoryWriter(temp_dir, dedup_judge=judge)

    first = writer.record_decision(
        rationale="Use PostgreSQL for its ACID guarantees and mature tooling.",
        alternatives=["MySQL", "SQLite"],
        applies_to=["DataLayer"],
        importance=6,
    )
    # Moderately different body on the same target — overlaps enough to
    # trigger the LLM check, which will fail → conservative New
    second = writer.record_decision(
        rationale="Switch to MySQL because the team has more operational experience with it.",
        alternatives=["PostgreSQL", "SQLite"],
        applies_to=["DataLayer"],
        importance=5,
    )
    assert first.action == "created"
    assert second.action == "created"
    assert first.path != second.path


def test_llm_dedup_judge_returns_supersede_when_llm_says_yes(temp_dir: Path):
    """When the LLM returns YES, LLMDedupJudge produces a Supersede verdict."""
    from backend.memory.dedup import LLMDedupJudge
    from unittest.mock import MagicMock, patch

    judge = LLMDedupJudge(model="any/model", api_key="key")
    writer = MemoryWriter(temp_dir, dedup_judge=judge)

    # Use substantially overlapping rationale text so token-set Jaccard falls in
    # the ambiguous zone (> _SUPERSEDE_MIN_OVERLAP=0.20, < update_threshold=0.70)
    # and the LLM check is triggered.
    first = writer.record_decision(
        rationale=(
            "Use PostgreSQL for the primary data store because of ACID compliance "
            "and its strong reliability guarantees for production workloads."
        ),
        alternatives=["MySQL", "SQLite"],
        applies_to=["DataLayer"],
        importance=6,
    )

    mock_resp = MagicMock()
    mock_resp.choices[0].message.content = "YES"

    with patch("litellm.completion", return_value=mock_resp):
        second = writer.record_decision(
            rationale=(
                "Use MySQL for the primary data store instead of PostgreSQL because "
                "the team has operational experience with MySQL for production workloads."
            ),
            alternatives=["PostgreSQL", "SQLite"],
            applies_to=["DataLayer"],
            importance=5,
        )

    assert first.action == "created"
    # Supersede falls through to the New path — creates a new file
    assert second.action == "created"
    assert second.path != first.path
    # New file must carry the supersedes link
    content = second.path.read_text()
    assert first.uri_stem in content


def test_llm_dedup_judge_skips_empty_body(temp_dir: Path):
    """Empty body produces no tokens — LLM check must be skipped."""
    from backend.memory.dedup import LLMDedupJudge, load_candidates, DedupCandidate
    from unittest.mock import patch
    from pathlib import Path as _Path

    judge = LLMDedupJudge(model="any/model", api_key="key")
    writer = MemoryWriter(temp_dir, dedup_judge=judge)
    writer.record_decision(
        rationale="Use Redis for caching.",
        alternatives=["Memcached"],
        applies_to=["CacheLayer"],
        importance=5,
    )

    with patch("litellm.completion") as mock_llm:
        # Force an empty-body scenario by calling judge directly
        candidates = load_candidates(temp_dir / "memory", type_="decision", applies_to=["CacheLayer"])
        from backend.memory.dedup import New
        verdict = judge.judge(
            type_="decision",
            applies_to=["CacheLayer"],
            body="",  # empty — no tokens
            content_hash="deadbeef",
            candidates=candidates,
        )
    assert isinstance(verdict, New)
    mock_llm.assert_not_called()


def test_llm_dedup_judge_skips_dissimilar_candidates(temp_dir: Path):
    """No LLM call when token overlap is below _SUPERSEDE_MIN_OVERLAP."""
    from backend.memory.dedup import LLMDedupJudge
    from unittest.mock import patch

    judge = LLMDedupJudge(model="any/model", api_key="key")
    writer = MemoryWriter(temp_dir, dedup_judge=judge)

    writer.record_decision(
        rationale="The authentication layer should use JWT tokens for stateless auth.",
        alternatives=["session cookies"],
        applies_to=["AuthService"],
        importance=7,
    )

    with patch("litellm.completion") as mock_llm:
        # Completely unrelated topic on the same target — overlap below threshold
        writer.record_decision(
            rationale="The database connection pool size should be tuned to 20 connections.",
            alternatives=["unbounded pool"],
            applies_to=["AuthService"],
            importance=4,
        )
    mock_llm.assert_not_called()
