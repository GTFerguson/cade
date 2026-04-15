"""Data source adapters for dashboard configs.

Each adapter fetches data from a different source type and returns
a list of dicts that dashboard components can render.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import yaml

from backend.dashboard.config import DataSourceConfig, DashboardConfig

logger = logging.getLogger(__name__)


class AdapterError(Exception):
    """Raised when a data adapter fails to fetch data."""


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class BaseAdapter(ABC):
    @abstractmethod
    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        """Fetch data from this source and return a list of entity dicts."""


# ---------------------------------------------------------------------------
# REST adapter — proxies API calls
# ---------------------------------------------------------------------------

class RestAdapter(BaseAdapter):
    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.endpoint:
            raise AdapterError(f"REST source '{config.name}': missing 'endpoint'")

        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(config.endpoint, headers=config.headers)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            raise AdapterError(f"REST source '{config.name}': {e}") from e

        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "items" in data:
            return data["items"]
        # Single object
        return [data] if isinstance(data, dict) else []


# ---------------------------------------------------------------------------
# JSON file adapter — reads a static JSON file
# ---------------------------------------------------------------------------

class JsonFileAdapter(BaseAdapter):
    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.path:
            raise AdapterError(f"JSON source '{config.name}': missing 'path'")

        file_path = project_root / config.path
        if not file_path.is_file():
            logger.warning("JSON source '%s': file not found: %s", config.name, file_path)
            return []

        def _read():
            text = file_path.read_text(encoding="utf-8")
            return json.loads(text)

        try:
            data = await asyncio.to_thread(_read)
        except Exception as e:
            raise AdapterError(f"JSON source '{config.name}': {e}") from e

        if isinstance(data, list):
            return data
        return [data] if isinstance(data, dict) else []


# ---------------------------------------------------------------------------
# Directory adapter — scans dir, parses YAML frontmatter per file
# ---------------------------------------------------------------------------

def _stringify_values(d: dict[str, Any]) -> dict[str, Any]:
    """Convert non-JSON-serializable values (dates, etc.) to strings."""
    import datetime
    result = {}
    for k, v in d.items():
        if isinstance(v, (datetime.date, datetime.datetime)):
            result[k] = v.isoformat()
        elif isinstance(v, dict):
            result[k] = _stringify_values(v)
        elif isinstance(v, list):
            result[k] = [
                item.isoformat() if isinstance(item, (datetime.date, datetime.datetime)) else item
                for item in v
            ]
        else:
            result[k] = v
    return result


def _parse_frontmatter(text: str) -> dict[str, Any]:
    """Extract YAML frontmatter from markdown text."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm_text = text[3:end].strip()
    try:
        data = yaml.safe_load(fm_text)
        if not isinstance(data, dict):
            return {}
        return _stringify_values(data)
    except yaml.YAMLError:
        return {}


class DirectoryAdapter(BaseAdapter):
    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.path:
            raise AdapterError(f"Directory source '{config.name}': missing 'path'")

        dir_path = project_root / config.path
        if not dir_path.is_dir():
            logger.warning("Directory source '%s': not found: %s", config.name, dir_path)
            return []

        def _scan():
            results = []
            # Scan both direct files and subdirectory index files
            for item in sorted(dir_path.iterdir()):
                if item.name.startswith(".") or item.name == "README.md":
                    continue

                target: Path | None = None
                if item.is_file() and item.suffix in (".md", ".yml", ".yaml"):
                    target = item
                elif item.is_dir():
                    # Look for an index file inside the subdirectory
                    for candidate_name in ("index.md", "application-guide.md", f"{item.name}.md"):
                        candidate = item / candidate_name
                        if candidate.is_file():
                            target = candidate
                            break
                    # Fallback: first .md file in the subdirectory
                    if target is None:
                        md_files = sorted(item.glob("*.md"))
                        if md_files:
                            target = md_files[0]

                if target is None:
                    continue

                text = target.read_text(encoding="utf-8")
                entry = _parse_frontmatter(text)
                entry.setdefault("_file", str(target.relative_to(project_root)))
                # Use the directory name or file stem as ID
                entry_id = item.stem if item.is_dir() else item.stem
                entry.setdefault("_filename", entry_id)
                if not entry.get("id"):
                    entry["id"] = entry_id
                results.append(entry)
            return results

        try:
            return await asyncio.to_thread(_scan)
        except Exception as e:
            raise AdapterError(f"Directory source '{config.name}': {e}") from e


# ---------------------------------------------------------------------------
# Markdown adapter — parses structured markdown into records
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(
    r"(?P<date>\d{1,2}\s+\w+(?:\s+\d{4})?|\w+\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})"
)


class MarkdownAdapter(BaseAdapter):
    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.path:
            raise AdapterError(f"Markdown source '{config.name}': missing 'path'")

        file_path = project_root / config.path
        if not file_path.is_file():
            logger.warning("Markdown source '%s': file not found: %s", config.name, file_path)
            return []

        parse_mode = config.parse or "list_items"

        def _parse():
            text = file_path.read_text(encoding="utf-8")
            if parse_mode == "date_entries":
                return _parse_date_entries(text)
            elif parse_mode == "ranked_list":
                return _parse_ranked_list(text)
            else:
                return _parse_list_items(text)

        try:
            return await asyncio.to_thread(_parse)
        except Exception as e:
            raise AdapterError(f"Markdown source '{config.name}': {e}") from e


def _parse_list_items(text: str) -> list[dict[str, Any]]:
    """Parse markdown list items into records."""
    results = []
    current_heading = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            current_heading = stripped.lstrip("#").strip()
        elif stripped.startswith("- ") or stripped.startswith("* "):
            item_text = stripped[2:].strip()
            # Check for checkbox
            done = False
            if item_text.startswith("[x]") or item_text.startswith("[X]"):
                done = True
                item_text = item_text[3:].strip()
            elif item_text.startswith("[ ]"):
                item_text = item_text[3:].strip()

            results.append({
                "id": f"item-{len(results)}",
                "text": item_text,
                "heading": current_heading,
                "done": done,
            })
    return results


def _parse_ranked_list(text: str) -> list[dict[str, Any]]:
    """Parse numbered or prioritized list items."""
    results = []
    current_heading = ""
    priority_map = {"critical": 1, "high": 2, "medium": 3, "low": 4}
    current_priority = "medium"

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading_text = stripped.lstrip("#").strip()
            current_heading = heading_text
            # Infer priority from heading
            lower = heading_text.lower()
            for keyword, prio in priority_map.items():
                if keyword in lower:
                    current_priority = keyword
                    break
        elif stripped.startswith(("- ", "* ")) or re.match(r"^\d+\.\s", stripped):
            item_text = re.sub(r"^[\-\*]\s+|^\d+\.\s+", "", stripped).strip()
            if not item_text:
                continue

            done = False
            if item_text.startswith("[x]") or item_text.startswith("[X]"):
                done = True
                item_text = item_text[3:].strip()
            elif item_text.startswith("[ ]"):
                item_text = item_text[3:].strip()

            results.append({
                "id": f"item-{len(results)}",
                "text": item_text,
                "heading": current_heading,
                "priority": current_priority,
                "done": done,
                "status": "done" if done else "todo",
            })
    return results


def _parse_date_entries(text: str) -> list[dict[str, Any]]:
    """Parse markdown with date-based entries.

    Handles both list-based and table-based timeline formats.
    Tables are detected by pipe-delimited rows with a header separator.
    """
    results = []
    current_heading = ""
    table_headers: list[str] = []
    in_table = False

    for line in text.splitlines():
        stripped = line.strip()

        if stripped.startswith("#"):
            current_heading = stripped.lstrip("#").strip()
            in_table = False
            table_headers = []
            continue

        # Detect table header row
        if "|" in stripped and not in_table:
            cells = [c.strip() for c in stripped.split("|")]
            cells = [c for c in cells if c]  # Remove empty from leading/trailing |
            if cells and all(c.replace("-", "").strip() == "" for c in cells):
                # This is the separator row — headers were the previous row
                in_table = True
                continue
            elif cells and not table_headers:
                table_headers = [c.lower().strip("*~ ") for c in cells]
                continue

        # Parse table data rows
        if in_table and "|" in stripped:
            cells = [c.strip() for c in stripped.split("|")]
            cells = [c for c in cells if c]  # Remove empty from leading/trailing |
            if not cells:
                continue

            # Build entry from headers + cells
            entry: dict[str, Any] = {
                "id": f"entry-{len(results)}",
                "heading": current_heading,
            }
            for i, header in enumerate(table_headers):
                if i < len(cells):
                    val = cells[i].strip("~* ")
                    entry[header] = val

            # Try to find a date field
            date_val = entry.get("date")
            if not date_val:
                # Check first cell as potential date
                first = cells[0].strip("~* ") if cells else ""
                date_match = _DATE_RE.search(first)
                if date_match:
                    date_val = date_match.group("date")
            entry["date"] = date_val

            # Build display text from 'what' column or all columns
            entry.setdefault("text", entry.get("what", " | ".join(cells)))
            results.append(entry)
            continue

        # Non-table: handle list items
        if not in_table and stripped.startswith(("- ", "* ")):
            item_text = stripped[2:].strip()
            date_match = _DATE_RE.search(item_text)
            date_str = date_match.group("date") if date_match else None
            results.append({
                "id": f"entry-{len(results)}",
                "text": item_text,
                "date": date_str,
                "heading": current_heading,
            })

        # End table on empty line
        if not stripped and in_table:
            in_table = False
            table_headers = []

    return results


# ---------------------------------------------------------------------------
# Vault adapter — recursively walks a tree of frontmatter markdown files
# ---------------------------------------------------------------------------

class VaultAdapter(BaseAdapter):
    """Recursive markdown vault.

    Walks a subtree rooted at `config.path` and returns one record per
    `.md` file. Each record has the file's YAML frontmatter fields plus:

    - ``id``: relative path stem, forward-slash separated (unique across the tree)
    - ``title``: ``frontmatter.title`` if present, else the file stem
    - ``_file``: file path relative to ``project_root``
    - ``_path``: path relative to the vault root (``config.path``)
    - ``_folder``: immediate parent folder relative to the vault root ("" for top-level)
    - ``_filename``: file stem (basename without ``.md``)
    - ``_body``: markdown content after the frontmatter block

    Files named ``README.md`` and anything starting with ``.`` are skipped,
    matching ``DirectoryAdapter``'s convention — treat these as folder notes,
    not entities.
    """

    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.path:
            raise AdapterError(f"Vault source '{config.name}': missing 'path'")

        vault_root = project_root / config.path
        if not vault_root.is_dir():
            logger.warning("Vault source '%s': directory not found: %s", config.name, vault_root)
            return []

        def _scan():
            results: list[dict[str, Any]] = []
            for md_path in sorted(vault_root.rglob("*.md")):
                if md_path.name == "README.md":
                    continue
                if any(part.startswith(".") for part in md_path.relative_to(vault_root).parts):
                    continue

                try:
                    text = md_path.read_text(encoding="utf-8")
                except OSError:
                    logger.warning("Vault source '%s': failed to read %s", config.name, md_path)
                    continue

                entry = _parse_frontmatter(text)
                rel_to_vault = md_path.relative_to(vault_root)
                rel_to_project = md_path.relative_to(project_root)
                stem_path = rel_to_vault.with_suffix("")
                parent = rel_to_vault.parent
                entry.setdefault("id", stem_path.as_posix())
                entry.setdefault("title", entry.get("title") or md_path.stem)
                entry["_file"] = rel_to_project.as_posix()
                entry["_path"] = rel_to_vault.as_posix()
                entry["_folder"] = parent.as_posix() if parent != Path(".") else ""
                entry["_filename"] = md_path.stem
                entry["_body"] = _strip_frontmatter(text)
                results.append(entry)
            return results

        try:
            return await asyncio.to_thread(_scan)
        except Exception as e:
            raise AdapterError(f"Vault source '{config.name}': {e}") from e


def _strip_frontmatter(text: str) -> str:
    """Return the markdown body with any leading YAML frontmatter removed."""
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    rest = text[end + 4:]
    return rest.lstrip("\n")


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_ADAPTERS: dict[str, BaseAdapter] = {
    "rest": RestAdapter(),
    "json_file": JsonFileAdapter(),
    "directory": DirectoryAdapter(),
    "markdown": MarkdownAdapter(),
    "vault": VaultAdapter(),
}


def get_adapter(source_type: str) -> BaseAdapter:
    """Get an adapter instance for a source type."""
    adapter = _ADAPTERS.get(source_type)
    if adapter is None:
        raise AdapterError(f"Unknown data source type: '{source_type}'")
    return adapter


async def fetch_all_sources(
    config: DashboardConfig, project_root: Path
) -> dict[str, list[dict[str, Any]]]:
    """Fetch data from all sources in parallel."""
    async def _fetch_one(name: str, src: DataSourceConfig):
        try:
            adapter = get_adapter(src.type)
            return name, await adapter.fetch(src, project_root)
        except AdapterError as e:
            logger.warning("Dashboard adapter error: %s", e)
            return name, []

    tasks = [_fetch_one(name, src) for name, src in config.data_sources.items()]
    results = await asyncio.gather(*tasks)
    return dict(results)
