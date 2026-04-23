"""Assemble a system prompt from modular markdown files.

Always includes:  dashboard
Mode-specific:    code | architect | review | orchestrator

Add a new .md file to modules/ and wire it in ALWAYS or MODE_MODULES.
"""

from __future__ import annotations

from pathlib import Path

MODULES_DIR = Path(__file__).parent / "modules"

ALWAYS = ["dashboard", "nkrdn", "neovim"]

MODE_MODULES: dict[str, list[str]] = {
    "code": ["code"],
    "architect": ["architect"],
    "review": ["review"],
    "orchestrator": ["orchestrator"],
}


def compose_prompt(mode: str) -> str:
    """Return the assembled system prompt for the given mode."""
    names = ALWAYS + MODE_MODULES.get(mode, [])
    parts = []
    for name in names:
        path = MODULES_DIR / f"{name}.md"
        if path.exists():
            parts.append(path.read_text().strip())
    return "\n\n---\n\n".join(parts)
