"""Provider registry for managing LLM providers."""

from __future__ import annotations

import logging

from core.backend.providers.api_provider import APIProvider
from core.backend.providers.base import BaseProvider
from core.backend.providers.failover_provider import FailoverProvider
from backend.providers.claude_code_provider import ClaudeCodeProvider
from core.backend.providers.config import ProvidersConfig
from core.backend.providers.subprocess_provider import SubprocessProvider
from core.backend.providers.websocket_provider import WebsocketProvider

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
            elif isinstance(provider, WebsocketProvider):
                provider_type = "websocket"
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
        """Create a registry from configuration.

        Two-pass approach: first registers all non-failover providers,
        then builds failover providers (which depend on other providers
        being registered).
        """
        registry = cls()
        registry._default = config.default_provider

        # Pass 1: register all non-failover providers
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
            elif provider_config.type == "failover":
                # Defer to pass 2
                pass
            else:
                logger.warning("Unknown provider type '%s' for %s", provider_config.type, name)

        # Pass 2: build failover providers (sub-providers now registered)
        for name, provider_config in config.providers.items():
            if provider_config.type == "failover":
                primary_name = provider_config.extra.get("primary", "")
                fallback_names = provider_config.extra.get("fallbacks", [])

                # Resolve named providers
                sub_providers: list[BaseProvider] = []
                for sub_name in [primary_name, *fallback_names]:
                    p = registry.get(sub_name)
                    if p is not None:
                        sub_providers.append(p)
                    else:
                        logger.warning(
                            "Failover '%s': sub-provider '%s' not found (not yet registered?)",
                            name,
                            sub_name,
                        )

                if sub_providers:
                    provider = FailoverProvider(name=name, providers=sub_providers)
                    registry.register(name, provider)
                else:
                    logger.error("Failover '%s': no valid sub-providers found, skipping", name)

        return registry
