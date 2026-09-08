"""Inspect closed SQLite snapshots before a possible cloud cutover.

This is an internal migration seam, not an activation command. Callers must
first stop Workspace writers and make coordinated snapshots outside OneDrive.
Inspection neither repairs records nor publishes a cloud storage authority.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from collections import Counter
from contextlib import ExitStack, closing
from pathlib import Path
from typing import Any

from .canvas_store import SCHEMA_VERSION as CANVAS_VERSION
from .generation_run_store import SCHEMA_VERSION as RUN_VERSION
from .generation_run_store import EffectResolution, SqliteGenerationRunStore


DATABASES = (
    "canvas-content.sqlite3",
    "generation-runs.sqlite3",
    "batch-generation.sqlite3",
)
_TERMINAL_RUNS = {"succeeded", "failed", "cancelled", "discarded"}
_TERMINAL_BATCHES = {"completed", "failed", "cancelled", "partially_failed", "deleted"}


class CloudMigrationError(RuntimeError):
    """A diagnostic code, deliberately excluding private content and paths."""


def _quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _fingerprint(path: Path) -> tuple[int, int, int, str]:
    before = path.stat()
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    after = path.stat()
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_ino, after.st_size, after.st_mtime_ns
    ):
        raise CloudMigrationError("cloud_migration_source_changed")
    return after.st_ino, after.st_size, after.st_mtime_ns, digest


def _check_closed_snapshot(path: Path) -> None:
    if not path.is_file() or path.is_symlink():
        raise CloudMigrationError("cloud_migration_snapshot_missing")
    if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise CloudMigrationError("cloud_migration_snapshot_not_closed")


def _metadata(connection: sqlite3.Connection, table: str, workspace_id: str, version: int) -> None:
    values = dict(connection.execute(f"SELECT key, value FROM {_quoted(table)}"))
    if values.get("workspace_id") != workspace_id:
        raise CloudMigrationError("cloud_migration_workspace_mismatch")
    if values.get("schema_version") != str(version):
        raise CloudMigrationError("cloud_migration_schema_unsupported")


def _inline_media(value: Any) -> bool:
    if isinstance(value, str):
        return value.lstrip().lower().startswith("data:") and ";base64," in value.lower()
    if isinstance(value, dict):
        return any(_inline_media(child) for child in value.values())
    if isinstance(value, list):
        return any(_inline_media(child) for child in value)
    return False


def _media_cells(connection: sqlite3.Connection, tables: list[str]) -> int:
    """Count encoded-media cells without exposing prompts or media contents."""
    count = 0
    for table in tables:
        columns = connection.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
        for column in columns:
            if "TEXT" not in str(column[2]).upper():
                continue
            name = _quoted(column[1])
            for (value,) in connection.execute(
                f"SELECT {name} FROM {_quoted(table)} WHERE {name} LIKE '%data:%;base64,%'"
            ):
                try:
                    candidate = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    candidate = value
                count += int(_inline_media(candidate))
    return count


def _effect_conflicts(canvas: sqlite3.Connection, runs: sqlite3.Connection) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for effect in runs.execute(
        "SELECT * FROM generation_effect_outbox WHERE state <> 'completed'"
    ):
        prior = canvas.execute(
            "SELECT * FROM applied_generation_effects WHERE effect_id = ?",
            (effect["effect_id"],),
        ).fetchone()
        if prior is None:
            continue
        counts["previously_resolved"] += 1
        try:
            payload = json.loads(effect["payload_json"])
            if not isinstance(payload, dict):
                raise ValueError
            identity_matches = (
                prior["canvas_id"] == effect["canvas_id"]
                and prior["run_id"] == effect["run_id"]
                and prior["node_id"] == str(payload.get("node_id") or "")
                and prior["generation_operation_id"] == str(payload.get("generation_operation_id") or "")
                and prior["request_index"] == max(0, int(payload.get("request_index") or 0))
            )
        except (ValueError, TypeError):
            counts["invalid_payload"] += 1
            continue
        if not identity_matches:
            counts["identity_conflict"] += 1
            continue
        log = canvas.execute(
            "SELECT final_status FROM canvas_logs WHERE log_id = ? AND canvas_id = ? AND run_id = ?",
            (prior["log_id"], prior["canvas_id"], prior["run_id"]),
        ).fetchone()
        if not prior["applied"] or log is None:
            continue
        status = {"success": "succeeded", "canceled": "cancelled"}.get(log[0], log[0])
        if status != effect["terminal_status"]:
            counts["terminal_outcome_conflict"] += 1
    return dict(counts)


def inspect_snapshots(directory: Path | str, *, workspace_id: str) -> dict[str, Any]:
    """Return content-free readiness facts; unresolved work blocks cutover.

    ``immutable`` is used only for caller-provided, closed inspection copies.
    Do not pass live Workspace databases: a process lock and coordinated copy
    remain the activation caller's responsibility, beyond these change checks.
    """
    if not workspace_id:
        raise CloudMigrationError("cloud_migration_workspace_missing")
    paths = [Path(directory) / name for name in DATABASES]
    before = {}
    for path in paths:
        _check_closed_snapshot(path)
        before[path.name] = _fingerprint(path)
    databases = {}
    blockers = []
    try:
        with ExitStack() as stack:
            connections = []
            for path in paths:
                connection = stack.enter_context(closing(sqlite3.connect(
                    path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True,
                )))
                connection.row_factory = sqlite3.Row
                connections.append(connection)
                if [row[0] for row in connection.execute("PRAGMA quick_check")] != ["ok"]:
                    raise CloudMigrationError("cloud_migration_integrity_failed")
                if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise CloudMigrationError("cloud_migration_foreign_keys_failed")
                tables = [row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )]
                databases[path.name] = {
                    "bytes": before[path.name][1],
                    "sha256": before[path.name][3],
                    "tables": {table: connection.execute(
                        f"SELECT count(*) FROM {_quoted(table)}"
                    ).fetchone()[0] for table in tables},
                    "inline_media_cells": _media_cells(connection, tables),
                }
            canvas, runs, batches = connections
            _metadata(canvas, "store_metadata", workspace_id, CANVAS_VERSION)
            _metadata(runs, "generation_run_store_metadata", workspace_id, RUN_VERSION)
            for connection, table, statuses, code in (
                (runs, "generation_runs", _TERMINAL_RUNS, "active_generation_runs"),
                (batches, "batches", _TERMINAL_BATCHES, "active_batches"),
                (batches, "batch_tasks", {"succeeded", "failed", "cancelled"}, "active_batch_tasks"),
            ):
                count = sum(row[1] for row in connection.execute(
                    f"SELECT status, count(*) FROM {_quoted(table)} GROUP BY status"
                ) if row[0] not in statuses)
                if count:
                    blockers.append({"code": code, "count": count})
            for table, code in (
                ("generation_effect_outbox", "pending_generation_effects"),
                ("generation_publication_receipts", "pending_publications"),
            ):
                count = runs.execute(f"SELECT count(*) FROM {table} WHERE state <> 'completed'").fetchone()[0]
                if count:
                    blockers.append({"code": code, "count": count})
            media_count = sum(db["inline_media_cells"] for db in databases.values())
            if media_count:
                blockers.append({"code": "inline_media_requires_materialization", "count": media_count})
            conflicts = _effect_conflicts(canvas, runs)
    except (sqlite3.Error, OSError):
        raise CloudMigrationError("cloud_migration_snapshot_unreadable") from None
    for path in paths:
        _check_closed_snapshot(path)
        if _fingerprint(path) != before[path.name]:
            raise CloudMigrationError("cloud_migration_source_changed")
    return {
        "schema_version": 1,
        "workspace_id": workspace_id,
        "ready": not blockers,
        "databases": databases,
        "blockers": blockers,
        "pending_effect_findings": conflicts,
        "authority_changed": False,
    }


def discard_conflicting_effects(
    directory: Path | str, *, workspace_id: str, quarantine_file: Path | str,
) -> dict[str, Any]:
    """Explicit maintenance action on backed-up migration copies only.

    Discard obsolete failed/cancelled deliveries only when their exact target,
    owner and run already have an applied, successful Canvas receipt and log.
    Archive all affected Run rows before using normal outbox settlement. No
    Canvas mutation or receipt collision rule is relaxed by this operation.
    """
    directory = Path(directory)
    inspect_snapshots(directory, workspace_id=workspace_id)
    archive = []
    with closing(sqlite3.connect((directory / DATABASES[0]).as_uri() + "?mode=ro&immutable=1", uri=True)) as canvas, \
            closing(sqlite3.connect((directory / DATABASES[1]).as_uri() + "?mode=ro&immutable=1", uri=True)) as runs:
        canvas.row_factory = runs.row_factory = sqlite3.Row
        for effect in runs.execute("SELECT * FROM generation_effect_outbox WHERE state <> 'completed'"):
            payload = json.loads(effect["payload_json"])
            prior = canvas.execute(
                """SELECT e.*, l.final_status, r.actor_id
                   FROM applied_generation_effects e
                   JOIN canvas_logs l ON l.log_id=e.log_id AND l.canvas_id=e.canvas_id AND l.run_id=e.run_id
                   JOIN canvas_operation_receipts r ON r.operation_id=e.effect_id AND r.canvas_id=e.canvas_id
                   WHERE e.effect_id=?""", (effect["effect_id"],),
            ).fetchone()
            run = runs.execute("SELECT * FROM generation_runs WHERE run_id=?", (effect["run_id"],)).fetchone()
            if not (
                prior is not None and run is not None and prior["applied"] == 1
                and prior["final_status"] == "success" and effect["state"] == "pending"
                and effect["terminal_status"] in {"failed", "cancelled"}
                and run["status"] == effect["terminal_status"]
                and prior["actor_id"] == run["owner_id"]
                and prior["canvas_id"] == effect["canvas_id"] and prior["run_id"] == effect["run_id"]
                and prior["node_id"] == payload.get("node_id")
                and prior["generation_operation_id"] == payload.get("generation_operation_id")
                and prior["request_index"] == payload.get("request_index")
            ):
                raise CloudMigrationError("cloud_migration_conflict_not_safe_to_discard")
            entry = {"effect": dict(effect), "run": dict(run), "canvas_receipt": dict(prior), "details": {}}
            for table in ("generation_run_payloads", "generation_run_attempts", "generation_run_remote_refs", "generation_run_outputs"):
                entry["details"][table] = [dict(row) for row in runs.execute(f"SELECT * FROM {table} WHERE run_id=?", (run["run_id"],))]
            archive.append(entry)
    # Exclusive creation prevents a retry from overwriting the only audit copy.
    destination = Path(quarantine_file)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump({"workspace_id": workspace_id, "records": archive}, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    if archive:
        clock = max(time.time(), *(float(entry["effect"]["available_at"]) + 1 for entry in archive))
        store = SqliteGenerationRunStore(directory / DATABASES[1], workspace_id=workspace_id, now=lambda: clock)
        expected = {entry["effect"]["effect_id"] for entry in archive}
        for _ in archive:
            claim = store.claim_effect("cloud-migration-discard", lease_seconds=60)
            if claim is None or claim.effect_id not in expected:
                raise CloudMigrationError("cloud_migration_source_changed")
            if not store.settle_effect(claim, EffectResolution.DISCARDED, detail="migration_discarded_obsolete_failure_after_canvas_success"):
                raise CloudMigrationError("cloud_migration_source_changed")
            expected.remove(claim.effect_id)
    report = inspect_snapshots(directory, workspace_id=workspace_id)
    report["discarded_effects"] = len(archive)
    return report
