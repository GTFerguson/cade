"""File tree building and file content reading."""

from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock

from backend.errors import FileError
from backend.types import FileNode

logger = logging.getLogger(__name__)

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
    respect_gitignore: bool = False,
) -> list[FileNode]:
    """Build a file tree from the given root directory.

    Args:
        root: Root directory to scan
        max_depth: Maximum depth to recurse
        respect_gitignore: Whether to respect .gitignore patterns (default: False, show all files)

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


class FileTreeCache:
    """Cache for file tree structures with invalidation support."""

    def __init__(self) -> None:
        self._cache: dict[tuple[Path, bool], list[FileNode]] = {}
        self._lock = Lock()

    def get(
        self,
        root: Path,
        max_depth: int = 10,
        respect_gitignore: bool = False,
    ) -> list[FileNode]:
        """Get cached tree or build if not cached."""
        cache_key = (root.resolve(), respect_gitignore)

        with self._lock:
            if cache_key in self._cache:
                logger.debug(f"File tree cache hit: {root}")
                return self._cache[cache_key]

        # Build tree outside lock
        logger.debug(f"File tree cache miss: {root}")
        tree = build_file_tree(root, max_depth=max_depth, respect_gitignore=respect_gitignore)

        # Cache result
        with self._lock:
            self._cache[cache_key] = tree

        return tree

    def invalidate(self, changed_path: Path) -> None:
        """
        Invalidate cache entries affected by a file system change.

        Strategy:
        - If change is to a directory, invalidate that directory and all parents
        - If change is to a file, invalidate parent directory and all its parents
        - This ensures tree structure stays consistent
        """
        with self._lock:
            paths_to_invalidate: set[Path] = set()

            # Resolve the changed path
            try:
                changed_path = changed_path.resolve()
            except (OSError, RuntimeError):
                # Path may not exist anymore (deleted), invalidate all
                logger.warning(
                    f"Cannot resolve changed path {changed_path}, clearing entire cache"
                )
                self._cache.clear()
                return

            # Determine invalidation root
            if changed_path.is_dir():
                invalidation_root = changed_path
            else:
                # For files, invalidate parent directory
                invalidation_root = changed_path.parent

            # Find all cached roots that are ancestors of or descendants of the change
            for cache_key in list(self._cache.keys()):
                cached_root, _ = cache_key
                try:
                    # Is cached_root an ancestor of the change?
                    changed_path.relative_to(cached_root)
                    paths_to_invalidate.add(cache_key)
                except ValueError:
                    pass

                try:
                    # Is cached_root a descendant of the change?
                    cached_root.relative_to(invalidation_root)
                    paths_to_invalidate.add(cache_key)
                except ValueError:
                    pass

            # Invalidate collected paths
            for cache_key in paths_to_invalidate:
                del self._cache[cache_key]
                logger.debug(f"Invalidated file tree cache: {cache_key[0]}")

    def clear(self) -> None:
        """Clear entire cache."""
        with self._lock:
            self._cache.clear()
            logger.debug("Cleared file tree cache")


# Global cache instance
_file_tree_cache: FileTreeCache | None = None


def get_file_tree_cache() -> FileTreeCache:
    """Get or create the global file tree cache."""
    global _file_tree_cache
    if _file_tree_cache is None:
        _file_tree_cache = FileTreeCache()
    return _file_tree_cache


def build_file_tree_cached(
    root: Path,
    max_depth: int = 10,
    respect_gitignore: bool = False,
) -> list[FileNode]:
    """Build file tree using cache."""
    cache = get_file_tree_cache()
    return cache.get(root, max_depth=max_depth, respect_gitignore=respect_gitignore)
