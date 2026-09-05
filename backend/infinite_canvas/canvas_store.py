"""Transactional Canvas storage seam and its local SQLite adapter.

This module is intentionally not wired into the running application until the
one-shot JSON/JSON -> SQLite/SQLite migration is ready.  Callers learn two
operations only: ``read`` a closed projection and ``commit`` a business intent.
SQLite schema details, WAL configuration, payload deduplication, authorization,
idempotency, and pagination stay behind that interface.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import logging
import math
import re
import sqlite3
import time
import urllib.parse
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterator, Mapping, Protocol

from .canvas_permissions import (
    can_access_canvas,
    can_access_project,
    set_canvas_visibility,
)
from .canvas_realtime import (
    CanvasRealtimeError,
    apply_operation,
    apply_single_node_position_operation,
)
from .generation_output import apply_generation_result_nodes


SCHEMA_VERSION = 1
DEFAULT_LOG_PAGE_SIZE = 5
MAX_LOG_PAGE_SIZE = 50
MAX_RAW_ERROR_BYTES = 64 * 1024
FINAL_LOG_STATUSES = {"success", "partial", "failed", "cancelled"}
SECRET_KEY_RE = re.compile(
    r"(?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|"
    r"cookie|secret|password|signature|signed|credential)",
    re.IGNORECASE,
)
LOGGER = logging.getLogger(__name__)
MUTATION_CHANGE_ACTIONS = (
    "node_creates",
    "node_updates",
    "node_unsets",
    "node_deletes",
    "connection_adds",
    "connection_removes",
    "canvas_updates",
    "canvas_unsets",
)
MUTATION_CHANGE_ACTION_SET = frozenset(MUTATION_CHANGE_ACTIONS)


class CanvasStoreError(RuntimeError):
    """Stable store failure with a machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        revision: int = 0,
        retry_changes: Mapping[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = str(code)
        self.message = str(message)
        self.revision = max(0, int(revision or 0))
        self.retry_changes = (
            copy.deepcopy(dict(retry_changes))
            if isinstance(retry_changes, Mapping)
            else None
        )


class CanvasProjectionKind(str, Enum):
    PUBLIC_SNAPSHOT = "public_snapshot"
    MIGRATION_VERIFICATION = "migration_verification"
    LIST_ITEM = "list_item"
    LOG_PAGE = "log_page"
    LOG_DETAIL = "log_detail"
    FULL_EXPORT = "full_export"


@dataclass(frozen=True)
class CanvasProjection:
    kind: CanvasProjectionKind
    node_id: str = ""
    cursor: str = ""
    log_id: str = ""
    limit: int = DEFAULT_LOG_PAGE_SIZE
    include_details: bool = False

    @classmethod
    def public_snapshot(cls) -> "CanvasProjection":
        return cls(CanvasProjectionKind.PUBLIC_SNAPSHOT)

    @classmethod
    def migration_verification(cls) -> "CanvasProjection":
        return cls(CanvasProjectionKind.MIGRATION_VERIFICATION)

    @classmethod
    def list_item(cls) -> "CanvasProjection":
        return cls(CanvasProjectionKind.LIST_ITEM)

    @classmethod
    def log_page(
        cls,
        *,
        node_id: str = "",
        cursor: str = "",
        limit: int = DEFAULT_LOG_PAGE_SIZE,
        include_details: bool = False,
    ) -> "CanvasProjection":
        return cls(
            CanvasProjectionKind.LOG_PAGE,
            node_id=str(node_id or ""),
            cursor=str(cursor or ""),
            limit=max(1, min(MAX_LOG_PAGE_SIZE, int(limit))),
            include_details=bool(include_details),
        )

    @classmethod
    def log_detail(cls, log_id: str) -> "CanvasProjection":
        return cls(
            CanvasProjectionKind.LOG_DETAIL,
            log_id=str(log_id or ""),
        )

    @classmethod
    def full_export(cls) -> "CanvasProjection":
        return cls(CanvasProjectionKind.FULL_EXPORT)


@dataclass(frozen=True)
class CanvasShareGrant:
    workspace_id: str
    canvas_id: str
    token_hash: str


class CanvasIntentKind(str, Enum):
    IMPORT_CANVAS = "import_canvas"
    CREATE_CANVAS = "create_canvas"
    CANVAS_MUTATION = "canvas_mutation"
    GENERATION_OUTPUT_COMMIT = "generation_output_commit"
    APPEND_FINAL_LOG = "append_final_log"
    TRASH_CANVAS = "trash_canvas"
    RESTORE_CANVAS = "restore_canvas"
    PURGE_CANVAS = "purge_canvas"
    UPDATE_METADATA = "update_metadata"
    SET_VISIBILITY = "set_visibility"
    TOUCH_CANVAS = "touch_canvas"
    SAVE_SNAPSHOT = "save_snapshot"
    UPDATE_PROMPT_TEMPLATES = "update_prompt_templates"
    COMMIT_PROMPT = "commit_prompt"


@dataclass(frozen=True)
class CanvasIntent:
    kind: CanvasIntentKind
    operation_id: str
    payload: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def import_canvas(
        cls,
        document: Mapping[str, Any],
        *,
        operation_id: str,
        generation_history: list[Mapping[str, Any]] | None = None,
    ) -> "CanvasIntent":
        payload: dict[str, Any] = {
            "canvas": copy.deepcopy(dict(document)),
        }
        if generation_history is not None:
            payload["generation_history"] = copy.deepcopy(generation_history)
        return cls(
            CanvasIntentKind.IMPORT_CANVAS,
            operation_id=str(operation_id or ""),
            payload=payload,
        )

    @classmethod
    def create_canvas(
        cls,
        document: Mapping[str, Any],
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.CREATE_CANVAS,
            operation_id=str(operation_id or ""),
            payload={"canvas": copy.deepcopy(dict(document))},
        )

    @classmethod
    def append_final_log(
        cls,
        log: Mapping[str, Any],
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.APPEND_FINAL_LOG,
            operation_id=str(operation_id or ""),
            payload={"log": copy.deepcopy(dict(log))},
        )

    @classmethod
    def trash_canvas(cls, *, operation_id: str) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.TRASH_CANVAS,
            operation_id=str(operation_id or ""),
        )

    @classmethod
    def restore_canvas(cls, *, operation_id: str) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.RESTORE_CANVAS,
            operation_id=str(operation_id or ""),
        )

    @classmethod
    def purge_canvas(cls, *, operation_id: str) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.PURGE_CANVAS,
            operation_id=str(operation_id or ""),
        )

    @classmethod
    def update_metadata(
        cls,
        values: Mapping[str, Any],
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.UPDATE_METADATA,
            operation_id=str(operation_id or ""),
            payload={"values": copy.deepcopy(dict(values))},
        )

    @classmethod
    def set_visibility(
        cls,
        visibility: str,
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.SET_VISIBILITY,
            operation_id=str(operation_id or ""),
            payload={"visibility": str(visibility or "")},
        )

    @classmethod
    def touch_canvas(cls, *, operation_id: str) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.TOUCH_CANVAS,
            operation_id=str(operation_id or ""),
        )

    @classmethod
    def save_snapshot(
        cls,
        values: Mapping[str, Any],
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.SAVE_SNAPSHOT,
            operation_id=str(operation_id or ""),
            payload={"values": copy.deepcopy(dict(values))},
        )

    @classmethod
    def update_prompt_templates(
        cls,
        templates: list[Mapping[str, Any]],
        *,
        base_revision: int,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.UPDATE_PROMPT_TEMPLATES,
            operation_id=str(operation_id or ""),
            payload={
                "templates": copy.deepcopy(list(templates)),
                "base_revision": max(0, int(base_revision or 0)),
            },
        )

    @classmethod
    def commit_prompt(
        cls,
        prompt_intent: Mapping[str, Any],
        *,
        operation_id: str,
    ) -> "CanvasIntent":
        return cls(
            CanvasIntentKind.COMMIT_PROMPT,
            operation_id=str(operation_id or ""),
            payload={"intent": copy.deepcopy(dict(prompt_intent))},
        )

    @classmethod
    def canvas_mutation(
        cls,
        operation: Mapping[str, Any],
    ) -> "CanvasIntent":
        operation = copy.deepcopy(dict(operation))
        return cls(
            CanvasIntentKind.CANVAS_MUTATION,
            operation_id=str(operation.get("operation_id") or ""),
            payload={"operation": operation},
        )

    @classmethod
    def generation_output_commit(
        cls,
        *,
        effect_id: str,
        node_id: str,
        generation_operation_id: str,
        request_index: int,
        run_id: str,
        node_changes: Mapping[str, Any],
        final_log: Mapping[str, Any] | None = None,
    ) -> "CanvasIntent":
        payload: Dict[str, Any] = {
            "node_id": str(node_id or ""),
            "generation_operation_id": str(
                generation_operation_id or ""
            ),
            "request_index": max(0, int(request_index or 0)),
            "run_id": str(run_id or ""),
            "node_changes": copy.deepcopy(dict(node_changes or {})),
        }
        if final_log is not None:
            payload["final_log"] = copy.deepcopy(dict(final_log))
        return cls(
            CanvasIntentKind.GENERATION_OUTPUT_COMMIT,
            operation_id=str(effect_id or ""),
            payload=payload,
        )


@dataclass(frozen=True)
class CanvasRead:
    canvas: Dict[str, Any] | None = None
    logs: tuple[Dict[str, Any], ...] = ()
    log: Dict[str, Any] | None = None
    next_cursor: str = ""


@dataclass(frozen=True)
class CanvasCommit:
    canvas_id: str
    operation_id: str
    revision: int
    changed: bool
    duplicate: bool = False
    log_id: str = ""
    event: Dict[str, Any] | None = None
    effect_applied: bool | None = None
    reason: str = ""


class CanvasStore(Protocol):
    """Business interface shared by application callers and contract tests."""

    def list_items(
        self,
        actor: Mapping[str, Any] | None,
    ) -> tuple[Dict[str, Any], ...]: ...

    def read_shared(self, grant: CanvasShareGrant) -> CanvasRead: ...

    def read(
        self,
        canvas_id: str,
        actor: Mapping[str, Any] | None,
        projection: CanvasProjection,
    ) -> CanvasRead: ...

    def commit(
        self,
        canvas_id: str,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit: ...

    def move_project_canvases(
        self,
        source_project_id: str,
        destination_project_id: str,
        actor: Mapping[str, Any] | None,
    ) -> int: ...

    def reassign_owned_canvases(
        self,
        target_owner_id: str,
        actor: Mapping[str, Any] | None,
    ) -> int: ...


def _json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _json_object(value: str | None) -> Dict[str, Any]:
    try:
        decoded = json.loads(value or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _digest(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def prompt_template_item_version(item: Mapping[str, Any] | None) -> str:
    """Return the stable optimistic-concurrency identity of one template."""

    if not isinstance(item, Mapping):
        return ""
    value = copy.deepcopy(dict(item))
    value.pop("item_version", None)
    return _digest(value)


def apply_prompt_template_intent(
    templates: list[Mapping[str, Any]],
    prompt_intent: Mapping[str, Any],
    *,
    revision: int,
    now_ms: int,
) -> tuple[list[Dict[str, Any]], str]:
    """Apply one semantic Prompt Template edit to the latest Canvas state."""

    current = [copy.deepcopy(dict(item)) for item in templates]
    intent = dict(prompt_intent or {})
    action = str(intent.get("action") or "").strip().lower()
    item_id = str(intent.get("item_id") or "").strip()
    if action == "create":
        item = intent.get("item")
        if not isinstance(item, Mapping):
            raise CanvasStoreError(
                "invalid_prompt_intent",
                "当前画布提示词创建数据无效",
                revision=revision,
            )
        created = copy.deepcopy(dict(item))
        item_id = str(created.get("id") or "").strip()
        if not item_id or not str(created.get("positive") or "").strip():
            raise CanvasStoreError(
                "invalid_prompt_intent",
                "当前画布提示词创建数据无效",
                revision=revision,
            )
        if any(str(item.get("id") or "") == item_id for item in current):
            raise CanvasStoreError(
                "prompt_template_conflict",
                "同一标识的当前画布提示词已经存在",
                revision=revision,
            )
        created["created_at"] = max(
            0,
            int(created.get("created_at") or now_ms or 0),
        )
        created["updated_at"] = max(
            0,
            int(created.get("updated_at") or created["created_at"]),
        )
        return [created, *current], item_id

    if action not in {"update", "delete"} or not item_id:
        raise CanvasStoreError(
            "invalid_prompt_intent",
            "当前画布提示词操作无效",
            revision=revision,
        )
    index = next(
        (
            index
            for index, item in enumerate(current)
            if str(item.get("id") or "") == item_id
        ),
        -1,
    )
    if index < 0:
        raise CanvasStoreError(
            "prompt_template_missing",
            "当前画布提示词不存在",
            revision=revision,
        )
    expected_version = str(intent.get("expected_item_version") or "")
    if expected_version:
        if prompt_template_item_version(current[index]) != expected_version:
            raise CanvasStoreError(
                "prompt_template_conflict",
                "这条当前画布提示词已被协作者修改，请保留草稿并重新确认",
                revision=revision,
            )
    elif "base_revision" in intent:
        base_revision = max(0, int(intent.get("base_revision") or 0))
        if base_revision != max(0, int(revision or 0)):
            raise CanvasStoreError(
                "stale_prompt_templates",
                "画布内容已更新，请刷新提示词库后重试",
                revision=revision,
            )
    else:
        raise CanvasStoreError(
            "missing_prompt_template_version",
            "缺少当前画布提示词版本，请刷新后重试",
            revision=revision,
        )

    if action == "delete":
        return [
            item
            for index_value, item in enumerate(current)
            if index_value != index
        ], item_id

    patch = intent.get("patch")
    if not isinstance(patch, Mapping):
        raise CanvasStoreError(
            "invalid_prompt_intent",
            "当前画布提示词更新数据无效",
            revision=revision,
        )
    allowed = {
        key: copy.deepcopy(patch[key])
        for key in ("name", "positive", "cover")
        if key in patch
    }
    if "positive" in allowed and not str(allowed["positive"] or "").strip():
        raise CanvasStoreError(
            "invalid_prompt_intent",
            "提示词内容不能为空",
            revision=revision,
        )
    unchanged = all(current[index].get(key) == value for key, value in allowed.items())
    if unchanged:
        return current, item_id
    current[index] = {
        **current[index],
        **allowed,
        "updated_at": max(0, int(now_ms or 0)),
    }
    return current, item_id


def _single_node_position_target(
    operation: Mapping[str, Any],
) -> tuple[str, str]:
    """Return the target Node ID or a sanitized fast-path fallback category."""

    allowed_operation_keys = {"operation_id", "base_revision", "changes"}
    if "reverts_operation_id" in operation:
        return "", "undo"
    if set(operation) - allowed_operation_keys:
        return "", "operation_metadata"
    changes = operation.get("changes")
    if not isinstance(changes, Mapping):
        return "", "invalid_changes"
    if set(changes) - MUTATION_CHANGE_ACTION_SET:
        return "", "unknown_action"
    for action in MUTATION_CHANGE_ACTIONS:
        if action == "node_updates":
            continue
        entries = changes.get(action, [])
        if entries != []:
            return "", action
    updates = changes.get("node_updates")
    if not isinstance(updates, list) or not updates:
        return "", "no_node_update"
    if len(updates) > 2:
        return "", "too_many_updates"

    target_id = ""
    paths = set()
    for raw in updates:
        if not isinstance(raw, Mapping):
            return "", "invalid_node_update"
        if set(raw) != {"id", "path", "value"}:
            return "", "node_update_metadata"
        node_id = str(raw.get("id") or "")
        path = raw.get("path")
        value = raw.get("value")
        if not node_id:
            return "", "invalid_node_id"
        if target_id and node_id != target_id:
            return "", "multiple_nodes"
        if not isinstance(path, list) or len(path) != 1 or path[0] not in {"x", "y"}:
            return "", "non_position_field"
        if path[0] in paths:
            return "", "duplicate_position_field"
        try:
            finite_position = math.isfinite(value)
        except (TypeError, ValueError, OverflowError):
            finite_position = False
        if isinstance(value, bool) or not finite_position:
            return "", "non_numeric_position"
        target_id = node_id
        paths.add(path[0])
    return target_id, ""


def _truncate_utf8(value: Any, limit: int) -> str:
    encoded = str(value or "").encode("utf-8", errors="replace")[:limit]
    return encoded.decode("utf-8", errors="ignore")


def _sanitize_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return value
    if parsed.scheme not in {"http", "https"} or not parsed.query:
        return value
    query = [
        (key, item)
        for key, item in urllib.parse.parse_qsl(
            parsed.query,
            keep_blank_values=True,
        )
        if not SECRET_KEY_RE.search(key)
    ]
    return urllib.parse.urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(query),
            parsed.fragment,
        )
    )


def _sanitize(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): (
                "[REDACTED]"
                if SECRET_KEY_RE.search(str(key))
                else _sanitize(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    if isinstance(value, str):
        return _sanitize_url(_sanitize_raw_error(value))
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


def _sanitize_raw_error(value: Any) -> str:
    text = str(value or "")
    text = re.sub(
        r"(?i)\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+",
        "Authorization=[REDACTED]",
        text,
    )
    text = re.sub(
        r"(?i)\b(api[-_]?key|access[-_]?token|refresh[-_]?token|token|"
        r"cookie|secret)"
        r"\s*[:=]\s*[^\s,;]+",
        r"\1=[REDACTED]",
        text,
    )
    text = re.sub(
        r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+",
        "Bearer [REDACTED]",
        text,
    )
    return text


def _cursor_encode(created_at: int, log_id: str) -> str:
    raw = _json([int(created_at), str(log_id)]).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _cursor_decode(value: str) -> tuple[int, str] | None:
    if not value:
        return None
    try:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        decoded = json.loads(raw.decode("utf-8"))
        if not isinstance(decoded, list) or len(decoded) != 2:
            return None
        return int(decoded[0]), str(decoded[1])
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        raise CanvasStoreError("invalid_cursor", "日志分页游标无效")


class SqliteCanvasStore:
    """SQLite/WAL adapter for one Workspace's authoritative Canvas data."""

    _CANVAS_COLUMNS = {
        "id",
        "kind",
        "title",
        "icon",
        "owner_id",
        "owner_username",
        "visibility",
        "created_by",
        "updated_by",
        "owner",
        "color",
        "pinned",
        "project",
        "created_at",
        "updated_at",
        "deleted_at",
        "revision",
    }
    _DROPPED_IMPORT_ROOTS = {
        "nodes",
        "connections",
        "logs",
        "_realtime",
        "_generation_runs",
    }

    def __init__(
        self,
        database_path: Path | str,
        *,
        workspace_id: str,
        now_ms: Any = None,
    ) -> None:
        self.database_path = Path(database_path)
        self.workspace_id = str(workspace_id or "").strip()
        if not self.workspace_id:
            raise ValueError("workspace_id must not be empty")
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            str(self.database_path),
            timeout=5,
        )
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA busy_timeout = 5000")
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA synchronous = FULL")
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS store_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS canvases (
                    canvas_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    icon TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    owner_username TEXT NOT NULL,
                    visibility TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    updated_by TEXT NOT NULL,
                    owner_label TEXT NOT NULL,
                    color TEXT NOT NULL,
                    pinned INTEGER NOT NULL,
                    project_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER NOT NULL,
                    revision INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS canvas_nodes (
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    node_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (canvas_id, node_id),
                    UNIQUE (canvas_id, position)
                );

                CREATE TABLE IF NOT EXISTS canvas_connections (
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    connection_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (canvas_id, connection_id),
                    UNIQUE (canvas_id, position)
                );

                CREATE TABLE IF NOT EXISTS canvas_top_level_payloads (
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    payload_key TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (canvas_id, payload_key)
                );

                CREATE TABLE IF NOT EXISTS canvas_realtime_state (
                    canvas_id TEXT PRIMARY KEY REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    payload_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS canvas_mutations (
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    operation_id TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    base_revision INTEGER NOT NULL,
                    changes_json TEXT NOT NULL,
                    inverse_json TEXT NOT NULL,
                    reverts_operation_id TEXT NOT NULL,
                    undone_by TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (canvas_id, operation_id),
                    UNIQUE (canvas_id, revision)
                );

                CREATE TABLE IF NOT EXISTS canvas_events (
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    event_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY (canvas_id, revision)
                );

                CREATE TABLE IF NOT EXISTS applied_generation_effects (
                    effect_id TEXT PRIMARY KEY,
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    run_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    generation_operation_id TEXT NOT NULL,
                    request_index INTEGER NOT NULL,
                    applied INTEGER NOT NULL,
                    outcome TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    log_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_effect_run
                    ON applied_generation_effects(canvas_id, run_id)
                    WHERE run_id <> '';

                CREATE TABLE IF NOT EXISTS generation_log_payloads (
                    payload_digest TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    byte_size INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS canvas_logs (
                    log_id TEXT PRIMARY KEY,
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    node_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    final_status TEXT NOT NULL,
                    actor_username TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    model TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    summary_json TEXT NOT NULL,
                    payload_digest TEXT NOT NULL REFERENCES generation_log_payloads(
                        payload_digest
                    )
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_canvas_logs_run
                    ON canvas_logs(canvas_id, run_id)
                    WHERE run_id <> '';
                CREATE INDEX IF NOT EXISTS idx_canvas_logs_page
                    ON canvas_logs(canvas_id, created_at DESC, log_id DESC);
                CREATE INDEX IF NOT EXISTS idx_canvas_logs_node_page
                    ON canvas_logs(
                        canvas_id, node_id, created_at DESC, log_id DESC
                    );

                CREATE TABLE IF NOT EXISTS generation_log_outputs (
                    log_id TEXT NOT NULL REFERENCES canvas_logs(log_id)
                        ON DELETE CASCADE,
                    output_index INTEGER NOT NULL,
                    media_ref TEXT NOT NULL,
                    media_kind TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    metadata_json TEXT NOT NULL,
                    PRIMARY KEY (log_id, output_index)
                );

                CREATE TABLE IF NOT EXISTS canvas_operation_receipts (
                    operation_id TEXT PRIMARY KEY,
                    canvas_id TEXT NOT NULL REFERENCES canvases(canvas_id)
                        ON DELETE CASCADE,
                    actor_id TEXT NOT NULL,
                    intent_kind TEXT NOT NULL,
                    intent_hash TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                """
            )
            connection.execute(
                """
                INSERT INTO store_metadata(key, value)
                VALUES ('schema_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(SCHEMA_VERSION),),
            )
            connection.execute(
                """
                INSERT INTO store_metadata(key, value)
                VALUES ('workspace_id', ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (self.workspace_id,),
            )
            stored_workspace = connection.execute(
                "SELECT value FROM store_metadata WHERE key = 'workspace_id'"
            ).fetchone()[0]
            if str(stored_workspace) != self.workspace_id:
                raise CanvasStoreError(
                    "workspace_mismatch",
                    "Canvas 数据库不属于当前 Workspace",
                )
            connection.commit()

    def backfill_generation_history(
        self,
        logs_by_canvas: Mapping[str, list[Mapping[str, Any]]],
        actor: Mapping[str, Any] | None,
        *,
        operation_id: str,
        source_fingerprint: str,
    ) -> int:
        """Import verified legacy final logs in one maintenance transaction."""

        if (
            not actor
            or actor.get("status", "active") != "active"
            or actor.get("role") != "admin"
        ):
            raise CanvasStoreError(
                "forbidden",
                "仅管理员可以回填 Generation History",
            )
        fingerprint = str(source_fingerprint or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            raise CanvasStoreError(
                "invalid_source_fingerprint",
                "Generation History 回填来源指纹无效",
            )
        imported_count = 0
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                if connection.execute(
                    """
                    SELECT 1 FROM store_metadata
                    WHERE key = 'legacy_generation_history_backfill'
                    """
                ).fetchone():
                    raise CanvasStoreError(
                        "generation_history_already_backfilled",
                        "旧 Generation History 已完成一次性回填",
                    )
                for canvas_id, logs in logs_by_canvas.items():
                    row = connection.execute(
                        "SELECT * FROM canvases WHERE canvas_id = ?",
                        (str(canvas_id or "").strip(),),
                    ).fetchone()
                    if row is None:
                        raise CanvasStoreError(
                            "not_found",
                            "回填日志所属画布不存在",
                        )
                    if not isinstance(logs, list):
                        raise CanvasStoreError(
                            "invalid_generation_history",
                            "Canvas Generation History 必须是数组",
                        )
                    for log in logs:
                        committed = self._append_final_log(
                            connection,
                            row,
                            actor,
                            CanvasIntent.append_final_log(
                                log,
                                operation_id=operation_id,
                            ),
                        )
                        if committed.duplicate:
                            raise CanvasStoreError(
                                "duplicate_generation_history",
                                "回填日志与现有 Generation Run 重复",
                            )
                        imported_count += 1
                connection.execute(
                    """
                    INSERT INTO store_metadata(key, value)
                    VALUES ('legacy_generation_history_backfill', ?)
                    """,
                    (
                        _json(
                            {
                                "operation_id": str(operation_id or ""),
                                "source_fingerprint": fingerprint,
                                "imported_count": imported_count,
                            }
                        ),
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return imported_count

    @staticmethod
    def _require_actor(
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        *,
        include_deleted: bool = False,
    ) -> None:
        canvas = {
            "owner_id": row["owner_id"],
            "owner_username": row["owner_username"],
            "visibility": row["visibility"],
            "project": row["project_id"],
        }
        if (
            not actor
            or actor.get("status", "active") != "active"
            or (int(row["deleted_at"] or 0) > 0 and not include_deleted)
            or not can_access_canvas(dict(actor), canvas)
        ):
            raise CanvasStoreError("not_found", "画布不存在")

    @staticmethod
    def _validate_operation_id(operation_id: str) -> str:
        value = str(operation_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,160}", value):
            raise CanvasStoreError("invalid_operation_id", "operation_id 无效")
        return value

    @staticmethod
    def _connection_id(connection: Mapping[str, Any], position: int) -> str:
        del position
        identity = {
            "from": str(connection.get("from") or ""),
            "to": str(connection.get("to") or ""),
            "kind": str(connection.get("kind") or "flow"),
        }
        return _digest(identity)

    @staticmethod
    def _row_canvas(row: sqlite3.Row) -> Dict[str, Any]:
        canvas = {
            "id": row["canvas_id"],
            "kind": row["kind"],
            "title": row["title"],
            "icon": row["icon"],
            "owner_id": row["owner_id"],
            "owner_username": row["owner_username"],
            "visibility": row["visibility"],
            "created_by": row["created_by"],
            "updated_by": row["updated_by"],
            "owner": row["owner_label"],
            "color": row["color"],
            "pinned": bool(row["pinned"]),
            "project": row["project_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "revision": row["revision"],
        }
        if int(row["deleted_at"] or 0):
            canvas["deleted_at"] = int(row["deleted_at"])
        return canvas

    @staticmethod
    def _list_asset_url(value: Any) -> str:
        text = ""
        if isinstance(value, str):
            text = value.strip()
        elif isinstance(value, Mapping):
            for key in (
                "url",
                "path",
                "src",
                "uri",
                "output",
                "output_url",
                "outputUrl",
            ):
                text = str(value.get(key) or "").strip()
                if text:
                    break
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

    @staticmethod
    def _list_asset_is_image(value: Any, url: str) -> bool:
        if isinstance(value, Mapping) and str(value.get("kind") or "").lower() == "image":
            return True
        clean = url.split("?", 1)[0].split("#", 1)[0].lower()
        return Path(clean).suffix in {
            ".avif",
            ".gif",
            ".jpeg",
            ".jpg",
            ".png",
            ".webp",
        }

    def _list_item(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        canvas_id = str(row["canvas_id"])
        item = self._row_canvas(row)
        item["deleted_at"] = int(row["deleted_at"] or 0)
        item["node_count"] = int(
            connection.execute(
                "SELECT COUNT(*) FROM canvas_nodes WHERE canvas_id = ?",
                (canvas_id,),
            ).fetchone()[0]
        )
        payloads = {
            str(payload["payload_key"]): json.loads(payload["payload_json"])
            for payload in connection.execute(
                """
                SELECT payload_key, payload_json
                FROM canvas_top_level_payloads
                WHERE canvas_id = ?
                  AND payload_key IN ('board_x', 'board_y', 'cover_image')
                """,
                (canvas_id,),
            )
        }
        item["board_x"] = payloads.get("board_x")
        item["board_y"] = payloads.get("board_y")

        explicit = payloads.get("cover_image")
        if isinstance(explicit, Mapping):
            url = self._list_asset_url(explicit)
            if url:
                try:
                    image_index = max(0, int(explicit.get("image_index") or 0))
                except (TypeError, ValueError):
                    image_index = 0
                item.update(
                    {
                        "cover_url": url,
                        "cover_custom": True,
                        "cover_node_id": str(explicit.get("node_id") or ""),
                        "cover_image_index": image_index,
                    }
                )
                return item

        for node_index, node_row in enumerate(
            connection.execute(
                """
                SELECT payload_json FROM canvas_nodes
                WHERE canvas_id = ? ORDER BY position
                """,
                (canvas_id,),
            )
        ):
            node = _json_object(node_row["payload_json"])
            images = node.get("images") if isinstance(node.get("images"), list) else []
            for image_index, value in enumerate(images):
                url = self._list_asset_url(value)
                if url and self._list_asset_is_image(value, url):
                    item.update(
                        {
                            "cover_url": url,
                            "cover_custom": False,
                            "cover_node_id": str(node.get("id") or f"node_{node_index}"),
                            "cover_image_index": image_index,
                        }
                    )
                    return item
        item.update(
            {
                "cover_url": "",
                "cover_custom": False,
                "cover_node_id": "",
                "cover_image_index": 0,
            }
        )
        return item

    def _canvas_row(
        self,
        connection: sqlite3.Connection,
        canvas_id: str,
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM canvases WHERE canvas_id = ?",
            (str(canvas_id or ""),),
        ).fetchone()
        if row is None:
            raise CanvasStoreError("not_found", "画布不存在")
        return row

    def _full_canvas(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        canvas_id = str(row["canvas_id"])
        canvas = self._row_canvas(row)
        for payload in connection.execute(
            """
            SELECT payload_key, payload_json
            FROM canvas_top_level_payloads
            WHERE canvas_id = ?
            ORDER BY payload_key
            """,
            (canvas_id,),
        ):
            canvas[str(payload["payload_key"])] = json.loads(
                payload["payload_json"]
            )
        canvas["nodes"] = [
            json.loads(item["payload_json"])
            for item in connection.execute(
                """
                SELECT payload_json FROM canvas_nodes
                WHERE canvas_id = ? ORDER BY position
                """,
                (canvas_id,),
            )
        ]
        canvas["connections"] = [
            json.loads(item["payload_json"])
            for item in connection.execute(
                """
                SELECT payload_json FROM canvas_connections
                WHERE canvas_id = ? ORDER BY position
                """,
                (canvas_id,),
            )
        ]
        return canvas

    def _receipt_commit(self, row: sqlite3.Row) -> CanvasCommit:
        result = _json_object(row["result_json"])
        effect_applied = (
            bool(result.get("effect_applied"))
            if result.get("effect_applied") is not None
            else None
        )
        reason = str(result.get("reason") or "")
        if (
            str(row["intent_kind"])
            == CanvasIntentKind.GENERATION_OUTPUT_COMMIT.value
            and effect_applied
            and not reason
        ):
            reason = "already_applied"
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=str(row["operation_id"]),
            revision=int(result.get("revision") or 0),
            changed=bool(result.get("changed")),
            duplicate=True,
            log_id=str(result.get("log_id") or ""),
            event=self._duplicate_event(result.get("event")),
            effect_applied=effect_applied,
            reason=reason,
        )

    @staticmethod
    def _duplicate_event(value: Any) -> Dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        event = copy.deepcopy(value)
        event["duplicate"] = True
        changes = event.get("changes")
        if isinstance(changes, Mapping):
            event["changes"] = {
                str(action): [] for action in changes
            }
        return event

    def _existing_receipt(
        self,
        connection: sqlite3.Connection,
        *,
        canvas_id: str,
        operation_id: str,
        intent_hash: str,
        actor_id: str,
    ) -> CanvasCommit | None:
        row = connection.execute(
            """
            SELECT * FROM canvas_operation_receipts
            WHERE operation_id = ?
            """,
            (operation_id,),
        ).fetchone()
        if row is None:
            return None
        if (
            str(row["canvas_id"]) != canvas_id
            or str(row["intent_hash"]) != intent_hash
            or str(row["actor_id"]) != actor_id
        ):
            result = _json_object(row["result_json"])
            raise CanvasStoreError(
                "operation_collision",
                "相同 operation_id 的提交内容不一致",
                revision=int(result.get("revision") or 0),
            )
        return self._receipt_commit(row)

    def _save_receipt(
        self,
        connection: sqlite3.Connection,
        intent: CanvasIntent,
        intent_hash: str,
        result: CanvasCommit,
        actor_id: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO canvas_operation_receipts(
                operation_id, canvas_id, actor_id, intent_kind, intent_hash,
                result_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.operation_id,
                result.canvas_id,
                actor_id,
                intent.kind.value,
                intent_hash,
                _json(
                    {
                        "revision": result.revision,
                        "changed": result.changed,
                        "log_id": result.log_id,
                        "event": result.event,
                        "effect_applied": result.effect_applied,
                        "reason": result.reason,
                    }
                ),
                int(self._now_ms()),
            ),
        )

    def _complete_split_generation_log(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
        intent_hash: str,
    ) -> CanvasCommit | None:
        """Upgrade an older output-only effect with its terminal log.

        Early SQLite cutovers could apply the Node output through the legacy
        target guard before the lifecycle Outbox delivered the same stable
        effect with a final log.  Accept only that exact append-only upgrade:
        the prior receipt must equal the new intent with ``final_log`` removed,
        and the persisted effect identity must already be applied and logless.
        """

        if intent.kind != CanvasIntentKind.GENERATION_OUTPUT_COMMIT:
            return None
        final_log = intent.payload.get("final_log")
        if not isinstance(final_log, Mapping):
            return None
        receipt = connection.execute(
            """
            SELECT * FROM canvas_operation_receipts
            WHERE operation_id = ?
            """,
            (intent.operation_id,),
        ).fetchone()
        actor_id = str((actor or {}).get("id") or "")
        if (
            receipt is None
            or str(receipt["canvas_id"]) != str(row["canvas_id"])
            or str(receipt["actor_id"]) != actor_id
            or str(receipt["intent_kind"])
            != CanvasIntentKind.GENERATION_OUTPUT_COMMIT.value
        ):
            return None
        output_only_payload = copy.deepcopy(dict(intent.payload))
        output_only_payload.pop("final_log", None)
        output_only_hash = _digest(
            {
                "kind": intent.kind.value,
                "payload": output_only_payload,
            }
        )
        if str(receipt["intent_hash"]) != output_only_hash:
            return None
        effect = connection.execute(
            """
            SELECT * FROM applied_generation_effects
            WHERE effect_id = ? AND canvas_id = ?
            """,
            (intent.operation_id, row["canvas_id"]),
        ).fetchone()
        identity = (
            str(intent.payload.get("run_id") or ""),
            str(intent.payload.get("node_id") or ""),
            str(intent.payload.get("generation_operation_id") or ""),
            max(0, int(intent.payload.get("request_index") or 0)),
        )
        if (
            effect is None
            or not bool(effect["applied"])
            or str(effect["log_id"] or "")
            or identity
            != (
                str(effect["run_id"]),
                str(effect["node_id"]),
                str(effect["generation_operation_id"]),
                int(effect["request_index"]),
            )
        ):
            return None
        log_payload = copy.deepcopy(dict(final_log))
        log_payload.setdefault("runId", identity[0])
        log_payload.setdefault("nodeId", identity[1])
        logged = self._append_final_log(
            connection,
            row,
            actor or {},
            CanvasIntent.append_final_log(
                log_payload,
                operation_id=intent.operation_id,
            ),
        )
        result = CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=int(row["revision"] or 0),
            changed=False,
            log_id=logged.log_id,
            effect_applied=True,
            reason="already_applied",
        )
        result_json = _json(
            {
                "revision": result.revision,
                "changed": result.changed,
                "log_id": result.log_id,
                "event": result.event,
                "effect_applied": result.effect_applied,
                "reason": result.reason,
            }
        )
        connection.execute(
            """
            UPDATE applied_generation_effects
            SET log_id = ? WHERE effect_id = ?
            """,
            (result.log_id, intent.operation_id),
        )
        connection.execute(
            """
            UPDATE canvas_operation_receipts
            SET intent_hash = ?, result_json = ?
            WHERE operation_id = ?
            """,
            (intent_hash, result_json, intent.operation_id),
        )
        return result

    def _import_canvas(
        self,
        connection: sqlite3.Connection,
        canvas_id: str,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        document = intent.payload.get("canvas")
        if not isinstance(document, Mapping):
            raise CanvasStoreError("invalid_canvas", "Canvas 导入数据无效")
        document = copy.deepcopy(dict(document))
        document_id = str(document.get("id") or canvas_id).strip()
        if not document_id or document_id != canvas_id:
            raise CanvasStoreError("canvas_mismatch", "Canvas ID 不一致")
        if (
            not actor
            or actor.get("status", "active") != "active"
            or actor.get("role") not in {"admin", "designer"}
            or not can_access_canvas(dict(actor), document)
        ):
            raise CanvasStoreError("not_found", "画布不存在")
        if connection.execute(
            "SELECT 1 FROM canvases WHERE canvas_id = ?",
            (canvas_id,),
        ).fetchone():
            raise CanvasStoreError("canvas_exists", "Canvas 已存在")

        connection.execute(
            """
            INSERT INTO canvases(
                canvas_id, kind, title, icon, owner_id, owner_username,
                visibility, created_by, updated_by, owner_label, color,
                pinned, project_id, created_at, updated_at, deleted_at,
                revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                canvas_id,
                "smart" if document.get("kind") == "smart" else "classic",
                str(document.get("title") or "未命名画布"),
                str(document.get("icon") or "layers"),
                str(document.get("owner_id") or actor.get("id") or ""),
                str(document.get("owner_username") or actor.get("username") or ""),
                (
                    str(document.get("visibility"))
                    if document.get("visibility") in {"shared", "private"}
                    else "shared"
                ),
                str(document.get("created_by") or actor.get("id") or ""),
                str(document.get("updated_by") or actor.get("id") or ""),
                str(document.get("owner") or "")[:40],
                str(document.get("color") or "")[:32],
                int(bool(document.get("pinned"))),
                str(document.get("project") or "default"),
                int(document.get("created_at") or 0),
                int(document.get("updated_at") or 0),
                int(document.get("deleted_at") or 0),
                max(0, int(document.get("revision") or 0)),
            ),
        )
        nodes = document.get("nodes")
        if not isinstance(nodes, list):
            nodes = []
        for position, node in enumerate(nodes):
            if not isinstance(node, Mapping) or not str(node.get("id") or ""):
                raise CanvasStoreError("invalid_node", "Node 缺少有效 ID")
            connection.execute(
                """
                INSERT INTO canvas_nodes(
                    canvas_id, node_id, position, payload_json
                ) VALUES (?, ?, ?, ?)
                """,
                (canvas_id, str(node["id"]), position, _json(node)),
            )
        connections = document.get("connections")
        if not isinstance(connections, list):
            connections = []
        for position, item in enumerate(connections):
            if not isinstance(item, Mapping):
                raise CanvasStoreError(
                    "invalid_connection",
                    "Connection 数据无效",
                )
            connection.execute(
                """
                INSERT INTO canvas_connections(
                    canvas_id, connection_id, position, payload_json
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    canvas_id,
                    self._connection_id(item, position),
                    position,
                    _json(item),
                ),
            )
        ignored = self._CANVAS_COLUMNS | self._DROPPED_IMPORT_ROOTS
        for key, value in document.items():
            if key in ignored:
                continue
            connection.execute(
                """
                INSERT INTO canvas_top_level_payloads(
                    canvas_id, payload_key, payload_json
                ) VALUES (?, ?, ?)
                """,
                (canvas_id, str(key), _json(value)),
            )
        connection.execute(
            """
            INSERT INTO canvas_realtime_state(canvas_id, payload_json)
            VALUES (?, ?)
            """,
            (
                canvas_id,
                _json(
                    {
                        "enabled": True,
                        "lineage_schema": 2,
                        "tombstones": {},
                        "versions": {},
                    }
                ),
            ),
        )
        generation_history = intent.payload.get("generation_history", [])
        if not isinstance(generation_history, list):
            raise CanvasStoreError(
                "invalid_generation_history",
                "Canvas Generation History 必须是数组",
            )
        if generation_history:
            imported_row = connection.execute(
                "SELECT * FROM canvases WHERE canvas_id = ?",
                (canvas_id,),
            ).fetchone()
            assert imported_row is not None
            for log in generation_history:
                self._append_final_log(
                    connection,
                    imported_row,
                    actor,
                    CanvasIntent.append_final_log(
                        log,
                        operation_id=intent.operation_id,
                    ),
                )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=max(0, int(document.get("revision") or 0)),
            changed=True,
        )

    def _set_deleted_state(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
        *,
        deleted: bool,
    ) -> CanvasCommit:
        canvas_id = str(row["canvas_id"])
        was_deleted = bool(int(row["deleted_at"] or 0))
        changed = was_deleted != deleted
        if changed:
            connection.execute(
                """
                UPDATE canvases
                SET deleted_at = ?
                WHERE canvas_id = ?
                """,
                (
                    int(self._now_ms()) if deleted else 0,
                    canvas_id,
                ),
            )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=max(0, int(row["revision"] or 0)),
            changed=changed,
        )

    def _purge_canvas(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        if not actor or actor.get("role") != "admin":
            raise CanvasStoreError("forbidden", "仅管理员可以永久删除画布")
        canvas_id = str(row["canvas_id"])
        revision = max(0, int(row["revision"] or 0))
        connection.execute(
            "DELETE FROM canvases WHERE canvas_id = ?",
            (canvas_id,),
        )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=revision,
            changed=True,
        )

    def _update_metadata(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        values = intent.payload.get("values")
        if not isinstance(values, Mapping):
            raise CanvasStoreError("invalid_metadata", "Canvas 元数据无效")
        canvas_id = str(row["canvas_id"])
        project_id = (
            str(values.get("project") or "").strip() or "default"
            if values.get("project") is not None
            else str(row["project_id"])
        )
        if not can_access_project(dict(actor or {}), project_id):
            raise CanvasStoreError("forbidden", "当前账号无权访问目标项目")
        color = (
            str(values.get("color") or "").strip().lower()
            if values.get("color") is not None
            else str(row["color"])
        )
        if color not in {
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
        }:
            color = ""
        title = (
            str(values.get("title") or row["title"] or "未命名画布")[:80]
            if values.get("title") is not None
            else str(row["title"])
        )
        icon = (
            str(values.get("icon") or "layers")[:32]
            if values.get("icon") is not None
            else str(row["icon"])
        )
        owner_label = (
            str(values.get("owner") or "").strip()[:40]
            if values.get("owner") is not None
            else str(row["owner_label"])
        )
        pinned = (
            int(bool(values.get("pinned")))
            if values.get("pinned") is not None
            else int(row["pinned"])
        )
        identity_changed = title != str(row["title"]) or icon != str(row["icon"])
        columns_changed = identity_changed or any(
            (
                owner_label != str(row["owner_label"]),
                color != str(row["color"]),
                pinned != int(row["pinned"]),
                project_id != str(row["project_id"]),
            )
        )
        if columns_changed:
            if identity_changed:
                connection.execute(
                    """
                    UPDATE canvases
                    SET title = ?, icon = ?, owner_label = ?, color = ?,
                        pinned = ?, project_id = ?, updated_by = ?, updated_at = ?
                    WHERE canvas_id = ?
                    """,
                    (
                        title,
                        icon,
                        owner_label,
                        color,
                        pinned,
                        project_id,
                        str((actor or {}).get("id") or ""),
                        int(self._now_ms()),
                        canvas_id,
                    ),
                )
            else:
                connection.execute(
                    """
                    UPDATE canvases
                    SET title = ?, icon = ?, owner_label = ?, color = ?,
                        pinned = ?, project_id = ?
                    WHERE canvas_id = ?
                    """,
                    (
                        title,
                        icon,
                        owner_label,
                        color,
                        pinned,
                        project_id,
                        canvas_id,
                    ),
                )
        payloads = {
            str(payload["payload_key"]): json.loads(payload["payload_json"])
            for payload in connection.execute(
                """
                SELECT payload_key, payload_json
                FROM canvas_top_level_payloads
                WHERE canvas_id = ?
                  AND payload_key IN ('board_x', 'board_y', 'cover_image')
                """,
                (canvas_id,),
            )
        }
        payload_changed = False
        for key in ("board_x", "board_y"):
            if values.get(key) is None:
                continue
            coordinate = float(values[key])
            if payloads.get(key) == coordinate:
                continue
            payload_changed = True
            connection.execute(
                """
                INSERT INTO canvas_top_level_payloads(
                    canvas_id, payload_key, payload_json
                ) VALUES (?, ?, ?)
                ON CONFLICT(canvas_id, payload_key)
                DO UPDATE SET payload_json = excluded.payload_json
                """,
                (canvas_id, key, _json(coordinate)),
            )
        if values.get("cover_url") is not None:
            cover_url = str(values.get("cover_url") or "")
            if cover_url:
                cover = {
                    "url": cover_url,
                    "node_id": str(values.get("cover_node_id") or "")[:160],
                    "image_index": max(
                        0,
                        int(values.get("cover_image_index") or 0),
                    ),
                }
                if payloads.get("cover_image") != cover:
                    payload_changed = True
                    connection.execute(
                        """
                        INSERT INTO canvas_top_level_payloads(
                            canvas_id, payload_key, payload_json
                        ) VALUES (?, 'cover_image', ?)
                        ON CONFLICT(canvas_id, payload_key)
                        DO UPDATE SET payload_json = excluded.payload_json
                        """,
                        (canvas_id, _json(cover)),
                    )
            elif "cover_image" in payloads:
                payload_changed = True
                connection.execute(
                    """
                    DELETE FROM canvas_top_level_payloads
                    WHERE canvas_id = ? AND payload_key = 'cover_image'
                    """,
                    (canvas_id,),
                )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=max(0, int(row["revision"] or 0)),
            changed=columns_changed or payload_changed,
        )

    def _set_visibility(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        canvas = self._row_canvas(row)
        try:
            set_canvas_visibility(
                canvas,
                str(intent.payload.get("visibility") or ""),
                dict(actor or {}),
            )
        except ValueError as exc:
            raise CanvasStoreError("invalid_visibility", str(exc)) from exc
        except PermissionError as exc:
            raise CanvasStoreError("forbidden", str(exc)) from exc
        changed = str(row["visibility"]) != str(canvas["visibility"])
        if changed:
            connection.execute(
                """
                UPDATE canvases SET visibility = ? WHERE canvas_id = ?
                """,
                (canvas["visibility"], str(row["canvas_id"])),
            )
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=max(0, int(row["revision"] or 0)),
            changed=changed,
        )

    def _touch_canvas(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        del connection, actor
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=max(0, int(row["revision"] or 0)),
            changed=False,
        )

    def _save_snapshot(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        values = intent.payload.get("values")
        if not isinstance(values, Mapping):
            raise CanvasStoreError("invalid_snapshot", "Canvas 快照无效")
        if str(row["kind"]) == "smart":
            raise CanvasStoreError(
                "realtime_mutation_required",
                "Smart Canvas 必须通过实时 Mutation 保存",
                revision=max(0, int(row["revision"] or 0)),
            )
        base_updated_at = int(values.get("base_updated_at") or 0)
        current_updated_at = int(row["updated_at"] or 0)
        if base_updated_at and base_updated_at < current_updated_at:
            raise CanvasStoreError(
                "stale_snapshot",
                "画布已被其他页面更新，已拒绝旧版本覆盖。",
                revision=max(0, int(row["revision"] or 0)),
            )
        canvas_id = str(row["canvas_id"])
        nodes = values.get("nodes")
        if not isinstance(nodes, list):
            nodes = []
        connections = values.get("connections")
        if not isinstance(connections, list):
            connections = []
        title = str(values.get("title") or row["title"] or "未命名画布")[:80]
        icon = str(values.get("icon") or row["icon"] or "layers")[:32]
        settings = copy.deepcopy(values.get("settings") or {})
        current = self._full_canvas(connection, row)
        changed = any(
            (
                title != str(row["title"]),
                icon != str(row["icon"]),
                nodes != list(current.get("nodes") or []),
                connections != list(current.get("connections") or []),
                settings != (current.get("settings") or {}),
            )
        )
        if not changed:
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=max(0, int(row["revision"] or 0)),
                changed=False,
            )
        connection.execute(
            "DELETE FROM canvas_nodes WHERE canvas_id = ?",
            (canvas_id,),
        )
        for position, node in enumerate(nodes):
            if not isinstance(node, Mapping) or not str(node.get("id") or ""):
                raise CanvasStoreError("invalid_node", "Node 缺少有效 ID")
            connection.execute(
                """
                INSERT INTO canvas_nodes(canvas_id, node_id, position, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (canvas_id, str(node["id"]), position, _json(node)),
            )
        connection.execute(
            "DELETE FROM canvas_connections WHERE canvas_id = ?",
            (canvas_id,),
        )
        for position, item in enumerate(connections):
            if not isinstance(item, Mapping):
                raise CanvasStoreError("invalid_connection", "Connection 数据无效")
            connection.execute(
                """
                INSERT INTO canvas_connections(
                    canvas_id, connection_id, position, payload_json
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    canvas_id,
                    self._connection_id(item, position),
                    position,
                    _json(item),
                ),
            )
        connection.execute(
            """
            UPDATE canvases
            SET title = ?, icon = ?, updated_by = ?, updated_at = ?
            WHERE canvas_id = ?
            """,
            (
                title,
                icon,
                str((actor or {}).get("id") or ""),
                int(self._now_ms()),
                canvas_id,
            ),
        )
        connection.execute(
            """
            INSERT INTO canvas_top_level_payloads(
                canvas_id, payload_key, payload_json
            ) VALUES (?, 'settings', ?)
            ON CONFLICT(canvas_id, payload_key)
            DO UPDATE SET payload_json = excluded.payload_json
            """,
            (canvas_id, _json(settings)),
        )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=max(0, int(row["revision"] or 0)),
            changed=True,
        )

    def _update_prompt_templates(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        templates = intent.payload.get("templates")
        if not isinstance(templates, list) or any(
            not isinstance(item, Mapping) for item in templates
        ):
            raise CanvasStoreError(
                "invalid_prompt_templates",
                "当前画布提示词数据无效",
            )
        current_revision = max(0, int(row["revision"] or 0))
        base_revision = max(0, int(intent.payload.get("base_revision") or 0))
        if base_revision != current_revision:
            raise CanvasStoreError(
                "stale_prompt_templates",
                "画布内容已更新，请刷新提示词库后重试",
                revision=current_revision,
            )
        canvas_id = str(row["canvas_id"])
        current_row = connection.execute(
            """
            SELECT payload_json FROM canvas_top_level_payloads
            WHERE canvas_id = ? AND payload_key = 'prompt_templates'
            """,
            (canvas_id,),
        ).fetchone()
        current_templates = (
            json.loads(current_row["payload_json"])
            if current_row is not None
            else []
        )
        next_templates = copy.deepcopy(templates)
        if current_templates == next_templates:
            return CanvasCommit(
                canvas_id=canvas_id,
                operation_id=intent.operation_id,
                revision=current_revision,
                changed=False,
            )
        timestamp = int(self._now_ms())
        next_revision = current_revision + 1
        connection.execute(
            """
            INSERT INTO canvas_top_level_payloads(
                canvas_id, payload_key, payload_json
            ) VALUES (?, 'prompt_templates', ?)
            ON CONFLICT(canvas_id, payload_key)
            DO UPDATE SET payload_json = excluded.payload_json
            """,
            (canvas_id, _json(next_templates)),
        )
        connection.execute(
            """
            UPDATE canvases
            SET revision = ?, updated_at = ?, updated_by = ?
            WHERE canvas_id = ?
            """,
            (
                next_revision,
                timestamp,
                str((actor or {}).get("id") or row["updated_by"]),
                canvas_id,
            ),
        )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=next_revision,
            changed=True,
            event={
                "type": "canvas_prompt_templates_updated",
                "canvas_id": canvas_id,
                "revision": next_revision,
                "updated_at": timestamp,
            },
        )

    def _commit_prompt(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        prompt_intent = intent.payload.get("intent")
        if not isinstance(prompt_intent, Mapping):
            raise CanvasStoreError(
                "invalid_prompt_intent",
                "当前画布提示词操作无效",
                revision=max(0, int(row["revision"] or 0)),
            )
        canvas_id = str(row["canvas_id"])
        current_revision = max(0, int(row["revision"] or 0))
        current_row = connection.execute(
            """
            SELECT payload_json FROM canvas_top_level_payloads
            WHERE canvas_id = ? AND payload_key = 'prompt_templates'
            """,
            (canvas_id,),
        ).fetchone()
        current_templates = (
            json.loads(current_row["payload_json"])
            if current_row is not None
            else []
        )
        timestamp = int(self._now_ms())
        next_templates, _item_id = apply_prompt_template_intent(
            current_templates,
            prompt_intent,
            revision=current_revision,
            now_ms=timestamp,
        )
        if current_templates == next_templates:
            return CanvasCommit(
                canvas_id=canvas_id,
                operation_id=intent.operation_id,
                revision=current_revision,
                changed=False,
            )
        next_revision = current_revision + 1
        connection.execute(
            """
            INSERT INTO canvas_top_level_payloads(
                canvas_id, payload_key, payload_json
            ) VALUES (?, 'prompt_templates', ?)
            ON CONFLICT(canvas_id, payload_key)
            DO UPDATE SET payload_json = excluded.payload_json
            """,
            (canvas_id, _json(next_templates)),
        )
        connection.execute(
            """
            UPDATE canvases
            SET revision = ?, updated_at = ?, updated_by = ?
            WHERE canvas_id = ?
            """,
            (
                next_revision,
                timestamp,
                str((actor or {}).get("id") or row["updated_by"]),
                canvas_id,
            ),
        )
        return CanvasCommit(
            canvas_id=canvas_id,
            operation_id=intent.operation_id,
            revision=next_revision,
            changed=True,
            event={
                "type": "canvas_prompt_templates_updated",
                "canvas_id": canvas_id,
                "revision": next_revision,
                "updated_at": timestamp,
            },
        )

    def _mutation_realtime_state(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        state_row = connection.execute(
            """
            SELECT payload_json FROM canvas_realtime_state
            WHERE canvas_id = ?
            """,
            (row["canvas_id"],),
        ).fetchone()
        state = _json_object(
            state_row["payload_json"] if state_row is not None else "{}"
        )
        state["enabled"] = True
        state["receipts"] = {}
        state["history"] = []
        for mutation in connection.execute(
            """
            SELECT * FROM canvas_mutations
            WHERE canvas_id = ? ORDER BY revision
            """,
            (row["canvas_id"],),
        ):
            record = {
                "operation_id": mutation["operation_id"],
                "actor_id": mutation["actor_id"],
                "revision": mutation["revision"],
                "base_revision": mutation["base_revision"],
                "changes": json.loads(mutation["changes_json"]),
                "inverse": json.loads(mutation["inverse_json"]),
                "reverts_operation_id": mutation["reverts_operation_id"],
            }
            if mutation["undone_by"]:
                record["undone_by"] = mutation["undone_by"]
            state["history"].append(record)
        return state

    def _mutation_canvas(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        canvas = self._full_canvas(connection, row)
        state = self._mutation_realtime_state(connection, row)
        canvas["_realtime"] = state
        return canvas

    @staticmethod
    def _reject_log_mutation(
        operation: Mapping[str, Any],
        *,
        revision: int,
    ) -> None:
        changes = operation.get("changes")
        if not isinstance(changes, Mapping):
            return
        for action in ("canvas_updates", "canvas_unsets"):
            entries = changes.get(action)
            if not isinstance(entries, list):
                continue
            if any(
                isinstance(entry, Mapping)
                and isinstance(entry.get("path"), list)
                and entry.get("path")
                and str(entry["path"][0]) == "logs"
                for entry in entries
            ):
                raise CanvasStoreError(
                    "logs_require_final_log",
                    "生成日志必须通过最终日志 intent 写入",
                    revision=revision,
                )

    def _upsert_node(
        self,
        connection: sqlite3.Connection,
        canvas_id: str,
        node: Mapping[str, Any],
    ) -> None:
        node_id = str(node.get("id") or "")
        existing = connection.execute(
            """
            SELECT position FROM canvas_nodes
            WHERE canvas_id = ? AND node_id = ?
            """,
            (canvas_id, node_id),
        ).fetchone()
        if existing is None:
            position = int(
                connection.execute(
                    """
                    SELECT COALESCE(MAX(position), -1) + 1
                    FROM canvas_nodes WHERE canvas_id = ?
                    """,
                    (canvas_id,),
                ).fetchone()[0]
            )
            connection.execute(
                """
                INSERT INTO canvas_nodes(
                    canvas_id, node_id, position, payload_json
                ) VALUES (?, ?, ?, ?)
                """,
                (canvas_id, node_id, position, _json(node)),
            )
        else:
            connection.execute(
                """
                UPDATE canvas_nodes SET payload_json = ?
                WHERE canvas_id = ? AND node_id = ?
                """,
                (_json(node), canvas_id, node_id),
            )

    def _replace_connections(
        self,
        connection: sqlite3.Connection,
        canvas_id: str,
        connections: list[Any],
    ) -> None:
        connection.execute(
            "DELETE FROM canvas_connections WHERE canvas_id = ?",
            (canvas_id,),
        )
        for position, item in enumerate(connections):
            connection.execute(
                """
                INSERT INTO canvas_connections(
                    canvas_id, connection_id, position, payload_json
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    canvas_id,
                    self._connection_id(item, position),
                    position,
                    _json(item),
                ),
            )

    def _persist_mutation_state(
        self,
        connection: sqlite3.Connection,
        canvas: Dict[str, Any],
        result: Any,
        actor: Mapping[str, Any],
    ) -> None:
        canvas_id = str(canvas["id"])
        changes = result.changes
        nodes = {
            str(node.get("id") or ""): node
            for node in canvas.get("nodes") or []
            if isinstance(node, Mapping)
        }
        affected_nodes = {
            str(entry.get("id") or "")
            for action in ("node_creates", "node_updates", "node_unsets")
            for entry in changes.get(action, [])
            if isinstance(entry, Mapping)
        }
        for node_id in affected_nodes:
            if node_id in nodes:
                self._upsert_node(
                    connection,
                    canvas_id,
                    nodes[node_id],
                )
        for raw in changes.get("node_deletes", []):
            node_id = str(raw.get("id") if isinstance(raw, Mapping) else raw)
            connection.execute(
                """
                DELETE FROM canvas_nodes
                WHERE canvas_id = ? AND node_id = ?
                """,
                (canvas_id, node_id),
            )

        if (
            changes.get("connection_adds")
            or changes.get("connection_removes")
            or changes.get("node_deletes")
        ):
            self._replace_connections(
                connection,
                canvas_id,
                list(canvas.get("connections") or []),
            )
        for root in {"title", "icon"}:
            if any(
                isinstance(entry, Mapping)
                and list(entry.get("path") or [""])[0] == root
                for action in ("canvas_updates", "canvas_unsets")
                for entry in changes.get(action, [])
            ):
                connection.execute(
                    f"UPDATE canvases SET {root} = ? WHERE canvas_id = ?",
                    (str(canvas.get(root) or ""), canvas_id),
                )
        if any(
            isinstance(entry, Mapping)
            and list(entry.get("path") or [""])[0] == "settings"
            for action in ("canvas_updates", "canvas_unsets")
            for entry in changes.get(action, [])
        ):
            connection.execute(
                """
                INSERT INTO canvas_top_level_payloads(
                    canvas_id, payload_key, payload_json
                ) VALUES (?, 'settings', ?)
                ON CONFLICT(canvas_id, payload_key)
                DO UPDATE SET payload_json = excluded.payload_json
                """,
                (canvas_id, _json(canvas.get("settings") or {})),
            )

        updated_at = int(self._now_ms())
        connection.execute(
            """
            UPDATE canvases
            SET revision = ?, updated_at = ?, updated_by = ?
            WHERE canvas_id = ?
            """,
            (
                int(canvas.get("revision") or 0),
                updated_at,
                str(actor.get("id") or ""),
                canvas_id,
            ),
        )
        state = dict(canvas.get("_realtime") or {})
        history = list(state.pop("history", []) or [])
        state.pop("receipts", None)
        connection.execute(
            """
            INSERT INTO canvas_realtime_state(canvas_id, payload_json)
            VALUES (?, ?)
            ON CONFLICT(canvas_id)
            DO UPDATE SET payload_json = excluded.payload_json
            """,
            (canvas_id, _json(state)),
        )
        history_ids = [
            str(record.get("operation_id") or "")
            for record in history
            if str(record.get("operation_id") or "")
        ]
        current_record = next(
            (
                record
                for record in reversed(history)
                if str(record.get("operation_id") or "")
                == result.operation_id
            ),
            None,
        )
        if current_record is not None:
            connection.execute(
                """
                INSERT INTO canvas_mutations(
                    canvas_id, operation_id, actor_id, revision,
                    base_revision, changes_json, inverse_json,
                    reverts_operation_id, undone_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(canvas_id, operation_id) DO UPDATE SET
                    undone_by = excluded.undone_by
                """,
                (
                    canvas_id,
                    result.operation_id,
                    str(current_record.get("actor_id") or ""),
                    int(current_record.get("revision") or 0),
                    int(current_record.get("base_revision") or 0),
                    _json(current_record.get("changes") or {}),
                    _json(current_record.get("inverse") or {}),
                    str(current_record.get("reverts_operation_id") or ""),
                    str(current_record.get("undone_by") or ""),
                    updated_at,
                ),
            )
        if result.reverts_operation_id:
            connection.execute(
                """
                UPDATE canvas_mutations SET undone_by = ?
                WHERE canvas_id = ? AND operation_id = ?
                """,
                (
                    result.operation_id,
                    canvas_id,
                    result.reverts_operation_id,
                ),
            )
        if history_ids:
            placeholders = ",".join("?" for _item in history_ids)
            connection.execute(
                f"""
                DELETE FROM canvas_mutations
                WHERE canvas_id = ?
                  AND operation_id NOT IN ({placeholders})
                """,
                [canvas_id, *history_ids],
            )
        else:
            connection.execute(
                "DELETE FROM canvas_mutations WHERE canvas_id = ?",
                (canvas_id,),
            )

    def _commit_mutation(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any],
        intent: CanvasIntent,
        *,
        route: tuple[str, str],
        timing: Dict[str, Any] | None = None,
    ) -> CanvasCommit:
        if row["kind"] != "smart":
            raise CanvasStoreError(
                "realtime_smart_only",
                "实时 Mutation 仅支持 Smart Canvas",
                revision=int(row["revision"] or 0),
            )
        operation = intent.payload.get("operation")
        if not isinstance(operation, Mapping):
            raise CanvasStoreError(
                "invalid_operation",
                "Mutation 必须是对象",
                revision=int(row["revision"] or 0),
            )
        if str(operation.get("operation_id") or "") != intent.operation_id:
            raise CanvasStoreError(
                "operation_collision",
                "operation_id 不一致",
                revision=int(row["revision"] or 0),
            )
        self._reject_log_mutation(
            operation,
            revision=int(row["revision"] or 0),
        )
        target_node_id, fallback_category = route
        fast_path_eligible = bool(target_node_id)
        load_started_ns = time.perf_counter_ns()
        if fast_path_eligible:
            node_row = connection.execute(
                """
                SELECT payload_json FROM canvas_nodes
                WHERE canvas_id = ? AND node_id = ?
                """,
                (row["canvas_id"], target_node_id),
            ).fetchone()
            node = (
                json.loads(node_row["payload_json"])
                if node_row is not None
                else None
            )
            state = self._mutation_realtime_state(connection, row)
            canvas = None
        else:
            node = None
            state = None
            canvas = self._mutation_canvas(connection, row)
        if timing is not None:
            timing.update(
                {
                    "eligible": fast_path_eligible,
                    "hit": fast_path_eligible,
                    "fallback": fallback_category,
                    "load_ms": (
                        time.perf_counter_ns() - load_started_ns
                    )
                    / 1_000_000,
                }
            )
        apply_started_ns = time.perf_counter_ns()
        try:
            if fast_path_eligible:
                canvas, result = apply_single_node_position_operation(
                    str(row["canvas_id"]),
                    node,
                    state or {},
                    int(row["revision"] or 0),
                    dict(operation),
                    str(actor.get("id") or ""),
                )
            else:
                assert canvas is not None
                result = apply_operation(
                    canvas,
                    dict(operation),
                    str(actor.get("id") or ""),
                )
        except CanvasRealtimeError as exc:
            raise CanvasStoreError(
                exc.code,
                exc.message,
                revision=exc.revision,
                retry_changes=exc.retry_changes,
            ) from exc
        if timing is not None:
            timing["apply_ms"] = (
                time.perf_counter_ns() - apply_started_ns
            ) / 1_000_000
        if result.revision == int(row["revision"] or 0):
            event = result.message()
            event["canvas_id"] = str(row["canvas_id"])
            event["changed"] = False
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=result.revision,
                changed=False,
                duplicate=result.duplicate,
                event=event,
            )
        persist_started_ns = time.perf_counter_ns()
        assert canvas is not None
        self._persist_mutation_state(
            connection,
            canvas,
            result,
            actor,
        )
        if timing is not None:
            timing["persist_ms"] = (
                time.perf_counter_ns() - persist_started_ns
            ) / 1_000_000
        event_started_ns = time.perf_counter_ns()
        event = result.message()
        event["canvas_id"] = str(row["canvas_id"])
        connection.execute(
            """
            INSERT INTO canvas_events(
                canvas_id, revision, event_json, created_at
            ) VALUES (?, ?, ?, ?)
            """,
            (
                row["canvas_id"],
                result.revision,
                _json(event),
                int(self._now_ms()),
            ),
        )
        if timing is not None:
            timing["event_ms"] = (
                time.perf_counter_ns() - event_started_ns
            ) / 1_000_000
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=result.revision,
            changed=True,
            event=event,
        )

    @staticmethod
    def _reject_inline_generation_media(
        node_changes: Mapping[str, Any],
    ) -> None:
        outputs = node_changes.get("images")
        if not isinstance(outputs, list):
            return
        for output in outputs:
            item = output if isinstance(output, Mapping) else {"url": output}
            media_ref = str(
                item.get("url")
                or item.get("path")
                or item.get("src")
                or ""
            ).strip()
            if media_ref.startswith("data:"):
                raise CanvasStoreError(
                    "inline_media_not_materialized",
                    "Generation Output 写入前必须先物化内嵌媒体",
                )

    def _record_generation_effect(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        intent: CanvasIntent,
        *,
        applied: bool,
        outcome: str,
        revision: int,
        log_id: str = "",
    ) -> None:
        connection.execute(
            """
            INSERT INTO applied_generation_effects(
                effect_id, canvas_id, run_id, node_id,
                generation_operation_id, request_index, applied,
                outcome, revision, log_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intent.operation_id,
                row["canvas_id"],
                str(intent.payload.get("run_id") or ""),
                str(intent.payload.get("node_id") or ""),
                str(intent.payload.get("generation_operation_id") or ""),
                max(0, int(intent.payload.get("request_index") or 0)),
                int(applied),
                str(outcome or ""),
                max(0, int(revision or 0)),
                str(log_id or ""),
                int(self._now_ms()),
            ),
        )

    def _existing_generation_effect(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        intent: CanvasIntent,
    ) -> CanvasCommit | None:
        run_id = str(intent.payload.get("run_id") or "")
        if not run_id:
            return None
        existing = connection.execute(
            """
            SELECT * FROM applied_generation_effects
            WHERE canvas_id = ? AND run_id = ?
            """,
            (row["canvas_id"], run_id),
        ).fetchone()
        if existing is None:
            return None
        identity = (
            str(intent.payload.get("node_id") or ""),
            str(intent.payload.get("generation_operation_id") or ""),
            max(0, int(intent.payload.get("request_index") or 0)),
        )
        stored_identity = (
            str(existing["node_id"]),
            str(existing["generation_operation_id"]),
            int(existing["request_index"]),
        )
        if identity != stored_identity:
            raise CanvasStoreError(
                "generation_effect_collision",
                "run_id 已绑定到其他 Generation Output",
                revision=int(row["revision"] or 0),
            )
        applied = bool(existing["applied"])
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=int(row["revision"] or 0),
            changed=False,
            duplicate=True,
            log_id=str(existing["log_id"] or ""),
            effect_applied=applied,
            reason=(
                "already_applied"
                if applied
                else str(existing["outcome"] or "")
            ),
        )

    def _commit_generation_output(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any],
        intent: CanvasIntent,
    ) -> CanvasCommit:
        revision = int(row["revision"] or 0)
        if row["kind"] != "smart":
            raise CanvasStoreError(
                "generation_smart_only",
                "Generation Output 仅支持 Smart Canvas",
                revision=revision,
            )
        node_id = str(intent.payload.get("node_id") or "").strip()
        generation_operation_id = str(
            intent.payload.get("generation_operation_id") or ""
        ).strip()
        node_changes = intent.payload.get("node_changes")
        final_log = intent.payload.get("final_log")
        if not node_id or not generation_operation_id:
            raise CanvasStoreError(
                "invalid_generation_target",
                "Generation Output 缺少目标 Node 或 operation ID",
                revision=revision,
            )
        if not isinstance(node_changes, Mapping):
            raise CanvasStoreError(
                "invalid_generation_output",
                "Generation Output Node changes 必须是对象",
                revision=revision,
            )
        if final_log is not None and not isinstance(final_log, Mapping):
            raise CanvasStoreError(
                "invalid_log",
                "最终日志数据无效",
                revision=revision,
            )
        existing = self._existing_generation_effect(
            connection,
            row,
            intent,
        )
        if existing is not None:
            return existing

        node_row = connection.execute(
            """
            SELECT payload_json FROM canvas_nodes
            WHERE canvas_id = ? AND node_id = ?
            """,
            (row["canvas_id"], node_id),
        ).fetchone()
        if node_row is None:
            self._record_generation_effect(
                connection,
                row,
                intent,
                applied=False,
                outcome="node_deleted",
                revision=revision,
            )
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=revision,
                changed=False,
                effect_applied=False,
                reason="node_deleted",
            )
        node = _json_object(node_row["payload_json"])
        if str(node.get("generationOperationId") or "") != (
            generation_operation_id
        ):
            self._record_generation_effect(
                connection,
                row,
                intent,
                applied=False,
                outcome="operation_replaced",
                revision=revision,
            )
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=revision,
                changed=False,
                effect_applied=False,
                reason="operation_replaced",
            )
        if not node_changes and final_log is None:
            self._record_generation_effect(
                connection,
                row,
                intent,
                applied=True,
                outcome="no_changes",
                revision=revision,
            )
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=revision,
                changed=False,
                effect_applied=True,
                reason="no_changes",
            )

        self._reject_inline_generation_media(node_changes)
        node_changed = bool(node_changes)
        event = None
        if node_changed:
            peer_rows = connection.execute(
                """SELECT payload_json FROM canvas_nodes
                   WHERE canvas_id = ? AND
                     (node_id = ? OR json_extract(payload_json, '$.generationBatchId') = ?)""",
                (row["canvas_id"], node_id, node.get("generationBatchId")),
            ).fetchall()
            updated_nodes = apply_generation_result_nodes(
                node,
                node_changes,
                [_json_object(peer["payload_json"]) for peer in peer_rows],
                run_id=str(intent.payload.get("run_id") or ""),
            )
            for updated_node in updated_nodes:
                self._upsert_node(connection, str(row["canvas_id"]), updated_node)
            revision += 1
            updated_at = int(self._now_ms())
            connection.execute(
                """
                UPDATE canvases
                SET revision = ?, updated_at = ?, updated_by = ?
                WHERE canvas_id = ?
                """,
                (
                    revision,
                    updated_at,
                    str(actor.get("id") or ""),
                    row["canvas_id"],
                ),
            )
            event = {
                "type": "canvas_updated",
                "canvas_id": str(row["canvas_id"]),
                "revision": revision,
                "updated_at": updated_at,
                "client_id": "",
            }
            connection.execute(
                """
                INSERT INTO canvas_events(
                    canvas_id, revision, event_json, created_at
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    row["canvas_id"],
                    revision,
                    _json(event),
                    updated_at,
                ),
            )

        log_id = ""
        if final_log is not None:
            log_payload = copy.deepcopy(dict(final_log))
            log_payload.setdefault("runId", intent.payload.get("run_id"))
            log_payload.setdefault("nodeId", node_id)
            log_result = self._append_final_log(
                connection,
                row,
                actor,
                CanvasIntent.append_final_log(
                    log_payload,
                    operation_id=intent.operation_id,
                ),
            )
            log_id = log_result.log_id

        self._record_generation_effect(
            connection,
            row,
            intent,
            applied=True,
            outcome="applied",
            revision=revision,
            log_id=log_id,
        )
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=revision,
            changed=node_changed,
            log_id=log_id,
            event=event,
            effect_applied=True,
        )

    @staticmethod
    def _log_summary(row: sqlite3.Row) -> Dict[str, Any]:
        summary = _json_object(row["summary_json"])
        summary.update(
            {
                "id": row["log_id"],
                "nodeId": row["node_id"],
                "runId": row["run_id"],
                "status": row["final_status"],
                "username": row["actor_username"],
                "platform": row["platform"],
                "model": row["model"],
                "createdAt": row["created_at"],
                "durationMs": row["duration_ms"],
            }
        )
        return summary

    def _log_detail(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        detail = self._log_summary(row)
        payload = connection.execute(
            """
            SELECT payload_json FROM generation_log_payloads
            WHERE payload_digest = ?
            """,
            (row["payload_digest"],),
        ).fetchone()
        if payload is not None:
            detail.update(_json_object(payload["payload_json"]))
        detail["outputs"] = []
        for output in connection.execute(
            """
            SELECT * FROM generation_log_outputs
            WHERE log_id = ? ORDER BY output_index
            """,
            (row["log_id"],),
        ):
            item = _json_object(output["metadata_json"])
            item.update(
                {
                    "url": output["media_ref"],
                    "kind": output["media_kind"],
                }
            )
            if int(output["width"] or 0):
                item["width"] = int(output["width"])
            if int(output["height"] or 0):
                item["height"] = int(output["height"])
            detail["outputs"].append(item)
        return detail

    def _append_final_log(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        raw = intent.payload.get("log")
        if not isinstance(raw, Mapping):
            raise CanvasStoreError("invalid_log", "最终日志数据无效")
        raw = copy.deepcopy(dict(raw))
        status = str(raw.get("status") or "").strip().lower()
        if status not in FINAL_LOG_STATUSES:
            raise CanvasStoreError("invalid_log_status", "日志必须是最终状态")
        run_id = str(raw.get("run_id") or raw.get("runId") or "").strip()
        existing_run = None
        if run_id:
            existing_run = connection.execute(
                """
                SELECT log_id FROM canvas_logs
                WHERE canvas_id = ? AND run_id = ?
                """,
                (row["canvas_id"], run_id),
            ).fetchone()
        if existing_run is not None:
            return CanvasCommit(
                canvas_id=str(row["canvas_id"]),
                operation_id=intent.operation_id,
                revision=int(row["revision"]),
                changed=False,
                duplicate=True,
                log_id=str(existing_run["log_id"]),
            )

        log_id = str(raw.get("id") or raw.get("log_id") or uuid.uuid4().hex)
        if connection.execute(
            "SELECT 1 FROM canvas_logs WHERE log_id = ?",
            (log_id,),
        ).fetchone():
            raise CanvasStoreError(
                "log_collision",
                "生成日志 ID 已被使用",
            )
        node_id = str(raw.get("node_id") or raw.get("nodeId") or "")
        created_at = int(
            raw.get("created_at")
            or raw.get("createdAt")
            or self._now_ms()
        )
        duration_ms = max(
            0,
            int(raw.get("duration_ms") or raw.get("durationMs") or 0),
        )
        platform = str(raw.get("platform") or "")[:120]
        model = str(raw.get("model") or "")[:240]
        summary = _sanitize(
            {
                "outputCount": len(raw.get("outputs") or []),
                "errorSummary": str(
                    raw.get("error_summary")
                    or raw.get("errorSummary")
                    or raw.get("error")
                    or ""
                )[:1000],
            }
        )
        detail_keys = {
            "prompt",
            "request",
            "refs",
            "tasks",
            "diagnostics",
            "error",
            "error_detail",
            "errorDetail",
            "upstream_task_id",
            "upstreamTaskId",
        }
        detail = _sanitize(
            {key: raw[key] for key in detail_keys if key in raw}
        )
        raw_error = raw.get("raw_error") or raw.get("rawError")
        if raw_error:
            detail["rawError"] = _truncate_utf8(
                _sanitize_raw_error(raw_error),
                MAX_RAW_ERROR_BYTES,
            )
        payload_digest = _digest(detail)
        payload_json = _json(detail)
        connection.execute(
            """
            INSERT INTO generation_log_payloads(
                payload_digest, payload_json, byte_size
            ) VALUES (?, ?, ?)
            ON CONFLICT(payload_digest) DO NOTHING
            """,
            (
                payload_digest,
                payload_json,
                len(payload_json.encode("utf-8")),
            ),
        )
        connection.execute(
            """
            INSERT INTO canvas_logs(
                log_id, canvas_id, node_id, run_id, final_status,
                actor_username, platform, model, created_at, duration_ms,
                summary_json, payload_digest
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                log_id,
                row["canvas_id"],
                node_id,
                run_id,
                status,
                str((actor or {}).get("username") or ""),
                platform,
                model,
                created_at,
                duration_ms,
                _json(summary),
                payload_digest,
            ),
        )
        outputs = raw.get("outputs")
        if not isinstance(outputs, list):
            outputs = []
        for index, output in enumerate(outputs):
            item = dict(output) if isinstance(output, Mapping) else {"url": output}
            media_ref = _sanitize_url(
                str(
                    item.get("url")
                    or item.get("path")
                    or item.get("src")
                    or ""
                )
            )
            if not media_ref:
                raise CanvasStoreError(
                    "invalid_log_output",
                    "生成日志输出缺少媒体引用",
                )
            if media_ref.startswith("data:"):
                raise CanvasStoreError(
                    "inline_media_not_materialized",
                    "生成日志写入前必须先物化内嵌媒体",
                )
            metadata = _sanitize(
                {
                    key: value
                    for key, value in item.items()
                    if key not in {"url", "path", "src", "kind", "type", "width", "height"}
                }
            )
            connection.execute(
                """
                INSERT INTO generation_log_outputs(
                    log_id, output_index, media_ref, media_kind,
                    width, height, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    log_id,
                    index,
                    media_ref,
                    str(item.get("kind") or item.get("type") or "image"),
                    max(0, int(item.get("width") or 0)),
                    max(0, int(item.get("height") or 0)),
                    _json(metadata),
                ),
            )
        return CanvasCommit(
            canvas_id=str(row["canvas_id"]),
            operation_id=intent.operation_id,
            revision=int(row["revision"]),
            changed=False,
            log_id=log_id,
        )

    def move_project_canvases(
        self,
        source_project_id: str,
        destination_project_id: str,
        actor: Mapping[str, Any] | None,
    ) -> int:
        source_project_id = str(source_project_id or "").strip()
        destination_project_id = str(destination_project_id or "").strip()
        if not source_project_id or not destination_project_id:
            raise CanvasStoreError("invalid_project", "项目 ID 无效")
        if (
            not actor
            or actor.get("status", "active") != "active"
            or actor.get("role") != "admin"
        ):
            raise CanvasStoreError("forbidden", "仅管理员可以删除项目")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                rows = connection.execute(
                    """
                    SELECT owner_id, owner_username, visibility, project_id
                    FROM canvases
                    WHERE project_id = ?
                    """,
                    (source_project_id,),
                ).fetchall()
                for row in rows:
                    if not can_access_canvas(
                        dict(actor),
                        {
                            "owner_id": row["owner_id"],
                            "owner_username": row["owner_username"],
                            "visibility": row["visibility"],
                            "project": row["project_id"],
                        },
                        write=True,
                    ):
                        raise CanvasStoreError(
                            "forbidden",
                            "项目中包含当前账号不可访问的私有画布",
                        )
                cursor = connection.execute(
                    """
                    UPDATE canvases
                    SET project_id = ?
                    WHERE project_id = ?
                    """,
                    (destination_project_id, source_project_id),
                )
                connection.commit()
                return max(0, int(cursor.rowcount))
            except Exception:
                connection.rollback()
                raise

    def reassign_owned_canvases(
        self,
        target_owner_id: str,
        actor: Mapping[str, Any] | None,
    ) -> int:
        target_owner_id = str(target_owner_id or "").strip()
        actor_id = str((actor or {}).get("id") or "").strip()
        actor_username = str((actor or {}).get("username") or "").strip()
        if not target_owner_id or not actor_id or not actor_username:
            raise CanvasStoreError(
                "invalid_owner_transfer",
                "无法确认账号或接管管理员",
            )
        if (
            actor.get("status", "active") != "active"
            or actor.get("role") != "admin"
        ):
            raise CanvasStoreError("forbidden", "仅管理员可以接管画布")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                cursor = connection.execute(
                    """
                    UPDATE canvases
                    SET owner_id = ?, owner_username = ?
                    WHERE owner_id = ?
                    """,
                    (
                        actor_id,
                        actor_username,
                        target_owner_id,
                    ),
                )
                connection.commit()
                return max(0, int(cursor.rowcount))
            except Exception:
                connection.rollback()
                raise

    def commit(
        self,
        canvas_id: str,
        actor: Mapping[str, Any] | None,
        intent: CanvasIntent,
    ) -> CanvasCommit:
        commit_started_ns = time.perf_counter_ns()
        mutation_timing: Dict[str, Any] | None = None
        canvas_id = str(canvas_id or "").strip()
        operation_id = self._validate_operation_id(intent.operation_id)
        if operation_id != intent.operation_id:
            intent = CanvasIntent(intent.kind, operation_id, intent.payload)
        intent_hash = _digest(
            {"kind": intent.kind.value, "payload": intent.payload}
        )
        mutation_route: tuple[str, str] | None = None
        if intent.kind == CanvasIntentKind.CANVAS_MUTATION:
            route_operation = intent.payload.get("operation")
            mutation_route = (
                _single_node_position_target(route_operation)
                if isinstance(route_operation, Mapping)
                else ("", "invalid_operation")
            )
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = None
                if intent.kind in {
                    CanvasIntentKind.IMPORT_CANVAS,
                    CanvasIntentKind.CREATE_CANVAS,
                }:
                    row = connection.execute(
                        "SELECT * FROM canvases WHERE canvas_id = ?",
                        (canvas_id,),
                    ).fetchone()
                    if row is not None:
                        self._require_actor(row, actor)
                else:
                    row = self._canvas_row(connection, canvas_id)
                    self._require_actor(
                        row,
                        actor,
                        include_deleted=intent.kind
                        in {
                            CanvasIntentKind.TRASH_CANVAS,
                            CanvasIntentKind.RESTORE_CANVAS,
                            CanvasIntentKind.PURGE_CANVAS,
                        },
                    )
                try:
                    duplicate = self._existing_receipt(
                        connection,
                        canvas_id=canvas_id,
                        operation_id=operation_id,
                        intent_hash=intent_hash,
                        actor_id=str((actor or {}).get("id") or ""),
                    )
                except CanvasStoreError as exc:
                    if exc.code != "operation_collision" or row is None:
                        raise
                    completed_log = self._complete_split_generation_log(
                        connection,
                        row,
                        actor,
                        intent,
                        intent_hash,
                    )
                    if completed_log is None:
                        raise
                    connection.commit()
                    return completed_log
                if duplicate is not None:
                    connection.commit()
                    return duplicate
                if intent.kind in {
                    CanvasIntentKind.IMPORT_CANVAS,
                    CanvasIntentKind.CREATE_CANVAS,
                }:
                    result = self._import_canvas(
                        connection,
                        canvas_id,
                        actor,
                        intent,
                    )
                else:
                    assert row is not None
                    if intent.kind == CanvasIntentKind.CANVAS_MUTATION:
                        mutation_timing = {}
                        assert mutation_route is not None
                        result = self._commit_mutation(
                            connection,
                            row,
                            actor,
                            intent,
                            route=mutation_route,
                            timing=mutation_timing,
                        )
                    elif (
                        intent.kind
                        == CanvasIntentKind.GENERATION_OUTPUT_COMMIT
                    ):
                        result = self._commit_generation_output(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.APPEND_FINAL_LOG:
                        result = self._append_final_log(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.TRASH_CANVAS:
                        result = self._set_deleted_state(
                            connection,
                            row,
                            actor,
                            intent,
                            deleted=True,
                        )
                    elif intent.kind == CanvasIntentKind.RESTORE_CANVAS:
                        result = self._set_deleted_state(
                            connection,
                            row,
                            actor,
                            intent,
                            deleted=False,
                        )
                    elif intent.kind == CanvasIntentKind.PURGE_CANVAS:
                        result = self._purge_canvas(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.UPDATE_METADATA:
                        result = self._update_metadata(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.SET_VISIBILITY:
                        result = self._set_visibility(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.TOUCH_CANVAS:
                        result = self._touch_canvas(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.SAVE_SNAPSHOT:
                        result = self._save_snapshot(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.UPDATE_PROMPT_TEMPLATES:
                        result = self._update_prompt_templates(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    elif intent.kind == CanvasIntentKind.COMMIT_PROMPT:
                        result = self._commit_prompt(
                            connection,
                            row,
                            actor,
                            intent,
                        )
                    else:  # pragma: no cover - closed enum guard
                        raise CanvasStoreError(
                            "unsupported_intent",
                            f"不支持的 Canvas intent: {intent.kind}",
                        )
                if intent.kind not in {
                    CanvasIntentKind.PURGE_CANVAS,
                    CanvasIntentKind.TOUCH_CANVAS,
                }:
                    receipt_started_ns = time.perf_counter_ns()
                    self._save_receipt(
                        connection,
                        intent,
                        intent_hash,
                        result,
                        str((actor or {}).get("id") or ""),
                    )
                    if mutation_timing is not None:
                        mutation_timing["receipt_ms"] = (
                            time.perf_counter_ns() - receipt_started_ns
                        ) / 1_000_000
                transaction_commit_started_ns = time.perf_counter_ns()
                connection.commit()
                if mutation_timing is not None:
                    mutation_timing["transaction_commit_ms"] = (
                        time.perf_counter_ns()
                        - transaction_commit_started_ns
                    ) / 1_000_000
                    mutation_timing["total_ms"] = (
                        time.perf_counter_ns() - commit_started_ns
                    ) / 1_000_000
                    mutation_timing["outcome"] = "committed"
                    LOGGER.debug(
                        "canvas_mutation_timing %s",
                        _json(mutation_timing),
                    )
                return result
            except sqlite3.IntegrityError as exc:
                connection.rollback()
                if mutation_timing is not None:
                    mutation_timing["total_ms"] = (
                        time.perf_counter_ns() - commit_started_ns
                    ) / 1_000_000
                    mutation_timing["outcome"] = "constraint_violation"
                    LOGGER.debug(
                        "canvas_mutation_timing %s",
                        _json(mutation_timing),
                    )
                raise CanvasStoreError(
                    "constraint_violation",
                    "Canvas 数据约束冲突",
                ) from exc
            except Exception as exc:
                connection.rollback()
                if mutation_timing is not None:
                    mutation_timing["total_ms"] = (
                        time.perf_counter_ns() - commit_started_ns
                    ) / 1_000_000
                    mutation_timing["outcome"] = (
                        exc.code
                        if isinstance(exc, CanvasStoreError)
                        else "error"
                    )
                    LOGGER.debug(
                        "canvas_mutation_timing %s",
                        _json(mutation_timing),
                    )
                raise

    def list_items(
        self,
        actor: Mapping[str, Any] | None,
    ) -> tuple[Dict[str, Any], ...]:
        with self._connect() as connection:
            items: list[Dict[str, Any]] = []
            for row in connection.execute(
                """
                SELECT * FROM canvases
                ORDER BY canvas_id
                """
            ):
                try:
                    self._require_actor(row, actor, include_deleted=True)
                except CanvasStoreError as exc:
                    if exc.code == "not_found":
                        continue
                    raise
                items.append(self._list_item(connection, row))
            return tuple(items)

    def read_shared(self, grant: CanvasShareGrant) -> CanvasRead:
        if (
            str(grant.workspace_id or "") != self.workspace_id
            or not str(grant.canvas_id or "")
            or not str(grant.token_hash or "")
        ):
            raise CanvasStoreError("not_found", "分享链接不存在或已失效")
        with self._connect() as connection:
            row = self._canvas_row(connection, grant.canvas_id)
            if int(row["deleted_at"] or 0) or str(row["visibility"]) != "shared":
                raise CanvasStoreError("not_found", "分享链接不存在或已失效")
            return CanvasRead(canvas=self._full_canvas(connection, row))

    def read(
        self,
        canvas_id: str,
        actor: Mapping[str, Any] | None,
        projection: CanvasProjection,
    ) -> CanvasRead:
        with self._connect() as connection:
            row = self._canvas_row(connection, canvas_id)
            self._require_actor(
                row,
                actor,
                include_deleted=(
                    projection.kind
                    == CanvasProjectionKind.MIGRATION_VERIFICATION
                ),
            )
            if projection.kind == CanvasProjectionKind.LIST_ITEM:
                return CanvasRead(canvas=self._list_item(connection, row))
            if projection.kind in {
                CanvasProjectionKind.PUBLIC_SNAPSHOT,
                CanvasProjectionKind.MIGRATION_VERIFICATION,
            }:
                return CanvasRead(canvas=self._full_canvas(connection, row))
            if projection.kind == CanvasProjectionKind.LOG_DETAIL:
                log_row = connection.execute(
                    """
                    SELECT * FROM canvas_logs
                    WHERE canvas_id = ? AND log_id = ?
                    """,
                    (canvas_id, projection.log_id),
                ).fetchone()
                if log_row is None:
                    raise CanvasStoreError("log_not_found", "生成日志不存在")
                return CanvasRead(log=self._log_detail(connection, log_row))
            if projection.kind == CanvasProjectionKind.LOG_PAGE:
                clauses = ["canvas_id = ?"]
                values: list[Any] = [canvas_id]
                if projection.node_id:
                    clauses.append("node_id = ?")
                    values.append(projection.node_id)
                cursor = _cursor_decode(projection.cursor)
                if cursor is not None:
                    clauses.append("(created_at < ? OR (created_at = ? AND log_id < ?))")
                    values.extend([cursor[0], cursor[0], cursor[1]])
                limit = max(1, min(MAX_LOG_PAGE_SIZE, int(projection.limit)))
                values.append(limit + 1)
                rows = connection.execute(
                    f"""
                    SELECT * FROM canvas_logs
                    WHERE {' AND '.join(clauses)}
                    ORDER BY created_at DESC, log_id DESC
                    LIMIT ?
                    """,
                    values,
                ).fetchall()
                page = rows[:limit]
                next_cursor = ""
                if len(rows) > limit and page:
                    last = page[-1]
                    next_cursor = _cursor_encode(
                        int(last["created_at"]),
                        str(last["log_id"]),
                    )
                return CanvasRead(
                    logs=tuple(
                        self._log_detail(connection, item)
                        if projection.include_details
                        else self._log_summary(item)
                        for item in page
                    ),
                    next_cursor=next_cursor,
                )
            if projection.kind == CanvasProjectionKind.FULL_EXPORT:
                canvas = self._full_canvas(connection, row)
                canvas["logs"] = [
                    self._log_detail(connection, item)
                    for item in connection.execute(
                        """
                        SELECT * FROM canvas_logs
                        WHERE canvas_id = ?
                        ORDER BY created_at DESC, log_id DESC
                        """,
                        (canvas_id,),
                    )
                ]
                return CanvasRead(canvas=canvas)
        raise CanvasStoreError("unsupported_projection", "不支持的 Canvas projection")

    def integrity(self) -> Dict[str, Any]:
        with self._connect() as connection:
            integrity_rows = [
                str(row[0])
                for row in connection.execute("PRAGMA integrity_check")
            ]
            foreign_keys = [
                tuple(row)
                for row in connection.execute("PRAGMA foreign_key_check")
            ]
            journal_mode = str(
                connection.execute("PRAGMA journal_mode").fetchone()[0]
            ).lower()
            counts = {
                "canvases": int(
                    connection.execute("SELECT COUNT(*) FROM canvases").fetchone()[0]
                ),
                "logs": int(
                    connection.execute("SELECT COUNT(*) FROM canvas_logs").fetchone()[0]
                ),
                "log_payloads": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_log_payloads"
                    ).fetchone()[0]
                ),
                "mutations": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM canvas_mutations"
                    ).fetchone()[0]
                ),
                "events": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM canvas_events"
                    ).fetchone()[0]
                ),
                "generation_effects": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM applied_generation_effects"
                    ).fetchone()[0]
                ),
            }
        return {
            "ok": integrity_rows == ["ok"] and not foreign_keys,
            "integrity": integrity_rows,
            "foreign_keys": foreign_keys,
            "journal_mode": journal_mode,
            "schema_version": SCHEMA_VERSION,
            "counts": counts,
        }


__all__ = [
    "CanvasCommit",
    "CanvasIntent",
    "CanvasIntentKind",
    "CanvasProjection",
    "CanvasProjectionKind",
    "CanvasRead",
    "CanvasShareGrant",
    "CanvasStore",
    "CanvasStoreError",
    "SqliteCanvasStore",
    "apply_prompt_template_intent",
    "prompt_template_item_version",
]
