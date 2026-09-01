"""Production composition kept lazy so app construction has no side effects."""

from __future__ import annotations

import asyncio
import atexit
import importlib
import json
import os
import sys
import threading
import uuid
from pathlib import Path
from types import ModuleType
from typing import Optional

from .content import WorkspaceContent
from .workspace_storage import (
    WorkspaceStorage,
    WorkspaceStorageError,
    application_state_directory,
    choose_workspace_parent_directory,
)
from .controlled_storage_migration import ControlledStorageMigration
from .device_state import DeviceState
from .generation_runs import generation_run_control
from .installation import installation_identity
from .sqlite_workspace_bootstrap import (
    FreshWorkspaceSqliteBootstrapError,
    bootstrap_fresh_workspace_sqlite,
)
from .workspace import WorkspaceService
from .workspace_storage_composition import compose_workspace_storage

from .app import RuntimeGateway, create_app
from .runtime import ApplicationRuntime, RuntimeStartup


class RestartSignal:
    def __init__(self) -> None:
        self._event = threading.Event()

    def set(self) -> None:
        self._event.set()

    def is_set(self) -> bool:
        return self._event.is_set()

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._event.wait(timeout)


class LegacyRuntimeAuthorization:
    """Read the loaded Local State session without starting legacy code."""

    def role_for_session(self, token: str) -> str:
        module = sys.modules.get("main")
        auth = (
            getattr(module, "AUTH_SYSTEM", None)
            if isinstance(module, ModuleType)
            else None
        )
        lookup = getattr(auth, "user_for_session", None)
        user = lookup(token) if callable(lookup) and token else None
        return str((user or {}).get("role") or "")


class LegacyInitializer:
    """Load and start the legacy route app only from runtime.start()."""

    def __init__(self) -> None:
        self._runtime: Optional[ApplicationRuntime] = None
        self._main: Optional[ModuleType] = None

    def bind_runtime(self, runtime: ApplicationRuntime) -> None:
        self._runtime = runtime

    def current_workspace_content(self):
        main = self._main
        provider = getattr(main, "current_workspace_content", None)
        if not callable(provider):
            raise WorkspaceStorageError("当前 Workspace 尚未完成启动")
        return provider()

    def current_workspace_id(self) -> str:
        main = self._main
        provider = getattr(main, "current_workspace_id", None)
        if not callable(provider):
            raise WorkspaceStorageError("当前 Workspace identity 尚不可用")
        return str(provider() or "")

    async def __call__(self) -> RuntimeStartup:
        main = await asyncio.to_thread(
            importlib.import_module,
            "main",
        )
        self._main = main
        install_control = getattr(main, "install_runtime_control", None)
        if callable(install_control) and self._runtime is not None:
            install_control(
                self._runtime._request_restart_from_thread,
                self._runtime.request_restart,
            )
            self._runtime.install_workspace_move_status_provider(
                getattr(main, "workspace_move_status", None)
            )
        setup_required = bool(main.AUTH_SYSTEM.needs_initial_setup())
        if (
            getattr(main, "WORKSPACE_CONFIGURED", True) is False
            and (
                getattr(main, "WORKSPACE_SELECTION_PRESENT", False)
                or not setup_required
            )
        ):
            raise WorkspaceStorageError(
                str(
                    getattr(
                        main,
                        "WORKSPACE_CONFIGURATION_ERROR",
                        "",
                    )
                    or "已选择的工作区不可用"
                )
            )
        if callable(install_control) and self._runtime is not None:
            self._runtime.install_restart_preparer(
                getattr(main, "prepare_controlled_restart", None)
            )
        await main.startup_event()
        return RuntimeStartup(
            application=main.app,
            stop=main.shutdown_event,
            setup_required=setup_required,
        )


class ExistingWorkspaceRecovery:
    def __init__(self, storage: WorkspaceStorage) -> None:
        self._storage = storage
        self._workspace = WorkspaceService(storage)
        self._device = DeviceState(storage.state_dir)
        self._pending: Optional[dict[str, object]] = None
        self._occupation = None
        self._lock = threading.RLock()

    def _read_creation_record(self) -> Optional[dict[str, str]]:
        path = self._device.workspace_recovery_creation
        try:
            raw = json.loads(path.read_text(encoding="utf-8-sig"))
            if not isinstance(raw, dict) or raw.get("version") != 1:
                return None
            operation_id = str(uuid.UUID(str(raw.get("operation_id") or "")))
            workspace_id = str(uuid.UUID(str(raw.get("workspace_id") or "")))
            raw_target = str(raw.get("target") or "").strip()
            if not raw_target:
                return None
            target = str(Path(raw_target).expanduser().resolve())
            original = str(raw.get("original") or "").strip()
            if original:
                original = str(Path(original).expanduser().resolve())
            phase = str(raw.get("phase") or "").strip()
            if phase not in {"selected", "ready"}:
                return None
            return {
                "operation_id": operation_id,
                "workspace_id": workspace_id,
                "target": target,
                "original": original,
                "phase": phase,
            }
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def _write_creation_record(self, record: dict[str, object]) -> None:
        path = self._device.workspace_recovery_creation
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(
                    {"version": 1, **record},
                    handle,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            os.replace(temporary, path)
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法保存新工作区创建进度，请检查本机状态目录后重试"
            ) from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _delete_creation_record(self) -> None:
        try:
            self._device.workspace_recovery_creation.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法提交新工作区创建状态，原工作区选择保持不变"
            ) from exc

    @staticmethod
    def _creation_tree_is_owned(target: Path, workspace_id: str) -> bool:
        """Accept only files that the fresh SQLite bootstrap can create."""

        try:
            allowed_top_level = {
                ".infinite-canvas-service",
                ".infinite-canvas-workspace.json",
                "data",
                "assets",
            }
            for entry in target.iterdir():
                identity_temporary = (
                    entry.name.startswith(
                        "..infinite-canvas-workspace.json."
                    )
                    and entry.name.endswith(".tmp")
                )
                if (
                    entry.name not in allowed_top_level
                    and not identity_temporary
                ) or entry.is_symlink():
                    return False
                if (
                    entry.name == ".infinite-canvas-service"
                    and not entry.is_dir()
                ):
                    return False
                if (
                    entry.name == ".infinite-canvas-workspace.json"
                    and not entry.is_file()
                ):
                    return False
                if identity_temporary and not entry.is_file():
                    return False

            assets = target / "assets"
            if assets.exists():
                if not assets.is_dir() or any(assets.iterdir()):
                    return False

            data = target / "data"
            if not data.exists():
                return True
            if not data.is_dir() or data.is_symlink():
                return False

            bootstrap_directory = Path("recovery") / f"bootstrap-{workspace_id}"
            allowed_directories = {
                Path("recovery"),
                bootstrap_directory,
            }
            database_names = {
                "canvas-content.sqlite3",
                "generation-runs.sqlite3",
            }
            for entry in data.rglob("*"):
                if entry.is_symlink():
                    return False
                relative = entry.relative_to(data)
                if entry.is_dir():
                    if relative not in allowed_directories:
                        return False
                    continue
                if len(relative.parts) == 1:
                    name = relative.name
                    if name == "storage-authority.json":
                        continue
                    if any(
                        name == database
                        or name in {
                            f"{database}-wal",
                            f"{database}-shm",
                            f"{database}-journal",
                        }
                        for database in database_names
                    ):
                        continue
                    if (
                        name.startswith(".storage-authority.json.")
                        and name.endswith(".tmp")
                    ):
                        continue
                    return False
                if relative.parent == bootstrap_directory:
                    name = relative.name
                    if name == "fresh-workspace-bootstrap.json":
                        continue
                    if (
                        name.startswith(".fresh-workspace-bootstrap.json.")
                        and name.endswith(".tmp")
                    ):
                        continue
                return False
            return True
        except (OSError, RuntimeError, ValueError):
            return False

    def _creation_phase(
        self,
        target: Path,
        record: Optional[dict[str, str]],
    ) -> str:
        if record is None or record.get("target") != str(target):
            return ""
        original = self._storage.configured_parent_hint()
        if str(record.get("original") or "") != str(original or ""):
            return ""
        workspace_id = str(record.get("workspace_id") or "")
        if not self._creation_tree_is_owned(target, workspace_id):
            return ""
        existing_identity = self._workspace.identity(target)
        if existing_identity and existing_identity != workspace_id:
            return ""
        workspace = self._workspace.workspace_for_directory(target)
        content = WorkspaceContent(workspace)
        if content.storage_authority.is_file():
            if existing_identity != workspace_id:
                return ""
            try:
                composition = compose_workspace_storage(
                    content,
                    workspace_id=workspace_id,
                )
            except Exception:
                return ""
            return "creation_ready" if composition.sqlite_ready else ""
        if any(content.smart_canvases.glob("*.json")):
            return ""
        if content.generation_runs.is_file():
            return ""
        report = (
            content.canvas_content.parent
            / "recovery"
            / f"bootstrap-{workspace_id}"
            / "fresh-workspace-bootstrap.json"
        )
        if (
            (content.canvas_content.exists() or content.generation_run_store.exists())
            and not report.is_file()
        ):
            return ""
        return "creation_pending"

    def _create_summary(self, parent_dir: object) -> dict[str, object]:
        inspection = self._workspace.inspect(parent_dir)
        target = inspection.directory
        record = self._read_creation_record()
        phase = (
            self._creation_phase(target, record)
            if inspection.status != "unavailable"
            else ""
        )
        if phase:
            ready = phase == "creation_ready"
            return {
                "workspace_directory": str(target),
                "type": phase,
                "type_label": "已准备的新工作区" if ready else "待继续的新工作区",
                "intent": "create_new",
                "same_workspace": False,
                "warnings": [
                    (
                        "新工作区已完整建立，可以重新确认切换；原工作区"
                        "不会被修改或删除，账号、登录状态和全局角色保持不变"
                        if ready
                        else "已找到上次未完成的新工作区创建记录，可以安全继续；"
                        "原工作区选择保持不变"
                    )
                ],
                "can_continue": True,
            }
        if (
            record is not None
            and record.get("target") == str(target)
            and record.get("original")
            == self._storage.configured_parent_hint()
        ):
            return {
                "workspace_directory": str(target),
                "type": "incomplete",
                "type_label": "无法继续的新工作区",
                "intent": "create_new",
                "same_workspace": False,
                "warnings": [
                    "创建中的目录出现未知内容或身份不一致；为避免覆盖文件，"
                    "请选择其他空目录"
                ],
                "recommended_intent": "",
                "can_continue": False,
            }
        if inspection.status == "empty":
            return {
                "workspace_directory": str(target),
                "type": "empty",
                "type_label": "空目录",
                "intent": "create_new",
                "same_workspace": False,
                "warnings": [
                    "只会替换这台设备当前连接的工作区；原工作区不会被修改或删除，"
                    "账号、登录状态和全局角色保持不变"
                ],
                "can_continue": True,
            }
        recommended_intent = (
            "open_other" if inspection.status == "existing" else ""
        )
        warning = (
            "这里已经有一个工作区，请改用“打开另一个已有工作区”"
            if inspection.status == "existing"
            else (
                inspection.message
                if inspection.status == "unavailable"
                else "创建新工作区必须选择空目录；普通非空目录和不完整工作区不能使用"
            )
        )
        return {
            "workspace_directory": str(target),
            "type": inspection.status,
            "type_label": "不可创建新工作区",
            "intent": "create_new",
            "same_workspace": False,
            "warnings": [warning],
            "recommended_intent": recommended_intent,
            "can_continue": False,
        }

    def _summary(
        self,
        parent_dir: object,
        *,
        intent: str,
    ) -> dict[str, object]:
        normalized_intent = str(intent or "").strip().lower()
        if normalized_intent == "create_new":
            return self._create_summary(parent_dir)
        if normalized_intent not in {"reconnect", "open_other"}:
            raise WorkspaceStorageError(
                "请选择重新连接、打开另一个已有工作区或创建新的工作区"
            )
        summary = self._workspace.summarize(parent_dir, intent="open")
        public = summary.public()
        warnings = list(public.get("warnings") or [])
        complete_and_readable = (
            summary.kind == "existing"
            and not any(
                "部分内容无法读取" in str(warning)
                for warning in warnings
            )
        )
        workspace_id = (
            self._workspace.identity(summary.directory)
            if complete_and_readable
            else ""
        )
        remembered = self._device.workspace_identity()
        same_workspace = bool(
            workspace_id and remembered and workspace_id == remembered
        )
        can_continue = complete_and_readable
        if normalized_intent == "reconnect" and not same_workspace:
            can_continue = False
            warnings = [
                "所选目录不是原工作区，请改用“打开另一个已有工作区”"
            ]
        elif normalized_intent == "reconnect" and can_continue:
            warnings = [
                "已确认这是原工作区，重新连接后现有登录状态会保留"
            ]
        public.update(
            {
                "intent": normalized_intent,
                "same_workspace": same_workspace,
                "warnings": warnings,
                "can_continue": can_continue,
            }
        )
        return public

    def inspect_current(self) -> dict[str, object]:
        current = self._storage.configured_parent_hint()
        if not current:
            return {
                "workspace_directory": "",
                "intent": "retry",
                "same_workspace": False,
                "warnings": ["尚未保存可重试的工作区目录"],
                "can_continue": False,
            }
        summary = self._summary(current, intent="reconnect")
        summary["intent"] = "retry"
        return summary

    def inspect(
        self,
        parent_dir: str,
        *,
        intent: str,
    ) -> dict[str, object]:
        return self._summary(parent_dir, intent=intent)

    def _stage(
        self,
        parent_dir: object,
        *,
        intent: str,
    ) -> dict[str, object]:
        self.release()
        summary = self._summary(
            parent_dir,
            intent=("reconnect" if intent == "retry" else intent),
        )
        if not summary["can_continue"]:
            warnings = list(summary.get("warnings") or [])
            raise WorkspaceStorageError(
                str(warnings[0])
                if warnings
                else "所选工作区无法打开，请检查后重试"
            )
        target = Path(
            str(summary["workspace_directory"])
        ).expanduser().resolve()
        occupation = self._workspace.acquire_occupation(
            self._device.server_identity(),
            directory=target,
        )
        self._occupation = occupation
        original = self._storage.configured_parent_hint()
        creation_record: Optional[dict[str, str]] = None
        try:
            if intent == "create_new":
                existing_record = self._read_creation_record()
                phase = self._creation_phase(target, existing_record)
                creation_record = (
                    existing_record
                    if phase
                    else {
                        "operation_id": str(uuid.uuid4()),
                        "workspace_id": str(uuid.uuid4()),
                        "target": str(target),
                        "original": original,
                        "phase": "selected",
                    }
                )
                self._write_creation_record(creation_record)
            self._pending = {
                "intent": intent,
                "target": target,
                "original": original,
                "creation_record": creation_record,
            }
        except Exception:
            self.release()
            raise
        return {
            **summary,
            "intent": intent,
        }

    def stage_retry(self) -> dict[str, object]:
        with self._lock:
            current = self._storage.configured_parent_hint()
            if not current:
                raise WorkspaceStorageError(
                    "尚未保存可重试的工作区目录"
                )
            return self._stage(current, intent="retry")

    def stage(
        self,
        parent_dir: str,
        *,
        intent: str,
    ) -> dict[str, object]:
        with self._lock:
            return self._stage(parent_dir, intent=intent)

    def prepare_restart(self):
        with self._lock:
            return self._prepare_restart_locked()

    def _prepare_restart_locked(self):
        pending = self._pending
        if pending is None:
            raise WorkspaceStorageError(
                "请先检查并确认要恢复的工作区"
            )
        target = Path(str(pending["target"])).resolve()
        original = str(pending.get("original") or "")
        intent = str(pending["intent"])
        creation_record = pending.get("creation_record")
        changed_selection = False
        try:
            if intent == "create_new":
                if not isinstance(creation_record, dict):
                    raise WorkspaceStorageError(
                        "新工作区创建记录不存在，请重新选择空目录"
                    )
                workspace_id = str(creation_record.get("workspace_id") or "")
                before_phase = self._creation_phase(
                    target,
                    self._read_creation_record(),
                )
                if before_phase not in {"creation_pending", "creation_ready"}:
                    raise WorkspaceStorageError(
                        "新工作区目录已发生变化，请选择其他空目录"
                    )
                workspace = self._workspace.prepare_recovery_creation(
                    target,
                    workspace_id=workspace_id,
                )
                content = WorkspaceContent(workspace)
                bootstrap_fresh_workspace_sqlite(
                    content,
                    workspace_id=workspace_id,
                )
                composition = compose_workspace_storage(
                    content,
                    workspace_id=workspace_id,
                )
                if not composition.sqlite_ready:
                    raise WorkspaceStorageError(
                        "新工作区 SQLite 存储未通过完整性检查"
                    )
                if self._creation_phase(
                    target,
                    self._read_creation_record(),
                ) != "creation_ready":
                    raise WorkspaceStorageError(
                        "新工作区必需结构验证失败，原工作区选择保持不变"
                    )
                creation_record = {
                    **creation_record,
                    "phase": "ready",
                }
                self._write_creation_record(creation_record)
                self._storage.reconnect_parent(target)
                changed_selection = True
                self._delete_creation_record()
            elif intent != "retry":
                self._storage.reconnect_parent(target)
                changed_selection = True
        except Exception as exc:
            if changed_selection and original:
                self._storage.remember_parent(original)
            self.release()
            if isinstance(exc, WorkspaceStorageError):
                raise
            if isinstance(exc, FreshWorkspaceSqliteBootstrapError):
                detail = str(exc or "").strip()
            else:
                detail = ""
            raise WorkspaceStorageError(
                detail
                if detail
                else "新工作区创建失败，原工作区选择保持不变，请重试"
            ) from exc

        def rollback() -> None:
            if changed_selection and original:
                self._storage.remember_parent(original)
            if intent == "create_new" and isinstance(creation_record, dict):
                self._write_creation_record(
                    {**creation_record, "phase": "ready"}
                )
            self.release()

        return rollback

    def release(self) -> None:
        with self._lock:
            occupation = self._occupation
            self._occupation = None
            self._pending = None
            if occupation is not None:
                occupation.release()

    def select_directory(self) -> str:
        return choose_workspace_parent_directory()


def _project_dir() -> Path:
    configured = str(os.getenv("INFINITE_CANVAS_PROJECT_DIR") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def _version(project_dir: Path) -> str:
    try:
        return project_dir.joinpath("VERSION").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        return "unknown"


def create_default_application(
) -> tuple[RuntimeGateway, ApplicationRuntime, RestartSignal]:
    project_dir = _project_dir()
    state_dir = application_state_directory(project_dir)
    os.environ.setdefault(
        "INFINITE_CANVAS_INSTANCE_STATE_DIR",
        str(application_state_directory() / "instance-state"),
    )
    restart_signal = RestartSignal()
    initializer = LegacyInitializer()
    storage_migration = ControlledStorageMigration(
        content_provider=initializer.current_workspace_content,
        workspace_id_provider=initializer.current_workspace_id,
    )
    runtime = ApplicationRuntime(
        initializer=initializer,
        local_state_dir=state_dir,
        version=_version(project_dir),
        generation_runs=generation_run_control,
        restart_signal=restart_signal.set,
    )
    initializer.bind_runtime(runtime)
    recovery = ExistingWorkspaceRecovery(
        WorkspaceStorage(project_dir, state_dir=state_dir)
    )
    atexit.register(recovery.release)
    return (
        create_app(
            runtime,
            workspace_recovery=recovery,
            runtime_authorization=LegacyRuntimeAuthorization(),
            storage_migration=storage_migration,
            installation_id=installation_identity(project_dir),
        ),
        runtime,
        restart_signal,
    )


__all__ = [
    "RestartSignal",
    "create_default_application",
]
