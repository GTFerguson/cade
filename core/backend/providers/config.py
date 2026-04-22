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


def _resolve_env_vars(value: str) -> str:
    """Replace ${ENV_VAR} references with environment variable values."""
    def replacer(match: re.Match) -> str:
        var_name = match.group(1) or match.group(2)
        env_value = os.environ.get(var_name)
        if env_value is None:
            logger.warning("Environment variable %s not set", var_name)
            return ""
        return env_value

    return _ENV_VAR_PATTERN.sub(replacer, value)


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
            if isinstance(value, str):
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
