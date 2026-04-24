"""Slash-command discovery for the chat UI.

Assembles the list shown in the `/` completion dropdown:
  1. CADE native commands (mode switches, cost, context, compact)
  2. Bundled skills from backend/prompts/bundled/skills/
  3. User skills from ~/.claude/skills/

Bundled skills load first; user skills with the same name are ignored so a
user can't accidentally shadow a CADE core skill like `handoff`.
"""

from __future__ import annotations

import re
from pathlib import Path

from backend.prompts.compose import BUNDLED_SKILLS_DIR

USER_SKILLS_DIR = Path.home() / ".claude" / "skills"

NATIVE_COMMANDS: list[dict[str, str]] = [
    {"name": "plan", "description": "Switch to Architect mode (read-only)"},
    {"name": "code", "description": "Switch to Code mode (full access)"},
    {"name": "review", "description": "Switch to Review mode (read-only)"},
    {"name": "orchestrator", "description": "Switch to Orchestrator mode"},
    {"name": "compact", "description": "Summarise session as handoff and start fresh"},
]

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)


def _parse_skill_frontmatter(text: str) -> tuple[str | None, str | None]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return None, None
    name_val: str | None = None
    desc_val: str | None = None
    for line in match.group(1).split("\n"):
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()
        if key == "name":
            name_val = val
        elif key == "description":
            desc_val = val
    return name_val, desc_val


def _collect_skills(skills_dir: Path, seen: set[str]) -> list[dict[str, str]]:
    if not skills_dir.exists():
        return []
    out: list[dict[str, str]] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            text = skill_md.read_text()
        except OSError:
            continue
        name, desc = _parse_skill_frontmatter(text)
        if not name or not desc or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "description": desc})
    return out


def build_slash_commands() -> list[dict[str, str]]:
    """Return the full command list for the chat `/` dropdown.

    Native commands first, then bundled skills, then user skills.
    """
    commands: list[dict[str, str]] = list(NATIVE_COMMANDS)
    seen: set[str] = set()
    commands.extend(_collect_skills(BUNDLED_SKILLS_DIR, seen))
    commands.extend(_collect_skills(USER_SKILLS_DIR, seen))
    return commands
