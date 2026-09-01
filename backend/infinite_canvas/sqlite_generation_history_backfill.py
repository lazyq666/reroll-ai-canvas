"""One-shot legacy Canvas JSON log backfill for SQLite-authority Workspaces."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canvas_store import SqliteCanvasStore
from .content import WorkspaceContent
from .sqlite_migration import normalize_legacy_generation_log
from .storage_authority import resolve_storage_authority


_MIGRATION_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class SqliteGenerationHistoryBackfillError(RuntimeError):
    """Legacy Generation History cannot be backfilled without ambiguity."""


@dataclass(frozen=True)
class SqliteGenerationHistoryBackfill:
    ok: bool
    migration_id: str
    recovery_directory: Path
    report: Path
    source_log_count: int
    starting_log_count: int
    imported_log_count: int
    final_log_count: int
    source_fingerprint: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _backup_database(source: Path, destination: Path) -> None:
    source_connection = sqlite3.connect(f"file:{source.resolve()}?mode=ro", uri=True)
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
        destination_connection.commit()
    finally:
        destination_connection.close()
        source_connection.close()
    connection = sqlite3.connect(f"file:{destination.resolve()}?mode=ro", uri=True)
    try:
        integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
        foreign_keys = list(connection.execute("PRAGMA foreign_key_check"))
    finally:
        connection.close()
    if integrity != ["ok"] or foreign_keys:
        raise SqliteGenerationHistoryBackfillError(
            "Generation History 回填恢复副本完整性检查失败"
        )


def _legacy_documents(
    content: WorkspaceContent,
) -> tuple[tuple[dict[str, Any], ...], int]:
    documents_by_id: dict[str, dict[str, Any]] = {}
    logs_by_id: dict[str, dict[str, Mapping[str, Any]]] = {}
    duplicate_log_count = 0
    for source in sorted(content.smart_canvases.glob("*.json")):
        try:
            value = json.loads(source.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise SqliteGenerationHistoryBackfillError(
                f"无法读取旧 Canvas：{source.name}"
            ) from exc
        if not isinstance(value, Mapping):
            raise SqliteGenerationHistoryBackfillError(
                f"旧 Canvas 根节点无效：{source.name}"
            )
        document = dict(value)
        canvas_id = str(document.get("id") or "").strip()
        if not canvas_id or (
            source.stem != canvas_id
            and not source.stem.startswith(f"{canvas_id}-")
        ):
            raise SqliteGenerationHistoryBackfillError(
                f"旧 Canvas ID 与文件名不一致：{source.name}"
            )
        logs = document.get("logs", [])
        if not isinstance(logs, list):
            raise SqliteGenerationHistoryBackfillError(
                f"旧 Canvas Generation History 必须是数组：{source.name}"
            )
        merged = documents_by_id.setdefault(
            canvas_id,
            {**document, "logs": []},
        )
        known_logs = logs_by_id.setdefault(canvas_id, {})
        for log in logs:
            if not isinstance(log, Mapping):
                merged["logs"].append(log)
                continue
            log_id = str(log.get("id") or log.get("log_id") or "").strip()
            if not log_id:
                merged["logs"].append(dict(log))
                continue
            previous = known_logs.get(log_id)
            if previous is None:
                known_logs[log_id] = log
                merged["logs"].append(dict(log))
                continue
            previous_json = json.dumps(
                previous,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            current_json = json.dumps(
                log,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            if previous_json != current_json:
                raise SqliteGenerationHistoryBackfillError(
                    f"设备冲突副本含同 ID 不同日志：{canvas_id}:{log_id}"
                )
            duplicate_log_count += 1
    return tuple(documents_by_id.values()), duplicate_log_count


def _source_fingerprint(documents: tuple[dict[str, Any], ...]) -> str:
    payload = [
        {
            "canvas_id": str(document.get("id") or ""),
            "logs": document.get("logs", []),
        }
        for document in documents
    ]
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def backfill_sqlite_generation_history(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
) -> SqliteGenerationHistoryBackfill:
    """Backfill all persisted legacy Canvas logs after an older SQLite cutover."""

    workspace_id = str(workspace_id or "").strip()
    migration_id = str(migration_id or "").strip()
    if not workspace_id:
        raise SqliteGenerationHistoryBackfillError("回填缺少 Workspace 或迁移 ID")
    if not _MIGRATION_ID.fullmatch(migration_id) or migration_id in {".", ".."}:
        raise SqliteGenerationHistoryBackfillError("回填 migration ID 无效")
    authority = resolve_storage_authority(
        content.storage_authority,
        workspace_id,
        supported_modes=("sqlite",),
    )
    if authority.mode != "sqlite" or not content.canvas_content.is_file():
        raise SqliteGenerationHistoryBackfillError("当前 Workspace 不是 SQLite 权威")
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(content.canvas_content) + suffix)
        if sidecar.exists() and sidecar.stat().st_size > 0:
            raise SqliteGenerationHistoryBackfillError(
                "Canvas SQLite 仍有活动 WAL/SHM，请先完全停止服务"
            )

    recovery = content.canvas_content.parent / "recovery" / migration_id
    if recovery.exists():
        raise SqliteGenerationHistoryBackfillError("该回填 migration ID 已存在")
    recovery.mkdir(parents=True)
    report = recovery / "generation-history-backfill-report.json"
    phase = "read_source"
    source_log_count = 0
    starting_log_count = 0
    imported_log_count = 0
    source_fingerprint = ""
    duplicate_source_log_count = 0
    try:
        documents, duplicate_source_log_count = _legacy_documents(content)
        source_log_count = sum(len(document.get("logs", [])) for document in documents)
        source_fingerprint = _source_fingerprint(documents)
        if source_log_count <= 0:
            raise SqliteGenerationHistoryBackfillError("旧 Canvas 中没有可回填日志")

        phase = "create_recovery"
        source_directory = recovery / "source" / "data" / "canvases"
        source_directory.mkdir(parents=True)
        copied_sources: list[dict[str, Any]] = []
        for source in sorted(content.smart_canvases.glob("*.json")):
            destination = source_directory / source.name
            before = _sha256(source)
            shutil.copy2(source, destination)
            if _sha256(destination) != before or _sha256(source) != before:
                raise SqliteGenerationHistoryBackfillError(
                    f"创建恢复副本时旧 Canvas 发生变化：{source.name}"
                )
            copied_sources.append(
                {"name": source.name, "sha256": before, "size": source.stat().st_size}
            )
        shutil.copy2(content.storage_authority, recovery / "storage-authority.json")
        database_backup = recovery / "canvas-content.before.sqlite3"
        _backup_database(content.canvas_content, database_backup)
        live_database_sha256 = _sha256(content.canvas_content)

        phase = "normalize"
        connection = sqlite3.connect(f"file:{database_backup.resolve()}?mode=ro", uri=True)
        try:
            starting_log_count = int(
                connection.execute("SELECT COUNT(*) FROM canvas_logs").fetchone()[0]
            )
            existing_log_ids = {
                str(row[0]) for row in connection.execute("SELECT log_id FROM canvas_logs")
            }
            used_log_ids = set(existing_log_ids)
            existing_run_ids: dict[str, set[str]] = {}
            for canvas_id, run_id in connection.execute(
                "SELECT canvas_id, run_id FROM canvas_logs WHERE run_id <> ''"
            ):
                existing_run_ids.setdefault(str(canvas_id), set()).add(str(run_id))
            canvas_ids = {
                str(row[0]) for row in connection.execute("SELECT canvas_id FROM canvases")
            }
        finally:
            connection.close()

        normalized_by_canvas: dict[str, list[Mapping[str, Any]]] = {}
        remapped_log_id_count = 0
        duplicate_run_id_count = 0
        for document in documents:
            canvas_id = str(document["id"])
            if canvas_id not in canvas_ids:
                raise SqliteGenerationHistoryBackfillError(
                    f"旧日志所属 Canvas 不在 SQLite：{canvas_id}"
                )
            used_run_ids = set(existing_run_ids.get(canvas_id, set()))
            normalized: list[Mapping[str, Any]] = []
            for index, legacy_log in enumerate(document.get("logs", [])):
                if isinstance(legacy_log, Mapping):
                    original_log_id = str(
                        legacy_log.get("id") or legacy_log.get("log_id") or ""
                    ).strip()
                    original_run_id = str(
                        legacy_log.get("runId")
                        or legacy_log.get("run_id")
                        or legacy_log.get("generationRunId")
                        or ""
                    ).strip()
                    if original_log_id and original_log_id in existing_log_ids:
                        raise SqliteGenerationHistoryBackfillError(
                            f"旧日志与 SQLite 日志 ID 重叠：{canvas_id}#{index + 1}"
                        )
                    if original_run_id and original_run_id in existing_run_ids.get(
                        canvas_id, set()
                    ):
                        raise SqliteGenerationHistoryBackfillError(
                            f"旧日志与 SQLite Run ID 重叠：{canvas_id}#{index + 1}"
                        )
                log, remapped, duplicate_run = normalize_legacy_generation_log(
                    legacy_log,
                    canvas_id=canvas_id,
                    index=index,
                    used_log_ids=used_log_ids,
                    used_run_ids=used_run_ids,
                )
                normalized.append(log)
                remapped_log_id_count += int(remapped)
                duplicate_run_id_count += int(duplicate_run)
            normalized_by_canvas[canvas_id] = normalized

        phase = "verify_staging"
        staging_directory = recovery / "staging"
        staging_directory.mkdir()
        staging_database = staging_directory / "canvas-content.sqlite3"
        _backup_database(database_backup, staging_database)
        actor = {
            "id": "generation-history-backfill",
            "username": "migration",
            "role": "admin",
            "status": "active",
        }
        staging_store = SqliteCanvasStore(staging_database, workspace_id=workspace_id)
        staged_count = staging_store.backfill_generation_history(
            normalized_by_canvas,
            actor,
            operation_id=f"history-backfill:{migration_id}",
            source_fingerprint=source_fingerprint,
        )
        staging_integrity = staging_store.integrity()
        expected_final_count = starting_log_count + source_log_count
        if (
            staged_count != source_log_count
            or not staging_integrity.get("ok")
            or int(staging_integrity["counts"]["logs"]) != expected_final_count
        ):
            raise SqliteGenerationHistoryBackfillError("回填 staging 校验失败")
        if _sha256(content.canvas_content) != live_database_sha256:
            raise SqliteGenerationHistoryBackfillError(
                "验证期间 Canvas SQLite 发生变化，请保持服务停止"
            )

        phase = "commit_live"
        live_store = SqliteCanvasStore(content.canvas_content, workspace_id=workspace_id)
        imported_log_count = live_store.backfill_generation_history(
            normalized_by_canvas,
            actor,
            operation_id=f"history-backfill:{migration_id}",
            source_fingerprint=source_fingerprint,
        )
        live_integrity = live_store.integrity()
        final_log_count = int(live_integrity["counts"]["logs"])
        if (
            imported_log_count != source_log_count
            or not live_integrity.get("ok")
            or final_log_count != expected_final_count
        ):
            raise SqliteGenerationHistoryBackfillError("正式 SQLite 回填后校验失败")

        _write_json(
            report,
            {
                "schema_version": 1,
                "status": "complete",
                "phase": "complete",
                "migration_id": migration_id,
                "workspace_id": workspace_id,
                "authority_migration_id": authority.migration_id,
                "source_fingerprint": source_fingerprint,
                "source_log_count": source_log_count,
                "starting_log_count": starting_log_count,
                "imported_log_count": imported_log_count,
                "final_log_count": final_log_count,
                "remapped_log_id_count": remapped_log_id_count,
                "duplicate_run_id_count": duplicate_run_id_count,
                "duplicate_source_log_count": duplicate_source_log_count,
                "database_before_sha256": _sha256(database_backup),
                "database_after_sha256": _sha256(content.canvas_content),
                "sources": copied_sources,
                "integrity": live_integrity,
                "storage_authority_changed": False,
            },
        )
        return SqliteGenerationHistoryBackfill(
            ok=True,
            migration_id=migration_id,
            recovery_directory=recovery,
            report=report,
            source_log_count=source_log_count,
            starting_log_count=starting_log_count,
            imported_log_count=imported_log_count,
            final_log_count=final_log_count,
            source_fingerprint=source_fingerprint,
        )
    except Exception as exc:
        try:
            _write_json(
                report,
                {
                    "schema_version": 1,
                    "status": "failed",
                    "phase": phase,
                    "migration_id": migration_id,
                    "workspace_id": workspace_id,
                    "source_fingerprint": source_fingerprint,
                    "source_log_count": source_log_count,
                    "starting_log_count": starting_log_count,
                    "imported_log_count": imported_log_count,
                    "duplicate_source_log_count": duplicate_source_log_count,
                    "reason": str(exc),
                    "storage_authority_changed": False,
                },
            )
        except OSError:
            pass
        raise


__all__ = [
    "SqliteGenerationHistoryBackfill",
    "SqliteGenerationHistoryBackfillError",
    "backfill_sqlite_generation_history",
]
