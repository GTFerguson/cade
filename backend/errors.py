"""Custom exceptions for CADE backend."""

from __future__ import annotations

from backend.protocol import ErrorCode, MessageType


class CADEError(Exception):
    """Base exception for CADE errors with structured error response."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")

    def to_message(self) -> dict:
        """Convert to WebSocket error message format."""
        return {
            "type": MessageType.ERROR,
            "code": self.code,
            "message": self.message,
        }


class PTYError(CADEError):
    """PTY-related errors."""

    @classmethod
    def spawn_failed(cls, command: str, reason: str) -> PTYError:
        return cls(
            ErrorCode.PTY_SPAWN_FAILED,
            f"Failed to spawn '{command}': {reason}",
        )

    @classmethod
    def read_failed(cls, reason: str) -> PTYError:
        return cls(ErrorCode.PTY_READ_FAILED, f"Failed to read from PTY: {reason}")

    @classmethod
    def write_failed(cls, reason: str) -> PTYError:
        return cls(ErrorCode.PTY_WRITE_FAILED, f"Failed to write to PTY: {reason}")


class FileError(CADEError):
    """File system related errors."""

    @classmethod
    def not_found(cls, path: str) -> FileError:
        return cls(ErrorCode.FILE_NOT_FOUND, f"File not found: {path}")

    @classmethod
    def read_failed(cls, path: str, reason: str) -> FileError:
        return cls(ErrorCode.FILE_READ_FAILED, f"Failed to read '{path}': {reason}")


class ProtocolError(CADEError):
    """Protocol-related errors."""

    @classmethod
    def invalid_message(cls, reason: str) -> ProtocolError:
        return cls(ErrorCode.INVALID_MESSAGE, f"Invalid message: {reason}")
