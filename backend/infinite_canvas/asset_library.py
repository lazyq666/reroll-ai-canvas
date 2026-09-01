"""Workspace-owned publication catalog for reusable image media."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence


ASSET_LIBRARY_CAPACITY = 5_000
ASSET_LIBRARY_PAGE_LIMIT = 60
ASSET_LIBRARY_NAME_LIMIT = 120
ASSET_LIBRARY_FOLDER_NAME_LIMIT = 24


class AssetLibraryError(ValueError):
    """A stable product-facing Workspace Asset Library failure."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = str(code)
        self.status_code = int(status_code)


class AssetLibraryBatchError(AssetLibraryError):
    """An atomic publish batch failed without creating any entries."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        existing: int = 0,
        failed: int = 1,
        status_code: int = 409,
    ) -> None:
        super().__init__(code, message, status_code=status_code)
        self.result = {
            "created": 0,
            "existing": max(0, int(existing)),
            "failed": max(1, int(failed)),
            "entries": [],
        }


def normalize_asset_name(value: object) -> str:
    name = str(value or "").strip()
    if not name:
        raise AssetLibraryError("invalid_name", "素材名称不能为空")
    if len(name) > ASSET_LIBRARY_NAME_LIMIT:
        raise AssetLibraryError(
            "invalid_name",
            f"素材名称不能超过 {ASSET_LIBRARY_NAME_LIMIT} 个字符",
        )
    return name


def normalize_asset_query(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).casefold().strip()


def normalize_folder_name(value: object) -> str:
    name = str(value or "").strip()
    if not name:
        raise AssetLibraryError("invalid_folder_name", "文件夹名称不能为空")
    if len(name) > ASSET_LIBRARY_FOLDER_NAME_LIMIT:
        raise AssetLibraryError(
            "invalid_folder_name",
            f"文件夹名称不能超过 {ASSET_LIBRARY_FOLDER_NAME_LIMIT} 个字符",
        )
    return name


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _encode_cursor(payload: Mapping[str, object]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(value: object) -> dict[str, object]:
    text = str(value or "").strip()
    if not text:
        return {}
    try:
        padded = text + "=" * (-len(text) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise AssetLibraryError("invalid_cursor", "资产库列表已失效，请重新加载") from exc
    if not isinstance(payload, dict):
        raise AssetLibraryError("invalid_cursor", "资产库列表已失效，请重新加载")
    return payload


@dataclass(frozen=True)
class AssetPublicationCandidate:
    media_id: str
    media_url: str
    name: str
    project_id: str
    canvas_id: str
    node_id: str

    @classmethod
    def from_file(
        cls,
        path: Path,
        *,
        media_url: object,
        name: object,
        project_id: object,
        canvas_id: object,
        node_id: object,
    ) -> "AssetPublicationCandidate":
        source = Path(path)
        if not source.is_file() or source.is_symlink():
            raise AssetLibraryError("media_unavailable", "图片文件不存在或无法读取")
        try:
            media_id = sha256_file(source)
        except OSError as exc:
            raise AssetLibraryError(
                "media_unavailable", "图片文件不存在或无法读取"
            ) from exc
        return cls(
            media_id=media_id,
            media_url=str(media_url or "").strip(),
            name=normalize_asset_name(name or "未命名图片"),
            project_id=str(project_id or "").strip(),
            canvas_id=str(canvas_id or "").strip(),
            node_id=str(node_id or "").strip(),
        )


class WorkspaceAssetLibrary:
    """Atomic JSON authority for one Workspace Asset Library.

    The catalog stores publication metadata only. Managed Media bytes remain at
    their existing Workspace location and are never copied or deleted here.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        capacity: int = ASSET_LIBRARY_CAPACITY,
        lock: threading.RLock | None = None,
    ) -> None:
        self.path = Path(path)
        self.capacity = max(1, int(capacity))
        self._lock = lock or threading.RLock()

    @staticmethod
    def _empty() -> dict[str, object]:
        return {"version": 2, "folders": [], "entries": []}

    def _load(self) -> dict[str, object]:
        if not self.path.exists():
            return self._empty()
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise AssetLibraryError(
                "catalog_unavailable",
                "资产库暂时无法读取，请稍后重试",
                status_code=503,
            ) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("entries"), list):
            raise AssetLibraryError(
                "catalog_unavailable",
                "资产库数据无效，请从备份恢复",
                status_code=503,
            )
        if not isinstance(payload.get("folders"), list):
            payload["folders"] = []
        return payload

    def _save(self, payload: Mapping[str, object]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(
            f".{self.path.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, self.path)
        except OSError as exc:
            raise AssetLibraryError(
                "catalog_unavailable",
                "资产库暂时无法保存，请检查目录权限后重试",
                status_code=503,
            ) from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _can_manage(entry: Mapping[str, object], actor: Mapping[str, object]) -> bool:
        return str(actor.get("role") or "") == "admin" or (
            bool(actor.get("id"))
            and str(entry.get("publisher_id") or "") == str(actor.get("id") or "")
        )

    @classmethod
    def _public(
        cls, entry: Mapping[str, object], actor: Mapping[str, object]
    ) -> dict[str, object]:
        # Source Project/Canvas/node metadata is intentionally private.
        return {
            "id": str(entry.get("id") or ""),
            "media_id": str(entry.get("media_id") or ""),
            "url": str(entry.get("media_url") or ""),
            "name": str(entry.get("name") or "未命名图片"),
            "kind": "image",
            "publisher": str(entry.get("publisher_name") or "未知成员"),
            "published_at": str(entry.get("published_at") or ""),
            "folder_id": str(entry.get("folder_id") or ""),
            "can_manage": cls._can_manage(entry, actor),
        }

    @staticmethod
    def _sorted_folders(
        folders: Iterable[Mapping[str, object]],
    ) -> list[dict[str, object]]:
        return sorted(
            (dict(folder) for folder in folders),
            key=lambda folder: (
                int(folder.get("order") or 0),
                str(folder.get("created_at") or ""),
                str(folder.get("id") or ""),
            ),
        )

    @classmethod
    def _public_folders(
        cls,
        folders: Iterable[Mapping[str, object]],
        entries: Iterable[Mapping[str, object]],
    ) -> list[dict[str, object]]:
        counts: dict[str, int] = {}
        for entry in entries:
            folder_id = str(entry.get("folder_id") or "")
            if folder_id:
                counts[folder_id] = counts.get(folder_id, 0) + 1
        return [
            {
                "id": str(folder.get("id") or ""),
                "name": str(folder.get("name") or ""),
                "order": int(folder.get("order") or 0),
                "item_count": counts.get(str(folder.get("id") or ""), 0),
            }
            for folder in cls._sorted_folders(folders)
        ]

    @staticmethod
    def _sort(entries: Iterable[Mapping[str, object]]) -> list[dict[str, object]]:
        return sorted(
            (dict(entry) for entry in entries),
            key=lambda entry: (
                str(entry.get("published_at") or ""),
                str(entry.get("id") or ""),
            ),
            reverse=True,
        )

    def publish(
        self,
        candidates: Sequence[AssetPublicationCandidate],
        actor: Mapping[str, object],
        *,
        folder_id: object = "",
    ) -> dict[str, object]:
        if not candidates:
            raise AssetLibraryBatchError(
                "empty_batch", "请选择至少一张图片", failed=1, status_code=400
            )
        actor_id = str(actor.get("id") or "").strip()
        selected_folder_id = str(folder_id or "").strip()
        if not actor_id:
            raise AssetLibraryBatchError(
                "unauthorized", "请先登录", failed=len(candidates), status_code=401
            )

        # De-duplicate the request before taking the catalog lock. The first
        # occurrence supplies the snapshotted name/source for this publication.
        unique: list[AssetPublicationCandidate] = []
        seen: set[str] = set()
        for candidate in candidates:
            if candidate.media_id in seen:
                continue
            seen.add(candidate.media_id)
            unique.append(candidate)

        with self._lock:
            payload = self._load()
            if selected_folder_id and not any(
                isinstance(folder, dict)
                and str(folder.get("id") or "") == selected_folder_id
                for folder in payload.get("folders", [])
            ):
                raise AssetLibraryBatchError(
                    "folder_not_found",
                    "目标文件夹不存在；本次没有导入任何图片",
                    failed=len(unique),
                    status_code=404,
                )
            entries = [dict(item) for item in payload["entries"] if isinstance(item, dict)]
            existing_ids = {str(item.get("media_id") or "") for item in entries}
            existing = [item for item in unique if item.media_id in existing_ids]
            additions = [item for item in unique if item.media_id not in existing_ids]
            if len(entries) + len(additions) > self.capacity:
                raise AssetLibraryBatchError(
                    "capacity_exceeded",
                    f"资产库最多可保存 {self.capacity} 项；本次没有添加任何图片",
                    existing=len(existing),
                    failed=len(additions) or 1,
                )
            published_at = _timestamp()
            created: list[dict[str, object]] = []
            for candidate in additions:
                entry = {
                    "id": uuid.uuid4().hex,
                    "media_id": candidate.media_id,
                    "media_url": candidate.media_url,
                    "media_kind": "image",
                    "name": candidate.name,
                    "publisher_id": actor_id,
                    "publisher_name": str(actor.get("username") or "").strip()
                    or "未知成员",
                    "published_at": published_at,
                    "folder_id": selected_folder_id,
                    "source": {
                        "project_id": candidate.project_id,
                        "canvas_id": candidate.canvas_id,
                        "node_id": candidate.node_id,
                    },
                }
                entries.append(entry)
                created.append(entry)
            if created:
                payload = {
                    "version": 2,
                    "folders": payload.get("folders", []),
                    "entries": self._sort(entries),
                }
                self._save(payload)
            return {
                "created": len(created),
                "existing": len(existing),
                "failed": 0,
                "entries": [self._public(entry, actor) for entry in created],
            }

    def list(
        self,
        actor: Mapping[str, object],
        *,
        query: object = "",
        cursor: object = "",
        folder_id: object = "",
        limit: int = ASSET_LIBRARY_PAGE_LIMIT,
    ) -> dict[str, object]:
        normalized_query = normalize_asset_query(query)
        selected_folder_id = str(folder_id or "").strip()
        page_limit = max(1, min(ASSET_LIBRARY_PAGE_LIMIT, int(limit or 0) or 30))
        cursor_payload = _decode_cursor(cursor)
        try:
            offset = max(0, int(cursor_payload.get("offset") or 0))
        except (TypeError, ValueError) as exc:
            raise AssetLibraryError("invalid_cursor", "资产库列表已失效，请重新加载") from exc
        cursor_query = normalize_asset_query(cursor_payload.get("query") or "")
        if cursor_payload and cursor_query != normalized_query:
            raise AssetLibraryError("invalid_cursor", "搜索条件已变化，请重新加载资产库")
        if cursor_payload and str(cursor_payload.get("folder_id") or "") != selected_folder_id:
            raise AssetLibraryError("invalid_cursor", "文件夹已变化，请重新加载资产库")

        with self._lock:
            payload = self._load()
            all_entries = payload["entries"]
            folders = payload.get("folders", [])
            total_entries = len(all_entries)
            entries = self._sort(all_entries)
        if selected_folder_id:
            if not any(
                str(folder.get("id") or "") == selected_folder_id
                for folder in folders
                if isinstance(folder, dict)
            ):
                raise AssetLibraryError(
                    "folder_not_found", "该文件夹不存在，可能已被删除", status_code=404
                )
            entries = [
                entry
                for entry in entries
                if str(entry.get("folder_id") or "") == selected_folder_id
            ]
        snapshot = str(cursor_payload.get("snapshot") or "")
        if not snapshot:
            snapshot = str(entries[0].get("published_at") or "") if entries else ""
        if snapshot:
            entries = [
                entry
                for entry in entries
                if str(entry.get("published_at") or "") <= snapshot
            ]
        if normalized_query:
            entries = [
                entry
                for entry in entries
                if normalized_query in normalize_asset_query(entry.get("name"))
            ]
        page = entries[offset : offset + page_limit]
        next_offset = offset + len(page)
        next_cursor = (
            _encode_cursor(
                {
                    "offset": next_offset,
                    "snapshot": snapshot,
                    "query": normalized_query,
                    "folder_id": selected_folder_id,
                }
            )
            if next_offset < len(entries)
            else ""
        )
        return {
            "items": [self._public(entry, actor) for entry in page],
            "next_cursor": next_cursor,
            "limit": page_limit,
            "capacity": self.capacity,
            "at_capacity": total_entries >= self.capacity,
            "all_count": total_entries,
            "folders": self._public_folders(folders, all_entries),
        }

    def create_folder(
        self, name: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        clean_name = normalize_folder_name(name)
        with self._lock:
            payload = self._load()
            folders = [
                dict(folder)
                for folder in payload.get("folders", [])
                if isinstance(folder, dict)
            ]
            normalized_name = normalize_asset_query(clean_name)
            if any(
                normalize_asset_query(folder.get("name")) == normalized_name
                for folder in folders
            ):
                raise AssetLibraryError(
                    "folder_name_exists", "已存在同名文件夹", status_code=409
                )
            folder = {
                "id": uuid.uuid4().hex,
                "name": clean_name,
                "order": len(folders),
                "created_at": _timestamp(),
                "created_by": str(actor.get("id") or ""),
            }
            folders.append(folder)
            payload["version"] = 2
            payload["folders"] = folders
            self._save(payload)
            return {"id": folder["id"], "name": clean_name, "order": folder["order"], "item_count": 0}

    def rename_folder(
        self, folder_id: object, name: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        clean_name = normalize_folder_name(name)
        with self._lock:
            payload = self._load()
            folders = payload.get("folders", [])
            target = next(
                (
                    folder
                    for folder in folders
                    if isinstance(folder, dict)
                    and str(folder.get("id") or "") == str(folder_id or "")
                ),
                None,
            )
            if target is None:
                raise AssetLibraryError(
                    "folder_not_found", "该文件夹不存在，可能已被删除", status_code=404
                )
            normalized_name = normalize_asset_query(clean_name)
            if any(
                folder is not target
                and isinstance(folder, dict)
                and normalize_asset_query(folder.get("name")) == normalized_name
                for folder in folders
            ):
                raise AssetLibraryError(
                    "folder_name_exists", "已存在同名文件夹", status_code=409
                )
            target["name"] = clean_name
            payload["version"] = 2
            self._save(payload)
            count = sum(
                1
                for entry in payload["entries"]
                if isinstance(entry, dict)
                and str(entry.get("folder_id") or "") == str(folder_id or "")
            )
            return {
                "id": str(target.get("id") or ""),
                "name": clean_name,
                "order": int(target.get("order") or 0),
                "item_count": count,
            }

    def delete_folder(
        self, folder_id: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        selected_id = str(folder_id or "")
        with self._lock:
            payload = self._load()
            folders = payload.get("folders", [])
            if not any(
                isinstance(folder, dict)
                and str(folder.get("id") or "") == selected_id
                for folder in folders
            ):
                raise AssetLibraryError(
                    "folder_not_found", "该文件夹不存在，可能已被删除", status_code=404
                )
            moved = 0
            for entry in payload["entries"]:
                if isinstance(entry, dict) and str(entry.get("folder_id") or "") == selected_id:
                    entry["folder_id"] = ""
                    moved += 1
            payload["folders"] = [
                folder
                for folder in folders
                if not isinstance(folder, dict)
                or str(folder.get("id") or "") != selected_id
            ]
            for order, folder in enumerate(payload["folders"]):
                if isinstance(folder, dict):
                    folder["order"] = order
            payload["version"] = 2
            self._save(payload)
            return {"removed": 1, "id": selected_id, "moved": moved}

    def classify(
        self, entry_id: object, folder_id: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        selected_folder_id = str(folder_id or "").strip()
        with self._lock:
            payload = self._load()
            if selected_folder_id and not any(
                isinstance(folder, dict)
                and str(folder.get("id") or "") == selected_folder_id
                for folder in payload.get("folders", [])
            ):
                raise AssetLibraryError(
                    "folder_not_found", "该文件夹不存在，可能已被删除", status_code=404
                )
            target = next(
                (
                    entry
                    for entry in payload["entries"]
                    if isinstance(entry, dict)
                    and str(entry.get("id") or "") == str(entry_id or "")
                ),
                None,
            )
            if target is None:
                raise AssetLibraryError(
                    "not_found", "该图片不在资产库中，可能已被移除", status_code=404
                )
            target["folder_id"] = selected_folder_id
            payload["version"] = 2
            self._save(payload)
            return self._public(target, actor)

    def rename(
        self, entry_id: object, name: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        clean_name = normalize_asset_name(name)
        with self._lock:
            payload = self._load()
            target = next(
                (
                    entry
                    for entry in payload["entries"]
                    if isinstance(entry, dict)
                    and str(entry.get("id") or "") == str(entry_id or "")
                ),
                None,
            )
            if target is None:
                raise AssetLibraryError(
                    "not_found", "该图片不在资产库中，可能已被移除", status_code=404
                )
            if not self._can_manage(target, actor):
                raise AssetLibraryError(
                    "forbidden", "只有添加者或管理员可以修改名称", status_code=403
                )
            target["name"] = clean_name
            self._save(payload)
            return self._public(target, actor)

    def unpublish(
        self, entry_id: object, actor: Mapping[str, object]
    ) -> dict[str, object]:
        with self._lock:
            payload = self._load()
            entries = payload["entries"]
            target = next(
                (
                    entry
                    for entry in entries
                    if isinstance(entry, dict)
                    and str(entry.get("id") or "") == str(entry_id or "")
                ),
                None,
            )
            if target is None:
                raise AssetLibraryError(
                    "not_found", "该图片不在资产库中，可能已被移除", status_code=404
                )
            if not self._can_manage(target, actor):
                raise AssetLibraryError(
                    "forbidden", "只有添加者或管理员可以从资产库移除这张图片", status_code=403
                )
            payload["entries"] = [entry for entry in entries if entry is not target]
            self._save(payload)
            return {"removed": 1, "id": str(entry_id or "")}


__all__ = [
    "ASSET_LIBRARY_CAPACITY",
    "ASSET_LIBRARY_NAME_LIMIT",
    "ASSET_LIBRARY_FOLDER_NAME_LIMIT",
    "ASSET_LIBRARY_PAGE_LIMIT",
    "AssetLibraryBatchError",
    "AssetLibraryError",
    "AssetPublicationCandidate",
    "WorkspaceAssetLibrary",
    "normalize_asset_name",
    "normalize_asset_query",
    "normalize_folder_name",
    "sha256_file",
]
