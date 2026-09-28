"""Fail-closed, offline Workspace handoff. Call only while owning the Workspace.

A seal proves a local snapshot, never OneDrive freshness. The next session must
supply the code obtained from the departing device, outside the synced folder.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from .workspace_storage import WorkspaceStorageError


class HandoffError(WorkspaceStorageError):
    def __init__(self, code: str = "invalid"):
        self.code = "handoff." + code
        super().__init__(self.code)


class WorkspaceHandoff:
    def __init__(self, root: Path, device_dir: Path, workspace_id: str, server_id: str):
        self.root = Path(root)
        self.workspace_id = workspace_id
        self.server_id = server_id
        self.control = self.root / ".infinite-canvas-service"
        self.path = self.control / "handoff.json"
        # Identity is never used as an unchecked filesystem component.
        key = hashlib.sha256(workspace_id.encode()).hexdigest()
        self.local = Path(device_dir) / "workspace-handoff" / key
        if self.local.resolve().is_relative_to(self.root.resolve()):
            raise HandoffError("invalid")
        self.receipt = self.local / "receipt.json"

    @staticmethod
    def _read(path: Path):
        if path.is_symlink():
            raise HandoffError("invalid")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            raise HandoffError("invalid") from None

    @staticmethod
    def _write(path: Path, value: dict):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as handle:
                json.dump(value, handle, sort_keys=True, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            if os.name != "nt":
                fd = os.open(path.parent, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)

    def _conflict_paths(self):
        if self.control.is_symlink():
            raise HandoffError("invalid")
        return sorted(path for path in self.control.glob("*handoff*") if path != self.path)

    def _read_record(self):
        value = self._read(self.path)
        if value is not None and (
            value.get("version") != 1
            or value.get("workspace_id") != self.workspace_id
            or value.get("state") not in {"active", "sealed"}
            or not isinstance(value.get("files"), dict)
            or not isinstance(value.get("id"), str)
            or not re.fullmatch(r"[a-f0-9]{32}", value["id"])
        ):
            raise HandoffError("invalid")
        return value

    def conflict_report(self, *, for_cleanup=False):
        """Read-only evidence. Never suggest a handoff code from a synced copy."""
        paths = [(path, "record") for path in self._conflict_paths()]
        known = {"canvas-content.sqlite3", "generation-runs.sqlite3", "batch-generation.sqlite3"}
        for name in ("data", "assets"):
            base = self.root / name
            if base.is_symlink():
                raise HandoffError("invalid")
            for directory, dirs, names in os.walk(base, followlinks=False):
                parent = Path(directory)
                dirs[:] = [child for child in dirs if not (parent / child).is_symlink()
                           and (parent / child).relative_to(self.root).as_posix()
                           not in {"data/recovery", "data/update_backups"}]
                paths.extend((parent / child, "database") for child in names
                             if child.endswith((".sqlite3", ".db")) and child not in known)
        def describe(path):
            result = {"path": path.relative_to(self.root).as_posix(), "readable": False}
            try:
                result.update(self._digest(path))
                result.update(readable=True, modified_ns=path.stat().st_mtime_ns)
            except (HandoffError, OSError):
                pass
            return result
        current = describe(self.path)
        entries = []
        for path, kind in sorted(paths):
            entry = {**describe(path), "kind": kind}
            entry["same_as_current"] = bool(entry.get("sha256") and entry.get("sha256") == current.get("sha256"))
            if for_cleanup:
                retained = self.path if kind == "record" else self._primary_for_copy(path)
                entry["can_remove"] = False
                entry["recommended_remove"] = False
                if retained is not None:
                    entry["retained"] = describe(retained)
                    entry["same_as_current"] = bool(entry.get("sha256") and entry.get("sha256") == entry["retained"].get("sha256"))
                    if kind == "database":
                        entry["comparison"] = self._compare_database(retained, path)
                        entry["can_remove"] = bool(entry["readable"] and entry["comparison"].get("valid"))
                    else:
                        entry["can_remove"] = bool(entry["readable"])
                    entry["recommended_remove"] = bool(entry["can_remove"] and entry["same_as_current"])
            entries.append(entry)
        snapshot = hashlib.sha256(json.dumps([current, entries], sort_keys=True).encode()).hexdigest()
        try:
            record = self._read_record()
        except HandoffError:
            record = None
        return {"current": current, "files": entries, "snapshot": snapshot, "can_cleanup": for_cleanup,
                "can_archive": bool(record and record["state"] == "sealed" and entries
                                    and all(item["kind"] == "record" and item["readable"] for item in entries)),
                "backup_directory": str(self.local / "conflicts")}

    def _primary_for_copy(self, path):
        if path.parent != self.root / "data":
            return None
        for name in ("canvas-content", "generation-runs", "batch-generation"):
            if re.fullmatch(re.escape(name) + r"[- (].+\.sqlite3", path.name):
                return path.with_name(name + ".sqlite3")
        return None

    @staticmethod
    def _quiet_database(path):
        if path.is_symlink() or not path.is_file():
            return False
        return all(not sidecar.is_symlink() and (not sidecar.exists() or sidecar.stat().st_size == 0)
                   for sidecar in (Path(str(path) + "-wal"), Path(str(path) + "-journal")))

    def _database_summary(self, path, primary_name):
        # immutable avoids creating SHM or touching the source. It is valid only
        # for stopped, fully checkpointed files; never ignore a nonempty WAL.
        if not self._quiet_database(path):
            raise HandoffError("wal")
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=1)) as db:
            if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise HandoffError("invalid")
            table = {"canvas-content.sqlite3": "canvases", "generation-runs.sqlite3": "generation_runs",
                     "batch-generation.sqlite3": "batches"}[primary_name]
            count = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            result = {"records": count}
            if primary_name == "canvas-content.sqlite3":
                if db.execute("SELECT value FROM store_metadata WHERE key='workspace_id'").fetchone() != (self.workspace_id,):
                    raise HandoffError("invalid")
                result["canvases"] = count
                result["titles"] = dict(db.execute("SELECT canvas_id, title FROM canvases"))
                result["nodes"] = {(canvas, node): hashlib.sha256(json.dumps([position, payload], ensure_ascii=False).encode()).hexdigest()
                                   for canvas, node, position, payload in db.execute("SELECT canvas_id, node_id, position, payload_json FROM canvas_nodes")}
            return result

    def _compare_database(self, current, copy):
        try:
            a = self._database_summary(current, current.name)
            b = self._database_summary(copy, current.name)
            comparison = {"valid": True, "current_records": a["records"], "copy_records": b["records"]}
            if "nodes" in a:
                current_only = a["nodes"].keys() - b["nodes"].keys()
                copy_only = b["nodes"].keys() - a["nodes"].keys()
                different = {key for key in a["nodes"].keys() & b["nodes"].keys() if a["nodes"][key] != b["nodes"][key]}
                comparison.update(current_canvases=a["canvases"], copy_canvases=b["canvases"],
                                  current_nodes=len(a["nodes"]), copy_nodes=len(b["nodes"]),
                                  current_only=len(current_only), copy_only=len(copy_only), changed=len(different))
                affected = sorted({key[0] for key in current_only | copy_only | different})
                comparison["affected_canvases"] = [a["titles"].get(key) or b["titles"].get(key) or key for key in affected[:20]]
            return comparison
        except (sqlite3.Error, OSError, HandoffError):
            return {"valid": False}

    def cleanup_conflicts(self, snapshot, selected):
        """Explicitly keep current databases, back up selected copies, then retire
        them. Caller must hold occupation, stop writers and serialize maintenance.
        No synced candidate is promoted to become a primary database.
        """
        record = self._read_record()
        receipt = self._read(self.receipt)
        if record is None:
            if receipt:
                raise HandoffError("missing")
        elif (record["state"] != "active" or record.get("server_id") != self.server_id or not receipt
              or receipt.get("state") != "active" or not record.get("session")
              or receipt.get("session") != record["session"] or receipt.get("id") != record["id"]):
            raise HandoffError("unclean")
        self.check_databases()
        report = self.conflict_report(for_cleanup=True)
        if not snapshot or report["snapshot"] != snapshot:
            raise HandoffError("conflictsChanged")
        candidates = {item["path"]: item for item in report["files"]}
        if (not selected or len(set(selected)) != len(selected)
                or any(path not in candidates or not candidates[path].get("can_remove") for path in selected)):
            raise HandoffError("conflictsManual")
        primary_paths = self._databases()
        if any(not self._quiet_database(path) for path in primary_paths):
            raise HandoffError("wal")
        if self.path.exists():
            primary_paths.append(self.path)
        originals = {path: self._digest(path) for path in primary_paths}
        originals.update({self.root / path: {key: candidates[path][key] for key in ("sha256", "size")} for path in selected})
        backup = self.local / "conflicts" / uuid.uuid4().hex
        self._write(backup / "report.json", {**report, "selected": selected})
        # All originals, including current databases, are durable before removal.
        for source, digest in originals.items():
            target = backup / source.relative_to(self.root)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            with target.open("rb") as handle:
                os.fsync(handle.fileno())
            if self._digest(target) != digest:
                raise HandoffError("conflictsChanged")
            self._write(target.parent / ".backup-durable.json", {"file": target.name})
        if (self.conflict_report(for_cleanup=True)["snapshot"] != snapshot
                or self._read_record() != record
                or any(self._digest(path) != digest for path, digest in originals.items())):
            raise HandoffError("conflictsChanged")
        self._write(backup / "ready.json", {"selected": selected})
        for relative in selected:
            source = self.root / relative
            # Staging stays beside its source (also works across mount points).
            # Its handoff name is recognised even if this operation is interrupted.
            staged = source.with_name(".handoff-removed-" + uuid.uuid4().hex + source.suffix)
            source.rename(staged)
            if self._digest(staged) != originals[source]:
                raise HandoffError("conflictsChanged")
            staged.unlink()
        self._write(backup / "completed.json", {"removed": selected})
        return {"backup_directory": str(backup), "removed": selected}

    def archive_conflicts(self, expected_id: str, snapshot: str):
        """Caller holds the occupation OS lock. Archive only after verifying the seal.

        Rename each source to a detectable staging name before copying, so a sync
        replacement at its old name cannot be deleted. Any interrupted staging
        file remains a conflict, and all completed backups stay in Device State.
        """
        report = self.conflict_report()
        if not snapshot or snapshot != report["snapshot"]:
            raise HandoffError("conflictsChanged")
        if not report["can_archive"]:
            raise HandoffError("conflictsManual")
        record = self._read_record()
        if not record or record["state"] != "sealed":
            raise HandoffError("conflictsChanged")
        self._validate_sealed(record, expected_id)
        if self.inventory() != record["files"] or self._read_record() != record:
            raise HandoffError("changed")
        if self.conflict_report()["snapshot"] != snapshot:
            raise HandoffError("conflictsChanged")
        backup = self.local / "conflicts" / uuid.uuid4().hex
        backup.mkdir(parents=True, exist_ok=False)
        self._write(backup / "report.json", report)
        shutil.copyfile(self.path, backup / "handoff.json")
        with (backup / "handoff.json").open("rb") as handle:
            os.fsync(handle.fileno())
        if self._digest(backup / "handoff.json")["sha256"] != report["current"]["sha256"]:
            raise HandoffError("conflictsChanged")
        for entry in report["files"]:
            source = self.root / entry["path"]
            staged = self.control / (".handoff-archive-" + uuid.uuid4().hex)
            source.rename(staged)
            # Never unlink a synced replacement at the original source path.
            if self._digest(staged)["sha256"] != entry["sha256"]:
                raise HandoffError("conflictsChanged")
            destination = backup / source.name
            shutil.copyfile(staged, destination)
            with destination.open("rb") as handle:
                os.fsync(handle.fileno())
            if self._digest(destination) != self._digest(staged):
                raise HandoffError("conflictsChanged")
            # Persist the directory entries before retiring the staged copy.
            self._write(backup / "progress.json", {"last_preserved": source.name})
            staged.unlink()
        if self.read() != record:
            raise HandoffError("conflictsChanged")
        return str(backup)

    def read(self):
        if self._conflict_paths():
            raise HandoffError("conflict")
        return self._read_record()

    @staticmethod
    def _digest(path: Path):
        if path.is_symlink() or not path.is_file():
            raise HandoffError("invalid")
        before = path.stat()
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise HandoffError("changed")
        return {"sha256": digest.hexdigest(), "size": after.st_size}

    def inventory(self):
        files = {}
        excluded = {"data/recovery", "data/update_backups"}
        for name in ("data", "assets"):
            base = self.root / name
            if base.is_symlink() or not base.is_dir():
                raise HandoffError("invalid")
            def unreadable(_error):
                raise HandoffError("invalid")
            for directory, dirs, names in os.walk(base, followlinks=False, onerror=unreadable):
                parent = Path(directory)
                for child in list(dirs):
                    path = parent / child
                    relative = path.relative_to(self.root).as_posix()
                    if path.is_symlink():
                        raise HandoffError("invalid")
                    if relative in excluded:
                        dirs.remove(child)
                for child in names:
                    path = parent / child
                    relative = path.relative_to(self.root).as_posix()
                    if child in {".DS_Store", "Thumbs.db"}:
                        continue
                    database_names = {"canvas-content.sqlite3", "generation-runs.sqlite3", "batch-generation.sqlite3"}
                    if child.endswith((".sqlite3", ".db")) and child not in database_names:
                        raise HandoffError("conflict")
                    # Sidecars are inspected separately. Never delete a WAL.
                    if child.endswith(("-wal", "-shm", "-journal")):
                        if path.is_symlink() or (not child.endswith("-shm") and path.stat().st_size):
                            raise HandoffError("wal")
                        continue
                    if relative.startswith("data/auth.db"):
                        raise HandoffError("invalid")
                    files[relative] = self._digest(path)
        files[".infinite-canvas-workspace.json"] = self._digest(
            self.root / ".infinite-canvas-workspace.json"
        )
        return files

    def _databases(self):
        from .storage_authority import resolve_storage_authority, StorageAuthorityError
        try:
            authority = resolve_storage_authority(
                self.root / "data/storage-authority.json", self.workspace_id,
                supported_modes=("json", "sqlite", "turso"),
            )
        except StorageAuthorityError:
            raise HandoffError("invalid") from None
        if authority.mode != "sqlite":
            raise HandoffError("unsupported")
        paths = [self.root / "data" / name for name in (
            "canvas-content.sqlite3", "generation-runs.sqlite3", "batch-generation.sqlite3"
        )]
        if any(not path.is_file() for path in paths[:2]):
            raise HandoffError("invalid")
        return [path for path in paths if path.exists()]

    def check_databases(self, *, checkpoint=False):
        from .generation_run_store import TERMINAL_RUN_STATUSES
        for path in self._databases():
            if path.is_symlink():
                raise HandoffError("invalid")
            try:
                mode = "rw" if checkpoint else "ro"
                with closing(sqlite3.connect(path.as_uri() + "?mode=" + mode, uri=True, timeout=1)) as db:
                    if checkpoint:
                        result = db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                        if result[0] != 0:
                            raise HandoffError("wal")
                    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                        raise HandoffError("invalid")
                    if db.execute("PRAGMA foreign_key_check").fetchone():
                        raise HandoffError("invalid")
                    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    required = {
                        "canvas-content.sqlite3": {"canvases", "canvas_nodes", "canvas_connections"},
                        "generation-runs.sqlite3": {"generation_runs", "generation_effect_outbox", "generation_publication_receipts"},
                        "batch-generation.sqlite3": {"batches", "batch_tasks"},
                    }[path.name]
                    if not required.issubset(tables):
                        raise HandoffError("invalid")
                    metadata = {"canvas-content.sqlite3": "store_metadata", "generation-runs.sqlite3": "generation_run_store_metadata"}.get(path.name)
                    if metadata:
                        if metadata not in tables or db.execute(f"SELECT value FROM {metadata} WHERE key='workspace_id'").fetchone() != (self.workspace_id,):
                            raise HandoffError("invalid")
                    if "generation_runs" in tables:
                        marks = ",".join("?" for _ in TERMINAL_RUN_STATUSES)
                        if db.execute(f"SELECT 1 FROM generation_runs WHERE status NOT IN ({marks}) LIMIT 1", sorted(TERMINAL_RUN_STATUSES)).fetchone():
                            raise HandoffError("tasks")
                    for table in ("generation_effect_outbox", "generation_publication_receipts"):
                        if table in tables and db.execute(f"SELECT 1 FROM {table} WHERE state != 'completed' LIMIT 1").fetchone():
                            raise HandoffError("tasks")
                    if "batch_tasks" in tables and db.execute("SELECT 1 FROM batch_tasks WHERE status NOT IN ('succeeded','failed','cancelled') LIMIT 1").fetchone():
                        raise HandoffError("tasks")
            except sqlite3.Error:
                raise HandoffError("invalid") from None

    def _validate_sealed(self, record, expected_id):
        receipt = self._read(self.receipt)
        if not expected_id:
            raise HandoffError("required")
        if expected_id.strip().lower() != record["id"]:
            raise HandoffError("code")
        if receipt and receipt.get("id") == record["id"] and receipt.get("state") == "active":
            raise HandoffError("stale")
        if self.inventory() != record["files"]:
            raise HandoffError("changed")
        self.check_databases()

    def acquire(self, expected_id: str = ""):
        """Validate before Store constructors or any business writes run."""
        record = self.read()
        receipt = self._read(self.receipt)
        if record is None:
            if receipt:
                raise HandoffError("missing")
            return  # Explicit opt-in; existing non-handoff Workspaces are unchanged.
        if record["state"] == "active":
            if (record.get("server_id") != self.server_id or not receipt
                    or not record.get("session") or receipt.get("id") != record["id"]
                    or receipt.get("session") != record.get("session")):
                raise HandoffError("unclean")
            if receipt.get("state") == "activating":
                self._write(self.receipt, {**receipt, "state": "active"})
            return  # Same installation may recover its interrupted session.
        self._validate_sealed(record, expected_id)
        # Verify again: SQLite and the sync client must not change files during validation.
        if self.inventory() != record["files"] or self.read() != record:
            raise HandoffError("changed")
        active = {**record, "state": "active", "server_id": self.server_id, "session": uuid.uuid4().hex}
        receipt = {"id": record["id"], "state": "activating", "session": active["session"]}
        self._write(self.receipt, receipt)
        self._write(self.path, active)
        self._write(self.receipt, {**receipt, "state": "active"})

    def seal(self):
        """Publish only after all writers have stopped; keep original files on failure."""
        previous = self.read()
        if previous and previous["state"] == "sealed":
            backup = self.local / "backups" / previous["id"] / "manifest.json"
            if (previous.get("server_id") != self.server_id
                    or self._read(backup) != previous or self.inventory() != previous["files"]):
                raise HandoffError("closed")
            self._write(self.receipt, {"id": previous["id"], "state": "sealed"})
            return {"id": previous["id"], "file_count": len(previous["files"]), "state": "sealed"}
        self.acquire()  # A synced foreign active session cannot be silently sealed.
        self.check_databases(checkpoint=True)
        files = self.inventory()
        handoff_id = uuid.uuid4().hex
        backup = self.local / "backups" / handoff_id
        for relative in files:
            if relative.startswith("assets/"):
                continue
            destination = backup / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / relative, destination)
            with destination.open("rb") as handle:
                os.fsync(handle.fileno())
            if self._digest(destination) != files[relative]:
                raise HandoffError("changed")
        record = {"version": 1, "workspace_id": self.workspace_id, "state": "sealed",
                  "id": handoff_id, "parent": previous["id"] if previous else None,
                  "server_id": self.server_id, "files": files}
        if self.inventory() != files or self.read() != previous:
            raise HandoffError("changed")
        self._write(backup / "manifest.json", record)
        self._write(self.path, record)  # Last publish point; cloud delivery order is irrelevant.
        self._write(self.receipt, {"id": handoff_id, "state": "sealed"})
        return {"id": handoff_id, "file_count": len(files), "state": "sealed"}
