"""Small remote handoff register. No leases, media, or writable local replicas.

All decisions use a primary write transaction. Network errors have unknown
outcomes: callers retain their durable operation and reconcile on the next call.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import closing, contextmanager

from .turso_sqlite import TursoConnection, database_url
from .workspace_handoff import HandoffError


SCHEMA = """CREATE TABLE IF NOT EXISTS reroll_handoff_register (
    workspace_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL
)"""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class HandoffRegister:
    def __init__(self, connect, workspace_id):
        self.connect = connect
        self.workspace_id = workspace_id

    @contextmanager
    def transaction(self):
        try:
            with closing(self.connect()) as db:
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    yield db
        except HandoffError:
            raise
        except (sqlite3.Error, OSError, ValueError, TypeError):
            raise HandoffError("onlineUnavailable") from None

    def prepare_schema(self):
        # Provisioning only; normal runtime must never recreate lost registers.
        with self.transaction() as db:
            db.execute(SCHEMA)

    def _get(self, db):
        row = db.execute("SELECT revision, payload FROM reroll_handoff_register WHERE workspace_id = ?",
                         (self.workspace_id,)).fetchone()
        if row is None:
            return None
        value = json.loads(row[1])
        if (not isinstance(value, dict) or value.get("state") not in {"active", "sealed", "receiving"}
                or not isinstance(value.get("owner"), str) or not isinstance(value.get("session"), str)
                or not isinstance(value.get("handoff_id"), str) or not isinstance(value.get("digest"), str)):
            raise HandoffError("onlineInvalid")
        return {**value, "revision": row[0]}

    def read(self):
        with self.transaction() as db:
            value = self._get(db)
            if value is None:
                raise HandoffError("onlineUnregistered")
            return value

    def enroll(self, owner, session, handoff_id):
        value = dict(state="active", owner=owner, session=session, handoff_id=handoff_id, digest="")
        with self.transaction() as db:
            current = self._get(db)
            if current is None:
                db.execute("INSERT INTO reroll_handoff_register VALUES (?, 1, ?)",
                           (self.workspace_id, canonical(value)))
            elif any(current.get(key) != val for key, val in value.items()):
                raise HandoffError("onlineBusy")
        return self.read()

    def change(self, expected, **updates):
        value = {**expected, **updates}
        value.pop("revision", None)
        with self.transaction() as db:
            current = self._get(db)
            if current != expected:
                raise HandoffError("onlineBusy")
            db.execute("UPDATE reroll_handoff_register SET revision = revision + 1, payload = ? "
                       "WHERE workspace_id = ? AND revision = ?",
                       (canonical(value), self.workspace_id, expected["revision"]))
        return {**value, "revision": expected["revision"] + 1}


class OnlineHandoff:
    """Coordinates a WorkspaceHandoff while its caller holds the local OS lock."""

    def __init__(self, handoff, *, connect=None, settings=None):
        self.handoff = handoff
        self.config_path = handoff.local / "connection.json"
        self.receipt_path = handoff.local / "online-receipt.json"
        self.marker_path = handoff.control / "coordinator.json"
        self.settings = settings if settings is not None else handoff._read(self.config_path)
        if not self.settings:
            raise HandoffError("onlineConfiguration")
        try:
            url = database_url(self.settings["url"])
            token = self.settings["token"]
            if (self.settings.get("version") != 1 or self.settings.get("workspace_id") != handoff.workspace_id
                    or not isinstance(token, str) or not token or any(c.isspace() for c in token)):
                raise ValueError()
        except (KeyError, TypeError, ValueError, sqlite3.Error):
            raise HandoffError("onlineConfiguration") from None
        self.binding = digest({"url": url, "workspace_id": handoff.workspace_id})
        self.register = HandoffRegister(connect or (lambda: TursoConnection(url, token, timeout=8)), handoff.workspace_id)
        marker = handoff._read(self.marker_path)
        if marker and marker != self.marker:
            raise HandoffError("onlineConfiguration")

    @property
    def marker(self):
        return {"version": 1, "workspace_id": self.handoff.workspace_id, "binding": self.binding}

    @classmethod
    def configured(cls, handoff):
        return any(path.exists() or path.is_symlink() for path in (
            handoff.local / "connection.json", handoff.local / "online-receipt.json",
            handoff.control / "coordinator.json"))

    def receipt(self):
        receipt = self.handoff._read(self.receipt_path)
        if receipt and receipt.get("binding") != self.binding:
            raise HandoffError("onlineConfiguration")
        return receipt

    def save(self, value):
        self.handoff._write(self.receipt_path, {**value, "binding": self.binding})

    def install(self):
        # Open temporary files with private mode, not chmod after publication.
        self.handoff._write(self.config_path, self.settings, private=True)
        self.handoff._write(self.marker_path, self.marker)

    def enroll(self):
        """Explicit first-device enrollment, AFTER ordinary local admission."""
        h = self.handoff
        h.check_databases()
        record = h.read()
        local = h._read(h.receipt)
        if record and (record["state"] != "active" or record.get("server_id") != h.server_id
                       or not local or record.get("session") != local.get("session")):
            raise HandoffError("unclean")
        receipt = self.receipt()
        if not receipt:
            receipt = {"phase": "enrolling", "session": record["session"] if record else uuid.uuid4().hex,
                       "handoff_id": record["id"] if record else ""}
            self.save(receipt)
        if receipt["phase"] not in {"enrolling", "active"}:
            raise HandoffError("onlineBusy")
        self.install()  # Uncertain enrollment must block normal local fallback.
        self.register.enroll(h.server_id, receipt["session"], receipt["handoff_id"])
        self.save({**receipt, "phase": "active"})

    def _owned(self, remote, receipt):
        return bool(receipt and remote["owner"] == self.handoff.server_id
                    and remote["session"] == receipt.get("session")
                    and remote["handoff_id"] == receipt.get("handoff_id"))

    def begin_seal(self):
        remote, receipt = self.register.read(), self.receipt()
        if remote["state"] != "active" or not self._owned(remote, receipt):
            raise HandoffError("onlineBusy")
        self.save({**receipt, "phase": "sealing"})

    def publish(self, record):
        h = self.handoff
        receipt = self.receipt()
        remote = self.register.read()
        seal_digest = digest(record)
        if remote["handoff_id"] == record["id"] and remote["digest"] == seal_digest:
            # A receiver may already have claimed a successfully committed seal
            # before the sender receives its acknowledgement.
            if (not receipt or record.get("server_id") != h.server_id
                    or receipt.get("phase") not in {"sealing", "sealed"}
                    or (remote["state"] == "sealed" and
                        (remote["owner"] != h.server_id or remote["session"] != receipt.get("session")))):
                raise HandoffError("onlineBusy")
        else:
            if (remote["state"] != "active" or not self._owned(remote, receipt)
                    or receipt.get("phase") != "sealing" or record.get("parent") != (remote["handoff_id"] or None)):
                raise HandoffError("onlineBusy")
            self.register.change(remote, state="sealed", handoff_id=record["id"], digest=seal_digest)
        self.save({**receipt, "phase": "sealed", "handoff_id": record["id"]})
        return {"state": "sealed", "id": record["id"], "automatic": True, "exit_server": True,
                "file_count": len(record["files"])}

    def acquire(self):
        h = self.handoff
        remote, receipt = self.register.read(), self.receipt()
        record = h.read()
        if (receipt and receipt.get("phase") == "sealing" and record
                and record["state"] == "sealed" and record.get("server_id") == h.server_id
                and remote["handoff_id"] == record["id"] and remote["digest"] == digest(record)):
            self.publish(record)
            raise HandoffError("onlinePublished")
        if remote["state"] == "active":
            if not self._owned(remote, receipt):
                raise HandoffError("onlineBusy")
            if receipt.get("phase") == "sealing":
                # Resume a interrupted close, never silently reopen its writers.
                record = h._seal_local()
                self.publish(h.read())
                raise HandoffError("onlinePublished")
            if record is None and not remote["handoff_id"] and receipt.get("phase") in {"enrolling", "active"}:
                self.save({**receipt, "phase": "active"})
                return
            if (not record or record["state"] != "active" or record.get("server_id") != h.server_id
                    or record.get("session") != remote["session"] or record["id"] != remote["handoff_id"]):
                raise HandoffError("onlineInvalid")
            if receipt.get("phase") == "receiving":
                # A lost final commit response is still startup, not an editing
                # recovery: sync must not have changed the accepted snapshot.
                if digest(record["files"]) != receipt.get("files_digest") or h.inventory() != record["files"]:
                    raise HandoffError("changed")
            h._acquire_local()
            self.save({**receipt, "phase": "active"})
            return
        if remote["state"] == "sealed":
            if not record or record["state"] != "sealed" or digest(record) != remote["digest"]:
                raise HandoffError("onlineWaiting")
            h._validate_sealed(record, remote["handoff_id"])
            receipt = {"phase": "receiving", "session": uuid.uuid4().hex, "handoff_id": record["id"],
                       "files_digest": digest(record["files"])}
            self.save(receipt)
            remote = self.register.change(remote, state="receiving", owner=h.server_id, session=receipt["session"])
        if remote["state"] == "receiving":
            if not self._owned(remote, receipt):
                raise HandoffError("onlineBusy")
            if not record or record["id"] != remote["handoff_id"]:
                raise HandoffError("onlineWaiting")
            if record["state"] == "sealed":
                if digest(record) != remote["digest"]:
                    raise HandoffError("onlineInvalid")
                h._validate_sealed(record, remote["handoff_id"])
                if h.inventory() != record["files"] or h.read() != record:
                    raise HandoffError("changed")
                h._activate(record, session=remote["session"])
            elif record.get("server_id") != h.server_id or record.get("session") != remote["session"]:
                raise HandoffError("onlineInvalid")
            # No Store has been constructed yet, including during crash recovery.
            if digest(record["files"]) != receipt.get("files_digest") or h.inventory() != record["files"]:
                raise HandoffError("changed")
            h.check_databases()
            self.register.change(remote, state="active")
            self.save({**receipt, "phase": "active"})
            self.handoff._write(self.marker_path, self.marker)
