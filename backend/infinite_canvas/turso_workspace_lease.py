"""Remote single-writer fence, pending Workspace activation/runtime wiring.

All times are evaluated by the database. The caller must check this fence in
the same transaction as the business write, and again before commit. This is
a coordination contract between trusted installations, not a database ACL.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from threading import Event
from typing import Any
from uuid import uuid4
import sqlite3

from .turso_sqlite import TursoError


_NOW = "CAST(strftime('%s', 'now') AS INTEGER)"
LEASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS reroll_workspace_lease (
    workspace_id TEXT PRIMARY KEY,
    binding_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('staging', 'active', 'retired')),
    owner TEXT NOT NULL DEFAULT '',
    epoch INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0),
    expires_at INTEGER NOT NULL DEFAULT 0
);
"""


@dataclass(frozen=True)
class WorkspaceFence:
    workspace_id: str
    binding_id: str
    owner: str
    epoch: int
    _revoked: Event = field(default_factory=Event, compare=False, repr=False)

    def check(self, connection: Any) -> None:
        if self._revoked.is_set():
            raise TursoError('cloud_storage_lease_lost')
        if not connection.in_transaction:
            raise TursoError('cloud_storage_transaction_required')
        row = connection.execute(
            f"""SELECT 1 FROM reroll_workspace_lease
                WHERE workspace_id = ? AND binding_id = ? AND state = 'active'
                  AND owner = ? AND epoch = ? AND expires_at > {_NOW}""",
            (self.workspace_id, self.binding_id, self.owner, self.epoch),
        ).fetchone()
        if row is None:
            raise TursoError('cloud_storage_lease_lost')

    @contextmanager
    def transaction(self, connect: Callable[[], Any]):
        """Use for a complete business transaction, without implicit retries."""
        with closing(connect()) as connection:
            with connection:
                connection.execute('BEGIN IMMEDIATE')
                self.check(connection)
                yield connection
                self.check(connection)


class WorkspaceLease:
    def __init__(
        self,
        connect: Callable[[], Any],
        *,
        workspace_id: str,
        binding_id: str,
        ttl_seconds: int = 60,
    ):
        if not workspace_id or not binding_id or not 15 <= ttl_seconds <= 300:
            raise ValueError('Invalid Workspace lease configuration')
        self._connect = connect
        self.workspace_id = workspace_id
        self.binding_id = binding_id
        # A process incarnation, never a persistent device ID: a restarted
        # process must not inherit an old process's write authorization.
        self.owner = uuid4().hex
        self.ttl_seconds = ttl_seconds
        self._fence: WorkspaceFence | None = None
        self._lost = False
        self._uncertain = False
        self._revoked = Event()

    def acquire(self) -> WorkspaceFence:
        if self._lost:
            raise TursoError('cloud_storage_lease_lost')
        with closing(self._connect()) as connection:
            with connection:
                connection.execute('BEGIN IMMEDIATE')
                # Repeating the same acquire after a lost response can only
                # recover this incarnation, never overwrite another owner.
                row = connection.execute(
                    f"""UPDATE reroll_workspace_lease
                        SET epoch = CASE WHEN owner = ? AND expires_at > {_NOW}
                                         THEN epoch ELSE epoch + 1 END,
                            owner = ?, expires_at = {_NOW} + ?
                        WHERE workspace_id = ? AND binding_id = ? AND state = 'active'
                          AND (owner = ? OR expires_at <= {_NOW})
                        RETURNING epoch""",
                    (self.owner, self.owner, self.ttl_seconds,
                     self.workspace_id, self.binding_id, self.owner),
                ).fetchone()
                if row is None:
                    raise TursoError('cloud_storage_workspace_busy')
        self._fence = WorkspaceFence(
            self.workspace_id, self.binding_id, self.owner, int(row[0]), self._revoked,
        )
        return self._fence

    def renew(self) -> None:
        fence = self._fence
        if fence is None or self._lost:
            raise TursoError('cloud_storage_lease_lost')
        self._extend(fence)

    @property
    def can_reconcile(self) -> bool:
        return self._uncertain

    def reconcile(self) -> WorkspaceFence:
        """Confirm the same unexpired owner/epoch; never acquire a new lease.

        Previously issued connections keep their revoked fence. Only new
        connections may use the replacement after the renewal commit is known.
        """
        fence = self._fence
        if fence is None or not self._uncertain:
            raise TursoError('cloud_storage_lease_lost')
        self._extend(fence)
        self._revoked = Event()
        self._fence = WorkspaceFence(
            fence.workspace_id, fence.binding_id, fence.owner, fence.epoch,
            self._revoked,
        )
        self._lost = False
        self._uncertain = False
        return self._fence

    def _extend(self, fence: WorkspaceFence) -> None:
        try:
            with closing(self._connect()) as connection:
                with connection:
                    changed = connection.execute(
                        f"""UPDATE reroll_workspace_lease SET expires_at = {_NOW} + ?
                            WHERE workspace_id = ? AND binding_id = ? AND state = 'active'
                              AND owner = ? AND epoch = ? AND expires_at > {_NOW}""",
                        (self.ttl_seconds, self.workspace_id, self.binding_id,
                         fence.owner, fence.epoch),
                    ).rowcount
                    if changed != 1:
                        raise TursoError('cloud_storage_lease_lost')
        except Exception as error:
            # An uncertain renewal must pause this incarnation. A caller may
            # reconcile state explicitly; it must not silently acquire again.
            self._lost = True
            self._revoked.set()
            self._uncertain = (
                isinstance(error, OSError)
                or getattr(error, 'code', '') in {
                    'cloud_storage_outcome_unknown',
                    'cloud_storage_unavailable',
                    'cloud_storage_limit_reached',
                    'cloud_storage_connection_closed',
                }
                or (type(error) is sqlite3.OperationalError
                    and str(error) == 'cloud_storage_query_failed')
            )
            raise

    def release(self) -> None:
        fence = self._fence
        self._lost = True
        self._uncertain = False
        self._revoked.set()
        if fence is None:
            return
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """UPDATE reroll_workspace_lease SET owner = '', expires_at = 0
                       WHERE workspace_id = ? AND binding_id = ?
                         AND owner = ? AND epoch = ?""",
                    (self.workspace_id, self.binding_id, fence.owner, fence.epoch),
                )
