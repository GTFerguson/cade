"""nkrdn knowledge graph integration — automatic build for opened projects.

Uses the nkrdn CLI to build and maintain a knowledge graph for any project
CADE opens. Degrades gracefully when nkrdn is not installed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.backend.models import FileChangeEvent

logger = logging.getLogger(__name__)

# Check if nkrdn CLI is available on PATH
_NKRDN_BIN = shutil.which("nkrdn")
NKRDN_AVAILABLE = _NKRDN_BIN is not None

if not NKRDN_AVAILABLE:
    logger.debug("nkrdn not found on PATH — knowledge graph disabled")

# File extensions that trigger a rebuild
_CODE_EXTENSIONS = frozenset({
    ".py", ".cpp", ".cc", ".cxx", ".hpp", ".h", ".hxx",
})


def _find_usage_rule() -> Path | None:
    """Locate the nkrdn usage-rule.md from the installed package."""
    try:
        result = subprocess.run(
            [_NKRDN_BIN, "-c",
             "import nkrdn, os; print(os.path.dirname(nkrdn.__file__))"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        # _NKRDN_BIN is the nkrdn CLI, not python — use python from same env
        pass

    # Find the python that nkrdn's venv uses
    nkrdn_bin = Path(_NKRDN_BIN).resolve() if _NKRDN_BIN else None
    if nkrdn_bin is None:
        return None

    python_bin = nkrdn_bin.parent / "python3"
    if not python_bin.exists():
        python_bin = nkrdn_bin.parent / "python"
    if not python_bin.exists():
        return None

    try:
        result = subprocess.run(
            [str(python_bin), "-c",
             "import nkrdn, os; print(os.path.dirname(nkrdn.__file__))"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            pkg_dir = Path(result.stdout.strip())
            rule = pkg_dir / "usage-rule.md"
            if rule.exists():
                return rule
    except Exception:
        pass

    return None


def ensure_setup() -> None:
    """Install nkrdn usage rule to ~/.claude/rules/. Idempotent."""
    rule_src = _find_usage_rule()
    if rule_src is None:
        return

    rules_dir = Path.home() / ".claude" / "rules"
    rule_dst = rules_dir / "code-intel.md"

    # Only install if no rule exists yet
    if rule_dst.exists():
        return

    rules_dir.mkdir(parents=True, exist_ok=True)
    # Copy the file (not symlink — package path may change on upgrades)
    shutil.copy2(rule_src, rule_dst)
    logger.info("Installed nkrdn usage rule to %s", rule_dst)


def has_code(project_dir: Path) -> bool:
    """Check if a project has source code worth indexing."""
    for ext in _CODE_EXTENSIONS:
        try:
            next(project_dir.rglob(f"*{ext}"))
            return True
        except StopIteration:
            continue
    return False


def _graph_path(project_dir: Path) -> Path:
    """Return the path where the knowledge graph is stored."""
    return project_dir / ".cade" / "graph.ttl"


def _run_nkrdn_rebuild(project_dir: Path) -> subprocess.CompletedProcess:
    """Run nkrdn rebuild as a subprocess.

    CPU-bound — call via asyncio.to_thread().
    """
    graph_file = _graph_path(project_dir)
    staging_dir = project_dir / ".cade" / "staging"

    cmd = [
        _NKRDN_BIN,
        "rebuild",
        str(project_dir),
        "--output", str(graph_file),
        "--staging-dir", str(staging_dir),
    ]

    env = os.environ.copy()
    env["NKRDN_BACKEND"] = "file"  # force rdflib, no Neo4j dependency

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(project_dir),
        timeout=300,  # 5 minute max for large projects
        env=env,
    )

    return result


class NkrdnService:
    """Manages knowledge graph lifecycle for a single project connection."""

    def __init__(self, project_dir: Path) -> None:
        self._project_dir = project_dir
        self._rebuild_task: asyncio.Task | None = None
        self._debounce_seconds = 10.0
        self._building = False

    async def initial_build(self) -> None:
        """Build knowledge graph on project open. Call as a background task."""
        try:
            await asyncio.to_thread(ensure_setup)

            if not has_code(self._project_dir):
                logger.debug("No source code to index in %s", self._project_dir)
                return

            self._building = True
            result = await asyncio.to_thread(
                _run_nkrdn_rebuild, self._project_dir
            )
            self._building = False

            if result.returncode == 0:
                logger.info(
                    "Knowledge graph built for %s",
                    self._project_dir,
                )
            else:
                logger.warning(
                    "nkrdn rebuild failed (exit %d): %s",
                    result.returncode,
                    result.stderr.strip() if result.stderr else "(no stderr)",
                )
        except subprocess.TimeoutExpired:
            self._building = False
            logger.warning("nkrdn rebuild timed out for %s", self._project_dir)
        except Exception as e:
            self._building = False
            logger.warning("nkrdn initial build failed: %s", e)

    def on_file_change(self, event: "FileChangeEvent") -> None:
        """FileWatcher callback. Queues debounced rebuild for code files."""
        suffix = Path(event.path).suffix.lower()
        if suffix not in _CODE_EXTENSIONS:
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

            if self._building:
                logger.debug("Skipping rebuild, build already in progress")
                return

            self._building = True
            result = await asyncio.to_thread(
                _run_nkrdn_rebuild, self._project_dir
            )
            self._building = False

            if result.returncode == 0:
                logger.info(
                    "Knowledge graph rebuilt for %s",
                    self._project_dir,
                )
            else:
                logger.warning(
                    "nkrdn rebuild failed (exit %d): %s",
                    result.returncode,
                    result.stderr.strip() if result.stderr else "(no stderr)",
                )
        except asyncio.CancelledError:
            pass
        except subprocess.TimeoutExpired:
            self._building = False
            logger.warning("nkrdn rebuild timed out")
        except Exception as e:
            self._building = False
            logger.warning("nkrdn rebuild failed: %s", e)

    def cancel(self) -> None:
        """Cancel any pending rebuild. Call from cleanup."""
        if self._rebuild_task is not None:
            self._rebuild_task.cancel()
            self._rebuild_task = None
