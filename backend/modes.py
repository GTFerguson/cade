"""Mode registry — loads mode definitions from modes.toml."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib  # type: ignore[no-redef]

_MODES_FILE = Path(__file__).parent / "modes.toml"


@dataclass
class ModeConfig:
    name: str
    label: str
    description: str
    color: str
    modules: list[str]
    additional_modules: list[str]
    write_access: str  # "all" | "docs_plans" | "none"
    slash_names: list[str] = field(default_factory=list)


def _load() -> dict[str, ModeConfig]:
    data = tomllib.loads(_MODES_FILE.read_text())
    result: dict[str, ModeConfig] = {}
    for name, cfg in data["modes"].items():
        result[name] = ModeConfig(
            name=name,
            label=cfg.get("label", name.upper()),
            description=cfg.get("description", ""),
            color=cfg.get("color", ""),
            modules=cfg.get("modules", []),
            additional_modules=cfg.get("additional_modules", []),
            write_access=cfg.get("write_access", "none"),
            slash_names=cfg.get("slash_names", [name]),
        )
    return result


MODES: dict[str, ModeConfig] = _load()

# Slash command → mode name mapping (e.g. "/orch" → "orchestrator")
MODE_SLASH_MAP: dict[str, str] = {
    f"/{slash}": cfg.name
    for cfg in MODES.values()
    for slash in cfg.slash_names
}
