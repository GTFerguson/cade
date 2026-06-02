"""Tests for provider configuration loading."""

from __future__ import annotations

import os
from pathlib import Path
from textwrap import dedent

import pytest

from core.backend.providers.config import (
    DEFAULT_CONTEXT_BUDGET_HARD_LIMIT,
    DEFAULT_CONTEXT_BUDGET_THRESHOLD,
    DEFAULT_CONTEXT_WINDOW,
    ProviderConfig,
    get_context_budget,
    load_providers_config,
    resolve_worker_provider,
)


@pytest.fixture
def providers_toml(tmp_path: Path) -> Path:
    """Create a temporary providers.toml file."""
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        default = "anthropic"

        [provider.anthropic]
        type = "api"
        model = "claude-sonnet-4-6"
        api-key = "${ANTHROPIC_API_KEY}"

        [provider.openai]
        type = "api"
        model = "gpt-4o"
        api-key = "sk-hardcoded-key"

        [provider.claude-cli]
        type = "cli"
    """))
    return config_file


def test_load_providers_toml(providers_toml: Path, monkeypatch: pytest.MonkeyPatch):
    """Test basic TOML parsing with env var resolution."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-123")

    config = load_providers_config(providers_toml)

    assert config.default_provider == "anthropic"
    assert len(config.providers) == 3

    anthropic = config.providers["anthropic"]
    assert anthropic.type == "api"
    assert anthropic.model == "claude-sonnet-4-6"
    assert anthropic.api_key == "sk-test-123"

    openai = config.providers["openai"]
    assert openai.api_key == "sk-hardcoded-key"

    cli = config.providers["claude-cli"]
    assert cli.type == "cli"


def test_env_var_missing(providers_toml: Path, monkeypatch: pytest.MonkeyPatch):
    """Test that missing env vars resolve to empty string."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    config = load_providers_config(providers_toml)
    assert config.providers["anthropic"].api_key == ""


def test_missing_config_file(tmp_path: Path):
    """Test fallback when config file doesn't exist."""
    config = load_providers_config(tmp_path / "nonexistent.toml")
    assert config.default_provider == ""
    assert len(config.providers) == 0


def test_extra_fields(tmp_path: Path):
    """Test that unknown fields are captured in extra."""
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        [provider.bedrock]
        type = "api"
        model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
        region = "us-west-2"
        custom_field = "custom_value"
    """))

    config = load_providers_config(config_file)
    bedrock = config.providers["bedrock"]
    assert bedrock.region == "us-west-2"
    assert bedrock.extra["custom_field"] == "custom_value"


def test_extra_headers_env_var_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Regression: env vars inside nested extra_headers tables must be resolved.

    Previously _resolve_env_vars was only called on top-level strings, so
    ${API_KEY} inside [provider.X.extra_headers] was sent as a literal string,
    causing authentication failures on proxies like MiniMax that require
    Authorization: Bearer <key>.
    """
    monkeypatch.setenv("MY_API_KEY", "sk-real-secret")
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        [provider.proxy]
        type = "api"
        model = "anthropic/model-name"
        api-key = "${MY_API_KEY}"
        api_base = "https://api.example.com/v1/messages"

        [provider.proxy.extra_headers]
        Authorization = "Bearer ${MY_API_KEY}"
        X-Custom = "static-value"
    """))

    config = load_providers_config(config_file)
    proxy = config.providers["proxy"]

    assert proxy.api_key == "sk-real-secret"
    assert proxy.extra["api_base"] == "https://api.example.com/v1/messages"
    headers = proxy.extra["extra_headers"]
    assert headers["Authorization"] == "Bearer sk-real-secret"
    assert headers["X-Custom"] == "static-value"


def test_extra_headers_missing_env_var(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Missing env vars inside nested tables resolve to empty string, not literal placeholder."""
    monkeypatch.delenv("MISSING_KEY", raising=False)
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        [provider.proxy]
        type = "api"
        model = "anthropic/model"
        api-key = "${MISSING_KEY}"

        [provider.proxy.extra_headers]
        Authorization = "Bearer ${MISSING_KEY}"
    """))

    config = load_providers_config(config_file)
    proxy = config.providers["proxy"]

    assert proxy.api_key == ""
    assert proxy.extra["extra_headers"]["Authorization"] == "Bearer "


def test_invalid_toml(tmp_path: Path):
    """Test graceful handling of invalid TOML."""
    config_file = tmp_path / "providers.toml"
    config_file.write_text("this is not valid toml [[[")

    config = load_providers_config(config_file)
    assert len(config.providers) == 0


def test_context_budget_defaults_when_unset():
    """Without overrides, get_context_budget returns the documented defaults."""
    cfg = ProviderConfig(name="x", type="api", model="claude-sonnet-4-5-20250929")
    budget = get_context_budget(cfg)
    assert budget["warn"] == DEFAULT_CONTEXT_BUDGET_THRESHOLD
    assert budget["danger"] == DEFAULT_CONTEXT_BUDGET_HARD_LIMIT
    # litellm has Claude Sonnet 4.5 in its catalog with a 200k input window.
    assert budget["window"] == 200_000


def test_context_budget_reads_from_extra():
    """context_budget_threshold / hard_limit / window in providers.toml flow through."""
    cfg = ProviderConfig(
        name="x", type="api", model="claude-sonnet-4-6",
        extra={
            "context_budget_threshold": 0.6,
            "context_budget_hard_limit": 0.85,
            "context_window": 500_000,
        },
    )
    budget = get_context_budget(cfg)
    assert budget["warn"] == 0.6
    assert budget["danger"] == 0.85
    assert budget["window"] == 500_000


def test_context_budget_clamps_invalid_thresholds():
    """Out-of-range thresholds are clamped to [0.0, 1.0]."""
    cfg = ProviderConfig(
        name="x", type="api", model="claude-sonnet-4-6",
        extra={"context_budget_threshold": 5.0, "context_budget_hard_limit": -0.2},
    )
    budget = get_context_budget(cfg)
    assert budget["warn"] == 1.0
    assert budget["danger"] == 0.0


def test_context_budget_falls_back_when_model_unknown():
    """Unknown models fall back to DEFAULT_CONTEXT_WINDOW."""
    cfg = ProviderConfig(name="x", type="api", model="bogus/model-does-not-exist")
    budget = get_context_budget(cfg)
    assert budget["window"] == DEFAULT_CONTEXT_WINDOW


def test_load_worker_provider_and_cli_orchestrator_flags(tmp_path: Path):
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        default = "mistral"
        worker_provider = "minimax"
        cli_orchestrator = false

        [provider.mistral]
        type = "api"
        model = "mistral/large"

        [provider.minimax]
        type = "api"
        model = "minimax/MiniMax-M2.7"
    """))

    config = load_providers_config(config_file)
    assert config.worker_provider == "minimax"
    assert config.cli_orchestrator is False
    assert resolve_worker_provider(config).name == "minimax"


def test_minimax_model_ok_on_anthropic_endpoint(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    """anthropic/minimax-* + anthropic messages api_base is the correct pairing."""
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        [provider.minimax]
        type = "api"
        model = "anthropic/minimax-m2.7"
        api-key = "sk-test"
        api_base = "https://api.minimax.io/anthropic/v1/messages"
    """))

    with caplog.at_level("WARNING"):
        config = load_providers_config(config_file)

    assert config.providers["minimax"].model == "anthropic/minimax-m2.7"
    assert not any("Provider minimax" in r.message for r in caplog.records)


def test_minimax_model_warning_on_mismatched_endpoint(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    """minimax/MiniMax-* with anthropic messages api_base 404s — warn at load."""
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        [provider.minimax]
        type = "api"
        model = "minimax/MiniMax-M2.7"
        api-key = "sk-test"
        api_base = "https://api.minimax.io/anthropic/v1/messages"
    """))

    with caplog.at_level("WARNING"):
        load_providers_config(config_file)

    assert any("anthropic/minimax-m2.7" in r.message for r in caplog.records)
