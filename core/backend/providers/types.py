"""Chat event and message types for the provider abstraction."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChatMessage:
    """A single message in a conversation."""

    role: str  # "user", "assistant", "system"
    content: str


@dataclass
class ProviderCapabilities:
    """What a provider supports."""

    streaming: bool = True
    tool_use: bool = False
    vision: bool = False


@dataclass
class ToolDefinition:
    """Describes a callable tool for an LLM provider."""

    name: str
    description: str
    parameters_schema: dict  # JSON Schema object {"type": "object", "properties": {...}}


# --- Streaming events ---

@dataclass
class ChatEvent:
    """Base class for chat streaming events."""

    pass


@dataclass
class TextDelta(ChatEvent):
    """Incremental text chunk from the model."""

    content: str


@dataclass
class ChatDone(ChatEvent):
    """Stream completed successfully."""

    usage: dict = field(default_factory=dict)
    cost: float = 0


@dataclass
class ChatError(ChatEvent):
    """Stream encountered an error."""

    message: str
    code: str = ""


@dataclass
class ToolUseStart(ChatEvent):
    """A tool invocation has started."""

    tool_id: str
    tool_name: str
    tool_input: dict = field(default_factory=dict)


@dataclass
class ToolResult(ChatEvent):
    """A tool invocation has completed."""

    tool_id: str
    tool_name: str
    status: str  # "success" | "error"
    content: str = ""


@dataclass
class ThinkingDelta(ChatEvent):
    """Incremental thinking/reasoning text from the model."""

    content: str


@dataclass
class SystemInfo(ChatEvent):
    """System initialization info from Claude Code."""

    model: str
    session_id: str
    tools: list[str]
    slash_commands: list[str]
    version: str
