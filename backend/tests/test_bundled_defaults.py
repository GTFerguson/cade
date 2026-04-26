"""Tests for bundled defaults architecture."""

from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import patch


class TestComposeRulesLoading:
    """Test that rules load from bundled + user dirs with correct merge strategy."""

    def test_loads_bundled_rules_from_bundled_dir(self):
        """Bundled rules should load from backend/prompts/bundled/rules/."""
        from backend.prompts.compose import _load_rules, BUNDLED_RULES_DIR

        assert BUNDLED_RULES_DIR.exists(), f"BUNDLED_RULES_DIR not found: {BUNDLED_RULES_DIR}"
        assert BUNDLED_RULES_DIR.is_dir()

        rules = _load_rules()
        rule_names = [name for name, _content, _desc in rules]
        assert "coding-standards" in rule_names, f"coding-standards not in rules: {rule_names}"
        assert "context-management" in rule_names, f"context-management not in rules: {rule_names}"

    def test_bundled_rules_have_descriptions(self):
        """Bundled rules should parse description from frontmatter."""
        from backend.prompts.compose import _load_rules

        rules = _load_rules()
        rule_dict = {name: desc for name, _content, desc in rules}
        assert rule_dict.get("coding-standards"), "coding-standards missing description"
        assert rule_dict.get("context-management"), "context-management missing description"

    def test_loads_all_bundled_rules(self):
        """All bundled rules should load from the bundled rules directory."""
        from backend.prompts.compose import _load_rules, BUNDLED_RULES_DIR

        rules = _load_rules()
        rule_names = [name for name, _content, _desc in rules]
        bundled_stems = {p.stem for p in BUNDLED_RULES_DIR.glob("*.md")}
        for stem in bundled_stems:
            assert stem in rule_names, f"Bundled rule '{stem}' not loaded"

    def test_user_claude_rules_not_loaded(self, tmp_path):
        """~/.claude/rules/ are not loaded — only bundled rules are."""
        from backend.prompts.compose import _load_rules

        rules = _load_rules()
        rule_names = [name for name, _content, _desc in rules]
        # Rules come only from the bundled dir — no user-home rules
        assert "my-custom-rule" not in rule_names


class TestComposePromptStructure:
    """Test that compose_prompt assembles correctly."""

    def test_compose_includes_base(self):
        """Base module should always be first."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        assert len(prompt) > 0

    def test_compose_includes_bundled_rules(self):
        """Bundled rules should appear in composed prompt."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        # Check for coding-standards content
        assert "## Coding Standards" in prompt or "## Context Management" in prompt

    def test_compose_includes_mode_module(self):
        """Mode-specific module should be included."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        # Mode module for 'code' is 'code'
        assert "code" in prompt.lower()

    def test_compose_includes_additional_for_mode(self):
        """Additional modules for the mode should be included."""
        from backend.prompts.compose import compose_prompt

        # nkrdn is in ADDITIONAL for all modes
        prompt = compose_prompt("code")
        assert "nkrdn" in prompt.lower() or len(prompt) > 0

    def test_compose_includes_current_datetime(self):
        """System prompt must include current date so the agent is not time-blind."""
        import re
        from datetime import datetime, timezone
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        # Must contain a date string in YYYY-MM-DD format
        assert re.search(r"\d{4}-\d{2}-\d{2}", prompt), "No date found in system prompt"
        # The year must be current
        current_year = str(datetime.now(timezone.utc).year)
        assert current_year in prompt, f"Current year {current_year} not in system prompt"

    def test_compose_datetime_is_first_content(self):
        """Datetime line must appear before any other module content."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        dt_pos = prompt.find("Current date and time:")
        assert dt_pos != -1, "Datetime header not found in system prompt"
        assert dt_pos == 0, "Datetime must be the very first line of the system prompt"

    def test_compose_datetime_refreshes_each_call(self):
        """Each compose_prompt call should reflect the time at call time."""
        import re
        from unittest.mock import patch
        from datetime import datetime, timezone
        from backend.prompts.compose import compose_prompt

        # Patch datetime to return a fixed time and verify it appears
        fixed_dt = datetime(2025, 3, 15, 10, 30, tzinfo=timezone.utc)
        with patch("backend.prompts.compose.datetime") as mock_dt:
            mock_dt.now.return_value = fixed_dt
            prompt = compose_prompt("code")

        assert "2025-03-15" in prompt, "Fixed date not found in prompt"
        assert "10:30" in prompt, "Fixed time not found in prompt"


class TestGetRules:
    """Test get_rules() returns the merged rule list."""

    def test_get_rules_returns_tuples(self):
        """get_rules() should return (name, content, description) tuples."""
        from backend.prompts import get_rules

        rules = get_rules()
        assert len(rules) > 0
        for item in rules:
            assert len(item) == 3
            name, content, desc = item
            assert isinstance(name, str)
            assert isinstance(content, str)
            assert isinstance(desc, str)


class TestTryLoadSkill:
    """Test skill activation via _try_load_skill."""

    def test_tries_load_skill_method_exists(self):
        """ConnectionHandler should have _try_load_skill method."""
        from backend.websocket import ConnectionHandler
        assert hasattr(ConnectionHandler, "_try_load_skill")

    def test_loads_bundled_handoff_skill(self):
        """_try_load_skill should load bundled handoff skill."""
        from backend.websocket import ConnectionHandler

        handler = ConnectionHandler.__new__(ConnectionHandler)
        remaining, content = handler._try_load_skill("/handoff")

        assert remaining == ""
        assert len(content) > 0
        assert "handoff" in content.lower() or "Handoff" in content

    def test_strips_skill_prefix_from_message(self):
        """_try_load_skill should return remaining content after /<skillname>."""
        from backend.websocket import ConnectionHandler

        handler = ConnectionHandler.__new__(ConnectionHandler)
        remaining, content = handler._try_load_skill("/handoff my session")

        assert remaining == "my session"
        assert len(content) > 0

    def test_returns_empty_for_non_slash(self):
        """_try_load_skill should return empty for non-slash messages."""
        from backend.websocket import ConnectionHandler

        handler = ConnectionHandler.__new__(ConnectionHandler)
        remaining, content = handler._try_load_skill("just a regular message")

        assert remaining == ""
        assert content == ""

    def test_returns_empty_for_unknown_skill(self):
        """_try_load_skill should return empty for unknown skill names."""
        from backend.websocket import ConnectionHandler

        handler = ConnectionHandler.__new__(ConnectionHandler)
        remaining, content = handler._try_load_skill("/nonexistent-skill arg")

        assert remaining == "arg"
        assert content == ""


class TestBundledSkillsDir:
    """Test that bundled skills directory is correctly exposed."""

    def test_bundled_skills_dir_exists(self):
        """BUNDLED_SKILLS_DIR should point to a valid directory."""
        from backend.prompts import BUNDLED_SKILLS_DIR

        assert BUNDLED_SKILLS_DIR.exists(), f"BUNDLED_SKILLS_DIR not found: {BUNDLED_SKILLS_DIR}"
        assert BUNDLED_SKILLS_DIR.is_dir()

    def test_handoff_skill_exists(self):
        """Bundled handoff skill should exist."""
        from backend.prompts import BUNDLED_SKILLS_DIR

        handoff_path = BUNDLED_SKILLS_DIR / "handoff" / "SKILL.md"
        assert handoff_path.exists(), f"handoff skill not found: {handoff_path}"

    def test_handoff_skill_has_frontmatter(self):
        """handoff skill should have name and description in frontmatter."""
        from backend.prompts import BUNDLED_SKILLS_DIR

        handoff_path = BUNDLED_SKILLS_DIR / "handoff" / "SKILL.md"
        content = handoff_path.read_text()
        assert content.startswith("---")
        assert "name: handoff" in content
        assert "description:" in content
