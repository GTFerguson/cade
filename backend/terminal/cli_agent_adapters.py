"""CLI coding agent adapter layer.

Terminal-first coding agents (Claude Code, Codex, Cursor) are not LiteLLM
providers. CADE launches them in a PTY and attaches workflow integrations around
that process. This module keeps vendor-specific launch syntax out of the
terminal/session code.

MCP integration strategy differs by agent:

- **Claude Code** passes ``--mcp-config <path>`` on every invocation, pointing
  at a CADE-generated JSON file under ``~/.cade/mcp/``.
- **Codex** reads ``~/.codex/config.toml``, which every Codex thread on the
  machine shares, so CADE gives it no servers (see ``CodexAdapter``) and
  writes only its notify command there.
- **Cursor** reads ``.cursor/mcp.json`` (project or global).  CADE merges its
  server entries into the project-level file and removes them on teardown.

Each adapter owns ``install_mcp_config`` / ``remove_mcp_config`` so the
terminal layer never touches vendor-specific config formats.
"""

from __future__ import annotations

import json
import logging
import shlex
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Protocol

logger = logging.getLogger(__name__)

# Every server name CADE has written into an agent's own config. Cleanup
# strips all of them, so the list keeps "cade-permissions": older builds
# wrote it and it can still be sitting in a Codex or Cursor config.
CADE_MCP_SERVER_NAMES = frozenset({"cade-orchestrator", "cade-permissions"})

# ── Capabilities ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CliAgentCapabilities:
    """Capabilities CADE can use when integrating a terminal coding agent."""

    prompt_seed: bool = True
    mcp: bool = False
    hooks: bool = False
    permissions: bool = False
    session_resolution: bool = False
    handoff_resume: bool = True


# ── Protocol ────────────────────────────────────────────────────────────────


class CliCodingAgentAdapter(Protocol):
    """Vendor-specific bridge for a terminal coding agent."""

    id: str
    display_name: str
    capabilities: CliAgentCapabilities

    @property
    def command(self) -> str:
        ...

    @property
    def seed_style(self) -> str:
        ...

    @property
    def seed_flag(self) -> str:
        ...

    def direct_command(
        self,
        prompt: str | None,
        mcp_config_path: str | Path | None = None,
    ) -> str:
        """Shell-safe command string for fallback launch (no resume wrapper)."""
        ...

    def shell_mcp_array_assignment(self) -> str:
        """Bash snippet that populates the ``mcp`` array in the resume wrapper."""
        ...

    def install_mcp_config(
        self,
        servers: dict,
        project_dir: Path | None = None,
    ) -> None:
        """Write CADE's MCP server definitions where the agent will find them.

        *servers* is the ``mcpServers`` dict (same schema ``write_mcp_config``
        produces).  For CLI-arg agents (Claude Code) this is a no-op — they
        reference the generated file directly.  For config-file agents (Codex,
        Cursor) this merges entries into the agent's native config.
        """
        ...

    def remove_mcp_config(self, project_dir: Path | None = None) -> None:
        """Remove CADE-managed MCP server entries on session teardown."""
        ...


# ── Helpers ─────────────────────────────────────────────────────────────────


def _seed_args(seed_style: str, seed_flag: str, prompt: str) -> list[str]:
    """Return shell-quoted argument list for prompt seeding."""
    if seed_style == "flag":
        return [shlex.quote(seed_flag), shlex.quote(prompt)]
    return [shlex.quote(prompt)]


# ── Claude Code ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ClaudeCodeAdapter:
    """Claude Code CLI adapter preserving CADE's existing launch behaviour."""

    command: str = "claude"
    seed_style: str = "positional"
    seed_flag: str = "-p"

    id: str = "claude-code"
    display_name: str = "Claude Code"
    capabilities: CliAgentCapabilities = CliAgentCapabilities(
        prompt_seed=True,
        mcp=True,
        hooks=True,
        permissions=True,
        session_resolution=True,
        handoff_resume=True,
    )

    def direct_command(
        self,
        prompt: str | None,
        mcp_config_path: str | Path | None = None,
    ) -> str:
        parts = [shlex.quote(self.command)]
        if mcp_config_path:
            parts.extend(["--mcp-config", shlex.quote(str(mcp_config_path))])
        if prompt:
            # --mcp-config is variadic; `--` prevents the positional prompt from
            # being consumed as a second config path when seed_style is positional.
            if self.seed_style == "positional":
                parts.append("--")
            parts.extend(_seed_args(self.seed_style, self.seed_flag, prompt))
        return " ".join(parts)

    def shell_mcp_array_assignment(self) -> str:
        return 'mcp=(--mcp-config "$CADE_CLI_MCP_CONFIG")'

    def install_mcp_config(
        self, servers: dict, project_dir: Path | None = None
    ) -> None:
        pass  # Claude reads the generated file via --mcp-config

    def remove_mcp_config(self, project_dir: Path | None = None) -> None:
        pass  # Cleaned up by mcp_config.remove_mcp_config()


# ── Codex ───────────────────────────────────────────────────────────────────


def _codex_config_path() -> Path:
    """User-level Codex config (``~/.codex/config.toml``)."""
    return Path.home() / ".codex" / "config.toml"


_CADE_NOTIFY_MARKER = "cade-managed notify"


def _merge_codex_notify(config_path: Path, command: list[str]) -> None:
    """Point Codex's ``notify`` at CADE's attention hook.

    ``notify`` is a top-level key, so it must sit above the first table
    header. A user's own ``notify`` is left alone; only a line CADE wrote
    (marked) is replaced.
    """
    lines = config_path.read_text(encoding="utf-8").splitlines() if config_path.exists() else []
    kept: list[str] = []
    for line in lines:
        if line.strip().startswith("notify") and _CADE_NOTIFY_MARKER in line:
            continue
        kept.append(line)
    if any(l.strip().startswith("notify") for l in kept):
        return  # the user configured their own notify command

    args = ", ".join(json.dumps(a) for a in command)
    notify_line = f"notify = [{args}]  # {_CADE_NOTIFY_MARKER}"
    first_table = next((i for i, l in enumerate(kept) if l.strip().startswith("[")), len(kept))
    kept.insert(first_table, notify_line)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text("\n".join(kept).rstrip("\n") + "\n", encoding="utf-8")


def _remove_codex_notify(config_path: Path) -> None:
    if not config_path.exists():
        return
    lines = config_path.read_text(encoding="utf-8").splitlines()
    kept = [l for l in lines if not (l.strip().startswith("notify") and _CADE_NOTIFY_MARKER in l)]
    if len(kept) == len(lines):
        return
    cleaned = "\n".join(kept).strip()
    if cleaned:
        config_path.write_text(cleaned + "\n", encoding="utf-8")
    else:
        config_path.unlink(missing_ok=True)


def _remove_codex_mcp_servers(config_path: Path, server_names: set[str]) -> None:
    """Strip CADE-managed MCP sections from Codex config."""
    if not config_path.exists():
        return
    lines = config_path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    in_cade_block = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[mcp_servers."):
            name = stripped.split(".", 1)[1].rstrip("]").strip().strip('"')
            if name in server_names:
                in_cade_block = True
                continue
            in_cade_block = False
        elif stripped.startswith("[") and in_cade_block:
            in_cade_block = False
        if in_cade_block:
            continue
        out.append(line)
    if len(out) == len(lines):
        # Nothing of CADE's in the file; leave the user's config untouched.
        return
    cleaned = "\n".join(out).strip()
    if cleaned:
        config_path.write_text(cleaned + "\n", encoding="utf-8")
    else:
        config_path.unlink(missing_ok=True)
    logger.info("Removed CADE MCP servers from %s", config_path)


@dataclass(frozen=True)
class CodexAdapter:
    """OpenAI Codex CLI adapter.

    Codex reads MCP servers from ``~/.codex/config.toml`` (user-level) or
    ``.codex/config.toml`` (project-level) and has no ``--mcp-config`` flag,
    so it cannot be given servers for one session. CADE therefore gives it
    none: the user-level file belongs to every Codex thread on the machine,
    and servers written there are started by all of them, in a CADE tab or
    not, each as its own copy of the backend and all carrying the connection
    of whichever tab wrote the file last. Only the notify command is set.
    """

    command: str = "codex"
    seed_style: str = "positional"
    seed_flag: str = ""

    id: str = "codex"
    display_name: str = "Codex"
    capabilities: CliAgentCapabilities = CliAgentCapabilities(
        prompt_seed=True,
        mcp=False,
        hooks=False,
        permissions=False,
        session_resolution=False,
        handoff_resume=True,
    )

    def direct_command(
        self,
        prompt: str | None,
        mcp_config_path: str | Path | None = None,
    ) -> str:
        parts = [shlex.quote(self.command)]
        if prompt:
            parts.extend(_seed_args(self.seed_style, self.seed_flag, prompt))
        return " ".join(parts)

    def shell_mcp_array_assignment(self) -> str:
        return "mcp=()"  # MCP servers are in config.toml, no CLI args needed

    def install_mcp_config(
        self, servers: dict, project_dir: Path | None = None
    ) -> None:
        # Clears what a build that did write servers here left behind.
        _remove_codex_mcp_servers(_codex_config_path(), CADE_MCP_SERVER_NAMES)
        # Codex has no hooks, but its notify command fires on turn
        # completion, which is enough for "done, come back".
        _merge_codex_notify(
            _codex_config_path(),
            ["python3", str(Path.home() / ".cade" / "hooks" / "attention.py")],
        )

    def remove_mcp_config(self, project_dir: Path | None = None) -> None:
        _remove_codex_mcp_servers(_codex_config_path(), CADE_MCP_SERVER_NAMES)
        _remove_codex_notify(_codex_config_path())


# ── Cursor ──────────────────────────────────────────────────────────────────


def _cursor_mcp_json_path(project_dir: Path | None) -> Path:
    """Cursor MCP config: project-level when available, else global."""
    if project_dir:
        return project_dir / ".cursor" / "mcp.json"
    return Path.home() / ".cursor" / "mcp.json"


def _merge_cursor_mcp_servers(config_path: Path, servers: dict) -> None:
    """Merge CADE MCP servers into a Cursor mcp.json."""
    existing: dict = {}
    if config_path.exists():
        try:
            existing = json.loads(config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    mcp_servers = existing.setdefault("mcpServers", {})
    for name, srv in servers.items():
        mcp_servers[name] = srv

    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(existing, indent=2) + "\n", encoding="utf-8"
    )
    logger.info("Merged CADE MCP servers into %s", config_path)


def _remove_cursor_mcp_servers(
    config_path: Path, server_names: set[str]
) -> None:
    """Strip CADE-managed MCP servers from Cursor mcp.json."""
    if not config_path.exists():
        return
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    mcp_servers = data.get("mcpServers", {})
    for name in server_names:
        mcp_servers.pop(name, None)
    if mcp_servers or any(k != "mcpServers" for k in data):
        config_path.write_text(
            json.dumps(data, indent=2) + "\n", encoding="utf-8"
        )
    else:
        config_path.unlink(missing_ok=True)
    logger.info("Removed CADE MCP servers from %s", config_path)


@dataclass(frozen=True)
class CursorAdapter:
    """Cursor CLI (cursor-agent) adapter.

    Cursor reads MCP servers from ``.cursor/mcp.json`` (project-level preferred)
    or ``~/.cursor/mcp.json``.  The ``--approve-mcps`` flag auto-approves
    configured servers so CADE tools are available without interactive prompts.
    """

    command: str = "cursor-agent"
    seed_style: str = "positional"
    seed_flag: str = ""

    id: str = "cursor"
    display_name: str = "Cursor"
    capabilities: CliAgentCapabilities = CliAgentCapabilities(
        prompt_seed=True,
        mcp=True,
        hooks=False,
        permissions=False,
        session_resolution=False,
        handoff_resume=True,
    )

    def direct_command(
        self,
        prompt: str | None,
        mcp_config_path: str | Path | None = None,
    ) -> str:
        parts = [shlex.quote(self.command), "--approve-mcps"]
        if prompt:
            parts.extend(_seed_args(self.seed_style, self.seed_flag, prompt))
        return " ".join(parts)

    def shell_mcp_array_assignment(self) -> str:
        return "mcp=(--approve-mcps)"

    def install_mcp_config(
        self, servers: dict, project_dir: Path | None = None
    ) -> None:
        _merge_cursor_mcp_servers(
            _cursor_mcp_json_path(project_dir), servers
        )

    def remove_mcp_config(self, project_dir: Path | None = None) -> None:
        _remove_cursor_mcp_servers(
            _cursor_mcp_json_path(project_dir), CADE_MCP_SERVER_NAMES
        )


# ── Registry ────────────────────────────────────────────────────────────────


AdapterFactory = Callable[[object], CliCodingAgentAdapter]


def _claude_code_from_descriptor(agent: object) -> CliCodingAgentAdapter:
    return ClaudeCodeAdapter(
        command=getattr(agent, "command", "claude"),
        seed_style=getattr(agent, "seed_style", "positional"),
        seed_flag=getattr(agent, "seed_flag", "-p"),
    )


def _codex_from_descriptor(agent: object) -> CliCodingAgentAdapter:
    return CodexAdapter(
        command=getattr(agent, "command", "codex"),
        seed_style=getattr(agent, "seed_style", "positional"),
        seed_flag=getattr(agent, "seed_flag", ""),
    )


def _cursor_from_descriptor(agent: object) -> CliCodingAgentAdapter:
    return CursorAdapter(
        command=getattr(agent, "command", "cursor-agent"),
        seed_style=getattr(agent, "seed_style", "positional"),
        seed_flag=getattr(agent, "seed_flag", ""),
    )


ADAPTERS: dict[str, AdapterFactory] = {
    "claude-code": _claude_code_from_descriptor,
    "codex": _codex_from_descriptor,
    "cursor": _cursor_from_descriptor,
    # Historical escape hatch: before adapters, CADE_CLI_AGENT could point at
    # another Claude-compatible CLI. Keep it mapped to the Claude launch shape.
    "claude-compatible": _claude_code_from_descriptor,
}


def adapter_from_descriptor(agent: object) -> CliCodingAgentAdapter:
    """Return the adapter for the configured CLI agent descriptor."""
    adapter_id = getattr(agent, "adapter_id", "claude-code")
    factory = ADAPTERS.get(adapter_id)
    if factory is None:
        raise ValueError(f"Unknown CLI coding agent adapter: {adapter_id}")
    return factory(agent)
