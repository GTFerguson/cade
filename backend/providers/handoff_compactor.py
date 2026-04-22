"""Handoff compactor for agent context continuation."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class HandoffCompactor:
    """Generates and approves handoff briefs for agent context continuation."""

    def generate_brief(
        self,
        chat_context: list[dict[str, Any]],
        summary: str = "",
        decisions: list[str] | None = None,
        artifacts: list[str] | None = None,
    ) -> str:
        """Generate a handoff brief from chat context.

        Args:
            chat_context: List of message dicts from the session
            summary: Optional summary of completed work
            decisions: Optional list of key decisions made
            artifacts: Optional list of artifacts/files created or modified

        Returns:
            A formatted brief suitable for injection into next agent's system prompt
        """
        brief_parts = []

        if summary:
            brief_parts.append(f"## Work Completed\n\n{summary}")

        if decisions:
            brief_parts.append("## Key Decisions\n\n" + "\n".join(f"- {d}" for d in decisions))

        if artifacts:
            brief_parts.append("## Artifacts\n\n" + "\n".join(f"- {a}" for a in artifacts))

        if not brief_parts:
            # Fallback: generate from chat context
            message_count = len(chat_context)
            brief_parts.append(
                f"## Context\n\n"
                f"Previous session included {message_count} messages. "
                "Key work was being done on implementation and testing."
            )

        return "\n\n".join(brief_parts)

    def format_for_injection(self, brief: str) -> str:
        """Format brief for injection into system prompt.

        Args:
            brief: The handoff brief

        Returns:
            Formatted brief with context about continuing from a previous session
        """
        return (
            "## Context from Previous Session\n\n"
            f"{brief}\n\n"
            "Continue from where the previous session left off, "
            "using the context above to understand what has been completed."
        )
