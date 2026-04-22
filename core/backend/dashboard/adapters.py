"""Data source adapters for dashboard configs.

Each adapter fetches data from a different source type and returns
a list of dicts that dashboard components can render.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import yaml

from core.backend.dashboard.config import DataSourceConfig, DashboardConfig

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
            if parse_mode == "raw":
                # Single-record mode: return the entire file body as one
                # record with a `content` field. Pair with the frontend
                # MarkdownPanelComponent (fields: [content] or default)
                # to render the whole file as rich markdown.
                return [{"content": text}]
            if parse_mode == "date_entries":
                return _parse_date_entries(text)
            if parse_mode == "ranked_list":
                return _parse_ranked_list(text)
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


class JsonDirectoryAdapter(BaseAdapter):
    """Reads a directory of `*.json` files, one record per file.

    Each file's top-level object becomes a record. The filename stem is
    exposed as `_filename` and used as `id` if the object has no `id`.
    The full parsed JSON is also exposed as `_json` (string) so detail
    views can pretty-print the raw file.

    Extra options (via data source config `extra`):
      merge_suffix: str  — e.g. "-map". For each primary file, look for a
                           sibling named `{stem}{suffix}.json` and embed its
                           parsed data as `_sibling` in the record. Sibling
                           files are excluded from the primary listing.
      exclude: str | list — filename(s) to skip entirely (exact match).
    """

    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        if not config.path:
            raise AdapterError(f"JSON directory source '{config.name}': missing 'path'")

        dir_path = project_root / config.path
        if not dir_path.is_dir():
            logger.warning("JSON directory source '%s': not found: %s", config.name, dir_path)
            return []

        merge_suffix: str = config.extra.get("merge_suffix", "")
        exclude_raw = config.extra.get("exclude", [])
        exclude_names: set[str] = (
            {exclude_raw} if isinstance(exclude_raw, str) else set(exclude_raw)
        )

        def _load_json(path: Path) -> dict[str, Any] | None:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else None
            except Exception as e:
                logger.warning("JSON directory '%s': skipping %s: %s", config.name, path.name, e)
                return None

        def _scan():
            results = []
            all_files = sorted(dir_path.glob("*.json"))

            # Build set of sibling filenames to skip in primary listing
            sibling_names: set[str] = set()
            if merge_suffix:
                sibling_names = {
                    f.name for f in all_files
                    if f.stem.endswith(merge_suffix)
                }

            for item in all_files:
                if item.name.startswith("."):
                    continue
                if item.name in exclude_names:
                    continue
                if item.name in sibling_names:
                    continue

                data = _load_json(item)
                if data is None:
                    continue

                entry = dict(data)
                entry.setdefault("_filename", item.stem)
                entry.setdefault("_file", str(item.relative_to(project_root)))
                pretty = json.dumps(data, indent=2, ensure_ascii=False)
                entry.setdefault("_json", pretty)
                entry.setdefault("_json_md", f"```json\n{pretty}\n```\n")
                if not entry.get("id"):
                    entry["id"] = item.stem

                if merge_suffix:
                    sibling_path = dir_path / f"{item.stem}{merge_suffix}.json"
                    if sibling_path.is_file():
                        sibling_data = _load_json(sibling_path)
                        if sibling_data is not None:
                            entry["_sibling"] = sibling_data

                results.append(entry)
            return results

        try:
            return await asyncio.to_thread(_scan)
        except Exception as e:
            raise AdapterError(f"JSON directory source '{config.name}': {e}") from e


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
# Model usage adapter — aggregates JSONL call logs across projects
# ---------------------------------------------------------------------------

def _parse_window_seconds(window: str) -> float:
    """Parse '7d', '24h', '30m' to seconds. Defaults to 7 days."""
    m = re.match(r"^(\d+)([dhm])$", window.strip())
    if not m:
        return 7 * 86400
    value, unit = int(m.group(1)), m.group(2)
    return value * {"d": 86400, "h": 3600, "m": 60}[unit]


# ---------------------------------------------------------------------------
# Plog helpers (Padarax structured log format)
# ---------------------------------------------------------------------------

# Matches: [YYYY-MM-DD HH:MM:SS.mmm] [info] [llm] command  key=val ...
_PLOG_LLM_RE = re.compile(
    r"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\] \[info\] \[llm\] command\s+(.*)"
)
_PLOG_KV_RE = re.compile(r"(\w+)=(\S+)")

# Default model-name prefix → provider inference.
# Longer / more-specific prefixes must come first so they win over shorter ones.
_MODEL_PREFIX_PROVIDERS: list[tuple[str, str]] = [
    ("llama-3.3-70b-versatile", "groq"),
    ("llama-3.1-70b-versatile", "groq"),
    ("llama-3.1-8b-instant", "groq"),
    ("llama-3.1-8b", "groq"),
    ("llama-3.3-70b", "cerebras"),  # cerebras uses base name without -versatile
    ("llama-3.1-70b", "cerebras"),
    ("llama", "groq"),              # groq is the default llama host
    ("mistral", "mistral"),
    ("codestral", "mistral"),
    ("devstral", "mistral"),
    ("gemini", "google"),
    ("qwen", "cerebras"),
]


def _infer_provider(model: str, custom: dict[str, str]) -> str:
    """Infer LLM provider from model name. custom dict takes priority."""
    if model in custom:
        return custom[model]
    lower = model.lower()
    for prefix, provider in _MODEL_PREFIX_PROVIDERS:
        if lower.startswith(prefix):
            return provider
    return "unknown"


def _parse_plog_ts(ts_str: str) -> float:
    """Parse plog timestamp '[YYYY-MM-DD HH:MM:SS.mmm]' → Unix time."""
    import datetime
    try:
        dt = datetime.datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
        return dt.timestamp()
    except ValueError:
        return 0.0


def _read_plog_records(
    fp: Path,
    cutoff: float,
    model_providers: dict[str, str],
) -> list[dict[str, Any]]:
    """Read `[llm] command` lines from a plog file, returning normalised dicts."""
    records: list[dict[str, Any]] = []
    try:
        with fp.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                m = _PLOG_LLM_RE.match(line)
                if not m:
                    continue
                ts = _parse_plog_ts(m.group(1))
                if ts < cutoff:
                    continue
                kv = dict(_PLOG_KV_RE.findall(m.group(2)))
                model = kv.get("model", "unknown")
                records.append({
                    "ts": ts,
                    "model": model,
                    "provider": _infer_provider(model, model_providers),
                    "latency_ms": float(kv["latency_ms"]) if "latency_ms" in kv else None,
                    "slot": kv.get("slot", ""),
                    # plog does not carry token counts
                    "input_tokens": 0,
                    "output_tokens": 0,
                })
    except OSError as exc:
        logger.warning("ModelUsageAdapter plog: failed to read %s: %s", fp, exc)
    return records


def _read_jsonl_records(fp: Path, cutoff: float) -> list[dict[str, Any]]:
    """Read JSONL records from a file, filtering by timestamp."""
    records: list[dict[str, Any]] = []
    try:
        with fp.open(encoding="utf-8") as f:
            for raw_line in f:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    obj = json.loads(raw_line)
                    if isinstance(obj, dict) and float(obj.get("ts", 0)) >= cutoff:
                        records.append(obj)
                except (json.JSONDecodeError, ValueError):
                    pass
    except OSError as exc:
        logger.warning("ModelUsageAdapter jsonl: failed to read %s: %s", fp, exc)
    return records


class ModelUsageAdapter(BaseAdapter):
    """Aggregates model call logs from one or more log files.

    Supports two log formats via ``parse``:

    ``jsonl`` (default)  — newline-delimited JSON, one object per call:
        {"ts": 1745301234.5, "model": "llama-3.3-70b-versatile",
         "provider": "groq", "input_tokens": 350, "output_tokens": 150}

    ``plog_llm``  — Padarax structured-log format:
        [2026-01-01 12:00:00.000] [info] [llm] command  model=mistral-small-2603
        latency_ms=1200 slot=dialogue
        Provider is inferred from model-name prefixes (configurable via
        ``model_providers`` in extra).

    Config options via ``extra``:
        inputs          list   [{path: str, label: str}, ...]  — files to aggregate
        window          str    Time window, e.g. "7d", "24h" (default: "7d")
        model_providers dict   {model_name: provider} overrides for inference
        static_quotas   dict   {provider: {daily_tokens: N, monthly_tokens: N}}
        quota_endpoints dict   {provider: {endpoint: url, headers: {k: v}}}

    Returns one row per model (sorted by call count) plus a leading
    ``_summary`` row with aggregate totals.
    """

    async def fetch(self, config: DataSourceConfig, project_root: Path) -> list[dict[str, Any]]:
        from collections import defaultdict

        parse_mode: str = config.parse or "jsonl"
        inputs: list[dict[str, Any]] = list(config.extra.get("inputs", []))
        if config.path:
            inputs.insert(0, {"path": config.path, "label": config.extra.get("label", "default")})

        window_str: str = config.extra.get("window", "7d")
        cutoff = time.time() - _parse_window_seconds(window_str)
        model_providers: dict[str, str] = config.extra.get("model_providers", {})
        static_quotas: dict[str, dict[str, Any]] = config.extra.get("static_quotas", {})
        quota_endpoints: dict[str, dict[str, Any]] = config.extra.get("quota_endpoints", {})

        # model_key → aggregated stats
        model_data: dict[str, dict[str, Any]] = defaultdict(lambda: {
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "latency_ms_total": 0.0,
            "latency_count": 0,
            "projects": defaultdict(int),
        })
        total_calls = 0

        for inp in inputs:
            path_str = inp.get("path")
            if not path_str:
                continue
            label: str = inp.get("label") or str(path_str)
            inp_parse: str = inp.get("parse") or parse_mode  # per-input override

            file_path = Path(path_str)
            if not file_path.is_absolute():
                file_path = project_root / file_path
            if not file_path.is_file():
                logger.warning("ModelUsageAdapter: file not found: %s", file_path)
                continue

            if inp_parse == "plog_llm":
                records = await asyncio.to_thread(
                    _read_plog_records, file_path, cutoff, model_providers
                )
            else:
                records = await asyncio.to_thread(_read_jsonl_records, file_path, cutoff)

            for rec in records:
                model = str(rec.get("model", "unknown"))
                provider = str(rec.get("provider", "unknown"))
                key = f"{provider}/{model}"
                entry = model_data[key]
                entry["model"] = model
                entry["provider"] = provider
                entry["calls"] += 1
                entry["input_tokens"] += int(rec.get("input_tokens", 0))
                entry["output_tokens"] += int(rec.get("output_tokens", 0))
                if rec.get("latency_ms") is not None:
                    entry["latency_ms_total"] += float(rec["latency_ms"])
                    entry["latency_count"] += 1
                entry["projects"][label] += 1
                total_calls += 1

        if total_calls == 0:
            return [{"id": "_summary", "total_calls": 0, "window": window_str, "model_count": 0}]

        # Optional: fetch live quota data from provider REST endpoints
        quota_api_data: dict[str, dict[str, Any]] = {}
        for provider, qcfg in quota_endpoints.items():
            endpoint = qcfg.get("endpoint")
            if not endpoint:
                continue
            headers = {k: os.path.expandvars(str(v)) for k, v in qcfg.get("headers", {}).items()}
            try:
                import httpx
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(endpoint, headers=headers)
                    resp.raise_for_status()
                    quota_api_data[provider] = resp.json()
            except Exception as exc:
                logger.warning("ModelUsageAdapter: quota endpoint error for %s: %s", provider, exc)

        # Build per-model result rows
        results: list[dict[str, Any]] = []
        for key, entry in sorted(model_data.items(), key=lambda x: -x[1]["calls"]):
            calls = entry["calls"]
            calls_pct = round(calls / total_calls * 100, 1) if total_calls else 0
            total_tokens = entry["input_tokens"] + entry["output_tokens"]
            avg_latency = (
                round(entry["latency_ms_total"] / entry["latency_count"])
                if entry["latency_count"]
                else None
            )
            provider = entry["provider"]

            row: dict[str, Any] = {
                "id": key,
                "model": entry["model"],
                "provider": provider,
                "calls": calls,
                "calls_pct": calls_pct,
                "input_tokens": entry["input_tokens"],
                "output_tokens": entry["output_tokens"],
                "total_tokens": total_tokens,
                "avg_latency_ms": avg_latency,
                "projects": [
                    {"label": lbl, "calls": cnt}
                    for lbl, cnt in sorted(entry["projects"].items(), key=lambda x: -x[1])
                ],
            }

            # Attach quota — prefer live API data, fall back to static config
            sq = static_quotas.get(provider, {})
            live_quota = quota_api_data.get(provider)

            if live_quota:
                row["quota_used"] = live_quota.get("used")
                row["quota_limit"] = live_quota.get("limit")
                row["quota_unit"] = live_quota.get("unit", "tokens")
                row["quota_reset"] = live_quota.get("reset")
                if row["quota_limit"]:
                    row["quota_pct"] = round(row["quota_used"] / row["quota_limit"] * 100, 1)
            elif sq:
                for quota_key in ("daily_tokens", "monthly_tokens", "weekly_tokens"):
                    if quota_key in sq:
                        limit = int(sq[quota_key])
                        row["quota_limit"] = limit
                        row["quota_unit"] = quota_key.replace("_", " ")
                        row["quota_used"] = total_tokens
                        row["quota_pct"] = min(100.0, round(total_tokens / limit * 100, 1)) if limit else 0
                        break

            results.append(row)

        results.insert(0, {
            "id": "_summary",
            "total_calls": total_calls,
            "window": window_str,
            "model_count": len(model_data),
        })
        return results


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_ADAPTERS: dict[str, BaseAdapter] = {
    "rest": RestAdapter(),
    "json_file": JsonFileAdapter(),
    "json_directory": JsonDirectoryAdapter(),
    "directory": DirectoryAdapter(),
    "markdown": MarkdownAdapter(),
    "model_usage": ModelUsageAdapter(),
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
