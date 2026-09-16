"""File operations: tree building, watching, read/write, and user config."""

from backend.files.operations import create_file, validate_path, write_file_content
from backend.files.tree import (
    build_file_tree,
    build_file_tree_cached,
    get_file_tree_cache,
    build_file_payload,
    get_file_type,
    read_file_content,
    read_file_payload,
)
from backend.files.user_config import UserConfig, get_default_user_config
from core.backend.watcher import FileWatcher

__all__ = [
    "FileWatcher",
    "UserConfig",
    "build_file_tree",
    "build_file_tree_cached",
    "build_file_payload",
    "create_file",
    "get_default_user_config",
    "get_file_tree_cache",
    "get_file_type",
    "read_file_content",
    "read_file_payload",
    "validate_path",
    "write_file_content",
]
