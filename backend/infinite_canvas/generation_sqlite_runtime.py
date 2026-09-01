"""Process-owned lifecycle for future SQLite Generation persistence.

The legacy JSON production path does not construct this runtime.  Once the
Workspace authority switches to SQLite, this composition root ensures the
lifecycle gateway and durable effect dispatcher share one bounded Store
executor and shut down in the only safe order.
"""

from __future__ import annotations

import asyncio

from .generation_effect_dispatcher import (
    GenerationEffectDispatcher,
    GenerationEffectTarget,
    GenerationRunStoreExecutor,
)
from .generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from .generation_run_store import GenerationRunStore


class GenerationSqliteRuntimeClosed(RuntimeError):
    """The process-owned SQLite Generation runtime has been closed."""


class GenerationSqliteRuntime:
    """Own one shared executor, lifecycle gateway, and effect consumer."""

    def __init__(
        self,
        *,
        store: GenerationRunStore,
        target: GenerationEffectTarget,
        worker_id: str,
        store_max_workers: int = 1,
        store_max_pending: int = 64,
        lease_seconds: float = 30,
        retry_delay_seconds: float = 5,
        idle_delay_seconds: float = 0.25,
        failure_delay_seconds: float = 1,
    ) -> None:
        self._store_executor = GenerationRunStoreExecutor(
            max_workers=store_max_workers,
            max_pending=store_max_pending,
        )
        self._lifecycle_store = AsyncGenerationRunLifecycleStore(
            store=store,
            store_executor=self._store_executor,
        )
        self._dispatcher = GenerationEffectDispatcher(
            store=store,
            store_executor=self._store_executor,
            target=target,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            retry_delay_seconds=retry_delay_seconds,
            idle_delay_seconds=idle_delay_seconds,
            failure_delay_seconds=failure_delay_seconds,
        )
        self._lifecycle_lock = asyncio.Lock()
        self._close_task: asyncio.Task[None] | None = None
        self._closed = False

    @property
    def store_executor(self) -> GenerationRunStoreExecutor:
        return self._store_executor

    @property
    def lifecycle_store(self) -> AsyncGenerationRunLifecycleStore:
        return self._lifecycle_store

    @property
    def dispatcher(self) -> GenerationEffectDispatcher:
        return self._dispatcher

    @property
    def running(self) -> bool:
        return self._dispatcher.running

    @property
    def closed(self) -> bool:
        return self._closed

    async def start(self) -> None:
        """Start effect delivery once; construction alone stays inactive."""

        async with self._lifecycle_lock:
            if self._close_task is not None or self._closed:
                raise GenerationSqliteRuntimeClosed(
                    "SQLite Generation runtime is closed"
                )
            await self._dispatcher.start()

    async def _close_owned_resources(self) -> None:
        try:
            # The dispatcher may be holding a lease and must settle it while
            # Store admission is still open.
            await self._dispatcher.stop()
        finally:
            await self._store_executor.close()
            self._closed = True

    async def close(self) -> None:
        """Drain effect delivery, then close shared Store admission."""

        async with self._lifecycle_lock:
            if self._close_task is None:
                self._close_task = asyncio.create_task(
                    self._close_owned_resources(),
                    name="generation-sqlite-runtime-close",
                )
            close_task = self._close_task
        await asyncio.shield(close_task)


__all__ = [
    "GenerationSqliteRuntime",
    "GenerationSqliteRuntimeClosed",
]
