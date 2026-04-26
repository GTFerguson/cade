"""Regression tests for project-context injection in compose_prompt."""

from __future__ import annotations

import pytest
from pathlib import Path


class TestComposeProjectContext:
    """compose_prompt(mode, working_dir) injects CLAUDE.md and .claude/rules/."""

    def test_no_working_dir_unchanged(self):
        """Omitting working_dir produces the same output as before."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code")
        assert "Project instructions" not in prompt

    def test_working_dir_without_claude_md(self, tmp_path):
        """working_dir with no CLAUDE.md injects nothing extra."""
        from backend.prompts.compose import compose_prompt

        prompt = compose_prompt("code", tmp_path)
        assert "Project instructions" not in prompt

    def test_injects_root_claude_md(self, tmp_path):
        """CLAUDE.md at working_dir root is injected into the prompt."""
        from backend.prompts.compose import compose_prompt

        claude_md = tmp_path / "CLAUDE.md"
        claude_md.write_text("# My Project\n\nDo the thing.\n")

        prompt = compose_prompt("code", tmp_path)
        assert "Do the thing." in prompt
        assert "Project instructions (CLAUDE.md)" in prompt

    def test_injects_dot_claude_claude_md(self, tmp_path):
        """CLAUDE.md inside .claude/ subdirectory is also injected."""
        from backend.prompts.compose import compose_prompt

        dot_claude = tmp_path / ".claude"
        dot_claude.mkdir()
        (dot_claude / "CLAUDE.md").write_text("# Hidden instructions\n\nSecret rule.\n")

        prompt = compose_prompt("code", tmp_path)
        assert "Secret rule." in prompt

    def test_both_claude_md_files_injected(self, tmp_path):
        """Both root and .claude/CLAUDE.md are injected when both exist."""
        from backend.prompts.compose import compose_prompt

        (tmp_path / "CLAUDE.md").write_text("Root instructions.")
        dot_claude = tmp_path / ".claude"
        dot_claude.mkdir()
        (dot_claude / "CLAUDE.md").write_text("Subdirectory instructions.")

        prompt = compose_prompt("code", tmp_path)
        assert "Root instructions." in prompt
        assert "Subdirectory instructions." in prompt

    def test_injects_dot_claude_rules(self, tmp_path):
        """Markdown files in .claude/rules/ are injected."""
        from backend.prompts.compose import compose_prompt

        rules_dir = tmp_path / ".claude" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "my-rule.md").write_text("# Project Rule\n\nAlways do X.\n")

        prompt = compose_prompt("code", tmp_path)
        assert "Always do X." in prompt

    def test_dot_claude_rules_sorted_alphabetically(self, tmp_path):
        """Rules from .claude/rules/ are injected in sorted filename order."""
        from backend.prompts.compose import compose_prompt

        rules_dir = tmp_path / ".claude" / "rules"
        rules_dir.mkdir(parents=True)
        (rules_dir / "b-rule.md").write_text("B rule content.")
        (rules_dir / "a-rule.md").write_text("A rule content.")

        prompt = compose_prompt("code", tmp_path)
        a_pos = prompt.index("A rule content.")
        b_pos = prompt.index("B rule content.")
        assert a_pos < b_pos

    def test_project_context_appended_after_mode_modules(self, tmp_path):
        """Project instructions come after mode-specific content."""
        from backend.prompts.compose import compose_prompt

        (tmp_path / "CLAUDE.md").write_text("PROJECT_MARKER_UNIQUE")

        prompt = compose_prompt("code", tmp_path)
        # nkrdn module is in ADDITIONAL for code mode
        nkrdn_pos = prompt.find("nkrdn")
        project_pos = prompt.find("PROJECT_MARKER_UNIQUE")
        assert nkrdn_pos != -1
        assert project_pos != -1
        assert project_pos > nkrdn_pos

    def test_empty_claude_md_not_injected(self, tmp_path):
        """Empty or whitespace-only CLAUDE.md produces no extra section."""
        from backend.prompts.compose import compose_prompt

        (tmp_path / "CLAUDE.md").write_text("   \n\n   ")

        prompt = compose_prompt("code", tmp_path)
        assert "Project instructions" not in prompt

    def test_all_modes_accept_working_dir(self, tmp_path):
        """working_dir injection works for every registered mode."""
        from backend.prompts.compose import compose_prompt, MODE_MODULES

        (tmp_path / "CLAUDE.md").write_text("Mode-agnostic rule.")
        for mode in MODE_MODULES:
            prompt = compose_prompt(mode, tmp_path)
            assert "Mode-agnostic rule." in prompt, f"Injection missing for mode={mode}"


class TestAPIProviderModeProperty:
    """APIProvider.mode property exposes current mode."""

    def test_default_mode_from_config(self):
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig

        config = ProviderConfig(name="t", type="api", model="x", extra={"mode": "plan"})
        provider = APIProvider(config)
        assert provider.mode == "plan"

    def test_default_mode_falls_back_to_code(self):
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig

        config = ProviderConfig(name="t", type="api", model="x")
        provider = APIProvider(config)
        assert provider.mode == "code"

    def test_set_mode_updates_property(self):
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig

        config = ProviderConfig(name="t", type="api", model="x")
        provider = APIProvider(config)
        provider.set_mode("research")
        assert provider.mode == "research"


class TestBaseProviderCancel:
    """BaseProvider.cancel() is a no-op that doesn't raise."""

    def test_cancel_is_awaitable_noop(self):
        import asyncio
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig

        config = ProviderConfig(name="t", type="api", model="x")
        provider = APIProvider(config)
        # Should complete without error
        asyncio.get_event_loop().run_until_complete(provider.cancel())


class TestMakeWorkerProvider:
    """_make_worker_provider returns an APIProvider, not ClaudeCodeProvider."""

    def test_returns_api_provider(self, tmp_path):
        from unittest.mock import patch, MagicMock
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig, ProvidersConfig

        api_cfg = ProviderConfig(name="main", type="api", model="minimax/test")
        providers_cfg = ProvidersConfig(
            providers={"main": api_cfg},
            default_provider="main",
        )

        with patch("core.backend.providers.config.get_providers_config", return_value=providers_cfg):
            from backend.orchestrator.manager import _make_worker_provider
            provider = _make_worker_provider("worker-1", "code", tmp_path, "conn-1")

        assert isinstance(provider, APIProvider)

    def test_worker_mode_is_set(self, tmp_path):
        from unittest.mock import patch
        from core.backend.providers.config import ProviderConfig, ProvidersConfig

        api_cfg = ProviderConfig(name="main", type="api", model="minimax/test")
        providers_cfg = ProvidersConfig(
            providers={"main": api_cfg},
            default_provider="main",
        )

        with patch("core.backend.providers.config.get_providers_config", return_value=providers_cfg):
            from backend.orchestrator.manager import _make_worker_provider
            provider = _make_worker_provider("worker-1", "research", tmp_path, "conn-1")

        assert provider.mode == "research"

    def test_worker_system_prompt_includes_claude_md(self, tmp_path):
        from unittest.mock import patch
        from core.backend.providers.config import ProviderConfig, ProvidersConfig

        (tmp_path / "CLAUDE.md").write_text("WORKER_PROJECT_CONTEXT")
        api_cfg = ProviderConfig(name="main", type="api", model="minimax/test")
        providers_cfg = ProvidersConfig(
            providers={"main": api_cfg},
            default_provider="main",
        )

        with patch("core.backend.providers.config.get_providers_config", return_value=providers_cfg):
            from backend.orchestrator.manager import _make_worker_provider
            provider = _make_worker_provider("worker-1", "code", tmp_path, "conn-1")

        assert "WORKER_PROJECT_CONTEXT" in provider._config.system_prompt

    def test_raises_when_no_api_provider_configured(self, tmp_path):
        from unittest.mock import patch
        from core.backend.providers.config import ProviderConfig, ProvidersConfig

        cc_cfg = ProviderConfig(name="cc", type="claude-code", model="sonnet")
        providers_cfg = ProvidersConfig(
            providers={"cc": cc_cfg},
            default_provider="cc",
        )

        with patch("core.backend.providers.config.get_providers_config", return_value=providers_cfg):
            from backend.orchestrator.manager import _make_worker_provider
            with pytest.raises(RuntimeError, match="No API provider configured"):
                _make_worker_provider("worker-1", "code", tmp_path, "conn-1")
