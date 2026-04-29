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

import json
import logging
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

from backend.memory.writer import (
    DEFAULT_AUTHOR,
    MemoryWriter,
    WriteResult,
    WriteValidationError,
)

logger = logging.getLogger(__name__)


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
]


_TOOL_NAMES = frozenset(d.name for d in _ALL_DEFINITIONS)


def _format_result(result: WriteResult, tool_name: str) -> str:
    """Compact JSON status string the LLM can parse if it wants to."""
    payload = {
        "tool": tool_name,
        "uri_stem": result.uri_stem,
        "path": str(result.path),
        "created": result.created,
        "status": "written" if result.created else "duplicate-skipped",
    }
    return json.dumps(payload)


class MemoryToolExecutor:
    """Executes record_decision / record_attempt / record_note tool calls."""

    def __init__(
        self,
        project_root: Path,
        *,
        author: str | None = None,
        provider_name: str = "",
        connection_id: str = "",
    ) -> None:
        # Author resolution: explicit `author=` wins; otherwise derive from
        # the active LiteLLM provider name (e.g. 'agent:cerebras'). Falling
        # back to DEFAULT_AUTHOR preserves the prior 'agent:cade' behaviour
        # for callers that pass nothing.
        if author is None:
            slug = (provider_name or "").strip().lower()
            author = f"agent:{slug}" if slug else DEFAULT_AUTHOR
        self._writer = MemoryWriter(Path(project_root), author=author)
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
        return self._dispatch_sync(name, arguments)

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
            else:  # unreachable, _TOOL_NAMES guard above
                return f"Error: unhandled memory tool '{name}'"
        except WriteValidationError as exc:
            return f"Validation error: {exc}"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Memory write failed for %s: %s", name, exc)
            return f"Error: memory write failed: {exc}"

        return _format_result(result, name)
