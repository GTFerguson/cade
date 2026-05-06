"""Provider configuration loaded from ~/.cade/providers.toml."""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

logger = logging.getLogger(__name__)

# Matches ${ENV_VAR} or $ENV_VAR in config values
_ENV_VAR_PATTERN = re.compile(r"\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)")


def _resolve_env_vars(value):
    """Replace ${ENV_VAR} references with environment variable values.

    Recurses into nested dicts and lists so values like extra_headers tables
    in providers.toml expand env vars on their string leaves.
    """
    def replacer(match: re.Match) -> str:
        var_name = match.group(1) or match.group(2)
        env_value = os.environ.get(var_name)
        if env_value is None:
            logger.warning("Environment variable %s not set", var_name)
            return ""
        return env_value

    if isinstance(value, str):
        return _ENV_VAR_PATTERN.sub(replacer, value)
    if isinstance(value, dict):
        return {k: _resolve_env_vars(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_env_vars(v) for v in value]
    return value


@dataclass
class ProviderConfig:
    """Configuration for a single LLM provider."""

    name: str
    type: str  # "api" or "cli"
    model: str = ""
    region: str = ""
    api_key: str = ""
    system_prompt: str = ""
    extra: dict = field(default_factory=dict)


@dataclass
class ProvidersConfig:
    """Top-level providers configuration."""

    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    default_provider: str = ""


# Default warn / danger thresholds for the context-budget indicator,
# expressed as fractions of the model's input window. Override per-provider
# in providers.toml: context_budget_threshold = 0.75 / context_budget_hard_limit = 0.9
DEFAULT_CONTEXT_BUDGET_THRESHOLD = 0.75
DEFAULT_CONTEXT_BUDGET_HARD_LIMIT = 0.9
DEFAULT_CONTEXT_WINDOW = 200_000


def _coerce_float(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coerce_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def resolve_context_window(model: str) -> int:
    """Look up max input tokens for a model via litellm. Falls back to 200k."""
    if not model:
        return DEFAULT_CONTEXT_WINDOW
    try:
        import litellm
        info = litellm.get_model_info(model)
        max_in = info.get("max_input_tokens") if isinstance(info, dict) else None
        if max_in:
            return int(max_in)
    except Exception as e:
        logger.debug("get_model_info failed for %s: %s", model, e)
    return DEFAULT_CONTEXT_WINDOW


def get_context_budget(cfg: ProviderConfig) -> dict:
    """Return the warn/danger thresholds and context window for a provider.

    Reads `context_budget_threshold`, `context_budget_hard_limit`, and an
    optional `context_window` override from the provider's extra fields.
    Falls back to litellm's catalog for the window, and to 0.75 / 0.9 for
    the thresholds when not configured.
    """
    extra = cfg.extra or {}
    warn = _coerce_float(
        extra.get("context_budget_threshold"), DEFAULT_CONTEXT_BUDGET_THRESHOLD,
    )
    danger = _coerce_float(
        extra.get("context_budget_hard_limit"), DEFAULT_CONTEXT_BUDGET_HARD_LIMIT,
    )
    window = _coerce_int(extra.get("context_window"), 0) or resolve_context_window(cfg.model)
    return {
        "warn": max(0.0, min(warn, 1.0)),
        "danger": max(0.0, min(danger, 1.0)),
        "window": window,
    }


def _get_providers_config_path() -> Path:
    """Get the path to the providers config file."""
    return Path.home() / ".cade" / "providers.toml"


def load_providers_config(path: Path | None = None) -> ProvidersConfig:
    """Load providers configuration from TOML file.

    Args:
        path: Config file path. Defaults to ~/.cade/providers.toml.

    Returns:
        ProvidersConfig with all providers loaded.
    """
    config_path = path or _get_providers_config_path()

    if not config_path.exists():
        logger.debug("No providers config at %s, using defaults", config_path)
        return ProvidersConfig()

    try:
        with open(config_path, "rb") as f:
            data = tomllib.load(f)
    except Exception as e:
        logger.warning("Failed to load providers config %s: %s", config_path, e)
        return ProvidersConfig()

    default_provider = data.get("default", "")
    if isinstance(default_provider, str):
        default_provider = _resolve_env_vars(default_provider)

    providers: dict[str, ProviderConfig] = {}

    providers_data = data.get("provider", {})
    for name, provider_data in providers_data.items():
        if not isinstance(provider_data, dict):
            continue

        # Resolve env vars in string values
        resolved = {}
        extra = {}
        known_keys = {"type", "model", "region", "api-key", "api_key", "system-prompt", "system_prompt"}
        for key, value in provider_data.items():
            value = _resolve_env_vars(value)
            if key in known_keys:
                resolved[key] = value
            else:
                extra[key] = value

        api_key = resolved.get("api-key", resolved.get("api_key", ""))
        system_prompt = resolved.get("system-prompt", resolved.get("system_prompt", ""))

        providers[name] = ProviderConfig(
            name=name,
            type=resolved.get("type", "api"),
            model=resolved.get("model", ""),
            region=resolved.get("region", ""),
            api_key=api_key,
            system_prompt=system_prompt,
            extra=extra,
        )

    return ProvidersConfig(
        providers=providers,
        default_provider=default_provider,
    )


# Singleton
_providers_config: ProvidersConfig | None = None


def get_providers_config() -> ProvidersConfig:
    """Get the providers configuration, loading if needed."""
    global _providers_config
    if _providers_config is None:
        _providers_config = load_providers_config()
    return _providers_config
