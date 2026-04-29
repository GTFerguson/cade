"""Markdown emitter for agent memory entries.

Writes `.cade/memory/<YYYY-MM-DD-slug>.md` files with YAML frontmatter that
matches `nkrdn/parsers/memory/parser.py`. Schema fields:

  type: decision | attempt | note | session
  applies_to: [[SymbolName]]          # wiki-links, resolved on nkrdn rebuild
  supersedes: <stem-of-prior-entry>   # optional
  evidence: [[[doc-stem]], "URL", "citation text"]  # optional, mixed
  authored_by: agent:cade
  session: <YYYY-MM-DD>
  tags: [tag1, tag2]
  importance: 1-10                    # clamped at write
  created: <YYYY-MM-DD>

Idempotency: a content hash over (rationale + sorted(alternatives) +
sorted(applies_to)) is compared against existing entries. Exact matches
return the existing URI silently. Phase 4.0 stops there — fuzzy/refinement
detection via embedding ANN + LLM judge is deferred.

The writer does not invoke nkrdn rebuild directly. The FileWatcher in
`backend/nkrdn_service.py` fires on memory `.md` writes and uses its
existing debounce machinery to schedule the rebuild.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)


MEMORY_DIR_NAME = ".cade/memory"
VALID_TYPES = frozenset({"decision", "attempt", "note", "session"})
DEFAULT_AUTHOR = "agent:cade"
SLUG_MAX_LEN = 50


@dataclass(frozen=True)
class WriteResult:
    """Outcome of a write call."""
    uri_stem: str          # The filename stem (also the mem: URI suffix)
    path: Path             # Absolute path of the markdown file
    created: bool          # False if this was an idempotent no-op
    content_hash: str      # The hash that determined idempotency


# ---------------------------------------------------------------------------
# Slug generation
# ---------------------------------------------------------------------------

_SLUG_KEEP = re.compile(r"[a-z0-9]+")


def _slugify(text: str, max_len: int = SLUG_MAX_LEN) -> str:
    """Lowercase kebab-case slug; falls back to 'memory' if empty."""
    tokens = _SLUG_KEEP.findall(text.lower())
    if not tokens:
        return "memory"
    slug = "-".join(tokens)
    if len(slug) <= max_len:
        return slug
    # Cut at the nearest token boundary <= max_len
    truncated = slug[:max_len]
    last_dash = truncated.rfind("-")
    if last_dash > max_len // 2:
        truncated = truncated[:last_dash]
    return truncated.rstrip("-") or "memory"


def _date_stem(content: str, today: date | None = None) -> str:
    """Build the date-prefixed slug stem from a content snippet."""
    today = today or date.today()
    return f"{today.isoformat()}-{_slugify(content)}"


def _resolve_collision(memory_dir: Path, base_stem: str) -> str:
    """Return a stem that doesn't collide with an existing file in memory_dir."""
    if not (memory_dir / f"{base_stem}.md").exists():
        return base_stem
    n = 2
    while (memory_dir / f"{base_stem}-{n}.md").exists():
        n += 1
        if n > 999:  # paranoia guard; would mean ~1000 dupes in one day
            raise RuntimeError(f"Could not resolve slug collision for {base_stem}")
    return f"{base_stem}-{n}"


# ---------------------------------------------------------------------------
# Content hashing for idempotency
# ---------------------------------------------------------------------------

def _content_hash(
    *,
    type_: str,
    primary: str,
    alternatives: list[str] | None = None,
    applies_to: list[str] | None = None,
) -> str:
    """Stable hash for idempotency. Order-independent on alternatives/applies_to."""
    h = hashlib.sha256()
    h.update(type_.encode("utf-8"))
    h.update(b"\x00")
    h.update(primary.strip().encode("utf-8"))
    h.update(b"\x00")
    for alt in sorted(a.strip() for a in (alternatives or [])):
        h.update(alt.encode("utf-8"))
        h.update(b"\x01")
    h.update(b"\x00")
    for tgt in sorted(a.strip() for a in (applies_to or [])):
        h.update(tgt.encode("utf-8"))
        h.update(b"\x02")
    return h.hexdigest()


_HASH_LINE_RE = re.compile(r"<!-- *cade-content-hash: ([0-9a-f]{64}) *-->")


def _extract_hash(text: str) -> str | None:
    m = _HASH_LINE_RE.search(text)
    return m.group(1) if m else None


def _scan_for_duplicate(memory_dir: Path, content_hash: str) -> Path | None:
    """Linear scan of memory_dir for a file whose embedded hash matches."""
    if not memory_dir.is_dir():
        return None
    for md_path in memory_dir.glob("*.md"):
        try:
            text = md_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if _extract_hash(text) == content_hash:
            return md_path
    return None


# ---------------------------------------------------------------------------
# Frontmatter + body emission
# ---------------------------------------------------------------------------

def _yaml_escape(value: str) -> str:
    """Quote a YAML string if it contains characters that would break parsing."""
    if value == "" or any(c in value for c in ":#'\"\n"):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _format_applies_to(applies_to: list[str]) -> str:
    """Render applies_to wiki-links. Single → `[[Name]]`; multiple → bracket list."""
    if not applies_to:
        return "[]"
    if len(applies_to) == 1:
        return f"[[{applies_to[0]}]]"
    inner = ", ".join(f"[[{name}]]" for name in applies_to)
    return f"[{inner}]"


def _format_tag_list(tags: list[str]) -> str:
    if not tags:
        return "[]"
    return "[" + ", ".join(_yaml_escape(t) for t in tags) + "]"


def _format_quoted_list(items: list[str]) -> str:
    """Render free-text items as a YAML bracket list with every item quoted.

    Used for alternatives: items frequently contain commas, em-dashes, and
    other separators that would break the parser's naive comma split if
    rendered unquoted.
    """
    if not items:
        return "[]"

    def _quote(s: str) -> str:
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'

    return "[" + ", ".join(_quote(s) for s in items) + "]"


_WIKILINK_FULL = re.compile(r"^\[\[([^\[\]]+)\]\]$")


def _format_evidence_item(item: str) -> str:
    """Render one evidence item: keep `[[name]]` verbatim; YAML-quote everything else."""
    stripped = item.strip()
    if _WIKILINK_FULL.match(stripped):
        return stripped
    return _yaml_escape(stripped)


def _format_evidence_list(evidence: list[str]) -> str:
    """Render evidence as a mixed bracket list. Single wiki-link → bare; else list."""
    if len(evidence) == 1 and _WIKILINK_FULL.match(evidence[0].strip()):
        return evidence[0].strip()
    return "[" + ", ".join(_format_evidence_item(e) for e in evidence) + "]"


def _build_frontmatter(
    *,
    type_: str,
    applies_to: list[str],
    importance: int,
    tags: list[str],
    supersedes: str | None,
    evidence: list[str] | None,
    alternatives: list[str] | None,
    today: date,
    author: str,
) -> str:
    lines = [
        "---",
        f"type: {type_}",
        f"applies_to: {_format_applies_to(applies_to)}",
    ]
    if supersedes:
        lines.append(f"supersedes: {supersedes}")
    if evidence:
        lines.append(f"evidence: {_format_evidence_list(evidence)}")
    if alternatives:
        # Same content appears as prose in the body's "Considered Options"
        # section; here it surfaces as queryable mem:rejectedAlternative
        # triples after nkrdn ingest. Always-quote rendering protects items
        # containing commas / em-dashes from the parser's naive split.
        lines.append(f"alternatives: {_format_quoted_list(alternatives)}")
    lines.extend([
        f"authored_by: {author}",
        f"session: {today.isoformat()}",
        f"tags: {_format_tag_list(tags)}",
        f"importance: {importance}",
        f"created: {today.isoformat()}",
        "---",
    ])
    return "\n".join(lines)


def _build_decision_body(
    rationale: str,
    alternatives: list[str],
    consequences: list[str] | None = None,
) -> str:
    """MADR-flavoured body: rationale + Considered Options + Consequences."""
    parts = [rationale.strip()]
    if alternatives:
        parts.append("\n## Considered Options\n")
        parts.append("\n".join(f"- {alt.strip()}" for alt in alternatives))
    if consequences:
        parts.append("\n## Consequences\n")
        parts.append("\n".join(f"- {c.strip()}" for c in consequences))
    return "\n".join(parts)


def _build_attempt_body(approach: str, outcome: str) -> str:
    return (
        f"{approach.strip()}\n\n"
        f"## Outcome\n\n"
        f"{outcome.strip()}"
    )


def _build_note_body(observation: str) -> str:
    return observation.strip()


def _assemble_markdown(frontmatter: str, body: str, content_hash: str) -> str:
    """Combine frontmatter + body, embedding the content hash as a comment line."""
    return (
        f"{frontmatter}\n\n"
        f"<!-- cade-content-hash: {content_hash} -->\n\n"
        f"{body}\n"
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class WriteValidationError(ValueError):
    """Raised when write parameters fail validation."""


def _clamp_importance(importance: int) -> int:
    if not isinstance(importance, int):
        try:
            importance = int(importance)
        except (TypeError, ValueError) as exc:
            raise WriteValidationError(f"importance must be an integer, got {importance!r}") from exc
    return max(1, min(10, importance))


def _validate_strings(name: str, values: list[str], *, allow_empty: bool = False) -> list[str]:
    if not isinstance(values, list):
        raise WriteValidationError(f"{name} must be a list of strings")
    out: list[str] = []
    for v in values:
        if not isinstance(v, str):
            raise WriteValidationError(f"{name} entries must be strings, got {v!r}")
        v = v.strip()
        if not v and not allow_empty:
            continue
        out.append(v)
    return out


def _require_nonempty(name: str, value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise WriteValidationError(f"{name} is required and must be a non-empty string")
    return value.strip()


# ---------------------------------------------------------------------------
# Public writer
# ---------------------------------------------------------------------------

class MemoryWriter:
    """Emits memory markdown files into `.cade/memory/`."""

    def __init__(self, project_root: Path, *, author: str = DEFAULT_AUTHOR) -> None:
        self._root = Path(project_root).resolve()
        self._author = author

    @property
    def memory_dir(self) -> Path:
        return self._root / MEMORY_DIR_NAME

    def _ensure_dir(self) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)

    def _write_file(
        self,
        *,
        type_: str,
        body: str,
        applies_to: list[str],
        importance: int,
        tags: list[str],
        supersedes: str | None,
        evidence: list[str] | None,
        alternatives: list[str] | None,
        content_hash: str,
        slug_seed: str,
    ) -> WriteResult:
        # Idempotency check: matching hash → silent no-op
        existing = _scan_for_duplicate(self.memory_dir, content_hash)
        if existing is not None:
            logger.debug("Skipping duplicate memory write: %s", existing.name)
            return WriteResult(
                uri_stem=existing.stem,
                path=existing.resolve(),
                created=False,
                content_hash=content_hash,
            )

        self._ensure_dir()
        today = date.today()
        base_stem = _date_stem(slug_seed, today=today)
        stem = _resolve_collision(self.memory_dir, base_stem)

        frontmatter = _build_frontmatter(
            type_=type_,
            applies_to=applies_to,
            importance=importance,
            tags=tags,
            supersedes=supersedes,
            evidence=evidence,
            alternatives=alternatives,
            today=today,
            author=self._author,
        )
        markdown = _assemble_markdown(frontmatter, body, content_hash)

        path = self.memory_dir / f"{stem}.md"
        path.write_text(markdown, encoding="utf-8")
        logger.info("Wrote memory entry: %s", path.name)
        return WriteResult(
            uri_stem=stem,
            path=path.resolve(),
            created=True,
            content_hash=content_hash,
        )

    # -- record_decision ----------------------------------------------------

    def record_decision(
        self,
        *,
        rationale: str,
        alternatives: list[str],
        applies_to: list[str],
        importance: int,
        consequences: list[str] | None = None,
        supersedes: str | None = None,
        tags: list[str] | None = None,
        evidence: list[str] | None = None,
    ) -> WriteResult:
        rationale = _require_nonempty("rationale", rationale)
        alternatives = _validate_strings("alternatives", alternatives or [])
        if not alternatives:
            raise WriteValidationError(
                "record_decision requires at least one rejected alternative"
            )
        applies_to = _validate_strings("applies_to", applies_to or [])
        if not applies_to:
            raise WriteValidationError(
                "record_decision requires at least one applies_to target"
            )
        cons = _validate_strings("consequences", consequences or [])
        tags = _validate_strings("tags", tags or [])
        evidence = _validate_strings("evidence", evidence or [])
        importance = _clamp_importance(importance)
        supersedes_clean = supersedes.strip() if isinstance(supersedes, str) and supersedes.strip() else None

        body = _build_decision_body(rationale, alternatives, cons or None)
        content_hash = _content_hash(
            type_="decision",
            primary=rationale,
            alternatives=alternatives,
            applies_to=applies_to,
        )
        return self._write_file(
            type_="decision",
            body=body,
            applies_to=applies_to,
            importance=importance,
            tags=tags,
            supersedes=supersedes_clean,
            evidence=evidence or None,
            alternatives=alternatives,
            content_hash=content_hash,
            slug_seed=rationale,
        )

    # -- record_attempt -----------------------------------------------------

    def record_attempt(
        self,
        *,
        approach: str,
        outcome: str,
        applies_to: list[str],
        importance: int,
        tags: list[str] | None = None,
        evidence: list[str] | None = None,
    ) -> WriteResult:
        approach = _require_nonempty("approach", approach)
        outcome = _require_nonempty("outcome", outcome)
        applies_to = _validate_strings("applies_to", applies_to or [])
        if not applies_to:
            raise WriteValidationError(
                "record_attempt requires at least one applies_to target"
            )
        tags = _validate_strings("tags", tags or [])
        evidence = _validate_strings("evidence", evidence or [])
        importance = _clamp_importance(importance)

        body = _build_attempt_body(approach, outcome)
        content_hash = _content_hash(
            type_="attempt",
            primary=approach,
            alternatives=[outcome],
            applies_to=applies_to,
        )
        return self._write_file(
            type_="attempt",
            body=body,
            applies_to=applies_to,
            importance=importance,
            tags=tags,
            supersedes=None,
            evidence=evidence or None,
            alternatives=None,
            content_hash=content_hash,
            slug_seed=approach,
        )

    # -- record_note --------------------------------------------------------

    def record_note(
        self,
        *,
        observation: str,
        applies_to: list[str],
        importance: int,
        tags: list[str] | None = None,
        evidence: list[str] | None = None,
    ) -> WriteResult:
        observation = _require_nonempty("observation", observation)
        applies_to = _validate_strings("applies_to", applies_to or [])
        if not applies_to:
            raise WriteValidationError(
                "record_note requires at least one applies_to target"
            )
        tags = _validate_strings("tags", tags or [])
        evidence = _validate_strings("evidence", evidence or [])
        importance = _clamp_importance(importance)

        body = _build_note_body(observation)
        content_hash = _content_hash(
            type_="note",
            primary=observation,
            alternatives=None,
            applies_to=applies_to,
        )
        return self._write_file(
            type_="note",
            body=body,
            applies_to=applies_to,
            importance=importance,
            tags=tags,
            supersedes=None,
            evidence=evidence or None,
            alternatives=None,
            content_hash=content_hash,
            slug_seed=observation,
        )
