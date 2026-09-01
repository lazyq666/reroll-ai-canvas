"""Explicit workspace selection and device-local state support.

The source tree contains application code and built-in resources only.
Workspace data is read directly from the user-selected ``data`` and ``assets``
directories. Device-specific configuration lives in the operating system's
application-state directory.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

from .installation import installation_directory


SETTINGS_VERSION = 3


class WorkspaceStorageError(ValueError):
    """Raised when a workspace location is unsafe, missing, or unusable."""


def application_state_directory(
    project_dir: str | os.PathLike[str] | None = None,
) -> Path:
    """Return the application state directory for one installation.

    ``INFINITE_CANVAS_STATE_DIR`` is an explicit adapter for tests, portable
    installs, and administrators who need a custom location. Operating-system
    defaults are scoped by project directory so separate checkouts do not
    share mutable server or Workspace-selection state.
    """

    override = str(os.getenv("INFINITE_CANVAS_STATE_DIR") or "").strip()
    if override:
        return Path(os.path.expandvars(os.path.expanduser(override))).resolve()
    system = platform.system()
    if system == "Darwin":
        base = (
            Path.home() / "Library" / "Application Support" / "Infinite Canvas"
        ).resolve()
    elif system == "Windows":
        root = (
            os.getenv("LOCALAPPDATA")
            or os.getenv("APPDATA")
            or str(Path.home() / "AppData" / "Local")
        )
        base = (Path(root) / "Infinite Canvas").expanduser().resolve()
    else:
        xdg_state = str(os.getenv("XDG_STATE_HOME") or "").strip()
        if xdg_state:
            base = (
                Path(xdg_state).expanduser() / "infinite-canvas"
            ).resolve()
        else:
            base = (
                Path.home() / ".local" / "state" / "infinite-canvas"
            ).resolve()
    return installation_directory(base, project_dir) if project_dir else base


def choose_workspace_parent_directory() -> str:
    """Open the operating system's folder picker and return an absolute path."""

    system = platform.system()
    if system == "Darwin":
        command = [
            "/usr/bin/osascript",
            "-e",
            'POSIX path of (choose folder with prompt "选择 Reroll 工作区目录")',
        ]
    elif system == "Windows":
        command = [
            "powershell.exe",
            "-NoProfile",
            "-STA",
            "-Command",
            (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$d=New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$d.Description='选择 Reroll 工作区目录'; "
                "if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}"
            ),
        ]
    else:
        picker = shutil.which("zenity")
        if not picker:
            raise RuntimeError(
                "当前桌面环境没有可用的目录选择器，请安装 zenity 或手动输入工作区目录"
            )
        command = [
            picker,
            "--file-selection",
            "--directory",
            "--title=选择 Reroll 工作区目录",
        ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )
    if completed.returncode != 0:
        return ""
    selected = completed.stdout.strip()
    return str(Path(selected).expanduser().resolve()) if selected else ""


@dataclass(frozen=True)
class WorkspacePaths:
    data_dir: Path
    assets_dir: Path
    settings_file: Path


def _atomic_json_write(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
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


class WorkspaceStorage:
    """Resolve and persist one explicitly chosen workspace.

    Callers use :meth:`paths` as the module interface. It either returns the
    exact configured paths or raises with a recovery reason; it never invents
    source-tree defaults.
    """

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        state_dir: str | os.PathLike[str] | None = None,
    ) -> None:
        self.base_dir = Path(base_dir).expanduser().resolve()
        self.state_dir = (
            Path(state_dir).expanduser().resolve()
            if state_dir is not None
            else application_state_directory(self.base_dir)
        )
        self.settings_file = self.state_dir / "workspace-storage.json"

    def _configured(self) -> Dict[str, str]:
        try:
            raw = json.loads(
                self.settings_file.read_text(encoding="utf-8-sig")
            )
        except (OSError, ValueError, TypeError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def configured_parent_hint(self) -> str:
        configured = self._configured()
        parent = str(configured.get("parent_dir") or "").strip()
        if parent:
            try:
                return str(self._resolve(parent))
            except WorkspaceStorageError:
                return parent
        return ""

    def has_configuration(self) -> bool:
        """Return whether a workspace selection exists, even if unavailable."""

        configured = self._configured()
        return bool(str(configured.get("parent_dir") or "").strip())

    def _resolve(self, value: object) -> Path:
        text = str(value or "").strip()
        if not text:
            raise WorkspaceStorageError("尚未选择工作区目录")
        expanded = Path(os.path.expandvars(os.path.expanduser(text)))
        if not expanded.is_absolute():
            expanded = self.base_dir / expanded
        return expanded.resolve()

    def paths(self) -> WorkspacePaths:
        configured = self._configured()
        configured_parent = str(configured.get("parent_dir") or "").strip()
        if not configured_parent:
            raise WorkspaceStorageError("尚未选择工作区目录")

        parent = self._resolve(configured_parent)
        data_dir = parent / "data"
        assets_dir = parent / "assets"
        self.validate_pair(data_dir, assets_dir, require_existing=True)
        return WorkspacePaths(
            data_dir=data_dir,
            assets_dir=assets_dir,
            settings_file=self.settings_file,
        )

    def try_paths(self) -> Tuple[Optional[WorkspacePaths], str]:
        """Return configured paths or a user-facing recovery reason."""

        try:
            return self.paths(), ""
        except WorkspaceStorageError as exc:
            return None, str(exc)

    def _validate_directory(
        self, path: Path, label: str, *, require_existing: bool
    ) -> None:
        if path == Path(path.anchor) or path == Path.home().resolve():
            raise WorkspaceStorageError(f"{label}不能使用磁盘根目录或用户主目录")
        if path.exists() and not path.is_dir():
            raise WorkspaceStorageError(f"{label}不是可用文件夹")
        if require_existing and not path.is_dir():
            raise WorkspaceStorageError(f"{label}不存在或暂时不可访问")
        parent = path if path.exists() else path.parent
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        if not parent.is_dir() or not os.access(parent, os.W_OK):
            raise WorkspaceStorageError(f"{label}不可写，请检查权限后重试")

    def validate_pair(
        self,
        data_dir: Path,
        assets_dir: Path,
        *,
        require_existing: bool,
    ) -> None:
        self._validate_directory(
            data_dir, "工作区目录", require_existing=require_existing
        )
        self._validate_directory(
            assets_dir, "工作区目录", require_existing=require_existing
        )
        if data_dir == assets_dir:
            raise WorkspaceStorageError("所选工作区目录结构无效")
        if data_dir in assets_dir.parents or assets_dir in data_dir.parents:
            raise WorkspaceStorageError(
                "所选工作区目录结构无效，请选择完整的工作区目录"
            )

    def save_parent(
        self,
        parent_dir: object,
        *,
        require_existing: bool = True,
    ) -> WorkspacePaths:
        text = str(parent_dir or "").strip()
        if not text:
            raise WorkspaceStorageError("请选择工作区目录")
        parent = self._resolve(text)
        self._validate_directory(
            parent,
            "工作区目录",
            require_existing=require_existing,
        )
        data_dir = parent / "data"
        assets_dir = parent / "assets"
        self.validate_pair(data_dir, assets_dir, require_existing=False)
        data_dir.mkdir(parents=True, exist_ok=True)
        assets_dir.mkdir(parents=True, exist_ok=True)
        _atomic_json_write(
            self.settings_file,
            {
                "version": SETTINGS_VERSION,
                "parent_dir": str(parent),
            },
        )
        return self.paths()

    def remember_parent(self, parent_dir: object) -> str:
        """Persist an exact selection without creating or validating it.

        Recovery uses this narrow seam to retain an unavailable selection and
        to restore it if a controlled restart cannot be requested.
        """

        text = str(parent_dir or "").strip()
        if not text:
            raise WorkspaceStorageError("请选择工作区目录")
        parent = self._resolve(text)
        _atomic_json_write(
            self.settings_file,
            {
                "version": SETTINGS_VERSION,
                "parent_dir": str(parent),
            },
        )
        return str(parent)

    def reconnect_parent(self, parent_dir: object) -> WorkspacePaths:
        """Reconnect recovery to an existing Workspace Data pair only."""
        text = str(parent_dir or "").strip()
        if not text:
            raise WorkspaceStorageError("请选择现有工作区目录")
        parent = self._resolve(text)
        self._validate_directory(
            parent,
            "工作区目录",
            require_existing=True,
        )
        data_dir = parent / "data"
        assets_dir = parent / "assets"
        self._validate_directory(
            data_dir,
            "工作区目录",
            require_existing=True,
        )
        self._validate_directory(
            assets_dir,
            "工作区目录",
            require_existing=True,
        )
        self.validate_pair(data_dir, assets_dir, require_existing=True)
        _atomic_json_write(
            self.settings_file,
            {
                "version": SETTINGS_VERSION,
                "parent_dir": str(parent),
            },
        )
        return self.paths()

__all__ = [
    "WorkspacePaths",
    "WorkspaceStorage",
    "WorkspaceStorageError",
    "application_state_directory",
    "choose_workspace_parent_directory",
]
