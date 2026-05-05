"""Tool executor exposing memory writers to the LLM agent.

Implements the ToolExecutor protocol used by `core.backend.providers.tool_executor.ToolRegistry`.
Three type-discriminated tools — record_decision, record_attempt, record_note —
each with required schema fields. Type discrimination is deliberate: the
parameter shape signals what good content looks like and stops the agent from
collapsing everything into a generic save_memory call.

Returns short status strings the LLM can read. The writer's idempotency check
silently absorbs duplicates, so the agent can call these tools liberally.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

from backend.memory.dedup import DedupJudge, TokenJaccardJudge
from backend.memory.writer import (
    DEFAULT_AUTHOR,
    MemoryWriter,
    WriteResult,
    WriteValidationError,
)

logger = logging.getLogger(__name__)

# Connection-keyed send callbacks. The websocket registers its _send function
# here so the executor can emit memory-write events without a direct reference.
_WRITE_BROADCASTS: dict[str, Callable[[dict], Coroutine[Any, Any, None]]] = {}


def register_write_broadcast(connection_id: str, send_fn: Callable[[dict], Coroutine[Any, Any, None]]) -> None:
    if connection_id:
        _WRITE_BROADCASTS[connection_id] = send_fn


def unregister_write_broadcast(connection_id: str) -> None:
    _WRITE_BROADCASTS.pop(connection_id, None)


# ---------------------------------------------------------------------------
# JSON Schemas (presented to the LLM as the tool contract)
# ---------------------------------------------------------------------------

_DECISION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "rationale": {
            "type": "string",
            "description": (
                "WHY this choice was made. Include the forces and constraints that "
                "drove the decision, not just what was decided. Several sentences "
                "of prose, not a one-liner."
            ),
        },
        "alternatives": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Rejected alternatives, one per item. Each entry should briefly "
                "name the option and the reason it was rejected. At least one "
                "alternative is required — if there were no real alternatives, "
                "this isn't a decision worth recording."
            ),
            "minItems": 1,
        },
        "applies_to": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Symbol or component names this decision affects. Use the bare "
                "name (e.g. 'AuthService', 'JWTMiddleware') — wiki-link "
                "resolution to a stable code URI happens on the next nkrdn "
                "rebuild."
            ),
            "minItems": 1,
        },
        "importance": {
            "type": "integer",
            "description": (
                "Importance score 1-10. Anchor: 3 routine choice, 5 standard "
                "trade-off with rationale, 7 architectural decision with broad "
                "impact, 9 critical (security, correctness, contractual). Score "
                "at write time using context only you have right now."
            ),
            "minimum": 1,
            "maximum": 10,
        },
        "consequences": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Optional. Bulleted consequences of the decision — both positive "
                "AND negative. Be honest about the negatives; future readers "
                "need them more than the positives."
            ),
        },
        "supersedes": {
            "type": "string",
            "description": (
                "Optional. The filename stem of a prior memory entry this "
                "decision replaces. Use only when the prior decision was "
                "explicitly reversed, not for refinements."
            ),
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional categorisation tags (e.g. ['auth', 'security']).",
        },
        "evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Optional. Backing references that ground this decision. Each "
                "item can be a wiki-link to a reference doc or symbol "
                "([[agent-memory-systems]]), a URL "
                "(https://arxiv.org/abs/2304.03442), or a citation literal "
                "('Park et al. 2023'). Wiki-links resolve to graph URIs on "
                "the next nkrdn rebuild; other strings stay as literals."
            ),
        },
    },
    "required": ["rationale", "alternatives", "applies_to", "importance"],
}

_ATTEMPT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "approach": {
            "type": "string",
            "description": (
                "What was tried — the approach that didn't work. Specific "
                "enough that a future agent could recognise the same dead end "
                "if they considered it."
            ),
        },
        "outcome": {
            "type": "string",
            "description": (
                "What went wrong and why. The actual failure mode, not 'didn't "
                "work'. Future agents save time by knowing the specific failure."
            ),
        },
        "applies_to": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Symbol or component names this attempt affects.",
            "minItems": 1,
        },
        "importance": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10,
            "description": "Importance score 1-10, same scale as record_decision.",
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
        },
        "evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Optional. Backing references — wiki-links to reference docs "
                "or symbols, URLs, or citation literals. See record_decision "
                "for format details."
            ),
        },
    },
    "required": ["approach", "outcome", "applies_to", "importance"],
}

_NOTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "observation": {
            "type": "string",
            "description": (
                "A non-obvious finding worth keeping. Code quirks, hidden "
                "constraints, surprising behaviours. Use sparingly — small "
                "edits and routine tool calls are NOT notes."
            ),
        },
        "applies_to": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Symbol or component names the note describes.",
            "minItems": 1,
        },
        "importance": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10,
            "description": "Importance 1-10. Notes typically score lower than decisions.",
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
        },
        "evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Optional. Backing references — wiki-links to reference docs "
                "or symbols, URLs, or citation literals. See record_decision "
                "for format details."
            ),
        },
    },
    "required": ["observation", "applies_to", "importance"],
}

_INVESTIGATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "applies_to": {
            "type": "string",
            "description": (
                "Counterparty name as a wiki-link, e.g. '[[ACME Holdings]]'. "
                "Used to attach this investigation to the counterparty entity "
                "in the knowledge graph."
            ),
        },
        "verdict": {
            "type": "string",
            "enum": ["legit", "escalate", "block"],
            "description": (
                "Triage verdict for this transaction. 'legit' — approve and "
                "pass through; 'escalate' — flag for human review; 'block' — "
                "reject outright."
            ),
        },
        "confidence": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "Confidence in the verdict, from 0.0 (uncertain) to 1.0 (certain).",
        },
        "signals": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Risk or trust signals that influenced the verdict, e.g. "
                "['first_time_payee', 'large_amount', 'fca_registered']."
            ),
        },
        "specter_snapshot": {
            "type": "string",
            "description": (
                "2-3 sentence summary of what Specter returned for this "
                "counterparty. Include founding year, operating status, and "
                "any notable highlights."
            ),
        },
        "rationale": {
            "type": "string",
            "description": (
                "Why this verdict was reached. Connect the signals to the "
                "verdict clearly — a future reviewer should understand the "
                "reasoning without re-running the investigation."
            ),
        },
        "transaction_id": {
            "type": "string",
            "description": "The transaction identifier, e.g. 'tx-003'.",
        },
    },
    "required": ["applies_to", "verdict", "confidence", "signals", "specter_snapshot", "rationale", "transaction_id"],
}


_ALL_DEFINITIONS = [
    ToolDefinition(
        name="record_decision",
        description=(
            "Record an architectural or design decision with rationale and "
            "rejected alternatives. Call this AFTER choosing between two or "
            "more concrete approaches with a non-trivial trade-off. The "
            "decision becomes searchable memory attached to the affected "
            "code symbols. Do NOT call for routine code edits or choices "
            "without a real trade-off."
        ),
        parameters_schema=_DECISION_SCHEMA,
    ),
    ToolDefinition(
        name="record_attempt",
        description=(
            "Record an approach that was tried and abandoned, with the "
            "specific failure mode. Call after spending a few tool calls on "
            "an approach that didn't work — a breadcrumb for future sessions "
            "so the same dead end isn't re-explored."
        ),
        parameters_schema=_ATTEMPT_SCHEMA,
    ),
    ToolDefinition(
        name="record_note",
        description=(
            "Record a non-obvious finding worth keeping — code quirks, hidden "
            "constraints, surprising behaviours. Lighter weight than a "
            "decision; use only when a future agent would benefit from "
            "knowing this and would be unlikely to discover it from the code "
            "alone."
        ),
        parameters_schema=_NOTE_SCHEMA,
    ),
    ToolDefinition(
        name="record_investigation",
        description=(
            "Record a completed transaction triage investigation — verdict, "
            "confidence, signals observed, Specter counterparty snapshot, and "
            "rationale. Call once per transaction after reaching a verdict. "
            "Persists findings to the knowledge graph so future queries about "
            "this counterparty start from accumulated intelligence."
        ),
        parameters_schema=_INVESTIGATION_SCHEMA,
    ),
]


_TOOL_NAMES = frozenset(d.name for d in _ALL_DEFINITIONS)


_STATUS_BY_ACTION = {
    "created": "written",
    "skipped": "duplicate-skipped",
    "updated": "refined-in-place",
}


def _format_result(result: WriteResult, tool_name: str) -> str:
    """Compact JSON status string the LLM can parse if it wants to."""
    payload = {
        "tool": tool_name,
        "uri_stem": result.uri_stem,
        "path": str(result.path),
        "created": result.created,
        "action": result.action,
        "status": _STATUS_BY_ACTION.get(result.action, "written"),
    }
    return json.dumps(payload)


class MemoryToolExecutor:
    """Executes record_decision / record_attempt / record_note / record_investigation tool calls."""

    def __init__(
        self,
        project_root: Path,
        *,
        author: str | None = None,
        provider_name: str = "",
        connection_id: str = "",
        dedup_judge: DedupJudge | None = None,
    ) -> None:
        if author is None:
            slug = (provider_name or "").strip().lower()
            author = f"agent:{slug}" if slug else DEFAULT_AUTHOR
        self._writer = MemoryWriter(
            Path(project_root),
            author=author,
            dedup_judge=dedup_judge or TokenJaccardJudge(),
        )
        self._connection_id = connection_id

    # ------------------------------------------------------------------
    # ToolExecutor protocol
    # ------------------------------------------------------------------

    def tool_definitions(self) -> list[ToolDefinition]:
        # Memory capture is exposed uniformly in every mode. Read-only modes
        # (plan, research, review) don't write code, but a research session
        # is precisely where Decisions and Notes accumulate, and plan mode is
        # where the most architectural trade-offs get reasoned through.
        # Gating capture by write_access would lose the highest-signal entries.
        return list(_ALL_DEFINITIONS)

    def execute(self, name: str, arguments: dict) -> str:
        # The shared ToolRegistry prefers execute_async; this is a fallback.
        return self._dispatch_sync(name, arguments)

    async def execute_async(self, name: str, arguments: dict) -> str:
        # Run in a thread: _dispatch_sync does file I/O, and when LLMDedupJudge
        # is active it also calls litellm.completion (sync) — both must stay
        # off the event loop.
        raw = await asyncio.to_thread(self._dispatch_sync, name, arguments)
        send_fn = _WRITE_BROADCASTS.get(self._connection_id) if self._connection_id else None
        if send_fn is not None:
            try:
                payload = json.loads(raw)
                if payload.get("action") in ("created", "updated"):
                    asyncio.create_task(send_fn({
                        "type": "memory-write",
                        "action": payload["action"],
                        "memory_type": payload.get("tool", name).removeprefix("record_"),
                        "uri_stem": payload.get("uri_stem", ""),
                    }))
            except (json.JSONDecodeError, Exception):
                pass
        return raw

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def _dispatch_sync(self, name: str, arguments: dict) -> str:
        if name not in _TOOL_NAMES:
            return f"Error: unknown memory tool '{name}'"
        try:
            if name == "record_decision":
                result = self._writer.record_decision(
                    rationale=arguments.get("rationale", ""),
                    alternatives=arguments.get("alternatives", []) or [],
                    applies_to=arguments.get("applies_to", []) or [],
                    importance=arguments.get("importance", 5),
                    consequences=arguments.get("consequences"),
                    supersedes=arguments.get("supersedes"),
                    tags=arguments.get("tags"),
                    evidence=arguments.get("evidence"),
                )
            elif name == "record_attempt":
                result = self._writer.record_attempt(
                    approach=arguments.get("approach", ""),
                    outcome=arguments.get("outcome", ""),
                    applies_to=arguments.get("applies_to", []) or [],
                    importance=arguments.get("importance", 3),
                    tags=arguments.get("tags"),
                    evidence=arguments.get("evidence"),
                )
            elif name == "record_note":
                result = self._writer.record_note(
                    observation=arguments.get("observation", ""),
                    applies_to=arguments.get("applies_to", []) or [],
                    importance=arguments.get("importance", 3),
                    tags=arguments.get("tags"),
                    evidence=arguments.get("evidence"),
                )
            elif name == "record_investigation":
                result = self._record_investigation(arguments)
            else:  # unreachable, _TOOL_NAMES guard above
                return f"Error: unhandled memory tool '{name}'"
        except WriteValidationError as exc:
            return f"Validation error: {exc}"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Memory write failed for %s: %s", name, exc)
            return f"Error: memory write failed: {exc}"

        return _format_result(result, name)

    def _record_investigation(self, arguments: dict) -> WriteResult:
        """Map record_investigation tool args to MemoryWriter._write_file."""
        from backend.memory.writer import (
            _build_note_body,
            _clamp_importance,
            _content_hash,
            _validate_strings,
            _require_nonempty,
            WriteValidationError,
        )

        applies_to_raw = arguments.get("applies_to", "")
        if not isinstance(applies_to_raw, str) or not applies_to_raw.strip():
            raise WriteValidationError("applies_to is required and must be a non-empty string")
        # Strip wiki-link brackets if present so the writer re-adds them
        applies_to_name = applies_to_raw.strip().lstrip("[[").rstrip("]]")
        applies_to = [applies_to_name]

        verdict = arguments.get("verdict", "")
        rationale = _require_nonempty("rationale", arguments.get("rationale", ""))
        transaction_id = arguments.get("transaction_id", "")
        specter_snapshot = arguments.get("specter_snapshot", "")
        confidence = arguments.get("confidence", 0.5)
        signals = arguments.get("signals", []) or []

        # Build the markdown body: rationale + structured fields as sections
        signals_md = "\n".join(f"- {s}" for s in signals) if signals else "- (none)"
        body = (
            f"{rationale}\n\n"
            f"## Transaction\n\n"
            f"- ID: {transaction_id}\n"
            f"- Verdict: **{verdict}**\n"
            f"- Confidence: {confidence:.0%}\n\n"
            f"## Signals\n\n"
            f"{signals_md}\n\n"
            f"## Specter Snapshot\n\n"
            f"{specter_snapshot}"
        )

        tags = ["transaction-triage", verdict]

        content_hash = _content_hash(
            type_="investigation",
            primary=rationale,
            alternatives=[transaction_id, verdict],
            applies_to=applies_to,
        )

        return self._writer._write_file(
            type_="investigation",
            body=body,
            applies_to=applies_to,
            importance=7 if verdict in ("escalate", "block") else 4,
            tags=tags,
            supersedes=None,
            evidence=None,
            alternatives=None,
            content_hash=content_hash,
            slug_seed=f"{transaction_id} {applies_to_name} {verdict}",
        )
