"""File editing tool executor for LLM agents.

Tools: read_file, read_files, list_directory, write_file, edit_file,
       multi_edit, delete_file, move_file.

Write/edit/delete/move operations enforce:
  1. Mode permissions — plan/research block all writes; review allows docs/plans/ only.
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

_READ_FILES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "paths": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of file paths (absolute or relative to project root). Preferred over read_file when reading 2+ files.",
        },
        "offset": {"type": "integer", "description": "Start line number applied to each file, 1-indexed (optional)"},
        "limit": {"type": "integer", "description": "Maximum lines returned per file (optional)"},
    },
    "required": ["paths"],
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

_MULTI_EDIT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path (absolute or relative to project root)"},
        "edits": {
            "type": "array",
            "description": (
                "Ordered list of edits to apply. Each old_str must be unique at the time "
                "its edit runs (i.e. after preceding edits have been applied)."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "old_str": {"type": "string", "description": "Exact string to replace"},
                    "new_str": {"type": "string", "description": "Replacement string"},
                },
                "required": ["old_str", "new_str"],
            },
        },
    },
    "required": ["path", "edits"],
}

_DELETE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path to delete (absolute or relative to project root)"},
    },
    "required": ["path"],
}

_MOVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "src": {"type": "string", "description": "Source file path (absolute or relative to project root)"},
        "dst": {"type": "string", "description": "Destination file path (absolute or relative to project root). Parent directories are created if needed."},
    },
    "required": ["src", "dst"],
}

_LIST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Directory path (absolute or relative to project root). Defaults to project root."},
    },
    "required": [],
}

_ALL_DEFINITIONS = [
    ToolDefinition(
        name="read_file",
        description=(
            "Read a single file's contents. Use offset/limit to read a specific range of lines. "
            "Returns content with 1-indexed line numbers prefixed. "
            "Prefer read_files when you need to read more than one file."
        ),
        parameters_schema=_READ_SCHEMA,
    ),
    ToolDefinition(
        name="read_files",
        description=(
            "Read multiple files in a single call. Returns each file's content separated by "
            "'===== {path} =====' delimiters, with 1-indexed line numbers. Missing files are "
            "reported in a trailing '=== missing ===' section. Use this instead of calling "
            "read_file repeatedly — it saves turns and tokens. Total output is capped at ~256KB."
        ),
        parameters_schema=_READ_FILES_SCHEMA,
    ),
    ToolDefinition(
        name="list_directory",
        description=(
            "List the contents of a directory. Directories are shown with a trailing '/'. "
            "Defaults to the project root if no path is given."
        ),
        parameters_schema=_LIST_SCHEMA,
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
            "Use more surrounding context to disambiguate if there are multiple matches. "
            "Prefer multi_edit when making several changes to the same file."
        ),
        parameters_schema=_EDIT_SCHEMA,
    ),
    ToolDefinition(
        name="multi_edit",
        description=(
            "Apply multiple string replacements to a single file in one call. "
            "Edits are applied in order; each old_str must be unique in the file as it "
            "exists after previous edits. All-or-nothing: if any edit fails, none are "
            "applied. Prefer this over repeated edit_file calls on the same file."
        ),
        parameters_schema=_MULTI_EDIT_SCHEMA,
    ),
    ToolDefinition(
        name="delete_file",
        description=(
            "Permanently delete a file from disk. Use this when you need to remove a file — "
            "don't use write_file to blank it out. Requires write permission."
        ),
        parameters_schema=_DELETE_SCHEMA,
    ),
    ToolDefinition(
        name="move_file",
        description=(
            "Move or rename a file. Use instead of read_file + write_file + delete_file, "
            "which wastes three tool calls and three permission prompts for one operation. "
            "Creates parent directories at the destination if needed."
        ),
        parameters_schema=_MOVE_SCHEMA,
    ),
]

_READ_ONLY_COUNT = 3  # read_file + read_files + list_directory are always available
_READ_FILES_TOTAL_CAP = 256 * 1024  # 256KB total response cap
_WRITE_TOOL_NAMES = {"write_file", "edit_file", "multi_edit", "delete_file", "move_file"}


class FileToolExecutor:
    """Executes file read/write tools with permission and scope enforcement."""

    def __init__(self, project_root: Path, connection_id: str = "") -> None:
        self._root = project_root.resolve()
        self._connection_id = connection_id

    # ------------------------------------------------------------------
    # ToolExecutor protocol
    # ------------------------------------------------------------------

    def tool_definitions(self) -> list[ToolDefinition]:
        from backend.permissions.manager import get_permission_manager
        from backend.permissions.mode_permissions import can_write
        if can_write(get_permission_manager().get_mode(self._connection_id)):
            return _ALL_DEFINITIONS
        # Fully read-only modes: expose read_file + list_directory only
        return _ALL_DEFINITIONS[:_READ_ONLY_COUNT]

    def execute(self, name: str, arguments: dict) -> str:
        # Sync path not used — execute_async always takes precedence in ToolRegistry
        return "Error: file tools require async execution"

    async def execute_async(self, name: str, arguments: dict) -> str:
        try:
            if name == "read_file":
                return self._read_file(arguments)
            if name == "read_files":
                return self._read_files(arguments)
            if name == "list_directory":
                return self._list_directory(arguments)
            if name == "write_file":
                return await self._write_file(arguments)
            if name == "edit_file":
                return await self._edit_file(arguments)
            if name == "multi_edit":
                return await self._multi_edit(arguments)
            if name == "delete_file":
                return await self._delete_file(arguments)
            if name == "move_file":
                return await self._move_file(arguments)
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

    async def _nvim_record_edit(self, path: Path, old_content: str, new_content: str) -> None:
        try:
            from backend.neovim.manager import get_neovim_manager
            await get_neovim_manager().record_edit(self._root, path, old_content, new_content)
        except Exception:
            pass

    async def _check_write_permission(
        self, path: Path, tool_name: str, tool_input: dict
    ) -> str | None:
        """Return an error string if the write should be blocked, else None."""
        from backend.permissions.manager import get_permission_manager
        from backend.permissions.mode_permissions import can_write_path

        perms = get_permission_manager()

        mode = perms.get_mode(self._connection_id)
        if not can_write_path(mode, path):
            return f"Error: {mode} mode does not allow writing to {path}"

        # Out-of-scope paths need explicit one-time approval
        if not self._in_scope(path) and not perms.is_path_approved(path, self._connection_id):
            result = await perms.request_permission(
                tool_name=tool_name,
                description=f"Write outside project root: {path}",
                tool_input=tool_input,
                connection_id=self._connection_id,
            )
            if result["decision"] != "allow":
                return f"Error: {result.get('message', 'Permission denied')}"
            perms.approve_path(path, self._connection_id)

        if not perms.get_allow_write(self._connection_id):
            result = await perms.request_permission(
                tool_name=tool_name,
                description=str(path),
                tool_input=tool_input,
                connection_id=self._connection_id,
            )
            if result["decision"] != "allow":
                return f"Error: {result.get('message', 'User denied write')}"

        return None

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    def _list_directory(self, args: dict) -> str:

        raw = args.get("path", "")
        path = self._resolve(raw) if raw else self._root

        if not path.exists():
            return f"Error: path not found: {path}"
        if not path.is_dir():
            return f"Error: not a directory: {path}"

        try:
            entries = sorted(path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return f"Error: permission denied: {path}"

        if not entries:
            return f"{path}/\n(empty)"

        lines = [f"{path}/"]
        for entry in entries:
            lines.append(entry.name + "/" if entry.is_dir() else entry.name)
        return "\n".join(lines)

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

    def _read_files(self, args: dict) -> str:
        raw_paths = args.get("paths") or []
        if not isinstance(raw_paths, list) or not raw_paths:
            return "Error: paths must be a non-empty list of file paths"

        offset = args.get("offset")
        limit = args.get("limit")
        start = (offset - 1) if offset and offset > 0 else 0

        sections: list[str] = []
        missing: list[str] = []
        total_size = 0
        truncated = False

        for raw in raw_paths:
            path = self._resolve(str(raw))

            if not path.exists() or not path.is_file():
                missing.append(str(path))
                continue

            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except Exception as e:
                missing.append(f"{path} (read error: {e})")
                continue

            end = (start + limit) if limit and limit > 0 else len(lines)
            selected = lines[start:end]
            body = "\n".join(f"{start + i + 1}\t{line}" for i, line in enumerate(selected))
            section = f"===== {path} =====\n{body}"

            if total_size + len(section) > _READ_FILES_TOTAL_CAP:
                remaining = len(raw_paths) - len(sections) - len(missing)
                sections.append(
                    f"===== (truncated) =====\n"
                    f"Output cap reached ({_READ_FILES_TOTAL_CAP} bytes). "
                    f"{remaining} file(s) not read. Request them in a follow-up call."
                )
                truncated = True
                break

            sections.append(section)
            total_size += len(section) + 1

        result = "\n".join(sections)
        if missing:
            result += "\n=== missing ===\n" + "\n".join(missing)
        if truncated and not sections:
            result = "Error: first file exceeds output cap — use read_file with offset/limit"
        return result

    async def _write_file(self, args: dict) -> str:
        path = self._resolve(args["path"])
        content: str = args.get("content", "")

        err = await self._check_write_permission(path, "write_file", args)
        if err:
            return err

        old_content = ""
        if path.exists():
            try:
                old_content = path.read_text(encoding="utf-8")
            except Exception:
                pass

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        await self._nvim_record_edit(path, old_content, content)
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

        new_content = content.replace(old_str, new_str, 1)
        path.write_text(new_content, encoding="utf-8")
        await self._nvim_record_edit(path, content, new_content)
        return f"Edited {path}"

    async def _multi_edit(self, args: dict) -> str:
        path = self._resolve(args["path"])
        edits: list[dict] = args.get("edits") or []

        if not edits:
            return "Error: edits list is required and must be non-empty"
        if not path.exists():
            return f"Error: file not found: {path}"

        err = await self._check_write_permission(path, "multi_edit", args)
        if err:
            return err

        try:
            original = path.read_text(encoding="utf-8")
        except Exception as e:
            return f"Error reading file: {e}"

        # Apply edits on a working copy; bail on first failure (atomic)
        working = original
        for i, edit in enumerate(edits):
            old_str = edit.get("old_str", "")
            new_str = edit.get("new_str", "")
            if not old_str:
                return f"Error: edit {i + 1} is missing old_str"
            count = working.count(old_str)
            if count == 0:
                return f"Error: edit {i + 1} — old_str not found in file (after {i} previous edits applied)"
            if count > 1:
                return (
                    f"Error: edit {i + 1} — old_str is ambiguous ({count} occurrences). "
                    "Add more surrounding context to make it unique."
                )
            working = working.replace(old_str, new_str, 1)

        path.write_text(working, encoding="utf-8")
        await self._nvim_record_edit(path, original, working)
        return f"Applied {len(edits)} edit(s) to {path}"

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

    async def _move_file(self, args: dict) -> str:
        import shutil
        src = self._resolve(args["src"])
        dst = self._resolve(args["dst"])

        if not src.exists():
            return f"Error: source not found: {src}"
        if not src.is_file():
            return f"Error: source is not a file: {src}"
        if dst.is_dir():
            return f"Error: destination is a directory: {dst}"

        # Permission check on both paths — moving is effectively a write at dst and delete at src
        err = await self._check_write_permission(src, "move_file", args)
        if err:
            return err
        if dst != src:
            err = await self._check_write_permission(dst, "move_file", args)
            if err:
                return err

        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return f"Moved {src} → {dst}"
