"""Read-only SQLite to legacy JSON recovery package export.

The exporter never changes the source databases or the Workspace authority.
It builds a sibling temporary directory and publishes the complete package only
after every legacy JSON file has been written successfully.
"""

from __future__ import annotations

import copy
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

from .canvas_store import CanvasProjection, SqliteCanvasStore
from .generation_run_store import (
    GenerationRunAttempt,
    GenerationRunState,
    SqliteGenerationRunStore,
)


class SqliteLegacyExportError(RuntimeError):
    """SQLite authority cannot be represented as a safe legacy package."""


@dataclass(frozen=True)
class SqliteLegacyExport:
    ok: bool
    destination: Path
    canvas_count: int
    generation_run_count: int
    generation_history_count: int
    publication_receipt_count: int


def _database_workspace_id(database: Path, *, metadata_table: str) -> str:
    if not database.is_file():
        raise SqliteLegacyExportError(f"SQLite 数据库不存在：{database.name}")
    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)
    try:
        row = connection.execute(
            f"SELECT value FROM {metadata_table} WHERE key = 'workspace_id'"
        ).fetchone()
    except sqlite3.Error as exc:
        raise SqliteLegacyExportError(
            f"SQLite 数据库元数据无效：{database.name}"
        ) from exc
    finally:
        connection.close()
    return str(row[0] if row is not None else "").strip()


def _canvas_records(database: Path) -> tuple[tuple[str, str, str], ...]:
    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)
    try:
        return tuple(
            (str(row[0]), str(row[1]), str(row[2]))
            for row in connection.execute(
                """
                SELECT canvas_id, owner_id, owner_username
                FROM canvases ORDER BY canvas_id
                """
            )
        )
    except sqlite3.Error as exc:
        raise SqliteLegacyExportError("无法读取 SQLite Canvas 清单") from exc
    finally:
        connection.close()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _package_fingerprint(directory: Path) -> tuple[tuple[str, int, str], ...]:
    if not directory.is_dir() or directory.is_symlink():
        raise SqliteLegacyExportError("legacy export 目标不是安全目录")
    paths = sorted(path for path in directory.rglob("*") if path.is_file())
    if any(path.is_symlink() for path in paths):
        raise SqliteLegacyExportError("legacy export 目标包含符号链接")
    return tuple(
        (
            path.relative_to(directory).as_posix(),
            path.stat().st_size,
            _sha256(path),
        )
        for path in paths
    )


def _verify_legacy_package(
    staging: Path,
    *,
    expected_canvas_ids: tuple[str, ...],
) -> tuple[dict[str, Any], ...]:
    canvas_directory = staging / "data" / "canvases"
    canvas_paths = sorted(canvas_directory.glob("*.json"))
    if tuple(path.stem for path in canvas_paths) != expected_canvas_ids:
        raise SqliteLegacyExportError("legacy export Canvas 清单校验失败")
    for path in canvas_paths:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise SqliteLegacyExportError(
                f"legacy Canvas JSON 无法读取：{path.name}"
            ) from exc
        if (
            not isinstance(document, Mapping)
            or str(document.get("id") or "") != path.stem
            or not isinstance(document.get("nodes"), list)
            or not isinstance(document.get("connections"), list)
            or not isinstance(document.get("logs"), list)
        ):
            raise SqliteLegacyExportError(
                f"legacy Canvas 契约校验失败：{path.name}"
            )
    run_path = staging / "data" / "generation-runs.json"
    try:
        run_payload = json.loads(run_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SqliteLegacyExportError("legacy Generation Run JSON 无法读取") from exc
    runs = run_payload.get("runs") if isinstance(run_payload, Mapping) else None
    if run_payload.get("version") != 1 or not isinstance(runs, list):
        raise SqliteLegacyExportError("legacy Generation Run 契约校验失败")
    if any(not isinstance(run, Mapping) or not str(run.get("id") or "") for run in runs):
        raise SqliteLegacyExportError("legacy Generation Run identity 校验失败")
    history_path = staging / "data" / "generation-history.json"
    effects_path = staging / "data" / "generation-effects.json"
    try:
        history_payload = json.loads(history_path.read_text(encoding="utf-8"))
        effects_payload = json.loads(effects_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SqliteLegacyExportError(
            "legacy Generation History/Effects JSON 无法读取"
        ) from exc
    if not isinstance(history_payload, list) or any(
        not isinstance(item, Mapping) for item in history_payload
    ):
        raise SqliteLegacyExportError("legacy Generation History 契约校验失败")
    effects = effects_payload.get("effects") if isinstance(effects_payload, Mapping) else None
    pending = effects_payload.get("pending") if isinstance(effects_payload, Mapping) else None
    if (
        not isinstance(effects_payload, Mapping)
        or effects_payload.get("version") != 2
        or not isinstance(effects, Mapping)
        or not isinstance(pending, Mapping)
    ):
        raise SqliteLegacyExportError("legacy Generation Effects 契约校验失败")
    for receipt_map in (effects, pending):
        if any(
            not str(run_id or "").strip()
            or not isinstance(names, list)
            or any(name not in {"history", "notification"} for name in names)
            for run_id, names in receipt_map.items()
        ):
            raise SqliteLegacyExportError(
                "legacy Generation Effects receipt 校验失败"
            )
    package_paths = [*canvas_paths, run_path, history_path, effects_path]
    return tuple(
        {
            "relative_path": path.relative_to(staging).as_posix(),
            "size": path.stat().st_size,
            "sha256": _sha256(path),
        }
        for path in package_paths
    )


def _legacy_attempt(attempt: GenerationRunAttempt) -> dict[str, Any]:
    value = copy.deepcopy(dict(attempt.payload))
    value.update(
        {
            "index": attempt.attempt_index,
            "status": attempt.status,
            "provider_id": attempt.provider_id,
            "remote_ref": attempt.remote_ref,
            "provider_output": copy.deepcopy(attempt.provider_output),
            "error": attempt.error,
            "updated_at": attempt.updated_at,
        }
    )
    return value


def _legacy_run(run: GenerationRunState) -> dict[str, Any]:
    return {
        "id": run.run_id,
        "kind": run.kind,
        "status": run.status,
        "owner": run.owner,
        "key": run.key,
        "request_hash": run.request_hash,
        "request": copy.deepcopy(dict(run.request)),
        "effect_context": copy.deepcopy(dict(run.effect_context)),
        "provider_id": run.provider_id,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "result": copy.deepcopy(run.result),
        "error": run.error,
        "status_code": run.status_code,
        "remote_refs": [remote_ref for _provider, remote_ref in run.remote_refs],
        "target": copy.deepcopy(dict(run.target)) if run.target is not None else None,
        "public_metadata": copy.deepcopy(dict(run.public_metadata)),
        "effects_done": False,
        "recoverable": run.recoverable,
        "phase": run.phase,
        "provider_output": copy.deepcopy(run.provider_output),
        "prepared_output": copy.deepcopy(run.prepared_output),
        "child_attempts": [_legacy_attempt(attempt) for attempt in run.attempts],
    }


def export_sqlite_to_legacy(
    canvas_database: Path | str,
    generation_run_database: Path | str,
    *,
    workspace_id: str,
    destination: Path | str,
) -> SqliteLegacyExport:
    """Build one complete legacy recovery package without changing authority."""

    canvas_database = Path(canvas_database)
    generation_run_database = Path(generation_run_database)
    destination = Path(destination)
    workspace_id = str(workspace_id or "").strip()
    if not workspace_id:
        raise SqliteLegacyExportError("legacy export 缺少 Workspace identity")
    if destination.exists() and (
        not destination.is_dir() or destination.is_symlink()
    ):
        raise SqliteLegacyExportError("legacy export 目标已存在且不是安全目录")
    expected = (
        (canvas_database, "store_metadata"),
        (generation_run_database, "generation_run_store_metadata"),
    )
    for database, metadata_table in expected:
        if _database_workspace_id(database, metadata_table=metadata_table) != workspace_id:
            raise SqliteLegacyExportError(
                f"SQLite 数据库不属于当前 Workspace：{database.name}"
            )

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        canvas_store = SqliteCanvasStore(
            canvas_database,
            workspace_id=workspace_id,
        )
        run_store = SqliteGenerationRunStore(
            generation_run_database,
            workspace_id=workspace_id,
        )
        if not canvas_store.integrity().get("ok") or not run_store.integrity().get("ok"):
            raise SqliteLegacyExportError(
                "SQLite 完整性检查失败，未发布 legacy export"
            )
        canvas_records = _canvas_records(canvas_database)
        for canvas_id, owner_id, owner_username in canvas_records:
            actor = {
                "id": owner_id,
                "username": owner_username,
                "role": "admin",
                "status": "active",
            }
            document = canvas_store.read(
                canvas_id,
                actor,
                CanvasProjection.full_export(),
            ).canvas
            if document is None:
                raise SqliteLegacyExportError(
                    f"SQLite Canvas 无法导出：{canvas_id}"
                )
            _write_json(
                staging / "data" / "canvases" / f"{canvas_id}.json",
                document,
            )
        runs = run_store.load_unfinished(limit=1_000_000)
        publication = run_store.legacy_publication_snapshot()
        _write_json(
            staging / "data" / "generation-runs.json",
            {
                "version": 1,
                "runs": [
                    _legacy_run(run)
                    for run in sorted(
                        runs,
                        key=lambda item: (item.created_at, item.run_id),
                    )
                ],
            },
        )
        _write_json(
            staging / "data" / "generation-history.json",
            list(publication.history),
        )
        _write_json(
            staging / "data" / "generation-effects.json",
            {
                "version": 2,
                "effects": {
                    run_id: list(names)
                    for run_id, names in publication.completed.items()
                },
                "pending": {
                    run_id: list(names)
                    for run_id, names in publication.pending.items()
                },
            },
        )
        files = _verify_legacy_package(
            staging,
            expected_canvas_ids=tuple(record[0] for record in canvas_records),
        )
        _write_json(
            staging / "legacy-export-report.json",
            {
                "schema_version": 1,
                "workspace_id": workspace_id,
                "verified": True,
                "canvas_count": len(canvas_records),
                "generation_run_count": len(runs),
                "generation_history_count": len(publication.history),
                "publication_receipt_count": sum(
                    len(names) for names in publication.completed.values()
                ) + sum(len(names) for names in publication.pending.values()),
                "files": files,
            },
        )
        if destination.exists():
            if _package_fingerprint(staging) != _package_fingerprint(destination):
                raise SqliteLegacyExportError(
                    "legacy export 目标已存在且内容不同"
                )
            shutil.rmtree(staging)
        else:
            os.replace(staging, destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    return SqliteLegacyExport(
        ok=True,
        destination=destination,
        canvas_count=len(canvas_records),
        generation_run_count=len(runs),
        generation_history_count=len(publication.history),
        publication_receipt_count=sum(
            len(names) for names in publication.completed.values()
        ) + sum(len(names) for names in publication.pending.values()),
    )


__all__ = [
    "SqliteLegacyExport",
    "SqliteLegacyExportError",
    "export_sqlite_to_legacy",
]
