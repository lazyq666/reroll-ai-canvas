"""Fail-closed storage authority selection for one Workspace."""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


STORAGE_AUTHORITY_SCHEMA_VERSION = 1
StorageMode = Literal["json", "sqlite"]
_MIGRATION_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class StorageAuthorityError(RuntimeError):
    """The Workspace authority manifest cannot be used safely."""


@dataclass(frozen=True)
class StorageAuthority:
    mode: StorageMode
    workspace_id: str
    migration_id: str = ""
    explicit: bool = False


def resolve_storage_authority(
    manifest_path: Path | str,
    workspace_id: str,
    *,
    supported_modes: Collection[str] = ("json",),
) -> StorageAuthority:
    """Resolve one all-or-nothing Canvas and Generation Run authority.

    A missing manifest preserves the legacy JSON authority.  Once a manifest
    exists, malformed, mixed, foreign, or unsupported declarations fail
    closed instead of falling back to a different writer.
    """

    path = Path(manifest_path)
    expected_workspace_id = str(workspace_id or "").strip()
    if not expected_workspace_id:
        raise StorageAuthorityError("无法确认当前工作区身份，拒绝选择存储权威")
    try:
        manifest_text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return StorageAuthority(
            mode="json",
            workspace_id=expected_workspace_id,
        )
    except (OSError, UnicodeError) as exc:
        raise StorageAuthorityError(
            "storage-authority.json 无法读取或不是有效 JSON"
        ) from exc
    try:
        raw = json.loads(manifest_text)
    except json.JSONDecodeError as exc:
        raise StorageAuthorityError(
            "storage-authority.json 无法读取或不是有效 JSON"
        ) from exc
    if not isinstance(raw, dict):
        raise StorageAuthorityError("storage-authority.json 根节点必须是对象")

    schema_version = raw.get("schema_version")
    if (
        isinstance(schema_version, bool)
        or schema_version != STORAGE_AUTHORITY_SCHEMA_VERSION
    ):
        raise StorageAuthorityError(
            "storage-authority.json schema_version 不受当前版本支持"
        )
    declared_workspace_id = str(raw.get("workspace_id") or "").strip()
    if declared_workspace_id != expected_workspace_id:
        raise StorageAuthorityError(
            "storage-authority.json 不属于当前工作区"
        )
    migration_id = str(raw.get("migration_id") or "").strip()
    if not _MIGRATION_ID.fullmatch(migration_id):
        raise StorageAuthorityError(
            "storage-authority.json migration_id 无效"
        )

    canvas_mode = str(raw.get("canvas") or "").strip().lower()
    generation_runs_mode = str(
        raw.get("generation_runs") or ""
    ).strip().lower()
    valid_modes = {"json", "sqlite"}
    if canvas_mode not in valid_modes or generation_runs_mode not in valid_modes:
        raise StorageAuthorityError(
            "storage-authority.json 存储类型必须是 json 或 sqlite"
        )
    if canvas_mode != generation_runs_mode:
        raise StorageAuthorityError(
            "不允许 Canvas 与 Generation Run 使用不同的存储权威"
        )
    supported = {
        str(value or "").strip().lower() for value in supported_modes
    }
    if canvas_mode not in supported:
        raise StorageAuthorityError(
            f"当前版本尚未启用 {canvas_mode} 存储权威，拒绝部分启动"
        )
    return StorageAuthority(
        mode=canvas_mode,
        workspace_id=expected_workspace_id,
        migration_id=migration_id,
        explicit=True,
    )


__all__ = [
    "STORAGE_AUTHORITY_SCHEMA_VERSION",
    "StorageAuthority",
    "StorageAuthorityError",
    "resolve_storage_authority",
]
