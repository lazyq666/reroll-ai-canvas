"""Side-effect-free HTTP shell and application factory."""

from __future__ import annotations

import asyncio
import html
import ipaddress
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal, Optional, Protocol

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .runtime import ApplicationRuntime, RuntimeStage
from .workspace_storage import WorkspaceStorageError


_RUNTIME_PATHS = (
    "/api/runtime/",
    "/api/workspace-move/",
    "/ws/workspace-move",
    "/workspace-move",
    "/startup",
    "/recovery",
)
_SETUP_PATHS = {
    "/",
    "/setup",
    "/api/setup",
    "/api/setup/status",
    "/api/setup/select-directory",
    "/api/setup/inspect-workspace",
    "/api/setup/open-workspace",
}
_SETUP_PREFIXES = (
    "/static/",
)
_MAINTENANCE_INITIATOR_PATHS = {
    "/api/setup/open-workspace",
    "/api/workspace-storage-settings/open",
    "/api/workspace-storage-settings/move",
}


class RestartRequest(BaseModel):
    cancel_active: bool = False


class StorageMigrationRequest(BaseModel):
    migration_id: str = ""
    approved: bool = False


class RecoveryRequest(BaseModel):
    workspace_directory: str = ""
    parent_dir: str = ""
    intent: Literal["reconnect", "open_other", "create_new"] = "reconnect"

    def selected_directory(self) -> str:
        return self.workspace_directory or self.parent_dir


class WorkspaceRecovery(Protocol):
    def inspect_current(self) -> dict[str, object]: ...

    def inspect(
        self,
        parent_dir: str,
        *,
        intent: str,
    ) -> dict[str, object]: ...

    def stage_retry(self) -> dict[str, object]: ...

    def stage(
        self,
        parent_dir: str,
        *,
        intent: str,
    ) -> dict[str, object]: ...

    def prepare_restart(self) -> object: ...

    def select_directory(self) -> str: ...


class RuntimeAuthorization(Protocol):
    def role_for_session(self, token: str) -> str: ...


class StorageMigration(Protocol):
    def migrate(self, migration_id: str) -> object: ...


def _cross_site_write(request: Request) -> bool:
    if request.headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
        return True
    origin = request.headers.get("origin", "").strip().rstrip("/")
    if not origin:
        return False
    return origin != f"{request.url.scheme}://{request.url.netloc}".rstrip("/")


def _local_client(request: Request) -> bool:
    host = str(request.client.host if request.client else "").strip()
    if host == "testclient":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _runtime_admin_error(
    request: Request,
    authorization: Optional[RuntimeAuthorization],
) -> Optional[JSONResponse]:
    token = request.cookies.get("ic_session", "")
    if not token or authorization is None:
        return JSONResponse(
            status_code=401,
            content={"detail": "未登录或登录已失效"},
        )
    role = authorization.role_for_session(token)
    if not role:
        return JSONResponse(
            status_code=401,
            content={"detail": "未登录或登录已失效"},
        )
    if role != "admin":
        return JSONResponse(
            status_code=403,
            content={"detail": "仅管理员可以执行运行时操作"},
        )
    return None


def _runtime_page(runtime: ApplicationRuntime) -> str:
    status = runtime.status()
    title = "Reroll 正在启动"
    title_key = "runtime.startingTitle"
    detail_key = "runtime.startingDetail"
    detail = status.message
    action = ""
    if status.stage == RuntimeStage.RECOVERY_REQUIRED:
        title = "需要重新连接工作区"
        title_key = "runtime.reconnectTitle"
        detail_key = "runtime.recoveryDetail"
        action = '<ic-button hierarchy="primary" href="/recovery" data-i18n="runtime.reconnectAction">重新连接工作区</ic-button>'
    elif status.stage == RuntimeStage.RESTART_WAITING:
        title = "正在等待安全重启"
        title_key = "runtime.restartWaitingTitle"
        detail_key = "runtime.waitingTasks"
        action = (
            '<ic-button id="restart-now" type="button" hierarchy="primary" tone="danger" data-i18n="runtime.cancelAndRestart">取消活动生成任务并立即重启</ic-button>'
        )
    elif status.stage == RuntimeStage.MAINTENANCE:
        move_stage = str(
            runtime.workspace_move_status().get("stage") or ""
        )
        if move_stage not in {"", "idle", "completed", "failed"}:
            title = "工作区正在搬家"
            title_key = "runtime.moveInProgressTitle"
            detail_key = "runtime.movingSafely"
            action = (
                '<ic-button hierarchy="primary" href="/workspace-move" data-i18n="runtime.viewMoveProgress">查看搬家进度</ic-button>'
            )
        else:
            title = "Reroll 正在安全维护"
            title_key = "runtime.maintenanceTitle"
            detail_key = "runtime.maintenanceDetail"
    elif status.stage == RuntimeStage.STOPPING:
        title = "Reroll 正在重启"
        title_key = "runtime.restartingTitle"
        detail_key = "runtime.restartingDetail"
    elif status.stage == RuntimeStage.FAILED:
        title = "Reroll 启动失败"
        title_key = "runtime.failedTitle"
        detail_key = "runtime.failedDetail"
        action = '<ic-button id="copy-error" type="button" hierarchy="secondary" data-i18n="runtime.copyError">复制错误信息</ic-button>'
    safe_title = html.escape(title)
    safe_detail = html.escape(detail)
    error_id = html.escape(status.error_id)
    return f"""<!doctype html>
<html lang="zh-CN" data-ui-scope="runtime" data-studio-scale="off">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title data-i18n="{title_key}">{safe_title}</title>
  <link rel="icon" href="/static/images/favicon.png?v=2026.08.29.reroll.1" type="image/png">
  <link rel="stylesheet" href="/static/css/design-tokens.css?v=2026.08.10.1">
  <link rel="stylesheet" href="/static/css/runtime-recovery.css?v=2026.08.10.1">
  <script src="/static/js/i18n.js?v=2026.08.30.i18n-audit.12"></script>
</head>
<body class="runtime-page">
  <main class="runtime-shell">
    <div class="runtime-brand" aria-label="Reroll">
      <img src="/static/images/logo.png" alt="">
      <strong>Reroll</strong>
    </div>
    <ic-card class="runtime-card" label="{safe_title}" data-i18n-label="{title_key}">
      <div class="runtime-card-content">
        <p class="runtime-eyebrow">WORKSPACE</p>
        <h1 data-i18n="{title_key}">{safe_title}</h1>
        <p id="runtime-detail" class="runtime-detail">{safe_detail}</p>
        <div class="runtime-actions">{action}</div>
      </div>
    </ic-card>
  </main>
  <script type="module" src="/static/js/infinite-canvas-ui/core.js?v=ic-ui-1a20b8e9d3c4"></script>
  <script>
    const runtimeDetailKey = {detail_key!r};
    const runtimeDetailFallback = document.getElementById('runtime-detail')?.textContent || '';
    function applyRuntimeDetail() {{
      const target = document.getElementById('runtime-detail');
      if (!target) return;
      target.textContent = window.StudioI18n?.lang?.() === 'en'
        ? (window.StudioI18n?.format?.(runtimeDetailKey, {{count:{status.blocking_generation_runs}}}) || runtimeDetailFallback)
        : runtimeDetailFallback;
    }}
    applyRuntimeDetail();
    window.addEventListener('studio-lang-change', applyRuntimeDetail);
    const errorId = {error_id!r};
    document.getElementById('copy-error')?.addEventListener('click', async () => {{
      const response = await fetch('/api/runtime/diagnostics/' + encodeURIComponent(errorId));
      await navigator.clipboard.writeText(await response.text());
    }});
    document.getElementById('restart-now')?.addEventListener('click', async () => {{
      await fetch('/api/runtime/restart', {{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{cancel_active:true}})}});
    }});
    async function watchRuntime() {{
      try {{
        const response = await fetch('/api/runtime/status', {{cache:'no-store'}});
        const next = await response.json();
        if (next.stage === 'ready' || next.stage === 'setup_required') {{
          location.reload();
          return;
        }}
        if (next.stage !== {status.stage.value!r} || next.error_id !== errorId) {{
          location.reload();
          return;
        }}
      }} catch (_) {{}}
      setTimeout(watchRuntime, 800);
    }}
    setTimeout(watchRuntime, 800);
  </script>
</body>
</html>"""


def _recovery_page() -> str:
    return """<!doctype html>
<html lang="zh-CN" data-ui-scope="runtime" data-studio-scale="off">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title data-i18n="runtime.recoveryPageTitle">恢复工作区 · Reroll</title>
  <link rel="icon" href="/static/images/favicon.png?v=2026.08.29.reroll.1" type="image/png">
  <link rel="stylesheet" href="/static/css/design-tokens.css?v=2026.08.10.1">
  <link rel="stylesheet" href="/static/css/runtime-recovery.css?v=2026.08.10.1">
  <script src="/static/js/i18n.js?v=2026.08.30.i18n-audit.12"></script>
</head>
<body class="runtime-page recovery-page">
  <main class="runtime-shell recovery-shell">
    <div class="runtime-brand" aria-label="Reroll">
      <img src="/static/images/logo.png" alt="">
      <strong>Reroll</strong>
    </div>
    <ic-card class="runtime-card recovery-card" label="恢复工作区">
      <div class="runtime-card-content recovery-card-content">
        <header class="recovery-header">
          <p class="runtime-eyebrow">WORKSPACE</p>
          <h1 data-i18n="runtime.recoveryHeading">恢复工作区</h1>
          <p class="runtime-detail" data-i18n="runtime.recoveryIntro">原工作区目录暂时不可用。选择下一步后会先检查内容，确认无误才会安全重启。</p>
        </header>
        <section class="recovery-methods" aria-label="恢复方式" data-i18n-aria-label="runtime.recoveryMethods">
          <article class="recovery-method">
            <div>
              <strong data-i18n="runtime.retryCurrent">重试当前工作区</strong>
              <p data-i18n="runtime.retryCurrentDesc">目录已恢复连接或权限后，重新检查原位置。</p>
            </div>
            <ic-button id="retry-current" type="button" hierarchy="secondary" data-i18n="runtime.retryCurrent">重试当前工作区</ic-button>
          </article>
          <article class="recovery-method">
            <div>
              <strong data-i18n="runtime.reconnectWorkspace">重新连接工作区</strong>
              <p data-i18n="runtime.reconnectWorkspaceDesc">原工作区被移动后，选择它现在所在的位置。</p>
            </div>
            <ic-button data-intent="reconnect" type="button" hierarchy="secondary" data-i18n="runtime.reconnectWorkspace">重新连接工作区</ic-button>
          </article>
          <article class="recovery-method">
            <div>
              <strong data-i18n="runtime.openOther">打开另一个已有工作区</strong>
              <p data-i18n="runtime.openOtherDesc">切换到另一个完整内容工作区；当前账号、会话和角色保持不变。</p>
            </div>
            <ic-button data-intent="open_other" type="button" hierarchy="secondary" data-i18n="runtime.openOther">打开另一个已有工作区</ic-button>
          </article>
          <article class="recovery-method">
            <div>
              <strong data-i18n="runtime.createNew">创建新的工作区</strong>
              <p data-i18n="runtime.createNewDesc">选择空目录，确认后创建并安全重启；不会删除或修改原工作区。</p>
            </div>
            <ic-button data-intent="create_new" type="button" hierarchy="secondary" data-i18n="runtime.createNew">创建新的工作区</ic-button>
          </article>
        </section>
        <section class="recovery-selection" id="selection" hidden>
          <ic-form-field label="工作区目录">
            <ic-input id="workspace-directory" autocomplete="off"></ic-input>
          </ic-form-field>
          <div class="recovery-actions">
            <ic-button id="choose-directory" type="button" hierarchy="secondary" data-i18n="runtime.chooseDirectory">选择目录…</ic-button>
            <ic-button id="check-directory" type="button" hierarchy="primary" data-i18n="runtime.inspectWorkspace">检查工作区</ic-button>
            <ic-button id="confirm-recovery" type="button" hierarchy="primary" hidden data-i18n="runtime.confirmRestart">确认并安全重启</ic-button>
          </div>
          <ic-alert id="recovery-summary" tone="info" hidden>工作区检查结果</ic-alert>
        </section>
        <ic-alert id="recovery-message" tone="warning" role="status" hidden>工作区恢复状态</ic-alert>
      </div>
    </ic-card>
  </main>
  <script type="module" src="/static/js/infinite-canvas-ui/core.js?v=ic-ui-1a20b8e9d3c4"></script>
  <script>
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const input = document.getElementById('workspace-directory');
    const message = document.getElementById('recovery-message');
    const summary = document.getElementById('recovery-summary');
    const selection = document.getElementById('selection');
    const confirm = document.getElementById('confirm-recovery');
    let selectedIntent = 'reconnect';
    let checkedDirectory = '';
    function showAlert(target, text, tone = 'warning') {
      if (text) {
        target.textContent = text;
        target.tone = tone;
      }
      target.hidden = !text;
    }
    function describe(result) {
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      showAlert(summary, result.can_continue
        ? (warnings[0] || tr('runtime.completeFound'))
        : (warnings[0] || tr('runtime.selectedUnavailable')), result.can_continue ? 'success' : 'warning');
      confirm.hidden = !result.can_continue;
      checkedDirectory = result.can_continue ? input.value.trim() : '';
    }
    document.querySelectorAll('[data-intent]').forEach(button => {
      button.addEventListener('click', () => {
        selectedIntent = button.dataset.intent;
        confirm.textContent = selectedIntent === 'create_new'
          ? tr('runtime.createAndRestart')
          : tr('runtime.confirmRestart');
        selection.hidden = false;
        confirm.hidden = true;
        showAlert(summary, '');
        checkedDirectory = '';
        input.focus();
      });
    });
    document.getElementById('retry-current').addEventListener('click', async () => {
      showAlert(message, tr('runtime.recheckingCurrent'), 'info');
      const inspected = await fetch('/api/runtime/recovery/inspect-current', {method:'POST'});
      const result = await inspected.json();
      if (!inspected.ok || !result.can_continue) {
        showAlert(message, result.detail || (result.warnings || [])[0] || tr('runtime.currentUnavailable'), 'danger');
        return;
      }
      const response = await fetch('/api/runtime/recovery/retry', {method:'POST'});
      const data = await response.json();
      showAlert(message, response.ok ? tr('runtime.recoveredRestarting') : (data.detail || tr('runtime.retryFailed')), response.ok ? 'success' : 'danger');
    });
    document.getElementById('choose-directory').addEventListener('click', async () => {
      const response = await fetch('/api/runtime/recovery/select-directory', {method:'POST'});
      const data = await response.json();
      if (response.ok) {
        input.value = data.workspace_directory || '';
        confirm.hidden = true;
        checkedDirectory = '';
      }
      else showAlert(message, data.detail || tr('runtime.directorySelectionFailed'), 'danger');
    });
    document.getElementById('check-directory').addEventListener('click', async () => {
      const response = await fetch('/api/runtime/recovery/inspect', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({workspace_directory:input.value.trim(),intent:selectedIntent})
      });
      const data = await response.json();
      if (!response.ok) {
        showAlert(message, data.detail || tr('runtime.inspectFailed'), 'danger');
        return;
      }
      showAlert(message, '');
      describe(data);
    });
    confirm.addEventListener('click', async () => {
      if (!checkedDirectory || checkedDirectory !== input.value.trim()) {
        showAlert(message, tr('runtime.directoryChanged'), 'warning');
        confirm.hidden = true;
        return;
      }
      confirm.disabled = true;
      const response = await fetch('/api/runtime/recovery', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({workspace_directory:checkedDirectory,intent:selectedIntent})
      });
      const data = await response.json();
      const successMessage = selectedIntent === 'create_new'
        ? tr('runtime.createdRestarting')
        : tr('runtime.confirmedRestarting');
      showAlert(message, response.ok ? successMessage : (data.detail || tr('runtime.recoveryFailed')), response.ok ? 'success' : 'danger');
      if (!response.ok) confirm.disabled = false;
    });
    async function watchRuntime() {
      try {
        const response = await fetch('/api/runtime/status', {cache:'no-store'});
        const state = await response.json();
        if (state.stage === 'ready' || state.stage === 'setup_required') {
          location.replace('/');
          return;
        }
        if (state.stage === 'failed') {
          location.replace('/startup');
          return;
        }
      } catch (_) {}
      setTimeout(watchRuntime, 800);
    }
    setTimeout(watchRuntime, 800);
  </script>
</body></html>"""


def _workspace_move_page() -> str:
    return """<!doctype html>
<html lang="zh-CN" data-ui-scope="auth" data-studio-scale="off">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="/static/js/page-zoom-guard.js?v=2026.08.28.issue-181.1"></script>
  <title data-i18n="runtime.movePageTitle">工作区搬家进度 · Reroll</title>
  <script src="/static/js/i18n.js?v=2026.08.30.i18n-audit.12"></script>
  <script src="/static/js/theme.js?v=2026.08.28.issue-181.1"></script>
  <link rel="icon" href="/static/images/favicon.png?v=2026.08.29.reroll.1" type="image/png">
  <link rel="stylesheet" href="/static/css/design-tokens.css?v=2026.08.28.issue-181.1">
  <link rel="stylesheet" href="/static/css/account-login.css?v=2026.08.28.issue-181.1">
  <link rel="stylesheet" href="/static/css/workspace-move.css?v=2026.08.28.issue-181.1">
</head>
<body>
  <main class="workspace-move-shell">
    <ic-card class="workspace-move-card" label="工作区搬家进度">
      <div class="workspace-move-card-content">
        <div class="brand-lockup">
          <img class="brand-mark" src="/static/images/logo.png" alt="Reroll">
          <div><strong>Reroll</strong><span data-i18n="runtime.moveInProgressTitle">工作区正在搬家</span></div>
        </div>
        <div class="workspace-move-heading">
          <div>
            <p class="eyebrow" data-i18n="runtime.moveInProgressTitle">工作区正在搬家</p>
            <h1 data-i18n="runtime.moveHeading">工作区搬家进度</h1>
          </div>
          <ic-badge id="move-stage" kind="status" tone="info" loading data-i18n="runtime.moveStatusReading">读取中</ic-badge>
        </div>
        <p id="move-message" class="workspace-move-message" role="status" aria-live="polite" data-i18n="runtime.readingMove">正在读取搬家进度…</p>
        <ic-progress id="move-progress" label="工作区搬家进度" value="0" max="100" value-text="0%"></ic-progress>
        <div class="workspace-move-counts" aria-label="搬家统计">
          <span id="move-files" data-i18n="runtime.filesEmpty">文件：--</span>
          <span id="move-size" data-i18n="runtime.sizeEmpty">容量：--</span>
        </div>
        <ic-alert id="move-alert" tone="danger" hidden>暂时无法读取搬家进度</ic-alert>
        <div class="workspace-move-actions">
          <ic-button id="cancel-generation" type="button" hierarchy="secondary" hidden data-i18n="runtime.cancelGenerationMove">取消活动生成任务并开始搬家</ic-button>
          <ic-button id="enter-product" type="button" hierarchy="primary" hidden data-i18n="runtime.enterProduct">进入 Reroll</ic-button>
        </div>
      </div>
    </ic-card>
  </main>
  <script type="module" src="/static/js/infinite-canvas-ui/core.js?v=ic-ui-1a20b8e9d3c4"></script>
  <script src="/static/js/workspace-move.js?v=2026.08.28.issue-181.1" defer></script>
</body>
</html>"""


class RuntimeGateway:
    """Dispatch ready traffic to the legacy app and keep the shell available."""

    def __init__(self, shell: FastAPI, runtime: ApplicationRuntime) -> None:
        self.shell = shell
        self.runtime = runtime
        self._business_write_condition = threading.Condition()
        self._active_business_writes = 0
        runtime.install_maintenance_drainer(
            self._wait_for_business_writes
        )

    async def _wait_for_business_writes(self) -> None:
        def wait() -> None:
            deadline = time.monotonic() + 10
            with self._business_write_condition:
                while self._active_business_writes:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise WorkspaceStorageError(
                            "仍有操作正在保存，请稍后重试，当前工作区继续可用"
                        )
                    self._business_write_condition.wait(remaining)

        await asyncio.to_thread(wait)

    def _begin_business_write(self) -> None:
        with self._business_write_condition:
            self._active_business_writes += 1

    def _finish_business_write(self) -> None:
        with self._business_write_condition:
            self._active_business_writes = max(
                0,
                self._active_business_writes - 1,
            )
            self._business_write_condition.notify_all()

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            await self.shell(scope, receive, send)
            return
        path = str(scope.get("path") or "/")
        if path.startswith(_RUNTIME_PATHS):
            await self.shell(scope, receive, send)
            return
        status = self.runtime.status()
        application = self.runtime._application()
        setup_route = path in _SETUP_PATHS or path.startswith(_SETUP_PREFIXES)
        if application is not None and (
            status.stage == RuntimeStage.READY
            or (status.stage == RuntimeStage.SETUP_REQUIRED and setup_route)
        ):
            method = str(scope.get("method") or "").upper()
            track_write = (
                scope["type"] == "http"
                and method not in {"GET", "HEAD", "OPTIONS"}
                and path not in _MAINTENANCE_INITIATOR_PATHS
            )
            if track_write:
                self._begin_business_write()
            try:
                await application(scope, receive, send)
            finally:
                if track_write:
                    self._finish_business_write()
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1013})
            return
        await self.shell(scope, receive, send)


def create_app(
    runtime: ApplicationRuntime,
    *,
    workspace_recovery: Optional[WorkspaceRecovery] = None,
    runtime_authorization: Optional[RuntimeAuthorization] = None,
    storage_migration: Optional[StorageMigration] = None,
    installation_id: str = "",
) -> RuntimeGateway:
    """Create the minimal HTTP shell without starting runtime dependencies."""

    recovery_preparer = (
        getattr(workspace_recovery, "prepare_restart", None)
        if workspace_recovery is not None
        else None
    )
    if callable(recovery_preparer):
        runtime.install_restart_preparer(recovery_preparer)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        start_task = asyncio.create_task(runtime.start())
        await asyncio.sleep(0)
        try:
            yield
        finally:
            if not start_task.done():
                start_task.cancel()
            await asyncio.gather(start_task, return_exceptions=True)
            await runtime.stop()

    shell = FastAPI(lifespan=lifespan)
    shell.mount(
        "/static",
        StaticFiles(
            directory=str(Path(__file__).resolve().parents[2] / "static"),
            check_dir=False,
        ),
        name="runtime-static",
    )

    @shell.get("/api/runtime/status")
    async def runtime_status(
        include_event_loop_lag: bool = False,
        event_loop_lag_after_sequence: int = 0,
    ):
        status = runtime.status().public()
        status["installation_id"] = str(installation_id or "")
        if include_event_loop_lag:
            status["event_loop_lag"] = runtime.event_loop_lag_snapshot(
                after_sequence=event_loop_lag_after_sequence,
            )
        return status

    @shell.get("/api/workspace-move/status")
    async def workspace_move_status(
        request: Request,
        operation_id: str = "",
    ):
        authorization_error = _runtime_admin_error(
            request,
            runtime_authorization,
        )
        if authorization_error is not None:
            return authorization_error
        status = runtime.workspace_move_status()
        if (
            operation_id
            and str(status.get("operation_id") or "") != operation_id
        ):
            return JSONResponse(
                status_code=404,
                content={"detail": "找不到这次工作区搬家记录"},
            )
        return status

    @shell.websocket("/ws/workspace-move")
    async def workspace_move_updates(
        websocket: WebSocket,
        operation_id: str = "",
    ):
        token = websocket.cookies.get("ic_session", "")
        role = (
            runtime_authorization.role_for_session(token)
            if token and runtime_authorization is not None
            else ""
        )
        if role != "admin":
            await websocket.close(code=4403)
            return
        await websocket.accept()
        previous = None
        try:
            while True:
                status = runtime.workspace_move_status()
                if (
                    operation_id
                    and str(status.get("operation_id") or "")
                    != operation_id
                ):
                    await websocket.close(
                        code=4404,
                        reason="找不到这次工作区搬家记录",
                    )
                    return
                fingerprint = repr(sorted(status.items()))
                if fingerprint != previous:
                    await websocket.send_json(status)
                    previous = fingerprint
                await asyncio.sleep(0.4)
        except WebSocketDisconnect:
            return

    @shell.post("/api/runtime/restart")
    async def request_restart(
        request: Request,
        payload: RestartRequest = RestartRequest(),
    ):
        if _cross_site_write(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "已拒绝跨站重启请求"},
            )
        if runtime.status().stage not in {
            RuntimeStage.READY,
            RuntimeStage.SETUP_REQUIRED,
            RuntimeStage.RESTART_WAITING,
        }:
            return JSONResponse(
                status_code=409,
                content={"detail": "当前运行阶段不能请求重启"},
            )
        authorization_error = _runtime_admin_error(
            request,
            runtime_authorization,
        )
        if authorization_error is not None:
            return authorization_error
        return (
            await runtime.request_restart(
                cancel_active=payload.cancel_active,
            )
        ).public()

    @shell.post("/api/runtime/storage-migration")
    async def request_storage_migration(
        request: Request,
        payload: StorageMigrationRequest,
    ):
        if _cross_site_write(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "已拒绝跨站存储迁移请求"},
            )
        if not _local_client(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "只能在运行 Reroll 的设备上迁移存储"},
            )
        authorization_error = _runtime_admin_error(
            request,
            runtime_authorization,
        )
        if authorization_error is not None:
            return authorization_error
        blocking = runtime.active_generation_runs()
        if blocking:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": (
                        f"仍有 {blocking} 个生成任务正在执行，"
                        "请等待任务结束或手动取消后重试。"
                    ),
                    "reason": "active_generation_runs",
                    "blocking_generation_runs": blocking,
                    "next_step": "finish_or_cancel_generation_runs",
                },
            )
        if not payload.approved:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "请先确认已了解维护停服和恢复副本要求。",
                    "reason": "explicit_approval_required",
                    "next_step": "approve_storage_migration",
                },
            )
        migration_id = payload.migration_id.strip()
        if not migration_id:
            return JSONResponse(
                status_code=422,
                content={"detail": "迁移请求缺少 migration_id"},
            )
        if storage_migration is None:
            return JSONResponse(
                status_code=503,
                content={"detail": "存储迁移入口尚未完成配置"},
            )

        migration_error = ""
        late_blocking = 0

        async def prepare_storage_migration():
            nonlocal late_blocking, migration_error
            late_blocking = runtime.active_generation_runs()
            if late_blocking:
                raise WorkspaceStorageError(
                    f"仍有 {late_blocking} 个生成任务正在执行"
                )
            try:
                return await asyncio.to_thread(
                    storage_migration.migrate,
                    migration_id,
                )
            except WorkspaceStorageError as exc:
                migration_error = str(exc)
                raise

        status = await runtime.request_maintenance_restart(
            prepare_storage_migration,
        )
        if late_blocking:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": (
                        f"仍有 {late_blocking} 个生成任务正在执行，"
                        "请等待任务结束或手动取消后重试。"
                    ),
                    "reason": "active_generation_runs",
                    "blocking_generation_runs": late_blocking,
                    "next_step": "finish_or_cancel_generation_runs",
                },
            )
        if migration_error:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": migration_error,
                    "reason": "migration_preparation_failed",
                    "next_step": "review_migration_report_and_retry",
                },
            )
        if status.stage != RuntimeStage.STOPPING:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": status.message,
                    "reason": "migration_restart_failed",
                    "next_step": "review_runtime_status_and_retry",
                },
            )
        return status.public()

    @shell.get("/api/runtime/diagnostics/{error_id}")
    async def runtime_diagnostic(error_id: str):
        diagnostic = runtime.copyable_diagnostic(error_id)
        if not diagnostic:
            return PlainTextResponse("错误信息不存在。", status_code=404)
        return PlainTextResponse(diagnostic)

    @shell.post("/api/runtime/recovery/select-directory")
    async def select_recovery_directory(request: Request):
        if runtime.status().stage != RuntimeStage.RECOVERY_REQUIRED:
            return JSONResponse(
                status_code=409,
                content={"detail": "当前不需要恢复工作区"},
            )
        if not _local_client(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "只能在运行 Reroll 的设备上恢复工作区"},
            )
        if _cross_site_write(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "已拒绝跨站目录选择请求"},
            )
        if workspace_recovery is None:
            return JSONResponse(
                status_code=503,
                content={"detail": "工作区恢复暂不可用。"},
            )
        try:
            selected = await asyncio.to_thread(
                workspace_recovery.select_directory
            )
        except (OSError, RuntimeError, ValueError) as exc:
            return JSONResponse(
                status_code=500,
                content={"detail": str(exc)},
            )
        if not selected:
            return JSONResponse(
                status_code=400,
                content={"detail": "未选择目录"},
            )
        return {"workspace_directory": selected}

    def recovery_write_error(request: Request) -> Optional[JSONResponse]:
        if runtime.status().stage != RuntimeStage.RECOVERY_REQUIRED:
            return JSONResponse(
                status_code=409,
                content={"detail": "当前不需要恢复工作区"},
            )
        if not _local_client(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "只能在运行 Reroll 的设备上恢复工作区"},
            )
        if _cross_site_write(request):
            return JSONResponse(
                status_code=403,
                content={"detail": "已拒绝跨站工作区恢复请求"},
            )
        if workspace_recovery is None:
            return JSONResponse(
                status_code=503,
                content={"detail": "工作区恢复暂不可用。"},
            )
        return None

    @shell.post("/api/runtime/recovery/inspect-current")
    async def inspect_current_workspace(request: Request):
        rejected = recovery_write_error(request)
        if rejected is not None:
            return rejected
        try:
            return await asyncio.to_thread(
                workspace_recovery.inspect_current
            )
        except WorkspaceStorageError as exc:
            return JSONResponse(
                status_code=400,
                content={"detail": str(exc)},
            )

    @shell.post("/api/runtime/recovery/inspect")
    async def inspect_recovery_workspace(
        request: Request,
        payload: RecoveryRequest,
    ):
        rejected = recovery_write_error(request)
        if rejected is not None:
            return rejected
        try:
            return await asyncio.to_thread(
                workspace_recovery.inspect,
                payload.selected_directory(),
                intent=payload.intent,
            )
        except WorkspaceStorageError as exc:
            return JSONResponse(
                status_code=400,
                content={"detail": str(exc)},
            )

    @shell.post("/api/runtime/recovery/retry")
    async def retry_current_workspace(request: Request):
        rejected = recovery_write_error(request)
        if rejected is not None:
            return rejected
        try:
            await asyncio.to_thread(workspace_recovery.stage_retry)
        except WorkspaceStorageError as exc:
            return JSONResponse(
                status_code=400,
                content={"detail": str(exc)},
            )
        return (await runtime.request_restart()).public()

    @shell.post("/api/runtime/recovery")
    async def reconnect_workspace(
        request: Request,
        payload: RecoveryRequest,
    ):
        rejected = recovery_write_error(request)
        if rejected is not None:
            return rejected
        try:
            await asyncio.to_thread(
                workspace_recovery.stage,
                payload.selected_directory(),
                intent=payload.intent,
            )
        except WorkspaceStorageError as exc:
            return JSONResponse(
                status_code=400,
                content={"detail": str(exc)},
            )
        return (await runtime.request_restart()).public()

    @shell.get("/recovery")
    async def recovery_page():
        if runtime.status().stage in {
            RuntimeStage.READY,
            RuntimeStage.SETUP_REQUIRED,
        }:
            return RedirectResponse(url="/", status_code=303)
        return HTMLResponse(_recovery_page())

    @shell.get("/startup")
    async def startup_page():
        if runtime.status().stage == RuntimeStage.READY:
            return RedirectResponse(url="/", status_code=303)
        return HTMLResponse(_runtime_page(runtime))

    @shell.get("/workspace-move")
    async def workspace_move_page():
        # The static shell contains no operation details. Keeping it reachable
        # lets a refresh survive the brief interval before account state loads;
        # status and controls remain administrator-protected.
        return HTMLResponse(_workspace_move_page())

    @shell.get("/")
    async def runtime_root():
        return HTMLResponse(_runtime_page(runtime))

    @shell.api_route(
        "/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    )
    async def unavailable(path: str):
        if path.startswith("api/"):
            status = runtime.status()
            move_stage = str(
                runtime.workspace_move_status().get("stage") or ""
            )
            detail = (
                "工作区正在搬家，当前操作暂不可用，请稍后重新进入。"
                if (
                    status.stage == RuntimeStage.MAINTENANCE
                    and move_stage
                    not in {"", "idle", "completed", "failed"}
                )
                else (
                    "Reroll 正在安全维护，当前操作暂不可用。"
                    if status.stage == RuntimeStage.MAINTENANCE
                    else "Reroll 暂时不可用，请等待启动完成。"
                )
            )
            return JSONResponse(
                status_code=503,
                content={
                    "detail": detail,
                    "runtime_stage": status.stage.value,
                },
            )
        return HTMLResponse(_runtime_page(runtime))

    return RuntimeGateway(shell, runtime)


__all__ = ["RuntimeGateway", "create_app"]
