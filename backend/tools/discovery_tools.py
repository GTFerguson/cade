"""Read-only discovery tools: glob (file patterns) and grep (content search).

No permission gating — these are purely read-only and don't leave the
filesystem untouched. They operate within the project root by default and
don't restrict out-of-scope paths, matching the same convention as read_file.

ripgrep is preferred when available; Python re/pathlib used as fallback.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)

_GLOB_MAX_RESULTS = 200
_GREP_MAX_RESULTS = 100
_GREP_CONTEXT_BYTES = 64 * 1024  # 64KB output cap

# Detect ripgrep once at import time
_RG = shutil.which("rg")

# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

_GLOB_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pattern": {
            "type": "string",
            "description": (
                "Glob pattern, e.g. '**/*.py', 'src/**/*.ts', '*.md'. "
                "Matched relative to cwd (defaults to project root)."
            ),
        },
        "cwd": {
            "type": "string",
            "description": "Directory to search from. Defaults to project root.",
        },
    },
    "required": ["pattern"],
}

_GREP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pattern": {
            "type": "string",
            "description": "Regular expression pattern to search for.",
        },
        "path": {
            "type": "string",
            "description": "File or directory to search. Defaults to project root.",
        },
        "glob": {
            "type": "string",
            "description": "Restrict search to files matching this glob, e.g. '*.py'.",
        },
        "case_insensitive": {
            "type": "boolean",
            "description": "Case-insensitive matching (default false).",
        },
        "max_results": {
            "type": "integer",
            "description": f"Maximum number of matches to return (default {_GREP_MAX_RESULTS}).",
        },
    },
    "required": ["pattern"],
}

_ALL_DEFINITIONS = [
    ToolDefinition(
        name="glob",
        description=(
            f"Find files by name pattern. Supports ** recursive globs. "
            f"Returns paths relative to project root, sorted by modification time "
            f"(newest first). Capped at {_GLOB_MAX_RESULTS} results."
        ),
        parameters_schema=_GLOB_SCHEMA,
    ),
    ToolDefinition(
        name="grep",
        description=(
            f"Search file contents with a regex. Returns {{path}}:{{line_no}}:{{line}} "
            f"matches, capped at {_GREP_MAX_RESULTS} results. Uses ripgrep when available, "
            "falls back to Python re. Respects .gitignore when ripgrep is used."
        ),
        parameters_schema=_GREP_SCHEMA,
    ),
]


class DiscoveryToolExecutor:
    """Executes glob and grep tools."""

    def __init__(self, project_root: Path) -> None:
        self._root = project_root.resolve()

    def tool_definitions(self) -> list[ToolDefinition]:
        return _ALL_DEFINITIONS

    def execute(self, name: str, arguments: dict) -> str:
        return "Error: discovery tools require async execution"

    async def execute_async(self, name: str, arguments: dict) -> str:
        try:
            if name == "glob":
                return self._glob(arguments)
            if name == "grep":
                return await self._grep(arguments)
            return f"Error: unknown tool '{name}'"
        except Exception as e:
            logger.error("discovery tool %s failed: %s", name, e)
            return f"Error: {e}"

    # ------------------------------------------------------------------

    def _resolve(self, raw: str) -> Path:
        p = Path(raw)
        return (p if p.is_absolute() else self._root / p).resolve()

    def _glob(self, args: dict) -> str:
        pattern: str = args.get("pattern", "")
        if not pattern:
            return "Error: pattern is required"

        raw_cwd = args.get("cwd", "")
        base = self._resolve(raw_cwd) if raw_cwd else self._root

        if not base.exists():
            return f"Error: path not found: {base}"

        try:
            matches = sorted(base.rglob(pattern) if "**" in pattern else base.glob(pattern),
                             key=lambda p: p.stat().st_mtime, reverse=True)
        except Exception as e:
            return f"Error: {e}"

        if not matches:
            return "No files matched."

        truncated = len(matches) > _GLOB_MAX_RESULTS
        results = matches[:_GLOB_MAX_RESULTS]

        lines = []
        for p in results:
            try:
                rel = p.relative_to(self._root)
            except ValueError:
                rel = p
            lines.append(str(rel))

        out = "\n".join(lines)
        if truncated:
            out += f"\n... ({len(matches) - _GLOB_MAX_RESULTS} more results truncated)"
        return out

    async def _grep(self, args: dict) -> str:
        pattern: str = args.get("pattern", "")
        if not pattern:
            return "Error: pattern is required"

        raw_path = args.get("path", "")
        search_path = self._resolve(raw_path) if raw_path else self._root
        glob_filter: str = args.get("glob", "")
        case_insensitive: bool = args.get("case_insensitive", False)
        max_results: int = min(args.get("max_results") or _GREP_MAX_RESULTS, _GREP_MAX_RESULTS)

        if not search_path.exists():
            return f"Error: path not found: {search_path}"

        if _RG:
            return await self._grep_rg(pattern, search_path, glob_filter, case_insensitive, max_results)
        return self._grep_python(pattern, search_path, glob_filter, case_insensitive, max_results)

    async def _grep_rg(
        self, pattern: str, path: Path, glob_filter: str,
        case_insensitive: bool, max_results: int,
    ) -> str:
        cmd = [_RG, "--line-number", "--no-heading", "--color=never",
               f"--max-count={max_results}", f"--max-filesize=1M"]
        if case_insensitive:
            cmd.append("--ignore-case")
        if glob_filter:
            cmd += ["--glob", glob_filter]
        cmd += [pattern, str(path)]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
            output = stdout.decode("utf-8", errors="replace")
        except asyncio.TimeoutError:
            return "Error: grep timed out"
        except Exception as e:
            return f"Error: {e}"

        if not output.strip():
            return "No matches found."

        lines = output.splitlines()
        # Relativise absolute paths in rg output
        result_lines = []
        for line in lines[:max_results]:
            if line.startswith(str(path)):
                line = line[len(str(path)):].lstrip("/")
            result_lines.append(line)

        out = "\n".join(result_lines)
        if len(out) > _GREP_CONTEXT_BYTES:
            out = out[:_GREP_CONTEXT_BYTES] + f"\n... (truncated at {_GREP_CONTEXT_BYTES} bytes)"
        return out

    def _grep_python(
        self, pattern: str, path: Path, glob_filter: str,
        case_insensitive: bool, max_results: int,
    ) -> str:
        flags = re.IGNORECASE if case_insensitive else 0
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return f"Error: invalid regex — {e}"

        files: list[Path]
        if path.is_file():
            files = [path]
        else:
            try:
                if glob_filter:
                    files = [p for p in path.rglob(glob_filter) if p.is_file()]
                else:
                    files = [p for p in path.rglob("*") if p.is_file()]
            except Exception as e:
                return f"Error listing files: {e}"

        results: list[str] = []
        total_bytes = 0

        for f in files:
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            for lineno, line in enumerate(text.splitlines(), 1):
                if regex.search(line):
                    try:
                        rel = str(f.relative_to(self._root))
                    except ValueError:
                        rel = str(f)
                    entry = f"{rel}:{lineno}:{line}"
                    results.append(entry)
                    total_bytes += len(entry) + 1
                    if len(results) >= max_results or total_bytes > _GREP_CONTEXT_BYTES:
                        break
            if len(results) >= max_results or total_bytes > _GREP_CONTEXT_BYTES:
                break

        if not results:
            return "No matches found."

        out = "\n".join(results)
        if total_bytes > _GREP_CONTEXT_BYTES:
            out += f"\n... (truncated at {_GREP_CONTEXT_BYTES} bytes)"
        return out
