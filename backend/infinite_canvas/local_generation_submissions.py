"""Device-local submission journal; cloud Run and Canvas stores stay authoritative.

Only immutable commands are staged here. The worker confirms their Canvas
operations before dispatch, and never replays an uncertain Provider submission.
Ports recheck the current actor, Workspace binding and target at execution time.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Awaitable, Callable


class LocalSubmissionError(Exception):
    def __init__(self, code: str, status_code: int = 409):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


ACTIVE = ("queued", "syncing", "submitting", "uncertain")
MAX_COMMAND_BYTES = 8 * 1024 * 1024
MAX_PENDING = 128


class LocalSubmissionJournal:
    """Atomic local acceptance and identity-scoped immutable command storage."""

    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("""CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner TEXT NOT NULL,
            canvas_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_index INTEGER NOT NULL,
            command TEXT NOT NULL, command_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}',
            error TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, updated_at REAL NOT NULL,
            UNIQUE(workspace_id, owner, operation_id, request_index)
        )""")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _record(row):
        if row is None:
            raise LocalSubmissionError("local_generation_not_found", 404)
        result = dict(row)
        result["command"] = json.loads(result["command"])
        result["result"] = json.loads(result["result"])
        return result

    def accept(self, workspace_id: str, owner: str, command: dict) -> dict:
        encoded = json.dumps(command, sort_keys=True, separators=(",", ":"), allow_nan=False)
        command_hash = hashlib.sha256(encoded.encode()).hexdigest()
        if len(encoded.encode()) > MAX_COMMAND_BYTES:
            raise LocalSubmissionError("local_generation_too_large", 413)
        operation_id = str(command.get("operation_id") or "")
        canvas_id = str(command.get("canvas_id") or "")
        index = command.get("request_index", 0)
        if not workspace_id or not owner or not canvas_id or not operation_id or not isinstance(index, int) or not 0 <= index < 8:
            raise LocalSubmissionError("local_generation_invalid", 422)
        identity = json.dumps([workspace_id, owner, operation_id, index])
        submission_id = hashlib.sha256(identity.encode()).hexdigest()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
            if existing:
                if existing["command_hash"] != command_hash:
                    raise LocalSubmissionError("local_generation_collision")
                return self._record(existing)
            pending = db.execute("SELECT COUNT(*) FROM submissions WHERE status IN ('queued','syncing','submitting','uncertain')").fetchone()[0]
            if pending >= MAX_PENDING:
                raise LocalSubmissionError("local_generation_full", 429)
            now = time.time()
            db.execute("INSERT INTO submissions (id,workspace_id,owner,canvas_id,operation_id,request_index,command,command_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'queued',?,?)",
                       (submission_id, workspace_id, owner, canvas_id, operation_id, index, encoded, command_hash, now, now))
            row = db.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
        return self._record(row)

    def read(self, submission_id: str, workspace_id: str, owner: str) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT * FROM submissions WHERE id=? AND workspace_id=? AND owner=?", (submission_id, workspace_id, owner)).fetchone()
        return self._record(row)

    def list(self, workspace_id: str, *, owner: str | None = None, canvas_id: str | None = None) -> list[dict]:
        clauses, values = ["workspace_id=?"], [workspace_id]
        for name, value in (("owner", owner), ("canvas_id", canvas_id)):
            if value is not None:
                clauses.append(f"{name}=?")
                values.append(value)
        with self._connect() as db:
            rows = db.execute("SELECT * FROM submissions WHERE " + " AND ".join(clauses) + " ORDER BY created_at,id", values).fetchall()
        return [self._record(row) for row in rows]

    def update(self, record: dict, status: str, *, result: dict | None = None, error: str = "") -> dict:
        with self._connect() as db:
            db.execute("UPDATE submissions SET status=?,result=?,error=?,updated_at=? WHERE id=? AND workspace_id=? AND owner=?",
                       (status, json.dumps(result or {}), error, time.time(), record["id"], record["workspace_id"], record["owner"]))
            if status in {"accepted", "cancelled"}:
                summary = {key: record["command"].get(key) for key in ("canvas_id", "operation_id", "request_index", "endpoint", "target_ids")}
                db.execute("UPDATE submissions SET command=? WHERE id=?", (json.dumps(summary), record["id"]))
            row = db.execute("SELECT * FROM submissions WHERE id=?", (record["id"],)).fetchone()
        return self._record(row)

    def active_count(self, workspace_id: str) -> int:
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM submissions WHERE workspace_id=? AND status IN ('queued','syncing','submitting','uncertain')", (workspace_id,)).fetchone()[0]


class LocalGenerationSubmissions:
    """Run independent commands concurrently after their ordered prerequisites."""

    def __init__(self, *, journal: LocalSubmissionJournal, workspace_id: str,
                 prepare: Callable[[dict], Awaitable[None]],
                 dispatch: Callable[[dict], Awaitable[dict]],
                 reconcile: Callable[[dict], Awaitable[dict | None]],
                 concurrency: int = 4):
        self.journal = journal
        self.workspace_id = workspace_id
        self.prepare = prepare
        self.dispatch = dispatch
        self.reconcile = reconcile
        self._slots = asyncio.Semaphore(concurrency)
        self._phase_lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}
        self._closed = False
        self._cancelled: set[str] = set()
        self._retry_task = None
        self._accepting = 0
        self._accept_work: set[asyncio.Task] = set()
        self._cancelling = False

    def active_count(self):
        return self._accepting + self.journal.active_count(self.workspace_id)

    async def accept(self, owner: str, command: dict) -> dict:
        if self._closed or self._cancelling:
            raise LocalSubmissionError("local_generation_unavailable", 503)
        self._accepting += 1
        work = asyncio.create_task(asyncio.to_thread(self.journal.accept, self.workspace_id, owner, command))
        self._accept_work.add(work)
        try:
            try:
                record = await asyncio.shield(work)
            except asyncio.CancelledError:
                # A disconnected browser does not cancel an in-progress disk
                # commit or make it disappear from the shutdown count.
                record = await work
                self.wake(record)
                raise
            except (sqlite3.Error, OSError) as error:
                raise LocalSubmissionError("local_generation_storage_failed", 507) from error
        finally:
            self._accept_work.discard(work)
            self._accepting -= 1
        self.wake(record)
        return record

    def wake(self, record: dict):
        if self._closed or record["workspace_id"] != self.workspace_id or record["status"] not in ACTIVE:
            return
        task = self._tasks.get(record["id"])
        if task is None or task.done():
            self._tasks[record["id"]] = asyncio.create_task(self._run(record), name="local-generation-" + record["id"][:12])
            self._tasks[record["id"]].add_done_callback(lambda task: task.exception() if not task.cancelled() else None)

    async def start(self):
        for record in await asyncio.to_thread(self.journal.list, self.workspace_id):
            self.wake(record)
        if self._retry_task is None:
            self._retry_task = asyncio.create_task(self._retry_pending(), name="local-generation-recovery")

    async def _retry_pending(self):
        while not self._closed:
            await asyncio.sleep(4)
            try:
                records = await asyncio.to_thread(self.journal.list, self.workspace_id)
                for record in records:
                    self.wake(record)
                active_ids = {record["id"] for record in records if record["status"] in ACTIVE}
                self._tasks = {key: task for key, task in self._tasks.items() if key in active_ids or not task.done()}
            except (sqlite3.Error, OSError):
                continue

    async def _update(self, record, status, **values):
        work = asyncio.create_task(asyncio.to_thread(self.journal.update, record, status, **values))
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            # Finish the disk write before shutdown/cancellation can record a
            # later phase. Cancelling to_thread alone leaves its write running.
            await work
            raise

    async def _run(self, record):
        async with self._slots:
            checking_receipt = False
            try:
                record = await asyncio.to_thread(self.journal.read, record["id"], self.workspace_id, record["owner"])
                if record["status"] not in ACTIVE:
                    return
                if record["status"] in {"submitting", "uncertain"}:
                    checking_receipt = True
                    receipt = await self.reconcile(record)
                    await self._update(record, "accepted" if receipt else "uncertain", result=receipt, error="" if receipt else "local_generation_uncertain")
                    return
                if record["id"] in self._cancelled:
                    await self._update(record, "cancelled")
                    return
                record = await self._update(record, "syncing")
                await self.prepare(record)
                async with self._phase_lock:
                    if record["id"] in self._cancelled:
                        await self._update(record, "cancelled")
                        return
                    record = await self._update(record, "submitting")
                receipt = await self.dispatch(record)
                await self._update(record, "accepted", result=receipt)
            except asyncio.CancelledError:
                # Leave the durable phase intact. On restart, only pre-dispatch
                # commands may run; unknown dispatches go through reconciliation.
                raise
            except Exception as error:
                code = str(getattr(error, "code", "") or "local_generation_failed")
                status = int(getattr(error, "status_code", 0) or 0)
                if checking_receipt or (record["status"] in {"submitting", "uncertain"}
                                        and not isinstance(error, LocalSubmissionError)):
                    # A failed lookup (including revoked access) cannot prove
                    # that an earlier Provider call was never executed.
                    await self._update(record, "uncertain", error="local_generation_uncertain")
                elif status in {401, 403}:
                    await self._update(record, "failed", error="local_generation_permission_lost")
                elif status in {400, 404, 409, 422} and code != "local_generation_uncertain":
                    await self._update(record, "failed", error=code)
                elif record["status"] in {"submitting", "uncertain"}:
                    # Even a lost response may have started a billable Run.
                    await self._update(record, "uncertain", error="local_generation_uncertain")
                elif code.startswith("cloud_storage_"):
                    await self._update(record, "syncing", error=code)
                else:
                    await self._update(record, "failed", error=code)

    async def retry(self, record):
        task = self._tasks.get(record["id"])
        if task is not None and not task.done():
            return await asyncio.to_thread(self.journal.read, record["id"], self.workspace_id, record["owner"])
        if record["status"] == "failed":
            record = await self._update(record, "queued")
        self.wake(record)
        return record

    async def cancel_active(self):
        self._cancelling = True
        try:
            if self._accept_work:
                await asyncio.gather(*(asyncio.shield(task) for task in tuple(self._accept_work)), return_exceptions=True)
            async with self._phase_lock:
                records = await asyncio.to_thread(self.journal.list, self.workspace_id)
                if any(record["status"] in {"submitting", "uncertain"} for record in records):
                    raise LocalSubmissionError("local_generation_uncertain")
                self._cancelled.update(record["id"] for record in records if record["status"] in {"queued", "syncing"})
            for record in records:
                if record["status"] in {"queued", "syncing"}:
                    task = self._tasks.get(record["id"])
                    if task and not task.done():
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)
                    await self._update(record, "cancelled")
        finally:
            self._cancelling = False

    async def close(self, *, drain=False):
        self._closed = True
        if self._accept_work:
            await asyncio.gather(*(asyncio.shield(task) for task in tuple(self._accept_work)), return_exceptions=True)
        if self._retry_task is not None:
            self._retry_task.cancel()
            await asyncio.gather(self._retry_task, return_exceptions=True)
        tasks = tuple(self._tasks.values())
        try:
            if drain and tasks:
                await asyncio.gather(*(asyncio.shield(task) for task in tasks), return_exceptions=True)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
