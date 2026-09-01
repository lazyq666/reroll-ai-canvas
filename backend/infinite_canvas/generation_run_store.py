"""Durable unfinished Generation Runs and their effect outbox.

The adapter in this module is deliberately not installed in ``main`` yet.
Its methods perform blocking SQLite I/O and must be called through the
GenerationRunStore bounded executor when the JSON/JSON authority cutover is
implemented.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterator, Mapping, Protocol


SCHEMA_VERSION = 2
TERMINAL_RUN_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "discarded"}
)


class GenerationRunStoreError(RuntimeError):
    """Stable persistence failure with a machine-readable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = str(code)
        self.message = str(message)


class EffectResolution(str, Enum):
    APPLIED = "applied"
    DISCARDED = "discarded"
    RETRY = "retry"


@dataclass(frozen=True)
class GenerationRunAttempt:
    attempt_index: int
    status: str
    provider_id: str = ""
    remote_ref: str = ""
    payload: Mapping[str, Any] = field(default_factory=dict)
    provider_output: Mapping[str, Any] | None = None
    error: str = ""
    updated_at: float = 0.0


@dataclass(frozen=True)
class GenerationRunState:
    run_id: str
    kind: str
    status: str
    phase: str
    owner: str
    key: str
    request_hash: str
    provider_id: str
    created_at: float
    updated_at: float
    request: Mapping[str, Any] = field(default_factory=dict)
    effect_context: Mapping[str, Any] = field(default_factory=dict)
    target: Mapping[str, Any] | None = None
    public_metadata: Mapping[str, Any] = field(default_factory=dict)
    error: str = ""
    status_code: int = 0
    recoverable: bool = False
    attempts: tuple[GenerationRunAttempt, ...] = ()
    remote_refs: tuple[tuple[str, str], ...] = ()
    provider_output: Mapping[str, Any] | None = None
    prepared_output: Mapping[str, Any] | None = None
    result: Any = None


@dataclass(frozen=True)
class GenerationRunEffect:
    effect_id: str
    run_id: str
    canvas_id: str
    payload: Mapping[str, Any]
    created_at: float
    terminal_status: str = "succeeded"


@dataclass(frozen=True)
class GenerationEffectClaim:
    effect_id: str
    run_id: str
    owner: str
    canvas_id: str
    payload: Mapping[str, Any]
    lease_token: str
    lease_owner: str
    lease_expires_at: float
    attempt_count: int


@dataclass(frozen=True)
class GenerationHistoryPage:
    items: tuple[Mapping[str, Any], ...]
    next_cursor: str = ""


@dataclass(frozen=True)
class GenerationPublicationClaim:
    effect_id: str
    run_id: str
    effect_kind: str
    payload: Mapping[str, Any]
    lease_token: str
    lease_owner: str
    lease_expires_at: float
    attempt_count: int


@dataclass(frozen=True)
class LegacyGenerationPublicationSnapshot:
    """One read-only projection that an older JSON runtime can consume."""

    history: tuple[Mapping[str, Any], ...]
    completed: Mapping[str, tuple[str, ...]]
    pending: Mapping[str, tuple[str, ...]]


class GenerationRunStore(Protocol):
    """Blocking persistence interface used by lifecycle callers and tests."""

    def save(
        self,
        run: GenerationRunState,
        *,
        effect: GenerationRunEffect | None = None,
    ) -> None: ...

    def load(self, run_id: str) -> GenerationRunState | None: ...

    def load_unfinished(
        self,
        *,
        limit: int = 1000,
    ) -> tuple[GenerationRunState, ...]: ...

    def claim_effect(
        self,
        worker_id: str,
        *,
        lease_seconds: float,
    ) -> GenerationEffectClaim | None: ...

    def settle_effect(
        self,
        claim: GenerationEffectClaim,
        resolution: EffectResolution,
        *,
        detail: str = "",
        retry_delay_seconds: float = 0,
    ) -> bool: ...

    def integrity(self) -> Dict[str, Any]: ...


class GenerationPublicationStore(Protocol):
    """Blocking Global History and publication-receipt interface."""

    def publish_history(
        self,
        run_id: str,
        history_id: str,
        record: Mapping[str, Any],
        *,
        source: str = "runtime",
    ) -> str: ...

    def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> GenerationHistoryPage: ...

    def history_by_id(self, history_id: str) -> Mapping[str, Any] | None: ...

    def delete_history(
        self,
        *,
        history_id: str = "",
        timestamp: float | None = None,
    ) -> tuple[Mapping[str, Any], ...]: ...

    def seed_publication_receipt(
        self,
        run_id: str,
        effect_kind: str,
        *,
        completed: bool,
        payload: Mapping[str, Any] | None = None,
        created_at: float = 0,
    ) -> None: ...

    def claim_publication(
        self,
        worker_id: str,
        *,
        lease_seconds: float,
        run_id: str = "",
        effect_kind: str = "",
        payload: Mapping[str, Any] | None = None,
    ) -> GenerationPublicationClaim | None: ...

    def settle_publication(
        self,
        claim: GenerationPublicationClaim,
        *,
        completed: bool,
        detail: str = "",
        retry_delay_seconds: float = 0,
    ) -> bool: ...

    def legacy_publication_snapshot(
        self,
    ) -> LegacyGenerationPublicationSnapshot: ...


def _json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _decode(value: str | None, default: Any) -> Any:
    if value is None:
        return copy.deepcopy(default)
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return copy.deepcopy(default)


def _digest(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _history_media_type(record: Mapping[str, Any]) -> str:
    return str(record.get("type") or "zimage").strip() or "zimage"


def _history_provider(record: Mapping[str, Any]) -> str:
    params = record.get("params")
    params = params if isinstance(params, Mapping) else {}
    return str(
        record.get("provider_id")
        or record.get("provider")
        or params.get("provider_id")
        or ""
    ).strip()


def _history_model(record: Mapping[str, Any]) -> str:
    params = record.get("params")
    params = params if isinstance(params, Mapping) else {}
    return str(record.get("model") or params.get("model") or "").strip()


def _history_output_urls(record: Mapping[str, Any]) -> tuple[str, ...]:
    values: list[Any] = []
    for key in (
        "images",
        "videos",
        "audios",
        "files",
        "texts",
        "outputs",
        "urls",
        "items",
        "image_items",
    ):
        current = record.get(key)
        if isinstance(current, list):
            values.extend(current)
    if record.get("url"):
        values.append(record.get("url"))
    urls: list[str] = []
    for value in values:
        if isinstance(value, Mapping):
            value = (
                value.get("url")
                or value.get("path")
                or value.get("src")
                or value.get("uri")
            )
        normalized = str(value or "").strip()
        if normalized and normalized not in urls:
            urls.append(normalized)
    return tuple(urls)


def _encode_history_cursor(created_at: float, sequence: int) -> str:
    payload = json.dumps(
        [float(created_at), int(sequence)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_history_cursor(cursor: str) -> tuple[float, int] | None:
    value = str(cursor or "").strip()
    if not value:
        return None
    try:
        padding = "=" * (-len(value) % 4)
        decoded = json.loads(
            base64.urlsafe_b64decode(value + padding).decode("utf-8")
        )
        if not isinstance(decoded, list) or len(decoded) != 2:
            raise ValueError
        return float(decoded[0]), int(decoded[1])
    except (TypeError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise GenerationRunStoreError(
            "invalid_history_cursor", "Generation History cursor is invalid"
        ) from exc


def _contains_inline_media(value: Any) -> bool:
    if isinstance(value, str):
        return value.lower().startswith("data:") and "," in value[:512]
    if isinstance(value, Mapping):
        return any(_contains_inline_media(item) for item in value.values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_inline_media(item) for item in value)
    return False


class SqliteGenerationRunStore:
    """SQLite/WAL adapter for one Workspace's unfinished Generation Runs."""

    def __init__(
        self,
        database_path: Path | str,
        *,
        workspace_id: str,
        now: Any = None,
    ) -> None:
        self.database_path = Path(database_path)
        self.workspace_id = str(workspace_id or "").strip()
        if not self.workspace_id:
            raise ValueError("workspace_id must not be empty")
        self._now = now or time.time
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.database_path), timeout=5)
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
                CREATE TABLE IF NOT EXISTS generation_run_store_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS generation_runs (
                    run_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    error TEXT NOT NULL,
                    status_code INTEGER NOT NULL,
                    recoverable INTEGER NOT NULL CHECK (recoverable IN (0, 1))
                );

                CREATE UNIQUE INDEX IF NOT EXISTS generation_runs_owner_key
                ON generation_runs(owner_id, idempotency_key)
                WHERE idempotency_key <> '';

                CREATE TABLE IF NOT EXISTS generation_run_payloads (
                    run_id TEXT PRIMARY KEY REFERENCES generation_runs(run_id)
                        ON DELETE CASCADE,
                    request_json TEXT NOT NULL,
                    effect_context_json TEXT NOT NULL,
                    target_json TEXT,
                    public_metadata_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS generation_run_attempts (
                    run_id TEXT NOT NULL REFERENCES generation_runs(run_id)
                        ON DELETE CASCADE,
                    attempt_index INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    remote_ref TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    provider_output_json TEXT,
                    error TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (run_id, attempt_index)
                );

                CREATE TABLE IF NOT EXISTS generation_run_remote_refs (
                    run_id TEXT NOT NULL REFERENCES generation_runs(run_id)
                        ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    provider_id TEXT NOT NULL,
                    remote_ref TEXT NOT NULL,
                    PRIMARY KEY (run_id, position),
                    UNIQUE (run_id, provider_id, remote_ref)
                );

                CREATE INDEX IF NOT EXISTS generation_remote_ref_lookup
                ON generation_run_remote_refs(provider_id, remote_ref);

                CREATE TABLE IF NOT EXISTS generation_run_outputs (
                    run_id TEXT PRIMARY KEY REFERENCES generation_runs(run_id)
                        ON DELETE CASCADE,
                    provider_output_json TEXT,
                    prepared_output_json TEXT,
                    result_json TEXT,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS generation_effect_outbox (
                    effect_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(run_id)
                        ON DELETE CASCADE,
                    canvas_id TEXT NOT NULL,
                    terminal_status TEXT NOT NULL,
                    state TEXT NOT NULL
                        CHECK (state IN ('pending', 'claimed', 'completed')),
                    outcome TEXT NOT NULL
                        CHECK (outcome IN ('', 'applied', 'discarded')),
                    payload_json TEXT,
                    payload_digest TEXT NOT NULL,
                    available_at REAL NOT NULL,
                    lease_token TEXT NOT NULL,
                    lease_owner TEXT NOT NULL,
                    lease_expires_at REAL NOT NULL
                        CHECK (lease_expires_at >= 0),
                    attempt_count INTEGER NOT NULL
                        CHECK (attempt_count >= 0),
                    last_error TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    completed_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS generation_history (
                    history_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    history_id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    output_url TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    source TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS generation_history_run
                ON generation_history(run_id) WHERE run_id <> '';

                CREATE INDEX IF NOT EXISTS generation_history_page
                ON generation_history(created_at DESC, history_sequence DESC);

                CREATE INDEX IF NOT EXISTS generation_history_type_page
                ON generation_history(
                    media_type, created_at DESC, history_sequence DESC
                );

                CREATE TABLE IF NOT EXISTS generation_publication_receipts (
                    effect_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    effect_kind TEXT NOT NULL
                        CHECK (effect_kind IN ('history', 'notification')),
                    state TEXT NOT NULL
                        CHECK (state IN ('pending', 'claimed', 'completed')),
                    payload_json TEXT,
                    payload_digest TEXT NOT NULL,
                    available_at REAL NOT NULL,
                    lease_token TEXT NOT NULL,
                    lease_owner TEXT NOT NULL,
                    lease_expires_at REAL NOT NULL
                        CHECK (lease_expires_at >= 0),
                    attempt_count INTEGER NOT NULL
                        CHECK (attempt_count >= 0),
                    last_error TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    completed_at REAL NOT NULL,
                    UNIQUE (run_id, effect_kind)
                );

                CREATE INDEX IF NOT EXISTS generation_publication_pending
                ON generation_publication_receipts(
                    state, available_at, created_at, effect_id
                );
                """
            )
            metadata = {
                str(row["key"]): str(row["value"])
                for row in connection.execute(
                    "SELECT key, value FROM generation_run_store_metadata"
                )
            }
            if metadata:
                schema_version = metadata.get("schema_version")
                if schema_version not in {"1", str(SCHEMA_VERSION)}:
                    raise GenerationRunStoreError(
                        "unsupported_schema",
                        "GenerationRunStore schema version is not supported",
                    )
                if metadata.get("workspace_id") != self.workspace_id:
                    raise GenerationRunStoreError(
                        "workspace_mismatch",
                        "GenerationRunStore belongs to another Workspace",
                    )
                if schema_version == "1":
                    connection.execute(
                        """
                        UPDATE generation_run_store_metadata
                        SET value = ? WHERE key = 'schema_version'
                        """,
                        (str(SCHEMA_VERSION),),
                    )
            else:
                connection.executemany(
                    """
                    INSERT INTO generation_run_store_metadata(key, value)
                    VALUES (?, ?)
                    """,
                    (
                        ("schema_version", str(SCHEMA_VERSION)),
                        ("workspace_id", self.workspace_id),
                    ),
                )
            connection.commit()

    def save(
        self,
        run: GenerationRunState,
        *,
        effect: GenerationRunEffect | None = None,
    ) -> None:
        if not str(run.run_id or "").strip():
            raise GenerationRunStoreError("invalid_run_id", "run_id must not be empty")
        if effect is not None:
            if not str(effect.effect_id or "").strip():
                raise GenerationRunStoreError(
                    "invalid_effect_id", "effect_id must not be empty"
                )
            if effect.run_id != run.run_id:
                raise GenerationRunStoreError(
                    "effect_run_mismatch", "effect must belong to the saved run"
                )
            if effect.terminal_status not in TERMINAL_RUN_STATUSES:
                raise GenerationRunStoreError(
                    "invalid_terminal_status",
                    "effect terminal_status must be a terminal Generation Run status",
                )
        persisted_values = (
            run.request,
            run.effect_context,
            run.target,
            run.public_metadata,
            run.provider_output,
            run.prepared_output,
            run.result,
            *(attempt.payload for attempt in run.attempts),
            *(attempt.provider_output for attempt in run.attempts),
            effect.payload if effect is not None else None,
        )
        if any(_contains_inline_media(value) for value in persisted_values):
            raise GenerationRunStoreError(
                "inline_media_not_materialized",
                "media data URLs must be materialized before persistence",
            )
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                finalized = connection.execute(
                    """
                    SELECT 1 FROM generation_effect_outbox
                    WHERE run_id = ? AND state = 'completed'
                    """,
                    (run.run_id,),
                ).fetchone()
                if finalized is not None:
                    raise GenerationRunStoreError(
                        "run_finalized",
                        "completed Generation Run details cannot be restored",
                    )
                connection.execute(
                    """
                    INSERT INTO generation_runs(
                        run_id, kind, status, phase, owner_id, idempotency_key,
                        request_hash, provider_id, created_at, updated_at, error,
                        status_code, recoverable
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(run_id) DO UPDATE SET
                        kind = excluded.kind,
                        status = excluded.status,
                        phase = excluded.phase,
                        owner_id = excluded.owner_id,
                        idempotency_key = excluded.idempotency_key,
                        request_hash = excluded.request_hash,
                        provider_id = excluded.provider_id,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at,
                        error = excluded.error,
                        status_code = excluded.status_code,
                        recoverable = excluded.recoverable
                    """,
                    (
                        run.run_id,
                        run.kind,
                        run.status,
                        run.phase,
                        run.owner,
                        run.key,
                        run.request_hash,
                        run.provider_id,
                        float(run.created_at),
                        float(run.updated_at),
                        run.error,
                        int(run.status_code),
                        int(bool(run.recoverable)),
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO generation_run_payloads(
                        run_id, request_json, effect_context_json, target_json,
                        public_metadata_json
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(run_id) DO UPDATE SET
                        request_json = excluded.request_json,
                        effect_context_json = excluded.effect_context_json,
                        target_json = excluded.target_json,
                        public_metadata_json = excluded.public_metadata_json
                    """,
                    (
                        run.run_id,
                        _json(run.request),
                        _json(run.effect_context),
                        _json(run.target) if run.target is not None else None,
                        _json(run.public_metadata),
                    ),
                )
                connection.execute(
                    "DELETE FROM generation_run_attempts WHERE run_id = ?",
                    (run.run_id,),
                )
                connection.executemany(
                    """
                    INSERT INTO generation_run_attempts(
                        run_id, attempt_index, status, provider_id, remote_ref,
                        payload_json, provider_output_json, error, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        (
                            run.run_id,
                            int(attempt.attempt_index),
                            attempt.status,
                            attempt.provider_id,
                            attempt.remote_ref,
                            _json(attempt.payload),
                            (
                                _json(attempt.provider_output)
                                if attempt.provider_output is not None
                                else None
                            ),
                            attempt.error,
                            float(attempt.updated_at),
                        )
                        for attempt in run.attempts
                    ),
                )
                connection.execute(
                    "DELETE FROM generation_run_remote_refs WHERE run_id = ?",
                    (run.run_id,),
                )
                connection.executemany(
                    """
                    INSERT INTO generation_run_remote_refs(
                        run_id, position, provider_id, remote_ref
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        (run.run_id, position, provider_id, remote_ref)
                        for position, (provider_id, remote_ref) in enumerate(
                            run.remote_refs
                        )
                    ),
                )
                if any(
                    value is not None
                    for value in (
                        run.provider_output,
                        run.prepared_output,
                        run.result,
                    )
                ):
                    connection.execute(
                        """
                        INSERT INTO generation_run_outputs(
                            run_id, provider_output_json, prepared_output_json,
                            result_json, updated_at
                        ) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(run_id) DO UPDATE SET
                            provider_output_json = excluded.provider_output_json,
                            prepared_output_json = excluded.prepared_output_json,
                            result_json = excluded.result_json,
                            updated_at = excluded.updated_at
                        """,
                        (
                            run.run_id,
                            (
                                _json(run.provider_output)
                                if run.provider_output is not None
                                else None
                            ),
                            (
                                _json(run.prepared_output)
                                if run.prepared_output is not None
                                else None
                            ),
                            _json(run.result) if run.result is not None else None,
                            float(run.updated_at),
                        ),
                    )
                else:
                    connection.execute(
                        "DELETE FROM generation_run_outputs WHERE run_id = ?",
                        (run.run_id,),
                    )
                if effect is not None:
                    payload_json = _json(effect.payload)
                    payload_digest = _digest(effect.payload)
                    existing = connection.execute(
                        """
                        SELECT run_id, canvas_id, terminal_status, payload_digest
                        FROM generation_effect_outbox WHERE effect_id = ?
                        """,
                        (effect.effect_id,),
                    ).fetchone()
                    if existing is not None:
                        if (
                            str(existing["run_id"]) != effect.run_id
                            or str(existing["canvas_id"]) != effect.canvas_id
                            or str(existing["terminal_status"])
                            != effect.terminal_status
                            or str(existing["payload_digest"]) != payload_digest
                        ):
                            raise GenerationRunStoreError(
                                "effect_collision",
                                "effect_id already identifies different work",
                            )
                    else:
                        try:
                            connection.execute(
                                """
                                INSERT INTO generation_effect_outbox(
                                    effect_id, run_id, canvas_id, terminal_status,
                                    state, outcome, payload_json, payload_digest,
                                    available_at, lease_token, lease_owner,
                                    lease_expires_at, attempt_count, last_error,
                                    created_at, updated_at, completed_at
                                ) VALUES (?, ?, ?, ?, 'pending', '', ?, ?, ?, '', '',
                                          0, 0, '', ?, ?, 0)
                                """,
                                (
                                    effect.effect_id,
                                    effect.run_id,
                                    effect.canvas_id,
                                    effect.terminal_status,
                                    payload_json,
                                    payload_digest,
                                    float(effect.created_at),
                                    float(effect.created_at),
                                    float(effect.created_at),
                                ),
                            )
                        except sqlite3.IntegrityError as exc:
                            raise GenerationRunStoreError(
                                "effect_collision",
                                "run already has a different stable effect",
                            ) from exc

    def load(self, run_id: str) -> GenerationRunState | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT runs.*, payloads.request_json,
                       payloads.effect_context_json, payloads.target_json,
                       payloads.public_metadata_json,
                       outputs.provider_output_json,
                       outputs.prepared_output_json, outputs.result_json
                FROM generation_runs AS runs
                LEFT JOIN generation_run_payloads AS payloads
                    ON payloads.run_id = runs.run_id
                LEFT JOIN generation_run_outputs AS outputs
                    ON outputs.run_id = runs.run_id
                WHERE runs.run_id = ?
                """,
                (str(run_id or ""),),
            ).fetchone()
            if row is None:
                return None
            attempts = tuple(
                GenerationRunAttempt(
                    attempt_index=int(item["attempt_index"]),
                    status=str(item["status"]),
                    provider_id=str(item["provider_id"]),
                    remote_ref=str(item["remote_ref"]),
                    payload=_decode(item["payload_json"], {}),
                    provider_output=(
                        _decode(item["provider_output_json"], {})
                        if item["provider_output_json"] is not None
                        else None
                    ),
                    error=str(item["error"]),
                    updated_at=float(item["updated_at"]),
                )
                for item in connection.execute(
                    """
                    SELECT * FROM generation_run_attempts
                    WHERE run_id = ? ORDER BY attempt_index
                    """,
                    (str(run_id or ""),),
                )
            )
            remote_refs = tuple(
                (str(item["provider_id"]), str(item["remote_ref"]))
                for item in connection.execute(
                    """
                    SELECT provider_id, remote_ref
                    FROM generation_run_remote_refs
                    WHERE run_id = ? ORDER BY position
                    """,
                    (str(run_id or ""),),
                )
            )
        return GenerationRunState(
            run_id=str(row["run_id"]),
            kind=str(row["kind"]),
            status=str(row["status"]),
            phase=str(row["phase"]),
            owner=str(row["owner_id"]),
            key=str(row["idempotency_key"]),
            request_hash=str(row["request_hash"]),
            provider_id=str(row["provider_id"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
            request=_decode(row["request_json"], {}),
            effect_context=_decode(row["effect_context_json"], {}),
            target=(
                _decode(row["target_json"], {})
                if row["target_json"] is not None
                else None
            ),
            public_metadata=_decode(row["public_metadata_json"], {}),
            error=str(row["error"]),
            status_code=int(row["status_code"]),
            recoverable=bool(row["recoverable"]),
            attempts=attempts,
            remote_refs=remote_refs,
            provider_output=(
                _decode(row["provider_output_json"], {})
                if row["provider_output_json"] is not None
                else None
            ),
            prepared_output=(
                _decode(row["prepared_output_json"], {})
                if row["prepared_output_json"] is not None
                else None
            ),
            result=(
                _decode(row["result_json"], None)
                if row["result_json"] is not None
                else None
            ),
        )

    def load_unfinished(
        self,
        *,
        limit: int = 1000,
    ) -> tuple[GenerationRunState, ...]:
        placeholders = ",".join("?" for _ in TERMINAL_RUN_STATUSES)
        with self._connect() as connection:
            run_ids = [
                str(row["run_id"])
                for row in connection.execute(
                    f"""
                    SELECT runs.run_id FROM generation_runs AS runs
                    WHERE runs.status NOT IN ({placeholders})
                       OR EXISTS (
                            SELECT 1 FROM generation_effect_outbox AS effects
                            WHERE effects.run_id = runs.run_id
                              AND effects.state <> 'completed'
                       )
                       OR EXISTS (
                            SELECT 1
                            FROM generation_publication_receipts AS receipts
                            WHERE receipts.run_id = runs.run_id
                              AND receipts.state <> 'completed'
                       )
                    ORDER BY runs.created_at, runs.run_id LIMIT ?
                    """,
                    (*sorted(TERMINAL_RUN_STATUSES), max(1, int(limit))),
                )
            ]
        return tuple(
            run
            for run_id in run_ids
            for run in (self.load(run_id),)
            if run is not None
        )

    def claim_effect(
        self,
        worker_id: str,
        *,
        lease_seconds: float,
    ) -> GenerationEffectClaim | None:
        owner = str(worker_id or "").strip()
        if not owner:
            raise ValueError("worker_id must not be empty")
        duration = float(lease_seconds)
        if duration <= 0:
            raise ValueError("lease_seconds must be positive")
        now = float(self._now())
        lease_token = uuid.uuid4().hex
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """
                    SELECT effects.*, runs.owner_id
                    FROM generation_effect_outbox AS effects
                    JOIN generation_runs AS runs
                        ON runs.run_id = effects.run_id
                    WHERE (effects.state = 'pending'
                           AND effects.available_at <= ?)
                       OR (effects.state = 'claimed'
                           AND effects.lease_expires_at <= ?)
                    ORDER BY effects.available_at, effects.created_at,
                             effects.effect_id
                    LIMIT 1
                    """,
                    (now, now),
                ).fetchone()
                if row is None:
                    return None
                connection.execute(
                    """
                    UPDATE generation_effect_outbox
                    SET state = 'claimed', lease_token = ?, lease_owner = ?,
                        lease_expires_at = ?, attempt_count = attempt_count + 1,
                        updated_at = ?
                    WHERE effect_id = ?
                    """,
                    (
                        lease_token,
                        owner,
                        now + duration,
                        now,
                        str(row["effect_id"]),
                    ),
                )
                attempt_count = int(row["attempt_count"]) + 1
        return GenerationEffectClaim(
            effect_id=str(row["effect_id"]),
            run_id=str(row["run_id"]),
            owner=str(row["owner_id"]),
            canvas_id=str(row["canvas_id"]),
            payload=_decode(row["payload_json"], {}),
            lease_token=lease_token,
            lease_owner=owner,
            lease_expires_at=now + duration,
            attempt_count=attempt_count,
        )

    def settle_effect(
        self,
        claim: GenerationEffectClaim,
        resolution: EffectResolution,
        *,
        detail: str = "",
        retry_delay_seconds: float = 0,
    ) -> bool:
        try:
            resolution = EffectResolution(resolution)
        except ValueError as exc:
            raise ValueError("invalid effect resolution") from exc
        now = float(self._now())
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute(
                    """
                    SELECT effect_id, terminal_status
                    FROM generation_effect_outbox
                    WHERE effect_id = ? AND state = 'claimed'
                      AND lease_token = ? AND lease_owner = ?
                      AND lease_expires_at > ?
                    """,
                    (
                        claim.effect_id,
                        claim.lease_token,
                        claim.lease_owner,
                        now,
                    ),
                ).fetchone()
                if current is None:
                    return False
                if resolution is EffectResolution.RETRY:
                    connection.execute(
                        """
                        UPDATE generation_effect_outbox
                        SET state = 'pending', outcome = '',
                            available_at = ?, lease_token = '', lease_owner = '',
                            lease_expires_at = 0, last_error = ?, updated_at = ?
                        WHERE effect_id = ?
                        """,
                        (
                            now + max(0.0, float(retry_delay_seconds)),
                            str(detail or "")[:65536],
                            now,
                            claim.effect_id,
                        ),
                    )
                else:
                    connection.execute(
                        """
                        UPDATE generation_effect_outbox
                        SET state = 'completed', outcome = ?, payload_json = NULL,
                            lease_token = '', lease_owner = '',
                            lease_expires_at = 0, last_error = ?, updated_at = ?,
                            completed_at = ?
                        WHERE effect_id = ?
                        """,
                        (
                            resolution.value,
                            str(detail or "")[:65536],
                            now,
                            now,
                            claim.effect_id,
                        ),
                    )
                    connection.execute(
                        """
                        UPDATE generation_runs
                        SET status = ?, phase = 'finished', updated_at = ?,
                            error = CASE WHEN ? = 'discarded' THEN '' ELSE error END,
                            status_code = CASE
                                WHEN ? = 'discarded' THEN 0 ELSE status_code
                            END,
                            recoverable = 0
                        WHERE run_id = ?
                        """,
                        (
                            (
                                str(current["terminal_status"])
                                if resolution is EffectResolution.APPLIED
                                else "discarded"
                            ),
                            now,
                            resolution.value,
                            resolution.value,
                            claim.run_id,
                        ),
                    )
                    for table in (
                        "generation_run_payloads",
                        "generation_run_attempts",
                        "generation_run_remote_refs",
                        "generation_run_outputs",
                    ):
                        connection.execute(
                            f"DELETE FROM {table} WHERE run_id = ?",
                            (claim.run_id,),
                        )
        return True

    @staticmethod
    def _publication_effect_id(run_id: str, effect_kind: str) -> str:
        return f"generation-run:{run_id}:{effect_kind}"

    def publish_history(
        self,
        run_id: str,
        history_id: str,
        record: Mapping[str, Any],
        *,
        source: str = "runtime",
    ) -> str:
        history_id = str(history_id or "").strip()
        run_id = str(run_id or "").strip()
        if not history_id:
            raise GenerationRunStoreError(
                "invalid_history_id", "history_id must not be empty"
            )
        if not isinstance(record, Mapping):
            raise GenerationRunStoreError(
                "invalid_history_record", "Generation History must be an object"
            )
        if _contains_inline_media(record):
            raise GenerationRunStoreError(
                "inline_media_not_materialized",
                "Generation History media must be materialized before persistence",
            )
        public_record = {
            str(key): copy.deepcopy(value)
            for key, value in record.items()
            if str(key) != "_effect_id"
        }
        public_record.setdefault("history_id", history_id)
        try:
            created_at = float(public_record.get("timestamp") or 0)
        except (TypeError, ValueError):
            created_at = 0.0
        payload_json = _json(public_record)
        payload_digest = _digest(public_record)
        output_urls = _history_output_urls(public_record)
        now = float(self._now())
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    """
                    SELECT history_id, run_id, payload_digest
                    FROM generation_history WHERE history_id = ?
                    """,
                    (history_id,),
                ).fetchone()
                if existing is None and run_id:
                    existing = connection.execute(
                        """
                        SELECT history_id, run_id, payload_digest
                        FROM generation_history WHERE run_id = ?
                        """,
                        (run_id,),
                    ).fetchone()
                if existing is not None:
                    if str(existing["payload_digest"]) != payload_digest:
                        raise GenerationRunStoreError(
                            "history_collision",
                            "Generation History identity already has different content",
                        )
                    history_id = str(existing["history_id"])
                else:
                    connection.execute(
                        """
                        INSERT INTO generation_history(
                            history_id, run_id, media_type, provider_id, model,
                            output_url, created_at, payload_json, payload_digest,
                            source
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            history_id,
                            run_id,
                            _history_media_type(public_record),
                            _history_provider(public_record),
                            _history_model(public_record),
                            output_urls[0] if output_urls else "",
                            created_at,
                            payload_json,
                            payload_digest,
                            str(source or "runtime"),
                        ),
                    )
                if run_id:
                    effect_id = self._publication_effect_id(run_id, "history")
                    receipt = connection.execute(
                        """
                        SELECT effect_kind, state, payload_digest
                        FROM generation_publication_receipts
                        WHERE effect_id = ?
                        """,
                        (effect_id,),
                    ).fetchone()
                    if (
                        receipt is not None
                        and str(receipt["payload_digest"])
                        and str(receipt["payload_digest"]) != payload_digest
                    ):
                        raise GenerationRunStoreError(
                            "publication_collision",
                            "History receipt already identifies different content",
                        )
                    connection.execute(
                        """
                        INSERT INTO generation_publication_receipts(
                            effect_id, run_id, effect_kind, state, payload_json,
                            payload_digest, available_at, lease_token,
                            lease_owner, lease_expires_at, attempt_count,
                            last_error, created_at, updated_at, completed_at
                        ) VALUES (?, ?, 'history', 'completed', NULL, ?, ?, '', '',
                                  0, 0, '', ?, ?, ?)
                        ON CONFLICT(effect_id) DO UPDATE SET
                            state = 'completed', payload_json = NULL,
                            payload_digest = CASE
                                WHEN generation_publication_receipts.payload_digest = ''
                                THEN excluded.payload_digest
                                ELSE generation_publication_receipts.payload_digest
                            END,
                            available_at = excluded.available_at,
                            lease_token = '', lease_owner = '',
                            lease_expires_at = 0, last_error = '',
                            updated_at = excluded.updated_at,
                            completed_at = excluded.completed_at
                        """,
                        (
                            effect_id,
                            run_id,
                            payload_digest,
                            now,
                            now,
                            now,
                            now,
                        ),
                    )
        return history_id

    @staticmethod
    def _history_public_row(row: sqlite3.Row) -> dict[str, Any]:
        value = _decode(row["payload_json"], {})
        value = dict(value) if isinstance(value, Mapping) else {}
        value.setdefault("history_id", str(row["history_id"]))
        return value

    def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> GenerationHistoryPage:
        requested_limit = max(1, min(5000, int(limit)))
        decoded_cursor = _decode_history_cursor(cursor)
        clauses = ["output_url <> ''"]
        parameters: list[Any] = []
        normalized_type = str(media_type or "").strip()
        if normalized_type:
            clauses.append("media_type = ?")
            parameters.append(normalized_type)
        if decoded_cursor is not None:
            clauses.append(
                "(created_at < ? OR (created_at = ? AND history_sequence < ?))"
            )
            parameters.extend(
                [decoded_cursor[0], decoded_cursor[0], decoded_cursor[1]]
            )
        parameters.append(requested_limit + 1)
        with self._connect() as connection:
            rows = list(
                connection.execute(
                    f"""
                    SELECT history_sequence, history_id, payload_json, created_at
                    FROM generation_history
                    WHERE {' AND '.join(clauses)}
                    ORDER BY created_at DESC, history_sequence DESC
                    LIMIT ?
                    """,
                    tuple(parameters),
                )
            )
        has_more = len(rows) > requested_limit
        visible = rows[:requested_limit]
        next_cursor = ""
        if has_more and visible:
            last = visible[-1]
            next_cursor = _encode_history_cursor(
                float(last["created_at"]), int(last["history_sequence"])
            )
        return GenerationHistoryPage(
            items=tuple(self._history_public_row(row) for row in visible),
            next_cursor=next_cursor,
        )

    def history_by_id(self, history_id: str) -> Mapping[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT history_id, payload_json FROM generation_history
                WHERE history_id = ?
                """,
                (str(history_id or "").strip(),),
            ).fetchone()
        return self._history_public_row(row) if row is not None else None

    def delete_history(
        self,
        *,
        history_id: str = "",
        timestamp: float | None = None,
    ) -> tuple[Mapping[str, Any], ...]:
        history_id = str(history_id or "").strip()
        if not history_id and timestamp is None:
            raise GenerationRunStoreError(
                "history_identity_required",
                "history_id or timestamp is required",
            )
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                if history_id:
                    rows = list(
                        connection.execute(
                            """
                            SELECT history_sequence, history_id, payload_json
                            FROM generation_history WHERE history_id = ?
                            """,
                            (history_id,),
                        )
                    )
                else:
                    requested = float(timestamp)
                    rows = list(
                        connection.execute(
                            """
                            SELECT history_sequence, history_id, payload_json
                            FROM generation_history
                            WHERE created_at >= ? AND created_at <= ?
                            ORDER BY history_sequence DESC
                            """,
                            (requested - 0.001, requested + 0.001),
                        )
                    )
                if rows:
                    connection.executemany(
                        "DELETE FROM generation_history WHERE history_sequence = ?",
                        ((int(row["history_sequence"]),) for row in rows),
                    )
        return tuple(self._history_public_row(row) for row in rows)

    def seed_publication_receipt(
        self,
        run_id: str,
        effect_kind: str,
        *,
        completed: bool,
        payload: Mapping[str, Any] | None = None,
        created_at: float = 0,
    ) -> None:
        run_id = str(run_id or "").strip()
        effect_kind = str(effect_kind or "").strip()
        if not run_id or effect_kind not in {"history", "notification"}:
            raise GenerationRunStoreError(
                "invalid_publication_receipt",
                "publication receipt requires a run and known effect kind",
            )
        if not completed and not isinstance(payload, Mapping):
            raise GenerationRunStoreError(
                "missing_publication_payload",
                "pending publication receipt requires a payload",
            )
        if _contains_inline_media(payload):
            raise GenerationRunStoreError(
                "inline_media_not_materialized",
                "publication media must be materialized before persistence",
            )
        now = float(self._now())
        created = float(created_at or now)
        payload_digest = _digest(payload) if isinstance(payload, Mapping) else ""
        effect_id = self._publication_effect_id(run_id, effect_kind)
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    """
                    SELECT state, payload_digest
                    FROM generation_publication_receipts WHERE effect_id = ?
                    """,
                    (effect_id,),
                ).fetchone()
                if (
                    existing is not None
                    and str(existing["payload_digest"])
                    and payload_digest
                    and str(existing["payload_digest"]) != payload_digest
                ):
                    raise GenerationRunStoreError(
                        "publication_collision",
                        "publication receipt already identifies different content",
                    )
                if existing is not None and str(existing["state"]) == "completed":
                    return
                state = "completed" if completed else "pending"
                connection.execute(
                    """
                    INSERT INTO generation_publication_receipts(
                        effect_id, run_id, effect_kind, state, payload_json,
                        payload_digest, available_at, lease_token, lease_owner,
                        lease_expires_at, attempt_count, last_error, created_at,
                        updated_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 0, 0, '', ?, ?, ?)
                    ON CONFLICT(effect_id) DO UPDATE SET
                        state = excluded.state,
                        payload_json = excluded.payload_json,
                        payload_digest = CASE
                            WHEN generation_publication_receipts.payload_digest = ''
                            THEN excluded.payload_digest
                            ELSE generation_publication_receipts.payload_digest
                        END,
                        available_at = excluded.available_at,
                        lease_token = '', lease_owner = '', lease_expires_at = 0,
                        last_error = '', updated_at = excluded.updated_at,
                        completed_at = excluded.completed_at
                    """,
                    (
                        effect_id,
                        run_id,
                        effect_kind,
                        state,
                        None if completed else _json(payload),
                        payload_digest,
                        now,
                        created,
                        now,
                        now if completed else 0,
                    ),
                )

    def claim_publication(
        self,
        worker_id: str,
        *,
        lease_seconds: float,
        run_id: str = "",
        effect_kind: str = "",
        payload: Mapping[str, Any] | None = None,
    ) -> GenerationPublicationClaim | None:
        owner = str(worker_id or "").strip()
        if not owner:
            raise ValueError("worker_id must not be empty")
        duration = float(lease_seconds)
        if duration <= 0:
            raise ValueError("lease_seconds must be positive")
        run_id = str(run_id or "").strip()
        effect_kind = str(effect_kind or "").strip()
        if payload is not None:
            self.seed_publication_receipt(
                run_id,
                effect_kind,
                completed=False,
                payload=payload,
            )
        now = float(self._now())
        lease_token = uuid.uuid4().hex
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """
                    SELECT * FROM generation_publication_receipts
                    WHERE (? = '' OR run_id = ?)
                      AND (? = '' OR effect_kind = ?)
                      AND ((state = 'pending' AND available_at <= ?)
                           OR (state = 'claimed' AND lease_expires_at <= ?))
                    ORDER BY available_at, created_at, effect_id
                    LIMIT 1
                    """,
                    (run_id, run_id, effect_kind, effect_kind, now, now),
                ).fetchone()
                if row is None:
                    return None
                connection.execute(
                    """
                    UPDATE generation_publication_receipts
                    SET state = 'claimed', lease_token = ?, lease_owner = ?,
                        lease_expires_at = ?, attempt_count = attempt_count + 1,
                        updated_at = ? WHERE effect_id = ?
                    """,
                    (
                        lease_token,
                        owner,
                        now + duration,
                        now,
                        str(row["effect_id"]),
                    ),
                )
        return GenerationPublicationClaim(
            effect_id=str(row["effect_id"]),
            run_id=str(row["run_id"]),
            effect_kind=str(row["effect_kind"]),
            payload=_decode(row["payload_json"], {}),
            lease_token=lease_token,
            lease_owner=owner,
            lease_expires_at=now + duration,
            attempt_count=int(row["attempt_count"]) + 1,
        )

    def settle_publication(
        self,
        claim: GenerationPublicationClaim,
        *,
        completed: bool,
        detail: str = "",
        retry_delay_seconds: float = 0,
    ) -> bool:
        now = float(self._now())
        with self._connect() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute(
                    """
                    SELECT effect_id FROM generation_publication_receipts
                    WHERE effect_id = ? AND state = 'claimed'
                      AND lease_token = ? AND lease_owner = ?
                      AND lease_expires_at > ?
                    """,
                    (
                        claim.effect_id,
                        claim.lease_token,
                        claim.lease_owner,
                        now,
                    ),
                ).fetchone()
                if current is None:
                    return False
                if completed:
                    connection.execute(
                        """
                        UPDATE generation_publication_receipts
                        SET state = 'completed', payload_json = NULL,
                            available_at = ?, lease_token = '', lease_owner = '',
                            lease_expires_at = 0, last_error = ?, updated_at = ?,
                            completed_at = ? WHERE effect_id = ?
                        """,
                        (now, str(detail or "")[:65536], now, now, claim.effect_id),
                    )
                else:
                    connection.execute(
                        """
                        UPDATE generation_publication_receipts
                        SET state = 'pending', available_at = ?, lease_token = '',
                            lease_owner = '', lease_expires_at = 0,
                            last_error = ?, updated_at = ? WHERE effect_id = ?
                        """,
                        (
                            now + max(0.0, float(retry_delay_seconds)),
                            str(detail or "")[:65536],
                            now,
                            claim.effect_id,
                        ),
                    )
        return True

    def legacy_publication_snapshot(
        self,
    ) -> LegacyGenerationPublicationSnapshot:
        """Project SQLite truth without mutating receipts or claiming work."""

        with self._connect() as connection:
            history_rows = list(
                connection.execute(
                    """
                    SELECT history_id, run_id, payload_json
                    FROM generation_history
                    ORDER BY created_at DESC, history_sequence DESC
                    """
                )
            )
            receipt_rows = list(
                connection.execute(
                    """
                    SELECT run_id, effect_kind, state
                    FROM generation_publication_receipts
                    ORDER BY created_at, effect_id
                    """
                )
            )
        history: list[Mapping[str, Any]] = []
        for row in history_rows:
            record = self._history_public_row(row)
            run_id = str(row["run_id"] or "").strip()
            if run_id:
                record["_effect_id"] = f"generation-run:{run_id}"
            history.append(record)
        completed: dict[str, list[str]] = {}
        pending: dict[str, list[str]] = {}
        for row in receipt_rows:
            run_id = str(row["run_id"])
            effect_kind = str(row["effect_kind"])
            target = completed if str(row["state"]) == "completed" else pending
            target.setdefault(run_id, []).append(effect_kind)
        return LegacyGenerationPublicationSnapshot(
            history=tuple(history),
            completed={
                run_id: tuple(dict.fromkeys(names))
                for run_id, names in completed.items()
            },
            pending={
                run_id: tuple(dict.fromkeys(names))
                for run_id, names in pending.items()
            },
        )

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
                "runs": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_runs"
                    ).fetchone()[0]
                ),
                "payloads": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_run_payloads"
                    ).fetchone()[0]
                ),
                "attempts": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_run_attempts"
                    ).fetchone()[0]
                ),
                "remote_refs": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_run_remote_refs"
                    ).fetchone()[0]
                ),
                "outputs": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_run_outputs"
                    ).fetchone()[0]
                ),
                "effects": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_effect_outbox"
                    ).fetchone()[0]
                ),
                "pending_effects": int(
                    connection.execute(
                        """
                        SELECT COUNT(*) FROM generation_effect_outbox
                        WHERE state <> 'completed'
                        """
                    ).fetchone()[0]
                ),
                "history": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_history"
                    ).fetchone()[0]
                ),
                "publications": int(
                    connection.execute(
                        "SELECT COUNT(*) FROM generation_publication_receipts"
                    ).fetchone()[0]
                ),
                "pending_publications": int(
                    connection.execute(
                        """
                        SELECT COUNT(*) FROM generation_publication_receipts
                        WHERE state <> 'completed'
                        """
                    ).fetchone()[0]
                ),
                "orphan_pending_publications": int(
                    connection.execute(
                        """
                        SELECT COUNT(*)
                        FROM generation_publication_receipts AS receipts
                        LEFT JOIN generation_runs AS runs
                          ON runs.run_id = receipts.run_id
                        WHERE receipts.state <> 'completed'
                          AND runs.run_id IS NULL
                        """
                    ).fetchone()[0]
                ),
            }
        return {
            "ok": (
                integrity_rows == ["ok"]
                and not foreign_keys
                and counts["orphan_pending_publications"] == 0
            ),
            "integrity": integrity_rows,
            "foreign_keys": foreign_keys,
            "journal_mode": journal_mode,
            "schema_version": SCHEMA_VERSION,
            "counts": counts,
        }


__all__ = [
    "EffectResolution",
    "GenerationEffectClaim",
    "GenerationHistoryPage",
    "LegacyGenerationPublicationSnapshot",
    "GenerationPublicationClaim",
    "GenerationPublicationStore",
    "GenerationRunAttempt",
    "GenerationRunEffect",
    "GenerationRunState",
    "GenerationRunStore",
    "GenerationRunStoreError",
    "SqliteGenerationRunStore",
]
