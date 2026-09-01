"""Application lifecycle, state, restart, diagnostics, and safe shutdown."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import platform
import re
from collections import deque
from datetime import datetime, timezone
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Awaitable, Callable, Optional, Protocol

from .workspace_storage import WorkspaceStorageError


class RuntimeStage(str, Enum):
    STARTING = "starting"
    SETUP_REQUIRED = "setup_required"
    RECOVERY_REQUIRED = "recovery_required"
    READY = "ready"
    RESTART_WAITING = "restart_waiting"
    MAINTENANCE = "maintenance"
    STOPPING = "stopping"
    FAILED = "failed"


@dataclass(frozen=True)
class RuntimeStatus:
    stage: RuntimeStage
    message: str
    blocking_generation_runs: int = 0
    error_id: str = ""
    unavailable_features: tuple[str, ...] = ()

    def public(self) -> dict[str, object]:
        return {
            "stage": self.stage.value,
            "message": self.message,
            "blocking_generation_runs": self.blocking_generation_runs,
            "error_id": self.error_id,
            "unavailable_features": list(self.unavailable_features),
        }


@dataclass(frozen=True)
class RuntimeStartup:
    application: object
    stop: Optional[Callable[[], object]] = None
    setup_required: bool = False
    unavailable_features: tuple[str, ...] = ()


Initializer = Callable[[], Awaitable[RuntimeStartup]]


class GenerationRunControl(Protocol):
    def active_count(self) -> int: ...

    def cancel_active(self) -> object: ...


class _NoGenerationRuns:
    def active_count(self) -> int:
        return 0

    def cancel_active(self) -> None:
        return None


class ApplicationRuntime:
    """Small public seam hiding the complete application lifecycle."""

    def __init__(
        self,
        *,
        initializer: Initializer,
        local_state_dir: Path,
        version: str,
        generation_runs: Optional[GenerationRunControl] = None,
        restart_signal: Optional[Callable[[], object]] = None,
        home_dir: Optional[Path] = None,
        operating_system: Optional[str] = None,
        timestamp: Optional[Callable[[], str]] = None,
    ) -> None:
        self._initializer = initializer
        self._local_state_dir = Path(local_state_dir)
        self._version = str(version)
        self._generation_runs = generation_runs or _NoGenerationRuns()
        self._restart_signal = restart_signal or (lambda: None)
        self._home_dir = Path(home_dir) if home_dir is not None else Path.home()
        self._operating_system = operating_system or platform.platform()
        self._timestamp = timestamp or (
            lambda: datetime.now(timezone.utc).astimezone().isoformat()
        )
        self._diagnostics: dict[str, str] = {}
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None
        self._event_loop_probe_interval_seconds = 0.01
        self._event_loop_probe_task: Optional[asyncio.Task[None]] = None
        self._event_loop_lag_samples: deque[tuple[int, float]] = deque(
            maxlen=4096
        )
        self._event_loop_lag_sequence = 0
        self._restart_wait_task: Optional[asyncio.Task[None]] = None
        self._restart_preparer: Optional[Callable[[], object]] = None
        self._maintenance_drainers: list[Callable[[], object]] = []
        self._workspace_move_status_provider: Optional[
            Callable[[], dict[str, object]]
        ] = None
        self._restart_prepared = False
        self._restart_signalled = False
        self._restart_origin_stage: Optional[RuntimeStage] = None
        self._status = RuntimeStatus(
            RuntimeStage.STARTING,
            "Reroll 正在启动…",
        )
        self._startup: Optional[RuntimeStartup] = None
        self._start_attempted = False
        self._stop_started = False
        self._start_lock = asyncio.Lock()
        self._stop_lock = asyncio.Lock()
        self._restart_begin_lock = asyncio.Lock()

    def status(self) -> RuntimeStatus:
        return self._status

    def active_generation_runs(self) -> int:
        """Return the public maintenance blocker count without changing Runs."""

        return max(0, int(self._generation_runs.active_count()))

    async def _probe_event_loop_lag(self) -> None:
        loop = asyncio.get_running_loop()
        interval = self._event_loop_probe_interval_seconds
        while True:
            expected = loop.time() + interval
            await asyncio.sleep(interval)
            observed = loop.time()
            self._event_loop_lag_sequence += 1
            self._event_loop_lag_samples.append(
                (
                    self._event_loop_lag_sequence,
                    max(0.0, (observed - expected) * 1000),
                )
            )

    def event_loop_lag_snapshot(
        self,
        *,
        after_sequence: int = 0,
    ) -> dict[str, object]:
        minimum_sequence = max(0, int(after_sequence))
        oldest_sequence = (
            self._event_loop_lag_samples[0][0]
            if self._event_loop_lag_samples
            else 0
        )
        return {
            "probe_interval_ms": int(
                self._event_loop_probe_interval_seconds * 1000
            ),
            "retention_capacity": int(
                self._event_loop_lag_samples.maxlen or 0
            ),
            "oldest_sequence": oldest_sequence,
            "latest_sequence": self._event_loop_lag_sequence,
            "samples": [
                {
                    "sequence": sequence,
                    "lag_ms": round(lag_ms, 3),
                }
                for sequence, lag_ms in self._event_loop_lag_samples
                if sequence > minimum_sequence
            ],
        }

    def install_restart_preparer(
        self,
        preparer: Optional[Callable[[], object]],
    ) -> None:
        """Install the business safe-point action run before restart signal."""

        self._restart_preparer = preparer

    def install_maintenance_drainer(
        self,
        drainer: Optional[Callable[[], object]],
    ) -> None:
        """Register work that must drain after traffic is frozen."""

        if drainer is not None and drainer not in self._maintenance_drainers:
            self._maintenance_drainers.append(drainer)

    def install_workspace_move_status_provider(
        self,
        provider: Optional[Callable[[], dict[str, object]]],
    ) -> None:
        self._workspace_move_status_provider = provider

    def workspace_move_status(self) -> dict[str, object]:
        provider = self._workspace_move_status_provider
        if provider is None:
            return {
                "stage": "idle",
                "message": "当前没有进行中的工作区搬家。",
                "finished": True,
            }
        try:
            return dict(provider() or {})
        except Exception:
            return {
                "stage": "failed",
                "message": "无法读取工作区搬家进度，请稍后重试。",
                "finished": True,
            }

    async def start(self) -> RuntimeStatus:
        async with self._start_lock:
            if self._start_attempted:
                return self._status
            self._start_attempted = True
            self._event_loop = asyncio.get_running_loop()
            self._event_loop_probe_task = asyncio.create_task(
                self._probe_event_loop_lag()
            )
            try:
                startup = await self._initializer()
            except WorkspaceStorageError:
                self._status = RuntimeStatus(
                    RuntimeStage.RECOVERY_REQUIRED,
                    "找不到已配置的工作区，请重新连接工作区。",
                )
                return self._status
            except Exception as exc:
                error_id = "IC-" + hashlib.sha256(
                    f"{type(exc).__name__}:{exc}".encode(
                        "utf-8",
                        errors="replace",
                    )
                ).hexdigest()[:10].upper()
                occurred_at = self._timestamp()
                safe_message = self._redact(str(exc))
                self._diagnostics[error_id] = "\n".join(
                    (
                        "Reroll 启动失败",
                        "阶段：starting",
                        f"错误编号：{error_id}",
                        f"时间：{occurred_at}",
                        f"版本：{self._version}",
                        f"系统：{self._operating_system}",
                        f"技术信息：{safe_message}",
                    )
                )
                self._status = RuntimeStatus(
                    RuntimeStage.FAILED,
                    "Reroll 启动失败，请复制错误信息后反馈。",
                    error_id=error_id,
                )
                return self._status
            self._startup = startup
            self._status = RuntimeStatus(
                (
                    RuntimeStage.SETUP_REQUIRED
                    if startup.setup_required
                    else RuntimeStage.READY
                ),
                (
                    "请完成首次设置。"
                    if startup.setup_required
                    else "Reroll 已就绪。"
                ),
                unavailable_features=startup.unavailable_features,
            )
            return self._status

    def copyable_diagnostic(self, error_id: str) -> str:
        return self._diagnostics.get(str(error_id or ""), "")

    def _application(self) -> Optional[object]:
        return self._startup.application if self._startup else None

    def _redact(self, message: str) -> str:
        redacted = str(message or "").replace(str(self._home_dir), "~")
        redacted = re.sub(
            (
                r"(?i)\b(cookie|authorization)\s*:\s*.*?"
                r"(?=\s+\b(?:cookie|authorization|api[_-]?key|password|"
                r"token|secret|canvas)\b\s*[:=]|$)"
            ),
            lambda match: f"{match.group(1)}=[已隐藏]",
            redacted,
        )
        redacted = re.sub(
            r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+",
            "Bearer [已隐藏]",
            redacted,
        )
        redacted = re.sub(
            (
                r"(?i)[\"']?(api[_-]?key|password|token|secret)[\"']?"
                r"\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"
            ),
            lambda match: f"{match.group(1)}=[已隐藏]",
            redacted,
        )
        redacted = re.sub(
            (
                r"(?is)([\"']?(?:canvas|smart[_ -]?canvas|nodes|connections)"
                r"[\"']?\s*[:=])\s*.*$"
            ),
            lambda match: (
                f"{match.group(1)} [Smart Canvas 内容已隐藏]"
            ),
            redacted,
        )
        return redacted[:1200]

    async def request_restart(
        self,
        *,
        cancel_active: bool = False,
    ) -> RuntimeStatus:
        if self._status.stage in {
            RuntimeStage.READY,
            RuntimeStage.SETUP_REQUIRED,
            RuntimeStage.RECOVERY_REQUIRED,
        }:
            self._restart_origin_stage = self._status.stage
        blocking = self.active_generation_runs()
        if blocking and not cancel_active:
            self._status = RuntimeStatus(
                RuntimeStage.RESTART_WAITING,
                f"正在等待 {blocking} 个生成任务完成…",
                blocking_generation_runs=blocking,
            )
            if (
                self._restart_wait_task is None
                or self._restart_wait_task.done()
            ):
                self._restart_wait_task = asyncio.create_task(
                    self._wait_for_generation_runs()
                )
            return self._status
        if blocking:
            result = self._generation_runs.cancel_active()
            if inspect.isawaitable(result):
                await result
        return await self._begin_restart()

    async def _wait_for_generation_runs(self) -> None:
        while self._status.stage == RuntimeStage.RESTART_WAITING:
            blocking = max(0, int(self._generation_runs.active_count()))
            if blocking <= 0:
                await self._begin_restart()
                return
            if blocking != self._status.blocking_generation_runs:
                self._status = RuntimeStatus(
                    RuntimeStage.RESTART_WAITING,
                    f"正在等待 {blocking} 个生成任务完成…",
                    blocking_generation_runs=blocking,
                )
            await asyncio.sleep(0.25)

    async def _begin_restart(self) -> RuntimeStatus:
        async with self._restart_begin_lock:
            return await self._begin_restart_once()

    async def request_maintenance_restart(
        self,
        preparer: Callable[[], object],
    ) -> RuntimeStatus:
        """Freeze traffic, drain writes, run one maintenance action, then restart."""

        async with self._restart_begin_lock:
            return await self._begin_restart_once(preparer=preparer)

    async def _begin_restart_once(
        self,
        *,
        preparer: Optional[Callable[[], object]] = None,
    ) -> RuntimeStatus:
        if self._restart_signalled:
            return self._status
        rollback: Optional[Callable[[], object]] = None
        if not self._restart_prepared:
            self._status = RuntimeStatus(
                RuntimeStage.MAINTENANCE,
                "Reroll 正在进入维护状态，请稍候…",
            )
            try:
                for drainer in self._maintenance_drainers:
                    result = drainer()
                    if inspect.isawaitable(result):
                        await result
                selected_preparer = preparer or self._restart_preparer
                if selected_preparer is not None:
                    result = selected_preparer()
                    if inspect.isawaitable(result):
                        result = await result
                    if callable(result):
                        rollback = result
                self._restart_prepared = True
            except Exception as exc:
                detail = (
                    str(exc or "").strip()
                    if isinstance(exc, WorkspaceStorageError)
                    else ""
                )
                recovery = (
                    self._restart_origin_stage
                    == RuntimeStage.RECOVERY_REQUIRED
                )
                if recovery and detail:
                    message = (
                        f"{detail.rstrip('。')}。"
                        "原工作区目录选择已保留，请检查后重试。"
                    )
                elif recovery:
                    message = (
                        "无法重新连接工作区，原工作区目录选择已保留，"
                        "请检查后重试。"
                    )
                elif "当前工作区继续可用" in detail:
                    message = detail.rstrip("。") + "。"
                elif detail:
                    message = f"{detail}。当前工作区继续可用。"
                else:
                    message = "无法完成工作区操作，当前工作区继续可用。"
                self._status = RuntimeStatus(
                    (
                        RuntimeStage.RECOVERY_REQUIRED
                        if recovery
                        else RuntimeStage.READY
                    ),
                    message,
                )
                return self._status
        self._status = RuntimeStatus(
            RuntimeStage.STOPPING,
            "正在安全关闭并重启 Reroll…",
        )
        try:
            result = self._restart_signal()
            if inspect.isawaitable(result):
                await result
        except Exception:
            if rollback is not None:
                try:
                    result = rollback()
                    if inspect.isawaitable(result):
                        await result
                except Exception:
                    pass
            self._restart_prepared = False
            self._restart_signalled = False
            recovery = (
                self._restart_origin_stage
                == RuntimeStage.RECOVERY_REQUIRED
            )
            self._status = RuntimeStatus(
                (
                    RuntimeStage.RECOVERY_REQUIRED
                    if recovery
                    else RuntimeStage.READY
                ),
                (
                    "无法完成安全重启，原工作区目录选择已保留，"
                    "请检查后重试。"
                    if recovery
                    else "无法完成安全重启，当前工作区继续可用。"
                ),
            )
            return self._status
        self._restart_signalled = True
        return self._status

    def _request_restart_from_thread(
        self,
        *,
        cancel_active: bool = False,
    ) -> dict[str, object]:
        loop = self._event_loop
        if loop is None or not loop.is_running():
            return self._status.public()
        future = asyncio.run_coroutine_threadsafe(
            self.request_restart(cancel_active=cancel_active),
            loop,
        )
        return future.result(timeout=10).public()

    async def stop(self, grace_period_seconds: float = 10) -> RuntimeStatus:
        async with self._stop_lock:
            if self._stop_started:
                return self._status
            self._stop_started = True
            self._status = RuntimeStatus(
                RuntimeStage.STOPPING,
                "Reroll 正在安全关闭…",
            )
            stopper = self._startup.stop if self._startup else None
            if self._restart_wait_task and not self._restart_wait_task.done():
                self._restart_wait_task.cancel()
            if (
                self._event_loop_probe_task
                and not self._event_loop_probe_task.done()
            ):
                self._event_loop_probe_task.cancel()
                await asyncio.gather(
                    self._event_loop_probe_task,
                    return_exceptions=True,
                )
            if stopper is not None:
                result = stopper()
                if inspect.isawaitable(result):
                    try:
                        await asyncio.wait_for(
                            result,
                            timeout=max(0.0, float(grace_period_seconds)),
                        )
                    except TimeoutError:
                        self._status = RuntimeStatus(
                            RuntimeStage.STOPPING,
                            "安全清理已达到等待上限，正在关闭。",
                        )
            return self._status


__all__ = [
    "ApplicationRuntime",
    "RuntimeStage",
    "RuntimeStartup",
    "RuntimeStatus",
]
