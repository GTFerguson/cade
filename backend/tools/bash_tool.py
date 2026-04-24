"""Gated bash tool for LiteLLM agents.

Commands are classified into four buckets before execution:

  COMPOUND  — shell operators detected (&&, ||, ;, |, backticks, $(...))
               → rejected; agent must issue separate calls
  HARD_DENY — catastrophic or irreversible commands (sudo, rm /, shutdown…)
               → refused without prompting
  AUTO      — known-safe read-only commands
               → runs immediately, no prompt
  PROMPT    — everything else
               → goes through request_permission; user can allow-once or
                  allow this command token for the session

Security note: the gating is advisory + UX, not a sandbox.  The agent
already has write-file access to the project, so the threat model here is
preventing footguns and unintended side-effects, not adversarial containment.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shlex
import shutil
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Classification tables
# ---------------------------------------------------------------------------

# First tokens that are always auto-approved (read-only or info-only).
_AUTO_FIRST_TOKENS: frozenset[str] = frozenset({
    # File inspection
    "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df",
    "find", "rg", "grep", "awk", "sed",   # sed read-only; -i flag caught below
    "sort", "uniq", "cut", "tr", "diff", "tree",
    # Navigation / env
    "pwd", "which", "type", "echo", "env", "printenv", "date", "uname", "hostname",
    # Data tools
    "jq", "yq", "xmllint", "column",
    # Version checks (subcommand/flag checked below for non-version uses)
    "python3", "python", "node", "ruby", "perl",
})

# git subcommands that are auto-approved (read-only git operations).
_AUTO_GIT_SUBCOMMANDS: frozenset[str] = frozenset({
    "status", "log", "diff", "show", "branch", "tag", "remote",
    "rev-parse", "ls-files", "blame", "describe", "reflog",
    "shortlog", "stash",  # stash list is read-only; bare stash is a write
})

# First tokens that are always refused without prompting.
_HARD_DENY_FIRST_TOKENS: frozenset[str] = frozenset({
    "sudo", "su", "doas", "pkexec",
    "shutdown", "reboot", "halt", "poweroff", "init",
    "mkfs", "fdisk", "parted", "dd",
    "passwd", "chpasswd", "visudo",
    "crontab",
})

# Regex that detects unquoted shell operators in the raw command string.
# We strip obvious quoted regions first to reduce false positives.
_QUOTED_REGION_RE = re.compile(r'"[^"\\]*(?:\\.[^"\\]*)*"|\'[^\']*\'')
_SHELL_OP_RE = re.compile(r"&&|\|\||;;|[|;&`]|\$\(|<\(|>\(")

# Hard-deny patterns checked against the full command string (post-strip).
# These catch the really bad stuff that first-token checks miss.
_HARD_DENY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\brm\s+.*(-[a-zA-Z]*r[a-zA-Z]*f|--force.*--recursive|--recursive.*--force).*\s*/(\s|$)"),
    re.compile(r"\brm\s+-rf\b"),   # rm -rf anything is at least prompt-worthy; escalate to deny
    re.compile(r">\s*/dev/sd"),    # raw disk writes
    re.compile(r">\s*/dev/nv"),    # NVMe
    re.compile(r">\s*/sys/"),
    re.compile(r">\s*/proc/sysrq"),
    re.compile(r"\bcurl\b.*\|\s*\b(sh|bash|zsh|fish)\b"),   # download-and-exec via pipe
    re.compile(r"\bwget\b.*-O.*-.*\|\s*\b(sh|bash|zsh)\b"),
    re.compile(r"~/.ssh\b"),
    re.compile(r"~/.aws\b"),
    re.compile(r"~/.gnupg\b"),
]

# Output/timeout caps
_DEFAULT_TIMEOUT_MS = 30_000
_MAX_TIMEOUT_MS = 300_000
_MAX_OUTPUT_BYTES = 64 * 1024  # 64KB per stream


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_BASH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "command": {
            "type": "string",
            "description": (
                "Shell command to run. Compound commands (&&, ||, |, ;) are not "
                "supported — issue each step as a separate bash() call. "
                "Runs in the project root by default."
            ),
        },
        "timeout_ms": {
            "type": "integer",
            "description": f"Timeout in milliseconds (default {_DEFAULT_TIMEOUT_MS}, max {_MAX_TIMEOUT_MS}).",
        },
        "cwd": {
            "type": "string",
            "description": "Working directory (absolute or relative to project root). Defaults to project root.",
        },
    },
    "required": ["command"],
}


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------

def _strip_quotes(s: str) -> str:
    return _QUOTED_REGION_RE.sub("", s)


def _classify(command: str) -> tuple[str, str]:
    """Return (bucket, reason).

    Buckets: "compound", "hard_deny", "auto", "prompt"
    """
    stripped = _strip_quotes(command)

    # 1. Compound check — must be first so operators in hard-deny cmds are caught
    m = _SHELL_OP_RE.search(stripped)
    if m:
        return "compound", f"shell operator '{m.group()}' detected"

    # 2. Hard-deny patterns on the full stripped command
    for pat in _HARD_DENY_PATTERNS:
        if pat.search(stripped):
            return "hard_deny", f"matches dangerous pattern: {pat.pattern}"

    # 3. Parse first token
    try:
        tokens = shlex.split(command)
    except ValueError as e:
        return "hard_deny", f"command parse error: {e}"

    if not tokens:
        return "hard_deny", "empty command"

    first = Path(tokens[0]).name  # strip any path prefix (e.g. /usr/bin/git → git)

    if first in _HARD_DENY_FIRST_TOKENS or first.startswith("mkfs"):
        return "hard_deny", f"'{first}' is never permitted"

    # 4. sed: deny if -i flag present (in-place edit)
    if first == "sed" and any(t.startswith("-") and "i" in t.lstrip("-") for t in tokens[1:]):
        return "prompt", "sed -i modifies files in-place"

    # 5. python/node/ruby: auto-approve only for --version / -V / -c "..." patterns
    if first in {"python3", "python", "node", "ruby", "perl"}:
        flags = [t for t in tokens[1:] if t.startswith("-")]
        if any(f in {"-V", "--version", "-v"} for f in flags) and len(tokens) <= 2:
            return "auto", "version check"
        return "prompt", f"{first} can execute arbitrary code"

    # 6. git: check subcommand
    if first == "git":
        sub = next((t for t in tokens[1:] if not t.startswith("-")), None)
        if sub in _AUTO_GIT_SUBCOMMANDS:
            return "auto", f"git {sub} is read-only"
        return "prompt", f"git {sub or '(unknown)'} is not on the auto-approve list"

    # 7. General auto-approve list
    if first in _AUTO_FIRST_TOKENS:
        return "auto", f"'{first}' is on the auto-approve list"

    return "prompt", f"'{first}' requires explicit approval"


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class BashToolExecutor:
    """Executes bash commands with classification-based gating."""

    def __init__(self, project_root: Path, connection_id: str = "") -> None:
        self._root = project_root.resolve()
        self._connection_id = connection_id

    def tool_definitions(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="bash",
                description=(
                    "Run a shell command. Common read-only commands (ls, cat, grep, rg, "
                    "git status/log/diff, etc.) run immediately. Other commands prompt for "
                    "approval; once approved, the token is remembered for the session. "
                    "Compound commands (&&, |, ;) are not supported — issue each step separately."
                ),
                parameters_schema=_BASH_SCHEMA,
            )
        ]

    def execute(self, name: str, arguments: dict) -> str:
        return "Error: bash tool requires async execution"

    async def execute_async(self, name: str, arguments: dict) -> str:
        if name != "bash":
            return f"Error: unknown tool '{name}'"

        command: str = arguments.get("command", "").strip()
        if not command:
            return "Error: command is required"

        timeout_ms = min(int(arguments.get("timeout_ms") or _DEFAULT_TIMEOUT_MS), _MAX_TIMEOUT_MS)
        raw_cwd = arguments.get("cwd", "")
        cwd = self._resolve_cwd(raw_cwd)

        bucket, reason = _classify(command)

        if bucket == "compound":
            op = reason.split("'")[1] if "'" in reason else ""
            return (
                f"Error: compound shell commands are not supported "
                f"(detected: `{op}`). Issue each command as a separate bash() call."
            )

        if bucket == "hard_deny":
            return f"Error: command refused — {reason}"

        if bucket == "auto":
            logger.debug("bash auto-approve: %s", command[:80])
            return await self._run(command, cwd, timeout_ms)

        # bucket == "prompt"
        return await self._prompt_and_run(command, cwd, timeout_ms, arguments)

    def _resolve_cwd(self, raw: str) -> Path:
        if not raw:
            return self._root
        p = Path(raw)
        return (p if p.is_absolute() else self._root / p).resolve()

    async def _prompt_and_run(
        self, command: str, cwd: Path, timeout_ms: int, original_args: dict
    ) -> str:
        from backend.permissions.manager import get_permission_manager
        from backend.permissions.mode_permissions import can_write

        perms = get_permission_manager()

        if not can_write(perms.get_mode(self._connection_id)):
            return f"Error: current mode does not allow running commands"

        # Extract first token as the session-approvable key
        try:
            first_token = Path(shlex.split(command)[0]).name
        except (ValueError, IndexError):
            first_token = ""

        # Check if this command token was already approved for session
        if first_token and perms.is_command_approved(first_token, self._connection_id):
            logger.debug("bash session-approved: %s", command[:80])
            return await self._run(command, cwd, timeout_ms)

        # Inject session key into tool_input so approve() can cache it
        tool_input = {**original_args, "_session_key": first_token}

        result = await perms.request_permission(
            tool_name="bash",
            description=command,
            tool_input=tool_input,
            connection_id=self._connection_id,
        )

        if result["decision"] != "allow":
            return f"Error: {result.get('message', 'Permission denied')}"

        return await self._run(command, cwd, timeout_ms)

    async def _run(self, command: str, cwd: Path, timeout_ms: int) -> str:
        timeout_s = timeout_ms / 1000

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(cwd),
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_s
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return f"Error: command timed out after {timeout_ms}ms"
        except Exception as e:
            return f"Error: {e}"

        stdout = _truncate(stdout_bytes.decode("utf-8", errors="replace"), _MAX_OUTPUT_BYTES)
        stderr = _truncate(stderr_bytes.decode("utf-8", errors="replace"), _MAX_OUTPUT_BYTES)
        code = proc.returncode

        parts = [f"exit: {code}"]
        if stdout:
            parts += ["----- stdout -----", stdout]
        if stderr:
            parts += ["----- stderr -----", stderr]
        if not stdout and not stderr:
            parts.append("(no output)")
        return "\n".join(parts)


def _truncate(text: str, cap: int) -> str:
    if len(text.encode()) <= cap:
        return text
    # Truncate by bytes, then decode safely
    truncated = text.encode()[:cap].decode("utf-8", errors="replace")
    remaining_bytes = len(text.encode()) - cap
    return truncated + f"\n... (truncated — {remaining_bytes} more bytes)"
