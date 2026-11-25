"""Which CLI coding agent a session runs.

The backend has one configured agent, but a tab may ask for another when it
opens (Claude Code in one tab, Codex in the next). The session remembers its
choice; this module turns that choice into the descriptor the launch code
uses and the environment the resume wrapper reads.
"""

from __future__ import annotations

import shutil
from types import SimpleNamespace
from typing import Any

from backend.config import CliAgent
from backend.terminal.cli_agent_adapters import ADAPTERS, adapter_from_descriptor

# Agents offered when opening a tab. Other adapters exist (see ADAPTERS) and
# can still be made the backend's configured agent.
SELECTABLE_AGENTS = ("claude-code", "codex")


def clean_agent_id(value: Any) -> str | None:
    """An adapter id CADE knows, or None for anything else."""
    return value if isinstance(value, str) and value in ADAPTERS else None


def agent_descriptor(agent_id: str | None, configured: CliAgent) -> CliAgent:
    """The descriptor for a session's agent.

    The configured agent keeps its configured command and seed convention. Any
    other agent gets its adapter's defaults, since the configured values were
    written for a different program.
    """
    if agent_id is None or agent_id == configured.adapter_id or agent_id not in ADAPTERS:
        return configured
    adapter = adapter_from_descriptor(SimpleNamespace(adapter_id=agent_id))
    return CliAgent(
        command=adapter.command,
        adapter_id=agent_id,
        seed_style=adapter.seed_style,
        seed_flag=adapter.seed_flag,
    )


def agent_env(agent: CliAgent) -> dict[str, str]:
    """PTY environment that makes the resume wrapper run this agent.

    The wrapper bakes in the configured agent and lets these override it, so
    one script on disk serves tabs running different agents.
    """
    return {
        "CADE_CLI_AGENT": agent.command,
        "CADE_CLI_AGENT_ADAPTER": agent.adapter_id,
        "CADE_CLI_AGENT_SEED_STYLE": agent.seed_style,
        "CADE_CLI_AGENT_SEED_FLAG": agent.seed_flag,
    }


def selectable_agents(configured: CliAgent) -> list[dict[str, Any]]:
    """Agents a new tab may choose, with whether each is installed here."""
    ids = list(SELECTABLE_AGENTS)
    if configured.adapter_id not in ids:
        ids.insert(0, configured.adapter_id)
    out = []
    for agent_id in ids:
        descriptor = agent_descriptor(agent_id, configured)
        adapter = adapter_from_descriptor(descriptor)
        out.append({
            "id": agent_id,
            "name": adapter.display_name,
            "available": shutil.which(descriptor.command) is not None,
            "default": agent_id == configured.adapter_id,
        })
    return out
