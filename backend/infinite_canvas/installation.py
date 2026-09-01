"""Stable identity and storage scope for one source checkout."""

from __future__ import annotations

import hashlib
from pathlib import Path


INSTALLATIONS_DIRECTORY = "installations"


def installation_identity(project_dir: str | Path) -> str:
    """Return the stable, non-secret identity of one project directory."""

    canonical = str(Path(project_dir).expanduser().resolve())
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def installation_directory(
    base_directory: str | Path,
    project_dir: str | Path,
) -> Path:
    """Scope an operating-system data root to one project checkout."""

    return (
        Path(base_directory).expanduser().resolve()
        / INSTALLATIONS_DIRECTORY
        / installation_identity(project_dir)
    )


__all__ = [
    "INSTALLATIONS_DIRECTORY",
    "installation_directory",
    "installation_identity",
]
