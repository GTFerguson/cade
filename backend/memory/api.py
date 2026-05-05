"""Memory graph API — assembles NkrdnGraphMessage from nkrdn CLI + SQLite.

Uses three data sources, all available in the cade backend environment:
  - `nkrdn memory list --json`  (subprocess, same as memory_search)
  - `.cade/staging/knowledge_base.db` via stdlib sqlite3 (symbol data)
  - source markdown YAML frontmatter via PyYAML (date, supersedes)
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import yaml
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_graph_message(project_dir: Path) -> dict:
    """Return a NkrdnGraphMessage dict for the given project directory."""
    import shutil
    nkrdn_bin = shutil.which("nkrdn")
    if nkrdn_bin is None:
        return _empty_message()

    graph_file = project_dir / ".cade" / "graph.ttl"
    if not graph_file.exists():
        return _empty_message()

    # --- Memory entries via CLI ---
    try:
        result = subprocess.run(
            [nkrdn_bin, "memory", "list", "--json"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=15,
        )
        raw_entries: list[dict] = json.loads(result.stdout) if result.returncode == 0 else []
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        raw_entries = []

    if not raw_entries:
        return _empty_message()

    # --- Symbol data via SQLite ---
    db_path = project_dir / ".cade" / "staging" / "knowledge_base.db"
    sym_rows = _load_symbols(db_path) if db_path.exists() else {}

    # --- Enrich entries with frontmatter fields ---
    entries = [_enrich_entry(e) for e in raw_entries]

    # Build superseded_by map: uri → uri_of_superseder
    superseded_by: dict[str, str] = {}
    for e in entries:
        if e.get("supersedes"):
            superseded_by[e["supersedes"]] = e["uri"]

    # --- Attach entries to symbols ---
    by_sid: dict[str, list[dict]] = {}   # stable_id → [entry]
    unattached: list[dict] = []

    for entry in entries:
        if entry.get("archived"):
            continue
        placed = False
        for uri in entry.get("applies_to") or []:
            sid = _stable_id(uri)
            if sid and sid in sym_rows:
                by_sid.setdefault(sid, []).append(entry)
                placed = True
                break
        if not placed and (entry.get("applies_to") or entry.get("unresolved_links")):
            unattached.append(entry)

    # --- Build MemorySymbol dicts ---
    live_syms: list[dict] = []
    tomb_syms: list[dict] = []

    for sid, mems in by_sid.items():
        row = sym_rows[sid]
        sym = _sym_dict(sid, row, mems, superseded_by)
        if row.get("tombstoned_at"):
            tomb_syms.append(sym)
        else:
            live_syms.append(sym)

    orphans = _build_orphans(unattached, sym_rows)
    modules = _build_module_tree(live_syms)

    total_mems = sum(len(s["memories"]) for s in live_syms)
    total_mems += sum(len(s["memories"]) for s in tomb_syms)

    return {
        "type": "nkrdn-graph",
        "modules": modules,
        "tombstoned": tomb_syms,
        "orphans": orphans,
        "stats": {
            "symbols": len(live_syms),
            "memories": total_mems,
            "orphans": len(orphans),
        },
    }


# ---------------------------------------------------------------------------
# SQLite symbol loading
# ---------------------------------------------------------------------------

def _load_symbols(db_path: Path) -> dict[str, dict]:
    """Load all symbols (with file paths) from knowledge_base.db."""
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT s.stable_id, s.fqn, s.kind, s.line_start, s.line_end,
                   s.tombstoned_at, f.path AS file_path
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.repository_name = 'default'
              AND s.stable_id IS NOT NULL
            """
        )
        rows = {row["stable_id"]: dict(row) for row in cur.fetchall()}
        conn.close()
        return rows
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Entry enrichment (adds date + supersedes from frontmatter)
# ---------------------------------------------------------------------------

def _enrich_entry(raw: dict) -> dict:
    """Add date, supersedes from YAML frontmatter of source_file."""
    entry = dict(raw)
    source = entry.get("source_file") or ""
    if source and Path(source).exists():
        try:
            text = Path(source).read_text(encoding="utf-8")
            if text.startswith("---"):
                end = text.index("\n---", 3)
                fm = yaml.safe_load(text[3:end]) or {}
                created = fm.get("created") or fm.get("date")
                if created:
                    entry["created"] = str(created)[:10]
                sup = fm.get("supersedes")
                if sup:
                    # Store as a URI fragment matching nkrdn's mem: convention
                    entry["supersedes"] = f"http://nkrdn.knowledge/memory#{sup}"
        except Exception:
            pass

    if not entry.get("created"):
        # Fall back to date prefix in filename: YYYY-MM-DD-slug.md
        stem = Path(source).stem if source else ""
        m = re.match(r"^(\d{4}-\d{2}-\d{2})", stem)
        entry["created"] = m.group(1) if m else "unknown"

    return entry


# ---------------------------------------------------------------------------
# Symbol + entry dict builders
# ---------------------------------------------------------------------------

def _sym_dict(sid: str, row: dict, mems: list[dict], superseded_by: dict[str, str]) -> dict:
    name = (row["fqn"] or "").rsplit(".", 1)[-1]
    d: dict = {
        "uuid": sid,
        "name": name,
        "fqn": row["fqn"] or "",
        "kind": _norm_kind(row["kind"]),
        "file": row["file_path"],
        "line_start": row["line_start"],
        "line_end": row["line_end"],
        "memories": [_entry_dict(e, superseded_by) for e in mems],
        "children": [],
    }
    if row.get("tombstoned_at"):
        d["tombstoned"] = True
        d["deleted_at"] = row["tombstoned_at"]
    return d


def _entry_dict(entry: dict, superseded_by: dict[str, str]) -> dict:
    uri = entry.get("uri") or ""
    uuid = _uuid_from_uri(uri)
    d: dict = {
        "uuid": uuid,
        "type": entry.get("type") or "note",
        "title": _title(entry),
        "date": entry.get("created") or "unknown",
    }
    if entry.get("content"):
        d["body"] = entry["content"]
    if entry.get("authored_by"):
        d["authored_by"] = entry["authored_by"]
    if entry.get("tags"):
        d["tags"] = list(entry["tags"])
    if entry.get("supersedes"):
        d["supersedes"] = _uuid_from_uri(entry["supersedes"])
    if uri in superseded_by:
        d["superseded_by"] = _uuid_from_uri(superseded_by[uri])
    if entry.get("archived"):
        d["archived"] = True
    return d


# ---------------------------------------------------------------------------
# Module tree
# ---------------------------------------------------------------------------

def _build_module_tree(syms: list[dict]) -> list[dict]:
    """Group live symbols into a directory-based GraphModule hierarchy."""
    by_dir: dict[str, list[dict]] = {}
    for sym in syms:
        fp = (sym.get("file") or "").replace("\\", "/")
        parts = fp.split("/")
        dir_key = "/".join(parts[:-1]) if len(parts) > 1 else ""
        by_dir.setdefault(dir_key, []).append(sym)
    return _dir_subtree("", by_dir)


def _dir_subtree(parent: str, by_dir: dict[str, list[dict]]) -> list[dict]:
    prefix = parent + "/" if parent else ""
    direct: set[str] = set()
    for dir_key in by_dir:
        if not dir_key.startswith(prefix):
            continue
        remainder = dir_key[len(prefix):]
        if not remainder:
            continue
        direct.add(prefix + remainder.split("/")[0])

    result: list[dict] = []
    for subdir in sorted(direct):
        name = subdir.rsplit("/", 1)[-1]
        children: list = _dir_subtree(subdir, by_dir)
        for sym in sorted(by_dir.get(subdir, []), key=lambda s: s["name"]):
            children.append(sym)
        if children:
            result.append({"name": name, "path": subdir, "children": children})
    return result


# ---------------------------------------------------------------------------
# Orphan memory builder
# ---------------------------------------------------------------------------

def _build_orphans(unattached: list[dict], sym_rows: dict[str, dict]) -> list[dict]:
    name_index: dict[str, list[tuple[str, dict]]] = {}
    for sid, row in sym_rows.items():
        if row.get("tombstoned_at"):
            continue
        name = (row["fqn"] or "").rsplit(".", 1)[-1].lower()
        name_index.setdefault(name, []).append((sid, row))

    result = []
    for entry in unattached:
        unresolved = entry.get("unresolved_links") or []
        applies = entry.get("applies_to") or []
        target = (unresolved[0] if unresolved
                  else applies[0].rsplit("/", 1)[-1] if applies
                  else "")
        d = _entry_dict(entry, {})
        d["applies_to_name"] = target
        d["candidates"] = _candidates(target, name_index)
        result.append(d)
    return result


def _candidates(name: str, name_index: dict) -> list[dict]:
    lower = name.lower()
    seen: set[str] = set()
    out: list[dict] = []

    for sid, row in name_index.get(lower, []):
        out.append(_cand_dict(sid, row, 1.0))
        seen.add(sid)

    if len(out) < 3:
        for sym_name, pairs in name_index.items():
            if lower == sym_name:
                continue
            if lower in sym_name or sym_name in lower:
                for sid, row in pairs:
                    if sid not in seen:
                        overlap = len(set(lower) & set(sym_name)) / max(len(lower), len(sym_name), 1)
                        out.append(_cand_dict(sid, row, round(overlap, 2)))
                        seen.add(sid)

    out.sort(key=lambda c: -c["confidence"])
    return out[:3]


def _cand_dict(sid: str, row: dict, confidence: float) -> dict:
    return {
        "uuid": sid,
        "name": (row["fqn"] or "").rsplit(".", 1)[-1],
        "fqn": row["fqn"] or "",
        "file": row["file_path"] or "",
        "line": row["line_start"] or 0,
        "confidence": confidence,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empty_message() -> dict:
    return {
        "type": "nkrdn-graph",
        "modules": [],
        "tombstoned": [],
        "orphans": [],
        "stats": {"symbols": 0, "memories": 0, "orphans": 0},
    }


def _stable_id(uri: str) -> str:
    """Extract stable_id from a code: URI like .../class/<uuid>."""
    return uri.rsplit("/", 1)[-1]


def _uuid_from_uri(uri: str) -> str:
    """Pull the trailing identifier from a mem: URI."""
    return uri.split("#")[-1]


def _title(entry: dict) -> str:
    """Derive a human-readable title from source file path or content."""
    source = entry.get("source_file") or ""
    if source:
        stem = Path(source).stem
        stem = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
        if stem:
            return stem.replace("-", " ")
    content = entry.get("content") or ""
    if content:
        line = content.strip().split("\n")[0].strip()
        line = re.sub(r"^#+\s*", "", line)
        return line[:80] if line else f"{entry.get('type', 'note')} entry"
    return f"{entry.get('type', 'note')} entry"


def _norm_kind(kind: str) -> str:
    mapping = {"class": "class", "function": "function", "module": "module",
               "method": "function", "interface": "class", "struct": "class"}
    return mapping.get((kind or "").lower(), "function")
