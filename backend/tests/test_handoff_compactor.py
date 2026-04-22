"""Tests for HandoffCompactor."""

from __future__ import annotations

import pytest

from backend.providers.handoff_compactor import HandoffCompactor


class TestHandoffCompactor:
    """Test HandoffCompactor functionality."""

    def test_initialization(self) -> None:
        """Test compactor initializes."""
        compactor = HandoffCompactor()
        assert compactor is not None

    def test_generate_brief_with_summary(self) -> None:
        """Test brief generation with summary."""
        compactor = HandoffCompactor()
        brief = compactor.generate_brief([], summary="Completed Phase 1 implementation")

        assert "Work Completed" in brief
        assert "Phase 1" in brief

    def test_generate_brief_with_decisions(self) -> None:
        """Test brief generation with decisions."""
        compactor = HandoffCompactor()
        decisions = ["Use async/await pattern", "Store state in session"]
        brief = compactor.generate_brief([], decisions=decisions)

        assert "Key Decisions" in brief
        assert "async/await" in brief
        assert "session" in brief

    def test_generate_brief_with_artifacts(self) -> None:
        """Test brief generation with artifacts."""
        compactor = HandoffCompactor()
        artifacts = ["src/main.ts", "tests/main.test.ts"]
        brief = compactor.generate_brief([], artifacts=artifacts)

        assert "Artifacts" in brief
        assert "main.ts" in brief

    def test_generate_brief_all_fields(self) -> None:
        """Test brief generation with all fields."""
        compactor = HandoffCompactor()
        brief = compactor.generate_brief(
            [],
            summary="Phase 1 done",
            decisions=["Decision 1"],
            artifacts=["file1.ts"],
        )

        assert "Work Completed" in brief
        assert "Key Decisions" in brief
        assert "Artifacts" in brief

    def test_generate_brief_empty(self) -> None:
        """Test brief generation with empty context."""
        compactor = HandoffCompactor()
        brief = compactor.generate_brief([])

        assert "Context" in brief
        assert len(brief) > 0

    def test_generate_brief_with_chat_context(self) -> None:
        """Test brief generation considers message count."""
        compactor = HandoffCompactor()
        messages = [{"role": "user", "content": "msg1"}, {"role": "assistant", "content": "msg2"}]
        brief = compactor.generate_brief(messages)

        assert "2" in brief or "messages" in brief.lower()

    def test_format_for_injection(self) -> None:
        """Test formatting brief for system prompt injection."""
        compactor = HandoffCompactor()
        brief = "Did some work"
        formatted = compactor.format_for_injection(brief)

        assert "Previous Session" in formatted
        assert "Did some work" in formatted
        assert "Continue from where" in formatted

    def test_format_for_injection_structure(self) -> None:
        """Test formatted brief has proper structure."""
        compactor = HandoffCompactor()
        brief = "Work summary"
        formatted = compactor.format_for_injection(brief)

        # Should be suitable for inclusion in a system prompt
        assert len(formatted) > len(brief)
        assert formatted.startswith("##")  # Markdown heading

    def test_multiple_decisions(self) -> None:
        """Test brief handles multiple decisions correctly."""
        compactor = HandoffCompactor()
        decisions = ["Chose approach A", "Rejected approach B", "Documented decision C"]
        brief = compactor.generate_brief([], decisions=decisions)

        for decision in decisions:
            assert decision in brief

    def test_multiple_artifacts(self) -> None:
        """Test brief handles multiple artifacts correctly."""
        compactor = HandoffCompactor()
        artifacts = ["file1.ts", "file2.ts", "file3.ts"]
        brief = compactor.generate_brief([], artifacts=artifacts)

        for artifact in artifacts:
            assert artifact in brief
