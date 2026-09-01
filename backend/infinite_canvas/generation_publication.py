"""Global Generation History and notification publication adapters.

Output materialization is intentionally outside this module.  JSON-authority
Workspaces use the legacy adapter; SQLite-authority Workspaces use the same
small publication interface without receiving legacy JSON paths.
"""

from __future__ import annotations

import copy
import inspect
import json
import os
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .generation_effect_dispatcher import GenerationRunStoreExecutor
from .generation_run_store import (
    GenerationHistoryPage,
    GenerationPublicationClaim,
    GenerationPublicationStore,
)


class GenerationPublicationError(RuntimeError):
    """Global History or notification publication could not be reconciled."""


class GenerationPublication(Protocol):
    async def publish_history(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None: ...

    async def publish_notification(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None: ...

    async def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> GenerationHistoryPage: ...

    async def history_by_id(
        self, history_id: str
    ) -> Mapping[str, Any] | None: ...

    async def delete_history(
        self,
        *,
        history_id: str = "",
        timestamp: float | None = None,
    ) -> tuple[Mapping[str, Any], ...]: ...

    async def recover_pending(self, *, limit: int = 1000) -> dict[str, Any]: ...


@dataclass(frozen=True)
class LegacyGenerationPublicationPorts:
    history_path: Callable[[], str | Path]
    journal_path: Callable[[], str | Path]
    history_lock: Any
    notify: Callable[..., Awaitable[None]]
    now: Callable[[], float] = time.time
    output_file_from_url: Callable[[str], str | None] | None = None


class LegacyGenerationPublication:
    """Compatibility adapter for an explicitly JSON-authority Workspace."""

    def __init__(self, ports: LegacyGenerationPublicationPorts) -> None:
        self._ports = ports
        self._journal_lock = threading.RLock()
        self._inflight_effects: set[tuple[str, str]] = set()

    @staticmethod
    def _effect_id(run_id: str, name: str) -> str:
        return f"generation-run:{run_id}:{name}"

    @staticmethod
    def _write_atomic(path: Path, payload: Any, *, indent: int = 2) -> None:
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=indent),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _load_journal(self, *, strict: bool = False) -> dict[str, Any]:
        path = Path(self._ports.journal_path())
        if not path.exists():
            return {"version": 2, "effects": {}, "pending": {}}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            if strict:
                raise GenerationPublicationError(
                    "旧 effect receipt journal 损坏，已保留原文件"
                ) from exc
            return {"version": 2, "effects": {}, "pending": {}}
        if not isinstance(payload, dict):
            if strict:
                raise GenerationPublicationError(
                    "旧 effect receipt journal 损坏，已保留原文件"
                )
            return {"version": 2, "effects": {}, "pending": {}}
        return payload

    def _effect_done(self, run_id: str, name: str) -> bool:
        with self._journal_lock:
            payload = self._load_journal()
            effects = payload.get("effects")
            completed = effects.get(run_id, []) if isinstance(effects, dict) else []
            return name in completed if isinstance(completed, list) else False

    def _update_effect(self, run_id: str, name: str, *, done: bool) -> None:
        path = Path(self._ports.journal_path())
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._journal_lock:
            payload = self._load_journal()
            effects = payload.get("effects")
            if not isinstance(effects, dict):
                effects = {}
                payload["effects"] = effects
            pending = payload.get("pending")
            if not isinstance(pending, dict):
                pending = {}
                payload["pending"] = pending
            completed_names = effects.get(run_id)
            if not isinstance(completed_names, list):
                completed_names = []
            pending_names = pending.get(run_id)
            if not isinstance(pending_names, list):
                pending_names = []
            if done and name not in completed_names:
                completed_names.append(name)
            if done:
                pending_names = [value for value in pending_names if value != name]
            elif name not in completed_names and name not in pending_names:
                pending_names.append(name)
            effects[run_id] = completed_names
            if pending_names:
                pending[run_id] = pending_names
            else:
                pending.pop(run_id, None)
            self._write_atomic(path, payload)

    def _begin_effect(self, run_id: str, name: str) -> bool:
        with self._journal_lock:
            if self._effect_done(run_id, name):
                return False
            identity = (run_id, name)
            if identity in self._inflight_effects:
                return False
            self._update_effect(run_id, name, done=False)
            self._inflight_effects.add(identity)
            return True

    def _complete_effect(self, run_id: str, name: str) -> None:
        self._update_effect(run_id, name, done=True)
        self._inflight_effects.discard((run_id, name))

    async def publish_history(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None:
        path = Path(self._ports.history_path())
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._ports.history_lock:
            history: list[dict[str, Any]] = []
            if path.exists():
                try:
                    loaded = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        history = [dict(item) for item in loaded if isinstance(item, Mapping)]
                except (OSError, UnicodeError, json.JSONDecodeError):
                    history = []
            marker = f"generation-run:{run_id}"
            if not any(item.get("_effect_id") == marker for item in history):
                stored = copy.deepcopy(dict(record))
                stored.setdefault("timestamp", float(self._ports.now()))
                stored["_effect_id"] = marker
                history.insert(0, stored)
                self._write_atomic(path, history[:5000], indent=4)
        self._complete_effect(run_id, "history")

    async def publish_notification(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None:
        if not self._begin_effect(run_id, "notification"):
            return
        effect_id = self._effect_id(run_id, "notification")
        try:
            try:
                inspect.signature(self._ports.notify).bind(
                    dict(record), effect_id=effect_id
                )
            except TypeError:
                await self._ports.notify(dict(record))
            else:
                await self._ports.notify(dict(record), effect_id=effect_id)
        except BaseException:
            self._inflight_effects.discard((run_id, "notification"))
            raise
        self._complete_effect(run_id, "notification")

    def _records(self, media_type: str = "") -> list[dict[str, Any]]:
        path = Path(self._ports.history_path())
        if not path.exists():
            return []
        try:
            with self._ports.history_lock:
                loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return []
        records = []
        for index, item in enumerate(loaded if isinstance(loaded, list) else []):
            if not isinstance(item, Mapping):
                continue
            record = {
                str(key): copy.deepcopy(value)
                for key, value in item.items()
                if str(key) != "_effect_id"
            }
            record.setdefault(
                "history_id",
                str(record.get("id") or f"legacy-position:{index}"),
            )
            if media_type and str(record.get("type") or "zimage") != media_type:
                continue
            if not self._output_urls(record):
                continue
            records.append(record)
        records.sort(
            key=lambda item: (
                float(item.get("timestamp") or 0)
                if isinstance(item.get("timestamp"), (int, float))
                else 0
            ),
            reverse=True,
        )
        return records

    async def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> GenerationHistoryPage:
        try:
            offset = max(0, int(cursor or 0))
        except (TypeError, ValueError) as exc:
            raise GenerationPublicationError("Generation History cursor 无效") from exc
        requested = max(1, min(5000, int(limit)))
        records = self._records(media_type)
        items = tuple(records[offset : offset + requested])
        next_offset = offset + len(items)
        return GenerationHistoryPage(
            items=items,
            next_cursor=str(next_offset) if next_offset < len(records) else "",
        )

    async def history_by_id(
        self, history_id: str
    ) -> Mapping[str, Any] | None:
        requested = str(history_id or "").strip()
        return next(
            (item for item in self._records() if item.get("history_id") == requested),
            None,
        )

    async def delete_history(
        self,
        *,
        history_id: str = "",
        timestamp: float | None = None,
    ) -> tuple[Mapping[str, Any], ...]:
        path = Path(self._ports.history_path())
        if not path.exists():
            return ()
        deleted: list[dict[str, Any]] = []
        with self._ports.history_lock:
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                return ()
            kept = []
            for index, item in enumerate(loaded if isinstance(loaded, list) else []):
                if not isinstance(item, Mapping):
                    kept.append(item)
                    continue
                item_id = str(item.get("id") or f"legacy-position:{index}")
                item_timestamp = item.get("timestamp")
                matches = bool(history_id and item_id == history_id)
                if not history_id and timestamp is not None:
                    try:
                        matches = abs(float(item_timestamp) - float(timestamp)) < 0.001
                    except (TypeError, ValueError):
                        matches = str(item_timestamp) == str(timestamp)
                if matches:
                    deleted.append(dict(item))
                else:
                    kept.append(item)
            if deleted:
                self._write_atomic(path, kept, indent=4)
        self._delete_output_files(deleted)
        return tuple(deleted)

    @staticmethod
    def _output_urls(record: Mapping[str, Any]) -> tuple[str, ...]:
        values: list[Any] = []
        for key in (
            "images", "videos", "audios", "files", "texts", "outputs",
            "urls", "items", "image_items",
        ):
            current = record.get(key)
            if isinstance(current, list):
                values.extend(current)
        if record.get("url"):
            values.append(record.get("url"))
        urls: list[str] = []
        for value in values:
            if isinstance(value, Mapping):
                value = (
                    value.get("url")
                    or value.get("path")
                    or value.get("src")
                    or value.get("uri")
                )
            normalized = str(value or "").strip()
            if normalized and normalized not in urls:
                urls.append(normalized)
        return tuple(urls)

    def _delete_output_files(self, records: list[Mapping[str, Any]]) -> None:
        resolver = self._ports.output_file_from_url
        if not callable(resolver):
            return
        for record in records:
            images = record.get("images")
            for value in self._output_urls(
                {"images": images if isinstance(images, list) else []}
            ):
                file_path = resolver(value)
                if file_path and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass

    def legacy_pending_receipts(self) -> dict[str, tuple[str, ...]]:
        with self._journal_lock:
            payload = self._load_journal(strict=True)
            effects = payload.get("effects", {})
            pending = payload.get("pending")
            if pending is None:
                return {}
            if not isinstance(effects, dict) or not isinstance(pending, dict):
                raise GenerationPublicationError(
                    "旧 effect receipt journal 损坏，已保留原文件"
                )
            receipts: dict[str, tuple[str, ...]] = {}
            changed = False
            for raw_run_id, values in tuple(pending.items()):
                if not isinstance(values, list):
                    pending.pop(raw_run_id, None)
                    changed = True
                    continue
                completed = effects.get(raw_run_id)
                completed_names = set(completed if isinstance(completed, list) else ())
                names = tuple(
                    dict.fromkeys(
                        str(value).strip()
                        for value in values
                        if str(value or "").strip()
                        and str(value).strip() not in completed_names
                    )
                )
                if names:
                    run_id = str(raw_run_id)
                    receipts[run_id] = names
                    if list(names) != values or run_id != raw_run_id:
                        pending.pop(raw_run_id, None)
                        pending[run_id] = list(names)
                        changed = True
                else:
                    pending.pop(raw_run_id, None)
                    changed = True
            if changed:
                self._write_atomic(Path(self._ports.journal_path()), payload)
            return receipts

    def discard_legacy_pending_receipts(
        self, run_id: str, names: tuple[str, ...] | list[str]
    ) -> None:
        path = Path(self._ports.journal_path())
        with self._journal_lock:
            payload = self._load_journal()
            pending = payload.get("pending")
            if not isinstance(pending, dict):
                return
            current = pending.get(run_id)
            if not isinstance(current, list):
                return
            discarded = {str(name) for name in names}
            remaining = [name for name in current if str(name) not in discarded]
            if remaining:
                pending[run_id] = remaining
            else:
                pending.pop(run_id, None)
            self._write_atomic(path, payload)

    async def recover_pending(self, *, limit: int = 1000) -> dict[str, Any]:
        del limit
        return {"recovered": 0, "failed": {}}


class SqliteGenerationPublication:
    """SQLite adapter for History rows and durable notification receipts."""

    def __init__(
        self,
        *,
        store: GenerationPublicationStore,
        store_executor: GenerationRunStoreExecutor,
        notify: Callable[..., Awaitable[None]],
        worker_id: str,
        output_file_from_url: Callable[[str], str | None] | None = None,
        lease_seconds: float = 30,
        retry_delay_seconds: float = 5,
    ) -> None:
        self._store = store
        self._store_executor = store_executor
        self._notify = notify
        self._worker_id = str(worker_id or "").strip()
        self._output_file_from_url = output_file_from_url
        self._lease_seconds = float(lease_seconds)
        self._retry_delay_seconds = float(retry_delay_seconds)
        if not self._worker_id:
            raise ValueError("worker_id must not be empty")

    @staticmethod
    def _history_id(run_id: str) -> str:
        return f"history:run:{run_id}"

    async def publish_history(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None:
        await self._store_executor.call(
            self._store.publish_history,
            run_id,
            self._history_id(run_id),
            dict(record),
            source="runtime",
        )

    async def _notify_claim(self, claim: GenerationPublicationClaim) -> None:
        try:
            try:
                inspect.signature(self._notify).bind(
                    dict(claim.payload), effect_id=claim.effect_id
                )
            except TypeError:
                await self._notify(dict(claim.payload))
            else:
                await self._notify(dict(claim.payload), effect_id=claim.effect_id)
        except BaseException as exc:
            await self._store_executor.call(
                self._store.settle_publication,
                claim,
                completed=False,
                detail=str(exc) or type(exc).__name__,
                retry_delay_seconds=self._retry_delay_seconds,
            )
            raise
        settled = await self._store_executor.call(
            self._store.settle_publication,
            claim,
            completed=True,
        )
        if not settled:
            raise GenerationPublicationError("Notification publication lease 已失效")

    async def publish_notification(
        self, run_id: str, record: Mapping[str, Any]
    ) -> None:
        claim = await self._store_executor.call(
            self._store.claim_publication,
            self._worker_id,
            lease_seconds=self._lease_seconds,
            run_id=run_id,
            effect_kind="notification",
            payload=dict(record),
        )
        if claim is not None:
            await self._notify_claim(claim)

    async def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> GenerationHistoryPage:
        return await self._store_executor.call(
            self._store.history_page,
            media_type=media_type,
            limit=limit,
            cursor=cursor,
        )

    async def history_by_id(
        self, history_id: str
    ) -> Mapping[str, Any] | None:
        return await self._store_executor.call(
            self._store.history_by_id, history_id
        )

    async def delete_history(
        self,
        *,
        history_id: str = "",
        timestamp: float | None = None,
    ) -> tuple[Mapping[str, Any], ...]:
        deleted = await self._store_executor.call(
            self._store.delete_history,
            history_id=history_id,
            timestamp=timestamp,
        )
        resolver = self._output_file_from_url
        if callable(resolver):
            for record in deleted:
                images = record.get("images")
                for value in LegacyGenerationPublication._output_urls(
                    {"images": images if isinstance(images, list) else []}
                ):
                    file_path = resolver(value)
                    if file_path and os.path.exists(file_path):
                        try:
                            os.remove(file_path)
                        except OSError:
                            pass
        return deleted

    async def recover_pending(self, *, limit: int = 1000) -> dict[str, Any]:
        recovered = 0
        failed: dict[str, str] = {}
        for _index in range(max(1, int(limit))):
            claim = await self._store_executor.call(
                self._store.claim_publication,
                self._worker_id,
                lease_seconds=self._lease_seconds,
            )
            if claim is None:
                break
            try:
                if claim.effect_kind == "history":
                    await self._store_executor.call(
                        self._store.publish_history,
                        claim.run_id,
                        self._history_id(claim.run_id),
                        dict(claim.payload),
                        source="recovery",
                    )
                elif claim.effect_kind == "notification":
                    await self._notify_claim(claim)
                else:
                    raise GenerationPublicationError(
                        f"未知 publication effect：{claim.effect_kind}"
                    )
                recovered += 1
            except Exception as exc:
                failed[claim.effect_id] = str(exc) or type(exc).__name__
                if claim.effect_kind == "history":
                    await self._store_executor.call(
                        self._store.settle_publication,
                        claim,
                        completed=False,
                        detail=failed[claim.effect_id],
                        retry_delay_seconds=self._retry_delay_seconds,
                    )
                break
        return {"recovered": recovered, "failed": failed}


__all__ = [
    "GenerationPublication",
    "GenerationPublicationError",
    "LegacyGenerationPublication",
    "LegacyGenerationPublicationPorts",
    "SqliteGenerationPublication",
]
