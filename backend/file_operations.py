"""File write and create operations with path validation."""

from __future__ import annotations

import tempfile
from pathlib import Path

from backend.errors import FileError


def validate_path(root: Path, relative_path: str) -> Path:
    """Validate that a relative path is within the project root.

    Args:
        root: Project root directory
        relative_path: Path relative to root

    Returns:
        Resolved absolute path

    Raises:
        FileError: If path is invalid or outside project root
    """
    if not relative_path or relative_path.strip() == "":
        raise FileError.invalid_path(relative_path, "Path cannot be empty")

    # Check for path traversal attempts
    if ".." in Path(relative_path).parts:
        raise FileError.invalid_path(relative_path, "Path traversal not allowed")

    try:
        file_path = (root / relative_path).resolve()
        root_resolved = root.resolve()

        if not str(file_path).startswith(str(root_resolved)):
            raise FileError.invalid_path(relative_path, "Path outside project root")

        return file_path
    except Exception as e:
        raise FileError.invalid_path(relative_path, str(e)) from e


def write_file_content(root: Path, relative_path: str, content: str) -> None:
    """Write content to an existing file with atomic write operation.

    Uses atomic write pattern: write to temp file, then rename.
    This prevents corruption if the process crashes during write.

    Args:
        root: Project root directory
        relative_path: Path relative to root
        content: File content to write

    Raises:
        FileError: If file doesn't exist, path is invalid, or write fails
    """
    file_path = validate_path(root, relative_path)

    if not file_path.exists():
        raise FileError.not_found(relative_path)

    if not file_path.is_file():
        raise FileError.write_failed(relative_path, "Not a regular file")

    try:
        # Atomic write: write to temp file in same directory, then rename
        temp_fd, temp_path = tempfile.mkstemp(
            dir=file_path.parent,
            prefix=f".{file_path.name}.",
            suffix=".tmp"
        )

        try:
            # Write content to temp file
            with open(temp_fd, "w", encoding="utf-8") as f:
                f.write(content)

            # Atomic rename
            Path(temp_path).replace(file_path)
        except Exception:
            # Clean up temp file on failure
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
            raise

    except PermissionError as e:
        raise FileError.write_failed(relative_path, "Permission denied") from e
    except OSError as e:
        raise FileError.write_failed(relative_path, str(e)) from e
    except Exception as e:
        raise FileError.write_failed(relative_path, str(e)) from e


def create_file(root: Path, relative_path: str, content: str = "") -> None:
    """Create a new file with optional content.

    Creates parent directories if they don't exist.
    Uses atomic write pattern for safety.

    Args:
        root: Project root directory
        relative_path: Path relative to root
        content: Initial file content (default: empty string)

    Raises:
        FileError: If file exists, path is invalid, or creation fails
    """
    file_path = validate_path(root, relative_path)

    if file_path.exists():
        raise FileError.file_exists(relative_path)

    try:
        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Atomic write: write to temp file in same directory, then rename
        temp_fd, temp_path = tempfile.mkstemp(
            dir=file_path.parent,
            prefix=f".{file_path.name}.",
            suffix=".tmp"
        )

        try:
            # Write content to temp file
            with open(temp_fd, "w", encoding="utf-8") as f:
                f.write(content)

            # Atomic rename
            Path(temp_path).replace(file_path)
        except Exception:
            # Clean up temp file on failure
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
            raise

    except PermissionError as e:
        raise FileError.create_failed(relative_path, "Permission denied") from e
    except OSError as e:
        raise FileError.create_failed(relative_path, str(e)) from e
    except Exception as e:
        raise FileError.create_failed(relative_path, str(e)) from e
