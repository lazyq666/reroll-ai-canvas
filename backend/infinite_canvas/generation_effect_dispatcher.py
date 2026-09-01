"""Bounded scheduling and at-least-once Generation effect delivery.

This module is not installed in ``main`` yet.  It provides the async seam that
keeps blocking GenerationRunStore work away from the application event loop.
"""

from __future__ import annotations

import asyncio
import copy
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from functools import partial
from typing import Any, Callable, Protocol

from .generation_run_store import (
    EffectResolution,
    GenerationEffectClaim,
    GenerationRunStore,
)


class GenerationRunStoreExecutorClosed(RuntimeError):
    """The bounded GenerationRunStore executor no longer accepts work."""


class GenerationRunStoreExecutor:
    """Run blocking store calls with bounded in-flight ownership."""

    def __init__(
        self,
        *,
        max_workers: int = 1,
        max_pending: int = 64,
    ) -> None:
        workers = int(max_workers)
        pending = int(max_pending)
        if workers <= 0:
            raise ValueError("max_workers must be positive")
        if pending <= 0:
            raise ValueError("max_pending must be positive")
        self._executor = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix="generation-run-store",
        )
        self._slots = asyncio.Semaphore(pending)
        self._futures: set[Future[Any]] = set()
        self._lock = threading.Lock()
        self._closed = False

    async def call(
        self,
        function: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Wait for bounded capacity, then execute one blocking call."""

        with self._lock:
            if self._closed:
                raise GenerationRunStoreExecutorClosed(
                    "GenerationRunStore executor is closed"
                )
        await self._slots.acquire()
        loop = asyncio.get_running_loop()
        try:
            with self._lock:
                if self._closed:
                    raise GenerationRunStoreExecutorClosed(
                        "GenerationRunStore executor is closed"
                    )
                future = self._executor.submit(
                    partial(function, *args, **kwargs)
                )
                self._futures.add(future)
        except BaseException:
            self._slots.release()
            raise

        def completed(value: Future[Any]) -> None:
            with self._lock:
                self._futures.discard(value)
            loop.call_soon_threadsafe(self._slots.release)

        future.add_done_callback(completed)
        return await asyncio.wrap_future(future)

    async def close(self) -> None:
        """Stop admission and wait without blocking the event loop."""

        with self._lock:
            if self._closed:
                futures = tuple(self._futures)
            else:
                self._closed = True
                futures = tuple(self._futures)
        if futures:
            await asyncio.gather(
                *(asyncio.wrap_future(future) for future in futures),
                return_exceptions=True,
            )
        self._executor.shutdown(wait=False, cancel_futures=False)


@dataclass(frozen=True)
class GenerationEffectDelivery:
    """Canvas delivery decision returned to the outbox dispatcher."""

    resolution: EffectResolution
    detail: str = ""


class GenerationEffectTarget(Protocol):
    """Async destination for one stable Generation effect claim."""

    async def commit_effect(
        self,
        claim: GenerationEffectClaim,
    ) -> GenerationEffectDelivery: ...


class CanvasSyncGenerationEffectTarget:
    """Translate one outbox claim into CanvasSync's atomic effect intent."""

    def __init__(
        self,
        *,
        canvas_sync: Any,
        actor_by_id: Callable[[str], Any],
    ) -> None:
        self._canvas_sync = canvas_sync
        self._actor_by_id = actor_by_id

    async def commit_effect(
        self,
        claim: GenerationEffectClaim,
    ) -> GenerationEffectDelivery:
        payload = claim.payload
        if not isinstance(payload, dict):
            raise ValueError("Generation effect payload must be an object")
        actor = self._actor_by_id(claim.owner)
        if not actor:
            raise ValueError("Generation effect owner no longer exists")
        node_changes = payload.get("node_changes")
        if not isinstance(node_changes, dict):
            raise ValueError("Generation effect node_changes must be an object")
        final_log = payload.get("final_log")
        if final_log is not None and not isinstance(final_log, dict):
            raise ValueError("Generation effect final_log must be an object")
        result = await self._canvas_sync.apply_generation_result_if_current(
            canvas_id=claim.canvas_id,
            actor=actor,
            node_id=str(payload.get("node_id") or ""),
            operation_id=str(
                payload.get("generation_operation_id") or ""
            ),
            request_index=int(payload.get("request_index") or 0),
            run_id=claim.run_id,
            node_changes=copy.deepcopy(node_changes),
            log=(
                copy.deepcopy(final_log)
                if isinstance(final_log, dict)
                else None
            ),
            effect_id=claim.effect_id,
        )
        return GenerationEffectDelivery(
            resolution=(
                EffectResolution.APPLIED
                if bool(result.applied)
                else EffectResolution.DISCARDED
            ),
            detail=str(result.reason or ""),
        )


class GenerationEffectDispatchStatus(str, Enum):
    IDLE = "idle"
    APPLIED = "applied"
    DISCARDED = "discarded"
    RETRY = "retry"
    LOST_LEASE = "lost_lease"


@dataclass(frozen=True)
class GenerationEffectDispatchResult:
    status: GenerationEffectDispatchStatus
    effect_id: str = ""
    attempt_count: int = 0
    detail: str = ""


class GenerationEffectDispatcher:
    """Claim, deliver, and settle at most one durable Generation effect."""

    def __init__(
        self,
        *,
        store: GenerationRunStore,
        store_executor: GenerationRunStoreExecutor,
        target: GenerationEffectTarget,
        worker_id: str,
        lease_seconds: float = 30,
        retry_delay_seconds: float = 5,
        idle_delay_seconds: float = 0.25,
        failure_delay_seconds: float = 1,
    ) -> None:
        self._store = store
        self._store_executor = store_executor
        self._target = target
        self._worker_id = str(worker_id or "").strip()
        self._lease_seconds = float(lease_seconds)
        self._retry_delay_seconds = float(retry_delay_seconds)
        self._idle_delay_seconds = float(idle_delay_seconds)
        self._failure_delay_seconds = float(failure_delay_seconds)
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None
        self._last_error: Exception | None = None
        if not self._worker_id:
            raise ValueError("worker_id must not be empty")
        if self._lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if self._retry_delay_seconds < 0:
            raise ValueError("retry_delay_seconds must not be negative")
        if self._idle_delay_seconds < 0:
            raise ValueError("idle_delay_seconds must not be negative")
        if self._failure_delay_seconds < 0:
            raise ValueError("failure_delay_seconds must not be negative")

    @property
    def running(self) -> bool:
        task = self._task
        return task is not None and not task.done()

    @property
    def last_error(self) -> Exception | None:
        return self._last_error

    async def start(self) -> None:
        """Start one process-owned consumer loop, idempotently."""

        if self.running:
            return
        stop_event = asyncio.Event()
        self._stop_event = stop_event
        self._task = asyncio.create_task(
            self._run_until_stopped(stop_event),
            name=f"generation-effect-dispatcher:{self._worker_id}",
        )
        await asyncio.sleep(0)

    async def stop(self) -> None:
        """Stop new claims and drain the currently owned delivery."""

        task = self._task
        stop_event = self._stop_event
        if task is None:
            return
        if stop_event is not None:
            stop_event.set()
        if task is not asyncio.current_task():
            await asyncio.gather(task, return_exceptions=True)
        if self._task is task:
            self._task = None
            self._stop_event = None

    @staticmethod
    async def _wait_or_stop(
        stop_event: asyncio.Event,
        delay_seconds: float,
    ) -> None:
        if stop_event.is_set():
            return
        if delay_seconds <= 0:
            await asyncio.sleep(0)
            return
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=delay_seconds,
            )
        except TimeoutError:
            pass

    async def _run_until_stopped(
        self,
        stop_event: asyncio.Event,
    ) -> None:
        while not stop_event.is_set():
            try:
                result = await self.dispatch_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error = exc
                await self._wait_or_stop(
                    stop_event,
                    self._failure_delay_seconds,
                )
                continue
            if result.status is GenerationEffectDispatchStatus.IDLE:
                await self._wait_or_stop(
                    stop_event,
                    self._idle_delay_seconds,
                )

    async def _settle(
        self,
        claim: GenerationEffectClaim,
        delivery: GenerationEffectDelivery,
    ) -> GenerationEffectDispatchResult:
        settled = await self._store_executor.call(
            self._store.settle_effect,
            claim,
            delivery.resolution,
            detail=delivery.detail,
            retry_delay_seconds=(
                self._retry_delay_seconds
                if delivery.resolution is EffectResolution.RETRY
                else 0
            ),
        )
        if not settled:
            return GenerationEffectDispatchResult(
                status=GenerationEffectDispatchStatus.LOST_LEASE,
                effect_id=claim.effect_id,
                attempt_count=claim.attempt_count,
                detail=delivery.detail,
            )
        return GenerationEffectDispatchResult(
            status=GenerationEffectDispatchStatus(delivery.resolution.value),
            effect_id=claim.effect_id,
            attempt_count=claim.attempt_count,
            detail=delivery.detail,
        )

    async def dispatch_once(self) -> GenerationEffectDispatchResult:
        """Deliver one claim; exceptions become durable delayed retries."""

        claim = await self._store_executor.call(
            self._store.claim_effect,
            self._worker_id,
            lease_seconds=self._lease_seconds,
        )
        if claim is None:
            return GenerationEffectDispatchResult(
                status=GenerationEffectDispatchStatus.IDLE
            )
        try:
            delivery = await self._target.commit_effect(claim)
            if not isinstance(delivery, GenerationEffectDelivery):
                raise TypeError(
                    "Generation effect target returned an invalid delivery"
                )
            delivery = GenerationEffectDelivery(
                resolution=EffectResolution(delivery.resolution),
                detail=str(delivery.detail or ""),
            )
        except Exception as exc:
            delivery = GenerationEffectDelivery(
                resolution=EffectResolution.RETRY,
                detail=str(exc) or exc.__class__.__name__,
            )
        return await self._settle(claim, delivery)


__all__ = [
    "CanvasSyncGenerationEffectTarget",
    "GenerationEffectDelivery",
    "GenerationEffectDispatcher",
    "GenerationEffectDispatchResult",
    "GenerationEffectDispatchStatus",
    "GenerationEffectTarget",
    "GenerationRunStoreExecutor",
    "GenerationRunStoreExecutorClosed",
]
