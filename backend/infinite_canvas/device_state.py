"""Device-local state that must not travel with a Workspace."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows adapter
    fcntl = None

try:
    import msvcrt
except ImportError:  # pragma: no cover - POSIX adapter
    msvcrt = None


def _lock_identity_file(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        return
    if msvcrt is not None:  # pragma: no cover - Windows adapter
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)


def _unlock_identity_file(handle) -> None:
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        elif msvcrt is not None:  # pragma: no cover - Windows adapter
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        pass


@dataclass(frozen=True)
class DeviceState:
    """Business locations owned by the current device."""

    directory: Path

    def __init__(self, directory: str | Path) -> None:
        object.__setattr__(
            self,
            "directory",
            Path(directory).expanduser().resolve(),
        )

    @property
    def provider_credentials(self) -> Path:
        """Credentials and machine-specific provider connections."""

        return self.directory / "api.env"

    @property
    def provider_connections(self) -> Path:
        """Non-secret provider endpoints and machine-specific options."""

        return self.directory / "provider-connections.json"

    @property
    def workspace_selection(self) -> Path:
        """The device's selected Workspace directory."""

        return self.directory / "workspace-storage.json"

    @property
    def launcher_state(self) -> Path:
        """Launcher state that belongs to this installation."""

        return self.directory / "launcher-state.json"

    @property
    def server_identity_file(self) -> Path:
        """Persistent identity used to recognize this installation."""

        return self.directory / "server-identity.json"

    @property
    def workspace_identity_file(self) -> Path:
        """Identity of the Workspace last opened successfully here."""

        return self.directory / "workspace-identity.json"

    @property
    def workspace_recovery_creation(self) -> Path:
        """Durable retry record for explicit Workspace creation in recovery."""

        return self.directory / "workspace-recovery-create.json"

    def workspace_identity(self) -> str:
        try:
            raw = json.loads(
                self.workspace_identity_file.read_text(encoding="utf-8-sig")
            )
            return str(uuid.UUID(str((raw or {}).get("workspace_id") or "")))
        except (OSError, ValueError, TypeError, AttributeError):
            return ""

    def remember_workspace_identity(self, workspace_id: object) -> str:
        try:
            normalized = str(uuid.UUID(str(workspace_id or "")))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("无法确认工作区身份") from exc
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            self.directory.chmod(0o700)
        except OSError:
            pass
        temporary = self.workspace_identity_file.with_name(
            f".{self.workspace_identity_file.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(
                    {"version": 1, "workspace_id": normalized},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            os.replace(temporary, self.workspace_identity_file)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return normalized

    def server_identity(self) -> str:
        self.directory.mkdir(parents=True, exist_ok=True)
        try:
            self.directory.chmod(0o700)
        except OSError:
            pass
        lock_file = self.directory / ".server-identity.lock"
        guard = lock_file.open("a+b")
        _lock_identity_file(guard)
        try:
            try:
                raw = json.loads(
                    self.server_identity_file.read_text(encoding="utf-8-sig")
                )
                value = str((raw or {}).get("server_id") or "")
                return str(uuid.UUID(value))
            except (OSError, ValueError, TypeError, AttributeError):
                pass

            server_id = str(uuid.uuid4())
            temporary = self.server_identity_file.with_name(
                f".{self.server_identity_file.name}.{uuid.uuid4().hex}.tmp"
            )
            try:
                temporary.write_text(
                    json.dumps(
                        {"version": 1, "server_id": server_id},
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                try:
                    temporary.chmod(0o600)
                except OSError:
                    pass
                os.replace(temporary, self.server_identity_file)
            finally:
                try:
                    temporary.unlink()
                except FileNotFoundError:
                    pass
            return server_id
        finally:
            _unlock_identity_file(guard)
            guard.close()


__all__ = ["DeviceState"]
