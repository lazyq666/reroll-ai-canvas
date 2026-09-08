"""All-or-nothing Workspace storage selection before production wiring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Any
from contextlib import closing
import sqlite3

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
    cloud_runtime: Any = None

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
    cloud_runtime: Callable[[StorageAuthority], Any] | None = None,
) -> WorkspaceStorageComposition:
    """Resolve one complete JSON or SQLite Workspace storage composition."""

    authority = resolve_storage_authority(
        content.storage_authority,
        workspace_id,
        supported_modes=("json", "sqlite", "turso") if cloud_runtime else ("json", "sqlite"),
    )
    if authority.mode == "json":
        return WorkspaceStorageComposition(authority=authority)
    if authority.mode == "turso":
        runtime = cloud_runtime(authority)
        runtime.require_active()
        if runtime.workspace_id != workspace_id or runtime.binding_id != authority.binding_id:
            raise WorkspaceStorageCompositionError("cloud_storage_binding_invalid")
        return WorkspaceStorageComposition(authority, runtime.canvas_store, runtime.generation_run_store, runtime)
    if (
        not content.canvas_content.is_file()
        or not content.generation_run_store.is_file()
    ):
        raise WorkspaceStorageCompositionError(
            "SQLite authority 缺少 Canvas 或 Generation Run 数据库"
        )
    if authority.return_epoch:
        try:
            for path, metadata in (
                (content.canvas_content, "store_metadata"),
                (content.generation_run_store, "generation_run_store_metadata"),
                (content.batch_generation, "reroll_batch_metadata"),
            ):
                with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
                    row = connection.execute(f"SELECT value FROM {metadata} WHERE key='cloud_return_epoch'").fetchone()
                    if row != (authority.return_epoch,):
                        raise WorkspaceStorageCompositionError("cloud_storage_local_copy_incomplete")
        except sqlite3.Error:
            raise WorkspaceStorageCompositionError("cloud_storage_local_copy_incomplete") from None
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
