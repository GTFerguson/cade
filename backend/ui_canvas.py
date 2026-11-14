"""Pages that agents draw into the viewer.

An agent hands over a complete HTML document and CADE stores it under the
project's ``.cade/canvas/`` directory, then opens it in the viewer. Keeping it
as a file (rather than a transient message) means the page survives a
reconnect, and the agent can refine it afterwards with ordinary file edits.
"""

from __future__ import annotations

import re
from pathlib import Path

CANVAS_DIR = Path(".cade") / "canvas"
DEFAULT_CANVAS_NAME = "canvas"
MAX_CANVAS_BYTES = 5 * 1024 * 1024
MAX_CANVAS_NAME_LENGTH = 64


class CanvasError(ValueError):
    """The page cannot be stored as given."""


def canvas_slug(name: str) -> str:
    """Reduce ``name`` to a filename stem.

    Everything outside ``[a-z0-9-]`` collapses to a hyphen, which is also what
    keeps a caller-supplied name from addressing a path outside the canvas
    directory.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:MAX_CANVAS_NAME_LENGTH].strip("-") or DEFAULT_CANVAS_NAME


def write_canvas(project_root: Path, name: str, html: str) -> str:
    """Store ``html`` as the canvas called ``name``.

    Returns the path relative to ``project_root``, in the form the viewer
    requests files by.
    """
    encoded = html.encode("utf-8")
    if not html.strip():
        raise CanvasError("html is empty")
    if len(encoded) > MAX_CANVAS_BYTES:
        raise CanvasError(
            f"html is {len(encoded)} bytes; the limit is {MAX_CANVAS_BYTES}"
        )

    relative = CANVAS_DIR / f"{canvas_slug(name)}.html"
    target = project_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encoded)
    return relative.as_posix()
