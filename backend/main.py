if __name__ == "__main__":
    from infinite_canvas.__main__ import main as run_application

    raise SystemExit(run_application())

import json
import copy
import uuid
import atexit
import base64
import hashlib
import hmac
import datetime
import urllib.request
import urllib.parse
import urllib.error
import os
import re
import random
import sys
import subprocess
import time
import traceback
import shutil
import glob
import asyncio
import logging
import ipaddress
import requests
import zipfile
import mimetypes
import tempfile
import math
import shlex
import functools
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from threading import BoundedSemaphore, Lock, RLock, Thread
import httpx
from PIL import Image, ImageOps
from io import BytesIO
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from infinite_canvas.auth_system import (
    SESSION_COOKIE,
    auth_from_environment,
    current_user,
    install_access_control,
    install_auth_routes,
    require_current_user,
)
from infinite_canvas.batch_generation import (
    BatchGeneration,
    BatchGenerationValidation,
)
from infinite_canvas.canvas_permissions import (
    can_access_canvas,
    can_access_project,
)
from infinite_canvas.canvas_list_index import CanvasListIndex
from infinite_canvas.canvas_opening import stream_canvas_opening
from infinite_canvas.matting_service import (
    BiRefNetMattingEngine,
    MattingDependencyError,
    MattingModelError,
)
from infinite_canvas.outbound_security import (
    OutboundUrlError,
    httpx_get_public,
    requests_get_public,
)
from infinite_canvas.api_settings_transfer import (
    ApiSettingsTransferError,
    ApiSettingsPackage,
    MAX_PACKAGE_BYTES,
    _ApiSettingsStorageAdapter,
)
from infinite_canvas.workspace_storage import (
    WorkspaceStorage,
    WorkspaceStorageError,
    application_state_directory,
    choose_workspace_parent_directory,
)
from infinite_canvas.artifacts import (
    APPLICATION_UPDATE_ROOT_FILES,
    APPLICATION_UPDATE_RUNTIME_FILES,
    WorkspaceArtifacts,
)
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.prompt_library import PromptLibraryStorage
from infinite_canvas.canvas_store import prompt_template_item_version
from infinite_canvas.canvas_sync import (
    CREATE_CANVAS,
    DEFAULT_PROJECT_ID,
    DELETE_PROJECT,
    PURGE_CANVAS,
    RESTORE_CANVAS,
    SAVE_SNAPSHOT,
    UPDATE_PROMPT_TEMPLATES,
    SET_VISIBILITY,
    TOUCH_CANVAS,
    TRASH_CANVAS,
    UPDATE_METADATA,
    CanvasCommand,
    CanvasSync,
    CanvasSyncError,
    normalize_canvas_color,
    normalize_canvas_cover_url,
    normalize_canvas_kind,
)
from infinite_canvas.connection_manager import ConnectionManager
from infinite_canvas.realtime_presence import RealtimePresenceManager
from infinite_canvas.generation_effect_dispatcher import (
    CanvasSyncGenerationEffectTarget,
)
from infinite_canvas.generation_publication import SqliteGenerationPublication
from infinite_canvas.generation_sqlite_runtime import GenerationSqliteRuntime
from infinite_canvas.workspace_storage_composition import (
    WorkspaceStorageCompositionError,
    compose_workspace_storage,
)
from infinite_canvas.sqlite_workspace_bootstrap import (
    bootstrap_fresh_workspace_sqlite,
    fresh_workspace_sqlite_bootstrap_required,
)
from infinite_canvas.device_state import DeviceState
from infinite_canvas.instance_state import InstanceState
from infinite_canvas.device_cache import (
    DeviceCache,
    application_cache_directory,
)
from infinite_canvas.depth_processor import DepthAnythingV2SmallProcessor
from infinite_canvas.local_image_processor import (
    LocalImageProcessorGenerationExecutor,
)
from infinite_canvas.design_tokens import (
    DesignTokenConflict,
    DesignTokenValidation,
    DesignTokenWorkbench,
)
from infinite_canvas.cli_updates import build_default_manager as build_cli_update_manager
from infinite_canvas.generation_settings import GenerationSettingsService
from infinite_canvas.image_capabilities import (
    ImageCapabilityRegistry,
    intersect_capabilities,
    normalize_image_aspect,
)
from infinite_canvas.image_materialization import materialize_image_cover
from infinite_canvas.model_capabilities import (
    CAPABILITY_SCHEMA_VERSION,
    ModelCapabilityCatalog,
    ModelCapabilityContext,
)
from infinite_canvas.model_capability_workbench import (
    ModelCapabilityWorkbench,
    ModelCapabilityWorkbenchConflict,
    ModelCapabilityWorkbenchPublication,
    ModelCapabilityWorkbenchValidation,
)
from infinite_canvas.video_capabilities import VideoCapabilityRegistry
from infinite_canvas.generation_runs import (
    Background,
    CanvasGenerationTargetGuard,
    GenerationEffectPorts,
    GenerationOutputPorts,
    GenerationRunError,
    GenerationRunValidation,
    GenerationRuns,
    ImageRun,
    Inline,
    ProviderGenerationExecutor,
    RecoveryRun,
    RunTarget,
    TextRun,
    VideoRun,
    WorkflowRun,
    WorkspaceGenerationEffects,
    generation_run_control,
)
from infinite_canvas.media import WorkspaceMediaService
from infinite_canvas.asset_library import (
    ASSET_LIBRARY_PAGE_LIMIT,
    AssetLibraryBatchError,
    AssetLibraryError,
    AssetPublicationCandidate,
    WorkspaceAssetLibrary,
)
from infinite_canvas.providers import implementation as _provider_implementation
from infinite_canvas.providers.inspector import (
    InspectorFunctions,
    build_inspector_runtime,
)
from infinite_canvas.providers.ports import (
    ProviderPorts,
    bind_provider_implementation,
    install_provider_ports,
)
from infinite_canvas.providers.runtime import (
    ImageExecutors,
    ProviderRuntime,
    RecoveryExecutors,
    TextExecutors,
    VideoExecutors,
    WorkflowExecutors,
    build_image_registry,
    build_recovery_registry,
    build_text_registry,
    build_video_registry,
    build_workflow_registry,
)

# Temporary import compatibility for internal call sites and third-party
# extensions.  Production generation and inspection enter through the
# registries below; the aliases avoid hundreds of pass-through definitions.
for _provider_export_name in _provider_implementation._CATEGORY_EXPORTS:
    if _provider_export_name == "jimeng_use_wsl":
        continue
    globals()[_provider_export_name] = getattr(
        _provider_implementation, _provider_export_name
    )


def jimeng_use_wsl():
    """Compatibility export with explicit CLI-detection ports."""
    return _provider_implementation.jimeng_use_wsl(
        env_reader=jimeng_env_value,
        native_executable=jimeng_native_cli_executable,
        wsl_available=jimeng_wsl_dreamina_available,
    )
from infinite_canvas.workspace import (
    Workspace,
    WorkspaceMoveError,
    WorkspaceMoveExecutor,
    WorkspaceService,
)

QUIET_ACCESS_PATHS = {
    "/api/queue_status",
    "/api/canvases",
    "/api/canvases/trash",
}
QUIET_ACCESS_PREFIXES = (
    "/api/canvases/",
)

class QuietAccessLogFilter(logging.Filter):
    def filter(self, record):
        args = record.args if isinstance(record.args, tuple) else ()
        if len(args) >= 3:
            raw_path = str(args[2])
            if raw_path.startswith("/share/") or raw_path.startswith("/api/shares/"):
                sanitized_args = list(args)
                sanitized_args[2] = re.sub(
                    r"^(/(?:api/)?shares?)/[^/?]+",
                    r"\1/[redacted]",
                    raw_path,
                )
                record.args = tuple(sanitized_args)
                args = record.args
            path = str(args[2]).split("?", 1)[0]
            status = int(args[4]) if len(args) >= 5 and str(args[4]).isdigit() else 0
            quiet_dynamic = (
                any(path.startswith(prefix) and path.endswith("/meta") for prefix in QUIET_ACCESS_PREFIXES)
                or path.startswith("/api/smart-canvas/matting/")
                or (
                    path.startswith("/api/smart-canvas/")
                    and path.endswith("/view-state")
                )
            )
            if (path in QUIET_ACCESS_PATHS or quiet_dynamic) and status < 400:
                return False
        message = record.getMessage()
        if any(f'"GET {path}' in message and '" 200' in message for path in QUIET_ACCESS_PATHS):
            return False
        if 'GET /api/canvases/' in message and '/meta' in message and '" 200' in message:
            return False
        if 'GET /api/smart-canvas/matting/' in message and '" 200' in message:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(QuietAccessLogFilter())

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("INFINITE_CANVAS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()
PRESENCE_MANAGER = RealtimePresenceManager(manager)
GLOBAL_LOOP = None
_RUNTIME_RESTART_REQUESTER = None
_RUNTIME_ASYNC_RESTART_REQUESTER = None
_CLI_UPDATE_TASK = None


def install_runtime_control(
    restart_requester,
    async_restart_requester=None,
):
    """Install the temporary inward adapter used by legacy update routes."""
    global _RUNTIME_RESTART_REQUESTER, _RUNTIME_ASYNC_RESTART_REQUESTER
    _RUNTIME_RESTART_REQUESTER = restart_requester
    _RUNTIME_ASYNC_RESTART_REQUESTER = async_restart_requester


def request_controlled_restart(cancel_active: bool = False):
    if _RUNTIME_RESTART_REQUESTER is None:
        return {"stage": "", "blocking_generation_runs": 0}
    try:
        return _RUNTIME_RESTART_REQUESTER(cancel_active=cancel_active)
    except Exception as exc:
        logging.exception("controlled restart request failed: %s", exc)
        return {"stage": "failed", "blocking_generation_runs": 0}

def _prepare_startup_state():
    if WORKSPACE_CONFIGURED:
        startup_composition = compose_workspace_storage(
            current_workspace_content(),
            workspace_id=current_workspace_id(),
        )
        if (
            WORKSPACE_STORAGE_COMPOSITION is None
            or startup_composition.mode
            != WORKSPACE_STORAGE_COMPOSITION.mode
        ):
            raise WorkspaceStorageCompositionError(
                "存储权威在应用加载后发生变化，拒绝部分启动"
            )
    if not AUTH_SYSTEM.needs_initial_setup():
        migrate_all_canvas_access()


@app.on_event("startup")
async def startup_event():
    global GLOBAL_LOOP, _CLI_UPDATE_TASK
    if WORKSPACE_CONFIGURED:
        ensure_workspace_occupation()
        remember_current_workspace_identity()
    GLOBAL_LOOP = asyncio.get_running_loop()
    await asyncio.to_thread(_prepare_startup_state)
    if _GENERATION_SQLITE_RUNTIME is not None:
        await _GENERATION_RUNS.restore_lifecycle_authority()
        await _GENERATION_SQLITE_RUNTIME.start()
        publication_recovery = (
            await _GENERATION_EFFECTS.recover_pending_publications()
        )
        if publication_recovery.get("failed"):
            logging.warning(
                "SQLite Generation publication recovery failures: %s",
                publication_recovery["failed"],
            )
    await generation_run_control.resume_active()
    if _GENERATION_SQLITE_RUNTIME is None:
        try:
            receipt_recovery = (
                await _GENERATION_RUNS.recover_legacy_effect_receipts()
            )
            if receipt_recovery.get("failed"):
                logging.warning(
                    "legacy Generation effect receipt recovery failures: %s",
                    receipt_recovery["failed"],
                )
        except Exception:
            logging.exception("legacy Generation effect receipt recovery failed")
        try:
            repair = await _GENERATION_RUNS.repair_publication_outputs(
                "batch-generation"
            )
            if repair.get("failed"):
                logging.warning(
                    "batch Generation Output repair failures: %s",
                    repair["failed"],
                )
        except Exception:
            logging.exception("batch Generation Output repair failed")
    batch_generation = globals().get("_BATCH_GENERATION")
    if batch_generation is not None:
        await batch_generation.resume_pending()
        await batch_generation.start_scheduler()
    cli_update_manager = globals().get("CLI_UPDATE_MANAGER")
    if cli_update_manager is not None:
        # Discovery must never hold the application startup gate.  The manager
        # keeps the completed snapshot for administrators who sign in later.
        _CLI_UPDATE_TASK = asyncio.create_task(cli_update_manager.check_all())


@app.on_event("shutdown")
async def shutdown_event():
    global MATTING_WORKER_TASKS, _CLI_UPDATE_TASK
    try:
        batch_generation = globals().get("_BATCH_GENERATION")
        if batch_generation is not None:
            await batch_generation.stop_scheduler()
        await generation_run_control.pause_active()
        if _GENERATION_SQLITE_RUNTIME is not None:
            await _GENERATION_SQLITE_RUNTIME.close()
        tasks = list(MATTING_WORKER_TASKS)
        MATTING_WORKER_TASKS = []
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if _CLI_UPDATE_TASK is not None and not _CLI_UPDATE_TASK.done():
            _CLI_UPDATE_TASK.cancel()
            await asyncio.gather(_CLI_UPDATE_TASK, return_exceptions=True)
        _CLI_UPDATE_TASK = None
    finally:
        cancel_pending_workspace_open()
        release_workspace_occupation()

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    user = AUTH_SYSTEM.user_for_session(websocket.cookies.get(SESSION_COOKIE, ""))
    if not user or user.get("role") == "guest":
        await websocket.close(code=4401)
        return
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket, client_id)
    except Exception as e:
        print(f"WS Error: {e}")
        await manager.disconnect(websocket, client_id)


@app.websocket("/ws/canvases/{canvas_id}")
async def canvas_realtime_endpoint(
    websocket: WebSocket,
    canvas_id: str,
    client_id: str = "",
):
    actor = enrich_current_workspace_user(
        AUTH_SYSTEM.user_for_session(
            websocket.cookies.get(SESSION_COOKIE, "")
        )
    )
    try:
        session = await CANVAS_SYNC.open_realtime(
            websocket,
            canvas_id,
            actor,
            client_id,
        )
    except CanvasSyncError:
        await websocket.close(code=4404)
        return
    if session is None:
        return
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await CANVAS_SYNC.reject_invalid_realtime_json(session)
                continue
            actor = enrich_current_workspace_user(
                AUTH_SYSTEM.user_for_session(
                    websocket.cookies.get(SESSION_COOKIE, "")
                )
            )
            try:
                await CANVAS_SYNC.receive_realtime(
                    session,
                    actor,
                    message,
                    raw_size=len(raw.encode("utf-8")),
                )
            except CanvasSyncError:
                await websocket.close(code=4403)
                return
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"Canvas realtime error ({canvas_id}): {exc}")
    finally:
        await CANVAS_SYNC.close_realtime(session)


# --- 配置区域 ---

CLIENT_ID = str(uuid.uuid4())
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(BACKEND_DIR)
DEVICE_STATE_DIR = str(application_state_directory(BASE_DIR))
DEVICE_CACHE_DIR = str(application_cache_directory(BASE_DIR))
INSTANCE_STATE = InstanceState(DEVICE_STATE_DIR)
MODEL_CAPABILITY_WORKBENCH = ModelCapabilityWorkbench(
    INSTANCE_STATE.directory / "model-capability-workbench.json"
)
IMAGE_CAPABILITY_REGISTRY = ImageCapabilityRegistry(
    os.path.join(BASE_DIR, "resources", "image-model-capabilities.json")
)
VIDEO_CAPABILITY_REGISTRY = VideoCapabilityRegistry(
    os.path.join(BASE_DIR, "resources", "video-model-capabilities.json")
)
MODEL_CAPABILITY_CATALOG = ModelCapabilityCatalog(
    image_registry=IMAGE_CAPABILITY_REGISTRY,
    video_registry=VIDEO_CAPABILITY_REGISTRY,
    text_path=os.path.join(BASE_DIR, "resources", "text-model-capabilities.json"),
    revision_paths=(
        os.path.join(BASE_DIR, "resources", "image-model-capabilities.json"),
        os.path.join(BASE_DIR, "resources", "video-model-capabilities.json"),
        os.path.join(BASE_DIR, "resources", "text-model-capabilities.json"),
    ),
    published_path=MODEL_CAPABILITY_WORKBENCH.path,
)
WORKSPACE_STORAGE = WorkspaceStorage(BASE_DIR, state_dir=DEVICE_STATE_DIR)
WORKSPACE_SERVICE = WorkspaceService(WORKSPACE_STORAGE)
_CONFIGURED_WORKSPACE, WORKSPACE_CONFIGURATION_ERROR = (
    WORKSPACE_SERVICE.try_current()
)
WORKSPACE_CONFIGURED = _CONFIGURED_WORKSPACE is not None
WORKSPACE_SELECTION_PRESENT = WORKSPACE_STORAGE.has_configuration()
DEVICE_STATE = DeviceState(DEVICE_STATE_DIR)
DEVICE_CACHE = DeviceCache(DEVICE_CACHE_DIR)
WORKSPACE_SERVER_ID = DEVICE_STATE.server_identity()
WORKSPACE_OCCUPATION = None
WORKSPACE_TAKEOVER_CONFIRMED = str(
    os.getenv("INFINITE_CANVAS_WORKSPACE_TAKEOVER") or ""
).strip().lower() in {"1", "true", "yes", "on"}
WORKSPACE_OPEN_LOCK = Lock()
PENDING_WORKSPACE_OPEN = None
WORKSPACE_MOVE_LOCK = Lock()
PENDING_WORKSPACE_MOVE = None
WORKSPACE_MOVE_RUNTIME_TASK = None
WORKSPACE_MOVE_STATUS_LOCK = Lock()
WORKSPACE_MOVE_STATUS_FILE = (
    Path(DEVICE_STATE_DIR) / "workspace-move-status.json"
)


def _read_workspace_move_status() -> Dict[str, Any]:
    try:
        raw = json.loads(
            WORKSPACE_MOVE_STATUS_FILE.read_text(encoding="utf-8-sig")
        )
    except (OSError, ValueError, TypeError):
        return {}
    return raw if isinstance(raw, dict) else {}


WORKSPACE_MOVE_STATUS = _read_workspace_move_status()
WORKSPACE_MOVE_STAGE_ORDER = {
    "waiting_for_generation_tasks": 0,
    "preparing": 1,
    "copying": 2,
    "verifying": 3,
    "prepared": 4,
    "switching": 5,
    "restarting": 6,
    "completed": 7,
}
WORKSPACE_MOVE_TERMINAL_STAGES = {"completed", "failed"}


def _write_workspace_move_status(payload: Dict[str, Any]) -> None:
    WORKSPACE_MOVE_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = WORKSPACE_MOVE_STATUS_FILE.with_name(
        f".{WORKSPACE_MOVE_STATUS_FILE.name}.{uuid.uuid4().hex}.tmp"
    )
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, WORKSPACE_MOVE_STATUS_FILE)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def update_workspace_move_status(**changes) -> Dict[str, Any]:
    global WORKSPACE_MOVE_STATUS
    with WORKSPACE_MOVE_STATUS_LOCK:
        current = dict(WORKSPACE_MOVE_STATUS)
        current_operation = str(current.get("operation_id") or "")
        incoming_operation = str(
            changes.get("operation_id") or current_operation
        )
        same_operation = (
            bool(current_operation)
            and incoming_operation == current_operation
        )
        if not same_operation:
            current = {}
        elif current.get("stage") in WORKSPACE_MOVE_TERMINAL_STAGES:
            return dict(current)
        else:
            current_stage = str(current.get("stage") or "")
            incoming_stage = str(changes.get("stage") or current_stage)
            if (
                incoming_stage != "failed"
                and WORKSPACE_MOVE_STAGE_ORDER.get(incoming_stage, -1)
                < WORKSPACE_MOVE_STAGE_ORDER.get(current_stage, -1)
            ):
                changes.pop("stage", None)
                changes.pop("message", None)
                changes.pop("blocking_generation_tasks", None)
            for key in (
                "file_count",
                "total_bytes",
                "copied_files",
                "copied_bytes",
            ):
                if key in changes:
                    changes[key] = max(
                        int(current.get(key) or 0),
                        int(changes.get(key) or 0),
                    )
            if current.get("finished"):
                changes["finished"] = True
        next_status = {
            **current,
            **changes,
            "updated_at": int(time.time() * 1000),
        }
        WORKSPACE_MOVE_STATUS = next_status
        _write_workspace_move_status(next_status)
        return dict(next_status)


def workspace_move_status() -> Dict[str, Any]:
    with WORKSPACE_MOVE_STATUS_LOCK:
        status = dict(WORKSPACE_MOVE_STATUS)
    if not status:
        return {
            "stage": "idle",
            "message": "当前没有进行中的工作区搬家。",
            "blocking_generation_tasks": 0,
            "file_count": 0,
            "total_bytes": 0,
            "copied_files": 0,
            "copied_bytes": 0,
            "finished": True,
        }
    if status.get("stage") == "waiting_for_generation_tasks":
        counter = globals().get("active_generation_run_count")
        if callable(counter):
            status["blocking_generation_tasks"] = counter()
    return status


def ensure_workspace_occupation(
    workspace_directory: str = "",
    *,
    allow_foreign_takeover: bool = False,
):
    """Hold unique write ownership before any Workspace Data writer starts."""

    global WORKSPACE_OCCUPATION
    requested = (
        Path(workspace_directory).expanduser().resolve()
        if workspace_directory
        else None
    )
    if WORKSPACE_OCCUPATION is not None and WORKSPACE_OCCUPATION.active:
        if requested is None or WORKSPACE_OCCUPATION.directory == requested:
            return WORKSPACE_OCCUPATION
        raise WorkspaceStorageError(
            "当前服务已经在使用另一个工作区，请先完成受控重启"
        )
    WORKSPACE_OCCUPATION = WORKSPACE_SERVICE.acquire_occupation(
        WORKSPACE_SERVER_ID,
        directory=str(requested) if requested is not None else "",
        allow_foreign_takeover=allow_foreign_takeover,
    )
    return WORKSPACE_OCCUPATION


def release_workspace_occupation() -> None:
    global WORKSPACE_OCCUPATION
    occupation = WORKSPACE_OCCUPATION
    WORKSPACE_OCCUPATION = None
    if occupation is not None:
        occupation.release()


def remember_current_workspace_identity() -> str:
    """Record the successfully owned Workspace for later recovery."""

    identity = WORKSPACE_SERVICE.ensure_identity()
    return DEVICE_STATE.remember_workspace_identity(identity)


def current_workspace_id() -> str:
    """Return the stable identity of the selected content Workspace."""

    identity = WORKSPACE_SERVICE.identity()
    if identity:
        return identity
    if WORKSPACE_CONFIGURED:
        return remember_current_workspace_identity()
    return ""


def stage_workspace_open(
    workspace_directory: str,
    *,
    actor_id: str,
) -> Dict[str, Any]:
    """Hold a validated target until ApplicationRuntime reaches safe restart."""

    global PENDING_WORKSPACE_OPEN
    target = Path(workspace_directory).expanduser().resolve()
    with WORKSPACE_MOVE_LOCK:
        if PENDING_WORKSPACE_MOVE is not None:
            raise WorkspaceStorageError(
                "工作区正在等待搬家，请完成当前操作后再试"
            )
    with WORKSPACE_OPEN_LOCK:
        pending = PENDING_WORKSPACE_OPEN
        if pending is not None:
            if pending["target"] == target:
                return {
                    "workspace_directory": str(target),
                    "pending": True,
                }
            raise WorkspaceStorageError(
                "另一个工作区正在等待打开，请完成当前操作后再试"
            )

        summary = WORKSPACE_SERVICE.summarize(target, intent="open")
        if not summary.can_continue:
            raise WorkspaceStorageError(
                summary.warnings[0]
                if summary.warnings
                else "所选目录不是可以打开的已有工作区"
            )
        occupation = WORKSPACE_SERVICE.acquire_occupation(
            WORKSPACE_SERVER_ID,
            directory=target,
        )
        try:
            confirmed = WORKSPACE_SERVICE.summarize(
                target,
                intent="open",
            )
            if not confirmed.can_continue:
                raise WorkspaceStorageError(
                    confirmed.warnings[0]
                    if confirmed.warnings
                    else "所选工作区已经发生变化，请重新选择"
                )
            PENDING_WORKSPACE_OPEN = {
                "source": WORKSPACE_SERVICE.current().directory,
                "target": target,
                "actor_id": str(actor_id or ""),
                "occupation": occupation,
                "prepared": False,
            }
            return {
                "workspace_directory": str(target),
                "pending": True,
            }
        except Exception:
            occupation.release()
            raise


def cancel_pending_workspace_open() -> None:
    global PENDING_WORKSPACE_OPEN
    with WORKSPACE_OPEN_LOCK:
        pending = PENDING_WORKSPACE_OPEN
        PENDING_WORKSPACE_OPEN = None
    if pending is not None:
        pending["occupation"].release()


def stage_workspace_move(
    workspace_directory: str,
    *,
    actor_id: str,
    return_url: str = "/",
) -> Dict[str, Any]:
    """Record one validated move without freezing or copying yet."""

    global PENDING_WORKSPACE_MOVE
    target = Path(workspace_directory).expanduser().resolve()
    with WORKSPACE_OPEN_LOCK:
        if PENDING_WORKSPACE_OPEN is not None:
            raise WorkspaceStorageError(
                "另一个工作区正在等待打开，请完成当前操作后再试"
            )
    with WORKSPACE_MOVE_LOCK:
        pending = PENDING_WORKSPACE_MOVE
        if pending is not None:
            if pending["target"] == target:
                return {
                    **workspace_move_status(),
                    "existing_operation": True,
                }
            raise WorkspaceStorageError(
                "另一次工作区搬家已经在进行，请等待完成"
            )
        previous = workspace_move_status()
        previous_target = str(
            previous.get("target_workspace_directory") or ""
        ).strip()
        if (
            previous.get("stage") == "failed"
            and previous_target
            and Path(previous_target).expanduser().resolve() == target
        ):
            try:
                WorkspaceMoveExecutor.cleanup_temporary(
                    target,
                    operation_id=previous.get("operation_id"),
                )
            except OSError as exc:
                raise WorkspaceStorageError(
                    "无法清理上次搬家留下的临时内容，请检查目标位置后重试"
                ) from exc
        active_tasks = active_generation_run_count()
        plan = WORKSPACE_SERVICE.plan_move(
            target,
            active_generation_tasks=active_tasks,
        )
        operation_id = uuid.uuid4().hex
        safe_return_url = _workspace_move_return_url(return_url)
        progress_url = (
            "/workspace-move?"
            + urllib.parse.urlencode({"operation_id": operation_id})
        )
        PENDING_WORKSPACE_MOVE = {
            "operation_id": operation_id,
            "source": plan.source,
            "target": plan.target,
            "actor_id": str(actor_id or ""),
            "file_count": plan.file_count,
            "total_bytes": plan.total_bytes,
            "return_url": safe_return_url,
            "prepared": False,
        }
        waiting = active_tasks > 0
        status = update_workspace_move_status(
            operation_id=operation_id,
            stage=(
                "waiting_for_generation_tasks"
                if waiting
                else "preparing"
            ),
            message=(
                f"正在等待 {active_tasks} 个生成任务完成…"
                if waiting
                else "正在进入维护状态，准备搬家…"
            ),
            source_workspace_directory=str(plan.source),
            target_workspace_directory=str(plan.target),
            blocking_generation_tasks=active_tasks,
            file_count=plan.file_count,
            total_bytes=plan.total_bytes,
            copied_files=0,
            copied_bytes=0,
            finished=False,
            failed_stage="",
            related_path="",
            return_url=safe_return_url,
            progress_url=progress_url,
        )
        return {**status, "existing_operation": False}


def _workspace_move_return_url(value: object) -> str:
    candidate = str(value or "").strip()
    if (
        not candidate
        or len(candidate) > 2048
        or not candidate.startswith("/")
        or candidate.startswith("//")
    ):
        return "/"
    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme or parsed.netloc:
        return "/"
    return urllib.parse.urlunsplit(
        ("", "", parsed.path, parsed.query, parsed.fragment)
    )


def _public_workspace_relative_path(value: object) -> str:
    raw_relative = str(value or "").replace("\\", "/")
    relative = raw_relative.strip("/")
    if (
        not relative
        or raw_relative.startswith("/")
        or (
            len(raw_relative) >= 3
            and raw_relative[1] == ":"
            and raw_relative[2] == "/"
        )
        or ".." in Path(relative).parts
    ):
        return ""
    parts = relative.split("/")
    if parts[0] == "assets":
        public_parts = ["媒体", *parts[1:]]
    elif parts[:2] == ["data", "canvases"]:
        public_parts = ["Smart Canvas", *parts[2:]]
    elif parts[0] == "data" and parts[-1].startswith("auth.db"):
        return "旧账号迁移记录"
    elif parts[0] == "data":
        public_parts = ["工作区内容", *parts[1:]]
    else:
        public_parts = ["工作区内容", *parts]
    return "/".join(part for part in public_parts if part)


def fail_pending_workspace_move(
    message: str,
    *,
    failed_stage: str = "",
    related_path: str = "",
) -> Dict[str, Any]:
    global PENDING_WORKSPACE_MOVE
    with WORKSPACE_MOVE_LOCK:
        PENDING_WORKSPACE_MOVE = None
    return update_workspace_move_status(
        stage="failed",
        message=(
            str(message or "").strip()
            or "工作区搬家未完成，当前工作区继续可用。"
        ),
        blocking_generation_tasks=0,
        failed_stage=str(failed_stage or ""),
        related_path=_public_workspace_relative_path(related_path),
        finished=True,
    )


async def _prepare_workspace_move():
    """Freeze writers, make a verified copy, switch, and return rollback."""

    global PENDING_WORKSPACE_MOVE
    with WORKSPACE_MOVE_LOCK:
        pending = PENDING_WORKSPACE_MOVE
        if pending is None:
            return None
        if pending.get("prepared"):
            return pending.get("rollback")
        pending = dict(pending)

    source = pending["source"]
    target = pending["target"]
    promoted = False
    try:
        current = WORKSPACE_SERVICE.current().directory
        if current != source:
            raise WorkspaceStorageError(
                "当前工作区已经发生变化，请重新选择搬家位置"
            )
        WORKSPACE_SERVICE.plan_move(
            target,
            active_generation_tasks=0,
        )
        update_workspace_move_status(
            stage="preparing",
            message="正在停止新的操作并安全保存工作区…",
            blocking_generation_tasks=0,
        )
        await PRESENCE_MANAGER.close_all()
        await manager.close_for_workspace_move()
        await shutdown_event()
        def report_progress(
            stage: str,
            copied_files: int,
            copied_bytes: int,
        ) -> None:
            messages = {
                "copying": "正在把工作区复制到新位置…",
                "verifying": "正在逐文件校验搬家结果…",
                "prepared": "校验完成，正在切换工作区目录…",
            }
            update_workspace_move_status(
                stage=stage,
                message=messages.get(stage, "正在安全搬家…"),
                copied_files=copied_files,
                copied_bytes=copied_bytes,
            )

        result = await asyncio.to_thread(
            WorkspaceMoveExecutor(
                source,
                target,
                operation_id=pending["operation_id"],
                progress=report_progress,
            ).copy_and_verify
        )
        promoted = True
        update_workspace_move_status(
            stage="switching",
            message="校验完成，正在切换工作区目录…",
            copied_files=result.file_count,
            copied_bytes=result.total_bytes,
        )
        ensure_workspace_occupation(str(target))
        WORKSPACE_STORAGE.save_parent(target)
        update_workspace_move_status(
            stage="restarting",
            message=(
                "工作区已完成校验并切换，正在安全重启 "
                "Reroll…"
            ),
            copied_files=result.file_count,
            copied_bytes=result.total_bytes,
            blocking_generation_tasks=0,
            finished=False,
        )

        def rollback() -> None:
            global PENDING_WORKSPACE_MOVE
            try:
                WORKSPACE_STORAGE.reconnect_parent(source)
            finally:
                release_workspace_occupation()
                ensure_workspace_occupation(str(source))
                with WORKSPACE_MOVE_LOCK:
                    PENDING_WORKSPACE_MOVE = None
                update_workspace_move_status(
                    stage="failed",
                    message=(
                        "无法完成安全重启，当前工作区继续可用；"
                        "新位置保留了已校验的工作区副本。"
                    ),
                    blocking_generation_tasks=0,
                    failed_stage="restarting",
                    related_path="",
                    finished=True,
                )

        with WORKSPACE_MOVE_LOCK:
            if PENDING_WORKSPACE_MOVE is not None:
                PENDING_WORKSPACE_MOVE["prepared"] = True
                PENDING_WORKSPACE_MOVE["rollback"] = rollback
        return rollback
    except Exception as exc:
        try:
            WORKSPACE_STORAGE.reconnect_parent(source)
        except Exception:
            pass
        release_workspace_occupation()
        try:
            ensure_workspace_occupation(str(source))
        except Exception:
            pass
        detail = (
            str(exc).strip()
            if isinstance(exc, WorkspaceStorageError)
            else ""
        )
        failed_stage = str(
            getattr(
                exc,
                "stage",
                workspace_move_status().get("stage") or "preparing",
            )
        )
        related_path = str(getattr(exc, "relative_path", "") or "")
        suffix = (
            "；新位置保留了已校验的工作区副本。"
            if promoted
            else "。"
        )
        message = (
            (detail.rstrip("。") + "。")
            if detail and "当前工作区继续可用" in detail
            else (
                f"{detail.rstrip('。')}，当前工作区继续可用{suffix}"
                if detail
                else f"工作区搬家未完成，当前工作区继续可用{suffix}"
            )
        )
        fail_pending_workspace_move(
            message,
            failed_stage=failed_stage,
            related_path=related_path,
        )
        raise WorkspaceStorageError(message) from exc


def prepare_controlled_restart():
    """Apply a confirmed Workspace operation at the runtime safe point."""

    with WORKSPACE_MOVE_LOCK:
        if PENDING_WORKSPACE_MOVE is not None:
            return _prepare_workspace_move()

    global PENDING_WORKSPACE_OPEN
    with WORKSPACE_OPEN_LOCK:
        pending = PENDING_WORKSPACE_OPEN
        if pending is None or pending.get("prepared"):
            return
        try:
            if not pending["occupation"].active:
                raise WorkspaceStorageError(
                    "目标工作区不再可用，请重新选择"
                )
            current = WORKSPACE_SERVICE.current().directory
            if current != pending["source"]:
                raise WorkspaceStorageError(
                    "当前工作区已经发生变化，请重新选择"
                )
            summary = WORKSPACE_SERVICE.summarize(
                pending["target"],
                intent="open",
            )
            if not summary.can_continue:
                raise WorkspaceStorageError(
                    summary.warnings[0]
                    if summary.warnings
                    else "目标工作区无法打开，请重新选择"
                )
            WORKSPACE_SERVICE.open_existing(pending["target"])
            pending["prepared"] = True
        except Exception:
            PENDING_WORKSPACE_OPEN = None
            pending["occupation"].release()
            raise


atexit.register(release_workspace_occupation)
atexit.register(cancel_pending_workspace_open)


if WORKSPACE_CONFIGURED:
    ensure_workspace_occupation(
        allow_foreign_takeover=WORKSPACE_TAKEOVER_CONFIRMED,
    )

CURRENT_WORKSPACE_ID = (
    remember_current_workspace_identity() if WORKSPACE_CONFIGURED else ""
)


def reconcile_workspace_move_status() -> None:
    status = workspace_move_status()
    stage = str(status.get("stage") or "")
    if stage == "restarting" and WORKSPACE_CONFIGURED:
        try:
            current = WORKSPACE_SERVICE.current().directory
            target = Path(
                str(
                    status.get("target_workspace_directory")
                    or ""
                )
            ).expanduser().resolve()
        except (OSError, WorkspaceStorageError):
            current = None
            target = None
        if current is not None and current == target:
            update_workspace_move_status(
                stage="completed",
                message=(
                    "工作区已搬到新位置，原工作区仍保留。"
                    "你可以继续使用 Reroll。"
                ),
                blocking_generation_tasks=0,
                finished=True,
            )
            return
    if stage in {
        "waiting_for_generation_tasks",
        "preparing",
        "copying",
        "verifying",
        "prepared",
        "restarting",
    }:
        update_workspace_move_status(
            stage="failed",
            message=(
                "上次工作区搬家没有完成，当前工作区继续可用。"
            ),
            blocking_generation_tasks=0,
            failed_stage=stage,
            related_path="",
            finished=True,
        )


reconcile_workspace_move_status()

SETUP_STATE_DIR = os.path.join(DEVICE_STATE_DIR, "setup")
RESOURCE_WORKFLOW_DIR = os.path.join(BASE_DIR, "resources", "workflows")
WORKFLOW_PATH = os.path.join(RESOURCE_WORKFLOW_DIR, "Z-Image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
DESIGN_TOKEN_SOURCE = Path(STATIC_DIR) / "css" / "design-tokens.css"
DESIGN_TOKEN_WORKBENCH = DesignTokenWorkbench(DESIGN_TOKEN_SOURCE)
STATIC_RUNNINGHUB_DIR = os.path.join(STATIC_DIR, "runninghub")
STATIC_RUNNINGHUB_THUMBNAIL_DIR = os.path.join(STATIC_RUNNINGHUB_DIR, "thumbnails")
STATIC_RUNNINGHUB_API_PROVIDERS_FILE = os.path.join(STATIC_RUNNINGHUB_DIR, "api_providers.json")
STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE = os.path.join(STATIC_RUNNINGHUB_DIR, "models_registry.json")
API_ENV_FILE = os.path.join(DEVICE_STATE_DIR, "api.env")
PROVIDER_CONNECTIONS_FILE = os.path.join(
    DEVICE_STATE_DIR,
    "provider-connections.json",
)
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
MAX_UPLOAD_FILES = int(os.getenv("INFINITE_CANVAS_MAX_UPLOAD_FILES", "50"))
MAX_UPLOAD_BYTES = int(
    os.getenv("INFINITE_CANVAS_MAX_UPLOAD_BYTES", str(500 * 1024 * 1024))
)
AI_REFERENCE_MAX_UPLOAD_FILES = 20
ASSET_LIBRARY_IMPORT_MAX_FILES = 200
ASSET_LIBRARY_IMPORT_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"
}
AI_REFERENCE_EXTENSIONS = {
    ".txt",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif",
    ".mp4", ".webm", ".mov", ".m4v", ".flv", ".avi", ".mkv",
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
}
TXT_REFERENCE_MAX_BYTES = 1024 * 1024
TXT_REFERENCE_BATCH_MAX_BYTES = 2 * 1024 * 1024
MAX_WORKFLOW_ARCHIVE_BYTES = int(
    os.getenv("INFINITE_CANVAS_MAX_WORKFLOW_ARCHIVE_BYTES", str(MAX_UPLOAD_BYTES))
)
MAX_WORKFLOW_EXTRACTED_BYTES = int(
    os.getenv("INFINITE_CANVAS_MAX_WORKFLOW_EXTRACTED_BYTES", str(500 * 1024 * 1024))
)
MAX_WORKFLOW_ARCHIVE_ENTRIES = int(
    os.getenv("INFINITE_CANVAS_MAX_WORKFLOW_ARCHIVE_ENTRIES", "500")
)
LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
RUNNINGHUB_THUMBNAIL_EXTS = (".jpg",)


def current_workspace_content() -> WorkspaceContent:
    return WorkspaceContent(WORKSPACE_SERVICE.current())


def current_workspace_artifacts() -> WorkspaceArtifacts:
    return WorkspaceArtifacts(WORKSPACE_SERVICE.current())


def generation_history_path() -> str:
    return str(current_workspace_content().generation_history)


def user_workflow_directory() -> str:
    return str(current_workspace_content().user_workflows)


def runninghub_workflow_file() -> str:
    return str(current_workspace_content().runninghub_workflows)


def prompt_library_file() -> str:
    return str(current_workspace_content().prompt_libraries)


def current_prompt_library_storage() -> PromptLibraryStorage:
    return PromptLibraryStorage(WORKSPACE_SERVICE.current())


def managed_media_directory() -> str:
    return str(current_workspace_artifacts().managed_media)


def generation_input_directory() -> str:
    return str(current_workspace_artifacts().generation_inputs)


def generation_output_directory() -> str:
    return str(current_workspace_artifacts().generation_outputs)


def local_upload_directory() -> str:
    return str(current_workspace_artifacts().local_uploads)


def media_preview_directory() -> str:
    return str(DEVICE_CACHE.media_previews)


def available_models_file() -> str:
    return str(current_workspace_artifacts().available_models)


def api_providers_file() -> str:
    return str(WORKSPACE_SERVICE.current().api_providers)


def model_cache_directory() -> str:
    return str(DEVICE_CACHE.models)


def update_staging_directory() -> str:
    return str(current_workspace_artifacts().update_staging)


def update_backup_directory() -> str:
    return str(current_workspace_artifacts().update_backups)


def recovery_copy_directory() -> str:
    return str(current_workspace_artifacts().recovery_copies)


def current_workspace_media(
    *,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> WorkspaceMediaService:
    return WorkspaceMediaService(
        WORKSPACE_SERVICE.current(),
        max_bytes=max_bytes,
    )


ASSET_LIBRARY_LOCK = RLock()


def current_workspace_asset_library() -> WorkspaceAssetLibrary:
    return WorkspaceAssetLibrary(
        current_workspace_content().workspace_asset_library,
        lock=ASSET_LIBRARY_LOCK,
    )


async def read_upload_limited(
    upload: UploadFile,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> bytes:
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        size_mb = max(1, max_bytes // (1024 * 1024))
        raise HTTPException(
            status_code=413,
            detail=f"{upload.filename or '文件'} 超过 {size_mb}MB，无法上传",
        )
    return content


def validate_workflow_archive(archive: zipfile.ZipFile) -> None:
    entries = archive.infolist()
    if len(entries) > MAX_WORKFLOW_ARCHIVE_ENTRIES:
        raise HTTPException(status_code=413, detail="工作流压缩包文件数量过多")
    total = 0
    for entry in entries:
        total += max(0, int(entry.file_size))
        if total > MAX_WORKFLOW_EXTRACTED_BYTES:
            raise HTTPException(status_code=413, detail="工作流压缩包解压后体积过大")
        if entry.file_size > MAX_UPLOAD_BYTES and entry.compress_size <= 0:
            raise HTTPException(status_code=413, detail="工作流压缩包包含异常文件")
        if (
            entry.file_size > MAX_UPLOAD_BYTES
            and entry.compress_size > 0
            and entry.file_size / entry.compress_size > 200
        ):
            raise HTTPException(status_code=413, detail="工作流压缩包压缩比异常")

def _matting_env_int(name, fallback, minimum, maximum):
    try:
        value = int(os.getenv(name, str(fallback)))
    except (TypeError, ValueError):
        value = fallback
    return max(minimum, min(maximum, value))

QUEUE = []
QUEUE_LOCK = Lock()
MATTING_QUEUE = None
MATTING_WORKER_TASKS = []
MATTING_RUNTIME_LOOP = None
MATTING_ENGINE = None
MATTING_JOBS = {}
MATTING_MAX_CONCURRENCY = _matting_env_int("MATTING_MAX_CONCURRENCY", 2, 1, 8)
MATTING_QUEUE_MAX = _matting_env_int("MATTING_QUEUE_MAX", 24, 1, 100)
MATTING_PER_USER_MAX = _matting_env_int("MATTING_PER_USER_MAX", 3, 1, 10)
HISTORY_LOCK = Lock()
GLOBAL_CONFIG_LOCK = RLock()
CANVAS_LOCK = Lock()
LOAD_LOCK = Lock()
RUNNINGHUB_WORKFLOW_LOCK = GLOBAL_CONFIG_LOCK
NEXT_TASK_ID = 1
UPDATE_LOCK = Lock()
JIMENG_LOGIN_SESSION = {
    "proc": None,
    "stdout": "",
    "stderr": "",
    "started_at": 0.0,
}

PROVIDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")
SUPPORTED_PROVIDER_PROTOCOLS = {"openai", "apimart", "gemini", "gemini-cli", "volcengine", "runninghub", "jimeng", "codex"}
SUPPORTED_IMAGE_REQUEST_MODES = {"openai", "openai-json", "openai-video-proxy", "openai-responses"}
RUNNINGHUB_DEFAULT_BASE_URL = "https://www.runninghub.cn"
RUNNINGHUB_OPENAPI_BASE_URL = "https://www.runninghub.cn/openapi/v2"
RUNNINGHUB_MODEL_REGISTRY_URL = "https://raw.githubusercontent.com/HM-RunningHub/ComfyUI_RH_OpenAPI/main/models_registry.json"
RUNNINGHUB_LLM_BASE_URL = "https://llm.runninghub.cn/v1"
RUNNINGHUB_FILE_HOST_REWRITES = {
    "rh-images-1252422369.cos.ap-beijing.myqcloud.com": "rh-images.xiaoyaoyou.com",
}
LINGJING_DEFAULT_BASE_URL = "https://apistudio.vip"
RUNNINGHUB_LLM_MODELS_URLS = [
    "https://llm.runninghub.cn/v1/models",
    "https://llm.runninghub.ai/v1/models",
]
RUNNINGHUB_FALLBACK_CHAT_MODELS = [
    "google/gemini-3.1-flash-lite-preview",
    "qwen/qwen3-vl-235b-a22b-instruct",
    "qwen/qwen-plus",
    "openai/gpt-5.1",
]
JIMENG_DEFAULT_IMAGE_MODELS = [
    "5.0",
    "5.0Pro",
    "4.7",
    "4.6",
    "4.5",
    "4.1",
    "4.0",
    "3.1",
    "3.0",
]
JIMENG_DEFAULT_IMAGE_MODEL_NAMES = {
    "5.0": "5.0 Lite",
    "5.0Pro": "5.0 Pro",
}
JIMENG_DEFAULT_VIDEO_MODELS = [
    "seedance2.5",
    "seedance2.0_vip",
    "seedance2.0fast_vip",
    "seedance2.0",
    "seedance2.0fast",
    "seedance2.0mini",
    "seedance1.5pro",
    "seedance1.0fast",
    "3.5pro",
    "3.0pro",
    "3.0",
    "3.0fast",
]
CODEX_DEFAULT_IMAGE_MODELS = ["gpt-image-2"]
CODEX_DEFAULT_CHAT_MODELS = ["gpt-5.5"]
GEMINI_CLI_DEFAULT_IMAGE_MODELS = ["auto"]
GEMINI_CLI_DEFAULT_CHAT_MODELS = ["auto"]
try:
    CODEX_DEFAULT_TIMEOUT = max(30, min(3600, int(os.getenv("CODEX_CLI_TIMEOUT", "900"))))
except Exception:
    CODEX_DEFAULT_TIMEOUT = 900
try:
    GEMINI_CLI_DEFAULT_TIMEOUT = max(30, min(3600, int(os.getenv("GEMINI_CLI_TIMEOUT", "900"))))
except Exception:
    GEMINI_CLI_DEFAULT_TIMEOUT = 900
AGNES_DEFAULT_VIDEO_MODELS = ["agnes-video-v2.0"]
JIMENG_LEGACY_IMAGE_MODELS = {
    "jimeng-image-2k",
    "jimeng-image-4k",
}
JIMENG_LEGACY_VIDEO_MODELS = {
    "jimeng-video-720p",
    "jimeng-video-1080p",
}
try:
    JIMENG_DEFAULT_POLL_SECONDS = max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", "900"))))
except Exception:
    JIMENG_DEFAULT_POLL_SECONDS = 900
VOLCENGINE_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
VOLCENGINE_DEFAULT_PROJECT_NAME = "default"
VOLCENGINE_DEFAULT_REGION = "cn-beijing"
RUNNINGHUB_DEFAULT_IMAGE_MODELS = [
    "gpt-image-2.0/text-to-image-channel-low-price",
    "gpt-image-2.0/edit-channel-low-price",
    "gpt-image-2/text-to-image-official-stable",
    "gpt-image-2/image-to-image-official-stable",
    "nano-banana/text-to-image-official-stable",
    "nano-banana/edit-official-stable",
]
RUNNINGHUB_DEFAULT_VIDEO_MODELS = [
    "google/veo3.1-fast/text-to-video-channel-low-price",
    "sora-2/text-to-video-official-stable",
    "seedance-2.0-global/text-to-video",
    "seedance-2.0-global/image-to-video",
]
RUNNINGHUB_MODEL_ENDPOINT_ALIASES = {
    "Seedance2.0 Image to Video": "bytedance/seedance-2.0-global/image-to-video",
    "Seedance2.0 Text to Video": "bytedance/seedance-2.0-global/text-to-video",
    "seedance2.0 image to video": "bytedance/seedance-2.0-global/image-to-video",
    "seedance2.0 text to video": "bytedance/seedance-2.0-global/text-to-video",
    "gpt-image-2.0/text-to-image-channel-low-price": "rhart-image-g-2/text-to-image",
    "gpt-image-2/text-to-image-channel-low-price": "rhart-image-g-2/text-to-image",
    "gpt-image-2.0/edit-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2/edit-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2.0/image-to-image-channel-low-price": "rhart-image-g-2/image-to-image",
    "gpt-image-2/image-to-image-channel-low-price": "rhart-image-g-2/image-to-image",
    "nano-banana/text-to-image-channel-low-price": "rhart-image-v1/text-to-image",
    "nano-banana/edit-channel-low-price": "rhart-image-v1/edit",
}
RUNNINGHUB_DEFAULT_APPS = [
    {
        "id": "2058517022748798977",
        "appId": "2058517022748798977",
        "title": "2511-风格迁移",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "fields": [
            {
                "id": "100::image",
                "nodeId": "100",
                "fieldName": "image",
                "fieldValue": "pasted/57ef7dc980b6446bca366caaf3f94eb12b22b23f78aa30e294b39cabd7d0187b.png",
                "fieldType": "IMAGE",
                "label": "image",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "image",
                "options": [],
                "random_enabled": False,
                "min": "",
                "max": "",
                "step": "",
                "imageOrder": 0,
                "required": False,
            },
            {
                "id": "112::image",
                "nodeId": "112",
                "fieldName": "image",
                "fieldValue": "8cff63ee4b3e0285ca85ab90a52e26746df84ed0dec0be9d76c679cbb62a247d.png",
                "fieldType": "IMAGE",
                "label": "image",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "image",
                "options": [],
                "random_enabled": False,
                "min": "",
                "max": "",
                "step": "",
                "imageOrder": 0,
                "required": False,
            },
            {
                "id": "14::seed",
                "nodeId": "14",
                "fieldName": "seed",
                "fieldValue": "3250470112",
                "fieldType": "INT",
                "label": "seed",
                "enabled": True,
                "sourceFromUpstream": True,
                "group": "AI 应用参数",
                "note": "seed",
                "options": [],
                "random_enabled": True,
                "min": "1",
                "max": "4294967295",
                "step": "1",
                "imageOrder": 0,
                "required": False,
            },
        ],
    },
    {
        "id": "1997622492837646338",
        "appId": "1997622492837646338",
        "title": "2511-光线迁移",
        "note": "",
        "thumbnail": "",
        "enabled": True,
    },
]
RUNNINGHUB_DEFAULT_WORKFLOWS = [
    {
        "id": "2058554058318897153",
        "workflowId": "2058554058318897153",
        "title": "GPT-Image-2-图片编辑",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "optionalImageMode": "prune-workflow",
    },
    {
        "id": "2058541134623891458",
        "workflowId": "2058541134623891458",
        "title": "NanoBanana-2-图片编辑",
        "note": "",
        "thumbnail": "",
        "enabled": True,
        "optionalImageMode": "prune-workflow",
    },
]

def ensure_runtime_config_files():
    """Create device-local configuration without inventing a workspace."""
    try:
        os.makedirs(os.path.dirname(API_ENV_FILE), exist_ok=True)
        if not os.path.exists(API_ENV_FILE):
            with open(API_ENV_FILE, "a", encoding="utf-8"):
                pass
    except Exception as e:
        print(f"初始化 API 配置目录失败: {e}")

def load_env_file():
    if not os.path.exists(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, 'r', encoding='utf-8-sig') as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as e:
        print(f"加载设备状态目录中的 api.env 失败: {e}")
ensure_runtime_config_files()
load_env_file()

COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_MEDIA_BASE_URL = os.getenv("PUBLIC_MEDIA_BASE_URL", "").strip().rstrip("/")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"
MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
MODELSCOPE_DEFAULT_CHAT_MODELS = [
    "Qwen/Qwen3-235B-A22B",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "MiniMax/MiniMax-M2.7:MiniMax",
]
_MODELSCOPE_CONFIGURED_CHAT_MODELS = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_MODELSCOPE_CONFIGURED_CHAT_MODELS] if m]))
MODELSCOPE_DEFAULT_IMAGE_MODEL = MODELSCOPE_DEFAULT_IMAGE_MODELS[0]
MODELSCOPE_DEFAULT_CHAT_MODEL = "Qwen/Qwen3-235B-A22B"
MODELSCOPE_DEFAULT_LORAS = [
    {
        "id": "Daniel8152/film",
        "name": "Z-Image Film",
        "target_model": "Tongyi-MAI/Z-Image-Turbo",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Qwen-Image-2512-Film",
        "name": "Qwen Image 2512 Film",
        "target_model": "Qwen/Qwen-Image-2512",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Klein-enhance",
        "name": "Klein enhance",
        "target_model": "black-forest-labs/FLUX.2-klein-9B",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
]
MODELSCOPE_DEFAULTS_VERSION = 3
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-2")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "1800"))
IMAGE_POLL_INTERVAL = float(os.getenv("IMAGE_POLL_INTERVAL", "2"))
IMAGE_TASK_TIMEOUT = float(os.getenv("IMAGE_TASK_TIMEOUT", str(AI_REQUEST_TIMEOUT)))
COMFYUI_HISTORY_TIMEOUT = int(float(os.getenv("COMFYUI_HISTORY_TIMEOUT", "1800")))
# 下载 ComfyUI 产物的 socket 超时（秒，作用于连接和每次 read）。没有它时一次网络卡顿会让 urlopen 永久挂起，
# 导致 generate() 不返回、画布卡片一直转圈拿不到结果。给得足够大以容纳大视频/大图的正常下载。
COMFYUI_DOWNLOAD_TIMEOUT = float(os.getenv("COMFYUI_DOWNLOAD_TIMEOUT", "120"))
APIMART_IMAGE_TASK_TIMEOUT = float(os.getenv("APIMART_IMAGE_TASK_TIMEOUT", "1800"))
APIMART_IMAGE_POLL_INTERVAL = float(os.getenv("APIMART_IMAGE_POLL_INTERVAL", "5"))
APIMART_IMAGE_INITIAL_POLL_DELAY = float(os.getenv("APIMART_IMAGE_INITIAL_POLL_DELAY", "10"))
VIDEO_POLL_TIMEOUT = float(os.getenv("VIDEO_POLL_TIMEOUT", "1800"))
ONLINE_IMAGE_PROMPT_MAX_LENGTH = int(os.getenv("ONLINE_IMAGE_PROMPT_MAX_LENGTH", "20000"))
VIDEO_PROMPT_MAX_LENGTH = int(os.getenv("VIDEO_PROMPT_MAX_LENGTH", "4000"))
LLM_MESSAGE_MAX_LENGTH = int(os.getenv("LLM_MESSAGE_MAX_LENGTH", "20000"))
ONLINE_IMAGE_REFERENCE_MAX = int(os.getenv("ONLINE_IMAGE_REFERENCE_MAX", "20"))

FIELD_LABELS = {
    "prompt": "提示词",
    "message": "文本",
    "system_prompt": "系统提示词",
}

def friendly_validation_error(errors):
    parts = []
    for err in errors or []:
        loc = [str(item) for item in err.get("loc", []) if item != "body"]
        field = loc[-1] if loc else ""
        label = FIELD_LABELS.get(field, field or "请求参数")
        ctx = err.get("ctx") or {}
        limit = ctx.get("limit_value") or ctx.get("max_length") or ctx.get("min_length")
        err_type = str(err.get("type") or "")
        msg = str(err.get("msg") or "")
        if "max_length" in err_type or "at most" in msg:
            parts.append(f"{label}过长：当前内容超过后端上限 {limit} 个字符。请拆分为多个提示词节点，或先用 LLM 节点压缩后再生成。")
        elif "min_length" in err_type:
            parts.append(f"{label}不能为空。")
        else:
            parts.append(f"{label}格式不正确：{msg}")
    return "\n".join(parts) or "请求参数不正确。"

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": friendly_validation_error(exc.errors()), "errors": exc.errors()},
    )

def model_list(env_name, primary, defaults):
    configured = os.getenv(env_name, "")
    configured_values = [item.strip() for item in configured.split(",") if item.strip()]
    values = configured_values or [primary, *defaults]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped

def reload_env_globals():
    """保存 API 设置后，将 os.environ 里最新的值同步回模块级全局变量，
    避免保存后需要重启才能生效。"""
    global MODELSCOPE_API_KEY, AI_API_KEY, AI_BASE_URL
    global IMAGE_MODELS, CHAT_MODELS, VIDEO_MODELS, MODELSCOPE_CHAT_MODELS
    MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
    AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
    AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
    IMAGE_MODELS = model_list("IMAGE_MODELS", os.getenv("IMAGE_MODEL", IMAGE_MODEL), ["nano-banana-pro"])
    CHAT_MODELS = model_list("CHAT_MODELS", os.getenv("CHAT_MODEL", CHAT_MODEL), ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
    VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
        "veo2", "veo2-fast", "veo2-pro",
        "veo3", "veo3-fast", "veo3-pro",
        "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
        "sora-2", "sora-2-pro",
        "wan2.6-t2v", "wan2.6-i2v",
        "wan2.5-t2v-preview", "wan2.5-i2v-preview",
        "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-1-5-pro-251215",
        "doubao-seedance-1-0-pro-250528",
        "doubao-seedance-1-0-lite-t2v-250428",
        "doubao-seedance-1-0-lite-i2v-250428",
    ])
    _configured = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
    MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_configured] if m]))

CHAT_MODELS = model_list("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["nano-banana-pro"])
VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
    # —— Veo 系列 ——
    "veo2", "veo2-fast", "veo2-pro",
    "veo3", "veo3-fast", "veo3-pro",
    "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite",
    # —— Sora ——
    "sora-2", "sora-2-pro",
    # —— 阿里 通义万相 ——
    "wan2.6-t2v", "wan2.6-i2v",
    "wan2.5-t2v-preview", "wan2.5-i2v-preview",
    "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
    # —— 火山 豆包 Seedance ——
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-lite-i2v-250428",
])

def provider_key_env(provider_id):
    if provider_id == "comfly":
        return "COMFLY_API_KEY"
    if provider_id == "modelscope":
        return "MODELSCOPE_API_KEY"
    if provider_id == "runninghub":
        return "RUNNINGHUB_API_KEY"
    if provider_id == "volcengine":
        return "ARK_API_KEY"
    return f"API_PROVIDER_{re.sub(r'[^A-Za-z0-9]', '_', provider_id).upper()}_KEY"

def runninghub_wallet_key_env():
    return "RUNNINGHUB_WALLET_API_KEY"

def volcengine_access_key_env():
    return "VOLCENGINE_ACCESS_KEY_ID"

def volcengine_secret_key_env():
    return "VOLCENGINE_SECRET_ACCESS_KEY"

def read_api_env_value(key: str) -> str:
    key = str(key or "").strip()
    if not key or not os.path.exists(API_ENV_FILE):
        return ""
    try:
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                env_key, value = line.split("=", 1)
                if env_key.strip() == key:
                    return value.strip().strip('"').strip("'")
    except Exception:
        return ""
    return ""

def provider_env_key_value(provider_id: str) -> str:
    provider_id = str(provider_id or "").strip().lower()
    env_key = provider_key_env(provider_id)
    key = os.getenv(env_key, "") or read_api_env_value(env_key)
    if key:
        return key
    if provider_id == "modelscope":
        return MODELSCOPE_API_KEY or ""
    return ""

def runninghub_wallet_key_value() -> str:
    env_key = runninghub_wallet_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_access_key_value() -> str:
    env_key = volcengine_access_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_secret_key_value() -> str:
    env_key = volcengine_secret_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def volcengine_provider_api_key(explicit_key: str = "") -> str:
    explicit_key = str(explicit_key or "").strip()
    if explicit_key:
        return explicit_key
    return provider_env_key_value("volcengine")

def mask_secret(value):
    if not value:
        return ""
    tail = value[-4:] if len(value) > 4 else value
    return f"••••••••{tail}"

def strip_auth_scheme(value, scheme="Bearer"):
    text = str(value or "").strip()
    if not text:
        return ""
    pattern = rf"^{re.escape(scheme)}\s+"
    return re.sub(pattern, "", text, flags=re.I).strip()

def bearer_auth_value(value):
    token = strip_auth_scheme(value, "Bearer")
    return f"Bearer {token}" if token else ""

def default_api_providers():
    # 独立入口平台强制保留，其他平台均可自定义增删
    return [
        {
            "id": "modelscope",
            "name": "ModelScope",
            "base_url": MODELSCOPE_CHAT_BASE_URL,
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": MODELSCOPE_DEFAULT_IMAGE_MODELS,
            "chat_models": MODELSCOPE_CHAT_MODELS,
            "video_models": [],
            "ms_loras": MODELSCOPE_DEFAULT_LORAS,
            "ms_defaults_version": MODELSCOPE_DEFAULTS_VERSION,
        },
        {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": RUNNINGHUB_DEFAULT_BASE_URL,
            "protocol": "runninghub",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "ms_loras": [],
            "ms_defaults_version": 0,
            "rh_apps": RUNNINGHUB_DEFAULT_APPS,
            "rh_workflows": RUNNINGHUB_DEFAULT_WORKFLOWS,
        },
        {
            "id": "volcengine",
            "name": "火山引擎",
            "base_url": VOLCENGINE_DEFAULT_BASE_URL,
            "protocol": "volcengine",
            "image_request_mode": "openai",
            "image_generation_endpoint": "",
            "image_edit_endpoint": "",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "ms_loras": [],
            "ms_defaults_version": 0,
            "volcengine_project_name": VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": VOLCENGINE_DEFAULT_REGION,
        },
    ]

def merge_default_api_providers(providers, inject_missing=True):
    merged = [dict(item) for item in providers]
    # 强制保留独立入口平台（不再强制 comfly）
    ms_default = next((d for d in default_api_providers() if d["id"] == "modelscope"), None)
    if ms_default:
        current = next((item for item in merged if item.get("id") == "modelscope"), None)
        if not current:
            if inject_missing:
                merged.append(ms_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = ms_default["base_url"]
            seeded_version = int(current.get("ms_defaults_version") or 0)
            if seeded_version < MODELSCOPE_DEFAULTS_VERSION:
                image_models = model_list_from_values([*MODELSCOPE_DEFAULT_IMAGE_MODELS, *(current.get("image_models") or [])])
                chat_models = model_list_from_values([*MODELSCOPE_DEFAULT_CHAT_MODELS, *(current.get("chat_models") or [])])
                loras = normalize_ms_loras([*MODELSCOPE_DEFAULT_LORAS, *(current.get("ms_loras") or [])])
                current["image_models"] = image_models
                current["chat_models"] = chat_models
                current["ms_loras"] = loras
                current["ms_defaults_version"] = MODELSCOPE_DEFAULTS_VERSION
    rh_default = load_static_runninghub_provider() or next((d for d in default_api_providers() if d["id"] == "runninghub"), None)
    if rh_default:
        current = next((item for item in merged if item.get("id") == "runninghub"), None)
        if not current:
            if inject_missing:
                merged.append(rh_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = rh_default["base_url"]
            if not current.get("protocol") or current.get("protocol") == "openai":
                current["protocol"] = "runninghub"
            current["image_models"] = model_list_from_values(current.get("image_models") or [])
            current["chat_models"] = model_list_from_values(current.get("chat_models") or [])
            current["video_models"] = model_list_from_values(current.get("video_models") or [])
            current["rh_apps"] = merge_runninghub_system_entries(rh_default.get("rh_apps") or [], current.get("rh_apps") or [], "app")
            current["rh_workflows"] = merge_runninghub_system_entries(rh_default.get("rh_workflows") or [], current.get("rh_workflows") or [], "workflow")
    volc_default = next((d for d in default_api_providers() if d["id"] == "volcengine"), None)
    if volc_default:
        current = next((item for item in merged if item.get("id") == "volcengine"), None)
        legacy = next((item for item in merged if item.get("id") != "volcengine" and str(item.get("protocol") or "").lower() == "volcengine"), None)
        if not current:
            if legacy:
                legacy_image_models = model_list_from_values(legacy.get("image_models") or [])
                legacy_video_models = model_list_from_values(legacy.get("video_models") or [])
                current = {
                    **volc_default,
                    "base_url": legacy.get("base_url") or volc_default["base_url"],
                    "image_models": legacy_image_models or model_list_from_values(volc_default.get("image_models") or []),
                    "chat_models": model_list_from_values(legacy.get("chat_models") or []),
                    "video_models": legacy_video_models,
                }
                merged.append(current)
            elif inject_missing:
                merged.append(volc_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = volc_default["base_url"]
            current["protocol"] = "volcengine"
            current["volcengine_project_name"] = str(current.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME).strip() or VOLCENGINE_DEFAULT_PROJECT_NAME
            current["volcengine_region"] = str(current.get("volcengine_region") or VOLCENGINE_DEFAULT_REGION).strip() or VOLCENGINE_DEFAULT_REGION
    # 即梦 CLI 不再是强制保留的默认平台：仅在用户已添加了即梦协议的平台时，规范化其默认模型/地址。
    for current in merged:
        if not is_jimeng_provider(current):
            continue
        current["protocol"] = "jimeng"
        current["base_url"] = ""
        current["image_models"] = model_list_from_values([
            *[item for item in (current.get("image_models") or []) if str(item or "").strip() not in JIMENG_LEGACY_IMAGE_MODELS],
            *JIMENG_DEFAULT_IMAGE_MODELS,
        ])
        current["model_names"] = {
            **JIMENG_DEFAULT_IMAGE_MODEL_NAMES,
            **normalize_model_name_map(current.get("model_names")),
        }
        current["video_models"] = model_list_from_values([
            *[item for item in (current.get("video_models") or []) if str(item or "").strip() not in JIMENG_LEGACY_VIDEO_MODELS],
            *JIMENG_DEFAULT_VIDEO_MODELS,
        ])
    # OpenAI/Antigravity CLI 和即梦一样作为协议使用：用户选中 CLI 协议时再规范化模型与地址，不强制额外注入平台。
    for current in merged:
        current_protocol = str((current or {}).get("protocol") or "").strip().lower()
        if current_protocol not in {"codex", "gemini-cli"}:
            continue
        current["protocol"] = current_protocol
        current["base_url"] = ""
        default_image_models = CODEX_DEFAULT_IMAGE_MODELS if current_protocol == "codex" else GEMINI_CLI_DEFAULT_IMAGE_MODELS
        default_chat_models = CODEX_DEFAULT_CHAT_MODELS if current_protocol == "codex" else GEMINI_CLI_DEFAULT_CHAT_MODELS
        image_models = current.get("image_models") or []
        if current_protocol == "codex":
            image_models = [item for item in image_models if str(item or "").strip().lower() != "$imagegen"]
        current["image_models"] = model_list_from_values([*image_models, *default_image_models])
        current["chat_models"] = model_list_from_values([*(current.get("chat_models") or []), *default_chat_models])
        current["video_models"] = []
    return merged

def normalize_model_list(values):
    return model_list_from_values(values)

def model_list_from_values(values):
    deduped = []
    for value in values or []:
        item = str(value or "").strip()
        if item and item not in deduped:
            selected_model(item, item)
            deduped.append(item)
    return deduped

def normalize_ms_loras(values):
    normalized = []
    seen = set()
    for raw in values or []:
        if not isinstance(raw, dict):
            continue
        lora_id = str(raw.get("id") or "").strip()
        if not lora_id:
            continue
        target_model = str(raw.get("target_model") or raw.get("model") or "").strip()
        if not target_model:
            continue
        key = (target_model, lora_id)
        if key in seen:
            continue
        seen.add(key)
        try:
            strength = float(raw.get("strength", raw.get("default_strength", 0.8)))
        except Exception:
            strength = 0.8
        strength = max(0.0, min(2.0, strength))
        name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())[:80]
        normalized.append({
            "id": lora_id[:180],
            "name": name or lora_id,
            "target_model": target_model[:180],
            "strength": strength,
            "enabled": bool(raw.get("enabled", True)),
            "note": str(raw.get("note") or "").strip()[:300],
        })
    return normalized


def normalize_endpoint_override(value, label):
    endpoint = str(value or "").strip()
    if not endpoint:
        return ""
    if len(endpoint) > 300 or re.search(r"\s", endpoint):
        raise HTTPException(status_code=400, detail=f"{label} 不合法，请填写类似 /v1/images/edits 的路径")
    if re.match(r"^https?://", endpoint, re.I):
        return endpoint.rstrip("/")
    if not endpoint.startswith("/"):
        raise HTTPException(status_code=400, detail=f"{label} 需要以 /v1/... 开头，或填写完整 http(s) 地址")
    return endpoint

def normalize_image_request_mode(value):
    mode = str(value or "").strip().lower()
    return mode if mode in SUPPORTED_IMAGE_REQUEST_MODES else "openai"

LOCKED_RECOMMENDED_PROVIDER_RULES = {
    "exellome": {
        "names": {"exellome"},
        "base_urls": {"https://new.exellome.online"},
        "protocol": "apimart",
        "image_request_mode": "openai-video-proxy",
        "video_models": [],
    },
    "fhl": {
        "names": {"fhl"},
        "base_urls": {"https://www.fhl.mom"},
        "protocol": "openai",
        "image_request_mode": "openai-responses",
        "video_models": [],
    },
}

def locked_recommended_provider_rule(provider_id="", name="", base_url=""):
    pid = str(provider_id or "").strip().lower()
    pname = str(name or "").strip().lower()
    pbase = str(base_url or "").strip().rstrip("/").lower()
    try:
        phost = urllib.parse.urlsplit(pbase).netloc.lower()
    except Exception:
        phost = ""
    for key, rule in LOCKED_RECOMMENDED_PROVIDER_RULES.items():
        hosts = {urllib.parse.urlsplit(url).netloc.lower() for url in rule["base_urls"]}
        if pid == key or pname in rule["names"] or pbase in rule["base_urls"] or (phost and phost in hosts):
            return rule
    return None

def apply_locked_recommended_model_rules(base_url="", grouped=None):
    rule = locked_recommended_provider_rule("", "", base_url)
    if not rule or "video_models" not in rule:
        return grouped
    grouped = {key: list(value or []) for key, value in (grouped or {}).items()}
    grouped.setdefault("image", [])
    grouped.setdefault("chat", [])
    grouped["video"] = list(rule.get("video_models") or [])
    return grouped

def provider_endpoint_url(provider, key, default_path):
    base_url = str((provider or {}).get("base_url") or AI_BASE_URL).strip().rstrip("/")
    override = str((provider or {}).get(key) or "").strip()
    if override:
        if re.match(r"^https?://", override, re.I):
            return override.rstrip("/")
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}{override}"
        return override
    for prefix in ("/api/v3", "/v1beta", "/v1", "/v2"):
        if base_url.endswith(prefix) and default_path.startswith(f"{prefix}/"):
            return f"{base_url}{default_path[len(prefix):]}"
    return f"{base_url}{default_path}"


def normalize_provider(item):
    provider_id = str(item.get("id") or "").strip().lower()
    if not PROVIDER_ID_RE.fullmatch(provider_id):
        raise HTTPException(status_code=400, detail=f"API 平台 ID 不合法：{provider_id or '(empty)'}")
    name = re.sub(r"\s+", " ", str(item.get("name") or provider_id).strip())[:60] or provider_id
    base_url = str(item.get("base_url") or "").strip().rstrip("/")
    if base_url and not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail=f"{name} 的 Base URL 需要以 http:// 或 https:// 开头")
    protocol = str(item.get("protocol") or "openai").strip().lower()
    if protocol not in SUPPORTED_PROVIDER_PROTOCOLS:
        protocol = "openai"
    image_request_mode = detect_image_request_mode(base_url, item.get("image_models") or []) or normalize_image_request_mode(item.get("image_request_mode"))
    image_generation_endpoint = normalize_endpoint_override(item.get("image_generation_endpoint"), "文生图端口")
    image_edit_endpoint = normalize_endpoint_override(item.get("image_edit_endpoint"), "图生图/编辑端口")
    volc_project = re.sub(r"\s+", " ", str(item.get("volcengine_project_name") or "").strip())[:80]
    volc_region = re.sub(r"\s+", " ", str(item.get("volcengine_region") or "").strip())[:40]
    if provider_id == "volcengine":
        protocol = "volcengine"
        base_url = base_url or VOLCENGINE_DEFAULT_BASE_URL
        volc_project = volc_project or VOLCENGINE_DEFAULT_PROJECT_NAME
        volc_region = volc_region or VOLCENGINE_DEFAULT_REGION
    if provider_id == "jimeng" or protocol == "jimeng":
        protocol = "jimeng"
        base_url = ""
    if protocol in {"codex", "gemini-cli"}:
        base_url = ""
    if provider_id == "runninghub":
        protocol = "runninghub"
        base_url = base_url or RUNNINGHUB_DEFAULT_BASE_URL
    locked_rule = locked_recommended_provider_rule(provider_id, name, base_url)
    if locked_rule:
        protocol = locked_rule["protocol"]
        image_request_mode = locked_rule["image_request_mode"]
    video_models = model_list_from_values(item.get("video_models") or [])
    if locked_rule and "video_models" in locked_rule:
        video_models = model_list_from_values(locked_rule.get("video_models") or [])
    return {
        "id": provider_id,
        "name": name,
        "base_url": base_url,
        "protocol": protocol,
        "image_request_mode": image_request_mode,
        "image_generation_endpoint": image_generation_endpoint,
        "image_edit_endpoint": image_edit_endpoint,
        "enabled": bool(item.get("enabled", True)),
        "primary": bool(item.get("primary", False)),
        "image_models": model_list_from_values(item.get("image_models") or []),
        "chat_models": model_list_from_values(item.get("chat_models") or []),
        "video_models": video_models,
        "model_names": normalize_model_name_map(item.get("model_names")),
        "model_protocols": normalize_model_protocols(item.get("model_protocols")),
        "ms_loras": normalize_ms_loras(item.get("ms_loras") or []),
        "ms_defaults_version": int(item.get("ms_defaults_version") or 0),
        "rh_apps": normalize_runninghub_entries(item.get("rh_apps") or [], "app"),
        "rh_workflows": normalize_runninghub_entries(item.get("rh_workflows") or [], "workflow"),
        "volcengine_project_name": volc_project,
        "volcengine_region": volc_region,
    }

LEGACY_SHARED_GENERATION_ENV_KEYS = frozenset(
    {
        "IMAGE_MODEL",
        "IMAGE_MODELS",
        "CHAT_MODEL",
        "CHAT_MODELS",
        "VIDEO_MODELS",
        "MODELSCOPE_CHAT_MODELS",
    }
)


def retire_legacy_shared_generation_env() -> None:
    """Remove migrated team choices from the device credential file."""

    if not os.path.isfile(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as source:
            lines = source.read().splitlines()
    except OSError:
        return
    retained = []
    removed = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            retained.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in LEGACY_SHARED_GENERATION_ENV_KEYS:
            removed = True
            continue
        retained.append(line)
    if not removed:
        return
    temporary = (
        f"{API_ENV_FILE}.generation-settings-{uuid.uuid4().hex}.tmp"
    )
    try:
        with open(temporary, "w", encoding="utf-8") as output:
            output.write("\n".join(retained).rstrip() + "\n")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        os.replace(temporary, API_ENV_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _load_api_providers_unlocked():
    defaults = default_api_providers()
    shared_path = api_providers_file()
    settings = GenerationSettingsService(
        shared_path,
        PROVIDER_CONNECTIONS_FILE,
    )
    if not os.path.exists(shared_path):
        providers = merge_default_api_providers(defaults)
        if WORKSPACE_CONFIGURED:
            settings.save(providers)
            retire_legacy_shared_generation_env()
        return providers
    try:
        raw = settings.load()
        providers = [normalize_provider(item) for item in raw if isinstance(item, dict)]
        merged = merge_default_api_providers(
            providers or defaults,
            inject_missing=not bool(providers),
        )
        retire_legacy_shared_generation_env()
        return merged
    except Exception as e:
        print(f"加载 API 平台配置失败: {e}")
        return defaults


def load_api_providers():
    with GLOBAL_CONFIG_LOCK:
        return _load_api_providers_unlocked()


def save_api_providers(providers):
    with GLOBAL_CONFIG_LOCK:
        GenerationSettingsService(
            api_providers_file(),
            PROVIDER_CONNECTIONS_FILE,
        ).save(providers)
        retire_legacy_shared_generation_env()


def configured_cli_update_ids():
    """Return enabled CLI Provider identities for device-local maintenance."""
    if not WORKSPACE_CONFIGURED:
        # Recovery/setup pages have no Provider configuration to inspect yet.
        # Treat them as an empty selection instead of leaking a background-task
        # exception into the application startup log.
        return set()
    supported = {"jimeng", "codex", "gemini-cli"}
    return {
        (
            str(provider.get("protocol") or "").strip().lower()
            if str(provider.get("protocol") or "").strip().lower() in supported
            else str(provider.get("id") or "").strip().lower()
        )
        for provider in load_api_providers()
        if provider.get("enabled", True) is not False
        and (
            str(provider.get("protocol") or "").strip().lower() in supported
            or str(provider.get("id") or "").strip().lower() in supported
        )
    }


def antigravity_cli_update_executable():
    executable = _provider_implementation.gemini_cli_executable()
    return (
        executable
        if executable and _provider_implementation.is_antigravity_cli(executable)
        else ""
    )


CLI_UPDATE_MANAGER = build_cli_update_manager(
    dreamina_executable=_provider_implementation.jimeng_cli_executable,
    codex_executable=_provider_implementation.codex_cli_executable,
    antigravity_executable=antigravity_cli_update_executable,
    configured_ids=configured_cli_update_ids,
    dreamina_version_command=lambda flag: _provider_implementation.jimeng_command([flag]),
)

def public_provider(provider):
    if provider.get("id") == "runninghub":
        try:
            provider = runninghub_provider_with_workflow_store(provider)
        except Exception:
            pass
    key = provider_env_key_value(provider["id"])
    item = {
        **provider,
        "has_key": bool(key),
        "key_preview": mask_secret(key),
        "key_env": provider_key_env(provider["id"]),
    }
    if provider.get("id") == "runninghub":
        wallet_key = runninghub_wallet_key_value()
        item.update({
            "has_wallet_key": bool(wallet_key),
            "wallet_key_preview": mask_secret(wallet_key),
            "wallet_key_env": runninghub_wallet_key_env(),
        })
    if provider.get("id") == "volcengine":
        ak = volcengine_access_key_value()
        sk = volcengine_secret_key_value()
        item.update({
            "has_volcengine_access_key": bool(ak),
            "volcengine_access_key_preview": mask_secret(ak),
            "volcengine_access_key_env": volcengine_access_key_env(),
            "has_volcengine_secret_key": bool(sk),
            "volcengine_secret_key_preview": mask_secret(sk),
            "volcengine_secret_key_env": volcengine_secret_key_env(),
            "volcengine_project_name": provider.get("volcengine_project_name") or VOLCENGINE_DEFAULT_PROJECT_NAME,
            "volcengine_region": provider.get("volcengine_region") or VOLCENGINE_DEFAULT_REGION,
        })
    return item

def public_api_providers():
    return [public_provider(p) for p in load_api_providers()]

AVAILABLE_MODEL_FIELDS = {
    "image": "image_models",
    "video": "video_models",
    "text": "chat_models",
}

def available_model_id(provider_id: str, model: str) -> str:
    raw = f"{str(provider_id or '').strip()}\0{str(model or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

def _load_available_model_order() -> Dict[str, List[str]]:
    return _load_available_model_settings()["order"]

def _load_available_model_settings() -> Dict[str, Any]:
    with GLOBAL_CONFIG_LOCK:
        try:
            with open(available_models_file(), "r", encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError, TypeError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    order = {}
    hidden_source = raw.get("hidden") if isinstance(raw.get("hidden"), dict) else {}
    hidden = {}
    for kind in AVAILABLE_MODEL_FIELDS:
        values = raw.get(kind) or []
        order[kind] = list(dict.fromkeys(
            str(value or "").strip()
            for value in values
            if str(value or "").strip()
        )) if isinstance(values, list) else []
        hidden_values = hidden_source.get(kind) or []
        hidden[kind] = list(dict.fromkeys(
            str(value or "").strip()
            for value in hidden_values
            if str(value or "").strip()
        )) if isinstance(hidden_values, list) else []
    return {"order": order, "hidden": hidden}

def available_models(providers=None, *, include_hidden=True) -> Dict[str, List[Dict[str, Any]]]:
    """Return every enabled provider model, grouped by scene and in admin-defined order."""
    providers = providers if providers is not None else load_api_providers()
    settings = _load_available_model_settings()
    saved_order = settings["order"]
    hidden = {kind: set(settings["hidden"].get(kind) or []) for kind in AVAILABLE_MODEL_FIELDS}
    grouped = {kind: [] for kind in AVAILABLE_MODEL_FIELDS}
    for provider in providers:
        if not isinstance(provider, dict) or provider.get("enabled", True) is False:
            continue
        provider_id = str(provider.get("id") or "").strip()
        if not provider_id:
            continue
        provider_name = str(provider.get("name") or provider_id).strip() or provider_id
        model_names = provider.get("model_names") if isinstance(provider.get("model_names"), dict) else {}
        for kind, field in AVAILABLE_MODEL_FIELDS.items():
            for model in model_list_from_values(provider.get(field) or []):
                entry_id = available_model_id(provider_id, model)
                visible = entry_id not in hidden[kind]
                if not include_hidden and not visible:
                    continue
                grouped[kind].append({
                    "id": entry_id,
                    "type": kind,
                    "provider_id": provider_id,
                    "provider_name": provider_name,
                    "model": model,
                    "name": str(model_names.get(model) or model).strip() or model,
                    "visible": visible,
                })
    for kind, entries in grouped.items():
        rank = {model_id: index for index, model_id in enumerate(saved_order.get(kind) or [])}
        original_rank = {entry["id"]: index for index, entry in enumerate(entries)}
        entries.sort(key=lambda entry: (
            0 if entry["id"] in rank else 1,
            rank.get(entry["id"], original_rank[entry["id"]]),
        ))
    return grouped

def save_available_model_order(
    payload: Dict[str, List[str]],
    visible: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    inventory = available_models(include_hidden=True)
    previous = _load_available_model_settings()
    order = {}
    hidden = {}
    for kind, entries in inventory.items():
        valid_ids = [entry["id"] for entry in entries]
        valid_set = set(valid_ids)
        requested = payload.get(kind) if isinstance(payload, dict) else []
        requested = requested if isinstance(requested, list) else []
        selected = list(dict.fromkeys(
            str(model_id or "").strip()
            for model_id in requested
            if str(model_id or "").strip() in valid_set
        ))
        order[kind] = [*selected, *[model_id for model_id in valid_ids if model_id not in selected]]
        if visible is None:
            hidden[kind] = [model_id for model_id in previous["hidden"].get(kind, []) if model_id in valid_set]
        else:
            requested_visible = visible.get(kind) if isinstance(visible.get(kind), list) else []
            visible_ids = {
                str(model_id or "").strip()
                for model_id in requested_visible
                if str(model_id or "").strip() in valid_set
            }
            hidden[kind] = [model_id for model_id in valid_ids if model_id not in visible_ids]
    saved = {**order, "hidden": hidden}
    path = available_models_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with GLOBAL_CONFIG_LOCK:
        temporary = f"{path}.settings-{uuid.uuid4().hex}.tmp"
        try:
            with open(temporary, "w", encoding="utf-8") as f:
                json.dump(saved, f, ensure_ascii=False, indent=2)
            os.replace(temporary, path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return available_models(include_hidden=True)

def save_available_model_names(names: Dict[str, str]) -> None:
    """Persist administrator-defined display names without changing provider model IDs."""
    if not isinstance(names, dict) or not names:
        return
    providers = load_api_providers()
    inventory = available_models(providers, include_hidden=True)
    entries_by_id = {
        entry["id"]: entry
        for entries in inventory.values()
        for entry in entries
    }
    providers_by_id = {
        str(provider.get("id") or "").strip(): provider
        for provider in providers
        if isinstance(provider, dict)
    }
    changed = False
    for entry_id, raw_name in names.items():
        entry = entries_by_id.get(str(entry_id or "").strip())
        if not entry:
            continue
        display_name = re.sub(r"\s+", " ", str(raw_name or "").strip())[:160]
        if not display_name:
            raise HTTPException(status_code=400, detail="模型名称不能为空")
        provider = providers_by_id.get(entry["provider_id"])
        if not provider:
            continue
        model_names = provider.get("model_names")
        if not isinstance(model_names, dict):
            model_names = {}
            provider["model_names"] = model_names
        model_id = entry["model"]
        if model_names.get(model_id) == display_name:
            continue
        model_names[model_id] = display_name
        changed = True
    if changed:
        save_api_providers(providers)

def get_primary_provider_id(providers=None):
    """返回当前首选 provider 的 id；优先 primary=True 的，否则取第一个非 modelscope 的，再次取第一个。"""
    providers = providers if providers is not None else load_api_providers()
    primary = next((p for p in providers if p.get("primary") and p.get("enabled", True)), None)
    if primary:
        return primary["id"]
    non_ms = next((p for p in providers if p["id"] != "modelscope" and p.get("enabled", True)), None)
    if non_ms:
        return non_ms["id"]
    return providers[0]["id"] if providers else "modelscope"

def get_api_provider(provider_id="comfly"):
    providers = load_api_providers()
    target = (provider_id or "").strip().lower()
    # 兼容旧的 "comfly" 硬编码：若 comfly 不存在或未指定，回退到首选 provider
    if not target or not any(p["id"] == target for p in providers):
        target = get_primary_provider_id(providers)
    provider = next((p for p in providers if p["id"] == target), None)
    if not provider:
        raise HTTPException(status_code=400, detail=f"未找到 API 平台：{target}")
    if not provider.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"API 平台已禁用：{provider.get('name') or target}")
    return provider

def get_api_provider_exact(provider_id: str):
    providers = load_api_providers()
    target = (provider_id or "").strip().lower()
    provider = next((p for p in providers if p["id"] == target), None)
    if not provider:
        raise HTTPException(status_code=400, detail=f"未找到 API 平台：{target or '(empty)'}。新增平台未保存时请使用当前表单拉取模型。")
    if not provider.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"API 平台已禁用：{provider.get('name') or target}")
    return provider

def modelscope_provider_config():
    return get_api_provider_exact("modelscope")

def modelscope_api_key(explicit_key: str = ""):
    return (
        strip_auth_scheme(explicit_key, "Bearer")
        or strip_auth_scheme(provider_env_key_value("modelscope"), "Bearer")
        or strip_auth_scheme(MODELSCOPE_API_KEY, "Bearer")
    )

def modelscope_api_root(provider=None):
    provider = provider or modelscope_provider_config()
    base_root = str((provider or {}).get("base_url") or MODELSCOPE_CHAT_BASE_URL).strip().rstrip("/")
    if not base_root:
        base_root = MODELSCOPE_CHAT_BASE_URL
    return base_root if base_root.endswith("/v1") else f"{base_root}/v1"

def modelscope_image_api_root():
    return MODELSCOPE_CHAT_BASE_URL.rstrip("/")

def env_quote(value):
    text = str(value or "")
    if not text or re.search(r"\s|#|['\"]", text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text

def update_env_values(updates):
    with GLOBAL_CONFIG_LOCK:
        os.makedirs(os.path.dirname(API_ENV_FILE), exist_ok=True)
        lines = []
        if os.path.exists(API_ENV_FILE):
            with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
                lines = f.read().splitlines()
        seen = set()
        next_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in line:
                next_lines.append(line)
                continue
            key = line.split("=", 1)[0].strip()
            if key in updates:
                next_lines.append(f"{key}={env_quote(updates[key])}")
                os.environ[key] = str(updates[key] or "")
                seen.add(key)
            else:
                next_lines.append(line)
        for key, value in updates.items():
            if key not in seen:
                next_lines.append(f"{key}={env_quote(value)}")
                os.environ[key] = str(value or "")
        temporary = (
            f"{API_ENV_FILE}.settings-{uuid.uuid4().hex}.tmp"
        )
        try:
            with open(temporary, "w", encoding="utf-8") as f:
                f.write("\n".join(next_lines).rstrip() + "\n")
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
            os.replace(temporary, API_ENV_FILE)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}

if WORKSPACE_CONFIGURED:
    current_workspace_artifacts().ensure_directories()
    current_workspace_content().ensure_directories()

def reassign_deleted_account_canvases(target, actor):
    CANVAS_SYNC.transfer_owned_canvases(target, actor)

AUTH_SYSTEM = auth_from_environment(
    INSTANCE_STATE,
    workspace_directory=(
        _CONFIGURED_WORKSPACE.directory
        if _CONFIGURED_WORKSPACE is not None
        else None
    ),
    workspace_id=CURRENT_WORKSPACE_ID,
)


def enrich_current_workspace_user(user):
    return AUTH_SYSTEM.user_with_project_access(
        user,
        current_workspace_id(),
    )


def configure_initial_workspace(workspace_directory: str) -> Dict[str, Any]:
    inspection = WORKSPACE_SERVICE.inspect(workspace_directory)
    if inspection.status not in {"empty", "existing"}:
        raise WorkspaceStorageError(inspection.message)
    if inspection.status == "existing":
        legacy_status = INSTANCE_STATE.legacy_account_status(
            inspection.directory
        )
        if legacy_status == "accounts":
            raise WorkspaceStorageError(
                "此工作区含有可迁移账号，请改用“打开已有工作区”"
            )
        if legacy_status == "invalid":
            raise WorkspaceStorageError(
                "旧账号数据无法验证；源数据保持不变，请先从备份恢复"
            )
    occupation = ensure_workspace_occupation(str(inspection.directory))
    try:
        workspace = WORKSPACE_SERVICE.prepare_initial(
            str(inspection.directory)
        )
        identity = WORKSPACE_SERVICE.ensure_identity(workspace.directory)
        content = WorkspaceContent(workspace)
        if (
            inspection.status == "empty"
            or fresh_workspace_sqlite_bootstrap_required(content, identity)
        ):
            bootstrap_fresh_workspace_sqlite(
                content,
                workspace_id=identity,
            )
        DEVICE_STATE.remember_workspace_identity(identity)
        INSTANCE_STATE.prepare_auth_database(
            workspace_directory=workspace.directory,
            workspace_id=identity,
        )
        return workspace.public()
    except Exception:
        if WORKSPACE_OCCUPATION is occupation:
            release_workspace_occupation()
        raise


def inspect_initial_workspace(workspace_directory: str) -> Dict[str, Any]:
    inspection = WORKSPACE_SERVICE.inspect(workspace_directory)
    public = inspection.public()
    if inspection.status == "empty":
        public["next_step"] = "create_admin"
        public["message"] = "此目录可以创建内容工作区；管理员将保存到 Instance State"
        public["message_code"] = "setup_workspace_empty"
    elif inspection.status == "existing":
        legacy_status = INSTANCE_STATE.legacy_account_status(
            inspection.directory
        )
        if legacy_status == "accounts":
            public["next_step"] = "login"
            public["message"] = (
                "已找到现有内容和可迁移账号；打开后继续使用同一全局账号域"
            )
            public["message_code"] = "setup_workspace_existing_accounts"
        elif legacy_status == "invalid":
            public["next_step"] = "recover_accounts"
            public["message"] = (
                "旧账号数据无法验证；源数据保持不变，请先从备份恢复"
            )
            public["message_code"] = "setup_workspace_invalid_accounts"
        else:
            public["next_step"] = "create_admin"
            public["message"] = "已找到现有内容；请为当前安装创建管理员"
            public["message_code"] = "setup_workspace_existing_needs_admin"
    return public


def open_initial_workspace(workspace_directory: str) -> Dict[str, Any]:
    inspection = WORKSPACE_SERVICE.inspect(workspace_directory)
    if inspection.status != "existing":
        raise WorkspaceStorageError(inspection.message)
    legacy_status = INSTANCE_STATE.legacy_account_status(
        inspection.directory
    )
    if legacy_status != "accounts":
        raise WorkspaceStorageError(
            "此内容工作区没有可安全迁移的账号，请返回并创建安装管理员"
            if legacy_status != "invalid"
            else "旧账号数据无法验证；源数据保持不变，请先从备份恢复"
        )
    occupation = ensure_workspace_occupation(str(inspection.directory))
    try:
        workspace = WORKSPACE_SERVICE.open_existing(
            str(inspection.directory)
        )
        return {
            **workspace.public(),
            "next_step": "continue",
            "restart": request_controlled_restart(),
        }
    except Exception:
        if WORKSPACE_OCCUPATION is occupation:
            release_workspace_occupation()
        raise


def initial_workspace_status() -> Dict[str, Any]:
    status = {
        "workspace_configured": WORKSPACE_CONFIGURED,
        "workspace_error": WORKSPACE_CONFIGURATION_ERROR,
        "configured_workspace_directory": (
            WORKSPACE_STORAGE.configured_parent_hint()
        ),
    }
    if WORKSPACE_CONFIGURATION_ERROR:
        status["workspace_error_reason"] = (
            "previous_workspace_unavailable"
            if WORKSPACE_STORAGE.has_configuration()
            else "workspace_not_configured"
        )
    return status


install_auth_routes(
    app,
    AUTH_SYSTEM,
    before_delete=reassign_deleted_account_canvases,
    initial_setup_configurator=configure_initial_workspace,
    initial_directory_picker=choose_workspace_parent_directory,
    initial_setup_status_provider=initial_workspace_status,
    initial_workspace_inspector=inspect_initial_workspace,
    initial_workspace_opener=open_initial_workspace,
    user_enricher=enrich_current_workspace_user,
)
install_access_control(
    app,
    AUTH_SYSTEM,
    user_enricher=enrich_current_workspace_user,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount(
    "/assets",
    StaticFiles(
        directory=(
            str(_CONFIGURED_WORKSPACE.managed_media)
            if _CONFIGURED_WORKSPACE is not None
            else os.path.join(SETUP_STATE_DIR, "unavailable-media")
        ),
        check_dir=WORKSPACE_CONFIGURED,
    ),
    name="assets",
)

# --- Pydantic 模型 ---

def current_app_version():
    version_file = os.path.join(BASE_DIR, "VERSION")
    try:
        if os.path.exists(version_file):
            with open(version_file, "r", encoding="utf-8") as f:
                version = (f.read().strip().splitlines() or [""])[0].strip()
                if version:
                    return version
    except Exception:
        pass
    try:
        return time.strftime("%Y.%m.%d", time.localtime())
    except Exception:
        return ""

def versioned_static_html(html: str) -> str:
    version = current_app_version()
    if not version:
        return html
    safe_version = urllib.parse.quote(version, safe="._-")
    pattern = re.compile(
        r'(?P<prefix>(?:data-src|src|href)=["\']|@import\s+url\(["\'])'
        r'(?P<path>/static/[^"\')?#]+(?:\.(?:js|css|html)))'
        r'(?P<query>\?[^"\')#]*)?'
        r'(?P<fragment>#[^"\')]*)?',
        re.I,
    )

    def replace(match):
        path_url = match.group("path")
        existing_query_parts = [
            part for part in (match.group("query") or "")[1:].split("&") if part
        ]
        fingerprint_prefix = ""
        if path_url.startswith("/static/js/infinite-canvas-ui/"):
            fingerprint_prefix = "ic-ui-"
        elif path_url == "/static/js/i18n.js":
            fingerprint_prefix = "i18n-loader-"
        if fingerprint_prefix and any(
            urllib.parse.unquote_plus(part.partition("=")[0]) == "v"
            and urllib.parse.unquote_plus(part.partition("=")[2]).startswith(
                fingerprint_prefix
            )
            for part in existing_query_parts
        ):
            # These assets use content-derived fingerprints synchronized with
            # their dependent module graphs. Replacing one with the application
            # version would make the graph inconsistent.
            return match.group(0)
        query_parts = [
            part
            for part in existing_query_parts
            if urllib.parse.unquote_plus(part.partition("=")[0]) != "v"
        ]
        query_parts.append(f"v={safe_version}")
        return (
            f"{match.group('prefix')}{path_url}?{'&'.join(query_parts)}"
            f"{match.group('fragment') or ''}"
        )

    return pattern.sub(replace, html)

def static_html_response(filename: str):
    path = os.path.join(STATIC_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    return Response(
        versioned_static_html(html),
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )

STATIC_PROMPT_TEMPLATE_MD = os.path.join(STATIC_DIR, "system-prompts", "infinite-canvas-prompt-templates.md")
PROMPT_TEMPLATE_PATHS = [STATIC_PROMPT_TEMPLATE_MD]
PROMPT_TEMPLATE_EN = {
    "多机位九宫格": {
        "name": "9-Angle Multi-Camera Grid",
    },
    "多机位九宫格4K": {
        "name": "9-Angle Multi-Camera Grid 4K",
    },
    "剧情推演四宫格": {
        "name": "4-Panel Story Progression",
    },
    "角色脸部三视图": {
        "name": "Character Face 3-View Sheet",
    },
    "产品三视图": {
        "name": "Product 3-View Sheet",
    },
    "25宫格连贯分镜": {
        "name": "25-Panel Continuous Storyboard",
    },
    "电影级光影校正": {
        "name": "Cinematic Lighting Comparison",
    },
    "角色设定参考表（胸口特写+全身三视图）": {
        "name": "Character Reference Sheet: Portrait + Full-Body Views",
    },
    "6种基础表情胸像（2×3六宫格）": {
        "name": "6 Basic Expression Busts",
    },
    "360全景图": {
        "name": "360 Panorama VR Image",
    },
}

def prompt_template_markdown_path() -> str:
    for path in PROMPT_TEMPLATE_PATHS:
        if os.path.exists(path):
            return path
    return ""

def prompt_template_category(name: str, usage_text: str) -> str:
    text = f"{name} {usage_text}"
    if any(k in text for k in ["光影", "灯光", "光效", "电影级"]):
        return "lighting"
    if any(k in text for k in ["视角", "全景", "VR", "镜头", "俯拍", "仰拍", "景别", "构图", "透视"]):
        return "view"
    if any(k in text for k in ["角色", "脸部", "表情", "Actor", "服装"]):
        return "character"
    if any(k in name for k in ["产品", "电商", "工业"]):
        return "product"
    return "storyboard"

def extract_prompt_template_section(block: str, title: str) -> str:
    pattern = rf"###\s*{re.escape(title)}\s*\n(?P<body>.*?)(?=\n###\s+|\Z)"
    match = re.search(pattern, block, re.S)
    if not match:
        return ""
    body = match.group("body").strip()
    fence = re.search(r"```(?:\w+)?\s*\n(?P<code>.*?)\n```", body, re.S)
    return (fence.group("code") if fence else body).strip()

def parse_prompt_template_markdown(text: str):
    templates = []
    matches = list(re.finditer(r"^##\s*预设\s*(\d+)\s*[：:]\s*(.+?)\s*$", text, re.M))
    for index, match in enumerate(matches):
        number = match.group(1).strip()
        name = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[start:end]
        usage_text = extract_prompt_template_section(block, "适用场景")
        positive = extract_prompt_template_section(block, "正向提示词")
        negative = extract_prompt_template_section(block, "负向提示词")
        params_raw = extract_prompt_template_section(block, "平台参数建议")
        params = {}
        for line in params_raw.splitlines():
            item = re.match(r"[-*]\s*\*\*(.+?)\*\*\s*[：:]\s*(.+)", line.strip())
            if item:
                params[item.group(1).strip()] = item.group(2).strip()
        if not positive:
            continue
        templates.append({
            "id": f"builtin_md_{number}",
            "number": number,
            "name": name,
            "name_en": PROMPT_TEMPLATE_EN.get(name, {}).get("name", name),
            "category": prompt_template_category(name, usage_text),
            "positive": positive,
            "negative": negative,
            "params": params,
            "builtin": True,
        })
    return templates

@app.get("/api/app-info")
def app_info():
    return {"version": current_app_version()}

def connectivity_probe(name: str, url: str, timeout: float = 5.0) -> Dict[str, Any]:
    started = time.time()
    item = {
        "name": name,
        "url": url,
        "ok": False,
        "status": 0,
        "elapsed_ms": 0,
        "error": "",
        "timed_out": False,
    }
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "Reroll-Updater"},
            timeout=timeout,
            stream=True,
            proxies=urllib.request.getproxies() or None,
        )
        item["status"] = response.status_code
        item["ok"] = 200 <= response.status_code < 400
        if not item["ok"]:
            item["error"] = f"HTTP {response.status_code} {response.reason}"
        response.close()
    except requests.Timeout:
        item["timed_out"] = True
        item["error"] = f"连接超时（超过 {timeout:g}s）"
    except requests.RequestException as exc:
        item["error"] = str(exc)
    finally:
        item["elapsed_ms"] = int((time.time() - started) * 1000)
    return item

def update_connectivity_targets() -> List[Tuple[str, str, str, bool]]:
    targets = [
        ("GitHub 更新列表", GITHUB_TREE_URL, "github", True),
        ("GitHub 版本文件", GITHUB_VERSION_URL, "github", True),
        ("GitHub 主页", "https://github.com/", "github", False),
    ]
    if MODELSCOPE_UPDATE_ENABLED:
        targets.extend([
            ("ModelScope 更新列表", MODELSCOPE_TREE_URL, "modelscope", True),
            ("ModelScope 版本文件", MODELSCOPE_VERSION_URL, "modelscope", True),
            ("ModelScope 空间页面", MODELSCOPE_REPO_URL, "modelscope", False),
            ("ModelScope 主页", "https://modelscope.cn/", "modelscope", False),
        ])
    targets.append(("Google 连通性", "https://www.google.com/generate_204", "reference", False))
    return targets

@app.get("/api/update-connectivity/probe")
def update_connectivity_probe(name: str):
    raise HTTPException(status_code=410, detail="项目更新功能已移除")
    """实时检测：只探测单个目标，前端可并发调用并逐条刷新。"""
    for t_name, url, source, required in update_connectivity_targets():
        if t_name == name:
            item = connectivity_probe(t_name, url)
            item["source"] = source
            item["required"] = required
            return item
    raise HTTPException(status_code=404, detail="未知的连通性检测目标")

@app.get("/api/update-connectivity")
def update_connectivity():
    raise HTTPException(status_code=410, detail="项目更新功能已移除")
    targets = update_connectivity_targets()
    results = []
    for name, url, source, required in targets:
        item = connectivity_probe(name, url)
        item["source"] = source
        item["required"] = required
        results.append(item)
    sources = {}
    enabled_sources = ["github"]
    if MODELSCOPE_UPDATE_ENABLED:
        enabled_sources.append("modelscope")
    for source in enabled_sources:
        source_required = [item for item in results if item.get("source") == source and item.get("required")]
        sources[source] = {
            "ok": bool(source_required) and all(item["ok"] for item in source_required),
            "required": [item["name"] for item in source_required],
        }
    if not MODELSCOPE_UPDATE_ENABLED:
        sources["modelscope"] = {"ok": False, "required": [], "enabled": False}
    return {
        "ok": sources["github"]["ok"],
        "results": results,
        "sources": sources,
        "required": sources["github"]["required"],
        "optional": [
            item[0] for item in targets
            if not item[3]
        ],
    }

def fetch_remote_version(url: str, timeout: float = 5.0) -> Dict[str, Any]:
    info: Dict[str, Any] = {"version": "", "ok": False, "error": "", "url": url}
    if not url:
        info["error"] = "missing url"
        return info
    try:
        resp = requests.get(
            f"{url}{'&' if '?' in url else '?'}t={int(time.time())}",
            headers={"User-Agent": "Reroll-Updater"},
            timeout=timeout,
            proxies=urllib.request.getproxies() or None,
        )
        if 200 <= resp.status_code < 400:
            text = resp.content.decode("utf-8", errors="replace").strip()
            version = text.splitlines()[0].strip() if text else ""
            # 防御：raw 网页/错误页会返回 HTML 或 JSON，必须长得像版本号（含数字、无尖括号/花括号）
            if version and "<" not in version and "{" not in version and re.search(r"\d", version):
                info["version"] = version
                info["ok"] = True
            elif not version:
                info["error"] = "空版本文件"
            else:
                info["error"] = "版本文件格式异常"
        else:
            info["error"] = f"HTTP {resp.status_code}"
    except requests.RequestException as exc:
        info["error"] = str(exc)
    return info

def version_tuple(value: str) -> List[int]:
    return [int(x) for x in re.findall(r"\d+", str(value or ""))]

def version_gt(a: str, b: str) -> bool:
    ta, tb = version_tuple(a), version_tuple(b)
    n = max(len(ta), len(tb))
    ta += [0] * (n - len(ta))
    tb += [0] * (n - len(tb))
    return ta > tb

@app.get("/api/check-update")
def check_update():
    raise HTTPException(status_code=410, detail="项目更新功能已移除")
    """服务端并发检测已启用的更新源（走系统代理，避免浏览器跨域/被墙）。"""
    current = current_app_version()
    source_urls = {"github": GITHUB_VERSION_URL}
    if MODELSCOPE_UPDATE_ENABLED:
        source_urls["modelscope"] = MODELSCOPE_VERSION_URL
    holder: Dict[str, Dict[str, Any]] = {}
    def _probe(key: str, url: str):
        item = fetch_remote_version(url, timeout=5.0)
        item["source"] = key
        holder[key] = item
    threads = [
        Thread(target=_probe, args=(source, url), daemon=True)
        for source, url in source_urls.items()
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5.5)
    github = holder.get("github") or {"version": "", "ok": False, "error": "检测超时（超过 5s）", "url": GITHUB_VERSION_URL, "source": "github"}
    if MODELSCOPE_UPDATE_ENABLED:
        modelscope = holder.get("modelscope") or {"version": "", "ok": False, "error": "检测超时（超过 5s）", "url": MODELSCOPE_VERSION_URL, "source": "modelscope", "enabled": True}
    else:
        modelscope = {"version": "", "ok": False, "error": "未配置 ModelScope 更新源", "url": "", "source": "modelscope", "enabled": False}
    best: Dict[str, Any] = {}
    candidates = [github]
    if MODELSCOPE_UPDATE_ENABLED:
        candidates.append(modelscope)
    for item in candidates:
        if item["ok"] and item["version"]:
            if not best or version_gt(item["version"], best["version"]):
                best = {"source": item["source"], "version": item["version"]}
    update_available = bool(best and version_gt(best["version"], current))
    notes_by_source: Dict[str, Any] = {}
    if best and best.get("version"):
        best_notes, notes_by_source = fetch_update_notes_with_fallback(str(best.get("source") or "github"), best["version"], timeout=3.0)
        best["update_notes"] = best_notes if best_notes.get("ok") else {"version": best["version"], "items": []}
    return {
        "current": current,
        "github": github,
        "modelscope": modelscope,
        "latest": best,
        "update_notes": best.get("update_notes") if best else {},
        "update_notes_sources": notes_by_source,
        "update_available": update_available,
        "reachable": any(bool(item["ok"]) for item in candidates),
    }

UPDATE_ROOT_FILES = APPLICATION_UPDATE_ROOT_FILES
UPDATE_RUNTIME_FILES = APPLICATION_UPDATE_RUNTIME_FILES
UPDATE_REQUIRED_FILES = UPDATE_ROOT_FILES | UPDATE_RUNTIME_FILES

def update_allowed_file(path: str) -> bool:
    return WorkspaceArtifacts.is_update_backup_file(path)

# 缓存 GitHub Tree API 响应（含 ETag），减少 60 次/h 限流压力
GITHUB_TREE_CACHE: Dict[str, Any] = {"etag": "", "data": None, "expires_at": 0.0}

def github_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> requests.Response:
    try:
        response = requests.get(
            url,
            headers=headers or {},
            timeout=timeout,
            proxies=urllib.request.getproxies() or None,
        )
    except requests.RequestException as exc:
        raise urllib.error.URLError(str(exc)) from exc
    if response.status_code >= 400 or response.status_code == 304:
        raise urllib.error.HTTPError(url, response.status_code, response.reason, response.headers, None)
    return response

def github_json(url: str, use_etag_cache: bool = False):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Reroll-Updater",
    }
    cache_key = url
    if use_etag_cache and cache_key == GITHUB_TREE_URL:
        if GITHUB_TREE_CACHE["data"] and time.time() < GITHUB_TREE_CACHE["expires_at"]:
            return GITHUB_TREE_CACHE["data"]
        if GITHUB_TREE_CACHE["etag"]:
            headers["If-None-Match"] = GITHUB_TREE_CACHE["etag"]
    try:
        resp = github_get(url, headers=headers, timeout=30)
        etag = resp.headers.get("ETag", "")
        payload = json.loads(resp.content.decode("utf-8", errors="replace"))
        if use_etag_cache and cache_key == GITHUB_TREE_URL:
            GITHUB_TREE_CACHE.update({
                "etag": etag,
                "data": payload,
                "expires_at": time.time() + 600,  # 10 分钟内复用
            })
        return payload
    except urllib.error.HTTPError as exc:
        # 304 表示对方树未变，沿用缓存
        if exc.code == 304 and use_etag_cache and GITHUB_TREE_CACHE["data"]:
            GITHUB_TREE_CACHE["expires_at"] = time.time() + 600
            return GITHUB_TREE_CACHE["data"]
        raise

def github_bytes(url: str) -> bytes:
    resp = github_get(url, headers={"User-Agent": "Reroll-Updater"}, timeout=60)
    return resp.content

def download_github_update_files(files: List[str], staging_root: str) -> None:
    staging_root_abs = os.path.abspath(staging_root)
    for rel in files:
        safe_update_target(rel)
        raw_url = f"{GITHUB_RAW_ROOT}/{urllib.parse.quote(rel, safe='/')}"
        data = github_bytes(raw_url)
        stage_path = os.path.abspath(os.path.join(staging_root_abs, *rel.split("/")))
        if os.path.commonpath([staging_root_abs, stage_path]) != staging_root_abs:
            raise ValueError(f"更新暂存路径不安全：{rel}")
        os.makedirs(os.path.dirname(stage_path), exist_ok=True)
        with open(stage_path, "wb") as f:
            f.write(data)

def modelscope_update_file_list() -> List[str]:
    """通过 ModelScope 仓库文件 API 列出所有允许更新的文件（不依赖 git）。"""
    if not MODELSCOPE_UPDATE_ENABLED:
        raise RuntimeError("ModelScope 更新源尚未配置")
    resp = github_get(MODELSCOPE_TREE_URL, headers={"User-Agent": "Reroll-Updater"}, timeout=30)
    payload = json.loads(resp.content.decode("utf-8", errors="replace"))
    files_node = ((payload.get("Data") or {}).get("Files")) or []
    out: List[str] = []
    for entry in files_node:
        if not isinstance(entry, dict):
            continue
        if entry.get("Type") != "blob":
            continue
        path = str(entry.get("Path") or "").replace("\\", "/")
        if update_allowed_file(path):
            out.append(path)
    return sorted(set(out))

def modelscope_file_bytes(rel: str) -> bytes:
    url = MODELSCOPE_FILE_API_ROOT + urllib.parse.quote(rel, safe="/")
    resp = github_get(url, headers={"User-Agent": "Reroll-Updater"}, timeout=60)
    return resp.content

def download_modelscope_update_files(staging_root: str) -> List[str]:
    # 用 HTTP 仓库文件 API 下载（与 GitHub raw 同样思路），不依赖本机安装 Git。
    # 之前用 git clone 会要求目标机装 Git for Windows，很多用户没装 → 一键更新失败。
    files = modelscope_update_file_list()
    if not files:
        raise RuntimeError("ModelScope 未返回任何文件")
    missing_root = sorted(UPDATE_REQUIRED_FILES.difference(files))
    if missing_root:
        raise RuntimeError(f"ModelScope 更新源缺少必要文件：{', '.join(missing_root)}")
    if not any(f.startswith("static/") for f in files):
        raise RuntimeError("ModelScope 未返回 static 文件，已取消更新")
    staging_root_abs = os.path.abspath(staging_root)
    for rel in files:
        safe_update_target(rel)
        data = modelscope_file_bytes(rel)
        stage_path = os.path.abspath(os.path.join(staging_root_abs, *rel.split("/")))
        if os.path.commonpath([staging_root_abs, stage_path]) != staging_root_abs:
            raise ValueError(f"更新暂存路径不安全：{rel}")
        os.makedirs(os.path.dirname(stage_path), exist_ok=True)
        with open(stage_path, "wb") as f:
            f.write(data)
    return files

def safe_update_target(path: str) -> str:
    rel = str(path or "").replace("\\", "/").lstrip("/")
    if not update_allowed_file(rel):
        raise ValueError(f"更新文件不在允许范围：{rel}")
    target = os.path.abspath(os.path.join(BASE_DIR, *rel.split("/")))
    base = os.path.abspath(BASE_DIR)
    if os.path.commonpath([base, target]) != base:
        raise ValueError(f"更新路径不安全：{rel}")
    return target

def safe_static_dir() -> str:
    target = os.path.abspath(STATIC_DIR)
    expected = os.path.abspath(os.path.join(BASE_DIR, "static"))
    base = os.path.abspath(BASE_DIR)
    if target != expected or os.path.commonpath([base, target]) != base:
        raise RuntimeError(f"static 路径不安全：{target}")
    return target

class UpdateRequest(BaseModel):
    auto_restart: bool = False
    restart_delay: int = 3
    source: str = "github"
    fallback: bool = True

def github_update_file_list() -> Tuple[List[str], List[str], List[str]]:
    tree_data = github_json(GITHUB_TREE_URL, use_etag_cache=True)
    entries = tree_data.get("tree") or []
    static_files = []
    root_files = []
    for entry in entries:
        path = str(entry.get("path") or "").replace("\\", "/")
        if entry.get("type") == "blob" and update_allowed_file(path):
            if path.startswith("static/"):
                static_files.append(path)
            else:
                root_files.append(path)
    static_files = sorted(set(static_files))
    root_files = sorted(set(root_files))
    files = root_files + static_files
    missing_root = sorted(UPDATE_REQUIRED_FILES.difference(root_files))
    if missing_root:
        raise RuntimeError(f"GitHub 更新源缺少必要文件：{', '.join(missing_root)}")
    if not static_files:
        raise RuntimeError("GitHub 未返回 static 文件，已取消更新")
    return root_files, static_files, files

def staged_update_file_list(staging_root: str) -> Tuple[List[str], List[str], List[str]]:
    root_files = []
    static_files = []
    for root_dir, _, names in os.walk(staging_root):
        for name in names:
            path = os.path.abspath(os.path.join(root_dir, name))
            rel = os.path.relpath(path, staging_root).replace("\\", "/")
            if not update_allowed_file(rel):
                continue
            if rel.startswith("static/"):
                static_files.append(rel)
            else:
                root_files.append(rel)
    missing_root = sorted(UPDATE_REQUIRED_FILES.difference(root_files))
    if missing_root:
        raise RuntimeError(f"更新源缺少必要文件：{', '.join(missing_root)}")
    if not static_files:
        raise RuntimeError("更新源未返回 static 文件，已取消更新")
    root_files = sorted(set(root_files))
    static_files = sorted(set(static_files))
    return root_files, static_files, root_files + static_files

UPDATE_SOURCE_LABELS = {"github": "GitHub", "modelscope": "ModelScope"}

def normalize_update_source(value: str) -> str:
    source = str(value or "github").strip().lower()
    if source == "ms":
        source = "modelscope"
    if source not in {"github", "modelscope"}:
        return "github"
    if source == "modelscope" and not MODELSCOPE_UPDATE_ENABLED:
        return "github"
    return source

def stage_update_from_source(source: str, staging_root: str) -> Tuple[List[str], List[str], List[str]]:
    """下载指定源的更新文件到 staging，返回 (root_files, static_files, files)。失败抛异常。"""
    if source == "modelscope":
        if not MODELSCOPE_UPDATE_ENABLED:
            raise RuntimeError("ModelScope 更新源尚未配置")
        download_modelscope_update_files(staging_root)
        return staged_update_file_list(staging_root)
    root_files, static_files, files = github_update_file_list()
    download_github_update_files(files, staging_root)
    return root_files, static_files, files

@app.post("/api/update-from-github")
def update_from_github(req: UpdateRequest = UpdateRequest()):
    raise HTTPException(status_code=410, detail="项目更新功能已移除")
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在更新中，请稍后再试")
    staging_root = ""
    requested_source = normalize_update_source(req.source)
    # 冗余设计：先用用户选择的源，失败后自动切换到另一个源兜底，全部失败才报错
    source_order = [requested_source]
    if req.fallback:
        other = "modelscope" if requested_source == "github" else "github"
        if other != "modelscope" or MODELSCOPE_UPDATE_ENABLED:
            source_order.append(other)
    try:
        backup_root = os.path.join(
            update_backup_directory(),
            time.strftime("%Y%m%d-%H%M%S"),
        )

        # 下载阶段（带兜底切换），任意源成功即停止
        source = requested_source
        root_files = static_files = files = None
        download_errors: List[str] = []
        fallback_used = False
        for idx, candidate in enumerate(source_order):
            attempt_staging = os.path.join(
                update_staging_directory(),
                f"{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}-{candidate}",
            )
            if os.path.isdir(attempt_staging):
                shutil.rmtree(attempt_staging, ignore_errors=True)
            label = UPDATE_SOURCE_LABELS.get(candidate, candidate)
            print(f"[update] 尝试下载源 [{idx + 1}/{len(source_order)}] {label}（{candidate}）→ {attempt_staging}")
            try:
                root_files, static_files, files = stage_update_from_source(candidate, attempt_staging)
                source = candidate
                staging_root = attempt_staging
                fallback_used = idx > 0
                print(f"[update] 下载源 {label} 成功，共 {len(files or [])} 个文件")
                break
            except Exception as exc:  # noqa: BLE001 — 记录后尝试下一个源
                if os.path.isdir(attempt_staging):
                    shutil.rmtree(attempt_staging, ignore_errors=True)
                print(f"[update] 下载源 {label} 失败：{exc}")
                traceback.print_exc()
                download_errors.append(f"{label}：{exc}")
        if not staging_root:
            detail = "；".join(download_errors) or "未知错误"
            print(f"[update] 所有下载源均失败 → {detail}")
            raise HTTPException(status_code=502, detail=f"所有下载源均失败 → {detail}")

        updated = []
        for rel in root_files:
            target = safe_update_target(rel)
            if os.path.exists(target):
                backup_path = os.path.join(backup_root, *rel.split("/"))
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(target, backup_path)

        staged_static_dir = os.path.join(staging_root, "static")
        if not os.path.isdir(staged_static_dir):
            raise RuntimeError("更新源的 static 暂存目录不存在，已取消更新")
        static_dir = safe_static_dir()
        backup_static_dir = os.path.join(backup_root, "static")
        if os.path.isdir(static_dir):
            os.makedirs(os.path.dirname(backup_static_dir), exist_ok=True)
            shutil.copytree(static_dir, backup_static_dir)
            shutil.rmtree(static_dir)
        try:
            shutil.copytree(staged_static_dir, static_dir)
        except Exception:
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir, ignore_errors=True)
            if os.path.isdir(backup_static_dir):
                shutil.copytree(backup_static_dir, static_dir)
            raise
        updated.extend(static_files)

        replaced_root_files = []
        try:
            for rel in root_files:
                target = safe_update_target(rel)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                temp_path = f"{target}.update_tmp"
                shutil.copy2(os.path.join(staging_root, *rel.split("/")), temp_path)
                os.replace(temp_path, target)
                replaced_root_files.append(rel)
                updated.append(rel)
        except Exception:
            for rel in reversed(replaced_root_files):
                backup_path = os.path.join(backup_root, *rel.split("/"))
                target = safe_update_target(rel)
                if os.path.exists(backup_path):
                    temp_path = f"{target}.rollback_tmp"
                    shutil.copy2(backup_path, temp_path)
                    os.replace(temp_path, target)
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir, ignore_errors=True)
            if os.path.isdir(backup_static_dir):
                shutil.copytree(backup_static_dir, static_dir)
            raise

        restart_scheduled = False
        restart_status = {}
        if req.auto_restart and updated:
            restart_status = request_controlled_restart()
            restart_scheduled = restart_status.get("stage") == "stopping"
        new_version = ""
        try:
            staged_version = os.path.join(staging_root, "VERSION")
            if os.path.exists(staged_version):
                with open(staged_version, "r", encoding="utf-8") as f:
                    new_version = (f.read().strip().splitlines() or [""])[0].strip()
        except Exception:
            new_version = ""
        notes_file = os.path.join(staging_root, "static", "update-notes.json")
        update_notes = {}
        try:
            if os.path.exists(notes_file):
                with open(notes_file, "r", encoding="utf-8") as f:
                    update_notes = safe_update_notes(json.load(f), new_version)
        except Exception:
            update_notes = {}
        return {
            "ok": True,
            "source": source,
            "source_label": UPDATE_SOURCE_LABELS.get(source, source),
            "requested_source": requested_source,
            "fallback_used": fallback_used,
            "download_errors": download_errors,
            "updated": updated,
            "count": len(updated),
            "version": new_version,
            "update_notes": update_notes,
            "backup_dir": backup_root if os.path.exists(backup_root) else "",
            "restart_required": True,
            "restart_scheduled": restart_scheduled,
            "restart_status": restart_status,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"更新失败：{exc}") from exc
    finally:
        if staging_root and os.path.isdir(staging_root):
            shutil.rmtree(staging_root, ignore_errors=True)
        UPDATE_LOCK.release()

def list_update_backups() -> List[Dict[str, Any]]:
    root = update_backup_directory()
    if not os.path.isdir(root):
        return []
    items = []
    for name in sorted(os.listdir(root), reverse=True):
        bp = os.path.join(root, name)
        if not os.path.isdir(bp):
            continue
        file_count = 0
        for _, _, fs in os.walk(bp):
            file_count += len(fs)
        try:
            created_at = os.path.getmtime(bp)
        except OSError:
            created_at = 0.0
        items.append({
            "name": name,
            "file_count": file_count,
            "created_at": created_at,
        })
    return items

@app.get("/api/update-backups")
def get_update_backups():
    return {"backups": list_update_backups()}

class RollbackRequest(BaseModel):
    name: str = ""
    auto_restart: bool = False
    restart_delay: int = 3

@app.post("/api/update-rollback")
def rollback_update(req: RollbackRequest):
    if not req.name:
        raise HTTPException(status_code=400, detail="缺少备份名称")
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="正在更新中，请稍后再试")
    try:
        backup_root_abs = os.path.abspath(update_backup_directory())
        backup_dir = os.path.abspath(os.path.join(backup_root_abs, req.name))
        if os.path.commonpath([backup_root_abs, backup_dir]) != backup_root_abs:
            raise HTTPException(status_code=400, detail="备份路径不安全")
        if not os.path.isdir(backup_dir):
            raise HTTPException(status_code=404, detail="备份不存在")
        restored = []
        skipped = []
        backup_static_dir = os.path.join(backup_dir, "static")
        if os.path.isdir(backup_static_dir):
            static_dir = safe_static_dir()
            if os.path.isdir(static_dir):
                shutil.rmtree(static_dir)
            try:
                shutil.copytree(backup_static_dir, static_dir)
            except Exception:
                if os.path.isdir(static_dir):
                    shutil.rmtree(static_dir, ignore_errors=True)
                raise
            for dirpath, _, filenames in os.walk(backup_static_dir):
                for fn in filenames:
                    src = os.path.join(dirpath, fn)
                    restored.append(os.path.relpath(src, backup_dir).replace("\\", "/"))
        for dirpath, _, filenames in os.walk(backup_dir):
            for fn in filenames:
                src = os.path.join(dirpath, fn)
                rel = os.path.relpath(src, backup_dir).replace("\\", "/")
                if rel.startswith("static/"):
                    continue
                if not update_allowed_file(rel):
                    skipped.append(rel)
                    continue
                try:
                    target = safe_update_target(rel)
                except ValueError:
                    skipped.append(rel)
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                temp_path = f"{target}.rollback_tmp"
                with open(src, "rb") as fin, open(temp_path, "wb") as fout:
                    shutil.copyfileobj(fin, fout)
                os.replace(temp_path, target)
                restored.append(rel)
        restart_scheduled = False
        restart_status = {}
        if req.auto_restart and restored:
            restart_status = request_controlled_restart()
            restart_scheduled = restart_status.get("stage") == "stopping"
        return {
            "ok": True,
            "restored": restored,
            "skipped": skipped,
            "count": len(restored),
            "restart_required": True,
            "restart_scheduled": restart_scheduled,
            "restart_status": restart_status,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"回滚失败：{exc}") from exc
    finally:
        UPDATE_LOCK.release()

class GenerateRequest(BaseModel):
    prompt: str = ""
    width: int = 1024
    height: int = 1024
    workflow_json: str = "Z-Image.json"
    params: Dict[str, Any] = {}
    type: str = "zimage"
    client_id: str = ""
    convert_to_jpg: bool = False
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class DeleteHistoryRequest(BaseModel):
    timestamp: Optional[float] = None
    history_id: str = ""

class TokenRequest(BaseModel):
    token: str

class CloudGenRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = ""
    resolution: str = "1024x1024"
    type: str = "zimage"
    image_urls: List[str] = []
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CloudPollRequest(BaseModel):
    task_id: str
    api_key: str = ""
    client_id: Optional[str] = None

class AIReference(BaseModel):
    url: str = ""
    name: str = ""
    role: str = ""
    kind: str = ""
    mime: str = ""
    instance_id: str = ""
    natural_w: int = 0
    natural_h: int = 0

class OnlineImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = ""
    size: str = "1024x1024"
    target_aspect_ratio: str = ""
    reference_aspect_ratio: str = ""
    resolution_tier: str = ""
    quality: str = "auto"
    transparent_png: bool = False
    n: int = 1
    reference_images: List[AIReference] = []
    catalog_revision: str = ""
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0


class LayerDecompositionRequest(BaseModel):
    """One paid layer-decomposition intent for one source Image Node."""

    provider_id: str = "apimart"
    model: str = "seedream-5-0-pro"
    resolution_tier: str = "2K"
    prompt: str = Field(default="", max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    image: AIReference
    source_media_id: str = Field(default="", max_length=240)
    catalog_revision: str = ""
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class ImageTaskQueryRequest(BaseModel):
    provider_id: str = "comfly"
    task_id: str = Field(min_length=1, max_length=240)

def active_generation_run_count() -> int:
    return generation_run_control.active_count()

class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=VIDEO_PROMPT_MAX_LENGTH)
    provider_id: str = "comfly"
    model: str = "veo3-fast"
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[AIReference] = []
    videos: List[str] = []
    audios: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False
    return_last_frame: bool = False
    generate_audio: bool = False
    multimodal: bool = False
    trusted_asset: bool = False
    catalog_revision: str = ""
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class TempShUploadRequest(BaseModel):
    url: str = ""

class CloudVideoUploadRequest(BaseModel):
    url: str = ""
    service: str = "auto"

class RunningHubSubmitRequest(BaseModel):
    webappId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    instanceType: str = ""
    useWallet: bool = False
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class RunningHubWorkflowSubmitRequest(BaseModel):
    workflowId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    workflow: Any = None
    useWallet: bool = False
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class RunningHubUploadAssetRequest(BaseModel):
    url: str = ""
    useWallet: bool = False

class JimengHelpRequest(BaseModel):
    command: str = ""

class CodexHelpRequest(BaseModel):
    command: str = ""

class GeminiCliHelpRequest(BaseModel):
    command: str = ""

class JimengQueryMediaRequest(BaseModel):
    submit_id: str = ""
    kind: str = "image"

class RunningHubWorkflowConfigField(BaseModel):
    id: str = ""
    nodeId: str = ""
    fieldName: str = ""
    fieldValue: str = ""
    fieldType: str = "TEXT"
    label: str = ""
    enabled: bool = True
    sourceFromUpstream: bool = True
    group: str = ""
    note: str = ""
    options: List[str] = Field(default_factory=list)
    random_enabled: bool = False
    min: Any = ""
    max: Any = ""
    step: Any = ""
    imageOrder: int = 0
    required: bool = False

class RunningHubWorkflowConfig(BaseModel):
    workflowId: str = ""
    title: str = ""
    description: str = ""
    fields: List[RunningHubWorkflowConfigField] = Field(default_factory=list)
    workflowJson: Dict[str, Any] = Field(default_factory=dict)
    optionalImageMode: str = "prune-workflow"
    raw: Dict[str, Any] = Field(default_factory=dict)

class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"
    image_generation_endpoint: str = ""
    image_edit_endpoint: str = ""
    enabled: bool = True
    primary: bool = False
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    model_names: Dict[str, str] = {}
    model_protocols: Dict[str, str] = {}
    ms_loras: List[Dict[str, Any]] = []
    ms_defaults_version: int = 0
    rh_apps: List[Dict[str, Any]] = []
    rh_workflows: List[Dict[str, Any]] = []
    volcengine_project_name: str = VOLCENGINE_DEFAULT_PROJECT_NAME
    volcengine_region: str = VOLCENGINE_DEFAULT_REGION
    volcengine_access_key_id: Optional[str] = None
    volcengine_secret_access_key: Optional[str] = None
    api_key: Optional[str] = None
    wallet_api_key: Optional[str] = None
    clear_key: bool = False
    clear_wallet_key: bool = False
    clear_volcengine_access_key_id: bool = False
    clear_volcengine_secret_access_key: bool = False

class AvailableModelOrderPayload(BaseModel):
    image: List[str] = Field(default_factory=list)
    video: List[str] = Field(default_factory=list)
    text: List[str] = Field(default_factory=list)
    names: Dict[str, str] = Field(default_factory=dict)
    visible: Optional[Dict[str, List[str]]] = None

class DesignTokenChangePayload(BaseModel):
    name: str
    value: Optional[str] = None
    light: Optional[str] = None
    dark: Optional[str] = None

class DesignTokenSavePayload(BaseModel):
    expected_revision: str
    changes: List[DesignTokenChangePayload] = Field(default_factory=list)

class MsGenerateRequest(BaseModel):
    prompt: str
    api_key: str = ""
    model: str = "black-forest-labs/FLUX.2-klein-9B"
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
    size: str = ""
    loras: Optional[Any] = None
    client_id: Optional[str] = None
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class CanvasLLMRequest(BaseModel):
    message: str = Field(min_length=1, max_length=LLM_MESSAGE_MAX_LENGTH)
    system_prompt: str = ""
    model: str = ""
    messages: List[Dict[str, Any]] = []
    provider: str = "comfly"
    ms_model: str = ""
    images: List[str] = []   # 可以是 /assets/*.png 本地路径或 http(s)/data URL
    videos: List[str] = []   # 可以是 /assets/*.mp4 本地路径或 http(s)/data URL
    catalog_revision: str = ""
    canvas_id: str = ""
    node_id: str = ""
    generation_operation_id: str = ""
    generation_request_index: int = 0

class CanvasCreateRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    kind: str = "classic"
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None

class CanvasMetaUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    owner: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None
    project: Optional[str] = None
    board_x: Optional[float] = None
    board_y: Optional[float] = None
    cover_url: Optional[str] = None
    cover_node_id: Optional[str] = None
    cover_image_index: Optional[int] = None

class CanvasMetaBatchItem(BaseModel):
    id: str
    board_x: Optional[float] = None
    board_y: Optional[float] = None

class CanvasMetaBatchUpdate(BaseModel):
    updates: List[CanvasMetaBatchItem] = Field(default_factory=list)

class CanvasVisibilityUpdate(BaseModel):
    visibility: str

class SmartCanvasViewStateUpdate(BaseModel):
    center_x: float = Field(ge=-1_000_000_000, le=1_000_000_000)
    center_y: float = Field(ge=-1_000_000_000, le=1_000_000_000)
    scale: float = Field(ge=0.02, le=8)

class ProjectCreateRequest(BaseModel):
    name: str = "新项目"

class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None

class AccountProjectPermissionsUpdate(BaseModel):
    project_ids: List[str] = Field(default_factory=list)


class WorkspaceAssetPublishItem(BaseModel):
    canvas_id: str = ""
    node_id: str = ""
    url: str = ""
    name: str = ""


class WorkspaceAssetPublishRequest(BaseModel):
    items: List[WorkspaceAssetPublishItem] = Field(
        default_factory=list,
        max_length=200,
    )


class WorkspaceAssetRenameRequest(BaseModel):
    name: Optional[str] = None
    folder_id: Optional[str] = None


class WorkspaceAssetFolderRequest(BaseModel):
    name: str = ""

class CanvasSaveRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    viewport: Dict[str, Any] = {}
    logs: List[Dict[str, Any]] = []
    settings: Dict[str, Any] = {}
    client_id: str = ""
    base_updated_at: int = 0

class CanvasAssetCheckRequest(BaseModel):
    urls: List[str] = []

class SmartCanvasImageCaptionRequest(BaseModel):
    canvas_id: str = ""
    node_id: str = ""
    image_index: int = 0
    provider: str = ""
    model: str = ""
    ms_model: str = ""
    prompt: str = "请反推这张图片的中文 AI 生图提示词"

class SmartCanvasMattingRequest(BaseModel):
    canvas_id: str = ""
    node_id: str = ""
    image_index: int = 0
    client_id: str = ""

class SmartCanvasDepthMapRequest(BaseModel):
    canvas_id: str = Field(default="", max_length=200)
    source_node_id: str = Field(default="", max_length=200)
    source_image_index: int = Field(default=0, ge=0, le=1000)
    node_id: str = Field(default="", max_length=200)
    generation_operation_id: str = Field(default="", max_length=240)
    generation_request_index: int = Field(default=0, ge=0, le=1000)
    client_id: str = Field(default="", max_length=120)

class CanvasAssetDownloadRequest(BaseModel):
    urls: List[str] = []
    items: List[Dict[str, Any]] = []
    filename: str = "canvas-output-images.zip"

class CanvasWorkflowExportRequest(BaseModel):
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    filename: str = "canvas-workflow.zip"
    include_resources: bool = True

class SmartCanvasGroupExportItem(BaseModel):
    kind: str = ""
    url: str = ""
    text: str = ""
    name: str = ""

class SmartCanvasGroupExportRequest(BaseModel):
    folder: str = ""
    group_name: str = "group"
    items: List[SmartCanvasGroupExportItem] = []

class LocalImageImportRequest(BaseModel):
    path: str = ""
    paths: List[str] = Field(default_factory=list)

class PromptLibraryRequest(BaseModel):
    name: str = "提示词库"

class PromptLibraryItemRequest(BaseModel):
    library_id: str = ""
    item_id: str = ""
    name: str = "提示词"
    category: str = "custom"
    positive: str = ""
    negative: str = ""
    cover: Optional[str] = None

class CanvasPromptTemplateRequest(BaseModel):
    operation_id: str = ""
    base_revision: int = 0
    client_id: str = ""
    expected_item_version: str = ""
    name: str = "提示词"
    positive: str = ""
    cover: Optional[str] = None

class CanvasPromptTemplateCopyRequest(BaseModel):
    canvas_id: str = ""
    operation_id: str = ""
    base_revision: int = 0
    client_id: str = ""
    library_id: str = ""

class CanvasPromptTemplatePromotionRequest(BaseModel):
    operation_id: str = ""
    base_revision: int = 0
    client_id: str = ""
    expected_item_version: str = ""
    library_id: str = ""
    category: str = ""

class PromptLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []

class PromptLibraryCategoryRequest(BaseModel):
    name: str = "新分组"
    library_id: str = ""

class PromptLibraryCategoryReorderRequest(BaseModel):
    library_id: str = ""
    category_ids: List[str] = []

# --- 负载均衡 ---

def check_images_exist(backend_addr, images):
    if not images: return True
    for img in images:
        try:
            url = f"http://{backend_addr}/view?filename={urllib.parse.quote(img)}&type=input"
            r = requests.get(url, stream=True, timeout=0.5)
            r.close()
            if r.status_code != 200: return False
        except: return False
    return True

MEDIA_INPUT_KEYS = ("image", "video", "audio", "mask", "filename", "file")
MEDIA_INPUT_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)", re.I)


# --- 辅助工具 ---


# 纯预览/对比类节点：其输出只用于界面展示（PreviewImage、rgthree 的 Image Comparer 等），
# 工作流里通常还有 SaveImage 产出真正结果，故有正式产出时应丢弃这些冗余预览/对比图。
COMFY_PREVIEW_CLASS_HINTS = ("previewimage", "comparer", "imagecompare", "image compare")
# show/utility 类调试文本节点：ShowText、各种 *Anything、CR Text、MathExpression、note 等，
# 它们的 ui 文本基本是调试信息，不应混进最终结果。
COMFY_DEBUG_TEXT_CLASS_HINTS = (
    "showtext", "show text", "showanything", "show any", "preview any", "previewany",
    "displaytext", "display text", "display any", "anything everywhere", "convertanything",
    "easy show", "note", "mathexpression", "cr text", "text multiline", "string function",
    "debug",
)


def now_ms():
    return int(time.time() * 1000)


WORKSPACE_STORAGE_COMPOSITION = (
    compose_workspace_storage(
        current_workspace_content(),
        workspace_id=current_workspace_id(),
    )
    if WORKSPACE_CONFIGURED
    else None
)

CANVAS_SYNC = CanvasSync(
    content=current_workspace_content,
    now_ms=now_ms,
    file_lock=CANVAS_LOCK,
    notifier=manager,
    administration=AUTH_SYSTEM,
    workspace_id=current_workspace_id,
    initial_admin=AUTH_SYSTEM.first_admin,
    user_by_id=lambda user_id: enrich_current_workspace_user(
        AUTH_SYSTEM.get_user(user_id)
    ),
    recovery_directory=recovery_copy_directory,
    canvas_store=(
        lambda: WORKSPACE_STORAGE_COMPOSITION.canvas_store
        if WORKSPACE_STORAGE_COMPOSITION is not None
        else None
    )
    if (
        WORKSPACE_STORAGE_COMPOSITION is not None
        and WORKSPACE_STORAGE_COMPOSITION.sqlite_ready
    )
    else None,
    realtime_presence=PRESENCE_MANAGER,
)
def raise_canvas_sync_http(error: CanvasSyncError):
    raise HTTPException(
        status_code=error.status_code,
        detail=error.detail,
    ) from error


async def submit_canvas_http(command: CanvasCommand, actor):
    try:
        return await CANVAS_SYNC.submit(command, actor)
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)


def canvas_request_values(payload: BaseModel) -> Dict[str, Any]:
    model_dump = getattr(payload, "model_dump", None)
    return model_dump() if callable(model_dump) else payload.dict()


# ===== 项目（按项目分类管理画布）=====

def project_index_file() -> str:
    return str(current_workspace_content().projects)


def load_projects():
    try:
        with open(project_index_file(), 'r', encoding='utf-8') as f:
            data = json.load(f)
        projects = data.get("projects") if isinstance(data, dict) else data
        if isinstance(projects, list):
            return [p for p in projects if isinstance(p, dict) and p.get("id")]
    except Exception:
        pass
    return []

def save_projects(projects):
    with CANVAS_LOCK:
        with open(project_index_file(), 'w', encoding='utf-8') as f:
            json.dump({"projects": projects}, f, ensure_ascii=False, indent=2)

def project_record(p):
    return {
        "id": p.get("id"),
        "name": (p.get("name") or "未命名项目")[:60],
        "order": int(p.get("order") or 0),
        "created_at": p.get("created_at", 0),
        "updated_at": p.get("updated_at", 0),
    }

def ensure_default_project():
    """保证存在一个“默认项目”，并把没有归属项目的画布迁移进去（一次性、幂等）。"""
    projects = load_projects()
    changed = False
    if not any(p.get("id") == DEFAULT_PROJECT_ID for p in projects):
        ts = now_ms()
        projects.insert(0, {"id": DEFAULT_PROJECT_ID, "name": "默认项目", "order": 0, "created_at": ts, "updated_at": ts})
        changed = True
    if changed:
        save_projects(projects)
    return projects

def new_project(name="新项目"):
    projects = ensure_default_project()
    ts = now_ms()
    clean = (str(name or "").strip() or "新项目")[:60]
    order = max([int(p.get("order") or 0) for p in projects], default=0) + 1
    proj = {"id": uuid.uuid4().hex, "name": clean, "order": order, "created_at": ts, "updated_at": ts}
    projects.append(proj)
    save_projects(projects)
    return proj

def list_projects(*, with_status=False):
    projects = ensure_default_project()
    counts = {}
    actor = require_current_user("admin", "designer")
    page = CANVAS_LIST_INDEX.list_records(actor, parse_budget=50)
    for rec in page.records:
        pid = rec.get("project") or DEFAULT_PROJECT_ID
        counts[pid] = counts.get(pid, 0) + 1
    out = []
    for p in sorted(projects, key=lambda x: (int(x.get("order") or 0), x.get("created_at") or 0)):
        rec = project_record(p)
        if not can_access_project(actor, rec["id"]):
            continue
        rec["canvas_count"] = counts.get(rec["id"], 0)
        out.append(rec)
    return (out, page.rebuilding, page.index_error) if with_status else out

def migrate_all_canvas_access():
    CANVAS_SYNC.migrate_all_access()

def load_canvas(canvas_id, write=False):
    actor = require_current_user("admin", "designer")
    try:
        return CANVAS_SYNC.read(canvas_id, actor, write=write)
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)

def load_shared_canvas(share):
    try:
        return CANVAS_SYNC.read_shared(share)
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)

def canvas_cover_record(data):
    explicit = data.get("cover_image") if isinstance(data.get("cover_image"), dict) else {}
    explicit_url = normalize_canvas_cover_url(explicit.get("url"))
    if explicit_url:
        try:
            explicit_index = max(0, int(explicit.get("image_index") or 0))
        except (TypeError, ValueError):
            explicit_index = 0
        return {
            "url": explicit_url,
            "custom": True,
            "node_id": str(explicit.get("node_id") or ""),
            "image_index": explicit_index,
        }
    nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        images = node.get("images") if isinstance(node.get("images"), list) else []
        for image_index, raw in enumerate(images):
            cover_url = normalize_canvas_cover_url(canvas_asset_url_value(raw))
            if cover_url and canvas_asset_kind(raw, cover_url) == "image":
                return {
                    "url": cover_url,
                    "custom": False,
                    "node_id": str(node.get("id") or f"node_{node_index}"),
                    "image_index": image_index,
                }
        for _field_path, raw, url in iter_canvas_asset_values(node):
            cover_url = normalize_canvas_cover_url(url)
            if not cover_url or canvas_asset_kind(raw, cover_url) != "image":
                continue
            return {
                "url": cover_url,
                "custom": False,
                "node_id": str(node.get("id") or f"node_{node_index}"),
                "image_index": 0,
            }
    return {"url": "", "custom": False, "node_id": "", "image_index": 0}

def canvas_record(data):
    cover = canvas_cover_record(data)
    return {
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": normalize_canvas_kind(data.get("kind")),
        "owner_id": str(data.get("owner_id") or ""),
        "owner_username": str(data.get("owner_username") or ""),
        "visibility": data.get("visibility") if data.get("visibility") in {"shared", "private"} else "shared",
        "created_by": str(data.get("created_by") or ""),
        "updated_by": str(data.get("updated_by") or ""),
        "owner": str(data.get("owner") or "")[:40],
        "color": normalize_canvas_color(data.get("color")),
        "pinned": bool(data.get("pinned") or False),
        "project": str(data.get("project") or "").strip() or DEFAULT_PROJECT_ID,
        "board_x": data.get("board_x"),
        "board_y": data.get("board_y"),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "revision": max(0, int(data.get("revision") or 0)),
        "deleted_at": data.get("deleted_at", 0),
        "node_count": len(data.get("nodes", [])),
        "cover_url": cover["url"],
        "cover_custom": cover["custom"],
        "cover_node_id": cover["node_id"],
        "cover_image_index": cover["image_index"],
    }

CANVAS_LIST_INDEX = CanvasListIndex(
    lambda: Path(current_workspace_content().smart_canvases),
    index_file=lambda: DEVICE_CACHE.canvas_list_index(
        WORKSPACE_SERVICE.identity()
        or f"directory:{WORKSPACE_SERVICE.current().directory}"
    ),
    document_loader=lambda path: CANVAS_SYNC.read_list_document(path.stem),
    record_loader=lambda actor: CANVAS_SYNC.list_index_records(actor),
    record_builder=canvas_record,
)

def iter_canvas_records(include_deleted=False):
    actor = current_user()
    return [
        canvas_record(canvas)
        for canvas in CANVAS_SYNC.list_documents(
            actor,
            deleted=bool(include_deleted),
            trash_retention_ms=CANVAS_TRASH_RETENTION_MS,
        )
    ]

def list_canvas_page(*, project="", cursor="", limit=0, deleted=False):
    actor = require_current_user("admin", "designer")
    return CANVAS_LIST_INDEX.list_records(
        actor,
        project=str(project or "").strip(),
        deleted=bool(deleted),
        cursor=str(cursor or ""),
        limit=int(limit or 0),
    )

def list_canvases(*, project="", cursor="", limit=0):
    return list_canvas_page(project=project, cursor=cursor, limit=limit).records

def list_deleted_canvases():
    actor = require_current_user("admin", "designer")
    # Trash is loaded after first paint; preserve the existing retention cleanup
    # without putting full-document reads back on the main canvas-list path.
    CANVAS_SYNC.list_documents(
        actor,
        deleted=True,
        trash_retention_ms=CANVAS_TRASH_RETENTION_MS,
    )
    return CANVAS_LIST_INDEX.list_records(actor, deleted=True).records

def canvas_asset_url_value(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "path", "src", "uri", "output", "output_url", "outputUrl", "video", "video_url", "videoUrl"):
            text = str(value.get(key) or "").strip()
            if text:
                return text
    return ""

def canvas_asset_downloadable_url(url):
    text = str(url or "").strip()
    return text if text.startswith(("/assets/", "http://", "https://")) else ""

def canvas_asset_kind(value, url=""):
    explicit = ""
    if isinstance(value, dict):
        explicit = str(value.get("kind") or value.get("mediaKind") or value.get("type") or "").lower()
    if "video" in explicit:
        return "video"
    if "audio" in explicit:
        return "audio"
    if "text" in explicit:
        return "text"
    if "workflow" in explicit:
        return "workflow"
    media_url = str(url or canvas_asset_url_value(value)).lower().split("?", 1)[0]
    extension = os.path.splitext(media_url)[1]
    if extension in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv"}:
        return "video"
    if extension in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}:
        return "audio"
    return "image"

def canvas_asset_name(value, url="", fallback="asset"):
    if isinstance(value, dict):
        for key in ("name", "filename", "file", "title"):
            name = str(value.get(key) or "").strip()
            if name:
                return sanitize_asset_name(name, fallback)
    return sanitize_asset_name(filename_from_media_url(url, fallback), fallback)

def iter_canvas_asset_values(value, path=""):
    if isinstance(value, dict):
        url = canvas_asset_downloadable_url(canvas_asset_url_value(value))
        if url:
            yield path, value, url
        for key, child in value.items():
            if key in {"run", "runs", "settings", "params", "metadata", "meta", "prompt", "text", "caption", "logs"}:
                continue
            yield from iter_canvas_asset_values(child, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_canvas_asset_values(child, f"{path}[{index}]")
    elif isinstance(value, str):
        url = canvas_asset_downloadable_url(value)
        if url:
            yield path, value, url


def workspace_asset_candidate(
    item: WorkspaceAssetPublishItem,
) -> AssetPublicationCandidate:
    canvas_id = str(item.canvas_id or "").strip()
    node_id = str(item.node_id or "").strip()
    if not canvas_id or not node_id:
        raise AssetLibraryError(
            "invalid_source", "无法添加到资产库：缺少画布或节点来源"
        )
    canvas = load_canvas(canvas_id)
    if normalize_canvas_kind(canvas.get("kind")) != "smart":
        raise AssetLibraryError(
            "classic_canvas_unsupported", "只能将智能画布中的图片添加到资产库"
        )
    node = next(
        (
            candidate
            for candidate in (canvas.get("nodes") or [])
            if isinstance(candidate, dict)
            and str(candidate.get("id") or "") == node_id
        ),
        None,
    )
    if node is None:
        raise AssetLibraryError(
            "source_deleted", "来源节点不存在；本次没有添加任何图片", status_code=409
        )
    requested_url = str(item.url or "").strip()
    media_values = []
    seen_urls = set()
    for _path, value, url in iter_canvas_asset_values(node):
        if url in seen_urls or canvas_asset_kind(value, url) != "image":
            continue
        seen_urls.add(url)
        media_values.append((value, url))
    if requested_url:
        media_values = [pair for pair in media_values if pair[1] == requested_url]
    if not media_values:
        raise AssetLibraryError(
            "image_unavailable", "所选内容中没有可添加到资产库的图片"
        )
    value, url = media_values[0]
    path = output_file_from_url(url)
    if not path:
        raise AssetLibraryError(
            "image_unavailable", "图片尚未准备完成，暂时无法添加到资产库"
        )
    try:
        with Image.open(path) as image:
            image.verify()
    except (OSError, ValueError) as exc:
        raise AssetLibraryError(
            "image_unavailable", "图片无法读取；本次没有添加任何图片"
        ) from exc
    return AssetPublicationCandidate.from_file(
        Path(path),
        media_url=url,
        name=(
            str(item.name or "").strip()
            or canvas_asset_name(value, url, "未命名图片")
            or "未命名图片"
        ),
        project_id=canvas.get("project") or DEFAULT_PROJECT_ID,
        canvas_id=canvas_id,
        node_id=node_id,
    )

def canvas_node_title(node):
    if not isinstance(node, dict):
        return ""
    return str(node.get("title") or node.get("name") or node.get("label") or node.get("type") or "节点")[:120]

IMAGE_OUTPUT_KEY_HINTS = (
    "url", "image_url", "imageUrl", "image", "output_url", "outputUrl",
    "result_url", "resultUrl", "download_url", "downloadUrl", "asset_url", "assetUrl",
)
IMAGE_CONTAINER_KEY_HINTS = (
    "images", "image", "output", "outputs", "result", "results", "data", "items", "files",
)
IMAGE_BASE64_KEY_HINTS = ("b64_json", "base64", "image_base64", "imageBase64")


RESPONSES_REJECT_STATUSES = {400, 404, 405, 415, 422}
RESPONSES_POLL_INTERVAL = 5.0
RESPONSES_POLL_MAX_SECONDS = 1500.0


# 单模型可覆盖的协议（仅 OpenAI / Gemini，二者可共用同一站点的 Base URL + Key）
PER_MODEL_PROTOCOL_OPTIONS = {"openai", "gemini"}
# 协议固定、不支持单模型覆盖的内置平台
FIXED_PROTOCOL_PROVIDER_IDS = {"modelscope", "volcengine", "jimeng", "runninghub"}


# ---- 数字人/真人认证：平台无关分发 ----
# 认证是一个跨平台功能。每个平台用不同的资产 API 实现，但对外是统一入口。
# 新增平台时：在 avatar_platform_for_provider 里加一条识别，并把平台键加进
# AVATAR_SUPPORTED_PLATFORMS，再在 register/avatar-status 端点里补一个分发分支即可。
AVATAR_SUPPORTED_PLATFORMS = {"apimart", "volcengine"}  # 已接入官方资产 API 的平台


JIMENG_WSL_DETECTION = {"expires_at": 0.0, "available": False}


# 旧版 dreamina CLI 将 submit_id 用 16 位 hex，v1.4.2 起升级为 UUID，
# 与当前轮询逻辑不兼容。这里做尽力而为的版本探测，失败不阻断主流程。
JIMENG_MIN_CLI_VERSION = (1, 4, 2)


class JimengPendingError(Exception):
    """即梦任务还在云端排队/生成（轮询超时但未失败）。submit_id 可用于后续续查。"""
    def __init__(self, submit_id, kind="image", queue_info=None, raw=None):
        self.submit_id = str(submit_id or "")
        self.kind = kind or "image"
        self.queue_info = queue_info if isinstance(queue_info, dict) else {}
        self.raw = raw
        super().__init__(f"jimeng pending submit_id={self.submit_id}")


@app.exception_handler(JimengPendingError)
async def jimeng_pending_exception_handler(request: Request, exc: JimengPendingError):
    # 轮询超时但任务还在云端排队：返回 202 + submit_id，让前端保持「排队中」卡片并续查
    payload = jimeng_pending_payload(exc)
    actor = current_user() or {}
    payload["actor_id"] = str(actor.get("id") or "")
    return JSONResponse(status_code=202, content=payload)


JIMENG_RATIO_CHOICES = [(21, 9), (16, 9), (3, 2), (4, 3), (1, 1), (3, 4), (2, 3), (9, 16)]

# 官方 dreamina 支持的图片模型（来自 text2image/image2image -h）。
# image2image 不支持 3.0/3.1。
JIMENG_TEXT2IMAGE_MODELS = {
    "3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro",
}
JIMENG_IMAGE2IMAGE_MODELS = {
    "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro",
}


# 当前 CLI 仅 seedance2.0_vip 支持高于 720P 的视频输出。
JIMENG_VIDEO_1080P_MODELS = {"seedance2.0_vip"}


# 时长由 CLI 模型规则收敛：1.x、2.0、2.5 与旧 3.x 系列各自处理。


IMAGE_TASK_SUCCESS_STATUSES = {"SUCCESS", "SUCCESSFUL", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED", "OK", "READY"}
IMAGE_TASK_FAILED_STATUSES = {"FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "TIMEOUT", "REJECTED", "EXPIRED"}


def output_storage(category="output"):
    if category == "input":
        return generation_input_directory(), "input"
    return generation_output_directory(), "output"

def output_url_for(filename, category="output"):
    folder, subdir = output_storage(category)
    rel = str(filename or "").replace("\\", "/").lstrip("/")
    try:
        asset_rel = os.path.relpath(
            os.path.join(folder, rel),
            managed_media_directory(),
        ).replace("\\", "/")
        if not asset_rel.startswith("../") and asset_rel != "..":
            return f"/assets/{urllib.parse.quote(asset_rel, safe='/')}"
    except Exception:
        pass
    kind = "upload" if category == "input" else "generated"
    return f"/api/storage-files/{kind}/{urllib.parse.quote(rel, safe='/')}"

def output_path_for(filename, category="output"):
    folder, _ = output_storage(category)
    return os.path.join(folder, filename)

def storage_kind_dir(kind):
    kind = str(kind or "").strip().lower()
    if kind == "upload":
        return os.path.abspath(generation_input_directory())
    if kind == "generated":
        return os.path.abspath(generation_output_directory())
    if kind == "local":
        return os.path.abspath(local_upload_directory())
    raise HTTPException(status_code=404, detail="未知存储目录")

def storage_file_path(kind, rel):
    root = storage_kind_dir(kind)
    rel_path = str(rel or "").replace("\\", "/").lstrip("/")
    rel_path = os.path.normpath(rel_path).replace("\\", "/")
    if not rel_path or rel_path == "." or rel_path == ".." or rel_path.startswith("../") or os.path.isabs(rel_path):
        raise HTTPException(status_code=400, detail="非法文件路径")
    path = os.path.abspath(os.path.join(root, rel_path))
    try:
        if os.path.commonpath([root, path]) != root:
            raise HTTPException(status_code=400, detail="非法文件路径")
    except ValueError:
        raise HTTPException(status_code=400, detail="非法文件路径")
    return path if os.path.exists(path) else None

def output_file_from_url(url):
    if isinstance(url, dict):
        url = url.get("url", "")
    if not url:
        return None
    clean = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/api/storage-files/"):
        rest = clean[len("/api/storage-files/"):].lstrip("/")
        kind, _, rel = rest.partition("/")
        return storage_file_path(kind, rel) if kind and rel else None
    if not clean.startswith("/assets/"):
        return None
    root = managed_media_directory()
    rel = clean[len("/assets/"):]
    rel = rel.lstrip("/")
    if not rel:
        return None
    path = os.path.abspath(os.path.join(root, rel))
    output_root = os.path.abspath(root)
    return (
        path
        if os.path.commonpath([output_root, path]) == output_root
        and os.path.exists(path)
        else None
    )


async def materialize_generation_image(
    source_url: str,
    *,
    target_aspect_ratio: str,
    stable_id: str,
) -> str:
    source_path = output_file_from_url(source_url)
    if not source_path:
        raise GenerationRunError("Provider Source Image 文件不可用")
    safe_id = re.sub(r"[^a-zA-Z0-9._-]+", "_", stable_id).strip("._")
    suffix = Path(source_path).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    filename = f"materialized_{safe_id or uuid.uuid4().hex}{suffix}"
    destination = output_path_for(filename, "output")
    result = await asyncio.to_thread(
        materialize_image_cover,
        source_path,
        target_aspect_ratio,
        destination,
    )
    if not result.cropped:
        return source_url
    return output_url_for(filename, "output")

def image_has_alpha(img: Image.Image) -> bool:
    if img.mode in ("RGBA", "LA"):
        return True
    if img.mode == "P":
        return "transparency" in img.info
    return False

def _get_matting_engine():
    global MATTING_ENGINE
    if MATTING_ENGINE is None:
        model_dir = os.getenv("MATTING_MODEL_DIR") or os.path.join(
            model_cache_directory(),
            "matting",
        )
        MATTING_ENGINE = BiRefNetMattingEngine(model_dir=model_dir)
    return MATTING_ENGINE

def _matting_cache_key(source_path):
    stat = os.stat(source_path)
    identity = "|".join(
        (
            os.path.abspath(source_path),
            str(stat.st_size),
            str(stat.st_mtime_ns),
            str(os.getenv("MATTING_MODEL", "birefnet-general")),
            str(os.getenv("MATTING_REFINE_MAX_PIXELS", "1500000")),
        )
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]

def run_matting_job_sync(source_path):
    engine = _get_matting_engine()
    cache_key = _matting_cache_key(source_path)
    filename = f"matting_{cache_key}.png"
    output_path = output_path_for(filename, "output")
    if os.path.isfile(output_path):
        try:
            with Image.open(output_path) as cached:
                cached.verify()
            return {
                "output_url": output_url_for(filename, "output"),
                "output_name": filename,
                "width": 0,
                "height": 0,
                "model": engine.spec.name,
                "cached": True,
            }
        except Exception:
            try:
                os.unlink(output_path)
            except OSError:
                pass
    result = engine.remove_background(source_path, output_path)
    return {
        **result,
        "output_url": output_url_for(filename, "output"),
        "output_name": filename,
        "cached": False,
    }

def _matting_queue_position(job_id):
    queued = sorted(
        (
            job for job in MATTING_JOBS.values()
            if job.get("status") == "queued"
        ),
        key=lambda item: int(item.get("submitted_at") or 0),
    )
    return next(
        (index for index, job in enumerate(queued, start=1) if job.get("job_id") == job_id),
        0,
    )

def public_matting_job(job):
    status = str(job.get("status") or "queued")
    position = _matting_queue_position(job.get("job_id")) if status == "queued" else 0
    queue_length = sum(1 for item in MATTING_JOBS.values() if item.get("status") == "queued")
    message = str(job.get("message") or "")
    if status == "queued":
        message = f"排队等待中（前方 {max(0, position - 1)} 个任务）"
    elif status == "running" and not message:
        message = "正在抠图"
    payload = {
        "job_id": job.get("job_id"),
        "status": status,
        "position": position,
        "queue_length": queue_length,
        "message": message,
        "submitted_at": int(job.get("submitted_at") or 0),
        "started_at": int(job.get("started_at") or 0),
        "finished_at": int(job.get("finished_at") or 0),
    }
    for key in (
        "output_url",
        "output_name",
        "model",
        "width",
        "height",
        "cached",
        "error",
    ):
        if job.get(key) not in (None, ""):
            payload[key] = job.get(key)
    return payload

def _prune_matting_jobs():
    cutoff = now_ms() - (24 * 60 * 60 * 1000)
    terminal = sorted(
        (
            job for job in MATTING_JOBS.values()
            if job.get("status") in {"succeeded", "failed"}
        ),
        key=lambda item: int(item.get("finished_at") or 0),
    )
    remove_ids = {
        job["job_id"] for job in terminal
        if int(job.get("finished_at") or 0) < cutoff
    }
    if len(terminal) - len(remove_ids) > 500:
        survivors = [job for job in terminal if job["job_id"] not in remove_ids]
        remove_ids.update(job["job_id"] for job in survivors[:len(survivors) - 500])
    for job_id in remove_ids:
        MATTING_JOBS.pop(job_id, None)

async def _matting_worker():
    while True:
        job_id = await MATTING_QUEUE.get()
        job = MATTING_JOBS.get(job_id)
        try:
            if not job or job.get("status") != "queued":
                continue
            job["status"] = "running"
            job["started_at"] = now_ms()
            engine = _get_matting_engine()
            job["message"] = (
                "首次使用：正在下载并加载 BiRefNet 模型"
                if not engine.model_ready()
                else "正在执行 BiRefNet + Alpha Matting"
            )
            result = await asyncio.to_thread(run_matting_job_sync, job["source_path"])
            job.update(result)
            job["status"] = "succeeded"
            job["message"] = "抠图完成"
        except asyncio.CancelledError:
            if job and job.get("status") == "running":
                job["status"] = "failed"
                job["error"] = "服务已停止，请重新提交抠图"
            raise
        except (MattingDependencyError, MattingModelError, ValueError) as exc:
            if job:
                job["status"] = "failed"
                job["error"] = str(exc)[:500]
                job["message"] = "抠图失败"
        except Exception as exc:
            traceback.print_exc()
            if job:
                job["status"] = "failed"
                job["error"] = f"本地抠图失败：{exc}"[:500]
                job["message"] = "抠图失败"
        finally:
            if job and job.get("status") in {"succeeded", "failed"}:
                job["finished_at"] = now_ms()
            MATTING_QUEUE.task_done()
            _prune_matting_jobs()

async def ensure_matting_workers():
    global MATTING_QUEUE, MATTING_WORKER_TASKS, MATTING_RUNTIME_LOOP
    loop = asyncio.get_running_loop()
    if MATTING_RUNTIME_LOOP is not loop:
        if MATTING_RUNTIME_LOOP is not None:
            for job in MATTING_JOBS.values():
                if job.get("status") in {"queued", "running"}:
                    job["status"] = "failed"
                    job["error"] = "抠图服务已重启，请重新提交"
                    job["message"] = "抠图失败"
                    job["finished_at"] = now_ms()
        MATTING_RUNTIME_LOOP = loop
        MATTING_QUEUE = asyncio.Queue(maxsize=MATTING_QUEUE_MAX)
        MATTING_WORKER_TASKS = []
    MATTING_WORKER_TASKS = [
        task for task in MATTING_WORKER_TASKS if not task.done()
    ]
    for worker_number in range(
        len(MATTING_WORKER_TASKS) + 1,
        MATTING_MAX_CONCURRENCY + 1,
    ):
        MATTING_WORKER_TASKS.append(
            asyncio.create_task(
                _matting_worker(),
                name=f"infinite-canvas-matting-worker-{worker_number}",
            )
        )
    return MATTING_QUEUE

STORAGE_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
STORAGE_MEDIA_EXTS = STORAGE_IMAGE_EXTS | {
    ".mp4",
    ".webm",
    ".mov",
    ".m4v",
    ".flv",
    ".avi",
    ".mkv",
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".ogg",
    ".flac",
    ".pdf",
    ".txt",
    ".md",
    ".csv",
    ".json",
}

def storage_file_item(kind, root, path):
    rel = os.path.relpath(path, root).replace("\\", "/")
    try:
        stat = os.stat(path)
    except OSError:
        return None
    item = {
        "id": f"{kind}:{rel}",
        "kind": kind,
        "rel": rel,
        "name": os.path.basename(path),
        "folder": os.path.dirname(rel).replace("\\", "/"),
        "url": f"/api/storage-files/{kind}/{urllib.parse.quote(rel, safe='/')}",
        "size": stat.st_size,
        "created_at": stat.st_mtime,
    }
    extension = os.path.splitext(path)[1].lower()
    item["media_kind"] = (
        "image"
        if extension in STORAGE_IMAGE_EXTS
        else (
            "video"
            if extension in {
                ".mp4",
                ".webm",
                ".mov",
                ".m4v",
                ".flv",
                ".avi",
                ".mkv",
            }
            else (
                "audio"
                if extension
                in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
                else "file"
            )
        )
    )
    try:
        with Image.open(path) as img:
            item["width"], item["height"] = img.size
    except Exception:
        pass
    return item

class WorkspaceStorageSettingsPayload(BaseModel):
    workspace_directory: str = ""
    parent_dir: str = ""
    migrate: bool = False

    def selected_directory(self) -> str:
        return self.workspace_directory or self.parent_dir


class WorkspaceInspectionPayload(BaseModel):
    workspace_directory: str
    intent: str


class WorkspaceOpenPayload(BaseModel):
    workspace_directory: str
    cancel_active: bool = False


class WorkspaceMovePlanPayload(BaseModel):
    workspace_directory: str


class WorkspaceMoveStartPayload(BaseModel):
    workspace_directory: str
    cancel_active: bool = False
    return_url: str = "/"


def _require_local_workspace_management(
    request: Request,
) -> Dict[str, Any]:
    actor = require_current_user("admin")
    client_host = str(
        request.client.host if request.client is not None else ""
    ).strip().lower()
    if client_host in {"localhost", "testclient"}:
        return actor
    try:
        if ipaddress.ip_address(client_host).is_loopback:
            return actor
    except ValueError:
        pass
    raise HTTPException(
        status_code=403,
        detail="请在运行 Reroll 服务的电脑上选择工作区目录",
    )


def _workspace_storage_response(paths=None, **extra):
    paths = paths or WORKSPACE_STORAGE.paths()
    return {
        "active": WORKSPACE_SERVICE.current().public(),
        "configured": Workspace.from_paths(paths).public(),
        **extra,
    }


@app.get("/api/workspace-storage-settings")
async def get_workspace_storage_settings(request: Request):
    require_current_user("admin")
    return _workspace_storage_response(restart_required=False)


@app.post("/api/workspace-storage-settings/select-directory")
async def select_workspace_storage_parent(request: Request):
    _require_local_workspace_management(request)
    try:
        selected = await asyncio.to_thread(choose_workspace_parent_directory)
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not selected:
        raise HTTPException(status_code=400, detail="未选择目录")
    return {"workspace_directory": selected}


@app.post("/api/workspace-storage-settings/inspect")
async def inspect_workspace_storage_selection(
    payload: WorkspaceInspectionPayload,
    request: Request,
):
    _require_local_workspace_management(request)
    try:
        summary = await asyncio.to_thread(
            WORKSPACE_SERVICE.summarize,
            payload.workspace_directory,
            intent=payload.intent,
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return summary.public()


@app.post("/api/workspace-storage-settings/open")
async def open_workspace_storage_selection(
    payload: WorkspaceOpenPayload,
    request: Request,
):
    actor = _require_local_workspace_management(request)
    restart_requester = _RUNTIME_ASYNC_RESTART_REQUESTER
    if restart_requester is None:
        raise HTTPException(
            status_code=503,
            detail="当前无法安全重启，请从统一启动入口运行 Reroll 后重试",
        )
    try:
        staged = await asyncio.to_thread(
            stage_workspace_open,
            payload.workspace_directory,
            actor_id=actor["id"],
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        runtime_result = await restart_requester(
            cancel_active=payload.cancel_active
        )
        runtime_status = (
            runtime_result.public()
            if callable(getattr(runtime_result, "public", None))
            else dict(runtime_result or {})
        )
    except WorkspaceStorageError as exc:
        cancel_pending_workspace_open()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        cancel_pending_workspace_open()
        raise HTTPException(
            status_code=500,
            detail="无法开始安全打开工作区，当前工作区继续可用",
        ) from exc

    stage = str(runtime_status.get("stage") or "")
    if stage not in {"restart_waiting", "stopping"}:
        cancel_pending_workspace_open()
        raise HTTPException(
            status_code=409,
            detail=(
                str(runtime_status.get("message") or "").strip()
                or "无法开始安全打开工作区，当前工作区继续可用"
            ),
        )
    return {
        **runtime_status,
        **staged,
        "next_step": "continue",
    }


@app.post("/api/workspace-storage-settings/plan-move")
async def plan_workspace_storage_move(
    payload: WorkspaceMovePlanPayload,
    request: Request,
):
    _require_local_workspace_management(request)
    try:
        plan = await asyncio.to_thread(
            WORKSPACE_SERVICE.plan_move,
            payload.workspace_directory,
            active_generation_tasks=active_generation_run_count(),
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return plan.public()


async def _run_workspace_move_restart(*, cancel_active: bool) -> None:
    requester = _RUNTIME_ASYNC_RESTART_REQUESTER
    if requester is None:
        fail_pending_workspace_move(
            "当前无法安全重启，工作区搬家尚未开始。"
        )
        return
    try:
        result = await requester(cancel_active=cancel_active)
        runtime_status = (
            result.public()
            if callable(getattr(result, "public", None))
            else dict(result or {})
        )
        stage = str(runtime_status.get("stage") or "")
        if stage == "restart_waiting":
            blocking = max(
                0,
                int(
                    runtime_status.get("blocking_generation_runs")
                    or 0
                ),
            )
            update_workspace_move_status(
                stage="waiting_for_generation_tasks",
                message=f"正在等待 {blocking} 个生成任务完成…",
                blocking_generation_tasks=blocking,
            )
        elif stage not in {"maintenance", "stopping"}:
            current = workspace_move_status()
            if current.get("stage") != "failed":
                fail_pending_workspace_move(
                    str(runtime_status.get("message") or "").strip()
                    or "无法开始安全搬家，当前工作区继续可用。"
                )
    except asyncio.CancelledError:
        raise
    except Exception:
        fail_pending_workspace_move(
            "无法开始安全搬家，当前工作区继续可用。"
        )


@app.post("/api/workspace-storage-settings/move")
async def start_workspace_storage_move(
    payload: WorkspaceMoveStartPayload,
    request: Request,
):
    global WORKSPACE_MOVE_RUNTIME_TASK
    actor = _require_local_workspace_management(request)
    if _RUNTIME_ASYNC_RESTART_REQUESTER is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "当前无法安全重启，请从统一启动入口运行 "
                "Reroll 后重试"
            ),
        )
    try:
        staged = stage_workspace_move(
            payload.workspace_directory,
            actor_id=actor["id"],
            return_url=payload.return_url,
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not staged.get("existing_operation"):
        WORKSPACE_MOVE_RUNTIME_TASK = asyncio.create_task(
            _run_workspace_move_restart(
                cancel_active=payload.cancel_active,
            ),
            name="infinite-canvas-workspace-move",
        )
        await asyncio.sleep(0)
    return {
        **staged,
    }


@app.put("/api/workspace-storage-settings")
async def update_workspace_storage_settings(
    payload: WorkspaceStorageSettingsPayload,
    request: Request,
):
    _require_local_workspace_management(request)
    raise HTTPException(
        status_code=409,
        detail=(
            "请使用“搬家到新位置”查看摘要并确认，"
            "工作区不会在后台直接切换"
        ),
    )


@app.get("/api/storage-files")
async def list_storage_files(kind: str = "generated", offset: int = 0, limit: int = 80):
    root = storage_kind_dir(kind)
    os.makedirs(root, exist_ok=True)
    offset = max(0, int(offset or 0))
    limit = max(20, min(200, int(limit or 80)))
    items = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".") and not d.startswith("._")], key=str.lower)
        for name in sorted(files, key=str.lower):
            if name.startswith(".") or name.startswith("._"):
                continue
            if os.path.splitext(name)[1].lower() not in STORAGE_MEDIA_EXTS:
                continue
            item = storage_file_item(kind, root, os.path.join(current, name))
            if item:
                items.append(item)
    items.sort(key=lambda item: item.get("created_at") or 0, reverse=True)
    total = len(items)
    page_items = items[offset:offset + limit]
    return {
        "kind": kind,
        "root": root,
        "items": page_items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(page_items) < total,
    }

@app.get("/api/storage-files/{kind}/{rel_path:path}")
async def get_storage_file(kind: str, rel_path: str):
    path = storage_file_path(kind, rel_path)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, media_type=content_type_for_path(path))

@app.post("/api/storage-files/delete")
async def delete_storage_files(payload: Dict[str, Any]):
    kind = str((payload or {}).get("kind") or "").strip()
    rels = [str(item or "").strip() for item in ((payload or {}).get("items") or []) if str(item or "").strip()]
    if not rels:
        raise HTTPException(status_code=400, detail="请选择要删除的文件")
    removed = 0
    for rel in rels:
        path = storage_file_path(kind, rel)
        if not path or not os.path.isfile(path):
            continue
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    return {"removed": removed}

def media_preview_cache_paths(path: str, width: int):
    stat = os.stat(path)
    key = hashlib.sha1(
        f"{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")
    ).hexdigest()
    preview_directory = media_preview_directory()
    return (
        os.path.join(preview_directory, f"{key}.webp"),
        os.path.join(preview_directory, f"{key}.png"),
    )


MEDIA_PREVIEW_BUILD_CONCURRENCY = 2
MEDIA_PREVIEW_BUILD_SEMAPHORE = BoundedSemaphore(MEDIA_PREVIEW_BUILD_CONCURRENCY)


def is_video_preview_file(path: str) -> bool:
    return os.path.splitext(str(path or "").split("?", 1)[0])[1].lower() in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}

def generate_video_preview_image(path: str, width: int) -> Image.Image:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，无法生成视频预览图")
    fd, frame_path = tempfile.mkstemp(prefix="media_preview_frame_", suffix=".jpg")
    os.close(fd)
    try:
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", "0.5",
            "-i", path,
            "-frames:v", "1",
            "-vf", f"scale='min({width},iw)':-2",
            frame_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0 or not os.path.exists(frame_path) or os.path.getsize(frame_path) <= 0:
            raise RuntimeError((proc.stderr or "ffmpeg 未能抽取视频首帧").strip()[:300])
        with Image.open(frame_path) as frame:
            img = ImageOps.exif_transpose(frame).copy()
            img.thumbnail((width, width), Image.LANCZOS)
            return img.convert("RGB")
    finally:
        try:
            os.remove(frame_path)
        except OSError:
            pass

async def media_preview_file_response(path: str, w: int = 512, *, headers=None):
    width = max(64, min(2048, int(w or 512)))
    webp_path, png_path = media_preview_cache_paths(path, width)

    if os.path.exists(webp_path):
        return FileResponse(webp_path, media_type="image/webp", headers=headers)
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png", headers=headers)

    def _build_preview():
        # 同步 PIL 处理 + 落盘，放到线程里执行，避免阻塞事件循环；同时限制冷缓存并发，
        # 防止几十张 2K/4K 图片同时解码，把列表页优化变成后端内存峰值。
        with MEDIA_PREVIEW_BUILD_SEMAPHORE:
            os.makedirs(media_preview_directory(), exist_ok=True)
            if os.path.exists(webp_path):
                return webp_path, "image/webp"
            if os.path.exists(png_path):
                return png_path, "image/png"
            if is_video_preview_file(path):
                img = generate_video_preview_image(path, width)
            else:
                with Image.open(path) as source:
                    img = ImageOps.exif_transpose(source)
                    img.thumbnail((width, width), Image.LANCZOS)
                    img = img.convert("RGBA" if image_has_alpha(img) else "RGB")
            try:
                img.save(webp_path, format="WEBP", quality=80, method=1)   # method=1 生成更快（缩略图不追求极致压缩）
                return webp_path, "image/webp"
            except Exception:
                img.save(png_path, format="PNG")
                return png_path, "image/png"

    try:
        out_path, media_type = await asyncio.to_thread(_build_preview)
        return FileResponse(out_path, media_type=media_type, headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=415, detail=f"无法生成预览图：{exc}") from exc


@app.get("/api/media-preview")
async def media_preview(url: str, w: int = 512):
    path = output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    return await media_preview_file_response(path, w)

@app.get("/api/image-jpeg")
async def image_jpeg(url: str, w: int = 0):
    """把任意图片转成 JPEG 返回（带缓存）。给不支持 WebP 等格式显示的客户端（PS UXP）用。
    w>0 时同时缩放到该宽度（缩略图）；w=0 输出原尺寸。"""
    path = output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    width = max(0, min(4096, int(w or 0)))
    stat = os.stat(path)
    key = hashlib.sha1(f"{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{width}|jpg".encode("utf-8", "ignore")).hexdigest()
    cache_path = os.path.join(
        media_preview_directory(),
        f"{key}.jpg",
    )
    if os.path.exists(cache_path):
        return FileResponse(cache_path, media_type="image/jpeg")

    def _build():
        os.makedirs(media_preview_directory(), exist_ok=True)
        with Image.open(path) as src:
            img = ImageOps.exif_transpose(src)
            if width:
                img.thumbnail((width, width), Image.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                rgba = img.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.save(cache_path, format="JPEG", quality=86)
        return cache_path

    try:
        out_path = await asyncio.to_thread(_build)
        return FileResponse(out_path, media_type="image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=415, detail=f"无法转换图片：{exc}") from exc

def local_media_file_by_basename(name: str):
    safe = os.path.basename(urllib.parse.unquote(str(name or "")))
    if not safe:
        return None
    roots = [
        generation_output_directory(),
        generation_input_directory(),
        os.path.join(managed_media_directory(), "output"),
        os.path.join(managed_media_directory(), "input"),
        os.path.join(managed_media_directory(), "library"),
    ]
    for root in roots:
        path = os.path.abspath(os.path.join(root, safe))
        root_abs = os.path.abspath(root)
        if os.path.commonpath([root_abs, path]) == root_abs and os.path.isfile(path):
            return path
    return None

def filename_from_media_url(url: str, fallback: str = "download.bin") -> str:
    path = urllib.parse.urlsplit(str(url or "")).path
    name = os.path.basename(urllib.parse.unquote(path))
    return sanitize_export_filename(name or fallback, fallback)

def fetch_remote_media_bytes(url: str, timeout: float = 30.0, max_bytes: int = 200 * 1024 * 1024):
    text = rewrite_runninghub_file_url(str(url or "").strip())
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    try:
        response_context = requests_get_public(
            text,
            stream=True,
            timeout=timeout,
            headers={"User-Agent": "ComfyUI-API-Modelscope/1.0"},
        )
    except OutboundUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with response_context as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type") or "application/octet-stream"
        chunks = []
        total = 0
        for chunk in response.iter_content(chunk_size=1024 * 256):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="文件太大，无法下载")
            chunks.append(chunk)
        return b"".join(chunks), content_type

def origin_from_url(value):
    parsed = urllib.parse.urlparse(str(value or ""))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".lower()

def ensure_same_origin_request(request: Request):
    host = str(request.headers.get("host") or "").lower()
    expected = f"{request.url.scheme}://{host}".lower() if host else ""
    origin = origin_from_url(request.headers.get("origin", ""))
    referer = origin_from_url(request.headers.get("referer", ""))
    actual = origin or referer
    if expected and actual != expected:
        raise HTTPException(status_code=403, detail="只允许从当前页面导入本地媒体")

def normalize_local_media_path(value):
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        raise HTTPException(status_code=400, detail="本地媒体路径为空")
    if text.lower().startswith("file:"):
        parsed = urllib.parse.urlparse(text)
        if parsed.scheme.lower() != "file":
            raise HTTPException(status_code=400, detail="只支持本地媒体路径")
        if parsed.netloc and re.match(r"^[a-zA-Z]:$", parsed.netloc) and os.name == "nt":
            path = f"{parsed.netloc}{urllib.request.url2pathname(parsed.path or '')}"
        elif parsed.netloc and parsed.netloc.lower() not in ("localhost",):
            raise HTTPException(status_code=400, detail="只支持本机媒体路径")
        else:
            path = urllib.request.url2pathname(parsed.path or "")
    else:
        path = text
    path = path.strip().strip('"').strip("'")
    if re.match(r"^/[a-zA-Z]:[\\/]", path):
        path = path[1:]
    if re.match(r"^[a-zA-Z]:[\\/]", path):
        return os.path.abspath(path)
    if path.startswith("/") and os.name != "nt":
        return os.path.abspath(path)
    raise HTTPException(status_code=400, detail="只支持本机绝对媒体路径")

def import_local_media_file(path):
    ext = os.path.splitext(path)[1].lower()
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="本地媒体不存在或无法读取")
    try:
        size = os.path.getsize(path)
    except OSError:
        raise HTTPException(status_code=404, detail="本地媒体不存在或无法读取")
    if size <= 0:
        raise HTTPException(status_code=400, detail="本地媒体为空")
    if size > LOCAL_IMAGE_IMPORT_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail="本地媒体过大，请使用 50MB 以内的文件",
        )
    if ext in LOCAL_IMAGE_IMPORT_EXTS:
        try:
            with Image.open(path) as img:
                img.verify()
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="文件不是可识别的图片",
            )
    try:
        return current_workspace_media(
            max_bytes=LOCAL_IMAGE_IMPORT_MAX_BYTES
        ).import_file(path).public()
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# Compatibility names for installed clients using the original image route.
normalize_local_image_path = normalize_local_media_path
import_local_image_file = import_local_media_file

def builtin_prompt_templates():
    try:
        template_path = prompt_template_markdown_path()
        if not template_path:
            return []
        with open(template_path, "r", encoding="utf-8") as f:
            return parse_prompt_template_markdown(f.read())
    except Exception as e:
        print(f"读取提示词模板失败: {e}")
        return []

def normalize_prompt_category_id(category="custom"):
    category_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(category or "custom"))[:40] or "custom"
    return "custom" if category_id in {"mine", "my", "personal"} else category_id

PROMPT_UNCATEGORIZED_CATEGORY_ID = "uncategorized"
PROMPT_UNCATEGORIZED_CATEGORY_NAME = "未分类"

def normalize_prompt_library_item(item):
    if not isinstance(item, dict):
        item = {}
    name = sanitize_asset_name(item.get("name") or "提示词", "提示词")
    positive = str(item.get("positive") or item.get("text") or "").strip()
    normalized = copy.deepcopy(item)
    normalized.update({
        "id": re.sub(r"[^A-Za-z0-9_-]+", "_", str(item.get("id") or item.get("item_id") or f"tpl_{uuid.uuid4().hex[:12]}"))[:60],
        "name": name,
        "category": normalize_prompt_category_id(item.get("category") or "custom"),
        "cover": str(item.get("cover") or "").strip()[:8000],
        "positive": positive,
        "negative": str(item.get("negative") or "").strip(),
        "params": item.get("params") if isinstance(item.get("params"), dict) else {},
        "created_at": int(item.get("created_at") or now_ms()),
        "updated_at": int(item.get("updated_at") or item.get("created_at") or now_ms()),
    })
    normalized.pop("item_id", None)
    normalized.pop("text", None)
    normalized.pop("scene", None)
    normalized.pop("scene_en", None)
    return normalized

def seed_system_prompt_library():
    return {
        "id": "system",
        "name": "系统提示词库",
        "type": "prompt",
        "items": builtin_prompt_templates(),
        "categories": defaultPromptTemplateCategories(),
    }

def default_prompt_libraries():
    return {
        "active_library_id": "system",
        "libraries": [seed_system_prompt_library()],
        "updated_at": now_ms(),
    }

def defaultPromptTemplateCategories():
    return [
        {"id": "view", "name": "视角"},
        {"id": "storyboard", "name": "分镜"},
        {"id": "character", "name": "角色"},
        {"id": "product", "name": "产品"},
        {"id": "lighting", "name": "光影"},
        {"id": "custom", "name": "我的"},
    ]

def normalize_prompt_template_categories(*category_lists, include_defaults=True):
    normalized = []
    seen = set()

    def add_category(category):
        if not isinstance(category, dict):
            return
        cat_id = normalize_prompt_category_id(category.get("id") or category.get("name") or "custom")
        if cat_id in seen:
            return
        seen.add(cat_id)
        # 不再强制把 custom 显示为“我的”，分组名以存储为准，这样内置分组也能被重命名。
        name = sanitize_asset_name(category.get("name") or cat_id, cat_id)
        normalized.append({"id": cat_id, "name": name})

    # 先采用已存储的分组（保留用户对内置分组的重命名/删除），
    # 只有在系统库一个分组都没有时才补齐默认内置分组（首次初始化）。
    for categories in category_lists:
        if isinstance(categories, list):
            for category in categories:
                add_category(category)
    if include_defaults and not normalized:
        for category in defaultPromptTemplateCategories():
            add_category(category)
    return normalized

def normalize_prompt_libraries(data):
    if not isinstance(data, dict):
        raise ValueError("提示词库根数据必须是对象")
    raw_libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    raw_libraries = [lib for lib in raw_libraries if isinstance(lib, dict)]
    libraries = []
    seen_lib_ids = set()
    for raw in raw_libraries:
        is_system = raw.get("id") == "system"
        if is_system:
            lib_id = "system"
        else:
            lib_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw.get("id") or f"lib_{uuid.uuid4().hex[:12]}"))[:60] or f"lib_{uuid.uuid4().hex[:12]}"
        if lib_id in seen_lib_ids:
            raise ValueError(f"提示词库存在重复 ID: {lib_id}")
        seen_lib_ids.add(lib_id)
        items = []
        seen_items = set()
        for raw_item in (raw.get("items") if isinstance(raw.get("items"), list) else []):
            if not isinstance(raw_item, dict):
                continue
            item = normalize_prompt_library_item(raw_item)
            item_id = item.get("id") or f"tpl_{uuid.uuid4().hex[:12]}"
            if item_id in seen_items:
                raise ValueError(f"提示词库 {lib_id} 存在重复模板 ID: {item_id}")
            seen_items.add(item_id)
            items.append(item)
        default_name = "通用" if is_system else "提示词库"
        raw_categories = raw.get("categories") if isinstance(raw.get("categories"), list) else []
        if not is_system:
            # 非系统库不保留任何内置分组（视角/分镜等），仅保留用户自建分组
            builtin_ids = {"view", "storyboard", "character", "product", "lighting", "custom"}
            raw_categories = [c for c in raw_categories if isinstance(c, dict) and normalize_prompt_category_id(c.get("id") or c.get("name") or "") not in builtin_ids]
        libraries.append({
            "id": lib_id,
            "name": sanitize_asset_name(raw.get("name") or default_name, default_name),
            "type": "prompt",
            "readonly": False,
            "system": is_system,
            "categories": normalize_prompt_template_categories(raw_categories, include_defaults=False),
            "items": items,
        })
    active = str(data.get("active_library_id") or "system")
    if not any(lib["id"] == active for lib in libraries):
        active = "system" if any(lib["id"] == "system" for lib in libraries) else (libraries[0]["id"] if libraries else "system")
    return {"active_library_id": active, "libraries": libraries, "updated_at": int(data.get("updated_at") or now_ms())}

def load_prompt_libraries():
    path = prompt_library_file()
    if not os.path.exists(path):
        try:
            current_prompt_library_storage().migrate_legacy_layout()
        except WorkspaceStorageError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not os.path.exists(path):
            data = default_prompt_libraries()
            return save_prompt_libraries(data)
    try:
        data = current_prompt_library_storage().load()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="提示词库数据无法安全读取；原文件已保留，请修复后重试",
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=500,
            detail="提示词库数据格式无效；原文件已保留，请修复后重试",
        )
    try:
        normalized = normalize_prompt_libraries(data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if normalized.get("active_library_id") != data.get("active_library_id") or normalized.get("libraries") != data.get("libraries"):
        return save_prompt_libraries(normalized)
    return normalized

def save_prompt_libraries(data):
    try:
        data = normalize_prompt_libraries(data)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    data["updated_at"] = now_ms()
    try:
        current_prompt_library_storage().save(data)
    except (OSError, WorkspaceStorageError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail="提示词库数据无法安全保存；原文件已保留",
        ) from exc
    return data

def public_prompt_libraries(data=None):
    data = normalize_prompt_libraries(data or load_prompt_libraries())
    public_libraries = []
    common_categories = []
    common_items = []
    for library in data.get("libraries") or []:
        item_category_ids = {
            str(item.get("category") or "")
            for item in library.get("items") or []
            if isinstance(item, dict)
        }
        visible_categories = []
        for category in library.get("categories") or []:
            if not isinstance(category, dict) or not category.get("id"):
                continue
            category_id = str(category.get("id") or "")
            if category_id == PROMPT_UNCATEGORIZED_CATEGORY_ID and category_id not in item_category_ids:
                continue
            public_category = copy.deepcopy(category)
            if category_id == PROMPT_UNCATEGORIZED_CATEGORY_ID:
                public_category["name"] = PROMPT_UNCATEGORIZED_CATEGORY_NAME
                public_category["managed"] = True
            visible_categories.append(public_category)
        public_library = copy.deepcopy(library)
        public_library["categories"] = copy.deepcopy(visible_categories)
        if public_library.get("id") == "system":
            public_library["name"] = "通用"
            public_library["system"] = False
        public_libraries.append(public_library)
        library_id = str(library.get("id") or "")
        for category in visible_categories:
            if not isinstance(category, dict) or not category.get("id"):
                continue
            common_categories.append({
                **copy.deepcopy(category),
                "id": f"{library_id}::{category['id']}",
                "library_id": library_id,
                "category_id": str(category["id"]),
            })
        for item in library.get("items") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            common_item = {
                **copy.deepcopy(item),
                "id": f"{library_id}::{item['id']}",
                "source_id": str(item["id"]),
                "library_id": library_id,
                "category": f"{library_id}::{item.get('category') or ''}",
                "scope": "common",
            }
            # 预置内容进入工作区后就是普通通用模板；这些旧存储标记仅保留作兼容，
            # 不进入新的公共范围协议，也不在界面形成“系统/内置”身份。
            common_item.pop("system", None)
            common_item.pop("builtin", None)
            common_items.append(common_item)
    return {
        "active_library_id": data.get("active_library_id") or (data.get("libraries") or [{}])[0].get("id") or "system",
        "libraries": public_libraries,
        "common": {
            "id": "common",
            "name": "通用",
            "description": "当前工作区内的所有画布均可使用",
            "scope": "common",
            "readonly": False,
            "categories": common_categories,
            "items": common_items,
        },
        "updated_at": data.get("updated_at") or now_ms(),
    }

def find_prompt_library(data, library_id=""):
    if not isinstance(data, dict):
        return None
    libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    requested_id = str(library_id or "").strip()
    if requested_id:
        return next((item for item in libraries if item.get("id") == requested_id), None)
    active_id = str(data.get("active_library_id") or "").strip()
    return next((item for item in libraries if item.get("id") == active_id), None) or (libraries[0] if libraries else None)

def normalize_canvas_prompt_template(item):
    raw = copy.deepcopy(item) if isinstance(item, dict) else {}
    timestamp = now_ms()
    normalized = {
        **raw,
        "id": re.sub(
            r"[^A-Za-z0-9_-]+",
            "_",
            str(raw.get("id") or f"ctpl_{uuid.uuid4().hex[:16]}"),
        )[:80],
        "name": sanitize_asset_name(raw.get("name") or "提示词", "提示词"),
        "positive": str(raw.get("positive") or raw.get("text") or "").strip(),
        "cover": str(raw.get("cover") or "").strip()[:8000],
        "created_at": int(raw.get("created_at") or timestamp),
        "updated_at": int(raw.get("updated_at") or raw.get("created_at") or timestamp),
        "scope": "canvas",
    }
    for key in ("category", "library_id", "source_id", "text", "scene", "scene_en"):
        normalized.pop(key, None)
    return normalized

def canvas_prompt_templates(canvas):
    raw_items = canvas.get("prompt_templates") if isinstance(canvas, dict) else []
    items = []
    seen = set()
    for raw in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(raw, dict):
            continue
        item = normalize_canvas_prompt_template(raw)
        if item["id"] in seen:
            raise HTTPException(
                status_code=409,
                detail=f"当前画布提示词存在重复 ID: {item['id']}",
            )
        seen.add(item["id"])
        items.append(item)
    return sorted(
        items,
        key=lambda item: (
            int(item.get("updated_at") or item.get("created_at") or 0),
            int(item.get("created_at") or 0),
            str(item.get("id") or ""),
        ),
        reverse=True,
    )

def public_canvas_prompt_templates(canvas):
    return [
        {
            **item,
            "item_version": prompt_template_item_version(item),
        }
        for item in canvas_prompt_templates(canvas)
    ]

def prompt_template_operation_id(value):
    operation_id = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,160}", operation_id):
        raise HTTPException(status_code=400, detail="operation_id 无效")
    return operation_id

def canvas_prompt_template_id(canvas_id, operation_id):
    digest = hashlib.sha256(
        f"{canvas_id}\0{operation_id}".encode("utf-8")
    ).hexdigest()[:20]
    return f"ctpl_{digest}"

async def commit_canvas_prompt_intent(
    canvas_id,
    prompt_intent,
    *,
    operation_id,
    client_id="",
):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(
            UPDATE_PROMPT_TEMPLATES,
            canvas_id,
            {
                "intent": copy.deepcopy(dict(prompt_intent)),
                "operation_id": prompt_template_operation_id(operation_id),
                "client_id": str(client_id or "")[:120],
            },
        ),
        actor,
    )
    return result.canvas

def find_common_prompt_item(data, item_id, library_id=""):
    library = find_prompt_library(data, library_id)
    if not library:
        return None, None
    item = next(
        (
            item
            for item in library.get("items") or []
            if isinstance(item, dict) and item.get("id") == item_id
        ),
        None,
    )
    return library, item

def sanitize_asset_name(name, fallback="asset"):
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(name or fallback)).strip()
    return name[:120] or fallback

def content_type_for_path(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in [".mp4", ".m4v"]:
        return "video/mp4"
    if ext == ".webm":
        return "video/webm"
    if ext == ".mov":
        return "video/quicktime"
    if ext == ".avi":
        return "video/x-msvideo"
    if ext == ".mkv":
        return "video/x-matroska"
    if ext == ".flv":
        return "video/x-flv"
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".wav":
        return "audio/wav"
    if ext == ".m4a":
        return "audio/mp4"
    if ext == ".aac":
        return "audio/aac"
    if ext == ".ogg":
        return "audio/ogg"
    if ext == ".flac":
        return "audio/flac"
    if ext == ".gif":
        return "image/gif"
    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    if ext == ".txt":
        return "text/plain; charset=utf-8"
    if ext == ".json":
        return "application/json; charset=utf-8"
    if ext == ".csv":
        return "text/csv; charset=utf-8"
    if ext == ".md":
        return "text/markdown; charset=utf-8"
    if ext == ".srt":
        return "application/x-subrip; charset=utf-8"
    if ext == ".vtt":
        return "text/vtt; charset=utf-8"
    if ext == ".png":
        return "image/png"
    return "application/octet-stream"

def is_image_reference_value(value):
    if not isinstance(value, str) or not value:
        return False
    if value.startswith("data:image/"):
        return True
    if value.startswith("data:"):
        return False
    if value.startswith("/assets/"):
        path = output_file_from_url(value)
        return bool(path and content_type_for_path(path).startswith("image/"))
    clean = value.split("?", 1)[0].lower()
    if re.search(r"\.(mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)$", clean):
        return False
    return True

def is_video_reference_value(value):
    if not isinstance(value, str) or not value:
        return False
    if value.startswith("data:video/"):
        return True
    if value.startswith("data:"):
        return False
    if value.startswith("/assets/"):
        path = output_file_from_url(value)
        return bool(path and content_type_for_path(path).startswith("video/"))
    clean = value.split("?", 1)[0].lower()
    return bool(re.search(r"\.(mp4|webm|mov|m4v|avi|mkv)$", clean))

def convert_output_to_jpg(url, quality=88):
    path = output_file_from_url(url)
    if not path:
        return url
    root, ext = os.path.splitext(path)
    if ext.lower() in [".jpg", ".jpeg"]:
        return url
    jpg_path = f"{root}.jpg"
    try:
        with Image.open(path) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.save(jpg_path, "JPEG", quality=quality, optimize=True)
        assets_root = os.path.abspath(managed_media_directory())
        jpg_abs = os.path.abspath(jpg_path)
        try:
            if os.path.commonpath([assets_root, jpg_abs]) == assets_root:
                rel = os.path.relpath(jpg_abs, assets_root).replace("\\", "/")
                return f"/assets/{urllib.parse.quote(rel, safe='/')}"
        except ValueError:
            pass
        generated_root = os.path.abspath(
            generation_output_directory()
        )
        try:
            if os.path.commonpath([generated_root, jpg_abs]) == generated_root:
                rel = os.path.relpath(jpg_abs, generated_root).replace("\\", "/")
                return f"/api/storage-files/generated/{urllib.parse.quote(rel, safe='/')}"
        except ValueError:
            pass
        return url
    except Exception as e:
        print(f"转换 JPG 失败: {e}")
        return url

def reference_to_data_url(ref, max_size=None):
    """把本地输出文件转为 data URL（base64）。max_size 限制最长边像素，避免 payload 过大。"""
    path = output_file_from_url(ref.get("url", ""))
    if not path:
        return ref.get("url", "")
    if max_size:
        try:
            with Image.open(path) as img:
                img.load()
                w, h = img.size
                if max(w, h) > max_size:
                    img.thumbnail((max_size, max_size), Image.LANCZOS)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                buf = BytesIO()
                fmt = "PNG" if img.mode == "RGBA" else "JPEG"
                img.save(buf, format=fmt, quality=88 if fmt == "JPEG" else None)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png" if fmt == "PNG" else "image/jpeg"
                return f"data:{mime};base64,{encoded}"
        except Exception as e:
            print(f"reference resize failed, fallback to raw: {e}")
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{content_type_for_path(path)};base64,{encoded}"

def is_image_reference(ref):
    if not isinstance(ref, dict):
        return False
    kind = str(ref.get("kind") or "").strip().lower()
    mime = str(ref.get("mime") or "").strip().lower()
    url = str(ref.get("url") or "").strip().lower()
    if kind:
        return kind == "image"
    if mime:
        return mime.startswith("image/")
    return bool(re.search(r"\.(png|jpe?g|webp|gif|bmp|tiff?)(\?|#|$)", url))

def image_references(refs):
    return [ref for ref in (refs or []) if is_image_reference(ref)]

def media_reference_to_url(value, max_image_size=None):
    if not isinstance(value, str) or not value:
        return ""
    if value.startswith("/assets/"):
        return reference_to_data_url({"url": value}, max_size=max_image_size)
    return value

def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    if not isinstance(value, str) or not value.startswith("data:image/") or ";base64," not in value:
        return value
    header, encoded = value.split(";base64,", 1)
    try:
        raw = base64.b64decode(encoded)
        with Image.open(BytesIO(raw)) as img:
            img.load()
            if max_size and max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
            has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
            if has_alpha:
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                fmt, mime = "PNG", "image/png"
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                fmt, mime = "JPEG", "image/jpeg"
            buf = BytesIO()
            if fmt == "JPEG":
                img.save(buf, format=fmt, quality=jpeg_quality, optimize=True)
            else:
                img.save(buf, format=fmt, optimize=True)
            return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"
    except Exception as e:
        print(f"data url image compress failed, fallback to raw: {e}")
        return value


APIMART_UPLOAD_RETRY_ATTEMPTS = 3


AVATAR_TASK_DONE_STATUSES = {"completed", "complete", "succeeded", "success", "active", "done"}
AVATAR_TASK_FAIL_STATUSES = {"failed", "fail", "error", "rejected", "canceled", "cancelled", "expired"}


# ---- 火山 Ark 私域素材资产（Assets）API：AK/SK 签名 V4 + CreateAssetGroup/CreateAsset/GetAsset ----
VOLCENGINE_ARK_ASSET_HOST = "open.volcengineapi.com"
VOLCENGINE_ARK_ASSET_SERVICE = "ark"
VOLCENGINE_ARK_ASSET_REGION = "cn-beijing"
VOLCENGINE_ARK_ASSET_VERSION = "2024-01-01"


CHAT_RATIO_SIZE_OPTIONS = {
    "1:1": ("1024x1024", "1536x1536", "2048x2048"),
    "2:3": ("720x1080", "1024x1536", "1365x2048"),
    "3:2": ("1080x720", "1536x1024", "2048x1365"),
    "3:4": ("1008x1344", "1536x2048", "2448x3264"),
    "4:3": ("1344x1008", "2048x1536", "3264x2448"),
    "9:16": ("720x1280", "1080x1920", "1440x2560"),
    "16:9": ("1280x720", "1920x1080", "2560x1440"),
}


# GPT-Image-2 限制：长边最大 3840，主要受最大像素限制（约 829 万 = 3840x2160）。
# 这里只用于上游报错后给出友好的像素上限提示；不对尺寸做任何缩小（用户选什么就原样发送）。
GPT_IMAGE2_MAX_EDGE = 3840
GPT_IMAGE2_MAX_PIXELS = 8_294_400
GPT_IMAGE2_MIN_PIXELS = 655_360


VOLCENGINE_MIN_PIXELS = 3_686_400
VOLCENGINE_MIN_EDGE = 1536
VOLCENGINE_MAX_EDGE = 4096
VOLCENGINE_RATIO_CHOICES = [
    (1, 1, "1:1"),
    (4, 3, "4:3"),
    (3, 4, "3:4"),
    (16, 9, "16:9"),
    (9, 16, "9:16"),
    (21, 9, "21:9"),
    (9, 21, "9:21"),
    (3, 2, "3:2"),
    (2, 3, "2:3"),
    (5, 4, "5:4"),
    (4, 5, "4:5"),
]


RUNNINGHUB_ENTRY_MODEL_RE = re.compile(r"^(app|workflow):(.+)$")


SEED_UINT32_MAX = 4294967295


async def generate_ai_image(
    prompt,
    size,
    quality,
    model,
    reference_images=None,
    provider_id="comfly",
    transparent_png=False,
):
    """Strict-compatible image facade routed through Generation Runs."""
    return await _run_generation_inline(
        ImageRun(
            prompt=prompt,
            settings={
                "size": size,
                "quality": quality,
                "model": model,
                "provider_id": provider_id,
                "wait_for_task": wait_for_image_task,
                "transparent_png": bool(transparent_png),
            },
            references=tuple(reference_images or ()),
        )
    )


# --- 路由接口 ---

@app.get("/setup")
async def setup_page():
    response = static_html_response("setup.html")
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/login")
async def login_page():
    response = static_html_response("login.html")
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' data:; frame-ancestors 'none'"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response

@app.get("/share/{token}")
async def shared_canvas_page(token: str):
    _active_shared_canvas(token)
    response = static_html_response("share.html")
    response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'self'"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

@app.get("/")
async def index():
    return static_html_response("index.html")


@app.get("/ui-component-library")
async def ui_component_library_page():
    response = static_html_response("ui-component-library.html")
    response.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/view")
def view_image(filename: str, type: str = "input", subfolder: str = ""):
    # 先按原逻辑去各 ComfyUI 后端找
    for addr in COMFYUI_INSTANCES:
        try:
            url = f"http://{addr}/view"
            params = {"filename": filename, "type": type, "subfolder": subfolder}
            r = requests.get(url, params=params, timeout=1)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    # 后端都拿不到时回退本地 assets/<input|output>/
    # 适用场景：画布通过 /api/ai/upload 把参考图直接落到本地 assets/input/，
    # 但 ComfyUI 的 input 可能因为重启/清理而丢失，导致 enhance/klein 等页面预览对比图 404
    if not subfolder and type in ("input", "output"):
        safe_name = os.path.basename(filename or "")
        if safe_name:
            local_path = output_path_for(safe_name, "input" if type == "input" else "output")
            if os.path.isfile(local_path):
                return FileResponse(local_path, media_type=content_type_for_path(local_path))
    raise HTTPException(status_code=404, detail="Image not found on any available backend")

@app.get("/api/download-output")
def download_output(request: Request, url: str, name: str = "", inline: bool = False):
    url = rewrite_runninghub_file_url(url)
    path = output_file_from_url(url)
    if not path:
        path = local_media_file_by_basename(filename_from_media_url(url, ""))
    if path:
        filename = sanitize_export_filename(os.path.basename(name) if name else os.path.basename(path), os.path.basename(path))
        return FileResponse(path, media_type=content_type_for_path(path), filename=None if inline else filename)
    # 远程文件：流式代理，绝不把整段视频/大文件读进内存（否则多个视频同时代理会撑爆内存、拖垮单进程服务）。
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="无效的下载地址")
    try:
        upstream_headers = {"User-Agent": "ComfyUI-API-Modelscope/1.0"}
        range_header = request.headers.get("range")
        if range_header:
            upstream_headers["Range"] = range_header
        upstream = requests_get_public(
            url, stream=True, timeout=(10, 60),
            headers=upstream_headers,
        )
        upstream.raise_for_status()
    except OutboundUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"远程文件下载失败：{exc}")
    content_type = upstream.headers.get("content-type") or "application/octet-stream"
    fallback = filename_from_media_url(url, "download.bin")
    filename = sanitize_export_filename(os.path.basename(name) if name else fallback, fallback)
    disposition = "inline" if inline else "attachment"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(filename)}"}
    for key in ("content-range", "accept-ranges"):
        value = upstream.headers.get(key)
        if value:
            headers["-".join(part.capitalize() for part in key.split("-"))] = value

    def stream_remote():
        try:
            for chunk in upstream.iter_content(chunk_size=256 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(stream_remote(), media_type=content_type, headers=headers, status_code=upstream.status_code)

@app.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail="一次上传的文件数量过多")
    uploaded_files = []
    for file in files:
        content = await read_upload_limited(file)
        success_count = 0
        last_result = None
        for addr in COMFYUI_INSTANCES:
            try:
                files_data = {'image': (file.filename, content, file.content_type)}
                response = requests.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception as e:
                print(f"Upload error for {addr}: {e}")

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}

def decode_txt_reference_snapshot(content: bytes) -> tuple[str, str]:
    if len(content) > TXT_REFERENCE_MAX_BYTES:
        return "", "TXT 文本超过 1MB，生成前请移除或替换此文件"
    encodings = []
    if content.startswith(b"\xef\xbb\xbf"):
        encodings.append("utf-8-sig")
    elif content.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings.append("utf-16")
    encodings.extend(encoding for encoding in ("utf-8", "gb18030") if encoding not in encodings)
    for encoding in encodings:
        try:
            return content.decode(encoding), ""
        except UnicodeDecodeError:
            continue
    return "", "TXT 文本无法按 UTF-8、UTF-16 或 GB18030 解码"


@app.get("/api/ai/upload-limits")
async def ai_reference_upload_limits():
    return {
        "max_files": AI_REFERENCE_MAX_UPLOAD_FILES,
        "max_file_bytes": MAX_UPLOAD_BYTES,
        "txt_max_bytes": TXT_REFERENCE_MAX_BYTES,
        "txt_batch_max_bytes": TXT_REFERENCE_BATCH_MAX_BYTES,
        "accept": ["text/plain", "image/*", "video/*", "audio/*"],
    }


@app.post("/api/ai/upload")
async def upload_ai_reference(files: List[UploadFile] = File(...)):
    if len(files) > AI_REFERENCE_MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"每次最多选择 {AI_REFERENCE_MAX_UPLOAD_FILES} 个文件",
        )
    uploaded = []
    failures = []
    for index, file in enumerate(files):
        filename = Path(file.filename or f"文件 {index + 1}").name
        try:
            content = await read_upload_limited(file)
            if not content:
                raise WorkspaceStorageError("所选本地媒体为空")
            content_type = (file.content_type or "").lower()
            extension = Path(filename).suffix.lower()
            normalized_type = content_type.split(";", 1)[0]
            accepted_mime = (
                not normalized_type
                or normalized_type == "application/octet-stream"
                or normalized_type == "text/plain"
                or normalized_type.startswith(("image/", "video/", "audio/"))
            )
            if extension not in AI_REFERENCE_EXTENSIONS or not accepted_mime:
                raise WorkspaceStorageError(
                    "本地引用只支持 TXT、图片、视频和音频"
                )
            imported = current_workspace_media().import_bytes(
                content,
                name=(
                    filename
                    or (
                        "imported"
                        f"{mimetypes.guess_extension(content_type) or '.bin'}"
                    )
                ),
                content_type=content_type,
            )
            public = {
                **imported.public(),
                "mime": content_type,
                "index": index,
            }
            if extension == ".txt" or normalized_type == "text/plain":
                snapshot, text_error = decode_txt_reference_snapshot(content)
                public.update(
                    {
                        "kind": "text",
                        "text_snapshot": snapshot,
                        "text_bytes": len(content),
                        "text_error": text_error,
                    }
                )
            uploaded.append(public)
        except HTTPException as exc:
            failures.append(
                {
                    "index": index,
                    "name": filename,
                    "reason": str(exc.detail),
                }
            )
        except WorkspaceStorageError as exc:
            failures.append(
                {"index": index, "name": filename, "reason": str(exc)}
            )
    return {
        "files": uploaded,
        "failures": failures,
        "success_count": len(uploaded),
        "failed_count": len(failures),
    }

class Base64UploadRequest(BaseModel):
    data: str = ""            # 纯 base64 或 data:URL
    name: str = ""
    content_type: str = ""

@app.post("/api/ai/upload-base64")
async def upload_ai_base64(payload: Base64UploadRequest):
    """以 base64 JSON 方式上传字节到 assets/input，返回 /assets 地址。
    给不便用 multipart/FormData 的客户端（如 PS UXP 面板）用——UXP 的 fetch+FormData 经常发不出有效 multipart。"""
    raw = (payload.data or "").strip()
    ct = (payload.content_type or "").split(";", 1)[0].strip().lower()
    if raw.startswith("data:"):
        header, _, raw = raw.partition(",")
        if not ct:
            ct = header[5:].split(";", 1)[0].strip().lower()
    try:
        content = base64.b64decode(raw, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="数据无法解码")
    if not content:
        raise HTTPException(status_code=400, detail="内容为空")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"超过 {max(1, MAX_UPLOAD_BYTES // (1024 * 1024))}MB",
        )
    try:
        imported = current_workspace_media().import_bytes(
            content,
            name=payload.name or "imported.png",
            content_type=ct or "image/png",
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"files": [imported.public()]}

@app.post("/api/comfyui/upload-base64")
async def upload_comfyui_base64(payload: Base64UploadRequest):
    return await _provider_implementation.upload_comfyui_base64(payload)

def _local_upload_kind_ext(filename, content_type):
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".webm", ".mov", ".m4v", ".flv"}
    audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
    ext = os.path.splitext(filename or "")[1].lower()
    ct = (content_type or "").lower()
    if ext in video_exts or ct.startswith("video/"):
        if ext not in video_exts:
            ext = ".webm" if "webm" in ct else ".mov" if "quicktime" in ct else ".mp4"
        return "video", ext
    if ext in audio_exts or ct.startswith("audio/"):
        if ext not in audio_exts:
            ext = ".wav" if "wav" in ct else ".ogg" if "ogg" in ct else ".m4a" if "mp4" in ct else ".mp3"
        return "audio", ext
    if ext in image_exts or ct.startswith("image/"):
        if ext not in image_exts:
            ext = ".jpg" if "jpeg" in ct else ".webp" if "webp" in ct else ".gif" if "gif" in ct else ".png"
        return "image", ext
    return None, ext

def _local_upload_display_name(filename):
    # 文件名形如 up_<hex>_<原始名>；去掉前缀还原展示名
    base = os.path.basename(str(filename or ""))
    m = re.match(r"^up_[0-9a-f]{12}_(.+)$", base)
    return m.group(1) if m else base

def _local_upload_rel_path(value):
    text = str(value or "").replace("\\", "/").strip().lstrip("/")
    if not text:
        return ""
    norm = os.path.normpath(text).replace("\\", "/")
    if norm in {".", ""}:
        return ""
    if norm.startswith("../") or norm == ".." or os.path.isabs(norm):
        raise HTTPException(status_code=400, detail="非法路径")
    return norm

def _local_upload_abs(rel):
    rel_path = _local_upload_rel_path(rel)
    root = os.path.abspath(local_upload_directory())
    path = os.path.abspath(os.path.join(root, rel_path))
    try:
        common = os.path.commonpath([root, path])
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    if common != root:
        raise HTTPException(status_code=400, detail="非法路径")
    return rel_path, path

def _local_upload_safe_path(name):
    filename, path = _local_upload_abs(name)
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    return filename, path

def _local_upload_safe_folder(path_value):
    rel, path = _local_upload_abs(path_value)
    return rel, path

def _local_upload_safe_folder_name(name):
    cleaned = sanitize_asset_name(os.path.basename(str(name or "").strip()), "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    return cleaned[:60]

def _local_upload_safe_file_stem(name):
    raw = os.path.splitext(os.path.basename(str(name or "").strip()))[0]
    cleaned = sanitize_asset_name(raw, "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件名称不能为空")
    return cleaned[:120]

@app.post("/api/temp-sh/upload")
async def temp_sh_upload(payload: TempShUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, "auto")

@app.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, payload.service)

@app.post("/api/ai/import-local-image")
async def import_local_ai_reference(payload: LocalImageImportRequest, request: Request):
    ensure_same_origin_request(request)
    requested = [payload.path] if payload.path else []
    requested.extend(payload.paths or [])
    requested = [p for p in requested if str(p or "").strip()][:20]
    if not requested:
        raise HTTPException(status_code=400, detail="没有可导入的本地媒体")
    return {
        "files": [
            import_local_media_file(normalize_local_media_path(path))
            for path in requested
        ]
    }

@app.get("/api/runninghub/app-info")
async def runninghub_app_info(webappId: str = ""):
    return await _provider_implementation.runninghub_app_info(webappId)

@app.post("/api/runninghub/submit")
async def runninghub_submit(payload: RunningHubSubmitRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "runninghub-app-submit",
            payload,
            provider_id="runninghub",
        ),
        payload,
    )

@app.post("/api/runninghub/workflow-submit")
async def runninghub_workflow_submit(payload: RunningHubWorkflowSubmitRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "runninghub-submit",
            payload,
            provider_id="runninghub",
        ),
        payload,
    )

@app.get("/api/runninghub/workflow-info")
async def runninghub_workflow_info(workflowId: str = ""):
    return await _provider_implementation.runninghub_workflow_info(workflowId)

@app.get("/api/runninghub/workflows")
def list_runninghub_workflows():
    return _provider_implementation.list_runninghub_workflows()

@app.get("/api/runninghub/workflows/{workflow_id:path}")
def get_runninghub_workflow(workflow_id: str):
    return _provider_implementation.get_runninghub_workflow(workflow_id)

@app.post("/api/runninghub/workflows/fetch")
async def fetch_runninghub_workflow(payload: RunningHubWorkflowConfig):
    return await _provider_implementation.fetch_runninghub_workflow(payload)

@app.put("/api/runninghub/workflows/{workflow_id:path}")
def save_runninghub_workflow(workflow_id: str, payload: RunningHubWorkflowConfig):
    return _provider_implementation.save_runninghub_workflow(workflow_id, payload)

@app.delete("/api/runninghub/workflows/{workflow_id:path}")
def delete_runninghub_workflow(workflow_id: str):
    return _provider_implementation.delete_runninghub_workflow(workflow_id)

@app.get("/api/runninghub/query")
async def runninghub_query(taskId: str = "", useWallet: bool = False):
    actor = current_user() or {}
    owner = str(actor.get("id") or "")
    remote_ref = str(taskId or "").strip()
    return await _query_generation_remote(
        remote_ref,
        provider_id="runninghub",
        owner=owner,
        fallback_request=WorkflowRun(
            "runninghub-query",
            {"taskId": remote_ref, "useWallet": useWallet},
            provider_id="runninghub",
        ),
        fallback_key=f"runninghub-recovery:{remote_ref}",
        failure_as_result=True,
    )

@app.post("/api/runninghub/upload-asset")
async def runninghub_upload_asset(payload: RunningHubUploadAssetRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "runninghub-upload-asset",
            payload,
            provider_id="runninghub",
        )
    )

@app.get("/api/codex/status")
async def codex_status():
    return await _PROVIDER_INSPECTORS.status("codex")

@app.post("/api/codex/help")
async def codex_help(payload: CodexHelpRequest):
    return await _provider_implementation.codex_help(payload)

@app.get("/api/gemini-cli/status")
async def gemini_cli_status():
    return await _PROVIDER_INSPECTORS.status("gemini-cli")

@app.post("/api/gemini-cli/help")
async def gemini_cli_help(payload: GeminiCliHelpRequest):
    return await _provider_implementation.gemini_cli_help(payload)

@app.get("/api/jimeng/status")
async def jimeng_status():
    return await _PROVIDER_INSPECTORS.status("jimeng")


class CliUpdateDismissRequest(BaseModel):
    cli_ids: List[str] = Field(default_factory=list, max_length=3)


@app.get("/api/admin/cli-updates")
async def cli_update_status():
    require_current_user("admin")
    return CLI_UPDATE_MANAGER.snapshot()


@app.post("/api/admin/cli-updates/check")
async def check_cli_updates():
    require_current_user("admin")
    return await CLI_UPDATE_MANAGER.check_all(force=True)


@app.post("/api/admin/cli-updates/dismiss")
async def dismiss_cli_updates(payload: CliUpdateDismissRequest):
    require_current_user("admin")
    return CLI_UPDATE_MANAGER.dismiss(payload.cli_ids)

@app.get("/api/jimeng/credit")
async def jimeng_credit():
    return await _provider_implementation.jimeng_credit()

@app.post("/api/jimeng/logout")
async def jimeng_logout():
    return await _provider_implementation.jimeng_logout()

@app.post("/api/jimeng/login/start")
async def jimeng_login_start():
    return await _provider_implementation.jimeng_login_start()

@app.get("/api/jimeng/login/status")
async def jimeng_login_status():
    return await _provider_implementation.jimeng_login_status()

@app.post("/api/jimeng/help")
async def jimeng_help(payload: JimengHelpRequest):
    return await _provider_implementation.jimeng_help(payload)

@app.post("/api/jimeng/query-media")
async def jimeng_query_media(payload: JimengQueryMediaRequest):
    remote_ref = str(payload.submit_id or "").strip()
    if not remote_ref:
        raise HTTPException(status_code=400, detail="缺少 submit_id")
    media_kind = str(payload.kind or "image").strip().lower()
    if media_kind not in {"image", "video", "audio"}:
        media_kind = "image"
    actor = current_user() or {}
    owner = str(actor.get("id") or "")
    linked = _GENERATION_RUNS.find_by_remote_ref(
        remote_ref,
        provider_id="jimeng",
        owner=owner,
    )
    try:
        if linked is None:
            run = await _GENERATION_RUNS.start(
                RecoveryRun(
                    provider_id="jimeng",
                    remote_ref=remote_ref,
                    media_kind=media_kind,
                ),
                key=f"jimeng-recovery:{media_kind}:{remote_ref}",
                owner=owner,
                delivery=Inline(),
            )
        elif linked.status in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = linked
        else:
            run = await _GENERATION_RUNS.resume(
                linked.id,
                owner=owner,
            )
    except Exception as exc:
        _raise_generation_http(exc)
    return run.result

@app.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    providers = public_api_providers()
    return {
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "video_models": VIDEO_MODELS,
        "comfy_instances": COMFYUI_INSTANCES,
        "api_providers": providers,
        "available_models": available_models(providers, include_hidden=False),
        "canvas_storage_authority": (
            "sqlite"
            if (
                WORKSPACE_STORAGE_COMPOSITION is not None
                and WORKSPACE_STORAGE_COMPOSITION.sqlite_ready
            )
            else "json"
        ),
        "has_api_key": bool(AI_API_KEY),
        "ms_chat_models": MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(modelscope_api_key()),
    }

@app.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS, "video_models": VIDEO_MODELS}

@app.get("/api/providers")
async def api_providers():
    return {"providers": public_api_providers()}

@app.get("/api/available-models")
async def get_available_models():
    return {"models": available_models(include_hidden=False)}

@app.get("/api/admin/available-models")
async def get_admin_available_models():
    require_current_user("admin")
    return {"models": available_models(include_hidden=True)}

@app.get("/api/admin/design-tokens")
async def get_design_tokens():
    require_current_user("admin")
    try:
        return DESIGN_TOKEN_WORKBENCH.snapshot()
    except (OSError, DesignTokenValidation) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

@app.put("/api/admin/design-tokens")
async def save_design_tokens(payload: DesignTokenSavePayload):
    require_current_user("admin")
    try:
        return DESIGN_TOKEN_WORKBENCH.save(
            expected_revision=payload.expected_revision,
            changes=[change.model_dump(exclude_none=True) for change in payload.changes],
        )
    except DesignTokenConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except DesignTokenValidation as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail="无法保存设计参数") from error

@app.put("/api/admin/available-models")
async def update_available_models(payload: AvailableModelOrderPayload):
    require_current_user("admin")
    save_available_model_names(payload.names)
    models = save_available_model_order(
        payload.dict(exclude={"names", "visible"}),
        payload.visible,
    )
    return {"models": models}

@app.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    providers = []
    env_updates = {}
    # 收集每个 item 的 primary 字段
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    for item in payload:
        provider = normalize_provider(item.dict(exclude={"api_key"}))
        if provider["id"] == "runninghub":
            provider = preserve_runninghub_hidden_overrides(provider)
            prune_runninghub_workflow_store_for_provider(provider)
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复：{provider['id']}")
        providers.append(provider)
        key_env = provider_key_env(provider["id"])
        if item.clear_key:
            env_updates[key_env] = ""
        elif item.api_key is not None and item.api_key.strip():
            env_updates[key_env] = item.api_key.strip()
        if provider["id"] == "runninghub":
            wallet_env = runninghub_wallet_key_env()
            if item.clear_wallet_key:
                env_updates[wallet_env] = ""
            elif item.wallet_api_key is not None and item.wallet_api_key.strip():
                env_updates[wallet_env] = item.wallet_api_key.strip()
        if provider["id"] == "volcengine":
            ak_env = volcengine_access_key_env()
            sk_env = volcengine_secret_key_env()
            if item.clear_volcengine_access_key_id:
                env_updates[ak_env] = ""
            elif item.volcengine_access_key_id is not None and item.volcengine_access_key_id.strip():
                env_updates[ak_env] = item.volcengine_access_key_id.strip()
            if item.clear_volcengine_secret_access_key:
                env_updates[sk_env] = ""
            elif item.volcengine_secret_access_key is not None and item.volcengine_secret_access_key.strip():
                env_updates[sk_env] = item.volcengine_secret_access_key.strip()
        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
        if provider["id"] == "runninghub":
            provider["protocol"] = "runninghub"
        if provider["id"] == "volcengine":
            provider["protocol"] = "volcengine"
    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")
    # 强制最多一个 primary（取最后被标记的；都没标记则保持原样不强制）
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)
    save_api_providers(providers)
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()   # 立即将最新 env 值同步回模块全局变量，无需重启
    return {"providers": [public_provider(p) for p in providers]}


class ApiSettingsEncryptedExportPayload(BaseModel):
    password: str = Field(min_length=8, max_length=256)


@functools.lru_cache(maxsize=1)
def _configured_api_settings_package():
    return ApiSettingsPackage(
        _ApiSettingsStorageAdapter(
            mutation_lock=GLOBAL_CONFIG_LOCK,
            load_providers=load_api_providers,
            available_models=available_models,
            load_runninghub_workflows=load_runninghub_workflow_store,
            provider_api_key=provider_env_key_value,
            runninghub_wallet_key=runninghub_wallet_key_value,
            volcengine_access_key=volcengine_access_key_value,
            volcengine_secret_key=volcengine_secret_key_value,
            current_app_version=current_app_version,
            now_ms=now_ms,
            normalize_provider=normalize_provider,
            save_providers=save_api_providers,
            load_model_order=_load_available_model_order,
            save_model_order=save_available_model_order,
            save_runninghub_workflows=save_runninghub_workflow_store,
            update_env_values=update_env_values,
            reload_env_globals=reload_env_globals,
            public_providers=public_api_providers,
            transaction_paths=lambda: (
                api_providers_file(),
                PROVIDER_CONNECTIONS_FILE,
                available_models_file(),
                runninghub_workflow_file(),
                API_ENV_FILE,
            ),
            environment=os.environ,
        )
    )


@app.post("/api/providers/export-encrypted")
async def export_encrypted_api_settings(
    payload: ApiSettingsEncryptedExportPayload,
):
    try:
        settings_package = _configured_api_settings_package()
        package = await asyncio.to_thread(
            settings_package.export_encrypted,
            payload.password,
        )
    except ApiSettingsTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    filename = (
        "infinite-canvas-api-settings-"
        + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        + ".icapi"
    )
    return Response(
        content=package,
        media_type="application/vnd.infinite-canvas.api-settings",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/providers/import-encrypted")
async def import_encrypted_api_settings(
    file: UploadFile = File(...),
    password: str = Form(...),
):
    try:
        package = await file.read(MAX_PACKAGE_BYTES + 1)
        settings_package = _configured_api_settings_package()
        return await asyncio.to_thread(
            settings_package.import_encrypted,
            package,
            password,
        )
    except ApiSettingsTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"导入 API 设置失败：{exc}",
        ) from exc


# --- ModelScope Token (从 env 读取，不再支持通过 UI 修改) ---

@app.get("/api/config/token")
async def get_global_token():
    # 仅返回配置状态和掩码，永不向浏览器返回 API Key 明文。
    saved_token = modelscope_api_key()
    masked = ""
    if saved_token:
        masked = (saved_token[:4] + "…" + saved_token[-4:]) if len(saved_token) > 10 else "•" * 8
    return {"configured": bool(saved_token), "masked": masked}

# --- 在线生图 (COMFLY) ---

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""
    protocol: str = "openai"
    image_request_mode: str = "openai"


@app.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    return await _PROVIDER_INSPECTORS.test_connection(payload)

@app.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    return await _provider_implementation.probe_async_endpoint(payload)


@app.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    return await _provider_implementation.fetch_upstream_models_from_payload(payload)

@app.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    return await _provider_implementation.fetch_upstream_models(provider_id)

def _raise_generation_http(error):
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=int(getattr(error, "status_code", 500) or 500),
        detail=getattr(error, "detail", None) or str(error),
    ) from error


def _generation_target(payload):
    operation_id = str(
        getattr(payload, "generation_operation_id", "") or ""
    ).strip()
    if not operation_id:
        actor = current_user() or {}
        return str(actor.get("id") or ""), "", None
    actor = require_current_user("admin", "designer")
    owner = str(actor.get("id") or "")
    target = RunTarget(
        canvas_id=str(getattr(payload, "canvas_id", "") or "").strip(),
        node_id=str(getattr(payload, "node_id", "") or "").strip(),
        operation_id=operation_id,
        request_index=int(
            getattr(payload, "generation_request_index", 0) or 0
        ),
    )
    return owner, target.key(owner), target


async def _run_generation_inline(request, payload=None):
    owner = ""
    key = ""
    target = None
    if payload is not None:
        owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            request,
            key=key,
            owner=owner,
            delivery=Inline(),
            target=target,
        )
    except Exception as exc:
        _raise_generation_http(exc)
    if run.status in {"failed", "cancelled"}:
        raise HTTPException(
            status_code=run.status_code or 500,
            detail=run.error or "生成任务执行失败",
        )
    if run.status == "jimeng_pending" and isinstance(
        run.result, BaseException
    ):
        raise run.result
    return run.result


async def _query_generation_remote(
    remote_ref,
    *,
    provider_id=None,
    owner="",
    fallback_request,
    fallback_key,
    failure_as_result=False,
):
    linked = _GENERATION_RUNS.find_by_remote_ref(
        remote_ref,
        provider_id=provider_id,
        owner=owner,
    )
    try:
        if linked is None:
            run = await _GENERATION_RUNS.start(
                fallback_request,
                key=fallback_key,
                owner=owner,
                delivery=Inline(),
            )
        elif (
            linked.status == "failed"
            and "恢复任务缺少当前可用的提供方凭证" in linked.error
        ):
            # A manual poll may carry a freshly entered one-time credential.
            # Execute only the query-shaped fallback in memory; GenerationRuns
            # redacts it before persistence and never re-submits the original.
            run = await _GENERATION_RUNS.start(
                fallback_request,
                owner=owner,
                delivery=Inline(),
            )
        elif linked.status in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = linked
        else:
            run = await _GENERATION_RUNS.resume(
                linked.id,
                owner=owner,
                recovery_request=fallback_request,
            )
    except Exception as exc:
        _raise_generation_http(exc)
    if run.status in {"failed", "cancelled"}:
        if failure_as_result and run.result is not None:
            return run.result
        raise HTTPException(
            status_code=run.status_code or 500,
            detail=run.error or "任务查询失败",
        )
    return run.result


def _online_image_run(payload, *, publication="online-image"):
    provider = get_api_provider(payload.provider_id)
    default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
    model = selected_model(payload.model, default_model)
    payload.model = model
    capability = resolved_image_capability(provider, model)
    transparent_png = bool(payload.transparent_png)
    target_aspect_ratio = str(payload.target_aspect_ratio or "").strip()
    if not target_aspect_ratio:
        match = re.fullmatch(
            r"\s*(\d+)\s*[xX*]\s*(\d+)\s*",
            str(payload.size or ""),
        )
        if match:
            target_aspect_ratio, _error = normalize_image_aspect(
                int(match.group(1)),
                int(match.group(2)),
                capability.aspect_ratios,
            )
    resolution_tier = str(payload.resolution_tier or "").strip().upper()
    native_gemini = (
        effective_protocol(provider, model) == "gemini"
        and not is_apimart_provider(provider)
    )
    request_size = (
        payload.size
        if native_gemini
        else snap_size_to_multiple(payload.size, 16)
    )
    refs = [
        ref.dict() for ref in payload.reference_images if ref.url
    ]
    image_inputs = image_references(refs)
    operation = "image.edit" if image_inputs else "image.generate"
    model_capability = resolved_model_capability(
        provider["id"], model, operation
    )
    capability_parameters = {
        "count": int(payload.n),
        "quality": str(payload.quality or "auto").strip().lower() or "auto",
    }
    if target_aspect_ratio:
        capability_parameters["aspect_ratio"] = target_aspect_ratio
    if resolution_tier:
        capability_parameters["resolution_tier"] = resolution_tier
    if transparent_png:
        capability_parameters["transparent_png"] = True
    capability_validation = MODEL_CAPABILITY_CATALOG.validate(
        model_capability,
        input_counts={"text": 1, "image": len(image_inputs)},
        parameters=capability_parameters,
        catalog_revision=str(payload.catalog_revision or ""),
    )
    raise_model_capability_validation(capability_validation)
    payload.catalog_revision = model_capability["catalog_revision"]
    reference_aspect_ratio = ""
    submitted_reference_ratio = str(
        payload.reference_aspect_ratio or ""
    ).strip()
    if submitted_reference_ratio:
        image_refs = image_references(refs)
        if len(image_refs) != 1:
            raise GenerationRunValidation(
                "原图比例只适用于一张当前参考图"
            )
        reference = image_refs[0]
        reference_width = int(reference.get("natural_w") or 0)
        reference_height = int(reference.get("natural_h") or 0)
        ratio_match = re.fullmatch(
            r"\s*(\d+)\s*:\s*(\d+)\s*",
            submitted_reference_ratio,
        )
        if (
            reference_width <= 0
            or reference_height <= 0
            or not ratio_match
            or int(ratio_match.group(1)) * reference_height
                != int(ratio_match.group(2)) * reference_width
        ):
            raise GenerationRunValidation(
                "原图比例与当前参考图尺寸不一致"
            )
        reference_aspect_ratio = (
            f"{reference_width}:{reference_height}"
        )
    return ImageRun(
        prompt=payload.prompt,
        settings={
            "provider_id": provider["id"],
            "provider_name": provider.get("name") or provider["id"],
            "model": model,
            "size": request_size,
            "requested_size": payload.size,
            "quality": payload.quality,
            "target_aspect_ratio": target_aspect_ratio,
            "reference_aspect_ratio": reference_aspect_ratio,
            "resolution_tier": resolution_tier,
            "transparent_png": transparent_png,
            "catalog_revision": model_capability["catalog_revision"],
            "capability_schema_version": model_capability[
                "capability_schema_version"
            ],
            "operation": operation,
        },
        references=tuple(image_inputs),
        count=int(payload.n),
        publication=publication,
    )


def _layer_decomposition_run(payload: LayerDecompositionRequest) -> ImageRun:
    provider = get_api_provider(payload.provider_id)
    provider_id = str(provider.get("id") or payload.provider_id).strip().lower()
    model = str(payload.model or "").strip()
    operation = "image.layer_decomposition"
    if provider_id != "apimart" or model != "seedream-5-0-pro":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "capability_unknown",
                "field": "operation",
                "actual": operation,
            },
        )
    image = payload.image.model_dump()
    if not image.get("url") or not is_image_reference(image):
        raise HTTPException(
            status_code=422,
            detail={"code": "input_invalid", "field": "image"},
        )
    image["role"] = "source"
    capability = resolved_model_capability(provider_id, model, operation)
    if capability.get("support_state") != "supported":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "capability_unknown",
                "field": "operation",
                "actual": operation,
            },
        )
    resolution_tier = str(payload.resolution_tier or "2K").strip()
    if resolution_tier.lower() == "auto":
        resolution_tier = "auto"
    else:
        resolution_tier = resolution_tier.upper()
    validation = MODEL_CAPABILITY_CATALOG.validate(
        capability,
        input_counts={
            "text": 1 if payload.prompt else 0,
            "image": 1,
            "video": 0,
            "audio": 0,
            "file": 0,
        },
        input_roles={"image": ["source"]},
        parameters={"resolution_tier": resolution_tier, "count": 1},
        catalog_revision=str(payload.catalog_revision or ""),
    )
    raise_model_capability_validation(validation)
    payload.catalog_revision = str(capability["catalog_revision"])
    payload.resolution_tier = resolution_tier
    return ImageRun(
        prompt=str(payload.prompt or ""),
        settings={
            "provider_id": "apimart",
            "provider_name": str(provider.get("name") or "APIMART"),
            "model": "seedream-5-0-pro",
            "size": resolution_tier,
            "requested_size": resolution_tier,
            "resolution_tier": resolution_tier,
            "operation": operation,
            "catalog_revision": capability["catalog_revision"],
            "capability_schema_version": capability[
                "capability_schema_version"
            ],
            "source_media_id": str(payload.source_media_id or ""),
        },
        references=(image,),
        count=1,
        publication="layer-decomposition",
        effect_context={
            "provider_id": "apimart",
            "model": "seedream-5-0-pro",
            "resolution_tier": resolution_tier,
            "source_media_id": str(payload.source_media_id or ""),
            "source_url": str(image.get("url") or ""),
        },
    )


async def build_online_image_result(payload: OnlineImageRequest):
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            _online_image_run(payload),
            key=key,
            owner=owner,
            delivery=Inline(),
            target=target,
        )
    except Exception as exc:
        _raise_generation_http(exc)
    if run.status in {"queued", "jimeng_pending"} and isinstance(
        run.result, BaseException
    ):
        raise run.result
    if run.status != "succeeded":
        raise HTTPException(
            status_code=run.status_code or 500,
            detail=run.error or "生成任务提交失败",
        )
    return run.result

@app.post("/api/online-image")
async def online_image(payload: OnlineImageRequest):
    return await build_online_image_result(payload)


class BatchGenerationPayload(BaseModel):
    name: str = ""
    name_prefix: str = ""
    prompt_modules: List[Dict[str, Any]] = Field(default_factory=list)
    image_variables: List[Dict[str, Any]] = Field(default_factory=list)
    models: List[Any] = Field(default_factory=list)
    ratios: List[str] = Field(default_factory=list)
    settings: Dict[str, Any] = Field(default_factory=dict)
    excluded: List[int] = Field(default_factory=list)


def _batch_payload(payload: BatchGenerationPayload) -> Dict[str, Any]:
    dump = getattr(payload, "model_dump", None)
    return dump() if callable(dump) else payload.dict()


def validated_batch_capability_payload(
    payload: BatchGenerationPayload,
) -> Dict[str, Any]:
    value = _batch_payload(payload)
    providers = {
        str(item.get("id") or ""): item for item in load_api_providers()
    }
    settings = value.setdefault("settings", {})
    default_provider_id = str(settings.get("provider_id") or "")
    capabilities = []
    for model in value.get("models") or []:
        if isinstance(model, dict):
            provider_id = str(model.get("provider_id") or default_provider_id)
            model_id = str(model.get("model") or model.get("model_id") or "")
        else:
            provider_id = default_provider_id
            model_id = str(model or "")
        capabilities.append(resolved_image_capability(
            providers.get(provider_id, {"id": provider_id}),
            model_id,
        ))
    if not capabilities:
        return value
    shared = intersect_capabilities(capabilities)
    if shared["blocked"]:
        raise BatchGenerationValidation(
            "所选模型没有共同的画幅或 Resolution Tier，请减少或重新选择模型"
        )
    invalid_ratios = [
        ratio
        for ratio in (value.get("ratios") or [])
        if ratio not in shared["aspect_ratios"]
    ]
    if invalid_ratios:
        raise BatchGenerationValidation("所选模型不共同支持当前画幅")
    resolution = str(settings.get("resolution") or "").upper()
    if shared["resolution_tiers"]:
        if not resolution:
            resolution = str(
                shared.get("default_resolution_tier")
                or shared["resolution_tiers"][0]
            ).upper()
            settings["resolution"] = resolution.lower()
        elif resolution not in shared["resolution_tiers"]:
            raise BatchGenerationValidation(
                "所选模型不共同支持当前 Resolution Tier"
            )
    else:
        settings["resolution"] = ""
    return value


def validate_batch_generation_task(task: Dict[str, Any]) -> None:
    settings = task.get("settings") or {}
    provider_id = str(
        task.get("provider_id") or settings.get("provider_id") or ""
    ).strip()
    is_jimeng = provider_id.lower() == "jimeng"
    if not is_jimeng:
        provider = get_api_provider(provider_id)
        is_jimeng = _provider_implementation.is_jimeng_provider(provider)
    if not is_jimeng:
        return
    validation_error = (
        _provider_implementation.jimeng_image_prompt_validation_error(
            task.get("prompt"),
            task.get("model"),
            task.get("reference_images"),
        )
    )
    if validation_error:
        raise BatchGenerationValidation(validation_error)


@app.post("/api/batch-generation/preview")
async def preview_batch_generation(payload: BatchGenerationPayload):
    require_current_user("admin", "designer")
    try:
        return _BATCH_GENERATION.preview(
            validated_batch_capability_payload(payload)
        )
    except BatchGenerationValidation as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/batch-generation/batches")
async def start_batch_generation(payload: BatchGenerationPayload):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.start(
            validated_batch_capability_payload(payload),
            owner=str(actor.get("id") or ""),
        )
    except BatchGenerationValidation as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/batch-generation/history")
@app.get("/api/batch-generation/batches")
async def list_batch_generation(creator: str = "", status: str = ""):
    actor = require_current_user("admin", "designer")
    return {
        "batches": _BATCH_GENERATION.list(
            owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
            creator=creator,
            status=status,
        )
    }


@app.get("/api/batch-generation/batches/{batch_id}")
async def get_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.query(
            batch_id,
            owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


@app.post("/api/batch-generation/batches/{batch_id}/pause")
async def pause_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return _BATCH_GENERATION.pause(
            batch_id, owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


@app.post("/api/batch-generation/batches/{batch_id}/resume")
async def resume_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.resume(
            batch_id, owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


@app.post("/api/batch-generation/batches/{batch_id}/cancel")
async def cancel_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.cancel(
            batch_id, owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


@app.post("/api/batch-generation/batches/{batch_id}/retry-failed")
async def retry_failed_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.retry_failed(
            batch_id, owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


@app.post("/api/batch-generation/batches/{batch_id}/rerun")
async def rerun_batch_generation(batch_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return await _BATCH_GENERATION.rerun(
            batch_id, owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")


class BatchRenamePayload(BaseModel):
    name: str = ""


@app.put("/api/batch-generation/batches/{batch_id}/name")
async def rename_batch_generation(
    batch_id: str,
    payload: BatchRenamePayload,
):
    actor = require_current_user("admin", "designer")
    try:
        return _BATCH_GENERATION.rename(
            batch_id, payload.name,
            owner=str(actor.get("id") or ""),
            admin=actor.get("role") == "admin",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="批次不存在")
    except BatchGenerationValidation as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/image-task-query")
async def query_image_task(payload: ImageTaskQueryRequest):
    actor = require_current_user("admin", "designer")
    owner = str(actor.get("id") or "")
    remote_ref = str(payload.task_id or "").strip()
    provider_id = str(payload.provider_id or "").strip()
    return await _query_generation_remote(
        remote_ref,
        provider_id=provider_id,
        owner=owner,
        fallback_request=RecoveryRun(
            provider_id=provider_id,
            remote_ref=remote_ref,
        ),
        fallback_key=f"image-recovery:{provider_id}:{remote_ref}",
        failure_as_result=True,
    )


_DIAGNOSTIC_SECRET_KEY = re.compile(
    r"(?:api[_-]?key|token|authorization|cookie|password|secret|credential)",
    re.IGNORECASE,
)
_DIAGNOSTIC_PARAMETER_KEYS = {
    "kind", "provider_id", "model", "size", "quality", "count", "n",
    "width", "height", "resolution", "aspect_ratio", "ratio", "duration",
    "fps", "seed", "steps", "strength", "style", "mode", "workflow",
    "submission_count", "publication", "media_kind",
}
_DIAGNOSTIC_BILLING_KEYS = {
    "cost", "fee", "charged", "charge", "credits", "currency",
    "refund", "refunded", "auto_refunded", "billing_status",
}


def _diagnostic_safe_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(
        r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+",
        r"\1[REDACTED]",
        text,
    )
    text = re.sub(
        r"(?i)((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+",
        r"\1[REDACTED]",
        text,
    )
    text = re.sub(r"data:[^\s,;]+;base64,[A-Za-z0-9+/=]+", "[BASE64 OMITTED]", text)
    text = re.sub(r"https?://[^\s]+", "[URL OMITTED]", text)
    text = re.sub(r"(?:[A-Za-z]:\\|/(?:Users|home|private|var|tmp)/)[^\s]+", "[PATH OMITTED]", text)
    return text[:8000]


def _diagnostic_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _diagnostic_safe_text(value)
    return None


def _diagnostic_parameters(request_data: Any) -> dict[str, Any]:
    if not isinstance(request_data, dict):
        return {}
    source = dict(request_data)
    if isinstance(source.get("settings"), dict):
        source.update(source["settings"])
    payload = source.get("payload")
    if isinstance(payload, dict):
        source.update(payload)
    result: dict[str, Any] = {}
    for key, value in source.items():
        normalized = str(key or "").lower()
        if normalized not in _DIAGNOSTIC_PARAMETER_KEYS:
            continue
        safe = _diagnostic_scalar(value)
        if safe not in (None, ""):
            result[normalized] = safe
    return result


def _diagnostic_reference_summary(request_data: Any) -> list[dict[str, Any]]:
    if not isinstance(request_data, dict):
        return []
    references = request_data.get("references") or []
    if not isinstance(references, (list, tuple)):
        return []
    summary = []
    for item in references[:32]:
        if isinstance(item, dict):
            source_url = str(item.get("url") or item.get("src") or "")
            name = item.get("name") or item.get("filename") or Path(
                urllib.parse.urlparse(source_url).path
            ).name
            kind = item.get("kind") or item.get("type") or ""
            width = item.get("width") or 0
            height = item.get("height") or 0
        else:
            name = Path(urllib.parse.urlparse(str(item or "")).path).name
            kind = ""
            width = height = 0
        safe_item = {
            "name": Path(str(name)).name if name else "",
            "kind": _diagnostic_safe_text(kind),
        }
        if int(width or 0) > 0 and int(height or 0) > 0:
            safe_item["width"] = int(width)
            safe_item["height"] = int(height)
        summary.append(safe_item)
    return summary


def _diagnostic_billing_evidence(value: Any, *, depth: int = 0) -> dict[str, Any]:
    if depth > 4:
        return {}
    evidence: dict[str, Any] = {}
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key or "").lower()
            if normalized in _DIAGNOSTIC_BILLING_KEYS:
                safe = _diagnostic_scalar(item)
                if safe not in (None, ""):
                    evidence[normalized] = safe
            elif isinstance(item, (dict, list, tuple)):
                evidence.update(_diagnostic_billing_evidence(item, depth=depth + 1))
    elif isinstance(value, (list, tuple)):
        for item in value[:32]:
            evidence.update(_diagnostic_billing_evidence(item, depth=depth + 1))
    return evidence


def _safe_canvas_run_diagnostics(run) -> dict[str, Any]:
    request_data = dict(getattr(run, "request_data", {}) or {})
    children = []
    for attempt in tuple(getattr(run, "child_attempts", ()) or ())[:100]:
        if not isinstance(attempt, dict):
            continue
        raw = attempt.get("raw")
        remote_ref = _diagnostic_safe_text(attempt.get("remote_ref") or "")
        if remote_ref in {"[URL OMITTED]", "[PATH OMITTED]"}:
            remote_ref = ""
        child = {
            "index": int(attempt.get("index") or 0),
            "status": _diagnostic_safe_text(attempt.get("status") or ""),
            "upstream_task_id": remote_ref,
            "technical_error": _diagnostic_safe_text(attempt.get("error") or ""),
            "billing_evidence": _diagnostic_billing_evidence(raw),
        }
        if isinstance(raw, dict):
            child["upstream_error_code"] = _diagnostic_safe_text(
                raw.get("error_code") or raw.get("code") or ""
            )
            child["http_status"] = int(raw.get("status_code") or 0)
        children.append(child)
    remote_refs = []
    for item in tuple(getattr(run, "remote_refs", ()) or ())[:100]:
        safe = _diagnostic_safe_text(item)
        if safe and safe not in {"[URL OMITTED]", "[PATH OMITTED]"}:
            remote_refs.append(safe)
    return {
        "application_version": current_app_version(),
        "generation_run_id": run.id,
        "request_fingerprint": run.request_hash,
        "recoverable": bool(run.recoverable),
        "provider_id": _diagnostic_safe_text(getattr(run, "provider_id", "")),
        "parameters": _diagnostic_parameters(request_data),
        "prompt": _diagnostic_safe_text(request_data.get("prompt") or ""),
        "references": _diagnostic_reference_summary(request_data),
        "upstream_task_ids": remote_refs,
        "technical_error": _diagnostic_safe_text(run.error),
        "http_status": int(run.status_code or 0),
        "billing_evidence": _diagnostic_billing_evidence(run.result),
        "tasks": children,
    }


def _public_canvas_run(run):
    metadata = dict(run.public_metadata or {})
    public = {
        "id": run.id,
        "type": metadata.pop("type", run.kind),
        "status": run.status,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "result": run.result,
        "error": run.error,
        "request_hash": run.request_hash,
        "status_code": run.status_code,
        "recoverable": run.recoverable,
        "diagnostics": _safe_canvas_run_diagnostics(run),
    }
    if run.target:
        public.update(
            {
                "actor_id": run.owner,
                "canvas_id": run.target.canvas_id,
                "node_id": run.target.node_id,
                "generation_operation_id": run.target.operation_id,
                "generation_request_index": run.target.request_index,
            }
        )
    public.update(metadata)
    pending = run.result
    if run.status == "jimeng_pending":
        submit_id = (
            getattr(pending, "submit_id", "")
            or (run.remote_refs[0] if run.remote_refs else "")
        )
        media_kind = getattr(
            pending,
            "kind",
            "video" if run.kind == "video" else "image",
        )
        queue_info = getattr(pending, "queue_info", {})
        message = (
            jimeng_pending_payload(pending)["message"]
            if isinstance(pending, BaseException)
            else "即梦任务仍在排队，可稍后继续查询。"
        )
        public.update(
            {
                "jimeng_pending": True,
                "submit_id": submit_id,
                "kind": media_kind,
                "queue_info": queue_info,
                "message": message,
                "result": None,
            }
        )
    if run.status == "discarded":
        public.update(
            {
                "result": None,
                "error": "",
                "message": "目标节点已删除或运行已被替换，生成结果未写回画布",
                "recoverable": True,
            }
        )
    return public

@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: OnlineImageRequest):
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            _online_image_run(payload),
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "online-image",
                "provider_id": payload.provider_id,
                "model": payload.model,
                "operation": (
                    "image.edit"
                    if any(ref.url for ref in payload.reference_images)
                    else "image.generate"
                ),
                "catalog_revision": payload.catalog_revision,
                "capability_schema_version": CAPABILITY_SCHEMA_VERSION,
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
        "actor_id": run.owner,
    }

@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    actor = require_current_user("admin", "designer")
    try:
        run = _GENERATION_RUNS.get(
            task_id,
            owner=str(actor.get("id") or ""),
        )
        if run.status not in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = await _GENERATION_RUNS.resume(
                task_id,
                owner=str(actor.get("id") or ""),
                delivery=Background(),
            )
    except Exception as exc:
        if isinstance(exc, GenerationRunError):
            raise HTTPException(
                status_code=404,
                detail="画布任务不存在，可能服务已重启或任务已过期",
            ) from exc
        raise
    return _public_canvas_run(run)


@app.post("/api/canvas-layer-decomposition-tasks")
async def create_canvas_layer_decomposition_task(
    payload: LayerDecompositionRequest,
):
    # Unlike legacy image endpoints, this paid operation never permits an
    # unauthenticated request even when a caller omits a Canvas target.
    require_current_user("admin", "designer")
    owner, key, target = _generation_target(payload)
    request = _layer_decomposition_run(payload)
    try:
        run = await _GENERATION_RUNS.start(
            request,
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "layer-decomposition",
                "provider_id": "apimart",
                "model": "seedream-5-0-pro",
                "operation": "image.layer_decomposition",
                "catalog_revision": request.settings["catalog_revision"],
                "capability_schema_version": request.settings[
                    "capability_schema_version"
                ],
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
        "actor_id": run.owner,
    }


@app.get("/api/canvas-layer-decomposition-tasks/{task_id}")
async def get_canvas_layer_decomposition_task(task_id: str):
    actor = require_current_user("admin", "designer")
    try:
        run = _GENERATION_RUNS.get(
            task_id,
            owner=str(actor.get("id") or ""),
        )
        if run.status not in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = await _GENERATION_RUNS.resume(
                task_id,
                owner=str(actor.get("id") or ""),
                delivery=Background(),
            )
    except Exception as exc:
        if isinstance(exc, GenerationRunError):
            raise HTTPException(
                status_code=404,
                detail="图层拆分任务不存在，或不属于当前账号",
            ) from exc
        raise
    return _public_canvas_run(run)


@app.post("/api/canvas-comfy-tasks")
async def create_canvas_comfy_task(payload: GenerateRequest):
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            WorkflowRun(
                "comfyui",
                payload,
                provider_id="comfyui",
                publication="history",
            ),
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "comfy",
                "workflow_json": payload.workflow_json,
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
    }

@app.get("/api/canvas-comfy-tasks/{task_id}")
async def get_canvas_comfy_task(task_id: str):
    actor = require_current_user("admin", "designer")
    try:
        run = _GENERATION_RUNS.get(
            task_id,
            owner=str(actor.get("id") or ""),
        )
        if run.status not in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = await _GENERATION_RUNS.resume(
                task_id,
                owner=str(actor.get("id") or ""),
                delivery=Background(),
            )
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail="ComfyUI 任务不存在，可能服务已重启或任务已过期",
        ) from exc
    return _public_canvas_run(run)

# --- 图像生成参数 schema（供客户端动态渲染参数表单，避免把参数写死在前端） ---
IMAGE_PARAM_RATIOS = [
    {"value": "1:1", "label": "1:1"},
    {"value": "3:4", "label": "3:4"},
    {"value": "4:3", "label": "4:3"},
    {"value": "16:9", "label": "16:9"},
    {"value": "9:16", "label": "9:16"},
    {"value": "2:3", "label": "2:3"},
    {"value": "3:2", "label": "3:2"},
]
IMAGE_PARAM_RESOLUTIONS = [
    {"value": "1k", "label": "1K"},
    {"value": "2k", "label": "2K"},
    {"value": "4k", "label": "4K"},
]


def provider_image_capability_data(provider: dict, model: str):
    capabilities = provider.get("image_capabilities")
    if isinstance(capabilities, dict):
        value = capabilities.get(model)
        return value if isinstance(value, dict) else None
    if isinstance(capabilities, list):
        for value in capabilities:
            if (
                isinstance(value, dict)
                and str(value.get("model_id") or "").strip() == model
            ):
                return value
    return None


def resolved_image_capability(provider: dict, model: str):
    return IMAGE_CAPABILITY_REGISTRY.resolve(
        str(provider.get("id") or ""),
        str(model or ""),
        discovered=provider_image_capability_data(provider, str(model or "")),
        provider_default_resolution=str(
            provider.get("default_image_resolution") or ""
        ),
    )


def model_capability_provider(provider_id: str) -> dict:
    target_id = str(provider_id or "").strip().lower()
    return next(
        (
            item
            for item in load_api_providers()
            if str(item.get("id") or "").strip().lower() == target_id
        ),
        {"id": target_id},
    )


def resolved_model_capability(
    provider_id: str,
    model: str,
    operation: str,
    *,
    protocol: str = "",
    base_url: str = "",
):
    provider = model_capability_provider(provider_id)
    request_mode = (
        effective_image_request_mode(provider, model)
        if str(operation or "").startswith("image.")
        else ""
    )
    return MODEL_CAPABILITY_CATALOG.resolve(
        str(provider.get("id") or provider_id),
        str(model or ""),
        str(operation or ""),
        context=ModelCapabilityContext(
            protocol=str(protocol or provider.get("protocol") or ""),
            base_url=str(base_url or provider.get("base_url") or ""),
            image_request_mode=request_mode,
            discovered_image=provider_image_capability_data(provider, str(model or "")),
            default_image_resolution=str(
                provider.get("default_image_resolution") or ""
            ),
            image_reference_maximum=(
                min(6, ONLINE_IMAGE_REFERENCE_MAX)
                if request_mode == "openai-video-proxy"
                else ONLINE_IMAGE_REFERENCE_MAX
            ),
            text_image_maximum=8,
            text_video_maximum=3,
            text_history_maximum=MAX_HISTORY_MESSAGES,
        ),
    )


def raise_model_capability_validation(result: dict) -> None:
    if result.get("valid"):
        return
    errors = result.get("errors") if isinstance(result.get("errors"), list) else []
    error = errors[0] if errors else {"code": "capability_invalid"}
    raise HTTPException(
        status_code=409 if error.get("code") == "catalog_changed" else 422,
        detail=error,
    )

def build_image_param_fields(engine: str, provider: dict, model: str):
    """返回某平台/引擎的图像生成参数字段定义。客户端按 type 动态渲染并回填到生成请求。
    字段 key 直接对应 OnlineImageRequest 的字段名（size/quality/n/reference_images）。"""
    capability = resolved_image_capability(provider, model)
    image_ratios = [
        {"value": value, "label": value}
        for value in capability.aspect_ratios
    ]
    image_resolutions = [
        {"value": value.lower(), "label": value}
        for value in capability.resolution_tiers
    ]
    size_field = {
        "key": "size", "type": "size", "label": "尺寸",
        "ratios": image_ratios,
        "resolutions": image_resolutions,
        "resolution_hidden": not capability.show_resolution_control,
        "default": {
            "ratio": capability.aspect_ratios[0],
            "resolution": (
                capability.default_resolution_tier.lower()
                if capability.default_resolution_tier
                else ""
            ),
        },
    }
    count_field = {
        "key": "n", "type": "int", "label": "数量", "control": "chips",
        "options": [1, 2, 3, 4], "default": 1,
    }
    refs_field = {"key": "reference_images", "type": "refs", "label": "参考图", "max": ONLINE_IMAGE_REFERENCE_MAX}

    if engine == "runninghub":
        # RunningHub 参数按 app/工作流动态，需先选工作流再用 /api/runninghub/workflow-info 拉字段。
        return [{"key": "_rh_notice", "type": "notice",
                 "label": "RunningHub 工作流参数将按所选工作流动态加载（开发中）。"}]

    fields = [size_field]
    if engine in ("api", "volcengine"):
        fields.append({
            "key": "quality", "type": "select", "label": "质量", "control": "chips",
            "options": [
                {"value": "auto", "label": "自动"},
                {"value": "low", "label": "低"},
                {"value": "medium", "label": "中"},
                {"value": "high", "label": "高"},
            ],
            "default": "auto",
        })
    if capability.supports_transparent_png:
        fields.append({
            "key": "transparent_png",
            "type": "boolean",
            "label": "透明 PNG",
            "control": "switch",
            "default": False,
        })
    fields.append(count_field)
    fields.append(refs_field)
    return fields

@app.get("/api/image-params")
async def image_params(provider_id: str = "", model: str = ""):
    target_id = (provider_id or "").strip().lower()
    provider = next(
        (item for item in load_api_providers() if item.get("id") == target_id),
        None,
    )
    engine = (
        _PROVIDER_RUNTIME.image_engine(provider["id"], model)
        if provider
        else "api"
    )
    capability = resolved_image_capability(
        provider or {"id": target_id}, model
    )
    return {
        "engine": engine,
        "submit": "/api/canvas-image-tasks",
        "fields": build_image_param_fields(
            engine, provider or {"id": target_id}, model
        ),
        "capability": capability.public(),
    }


class ImageCapabilitySelection(BaseModel):
    provider_id: str
    model_id: str


class ImageCapabilityIntersectionRequest(BaseModel):
    models: List[ImageCapabilitySelection] = Field(default_factory=list)


class ModelCapabilityValidationRequest(BaseModel):
    provider_id: str = ""
    model_id: str = ""
    operation: str = ""
    catalog_revision: str = ""
    protocol: str = ""
    base_url: str = ""
    inputs: Dict[str, int] = Field(default_factory=dict)
    input_roles: Dict[str, List[str]] = Field(default_factory=dict)
    parameters: Dict[str, Any] = Field(default_factory=dict)


class ModelCapabilityEvidencePayload(BaseModel):
    provider_id: str
    model_id: str
    operation: str
    source_type: str
    source_locator: str
    fetched_at: str
    applicable_version: str
    content_location: str
    excerpt: str


class ModelCapabilityDraftPayload(BaseModel):
    draft_id: str = ""
    provider_id: str
    model_id: str
    operation: str
    capability: Dict[str, Any] = Field(default_factory=dict)
    field_evidence: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    base_catalog_revision: str


class ModelCapabilityReturnPayload(BaseModel):
    note: str


class ModelCapabilityPublishPayload(BaseModel):
    expected_catalog_revision: str


def _model_capability_workbench_actor() -> str:
    actor = require_current_user("admin")
    return str(actor.get("id") or actor.get("username") or "")


def _model_capability_workbench_action(action):
    try:
        return action()
    except ModelCapabilityWorkbenchConflict as error:
        raise HTTPException(
            status_code=409,
            detail={"code": "model_capability_workbench_conflict"},
        ) from error
    except ModelCapabilityWorkbenchValidation as error:
        raise HTTPException(
            status_code=400,
            detail={"code": "model_capability_workbench_invalid"},
        ) from error
    except ModelCapabilityWorkbenchPublication as error:
        raise HTTPException(
            status_code=500,
            detail={"code": "model_capability_catalog_publish_failed"},
        ) from error
    except OSError as error:
        raise HTTPException(
            status_code=500,
            detail={"code": "model_capability_workbench_unavailable"},
        ) from error


@app.get("/api/model-capabilities")
async def model_capability(
    provider_id: str = "",
    model: str = "",
    operation: str = "",
    protocol: str = "",
    base_url: str = "",
):
    return resolved_model_capability(
        provider_id,
        model,
        operation,
        protocol=protocol,
        base_url=base_url,
    )


@app.post("/api/model-capabilities/validate")
async def validate_model_capability(payload: ModelCapabilityValidationRequest):
    capability = resolved_model_capability(
        payload.provider_id,
        payload.model_id,
        payload.operation,
        protocol=payload.protocol,
        base_url=payload.base_url,
    )
    return MODEL_CAPABILITY_CATALOG.validate(
        capability,
        input_counts=payload.inputs,
        input_roles=payload.input_roles,
        parameters=payload.parameters,
        catalog_revision=payload.catalog_revision,
    )


@app.get("/api/admin/model-capability-workbench")
async def model_capability_workbench_snapshot():
    _model_capability_workbench_actor()
    snapshot = _model_capability_workbench_action(
        MODEL_CAPABILITY_WORKBENCH.snapshot
    )
    return {**snapshot, "catalog": MODEL_CAPABILITY_CATALOG.status()}


@app.post("/api/admin/model-capability-evidence")
async def create_model_capability_evidence(
    payload: ModelCapabilityEvidencePayload,
):
    actor_id = _model_capability_workbench_actor()
    return _model_capability_workbench_action(
        lambda: MODEL_CAPABILITY_WORKBENCH.record_evidence(
            **payload.model_dump(), actor_id=actor_id
        )
    )


@app.put("/api/admin/model-capability-drafts")
async def save_model_capability_draft(payload: ModelCapabilityDraftPayload):
    actor_id = _model_capability_workbench_actor()
    return _model_capability_workbench_action(
        lambda: MODEL_CAPABILITY_WORKBENCH.save_draft(
            **payload.model_dump(), actor_id=actor_id
        )
    )


@app.post("/api/admin/model-capability-drafts/{draft_id}/submit")
async def submit_model_capability_draft(draft_id: str):
    actor_id = _model_capability_workbench_actor()
    return _model_capability_workbench_action(
        lambda: MODEL_CAPABILITY_WORKBENCH.submit_for_review(
            draft_id, actor_id=actor_id
        )
    )


@app.post("/api/admin/model-capability-drafts/{draft_id}/return")
async def return_model_capability_draft(
    draft_id: str,
    payload: ModelCapabilityReturnPayload,
):
    actor_id = _model_capability_workbench_actor()
    return _model_capability_workbench_action(
        lambda: MODEL_CAPABILITY_WORKBENCH.return_for_changes(
            draft_id, actor_id=actor_id, note=payload.note
        )
    )


@app.post("/api/admin/model-capability-drafts/{draft_id}/publish")
async def publish_model_capability_draft(
    draft_id: str,
    payload: ModelCapabilityPublishPayload,
):
    actor_id = _model_capability_workbench_actor()
    catalog = {}

    def activate_catalog():
        result = MODEL_CAPABILITY_CATALOG.refresh()
        catalog.update(result)
        return result

    draft = _model_capability_workbench_action(
        lambda: MODEL_CAPABILITY_WORKBENCH.publish(
            draft_id,
            actor_id=actor_id,
            active_catalog_revision=payload.expected_catalog_revision,
            activate=activate_catalog,
        )
    )
    return {"draft": draft, "catalog": catalog}


@app.get("/api/admin/model-capabilities/status")
async def model_capability_catalog_status():
    require_current_user("admin")
    return MODEL_CAPABILITY_CATALOG.status()


@app.post("/api/admin/model-capabilities/refresh")
async def refresh_model_capability_catalog():
    require_current_user("admin")
    result = MODEL_CAPABILITY_CATALOG.refresh()
    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result)
    return result


@app.get("/api/image-model-capabilities")
async def image_model_capability(provider_id: str = "", model: str = ""):
    provider = next(
        (
            item
            for item in load_api_providers()
            if item.get("id") == str(provider_id or "").strip().lower()
        ),
        {"id": str(provider_id or "").strip().lower()},
    )
    return resolved_image_capability(provider, model).public()


@app.post("/api/image-model-capabilities/intersection")
async def image_model_capability_intersection(
    payload: ImageCapabilityIntersectionRequest,
):
    providers = {
        str(item.get("id") or ""): item for item in load_api_providers()
    }
    capabilities = [
        resolved_image_capability(
            providers.get(selection.provider_id, {"id": selection.provider_id}),
            selection.model_id,
        )
        for selection in payload.models
    ]
    return {
        "models": [item.public() for item in capabilities],
        **intersect_capabilities(capabilities),
    }


@app.get("/api/video-model-capabilities")
async def video_model_capability(
    provider_id: str = "",
    model: str = "",
    protocol: str = "",
    base_url: str = "",
):
    return VIDEO_CAPABILITY_REGISTRY.public(
        provider_id,
        model,
        protocol=protocol,
        base_url=base_url,
    )

# --- Canvas Video ---

VIDEO_URL_KEYS = (
    "url", "video_url", "videoUrl", "mp4_url", "mp4Url",
    "output", "output_url", "outputUrl", "download_url", "downloadUrl",
    "video", "src", "uri", "preview_url", "previewUrl", "path",
    "last_frame_url", "lastFrameUrl", "remixed_from_video_id",
)


VIDEO_TASK_SUCCESS_STATUSES = {
    "SUCCESS", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE",
    "DONE", "FINISHED", "FINISH", "OK", "READY",
}
VIDEO_TASK_FAILURE_STATUSES = {
    "FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED",
    "CANCELED", "CANCELLED", "TIMEOUT", "TIMEDOUT", "REJECTED", "EXPIRED",
}


def validate_canvas_video_capability(payload: CanvasVideoRequest) -> dict:
    capability = resolved_model_capability(
        payload.provider_id,
        payload.model,
        "video.generate",
    )
    parameters = {"duration_seconds": int(payload.duration)}
    if payload.aspect_ratio and payload.aspect_ratio != "adaptive":
        parameters["aspect_ratio"] = payload.aspect_ratio
    if payload.resolution:
        parameters["resolution"] = payload.resolution
    if payload.seed is not None:
        parameters["seed"] = payload.seed
    for field, value in (
        ("enhance_prompt", payload.enhance_prompt),
        ("enable_upsample", payload.enable_upsample),
        ("watermark", payload.watermark),
        ("camera_fixed", payload.camerafixed),
        ("generate_audio", payload.generate_audio),
    ):
        if value:
            parameters[field] = True
    result = MODEL_CAPABILITY_CATALOG.validate(
        capability,
        input_counts={
            "text": 1,
            "image": len(payload.images or []),
            "video": len(payload.videos or []),
            "audio": len(payload.audios or []),
        },
        input_roles={
            "image": [str(image.role or "") for image in payload.images or []]
        },
        parameters=parameters,
        catalog_revision=str(payload.catalog_revision or ""),
    )
    raise_model_capability_validation(result)
    reference_validation = VIDEO_CAPABILITY_REGISTRY.validate_references(
        payload.provider_id,
        payload.model,
        images=payload.images,
        videos=payload.videos,
        audios=payload.audios,
        multimodal=payload.multimodal,
    )
    if not reference_validation["valid"]:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "input_count",
                "field": reference_validation.get("reason") or "reference",
                "actual": reference_validation.get("count"),
                "minimum": reference_validation.get("minimum"),
                "maximum": reference_validation.get("maximum"),
            },
        )
    payload.catalog_revision = capability["catalog_revision"]
    return capability


# ---- 玉玉API（yuli.host）OpenAI 视频格式：/v1/videos（multipart，支持 seconds 时长）----


@app.post("/api/canvas-video")
async def canvas_video(payload: CanvasVideoRequest):
    validate_canvas_video_capability(payload)
    return await _run_generation_inline(VideoRun(payload), payload)


@app.post("/api/canvas-video-tasks")
async def create_canvas_video_task(payload: CanvasVideoRequest):
    capability = validate_canvas_video_capability(payload)
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            VideoRun(payload),
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "video",
                "provider_id": payload.provider_id,
                "model": payload.model,
                "operation": capability["operation"],
                "catalog_revision": capability["catalog_revision"],
                "capability_schema_version": capability[
                    "capability_schema_version"
                ],
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
        "actor_id": run.owner,
    }


@app.get("/api/canvas-video-tasks/{task_id}")
async def get_canvas_video_task(task_id: str):
    actor = require_current_user("admin", "designer")
    try:
        run = _GENERATION_RUNS.get(
            task_id,
            owner=str(actor.get("id") or ""),
        )
        if run.status not in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = await _GENERATION_RUNS.resume(
                task_id,
                owner=str(actor.get("id") or ""),
                delivery=Background(),
            )
    except Exception as exc:
        if isinstance(exc, GenerationRunError):
            raise HTTPException(
                status_code=404,
                detail="画布视频任务不存在，可能服务已重启或任务已过期",
            ) from exc
        raise
    return _public_canvas_run(run)

# --- Canvas LLM ---

async def _canvas_llm_run(payload: CanvasLLMRequest) -> TextRun:
    system_prompt = (payload.system_prompt or "").strip()
    requested_images = list(payload.images or [])
    requested_videos = list(payload.videos or [])
    image_inputs = [img for img in requested_images if is_image_reference_value(img)]
    video_inputs = [video for video in requested_videos if is_video_reference_value(video)]
    if len(image_inputs) != len(requested_images):
        raise HTTPException(
            status_code=422,
            detail={"code": "input_invalid", "field": "image"},
        )
    if len(video_inputs) != len(requested_videos):
        raise HTTPException(
            status_code=422,
            detail={"code": "input_invalid", "field": "video"},
        )
    capability = resolved_model_capability(
        payload.provider,
        payload.model or payload.ms_model,
        "text.generate",
    )
    payload.model = str(capability.get("model_id") or payload.model)
    parameters = {"history": list(payload.messages or [])}
    if system_prompt:
        parameters["system_prompt"] = system_prompt
    validation = MODEL_CAPABILITY_CATALOG.validate(
        capability,
        input_counts={
            "text": 1,
            "image": len(image_inputs),
            "video": len(video_inputs),
        },
        parameters=parameters,
        catalog_revision=str(payload.catalog_revision or ""),
    )
    raise_model_capability_validation(validation)
    payload.catalog_revision = capability["catalog_revision"]
    upstream_messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
    for item in payload.messages:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    # 构造用户消息：有图片/视频时用 OpenAI/Gemini 多模态格式
    requested_image_count = len(requested_images)
    payload.images = list(image_inputs)
    if image_inputs or video_inputs:
        content_parts = [{"type": "text", "text": payload.message}]
        resolved_cli_images = []
        ok_imgs = 0
        for img in image_inputs:
            if not img or not isinstance(img, str):
                continue
            ref_url = media_reference_to_url(img, max_image_size=1024)
            if not ref_url:
                continue
            content_parts.append({"type": "image_url", "image_url": {"url": ref_url}})
            resolved_cli_images.append(img)
            ok_imgs += 1
        ok_videos = 0
        for video in video_inputs:
            if not video or not isinstance(video, str):
                continue
            frame_urls = await video_reference_to_frame_data_urls(video, max_frames=6, max_size=768)
            if frame_urls:
                ok_videos += 1
                content_parts.append({"type": "text", "text": f"以下是视频 {ok_videos} 按时间顺序抽取的关键帧，请结合这些画面理解视频内容。"})
                for frame_url in frame_urls:
                    content_parts.append({"type": "image_url", "image_url": {"url": frame_url}})
                    resolved_cli_images.append(frame_url)
            else:
                ref_url = media_reference_to_url(video)
                if not ref_url:
                    continue
                content_parts.append({"type": "video_url", "video_url": {"url": ref_url}})
                ok_videos += 1
        # CLI text adapters consume payload.images rather than the normalized
        # OpenAI-style message parts. Keep them aligned so rejected values are
        # not reintroduced and extracted video frames remain visible to CLIs.
        payload.images = resolved_cli_images
        print(f"[canvas-llm] model={payload.model} provider={payload.provider} text_len={len(payload.message)} images={ok_imgs}/{requested_image_count} videos={ok_videos}/{len(payload.videos)}")
        upstream_messages.append({"role": "user", "content": content_parts})
    else:
        upstream_messages.append({"role": "user", "content": payload.message})
    return TextRun(
        payload,
        history=tuple(payload.messages),
        messages=tuple(upstream_messages),
    )


@app.post("/api/canvas-llm")
async def canvas_llm(payload: CanvasLLMRequest):
    result = await _run_generation_inline(
        await _canvas_llm_run(payload),
        payload,
    )
    response_payload = {
        "text": result.text.strip() or "接口返回了空回复。",
        "model": result.model,
        "raw_usage": result.raw_usage,
    }
    if result.expose_raw:
        response_payload["raw"] = result.raw
    return response_payload


@app.post("/api/canvas-llm-tasks")
async def create_canvas_llm_task(payload: CanvasLLMRequest):
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            await _canvas_llm_run(payload),
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "canvas-text",
                "provider_id": payload.provider,
                "model": payload.model,
                "operation": "text.generate",
                "catalog_revision": payload.catalog_revision,
                "capability_schema_version": CAPABILITY_SCHEMA_VERSION,
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
        "actor_id": run.owner,
    }


@app.get("/api/canvas-llm-tasks/{task_id}")
async def get_canvas_llm_task(task_id: str):
    actor = require_current_user("admin", "designer")
    owner = str(actor.get("id") or "")
    try:
        run = _GENERATION_RUNS.get(task_id, owner=owner)
        if run.status not in {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }:
            run = await _GENERATION_RUNS.resume(
                task_id,
                owner=owner,
                delivery=Background(),
            )
    except Exception as exc:
        if isinstance(exc, GenerationRunError):
            raise HTTPException(
                status_code=404,
                detail="画布文本任务不存在，可能服务已重启或任务已过期",
            ) from exc
        raise
    return _public_canvas_run(run)

# --- 画布管理 ---


@app.get("/api/workspace-assets")
async def list_workspace_assets(
    query: str = "",
    cursor: str = "",
    folder_id: str = "",
    limit: int = 30,
):
    actor = require_current_user("admin", "designer")
    try:
        return current_workspace_asset_library().list(
            actor,
            query=query,
            cursor=cursor,
            folder_id=folder_id,
            limit=limit,
        )
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.post("/api/workspace-assets/publish")
async def publish_workspace_assets(payload: WorkspaceAssetPublishRequest):
    actor = require_current_user("admin", "designer")
    raw_items = payload.items
    try:
        candidates = [workspace_asset_candidate(item) for item in raw_items]
        return current_workspace_asset_library().publish(candidates, actor)
    except AssetLibraryBatchError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": str(exc),
                **exc.result,
            },
        )
    except AssetLibraryError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": str(exc),
                "created": 0,
                "existing": 0,
                "failed": max(1, len(raw_items)),
                "entries": [],
            },
        )


@app.post("/api/workspace-assets/import")
async def import_workspace_assets(
    files: List[UploadFile] = File(...),
    folder_id: str = Form(""),
):
    actor = require_current_user("admin", "designer")
    if len(files) > ASSET_LIBRARY_IMPORT_MAX_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"每次最多导入 {ASSET_LIBRARY_IMPORT_MAX_FILES} 张图片",
        )
    candidates = []
    failures = []
    for index, file in enumerate(files):
        filename = Path(file.filename or f"图片 {index + 1}").name
        try:
            content = await read_upload_limited(file)
            if not content:
                raise WorkspaceStorageError("所选图片为空")
            content_type = str(file.content_type or "").split(";", 1)[0].lower()
            if (
                Path(filename).suffix.lower() not in ASSET_LIBRARY_IMPORT_EXTENSIONS
                or (content_type and not content_type.startswith("image/"))
            ):
                raise WorkspaceStorageError("资产库批量导入只支持图片")
            try:
                with Image.open(BytesIO(content)) as image:
                    image.verify()
            except (OSError, ValueError) as exc:
                raise WorkspaceStorageError("文件不是可读取的图片") from exc
            imported = current_workspace_media().import_bytes(
                content,
                name=filename,
                content_type=content_type,
            )
            if imported.kind != "image":
                raise WorkspaceStorageError("资产库批量导入只支持图片")
            candidates.append(
                AssetPublicationCandidate(
                    media_id=imported.media_id,
                    media_url=imported.url,
                    name=filename or "未命名图片",
                    project_id="",
                    canvas_id="",
                    node_id="",
                )
            )
        except HTTPException as exc:
            failures.append(
                {"index": index, "name": filename, "reason": str(exc.detail)}
            )
        except (WorkspaceStorageError, AssetLibraryError) as exc:
            failures.append(
                {"index": index, "name": filename, "reason": str(exc)}
            )
    if not candidates:
        return {
            "created": 0,
            "existing": 0,
            "failed": len(failures),
            "entries": [],
            "failures": failures,
        }
    try:
        result = current_workspace_asset_library().publish(
            candidates,
            actor,
            folder_id=folder_id,
        )
    except AssetLibraryBatchError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": str(exc),
                **exc.result,
                "failed": len(failures) + exc.result["failed"],
                "failures": failures,
            },
        )
    return {
        **result,
        "failed": len(failures),
        "failures": failures,
    }


@app.patch("/api/workspace-assets/{entry_id}")
async def rename_workspace_asset(
    entry_id: str,
    payload: WorkspaceAssetRenameRequest,
):
    actor = require_current_user("admin", "designer")
    try:
        library = current_workspace_asset_library()
        if payload.name is None and payload.folder_id is None:
            raise AssetLibraryError("empty_update", "没有需要保存的更改")
        entry = (
            library.rename(entry_id, payload.name, actor)
            if payload.name is not None
            else None
        )
        if payload.folder_id is not None:
            entry = library.classify(entry_id, payload.folder_id, actor)
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"item": entry}


@app.delete("/api/workspace-assets/{entry_id}")
async def unpublish_workspace_asset(entry_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return current_workspace_asset_library().unpublish(entry_id, actor)
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.post("/api/workspace-assets/folders")
async def create_workspace_asset_folder(payload: WorkspaceAssetFolderRequest):
    actor = require_current_user("admin", "designer")
    try:
        folder = current_workspace_asset_library().create_folder(payload.name, actor)
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"folder": folder}


@app.patch("/api/workspace-assets/folders/{folder_id}")
async def rename_workspace_asset_folder(
    folder_id: str,
    payload: WorkspaceAssetFolderRequest,
):
    actor = require_current_user("admin", "designer")
    try:
        folder = current_workspace_asset_library().rename_folder(
            folder_id, payload.name, actor
        )
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"folder": folder}


@app.delete("/api/workspace-assets/folders/{folder_id}")
async def delete_workspace_asset_folder(folder_id: str):
    actor = require_current_user("admin", "designer")
    try:
        return current_workspace_asset_library().delete_folder(folder_id, actor)
    except AssetLibraryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

@app.get("/api/canvases")
async def canvases(project: str = "", cursor: str = "", limit: int = 0):
    started = time.perf_counter()
    page = list_canvas_page(project=project, cursor=cursor, limit=limit)
    return {
        "canvases": page.records,
        "next_cursor": page.next_cursor,
        "total": page.total,
        "rebuilding": page.rebuilding,
        "index_error": page.index_error,
        "index_read_ms": round((time.perf_counter() - started) * 1000, 2),
    }


class CanvasPresenceSummaryRequest(BaseModel):
    canvas_ids: List[str] = Field(default_factory=list, max_length=200)


@app.post("/api/canvases/presence")
async def canvas_presence_summary(payload: CanvasPresenceSummaryRequest):
    actor = require_current_user("admin", "designer")
    requested = set(payload.canvas_ids)
    # Use current authorized list projections, not full canvas documents or
    # client-supplied project/visibility claims. This never opens editing sockets.
    page = await asyncio.to_thread(list_canvas_page)
    visible_ids = [
        record["id"] for record in page.records
        if record.get("id") in requested
        and record.get("kind") == "smart"
    ]
    return JSONResponse(
        {"canvases": PRESENCE_MANAGER.member_summaries(
            visible_ids, viewer_id=str(actor["id"])
        )},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/projects")
async def get_projects():
    projects, rebuilding, index_error = list_projects(with_status=True)
    return {
        "projects": projects,
        "rebuilding": rebuilding,
        "index_error": index_error,
    }

@app.post("/api/projects")
async def create_project(payload: ProjectCreateRequest):
    require_current_user("admin")
    return {"project": project_record(new_project(payload.name))}

@app.post("/api/projects/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdateRequest):
    require_current_user("admin")
    projects = ensure_default_project()
    target = next((p for p in projects if p.get("id") == project_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="项目不存在")
    if payload.name is not None:
        target["name"] = (str(payload.name).strip() or target.get("name") or "未命名项目")[:60]
    if payload.order is not None:
        target["order"] = int(payload.order)
    target["updated_at"] = now_ms()
    save_projects(projects)
    return {"project": project_record(target)}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    actor = require_current_user("admin")
    result = await submit_canvas_http(
        CanvasCommand(DELETE_PROJECT, project_id),
        actor,
    )
    return result.value

@app.put("/api/admin/accounts/{user_id}/project-permissions")
async def update_account_project_permissions(
    user_id: str,
    payload: AccountProjectPermissionsUpdate,
):
    actor = require_current_user("admin")
    valid_project_ids = {
        str(project.get("id") or "")
        for project in ensure_default_project()
    }
    requested_project_ids = {
        str(project_id or "").strip()
        for project_id in payload.project_ids
        if str(project_id or "").strip()
    }
    unknown = sorted(requested_project_ids - valid_project_ids)
    if unknown:
        raise HTTPException(status_code=400, detail="包含不存在的项目")
    try:
        project_ids = AUTH_SYSTEM.set_user_project_ids(
            user_id,
            current_workspace_id(),
            sorted(requested_project_ids),
            actor_id=actor["id"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "user": enrich_current_workspace_user(AUTH_SYSTEM.get_user(user_id)),
        "project_ids": project_ids,
    }

@app.get("/api/canvases/trash")
async def trashed_canvases():
    return {"canvases": list_deleted_canvases(), "retention_days": 30}

@app.post("/api/canvases")
async def create_canvas(payload: CanvasCreateRequest):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(
            CREATE_CANVAS,
            "",
            canvas_request_values(payload),
        ),
        actor,
    )
    return {"canvas": result.canvas}

@app.post("/api/canvases/meta/batch")
async def update_canvas_meta_batch(payload: CanvasMetaBatchUpdate):
    actor = require_current_user("admin", "designer")
    updated = []
    seen = set()
    for item in payload.updates[:200]:
        canvas_id = str(item.id or "").strip()
        if not canvas_id or canvas_id in seen:
            continue
        seen.add(canvas_id)
        result = await submit_canvas_http(
            CanvasCommand(
                UPDATE_METADATA,
                canvas_id,
                {"board_x": item.board_x, "board_y": item.board_y},
            ),
            actor,
        )
        updated.append(canvas_record(result.canvas))
    return {"canvases": updated}

SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
SHARE_MEDIA_PREVIEW_WIDTHS = (512, 1024, 2048)
SHARE_CANVAS_FIELDS = {
    "id", "title", "icon", "kind", "nodes", "connections", "viewport", "created_at", "updated_at"
}
SHARE_SENSITIVE_KEYS = {
    "api_key", "apikey", "access_token", "refresh_token", "authorization",
    "password", "secret", "cookie", "session", "token",
}
def _share_media_id(canvas_id, url):
    return hashlib.sha256(f"{canvas_id}\0{url}".encode("utf-8")).hexdigest()[:32]

def _share_local_media_url(value):
    text = str(value or "").strip()
    return text if text.startswith(("/assets/", "/api/storage-files/")) else ""

def _share_media_name(value):
    path = urllib.parse.urlsplit(str(value or "")).path
    return os.path.basename(urllib.parse.unquote(path)).strip()

def _share_media_preview_width(value):
    requested = max(1, int(value or SHARE_MEDIA_PREVIEW_WIDTHS[0]))
    return next(
        (width for width in SHARE_MEDIA_PREVIEW_WIDTHS if requested <= width),
        SHARE_MEDIA_PREVIEW_WIDTHS[-1],
    )

def _share_normalize_key(key):
    text = str(key).strip().replace("-", "_")
    text = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", text)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text).lower()

def _rewrite_shared_value(value, token, canvas_id, media):
    if isinstance(value, str):
        local_url = _share_local_media_url(value)
        if local_url:
            media_id = _share_media_id(canvas_id, local_url)
            media[media_id] = local_url
            media_name = _share_media_name(local_url)
            query = f"?name={urllib.parse.quote(media_name)}" if media_name else ""
            return f"/api/shares/{token}/media/{media_id}{query}"
        return value
    if isinstance(value, list):
        return [_rewrite_shared_value(item, token, canvas_id, media) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            normalized_key = _share_normalize_key(key)
            if normalized_key in SHARE_SENSITIVE_KEYS or normalized_key.endswith("_api_key"):
                continue
            result[key] = _rewrite_shared_value(child, token, canvas_id, media)
        return result
    return value

def _active_shared_canvas(token):
    if not SHARE_TOKEN_RE.match(str(token or "")):
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    share = AUTH_SYSTEM.resolve_canvas_share(token, current_workspace_id())
    if not share:
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    canvas = load_shared_canvas(share)
    if canvas.get("deleted_at") or canvas.get("visibility") == "private":
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    return canvas

def _shared_canvas_document(canvas, token):
    media = {}
    public = {
        key: canvas[key]
        for key in SHARE_CANVAS_FIELDS
        if key in canvas
    }
    rewritten = _rewrite_shared_value(public, token, str(canvas.get("id") or ""), media)
    return rewritten, media

def _replace_canvas_share(canvas_id, *, regenerate=False):
    canvas = load_canvas(canvas_id, write=True)
    if canvas.get("visibility") == "private":
        raise HTTPException(status_code=400, detail="仅自己可见的画布不能分享")
    workspace_id = current_workspace_id()
    if (
        AUTH_SYSTEM.canvas_share_status(workspace_id, canvas_id).get("active")
        and not regenerate
    ):
        raise HTTPException(status_code=409, detail="画布已有有效分享，请使用重新生成接口替换旧链接")
    actor = require_current_user("admin", "designer")
    share = AUTH_SYSTEM.replace_canvas_share(
        workspace_id,
        canvas_id,
        actor["id"],
    )
    return {
        "canvas_id": canvas_id,
        "token": share["token"],
        "url": f"/share/{share['token']}",
        "active": True,
        "created_at": share["created_at"],
    }

@app.post("/api/canvases/{canvas_id}/share")
async def create_canvas_share(canvas_id: str):
    return _replace_canvas_share(canvas_id)

@app.post("/api/canvases/{canvas_id}/share/regenerate")
async def regenerate_canvas_share(canvas_id: str):
    return _replace_canvas_share(canvas_id, regenerate=True)

@app.get("/api/canvases/{canvas_id}/share")
async def get_canvas_share_status(canvas_id: str):
    load_canvas(canvas_id)
    status = AUTH_SYSTEM.canvas_share_status(
        current_workspace_id(),
        canvas_id,
    )
    return {
        "canvas_id": canvas_id,
        "active": bool(status.get("active")),
        "created_at": status.get("created_at"),
    }

@app.delete("/api/canvases/{canvas_id}/share")
async def revoke_canvas_share(canvas_id: str):
    load_canvas(canvas_id, write=True)
    actor = require_current_user("admin", "designer")
    AUTH_SYSTEM.revoke_canvas_share(
        current_workspace_id(),
        canvas_id,
        actor["id"],
    )
    return {"ok": True, "active": False}

@app.get("/api/shares/{token}")
async def get_shared_canvas(token: str):
    canvas = _active_shared_canvas(token)
    public, _ = _shared_canvas_document(canvas, token)
    return JSONResponse(
        {"canvas": public, "permissions": {"read": True, "write": False, "download": False}},
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )

@app.get("/api/shares/{token}/media/{media_id}")
async def get_shared_canvas_media(token: str, media_id: str, w: int = 0):
    canvas = _active_shared_canvas(token)
    _, media = _shared_canvas_document(canvas, token)
    source_url = media.get(str(media_id or ""))
    if not source_url:
        raise HTTPException(status_code=404, detail="分享媒体不存在")
    path = output_file_from_url(source_url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="分享媒体不存在")
    response_headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if w:
        return await media_preview_file_response(
            path,
            _share_media_preview_width(w),
            headers=response_headers,
        )
    return FileResponse(
        path,
        media_type=content_type_for_path(path),
        headers=response_headers,
    )

@app.get("/api/canvases/{canvas_id}/meta")
async def get_canvas_meta(canvas_id: str):
    canvas = load_canvas(canvas_id)
    return {
        "id": canvas.get("id"),
        "updated_at": canvas.get("updated_at", 0),
        "title": canvas.get("title", "未命名画布"),
        "icon": canvas.get("icon", "layers"),
        "kind": normalize_canvas_kind(canvas.get("kind")),
        "revision": max(0, int(canvas.get("revision") or 0)),
    }

@app.post("/api/canvases/{canvas_id}/meta")
async def update_canvas_meta(canvas_id: str, payload: CanvasMetaUpdate):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(
            UPDATE_METADATA,
            canvas_id,
            canvas_request_values(payload),
        ),
        actor,
    )
    return {"canvas": canvas_record(result.canvas)}

@app.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str):
    actor = require_current_user("admin", "designer")
    try:
        canvas = CANVAS_SYNC.read(
            canvas_id,
            actor,
            smart_snapshot=True,
        )
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    return {"canvas": canvas}


@app.get("/api/canvases/{canvas_id}/generation-runs/active")
async def get_active_canvas_generation_runs(canvas_id: str):
    actor = require_current_user("admin", "designer")
    try:
        CANVAS_SYNC.read(canvas_id, actor, smart_snapshot=True)
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    runs = _GENERATION_RUNS.active_for_canvas(canvas_id)
    return {
        "runs": [
            {
                "id": run.id,
                "kind": run.kind,
                "status": run.status,
                "actor_id": run.owner,
                "canvas_id": run.target.canvas_id,
                "node_id": run.target.node_id,
                "generation_operation_id": run.target.operation_id,
                "generation_request_index": run.target.request_index,
                "provider_id": run.provider_id,
                "created_at": run.created_at,
                "updated_at": run.updated_at,
            }
            for run in runs
            if run.target is not None
        ]
    }

@app.get("/api/canvases/{canvas_id}/open")
async def open_canvas(canvas_id: str):
    actor = require_current_user("admin", "designer")
    try:
        canvas = CANVAS_SYNC.read(
            canvas_id,
            actor,
            smart_snapshot=True,
        )
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    return StreamingResponse(
        stream_canvas_opening(canvas),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/api/canvases/{canvas_id}/logs")
async def get_canvas_generation_logs(
    canvas_id: str,
    node_id: str = "",
    cursor: str = "",
    limit: int = 50,
):
    actor = require_current_user("admin", "designer")
    try:
        return CANVAS_SYNC.read_generation_log_page(
            canvas_id,
            actor,
            node_id=node_id,
            cursor=cursor,
            limit=limit,
        )
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)

@app.post("/api/canvases/{canvas_id}/logs")
async def append_canvas_generation_log(
    canvas_id: str,
    payload: Dict[str, Any],
):
    actor = require_current_user("admin", "designer")
    try:
        log_id = await CANVAS_SYNC.append_generation_log(
            canvas_id,
            actor,
            payload,
        )
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    return {"log_id": log_id}

@app.get("/api/canvases/{canvas_id}/logs/{log_id}")
async def get_canvas_generation_log_detail(canvas_id: str, log_id: str):
    actor = require_current_user("admin", "designer")
    try:
        log = CANVAS_SYNC.read_generation_log_detail(
            canvas_id,
            actor,
            log_id,
        )
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    return {"log": log}

def require_smart_canvas_view_access(canvas_id: str) -> Dict[str, Any]:
    actor = require_current_user("admin", "designer")
    try:
        canvas = CANVAS_SYNC.read(canvas_id, actor)
    except CanvasSyncError as error:
        raise_canvas_sync_http(error)
    if normalize_canvas_kind(canvas.get("kind")) != "smart":
        raise HTTPException(status_code=400, detail="仅智能画布支持浏览位置记录")
    return actor

@app.get("/api/smart-canvas/{canvas_id}/view-state")
async def get_smart_canvas_view_state(canvas_id: str):
    actor = require_smart_canvas_view_access(canvas_id)
    return {
        "view_state": AUTH_SYSTEM.get_canvas_view_state(
            str(actor["id"]),
            current_workspace_id(),
            canvas_id,
        )
    }

@app.put("/api/smart-canvas/{canvas_id}/view-state")
async def update_smart_canvas_view_state(
    canvas_id: str,
    payload: SmartCanvasViewStateUpdate,
):
    actor = require_smart_canvas_view_access(canvas_id)
    try:
        view_state = AUTH_SYSTEM.save_canvas_view_state(
            str(actor["id"]),
            current_workspace_id(),
            canvas_id,
            center_x=payload.center_x,
            center_y=payload.center_y,
            scale=payload.scale,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"view_state": view_state}


def _validated_smart_canvas_local_image(
    canvas_id: str,
    node_id: str,
    image_index: int,
    *,
    operation_label: str,
):
    canvas = load_canvas(canvas_id, write=True)
    if normalize_canvas_kind(canvas.get("kind")) != "smart":
        raise HTTPException(
            status_code=400,
            detail=f"仅支持智能画布图片{operation_label}",
        )
    node = next(
        (
            item
            for item in (canvas.get("nodes") or [])
            if str(item.get("id") or "") == str(node_id or "")
        ),
        None,
    )
    if not node:
        raise HTTPException(status_code=404, detail="图片节点不存在")
    images = node.get("images") if isinstance(node.get("images"), list) else []
    index = int(image_index)
    if (
        index < 0
        or index >= len(images)
        or not isinstance(images[index], dict)
    ):
        raise HTTPException(status_code=404, detail="图片内容不存在")
    image = images[index]
    media_url = str(image.get("url") or "").strip()
    if not media_url.startswith(("/assets/", "/api/storage-files/")):
        raise HTTPException(
            status_code=400,
            detail="仅支持画布内已受控的本地图片",
        )
    source_path = output_file_from_url(media_url)
    if not source_path or not os.path.isfile(source_path):
        raise HTTPException(status_code=404, detail="图片文件不可访问")
    try:
        with Image.open(source_path) as source_image:
            source_image.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="目标内容不是有效图片",
        ) from exc
    return canvas, node, image, index, media_url, source_path

@app.post("/api/smart-canvas/image-caption")
async def caption_smart_canvas_image(payload: SmartCanvasImageCaptionRequest):
    canvas = load_canvas(payload.canvas_id, write=True)
    if normalize_canvas_kind(canvas.get("kind")) != "smart":
        raise HTTPException(status_code=400, detail="仅支持智能画布图片反推")
    node = next(
        (item for item in (canvas.get("nodes") or []) if str(item.get("id") or "") == str(payload.node_id or "")),
        None,
    )
    if not node:
        raise HTTPException(status_code=404, detail="图片节点不存在")
    images = node.get("images") if isinstance(node.get("images"), list) else []
    index = int(payload.image_index)
    if index < 0 or index >= len(images) or not isinstance(images[index], dict):
        raise HTTPException(status_code=404, detail="图片内容不存在")
    media_url = str(images[index].get("url") or "").strip()
    if not media_url.startswith(("/assets/", "/api/storage-files/")):
        raise HTTPException(status_code=400, detail="仅支持画布内已受控的本地图片")
    path = output_file_from_url(media_url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="图片文件不可访问")
    try:
        with Image.open(path) as source_image:
            source_image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="目标内容不是有效图片") from exc
    prompt = str(payload.prompt or "请反推这张图片的中文 AI 生图提示词").strip()[:8000]
    text, resolved_model = await caption_image_with_provider(
        path,
        prompt,
        payload.provider or get_primary_provider_id(),
        payload.model,
        payload.ms_model,
    )
    return {"ok": True, "text": text, "model": resolved_model}


@app.post("/api/smart-canvas/depth-map")
async def submit_smart_canvas_depth_map(payload: SmartCanvasDepthMapRequest):
    if not (
        str(payload.canvas_id or "").strip()
        and str(payload.source_node_id or "").strip()
        and str(payload.node_id or "").strip()
        and str(payload.generation_operation_id or "").strip()
    ):
        raise HTTPException(status_code=400, detail="深度图任务缺少目标信息")
    _canvas, _source_node, image, index, media_url, _source_path = (
        _validated_smart_canvas_local_image(
            payload.canvas_id,
            payload.source_node_id,
            payload.source_image_index,
            operation_label="生成深度图",
        )
    )
    owner, key, target = _generation_target(payload)
    try:
        run = await _GENERATION_RUNS.start(
            ImageRun(
                prompt="",
                settings={
                    "processor_id": "depth-anything-v2-small",
                    "model": "Depth Anything V2 Small",
                },
                references=(
                    {
                        "url": media_url,
                        "name": str(image.get("name") or "source"),
                        "kind": "image",
                        "nodeId": str(payload.source_node_id),
                        "imageIndex": index,
                    },
                ),
                publication="image-processor",
                effect_context={
                    "source_node_id": str(payload.source_node_id),
                    "source_image_index": index,
                },
            ),
            key=key,
            owner=owner,
            delivery=Background(),
            target=target,
            public_metadata={
                "type": "image-processor",
                "processor_id": "depth-anything-v2-small",
                "model": "Depth Anything V2 Small",
                "phase": "queued",
                "progress": 0,
                "message": "等待处理",
            },
        )
    except Exception as exc:
        _raise_generation_http(exc)
    return {
        "task_id": run.id,
        "status": run.status or "queued",
        "deduplicated": run.deduplicated,
        "actor_id": run.owner,
    }

@app.post("/api/smart-canvas/matting")
async def submit_smart_canvas_matting(payload: SmartCanvasMattingRequest):
    canvas = load_canvas(payload.canvas_id, write=True)
    if normalize_canvas_kind(canvas.get("kind")) != "smart":
        raise HTTPException(status_code=400, detail="仅支持智能画布图片抠图")
    node = next(
        (
            item for item in (canvas.get("nodes") or [])
            if str(item.get("id") or "") == str(payload.node_id or "")
        ),
        None,
    )
    if not node:
        raise HTTPException(status_code=404, detail="图片节点不存在")
    images = node.get("images") if isinstance(node.get("images"), list) else []
    index = int(payload.image_index)
    if index < 0 or index >= len(images) or not isinstance(images[index], dict):
        raise HTTPException(status_code=404, detail="图片内容不存在")
    media_url = str(images[index].get("url") or "").strip()
    if not media_url.startswith(("/assets/", "/api/storage-files/")):
        raise HTTPException(status_code=400, detail="仅支持画布内已受控的本地图片")
    source_path = output_file_from_url(media_url)
    if not source_path or not os.path.isfile(source_path):
        raise HTTPException(status_code=404, detail="图片文件不可访问")
    try:
        with Image.open(source_path) as source_image:
            source_image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="目标内容不是有效图片") from exc

    actor = current_user() or require_current_user("admin", "designer")
    owner_id = str(actor.get("id") or "")
    active_for_user = sum(
        1 for job in MATTING_JOBS.values()
        if job.get("owner_id") == owner_id and job.get("status") in {"queued", "running"}
    )
    if active_for_user >= MATTING_PER_USER_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"每位用户最多同时保留 {MATTING_PER_USER_MAX} 个抠图任务，请等待前序任务完成",
        )
    queue = await ensure_matting_workers()
    if queue.full():
        raise HTTPException(status_code=429, detail="抠图队列已满，请稍后重试")

    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "status": "queued",
        "owner_id": owner_id,
        "canvas_id": str(payload.canvas_id or ""),
        "source_node_id": str(payload.node_id or ""),
        "source_image_index": index,
        "source_path": source_path,
        "client_id": str(payload.client_id or "")[:120],
        "submitted_at": now_ms(),
        "started_at": 0,
        "finished_at": 0,
        "message": "",
    }
    MATTING_JOBS[job_id] = job
    try:
        queue.put_nowait(job_id)
    except asyncio.QueueFull as exc:
        MATTING_JOBS.pop(job_id, None)
        raise HTTPException(status_code=429, detail="抠图队列已满，请稍后重试") from exc
    return public_matting_job(job)

@app.get("/api/smart-canvas/matting/{job_id}")
async def get_smart_canvas_matting(job_id: str):
    actor = require_current_user("admin", "designer")
    job = MATTING_JOBS.get(str(job_id or ""))
    if not job:
        raise HTTPException(status_code=404, detail="抠图任务不存在或服务已重启")
    if actor.get("role") != "admin" and str(job.get("owner_id") or "") != str(actor.get("id") or ""):
        raise HTTPException(status_code=404, detail="抠图任务不存在")
    # Recheck canvas visibility/ownership on every poll instead of treating a
    # bearer job id as permission to fetch a result.
    load_canvas(str(job.get("canvas_id") or ""), write=True)
    return public_matting_job(job)

@app.put("/api/canvases/{canvas_id}/visibility")
async def update_canvas_visibility(canvas_id: str, payload: CanvasVisibilityUpdate):
    actor = require_current_user("admin")
    result = await submit_canvas_http(
        CanvasCommand(
            SET_VISIBILITY,
            canvas_id,
            {"visibility": payload.visibility},
        ),
        actor,
    )
    return {"canvas": canvas_record(result.canvas)}

@app.post("/api/canvases/{canvas_id}/touch")
async def touch_canvas(canvas_id: str):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(TOUCH_CANVAS, canvas_id),
        actor,
    )
    return {
        "canvas": canvas_record(result.canvas),
        "updated_at": result.canvas.get("updated_at", 0),
    }

@app.get("/api/smart-canvas/prompt-templates")
async def smart_canvas_prompt_templates():
    try:
        template_path = prompt_template_markdown_path()
        source = os.path.relpath(template_path, BASE_DIR).replace("\\", "/") if template_path else ""
        return {"templates": builtin_prompt_templates(), "source": source}
    except Exception as e:
        print(f"读取提示词模板失败: {e}")
        return {"templates": []}

@app.post("/api/canvas-assets/check")
async def check_canvas_assets(payload: CanvasAssetCheckRequest):
    result = {}
    for url in payload.urls[:3000]:
        text = str(url or "").strip()
        if not text:
            continue
        if text.startswith("/assets/"):
            result[text] = bool(output_file_from_url(text))
        else:
            result[text] = True
    return {"exists": result}

@app.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: CanvasAssetDownloadRequest):
    buffer = BytesIO()
    used_names = set()
    count = 0
    raw_items = payload.items or [{"url": url} for url in payload.urls]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw in raw_items[:1000]:
            if isinstance(raw, dict):
                text = str(raw.get("url") or "").strip()
                requested_name = str(raw.get("name") or "").strip()
            else:
                text = str(raw or "").strip()
                requested_name = ""
            if not text:
                continue
            path = output_file_from_url(text)
            content = None
            content_type = ""
            if path and os.path.isfile(path):
                base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
            else:
                local_by_name = local_media_file_by_basename(filename_from_media_url(text, ""))
                if local_by_name and os.path.isfile(local_by_name):
                    path = local_by_name
                    base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                else:
                    try:
                        remote = fetch_remote_media_bytes(text)
                    except Exception:
                        remote = None
                    if not remote:
                        continue
                    content, content_type = remote
                    base = sanitize_export_filename(requested_name or filename_from_media_url(text, f"image-{count + 1}.bin"), f"image-{count + 1}.bin")
            name, ext = os.path.splitext(base)
            archive_name = base
            suffix = 2
            while archive_name in used_names:
                archive_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(archive_name)
            if path and os.path.isfile(path):
                zf.write(path, archive_name)
            else:
                zf.writestr(archive_name, content)
            count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可下载的本地图片")
    buffer.seek(0)
    filename = re.sub(r'[\\/:*?"<>|]+', "_", payload.filename or "canvas-output-images.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)

def sanitize_export_filename(name: str, fallback: str) -> str:
    base = os.path.basename(str(name or "").strip()) or fallback
    base = re.sub(r'[\\/:*?"<>|]+', "_", base)
    return base or fallback

def canvas_workflow_collect_resource_refs(value, found=None):
    if found is None:
        found = []
    if isinstance(value, dict):
        for item in value.values():
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, list):
        for item in value:
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith("/assets/") and output_file_from_url(text):
            found.append(text)
    return found

def canvas_workflow_unique_archive_name(base, used):
    safe = sanitize_export_filename(base, "resource.bin")
    name, ext = os.path.splitext(safe)
    archive = safe
    idx = 2
    while archive in used:
        archive = f"{name}-{idx}{ext}"
        idx += 1
    used.add(archive)
    return archive

def canvas_workflow_replace_strings(value, mapping):
    if isinstance(value, dict):
        return {k: canvas_workflow_replace_strings(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [canvas_workflow_replace_strings(item, mapping) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value

def canvas_workflow_payload(nodes, connections, resources=None):
    return {
        "format": "infinite-canvas-workflow",
        "version": 1,
        "exported_at": now_ms(),
        "nodes": nodes or [],
        "connections": connections or [],
        "resources": resources or [],
    }

def build_canvas_workflow_archive(payload: CanvasWorkflowExportRequest) -> Tuple[bytes, Dict[str, Any]]:
    nodes_payload = payload.nodes or []
    connections_payload = payload.connections or []
    if not nodes_payload:
        raise HTTPException(status_code=400, detail="没有可导出的节点")
    buffer = BytesIO()
    resources = []
    used = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if payload.include_resources:
            for url in canvas_workflow_collect_resource_refs(nodes_payload):
                if any(item.get("url") == url for item in resources):
                    continue
                path = output_file_from_url(url)
                if not path or not os.path.isfile(path):
                    continue
                archive_name = canvas_workflow_unique_archive_name(os.path.basename(path), used)
                archive_path = f"resources/{archive_name}"
                zf.write(path, archive_path)
                resources.append({
                    "url": url,
                    "archive": archive_path,
                    "name": os.path.basename(path),
                    "size": os.path.getsize(path),
                })
        workflow = canvas_workflow_payload(nodes_payload, connections_payload, resources)
        zf.writestr("workflow.json", json.dumps(workflow, ensure_ascii=False, indent=2))
    buffer.seek(0)
    return buffer.getvalue(), {"resources": resources, "node_count": len(nodes_payload), "connection_count": len(connections_payload)}

@app.post("/api/canvas-workflows/export")
async def export_canvas_workflow(payload: CanvasWorkflowExportRequest):
    archive, _ = build_canvas_workflow_archive(payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(archive, media_type="application/zip", headers=headers)


@app.get("/api/canvas-workflows/limits")
async def canvas_workflow_limits():
    return {
        "max_archive_bytes": MAX_WORKFLOW_ARCHIVE_BYTES,
        "max_extracted_bytes": MAX_WORKFLOW_EXTRACTED_BYTES,
        "max_entries": MAX_WORKFLOW_ARCHIVE_ENTRIES,
    }


def inspect_canvas_workflow_bytes(raw: bytes, filename: str = "") -> Dict[str, Any]:
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    name = str(filename or "").lower()
    workflow = None
    archive_sizes: Dict[str, int] = {}
    try:
        if name.endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(BytesIO(raw), "r") as archive:
                validate_workflow_archive(archive)
                candidates = [item for item in archive.namelist() if item.lower().endswith("workflow.json")]
                workflow_name = "workflow.json" if "workflow.json" in archive.namelist() else (candidates[0] if candidates else "")
                if not workflow_name:
                    raise HTTPException(status_code=400, detail="压缩包中没有 workflow.json")
                workflow = json.loads(archive.read(workflow_name).decode("utf-8-sig"))
                archive_sizes = {item.filename: max(0, int(item.file_size)) for item in archive.infolist()}
        else:
            workflow = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无法读取压缩包") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法解析工作流文件：{exc}") from exc
    if isinstance(workflow, list):
        workflow = {"nodes": workflow, "connections": [], "resources": []}
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="工作流格式不正确")
    nodes_payload = workflow.get("nodes")
    connections_payload = workflow.get("connections")
    resources_payload = workflow.get("resources")
    if nodes_payload is None and isinstance(workflow.get("workflow"), dict):
        nested = workflow["workflow"]
        nodes_payload = nested.get("nodes")
        connections_payload = nested.get("connections")
        resources_payload = nested.get("resources", resources_payload)
    if not isinstance(nodes_payload, list):
        raise HTTPException(status_code=400, detail="工作流 JSON 缺少 nodes")
    if not nodes_payload:
        raise HTTPException(status_code=400, detail="工作流中没有可导入的节点")
    if not isinstance(connections_payload, list):
        connections_payload = []
    if not isinstance(resources_payload, list):
        resources_payload = []
    resource_bytes = 0
    for resource in resources_payload:
        if not isinstance(resource, dict):
            continue
        archive_name = str(resource.get("archive") or "").replace("\\", "/").lstrip("/")
        try:
            declared_size = max(0, int(resource.get("size") or 0))
        except (TypeError, ValueError):
            declared_size = 0
        resource_bytes += archive_sizes.get(archive_name, declared_size)
    return {
        "node_count": len(nodes_payload),
        "connection_count": len(connections_payload),
        "resource_count": len([item for item in resources_payload if isinstance(item, dict)]),
        "resource_bytes": resource_bytes,
        "package_type": "zip" if name.endswith(".zip") or raw[:2] == b"PK" else "json",
        "warning": "",
    }

@app.post("/api/canvas-workflows/inspect")
async def inspect_canvas_workflow(file: UploadFile = File(...)):
    raw = await read_upload_limited(file, MAX_WORKFLOW_ARCHIVE_BYTES)
    return inspect_canvas_workflow_bytes(raw, file.filename or "")

@app.post("/api/canvas-workflows/import")
async def import_canvas_workflow(file: UploadFile = File(...)):
    raw = await read_upload_limited(file, MAX_WORKFLOW_ARCHIVE_BYTES)
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    name = str(file.filename or "").lower()
    resource_mapping = {}
    workflow = None
    try:
        if name.endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(BytesIO(raw), "r") as zf:
                validate_workflow_archive(zf)
                candidates = [n for n in zf.namelist() if n.lower().endswith("workflow.json")]
                workflow_name = "workflow.json" if "workflow.json" in zf.namelist() else (candidates[0] if candidates else "")
                if not workflow_name:
                    raise HTTPException(status_code=400, detail="压缩包中没有 workflow.json")
                workflow = json.loads(zf.read(workflow_name).decode("utf-8-sig"))
                stamp = time.strftime("%Y%m%d-%H%M%S")
                import_dir = os.path.join(
                    generation_input_directory(),
                    f"workflow_import_{stamp}_{uuid.uuid4().hex[:6]}",
                )
                os.makedirs(import_dir, exist_ok=True)
                for res in workflow.get("resources") or []:
                    archive = str(res.get("archive") or "").replace("\\", "/").lstrip("/")
                    if not archive or archive not in zf.namelist():
                        continue
                    base = sanitize_export_filename(res.get("name") or os.path.basename(archive), os.path.basename(archive) or "resource.bin")
                    target = os.path.join(import_dir, f"{uuid.uuid4().hex[:8]}_{base}")
                    with zf.open(archive) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    rel = os.path.relpath(
                        target,
                        managed_media_directory(),
                    ).replace("\\", "/")
                    new_url = f"/assets/{rel}"
                    old_url = str(res.get("url") or "").strip()
                    if old_url:
                        resource_mapping[old_url] = new_url
                    resource_mapping[archive] = new_url
                    resource_mapping[f"./{archive}"] = new_url
                    resource_mapping[os.path.basename(archive)] = new_url
        else:
            workflow = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无法读取压缩包") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法解析工作流文件：{exc}") from exc
    if isinstance(workflow, list):
        workflow = {"nodes": workflow, "connections": []}
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="工作流格式不正确")
    nodes_payload = workflow.get("nodes")
    connections_payload = workflow.get("connections")
    if nodes_payload is None and isinstance(workflow.get("workflow"), dict):
        nodes_payload = workflow["workflow"].get("nodes")
        connections_payload = workflow["workflow"].get("connections")
    if not isinstance(nodes_payload, list):
        raise HTTPException(status_code=400, detail="工作流 JSON 缺少 nodes")
    if not isinstance(connections_payload, list):
        connections_payload = []
    if resource_mapping:
        nodes_payload = canvas_workflow_replace_strings(nodes_payload, resource_mapping)
        connections_payload = canvas_workflow_replace_strings(connections_payload, resource_mapping)
    return {
        "workflow": canvas_workflow_payload(nodes_payload, connections_payload, workflow.get("resources") or []),
        "nodes": nodes_payload,
        "connections": connections_payload,
        "resource_map": resource_mapping,
    }

def smart_group_export_folder(folder: str, group_name: str) -> str:
    text = str(folder or "").strip()
    if text:
        path = os.path.abspath(os.path.expanduser(text))
    else:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe_group = sanitize_export_filename(group_name or "group", "group")
        path = os.path.abspath(
            os.path.join(
                generation_output_directory(),
                "exports",
                "smart-groups",
                f"{safe_group}-{stamp}",
            )
        )
    os.makedirs(path, exist_ok=True)
    return path

@app.post("/api/smart-canvas/group-export")
async def export_smart_canvas_group(payload: SmartCanvasGroupExportRequest):
    target_dir = smart_group_export_folder(payload.folder, payload.group_name)
    used_names = set()
    count = 0
    text_index = 1
    for item in payload.items[:2000]:
        kind = str(item.kind or "").lower()
        if kind == "text":
            text = str(item.text or "")
            if not text.strip():
                continue
            base = sanitize_export_filename(item.name or f"{text_index}.txt", f"{text_index}.txt")
            if not base.lower().endswith(".txt"):
                base += ".txt"
            text_index += 1
            name, ext = os.path.splitext(base)
            out_name = base
            suffix = 2
            while out_name in used_names:
                out_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(out_name)
            with open(os.path.join(target_dir, out_name), "w", encoding="utf-8") as f:
                f.write(text)
            count += 1
            continue
        src = output_file_from_url(item.url)
        if not src or not os.path.isfile(src):
            continue
        base = sanitize_export_filename(item.name or os.path.basename(src), os.path.basename(src) or f"asset-{count + 1}")
        name, ext = os.path.splitext(base)
        if not ext:
            _, src_ext = os.path.splitext(src)
            ext = src_ext or ".bin"
            base = name + ext
        out_name = base
        suffix = 2
        while out_name in used_names:
            out_name = f"{name}-{suffix}{ext}"
            suffix += 1
        used_names.add(out_name)
        shutil.copy2(src, os.path.join(target_dir, out_name))
        count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可导出的内容")
    return {"ok": True, "folder": target_dir, "count": count}

@app.get("/api/canvases/{canvas_id}/prompt-templates")
async def get_canvas_prompt_templates(canvas_id: str):
    canvas = load_canvas(canvas_id)
    return {
        "canvas_id": canvas_id,
        "revision": max(0, int(canvas.get("revision") or 0)),
        "updated_at": max(0, int(canvas.get("updated_at") or 0)),
        "templates": public_canvas_prompt_templates(canvas),
    }

@app.post("/api/canvases/{canvas_id}/prompt-templates")
async def create_canvas_prompt_template(
    canvas_id: str,
    payload: CanvasPromptTemplateRequest,
):
    canvas = load_canvas(canvas_id, write=True)
    operation_id = prompt_template_operation_id(payload.operation_id)
    item_id = canvas_prompt_template_id(canvas_id, operation_id)
    items = canvas_prompt_templates(canvas)
    existed_before = any(item.get("id") == item_id for item in items)
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    item = normalize_canvas_prompt_template({
        "id": item_id,
        "name": payload.name,
        "positive": payload.positive,
        "cover": payload.cover or "",
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
    item.pop("created_at", None)
    item.pop("updated_at", None)
    saved = await commit_canvas_prompt_intent(
        canvas_id,
        {
            "action": "create",
            "item": item,
        },
        operation_id=operation_id,
        client_id=payload.client_id,
    )
    saved_items = public_canvas_prompt_templates(saved)
    saved_item = next(item for item in saved_items if item.get("id") == item_id)
    return {
        "canvas_id": canvas_id,
        "revision": max(0, int(saved.get("revision") or 0)),
        "updated_at": max(0, int(saved.get("updated_at") or 0)),
        "templates": saved_items,
        "item": saved_item,
        "duplicate": existed_before,
    }

@app.patch("/api/canvases/{canvas_id}/prompt-templates/{item_id}")
async def update_canvas_prompt_template(
    canvas_id: str,
    item_id: str,
    payload: CanvasPromptTemplateRequest,
):
    canvas = load_canvas(canvas_id, write=True)
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    patch = {
        "name": sanitize_asset_name(payload.name or "提示词", "提示词"),
        "positive": str(payload.positive or "").strip(),
    }
    if payload.cover is not None:
        patch["cover"] = str(payload.cover or "").strip()[:8000]
    prompt_intent = {
        "action": "update",
        "item_id": item_id,
        "patch": patch,
    }
    if payload.expected_item_version:
        prompt_intent["expected_item_version"] = payload.expected_item_version
    else:
        prompt_intent["base_revision"] = payload.base_revision
    saved = await commit_canvas_prompt_intent(
        canvas_id,
        prompt_intent,
        operation_id=payload.operation_id,
        client_id=payload.client_id,
    )
    saved_items = public_canvas_prompt_templates(saved)
    updated = next(item for item in saved_items if item.get("id") == item_id)
    return {
        "canvas_id": canvas_id,
        "revision": max(0, int(saved.get("revision") or 0)),
        "updated_at": max(0, int(saved.get("updated_at") or 0)),
        "templates": saved_items,
        "item": updated,
    }

@app.delete("/api/canvases/{canvas_id}/prompt-templates/{item_id}")
async def delete_canvas_prompt_template(
    canvas_id: str,
    item_id: str,
    operation_id: str,
    base_revision: int,
    client_id: str = "",
    expected_item_version: str = "",
):
    load_canvas(canvas_id, write=True)
    prompt_intent = {
        "action": "delete",
        "item_id": item_id,
    }
    if expected_item_version:
        prompt_intent["expected_item_version"] = expected_item_version
    else:
        prompt_intent["base_revision"] = base_revision
    saved = await commit_canvas_prompt_intent(
        canvas_id,
        prompt_intent,
        operation_id=operation_id,
        client_id=client_id,
    )
    return {
        "canvas_id": canvas_id,
        "revision": max(0, int(saved.get("revision") or 0)),
        "updated_at": max(0, int(saved.get("updated_at") or 0)),
        "templates": public_canvas_prompt_templates(saved),
        "removed": 1,
    }

@app.post("/api/prompt-libraries/items/{item_id}/copy-to-canvas")
async def copy_common_prompt_template_to_canvas(
    item_id: str,
    payload: CanvasPromptTemplateCopyRequest,
):
    require_current_user("admin", "designer")
    canvas = load_canvas(payload.canvas_id, write=True)
    operation_id = prompt_template_operation_id(payload.operation_id)
    target_id = canvas_prompt_template_id(payload.canvas_id, operation_id)
    canvas_items = canvas_prompt_templates(canvas)
    existing_target = next(
        (item for item in canvas_items if item.get("id") == target_id),
        None,
    )
    existed_before = existing_target is not None
    if existing_target:
        item = copy.deepcopy(existing_target)
        item.pop("created_at", None)
        item.pop("updated_at", None)
    else:
        data = load_prompt_libraries()
        _library, source = find_common_prompt_item(
            data,
            item_id,
            payload.library_id,
        )
        if not source:
            raise HTTPException(status_code=404, detail="通用提示词不存在")
        item = normalize_canvas_prompt_template({
            "id": target_id,
            "name": source.get("name"),
            "positive": source.get("positive"),
            "cover": source.get("cover"),
        })
        item.pop("created_at", None)
        item.pop("updated_at", None)
    saved = await commit_canvas_prompt_intent(
        payload.canvas_id,
        {
            "action": "create",
            "item": item,
        },
        operation_id=operation_id,
        client_id=payload.client_id,
    )
    saved_items = public_canvas_prompt_templates(saved)
    saved_item = next(item for item in saved_items if item.get("id") == target_id)
    return {
        "canvas_id": payload.canvas_id,
        "revision": max(0, int(saved.get("revision") or 0)),
        "updated_at": max(0, int(saved.get("updated_at") or 0)),
        "templates": saved_items,
        "item": saved_item,
        "duplicate": existed_before,
    }

@app.post("/api/canvases/{canvas_id}/prompt-templates/{item_id}/promote")
async def promote_canvas_prompt_template(
    canvas_id: str,
    item_id: str,
    payload: CanvasPromptTemplatePromotionRequest,
):
    require_current_user("admin", "designer")
    canvas = load_canvas(canvas_id, write=True)
    operation_id = prompt_template_operation_id(payload.operation_id)
    data = load_prompt_libraries()
    library = find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="通用提示词库不存在")
    category = next(
        (
            item
            for item in library.get("categories") or []
            if isinstance(item, dict) and item.get("id") == payload.category
        ),
        None,
    )
    if not category:
        raise HTTPException(status_code=400, detail="设为通用前必须选择通用分类")
    target_id = "tpl_" + hashlib.sha256(
        f"promote\0{canvas_id}\0{operation_id}".encode("utf-8")
    ).hexdigest()[:20]
    existing_common = next(
        (
            item
            for item in library.get("items") or []
            if isinstance(item, dict) and item.get("id") == target_id
        ),
        None,
    )
    canvas_items = canvas_prompt_templates(canvas)
    source = next(
        (item for item in canvas_items if item.get("id") == item_id),
        None,
    )
    prompt_intent = {
        "action": "delete",
        "item_id": item_id,
        "promotion": {
            "library_id": payload.library_id,
            "category": payload.category,
            "target_id": target_id,
        },
    }
    if payload.expected_item_version:
        prompt_intent["expected_item_version"] = payload.expected_item_version
    else:
        prompt_intent["base_revision"] = payload.base_revision
    if not source:
        saved = await commit_canvas_prompt_intent(
            canvas_id,
            prompt_intent,
            operation_id=operation_id,
            client_id=payload.client_id,
        )
        if not existing_common:
            raise HTTPException(status_code=409, detail="设为通用的结果不完整，请重试")
        return {
            "library": public_prompt_libraries(data),
            "item": existing_common,
            "canvas_id": canvas_id,
            "revision": max(0, int(saved.get("revision") or 0)),
            "updated_at": max(0, int(saved.get("updated_at") or 0)),
            "templates": public_canvas_prompt_templates(saved),
            "duplicate": True,
        }
    created_common = False
    if not existing_common:
        existing_common = normalize_prompt_library_item({
            **source,
            "id": target_id,
            "category": payload.category,
            "created_at": now_ms(),
            "updated_at": now_ms(),
        })
        library.setdefault("items", []).insert(0, existing_common)
        save_prompt_libraries(data)
        created_common = True
    try:
        saved = await commit_canvas_prompt_intent(
            canvas_id,
            prompt_intent,
            operation_id=operation_id,
            client_id=payload.client_id,
        )
    except Exception:
        if created_common:
            library["items"] = [
                item
                for item in library.get("items") or []
                if not isinstance(item, dict) or item.get("id") != target_id
            ]
            save_prompt_libraries(data)
        raise
    return {
        "library": public_prompt_libraries(load_prompt_libraries()),
        "item": existing_common,
        "canvas_id": canvas_id,
        "revision": max(0, int(saved.get("revision") or 0)),
        "updated_at": max(0, int(saved.get("updated_at") or 0)),
        "templates": public_canvas_prompt_templates(saved),
        "duplicate": False,
    }


@app.post("/api/prompt-libraries/covers")
async def upload_prompt_library_cover(file: UploadFile = File(...)):
    require_current_user("admin", "designer")
    filename = Path(file.filename or "prompt-cover").name
    try:
        content = await read_upload_limited(file)
        cover = current_prompt_library_storage().import_cover_bytes(
            content,
            name=filename,
            content_type=file.content_type or "",
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"cover": cover}


@app.get("/api/prompt-libraries/covers/{filename}")
async def get_prompt_library_cover(filename: str):
    require_current_user("admin", "designer")
    try:
        path, content_type = current_prompt_library_storage().resolve_cover(
            filename
        )
    except WorkspaceStorageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@app.get("/api/prompt-libraries")
async def get_prompt_libraries():
    require_current_user("admin", "designer")
    return {"library": public_prompt_libraries()}

@app.post("/api/prompt-libraries")
async def create_prompt_library(payload: PromptLibraryRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    library = {
        "id": f"lib_{uuid.uuid4().hex[:12]}",
        "name": sanitize_asset_name(payload.name, "提示词库"),
        "type": "prompt",
        "categories": [],
        "items": [],
    }
    data.setdefault("libraries", []).append(library)
    data["active_library_id"] = library["id"]
    data = save_prompt_libraries(data)
    new_lib = next((lib for lib in data.get("libraries", []) if lib.get("id") == library["id"]), library)
    return {"library": public_prompt_libraries(data), "prompt_library": new_lib}

@app.patch("/api/prompt-libraries/{library_id}")
async def rename_prompt_library(library_id: str, payload: PromptLibraryRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    library = find_prompt_library(data, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    library["name"] = sanitize_asset_name(payload.name, library.get("name") or "提示词库")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "prompt_library": library}

@app.delete("/api/prompt-libraries/{library_id}")
async def delete_prompt_library(library_id: str):
    require_current_user("admin", "designer")
    if library_id == "system":
        raise HTTPException(status_code=400, detail="通用范围不能删除，可以管理其中的分类和提示词")
    data = load_prompt_libraries()
    libraries = data.get("libraries", []) or []
    kept = [lib for lib in libraries if lib.get("id") != library_id]
    if len(kept) == len(libraries):
        raise HTTPException(status_code=404, detail="提示词库不存在")
    data["libraries"] = kept
    if data.get("active_library_id") == library_id:
        data["active_library_id"] = "system"
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

@app.post("/api/prompt-libraries/items")
async def add_prompt_library_item(payload: PromptLibraryItemRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    library = find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    item = normalize_prompt_library_item({
        "id": f"tpl_{uuid.uuid4().hex[:12]}",
        "name": payload.name,
        "category": payload.category,
        "positive": payload.positive,
        "negative": payload.negative,
        "cover": payload.cover or "",
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
    library.setdefault("items", []).insert(0, item)
    data["active_library_id"] = library.get("id") or data.get("active_library_id")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "item": item}

@app.patch("/api/prompt-libraries/items/{item_id}")
async def update_prompt_library_item(item_id: str, payload: PromptLibraryItemRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    for library in data.get("libraries", []) or []:
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for index, item in enumerate(library.get("items", []) or []):
            if item.get("id") == item_id:
                next_item = normalize_prompt_library_item({
                    **item,
                    "name": payload.name or item.get("name"),
                    "category": payload.category or item.get("category"),
                    "positive": payload.positive or item.get("positive"),
                    "negative": payload.negative,
                    "cover": item.get("cover") if payload.cover is None else payload.cover,
                    "updated_at": now_ms(),
                })
                library["items"][index] = next_item
                data = save_prompt_libraries(data)
                return {"library": public_prompt_libraries(data), "item": next_item}
    raise HTTPException(status_code=404, detail="提示词不存在")

@app.delete("/api/prompt-libraries/items/{item_id}")
async def delete_prompt_library_item(item_id: str, library_id: str = ""):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    removed = None
    for library in data.get("libraries", []) or []:
        if library_id and library.get("id") != library_id:
            continue
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") == item_id:
                removed = item
            else:
                keep.append(item)
        library["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="提示词不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "removed": 1}

@app.post("/api/prompt-libraries/items/delete")
async def batch_delete_prompt_library_items(payload: PromptLibraryBatchDeleteRequest):
    require_current_user("admin", "designer")
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择提示词")
    data = load_prompt_libraries()
    removed = 0
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") in ids:
                removed += 1
            else:
                keep.append(item)
        library["items"] = keep
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "removed": removed}

PROMPT_BUILTIN_CATEGORY_IDS = {"view", "storyboard", "character", "product", "lighting", "custom"}

@app.post("/api/prompt-libraries/categories")
async def add_prompt_library_category(payload: PromptLibraryCategoryRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    library = find_prompt_library(data, payload.library_id)
    if not library and not payload.library_id and not data.get("libraries"):
        library = {
            "id": "common",
            "name": "通用",
            "type": "prompt",
            "categories": [],
            "items": [],
        }
        data.setdefault("libraries", []).append(library)
        data["active_library_id"] = library["id"]
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    name = sanitize_asset_name(payload.name, "新分组")
    existing = {str(c.get("id")) for c in (library.get("categories") or []) if isinstance(c, dict)} | PROMPT_BUILTIN_CATEGORY_IDS
    cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    while cat_id in existing:
        cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    category = {"id": cat_id, "name": name}
    library.setdefault("categories", []).append(category)
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "category": category}

@app.patch("/api/prompt-libraries/{library_id}/categories/order")
async def reorder_prompt_library_categories(library_id: str, payload: PromptLibraryCategoryReorderRequest):
    require_current_user("admin", "designer")
    data = load_prompt_libraries()
    library = find_prompt_library(data, library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    categories = [category for category in (library.get("categories") or []) if isinstance(category, dict)]
    category_by_id = {str(category.get("id")): category for category in categories if category.get("id")}
    requested_ids = []
    for value in payload.category_ids or []:
        category_id = str(value or "").strip()
        if category_id in category_by_id and category_id not in requested_ids:
            requested_ids.append(category_id)
    if not requested_ids:
        raise HTTPException(status_code=400, detail="没有可排序的分组")
    requested_ids.extend(category_id for category_id in category_by_id if category_id not in requested_ids)
    library["categories"] = [category_by_id[category_id] for category_id in requested_ids]
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "categories": library["categories"]}

@app.patch("/api/prompt-libraries/categories/{category_id}")
async def rename_prompt_library_category(category_id: str, payload: PromptLibraryCategoryRequest):
    require_current_user("admin", "designer")
    if category_id == PROMPT_UNCATEGORIZED_CATEGORY_ID:
        raise HTTPException(status_code=400, detail="“未分类”由系统管理，不能重命名")
    # 系统库（内置）分组也允许重命名：分组的 id 不变，只改显示名。
    name = sanitize_asset_name(payload.name, "")
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    data = load_prompt_libraries()
    updated = False
    for library in data.get("libraries", []) or []:
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories") or []:
            if isinstance(cat, dict) and cat.get("id") == category_id:
                cat["name"] = name
                updated = True
    if not updated:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

@app.delete("/api/prompt-libraries/categories/{category_id}")
async def delete_prompt_library_category(category_id: str, library_id: str = ""):
    require_current_user("admin", "designer")
    if category_id == PROMPT_UNCATEGORIZED_CATEGORY_ID:
        raise HTTPException(status_code=400, detail="“未分类”由系统管理，不能删除")
    # 系统库（内置）分组也允许删除。
    data = load_prompt_libraries()
    found = False
    for library in data.get("libraries", []) or []:
        if library_id and library.get("id") != library_id:
            continue
        cats = library.get("categories") or []
        kept = [c for c in cats if not (isinstance(c, dict) and c.get("id") == category_id)]
        if len(kept) != len(cats):
            found = True
            library["categories"] = kept
            moved_items = [
                item
                for item in library.get("items", []) or []
                if isinstance(item, dict) and item.get("category") == category_id
            ]
            if moved_items:
                uncategorized = next(
                    (
                        category
                        for category in kept
                        if isinstance(category, dict)
                        and category.get("id") == PROMPT_UNCATEGORIZED_CATEGORY_ID
                    ),
                    None,
                )
                if not uncategorized:
                    kept.append({
                        "id": PROMPT_UNCATEGORIZED_CATEGORY_ID,
                        "name": PROMPT_UNCATEGORIZED_CATEGORY_NAME,
                    })
                for item in moved_items:
                    item["category"] = PROMPT_UNCATEGORIZED_CATEGORY_ID
    if not found:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

async def caption_image_with_provider(abs_path, prompt, provider_id, model, ms_model=""):
    prompt_text = (prompt or "描述图片").strip() or "描述图片"
    payload = CanvasLLMRequest(
        message=prompt_text,
        provider=provider_id,
        model=model,
        ms_model=ms_model,
        images=[abs_path],
    )
    data_url = image_path_to_data_url(abs_path, max_size=1024)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }]
    result = await _run_generation_inline(
        TextRun(
            payload=payload,
            messages=tuple(messages),
        )
    )
    return result.text.strip() or "接口返回了空回复。", result.model

@app.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: CanvasSaveRequest):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(
            action=SAVE_SNAPSHOT,
            canvas_id=canvas_id,
            values=canvas_request_values(payload),
        ),
        actor,
    )
    return {"canvas": result.canvas}

@app.delete("/api/canvases/{canvas_id}")
async def delete_canvas(canvas_id: str):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(TRASH_CANVAS, canvas_id),
        actor,
    )
    return result.value

@app.post("/api/canvases/{canvas_id}/restore")
async def restore_canvas(canvas_id: str):
    actor = require_current_user("admin", "designer")
    result = await submit_canvas_http(
        CanvasCommand(RESTORE_CANVAS, canvas_id),
        actor,
    )
    return {"canvas": result.canvas}

@app.delete("/api/canvases/{canvas_id}/purge")
async def purge_canvas(canvas_id: str):
    actor = require_current_user("admin")
    result = await submit_canvas_http(
        CanvasCommand(PURGE_CANVAS, canvas_id),
        actor,
    )
    AUTH_SYSTEM.delete_canvas_view_states(
        current_workspace_id(),
        canvas_id,
    )
    return result.value

# --- 历史记录 ---

@app.get("/api/history")
async def get_history_api(type: str = None):
    return await _GENERATION_EFFECTS.history(type)

@app.get("/api/history/page")
async def get_history_page_api(
    type: str = None,
    limit: int = 50,
    cursor: str = "",
):
    page = await _GENERATION_EFFECTS.history_page(
        media_type=str(type or ""),
        limit=limit,
        cursor=cursor,
    )
    return {
        "items": [dict(item) for item in page.items],
        "next_cursor": page.next_cursor,
    }

@app.get("/api/history/{history_id}")
async def get_history_detail_api(history_id: str):
    record = await _GENERATION_EFFECTS.history_by_id(history_id)
    if record is None:
        raise HTTPException(status_code=404, detail="History record not found")
    return dict(record)

@app.get("/api/queue_status")
async def get_queue_status(client_id: str):
    with QUEUE_LOCK:
        total = len(QUEUE)
        positions = [i + 1 for i, t in enumerate(QUEUE) if t["client_id"] == client_id]
        position = positions[0] if positions else 0
    return {"total": total, "position": position}

@app.post("/api/history/delete")
async def delete_history(req: DeleteHistoryRequest):
    return await _GENERATION_EFFECTS.delete_history(
        req.timestamp,
        history_id=req.history_id,
    )

# --- ModelScope 角度控制 ---

@app.post("/api/angle/poll_status")
async def poll_angle_cloud(req: CloudPollRequest):
    actor = current_user() or {}
    owner = str(actor.get("id") or "")
    remote_ref = str(req.task_id or "").strip()
    return await _query_generation_remote(
        remote_ref,
        provider_id="modelscope",
        owner=owner,
        fallback_request=WorkflowRun(
            "modelscope-angle-recovery",
            req,
            provider_id="modelscope",
            publication="history",
            effect_context={
                "history": {
                    "prompt": f"Resumed {req.task_id}",
                    "type": "angle",
                }
            },
        ),
        fallback_key=f"modelscope-angle-recovery:{remote_ref}",
    )

@app.post("/api/angle/generate")
async def generate_angle_cloud(req: CloudGenRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "modelscope-angle",
            req,
            provider_id="modelscope",
            publication="history",
            effect_context={
                "history": {
                    "prompt": req.prompt,
                    "type": "angle",
                    "model": req.model,
                }
            },
        )
    )

# --- ModelScope Z-Image 云端生图 ---

@app.post("/generate")
async def generate_cloud(req: CloudGenRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "modelscope-cloud",
            req,
            provider_id="modelscope",
            publication="history",
            effect_context={
                "history": {
                    "prompt": req.prompt,
                    "type": "cloud",
                }
            },
        )
    )

# --- ModelScope 通用图片生成（支持图生图） ---

@app.post("/api/ms/generate")
async def ms_generate(req: MsGenerateRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "modelscope",
            req,
            provider_id="modelscope",
            publication="history",
            effect_context={
                "history": {
                    "prompt": req.prompt,
                    "type": "klein",
                    "model": req.model,
                }
            },
        ),
        req,
    )

# --- 本地 ComfyUI 生图 ---

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "comfyui",
            req,
            provider_id="comfyui",
            publication="history",
        ),
        req,
    )

# --- ComfyUI 工作流管理 ---

CUSTOM_WORKFLOW_FOLDER = "custom"
LEGACY_CUSTOM_WORKFLOW_FOLDER = "自定义"
HIDDEN_BUILTIN_WORKFLOWS = {
    "Z-Image.json",
    "Z-Image-Enhance.json",
    "2511.json",
    "klein-enhance.json",
    "Flux2-Klein.json",
    "upscale.json",
}
WORKFLOW_NAME_RE = re.compile(rf"^(?:(?:{CUSTOM_WORKFLOW_FOLDER}|{LEGACY_CUSTOM_WORKFLOW_FOLDER})/)?[a-zA-Z0-9_一-龥\.\-]+\.json$")

class WorkflowField(BaseModel):
    id: str
    node: str = ""
    input: str = ""
    name: str = ""
    type: str = "text"
    default: Any = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: List[str] = []
    random_enabled: bool = False

class WorkflowConfig(BaseModel):
    title: str = ""
    fields: List[WorkflowField] = []
    mini_cards: Dict[str, Any] = {}

class WorkflowUploadRequest(BaseModel):
    name: str
    workflow: Dict[str, Any]

class WorkflowRunRequest(BaseModel):
    fields: Dict[str, Any] = {}
    config: WorkflowConfig
    client_id: str = ""


class ComfyInstancesPayload(BaseModel):
    instances: List[str] = []

@app.get("/api/comfyui/instances")
def get_comfyui_instances():
    return _provider_implementation.get_comfyui_instances()

@app.put("/api/comfyui/instances")
def save_comfyui_instances(payload: ComfyInstancesPayload):
    # 宽容校验：去前后空白、去 http(s):// 前缀、去尾部斜杠；要求形如 host:port
    return _provider_implementation.save_comfyui_instances(payload)

@app.get("/api/workflows")
def list_workflows():
    return _provider_implementation.list_workflows()

@app.get("/api/workflows/{name:path}")
def get_workflow(name: str):
    return _provider_implementation.get_workflow(name)

@app.post("/api/workflows")
def upload_workflow(payload: WorkflowUploadRequest):
    return _provider_implementation.upload_workflow(payload)

@app.put("/api/workflows/{name:path}/config")
def save_workflow_config(name: str, payload: WorkflowConfig):
    return _provider_implementation.save_workflow_config(name, payload)

@app.delete("/api/workflows/{name:path}")
def delete_workflow(name: str):
    return _provider_implementation.delete_workflow(name)

@app.post("/api/workflows/{name:path}/run")
async def run_workflow(name: str, payload: WorkflowRunRequest):
    return await _run_generation_inline(
        WorkflowRun(
            "comfyui-saved",
            {"name": name, "payload": payload},
            provider_id="comfyui",
            publication="history",
        )
    )


# Provider implementations own vendor protocols; the application entrypoint
# supplies explicit, typed ports.  Values remain late-bound to this application
# module so runtime workspace switches and test/extension replacements are
# visible without restoring globals injection.
_PROVIDER_PORTS = ProviderPorts.from_namespace(globals())
install_provider_ports(_PROVIDER_PORTS)
_provider_implementation = bind_provider_implementation(
    _provider_implementation, _PROVIDER_PORTS
)
for _provider_export_name in _provider_implementation._CATEGORY_EXPORTS:
    if _provider_export_name == "jimeng_use_wsl":
        continue
    globals()[_provider_export_name] = getattr(
        _provider_implementation, _provider_export_name
    )
_PROVIDER_RUNTIME = ProviderRuntime(
    # Keep the legacy patch/export name as the lookup adapter while callers
    # migrate to the registry seam.
    provider_lookup=lambda provider_id: get_api_provider(provider_id),
    image_registry=build_image_registry(
        ImageExecutors(
            http=_provider_implementation.generate_http_provider_image,
            modelscope=_provider_implementation.generate_modelscope_provider_image,
            codex=_provider_implementation.generate_codex_provider_image,
            gemini_cli=_provider_implementation.generate_gemini_cli_provider_image,
            jimeng=_provider_implementation.generate_jimeng_provider_image,
            runninghub=generate_runninghub_provider_image,
            gemini_native=_provider_implementation.generate_gemini_provider_image,
            volcengine=_provider_implementation.generate_volcengine_provider_image,
        )
    ),
    video_registry=build_video_registry(
        VideoExecutors(
            http=_provider_implementation.generate_http_provider_video,
            jimeng=_provider_implementation.generate_jimeng_video,
            runninghub=_provider_implementation.generate_runninghub_video,
        )
    ),
    text_registry=build_text_registry(
        TextExecutors(
            http=_provider_implementation.execute_http_text,
            http_stream=_provider_implementation.execute_http_text_stream,
            codex=_provider_implementation.codex_chat_text,
            gemini_cli=_provider_implementation.gemini_cli_chat_text,
            codex_default_model=CODEX_DEFAULT_CHAT_MODELS[0],
            gemini_cli_default_model=GEMINI_CLI_DEFAULT_CHAT_MODELS[0],
        )
    ),
    recovery_registry=build_recovery_registry(
        RecoveryExecutors(
            http=_provider_implementation.recover_http_image_task,
            runninghub=_provider_implementation.recover_runninghub_image_task,
            jimeng=_provider_implementation.recover_jimeng_media,
            modelscope=(
                _provider_implementation.recover_modelscope_provider_image
            ),
        )
    ),
    workflow_registry=build_workflow_registry(
        WorkflowExecutors(
            comfyui=_provider_implementation.execute_comfyui_workflow,
            comfyui_recovery=(
                _provider_implementation.execute_comfyui_recovery
            ),
            comfyui_saved=(
                _provider_implementation.execute_comfyui_saved_workflow
            ),
            modelscope=_provider_implementation.execute_modelscope_workflow,
            modelscope_recovery=(
                _provider_implementation.execute_modelscope_recovery
            ),
            modelscope_cloud=(
                _provider_implementation.execute_modelscope_cloud_workflow
            ),
            modelscope_angle=(
                _provider_implementation.execute_modelscope_angle_workflow
            ),
            modelscope_angle_recovery=(
                _provider_implementation.execute_modelscope_angle_recovery
            ),
            runninghub_submit=(
                _provider_implementation.execute_runninghub_workflow_submit
            ),
            runninghub_query=(
                _provider_implementation.execute_runninghub_workflow_query
            ),
            runninghub_app_submit=(
                _provider_implementation.execute_runninghub_app_submit
            ),
            runninghub_upload_asset=(
                _provider_implementation.execute_runninghub_upload_asset
            ),
        )
    ),
)
_PROVIDER_INSPECTORS = build_inspector_runtime(
    InspectorFunctions(
        http_test=_provider_implementation.test_http_provider_connection,
        codex_status=_provider_implementation.codex_status,
        codex_models=_provider_implementation.codex_models_payload,
        gemini_cli_status=_provider_implementation.gemini_cli_status,
        gemini_cli_models=_provider_implementation.gemini_cli_models_payload,
        jimeng_status=_provider_implementation.jimeng_status,
        jimeng_models=_provider_implementation.jimeng_models_payload,
        runninghub_models=_provider_implementation.runninghub_models_payload,
        fetch_models=_provider_implementation.fetch_upstream_models,
        jimeng_image_models=tuple(JIMENG_DEFAULT_IMAGE_MODELS),
        jimeng_video_models=tuple(JIMENG_DEFAULT_VIDEO_MODELS),
        runninghub_default_base_url=RUNNINGHUB_DEFAULT_BASE_URL,
    )
)


async def _publish_generation_notification(record, *, effect_id=""):
    await manager.broadcast_new_image(record, effect_id=effect_id)


_GENERATION_WORKER_ID = f"{current_workspace_id()}:{os.getpid()}"
_GENERATION_SQLITE_RUNTIME = (
    GenerationSqliteRuntime(
        store=WORKSPACE_STORAGE_COMPOSITION.generation_run_store,
        target=CanvasSyncGenerationEffectTarget(
            canvas_sync=CANVAS_SYNC,
            actor_by_id=lambda user_id: enrich_current_workspace_user(
                AUTH_SYSTEM.get_user(user_id)
            ),
        ),
        worker_id=_GENERATION_WORKER_ID,
    )
    if (
        WORKSPACE_STORAGE_COMPOSITION is not None
        and WORKSPACE_STORAGE_COMPOSITION.sqlite_ready
    )
    else None
)

_DEPTH_PROCESSOR = DepthAnythingV2SmallProcessor(
    model_dir=(
        DEVICE_CACHE.image_processor_models
        / "depth-anything-v2-small"
    ),
)
_GENERATION_EXECUTOR = LocalImageProcessorGenerationExecutor(
    delegate=ProviderGenerationExecutor(_PROVIDER_RUNTIME),
    processor=_DEPTH_PROCESSOR,
    resolve_media=output_file_from_url,
    result_path=lambda key: (
        DEVICE_CACHE.image_processor_results / f"{key}.png"
    ),
)

_GENERATION_OUTPUT_PORTS = GenerationOutputPorts(
    save_image=_provider_implementation.save_ai_image_to_output,
    image_meta=_provider_implementation.image_output_meta,
    extract_images=_provider_implementation.extract_images,
    now=time.time,
    now_ms=now_ms,
    output_file_from_url=output_file_from_url,
    save_video=_provider_implementation.save_remote_video_to_output,
    save_asset=_provider_implementation.save_remote_asset_to_output,
    save_text=_provider_implementation.save_comfy_text_output,
    materialize_image=materialize_generation_image,
)

_GENERATION_EFFECTS = (
    WorkspaceGenerationEffects(
        _GENERATION_OUTPUT_PORTS,
        publication=SqliteGenerationPublication(
            store=WORKSPACE_STORAGE_COMPOSITION.generation_run_store,
            store_executor=_GENERATION_SQLITE_RUNTIME.store_executor,
            notify=_publish_generation_notification,
            worker_id=_GENERATION_WORKER_ID,
            output_file_from_url=output_file_from_url,
        ),
    )
    if _GENERATION_SQLITE_RUNTIME is not None
    else WorkspaceGenerationEffects(
        GenerationEffectPorts(
            history_path=lambda: current_workspace_content().generation_history,
            journal_path=lambda: current_workspace_content().generation_effects,
            history_lock=HISTORY_LOCK,
            save_image=_provider_implementation.save_ai_image_to_output,
            image_meta=_provider_implementation.image_output_meta,
            extract_images=_provider_implementation.extract_images,
            notify=_publish_generation_notification,
            now=time.time,
            now_ms=now_ms,
            output_file_from_url=output_file_from_url,
            save_video=_provider_implementation.save_remote_video_to_output,
            save_asset=_provider_implementation.save_remote_asset_to_output,
            save_text=_provider_implementation.save_comfy_text_output,
            materialize_image=materialize_generation_image,
        )
    )
)

_GENERATION_RUNS = GenerationRuns(
    executor=_GENERATION_EXECUTOR,
    effects=_GENERATION_EFFECTS,
    store_path=(
        None
        if _GENERATION_SQLITE_RUNTIME is not None
        else lambda: (
            current_workspace_content().generation_runs
            if WORKSPACE_CONFIGURED
            else None
        )
    ),
    target_guard=CanvasGenerationTargetGuard(
        canvas_sync=CANVAS_SYNC,
        actor_by_id=lambda user_id: enrich_current_workspace_user(
            AUTH_SYSTEM.get_user(user_id)
        ),
    ),
    lifecycle_store=(
        _GENERATION_SQLITE_RUNTIME.lifecycle_store
        if _GENERATION_SQLITE_RUNTIME is not None
        else None
    ),
)
generation_run_control.install(_GENERATION_RUNS)


async def _submit_batch_generation_task(task, *, owner, batch_id):
    settings = dict(task.get("settings") or {})
    provider_id = str(
        task.get("provider_id") or settings.get("provider_id") or ""
    )
    references = [
        {"url": str(value.get("url") if isinstance(value, dict) else value),
         "name": str(value.get("name") if isinstance(value, dict) else "参考图片")}
        for value in task.get("reference_images") or []
    ]
    batch_sizes = {
        "1k": {"1:1":"1024x1024", "2:3":"1024x1536", "3:2":"1536x1024", "3:4":"1008x1344", "4:3":"1344x1008", "9:16":"720x1280", "16:9":"1280x720"},
        "2k": {"1:1":"2048x2048", "2:3":"1360x2048", "3:2":"2048x1360", "3:4":"1536x2048", "4:3":"2048x1536", "9:16":"1152x2048", "16:9":"2048x1152"},
        "4k": {"1:1":"3840x3840", "2:3":"2352x3520", "3:2":"3520x2352", "3:4":"2448x3264", "4:3":"3264x2448", "9:16":"2160x3840", "16:9":"3840x2160"},
    }
    resolution = str(settings.get("resolution") or "").lower()
    ratio_value = str(task.get("ratio") or "1:1")
    request_size = (
        batch_sizes.get(resolution, {}).get(ratio_value, "auto")
        if resolution
        else "auto"
    )
    run = await _GENERATION_RUNS.start(
        ImageRun(
            prompt=str(task.get("prompt") or ""),
            settings={
                **settings,
                "provider_id": provider_id,
                "model": str(task.get("model") or ""),
                "ratio": ratio_value,
                "size": request_size,
                "requested_size": request_size,
                "target_aspect_ratio": ratio_value,
                "resolution_tier": resolution.upper(),
            },
            references=tuple(image_references(references)),
            count=max(
                1,
                int(
                    task.get("outputs_per_submission")
                    or task.get("outputs")
                    or 1
                ),
            ),
            submission_count=max(1, int(task.get("submissions") or 1)),
            publication="batch-generation",
            effect_context={
                "batch_id": batch_id,
                "batch_name": str(task.get("batch_name") or batch_id),
                "task_index": task.get("index"),
                "model_name": str(
                    task.get("model_name") or task.get("model") or ""
                ),
            },
        ),
        key=f"batch-generation:{batch_id}:{task.get('index')}",
        owner=owner,
        delivery=Background(),
        public_metadata={
            "type": "batch-generation",
            "batch_id": batch_id,
            "task_index": task.get("index"),
        },
    )
    return {
        "run_id": run.id,
        "status": run.status,
        "outputs": [],
    }


_BATCH_GENERATION = BatchGeneration(
    (
        current_workspace_content().batch_generation
        if WORKSPACE_CONFIGURED
        else Path(SETUP_STATE_DIR) / "unavailable-batch-generation.sqlite3"
    ),
    submit=_submit_batch_generation_task,
    inspect_run=lambda run_id, owner: _GENERATION_RUNS.get(
        run_id, owner=owner
    ),
    cancel_run=lambda run_id, owner: _GENERATION_RUNS.cancel(
        run_id, owner=owner
    ),
    task_validator=validate_batch_generation_task,
    system_limit=int(os.getenv("BATCH_GENERATION_SYSTEM_CONCURRENCY", "32")),
    provider_limit=int(os.getenv("BATCH_GENERATION_PROVIDER_CONCURRENCY", "32")),
    user_limit=int(os.getenv("BATCH_GENERATION_USER_CONCURRENCY", "32")),
)
