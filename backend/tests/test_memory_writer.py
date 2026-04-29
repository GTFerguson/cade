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

def test_tool_executor_exposes_three_definitions():
    names = {d.name for d in _ALL_DEFINITIONS}
    assert names == {"record_decision", "record_attempt", "record_note"}


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
        assert "importance" in schema["properties"]
        assert "applies_to" in schema["required"]
        assert "importance" in schema["required"]


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
