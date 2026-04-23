"""Orchestrator system prompt — assembled from modular prompt files."""

from backend.prompts import compose_prompt

ORCHESTRATOR_ARCHITECT_PROMPT = compose_prompt("orchestrator")
