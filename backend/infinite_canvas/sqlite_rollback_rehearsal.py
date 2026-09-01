"""Offline rehearsal of a current SQLite authority rollback package."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from .content import WorkspaceContent
from .sqlite_legacy_export import export_sqlite_to_legacy
from .storage_authority import resolve_storage_authority


_REHEARSAL_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class SqliteRollbackRehearsalError(RuntimeError):
    """The active SQLite authority cannot produce a trusted rollback package."""


@dataclass(frozen=True)
class SqliteRollbackRehearsal:
    ok: bool
    workspace_id: str
    migration_id: str
    rehearsal_id: str
    package_directory: Path
    rehearsal_report: Path
    canvas_count: int
    generation_run_count: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, value: dict[str, object]) -> None:
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


def rehearse_sqlite_rollback(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    rehearsal_id: str,
) -> SqliteRollbackRehearsal:
    """Export current SQLite truth without changing authority or legacy JSON."""

    workspace_id = str(workspace_id or "").strip()
    rehearsal_id = str(rehearsal_id or "").strip()
    if not _REHEARSAL_ID.fullmatch(rehearsal_id) or rehearsal_id in {".", ".."}:
        raise SqliteRollbackRehearsalError("rollback rehearsal ID 无效")
    authority = resolve_storage_authority(
        content.storage_authority,
        workspace_id,
        supported_modes=("sqlite",),
    )
    if authority.mode != "sqlite" or not authority.explicit:
        raise SqliteRollbackRehearsalError(
            "当前 Workspace 不是明确的 SQLite authority"
        )
    if not content.canvas_content.is_file() or not content.generation_run_store.is_file():
        raise SqliteRollbackRehearsalError("SQLite authority 数据库不完整")

    authority_before = _sha256(content.storage_authority)
    package_directory = (
        content.canvas_content.parent
        / "recovery"
        / authority.migration_id
        / "rollback"
        / rehearsal_id
    )
    exported = export_sqlite_to_legacy(
        content.canvas_content,
        content.generation_run_store,
        workspace_id=workspace_id,
        destination=package_directory,
    )
    authority_after = _sha256(content.storage_authority)
    if authority_after != authority_before:
        raise SqliteRollbackRehearsalError(
            "rollback rehearsal 期间 authority 发生变化"
        )
    legacy_report = package_directory / "legacy-export-report.json"
    rehearsal_report = package_directory / "rollback-rehearsal-report.json"
    _write_json_atomic(
        rehearsal_report,
        {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "migration_id": authority.migration_id,
            "rehearsal_id": rehearsal_id,
            "status": "verified",
            "authority_unchanged": True,
            "authority_manifest_sha256": authority_after,
            "legacy_export_report_sha256": _sha256(legacy_report),
            "canvas_count": exported.canvas_count,
            "generation_run_count": exported.generation_run_count,
        },
    )
    return SqliteRollbackRehearsal(
        ok=True,
        workspace_id=workspace_id,
        migration_id=authority.migration_id,
        rehearsal_id=rehearsal_id,
        package_directory=package_directory,
        rehearsal_report=rehearsal_report,
        canvas_count=exported.canvas_count,
        generation_run_count=exported.generation_run_count,
    )


__all__ = [
    "SqliteRollbackRehearsal",
    "SqliteRollbackRehearsalError",
    "rehearse_sqlite_rollback",
]
