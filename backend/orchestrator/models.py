"""Orchestrator agent types."""

import asyncio
from dataclasses import dataclass, field
from enum import Enum


class AgentState(str, Enum):
    PENDING = "pending"
    STARTING = "starting"
    BUSY = "busy"
    DONE = "done"
    REVIEW = "review"
    CLOSED = "closed"
    ERROR = "error"


@dataclass
class AgentSpec:
    name: str
    task: str
    mode: str = "code"


@dataclass
class AgentRecord:
    agent_id: str
    name: str
    task: str
    mode: str
    state: AgentState
    owner_connection_id: str = ""
    session_id: str | None = None
    report: str = ""
    error: str = ""
    cost: float = 0.0
    usage: dict = field(default_factory=dict)
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)
    final_result: str = ""
    spawn_approved: bool = False
    report_approved: bool = False
