"""Service-stopped one-shot publication and rollback of SQLite authority."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Iterator, Mapping

from .content import WorkspaceContent
from .legacy_generation_archive import (
    archive_legacy_generation_json,
    restore_legacy_generation_json,
)
from .sqlite_authority_publish import publish_sqlite_authority
from .sqlite_migration import prepare_sqlite_migration
from .sqlite_publication_upgrade import (
    SqlitePublicationUpgradeError,
    is_existing_sqlite_upgrade,
    prepare_existing_sqlite_publication_upgrade,
    publish_existing_sqlite_publication_upgrade,
    rollback_existing_sqlite_publication_upgrade,
)
from .storage_authority import resolve_storage_authority
from .workspace import (
    Workspace,
    _release_file_lock,
    _try_exclusive_file_lock,
)
from .workspace_storage_composition import compose_workspace_storage


class OfflineSqliteMigrationError(RuntimeError):
    """The service-stopped migration cannot safely advance authority."""


_MIGRATION_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


@dataclass(frozen=True)
class OfflineSqliteMigration:
    ok: bool
    workspace_id: str
    migration_id: str
    status: str
    report: Path
    manifest: Path
    legacy_archive_report: Path


@dataclass(frozen=True)
class OfflineSqliteRollback:
    ok: bool
    workspace_id: str
    migration_id: str
    report: Path
    restored_legacy_report: Path
    retired_sqlite_directory: Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
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


def _load_upgrade_preparation_report(
    content: WorkspaceContent,
    migration_id: str,
) -> Mapping[str, Any]:
    path = (
        content.canvas_content.parent
        / "recovery"
        / migration_id
        / "preparation-report.json"
    )
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OfflineSqliteMigrationError(
            "无法读取 existing SQLite upgrade preparation report"
        ) from exc
    if not isinstance(value, Mapping):
        raise OfflineSqliteMigrationError(
            "existing SQLite upgrade preparation report 格式无效"
        )
    return value


def _phase_two_preparation_recorded(
    content: WorkspaceContent,
    migration_id: str,
) -> bool:
    try:
        report = _load_upgrade_preparation_report(content, migration_id)
    except OfflineSqliteMigrationError:
        return False
    return (
        report.get("status") == "ready"
        and report.get("phase") == "complete"
        and isinstance(report.get("global_history_audit"), Mapping)
        and isinstance(report.get("publication_audit"), Mapping)
    )


def _workspace_content(workspace_directory: Path) -> WorkspaceContent:
    return WorkspaceContent(
        Workspace(
            directory=workspace_directory,
            _records_directory=workspace_directory / "data",
            _media_directory=workspace_directory / "assets",
        )
    )


def _workspace_id(workspace_directory: Path) -> str:
    identity = workspace_directory / ".infinite-canvas-workspace.json"
    try:
        value = json.loads(identity.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OfflineSqliteMigrationError(
            "无法读取 Workspace identity"
        ) from exc
    workspace_id = str(
        value.get("workspace_id") if isinstance(value, Mapping) else ""
    ).strip()
    if not workspace_id:
        raise OfflineSqliteMigrationError("Workspace identity 为空")
    return workspace_id


def _validated_directory(path: Path | str, *, label: str) -> Path:
    value = Path(path).expanduser()
    if not value.is_absolute():
        raise OfflineSqliteMigrationError(f"{label} 必须是绝对路径")
    return value.resolve()


def _validated_migration_id(value: object) -> str:
    migration_id = str(value or "").strip()
    if (
        not _MIGRATION_ID.fullmatch(migration_id)
        or migration_id in {".", ".."}
    ):
        raise OfflineSqliteMigrationError("migration ID 无效")
    return migration_id


def _validated_quarantine_history_ids(
    values: tuple[str, ...] | list[str] | None,
) -> tuple[str, ...]:
    normalized: list[str] = []
    for raw in values or ():
        history_id = str(raw or "").strip()
        if (
            not history_id
            or len(history_id) > 512
            or history_id in normalized
            or len(normalized) >= 10_000
        ):
            raise OfflineSqliteMigrationError(
                "quarantine Global History ID 无效"
            )
        normalized.append(history_id)
    return tuple(normalized)


def _record_operator_resolution(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    history_ids: tuple[str, ...],
) -> Path:
    path = (
        content.canvas_content.parent
        / "recovery"
        / migration_id
        / "operator-resolution.json"
    )
    payload = {
        "schema_version": 1,
        "workspace_id": workspace_id,
        "migration_id": migration_id,
        "confirmed_irrecoverable": True,
        "reason": "operator_confirmed_irrecoverable_managed_media",
        "quarantine_missing_global_history_ids": list(history_ids),
    }
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise OfflineSqliteMigrationError(
                "已有 operator resolution 无法读取"
            ) from exc
        if current != payload:
            raise OfflineSqliteMigrationError(
                "同一 migration ID 已有不同 operator resolution"
            )
        return path
    _write_json_atomic(path, payload)
    return path


@contextmanager
def _maintenance_occupation(workspace_directory: Path) -> Iterator[None]:
    control = workspace_directory / ".infinite-canvas-service"
    control.mkdir(parents=True, exist_ok=True)
    guard: BinaryIO = (control / "writer.lock").open("a+b")
    if not _try_exclusive_file_lock(guard):
        guard.close()
        raise OfflineSqliteMigrationError(
            "Workspace 写锁仍被服务占用；请先停止服务"
        )
    try:
        yield
    finally:
        _release_file_lock(guard)
        guard.close()


def _migration_report(
    report_directory: Path,
    migration_id: str,
) -> Path:
    return report_directory / migration_id / "offline-migration-report.json"


def _rollback_report(
    report_directory: Path,
    migration_id: str,
) -> Path:
    return report_directory / migration_id / "offline-rollback-report.json"


def _workspace_report_path(path: Path, workspace_directory: Path) -> str:
    try:
        return path.relative_to(workspace_directory).as_posix()
    except ValueError as exc:
        raise OfflineSqliteMigrationError(
            "Workspace 报告路径越界"
        ) from exc


def _operator_report_path(path: Path, report_directory: Path) -> str:
    try:
        return path.relative_to(report_directory).as_posix()
    except ValueError as exc:
        raise OfflineSqliteMigrationError("操作报告路径越界") from exc


def _archive_authority_artifact(source: Path, destination: Path) -> None:
    if destination.exists():
        if not source.exists():
            return
        if (
            not destination.is_file()
            or destination.is_symlink()
            or source.is_symlink()
            or _sha256(destination) != _sha256(source)
        ):
            raise OfflineSqliteMigrationError(
                f"rollback 目标已有不同文件：{source.name}"
            )
        source.unlink()
        return
    if source.exists():
        if not source.is_file() or source.is_symlink():
            raise OfflineSqliteMigrationError(
                f"rollback authority 文件不安全：{source.name}"
            )
        os.replace(source, destination)


def _rollback_locked(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    report_directory: Path,
) -> OfflineSqliteRollback:
    authority = resolve_storage_authority(
        content.storage_authority,
        workspace_id,
        supported_modes=("sqlite",),
    )
    if authority.mode != "sqlite" or authority.migration_id != migration_id:
        raise OfflineSqliteMigrationError(
            "当前 SQLite authority 与 rollback migration ID 不一致"
        )
    if is_existing_sqlite_upgrade(content, migration_id=migration_id):
        try:
            rollback = rollback_existing_sqlite_publication_upgrade(
                content,
                workspace_id=workspace_id,
                migration_id=migration_id,
                report_directory=report_directory,
            )
        except SqlitePublicationUpgradeError as exc:
            raise OfflineSqliteMigrationError(str(exc)) from exc
        return OfflineSqliteRollback(
            ok=True,
            workspace_id=workspace_id,
            migration_id=migration_id,
            report=rollback.report,
            restored_legacy_report=rollback.restored_legacy_report,
            retired_sqlite_directory=rollback.retired_sqlite_directory,
        )
    migration_root = content.canvas_content.parent / "recovery" / migration_id
    recovery_manifest = migration_root / "recovery-manifest.json"
    restored = restore_legacy_generation_json(
        content,
        workspace_id=workspace_id,
        migration_id=migration_id,
        recovery_manifest=recovery_manifest,
    )

    # Legacy sources become durable before the authority commit point is
    # withdrawn.  The databases and manifest are moved, not deleted, so the
    # rollback itself is reversible and can be rehearsed byte-for-byte.
    retired = migration_root / "rollback" / "retired-sqlite-authority"
    retired.mkdir(parents=True, exist_ok=True)
    database_artifacts = []
    for database in (content.canvas_content, content.generation_run_store):
        database_artifacts.extend(
            (
                database.with_name(database.name + "-wal"),
                database.with_name(database.name + "-shm"),
                database,
            )
        )
    for source in (*database_artifacts, content.storage_authority):
        _archive_authority_artifact(source, retired / source.name)
    data_directory_fd = os.open(content.canvas_content.parent, os.O_RDONLY)
    try:
        os.fsync(data_directory_fd)
    finally:
        os.close(data_directory_fd)

    composition = compose_workspace_storage(content, workspace_id=workspace_id)
    if composition.mode != "json" or composition.sqlite_ready:
        raise OfflineSqliteMigrationError(
            "rollback 后未恢复 JSON authority"
        )
    report = _rollback_report(report_directory, migration_id)
    _write_json_atomic(
        report,
        {
            "schema_version": 1,
            "status": "complete",
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "authority": "json",
            "legacy_source_restore_report": _workspace_report_path(
                restored,
                content.canvas_content.parent.parent,
            ),
            "retired_sqlite_directory": _workspace_report_path(
                retired,
                content.canvas_content.parent.parent,
            ),
            "old_version_restart_ready": True,
        },
    )
    return OfflineSqliteRollback(
        ok=True,
        workspace_id=workspace_id,
        migration_id=migration_id,
        report=report,
        restored_legacy_report=restored,
        retired_sqlite_directory=retired,
    )


def rollback_workspace_sqlite_authority(
    workspace_directory: Path | str,
    *,
    migration_id: str,
    report_directory: Path | str,
) -> OfflineSqliteRollback:
    """Restore JSON authority while preserving every SQLite artifact."""

    workspace = _validated_directory(workspace_directory, label="Workspace 路径")
    reports = _validated_directory(report_directory, label="报告目录")
    migration_id = _validated_migration_id(migration_id)
    with _maintenance_occupation(workspace):
        content = _workspace_content(workspace)
        return _rollback_locked(
            content,
            workspace_id=_workspace_id(workspace),
            migration_id=migration_id,
            report_directory=reports,
        )


def migrate_workspace_sqlite_authority(
    workspace_directory: Path | str,
    *,
    migration_id: str,
    report_directory: Path | str,
    quarantine_missing_global_history_ids: tuple[str, ...] | list[str] = (),
) -> OfflineSqliteMigration:
    """Prepare, verify and publish all-SQLite authority under one write lock."""

    workspace = _validated_directory(workspace_directory, label="Workspace 路径")
    reports = _validated_directory(report_directory, label="报告目录")
    migration_id = _validated_migration_id(migration_id)
    quarantine_history_ids = _validated_quarantine_history_ids(
        quarantine_missing_global_history_ids
    )
    report = _migration_report(reports, migration_id)
    with _maintenance_occupation(workspace):
        content = _workspace_content(workspace)
        workspace_id = _workspace_id(workspace)
        if quarantine_history_ids:
            if not content.storage_authority.is_file():
                raise OfflineSqliteMigrationError(
                    "Global History quarantine 仅适用于早期 SQLite upgrade"
                )
            current_authority = resolve_storage_authority(
                content.storage_authority,
                workspace_id,
                supported_modes=("sqlite",),
            )
            if current_authority.migration_id == migration_id:
                raise OfflineSqliteMigrationError(
                    "早期 SQLite upgrade 必须使用新的 migration ID"
                )
            _record_operator_resolution(
                content,
                workspace_id=workspace_id,
                migration_id=migration_id,
                history_ids=quarantine_history_ids,
            )
        phase = "preflight"
        published = False
        try:
            migration_kind = "json-to-sqlite"
            previous_migration_id = ""
            if content.storage_authority.exists():
                authority = resolve_storage_authority(
                    content.storage_authority,
                    workspace_id,
                    supported_modes=("sqlite",),
                )
                if authority.migration_id == migration_id:
                    existing_upgrade = is_existing_sqlite_upgrade(
                        content, migration_id=migration_id
                    )
                    if (
                        not existing_upgrade
                        and not _phase_two_preparation_recorded(
                            content, migration_id
                        )
                    ):
                        raise OfflineSqliteMigrationError(
                            "当前 migration ID 来自早期不完整 SQLite cutover；"
                            "请使用新的 migration ID 执行 Phase 2 upgrade"
                        )
                    phase = "resume_archive"
                    composition = compose_workspace_storage(
                        content,
                        workspace_id=workspace_id,
                    )
                    if (
                        composition.mode != "sqlite"
                        or not composition.sqlite_ready
                    ):
                        raise OfflineSqliteMigrationError(
                            "已有 SQLite authority 无法通过完整性验证"
                        )
                    archive_report = archive_legacy_generation_json(
                        content,
                        workspace_id=workspace_id,
                        migration_id=migration_id,
                        recovery_manifest=(
                            content.canvas_content.parent
                            / "recovery"
                            / migration_id
                            / "recovery-manifest.json"
                        ),
                    )
                    status = "already_complete"
                    if existing_upgrade:
                        migration_kind = "existing-sqlite-publication-upgrade"
                        preparation = _load_upgrade_preparation_report(
                            content, migration_id
                        )
                        previous_migration_id = str(
                            preparation.get("previous_migration_id") or ""
                        )
                else:
                    migration_kind = "existing-sqlite-publication-upgrade"
                    previous_migration_id = authority.migration_id
                    phase = "prepare_existing_sqlite_upgrade"
                    try:
                        prepared_upgrade = (
                            prepare_existing_sqlite_publication_upgrade(
                                content,
                                workspace_id=workspace_id,
                                migration_id=migration_id,
                                previous_migration_id=previous_migration_id,
                            )
                        )
                        phase = "publish_existing_sqlite_upgrade"
                        upgrade = publish_existing_sqlite_publication_upgrade(
                            content, prepared_upgrade
                        )
                    except SqlitePublicationUpgradeError as exc:
                        raise OfflineSqliteMigrationError(str(exc)) from exc
                    published = True
                    archive_report = upgrade.legacy_archive_report
                    phase = "reopen_verify"
                    composition = compose_workspace_storage(
                        content,
                        workspace_id=workspace_id,
                    )
                    if (
                        composition.mode != "sqlite"
                        or not composition.sqlite_ready
                    ):
                        raise OfflineSqliteMigrationError(
                            "升级后的 SQLite authority 无法重新打开"
                        )
                    status = "complete"
            else:
                phase = "prepare_staging"
                prepared = prepare_sqlite_migration(
                    content,
                    workspace_id=workspace_id,
                    migration_id=migration_id,
                )
                phase = "publish_manifest_then_archive"
                publication = publish_sqlite_authority(content, prepared)
                published = True
                archive_report = publication.legacy_archive_report
                phase = "reopen_verify"
                composition = compose_workspace_storage(
                    content,
                    workspace_id=workspace_id,
                )
                if composition.mode != "sqlite" or not composition.sqlite_ready:
                    raise OfflineSqliteMigrationError(
                        "发布后的 SQLite authority 无法重新打开"
                    )
                status = "complete"
            phase = "report"
            _write_json_atomic(
                report,
                {
                    "schema_version": 1,
                    "status": status,
                    "workspace_id": workspace_id,
                    "migration_id": migration_id,
                    "migration_kind": migration_kind,
                    "previous_migration_id": previous_migration_id,
                    "authority": "sqlite",
                    "manifest": _workspace_report_path(
                        content.storage_authority,
                        workspace,
                    ),
                    "canvas_database": _workspace_report_path(
                        content.canvas_content,
                        workspace,
                    ),
                    "generation_run_database": _workspace_report_path(
                        content.generation_run_store,
                        workspace,
                    ),
                    "legacy_archive_report": _workspace_report_path(
                        archive_report,
                        workspace,
                    ),
                    "recovery_manifest": _workspace_report_path(
                        content.canvas_content.parent
                        / "recovery"
                        / migration_id
                        / "recovery-manifest.json",
                        workspace,
                    ),
                    "verified": True,
                },
            )
        except Exception as exc:
            rollback_report = ""
            authority_published = False
            if content.storage_authority.is_file():
                try:
                    current_manifest = json.loads(
                        content.storage_authority.read_text(encoding="utf-8-sig")
                    )
                    authority_published = (
                        isinstance(current_manifest, Mapping)
                        and current_manifest.get("migration_id") == migration_id
                    )
                except (OSError, UnicodeError, json.JSONDecodeError):
                    authority_published = False
            if published and content.storage_authority.exists():
                try:
                    rollback = _rollback_locked(
                        content,
                        workspace_id=workspace_id,
                        migration_id=migration_id,
                        report_directory=reports,
                    )
                    rollback_report = _operator_report_path(
                        rollback.report,
                        reports,
                    )
                except Exception as rollback_exc:
                    rollback_report = f"failed:{type(rollback_exc).__name__}"
            _write_json_atomic(
                report,
                {
                    "schema_version": 1,
                    "status": "failed",
                    "workspace_id": workspace_id,
                    "migration_id": migration_id,
                    "failed_phase": phase,
                    "reason": str(exc) or type(exc).__name__,
                    "authority_published_before_failure": authority_published,
                    "automatic_rollback_report": rollback_report,
                },
            )
            if isinstance(exc, OfflineSqliteMigrationError):
                raise
            raise OfflineSqliteMigrationError(str(exc)) from exc
    return OfflineSqliteMigration(
        ok=True,
        workspace_id=workspace_id,
        migration_id=migration_id,
        status=status,
        report=report,
        manifest=content.storage_authority,
        legacy_archive_report=archive_report,
    )


__all__ = [
    "OfflineSqliteMigration",
    "OfflineSqliteMigrationError",
    "OfflineSqliteRollback",
    "migrate_workspace_sqlite_authority",
    "rollback_workspace_sqlite_authority",
]
