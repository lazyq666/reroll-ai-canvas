"""Cloud adapters for the three Workspace SQLite responsibilities.

Opening these adapters validates an already prepared database; it never creates
schema, overwrites Workspace identity, or opens a local SQLite fallback. Runtime
composition and controlled activation are separate from these Store contracts.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Any

from .batch_generation import BatchGeneration
from .canvas_store import SCHEMA_VERSION as CANVAS_SCHEMA_VERSION, SqliteCanvasStore
from .generation_run_store import SCHEMA_VERSION as RUN_SCHEMA_VERSION, SqliteGenerationRunStore
from .turso_sqlite import TursoConnection, TursoError, _verb
from .turso_workspace_lease import WorkspaceFence


class FencedTursoConnection(TursoConnection):
    """Every business transaction checks the same remote fence before writing
    and before commit. The original Store continues to own the transaction.
    """

    def __init__(self, *args, fence: WorkspaceFence, **kwargs):
        super().__init__(*args, **kwargs)
        self._fence = fence

    def _execute(self, sql: str, parameters: Any):
        verb = _verb(sql)
        if verb in {'CREATE', 'DROP', 'ALTER', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX'}:
            raise TursoError('cloud_storage_schema_change_requires_migration')
        if verb == 'WITH':
            # The current Stores do not use CTEs. Classifying arbitrary CTEs as
            # reads can accidentally admit an autocommit write without a fence.
            raise TursoError('cloud_storage_unsupported_statement')
        if verb == 'PRAGMA' and '=' in sql:
            raise TursoError('cloud_storage_unsupported_statement')
        if verb in {'COMMIT', 'END'} and self.in_transaction:
            self._fence.check(self)
        starting = not self.in_transaction and verb in {'BEGIN', 'SAVEPOINT'}
        if starting and verb == 'SAVEPOINT':
            raise TursoError('cloud_storage_transaction_required')
        if starting:
            # Acquire the write lock before testing ownership; a deferred read
            # followed by an upgrade is an unnecessary race with a new owner.
            sql = 'BEGIN IMMEDIATE'
        result = super()._execute(sql, parameters)
        if starting:
            self._fence.check(self)
        return result

    def _sequence(self, sql: str) -> None:
        raise TursoError('cloud_storage_schema_change_requires_migration')


class _CloudStore:
    def _configure(self, connect: Callable[[], TursoConnection], workspace_id: str):
        self._cloud_connect = connect
        self.workspace_id = str(workspace_id or '').strip()
        if not self.workspace_id:
            raise ValueError('workspace_id must not be empty')
        # A remote Store deliberately has no usable file path. In particular,
        # passing it to a local backup or cleanup routine must fail visibly.
        self.database_path = None

    @contextmanager
    def _connect(self):
        with closing(self._cloud_connect()) as connection:
            if not isinstance(connection, FencedTursoConnection):
                raise TursoError('cloud_storage_fence_required')
            if connection._fence.workspace_id != self.workspace_id:
                raise TursoError('cloud_storage_workspace_mismatch')
            connection.row_factory = sqlite3.Row
            yield connection

    def _verify_metadata(self, table: str, expected_version: int):
        try:
            with self._connect() as connection:
                metadata = dict(connection.execute(f'SELECT key, value FROM {table}'))
                foreign_keys = connection.execute('PRAGMA foreign_keys').fetchone()[0]
        except TursoError:
            raise
        except sqlite3.Error:
            raise TursoError('cloud_storage_schema_invalid') from None
        if metadata.get('workspace_id') != self.workspace_id:
            raise TursoError('cloud_storage_workspace_mismatch')
        if metadata.get('schema_version') != str(expected_version) or foreign_keys != 1:
            raise TursoError('cloud_storage_schema_invalid')


class TursoCanvasStore(_CloudStore, SqliteCanvasStore):
    def __init__(self, connect: Callable[[], TursoConnection], *, workspace_id: str, now_ms=None):
        self._configure(connect, workspace_id)
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._initialize()

    def _initialize(self):
        self._verify_metadata('store_metadata', CANVAS_SCHEMA_VERSION)


class TursoGenerationRunStore(_CloudStore, SqliteGenerationRunStore):
    def __init__(self, connect: Callable[[], TursoConnection], *, workspace_id: str, now=None):
        self._configure(connect, workspace_id)
        self._now = now or time.time
        self._initialize()

    def _initialize(self):
        self._verify_metadata('generation_run_store_metadata', RUN_SCHEMA_VERSION)


class TursoBatchGeneration(BatchGeneration):
    def __init__(self, connect: Callable[[], TursoConnection], *, workspace_id: str, **kwargs):
        self._cloud_connect = connect
        self.workspace_id = workspace_id
        # BatchGeneration's constructor retains a path for its local adapter.
        # A directory sentinel cannot become a silently-created fallback DB.
        super().__init__(Path('.'), **kwargs)

    @contextmanager
    def _connect(self):
        # BatchGeneration uses connection contexts to commit, unlike the two
        # Store context managers which own their commit/rollback explicitly.
        with closing(self._cloud_connect()) as connection:
            if not isinstance(connection, FencedTursoConnection):
                raise TursoError('cloud_storage_fence_required')
            if connection._fence.workspace_id != self.workspace_id:
                raise TursoError('cloud_storage_workspace_mismatch')
            connection.row_factory = sqlite3.Row
            with connection:
                yield connection

    def _ensure_schema(self):
        with self._connect() as connection:
            batch_columns = {row[1] for row in connection.execute('PRAGMA table_info(batches)')}
            task_columns = {row[1] for row in connection.execute('PRAGMA table_info(batch_tasks)')}
        if not {'id', 'owner', 'name', 'status', 'snapshot', 'created_at', 'updated_at'} <= batch_columns:
            raise TursoError('cloud_storage_schema_invalid')
        if not {'batch_id', 'task_index', 'status', 'task', 'run_id', 'outputs', 'error', 'attempt_count'} <= task_columns:
            raise TursoError('cloud_storage_schema_invalid')
