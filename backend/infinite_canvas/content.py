"""Business content locations owned by one selected Workspace."""

from __future__ import annotations

import re
from pathlib import Path

from .workspace_storage import WorkspaceStorageError

from .workspace import Workspace


_IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]+$")
_WORKFLOW_NAME = re.compile(r"^[A-Za-z0-9_一-龥.\-]+\.json$")


class WorkspaceContent:
    """One entrypoint for canvases, collaboration, history, and workflows."""

    def __init__(self, workspace: Workspace) -> None:
        self._workspace = workspace

    @property
    def smart_canvases(self) -> Path:
        return self._workspace.smart_canvases

    def smart_canvas(self, canvas_id: object) -> Path:
        identifier = str(canvas_id or "").strip()
        if not _IDENTIFIER.fullmatch(identifier):
            raise WorkspaceStorageError("无效的画布 ID")
        return self.smart_canvases / f"{identifier}.json"

    @property
    def canvas_content(self) -> Path:
        return self._workspace.canvas_content

    @property
    def generation_run_store(self) -> Path:
        return self._workspace.generation_run_store

    @property
    def storage_authority(self) -> Path:
        return self._workspace.storage_authority

    @property
    def projects(self) -> Path:
        return self._workspace.projects

    @property
    def generation_history(self) -> Path:
        return self._workspace.generation_history

    @property
    def generation_runs(self) -> Path:
        return self._workspace.generation_runs

    @property
    def batch_generation(self) -> Path:
        return self._workspace.batch_generation

    @property
    def generation_effects(self) -> Path:
        return self._workspace.generation_effects

    @property
    def user_workflows(self) -> Path:
        return self._workspace.user_workflows

    def user_workflow(self, name: object) -> Path:
        filename = str(name or "").strip()
        if not _WORKFLOW_NAME.fullmatch(filename):
            raise WorkspaceStorageError("无效的用户工作流名称")
        return self.user_workflows / filename

    @property
    def runninghub_workflows(self) -> Path:
        return self._workspace.runninghub_workflows

    @property
    def prompt_libraries(self) -> Path:
        return self._workspace.prompt_libraries

    @property
    def prompt_library_directory(self) -> Path:
        return self._workspace.prompt_library_directory

    @property
    def prompt_library_covers(self) -> Path:
        return self._workspace.prompt_library_covers

    @property
    def legacy_prompt_libraries(self) -> Path:
        return self._workspace.legacy_prompt_libraries

    @property
    def workspace_asset_library(self) -> Path:
        return self._workspace.workspace_asset_library

    def ensure_directories(self) -> None:
        for directory in (
            self.smart_canvases,
            self.user_workflows,
        ):
            directory.mkdir(parents=True, exist_ok=True)


__all__ = ["WorkspaceContent"]
