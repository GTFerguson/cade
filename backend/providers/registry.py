"""Provider registry for managing LLM providers."""

from __future__ import annotations

import logging

from backend.providers.api_provider import APIProvider
from backend.providers.base import BaseProvider
from backend.providers.claude_code_provider import ClaudeCodeProvider
from backend.providers.config import ProvidersConfig
from backend.providers.subprocess_provider import SubprocessProvider

logger = logging.getLogger(__name__)


class ProviderRegistry:
    """Registry for LLM providers."""

    def __init__(self) -> None:
        self._providers: dict[str, BaseProvider] = {}
        self._default: str = ""

    def register(self, name: str, provider: BaseProvider) -> None:
        """Register a provider."""
        self._providers[name] = provider
        logger.info("Registered provider: %s (%s)", name, provider.model)

    def get(self, name: str) -> BaseProvider | None:
        """Get a provider by name."""
        return self._providers.get(name)

    def get_default(self) -> BaseProvider | None:
        """Get the default provider."""
        if self._default and self._default in self._providers:
            return self._providers[self._default]
        # Fall back to first registered provider
        if self._providers:
            return next(iter(self._providers.values()))
        return None

    def list_providers(self) -> list[dict]:
        """List all providers with their metadata."""
        result = []
        for name, provider in self._providers.items():
            caps = provider.get_capabilities()
            if isinstance(provider, ClaudeCodeProvider):
                provider_type = "claude-code"
            elif isinstance(provider, SubprocessProvider):
                provider_type = "subprocess"
            else:
                provider_type = "api"
            result.append({
                "name": name,
                "model": provider.model,
                "type": provider_type,
                "capabilities": {
                    "streaming": caps.streaming,
                    "tool_use": caps.tool_use,
                    "vision": caps.vision,
                },
            })
        return result

    @classmethod
    def from_config(cls, config: ProvidersConfig) -> ProviderRegistry:
        """Create a registry from configuration."""
        registry = cls()
        registry._default = config.default_provider

        for name, provider_config in config.providers.items():
            if provider_config.type == "api":
                provider = APIProvider(provider_config)
                registry.register(name, provider)
            elif provider_config.type == "claude-code":
                provider = ClaudeCodeProvider(provider_config)
                registry.register(name, provider)
            elif provider_config.type == "cli":
                # CLI providers are not managed through the registry —
                # they run as terminal processes
                logger.debug("Skipping CLI provider: %s", name)
            else:
                logger.warning("Unknown provider type '%s' for %s", provider_config.type, name)

        return registry
