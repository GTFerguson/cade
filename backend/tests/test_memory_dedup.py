"""Tests for backend.memory.dedup — judge interface and built-in judges."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.memory.dedup import (
    ContentHashJudge,
    DedupCandidate,
    New,
    Skip,
    TokenJaccardJudge,
    Update,
    load_candidates,
)


def _write_memory(
    memory_dir: Path,
    *,
    stem: str,
    type_: str,
    applies_to: str,
    body: str,
    content_hash: str | None = "0" * 64,
) -> Path:
    memory_dir.mkdir(parents=True, exist_ok=True)
    hash_line = f"<!-- cade-content-hash: {content_hash} -->\n\n" if content_hash else ""
    path = memory_dir / f"{stem}.md"
    path.write_text(
        f"---\n"
        f"type: {type_}\n"
        f"applies_to: [[{applies_to}]]\n"
        f"created: 2026-05-05\n"
        f"---\n\n"
        f"{hash_line}"
        f"{body}\n",
        encoding="utf-8",
    )
    return path


# ---------------------------------------------------------------------------
# load_candidates
# ---------------------------------------------------------------------------


class TestLoadCandidates:
    def test_returns_empty_when_dir_missing(self, tmp_path: Path):
        assert load_candidates(tmp_path / "nope", type_="decision", applies_to=["X"]) == []

    def test_returns_empty_when_no_targets(self, tmp_path: Path):
        _write_memory(tmp_path, stem="m1", type_="decision", applies_to="A", body="x")
        assert load_candidates(tmp_path, type_="decision", applies_to=[]) == []

    def test_filters_by_type(self, tmp_path: Path):
        _write_memory(tmp_path, stem="d1", type_="decision", applies_to="A", body="x")
        _write_memory(tmp_path, stem="n1", type_="note", applies_to="A", body="y")
        results = load_candidates(tmp_path, type_="decision", applies_to=["A"])
        assert [c.stem for c in results] == ["d1"]

    def test_filters_by_target_intersection(self, tmp_path: Path):
        _write_memory(tmp_path, stem="d1", type_="decision", applies_to="A", body="x")
        _write_memory(tmp_path, stem="d2", type_="decision", applies_to="B", body="y")
        results = load_candidates(tmp_path, type_="decision", applies_to=["A"])
        assert [c.stem for c in results] == ["d1"]

    def test_returns_candidate_with_parsed_fields(self, tmp_path: Path):
        _write_memory(
            tmp_path, stem="d1", type_="decision", applies_to="AuthService",
            body="Some rationale text.",
            content_hash="a" * 64,
        )
        [cand] = load_candidates(tmp_path, type_="decision", applies_to=["AuthService"])
        assert cand.stem == "d1"
        assert cand.type_ == "decision"
        assert cand.applies_to == ("AuthService",)
        assert cand.content_hash == "a" * 64
        assert "Some rationale text." in cand.body

    def test_skips_files_without_frontmatter(self, tmp_path: Path):
        bad = tmp_path / "broken.md"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_text("no frontmatter here\n", encoding="utf-8")
        _write_memory(tmp_path, stem="d1", type_="decision", applies_to="A", body="x")
        results = load_candidates(tmp_path, type_="decision", applies_to=["A"])
        assert [c.stem for c in results] == ["d1"]


# ---------------------------------------------------------------------------
# ContentHashJudge — Phase 4 baseline behavior
# ---------------------------------------------------------------------------


class TestContentHashJudge:
    def test_returns_new_when_no_candidates(self):
        verdict = ContentHashJudge().judge(
            type_="decision",
            applies_to=["A"],
            body="x",
            content_hash="abc",
            candidates=[],
        )
        assert isinstance(verdict, New)

    def test_returns_skip_on_exact_hash_match(self, tmp_path: Path):
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body="anything",
        )
        verdict = ContentHashJudge().judge(
            type_="decision",
            applies_to=["A"],
            body="totally different body",
            content_hash="abc",
            candidates=[cand],
        )
        assert isinstance(verdict, Skip)
        assert verdict.candidate.stem == "d1"

    def test_returns_new_on_hash_miss_even_with_candidates(self, tmp_path: Path):
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body="anything",
        )
        verdict = ContentHashJudge().judge(
            type_="decision",
            applies_to=["A"],
            body="x",
            content_hash="xyz",
            candidates=[cand],
        )
        assert isinstance(verdict, New)


# ---------------------------------------------------------------------------
# TokenJaccardJudge — adds Update detection
# ---------------------------------------------------------------------------


class TestTokenJaccardJudge:
    def test_skip_takes_priority_over_jaccard(self, tmp_path: Path):
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body="anything",
        )
        verdict = TokenJaccardJudge().judge(
            type_="decision", applies_to=["A"],
            body="totally different",
            content_hash="abc",
            candidates=[cand],
        )
        assert isinstance(verdict, Skip)

    def test_returns_update_for_high_jaccard_similarity(self, tmp_path: Path):
        # Bodies share most tokens, hash differs → should be Update
        original = "The auth service uses Result over throwing for explicit error handling"
        refined  = "The auth service uses Result over throwing for explicit error handling and telemetry"
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body=original,
        )
        verdict = TokenJaccardJudge(update_threshold=0.7).judge(
            type_="decision", applies_to=["A"],
            body=refined,
            content_hash="xyz",
            candidates=[cand],
        )
        assert isinstance(verdict, Update)
        assert verdict.candidate.stem == "d1"

    def test_returns_new_for_low_jaccard_similarity(self, tmp_path: Path):
        original = "The auth service uses Result over throwing"
        unrelated = "Rate limiter falls back to in-process counter when Redis is down"
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body=original,
        )
        verdict = TokenJaccardJudge(update_threshold=0.7).judge(
            type_="decision", applies_to=["A"],
            body=unrelated,
            content_hash="xyz",
            candidates=[cand],
        )
        assert isinstance(verdict, New)

    def test_picks_best_candidate_when_multiple_above_threshold(self, tmp_path: Path):
        # candidate2 should be a closer match
        c1 = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="h1", body="auth uses Result type for errors",
        )
        c2 = DedupCandidate(
            stem="d2", path=tmp_path / "d2.md",
            type_="decision", applies_to=("A",),
            content_hash="h2", body="auth uses Result type for errors and propagation",
        )
        verdict = TokenJaccardJudge(update_threshold=0.6).judge(
            type_="decision", applies_to=["A"],
            body="auth uses Result type for errors and propagation everywhere",
            content_hash="hnew",
            candidates=[c1, c2],
        )
        assert isinstance(verdict, Update)
        assert verdict.candidate.stem == "d2"

    def test_threshold_validation(self):
        with pytest.raises(ValueError):
            TokenJaccardJudge(update_threshold=0.0)
        with pytest.raises(ValueError):
            TokenJaccardJudge(update_threshold=1.5)

    def test_empty_body_returns_new(self, tmp_path: Path):
        cand = DedupCandidate(
            stem="d1", path=tmp_path / "d1.md",
            type_="decision", applies_to=("A",),
            content_hash="abc", body="something",
        )
        verdict = TokenJaccardJudge().judge(
            type_="decision", applies_to=["A"],
            body="",
            content_hash="xyz",
            candidates=[cand],
        )
        assert isinstance(verdict, New)
