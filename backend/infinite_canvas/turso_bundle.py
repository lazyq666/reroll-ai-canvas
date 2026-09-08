"""Lossless, verifiable packing of the three Workspace SQLite snapshots.

The bundle is a staging artifact. Its lease starts inactive and neither packing
nor verifying publishes an application storage authority.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
import time
from contextlib import closing, ExitStack
from pathlib import Path

from .turso_migration import CloudMigrationError, DATABASES, _quoted, inspect_snapshots
from .turso_workspace_lease import LEASE_SCHEMA


LAYOUT_SCHEMA = """
CREATE TABLE reroll_cloud_layout (
    file_name TEXT PRIMARY KEY,
    schema_json TEXT NOT NULL,
    contents_json TEXT NOT NULL
);
"""


def table_digest(connection: sqlite3.Connection, table: str) -> dict:
    columns = connection.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
    primary = [column[1] for column in sorted(columns, key=lambda row: row[5]) if column[5]]
    order = primary or [column[1] for column in columns]
    digest = hashlib.sha256()
    count = 0
    for row in connection.execute(f"SELECT * FROM {_quoted(table)} ORDER BY " + ",".join(map(_quoted, order))):
        values = [{"blob": base64.b64encode(value).decode("ascii")} if isinstance(value, bytes) else value for value in row]
        encoded = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


def create_bundle(snapshots: Path | str, destination: Path | str, *, workspace_id: str, binding_id: str) -> dict:
    snapshots, destination = Path(snapshots), Path(destination)
    report = inspect_snapshots(snapshots, workspace_id=workspace_id)
    if not report["ready"]:
        raise CloudMigrationError("cloud_migration_source_not_ready")
    if not binding_id:
        raise CloudMigrationError("cloud_migration_binding_missing")
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    expected = {}
    try:
        with closing(sqlite3.connect(destination)) as target:
            target.execute("PRAGMA journal_mode=WAL")
            for name in DATABASES:
                with closing(sqlite3.connect((snapshots / name).resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as source:
                    schema = list(source.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,name"))
                    if any(kind not in {"table", "index"} for kind, _, _ in schema):
                        raise CloudMigrationError("cloud_migration_schema_unsupported")
                    for kind, table, sql in schema:
                        if kind == "table":
                            target.execute(sql)
                            columns = len(source.execute(f"PRAGMA table_info({_quoted(table)})").fetchall())
                            target.executemany(f"INSERT INTO {_quoted(table)} VALUES (" + ",".join("?" for _ in range(columns)) + ")", source.execute(f"SELECT * FROM {_quoted(table)}"))
                            expected[table] = table_digest(source, table)
                    for kind, _, sql in schema:
                        if kind == "index":
                            target.execute(sql)
                    target.commit()
                    if name == DATABASES[0]:
                        target.execute(LAYOUT_SCHEMA)
                    tables = {table: expected[table] for kind, table, _ in schema if kind == "table"}
                    target.execute("INSERT INTO reroll_cloud_layout VALUES (?,?,?)", (name, json.dumps(schema), json.dumps(tables)))
                    target.commit()
            target.executescript(LEASE_SCHEMA)
            target.execute("INSERT INTO reroll_workspace_lease(workspace_id,binding_id,state) VALUES (?,?,'staging')", (workspace_id, binding_id))
            target.commit()
            if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or target.execute("PRAGMA foreign_key_check").fetchall():
                raise CloudMigrationError("cloud_migration_integrity_failed")
            for table, fingerprint in expected.items():
                if table_digest(target, table) != fingerprint:
                    raise CloudMigrationError("cloud_migration_copy_mismatch")
            target.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except BaseException:
        # Preserve an incomplete artifact for diagnosis; exclusive creation
        # ensures it cannot be mistaken for a verified, overwriteable bundle.
        raise
    return {"workspace_id": workspace_id, "binding_id": binding_id, "tables": expected, "state": "staging"}


def verify_export(path: Path | str, *, workspace_id: str, binding_id: str, expected: dict) -> dict:
    """Verify an isolated Turso CLI export, including any exported WAL frames."""
    with closing(sqlite3.connect(Path(path))) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or connection.execute("PRAGMA foreign_key_check").fetchall():
            raise CloudMigrationError("cloud_migration_integrity_failed")
        row = connection.execute("SELECT workspace_id,binding_id,state FROM reroll_workspace_lease").fetchall()
        if row != [(workspace_id, binding_id, "staging")]:
            raise CloudMigrationError("cloud_migration_binding_mismatch")
        actual_tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if actual_tables != set(expected) | {"reroll_workspace_lease", "reroll_cloud_layout"}:
            raise CloudMigrationError("cloud_migration_schema_unsupported")
        for table, fingerprint in expected.items():
            if table_digest(connection, table) != fingerprint:
                raise CloudMigrationError("cloud_migration_copy_mismatch")
    return {"verified_tables": len(expected), "verified_rows": sum(item["rows"] for item in expected.values())}


def verify_staging_tables(connect, source_bundle: Path | str, *, workspace_id: str, binding_id: str, expected: dict, progress=None) -> dict:
    """Read every cloud business row using bounded, retryable read-only pages.

    Keyset pages avoid repeatedly scanning old operation receipts. Each table's
    digest must match the frozen local bundle, so a resumed read cannot silently
    accept a missing, changed, or duplicated row. Only reads are retried here.
    """
    with ExitStack() as streams:
        current = [streams.enter_context(closing(connect()))]

        def read(sql, arguments=()):
            for attempt in range(3):
                try:
                    return current[0].execute(sql, arguments).fetchall()
                except sqlite3.OperationalError as error:
                    current[0].close()
                    current[0] = streams.enter_context(closing(connect()))
                    if attempt == 2 or getattr(error, 'code', '') == 'cloud_storage_response_too_large':
                        raise
                    time.sleep(attempt + 1)

        return _verify_staging_pages(read, source_bundle, workspace_id=workspace_id, binding_id=binding_id, expected=expected, progress=progress)


def _verify_staging_pages(read, source_bundle, *, workspace_id, binding_id, expected, progress):

    def check_binding():
        if read("SELECT workspace_id,binding_id,state FROM reroll_workspace_lease") != [(workspace_id, binding_id, "staging")]:
            raise CloudMigrationError("cloud_migration_binding_mismatch")

    check_binding()
    actual_tables = {row[0] for row in read("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if actual_tables != set(expected) | {"reroll_workspace_lease", "reroll_cloud_layout"}:
        raise CloudMigrationError("cloud_migration_schema_unsupported")
    with closing(sqlite3.connect(Path(source_bundle).resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as source:
        for table, fingerprint in expected.items():
            columns = source.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
            primary = [column[1] for column in sorted(columns, key=lambda row: row[5]) if column[5]]
            if not primary:
                raise CloudMigrationError("cloud_migration_schema_unsupported")
            indexes = [[column[1] for column in columns].index(name) for name in primary]
            limit = 1024
            order = ",".join(map(_quoted, primary))
            last = None
            count = 0
            digest = hashlib.sha256()
            while True:
                where = "" if last is None else f" WHERE ({order}) > (" + ",".join("?" for _ in primary) + ")"
                try:
                    rows = read(f"SELECT * FROM {_quoted(table)}{where} ORDER BY {order} LIMIT ?", (*(() if last is None else last), limit))
                except sqlite3.OperationalError as error:
                    if getattr(error, 'code', '') == 'cloud_storage_response_too_large' and limit > 1:
                        limit //= 2
                        continue
                    raise
                for row in rows:
                    values = [{"blob": base64.b64encode(value).decode("ascii")} if isinstance(value, bytes) else value for value in row]
                    encoded = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
                    digest.update(len(encoded).to_bytes(8, "big"))
                    digest.update(encoded)
                    count += 1
                if len(rows) < limit:
                    break
                last = tuple(rows[-1][index] for index in indexes)
                if any(value is None for value in last):
                    raise CloudMigrationError("cloud_migration_schema_unsupported")
            if {"rows": count, "sha256": digest.hexdigest()} != fingerprint:
                raise CloudMigrationError("cloud_migration_copy_mismatch")
            if progress:
                progress(table, count)
    check_binding()
    return {"verified_tables": len(expected), "verified_rows": sum(item["rows"] for item in expected.values())}
