"""Specter API client with fixture fallback for B2B counterparty intelligence.

Looks up company profiles via the Specter API (https://app.tryspecter.com/api/v1/).
Falls back to local fixtures in /home/gary/projects/afdex/kb/specter-fixtures/
when SPECTER_API_KEY is not set or the API call fails. Returns a stub when
neither source has data.

Results are cached in-process for the session lifetime — no redundant API calls.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)

SPECTER_BASE_URL = "https://app.tryspecter.com/api/v1"
FIXTURE_DIR = Path("/home/gary/projects/afdex/kb/specter-fixtures")

# Module-level session cache: slug → normalised profile dict
_cache: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Slug helpers
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^a-z0-9\s-]")
_WHITESPACE_RE = re.compile(r"\s+")


def _to_slug(name: str) -> str:
    """Convert a company name to a fixture-compatible slug.

    Example: "BrightOak Capital Partners Ltd" → "brightoak-capital-partners-ltd"
    """
    lowered = name.lower()
    no_punct = _PUNCT_RE.sub("", lowered)
    hyphenated = _WHITESPACE_RE.sub("-", no_punct.strip())
    return hyphenated


# ---------------------------------------------------------------------------
# Response normalisation
# ---------------------------------------------------------------------------

def _normalise(raw: dict, *, source: str) -> dict:
    """Map a raw Specter API or fixture payload to the unified return shape."""
    # Founders: try founder_info list first, fall back to founders list
    founders: list[str] = []
    founder_info = raw.get("founder_info") or []
    if founder_info:
        founders = [fi.get("full_name", "") for fi in founder_info if fi.get("full_name")]
    else:
        founders = [f for f in (raw.get("founders") or []) if isinstance(f, str)]

    # Industries: prefer tech_verticals flattened, fall back to industries list
    industries: list[str] = []
    tech_verticals = raw.get("tech_verticals") or []
    if tech_verticals:
        for group in tech_verticals:
            if isinstance(group, list):
                industries.extend(str(g) for g in group)
            elif isinstance(group, str):
                industries.append(group)
    if not industries:
        industries = [i for i in (raw.get("industries") or raw.get("industry") or []) if isinstance(i, str)]

    # Highlights: prefer new_highlights, fall back to highlights
    highlights: list[str] = raw.get("new_highlights") or raw.get("highlights") or []
    highlights = [h for h in highlights if isinstance(h, str)]

    # Domain
    website = raw.get("website") or {}
    domain = website.get("domain") if isinstance(website, dict) else None

    return {
        "name": raw.get("organization_name") or raw.get("name") or "",
        "domain": domain,
        "founded_year": raw.get("founded_year"),
        "employee_count": raw.get("employee_count"),
        "operating_status": raw.get("operating_status"),
        "founders": founders,
        "industries": industries,
        "highlights": highlights,
        "source": source,
        "found": True,
    }


# ---------------------------------------------------------------------------
# Fixture fallback
# ---------------------------------------------------------------------------

def _load_fixture(slug: str) -> dict | None:
    """Load a fixture JSON file for the given slug, or return None."""
    fixture_path = FIXTURE_DIR / f"{slug}.json"
    if not fixture_path.exists():
        return None
    try:
        raw = json.loads(fixture_path.read_text(encoding="utf-8"))
        logger.debug("Specter fixture hit: %s", fixture_path.name)
        return _normalise(raw, source="fixture")
    except Exception as exc:
        logger.warning("Failed to load Specter fixture %s: %s", fixture_path, exc)
        return None


# ---------------------------------------------------------------------------
# Live API
# ---------------------------------------------------------------------------

def _api_get(path: str, api_key: str) -> dict:
    """Make a GET request to the Specter API and return the parsed JSON body."""
    url = f"{SPECTER_BASE_URL}{path}"
    req = urllib.request.Request(
        url,
        headers={"x-api-key": api_key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_from_api(name: str, api_key: str) -> dict | None:
    """Search Specter for `name`, fetch the full profile, and normalise it.

    Returns None if not found or on any error.
    """
    try:
        query = urllib.parse.urlencode({"query": name})
        search_result = _api_get(f"/companies/search?{query}", api_key)

        # search result is expected to be a list of matches
        matches = search_result if isinstance(search_result, list) else search_result.get("results") or []
        if not matches:
            logger.debug("Specter search returned no matches for: %s", name)
            return None

        company_id = matches[0].get("id")
        if not company_id:
            return None

        profile = _api_get(f"/companies/{company_id}", api_key)
        logger.debug("Specter API hit for: %s (id=%s)", name, company_id)
        return _normalise(profile, source="specter_api")

    except urllib.error.HTTPError as exc:
        logger.warning("Specter API HTTP error for '%s': %s %s", name, exc.code, exc.reason)
        return None
    except Exception as exc:
        logger.warning("Specter API call failed for '%s': %s", name, exc)
        return None


# ---------------------------------------------------------------------------
# Public lookup function
# ---------------------------------------------------------------------------

def specter_lookup_company(name: str) -> dict:
    """Look up a company by name via Specter, fixtures, or stub.

    Resolution order:
    1. In-process session cache
    2. Live Specter API (if SPECTER_API_KEY is set)
    3. Local fixture file at FIXTURE_DIR/<slug>.json
    4. Minimal stub with found=False

    Returns a unified dict with keys: name, domain, founded_year,
    employee_count, operating_status, founders, industries, highlights,
    source, found.
    """
    slug = _to_slug(name)

    if slug in _cache:
        return _cache[slug]

    result: dict | None = None

    api_key = os.environ.get("SPECTER_API_KEY", "").strip()
    if api_key:
        result = _fetch_from_api(name, api_key)

    if result is None:
        result = _load_fixture(slug)

    if result is None:
        logger.debug("Specter: no data for '%s' (slug=%s) — returning stub", name, slug)
        result = {
            "name": name,
            "domain": None,
            "founded_year": None,
            "employee_count": None,
            "operating_status": None,
            "founders": [],
            "industries": [],
            "highlights": [],
            "source": "stub",
            "found": False,
        }

    _cache[slug] = result
    return result


# ---------------------------------------------------------------------------
# LLM tool schema
# ---------------------------------------------------------------------------

specter_lookup_company_tool_schema: dict[str, Any] = {
    "name": "specter_lookup_company",
    "description": (
        "Look up a company or counterparty by name using Specter's B2B intelligence "
        "database. Returns founding year, operating status, employee count, industry "
        "classification, founders, and traction highlights. Use this before triaging "
        "any transaction to enrich the counterparty profile."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": (
                    "The company or counterparty name to look up, as it appears in "
                    "the transaction record. E.g. 'BrightOak Capital Partners Ltd'."
                ),
            },
        },
        "required": ["name"],
    },
}


# ---------------------------------------------------------------------------
# ToolExecutor wrapper (for ToolRegistry integration)
# ---------------------------------------------------------------------------

_SPECTER_TOOL_DEFINITION = ToolDefinition(
    name="specter_lookup_company",
    description=specter_lookup_company_tool_schema["description"],
    parameters_schema=specter_lookup_company_tool_schema["input_schema"],
)


class SpecterToolExecutor:
    """Wraps specter_lookup_company as a ToolRegistry-compatible executor."""

    def tool_definitions(self) -> list[ToolDefinition]:
        return [_SPECTER_TOOL_DEFINITION]

    def execute(self, name: str, arguments: dict) -> str:
        if name != "specter_lookup_company":
            return f"Error: unknown tool '{name}'"
        company_name = arguments.get("name", "").strip()
        if not company_name:
            return "Error: 'name' is required"
        try:
            result = specter_lookup_company(company_name)
            return json.dumps(result, ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001
            logger.exception("specter_lookup_company failed for '%s': %s", company_name, exc)
            return f"Error: specter lookup failed: {exc}"

    async def execute_async(self, name: str, arguments: dict) -> str:
        return self.execute(name, arguments)
