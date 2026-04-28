"""Assemble a system prompt from modular markdown files.

Prompt structure (in order):
  BASE         — CADE identity, output channels, dashboard overview
  RULES        — bundled rules from backend/prompts/bundled/rules/
  ALWAYS       — dashboard, neovim (always loaded for all modes)
  MODE_MODULES — mode-specific module (code | plan | research | review | orchestrator)
  ADDITIONAL   — per-mode additional modules
  PROJECT      — CLAUDE.md and .claude/rules/ from the working directory

Add a new .md file to modules/ and wire it in ALWAYS or MODE_MODULES or ADDITIONAL.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

MODULES_DIR = Path(__file__).parent / "modules"
BUNDLED_DIR = Path(__file__).parent / "bundled"
BUNDLED_RULES_DIR = BUNDLED_DIR / "rules"
BUNDLED_SKILLS_DIR = BUNDLED_DIR / "skills"

ALWAYS = ["dashboard", "neovim"]

from backend.modes import MODES  # noqa: E402 — after path constants

MODE_MODULES: dict[str, list[str]] = {name: cfg.modules for name, cfg in MODES.items()}
ADDITIONAL: dict[str, list[str]] = {name: cfg.additional_modules for name, cfg in MODES.items()}


def _load_file(name: str) -> str:
    path = MODULES_DIR / f"{name}.md"
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
    """Load bundled rules from backend/prompts/bundled/rules/.

    Returns (name, content, description) tuples sorted alphabetically by filename.
    """
    rules: list[tuple[str, str, str]] = []
    if BUNDLED_RULES_DIR.exists():
        for path in sorted(BUNDLED_RULES_DIR.glob("*.md")):
            content = path.read_text().strip()
            fm = _parse_frontmatter(content)
            rules.append((path.stem, content, fm.get("description", "")))
    return rules


# RULES loaded once at import time
RULES = _load_rules()


def compose_prompt(mode: str, working_dir: "Path | None" = None, orchestrator: bool = False) -> str:
    """Return the assembled system prompt for the given mode.

    Compose order: datetime → base → rules → always → mode → additional → orchestrator → project
    """
    parts = []

    # DATETIME — injected fresh each call so the agent always knows the current time
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts.append(f"Current date and time: {now}")

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

    # ORCHESTRATOR overlay (added on top of any mode when the toggle is on)
    if orchestrator:
        content = _load_file("orchestrator")
        if content:
            parts.append(content)

    # PROJECT — CLAUDE.md and .claude/rules/ from the working directory
    if working_dir is not None:
        for candidate in (
            Path(working_dir) / "CLAUDE.md",
            Path(working_dir) / ".claude" / "CLAUDE.md",
        ):
            if candidate.exists():
                text = candidate.read_text().strip()
                if text:
                    parts.append(f"# Project instructions ({candidate.name})\n\n{text}")
        rules_dir = Path(working_dir) / ".claude" / "rules"
        if rules_dir.is_dir():
            for rule_file in sorted(rules_dir.glob("*.md")):
                text = rule_file.read_text().strip()
                if text:
                    parts.append(text)

    return "\n\n---\n\n".join(parts)


def get_rules() -> list[tuple[str, str, str]]:
    """Return loaded rules as (name, content, description) tuples.

    Used by the backend to populate slashCommands hints.
    """
    return RULES
