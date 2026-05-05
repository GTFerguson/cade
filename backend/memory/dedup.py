"""Dedup decisions at memory write time.

This module implements the verdict layer between an incoming
`record_*` call and the disk writer. Verdicts follow the rubric in
`docs/reference/agent-memory-capture.md` §3.2:

| Pattern                                       | Action     |
|-----------------------------------------------|------------|
| Same type AND target AND identical content    | Skip       |
| Same type AND target AND minor refinement     | Update     |
| Same type AND target AND contradicts existing | Supersede  |
| Anything else                                  | New        |

The Skip path is exact (content-hash). The Update path uses token-set
overlap (cheap, deterministic, no LLM dependency). The Supersede path
genuinely requires semantic understanding — see `LLMJudge` below for
the pluggable interface; without one configured, the writer treats
"differs but same target" as New (the safe default).

Phase 6 P5 ships the deterministic + Jaccard layer. The LLM judge
interface is here so a follow-up commit can wire it in without
restructuring the writer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol

import yaml


# ---------------------------------------------------------------------------
# Verdict types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Skip:
    """Identical content already exists — return the existing entry silently."""
    candidate: "DedupCandidate"


@dataclass(frozen=True)
class Update:
    """Body refines/extends the existing entry — overwrite body, keep URI."""
    candidate: "DedupCandidate"


@dataclass(frozen=True)
class Supersede:
    """Body contradicts the existing entry — write new with `supersedes:` link."""
    candidate: "DedupCandidate"


@dataclass(frozen=True)
class New:
    """No related entry — write as a fresh file."""


Verdict = Skip | Update | Supersede | New


# ---------------------------------------------------------------------------
# Candidate loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DedupCandidate:
    """An on-disk memory entry that might match an incoming write.

    Fields are pre-parsed at load time so the judge can score without
    re-reading files. The body excludes both frontmatter and the
    cade-content-hash comment line.
    """
    stem: str
    path: Path
    type_: str
    applies_to: tuple[str, ...]
    content_hash: str | None
    body: str


_HASH_LINE_RE = re.compile(r"<!-- *cade-content-hash: ([0-9a-f]{64}) *-->")
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _parse_applies_to(value) -> tuple[str, ...]:
    """Extract bare symbol names from frontmatter `applies_to`.

    Handles all the on-disk shapes that round-trip through YAML:
    - `[[Name]]` → YAML parses as `[["Name"]]` (nested flow sequence)
    - `[[Name1]], [[Name2]]` → not valid YAML; this code path is reached
      via the regex fallback in `_extract_applies_to_raw`
    - Already-quoted strings like `"[[Name]]"` → string with brackets
    """
    if value is None:
        return ()
    if isinstance(value, str):
        names = re.findall(r"\[\[([^\[\]]+)\]\]", value)
        if names:
            return tuple(n.strip() for n in names)
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, list):
                # YAML parsed `[[Name]]` as a nested list; recurse
                out.extend(_parse_applies_to(item))
            elif isinstance(item, str):
                m = re.match(r"^\[\[([^\[\]]+)\]\]$", item.strip())
                out.append(m.group(1).strip() if m else item.strip())
        return tuple(out)
    return ()


def _read_candidate(path: Path) -> DedupCandidate | None:
    """Parse one memory markdown file into a DedupCandidate, or None on error."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    fm_match = _FRONTMATTER_RE.match(text)
    if not fm_match:
        return None
    try:
        fm = yaml.safe_load(fm_match.group(1)) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(fm, dict):
        return None

    type_ = fm.get("type")
    if not isinstance(type_, str):
        return None

    rest = text[fm_match.end():]
    hash_match = _HASH_LINE_RE.search(rest)
    content_hash = hash_match.group(1) if hash_match else None
    if hash_match:
        body = (rest[:hash_match.start()] + rest[hash_match.end():]).strip()
    else:
        body = rest.strip()

    return DedupCandidate(
        stem=path.stem,
        path=path.resolve(),
        type_=type_,
        applies_to=_parse_applies_to(fm.get("applies_to")),
        content_hash=content_hash,
        body=body,
    )


def load_candidates(
    memory_dir: Path,
    *,
    type_: str,
    applies_to: Iterable[str],
) -> list[DedupCandidate]:
    """Find existing entries with the same type and at least one shared target."""
    if not memory_dir.is_dir():
        return []
    targets = {t.strip() for t in applies_to if isinstance(t, str) and t.strip()}
    if not targets:
        return []

    out: list[DedupCandidate] = []
    for md_path in memory_dir.glob("*.md"):
        cand = _read_candidate(md_path)
        if cand is None:
            continue
        if cand.type_ != type_:
            continue
        if not targets.intersection(cand.applies_to):
            continue
        out.append(cand)
    return out


# ---------------------------------------------------------------------------
# Judge interface + implementations
# ---------------------------------------------------------------------------


class DedupJudge(Protocol):
    """Pluggable verdict source. Stateless; safe to share across writes."""

    def judge(
        self,
        *,
        type_: str,
        applies_to: list[str],
        body: str,
        content_hash: str,
        candidates: list[DedupCandidate],
    ) -> Verdict: ...


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN_RE.findall(text.lower()))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


class ContentHashJudge:
    """Phase 4 baseline: skip on exact hash match, otherwise New.

    Kept as the default so existing callers see no behaviour change. Any
    caller that opts into refinement detection can swap in TokenJaccardJudge.
    """

    def judge(
        self,
        *,
        type_: str,
        applies_to: list[str],
        body: str,
        content_hash: str,
        candidates: list[DedupCandidate],
    ) -> Verdict:
        for cand in candidates:
            if cand.content_hash == content_hash:
                return Skip(cand)
        return New()


class TokenJaccardJudge:
    """Adds Update detection on top of ContentHashJudge.

    Decision rule:
      - Exact hash match → Skip (handled like ContentHashJudge).
      - Otherwise, compute token-set Jaccard against each candidate's body.
        If any candidate exceeds `update_threshold` (default 0.70) — i.e.
        the new body is mostly a re-statement with minor edits — return
        Update against that candidate.
      - Otherwise → New.

    The Supersede path requires semantic understanding (does the new body
    *contradict* the old one or merely refine?) and is left to a future
    LLMJudge implementation. Without one, materially-different content
    falls through to New, which is the conservative default per
    [[memory-write-deduplication#3-3-conservative-editing-skillclaw-pattern]].
    """

    def __init__(self, *, update_threshold: float = 0.70) -> None:
        if not 0.0 < update_threshold <= 1.0:
            raise ValueError(f"update_threshold must be in (0, 1], got {update_threshold}")
        self._update_threshold = update_threshold

    def judge(
        self,
        *,
        type_: str,
        applies_to: list[str],
        body: str,
        content_hash: str,
        candidates: list[DedupCandidate],
    ) -> Verdict:
        for cand in candidates:
            if cand.content_hash == content_hash:
                return Skip(cand)

        new_tokens = _tokens(body)
        if not new_tokens:
            return New()

        best: tuple[float, DedupCandidate] | None = None
        for cand in candidates:
            score = _jaccard(new_tokens, _tokens(cand.body))
            if best is None or score > best[0]:
                best = (score, cand)

        if best is not None and best[0] >= self._update_threshold:
            return Update(best[1])
        return New()
