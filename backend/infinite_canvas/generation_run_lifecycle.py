"""Pure lifecycle mapping for the future SQLite Generation Run authority.

The production ``GenerationRuns`` service is still backed by its legacy JSON
store.  This module converts one ``_Run.stored()`` snapshot into the normalized
store contract without changing that external lifecycle or selecting a new
authority.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol

from .generation_run_store import (
    GenerationRunAttempt,
    GenerationRunEffect,
    GenerationRunState,
    GenerationRunStore,
)


class GenerationRunStoreExecutorPort(Protocol):
    async def call(
        self,
        function: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> Any: ...


@dataclass(frozen=True)
class GenerationRunPersistenceRecord:
    state: GenerationRunState
    effect: GenerationRunEffect | None = None


@dataclass(frozen=True)
class GenerationRunEffectIntent:
    """Explicit Canvas work produced by a completed lifecycle transition."""

    terminal_status: str
    node_changes: Mapping[str, Any]
    final_log: Mapping[str, Any] | None = None


class AsyncGenerationRunLifecycleStore:
    """Async-only access to blocking GenerationRunStore lifecycle calls."""

    def __init__(
        self,
        *,
        store: GenerationRunStore,
        store_executor: GenerationRunStoreExecutorPort,
    ) -> None:
        self._store = store
        self._store_executor = store_executor

    @property
    def store_executor(self) -> GenerationRunStoreExecutorPort:
        """Expose the process-owned executor for lifecycle diagnostics."""

        return self._store_executor

    async def persist(
        self,
        value: Mapping[str, Any],
        *,
        effect: GenerationRunEffectIntent | None = None,
    ) -> GenerationRunPersistenceRecord:
        return await self._store_executor.call(
            _map_and_persist_generation_run_lifecycle,
            self._store,
            value,
            effect,
        )

    async def load(self, run_id: str) -> GenerationRunState | None:
        return await self._store_executor.call(self._store.load, run_id)

    async def load_unfinished(
        self,
        *,
        limit: int = 1000,
    ) -> tuple[GenerationRunState, ...]:
        return await self._store_executor.call(
            self._store.load_unfinished,
            limit=limit,
        )

    async def integrity(self) -> dict[str, Any]:
        return await self._store_executor.call(self._store.integrity)


def _mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    return copy.deepcopy(dict(value))


def _map_and_persist_generation_run_lifecycle(
    store: GenerationRunStore,
    value: Mapping[str, Any],
    effect: GenerationRunEffectIntent | None,
) -> GenerationRunPersistenceRecord:
    record = map_generation_run_lifecycle(value, effect=effect)
    store.save(record.state, effect=record.effect)
    return record


def _attempt(
    value: Mapping[str, Any],
    *,
    provider_id: str,
    updated_at: float,
) -> GenerationRunAttempt:
    payload = {
        key: copy.deepcopy(item)
        for key, item in value.items()
        if key
        not in {
            "index",
            "status",
            "provider_id",
            "remote_ref",
            "provider_output",
            "error",
            "updated_at",
        }
    }
    return GenerationRunAttempt(
        attempt_index=int(value.get("index") or 0),
        status=str(value.get("status") or ""),
        provider_id=str(value.get("provider_id") or provider_id),
        remote_ref=str(value.get("remote_ref") or ""),
        payload=payload,
        provider_output=(
            _mapping(value.get("provider_output"))
            if isinstance(value.get("provider_output"), Mapping)
            else None
        ),
        error=str(value.get("error") or ""),
        updated_at=float(value.get("updated_at") or updated_at),
    )


def map_generation_run_lifecycle(
    value: Mapping[str, Any],
    *,
    effect: GenerationRunEffectIntent | None = None,
) -> GenerationRunPersistenceRecord:
    """Map one legacy ``_Run.stored()`` value to the normalized store seam."""

    provider_id = str(value.get("provider_id") or "")
    updated_at = float(value.get("updated_at") or 0)
    attempts = tuple(
        _attempt(
            item,
            provider_id=provider_id,
            updated_at=updated_at,
        )
        for item in (value.get("child_attempts") or ())
        if isinstance(item, Mapping)
    )
    remote_refs: list[tuple[str, str]] = []
    for remote_ref in value.get("remote_refs") or ():
        normalized = str(remote_ref or "").strip()
        if normalized and (provider_id, normalized) not in remote_refs:
            remote_refs.append((provider_id, normalized))
    for attempt in attempts:
        item = (attempt.provider_id, attempt.remote_ref)
        if attempt.remote_ref and item not in remote_refs:
            remote_refs.append(item)

    target = value.get("target")
    state = GenerationRunState(
        run_id=str(value.get("id") or ""),
        kind=str(value.get("kind") or ""),
        status=str(value.get("status") or ""),
        phase=str(value.get("phase") or "submitted"),
        owner=str(value.get("owner") or ""),
        key=str(value.get("key") or ""),
        request_hash=str(value.get("request_hash") or ""),
        provider_id=provider_id,
        created_at=float(value.get("created_at") or 0),
        updated_at=updated_at,
        request=_mapping(value.get("request")),
        effect_context=_mapping(value.get("effect_context")),
        target=_mapping(target) if isinstance(target, Mapping) else None,
        public_metadata=_mapping(value.get("public_metadata")),
        error=str(value.get("error") or ""),
        status_code=int(value.get("status_code") or 0),
        recoverable=bool(value.get("recoverable")),
        attempts=attempts,
        remote_refs=tuple(remote_refs),
        provider_output=(
            _mapping(value.get("provider_output"))
            if isinstance(value.get("provider_output"), Mapping)
            else None
        ),
        prepared_output=(
            _mapping(value.get("prepared_output"))
            if isinstance(value.get("prepared_output"), Mapping)
            else None
        ),
        result=copy.deepcopy(value.get("result")),
    )
    mapped_effect = None
    if effect is not None:
        if not state.run_id.strip():
            raise ValueError("Generation effect requires a run ID")
        if not isinstance(effect.node_changes, Mapping):
            raise ValueError("Generation effect node changes must be an object")
        if effect.final_log is not None and not isinstance(
            effect.final_log, Mapping
        ):
            raise ValueError("Generation effect final log must be an object")
        if not isinstance(target, Mapping):
            raise ValueError("Generation effect requires a target")
        canvas_id = str(target.get("canvas_id") or "").strip()
        node_id = str(target.get("node_id") or "").strip()
        operation_id = str(target.get("operation_id") or "").strip()
        request_index = max(0, int(target.get("request_index") or 0))
        if not canvas_id or not node_id or not operation_id:
            raise ValueError("Generation effect target is incomplete")
        identity = {
            "canvas_id": canvas_id,
            "node_id": node_id,
            "generation_operation_id": operation_id,
            "request_index": request_index,
            "run_id": state.run_id,
        }
        effect_id = "generation:" + hashlib.sha256(
            json.dumps(
                identity,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        payload: dict[str, Any] = {
            "node_id": node_id,
            "generation_operation_id": operation_id,
            "request_index": request_index,
            "node_changes": _mapping(effect.node_changes),
        }
        if effect.final_log is not None:
            payload["final_log"] = _mapping(effect.final_log)
        mapped_effect = GenerationRunEffect(
            effect_id=effect_id,
            run_id=state.run_id,
            canvas_id=canvas_id,
            payload=payload,
            created_at=state.updated_at,
            terminal_status=str(effect.terminal_status or ""),
        )
    return GenerationRunPersistenceRecord(
        state=state,
        effect=mapped_effect,
    )


__all__ = [
    "AsyncGenerationRunLifecycleStore",
    "GenerationRunEffectIntent",
    "GenerationRunPersistenceRecord",
    "GenerationRunStoreExecutorPort",
    "map_generation_run_lifecycle",
]
