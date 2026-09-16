"""File tree building and file content reading."""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from threading import Lock

from backend.errors import FileError
from backend.models import FileNode

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


def _safe_is_dir(path: Path) -> bool:
    """Check is_dir(), returning False for inaccessible entries like WSL symlinks."""
    try:
        return path.is_dir()
    except OSError:
        return False


def _dir_sort_key(p: Path) -> tuple[bool, str]:
    """Sort key: directories first, then alphabetical. Handles inaccessible entries."""
    return (not _safe_is_dir(p), p.name.lower())


def _should_ignore(path: Path) -> bool:
    """Check if a path should be ignored."""
    name = path.name

    if _safe_is_dir(path):
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
        if _should_ignore(path):
            return None

        if respect_gitignore and _matches_gitignore(path, root, gitignore_patterns):
            return None

        try:
            rel_path = str(path.relative_to(root)).replace("\\", "/")
        except ValueError:
            rel_path = path.name

        if _safe_is_dir(path):
            if depth >= max_depth:
                # At depth limit: check if directory has visible children
                has_children = False
                try:
                    for child in path.iterdir():
                        if _should_ignore(child):
                            continue
                        if respect_gitignore and _matches_gitignore(child, root, gitignore_patterns):
                            continue
                        has_children = True
                        break
                except (PermissionError, OSError):
                    pass
                return FileNode(
                    name=path.name,
                    path=rel_path,
                    type="directory",
                    children=None,
                    has_more=has_children,
                )

            children: list[FileNode] = []
            try:
                for child in sorted(path.iterdir(), key=_dir_sort_key):
                    child_node = _build_node(child, depth + 1)
                    if child_node is not None:
                        children.append(child_node)
            except (PermissionError, OSError):
                pass

            return FileNode(
                name=path.name,
                path=rel_path,
                type="directory",
                children=children if children else None,
            )
        else:
            if depth > max_depth:
                return None

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
        for child in sorted(root.iterdir(), key=_dir_sort_key):
            node = _build_node(child, 0)
            if node is not None:
                nodes.append(node)
    except (PermissionError, OSError):
        pass

    return nodes


def build_directory_children(
    root: Path,
    relative_dir: str,
    *,
    max_depth: int = 2,
    respect_gitignore: bool = False,
) -> list[FileNode]:
    """Build children of a specific directory for lazy loading.

    Returns nodes whose paths are relative to `root` (project root),
    consistent with the main tree structure.
    """
    target_dir = (root / relative_dir).resolve()
    if not target_dir.is_dir():
        return []
    if not str(target_dir).startswith(str(root.resolve())):
        return []

    gitignore_patterns = _load_gitignore(root) if respect_gitignore else set()

    def _build_node(path: Path, depth: int) -> FileNode | None:
        if _should_ignore(path):
            return None
        if respect_gitignore and _matches_gitignore(path, root, gitignore_patterns):
            return None

        try:
            rel_path = str(path.relative_to(root)).replace("\\", "/")
        except ValueError:
            rel_path = path.name

        if _safe_is_dir(path):
            if depth >= max_depth:
                has_children = False
                try:
                    for child in path.iterdir():
                        if _should_ignore(child):
                            continue
                        if respect_gitignore and _matches_gitignore(child, root, gitignore_patterns):
                            continue
                        has_children = True
                        break
                except (PermissionError, OSError):
                    pass
                return FileNode(
                    name=path.name,
                    path=rel_path,
                    type="directory",
                    children=None,
                    has_more=has_children,
                )

            children: list[FileNode] = []
            try:
                for child in sorted(path.iterdir(), key=_dir_sort_key):
                    child_node = _build_node(child, depth + 1)
                    if child_node is not None:
                        children.append(child_node)
            except (PermissionError, OSError):
                pass

            return FileNode(
                name=path.name,
                path=rel_path,
                type="directory",
                children=children if children else None,
            )
        else:
            if depth > max_depth:
                return None
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
        for child in sorted(target_dir.iterdir(), key=_dir_sort_key):
            node = _build_node(child, 0)
            if node is not None:
                nodes.append(node)
    except (PermissionError, OSError):
        pass

    return nodes


# Binary previews travel over the WebSocket as base64 inside a JSON message,
# so a cap keeps one click on a huge asset from stalling the connection.
MAX_BINARY_PREVIEW_BYTES = 25 * 1024 * 1024

# Extensions the viewer can render (pdf, image) or must never show as text.
_BINARY_TYPES: dict[str, tuple[str, str]] = {
    ".pdf": ("pdf", "application/pdf"),
    ".png": ("image", "image/png"),
    ".jpg": ("image", "image/jpeg"),
    ".jpeg": ("image", "image/jpeg"),
    ".gif": ("image", "image/gif"),
    ".webp": ("image", "image/webp"),
    ".bmp": ("image", "image/bmp"),
    ".ico": ("image", "image/x-icon"),
    ".avif": ("image", "image/avif"),
}
_OPAQUE_BINARY_EXTENSIONS = frozenset({
    ".7z", ".a", ".bin", ".class", ".db", ".dll", ".dylib", ".exe", ".gz",
    ".jar", ".mp3", ".mp4", ".o", ".ogg", ".otf", ".pyc", ".so", ".sqlite",
    ".tar", ".ttf", ".wasm", ".wav", ".woff", ".woff2", ".xz", ".zip", ".zst",
})
_SNIFF_BYTES = 8192


def _resolve_within_root(root: Path, relative_path: str) -> Path:
    """Return the file for ``relative_path`` or raise if it escapes ``root``."""
    file_path = root / relative_path

    if not file_path.exists() or not file_path.is_file():
        raise FileError.not_found(relative_path)

    try:
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(root.resolve())):
            raise FileError.not_found(relative_path)
    except Exception:
        raise FileError.not_found(relative_path)

    return file_path


def _read_text_lenient(file_path: Path, label: str) -> str:
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return file_path.read_text(encoding="latin-1")
        except Exception as e:
            raise FileError.read_failed(label, str(e)) from e
    except Exception as e:
        raise FileError.read_failed(label, str(e)) from e


def _binary_kind(file_path: Path) -> tuple[str, str] | None:
    """Classify a file the viewer must not treat as text, or None for text."""
    ext = file_path.suffix.lower()
    if ext in _BINARY_TYPES:
        return _BINARY_TYPES[ext]
    if ext in _OPAQUE_BINARY_EXTENSIONS:
        return ("binary", "application/octet-stream")
    try:
        with file_path.open("rb") as fh:
            sample = fh.read(_SNIFF_BYTES)
    except OSError:
        return None
    # A NUL byte never appears in text encodings the viewer can show.
    if b"\x00" in sample:
        return ("binary", "application/octet-stream")
    return None


def build_file_payload(file_path: Path, path_label: str) -> dict:
    """Build the ``file-content`` message body for an on-disk file.

    Text files carry their decoded content. Binary files carry base64 so the
    viewer can render PDFs and images itself, or a bare size when the file is
    over the preview cap. Before this distinction existed a PDF was decoded
    as latin-1 and pushed through the syntax highlighter, which locked up
    the viewer.
    """
    kind = _binary_kind(file_path)
    if kind is None:
        content = _read_text_lenient(file_path, path_label)
        return {
            "path": path_label,
            "content": content,
            "fileType": get_file_type(path_label),
            "encoding": "utf-8",
            "size": file_path.stat().st_size,
        }

    file_type, mime = kind
    size = file_path.stat().st_size
    if size > MAX_BINARY_PREVIEW_BYTES:
        return {
            "path": path_label,
            "content": "",
            "fileType": file_type,
            "encoding": "none",
            "size": size,
            "mime": mime,
        }
    try:
        raw = file_path.read_bytes()
    except Exception as e:
        raise FileError.read_failed(path_label, str(e)) from e
    return {
        "path": path_label,
        "content": base64.b64encode(raw).decode("ascii"),
        "fileType": file_type,
        "encoding": "base64",
        "size": size,
        "mime": mime,
    }


def read_file_payload(root: Path, relative_path: str) -> dict:
    """Build a ``file-content`` payload for a path confined to ``root``."""
    return build_file_payload(_resolve_within_root(root, relative_path), relative_path)


def read_file_content(root: Path, relative_path: str) -> str:
    """Read a text file from a relative path confined to ``root``.

    Raises:
        FileError: If file not found or cannot be read
    """
    return _read_text_lenient(_resolve_within_root(root, relative_path), relative_path)


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

    if ext in _BINARY_TYPES:
        return _BINARY_TYPES[ext][0]
    if ext in _OPAQUE_BINARY_EXTENSIONS:
        return "binary"
    return type_map.get(ext, "plaintext")


class FileTreeCache:
    """Cache for file tree structures with invalidation support."""

    def __init__(self) -> None:
        self._cache: dict[tuple[Path, int, bool], list[FileNode]] = {}
        self._lock = Lock()

    def get(
        self,
        root: Path,
        max_depth: int = 10,
        respect_gitignore: bool = False,
    ) -> list[FileNode]:
        """Get cached tree or build if not cached."""
        cache_key = (root.resolve(), max_depth, respect_gitignore)

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
                cached_root = cache_key[0]
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
