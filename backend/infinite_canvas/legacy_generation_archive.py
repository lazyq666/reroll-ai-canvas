"""Exact archive and restoration of retired Generation JSON authorities."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .content import WorkspaceContent


LEGACY_GENERATION_FILES = (
    "generation-history.json",
    "generation-effects.json",
    "generation-runs.json",
)


class LegacyGenerationArchiveError(RuntimeError):
    """Legacy Generation sources cannot be archived or restored exactly."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_mapping(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise LegacyGenerationArchiveError(
            f"无法读取 archive 依据：{path.name}"
        ) from exc
    if not isinstance(value, Mapping):
        raise LegacyGenerationArchiveError(
            f"archive 依据格式无效：{path.name}"
        )
    return value


def _write_atomic(path: Path, value: Mapping[str, Any]) -> None:
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


def _expected_sources(
    recovery_manifest: Path,
    *,
    workspace_id: str,
    migration_id: str,
) -> dict[str, Mapping[str, Any]]:
    manifest = _load_mapping(recovery_manifest)
    if (
        manifest.get("workspace_id") != workspace_id
        or manifest.get("migration_id") != migration_id
        or not isinstance(manifest.get("sources"), list)
    ):
        raise LegacyGenerationArchiveError(
            "recovery manifest 与 legacy archive 操作不一致"
        )
    expected: dict[str, Mapping[str, Any]] = {}
    for item in manifest["sources"]:
        if not isinstance(item, Mapping):
            raise LegacyGenerationArchiveError("recovery source 记录无效")
        relative = str(item.get("relative_path") or "")
        if relative in {f"data/{name}" for name in LEGACY_GENERATION_FILES}:
            expected[relative] = item
    return expected


def archive_legacy_generation_json(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    recovery_manifest: Path,
) -> Path:
    """Move only verified legacy Generation JSON after authority publication."""

    migration_root = content.canvas_content.parent / "recovery" / migration_id
    archive_directory = migration_root / "legacy"
    if archive_directory.exists() and (
        not archive_directory.is_dir() or archive_directory.is_symlink()
    ):
        raise LegacyGenerationArchiveError("legacy archive 路径不安全")
    archive_directory.mkdir(parents=True, exist_ok=True)
    expected = _expected_sources(
        recovery_manifest,
        workspace_id=workspace_id,
        migration_id=migration_id,
    )
    source_by_name = {
        "generation-history.json": content.generation_history,
        "generation-effects.json": content.generation_effects,
        "generation-runs.json": content.generation_runs,
    }
    records: list[dict[str, Any]] = []
    for name in LEGACY_GENERATION_FILES:
        relative = f"data/{name}"
        source = source_by_name[name]
        archive = archive_directory / name
        expected_record = expected.get(relative)
        if expected_record is None:
            if source.exists() or archive.exists():
                raise LegacyGenerationArchiveError(
                    f"恢复副本后出现未记录 legacy 文件：{name}"
                )
            records.append({"relative_path": relative, "state": "absent"})
            continue
        expected_sha = str(expected_record.get("sha256") or "")
        if archive.exists():
            if archive.is_symlink() or _sha256(archive) != expected_sha:
                raise LegacyGenerationArchiveError(
                    f"legacy archive 内容不一致：{name}"
                )
            if source.exists():
                if source.is_symlink() or _sha256(source) != expected_sha:
                    raise LegacyGenerationArchiveError(
                        f"legacy source 与 archive 内容不一致：{name}"
                    )
                # A rehearsed rollback preserves the archive and restores the
                # source.  Re-publishing the same migration retires only that
                # byte-verified source while keeping the first archive intact.
                source.unlink()
        else:
            if (
                not source.is_file()
                or source.is_symlink()
                or _sha256(source) != expected_sha
            ):
                raise LegacyGenerationArchiveError(
                    f"legacy source 在发布前发生变化：{name}"
                )
            os.replace(source, archive)
            if _sha256(archive) != expected_sha:
                raise LegacyGenerationArchiveError(
                    f"legacy archive 发布后校验失败：{name}"
                )
        records.append(
            {
                "relative_path": relative,
                "archive_path": f"legacy/{name}",
                "size": int(expected_record.get("size") or archive.stat().st_size),
                "sha256": expected_sha,
                "state": "archived",
            }
        )
    directory_fd = os.open(archive_directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    data_directory_fd = os.open(content.canvas_content.parent, os.O_RDONLY)
    try:
        os.fsync(data_directory_fd)
    finally:
        os.close(data_directory_fd)
    report = archive_directory / "legacy-archive-report.json"
    _write_atomic(
        report,
        {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "status": "complete",
            "files": records,
        },
    )
    return report


def restore_legacy_generation_json(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    recovery_manifest: Path,
) -> Path:
    """Restore archived sources without deleting the recovery archive."""

    migration_root = content.canvas_content.parent / "recovery" / migration_id
    archive_directory = migration_root / "legacy"
    expected = _expected_sources(
        recovery_manifest,
        workspace_id=workspace_id,
        migration_id=migration_id,
    )
    restored: list[dict[str, Any]] = []
    source_by_name = {
        "generation-history.json": content.generation_history,
        "generation-effects.json": content.generation_effects,
        "generation-runs.json": content.generation_runs,
    }
    for name in LEGACY_GENERATION_FILES:
        relative = f"data/{name}"
        expected_record = expected.get(relative)
        if expected_record is None:
            continue
        expected_sha = str(expected_record.get("sha256") or "")
        archive = archive_directory / name
        source = source_by_name[name]
        if source.exists():
            if source.is_symlink() or _sha256(source) != expected_sha:
                raise LegacyGenerationArchiveError(
                    f"rollback 目标已有不同 legacy source：{name}"
                )
        else:
            if (
                not archive.is_file()
                or archive.is_symlink()
                or _sha256(archive) != expected_sha
            ):
                raise LegacyGenerationArchiveError(
                    f"rollback legacy archive 不完整：{name}"
                )
            temporary = source.with_name(f".{source.name}.{uuid.uuid4().hex}.restore")
            try:
                shutil.copy2(archive, temporary)
                if _sha256(temporary) != expected_sha:
                    raise LegacyGenerationArchiveError(
                        f"rollback source 恢复校验失败：{name}"
                    )
                os.replace(temporary, source)
            finally:
                try:
                    temporary.unlink()
                except FileNotFoundError:
                    pass
        restored.append(
            {"relative_path": relative, "sha256": expected_sha, "state": "restored"}
        )
    data_directory_fd = os.open(content.canvas_content.parent, os.O_RDONLY)
    try:
        os.fsync(data_directory_fd)
    finally:
        os.close(data_directory_fd)
    report_directory = migration_root / "rollback"
    report_directory.mkdir(exist_ok=True)
    report = report_directory / "legacy-source-restore-report.json"
    _write_atomic(
        report,
        {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "status": "complete",
            "files": restored,
        },
    )
    return report


__all__ = [
    "LEGACY_GENERATION_FILES",
    "LegacyGenerationArchiveError",
    "archive_legacy_generation_json",
    "restore_legacy_generation_json",
]
