"""All-or-nothing Workspace storage selection before production wiring."""

from __future__ import annotations

from dataclasses import dataclass

from .canvas_store import SqliteCanvasStore
from .content import WorkspaceContent
from .generation_run_store import SqliteGenerationRunStore
from .storage_authority import StorageAuthority, resolve_storage_authority


class WorkspaceStorageCompositionError(RuntimeError):
    """The declared Workspace authority cannot be composed safely."""


@dataclass(frozen=True)
class WorkspaceStorageComposition:
    authority: StorageAuthority
    canvas_store: SqliteCanvasStore | None = None
    generation_run_store: SqliteGenerationRunStore | None = None

    @property
    def mode(self) -> str:
        return self.authority.mode

    @property
    def sqlite_ready(self) -> bool:
        return (
            self.canvas_store is not None
            and self.generation_run_store is not None
        )


def compose_workspace_storage(
    content: WorkspaceContent,
    *,
    workspace_id: str,
) -> WorkspaceStorageComposition:
    """Resolve one complete JSON or SQLite Workspace storage composition."""

    authority = resolve_storage_authority(
        content.storage_authority,
        workspace_id,
        supported_modes=("json", "sqlite"),
    )
    if authority.mode == "json":
        return WorkspaceStorageComposition(authority=authority)
    if (
        not content.canvas_content.is_file()
        or not content.generation_run_store.is_file()
    ):
        raise WorkspaceStorageCompositionError(
            "SQLite authority 缺少 Canvas 或 Generation Run 数据库"
        )
    canvas_store = SqliteCanvasStore(
        content.canvas_content,
        workspace_id=workspace_id,
    )
    generation_run_store = SqliteGenerationRunStore(
        content.generation_run_store,
        workspace_id=workspace_id,
    )
    if (
        not canvas_store.integrity().get("ok")
        or not generation_run_store.integrity().get("ok")
    ):
        raise WorkspaceStorageCompositionError(
            "SQLite authority 完整性检查失败"
        )
    return WorkspaceStorageComposition(
        authority=authority,
        canvas_store=canvas_store,
        generation_run_store=generation_run_store,
    )


__all__ = [
    "WorkspaceStorageComposition",
    "WorkspaceStorageCompositionError",
    "compose_workspace_storage",
]
