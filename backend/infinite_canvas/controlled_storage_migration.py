"""Controlled JSON/JSON to SQLite/SQLite maintenance cutover."""

from __future__ import annotations

import os
from collections.abc import Callable

from .content import WorkspaceContent
from .legacy_generation_archive import restore_legacy_generation_json
from .sqlite_authority_publish import (
    SqliteAuthorityPublication,
    SqliteAuthorityPublishError,
    publish_sqlite_authority,
)
from .sqlite_migration import SqliteMigrationError, prepare_sqlite_migration
from .workspace_storage import WorkspaceStorageError
from .workspace_storage_composition import (
    WorkspaceStorageCompositionError,
    compose_workspace_storage,
)


class ControlledStorageMigration:
    """One public maintenance command for an all-or-nothing storage cutover."""

    def __init__(
        self,
        *,
        content_provider: Callable[[], WorkspaceContent],
        workspace_id_provider: Callable[[], str],
    ) -> None:
        self._content_provider = content_provider
        self._workspace_id_provider = workspace_id_provider

    @staticmethod
    def _rollback_publication(
        content: WorkspaceContent,
        published: SqliteAuthorityPublication,
    ) -> None:
        """Return to unchanged legacy JSON after a failed restart boundary."""

        restore_legacy_generation_json(
            content,
            workspace_id=published.workspace_id,
            migration_id=published.migration_id,
            recovery_manifest=(
                content.canvas_content.parent
                / "recovery"
                / published.migration_id
                / "recovery-manifest.json"
            ),
        )
        for path in (
            published.manifest,
            published.canvas_database,
            published.generation_run_database,
        ):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        directory_fd = os.open(content.canvas_content.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def migrate(self, migration_id: str) -> Callable[[], None]:
        """Prepare, publish and reopen both stores; return restart rollback."""

        content = self._content_provider()
        workspace_id = str(self._workspace_id_provider() or "").strip()
        try:
            prepared = prepare_sqlite_migration(
                content,
                workspace_id=workspace_id,
                migration_id=migration_id,
            )
            published = publish_sqlite_authority(content, prepared)
        except (SqliteMigrationError, SqliteAuthorityPublishError) as exc:
            raise WorkspaceStorageError(str(exc)) from exc

        try:
            reopened = compose_workspace_storage(
                content,
                workspace_id=workspace_id,
            )
            if reopened.mode != "sqlite" or not reopened.sqlite_ready:
                raise WorkspaceStorageCompositionError(
                    "发布后的 SQLite authority 未能同时重新打开两套存储"
                )
        except Exception as exc:
            self._rollback_publication(content, published)
            raise WorkspaceStorageError(
                "发布后的重新打开验证失败，已恢复使用迁移前 JSON 数据"
            ) from exc

        def rollback() -> None:
            self._rollback_publication(content, published)

        return rollback


__all__ = ["ControlledStorageMigration"]
