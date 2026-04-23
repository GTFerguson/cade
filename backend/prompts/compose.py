"""Assemble a system prompt from modular markdown files.

Prompt structure (in order):
  BASE         — CADE identity, output channels, dashboard overview
  RULES        — always-on guidance (bundled + ~/.claude/rules/)
  ALWAYS       — dashboard, neovim (always loaded for all modes)
  MODE_MODULES — mode-specific module (code | architect | review | orchestrator)
  ADDITIONAL   — per-mode additional modules

RULES are loaded from two sources:
  1. Bundled defaults in backend/prompts/bundled/rules/
  2. User additions in ~/.claude/rules/

Bundled rules load first; user rules with different names extend the list.
User rules with the same name as a bundled rule are ignored (bundled wins).

Add a new .md file to modules/ and wire it in ALWAYS or MODE_MODULES or ADDITIONAL.
"""

from __future__ import annotations

import re
from pathlib import Path

MODULES_DIR = Path(__file__).parent / "modules"
BUNDLED_DIR = Path(__file__).parent / "bundled"
BUNDLED_RULES_DIR = BUNDLED_DIR / "rules"
BUNDLED_SKILLS_DIR = BUNDLED_DIR / "skills"
RULES_DIR = Path.home() / ".claude" / "rules"

ALWAYS = ["dashboard", "neovim"]

MODE_MODULES: dict[str, list[str]] = {
    "code": ["code"],
    "architect": ["architect"],
    "review": ["review"],
    "orchestrator": ["orchestrator"],
}

ADDITIONAL: dict[str, list[str]] = {
    "code": ["nkrdn"],
    "architect": ["nkrdn"],
    "review": ["nkrdn"],
    "orchestrator": ["nkrdn"],
}


def _load_file(name: str) -> str:
    path = MODULES_DIR / f"{name}.md"
    if path.exists():
        return path.read_text().strip()
    return ""


def _load_rule(name: str) -> str:
    path = RULES_DIR / f"{name}.md"
    if path.exists():
        return path.read_text().strip()
    return ""


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Parse YAML frontmatter from a markdown file."""
    match = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not match:
        return {}
    result = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, val = line.split(":", 1)
            result[key.strip()] = val.strip()
    return result


def _load_rules() -> list[tuple[str, str, str]]:
    """Load all rules from bundled + user directories.

    Returns (name, content, description) tuples sorted alphabetically.
    Bundled rules load first; user rules with the same name are ignored.

    Rules are sorted alphabetically by filename stem. Files without a
    description in frontmatter are included but with empty description.
    """
    # Load bundled rules first
    bundled_names: set[str] = set()
    bundled_rules: list[tuple[str, str, str]] = []

    if BUNDLED_RULES_DIR.exists():
        for path in sorted(BUNDLED_RULES_DIR.glob("*.md")):
            content = path.read_text().strip()
            fm = _parse_frontmatter(content)
            bundled_rules.append((path.stem, content, fm.get("description", "")))
            bundled_names.add(path.stem)

    # Load user rules, skipping any that override bundled rules
    user_rules: list[tuple[str, str, str]] = []
    if RULES_DIR.exists():
        for path in sorted(RULES_DIR.glob("*.md")):
            if path.stem in bundled_names:
                continue  # Bundled rule takes precedence
            content = path.read_text().strip()
            fm = _parse_frontmatter(content)
            user_rules.append((path.stem, content, fm.get("description", "")))

    return bundled_rules + user_rules


# RULES loaded once at import time
RULES = _load_rules()


def compose_prompt(mode: str) -> str:
    """Return the assembled system prompt for the given mode.

    Compose order: base → rules → always → mode → additional
    """
    parts = []

    # BASE
    base = _load_file("base")
    if base:
        parts.append(base)

    # RULES (bundled + ~/.claude/rules/)
    for _name, content, _desc in RULES:
        if content:
            parts.append(content)

    # ALWAYS
    for name in ALWAYS:
        content = _load_file(name)
        if content:
            parts.append(content)

    # MODE
    for name in MODE_MODULES.get(mode, []):
        content = _load_file(name)
        if content:
            parts.append(content)

    # ADDITIONAL
    for name in ADDITIONAL.get(mode, []):
        content = _load_file(name)
        if content:
            parts.append(content)

    return "\n\n---\n\n".join(parts)


def get_rules() -> list[tuple[str, str, str]]:
    """Return loaded rules as (name, content, description) tuples.

    Used by the backend to populate slashCommands hints.
    """
    return RULES
