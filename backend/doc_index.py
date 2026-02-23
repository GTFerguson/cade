"""Doc-index integration — automatic indexing for opened projects.

Uses cadence's doc_index package to build and maintain a documentation
index for any project CADE opens. Degrades gracefully when the cadence
submodule is not available.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.models import FileChangeEvent

logger = logging.getLogger(__name__)

# Add cadence submodule to Python path so we can import tools.doc_index
_CADENCE_ROOT = Path(__file__).parent.parent / "cadence"


def _ensure_importable() -> bool:
    """Add cadence to sys.path if present. Returns True if available."""
    root_str = str(_CADENCE_ROOT)
    if not _CADENCE_ROOT.exists():
        return False
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
    return True


if _ensure_importable():
    try:
        from tools.doc_index.builder import build_index
        from tools.doc_index.config import load_config
        from tools.doc_index.search import build_tfidf, save_tfidf

        DOC_INDEX_AVAILABLE = True
    except ImportError:
        DOC_INDEX_AVAILABLE = False
else:
    DOC_INDEX_AVAILABLE = False

if not DOC_INDEX_AVAILABLE:
    logger.debug("cadence submodule not available — doc-index disabled")


def has_docs(project_dir: Path) -> bool:
    """Check if a project has markdown docs worth indexing."""
    if not DOC_INDEX_AVAILABLE:
        return False
    config = load_config(project_dir)
    for scan_dir in config.get("scan", []):
        doc_root = project_dir / scan_dir
        if doc_root.exists() and any(doc_root.rglob("*.md")):
            return True
    return False


def build_project_index(project_dir: Path) -> dict | None:
    """Build/rebuild the doc-index for a project.

    CPU-bound — call via asyncio.to_thread().
    Returns the index dict, or None if no docs found.
    """
    if not DOC_INDEX_AVAILABLE:
        return None
    if not has_docs(project_dir):
        return None

    config = load_config(project_dir)
    index = build_index(project_dir, config)

    # Always build TF-IDF alongside the main index
    tfidf_path = project_dir / config.get(
        "tfidf_output", ".cade/doc-index-tfidf.json"
    )
    tfidf_data = build_tfidf(index["docs"], project_dir)
    save_tfidf(tfidf_data, tfidf_path)

    return index


class DocIndexService:
    """Manages doc-index lifecycle for a single project connection."""

    def __init__(self, project_dir: Path) -> None:
        self._project_dir = project_dir
        self._rebuild_task: asyncio.Task | None = None
        self._debounce_seconds = 5.0

    async def initial_build(self) -> None:
        """Build index on project open. Call as a background task."""
        try:
            index = await asyncio.to_thread(
                build_project_index, self._project_dir
            )
            if index:
                logger.info(
                    "Doc-index built: %d docs in %s",
                    index.get("count", 0),
                    self._project_dir,
                )
            else:
                logger.debug(
                    "No docs to index in %s", self._project_dir
                )
        except Exception as e:
            logger.warning("Doc-index initial build failed: %s", e)

    def on_file_change(self, event: "FileChangeEvent") -> None:
        """FileWatcher callback. Queues debounced rebuild for .md files."""
        if not event.path.endswith(".md"):
            return
        self._schedule_rebuild()

    def _schedule_rebuild(self) -> None:
        """Cancel any pending rebuild and schedule a new one."""
        if self._rebuild_task is not None:
            self._rebuild_task.cancel()
        self._rebuild_task = asyncio.create_task(self._debounced_rebuild())

    async def _debounced_rebuild(self) -> None:
        """Wait for debounce period, then rebuild."""
        try:
            await asyncio.sleep(self._debounce_seconds)
            index = await asyncio.to_thread(
                build_project_index, self._project_dir
            )
            if index:
                logger.info(
                    "Doc-index rebuilt: %d docs in %s",
                    index.get("count", 0),
                    self._project_dir,
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("Doc-index rebuild failed: %s", e)

    def cancel(self) -> None:
        """Cancel any pending rebuild. Call from cleanup."""
        if self._rebuild_task is not None:
            self._rebuild_task.cancel()
            self._rebuild_task = None
