"""File editing tool executor for LLM agents.

Tools: read_file, write_file, edit_file, delete_file.

Write/edit/delete operations enforce:
  1. Mode permissions — architect/review modes block writes.
  2. Project scope  — paths outside the project root require explicit user approval,
                      which is then cached at directory level for the session.
  3. Accept-edits toggle — when off, every write prompts for approval regardless of scope.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

_READ_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path (absolute or relative to project root)"},
        "offset": {"type": "integer", "description": "Start line number, 1-indexed (optional)"},
        "limit": {"type": "integer", "description": "Maximum number of lines to return (optional)"},
    },
    "required": ["path"],
}

_WRITE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path (absolute or relative to project root)"},
        "content": {"type": "string", "description": "Full file content to write"},
    },
    "required": ["path", "content"],
}

_EDIT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path (absolute or relative to project root)"},
        "old_str": {"type": "string", "description": "Exact string to replace — must appear exactly once in the file"},
        "new_str": {"type": "string", "description": "Replacement string"},
    },
    "required": ["path", "old_str", "new_str"],
}

_DELETE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path to delete (absolute or relative to project root)"},
    },
    "required": ["path"],
}

_ALL_DEFINITIONS = [
    ToolDefinition(
        name="read_file",
        description=(
            "Read a file's contents. Use offset/limit to read a specific range of lines. "
            "Returns content with 1-indexed line numbers prefixed."
        ),
        parameters_schema=_READ_SCHEMA,
    ),
    ToolDefinition(
        name="write_file",
        description="Write content to a file, creating it or overwriting it entirely.",
        parameters_schema=_WRITE_SCHEMA,
    ),
    ToolDefinition(
        name="edit_file",
        description=(
            "Replace a unique string in a file. old_str must appear exactly once. "
            "Use more surrounding context to disambiguate if there are multiple matches."
        ),
        parameters_schema=_EDIT_SCHEMA,
    ),
    ToolDefinition(
        name="delete_file",
        description="Delete a file from disk.",
        parameters_schema=_DELETE_SCHEMA,
    ),
]

_WRITE_TOOL_NAMES = {"write_file", "edit_file", "delete_file"}


class FileToolExecutor:
    """Executes file read/write tools with permission and scope enforcement."""

    def __init__(self, project_root: Path) -> None:
        self._root = project_root.resolve()

    # ------------------------------------------------------------------
    # ToolExecutor protocol
    # ------------------------------------------------------------------

    def tool_definitions(self) -> list[ToolDefinition]:
        from backend.permissions.manager import get_permission_manager
        from backend.permissions.mode_permissions import can_write
        if can_write(get_permission_manager().get_mode()):
            return _ALL_DEFINITIONS
        # Read-only modes: only expose read_file
        return [_ALL_DEFINITIONS[0]]

    def execute(self, name: str, arguments: dict) -> str:
        # Sync path not used — execute_async always takes precedence in ToolRegistry
        return "Error: file tools require async execution"

    async def execute_async(self, name: str, arguments: dict) -> str:
        try:
            if name == "read_file":
                return self._read_file(arguments)
            if name == "write_file":
                return await self._write_file(arguments)
            if name == "edit_file":
                return await self._edit_file(arguments)
            if name == "delete_file":
                return await self._delete_file(arguments)
            return f"Error: unknown tool '{name}'"
        except Exception as e:
            logger.error("file tool %s failed: %s", name, e)
            return f"Error: {e}"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve(self, raw: str) -> Path:
        p = Path(raw)
        if not p.is_absolute():
            p = self._root / p
        return p.resolve()

    def _in_scope(self, path: Path) -> bool:
        try:
            path.relative_to(self._root)
            return True
        except ValueError:
            return False

    async def _check_write_permission(
        self, path: Path, tool_name: str, tool_input: dict
    ) -> str | None:
        """Return an error string if the write should be blocked, else None."""
        from backend.permissions.manager import get_permission_manager
        from backend.permissions.mode_permissions import can_write

        perms = get_permission_manager()

        if not can_write(perms.get_mode()):
            return f"Error: {perms.get_mode()} mode does not allow file writes"

        # Out-of-scope paths need explicit one-time approval
        if not self._in_scope(path) and not perms.is_path_approved(path):
            result = await perms.request_permission(
                tool_name=tool_name,
                description=f"Write outside project root: {path}",
                tool_input=tool_input,
            )
            if result["decision"] != "allow":
                return f"Error: {result.get('message', 'Permission denied')}"
            perms.approve_path(path)

        # When accept_edits is off, every write needs explicit approval
        if not perms.accept_edits:
            result = await perms.request_permission(
                tool_name=tool_name,
                description=str(path),
                tool_input=tool_input,
            )
            if result["decision"] != "allow":
                return f"Error: {result.get('message', 'User denied edit')}"

        return None

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    def _read_file(self, args: dict) -> str:
        path = self._resolve(args["path"])
        offset = args.get("offset")
        limit = args.get("limit")

        if not path.exists():
            return f"Error: file not found: {path}"
        if not path.is_file():
            return f"Error: not a file: {path}"

        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception as e:
            return f"Error: {e}"

        start = (offset - 1) if offset and offset > 0 else 0
        end = (start + limit) if limit and limit > 0 else len(lines)
        selected = lines[start:end]

        return "\n".join(f"{start + i + 1}\t{line}" for i, line in enumerate(selected))

    async def _write_file(self, args: dict) -> str:
        path = self._resolve(args["path"])
        content: str = args.get("content", "")

        err = await self._check_write_permission(path, "write_file", args)
        if err:
            return err

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return f"Written {len(content)} bytes to {path}"

    async def _edit_file(self, args: dict) -> str:
        path = self._resolve(args["path"])
        old_str: str = args.get("old_str", "")
        new_str: str = args.get("new_str", "")

        if not old_str:
            return "Error: old_str is required"
        if not path.exists():
            return f"Error: file not found: {path}"

        err = await self._check_write_permission(path, "edit_file", args)
        if err:
            return err

        try:
            content = path.read_text(encoding="utf-8")
        except Exception as e:
            return f"Error reading file: {e}"

        count = content.count(old_str)
        if count == 0:
            return "Error: old_str not found in file"
        if count > 1:
            return (
                f"Error: old_str is ambiguous — found {count} occurrences. "
                "Add more surrounding context to make it unique."
            )

        path.write_text(content.replace(old_str, new_str, 1), encoding="utf-8")
        return f"Edited {path}"

    async def _delete_file(self, args: dict) -> str:
        path = self._resolve(args["path"])

        if not path.exists():
            return f"Error: file not found: {path}"
        if not path.is_file():
            return f"Error: not a file: {path}"

        err = await self._check_write_permission(path, "delete_file", args)
        if err:
            return err

        path.unlink()
        return f"Deleted {path}"
