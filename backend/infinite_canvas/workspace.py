"""Unified business entrypoint for one selected Workspace."""

from __future__ import annotations

import os
import platform
import re
import shutil
import json
import hashlib
import subprocess
import threading
import time
import uuid
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Callable, Optional

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows adapter
    fcntl = None

try:
    import msvcrt
except ImportError:  # pragma: no cover - POSIX adapter
    msvcrt = None

from .workspace_storage import (
    WorkspacePaths,
    WorkspaceStorage,
    WorkspaceStorageError,
)

_OCCUPATION_DIRECTORY = ".infinite-canvas-service"
_OCCUPATION_GUARD = "writer.lock"
_OCCUPATION_METADATA = "occupation.json"
_WORKSPACE_IDENTITY_FILE = ".infinite-canvas-workspace.json"
_DEVICE_LOCAL_WORKSPACE_DIRECTORIES = {
    ("data", "media_previews"),
    ("data", "models"),
}
_ACTIVE_OCCUPATIONS: dict[Path, str] = {}
_ACTIVE_OCCUPATIONS_LOCK = threading.Lock()
_NETWORK_FILESYSTEM_MARKERS = (
    "smb",
    "cifs",
    "nfs",
    "afp",
    "webdav",
    "sshfs",
    "rclone",
    "9p",
)
_SYNCED_LOCAL_PATH_MARKERS = (
    "/library/cloudstorage/",
    "/library/mobile documents/",
    "/onedrive/",
    "/dropbox/",
    "/google drive/",
)


def _device_local_workspace_path(root: Path, candidate: Path) -> bool:
    try:
        parts = candidate.relative_to(root).parts
    except ValueError:
        return False
    device_local = (
        parts == (_OCCUPATION_DIRECTORY,)
        or parts in _DEVICE_LOCAL_WORKSPACE_DIRECTORIES
    )
    if device_local:
        return True
    if parts in {
        ("data", "auth.db"),
        ("data", "auth.db-wal"),
        ("data", "auth.db-shm"),
    }:
        return True
    return bool(
        len(parts) >= 3
        and parts[:2] == ("data", "recovery")
        and parts[-1].lower().startswith("auth")
        and any(
            parts[-1].lower().endswith(suffix)
            for suffix in (".db", ".db-wal", ".db-shm")
        )
    )


def _try_exclusive_file_lock(handle: BinaryIO) -> bool:
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        if msvcrt is not None:  # pragma: no cover - Windows adapter
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
    except (BlockingIOError, OSError):
        return False
    return False


def _release_file_lock(handle: BinaryIO) -> None:
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        elif msvcrt is not None:  # pragma: no cover - Windows adapter
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        pass


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return True


def _read_occupation_metadata(path: Path) -> Optional[dict[str, object]]:
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _write_occupation_metadata(
    path: Path,
    payload: dict[str, object],
) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@dataclass(frozen=True)
class WorkspaceLocationCapability:
    """Storage support classification for a proposed Workspace location."""

    kind: str
    label: str
    supported: bool
    warnings: tuple[str, ...] = ()


def _filesystem_type(path: Path) -> str:
    system = platform.system()
    if system == "Windows":  # pragma: no cover - Windows adapter
        return ""
    command = (
        ["/usr/bin/stat", "-f", "%T", str(path)]
        if system == "Darwin"
        else [shutil.which("stat") or "stat", "-f", "-c", "%T", str(path)]
    )
    try:
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return (
        completed.stdout.strip().lower()
        if completed.returncode == 0
        else ""
    )


def _default_storage_capability(path: Path) -> WorkspaceLocationCapability:
    raw = str(path)
    normalized = raw.replace("\\", "/").lower()
    system = platform.system()
    filesystem = _filesystem_type(path)

    if (
        raw.startswith("\\\\")
        or raw.startswith("//")
        or any(marker in filesystem for marker in _NETWORK_FILESYSTEM_MARKERS)
        or "fuse" in filesystem
    ):
        return WorkspaceLocationCapability(
            kind="network",
            label="NAS 或局域网磁盘",
            supported=False,
        )

    if system == "Windows":  # pragma: no cover - Windows adapter
        try:
            import ctypes

            drive = path.drive + "\\"
            drive_type = ctypes.windll.kernel32.GetDriveTypeW(drive)
            if drive_type == 4:
                return WorkspaceLocationCapability(
                    kind="network",
                    label="NAS 或局域网磁盘",
                    supported=False,
                )
            if drive_type not in {2, 3}:
                return WorkspaceLocationCapability(
                    kind="unknown",
                    label="无法确认的存储位置",
                    supported=False,
                )
            if drive_type == 2:
                return WorkspaceLocationCapability(
                    kind="external",
                    label="外接磁盘",
                    supported=True,
                    warnings=("搬家期间请保持外接磁盘连接。",),
                )
        except (AttributeError, OSError):
            return WorkspaceLocationCapability(
                kind="unknown",
                label="无法确认的存储位置",
                supported=False,
            )

    if any(marker in f"{normalized}/" for marker in _SYNCED_LOCAL_PATH_MARKERS):
        return WorkspaceLocationCapability(
            kind="synchronized_local",
            label="已同步到本机的云盘目录",
            supported=True,
            warnings=(
                "请确认目标目录已经完整同步到本机，搬家期间保持同步工具运行。",
            ),
        )

    external = (
        (system == "Darwin" and normalized.startswith("/volumes/"))
        or (
            system == "Linux"
            and normalized.startswith(("/media/", "/run/media/", "/mnt/"))
        )
    )
    if external:
        return WorkspaceLocationCapability(
            kind="external",
            label="外接磁盘",
            supported=True,
            warnings=("搬家期间请保持外接磁盘连接。",),
        )
    return WorkspaceLocationCapability(
        kind="local",
        label="本机磁盘",
        supported=True,
    )


class WorkspaceOccupation:
    """Held single-writer ownership for one Workspace."""

    def __init__(
        self,
        *,
        directory: Path,
        server_id: str,
        instance_id: str,
        metadata_path: Path,
        guard: BinaryIO,
    ) -> None:
        self.directory = directory
        self.server_id = server_id
        self.instance_id = instance_id
        self._metadata_path = metadata_path
        self._guard = guard
        self.active = True

    def release(self) -> None:
        if not self.active:
            return
        self.active = False
        try:
            owner = _read_occupation_metadata(self._metadata_path)
            if (
                isinstance(owner, dict)
                and owner.get("instance_id") == self.instance_id
            ):
                try:
                    self._metadata_path.unlink()
                except FileNotFoundError:
                    pass
        finally:
            _release_file_lock(self._guard)
            self._guard.close()
            with _ACTIVE_OCCUPATIONS_LOCK:
                if (
                    _ACTIVE_OCCUPATIONS.get(self.directory)
                    == self.instance_id
                ):
                    _ACTIVE_OCCUPATIONS.pop(self.directory, None)

    def __enter__(self) -> "WorkspaceOccupation":
        return self

    def __exit__(self, *_args: object) -> None:
        self.release()


@dataclass(frozen=True)
class Workspace:
    """Business storage capabilities rooted in one Workspace directory."""

    directory: Path
    _records_directory: Path
    _media_directory: Path

    @classmethod
    def from_paths(cls, paths: WorkspacePaths) -> "Workspace":
        records = paths.data_dir.resolve()
        media = paths.assets_dir.resolve()
        if records.parent != media.parent:
            raise WorkspaceStorageError(
                "当前工作区使用了分散位置，请先搬家到一个工作区目录"
            )
        return cls(
            directory=records.parent,
            _records_directory=records,
            _media_directory=media,
        )

    @property
    def smart_canvases(self) -> Path:
        return self._records_directory / "canvases"

    @property
    def canvas_content(self) -> Path:
        return self._records_directory / "canvas-content.sqlite3"

    @property
    def generation_run_store(self) -> Path:
        return self._records_directory / "generation-runs.sqlite3"

    @property
    def storage_authority(self) -> Path:
        return self._records_directory / "storage-authority.json"

    @property
    def managed_media(self) -> Path:
        return self._media_directory

    @property
    def generation_outputs(self) -> Path:
        return self._media_directory / "output"

    @property
    def generation_inputs(self) -> Path:
        return self._media_directory / "input"

    @property
    def imported_media(self) -> Path:
        return self._media_directory / "input" / "imported"

    @property
    def local_uploads(self) -> Path:
        return self._media_directory / "uploads"

    @property
    def available_models(self) -> Path:
        return self._records_directory / "available_models.json"

    @property
    def api_providers(self) -> Path:
        return self._records_directory / "api_providers.json"

    @property
    def update_staging(self) -> Path:
        return self._records_directory / "update_staging"

    @property
    def update_backups(self) -> Path:
        return self._records_directory / "update_backups"

    @property
    def recovery_copies(self) -> Path:
        return self._records_directory / "recovery"

    @property
    def generation_history(self) -> Path:
        return self._records_directory / "generation-history.json"

    @property
    def generation_runs(self) -> Path:
        return self._records_directory / "generation-runs.json"

    @property
    def batch_generation(self) -> Path:
        return self._records_directory / "batch-generation.sqlite3"

    @property
    def generation_effects(self) -> Path:
        return self._records_directory / "generation-effects.json"

    @property
    def projects(self) -> Path:
        return self._records_directory / "projects.json"

    @property
    def user_workflows(self) -> Path:
        return self._records_directory / "workflows"

    @property
    def runninghub_workflows(self) -> Path:
        return self._records_directory / "runninghub_workflows.json"

    @property
    def prompt_libraries(self) -> Path:
        return self.prompt_library_directory / "prompt_libraries.json"

    @property
    def prompt_library_directory(self) -> Path:
        return self._records_directory / "prompt-libraries"

    @property
    def prompt_library_covers(self) -> Path:
        return self.prompt_library_directory / "covers"

    @property
    def legacy_prompt_libraries(self) -> Path:
        return self._records_directory / "prompt_libraries.json"

    @property
    def workspace_asset_library(self) -> Path:
        return self._records_directory / "workspace_asset_library.json"

    def public(self) -> dict[str, str]:
        """Return the user-facing Workspace contract without internal layout."""

        return {"workspace_directory": str(self.directory)}


@dataclass(frozen=True)
class WorkspaceInspection:
    """Read-only classification of a directory selected during first run."""

    directory: Path
    status: str
    next_step: str
    message: str
    message_code: str = ""

    def public(self) -> dict[str, str]:
        result = {
            "workspace_directory": str(self.directory),
            "status": self.status,
            "next_step": self.next_step,
            "message": self.message,
        }
        if self.message_code:
            result["message_code"] = self.message_code
        return result


@dataclass(frozen=True)
class WorkspaceDirectorySummary:
    """Read-only, business-facing recognition summary for one selection."""

    directory: Path
    kind: str
    kind_label: str
    smart_canvas_count: int
    managed_media_count: int
    file_count: int
    total_bytes: int
    recent_modified_at: str
    unavailable_external_reference_count: int
    warnings: tuple[str, ...]
    can_continue: bool

    def public(self) -> dict[str, object]:
        return {
            "workspace_directory": str(self.directory),
            "type": self.kind,
            "type_label": self.kind_label,
            "smart_canvas_count": self.smart_canvas_count,
            "managed_media_count": self.managed_media_count,
            "file_count": self.file_count,
            "total_bytes": self.total_bytes,
            "recent_modified_at": self.recent_modified_at,
            "unavailable_external_reference_count": (
                self.unavailable_external_reference_count
            ),
            "warnings": list(self.warnings),
            "can_continue": self.can_continue,
        }


@dataclass(frozen=True)
class WorkspaceMovePlan:
    """Read-only scope and safety result shown before a Workspace move."""

    source: Path
    target: Path
    file_count: int
    total_bytes: int
    available_bytes: int
    active_generation_tasks: int
    storage_kind: str
    storage_label: str
    warnings: tuple[str, ...]
    can_continue: bool = True

    def public(self) -> dict[str, object]:
        return {
            "operation": "move",
            "source_workspace_directory": str(self.source),
            "target_workspace_directory": str(self.target),
            "file_count": self.file_count,
            "total_bytes": self.total_bytes,
            "available_bytes": self.available_bytes,
            "active_generation_tasks": self.active_generation_tasks,
            "storage_kind": self.storage_kind,
            "storage_label": self.storage_label,
            "warnings": list(self.warnings),
            "can_continue": self.can_continue,
        }


@dataclass(frozen=True)
class WorkspaceMoveResult:
    """Verified contents prepared at the new Workspace location."""

    source: Path
    target: Path
    file_count: int
    total_bytes: int


class WorkspaceMoveError(WorkspaceStorageError):
    """A failed move phase with one safe Workspace-relative path."""

    def __init__(
        self,
        stage: str,
        relative_path: str,
        message: str,
    ) -> None:
        self.stage = str(stage or "preparing")
        raw_relative = str(relative_path or "").replace("\\", "/")
        looks_absolute = (
            raw_relative.startswith("/")
            or (
                len(raw_relative) >= 3
                and raw_relative[1] == ":"
                and raw_relative[2] == "/"
            )
        )
        relative = raw_relative.lstrip("/")
        self.relative_path = (
            ""
            if looks_absolute
            or relative in {"", "."}
            or ".." in Path(relative).parts
            else relative
        )
        super().__init__(str(message or "工作区搬家未完成"))


def _workspace_file_manifest(
    root: Path,
    *,
    stage: str,
) -> dict[str, tuple[str, int, str]]:
    """Return relative path -> kind, size, SHA-256 for every Workspace file."""

    manifest: dict[str, tuple[str, int, str]] = {}
    for current, directories, names in os.walk(root, followlinks=False):
        current_path = Path(current)
        directories[:] = [
            name
            for name in directories
            if not _device_local_workspace_path(
                root,
                current_path / name,
            )
        ]
        names = [
            name
            for name in names
            if not _device_local_workspace_path(
                root,
                current_path / name,
            )
        ]
        for name in list(directories):
            candidate = current_path / name
            if not candidate.is_symlink():
                continue
            directories.remove(name)
            relative = candidate.relative_to(root).as_posix()
            value = os.readlink(candidate).encode(
                "utf-8",
                errors="surrogateescape",
            )
            manifest[relative] = (
                "link",
                len(value),
                hashlib.sha256(value).hexdigest(),
            )
        for name in names:
            candidate = current_path / name
            relative = candidate.relative_to(root).as_posix()
            if candidate.is_symlink():
                value = os.readlink(candidate).encode(
                    "utf-8",
                    errors="surrogateescape",
                )
                manifest[relative] = (
                    "link",
                    len(value),
                    hashlib.sha256(value).hexdigest(),
                )
                continue
            digest = hashlib.sha256()
            size = 0
            try:
                with candidate.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        size += len(chunk)
                        digest.update(chunk)
            except OSError as exc:
                raise WorkspaceMoveError(
                    stage,
                    relative,
                    "工作区有文件无法读取，请检查权限后重试",
                ) from exc
            manifest[relative] = ("file", size, digest.hexdigest())
    return manifest


class WorkspaceMoveExecutor:
    """Copy one frozen Workspace, verify it, then atomically publish it."""

    def __init__(
        self,
        source: object,
        target: object,
        *,
        operation_id: str,
        copy_tree: Optional[Callable[..., object]] = None,
        progress: Optional[Callable[[str, int, int], object]] = None,
    ) -> None:
        self.source = Path(str(source)).expanduser().resolve()
        self.target = Path(str(target)).expanduser().resolve()
        safe_operation = self._safe_operation_id(operation_id)
        if not safe_operation:
            raise WorkspaceStorageError("无法确认本次工作区搬家操作")
        self.operation_id = safe_operation
        self._copy_tree = copy_tree or shutil.copytree
        self._progress = progress or (
            lambda _stage, _files, _size: None
        )

    @staticmethod
    def _safe_operation_id(operation_id: object) -> str:
        raw = str(operation_id or "")
        safe_operation = "".join(
            character
            for character in raw
            if character.isalnum() or character in {"-", "_"}
        )
        if safe_operation != raw or len(safe_operation) > 80:
            return ""
        return safe_operation

    @classmethod
    def _stage_path_for(
        cls,
        target: Path,
        operation_id: object,
    ) -> Optional[Path]:
        safe_operation = cls._safe_operation_id(operation_id)
        if not safe_operation:
            return None
        return target.parent / (
            f".{target.name}.infinite-canvas-moving-{safe_operation}"
        )

    def _stage_path(self) -> Path:
        stage = self._stage_path_for(self.target, self.operation_id)
        if stage is None:  # Constructor has already validated this value.
            raise WorkspaceStorageError(
                "无法确认本次工作区搬家操作"
            )
        return stage

    @classmethod
    def cleanup_temporary(
        cls,
        target: object,
        *,
        operation_id: object,
    ) -> bool:
        """Remove only the exact temporary directory owned by one operation."""

        resolved_target = Path(str(target)).expanduser().resolve()
        stage = cls._stage_path_for(resolved_target, operation_id)
        if stage is None or stage.is_symlink() or not stage.is_dir():
            return False
        shutil.rmtree(stage)
        return True

    @staticmethod
    def _stats(
        manifest: dict[str, tuple[str, int, str]],
    ) -> tuple[int, int]:
        return (
            len(manifest),
            sum(item[1] for item in manifest.values()),
        )

    def copy_and_verify(self) -> WorkspaceMoveResult:
        current_stage = "preparing"
        if not self.source.is_dir():
            raise WorkspaceStorageError(
                "当前工作区目录不可用，搬家尚未开始"
            )
        if (
            self.target == self.source
            or self.target in self.source.parents
            or self.source in self.target.parents
        ):
            raise WorkspaceStorageError(
                "搬家目标不能与当前工作区互相包含"
            )
        try:
            target_empty = (
                self.target.is_dir()
                and next(self.target.iterdir(), None) is None
            )
        except OSError as exc:
            raise WorkspaceStorageError(
                "目标工作区目录暂时不可用，请重新选择"
            ) from exc
        if not target_empty:
            raise WorkspaceStorageError(
                "搬家目标必须是空目录，请重新选择"
            )

        stage = self._stage_path()
        if stage.exists():
            raise WorkspaceStorageError(
                "目标位置保留着一次未完成的搬家记录，请先重新连接工作区"
            )

        target_removed = False
        try:
            source_manifest = _workspace_file_manifest(
                self.source,
                stage="preparing",
            )
            file_count, total_bytes = self._stats(source_manifest)
            current_stage = "copying"
            self._progress("copying", 0, 0)
            copied_files = 0
            copied_bytes = 0

            def copy_file(source_file: str, target_file: str):
                nonlocal copied_files, copied_bytes
                copied = shutil.copy2(source_file, target_file)
                try:
                    copied_bytes += Path(source_file).stat().st_size
                except OSError:
                    pass
                copied_files += 1
                self._progress(
                    "copying",
                    copied_files,
                    copied_bytes,
                )
                return copied

            def ignore_device_local(directory: str, names: list[str]):
                current = Path(directory).resolve()
                return [
                    name
                    for name in names
                    if _device_local_workspace_path(
                        self.source,
                        current / name,
                    )
                ]

            self._copy_tree(
                self.source,
                stage,
                symlinks=True,
                ignore=ignore_device_local,
                copy_function=copy_file,
            )
            current_stage = "verifying"
            self._progress("verifying", file_count, total_bytes)
            target_manifest = _workspace_file_manifest(
                stage,
                stage="verifying",
            )
            source_after_copy = _workspace_file_manifest(
                self.source,
                stage="verifying",
            )
            if (
                source_after_copy != source_manifest
                or target_manifest != source_manifest
            ):
                related_path = next(
                    (
                        relative
                        for relative in sorted(
                            set(source_manifest)
                            | set(source_after_copy)
                            | set(target_manifest)
                        )
                        if (
                            source_after_copy.get(relative)
                            != source_manifest.get(relative)
                            or target_manifest.get(relative)
                            != source_manifest.get(relative)
                        )
                    ),
                    "",
                )
                raise WorkspaceMoveError(
                    "verifying",
                    related_path,
                    "工作区逐文件校验失败，当前工作区继续可用",
                )

            current_stage = "switching"
            self.target.rmdir()
            target_removed = True
            os.replace(stage, self.target)
            target_removed = False
            self._progress("prepared", file_count, total_bytes)
            return WorkspaceMoveResult(
                source=self.source,
                target=self.target,
                file_count=file_count,
                total_bytes=total_bytes,
            )
        except WorkspaceMoveError:
            raise
        except WorkspaceStorageError as exc:
            raise WorkspaceMoveError(
                current_stage,
                "",
                str(exc),
            ) from exc
        except shutil.Error as exc:
            related_path = self._relative_path_from_error(exc, stage)
            raise WorkspaceMoveError(
                current_stage,
                related_path,
                "无法复制工作区文件，当前工作区继续可用",
            ) from exc
        except OSError as exc:
            related_path = self._relative_path_from_error(exc, stage)
            raise WorkspaceMoveError(
                current_stage,
                related_path,
                "无法完成工作区搬家，当前工作区继续可用",
            ) from exc
        finally:
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)
            if target_removed and not self.target.exists():
                try:
                    self.target.mkdir(parents=True)
                except OSError:
                    pass

    def _relative_path_from_error(
        self,
        error: BaseException,
        stage: Path,
    ) -> str:
        candidates: list[object] = []
        for attribute in ("filename", "filename2"):
            value = getattr(error, attribute, None)
            if value:
                candidates.append(value)
        if isinstance(error, shutil.Error) and error.args:
            details = error.args[0]
            if isinstance(details, list):
                for item in details:
                    if isinstance(item, (list, tuple)):
                        candidates.extend(item[:2])
        for value in candidates:
            try:
                candidate = Path(str(value)).expanduser().resolve()
            except (OSError, ValueError):
                continue
            for root in (self.source, stage):
                try:
                    return candidate.relative_to(root).as_posix()
                except ValueError:
                    continue
        return ""


class WorkspaceService:
    """Resolve the current Workspace through one stable business seam."""

    def __init__(
        self,
        storage: WorkspaceStorage,
        *,
        storage_classifier: Optional[
            Callable[[Path], WorkspaceLocationCapability]
        ] = None,
        disk_usage: Optional[Callable[[Path], object]] = None,
    ) -> None:
        self._storage = storage
        self._storage_classifier = (
            storage_classifier or _default_storage_capability
        )
        self._disk_usage = disk_usage or shutil.disk_usage

    def current(self) -> Workspace:
        return Workspace.from_paths(self._storage.paths())

    def try_current(self) -> tuple[Optional[Workspace], str]:
        try:
            return self.current(), ""
        except WorkspaceStorageError as exc:
            return None, str(exc)

    def identity(self, directory: object = "") -> str:
        """Read a stable Workspace identity without changing the directory."""

        try:
            root = (
                Path(str(directory)).expanduser().resolve()
                if str(directory or "").strip()
                else self.current().directory
            )
            raw = json.loads(
                (root / _WORKSPACE_IDENTITY_FILE).read_text(
                    encoding="utf-8-sig"
                )
            )
            return str(uuid.UUID(str((raw or {}).get("workspace_id") or "")))
        except (
            OSError,
            ValueError,
            TypeError,
            AttributeError,
            WorkspaceStorageError,
        ):
            return ""

    def ensure_identity(
        self,
        directory: object = "",
        *,
        expected_identity: object = "",
    ) -> str:
        """Create the stable identity only after a caller owns the Workspace."""

        root = (
            Path(str(directory)).expanduser().resolve()
            if str(directory or "").strip()
            else self.current().directory
        )
        planned_identity = ""
        if str(expected_identity or "").strip():
            try:
                planned_identity = str(uuid.UUID(str(expected_identity)))
            except (ValueError, TypeError, AttributeError) as exc:
                raise WorkspaceStorageError(
                    "无法确认待创建工作区的身份"
                ) from exc
        existing = self.identity(root)
        if existing:
            if planned_identity and existing != planned_identity:
                raise WorkspaceStorageError(
                    "待创建工作区的身份与恢复记录不一致，请选择其他空目录"
                )
            return existing
        if not root.is_dir() or not os.access(root, os.W_OK | os.X_OK):
            raise WorkspaceStorageError(
                "无法保存工作区身份，请检查工作区目录权限后重试"
            )
        workspace_id = planned_identity or str(uuid.uuid4())
        marker = root / _WORKSPACE_IDENTITY_FILE
        temporary = marker.with_name(
            f".{marker.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temporary.write_text(
                json.dumps(
                    {"version": 1, "workspace_id": workspace_id},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            os.replace(temporary, marker)
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法保存工作区身份，请检查工作区目录权限后重试"
            ) from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return workspace_id

    @staticmethod
    def workspace_for_directory(directory: object) -> Workspace:
        """Build candidate capabilities without changing Device State."""

        root = Path(str(directory)).expanduser().resolve()
        return Workspace(
            directory=root,
            _records_directory=root / "data",
            _media_directory=root / "assets",
        )

    def prepare_recovery_creation(
        self,
        directory: object,
        *,
        workspace_id: object,
    ) -> Workspace:
        """Create a staged fresh Workspace without selecting it on this device."""

        workspace = self.workspace_for_directory(directory)
        if (
            not workspace.directory.is_dir()
            or not os.access(workspace.directory, os.W_OK | os.X_OK)
        ):
            raise WorkspaceStorageError(
                "新工作区目录不可访问或不可写，请检查后重试"
            )
        self._storage.validate_pair(
            workspace._records_directory,
            workspace._media_directory,
            require_existing=False,
        )
        try:
            workspace._records_directory.mkdir(parents=True, exist_ok=True)
            workspace._media_directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法建立新工作区必需目录，请检查权限后重试"
            ) from exc
        self.ensure_identity(
            workspace.directory,
            expected_identity=workspace_id,
        )
        return workspace

    @staticmethod
    def _inspection(
        directory: Path,
        status: str,
        next_step: str,
        message: str,
        message_code: str,
    ) -> WorkspaceInspection:
        return WorkspaceInspection(
            directory=directory,
            status=status,
            next_step=next_step,
            message=message,
            message_code=message_code,
        )

    def inspect(self, directory: object) -> WorkspaceInspection:
        """Classify a proposed Workspace directory without changing it."""

        raw = str(directory or "").strip()
        if not raw:
            return self._inspection(
                Path(".").resolve(),
                "unavailable",
                "choose_another",
                "请选择一个可访问的工作区目录",
                "workspace_directory_required",
            )
        try:
            candidate = Path(raw).expanduser().resolve()
            if (
                not candidate.is_dir()
                or not os.access(candidate, os.R_OK | os.X_OK)
                or not os.access(candidate, os.W_OK)
            ):
                raise OSError
            entries = [
                entry
                for entry in candidate.iterdir()
                if entry.name != _OCCUPATION_DIRECTORY
            ]
        except (OSError, RuntimeError, ValueError):
            return self._inspection(
                Path(raw).expanduser().absolute(),
                "unavailable",
                "choose_another",
                "所选工作区目录不可访问或不可写，请检查位置与权限后重试",
                "workspace_directory_unavailable",
            )

        try:
            capability = self._storage_classifier(candidate)
        except Exception:
            return self._inspection(
                candidate,
                "unavailable",
                "choose_another",
                "无法确认工作区存储位置，请选择本机磁盘、外接磁盘"
                "或已同步到本机的云盘目录",
                "workspace_storage_unknown",
            )
        if not capability.supported:
            message = (
                "出于工作区数据安全考虑，暂不支持 NAS 或局域网磁盘；"
                "请选择本机磁盘、外接磁盘或已同步到本机的云盘目录"
                if capability.kind == "network"
                else "无法确认工作区存储位置是否安全，请选择本机磁盘、"
                "外接磁盘或已同步到本机的云盘目录"
            )
            return self._inspection(
                candidate,
                "unavailable",
                "choose_another",
                message,
                (
                    "workspace_storage_network_unsupported"
                    if capability.kind == "network"
                    else "workspace_storage_unsupported"
                ),
            )

        if not entries:
            return self._inspection(
                candidate,
                "empty",
                "create_workspace",
                "此目录可以创建新的内容工作区",
                "workspace_directory_empty",
            )

        records = candidate / "data"
        media = candidate / "assets"
        records_present = records.exists()
        media_present = media.exists()
        if not records_present and not media_present:
            return self._inspection(
                candidate,
                "ordinary_non_empty",
                "choose_another",
                "所选目录已有其他内容，请选择空目录或打开已有工作区",
                "workspace_directory_non_empty",
            )
        if not records.is_dir() or not media.is_dir():
            return self._inspection(
                candidate,
                "incomplete",
                "choose_another",
                "此工作区内容不完整，请重新选择完整的工作区目录",
                "workspace_directory_incomplete",
            )

        return self._inspection(
            candidate,
            "existing",
            "open",
            "已找到现有内容工作区",
            "workspace_existing",
        )

    @staticmethod
    def _summary_tree(
        directory: Path,
    ) -> tuple[int, int, float, list[Path], bool]:
        files = 0
        total_bytes = 0
        latest = 0.0
        file_paths: list[Path] = []
        read_failed = False

        try:
            latest = directory.stat().st_mtime
        except OSError:
            read_failed = True

        def record_error(_error: OSError) -> None:
            nonlocal read_failed
            read_failed = True

        try:
            for current, directories, names in os.walk(
                directory,
                topdown=True,
                onerror=record_error,
                followlinks=False,
            ):
                current_path = Path(current)
                directories[:] = [
                    name
                    for name in directories
                    if not _device_local_workspace_path(
                        directory,
                        current_path / name,
                    )
                ]
                for name in names:
                    candidate = current_path / name
                    if _device_local_workspace_path(directory, candidate):
                        continue
                    try:
                        stat = candidate.stat(follow_symlinks=False)
                    except OSError:
                        read_failed = True
                        continue
                    files += 1
                    total_bytes += int(stat.st_size)
                    latest = max(latest, float(stat.st_mtime))
                    file_paths.append(candidate)
        except OSError:
            read_failed = True
        return files, total_bytes, latest, file_paths, read_failed

    @staticmethod
    def _legacy_external_reference(value: object) -> str:
        text = str(value or "").strip().strip('"').strip("'")
        if not text:
            return ""
        lowered = text.lower().replace("\\", "/")
        if lowered.startswith(
            (
                "/assets/",
                "/api/",
                "http://",
                "https://",
                "data:",
                "blob:",
            )
        ):
            return ""
        media_extensions = (
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".gif",
            ".bmp",
            ".avif",
            ".mp4",
            ".webm",
            ".mov",
            ".m4v",
            ".avi",
            ".mkv",
            ".mp3",
            ".wav",
            ".m4a",
            ".aac",
            ".ogg",
            ".flac",
            ".pdf",
        )
        clean_path = lowered.split("?", 1)[0].split("#", 1)[0]
        if not clean_path.endswith(media_extensions):
            return ""
        if lowered.startswith("file:"):
            parsed = urllib.parse.urlparse(text)
            if parsed.scheme.lower() != "file":
                return ""
            if parsed.netloc and parsed.netloc.lower() not in {"", "localhost"}:
                return text
            return urllib.parse.unquote(parsed.path or "")
        if re.match(r"^[a-zA-Z]:[\\/]", text) or text.startswith("/"):
            return text
        return ""

    @classmethod
    def _unavailable_external_reference_count(
        cls,
        canvas_files: list[Path],
    ) -> int:
        count = 0

        def visit(value: object) -> None:
            nonlocal count
            if isinstance(value, dict):
                for item in value.values():
                    visit(item)
                return
            if isinstance(value, list):
                for item in value:
                    visit(item)
                return
            if not isinstance(value, str):
                return
            external = cls._legacy_external_reference(value)
            if not external:
                return
            if re.match(r"^[a-zA-Z]:[\\/]", external):
                available = os.name == "nt" and Path(external).is_file()
            else:
                available = Path(external).expanduser().is_file()
            if not available:
                count += 1

        for path in canvas_files:
            try:
                if path.stat().st_size > 20 * 1024 * 1024:
                    continue
                visit(json.loads(path.read_text(encoding="utf-8-sig")))
            except (OSError, ValueError, TypeError):
                continue
        return count

    def summarize(
        self,
        directory: object,
        *,
        intent: str,
    ) -> WorkspaceDirectorySummary:
        """Recognize a selection without changing the selection or its files."""

        normalized_intent = str(intent or "").strip().lower()
        if normalized_intent not in {"open", "move"}:
            raise WorkspaceStorageError(
                "请选择“打开已有工作区”或“搬家到新位置”"
            )
        inspection = self.inspect(directory)
        candidate = inspection.directory
        type_labels = {
            "empty": "空目录",
            "existing": "已有工作区",
            "incomplete": "内容不完整的工作区",
            "ordinary_non_empty": "已有其他内容的目录",
            "unavailable": "不可用的目录",
        }
        file_count = 0
        total_bytes = 0
        latest = 0.0
        file_paths: list[Path] = []
        read_failed = inspection.status == "unavailable"
        if inspection.status != "unavailable":
            (
                file_count,
                total_bytes,
                latest,
                file_paths,
                scan_failed,
            ) = self._summary_tree(candidate)
            read_failed = read_failed or scan_failed

        smart_canvas_root = candidate / "data" / "canvases"
        managed_media_root = candidate / "assets"
        smart_canvas_count = sum(
            1
            for path in file_paths
            if path.suffix.lower() == ".json"
            and path.is_relative_to(smart_canvas_root)
        )
        managed_media_count = sum(
            1 for path in file_paths if path.is_relative_to(managed_media_root)
        )
        unavailable_external_reference_count = (
            self._unavailable_external_reference_count(
                [
                    path
                    for path in file_paths
                    if path.suffix.lower() == ".json"
                    and path.is_relative_to(smart_canvas_root)
                ]
            )
        )
        warnings: list[str] = []
        can_continue = (
            inspection.status == "existing"
            if normalized_intent == "open"
            else inspection.status == "empty"
        )

        if normalized_intent == "open":
            if inspection.status == "existing":
                warnings.append(
                    "确认后会切换到此内容工作区；当前账号、会话和全局角色保持不变"
                )
            elif inspection.status == "empty":
                warnings.append(
                    "此目录中没有已有工作区，请选择包含完整工作区内容的目录"
                )
            else:
                warnings.append(inspection.message)
        elif inspection.status == "empty":
            warnings.append(
                "搬家会把当前工作区复制到新位置，原工作区会保留"
            )
        elif inspection.status == "existing":
            warnings.append(
                "这里已经有一个工作区，请改用“打开已有工作区”"
            )
        else:
            warnings.append(
                "搬家位置必须是空目录，请选择或新建一个空目录"
            )

        try:
            if candidate == self.current().directory:
                can_continue = False
                warnings = ["当前已经在使用这个工作区目录"]
        except WorkspaceStorageError:
            pass

        if read_failed:
            can_continue = False
            warnings.append(
                "部分内容无法读取，请检查工作区目录权限后重新选择"
            )
        if unavailable_external_reference_count:
            warnings.append(
                "发现 "
                f"{unavailable_external_reference_count} 个旧媒体引用"
                "在当前设备不可用；工作区仍可打开，原引用不会被自动修改"
            )

        recent_modified_at = (
            datetime.fromtimestamp(latest, timezone.utc).isoformat()
            if latest > 0
            else ""
        )
        return WorkspaceDirectorySummary(
            directory=candidate,
            kind=inspection.status,
            kind_label=type_labels.get(inspection.status, "未知目录"),
            smart_canvas_count=smart_canvas_count,
            managed_media_count=managed_media_count,
            file_count=file_count,
            total_bytes=total_bytes,
            recent_modified_at=recent_modified_at,
            unavailable_external_reference_count=(
                unavailable_external_reference_count
            ),
            warnings=tuple(dict.fromkeys(warnings)),
            can_continue=can_continue,
        )

    def plan_move(
        self,
        target_directory: object,
        *,
        active_generation_tasks: int = 0,
    ) -> WorkspaceMovePlan:
        """Validate and summarize a move without changing either directory."""

        source = self.current().directory
        raw_target = str(target_directory or "").strip()
        if not raw_target:
            raise WorkspaceStorageError("请选择搬家到新位置的工作区目录")
        target = Path(raw_target).expanduser().resolve()
        if target == source:
            raise WorkspaceStorageError(
                "搬家目标不能是当前工作区目录，请选择新的空目录"
            )
        if target in source.parents or source in target.parents:
            raise WorkspaceStorageError(
                "搬家目标不能与当前工作区互相包含，请选择独立的空目录"
            )

        try:
            capability = self._storage_classifier(target)
        except Exception as exc:
            raise WorkspaceStorageError(
                "无法确认目标存储位置，请选择本机磁盘、外接磁盘"
                "或已同步到本机的云盘目录"
            ) from exc
        if not capability.supported:
            if capability.kind == "network":
                raise WorkspaceStorageError(
                    "出于工作区数据安全考虑，暂不支持 NAS 或局域网磁盘；"
                    "请选择本机磁盘、外接磁盘或已同步到本机的云盘目录"
                )
            raise WorkspaceStorageError(
                "无法确认目标存储位置是否安全，请选择本机磁盘、"
                "外接磁盘或已同步到本机的云盘目录"
            )

        inspection = self.inspect(target)
        if inspection.status == "existing":
            raise WorkspaceStorageError(
                "此目录已经是一个工作区，不能合并；请改用“打开已有工作区”"
            )
        if inspection.status != "empty":
            if inspection.status == "unavailable":
                raise WorkspaceStorageError(inspection.message)
            raise WorkspaceStorageError(
                "搬家目标必须是空目录，请选择或新建一个空目录"
            )

        (
            file_count,
            total_bytes,
            _latest,
            source_files,
            source_read_failed,
        ) = self._summary_tree(source)
        if source_read_failed:
            raise WorkspaceStorageError(
                "当前工作区有内容无法读取，请检查后再搬家"
            )
        try:
            available_bytes = max(
                0,
                int(getattr(self._disk_usage(target), "free")),
            )
        except (OSError, TypeError, ValueError, AttributeError) as exc:
            raise WorkspaceStorageError(
                "无法确认目标位置的可用空间，请检查磁盘后重试"
            ) from exc
        if available_bytes < total_bytes:
            raise WorkspaceStorageError(
                "目标位置可用空间不足，请释放空间或选择其他位置"
            )

        warnings = list(capability.warnings)
        if any(path.is_symlink() for path in source_files):
            warnings.append(
                "发现链接文件，搬家后请确认其内容在新位置仍然可用。"
            )
        active_tasks = max(0, int(active_generation_tasks or 0))
        if active_tasks:
            warnings.append(
                f"当前有 {active_tasks} 个活动生成任务，"
                "开始搬家前将默认等待它们完成。"
            )
        warnings.append(
            "搬家完成后原工作区仍会保留，Reroll 不会自动删除。"
        )
        return WorkspaceMovePlan(
            source=source,
            target=target,
            file_count=file_count,
            total_bytes=total_bytes,
            available_bytes=available_bytes,
            active_generation_tasks=active_tasks,
            storage_kind=capability.kind,
            storage_label=capability.label,
            warnings=tuple(dict.fromkeys(warnings)),
        )

    def prepare_initial(self, directory: object) -> Workspace:
        """Create/adopt an account-less Workspace after a fresh inspection."""

        inspection = self.inspect(directory)
        if inspection.status not in {"empty", "existing"}:
            raise WorkspaceStorageError(inspection.message)
        return Workspace.from_paths(
            self._storage.save_parent(inspection.directory)
        )

    def open_existing(self, directory: object) -> Workspace:
        """Reconnect only to a complete Workspace content directory."""

        inspection = self.inspect(directory)
        if inspection.status != "existing":
            raise WorkspaceStorageError(inspection.message)
        return Workspace.from_paths(
            self._storage.reconnect_parent(inspection.directory)
        )

    def acquire_occupation(
        self,
        server_id: str,
        *,
        directory: object = "",
        pid: Optional[int] = None,
        process_alive: Optional[Callable[[int], bool]] = None,
        allow_foreign_takeover: bool = False,
    ) -> WorkspaceOccupation:
        """Acquire this server's unique write ownership before business writes."""

        server_id = str(server_id or "").strip()
        if not server_id:
            raise WorkspaceStorageError(
                "无法确认当前服务身份，工作区未进入可写状态"
            )
        workspace_directory = (
            Path(str(directory)).expanduser().resolve()
            if str(directory or "").strip()
            else self.current().directory
        )
        control_directory = workspace_directory / _OCCUPATION_DIRECTORY
        metadata_path = control_directory / _OCCUPATION_METADATA
        guard_path = control_directory / _OCCUPATION_GUARD
        instance_id = str(uuid.uuid4())
        current_pid = int(pid if pid is not None else os.getpid())
        alive = process_alive or _process_alive

        with _ACTIVE_OCCUPATIONS_LOCK:
            if workspace_directory in _ACTIVE_OCCUPATIONS:
                raise WorkspaceStorageError(
                    "工作区正在被另一个 Reroll 服务使用，"
                    "请先在原服务中正常关闭"
                )

        try:
            control_directory.mkdir(parents=True, exist_ok=True)
            guard = guard_path.open("a+b")
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法取得工作区使用权，请检查工作区目录权限后重试"
            ) from exc

        if not _try_exclusive_file_lock(guard):
            guard.close()
            raise WorkspaceStorageError(
                "工作区正在被另一个 Reroll 服务使用，"
                "请先在原服务中正常关闭"
            )

        try:
            owner = _read_occupation_metadata(metadata_path)
            if owner is not None:
                if not owner:
                    raise WorkspaceStorageError(
                        "此工作区保留了无法确认的使用状态，"
                        "无法确认原服务已经安全退出。请回到原服务正常关闭后再试"
                    )
                owner_server = str(owner.get("server_id") or "")
                try:
                    owner_pid = int(owner.get("pid") or 0)
                except (TypeError, ValueError):
                    owner_pid = 0
                same_server_stale = (
                    owner_server == server_id
                    and owner_pid > 0
                    and not alive(owner_pid)
                )
                confirmed_foreign_takeover = bool(
                    allow_foreign_takeover
                    and owner_server
                    and owner_server != server_id
                )
                if not same_server_stale and not confirmed_foreign_takeover:
                    if owner_server and owner_server != server_id:
                        raise WorkspaceStorageError(
                            "此工作区记录为由另一台服务器使用，"
                            "无法确认原服务已经安全退出。请回到原服务正常关闭后再试"
                        )
                    raise WorkspaceStorageError(
                        "工作区正在被另一个 Reroll 服务使用，"
                        "请先在原服务中正常关闭"
                    )
            _write_occupation_metadata(
                metadata_path,
                {
                    "version": 1,
                    "server_id": server_id,
                    "instance_id": instance_id,
                    "pid": current_pid,
                    "started_at": int(time.time()),
                },
            )
            with _ACTIVE_OCCUPATIONS_LOCK:
                if workspace_directory in _ACTIVE_OCCUPATIONS:
                    raise WorkspaceStorageError(
                        "工作区正在被另一个 Reroll 服务使用，"
                        "请先在原服务中正常关闭"
                    )
                _ACTIVE_OCCUPATIONS[workspace_directory] = instance_id
            return WorkspaceOccupation(
                directory=workspace_directory,
                server_id=server_id,
                instance_id=instance_id,
                metadata_path=metadata_path,
                guard=guard,
            )
        except Exception:
            _release_file_lock(guard)
            guard.close()
            raise


__all__ = [
    "Workspace",
    "WorkspaceDirectorySummary",
    "WorkspaceInspection",
    "WorkspaceLocationCapability",
    "WorkspaceMovePlan",
    "WorkspaceMoveExecutor",
    "WorkspaceMoveError",
    "WorkspaceMoveResult",
    "WorkspaceOccupation",
    "WorkspaceService",
]
