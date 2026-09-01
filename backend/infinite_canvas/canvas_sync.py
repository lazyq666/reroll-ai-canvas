"""Authoritative persistence and ordered delivery for Canvas writes."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Dict, Iterable, Mapping, Protocol

from .canvas_permissions import (
    can_access_canvas,
    can_access_project,
    ensure_canvas_access_fields,
    set_canvas_visibility,
)
from .canvas_realtime import (
    CanvasRealtimeError,
    apply_operation,
    enable_realtime,
    public_snapshot,
)
from .canvas_store import (
    CanvasIntent,
    CanvasProjection,
    CanvasShareGrant,
    CanvasStore,
    CanvasStoreError,
    apply_prompt_template_intent,
)
from .realtime_presence import NullRealtimePresence
from .generation_output import apply_generation_node_changes
from .workspace_storage import WorkspaceStorageError

from .content import WorkspaceContent


SAVE_SNAPSHOT = "save_snapshot"
UPDATE_PROMPT_TEMPLATES = "update_prompt_templates"
CREATE_CANVAS = "create_canvas"
UPDATE_METADATA = "update_metadata"
SET_VISIBILITY = "set_visibility"
TOUCH_CANVAS = "touch_canvas"
TRASH_CANVAS = "trash_canvas"
RESTORE_CANVAS = "restore_canvas"
PURGE_CANVAS = "purge_canvas"
DELETE_PROJECT = "delete_project"
DEFAULT_PROJECT_ID = "default"
CANVAS_COLORS = {
    "",
    "red",
    "orange",
    "amber",
    "green",
    "teal",
    "blue",
    "violet",
    "pink",
    "slate",
}

CANVAS_STORE_EXECUTOR = ThreadPoolExecutor(
    max_workers=4,
    thread_name_prefix="canvas-store",
)
CANVAS_STORE_IN_FLIGHT_LIMIT = 16
REALTIME_JSON_BATCH_WINDOW_SECONDS = 0.03
CANVAS_JSON_WRITE_CHUNK_BYTES = 256 * 1024


def normalize_canvas_kind(kind: Any = "classic") -> str:
    return (
        "smart"
        if str(kind or "").strip().lower() == "smart"
        else "classic"
    )


def normalize_canvas_color(value: Any) -> str:
    color = str(value or "").strip().lower()
    return color if color in CANVAS_COLORS else ""


def normalize_canvas_cover_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 8000:
        return ""
    if text.startswith(
        ("/assets/", "/api/storage-files/", "/api/media-preview")
    ):
        return text
    if re.match(r"^https?://", text, re.IGNORECASE):
        return text
    if text.startswith("data:image/"):
        return text
    return ""


class CanvasSyncError(Exception):
    """Transport-neutral Canvas error with the preserved HTTP projection."""

    def __init__(self, status_code: int, detail: Any):
        super().__init__(
            detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
        )
        self.status_code = int(status_code)
        self.detail = detail


@dataclass(frozen=True)
class CanvasCommand:
    """One complete server-side Canvas write intent."""

    action: str
    canvas_id: str
    values: Mapping[str, Any] = field(default_factory=dict)


@dataclass
class _RealtimeBatchRequest:
    session: "RealtimeSession"
    actor: Dict[str, Any] | None
    message: Mapping[str, Any]
    completion: asyncio.Future[None] | None


@dataclass(frozen=True)
class CanvasSyncResult:
    """Observable result returned after persistence and ordered notification."""

    canvas: Dict[str, Any] | None = None
    value: Any = None


@dataclass(frozen=True)
class CanvasGenerationApplyResult:
    """Whether one late Generation Output still belonged to its target Node."""

    applied: bool
    reason: str = ""
    revision: int = 0


@dataclass(frozen=True)
class RealtimeSession:
    """One accepted realtime connection owned by Canvas Sync."""

    canvas_id: str
    client_id: str
    websocket: Any
    actor_id: str
    access_epoch: int
    access_scope: Mapping[str, Any]
    revision: int


class CanvasNotifier(Protocol):
    async def broadcast_canvas_updated(
        self,
        canvas_id: str,
        updated_at: int,
        client_id: str = "",
    ) -> None: ...

    async def connect_canvas(
        self,
        websocket: Any,
        canvas_id: str,
        client_id: str,
    ) -> bool: ...

    def disconnect_canvas(self, websocket: Any, canvas_id: str) -> None: ...

    async def send_canvas_message(
        self,
        websocket: Any,
        message: Dict[str, Any],
    ) -> bool: ...

    async def broadcast_canvas_message(
        self,
        canvas_id: str,
        message: Dict[str, Any],
    ) -> None: ...


class CanvasAdministration(Protocol):
    def revoke_canvas_share(
        self,
        workspace_id: str,
        canvas_id: str,
        actor_id: str,
    ) -> None: ...

    def audit(
        self,
        event: str,
        *,
        actor_id: str,
        target_type: str,
        target_id: str,
        details: Dict[str, Any],
        workspace_id: str,
    ) -> None: ...


class NullCanvasAdministration:
    def revoke_canvas_share(
        self,
        workspace_id: str,
        canvas_id: str,
        actor_id: str,
    ) -> None:
        del workspace_id, canvas_id, actor_id

    def audit(
        self,
        event: str,
        *,
        actor_id: str,
        target_type: str,
        target_id: str,
        details: Dict[str, Any],
        workspace_id: str,
    ) -> None:
        del event, actor_id, target_type, target_id, details, workspace_id


class NullCanvasNotifier:
    async def broadcast_canvas_updated(
        self,
        canvas_id: str,
        updated_at: int,
        client_id: str = "",
    ) -> None:
        del canvas_id, updated_at, client_id

    async def connect_canvas(
        self,
        websocket: Any,
        canvas_id: str,
        client_id: str,
    ) -> bool:
        del websocket, canvas_id, client_id
        return False

    def disconnect_canvas(self, websocket: Any, canvas_id: str) -> None:
        del websocket, canvas_id

    async def send_canvas_message(
        self,
        websocket: Any,
        message: Dict[str, Any],
    ) -> bool:
        del websocket, message
        return False

    async def broadcast_canvas_message(
        self,
        canvas_id: str,
        message: Dict[str, Any],
    ) -> None:
        del canvas_id, message


class CanvasSync:
    """Deep Canvas module: re-read, authorize, mutate, persist, then notify."""

    def __init__(
        self,
        *,
        content: Callable[[], WorkspaceContent],
        now_ms: Callable[[], int],
        file_lock: Lock | None = None,
        notifier: CanvasNotifier | None = None,
        administration: CanvasAdministration | None = None,
        workspace_id: Callable[[], str] | None = None,
        initial_admin: Callable[[], Dict[str, Any] | None] | None = None,
        user_by_id: Callable[[str], Dict[str, Any] | None] | None = None,
        recovery_directory: Callable[[], str | Path] | None = None,
        store_executor: Executor | None = None,
        canvas_store: Callable[[], CanvasStore] | None = None,
        realtime_presence: Any | None = None,
    ) -> None:
        self._content = content
        self._now_ms = now_ms
        self._file_lock = file_lock or Lock()
        self._notifier = notifier or NullCanvasNotifier()
        self._administration = administration or NullCanvasAdministration()
        self._workspace_id = workspace_id or (lambda: "legacy-workspace")
        self._initial_admin = initial_admin or (lambda: None)
        self._user_by_id = user_by_id or (lambda _user_id: None)
        self._recovery_directory = recovery_directory
        self._store_executor = store_executor or CANVAS_STORE_EXECUTOR
        # Cutover seam only: callers must not provide it while JSON remains
        # authoritative for the same Canvas. The callable keeps Workspace
        # selection dynamic without exposing storage details to CanvasSync.
        self._canvas_store = canvas_store
        self._realtime_presence = realtime_presence or NullRealtimePresence()
        self._store_slots = asyncio.Semaphore(CANVAS_STORE_IN_FLIGHT_LIMIT)
        self._operation_locks: Dict[str, asyncio.Lock] = {}
        self._administration_lock = asyncio.Lock()
        self._access_epochs: Dict[str, int] = {}
        self._realtime_revisions: Dict[str, int] = {}
        self._realtime_batch_pending: Dict[
            str,
            list[_RealtimeBatchRequest],
        ] = {}
        self._realtime_batch_tasks: Dict[str, asyncio.Task[None]] = {}

    def _operation_lock(self, canvas_id: str) -> asyncio.Lock:
        lock = self._operation_locks.get(canvas_id)
        if lock is None:
            lock = asyncio.Lock()
            self._operation_locks[canvas_id] = lock
        return lock

    async def _run_store(self, function: Callable[..., Any], *args: Any) -> Any:
        """Run blocking JSON/SQLite-compatible store work off the event loop."""

        async with self._store_slots:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                self._store_executor,
                partial(function, *args),
            )

    def _read_store_snapshot(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        """Read the closed public projection from an injected store."""

        assert self._canvas_store is not None
        store = self._canvas_store()
        try:
            result = store.read(
                canvas_id,
                actor,
                CanvasProjection.public_snapshot(),
            )
        except CanvasStoreError as exc:
            status = 404 if exc.code == "not_found" else 500
            raise CanvasSyncError(status, exc.message) from exc
        if not isinstance(result.canvas, dict):
            raise CanvasSyncError(500, "CanvasStore 未返回 Canvas 快照")
        return copy.deepcopy(result.canvas)

    def _read_realtime_store_snapshot(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        """Read and require one Smart Canvas for the realtime protocol."""

        canvas = self._read_store_snapshot(canvas_id, actor)
        self._require_smart(canvas)
        return canvas

    def _access_epoch(self, canvas_id: str) -> int:
        return int(self._access_epochs.get(canvas_id, 0))

    def _bump_access_epoch(self, canvas_id: str) -> None:
        self._access_epochs[canvas_id] = self._access_epoch(canvas_id) + 1

    def _remember_revision(self, canvas_id: str, revision: int) -> None:
        self._realtime_revisions[canvas_id] = max(
            int(revision or 0),
            int(self._realtime_revisions.get(canvas_id, 0)),
        )

    @staticmethod
    def _realtime_access_scope(canvas: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "owner_id": str(canvas.get("owner_id") or ""),
            "owner_username": str(canvas.get("owner_username") or ""),
            "visibility": str(canvas.get("visibility") or "shared"),
            "project": str(canvas.get("project") or DEFAULT_PROJECT_ID),
        }

    def _require_realtime_session_actor(
        self,
        session: RealtimeSession,
        actor: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        if (
            session.access_epoch != self._access_epoch(session.canvas_id)
            or not actor
            or str(actor.get("id") or "") != session.actor_id
            or actor.get("status", "active") != "active"
            or not can_access_canvas(
                actor,
                dict(session.access_scope),
                write=True,
            )
        ):
            raise CanvasSyncError(404, "画布不存在")
        return actor

    def _path(self, canvas_id: str) -> Path:
        try:
            return Path(self._content().smart_canvas(canvas_id))
        except WorkspaceStorageError as exc:
            raise CanvasSyncError(400, str(exc)) from exc

    def _directory(self) -> Path:
        return Path(self._content().smart_canvases)

    def _projects_path(self) -> Path:
        return Path(self._content().projects)

    @staticmethod
    def _require_actor(
        canvas: Dict[str, Any],
        actor: Dict[str, Any] | None,
        *,
        write: bool,
        include_deleted: bool = False,
        allowed_roles: tuple[str, ...] = ("admin", "designer"),
    ) -> Dict[str, Any]:
        if (
            not actor
            or actor.get("status", "active") != "active"
            or actor.get("role") not in allowed_roles
            or not can_access_canvas(actor, canvas, write=write)
        ):
            # Preserve the existing non-disclosure response for private canvases.
            raise CanvasSyncError(404, "画布不存在")
        if canvas.get("deleted_at") and not include_deleted:
            raise CanvasSyncError(404, "画布已在回收站")
        return actor

    def _migrate_access_locked(
        self,
        canvas: Dict[str, Any],
        path: Path,
    ) -> None:
        if not self._ensure_access_fields(canvas):
            return
        if self._recovery_directory is not None:
            backup_directory = (
                Path(self._recovery_directory()) / "v0_canvas_permissions"
            )
            backup_path = backup_directory / path.name
            backup_directory.mkdir(parents=True, exist_ok=True)
            if path.is_file() and not backup_path.exists():
                shutil.copy2(path, backup_path)
        self._write_locked(path, canvas, suffix="access")

    def _ensure_access_fields(self, canvas: Dict[str, Any]) -> bool:
        """Normalize legacy access fields in memory without persisting a read."""

        initial_admin = self._initial_admin()
        owner_id = str(canvas.get("owner_id") or "")
        owner = self._user_by_id(owner_id) if owner_id else None
        return ensure_canvas_access_fields(canvas, initial_admin, owner)

    def _read_locked(
        self,
        canvas_id: str,
    ) -> tuple[Path, Dict[str, Any]]:
        path = self._path(canvas_id)
        if not path.exists():
            raise CanvasSyncError(404, "画布不存在")
        try:
            with path.open("r", encoding="utf-8") as source:
                canvas = json.load(source)
        except FileNotFoundError as exc:
            raise CanvasSyncError(404, "画布不存在") from exc
        if not isinstance(canvas, dict):
            raise CanvasSyncError(500, "画布数据无效")
        self._ensure_access_fields(canvas)
        return path, canvas

    @staticmethod
    def _replace_bytes_locked(
        path: Path,
        content: bytes | Iterable[bytes],
        *,
        suffix: str,
    ) -> None:
        temporary = path.with_name(
            f".{path.name}.{suffix}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("wb") as output:
                chunks = (content,) if isinstance(content, bytes) else content
                for chunk in chunks:
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    @classmethod
    def _write_locked(
        cls,
        path: Path,
        canvas: Dict[str, Any],
        *,
        suffix: str,
    ) -> None:
        def encoded_chunks() -> Iterable[bytes]:
            encoder = json.JSONEncoder(ensure_ascii=False, indent=2)
            buffer = bytearray()
            for part in encoder.iterencode(canvas):
                buffer.extend(part.encode("utf-8"))
                if len(buffer) >= CANVAS_JSON_WRITE_CHUNK_BYTES:
                    yield bytes(buffer)
                    buffer.clear()
            if buffer:
                yield bytes(buffer)

        cls._replace_bytes_locked(path, encoded_chunks(), suffix=suffix)

    @classmethod
    def _write_batch_locked(
        cls,
        documents: list[tuple[Path, Dict[str, Any]]],
        *,
        suffix: str,
    ) -> None:
        originals = {
            path: path.read_bytes() if path.exists() else None
            for path, _document in documents
        }
        try:
            for path, document in documents:
                cls._write_locked(path, document, suffix=suffix)
        except Exception:
            for path, original in originals.items():
                if original is None:
                    try:
                        path.unlink()
                    except FileNotFoundError:
                        pass
                else:
                    cls._replace_bytes_locked(
                        path,
                        original,
                        suffix=f"{suffix}-rollback",
                    )
            raise

    def read(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        *,
        write: bool = False,
        include_deleted: bool = False,
        smart_snapshot: bool = False,
    ) -> Dict[str, Any]:
        """Read one freshly-authorized Canvas through the same storage seam."""

        if self._canvas_store is not None:
            if include_deleted:
                raise CanvasSyncError(
                    500,
                    "CanvasStore 尚未提供已删除 Canvas projection",
                )
            canvas = self._read_store_snapshot(canvas_id, actor)
            return (
                public_snapshot(canvas)
                if smart_snapshot
                and normalize_canvas_kind(canvas.get("kind")) == "smart"
                else canvas
            )
        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            self._require_actor(
                canvas,
                actor,
                write=write,
                include_deleted=include_deleted,
            )
            return (
                public_snapshot(canvas)
                if smart_snapshot
                and normalize_canvas_kind(canvas.get("kind")) == "smart"
                else copy.deepcopy(canvas)
            )

    def read_generation_log_page(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        *,
        node_id: str = "",
        cursor: str = "",
        limit: int = 50,
    ) -> Dict[str, Any]:
        """Read persisted Generation History without inflating Canvas snapshots."""

        projection = CanvasProjection.log_page(
            node_id=node_id,
            cursor=cursor,
            limit=limit,
            include_details=True,
        )
        if self._canvas_store is not None:
            try:
                result = self._canvas_store().read(
                    canvas_id,
                    actor,
                    projection,
                )
            except CanvasStoreError as exc:
                status = 404 if exc.code == "not_found" else 500
                raise CanvasSyncError(status, exc.message) from exc
            return {
                "logs": [copy.deepcopy(item) for item in result.logs],
                "next_cursor": str(result.next_cursor or ""),
            }

        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            self._require_actor(canvas, actor)
            logs = [
                copy.deepcopy(item)
                for item in list(canvas.get("logs") or [])
                if isinstance(item, Mapping)
                and (
                    not node_id
                    or str(item.get("nodeId") or item.get("node_id") or "")
                    == str(node_id)
                )
            ]
        logs.sort(
            key=lambda item: (
                int(item.get("createdAt") or item.get("created_at") or 0),
                str(item.get("id") or item.get("log_id") or ""),
            ),
            reverse=True,
        )
        try:
            offset = max(0, int(cursor.removeprefix("legacy:"))) if cursor else 0
        except ValueError:
            offset = 0
        page = logs[offset : offset + projection.limit]
        next_offset = offset + len(page)
        return {
            "logs": page,
            "next_cursor": (
                f"legacy:{next_offset}" if next_offset < len(logs) else ""
            ),
        }

    def read_generation_log_detail(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        log_id: str,
    ) -> Dict[str, Any]:
        """Read one persisted Generation History record with diagnostic detail."""

        if self._canvas_store is not None:
            try:
                result = self._canvas_store().read(
                    canvas_id,
                    actor,
                    CanvasProjection.log_detail(log_id),
                )
            except CanvasStoreError as exc:
                status = 404 if exc.code in {"not_found", "log_not_found"} else 500
                raise CanvasSyncError(status, exc.message) from exc
            if not isinstance(result.log, dict):
                raise CanvasSyncError(500, "CanvasStore 未返回生成日志")
            return copy.deepcopy(result.log)

        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            self._require_actor(canvas, actor)
            for item in list(canvas.get("logs") or []):
                if (
                    isinstance(item, Mapping)
                    and str(item.get("id") or item.get("log_id") or "")
                    == str(log_id or "")
                ):
                    return copy.deepcopy(dict(item))
        raise CanvasSyncError(404, "生成日志不存在")

    async def append_generation_log(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        log: Mapping[str, Any],
    ) -> str:
        """Persist one final Generation History record through one interface."""

        canvas_id = str(canvas_id or "").strip()
        if not canvas_id or not isinstance(log, Mapping):
            raise CanvasSyncError(400, "最终日志数据无效")
        normalized = copy.deepcopy(dict(log))
        status = str(normalized.get("status") or "").strip().lower()
        if status not in {"success", "partial", "failed", "cancelled"}:
            raise CanvasSyncError(400, "日志必须是最终状态")
        log_id = str(
            normalized.get("id")
            or normalized.get("log_id")
            or uuid.uuid4().hex
        ).strip()
        run_id = str(
            normalized.get("runId")
            or normalized.get("run_id")
            or normalized.get("generationRunId")
            or ""
        ).strip()
        normalized["id"] = log_id
        if run_id:
            normalized["runId"] = run_id
        if "durationMs" not in normalized and "runMs" in normalized:
            normalized["durationMs"] = normalized.get("runMs")
        operation_identity = json.dumps(
            {
                "canvas_id": canvas_id,
                "log_id": log_id,
                "run_id": run_id,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        operation_id = (
            "generation-log:"
            + hashlib.sha256(operation_identity).hexdigest()
        )

        if self._canvas_store is not None:
            async with self._operation_lock(canvas_id):
                try:
                    committed = await self._run_store(
                        self._commit_store_generation_output,
                        canvas_id,
                        actor,
                        CanvasIntent.append_final_log(
                            normalized,
                            operation_id=operation_id,
                        ),
                    )
                except CanvasStoreError as exc:
                    status_code = {
                        "not_found": 404,
                        "forbidden": 403,
                    }.get(exc.code, 400)
                    raise CanvasSyncError(status_code, exc.message) from exc
            return str(committed.log_id or log_id)

        # Temporary server-side adapter for Workspaces that have not completed
        # the controlled SQLite cutover. Browser code never sees this mode.
        async with self._operation_lock(canvas_id):
            with self._file_lock:
                path, canvas = self._read_locked(canvas_id)
                self._require_actor(canvas, actor, write=True)
                self._require_smart(canvas, mutation=True)
                logs = [
                    item
                    for item in list(canvas.get("logs") or [])
                    if isinstance(item, Mapping)
                ]
                for existing in logs:
                    existing_id = str(
                        existing.get("id") or existing.get("log_id") or ""
                    )
                    existing_run_id = str(
                        existing.get("runId")
                        or existing.get("run_id")
                        or existing.get("generationRunId")
                        or ""
                    )
                    if existing_id == log_id or (
                        run_id and existing_run_id == run_id
                    ):
                        return existing_id or log_id
                logs.append(normalized)
                canvas["logs"] = logs[-500:]
                self._write_locked(path, canvas, suffix="generation-log")
        return log_id

    def read_shared(self, share: Mapping[str, Any]) -> Dict[str, Any]:
        """Read a public snapshot through one validated share-token grant."""

        grant = CanvasShareGrant(
            workspace_id=str(share.get("workspace_id") or ""),
            canvas_id=str(share.get("canvas_id") or ""),
            token_hash=str(share.get("token_hash") or ""),
        )
        if (
            not bool(share.get("active"))
            or grant.workspace_id != str(self._workspace_id() or "")
            or not grant.canvas_id
            or not grant.token_hash
        ):
            raise CanvasSyncError(404, "分享链接不存在或已失效")
        if self._canvas_store is not None:
            try:
                result = self._canvas_store().read_shared(grant)
            except CanvasStoreError as exc:
                raise CanvasSyncError(404, "分享链接不存在或已失效") from exc
            if not isinstance(result.canvas, dict):
                raise CanvasSyncError(500, "CanvasStore 未返回 Canvas 快照")
            return copy.deepcopy(result.canvas)
        with self._file_lock:
            _path, canvas = self._read_locked(grant.canvas_id)
            if canvas.get("deleted_at") or canvas.get("visibility") == "private":
                raise CanvasSyncError(404, "分享链接不存在或已失效")
            return copy.deepcopy(canvas)

    def read_list_document(self, canvas_id: str) -> Dict[str, Any]:
        """Read one changed list document while applying access migration."""

        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            return copy.deepcopy(canvas)

    def list_canvas_items(
        self,
        actor: Dict[str, Any] | None,
    ) -> list[Dict[str, Any]]:
        """Read authorized lightweight Canvas list projections from a Store."""

        if self._canvas_store is None:
            raise CanvasSyncError(500, "CanvasStore 未配置列表投影")
        try:
            items = self._canvas_store().list_items(actor)
        except CanvasStoreError as exc:
            raise CanvasSyncError(500, exc.message) from exc
        return [copy.deepcopy(item) for item in items]

    def list_index_records(
        self,
        actor: Dict[str, Any] | None,
    ) -> list[Dict[str, Any]] | None:
        """Select Store projections or let the legacy index scan JSON."""

        if self._canvas_store is None:
            return None
        return self.list_canvas_items(actor)

    def list_documents(
        self,
        actor: Dict[str, Any] | None,
        *,
        deleted: bool,
        trash_retention_ms: int,
    ) -> list[Dict[str, Any]]:
        """Return authorized current records after retention cleanup."""

        if self._canvas_store is not None:
            return [
                item
                for item in self.list_canvas_items(actor)
                if bool(item.get("deleted_at")) == bool(deleted)
            ]

        cutoff = int(self._now_ms()) - int(trash_retention_ms)
        records: list[Dict[str, Any]] = []
        with self._file_lock:
            directory = self._directory()
            for path in directory.glob("*.json"):
                try:
                    with path.open("r", encoding="utf-8") as source:
                        canvas = json.load(source)
                    deleted_at = int(canvas.get("deleted_at") or 0)
                    if deleted_at and deleted_at < cutoff:
                        path.unlink()
                        continue
                    self._ensure_access_fields(canvas)
                except Exception:
                    continue
                if bool(canvas.get("deleted_at")) != bool(deleted):
                    continue
                if not can_access_canvas(actor, canvas):
                    continue
                records.append(copy.deepcopy(canvas))
        return records

    def migrate_all_access(self) -> None:
        """Migrate every historical Canvas or fail startup with its filename."""

        if self._canvas_store is not None:
            return
        if not self._initial_admin():
            raise RuntimeError("已配置账号但缺少管理员，无法迁移历史画布权限")
        with self._file_lock:
            for path in self._directory().glob("*.json"):
                try:
                    with path.open("r", encoding="utf-8") as source:
                        canvas = json.load(source)
                    if not isinstance(canvas, dict) or not canvas.get("id"):
                        raise ValueError("画布 JSON 缺少 id")
                    self._migrate_access_locked(canvas, path)
                except Exception as exc:
                    raise RuntimeError(
                        f"历史画布权限迁移失败: {path.name}: {exc}"
                    ) from exc

    def transfer_owned_canvases(
        self,
        target: Mapping[str, Any],
        actor: Mapping[str, Any],
    ) -> int:
        """Synchronously transfer documents before an account is deleted."""

        target_id = str((target or {}).get("id") or "")
        actor_id = str((actor or {}).get("id") or "")
        if not target_id or not actor_id:
            raise ValueError("无法确认账号或接管管理员")
        if self._canvas_store is not None:
            try:
                return self._canvas_store().reassign_owned_canvases(
                    target_id,
                    actor,
                )
            except CanvasStoreError as exc:
                raise ValueError(exc.message) from exc
        documents: list[tuple[Path, Dict[str, Any]]] = []
        with self._file_lock:
            for path in self._directory().glob("*.json"):
                try:
                    with path.open("r", encoding="utf-8") as source:
                        canvas = json.load(source)
                except Exception:
                    continue
                if str(canvas.get("owner_id") or "") != target_id:
                    continue
                canvas["owner_id"] = actor_id
                canvas["owner_username"] = str(
                    (actor or {}).get("username") or ""
                ).strip()
                documents.append((path, canvas))
            self._write_batch_locked(documents, suffix="owner")
            for path, _canvas in documents:
                self._bump_access_epoch(path.stem)
        return len(documents)

    @staticmethod
    def _require_smart(
        canvas: Dict[str, Any],
        *,
        mutation: bool = False,
    ) -> None:
        kind = str(canvas.get("kind") or "").strip().lower()
        if kind == "smart":
            return
        raise CanvasSyncError(
            400,
            (
                "实时 Mutation 仅支持 Smart Canvas。"
                if mutation
                else "实时编辑通道仅支持 Smart Canvas。"
            ),
        )

    async def open_realtime(
        self,
        websocket: Any,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        client_id: str = "",
    ) -> RealtimeSession | None:
        """Authorize, accept, enable, persist, and send one shared snapshot."""

        canvas_id = str(canvas_id or "").strip()
        await self._run_store(self._authorize_realtime_open, canvas_id, actor)

        safe_client_id = re.sub(
            r"[^A-Za-z0-9_.:-]",
            "-",
            str(client_id or ""),
        )[:160] or f"canvas-{uuid.uuid4().hex}"
        session: RealtimeSession | None = None
        try:
            async with self._operation_lock(canvas_id):
                # Register while the Canvas operation lock is held so no
                # committed mutation can be broadcast to this connection
                # before its snapshot has been queued.
                if not await self._notifier.connect_canvas(
                    websocket,
                    canvas_id,
                    safe_client_id,
                ):
                    return None
                snapshot, access_scope = await self._run_store(
                    self._prepare_realtime_snapshot,
                    canvas_id,
                    actor,
                )
                revision = int(snapshot.get("revision") or 0)
                self._remember_revision(canvas_id, revision)
                session = RealtimeSession(
                    canvas_id=canvas_id,
                    client_id=safe_client_id,
                    websocket=websocket,
                    actor_id=str((actor or {}).get("id") or ""),
                    access_epoch=self._access_epoch(canvas_id),
                    access_scope=access_scope,
                    revision=revision,
                )
                sent = await self._notifier.send_canvas_message(
                    websocket,
                    {
                        "type": "canvas_snapshot",
                        "canvas_id": canvas_id,
                        "client_id": safe_client_id,
                        "revision": revision,
                        "canvas": snapshot,
                    },
                )
            if sent:
                try:
                    await self._realtime_presence.join(
                        websocket,
                        canvas_id,
                        actor or {},
                    )
                except Exception:
                    # Presence is an optional, negotiated capability. Canvas
                    # editing remains available if its ephemeral setup fails.
                    pass
                return session
        except Exception:
            if session is not None:
                await self.close_realtime(session)
            else:
                self._notifier.disconnect_canvas(websocket, canvas_id)
            raise
        if session is not None:
            await self.close_realtime(session)
        return None

    def _authorize_realtime_open(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> None:
        if self._canvas_store is not None:
            self._read_realtime_store_snapshot(canvas_id, actor)
            return
        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            self._require_actor(canvas, actor, write=True)
            self._require_smart(canvas)

    def _prepare_realtime_snapshot(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        if self._canvas_store is not None:
            canvas = self._read_realtime_store_snapshot(canvas_id, actor)
            return canvas, self._realtime_access_scope(canvas)
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            self._require_actor(canvas, actor, write=True)
            self._require_smart(canvas)
            enable_realtime(canvas)
            return public_snapshot(canvas), self._realtime_access_scope(canvas)

    async def close_realtime(self, session: RealtimeSession) -> None:
        try:
            try:
                await self._realtime_presence.leave(session.websocket)
            except Exception:
                pass
        finally:
            self._notifier.disconnect_canvas(
                session.websocket,
                session.canvas_id,
            )

    async def reject_invalid_realtime_json(
        self,
        session: RealtimeSession,
    ) -> None:
        await self._notifier.send_canvas_message(
            session.websocket,
            {
                "type": "mutation_rejected",
                "code": "invalid_json",
                "message": "实时消息不是有效 JSON。",
            },
        )

    async def receive_realtime(
        self,
        session: RealtimeSession,
        actor: Dict[str, Any] | None,
        message: Mapping[str, Any],
        *,
        raw_size: int | None = None,
    ) -> None:
        """Handle one realtime message through the ordered Canvas seam."""

        include_timing = message.get("include_timing") is True
        server_received_monotonic_ns = (
            time.monotonic_ns() if include_timing else 0
        )

        if message.get("type") == "presence_update":
            self._require_realtime_session_actor(session, actor)
            if raw_size is None or raw_size <= 1024:
                try:
                    await self._realtime_presence.receive_update(
                        session.websocket,
                        message,
                    )
                except Exception:
                    pass
            return
        if message.get("type") == "presence_resync":
            self._require_realtime_session_actor(session, actor)
            if (raw_size is None or raw_size <= 1024) and set(message) == {"type"}:
                try:
                    await self._realtime_presence.resync(session.websocket)
                except Exception:
                    pass
            return

        if message.get("canvas_id") not in (
            None,
            "",
            session.canvas_id,
        ):
            self._require_realtime_session_actor(session, actor)
            await self._notifier.send_canvas_message(
                session.websocket,
                {
                    "type": "mutation_rejected",
                    "code": "canvas_mismatch",
                    "message": "消息中的 Canvas ID 与实时通道不一致。",
                },
            )
            return
        if message.get("type") == "ping":
            self._require_realtime_session_actor(session, actor)
            try:
                await self._realtime_presence.touch(session.websocket)
            except Exception:
                pass
            response = {
                "type": "pong",
                "revision": int(
                    self._realtime_revisions.get(
                        session.canvas_id,
                        session.revision,
                    )
                ),
            }
            if include_timing:
                response.update(
                    {
                        "server_received_monotonic_ns": (
                            server_received_monotonic_ns
                        ),
                        "server_responding_monotonic_ns": time.monotonic_ns(),
                    }
                )
            await self._notifier.send_canvas_message(
                session.websocket,
                response,
            )
            return
        if message.get("type") != "canvas_mutation":
            self._require_realtime_session_actor(session, actor)
            await self._notifier.send_canvas_message(
                session.websocket,
                {
                    "type": "mutation_rejected",
                    "code": "invalid_message",
                    "message": "实时通道仅接受 Canvas Mutation。",
                },
            )
            return

        try:
            await self._realtime_presence.touch(session.websocket)
        except Exception:
            pass

        if self._canvas_store is None:
            await self._enqueue_json_realtime(
                session,
                actor,
                message,
            )
            return

        async with self._operation_lock(session.canvas_id):
            outgoing, target_only = await self._run_store(
                self._commit_realtime_message,
                session,
                actor,
                message,
            )
            self._remember_revision(
                session.canvas_id,
                int(outgoing.get("revision") or 0),
            )
            if target_only:
                await self._notifier.send_canvas_message(
                    session.websocket,
                    outgoing,
                )
            else:
                await self._notifier.broadcast_canvas_message(
                    session.canvas_id,
                    outgoing,
                )

    async def _enqueue_json_realtime(
        self,
        session: RealtimeSession,
        actor: Dict[str, Any] | None,
        message: Mapping[str, Any],
    ) -> None:
        loop = asyncio.get_running_loop()
        completion: asyncio.Future[None] = loop.create_future()
        self._realtime_batch_pending.setdefault(
            session.canvas_id,
            [],
        ).append(
            _RealtimeBatchRequest(
                session=session,
                actor=actor,
                message=message,
                completion=completion,
            )
        )
        task = self._realtime_batch_tasks.get(session.canvas_id)
        if task is None or task.done():
            self._realtime_batch_tasks[session.canvas_id] = (
                asyncio.create_task(
                    self._flush_json_realtime_batches(session.canvas_id)
                )
            )
        await completion

    async def _flush_json_realtime_batches(self, canvas_id: str) -> None:
        try:
            while True:
                await asyncio.sleep(REALTIME_JSON_BATCH_WINDOW_SECONDS)
                requests = self._realtime_batch_pending.get(canvas_id, [])
                self._realtime_batch_pending[canvas_id] = []
                if not requests:
                    return
                try:
                    async with self._operation_lock(canvas_id):
                        results = await self._run_store(
                            self._commit_json_realtime_batch,
                            requests,
                        )
                        for request, (outgoing, target_only) in zip(
                            requests,
                            results,
                            strict=True,
                        ):
                            self._remember_revision(
                                canvas_id,
                                int(outgoing.get("revision") or 0),
                            )
                            if target_only:
                                await self._notifier.send_canvas_message(
                                    request.session.websocket,
                                    outgoing,
                                )
                            else:
                                await self._notifier.broadcast_canvas_message(
                                    canvas_id,
                                    outgoing,
                                )
                    for request in requests:
                        if (
                            request.completion is not None
                            and not request.completion.done()
                        ):
                            request.completion.set_result(None)
                except Exception as exc:
                    for request in requests:
                        if (
                            request.completion is not None
                            and not request.completion.done()
                        ):
                            request.completion.set_exception(exc)
                if not self._realtime_batch_pending.get(canvas_id):
                    return
        finally:
            self._realtime_batch_tasks.pop(canvas_id, None)
            pending = self._realtime_batch_pending.get(canvas_id)
            if not pending:
                self._realtime_batch_pending.pop(canvas_id, None)

    def _commit_realtime_message(
        self,
        session: RealtimeSession,
        actor: Dict[str, Any] | None,
        message: Mapping[str, Any],
    ) -> tuple[Dict[str, Any], bool]:
        if self._canvas_store is not None:
            return self._commit_store_realtime_message(
                session,
                actor,
                message,
            )
        return self._commit_json_realtime_batch(
            [
                _RealtimeBatchRequest(
                    session=session,
                    actor=actor,
                    message=message,
                    completion=None,
                )
            ]
        )[0]

    def _commit_json_realtime_batch(
        self,
        requests: list[_RealtimeBatchRequest],
    ) -> list[tuple[Dict[str, Any], bool]]:
        if not requests:
            return []
        with self._file_lock:
            canvas_id = requests[0].session.canvas_id
            path, canvas = self._read_locked(canvas_id)
            self._require_smart(canvas, mutation=True)
            results: list[tuple[Dict[str, Any], bool]] = []
            changed = False
            for request in requests:
                actor = self._require_actor(
                    canvas,
                    request.actor,
                    write=True,
                )
                raw_operation = request.message.get("operation")
                operation = (
                    raw_operation
                    if isinstance(raw_operation, dict)
                    else dict(request.message)
                )
                previous_revision = int(canvas.get("revision") or 0)
                try:
                    result = apply_operation(
                        canvas,
                        operation,
                        str(actor.get("id") or ""),
                    )
                except CanvasRealtimeError as exc:
                    outgoing: Dict[str, Any] = {
                        "type": "mutation_rejected",
                        "canvas_id": canvas_id,
                        "operation_id": str(
                            operation.get("operation_id") or ""
                        ),
                        "code": exc.code,
                        "message": exc.message,
                        "revision": exc.revision,
                    }
                    if exc.retry_changes:
                        outgoing["retry_changes"] = exc.retry_changes
                    results.append((outgoing, True))
                    continue
                operation_changed = (
                    not result.duplicate
                    and result.revision > previous_revision
                )
                if operation_changed:
                    changed = True
                    canvas["updated_by"] = str(actor.get("id") or "")
                    canvas["updated_at"] = int(self._now_ms())
                outgoing = result.message()
                outgoing.update(
                    {
                        "canvas_id": canvas_id,
                        "client_id": request.session.client_id,
                    }
                )
                if not operation_changed:
                    outgoing["changed"] = False
                results.append((outgoing, not operation_changed))
            if changed:
                self._write_locked(path, canvas, suffix="realtime")
            return results

    def _commit_store_realtime_message(
        self,
        session: RealtimeSession,
        actor: Dict[str, Any] | None,
        message: Mapping[str, Any],
    ) -> tuple[Dict[str, Any], bool]:
        """Commit through CanvasStore and consume its persisted event."""

        assert self._canvas_store is not None
        store = self._canvas_store()
        raw_operation = message.get("operation")
        operation = (
            raw_operation
            if isinstance(raw_operation, dict)
            else dict(message)
        )
        try:
            committed = store.commit(
                session.canvas_id,
                actor,
                CanvasIntent.canvas_mutation(operation),
            )
        except CanvasStoreError as exc:
            if exc.code == "not_found":
                raise CanvasSyncError(404, "画布不存在") from exc
            outgoing: Dict[str, Any] = {
                "type": "mutation_rejected",
                "canvas_id": session.canvas_id,
                "operation_id": str(operation.get("operation_id") or ""),
                "code": exc.code,
                "message": exc.message,
                "revision": exc.revision,
            }
            if exc.retry_changes:
                outgoing["retry_changes"] = exc.retry_changes
            return outgoing, True
        if not isinstance(committed.event, dict):
            raise CanvasSyncError(
                500,
                "CanvasStore Mutation 缺少持久化事件",
            )
        outgoing = copy.deepcopy(committed.event)
        outgoing.update(
            {
                "canvas_id": session.canvas_id,
                "client_id": session.client_id,
            }
        )
        return outgoing, committed.duplicate or not committed.changed

    def _commit_store_generation_output(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        intent: CanvasIntent,
    ) -> Any:
        """Resolve the Workspace store and commit inside its executor."""

        assert self._canvas_store is not None
        return self._canvas_store().commit(canvas_id, actor, intent)

    async def _submit_store_deleted_state(
        self,
        command: CanvasCommand,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        canvas_id = str(command.canvas_id or "").strip()
        operation_id = (
            f"management:{command.action}:{uuid.uuid4().hex}"
        )
        if command.action == TRASH_CANVAS:
            intent = CanvasIntent.trash_canvas(operation_id=operation_id)
        elif command.action == RESTORE_CANVAS:
            intent = CanvasIntent.restore_canvas(operation_id=operation_id)
        else:
            intent = CanvasIntent.purge_canvas(operation_id=operation_id)
        try:
            committed = await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                intent,
            )
        except CanvasStoreError as exc:
            status = {
                "not_found": 404,
                "forbidden": 403,
            }.get(exc.code, 400)
            raise CanvasSyncError(status, exc.message) from exc
        if committed.changed:
            self._bump_access_epoch(canvas_id)
        if command.action in {TRASH_CANVAS, PURGE_CANVAS}:
            self._administration.revoke_canvas_share(
                self._workspace_id(),
                canvas_id,
                str((actor or {}).get("id") or ""),
            )
            return CanvasSyncResult(value={"ok": True})
        canvas = await self._run_store(
            self._read_store_snapshot,
            canvas_id,
            actor,
        )
        return CanvasSyncResult(canvas=canvas)

    async def _submit_store_metadata(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        prepared = copy.deepcopy(dict(values))
        if prepared.get("cover_url") is not None:
            cover_url = normalize_canvas_cover_url(prepared.get("cover_url"))
            if prepared.get("cover_url") and not cover_url:
                raise CanvasSyncError(400, "封面图地址无效")
            prepared["cover_url"] = cover_url
        try:
            previous = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
            committed = await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                CanvasIntent.update_metadata(
                    prepared,
                    operation_id=f"management:metadata:{uuid.uuid4().hex}",
                ),
            )
            canvas = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
        except CanvasStoreError as exc:
            status = {
                "not_found": 404,
                "forbidden": 403,
            }.get(exc.code, 400)
            raise CanvasSyncError(status, exc.message) from exc
        if (
            committed.changed
            and self._realtime_access_scope(previous)
            != self._realtime_access_scope(canvas)
        ):
            self._bump_access_epoch(canvas_id)
        return CanvasSyncResult(canvas=canvas)

    async def _submit_store_visibility(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        visibility: str,
    ) -> CanvasSyncResult:
        try:
            committed = await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                CanvasIntent.set_visibility(
                    visibility,
                    operation_id=f"management:visibility:{uuid.uuid4().hex}",
                ),
            )
            canvas = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
        except CanvasStoreError as exc:
            status = {
                "not_found": 404,
                "forbidden": 403,
                "invalid_visibility": 400,
            }.get(exc.code, 400)
            raise CanvasSyncError(status, exc.message) from exc
        if committed.changed:
            self._bump_access_epoch(canvas_id)
        if canvas.get("visibility") == "private":
            self._administration.revoke_canvas_share(
                self._workspace_id(),
                canvas_id,
                str((actor or {}).get("id") or ""),
            )
        self._administration.audit(
            "canvas_visibility_changed",
            actor_id=str((actor or {}).get("id") or ""),
            target_type="canvas",
            target_id=canvas_id,
            details={"visibility": canvas.get("visibility")},
            workspace_id=self._workspace_id(),
        )
        return CanvasSyncResult(canvas=canvas)

    async def _submit_store_touch(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        try:
            await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                CanvasIntent.touch_canvas(
                    operation_id=f"management:touch:{uuid.uuid4().hex}",
                ),
            )
            canvas = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
        except CanvasStoreError as exc:
            status = 404 if exc.code == "not_found" else 400
            raise CanvasSyncError(status, exc.message) from exc
        return CanvasSyncResult(canvas=canvas)

    async def _submit_store_snapshot(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        try:
            committed = await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                CanvasIntent.save_snapshot(
                    values,
                    operation_id=f"management:snapshot:{uuid.uuid4().hex}",
                ),
            )
            canvas = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
        except CanvasStoreError as exc:
            status = {
                "not_found": 404,
                "stale_snapshot": 409,
                "realtime_mutation_required": 409,
            }.get(exc.code, 400)
            raise CanvasSyncError(status, exc.message) from exc
        if committed.changed:
            await self._notifier.broadcast_canvas_updated(
                canvas_id,
                int(canvas.get("updated_at") or self._now_ms()),
                str(values.get("client_id") or ""),
            )
        return CanvasSyncResult(canvas=canvas)

    async def _submit_store_prompt_templates(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        operation_id = str(values.get("operation_id") or "").strip()
        try:
            prompt_intent = values.get("intent")
            store_intent = (
                CanvasIntent.commit_prompt(
                    prompt_intent,
                    operation_id=operation_id,
                )
                if isinstance(prompt_intent, Mapping)
                else CanvasIntent.update_prompt_templates(
                    list(values.get("templates") or []),
                    base_revision=max(0, int(values.get("base_revision") or 0)),
                    operation_id=operation_id,
                )
            )
            committed = await self._run_store(
                self._commit_store_generation_output,
                canvas_id,
                actor,
                store_intent,
            )
            canvas = await self._run_store(
                self._read_store_snapshot,
                canvas_id,
                actor,
            )
        except CanvasStoreError as exc:
            status = {
                "not_found": 404,
                "forbidden": 403,
                "invalid_operation_id": 400,
                "invalid_prompt_templates": 400,
                "invalid_prompt_intent": 400,
                "missing_prompt_template_version": 409,
                "stale_prompt_templates": 409,
                "prompt_template_conflict": 409,
                "operation_collision": 409,
                "prompt_template_missing": 404,
            }.get(exc.code, 400)
            detail: Any = exc.message
            if exc.code in {
                "stale_prompt_templates",
                "prompt_template_conflict",
                "missing_prompt_template_version",
                "operation_collision",
            }:
                detail = {
                    "code": exc.code,
                    "message": exc.message,
                    "revision": exc.revision,
                }
            raise CanvasSyncError(status, detail) from exc
        if committed.changed and not committed.duplicate:
            self._remember_revision(canvas_id, committed.revision)
            await self._notifier.broadcast_canvas_message(
                canvas_id,
                {
                    "type": "canvas_mutation",
                    "canvas_id": canvas_id,
                    "operation_id": operation_id,
                    "revision": committed.revision,
                    "actor_id": str((actor or {}).get("id") or ""),
                    "changes": {
                        "node_creates": [],
                        "node_updates": [],
                        "node_unsets": [],
                        "node_deletes": [],
                        "connection_adds": [],
                        "connection_removes": [],
                        "canvas_updates": [],
                        "canvas_unsets": [],
                    },
                    "duplicate": False,
                    "reverts_operation_id": "",
                    "undoable": False,
                    "non_undoable_canvas_roots": ["prompt_templates"],
                    "client_id": str(values.get("client_id") or ""),
                },
            )
            await self._notifier.broadcast_canvas_updated(
                canvas_id,
                int(canvas.get("updated_at") or self._now_ms()),
                str(values.get("client_id") or ""),
            )
        return CanvasSyncResult(canvas=canvas)

    async def submit(
        self,
        command: CanvasCommand,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        """Complete one write before releasing its per-Canvas order."""

        canvas_id = str(command.canvas_id or "").strip()
        if command.action == CREATE_CANVAS:
            async with self._administration_lock:
                if self._canvas_store is not None:
                    return await self._create_store_canvas(
                        actor,
                        command.values,
                    )
                return self._create_canvas(actor, command.values)
        if command.action == DELETE_PROJECT:
            async with self._administration_lock:
                if self._canvas_store is not None:
                    return await self._run_store(
                        self._delete_store_project,
                        canvas_id,
                        actor,
                    )
                return self._delete_project(canvas_id, actor)
        async with self._operation_lock(canvas_id):
            if (
                self._canvas_store is not None
                and command.action
                in {TRASH_CANVAS, RESTORE_CANVAS, PURGE_CANVAS}
            ):
                return await self._submit_store_deleted_state(command, actor)
            if (
                self._canvas_store is not None
                and command.action == UPDATE_METADATA
            ):
                return await self._submit_store_metadata(
                    canvas_id,
                    actor,
                    command.values,
                )
            if (
                self._canvas_store is not None
                and command.action == SET_VISIBILITY
            ):
                return await self._submit_store_visibility(
                    canvas_id,
                    actor,
                    str(command.values.get("visibility") or ""),
                )
            if (
                self._canvas_store is not None
                and command.action == TOUCH_CANVAS
            ):
                return await self._submit_store_touch(canvas_id, actor)
            if (
                self._canvas_store is not None
                and command.action == SAVE_SNAPSHOT
            ):
                return await self._submit_store_snapshot(
                    canvas_id,
                    actor,
                    command.values,
                )
            if (
                self._canvas_store is not None
                and command.action == UPDATE_PROMPT_TEMPLATES
            ):
                return await self._submit_store_prompt_templates(
                    canvas_id,
                    actor,
                    command.values,
                )
            if command.action == SAVE_SNAPSHOT:
                return await self._save_snapshot(
                    canvas_id,
                    actor,
                    command.values,
                )
            if command.action == UPDATE_PROMPT_TEMPLATES:
                return await self._update_prompt_templates(
                    canvas_id,
                    actor,
                    command.values,
                )
            if command.action == UPDATE_METADATA:
                return self._update_metadata(
                    canvas_id,
                    actor,
                    command.values,
                )
            if command.action == SET_VISIBILITY:
                return self._set_visibility(
                    canvas_id,
                    actor,
                    command.values,
                )
            if command.action == TOUCH_CANVAS:
                return self._touch_canvas(canvas_id, actor)
            if command.action == TRASH_CANVAS:
                return self._trash_canvas(canvas_id, actor)
            if command.action == RESTORE_CANVAS:
                return self._restore_canvas(canvas_id, actor)
            if command.action == PURGE_CANVAS:
                return self._purge_canvas(canvas_id, actor)
        raise ValueError(f"unsupported Canvas command: {command.action}")

    async def apply_generation_result_if_current(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        *,
        node_id: str,
        operation_id: str,
        request_index: int,
        run_id: str,
        node_changes: Mapping[str, Any],
        log: Mapping[str, Any] | None = None,
        effect_id: str = "",
    ) -> CanvasGenerationApplyResult:
        """Atomically validate and apply one Generation Output.

        A provider may finish after the user deletes a Node or starts another
        Generation Run.  Re-reading under the per-Canvas lock is the only
        moment that can safely decide whether the output still belongs.
        """

        canvas_id = str(canvas_id or "").strip()
        node_id = str(node_id or "").strip()
        operation_id = str(operation_id or "").strip()
        request_index = max(0, int(request_index or 0))
        run_id = str(run_id or "").strip()
        if self._canvas_store is not None:
            effect_id = str(effect_id or "").strip()
            if not effect_id:
                effect_identity = json.dumps(
                    {
                        "canvas_id": canvas_id,
                        "node_id": node_id,
                        "generation_operation_id": operation_id,
                        "request_index": request_index,
                        "run_id": run_id,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
                effect_id = (
                    "generation:"
                    + hashlib.sha256(effect_identity).hexdigest()
                )
            final_log = copy.deepcopy(dict(log)) if log else None
            if final_log is not None:
                status = str(final_log.get("status") or "").lower()
                final_log["status"] = {
                    "succeeded": "success",
                    "canceled": "cancelled",
                }.get(status, status)
            async with self._operation_lock(canvas_id):
                try:
                    committed = await self._run_store(
                        self._commit_store_generation_output,
                        canvas_id,
                        actor,
                        CanvasIntent.generation_output_commit(
                            effect_id=effect_id,
                            node_id=node_id,
                            generation_operation_id=operation_id,
                            request_index=request_index,
                            run_id=run_id,
                            node_changes=node_changes,
                            final_log=final_log,
                        ),
                    )
                except CanvasStoreError as exc:
                    status_code = 404 if exc.code == "not_found" else 400
                    raise CanvasSyncError(status_code, exc.message) from exc
                if committed.effect_applied is None:
                    raise CanvasSyncError(
                        500,
                        "CanvasStore 未返回 Generation Output 结果",
                    )
                if isinstance(committed.event, Mapping):
                    await self._notifier.broadcast_canvas_updated(
                        canvas_id,
                        int(committed.event.get("updated_at") or 0),
                        "",
                    )
                return CanvasGenerationApplyResult(
                    bool(committed.effect_applied),
                    committed.reason,
                    committed.revision,
                )
        async with self._operation_lock(canvas_id):
            with self._file_lock:
                path, canvas = self._read_locked(canvas_id)
                actor = self._require_actor(canvas, actor, write=True)
                self._require_smart(canvas, mutation=True)
                applied_runs = canvas.get("_generation_runs")
                if not isinstance(applied_runs, dict):
                    applied_runs = {}
                applied = applied_runs.get(run_id)
                if (
                    run_id
                    and isinstance(applied, dict)
                    and str(applied.get("operation_id") or "")
                    == operation_id
                    and int(applied.get("request_index") or 0)
                    == request_index
                ):
                    return CanvasGenerationApplyResult(
                        True,
                        "already_applied",
                        int(canvas.get("revision") or 0),
                    )
                node = next(
                    (
                        item
                        for item in (canvas.get("nodes") or [])
                        if str(item.get("id") or "") == node_id
                    ),
                    None,
                )
                revision = int(canvas.get("revision") or 0)
                if node is None:
                    return CanvasGenerationApplyResult(
                        False, "node_deleted", revision
                    )
                if (
                    str(node.get("generationOperationId") or "")
                    != operation_id
                ):
                    return CanvasGenerationApplyResult(
                        False, "operation_replaced", revision
                    )
                if not node_changes and not log:
                    return CanvasGenerationApplyResult(
                        True, "no_changes", revision
                    )
                updated_node = apply_generation_node_changes(
                    node,
                    node_changes,
                    run_id=run_id,
                )
                node.clear()
                node.update(updated_node)
                if log:
                    logs = canvas.get("logs")
                    if not isinstance(logs, list):
                        logs = []
                        canvas["logs"] = logs
                    logs.append(copy.deepcopy(dict(log)))
                canvas["updated_by"] = str(actor.get("id") or "")
                canvas["updated_at"] = int(self._now_ms())
                canvas["revision"] = revision + 1
                if run_id:
                    applied_runs[run_id] = {
                        "operation_id": operation_id,
                        "request_index": request_index,
                    }
                    canvas["_generation_runs"] = applied_runs
                self._write_locked(path, canvas, suffix="generation")
                revision = int(canvas["revision"])
                updated_at = int(canvas["updated_at"])
            await self._notifier.broadcast_canvas_updated(
                canvas_id,
                updated_at,
                "",
            )
            return CanvasGenerationApplyResult(True, "", revision)

    @staticmethod
    def _require_create_actor(
        actor: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        if (
            not actor
            or actor.get("status", "active") != "active"
            or actor.get("role") not in {"admin", "designer"}
        ):
            raise CanvasSyncError(403, "权限不足")
        return actor

    def _new_canvas(
        self,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> Dict[str, Any]:
        actor = self._require_create_actor(actor)
        project_id = (
            str(values.get("project") or "").strip() or DEFAULT_PROJECT_ID
        )
        if not can_access_project(actor, project_id):
            raise CanvasSyncError(403, "当前账号无权访问目标项目")
        timestamp = int(self._now_ms())
        kind = normalize_canvas_kind(values.get("kind"))
        canvas = {
            "id": uuid.uuid4().hex,
            "title": (
                values.get("title")
                or ("智能画布" if kind == "smart" else "未命名画布")
            )[:80],
            "icon": (
                values.get("icon")
                or ("sparkles" if kind == "smart" else "🧩")
            )[:32],
            "kind": kind,
            "owner_id": actor["id"],
            "owner_username": actor["username"],
            "visibility": "shared",
            "created_by": actor["id"],
            "updated_by": actor["id"],
            "owner": "",
            "color": "",
            "pinned": False,
            "project": project_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            "revision": 0,
            "nodes": [],
            "connections": [],
            "viewport": {"x": 0, "y": 0, "scale": 1},
        }
        if values.get("board_x") is not None:
            canvas["board_x"] = float(values["board_x"])
        if values.get("board_y") is not None:
            canvas["board_y"] = float(values["board_y"])
        return canvas

    def _create_canvas(
        self,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        canvas = self._new_canvas(actor, values)
        with self._file_lock:
            path = self._path(canvas["id"])
            path.parent.mkdir(parents=True, exist_ok=True)
            self._write_locked(path, canvas, suffix="create")
        return CanvasSyncResult(canvas=copy.deepcopy(canvas))

    async def _create_store_canvas(
        self,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        canvas = self._new_canvas(actor, values)
        try:
            await self._run_store(
                self._commit_store_generation_output,
                canvas["id"],
                actor,
                CanvasIntent.create_canvas(
                    canvas,
                    operation_id=f"management:create:{canvas['id']}",
                ),
            )
            stored = await self._run_store(
                self._read_store_snapshot,
                canvas["id"],
                actor,
            )
        except CanvasStoreError as exc:
            status = 404 if exc.code == "not_found" else 400
            raise CanvasSyncError(status, exc.message) from exc
        return CanvasSyncResult(canvas=stored)

    def _update_metadata(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(canvas, actor, write=True)
            before = copy.deepcopy(canvas)
            original_project = str(
                canvas.get("project") or DEFAULT_PROJECT_ID
            )
            if values.get("title") is not None:
                canvas["title"] = (
                    values.get("title")
                    or canvas.get("title")
                    or "未命名画布"
                )[:80]
            if values.get("icon") is not None:
                canvas["icon"] = (values.get("icon") or "layers")[:32]
            if values.get("owner") is not None:
                canvas["owner"] = str(values.get("owner") or "").strip()[:40]
            if values.get("color") is not None:
                canvas["color"] = normalize_canvas_color(values.get("color"))
            if values.get("pinned") is not None:
                canvas["pinned"] = bool(values.get("pinned"))
            if values.get("project") is not None:
                project_id = (
                    str(values.get("project") or "").strip()
                    or DEFAULT_PROJECT_ID
                )
                if not can_access_project(actor, project_id):
                    raise CanvasSyncError(403, "当前账号无权访问目标项目")
                canvas["project"] = project_id
            if values.get("board_x") is not None:
                canvas["board_x"] = float(values["board_x"])
            if values.get("board_y") is not None:
                canvas["board_y"] = float(values["board_y"])
            if values.get("cover_url") is not None:
                cover_url = normalize_canvas_cover_url(
                    values.get("cover_url")
                )
                if values.get("cover_url") and not cover_url:
                    raise CanvasSyncError(400, "封面图地址无效")
                if cover_url:
                    canvas["cover_image"] = {
                        "url": cover_url,
                        "node_id": str(
                            values.get("cover_node_id") or ""
                        )[:160],
                        "image_index": max(
                            0,
                            int(values.get("cover_image_index") or 0),
                        ),
                    }
                else:
                    canvas.pop("cover_image", None)
            identity_changed = any(
                canvas.get(key) != before.get(key) for key in ("title", "icon")
            )
            if identity_changed:
                canvas["updated_by"] = str(actor.get("id") or "")
                canvas["updated_at"] = int(self._now_ms())
            if canvas != before:
                self._write_locked(path, canvas, suffix="metadata")
            if (
                str(canvas.get("project") or DEFAULT_PROJECT_ID)
                != original_project
            ):
                self._bump_access_epoch(canvas_id)
            return CanvasSyncResult(canvas=copy.deepcopy(canvas))

    def _set_visibility(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(
                canvas,
                actor,
                write=True,
                allowed_roles=("admin",),
            )
            previous_visibility = str(canvas.get("visibility") or "")
            try:
                set_canvas_visibility(
                    canvas,
                    str(values.get("visibility") or ""),
                    actor,
                )
            except ValueError as exc:
                raise CanvasSyncError(400, str(exc)) from exc
            except PermissionError as exc:
                raise CanvasSyncError(403, str(exc)) from exc
            if canvas.get("visibility") == "private":
                self._administration.revoke_canvas_share(
                    self._workspace_id(),
                    canvas_id,
                    str(actor.get("id") or ""),
                )
            if str(canvas.get("visibility") or "") != previous_visibility:
                self._write_locked(path, canvas, suffix="visibility")
                self._bump_access_epoch(canvas_id)
            result = copy.deepcopy(canvas)
        self._administration.audit(
            "canvas_visibility_changed",
            actor_id=str(actor.get("id") or ""),
            target_type="canvas",
            target_id=canvas_id,
            details={"visibility": result.get("visibility")},
            workspace_id=self._workspace_id(),
        )
        return CanvasSyncResult(canvas=result)

    def _touch_canvas(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        with self._file_lock:
            _path, canvas = self._read_locked(canvas_id)
            self._require_actor(canvas, actor, write=True)
            return CanvasSyncResult(canvas=copy.deepcopy(canvas))

    def _trash_canvas(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(
                canvas,
                actor,
                write=True,
                include_deleted=True,
            )
            if not canvas.get("deleted_at"):
                canvas["deleted_at"] = int(self._now_ms())
                self._write_locked(path, canvas, suffix="trash")
                self._bump_access_epoch(canvas_id)
            self._administration.revoke_canvas_share(
                self._workspace_id(),
                canvas_id,
                str(actor.get("id") or ""),
            )
        return CanvasSyncResult(value={"ok": True})

    def _restore_canvas(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(
                canvas,
                actor,
                write=True,
                include_deleted=True,
            )
            if canvas.get("deleted_at"):
                canvas.pop("deleted_at", None)
                self._write_locked(path, canvas, suffix="restore")
                self._bump_access_epoch(canvas_id)
            return CanvasSyncResult(canvas=copy.deepcopy(canvas))

    def _purge_canvas(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(
                canvas,
                actor,
                write=True,
                include_deleted=True,
                allowed_roles=("admin",),
            )
            self._administration.revoke_canvas_share(
                self._workspace_id(),
                canvas_id,
                str(actor.get("id") or ""),
            )
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            self._bump_access_epoch(canvas_id)
        return CanvasSyncResult(value={"ok": True})

    def _read_projects_locked(self) -> list[Dict[str, Any]]:
        try:
            with self._projects_path().open("r", encoding="utf-8") as source:
                raw = json.load(source)
            projects = raw.get("projects") if isinstance(raw, dict) else raw
            if isinstance(projects, list):
                return [
                    project
                    for project in projects
                    if isinstance(project, dict) and project.get("id")
                ]
        except Exception:
            pass
        return []

    def _delete_project(
        self,
        project_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        if project_id == DEFAULT_PROJECT_ID:
            raise CanvasSyncError(400, "默认项目不可删除")
        actor = self._require_create_actor(actor)
        if actor.get("role") != "admin":
            raise CanvasSyncError(403, "仅管理员可以删除项目")
        with self._file_lock:
            projects = self._read_projects_locked()
            if not any(
                project.get("id") == DEFAULT_PROJECT_ID
                for project in projects
            ):
                timestamp = int(self._now_ms())
                projects.insert(
                    0,
                    {
                        "id": DEFAULT_PROJECT_ID,
                        "name": "默认项目",
                        "order": 0,
                        "created_at": timestamp,
                        "updated_at": timestamp,
                    },
                )
            if not any(
                project.get("id") == project_id for project in projects
            ):
                raise CanvasSyncError(404, "项目不存在")
            candidates: list[tuple[Path, Dict[str, Any]]] = []
            for path in self._directory().glob("*.json"):
                try:
                    with path.open("r", encoding="utf-8") as source:
                        canvas = json.load(source)
                except Exception:
                    continue
                if str(canvas.get("project") or "") != project_id:
                    continue
                if not can_access_canvas(actor, canvas, write=True):
                    raise CanvasSyncError(
                        403,
                        "项目中包含当前账号不可访问的私有画布",
                    )
                candidates.append((path, canvas))
            projects_path = self._projects_path()
            projects_path.parent.mkdir(parents=True, exist_ok=True)
            documents: list[tuple[Path, Dict[str, Any]]] = [
                (
                    projects_path,
                    {
                        "projects": [
                            project
                            for project in projects
                            if project.get("id") != project_id
                        ]
                    },
                )
            ]
            for path, canvas in candidates:
                canvas["project"] = DEFAULT_PROJECT_ID
                documents.append((path, canvas))
            self._write_batch_locked(documents, suffix="project")
            for path, _canvas in candidates:
                self._bump_access_epoch(path.stem)
        return CanvasSyncResult(
            value={"ok": True, "moved": len(candidates)}
        )

    def _delete_store_project(
        self,
        project_id: str,
        actor: Dict[str, Any] | None,
    ) -> CanvasSyncResult:
        if project_id == DEFAULT_PROJECT_ID:
            raise CanvasSyncError(400, "默认项目不可删除")
        actor = self._require_create_actor(actor)
        if actor.get("role") != "admin":
            raise CanvasSyncError(403, "仅管理员可以删除项目")
        assert self._canvas_store is not None
        with self._file_lock:
            projects = self._read_projects_locked()
            if not any(
                project.get("id") == DEFAULT_PROJECT_ID
                for project in projects
            ):
                timestamp = int(self._now_ms())
                projects.insert(
                    0,
                    {
                        "id": DEFAULT_PROJECT_ID,
                        "name": "默认项目",
                        "order": 0,
                        "created_at": timestamp,
                        "updated_at": timestamp,
                    },
                )
            if not any(project.get("id") == project_id for project in projects):
                raise CanvasSyncError(404, "项目不存在")
            try:
                moved = self._canvas_store().move_project_canvases(
                    project_id,
                    DEFAULT_PROJECT_ID,
                    actor,
                )
            except CanvasStoreError as exc:
                status = 403 if exc.code == "forbidden" else 400
                raise CanvasSyncError(status, exc.message) from exc
            projects_path = self._projects_path()
            projects_path.parent.mkdir(parents=True, exist_ok=True)
            self._write_locked(
                projects_path,
                {
                    "projects": [
                        project
                        for project in projects
                        if project.get("id") != project_id
                    ]
                },
                suffix="project",
            )
        return CanvasSyncResult(value={"ok": True, "moved": moved})

    async def _save_snapshot(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(canvas, actor, write=True)
            kind = (
                "smart"
                if str(canvas.get("kind") or "").strip().lower() == "smart"
                else "classic"
            )
            if kind == "smart":
                raise CanvasSyncError(
                    409,
                    {
                        "code": "realtime_mutation_required",
                        "message": "该 Smart Canvas 已启用实时协作，不能再用完整快照覆盖。",
                        "canvas": public_snapshot(canvas),
                        "revision": int(canvas.get("revision") or 0),
                    },
                )
            current_updated_at = int(canvas.get("updated_at") or 0)
            base_updated_at = int(values.get("base_updated_at") or 0)
            if (
                base_updated_at
                and current_updated_at
                and base_updated_at < current_updated_at
            ):
                raise CanvasSyncError(
                    409,
                    {
                        "message": "画布已被其他页面更新，已拒绝旧版本覆盖。",
                        "canvas": copy.deepcopy(canvas),
                        "updated_at": current_updated_at,
                    },
                )
            candidate = copy.deepcopy(canvas)
            candidate["title"] = (
                values.get("title")
                or canvas.get("title")
                or "未命名画布"
            )[:80]
            candidate["icon"] = (
                values.get("icon")
                or canvas.get("icon")
                or "layers"
            )[:32]
            candidate["kind"] = kind
            candidate["nodes"] = copy.deepcopy(values.get("nodes") or [])
            candidate["connections"] = copy.deepcopy(
                values.get("connections") or []
            )
            if kind == "smart":
                candidate["viewport"] = copy.deepcopy(
                    values.get("viewport") or {}
                )
            else:
                candidate["viewport"] = canvas.get("viewport") or {
                    "x": 0,
                    "y": 0,
                    "scale": 1,
                }
            candidate["logs"] = copy.deepcopy(
                list(values.get("logs") or [])[-500:]
            )
            candidate["settings"] = copy.deepcopy(values.get("settings") or {})
            changed = any(
                (
                    candidate.get("title") != canvas.get("title"),
                    candidate.get("icon") != canvas.get("icon"),
                    candidate.get("nodes") != list(canvas.get("nodes") or []),
                    candidate.get("connections")
                    != list(canvas.get("connections") or []),
                    candidate.get("logs") != list(canvas.get("logs") or []),
                    candidate.get("settings") != (canvas.get("settings") or {}),
                )
            )
            if changed:
                candidate["updated_by"] = str(actor.get("id") or "")
                candidate["updated_at"] = int(self._now_ms())
                self._write_locked(path, candidate, suffix="snapshot")
                result = copy.deepcopy(candidate)
            else:
                result = copy.deepcopy(canvas)

        if changed:
            await self._notifier.broadcast_canvas_updated(
                canvas_id,
                int(result.get("updated_at") or self._now_ms()),
                str(values.get("client_id") or ""),
            )
        return CanvasSyncResult(canvas=result)

    async def _update_prompt_templates(
        self,
        canvas_id: str,
        actor: Dict[str, Any] | None,
        values: Mapping[str, Any],
    ) -> CanvasSyncResult:
        templates = values.get("templates")
        prompt_intent = values.get("intent")
        if not isinstance(prompt_intent, Mapping) and (
            not isinstance(templates, list)
            or any(not isinstance(item, Mapping) for item in templates)
        ):
            raise CanvasSyncError(400, "当前画布提示词数据无效")
        operation_id = str(values.get("operation_id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,160}", operation_id):
            raise CanvasSyncError(400, "operation_id 无效")
        intent_identity = (
            {"intent": prompt_intent}
            if isinstance(prompt_intent, Mapping)
            else {
                "templates": templates,
                "base_revision": max(0, int(values.get("base_revision") or 0)),
            }
        )
        intent_hash = hashlib.sha256(
            json.dumps(
                intent_identity,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        with self._file_lock:
            path, canvas = self._read_locked(canvas_id)
            actor = self._require_actor(canvas, actor, write=True)
            receipts = canvas.get("_prompt_template_receipts")
            if not isinstance(receipts, dict):
                receipts = {}
            if operation_id in receipts:
                receipt_hash = str(receipts[operation_id].get("intent_hash") or "")
                if receipt_hash and receipt_hash != intent_hash:
                    raise CanvasSyncError(
                        409,
                        {
                            "code": "operation_collision",
                            "message": "相同 operation_id 的提交内容不一致",
                            "revision": max(0, int(canvas.get("revision") or 0)),
                        },
                    )
                return CanvasSyncResult(canvas=copy.deepcopy(canvas))
            current_revision = max(0, int(canvas.get("revision") or 0))
            timestamp = int(self._now_ms())
            if isinstance(prompt_intent, Mapping):
                try:
                    next_templates, _item_id = apply_prompt_template_intent(
                        list(canvas.get("prompt_templates") or []),
                        prompt_intent,
                        revision=current_revision,
                        now_ms=timestamp,
                    )
                except CanvasStoreError as exc:
                    status = 404 if exc.code == "prompt_template_missing" else 409
                    raise CanvasSyncError(
                        status,
                        {
                            "code": exc.code,
                            "message": exc.message,
                            "revision": exc.revision,
                        },
                    ) from exc
            else:
                base_revision = max(0, int(values.get("base_revision") or 0))
                if base_revision != current_revision:
                    raise CanvasSyncError(
                        409,
                        {
                            "code": "stale_prompt_templates",
                            "message": "画布内容已更新，请刷新提示词库后重试",
                            "revision": current_revision,
                        },
                    )
                next_templates = copy.deepcopy(templates)
            changed = list(canvas.get("prompt_templates") or []) != next_templates
            if changed:
                canvas["prompt_templates"] = next_templates
                canvas["revision"] = current_revision + 1
                canvas["updated_at"] = timestamp
                canvas["updated_by"] = str(actor.get("id") or "")
            receipts[operation_id] = {
                "revision": canvas["revision"],
                "updated_at": timestamp,
                "intent_hash": intent_hash,
            }
            canvas["_prompt_template_receipts"] = dict(
                list(receipts.items())[-100:]
            )
            self._write_locked(path, canvas, suffix="prompt-templates")
            result = copy.deepcopy(canvas)
        if not changed:
            return CanvasSyncResult(canvas=result)
        await self._notifier.broadcast_canvas_updated(
            canvas_id,
            int(result.get("updated_at") or self._now_ms()),
            str(values.get("client_id") or ""),
        )
        self._remember_revision(canvas_id, int(result.get("revision") or 0))
        await self._notifier.broadcast_canvas_message(
            canvas_id,
            {
                "type": "canvas_mutation",
                "canvas_id": canvas_id,
                "operation_id": operation_id,
                "revision": int(result.get("revision") or 0),
                "actor_id": str(actor.get("id") or ""),
                "changes": {
                    "node_creates": [],
                    "node_updates": [],
                    "node_unsets": [],
                    "node_deletes": [],
                    "connection_adds": [],
                    "connection_removes": [],
                    "canvas_updates": [],
                    "canvas_unsets": [],
                },
                "duplicate": False,
                "reverts_operation_id": "",
                "undoable": False,
                "non_undoable_canvas_roots": ["prompt_templates"],
                "client_id": str(values.get("client_id") or ""),
            },
        )
        return CanvasSyncResult(canvas=result)


__all__ = [
    "CREATE_CANVAS",
    "DEFAULT_PROJECT_ID",
    "DELETE_PROJECT",
    "PURGE_CANVAS",
    "RESTORE_CANVAS",
    "SAVE_SNAPSHOT",
    "UPDATE_PROMPT_TEMPLATES",
    "SET_VISIBILITY",
    "TOUCH_CANVAS",
    "TRASH_CANVAS",
    "UPDATE_METADATA",
    "CanvasCommand",
    "CanvasGenerationApplyResult",
    "CanvasSync",
    "CanvasSyncError",
    "CanvasSyncResult",
    "RealtimeSession",
    "normalize_canvas_color",
    "normalize_canvas_cover_url",
    "normalize_canvas_kind",
]
