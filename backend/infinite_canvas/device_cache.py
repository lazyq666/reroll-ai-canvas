"""Regenerable, device-local caches for Reroll."""

from __future__ import annotations

import hashlib
import os
import platform
from dataclasses import dataclass
from pathlib import Path

from .installation import installation_directory


def application_cache_directory(
    project_dir: str | os.PathLike[str] | None = None,
) -> Path:
    """Return the operating-system cache directory for this installation."""

    override = str(os.getenv("INFINITE_CANVAS_CACHE_DIR") or "").strip()
    if override:
        return Path(os.path.expandvars(os.path.expanduser(override))).resolve()
    system = platform.system()
    if system == "Darwin":
        base = (
            Path.home() / "Library" / "Caches" / "Infinite Canvas"
        ).resolve()
    elif system == "Windows":
        root = (
            os.getenv("LOCALAPPDATA")
            or str(Path.home() / "AppData" / "Local")
        )
        base = (
            Path(root).expanduser() / "Infinite Canvas" / "Cache"
        ).resolve()
    else:
        xdg_cache = str(os.getenv("XDG_CACHE_HOME") or "").strip()
        if xdg_cache:
            base = (
                Path(xdg_cache).expanduser() / "infinite-canvas"
            ).resolve()
        else:
            base = (
                Path.home() / ".cache" / "infinite-canvas"
            ).resolve()
    return installation_directory(base, project_dir) if project_dir else base


@dataclass(frozen=True)
class DeviceCache:
    """Locations that may be deleted and reconstructed on one device."""

    directory: Path

    def __init__(self, directory: str | Path) -> None:
        object.__setattr__(
            self,
            "directory",
            Path(directory).expanduser().resolve(),
        )

    @property
    def media_previews(self) -> Path:
        return self.directory / "media-previews"

    @property
    def models(self) -> Path:
        return self.directory / "models"

    @property
    def matting_models(self) -> Path:
        return self.models / "matting"

    @property
    def image_processor_models(self) -> Path:
        return self.models / "image-processors"

    @property
    def image_processor_results(self) -> Path:
        return self.directory / "image-processor-results"

    @property
    def canvas_list_indexes(self) -> Path:
        return self.directory / "canvas-list-indexes"

    @property
    def model_capability_sources(self) -> Path:
        return self.directory / "model-capability-sources.json"

    def canvas_list_index(self, workspace_identity: object) -> Path:
        identity = str(workspace_identity or "").strip()
        if not identity:
            raise ValueError("workspace identity is required for derived indexes")
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        return self.canvas_list_indexes / f"{digest}.json"

    def ensure_directories(self) -> tuple[Path, ...]:
        directories = (
            self.media_previews,
            self.matting_models,
            self.image_processor_models,
            self.image_processor_results,
            self.canvas_list_indexes,
        )
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        return directories


__all__ = ["DeviceCache", "application_cache_directory"]
