"""File tree building and file content reading."""

from __future__ import annotations

from pathlib import Path

from backend.errors import FileError
from backend.types import FileNode

# Directories to always ignore
IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".cade",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    ".venv",
    "venv",
    ".env",
    "env",
    ".tox",
    ".eggs",
    "*.egg-info",
}

# File patterns to ignore
IGNORED_FILES = {
    ".DS_Store",
    "Thumbs.db",
    "*.pyc",
    "*.pyo",
    "*.so",
    "*.dll",
    "*.exe",
}


def _should_ignore(path: Path) -> bool:
    """Check if a path should be ignored."""
    name = path.name

    if path.is_dir():
        return name in IGNORED_DIRS

    if name in IGNORED_FILES:
        return True

    for pattern in IGNORED_FILES:
        if pattern.startswith("*") and name.endswith(pattern[1:]):
            return True

    return False


def _load_gitignore(root: Path) -> set[str]:
    """Load .gitignore patterns from the root directory."""
    gitignore_path = root / ".gitignore"
    patterns: set[str] = set()

    if gitignore_path.exists():
        try:
            with open(gitignore_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        patterns.add(line)
        except Exception:
            pass

    return patterns


def _matches_gitignore(path: Path, root: Path, patterns: set[str]) -> bool:
    """Check if a path matches any gitignore pattern."""
    try:
        rel_path = path.relative_to(root)
    except ValueError:
        return False

    rel_str = str(rel_path).replace("\\", "/")
    name = path.name

    for pattern in patterns:
        pattern = pattern.rstrip("/")

        if pattern == name:
            return True
        if pattern == rel_str:
            return True
        if pattern.endswith("/" + name):
            return True
        if "/" not in pattern and name == pattern:
            return True

    return False


def build_file_tree(
    root: Path,
    *,
    max_depth: int = 10,
    respect_gitignore: bool = True,
) -> list[FileNode]:
    """Build a file tree from the given root directory.

    Args:
        root: Root directory to scan
        max_depth: Maximum depth to recurse
        respect_gitignore: Whether to respect .gitignore patterns

    Returns:
        List of FileNode objects representing the tree
    """
    gitignore_patterns = _load_gitignore(root) if respect_gitignore else set()

    def _build_node(path: Path, depth: int) -> FileNode | None:
        if depth > max_depth:
            return None

        if _should_ignore(path):
            return None

        if respect_gitignore and _matches_gitignore(path, root, gitignore_patterns):
            return None

        try:
            rel_path = str(path.relative_to(root)).replace("\\", "/")
        except ValueError:
            rel_path = path.name

        if path.is_dir():
            children: list[FileNode] = []
            try:
                for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                    child_node = _build_node(child, depth + 1)
                    if child_node is not None:
                        children.append(child_node)
            except PermissionError:
                pass

            return FileNode(
                name=path.name,
                path=rel_path,
                type="directory",
                children=children if children else None,
            )
        else:
            try:
                modified = path.stat().st_mtime
            except Exception:
                modified = None

            return FileNode(
                name=path.name,
                path=rel_path,
                type="file",
                modified=modified,
            )

    nodes: list[FileNode] = []
    try:
        for child in sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            node = _build_node(child, 0)
            if node is not None:
                nodes.append(node)
    except PermissionError:
        pass

    return nodes


def read_file_content(root: Path, relative_path: str) -> str:
    """Read file content from a relative path.

    Args:
        root: Root directory
        relative_path: Path relative to root

    Returns:
        File content as string

    Raises:
        FileError: If file not found or cannot be read
    """
    file_path = root / relative_path

    if not file_path.exists():
        raise FileError.not_found(relative_path)

    if not file_path.is_file():
        raise FileError.not_found(relative_path)

    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(root.resolve())):
            raise FileError.not_found(relative_path)
    except Exception:
        raise FileError.not_found(relative_path)

    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return file_path.read_text(encoding="latin-1")
        except Exception as e:
            raise FileError.read_failed(relative_path, str(e)) from e
    except Exception as e:
        raise FileError.read_failed(relative_path, str(e)) from e


def get_file_type(path: str) -> str:
    """Determine the file type from extension for syntax highlighting."""
    ext = Path(path).suffix.lower()

    type_map = {
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".jsx": "jsx",
        ".json": "json",
        ".html": "html",
        ".css": "css",
        ".scss": "scss",
        ".md": "markdown",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".toml": "toml",
        ".sh": "bash",
        ".bash": "bash",
        ".zsh": "zsh",
        ".rs": "rust",
        ".go": "go",
        ".java": "java",
        ".c": "c",
        ".cpp": "cpp",
        ".h": "c",
        ".hpp": "cpp",
        ".rb": "ruby",
        ".php": "php",
        ".sql": "sql",
        ".xml": "xml",
        ".txt": "plaintext",
    }

    return type_map.get(ext, "plaintext")
