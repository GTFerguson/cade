"""requirements.txt and pyproject.toml must name the same dependencies.

Servers install from requirements.txt (scripts/deploy.sh, setup-remote.sh)
and a development checkout installs from pyproject.toml. A package added to
one and not the other works on one kind of machine and fails to import on
the other.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Left out of a server's `pip install -r` on purpose. nkrdn is not on the
# package index; setup-remote.sh installs it from a wheel it is handed.
# fastembed is a large optional extra: backend/doc_index.py builds embeddings
# only when it is importable.
PYPROJECT_ONLY = {"fastembed", "nkrdn"}

# tomllib is built in from Python 3.11, which pyproject.toml requires;
# requirements.txt still serves older interpreters.
REQUIREMENTS_ONLY = {"tomli"}


def _name(spec: str) -> str:
    return re.split(r"[\[<>=!~;\s]", spec.strip(), maxsplit=1)[0].lower()


def _requirements() -> set[str]:
    lines = (ROOT / "requirements.txt").read_text().splitlines()
    return {_name(line) for line in lines if line.strip() and not line.startswith("#")}


def _pyproject() -> set[str]:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    return {_name(spec) for spec in project["dependencies"]}


def test_both_lists_name_the_same_packages():
    assert _requirements() - REQUIREMENTS_ONLY == _pyproject() - PYPROJECT_ONLY


def test_exceptions_are_still_exceptions():
    assert PYPROJECT_ONLY <= _pyproject() - _requirements()
    assert REQUIREMENTS_ONLY <= _requirements() - _pyproject()
