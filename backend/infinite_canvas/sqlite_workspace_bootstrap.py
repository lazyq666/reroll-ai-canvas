"""Manifest-last SQLite authority bootstrap for a fresh Workspace."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from .canvas_store import SqliteCanvasStore
from .content import WorkspaceContent
from .generation_run_store import SqliteGenerationRunStore
from .storage_authority import resolve_storage_authority
from .workspace_storage_composition import compose_workspace_storage


class FreshWorkspaceSqliteBootstrapError(RuntimeError):
    """A fresh Workspace cannot safely publish SQLite authority."""


@dataclass(frozen=True)
class FreshWorkspaceSqliteBootstrap:
    workspace_id: str
    migration_id: str
    manifest: Path
    canvas_database: Path
    generation_run_database: Path
    recovery_report: Path


def _write_atomic_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _fsync_databases(*paths: Path) -> None:
    for path in paths:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    directory_fd = os.open(paths[0].parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _bootstrap_paths(
    content: WorkspaceContent,
    workspace_id: str,
) -> tuple[str, Path]:
    migration_id = f"bootstrap-{workspace_id}"
    report = (
        content.canvas_content.parent
        / "recovery"
        / migration_id
        / "fresh-workspace-bootstrap.json"
    )
    return migration_id, report


def fresh_workspace_bootstrap_pending(
    content: WorkspaceContent,
    workspace_id: str,
) -> bool:
    """Return whether a manifest-last fresh bootstrap can be resumed."""

    _migration_id, report = _bootstrap_paths(content, workspace_id)
    return report.is_file() and not content.storage_authority.is_file()


def fresh_workspace_sqlite_bootstrap_required(
    content: WorkspaceContent,
    workspace_id: str,
) -> bool:
    """Return whether Setup must attempt fresh SQLite bootstrap.

    This also recognizes a crash before the recovery report was durable: an
    adopted Workspace with no authority and no legacy Canvas / Generation Run
    data is still safe to bootstrap.  Unknown final SQLite files are attempted
    deliberately so the bootstrap seam can reject them with a clear error.
    """

    if content.storage_authority.is_file():
        return False
    _migration_id, report = _bootstrap_paths(content, workspace_id)
    if report.is_file():
        return True
    return not (
        any(content.smart_canvases.glob("*.json"))
        or content.generation_runs.is_file()
    )


def bootstrap_fresh_workspace_sqlite(
    content: WorkspaceContent,
    *,
    workspace_id: str,
) -> FreshWorkspaceSqliteBootstrap:
    """Create and verify both empty SQLite stores, then publish authority.

    The recovery report is written before either final database.  A retry may
    reuse only databases that prove they belong to the same Workspace.  The
    authority manifest remains the final commit point.
    """

    normalized_workspace_id = str(workspace_id or "").strip()
    if not normalized_workspace_id:
        raise FreshWorkspaceSqliteBootstrapError(
            "无法确认当前工作区身份，未建立 SQLite 存储权威"
        )
    migration_id, report = _bootstrap_paths(content, normalized_workspace_id)

    if content.storage_authority.is_file():
        authority = resolve_storage_authority(
            content.storage_authority,
            normalized_workspace_id,
            supported_modes=("sqlite",),
        )
        composition = compose_workspace_storage(
            content,
            workspace_id=normalized_workspace_id,
        )
        if not composition.sqlite_ready:
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区 SQLite 存储不完整，请检查后重试"
            )
        return FreshWorkspaceSqliteBootstrap(
            workspace_id=normalized_workspace_id,
            migration_id=authority.migration_id,
            manifest=content.storage_authority,
            canvas_database=content.canvas_content,
            generation_run_database=content.generation_run_store,
            recovery_report=report,
        )

    legacy_canvas_files = tuple(content.smart_canvases.glob("*.json"))
    if legacy_canvas_files or content.generation_runs.is_file():
        raise FreshWorkspaceSqliteBootstrapError(
            "此工作区已有旧版 Canvas 或 Generation Run 数据，"
            "请使用受控迁移，不会覆盖来源文件"
        )

    if report.is_file():
        try:
            loaded = json.loads(report.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区存储恢复记录无法验证，请检查后重试"
            ) from exc
        if not isinstance(loaded, dict):
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区存储恢复记录格式无效，请检查后重试"
            )
        if (
            loaded.get("schema_version") != 1
            or loaded.get("workspace_id") != normalized_workspace_id
            or loaded.get("migration_id") != migration_id
            or loaded.get("phase") not in {"prepared", "databases_durable"}
        ):
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区存储恢复记录不属于当前工作区"
            )
    elif content.canvas_content.exists() or content.generation_run_store.exists():
        raise FreshWorkspaceSqliteBootstrapError(
            "发现来源不明的 SQLite 数据库，未发布新工作区存储权威"
        )
    else:
        try:
            _write_atomic_json(
                report,
                {
                    "schema_version": 1,
                    "workspace_id": normalized_workspace_id,
                    "migration_id": migration_id,
                    "phase": "prepared",
                },
            )
        except Exception as exc:
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区 SQLite 存储初始化失败，来源内容未被覆盖；"
                "请重试"
            ) from exc

    try:
        canvas_store = SqliteCanvasStore(
            content.canvas_content,
            workspace_id=normalized_workspace_id,
        )
        run_store = SqliteGenerationRunStore(
            content.generation_run_store,
            workspace_id=normalized_workspace_id,
        )
        if (
            not canvas_store.integrity().get("ok")
            or not run_store.integrity().get("ok")
        ):
            raise FreshWorkspaceSqliteBootstrapError(
                "新工作区 SQLite 完整性检查失败"
            )
        _fsync_databases(
            content.canvas_content,
            content.generation_run_store,
        )
        _write_atomic_json(
            report,
            {
                "schema_version": 1,
                "workspace_id": normalized_workspace_id,
                "migration_id": migration_id,
                "phase": "databases_durable",
            },
        )
        _write_atomic_json(
            content.storage_authority,
            {
                "schema_version": 1,
                "workspace_id": normalized_workspace_id,
                "migration_id": migration_id,
                "canvas": "sqlite",
                "generation_runs": "sqlite",
            },
        )
    except FreshWorkspaceSqliteBootstrapError:
        raise
    except Exception as exc:
        raise FreshWorkspaceSqliteBootstrapError(
            "新工作区 SQLite 存储初始化失败，来源内容未被覆盖；"
            "请重试"
        ) from exc

    return FreshWorkspaceSqliteBootstrap(
        workspace_id=normalized_workspace_id,
        migration_id=migration_id,
        manifest=content.storage_authority,
        canvas_database=content.canvas_content,
        generation_run_database=content.generation_run_store,
        recovery_report=report,
    )


__all__ = [
    "FreshWorkspaceSqliteBootstrap",
    "FreshWorkspaceSqliteBootstrapError",
    "bootstrap_fresh_workspace_sqlite",
    "fresh_workspace_bootstrap_pending",
    "fresh_workspace_sqlite_bootstrap_required",
]
