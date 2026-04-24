"""Modular prompt composition for CADE providers."""

from backend.prompts.compose import BUNDLED_SKILLS_DIR, compose_prompt, get_rules
from backend.prompts.slash_commands import build_slash_commands

__all__ = ["compose_prompt", "get_rules", "BUNDLED_SKILLS_DIR", "build_slash_commands"]
