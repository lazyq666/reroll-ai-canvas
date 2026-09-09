"""Process ownership and connection configuration for optional cloud records."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from contextlib import closing
from pathlib import Path

from .turso_sqlite import TursoConnection, TursoError, database_url
from .turso_stores import FencedTursoConnection, TursoCanvasStore, TursoGenerationRunStore
from .turso_workspace_lease import WorkspaceLease

LOGGER = logging.getLogger(__name__)


class TursoWorkspaceRuntime:
    def __init__(self, configuration: Path | str, *, workspace_id: str, binding_id: str, device_id: str, transport=None):
        try:
            value = json.loads(Path(configuration).read_text(encoding="utf-8"))
            if value.get("schema_version") != 1 or value.get("workspace_id") != workspace_id:
                raise ValueError
            self._url = database_url(value["url"])
            self._token = str(value["token"])
        except (OSError, ValueError, TypeError, KeyError):
            raise TursoError("cloud_storage_configuration_required") from None
        self.workspace_id = workspace_id
        self.binding_id = binding_id
        self._transport = transport
        self._stop = threading.Event()
        self._renew_lock = threading.RLock()
        self._deadline = 0.0
        self._thread = None
        self._closed = False
        self.lease = WorkspaceLease(self.raw_connect, workspace_id=workspace_id, binding_id=binding_id, ttl_seconds=120)
        started = time.monotonic()
        self.fence = self.lease.acquire()
        self._deadline = started + 110
        try:
            self.canvas_store = TursoCanvasStore(self.connect, workspace_id=workspace_id)
            self.generation_run_store = TursoGenerationRunStore(self.connect, workspace_id=workspace_id)
            self.verify_device_recovery(device_id)
        except BaseException:
            self.close()
            raise

    def raw_connect(self):
        return TursoConnection(self._url, self._token, transport=self._transport)

    def connect(self):
        self.require_active()
        return FencedTursoConnection(self._url, self._token, transport=self._transport, fence=self.fence)

    def require_active(self):
        if self._stop.is_set() or self.fence._revoked.is_set() or time.monotonic() >= self._deadline:
            if not self._stop.is_set() and self.lease.can_reconcile and time.monotonic() < self._deadline:
                raise TursoError("cloud_storage_reconnecting")
            raise TursoError("cloud_storage_lease_lost")

    def renew(self):
        with self._renew_lock:
            if self._stop.is_set() or time.monotonic() >= self._deadline:
                raise TursoError("cloud_storage_lease_lost")
            started = time.monotonic()
            if self.lease.can_reconcile:
                self.fence = self.lease.reconcile()
            else:
                self.require_active()
                self.lease.renew()
            self._deadline = started + 110

    def start(self):
        self.require_active()
        if self._thread is not None:
            return

        def heartbeat():
            delay = 20
            while not self._stop.wait(delay):
                try:
                    self.renew()
                    delay = 20
                except Exception as error:
                    self.fence._revoked.set()
                    retry = self.lease.can_reconcile and time.monotonic() < self._deadline
                    code = getattr(error, 'code', '')
                    LOGGER.warning(
                        'Cloud lease renewal unavailable; reconciling=%s; error=%s',
                        retry, code if isinstance(code, str) and re.fullmatch(r'cloud_storage_[a-z_]+', code) else type(error).__name__,
                    )
                    if not retry:
                        return
                    delay = 2

        self._thread = threading.Thread(target=heartbeat, name="cloud-workspace-lease", daemon=True)
        self._thread.start()

    def verify_device_recovery(self, device_id):
        """Only the original account's device may resume unfinished work.

        Rotation with unfinished work needs the original installation and its
        credentials. A lease takeover must never resubmit a Provider request.
        """
        if not device_id:
            raise TursoError("cloud_storage_configuration_required")
        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute("SELECT value FROM store_metadata WHERE key='cloud_last_device_id'").fetchone()
            unfinished = connection.execute("""
                SELECT 1 FROM generation_runs r
                WHERE r.status NOT IN ('succeeded','failed','cancelled','discarded')
                   OR EXISTS (SELECT 1 FROM generation_effect_outbox e WHERE e.run_id=r.run_id AND e.state<>'completed')
                UNION SELECT 1 FROM batches WHERE status IN ('queued','running','paused')
                UNION SELECT 1 FROM generation_publication_receipts WHERE state<>'completed'
                LIMIT 1
            """).fetchone()
            if unfinished and (previous is None or previous[0] != device_id):
                raise TursoError("cloud_storage_original_device_required")
            connection.execute("INSERT INTO store_metadata(key,value) VALUES('cloud_last_device_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (device_id,))

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=20)
        with self._renew_lock:
            try:
                self.lease.release()
            finally:
                self._token = ""

    def public(self):
        try:
            self.require_active()
            status = "connected"
        except TursoError as error:
            status = "reconnecting" if error.code == "cloud_storage_reconnecting" else "unavailable"
        return {"enabled": True, "provider": "turso", "status": status, "workspace_id": self.workspace_id}
