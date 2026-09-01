"""Stable installation-owned account state and legacy account migration.

``InstanceState`` is the only module that knows where the active account
database lives.  It also hides the complete legacy Workspace migration:
SQLite-consistent snapshotting, validation, recovery publication, activation,
and source cleanup all happen behind :meth:`prepare_auth_database`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional


_REQUIRED_AUTH_TABLES = (
    "users",
    "sessions",
    "account_applications",
    "canvas_shares",
    "audit_events",
)
_OPTIONAL_AUTH_TABLES = ("user_canvas_view_states",)


class InstanceStateError(RuntimeError):
    """Raised when stable account state cannot be safely selected."""


@dataclass(frozen=True)
class AuthDatabasePreparation:
    """Observable result of resolving the installation account authority."""

    database_path: Path
    migration_status: str
    recovery_artifact: str = ""


def _private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(0o700)
    except OSError:
        pass


def _private_file(path: Path) -> None:
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _auth_database_snapshot(path: Path) -> Optional[dict[str, int]]:
    """Return validated record counts without creating or repairing a DB."""

    if not path.is_file():
        return None
    try:
        uri = f"{path.resolve().as_uri()}?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=5) as connection:
            connection.execute("PRAGMA query_only = ON")
            integrity = connection.execute("PRAGMA quick_check").fetchone()
            if not integrity or str(integrity[0]).lower() != "ok":
                return None
            tables = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            if not set(_REQUIRED_AUTH_TABLES).issubset(tables):
                return None
            if connection.execute("PRAGMA foreign_key_check").fetchone():
                return None
            included = _REQUIRED_AUTH_TABLES + tuple(
                table for table in _OPTIONAL_AUTH_TABLES if table in tables
            )
            return {
                table: int(
                    connection.execute(
                        f'SELECT COUNT(*) FROM "{table}"'
                    ).fetchone()[0]
                )
                for table in included
            }
    except (OSError, sqlite3.Error, TypeError, ValueError):
        return None


def _database_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_workspace_key(workspace_id: object) -> str:
    raw = str(workspace_id or "").strip()
    try:
        return str(uuid.UUID(raw))
    except (ValueError, TypeError, AttributeError):
        return "unknown-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


class InstanceState:
    """Resolve and migrate stable installation-owned account state.

    The supplied root is Device State's operating-system application directory;
    Instance State is a separate semantic child with an independent lifecycle.
    ``INFINITE_CANVAS_INSTANCE_STATE_DIR`` is an explicit test/administrator
    adapter and never changes the selected Workspace.
    """

    def __init__(
        self,
        device_state_root: Path | str,
        *,
        replace: Callable[[Path, Path], object] = os.replace,
    ) -> None:
        self._device_state_directory = (
            Path(device_state_root).expanduser().resolve()
        )
        override = str(
            os.getenv("INFINITE_CANVAS_INSTANCE_STATE_DIR") or ""
        ).strip()
        self.directory = (
            Path(os.path.expandvars(os.path.expanduser(override))).resolve()
            if override
            else self._device_state_directory / "instance-state"
        )
        self._replace = replace

    @property
    def auth_database(self) -> Path:
        return self.directory / "auth.db"

    @property
    def recovery_directory(self) -> Path:
        return self.directory / "account-recovery"

    @property
    def migration_status_file(self) -> Path:
        return self.directory / "legacy-account-migration.json"

    @property
    def _legacy_setup_database(self) -> Path:
        """Pre-Instance account database used by an unconfigured old app."""

        return self._device_state_directory / "setup" / "auth.db"

    def legacy_account_status(
        self,
        workspace_directory: Path | str,
    ) -> str:
        """Classify legacy account data without changing the Workspace."""

        database = (
            Path(workspace_directory).expanduser().resolve()
            / "data"
            / "auth.db"
        )
        if not database.exists():
            return "absent"
        snapshot = _auth_database_snapshot(database)
        if snapshot is None:
            return "invalid"
        return "accounts" if snapshot.get("users", 0) > 0 else "empty"

    def _write_status(
        self,
        *,
        status: str,
        operation: str,
        workspace_id: str,
        artifact: str = "",
        reason: str = "",
    ) -> None:
        _private_directory(self.directory)
        payload = {
            "version": 1,
            "status": str(status),
            "operation": str(operation),
            "workspace_id": _safe_workspace_key(workspace_id),
            "recovery_artifact": Path(artifact).name if artifact else "",
            "reason": str(reason or "")[:120],
        }
        temporary = self.migration_status_file.with_name(
            f".{self.migration_status_file.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            _private_file(temporary)
            self._replace(temporary, self.migration_status_file)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _consistent_snapshot(source: Path, destination: Path) -> dict[str, int]:
        source_snapshot = _auth_database_snapshot(source)
        if source_snapshot is None:
            raise InstanceStateError("legacy account database is not valid")
        uri = f"{source.resolve().as_uri()}?mode=ro"
        with (
            sqlite3.connect(uri, uri=True, timeout=5) as source_connection,
            sqlite3.connect(str(destination), timeout=5) as target_connection,
        ):
            source_connection.execute("PRAGMA query_only = ON")
            source_connection.backup(target_connection)
        _private_file(destination)
        if _auth_database_snapshot(destination) != source_snapshot:
            raise InstanceStateError("legacy account snapshot verification failed")
        return source_snapshot

    @staticmethod
    def _database_family(database: Path) -> tuple[Path, Path, Path]:
        return (
            database,
            Path(f"{database}-wal"),
            Path(f"{database}-shm"),
        )

    @classmethod
    def _cleanup_database_family(cls, database: Path) -> None:
        family = cls._database_family(database)
        # Delete the authoritative file last.  If sidecar cleanup fails, the
        # source database remains available for an idempotent retry.
        for candidate in (*family[1:], family[0]):
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass

    @classmethod
    def _cleanup_database_sidecars(cls, database: Path) -> None:
        for candidate in cls._database_family(database)[1:]:
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass

    def _cleanup_internal_sqlite_debris(self) -> None:
        """Remove only private migration/recovery files that cannot be active."""

        if self.directory.is_dir():
            for temporary in self.directory.glob(".auth.*.db"):
                self._cleanup_database_family(temporary)
            for pattern in (".auth.*.db-wal", ".auth.*.db-shm"):
                for sidecar in self.directory.glob(pattern):
                    try:
                        sidecar.unlink()
                    except FileNotFoundError:
                        pass
        if self.recovery_directory.is_dir():
            for temporary in self.recovery_directory.glob(".*.tmp"):
                self._cleanup_database_family(temporary)
            for pattern in (".*.tmp-wal", ".*.tmp-shm", "*.db-wal", "*.db-shm"):
                for sidecar in self.recovery_directory.glob(pattern):
                    try:
                        sidecar.unlink()
                    except FileNotFoundError:
                        pass

    def _publish_recovery(
        self,
        snapshot_database: Path,
        *,
        workspace_id: str,
        prefix: str,
        expected: dict[str, int],
    ) -> Path:
        _private_directory(self.recovery_directory)
        digest = _database_digest(snapshot_database)[:16]
        artifact = self.recovery_directory / (
            f"{prefix}-{_safe_workspace_key(workspace_id)}-{digest}.db"
        )
        if artifact.is_file():
            try:
                if _auth_database_snapshot(artifact) != expected:
                    raise InstanceStateError("existing recovery artifact is invalid")
                return artifact
            finally:
                self._cleanup_database_sidecars(artifact)
        temporary = artifact.with_name(f".{artifact.name}.{uuid.uuid4().hex}.tmp")
        try:
            shutil.copy2(snapshot_database, temporary)
            _private_file(temporary)
            if _auth_database_snapshot(temporary) != expected:
                raise InstanceStateError("recovery artifact verification failed")
            self._replace(temporary, artifact)
            if _auth_database_snapshot(artifact) != expected:
                raise InstanceStateError("published recovery artifact is invalid")
            return artifact
        finally:
            self._cleanup_database_family(temporary)
            self._cleanup_database_sidecars(artifact)

    def _seed_from_legacy_database(
        self,
        legacy_database: Path,
        *,
        workspace_id: str,
        recovery_prefix: str = "seed",
        status_operation: str = "seed",
    ) -> AuthDatabasePreparation:
        _private_directory(self.directory)
        _private_directory(self.recovery_directory)
        snapshot_database = self.directory / (
            f".auth.seed-snapshot.{uuid.uuid4().hex}.db"
        )
        active_temporary = self.directory / (
            f".auth.activate.{uuid.uuid4().hex}.db"
        )
        published_active = False
        activation_verified = False
        try:
            expected = self._consistent_snapshot(
                legacy_database,
                snapshot_database,
            )
            if expected.get("users", 0) < 1:
                raise InstanceStateError("legacy account database has no users")
            recovery = self._publish_recovery(
                snapshot_database,
                workspace_id=workspace_id,
                prefix=recovery_prefix,
                expected=expected,
            )
            shutil.copy2(snapshot_database, active_temporary)
            _private_file(active_temporary)
            if _auth_database_snapshot(active_temporary) != expected:
                raise InstanceStateError("Instance State target verification failed")
            self._replace(active_temporary, self.auth_database)
            published_active = True
            if _auth_database_snapshot(self.auth_database) != expected:
                raise InstanceStateError("Instance State activation verification failed")
            try:
                if _auth_database_snapshot(recovery) != expected:
                    raise InstanceStateError(
                        "Instance State recovery verification failed"
                    )
            finally:
                self._cleanup_database_sidecars(recovery)
            activation_verified = True
            self._cleanup_database_family(legacy_database)
            try:
                self._write_status(
                    status="completed",
                    operation=status_operation,
                    workspace_id=workspace_id,
                    artifact=recovery.name,
                )
            except Exception:
                logging.warning(
                    "Account migration completed but status publication failed"
                )
            return AuthDatabasePreparation(
                self.auth_database,
                "migrated",
                recovery.name,
            )
        except Exception as exc:
            if published_active and not activation_verified:
                try:
                    self.auth_database.unlink()
                except FileNotFoundError:
                    pass
            try:
                self._write_status(
                    status="recoverable",
                    operation=status_operation,
                    workspace_id=workspace_id,
                    reason=type(exc).__name__,
                )
            except Exception:
                pass
            if isinstance(exc, InstanceStateError):
                raise
            raise InstanceStateError(
                "无法安全迁移 legacy account data；源数据保持不变"
            ) from exc
        finally:
            for temporary in (snapshot_database, active_temporary):
                self._cleanup_database_family(temporary)

    def _seed_from_workspace(
        self,
        legacy_database: Path,
        *,
        workspace_id: str,
    ) -> AuthDatabasePreparation:
        return self._seed_from_legacy_database(
            legacy_database,
            workspace_id=workspace_id,
        )

    def _archive_database(
        self,
        database: Path,
        *,
        workspace_id: str,
        prefix: str = "legacy",
    ) -> str:
        snapshot_database = self.directory / (
            f".auth.archive-snapshot.{uuid.uuid4().hex}.db"
        )
        try:
            expected = self._consistent_snapshot(database, snapshot_database)
            artifact = self._publish_recovery(
                snapshot_database,
                workspace_id=workspace_id,
                prefix=prefix,
                expected=expected,
            )
            recovery = self.recovery_directory / artifact.name
            try:
                if _auth_database_snapshot(recovery) != expected:
                    raise InstanceStateError(
                        "legacy recovery verification failed"
                    )
            finally:
                self._cleanup_database_sidecars(recovery)
            self._cleanup_database_family(database)
            return artifact.name
        except Exception as exc:
            if isinstance(exc, InstanceStateError):
                raise
            raise InstanceStateError(
                "legacy account recovery publication failed"
            ) from exc
        finally:
            self._cleanup_database_family(snapshot_database)

    def _archive_legacy_setup_accounts(self, *, workspace_id: str) -> str:
        database = self._legacy_setup_database
        if not database.exists():
            return ""
        if not database.is_file():
            raise InstanceStateError(
                "legacy setup account data cannot be safely archived"
            )
        artifact = self._archive_database(
            database,
            workspace_id=workspace_id,
            prefix="legacy-setup",
        )
        try:
            self._write_status(
                status="completed",
                operation="archive-setup",
                workspace_id=workspace_id,
                artifact=artifact,
            )
        except Exception:
            logging.warning(
                "Legacy setup account archive completed but status publication failed"
            )
        return artifact

    def _archive_legacy_setup_accounts_best_effort(
        self,
        *,
        workspace_id: str,
    ) -> str:
        try:
            return self._archive_legacy_setup_accounts(
                workspace_id=workspace_id,
            )
        except InstanceStateError as exc:
            logging.warning(
                "Legacy setup account data remains recoverable: %s",
                type(exc).__name__,
            )
            try:
                self._write_status(
                    status="recoverable",
                    operation="archive-setup",
                    workspace_id=workspace_id,
                    reason=type(exc).__name__,
                )
            except Exception:
                pass
            return ""

    def _archive_workspace_legacy_accounts(
        self,
        workspace_directory: Path,
        *,
        workspace_id: str,
    ) -> str:
        legacy_database = workspace_directory / "data" / "auth.db"
        artifact = ""
        if legacy_database.exists():
            if not legacy_database.is_file():
                raise InstanceStateError(
                    "legacy account data cannot be safely archived"
                )
            artifact = self._archive_database(
                legacy_database,
                workspace_id=workspace_id,
            )

        recovery = workspace_directory / "data" / "recovery"
        recovery_failure = False
        if recovery.is_dir():
            for candidate in sorted(recovery.glob("auth*.db")):
                if not candidate.is_file():
                    continue
                try:
                    self._archive_database(
                        candidate,
                        workspace_id=workspace_id,
                        prefix="legacy-recovery",
                    )
                except InstanceStateError:
                    recovery_failure = True
                    logging.warning(
                        "Legacy account recovery artifact could not be archived"
                    )
        if recovery_failure:
            self._write_status(
                status="recoverable",
                operation="archive-recovery",
                workspace_id=workspace_id,
                artifact=artifact,
                reason="invalid_legacy_recovery",
            )
        elif artifact:
            self._write_status(
                status="completed",
                operation="archive",
                workspace_id=workspace_id,
                artifact=artifact,
            )
        return artifact

    def prepare_auth_database(
        self,
        *,
        workspace_directory: Path | str | None = None,
        workspace_id: str = "",
    ) -> AuthDatabasePreparation:
        """Select the stable auth DB and safely handle legacy Workspace data.

        A valid Instance account database is always authoritative.  A legacy
        Workspace database may seed it only while Instance State has no users;
        otherwise the legacy database is recovery-only and is never merged.
        """

        _private_directory(self.directory)
        self._cleanup_internal_sqlite_debris()
        active_exists = self.auth_database.exists()
        active_snapshot = _auth_database_snapshot(self.auth_database)
        if active_exists and active_snapshot is None:
            try:
                empty = (
                    self.auth_database.is_file()
                    and self.auth_database.stat().st_size == 0
                )
            except OSError:
                empty = False
            if not empty:
                raise InstanceStateError(
                    "Instance State 账号库无法验证，请从恢复副本受控恢复"
                )

        workspace = (
            Path(workspace_directory).expanduser().resolve()
            if workspace_directory is not None
            else None
        )
        legacy_database = (
            workspace / "data" / "auth.db" if workspace is not None else None
        )
        active_has_accounts = bool(
            active_snapshot is not None and active_snapshot.get("users", 0) > 0
        )

        if active_has_accounts:
            artifact = self._archive_legacy_setup_accounts_best_effort(
                workspace_id=workspace_id,
            )
            if workspace is not None:
                try:
                    workspace_artifact = self._archive_workspace_legacy_accounts(
                        workspace,
                        workspace_id=workspace_id,
                    )
                    artifact = workspace_artifact or artifact
                except InstanceStateError as exc:
                    logging.warning(
                        "Legacy account data remains recoverable in Workspace: %s",
                        type(exc).__name__,
                    )
                    try:
                        self._write_status(
                            status="recoverable",
                            operation="archive",
                            workspace_id=workspace_id,
                            reason=type(exc).__name__,
                        )
                    except Exception:
                        pass
            return AuthDatabasePreparation(
                self.auth_database,
                "existing",
                artifact,
            )

        if legacy_database is not None and legacy_database.exists():
            legacy_snapshot = _auth_database_snapshot(legacy_database)
            if legacy_snapshot is None:
                try:
                    self._write_status(
                        status="recoverable",
                        operation="seed",
                        workspace_id=workspace_id,
                        reason="invalid_legacy_database",
                    )
                except Exception:
                    pass
                raise InstanceStateError(
                    "legacy account data 无法验证；源数据保持不变"
                )
            if legacy_snapshot.get("users", 0) > 0:
                prepared = self._seed_from_workspace(
                    legacy_database,
                    workspace_id=workspace_id,
                )
                self._archive_legacy_setup_accounts_best_effort(
                    workspace_id=workspace_id,
                )
                return prepared
            self._archive_workspace_legacy_accounts(
                workspace,
                workspace_id=workspace_id,
            )

        setup_database = self._legacy_setup_database
        if setup_database.exists():
            setup_snapshot = _auth_database_snapshot(setup_database)
            if setup_snapshot is None:
                try:
                    self._write_status(
                        status="recoverable",
                        operation="seed-setup",
                        workspace_id=workspace_id,
                        reason="invalid_legacy_setup_database",
                    )
                except Exception:
                    pass
                raise InstanceStateError(
                    "legacy setup account data 无法验证；源数据保持不变"
                )
            if setup_snapshot.get("users", 0) > 0:
                return self._seed_from_legacy_database(
                    setup_database,
                    workspace_id=workspace_id,
                    recovery_prefix="seed-setup",
                    status_operation="seed-setup",
                )
            self._archive_legacy_setup_accounts(
                workspace_id=workspace_id,
            )

        return AuthDatabasePreparation(self.auth_database, "empty")


__all__ = [
    "AuthDatabasePreparation",
    "InstanceState",
    "InstanceStateError",
]
