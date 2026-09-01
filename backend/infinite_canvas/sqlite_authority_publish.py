"""Verified, manifest-last publication of prepared SQLite authority."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .canvas_store import SqliteCanvasStore
from .content import WorkspaceContent
from .generation_run_store import SqliteGenerationRunStore
from .legacy_generation_archive import (
    archive_legacy_generation_json,
    restore_legacy_generation_json,
)
from .sqlite_legacy_export import export_sqlite_to_legacy
from .sqlite_migration import SqliteMigrationPreparation


class SqliteAuthorityPublishError(RuntimeError):
    """Prepared SQLite storage cannot be published without losing safety."""


@dataclass(frozen=True)
class SqliteAuthorityPublication:
    ok: bool
    workspace_id: str
    migration_id: str
    manifest: Path
    canvas_database: Path
    generation_run_database: Path
    legacy_export_report: Path
    legacy_archive_report: Path


def _load_json(path: Path) -> Mapping[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SqliteAuthorityPublishError(
            f"无法验证发布前报告：{path.name}"
        ) from exc
    if not isinstance(value, Mapping):
        raise SqliteAuthorityPublishError(f"发布前报告格式无效：{path.name}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sqlite_integrity(path: Path) -> bool:
    connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    try:
        integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
        foreign_keys = list(connection.execute("PRAGMA foreign_key_check"))
        return integrity == ["ok"] and not foreign_keys
    except sqlite3.Error:
        return False
    finally:
        connection.close()


def _backup_database(source: Path, destination: Path) -> None:
    source_connection = sqlite3.connect(
        f"file:{source.resolve()}?mode=ro",
        uri=True,
    )
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
        destination_connection.commit()
    finally:
        destination_connection.close()
        source_connection.close()
    if not _sqlite_integrity(destination):
        raise SqliteAuthorityPublishError(
            f"发布副本完整性检查失败：{source.name}"
        )


def _fsync_published_databases(*paths: Path) -> None:
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


def _write_atomic_json(path: Path, value: Mapping[str, object]) -> None:
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


def _write_manifest(path: Path, value: Mapping[str, object]) -> None:
    """Final authority commit point, kept separate for failure injection."""

    _write_atomic_json(path, value)


def publish_sqlite_authority(
    content: WorkspaceContent,
    prepared: SqliteMigrationPreparation,
) -> SqliteAuthorityPublication:
    """Publish both databases first and the all-SQLite manifest last."""

    if content.storage_authority.exists():
        raise SqliteAuthorityPublishError("Workspace 已有存储权威，拒绝重复发布")

    migration_root = (
        content.canvas_content.parent / "recovery" / prepared.migration_id
    ).resolve()
    expected_staging = migration_root / "staging"
    if (
        prepared.staging_directory.resolve() != expected_staging
        or prepared.canvas_database.resolve()
        != expected_staging / "canvas-content.sqlite3"
        or prepared.generation_run_database.resolve()
        != expected_staging / "generation-runs.sqlite3"
    ):
        raise SqliteAuthorityPublishError("migration staging 不属于当前 Workspace")

    report = _load_json(prepared.preparation_report)
    composer = report.get("composer_audit")
    if (
        report.get("status") != "ready"
        or report.get("phase") != "complete"
        or report.get("authority_published") is not False
        or not isinstance(composer, Mapping)
        or composer.get("differences") not in ([], ())
    ):
        raise SqliteAuthorityPublishError("migration preparation 尚未通过全部 Gate")
    if (
        report.get("canvas_database_sha256")
        != _sha256(prepared.canvas_database)
        or report.get("generation_run_database_sha256")
        != _sha256(prepared.generation_run_database)
    ):
        raise SqliteAuthorityPublishError(
            "staging SQLite 在审计后发生变化，拒绝发布"
        )

    canvas_store = SqliteCanvasStore(
        prepared.canvas_database,
        workspace_id=prepared.workspace_id,
    )
    run_store = SqliteGenerationRunStore(
        prepared.generation_run_database,
        workspace_id=prepared.workspace_id,
    )
    if not canvas_store.integrity().get("ok") or not run_store.integrity().get("ok"):
        raise SqliteAuthorityPublishError("staging SQLite 完整性检查失败")

    legacy_export = export_sqlite_to_legacy(
        prepared.canvas_database,
        prepared.generation_run_database,
        workspace_id=prepared.workspace_id,
        destination=migration_root / "legacy-export",
    )
    legacy_report = legacy_export.destination / "legacy-export-report.json"
    if _load_json(legacy_report).get("verified") is not True:
        raise SqliteAuthorityPublishError("legacy export 验证未通过")

    content.canvas_content.parent.mkdir(parents=True, exist_ok=True)
    publication_intent_path = migration_root / "publication-intent.json"
    existing_databases = (
        content.canvas_content.exists(),
        content.generation_run_store.exists(),
    )
    if any(existing_databases):
        if not publication_intent_path.is_file():
            raise SqliteAuthorityPublishError(
                "发现无法证明来源的正式 SQLite 数据库；JSON authority 保持不变"
            )
        intent = _load_json(publication_intent_path)
        canvas_sha256 = str(intent.get("canvas_sha256") or "")
        run_sha256 = str(intent.get("generation_runs_sha256") or "")
        if (
            intent.get("schema_version") != 1
            or intent.get("workspace_id") != prepared.workspace_id
            or intent.get("migration_id") != prepared.migration_id
            or intent.get("phase") not in {"prepared", "databases_durable"}
            or intent.get("legacy_export_report_sha256") != _sha256(legacy_report)
        ):
            raise SqliteAuthorityPublishError(
                "崩溃恢复数据库与 publication intent 不一致；"
                "JSON authority 保持不变"
            )
        if content.canvas_content.exists() and (
            _sha256(content.canvas_content) != canvas_sha256
            or not _sqlite_integrity(content.canvas_content)
        ):
            raise SqliteAuthorityPublishError(
                "崩溃恢复 Canvas 数据库与 publication intent 不一致；"
                "JSON authority 保持不变"
            )
        if content.generation_run_store.exists() and (
            _sha256(content.generation_run_store) != run_sha256
            or not _sqlite_integrity(content.generation_run_store)
        ):
            raise SqliteAuthorityPublishError(
                "崩溃恢复 Generation Run 数据库与 publication intent 不一致；"
                "JSON authority 保持不变"
            )
        canvas_resume = content.canvas_content.with_name(
            f".{content.canvas_content.name}.{uuid.uuid4().hex}.resume"
        )
        run_resume = content.generation_run_store.with_name(
            f".{content.generation_run_store.name}.{uuid.uuid4().hex}.resume"
        )
        try:
            if not content.canvas_content.exists():
                _backup_database(prepared.canvas_database, canvas_resume)
                canvas_sha256 = _sha256(canvas_resume)
            if not content.generation_run_store.exists():
                _backup_database(prepared.generation_run_database, run_resume)
                run_sha256 = _sha256(run_resume)
            _write_atomic_json(
                publication_intent_path,
                {
                    "schema_version": 1,
                    "workspace_id": prepared.workspace_id,
                    "migration_id": prepared.migration_id,
                    "canvas_sha256": canvas_sha256,
                    "generation_runs_sha256": run_sha256,
                    "legacy_export_report_sha256": _sha256(legacy_report),
                },
            )
            if canvas_resume.exists():
                os.replace(canvas_resume, content.canvas_content)
            if run_resume.exists():
                os.replace(run_resume, content.generation_run_store)
            _fsync_published_databases(
                content.canvas_content,
                content.generation_run_store,
            )
            _write_atomic_json(
                publication_intent_path,
                {
                    "schema_version": 1,
                    "workspace_id": prepared.workspace_id,
                    "migration_id": prepared.migration_id,
                    "phase": "databases_durable",
                    "canvas_sha256": canvas_sha256,
                    "generation_runs_sha256": run_sha256,
                    "legacy_export_report_sha256": _sha256(legacy_report),
                },
            )
        finally:
            for path in (canvas_resume, run_resume):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
        try:
            _write_manifest(
                content.storage_authority,
                {
                    "schema_version": 1,
                    "workspace_id": prepared.workspace_id,
                    "migration_id": prepared.migration_id,
                    "canvas": "sqlite",
                    "generation_runs": "sqlite",
                    "canvas_sha256": canvas_sha256,
                    "generation_runs_sha256": run_sha256,
                    "legacy_export_report_sha256": _sha256(legacy_report),
                },
            )
            legacy_archive_report = archive_legacy_generation_json(
                content,
                workspace_id=prepared.workspace_id,
                migration_id=prepared.migration_id,
                recovery_manifest=prepared.recovery_manifest,
            )
        except Exception as publish_exc:
            try:
                restore_legacy_generation_json(
                    content,
                    workspace_id=prepared.workspace_id,
                    migration_id=prepared.migration_id,
                    recovery_manifest=prepared.recovery_manifest,
                )
            except Exception as restore_exc:
                raise SqliteAuthorityPublishError(
                    "SQLite authority 已发布，但 legacy source 无法精确恢复；"
                    "已保留 manifest 与数据库，请用同一 migration ID 恢复"
                ) from restore_exc
            try:
                content.storage_authority.unlink()
            except FileNotFoundError:
                pass
            for path in (
                content.canvas_content,
                content.generation_run_store,
            ):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            raise publish_exc
        return SqliteAuthorityPublication(
            ok=True,
            workspace_id=prepared.workspace_id,
            migration_id=prepared.migration_id,
            manifest=content.storage_authority,
            canvas_database=content.canvas_content,
            generation_run_database=content.generation_run_store,
            legacy_export_report=legacy_report,
            legacy_archive_report=legacy_archive_report,
        )

    canvas_temporary = content.canvas_content.with_name(
        f".{content.canvas_content.name}.{uuid.uuid4().hex}.publish"
    )
    run_temporary = content.generation_run_store.with_name(
        f".{content.generation_run_store.name}.{uuid.uuid4().hex}.publish"
    )
    published_paths: list[Path] = []
    try:
        _backup_database(prepared.canvas_database, canvas_temporary)
        _backup_database(prepared.generation_run_database, run_temporary)
        canvas_sha256 = _sha256(canvas_temporary)
        run_sha256 = _sha256(run_temporary)
        legacy_report_sha256 = _sha256(legacy_report)
        _write_atomic_json(
            publication_intent_path,
            {
                "schema_version": 1,
                "workspace_id": prepared.workspace_id,
                "migration_id": prepared.migration_id,
                "phase": "prepared",
                "canvas_sha256": canvas_sha256,
                "generation_runs_sha256": run_sha256,
                "legacy_export_report_sha256": legacy_report_sha256,
            },
        )
        os.replace(canvas_temporary, content.canvas_content)
        published_paths.append(content.canvas_content)
        os.replace(run_temporary, content.generation_run_store)
        published_paths.append(content.generation_run_store)
        _fsync_published_databases(
            content.canvas_content,
            content.generation_run_store,
        )
        _write_atomic_json(
            publication_intent_path,
            {
                "schema_version": 1,
                "workspace_id": prepared.workspace_id,
                "migration_id": prepared.migration_id,
                "phase": "databases_durable",
                "canvas_sha256": canvas_sha256,
                "generation_runs_sha256": run_sha256,
                "legacy_export_report_sha256": legacy_report_sha256,
            },
        )
        _write_manifest(
            content.storage_authority,
            {
                "schema_version": 1,
                "workspace_id": prepared.workspace_id,
                "migration_id": prepared.migration_id,
                "canvas": "sqlite",
                "generation_runs": "sqlite",
                "canvas_sha256": canvas_sha256,
                "generation_runs_sha256": run_sha256,
                "legacy_export_report_sha256": legacy_report_sha256,
            },
        )
        legacy_archive_report = archive_legacy_generation_json(
            content,
            workspace_id=prepared.workspace_id,
            migration_id=prepared.migration_id,
            recovery_manifest=prepared.recovery_manifest,
        )
    except Exception as publish_exc:
        if content.storage_authority.exists():
            try:
                restore_legacy_generation_json(
                    content,
                    workspace_id=prepared.workspace_id,
                    migration_id=prepared.migration_id,
                    recovery_manifest=prepared.recovery_manifest,
                )
            except Exception as restore_exc:
                raise SqliteAuthorityPublishError(
                    "SQLite authority 已发布，但 legacy source 无法精确恢复；"
                    "已保留 manifest 与数据库，请用同一 migration ID 恢复"
                ) from restore_exc
            try:
                content.storage_authority.unlink()
            except FileNotFoundError:
                pass
        for path in published_paths:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        raise publish_exc
    finally:
        for path in (canvas_temporary, run_temporary):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    return SqliteAuthorityPublication(
        ok=True,
        workspace_id=prepared.workspace_id,
        migration_id=prepared.migration_id,
        manifest=content.storage_authority,
        canvas_database=content.canvas_content,
        generation_run_database=content.generation_run_store,
        legacy_export_report=legacy_report,
        legacy_archive_report=legacy_archive_report,
    )


__all__ = [
    "SqliteAuthorityPublication",
    "SqliteAuthorityPublishError",
    "publish_sqlite_authority",
]
