"""Offline Phase 2 upgrade for an already-published SQLite Workspace.

Early controlled cutovers published Canvas and Generation Run SQLite stores
before Global History and History / Notification receipts had a SQLite model.
This module upgrades that exact shape without withdrawing the existing SQLite
authority or treating stale Canvas JSON as authoritative again.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canvas_store import SqliteCanvasStore
from .content import WorkspaceContent
from .generation_run_lifecycle import map_generation_run_lifecycle
from .generation_run_store import (
    GenerationRunStoreError,
    SqliteGenerationRunStore,
)
from .legacy_generation_archive import (
    archive_legacy_generation_json,
    restore_legacy_generation_json,
)
from .sqlite_legacy_export import export_sqlite_to_legacy
from .sqlite_migration import (
    SqliteMigrationError,
    _legacy_generation_runs,
    _legacy_global_history,
    _legacy_publication_receipts,
    _verify_managed_media,
    normalize_legacy_global_history,
)


class SqlitePublicationUpgradeError(RuntimeError):
    """An existing SQLite authority cannot be upgraded safely."""


_TERMINAL_RUN_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "discarded"}
)
_UPGRADE_KIND = "existing-sqlite-generation-publication"
_INLINE_MEDIA_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
}
_MAX_INLINE_MEDIA_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class SqlitePublicationUpgradePreparation:
    workspace_id: str
    migration_id: str
    previous_migration_id: str
    migration_root: Path
    recovery_manifest: Path
    preparation_report: Path
    canvas_database: Path
    generation_run_database: Path
    imported_generation_run_count: int
    preserved_generation_run_count: int
    imported_global_history_count: int
    imported_publication_receipt_count: int
    generation_run_integrity: Mapping[str, Any]


@dataclass(frozen=True)
class SqlitePublicationUpgradePublication:
    manifest: Path
    legacy_archive_report: Path
    legacy_export_report: Path
    previous_migration_id: str


@dataclass(frozen=True)
class SqlitePublicationUpgradeRollback:
    report: Path
    restored_legacy_report: Path
    retired_sqlite_directory: Path
    previous_migration_id: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_mapping(path: Path, *, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SqlitePublicationUpgradeError(f"无法读取 {label}") from exc
    if not isinstance(value, Mapping):
        raise SqlitePublicationUpgradeError(f"{label} 格式无效")
    return value


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


def _backup_database(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        destination.unlink()
    except FileNotFoundError:
        pass
    source_connection = sqlite3.connect(
        f"file:{source.resolve()}?mode=ro", uri=True
    )
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
        destination_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        destination_connection.commit()
    except sqlite3.Error as exc:
        raise SqlitePublicationUpgradeError(
            f"无法创建 SQLite staging：{source.name}"
        ) from exc
    finally:
        destination_connection.close()
        source_connection.close()


def _checkpoint_database(path: Path) -> None:
    try:
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if result is not None and int(result[0]) != 0:
                raise SqlitePublicationUpgradeError(
                    f"SQLite WAL 仍被占用：{path.name}"
                )
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise SqlitePublicationUpgradeError(
            f"无法 checkpoint SQLite：{path.name}"
        ) from exc


def _sqlite_integrity(path: Path) -> bool:
    if not path.is_file() or path.is_symlink():
        return False
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchone()
            return integrity == ("ok",) and foreign_keys is None
        finally:
            connection.close()
    except sqlite3.Error:
        return False


def _database_workspace_id(path: Path, *, metadata_table: str) -> str:
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
        try:
            row = connection.execute(
                f"SELECT value FROM {metadata_table} WHERE key = 'workspace_id'"
            ).fetchone()
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise SqlitePublicationUpgradeError(
            f"SQLite metadata 无效：{path.name}"
        ) from exc
    return str(row[0] if row else "").strip()


def _non_terminal_run_ids(path: Path) -> tuple[str, ...]:
    placeholders = ",".join("?" for _ in _TERMINAL_RUN_STATUSES)
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
        try:
            return tuple(
                str(row[0])
                for row in connection.execute(
                    f"""
                    SELECT run_id FROM generation_runs
                    WHERE status NOT IN ({placeholders})
                    ORDER BY updated_at, run_id
                    """,
                    tuple(sorted(_TERMINAL_RUN_STATUSES)),
                )
            )
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise SqlitePublicationUpgradeError(
            "无法检查现有 SQLite Generation Run"
        ) from exc


def _source_paths(content: WorkspaceContent) -> tuple[Path, ...]:
    values = [
        content.storage_authority,
        content.canvas_content,
        content.generation_run_store,
        content.generation_history,
        content.generation_effects,
        content.generation_runs,
    ]
    for database in (content.canvas_content, content.generation_run_store):
        values.extend(
            (
                database.with_name(database.name + "-wal"),
                database.with_name(database.name + "-shm"),
            )
        )
    return tuple(path for path in values if path.exists())


def _copy_recovery_sources(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    previous_migration_id: str,
    migration_root: Path,
) -> Path:
    workspace_root = content.canvas_content.parent.parent.resolve()
    source_root = migration_root / "source"
    records: list[dict[str, Any]] = []
    for source in _source_paths(content):
        if not source.is_file() or source.is_symlink():
            raise SqlitePublicationUpgradeError(
                f"升级恢复副本拒绝不安全来源：{source.name}"
            )
        resolved = source.resolve()
        try:
            relative = resolved.relative_to(workspace_root)
        except ValueError as exc:
            raise SqlitePublicationUpgradeError(
                f"升级来源超出 Workspace：{source.name}"
            ) from exc
        before = _sha256(resolved)
        destination = source_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(resolved, destination)
        copied = _sha256(destination)
        after = _sha256(resolved)
        if before != copied or before != after:
            raise SqlitePublicationUpgradeError(
                f"创建升级恢复副本时来源发生变化：{source.name}"
            )
        records.append(
            {
                "relative_path": relative.as_posix(),
                "size": destination.stat().st_size,
                "sha256": copied,
            }
        )
    required = {
        "data/storage-authority.json",
        "data/canvas-content.sqlite3",
        "data/generation-runs.sqlite3",
        "data/generation-history.json",
        "data/generation-effects.json",
        "data/generation-runs.json",
    }
    actual = {str(record["relative_path"]) for record in records}
    missing = sorted(required - actual)
    if missing:
        raise SqlitePublicationUpgradeError(
            "早期 SQLite upgrade 缺少必要来源：" + ", ".join(missing)
        )
    manifest = migration_root / "recovery-manifest.json"
    _write_json_atomic(
        manifest,
        {
            "schema_version": 1,
            "migration_kind": _UPGRADE_KIND,
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "previous_migration_id": previous_migration_id,
            "sources": records,
        },
    )
    return manifest


def _recovery_sources(
    recovery_manifest: Path,
    *,
    workspace_id: str,
    migration_id: str,
    previous_migration_id: str,
) -> dict[str, Mapping[str, Any]]:
    manifest = _load_mapping(recovery_manifest, label="upgrade recovery manifest")
    if (
        manifest.get("migration_kind") != _UPGRADE_KIND
        or manifest.get("workspace_id") != workspace_id
        or manifest.get("migration_id") != migration_id
        or manifest.get("previous_migration_id") != previous_migration_id
        or not isinstance(manifest.get("sources"), list)
    ):
        raise SqlitePublicationUpgradeError(
            "upgrade recovery manifest 与本次操作不一致"
        )
    source_root = recovery_manifest.parent / "source"
    records: dict[str, Mapping[str, Any]] = {}
    for raw in manifest["sources"]:
        if not isinstance(raw, Mapping):
            raise SqlitePublicationUpgradeError("upgrade recovery source 无效")
        relative = str(raw.get("relative_path") or "")
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise SqlitePublicationUpgradeError("upgrade recovery 路径无效")
        copy = source_root / relative_path
        if (
            not copy.is_file()
            or copy.is_symlink()
            or _sha256(copy) != str(raw.get("sha256") or "")
        ):
            raise SqlitePublicationUpgradeError(
                f"upgrade recovery copy 校验失败：{relative_path.name}"
            )
        records[relative] = raw
    return records


def _source_copy(recovery_manifest: Path, relative: str) -> Path:
    return recovery_manifest.parent / "source" / Path(relative)


def _validate_media_signature(mime_type: str, payload: bytes) -> None:
    signatures = {
        "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
        "image/webp": lambda value: (
            len(value) >= 12
            and value.startswith(b"RIFF")
            and value[8:12] == b"WEBP"
        ),
    }
    validator = signatures.get(mime_type)
    if validator is not None and not validator(payload):
        raise SqlitePublicationUpgradeError(
            f"inline media 内容与 MIME 不一致：{mime_type}"
        )


def _materialize_inline_media(
    value: Any,
    *,
    content: WorkspaceContent,
    migration_id: str,
    staging_root: Path,
    records: dict[str, dict[str, Any]],
) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _materialize_inline_media(
                item,
                content=content,
                migration_id=migration_id,
                staging_root=staging_root,
                records=records,
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [
            _materialize_inline_media(
                item,
                content=content,
                migration_id=migration_id,
                staging_root=staging_root,
                records=records,
            )
            for item in value
        ]
    if not (
        isinstance(value, str)
        and value.startswith("data:")
        and ";base64," in value
    ):
        return value
    header, encoded = value.split(",", 1)
    mime_type = header[5:].split(";", 1)[0].strip().lower()
    extension = _INLINE_MEDIA_EXTENSIONS.get(mime_type)
    if extension is None:
        raise SqlitePublicationUpgradeError(
            f"inline media MIME 不受迁移器支持：{mime_type or 'unknown'}"
        )
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise SqlitePublicationUpgradeError("inline media base64 无效") from exc
    if not payload or len(payload) > _MAX_INLINE_MEDIA_BYTES:
        raise SqlitePublicationUpgradeError("inline media 大小无效")
    _validate_media_signature(mime_type, payload)
    digest = hashlib.sha256(payload).hexdigest()
    workspace_relative = (
        Path("assets")
        / "input"
        / "migrations"
        / migration_id
        / f"{digest}{extension}"
    )
    relative = workspace_relative.as_posix()
    staging = staging_root / workspace_relative.relative_to("assets")
    staging.parent.mkdir(parents=True, exist_ok=True)
    if staging.exists():
        if staging.is_symlink() or _sha256(staging) != digest:
            raise SqlitePublicationUpgradeError(
                f"inline media staging 冲突：{staging.name}"
            )
    else:
        temporary = staging.with_name(f".{staging.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, staging)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
    destination = content.canvas_content.parent.parent / workspace_relative
    destination_existed = destination.exists()
    if destination_existed and (
        not destination.is_file()
        or destination.is_symlink()
        or _sha256(destination) != digest
    ):
        raise SqlitePublicationUpgradeError(
            f"inline media 正式目标冲突：{destination.name}"
        )
    records.setdefault(
        relative,
        {
            "relative_path": relative,
            "staging_path": (
                Path("staging-managed-media")
                / workspace_relative.relative_to("assets")
            ).as_posix(),
            "mime_type": mime_type,
            "size": len(payload),
            "sha256": digest,
            "created_by_migration": not destination_existed,
        },
    )
    return "/" + relative


def _managed_media_records(
    prepared: SqlitePublicationUpgradePreparation,
) -> tuple[Mapping[str, Any], ...]:
    report = _load_mapping(
        prepared.preparation_report, label="upgrade preparation report"
    )
    values = report.get("materialized_inline_media")
    if not isinstance(values, list):
        raise SqlitePublicationUpgradeError(
            "upgrade preparation 缺少 inline media audit"
        )
    records: list[Mapping[str, Any]] = []
    workspace_root = prepared.migration_root.parents[2]
    expected_prefix = Path("assets") / "input" / "migrations" / prepared.migration_id
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, Mapping):
            raise SqlitePublicationUpgradeError("inline media audit 记录无效")
        relative = Path(str(value.get("relative_path") or ""))
        staging_relative = Path(str(value.get("staging_path") or ""))
        expected_staging = (
            Path("staging-managed-media") / relative.relative_to("assets")
            if relative.parts and relative.parts[0] == "assets"
            else Path()
        )
        expected_sha = str(value.get("sha256") or "")
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or tuple(relative.parts[:4]) != tuple(expected_prefix.parts)
            or staging_relative.is_absolute()
            or ".." in staging_relative.parts
            or staging_relative != expected_staging
            or len(expected_sha) != 64
            or any(character not in "0123456789abcdef" for character in expected_sha)
            or not isinstance(value.get("size"), int)
            or int(value["size"]) <= 0
            or int(value["size"]) > _MAX_INLINE_MEDIA_BYTES
            or str(value.get("mime_type") or "") not in _INLINE_MEDIA_EXTENSIONS
            or not isinstance(value.get("created_by_migration"), bool)
            or relative.as_posix() in seen
        ):
            raise SqlitePublicationUpgradeError("inline media audit 路径无效")
        staging = prepared.migration_root / staging_relative
        destination = workspace_root / relative
        if (
            not staging.is_file()
            or staging.is_symlink()
            or _sha256(staging) != expected_sha
            or staging.stat().st_size != int(value["size"])
            or destination.resolve().parent.parent.parent
            != (workspace_root / "assets" / "input").resolve()
        ):
            raise SqlitePublicationUpgradeError(
                f"inline media staging 校验失败：{relative.name}"
            )
        seen.add(relative.as_posix())
        records.append(dict(value))
    return tuple(records)


def _managed_media_digest(records: tuple[Mapping[str, Any], ...]) -> str:
    return hashlib.sha256(
        json.dumps(
            [dict(record) for record in records],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _publish_materialized_media(
    prepared: SqlitePublicationUpgradePreparation,
    records: tuple[Mapping[str, Any], ...],
) -> None:
    workspace_root = prepared.migration_root.parents[2]
    for record in records:
        relative = Path(str(record["relative_path"]))
        source = prepared.migration_root / str(record["staging_path"])
        destination = workspace_root / relative
        expected_sha = str(record["sha256"])
        if destination.exists():
            if (
                not destination.is_file()
                or destination.is_symlink()
                or _sha256(destination) != expected_sha
            ):
                raise SqlitePublicationUpgradeError(
                    f"inline media 发布目标冲突：{destination.name}"
                )
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.publish"
        )
        try:
            shutil.copy2(source, temporary)
            if _sha256(temporary) != expected_sha:
                raise SqlitePublicationUpgradeError(
                    f"inline media 发布校验失败：{destination.name}"
                )
            os.replace(temporary, destination)
            directory_fd = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _cleanup_materialized_media(
    prepared: SqlitePublicationUpgradePreparation,
    records: tuple[Mapping[str, Any], ...],
) -> None:
    workspace_root = prepared.migration_root.parents[2]
    for record in records:
        if not bool(record.get("created_by_migration")):
            continue
        destination = workspace_root / str(record["relative_path"])
        if destination.exists():
            if (
                destination.is_symlink()
                or _sha256(destination) != str(record.get("sha256") or "")
            ):
                raise SqlitePublicationUpgradeError(
                    f"inline media 自动清理发现内容变化：{destination.name}"
                )
            destination.unlink()


def _validate_published_materialized_media(
    prepared: SqlitePublicationUpgradePreparation,
    records: tuple[Mapping[str, Any], ...],
) -> tuple[Mapping[str, Any], ...]:
    workspace_root = prepared.migration_root.parents[2]
    owned = tuple(
        record for record in records if bool(record.get("created_by_migration"))
    )
    for record in owned:
        destination = workspace_root / str(record["relative_path"])
        if (
            not destination.is_file()
            or destination.is_symlink()
            or _sha256(destination) != str(record["sha256"])
        ):
            raise SqlitePublicationUpgradeError(
                f"inline media 已变化；拒绝自动回滚：{destination.name}"
            )
    return owned


def _retire_materialized_media(
    prepared: SqlitePublicationUpgradePreparation,
    records: tuple[Mapping[str, Any], ...],
) -> tuple[Path, int]:
    workspace_root = prepared.migration_root.parents[2]
    owned = _validate_published_materialized_media(prepared, records)
    retired = prepared.migration_root / "rollback" / "retired-materialized-media"
    retired.mkdir(parents=True, exist_ok=True)
    for record in owned:
        relative = Path(str(record["relative_path"]))
        source = workspace_root / relative
        destination = retired / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if (
                not destination.is_file()
                or destination.is_symlink()
                or _sha256(destination) != str(record["sha256"])
            ):
                raise SqlitePublicationUpgradeError(
                    f"inline media 回滚归档冲突：{source.name}"
                )
            source.unlink()
        else:
            os.replace(source, destination)
    return retired, len(owned)


def _report_failure(
    path: Path,
    *,
    workspace_id: str,
    migration_id: str,
    previous_migration_id: str,
    phase: str,
    reason: str,
    details: Mapping[str, Any] | None = None,
) -> None:
    _write_json_atomic(
        path,
        {
            "schema_version": 1,
            "migration_kind": _UPGRADE_KIND,
            "status": "failed",
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "previous_migration_id": previous_migration_id,
            "phase": phase,
            "reason": reason,
            **dict(details or {}),
        },
    )


def _operator_resolution(
    migration_root: Path,
    *,
    workspace_id: str,
    migration_id: str,
) -> tuple[frozenset[str], Mapping[str, Any] | None]:
    path = migration_root / "operator-resolution.json"
    if not path.exists():
        return frozenset(), None
    if not path.is_file() or path.is_symlink():
        raise SqlitePublicationUpgradeError("operator resolution 路径不安全")
    value = _load_mapping(path, label="operator resolution")
    raw_ids = value.get("quarantine_missing_global_history_ids")
    if (
        value.get("schema_version") != 1
        or value.get("workspace_id") != workspace_id
        or value.get("migration_id") != migration_id
        or value.get("confirmed_irrecoverable") is not True
        or value.get("reason")
        != "operator_confirmed_irrecoverable_managed_media"
        or not isinstance(raw_ids, list)
        or not raw_ids
        or len(raw_ids) > 10_000
    ):
        raise SqlitePublicationUpgradeError("operator resolution 格式无效")
    ids: list[str] = []
    for raw_id in raw_ids:
        history_id = str(raw_id or "").strip()
        if not history_id or len(history_id) > 512 or history_id in ids:
            raise SqlitePublicationUpgradeError(
                "operator resolution History ID 无效"
            )
        ids.append(history_id)
    return frozenset(ids), {
        "relative_path": "operator-resolution.json",
        "sha256": _sha256(path),
        "quarantine_missing_global_history_ids": ids,
        "confirmed_irrecoverable": True,
        "reason": "operator_confirmed_irrecoverable_managed_media",
    }


def _validate_reported_operator_resolution(
    prepared: SqlitePublicationUpgradePreparation,
    report: Mapping[str, Any],
) -> None:
    _ids, current = _operator_resolution(
        prepared.migration_root,
        workspace_id=prepared.workspace_id,
        migration_id=prepared.migration_id,
    )
    recorded = report.get("operator_resolution")
    if current is None and recorded is None:
        return
    if not isinstance(recorded, Mapping) or current != dict(recorded):
        raise SqlitePublicationUpgradeError(
            "operator resolution 与 ready preparation 不一致"
        )


def _ready_preparation(
    *,
    workspace_id: str,
    migration_id: str,
    previous_migration_id: str,
    migration_root: Path,
) -> SqlitePublicationUpgradePreparation | None:
    report_path = migration_root / "preparation-report.json"
    recovery_manifest = migration_root / "recovery-manifest.json"
    if not report_path.is_file() or not recovery_manifest.is_file():
        return None
    report = _load_mapping(report_path, label="upgrade preparation report")
    if report.get("status") != "ready":
        return None
    if (
        report.get("migration_kind") != _UPGRADE_KIND
        or report.get("workspace_id") != workspace_id
        or report.get("migration_id") != migration_id
        or report.get("previous_migration_id") != previous_migration_id
    ):
        raise SqlitePublicationUpgradeError(
            "已有 upgrade preparation 与本次操作不一致"
        )
    _recovery_sources(
        recovery_manifest,
        workspace_id=workspace_id,
        migration_id=migration_id,
        previous_migration_id=previous_migration_id,
    )
    staging = migration_root / "staging"
    canvas_database = staging / "canvas-content.sqlite3"
    run_database = staging / "generation-runs.sqlite3"
    if (
        not canvas_database.is_file()
        or not run_database.is_file()
        or _sha256(canvas_database) != report.get("canvas_database_sha256")
        or _sha256(run_database)
        != report.get("generation_run_database_sha256")
    ):
        raise SqlitePublicationUpgradeError(
            "已有 upgrade staging 与审计报告不一致"
        )
    canvas_store = SqliteCanvasStore(canvas_database, workspace_id=workspace_id)
    run_store = SqliteGenerationRunStore(run_database, workspace_id=workspace_id)
    if not canvas_store.integrity().get("ok") or not run_store.integrity().get("ok"):
        raise SqlitePublicationUpgradeError("已有 upgrade staging 完整性失败")
    integrity = run_store.integrity()
    prepared = SqlitePublicationUpgradePreparation(
        workspace_id=workspace_id,
        migration_id=migration_id,
        previous_migration_id=previous_migration_id,
        migration_root=migration_root,
        recovery_manifest=recovery_manifest,
        preparation_report=report_path,
        canvas_database=canvas_database,
        generation_run_database=run_database,
        imported_generation_run_count=int(
            report.get("imported_generation_run_count") or 0
        ),
        preserved_generation_run_count=int(
            report.get("preserved_generation_run_count") or 0
        ),
        imported_global_history_count=int(
            report.get("imported_global_history_count") or 0
        ),
        imported_publication_receipt_count=int(
            report.get("imported_publication_receipt_count") or 0
        ),
        generation_run_integrity=integrity,
    )
    _managed_media_records(prepared)
    _validate_reported_operator_resolution(prepared, report)
    return prepared


def prepare_existing_sqlite_publication_upgrade(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    previous_migration_id: str,
) -> SqlitePublicationUpgradePreparation:
    """Build a verified schema-2 staging copy without changing authority."""

    workspace_id = str(workspace_id or "").strip()
    migration_id = str(migration_id or "").strip()
    previous_migration_id = str(previous_migration_id or "").strip()
    if not workspace_id or not migration_id or not previous_migration_id:
        raise SqlitePublicationUpgradeError("existing SQLite upgrade identity 不完整")
    migration_root = content.canvas_content.parent / "recovery" / migration_id
    report = migration_root / "preparation-report.json"
    phase = "sqlite_preflight"
    manual_actions: list[dict[str, Any]] = []
    materialized_media: dict[str, dict[str, Any]] = {}
    quarantined_history: list[dict[str, Any]] = []
    operator_resolution_audit: Mapping[str, Any] | None = None
    try:
        non_terminal = _non_terminal_run_ids(content.generation_run_store)
        if non_terminal:
            raise SqlitePublicationUpgradeError(
                "仍有未结束 Generation Run，拒绝升级 SQLite publication："
                + ", ".join(non_terminal[:10])
            )
        if (
            not _sqlite_integrity(content.canvas_content)
            or not _sqlite_integrity(content.generation_run_store)
        ):
            raise SqlitePublicationUpgradeError("现有 SQLite authority 完整性失败")
        if (
            _database_workspace_id(
                content.canvas_content, metadata_table="store_metadata"
            )
            != workspace_id
            or _database_workspace_id(
                content.generation_run_store,
                metadata_table="generation_run_store_metadata",
            )
            != workspace_id
        ):
            raise SqlitePublicationUpgradeError(
                "现有 SQLite authority 不属于当前 Workspace"
            )
        if migration_root.exists():
            if not migration_root.is_dir() or migration_root.is_symlink():
                raise SqlitePublicationUpgradeError("upgrade migration 路径不安全")
            ready = _ready_preparation(
                workspace_id=workspace_id,
                migration_id=migration_id,
                previous_migration_id=previous_migration_id,
                migration_root=migration_root,
            )
            if ready is not None:
                return ready
            staging = migration_root / "staging"
            if staging.exists():
                attempts = migration_root / "attempts"
                attempts.mkdir(exist_ok=True)
                os.replace(staging, attempts / f"staging-{uuid.uuid4().hex}")
        else:
            migration_root.mkdir(parents=True)

        phase = "operator_resolution"
        quarantine_history_ids, operator_resolution_audit = (
            _operator_resolution(
                migration_root,
                workspace_id=workspace_id,
                migration_id=migration_id,
            )
        )

        phase = "recovery_copy"
        recovery_manifest = migration_root / "recovery-manifest.json"
        if recovery_manifest.is_file():
            records = _recovery_sources(
                recovery_manifest,
                workspace_id=workspace_id,
                migration_id=migration_id,
                previous_migration_id=previous_migration_id,
            )
            workspace_root = content.canvas_content.parent.parent
            for relative, record in records.items():
                current = workspace_root / relative
                if (
                    not current.is_file()
                    or current.is_symlink()
                    or _sha256(current) != str(record.get("sha256") or "")
                ):
                    raise SqlitePublicationUpgradeError(
                        f"同一 migration ID 的 upgrade 来源已变化：{Path(relative).name}"
                    )
        else:
            _checkpoint_database(content.canvas_content)
            _checkpoint_database(content.generation_run_store)
            if (
                not _sqlite_integrity(content.canvas_content)
                or not _sqlite_integrity(content.generation_run_store)
            ):
                raise SqlitePublicationUpgradeError(
                    "SQLite checkpoint 后完整性失败"
                )
            recovery_manifest = _copy_recovery_sources(
                content,
                workspace_id=workspace_id,
                migration_id=migration_id,
                previous_migration_id=previous_migration_id,
                migration_root=migration_root,
            )

        recovery_data = recovery_manifest.parent / "source" / "data"
        phase = "legacy_run_preflight"
        legacy_runs = _legacy_generation_runs(
            recovery_data / "generation-runs.json"
        )
        legacy_non_terminal = [
            str(run.get("id") or "unknown")
            for run in legacy_runs
            if str(run.get("status") or "") not in _TERMINAL_RUN_STATUSES
        ]
        if legacy_non_terminal:
            raise SqlitePublicationUpgradeError(
                "legacy generation-runs.json 仍有未结束 Run："
                + ", ".join(legacy_non_terminal[:10])
            )

        phase = "create_staging"
        staging = migration_root / "staging"
        staging.mkdir(parents=True)
        canvas_database = staging / "canvas-content.sqlite3"
        run_database = staging / "generation-runs.sqlite3"
        _backup_database(content.canvas_content, canvas_database)
        _backup_database(content.generation_run_store, run_database)
        canvas_store = SqliteCanvasStore(canvas_database, workspace_id=workspace_id)
        run_store = SqliteGenerationRunStore(run_database, workspace_id=workspace_id)
        starting_integrity = run_store.integrity()
        if not canvas_store.integrity().get("ok") or not starting_integrity.get("ok"):
            raise SqlitePublicationUpgradeError("SQLite upgrade staging 初始完整性失败")

        phase = "import_missing_generation_runs"
        imported_run_count = 0
        preserved_run_count = 0
        runs_by_id: dict[str, Any] = {}
        for legacy_run in legacy_runs:
            legacy_run_id = str(legacy_run.get("id") or "")
            existing = run_store.load(legacy_run_id) if legacy_run_id else None
            if existing is not None:
                # The current SQLite store is already the declared authority.
                # A same-ID legacy record may never overwrite it, even if its
                # timestamp appears newer after old dual-write behavior.
                preserved_run_count += 1
                runs_by_id[existing.run_id] = existing
                continue
            normalized_run = _materialize_inline_media(
                legacy_run,
                content=content,
                migration_id=migration_id,
                staging_root=migration_root / "staging-managed-media",
                records=materialized_media,
            )
            mapped = map_generation_run_lifecycle(normalized_run).state
            try:
                run_store.save(mapped)
            except GenerationRunStoreError as exc:
                raise SqlitePublicationUpgradeError(
                    f"Generation Run 无法补迁：{mapped.run_id} ({exc.code})"
                ) from exc
            imported_run_count += 1
            runs_by_id[mapped.run_id] = mapped

        phase = "import_global_history"
        history = normalize_legacy_global_history(
            _legacy_global_history(recovery_data / "generation-history.json")
        )
        history_run_ids: set[str] = set()
        imported_history_ids: set[str] = set()
        verified_media = 0
        imported_history_count = 0
        for history_id, run_id, record in reversed(history):
            try:
                verified_media += _verify_managed_media(
                    content,
                    record,
                    label=f"Global Generation History {history_id}",
                )
            except SqliteMigrationError as exc:
                if history_id in quarantine_history_ids:
                    quarantined_history.append(
                        {
                            "history_id": history_id,
                            "run_id": run_id,
                            "reason": str(exc),
                        }
                    )
                    continue
                manual_actions.append(
                    {
                        "kind": "global_history_managed_media",
                        "history_id": history_id,
                        "run_id": run_id,
                        "reason": str(exc),
                    }
                )
                continue
            if history_id in quarantine_history_ids:
                raise SqlitePublicationUpgradeError(
                    f"operator resolution 指定的 History 仍可验证：{history_id}"
                )
            try:
                run_store.publish_history(
                    run_id,
                    history_id,
                    record,
                    source="legacy-json-upgrade",
                )
            except GenerationRunStoreError as exc:
                raise SqlitePublicationUpgradeError(
                    f"Global History 无法补迁：{history_id} ({exc.code})"
                ) from exc
            imported_history_count += 1
            imported_history_ids.add(history_id)
            if run_id:
                history_run_ids.add(run_id)

        quarantined_ids = {
            item["history_id"] for item in quarantined_history
        }
        unmatched_quarantine = sorted(
            quarantine_history_ids - quarantined_ids
        )
        if unmatched_quarantine:
            raise SqlitePublicationUpgradeError(
                "operator resolution 包含不存在或不符合条件的 History："
                + ", ".join(unmatched_quarantine[:10])
            )

        phase = "import_publication_receipts"
        completed, pending = _legacy_publication_receipts(
            recovery_data / "generation-effects.json"
        )
        for run_id, names in sorted(completed.items()):
            for name in sorted(names):
                run_store.seed_publication_receipt(run_id, name, completed=True)
        pending_count = 0
        for run_id, names in sorted(pending.items()):
            outstanding = set(names)
            if "history" in outstanding and run_id in history_run_ids:
                run_store.seed_publication_receipt(
                    run_id, "history", completed=True
                )
                outstanding.remove("history")
            run = runs_by_id.get(run_id) or run_store.load(run_id)
            prepared = run.prepared_output if run is not None else None
            effects = (
                prepared.get("effects")
                if isinstance(prepared, Mapping)
                else None
            )
            for name in sorted(outstanding):
                payload = effects.get(name) if isinstance(effects, Mapping) else None
                if not isinstance(payload, Mapping):
                    manual_actions.append(
                        {
                            "kind": "pending_publication",
                            "run_id": run_id,
                            "effect": name,
                            "reason": "durable_run_or_reconstructable_payload_missing",
                        }
                    )
                    continue
                try:
                    verified = _verify_managed_media(
                        content,
                        payload,
                        label=f"pending {name} receipt {run_id}",
                    )
                except SqliteMigrationError as exc:
                    manual_actions.append(
                        {
                            "kind": "pending_publication",
                            "run_id": run_id,
                            "effect": name,
                            "reason": str(exc),
                        }
                    )
                    continue
                if verified <= 0:
                    manual_actions.append(
                        {
                            "kind": "pending_publication",
                            "run_id": run_id,
                            "effect": name,
                            "reason": "reconstructable_managed_output_missing",
                        }
                    )
                    continue
                verified_media += verified
                run_store.seed_publication_receipt(
                    run_id,
                    name,
                    completed=False,
                    payload=payload,
                    created_at=run.updated_at,
                )
                pending_count += 1
        if manual_actions:
            raise SqlitePublicationUpgradeError(
                "存在无法安全迁移的 Global History / pending effect；"
                "请按 preparation report 人工处理"
            )

        phase = "verify_staging"
        integrity = run_store.integrity()
        counts = integrity.get("counts") or {}
        if (
            not integrity.get("ok")
            or int(counts.get("history") or 0) < imported_history_count
            or int(counts.get("pending_publications") or 0) != pending_count
            or _non_terminal_run_ids(run_database)
        ):
            raise SqlitePublicationUpgradeError("SQLite upgrade staging 完整性失败")
        for history_id in imported_history_ids:
            if run_store.history_by_id(history_id) is None:
                raise SqlitePublicationUpgradeError(
                    f"SQLite upgrade 缺少 Global History：{history_id}"
                )
        publication_count = int(counts.get("publications") or 0)
        _write_json_atomic(
            report,
            {
                "schema_version": 1,
                "migration_kind": _UPGRADE_KIND,
                "status": "ready",
                "phase": "complete",
                "workspace_id": workspace_id,
                "migration_id": migration_id,
                "previous_migration_id": previous_migration_id,
                "source_authority": "sqlite",
                "authority_published": False,
                "canvas_database_sha256": _sha256(canvas_database),
                "generation_run_database_sha256": _sha256(run_database),
                "starting_generation_run_count": int(
                    (starting_integrity.get("counts") or {}).get("runs") or 0
                ),
                "legacy_generation_run_count": len(legacy_runs),
                "source_global_history_count": len(history),
                "imported_generation_run_count": imported_run_count,
                "preserved_generation_run_count": preserved_run_count,
                "imported_global_history_count": imported_history_count,
                "imported_publication_receipt_count": publication_count,
                "pending_publication_count": pending_count,
                "managed_media_verified_count": verified_media,
                "materialized_inline_media": [
                    materialized_media[key] for key in sorted(materialized_media)
                ],
                "operator_resolution": operator_resolution_audit,
                "quarantined_global_history": quarantined_history,
                "manual_actions": [],
                "canvas_integrity": canvas_store.integrity(),
                "generation_run_integrity": integrity,
            },
        )
    except Exception as exc:
        try:
            _report_failure(
                report,
                workspace_id=workspace_id,
                migration_id=migration_id,
                previous_migration_id=previous_migration_id,
                phase=phase,
                reason=str(exc) or type(exc).__name__,
                details={
                    "manual_actions": manual_actions,
                    "materialized_inline_media": [
                        materialized_media[key]
                        for key in sorted(materialized_media)
                    ],
                    "operator_resolution": operator_resolution_audit,
                    "quarantined_global_history": quarantined_history,
                },
            )
        except OSError:
            pass
        if isinstance(exc, SqlitePublicationUpgradeError):
            raise
        raise SqlitePublicationUpgradeError(str(exc)) from exc

    return SqlitePublicationUpgradePreparation(
        workspace_id=workspace_id,
        migration_id=migration_id,
        previous_migration_id=previous_migration_id,
        migration_root=migration_root,
        recovery_manifest=recovery_manifest,
        preparation_report=report,
        canvas_database=canvas_database,
        generation_run_database=run_database,
        imported_generation_run_count=imported_run_count,
        preserved_generation_run_count=preserved_run_count,
        imported_global_history_count=imported_history_count,
        imported_publication_receipt_count=publication_count,
        generation_run_integrity=integrity,
    )


def _copy_atomic(source: Path, destination: Path) -> None:
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.restore")
    try:
        shutil.copy2(source, temporary)
        if _sha256(temporary) != _sha256(source):
            raise SqlitePublicationUpgradeError(
                f"恢复文件校验失败：{destination.name}"
            )
        os.replace(temporary, destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _restore_previous_authority(
    content: WorkspaceContent,
    prepared: SqlitePublicationUpgradePreparation,
) -> None:
    records = _recovery_sources(
        prepared.recovery_manifest,
        workspace_id=prepared.workspace_id,
        migration_id=prepared.migration_id,
        previous_migration_id=prepared.previous_migration_id,
    )
    for path in (
        content.generation_run_store.with_name(
            content.generation_run_store.name + "-wal"
        ),
        content.generation_run_store.with_name(
            content.generation_run_store.name + "-shm"
        ),
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    for relative in (
        "data/generation-runs.sqlite3",
        "data/generation-runs.sqlite3-wal",
        "data/generation-runs.sqlite3-shm",
    ):
        if relative in records:
            destination = content.canvas_content.parent / Path(relative).name
            _copy_atomic(_source_copy(prepared.recovery_manifest, relative), destination)
    _copy_atomic(
        _source_copy(prepared.recovery_manifest, "data/storage-authority.json"),
        content.storage_authority,
    )
    if not _sqlite_integrity(content.generation_run_store):
        raise SqlitePublicationUpgradeError(
            "恢复后的旧 Generation Run SQLite 完整性失败"
        )


def publish_existing_sqlite_publication_upgrade(
    content: WorkspaceContent,
    prepared: SqlitePublicationUpgradePreparation,
) -> SqlitePublicationUpgradePublication:
    """Atomically replace the Run store, publish manifest last, then archive."""

    report = _load_mapping(
        prepared.preparation_report, label="upgrade preparation report"
    )
    if (
        report.get("status") != "ready"
        or report.get("source_authority") != "sqlite"
        or report.get("authority_published") is not False
        or _sha256(prepared.canvas_database)
        != report.get("canvas_database_sha256")
        or _sha256(prepared.generation_run_database)
        != report.get("generation_run_database_sha256")
    ):
        raise SqlitePublicationUpgradeError("SQLite publication upgrade 尚未通过 Gate")
    _validate_reported_operator_resolution(prepared, report)
    if (
        not SqliteCanvasStore(
            prepared.canvas_database, workspace_id=prepared.workspace_id
        ).integrity().get("ok")
        or not SqliteGenerationRunStore(
            prepared.generation_run_database,
            workspace_id=prepared.workspace_id,
        ).integrity().get("ok")
    ):
        raise SqlitePublicationUpgradeError("SQLite publication staging 完整性失败")

    materialized_media = _managed_media_records(prepared)
    materialized_media_sha256 = _managed_media_digest(materialized_media)

    records = _recovery_sources(
        prepared.recovery_manifest,
        workspace_id=prepared.workspace_id,
        migration_id=prepared.migration_id,
        previous_migration_id=prepared.previous_migration_id,
    )
    old_canvas_sha = str(records["data/canvas-content.sqlite3"].get("sha256") or "")
    old_run_sha = str(records["data/generation-runs.sqlite3"].get("sha256") or "")
    if _sha256(content.canvas_content) != old_canvas_sha:
        raise SqlitePublicationUpgradeError(
            "现有 Canvas SQLite 在 upgrade preparation 后发生变化"
        )
    current_manifest = _load_mapping(
        content.storage_authority, label="current storage authority"
    )
    if current_manifest.get("migration_id") != prepared.previous_migration_id:
        raise SqlitePublicationUpgradeError(
            "现有 SQLite authority 已不是 preparation 的来源版本"
        )

    legacy_export = export_sqlite_to_legacy(
        prepared.canvas_database,
        prepared.generation_run_database,
        workspace_id=prepared.workspace_id,
        destination=prepared.migration_root / "legacy-export",
    )
    legacy_report = legacy_export.destination / "legacy-export-report.json"
    intent_path = prepared.migration_root / "publication-intent.json"
    run_temporary = content.generation_run_store.with_name(
        f".{content.generation_run_store.name}.{uuid.uuid4().hex}.upgrade"
    )
    published_database = False
    try:
        if intent_path.is_file():
            intent = _load_mapping(intent_path, label="upgrade publication intent")
            if (
                intent.get("migration_kind") != _UPGRADE_KIND
                or intent.get("workspace_id") != prepared.workspace_id
                or intent.get("migration_id") != prepared.migration_id
                or intent.get("previous_migration_id")
                != prepared.previous_migration_id
                or intent.get("legacy_export_report_sha256")
                != _sha256(legacy_report)
                or intent.get("materialized_inline_media_sha256")
                != materialized_media_sha256
            ):
                raise SqlitePublicationUpgradeError(
                    "upgrade publication intent 与本次操作不一致"
                )
            new_run_sha = str(intent.get("generation_runs_sha256") or "")
        else:
            _backup_database(prepared.generation_run_database, run_temporary)
            new_run_sha = _sha256(run_temporary)
            _write_json_atomic(
                intent_path,
                {
                    "schema_version": 1,
                    "migration_kind": _UPGRADE_KIND,
                    "workspace_id": prepared.workspace_id,
                    "migration_id": prepared.migration_id,
                    "previous_migration_id": prepared.previous_migration_id,
                    "phase": "prepared",
                    "canvas_sha256": old_canvas_sha,
                    "previous_generation_runs_sha256": old_run_sha,
                    "generation_runs_sha256": new_run_sha,
                    "legacy_export_report_sha256": _sha256(legacy_report),
                    "materialized_inline_media_sha256": (
                        materialized_media_sha256
                    ),
                },
            )
        _publish_materialized_media(prepared, materialized_media)
        current_run_sha = _sha256(content.generation_run_store)
        if current_run_sha == old_run_sha:
            if not run_temporary.exists():
                _backup_database(prepared.generation_run_database, run_temporary)
                if _sha256(run_temporary) != new_run_sha:
                    raise SqlitePublicationUpgradeError(
                        "重建的 upgrade SQLite 与 publication intent 不一致"
                    )
            for sidecar in (
                content.generation_run_store.with_name(
                    content.generation_run_store.name + "-wal"
                ),
                content.generation_run_store.with_name(
                    content.generation_run_store.name + "-shm"
                ),
            ):
                try:
                    sidecar.unlink()
                except FileNotFoundError:
                    pass
            os.replace(run_temporary, content.generation_run_store)
            published_database = True
        elif current_run_sha != new_run_sha:
            raise SqlitePublicationUpgradeError(
                "正式 Generation Run SQLite 与旧版或 upgrade staging 均不一致"
            )
        else:
            published_database = True
        if not _sqlite_integrity(content.generation_run_store):
            raise SqlitePublicationUpgradeError(
                "发布后的 Generation Run SQLite 完整性失败"
            )
        data_fd = os.open(content.canvas_content.parent, os.O_RDONLY)
        try:
            os.fsync(data_fd)
        finally:
            os.close(data_fd)
        _write_json_atomic(
            intent_path,
            {
                "schema_version": 1,
                "migration_kind": _UPGRADE_KIND,
                "workspace_id": prepared.workspace_id,
                "migration_id": prepared.migration_id,
                "previous_migration_id": prepared.previous_migration_id,
                "phase": "database_durable",
                "canvas_sha256": old_canvas_sha,
                "previous_generation_runs_sha256": old_run_sha,
                "generation_runs_sha256": new_run_sha,
                "legacy_export_report_sha256": _sha256(legacy_report),
                "materialized_inline_media_sha256": materialized_media_sha256,
            },
        )
        _write_json_atomic(
            content.storage_authority,
            {
                "schema_version": 1,
                "workspace_id": prepared.workspace_id,
                "migration_id": prepared.migration_id,
                "previous_migration_id": prepared.previous_migration_id,
                "canvas": "sqlite",
                "generation_runs": "sqlite",
                "canvas_sha256": old_canvas_sha,
                "generation_runs_sha256": new_run_sha,
                "legacy_export_report_sha256": _sha256(legacy_report),
                "materialized_inline_media_sha256": materialized_media_sha256,
            },
        )
        archive_report = archive_legacy_generation_json(
            content,
            workspace_id=prepared.workspace_id,
            migration_id=prepared.migration_id,
            recovery_manifest=prepared.recovery_manifest,
        )
    except Exception as exc:
        try:
            if published_database or (
                content.storage_authority.is_file()
                and _load_mapping(
                    content.storage_authority, label="storage authority"
                ).get("migration_id")
                == prepared.migration_id
            ):
                restore_legacy_generation_json(
                    content,
                    workspace_id=prepared.workspace_id,
                    migration_id=prepared.migration_id,
                    recovery_manifest=prepared.recovery_manifest,
                )
                _restore_previous_authority(content, prepared)
            _cleanup_materialized_media(prepared, materialized_media)
        except Exception as restore_exc:
            raise SqlitePublicationUpgradeError(
                "upgrade 发布失败且旧 SQLite authority / inline media "
                "无法自动恢复；请保留服务停止并使用同一 migration ID 恢复"
            ) from restore_exc
        if isinstance(exc, SqlitePublicationUpgradeError):
            raise
        raise SqlitePublicationUpgradeError(str(exc)) from exc
    finally:
        try:
            run_temporary.unlink()
        except FileNotFoundError:
            pass

    return SqlitePublicationUpgradePublication(
        manifest=content.storage_authority,
        legacy_archive_report=archive_report,
        legacy_export_report=legacy_report,
        previous_migration_id=prepared.previous_migration_id,
    )


def is_existing_sqlite_upgrade(
    content: WorkspaceContent,
    *,
    migration_id: str,
) -> bool:
    report = (
        content.canvas_content.parent
        / "recovery"
        / migration_id
        / "preparation-report.json"
    )
    if not report.is_file():
        return False
    try:
        return _load_mapping(report, label="upgrade preparation report").get(
            "migration_kind"
        ) == _UPGRADE_KIND
    except SqlitePublicationUpgradeError:
        return False


def _archive_current(path: Path, destination: Path) -> None:
    if not path.exists():
        return
    if destination.exists():
        if (
            not destination.is_file()
            or destination.is_symlink()
            or path.is_symlink()
            or _sha256(destination) != _sha256(path)
        ):
            raise SqlitePublicationUpgradeError(
                f"upgrade rollback 目标冲突：{path.name}"
            )
        path.unlink()
    else:
        os.replace(path, destination)


def rollback_existing_sqlite_publication_upgrade(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    report_directory: Path,
) -> SqlitePublicationUpgradeRollback:
    """Restore the exact pre-upgrade SQLite database, manifest and JSON."""

    migration_root = content.canvas_content.parent / "recovery" / migration_id
    report = _load_mapping(
        migration_root / "preparation-report.json",
        label="upgrade preparation report",
    )
    previous_migration_id = str(report.get("previous_migration_id") or "")
    prepared = _ready_preparation(
        workspace_id=workspace_id,
        migration_id=migration_id,
        previous_migration_id=previous_migration_id,
        migration_root=migration_root,
    )
    if prepared is None:
        raise SqlitePublicationUpgradeError("upgrade rollback 缺少 ready preparation")
    current_manifest = _load_mapping(
        content.storage_authority, label="current storage authority"
    )
    if current_manifest.get("migration_id") != migration_id:
        raise SqlitePublicationUpgradeError(
            "当前 authority 不是指定的 SQLite publication upgrade"
        )
    intent = _load_mapping(
        migration_root / "publication-intent.json",
        label="upgrade publication intent",
    )
    records = _recovery_sources(
        prepared.recovery_manifest,
        workspace_id=workspace_id,
        migration_id=migration_id,
        previous_migration_id=previous_migration_id,
    )
    if (
        _sha256(content.canvas_content)
        != str(records["data/canvas-content.sqlite3"].get("sha256") or "")
        or _sha256(content.generation_run_store)
        != str(intent.get("generation_runs_sha256") or "")
    ):
        raise SqlitePublicationUpgradeError(
            "upgrade 后 SQLite 已发生新写入；拒绝用旧快照自动回滚"
        )
    materialized_media = _managed_media_records(prepared)
    if (
        intent.get("materialized_inline_media_sha256")
        != _managed_media_digest(materialized_media)
    ):
        raise SqlitePublicationUpgradeError(
            "upgrade rollback 的 inline media audit 与发布意图不一致"
        )
    _validate_published_materialized_media(prepared, materialized_media)
    restored = restore_legacy_generation_json(
        content,
        workspace_id=workspace_id,
        migration_id=migration_id,
        recovery_manifest=prepared.recovery_manifest,
    )
    retired = migration_root / "rollback" / "retired-upgraded-authority"
    retired.mkdir(parents=True, exist_ok=True)
    for source in (
        content.generation_run_store.with_name(
            content.generation_run_store.name + "-wal"
        ),
        content.generation_run_store.with_name(
            content.generation_run_store.name + "-shm"
        ),
        content.generation_run_store,
        content.storage_authority,
    ):
        _archive_current(source, retired / source.name)
    _restore_previous_authority(content, prepared)
    retired_media, retired_media_count = _retire_materialized_media(
        prepared, materialized_media
    )
    restored_manifest = _load_mapping(
        content.storage_authority, label="restored storage authority"
    )
    if (
        restored_manifest.get("workspace_id") != workspace_id
        or restored_manifest.get("migration_id") != previous_migration_id
        or not _sqlite_integrity(content.canvas_content)
        or not _sqlite_integrity(content.generation_run_store)
    ):
        raise SqlitePublicationUpgradeError(
            "upgrade rollback 后旧 SQLite authority 校验失败"
        )
    rollback_report = (
        report_directory / migration_id / "offline-rollback-report.json"
    )
    workspace_root = content.canvas_content.parent.parent
    _write_json_atomic(
        rollback_report,
        {
            "schema_version": 1,
            "migration_kind": _UPGRADE_KIND,
            "status": "complete",
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "authority": "sqlite",
            "restored_migration_id": previous_migration_id,
            "legacy_source_restore_report": restored.relative_to(
                workspace_root
            ).as_posix(),
            "retired_sqlite_directory": retired.relative_to(
                workspace_root
            ).as_posix(),
            "retired_materialized_media_directory": retired_media.relative_to(
                workspace_root
            ).as_posix(),
            "retired_materialized_media_count": retired_media_count,
            "old_version_restart_ready": True,
        },
    )
    return SqlitePublicationUpgradeRollback(
        report=rollback_report,
        restored_legacy_report=restored,
        retired_sqlite_directory=retired,
        previous_migration_id=previous_migration_id,
    )


__all__ = [
    "SqlitePublicationUpgradeError",
    "SqlitePublicationUpgradePreparation",
    "SqlitePublicationUpgradePublication",
    "SqlitePublicationUpgradeRollback",
    "is_existing_sqlite_upgrade",
    "prepare_existing_sqlite_publication_upgrade",
    "publish_existing_sqlite_publication_upgrade",
    "rollback_existing_sqlite_publication_upgrade",
]
