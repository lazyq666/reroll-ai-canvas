"""One lifecycle for image, video, text, workflow, and recovery runs.

The external seam is deliberately small: callers start, read, resume, cancel,
count, or cancel active Generation Runs.  Provider selection, canonical
idempotency, persistence, restart recovery, publication, target freshness,
and shutdown ownership stay behind that interface.
"""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import datetime
import hashlib
import inspect
import json
import os
import re
import threading
import time
import urllib.parse
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal, Protocol, TypeAlias

from .generation_run_lifecycle import GenerationRunEffectIntent
from .generation_publication import (
    GenerationPublication,
    GenerationPublicationError,
    LegacyGenerationPublication,
    LegacyGenerationPublicationPorts,
)
from .generation_run_store import GenerationRunAttempt, GenerationRunState
from .layer_decomposition import (
    LayerDecompositionError,
    MANIFEST_VERSION,
    inspect_base_image,
    inspect_layer_image,
)
from .providers.core import Completed, ExecutionResult, Failed, Pending, Queued
from .providers.runtime import (
    ProviderOutput,
    ProviderRuntime,
    TextOutput,
    TextStreamEventKind,
    TextStreamOutput,
)


ACTIVE_STATUSES = frozenset(
    {"queued", "running", "in_progress", "processing", "pending", "jimeng_pending"}
)
TERMINAL_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "discarded"}
)
RECOVERY_WORKFLOW_OPERATIONS = frozenset(
    {
        "modelscope-angle-recovery",
        "modelscope-recovery",
        "runninghub-query",
        "comfyui-recovery",
    }
)
_STORE_VERSION = 1
JIMENG_MISSING_REMOTE_HISTORY_TIMEOUT_SECONDS = 30 * 60


class GenerationRunError(RuntimeError):
    status_code = 500

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = str(detail)


class GenerationRunConflict(GenerationRunError):
    status_code = 409


class GenerationRunValidation(GenerationRunError):
    status_code = 400


class GenerationRunNotFound(GenerationRunError):
    status_code = 404


class GenerationRunLifecycleProjectionError(RuntimeError):
    """A compatibility projection failed after JSON stayed authoritative."""


class GenerationRunLifecycleStore(Protocol):
    async def persist(
        self,
        value: Mapping[str, Any],
        *,
        effect: Any = None,
    ) -> Any: ...

    async def load_unfinished(
        self,
        *,
        limit: int = 1000,
    ) -> tuple[GenerationRunState, ...]: ...


@dataclass(frozen=True)
class Inline:
    value: Literal["inline"] = "inline"


@dataclass(frozen=True)
class Background:
    value: Literal["background"] = "background"


Delivery: TypeAlias = Inline | Background


@dataclass(frozen=True)
class RunTarget:
    canvas_id: str
    node_id: str
    operation_id: str
    request_index: int = 0

    def key(self, owner: str) -> str:
        return "\x1f".join(
            (
                str(owner or ""),
                self.canvas_id,
                self.node_id,
                self.operation_id,
                str(self.request_index),
            )
        )


@dataclass(frozen=True)
class ImageRun:
    prompt: str
    settings: Mapping[str, Any]
    references: tuple[Mapping[str, Any], ...] = ()
    count: int = 1
    submission_count: int = 1
    prompts: tuple[str, ...] = ()
    publication: str = ""
    effect_context: Mapping[str, Any] = field(
        default_factory=dict, compare=False, repr=False
    )


@dataclass(frozen=True)
class VideoRun:
    payload: Any
    publication: str = ""
    effect_context: Mapping[str, Any] = field(
        default_factory=dict, compare=False, repr=False
    )


@dataclass(frozen=True)
class TextRun:
    payload: Any
    history: tuple[Mapping[str, Any], ...] = ()
    messages: tuple[Mapping[str, Any], ...] = ()
    stream: bool = False
    publication: str = ""
    effect_context: Mapping[str, Any] = field(
        default_factory=dict, compare=False, repr=False
    )


@dataclass(frozen=True)
class WorkflowRun:
    operation: str
    payload: Any
    provider_id: str = ""
    publication: str = ""
    effect_context: Mapping[str, Any] = field(
        default_factory=dict, compare=False, repr=False
    )


@dataclass(frozen=True)
class RecoveryRun:
    provider_id: str
    remote_ref: str
    media_kind: str = "image"
    publication: str = ""
    effect_context: Mapping[str, Any] = field(
        default_factory=dict, compare=False, repr=False
    )


RunRequest: TypeAlias = ImageRun | VideoRun | TextRun | WorkflowRun | RecoveryRun


@dataclass(frozen=True)
class GenerationRunSnapshot:
    id: str
    kind: str
    status: str
    owner: str
    key: str
    request_hash: str
    created_at: float
    updated_at: float
    result: Any = None
    error: str = ""
    status_code: int = 0
    remote_refs: tuple[str, ...] = ()
    target: RunTarget | None = None
    public_metadata: Mapping[str, Any] = field(default_factory=dict)
    provider_id: str = ""
    request_data: Mapping[str, Any] = field(default_factory=dict)
    child_attempts: tuple[Mapping[str, Any], ...] = ()
    deduplicated: bool = False
    recoverable: bool = False

    def public(self) -> dict[str, Any]:
        value = dataclasses.asdict(self)
        value["remote_refs"] = list(self.remote_refs)
        value.pop("request_data", None)
        value.pop("child_attempts", None)
        return value


@dataclass(frozen=True)
class PreparedGenerationOutput:
    """Durable local output plus projections for later destinations."""

    result: Any
    canvas: Mapping[str, Any] = field(default_factory=dict)
    effects: Mapping[str, Any] = field(default_factory=dict)

    def stored(self) -> dict[str, Any]:
        return {
            "result": _json_value(self.result),
            "canvas": _json_value(self.canvas),
            "effects": _json_value(self.effects),
        }

    @classmethod
    def from_stored(cls, value: Any) -> "PreparedGenerationOutput":
        if not isinstance(value, Mapping):
            raise GenerationRunConflict(
                "Generation Run 缺少已保存的本地输出"
            )
        return cls(
            result=copy.deepcopy(value.get("result")),
            canvas=copy.deepcopy(value.get("canvas") or {}),
            effects=copy.deepcopy(value.get("effects") or {}),
        )


RemoteCheckpoint: TypeAlias = Callable[[Pending | Queued], None]


class GenerationExecutor(Protocol):
    async def execute(
        self,
        request: RunRequest,
        checkpoint: RemoteCheckpoint | None = None,
    ) -> ExecutionResult: ...


class GenerationEffects(Protocol):
    async def prepare(
        self,
        run_id: str,
        request: RunRequest,
        output: ProviderOutput,
    ) -> PreparedGenerationOutput: ...

    async def publish_prepared(
        self,
        run_id: str,
        request: RunRequest,
        prepared: PreparedGenerationOutput,
    ) -> Any: ...


class GenerationTargetGuard(Protocol):
    def validate(self, owner: str, target: RunTarget) -> None: ...

    def is_current(self, owner: str, target: RunTarget) -> bool: ...

    async def apply_if_current(
        self,
        run_id: str,
        owner: str,
        target: RunTarget,
        result: Any,
    ) -> bool: ...


_REDACTED_VALUE = "[redacted]"
_SENSITIVE_FIELD_NAMES = frozenset(
    {"api_key", "token", "secret", "password", "authorization"}
)


def _sensitive_field_name(value: Any) -> bool:
    name = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
    compact = name.replace("_", "")
    return any(
        name == sensitive
        or name.endswith(f"_{sensitive}")
        or compact.endswith(sensitive.replace("_", ""))
        for sensitive in _SENSITIVE_FIELD_NAMES
    )


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, TextStreamOutput):
        return {"model": value.model, "stream": True}
    if isinstance(value, bytes):
        return {"_bytes_sha256": hashlib.sha256(value).hexdigest()}
    if dataclasses.is_dataclass(value):
        return _json_value(dataclasses.asdict(value))
    if hasattr(value, "model_dump"):
        return _json_value(value.model_dump())
    if hasattr(value, "dict") and callable(value.dict):
        return _json_value(value.dict())
    if hasattr(value, "__dict__"):
        return _json_value(vars(value))
    if isinstance(value, Mapping):
        return {
            str(key): (
                _REDACTED_VALUE
                if _sensitive_field_name(key)
                else _json_value(item)
            )
            for key, item in value.items()
            if not callable(item)
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_value(item) for item in value]
    return str(value)


def _stored_credential(value: Any) -> str:
    text = str(value or "")
    return "" if text == _REDACTED_VALUE else text


def _credential_error(exc: BaseException) -> bool:
    status_code = _exception_status_code(exc)
    detail = str(getattr(exc, "detail", "") or exc).lower()
    return status_code in {401, 403} or any(
        token in detail
        for token in (
            "api key",
            "api_key",
            "authorization",
            "credential",
            "token",
            "密钥",
            "凭证",
        )
    )


def _exception_chain(exc: BaseException):
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = (
            getattr(current, "__cause__", None)
            or getattr(current, "__context__", None)
        )


def _exception_status_code(exc: BaseException) -> int:
    for current in _exception_chain(exc):
        direct = getattr(current, "status_code", 0)
        response = getattr(current, "response", None)
        value = direct or getattr(response, "status_code", 0)
        try:
            status_code = int(value or 0)
        except (TypeError, ValueError):
            status_code = 0
        if status_code:
            return status_code
    return 0


def _transient_recovery_error(exc: BaseException) -> bool:
    """Classify query failures that are safe to retry without re-submitting."""
    status_code = _exception_status_code(exc)
    if status_code:
        return (
            status_code in {408, 425, 429}
            or 500 <= status_code <= 599
        )
    transient_names = {
        "connecterror",
        "connecttimeout",
        "networkerror",
        "pooltimeout",
        "readerror",
        "readtimeout",
        "remoteprotocolerror",
        "timeout",
        "timeouterror",
        "writeerror",
        "writetimeout",
    }
    transient_phrases = (
        "connection refused",
        "connection reset",
        "connection aborted",
        "dns",
        "name resolution",
        "network is unreachable",
        "temporary failure",
        "timed out",
        "tls",
    )
    for current in _exception_chain(exc):
        if isinstance(current, (TimeoutError, ConnectionError)):
            return True
        name = type(current).__name__.lower()
        if name in transient_names:
            return True
        detail = str(
            getattr(current, "detail", "") or current
        ).lower()
        if any(phrase in detail for phrase in transient_phrases):
            return True
    return False


def _provider_output_value(output: ProviderOutput) -> dict[str, Any]:
    return {
        "text": output.text,
        "media": _json_value(output.media),
        "workflow_items": _json_value(output.workflow_items),
        "model": output.model,
        "usage": _json_value(output.usage),
        "raw": _json_value(output.raw),
        "remote_refs": _json_value(output.remote_refs),
        "metadata": _json_value(output.metadata),
        "legacy": _json_value(output.legacy),
    }


def _provider_output_from_value(value: Any) -> ProviderOutput:
    if not isinstance(value, Mapping):
        raise GenerationRunConflict("Generation Run 缺少可恢复的生成结果")
    legacy = copy.deepcopy(value.get("legacy"))
    if isinstance(legacy, list) and len(legacy) == 2:
        legacy = tuple(legacy)
    return ProviderOutput(
        text=str(value.get("text") or ""),
        media=tuple(value.get("media") or ()),
        workflow_items=tuple(value.get("workflow_items") or ()),
        model=str(value.get("model") or ""),
        usage=copy.deepcopy(value.get("usage")),
        raw=copy.deepcopy(value.get("raw")),
        remote_refs=tuple(
            str(item) for item in (value.get("remote_refs") or ())
        ),
        metadata=copy.deepcopy(value.get("metadata") or {}),
        legacy=legacy,
    )


def _canvas_output(
    output: ProviderOutput,
    media_kind: str = "",
) -> dict[str, Any]:
    """Project provider-specific output into the stable Canvas vocabulary."""
    legacy = output.legacy
    projected: dict[str, Any] = {}
    if isinstance(legacy, Mapping):
        for key in ("images", "image_items", "videos", "text"):
            if key in legacy:
                projected[key] = copy.deepcopy(legacy[key])
    if output.media and not any(
        key in projected for key in ("images", "image_items", "videos")
    ):
        projected["images"] = copy.deepcopy(list(output.media))
    if output.text and "text" not in projected:
        projected["text"] = output.text
    if str(media_kind or "").lower() == "video":
        images = projected.pop("images", None)
        projected.pop("image_items", None)
        if images is not None and "videos" not in projected:
            projected["videos"] = images
    return projected


def _has_workspace_media(value: Any) -> bool:
    if isinstance(value, str):
        return value.startswith((
            "/assets/output/",
            "/api/storage-files/generated/",
        ))
    if isinstance(value, Mapping):
        return any(_has_workspace_media(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_has_workspace_media(item) for item in value)
    return False


def _request_kind(request: RunRequest) -> str:
    if isinstance(request, ImageRun):
        return "image"
    if isinstance(request, VideoRun):
        return "video"
    if isinstance(request, TextRun):
        return "text-stream" if request.stream else "text"
    if isinstance(request, WorkflowRun):
        return "workflow"
    return "recovery"


def _canonical_request(request: RunRequest) -> dict[str, Any]:
    if isinstance(request, ImageRun):
        value = {
            "kind": "image",
            "prompt": request.prompt,
            "settings": _json_value(request.settings),
            "references": _json_value(request.references),
            "count": max(1, int(request.count or 1)),
            "prompts": list(request.prompts),
            "publication": request.publication,
        }
        submission_count = max(1, int(request.submission_count or 1))
        if submission_count != 1:
            value["submission_count"] = submission_count
        return value
    if isinstance(request, VideoRun):
        return {
            "kind": "video",
            "payload": _json_value(request.payload),
            "publication": request.publication,
        }
    if isinstance(request, TextRun):
        return {
            "kind": "text-stream" if request.stream else "text",
            "payload": _json_value(request.payload),
            "history": _json_value(request.history),
            "messages": _json_value(request.messages),
            "publication": request.publication,
        }
    if isinstance(request, WorkflowRun):
        return {
            "kind": "workflow",
            "operation": request.operation,
            "payload": _json_value(request.payload),
            "provider_id": request.provider_id,
            "publication": request.publication,
        }
    return {
        "kind": "recovery",
        "provider_id": request.provider_id,
        "remote_ref": request.remote_ref,
        "media_kind": request.media_kind,
        "publication": request.publication,
    }


def canonical_request_hash(request: RunRequest) -> str:
    encoded = json.dumps(
        _canonical_request(request),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _request_provider_id(request: RunRequest) -> str:
    if isinstance(request, ImageRun):
        return str(request.settings.get("provider_id") or "").strip()
    if isinstance(request, RecoveryRun):
        return str(request.provider_id or "").strip()
    if isinstance(request, WorkflowRun):
        return str(request.provider_id or "").strip()
    payload = getattr(request, "payload", None)
    return str(
        getattr(payload, "provider_id", "")
        or getattr(payload, "provider", "")
        or ""
    ).strip()


def _payload_field(payload: Any, *names: str) -> Any:
    for name in names:
        if isinstance(payload, Mapping) and name in payload:
            return payload.get(name)
        value = getattr(payload, name, None)
        if value is not None:
            return value
    return None


def _request_remote_refs(request: RunRequest) -> tuple[str, ...]:
    if isinstance(request, RecoveryRun):
        value = str(request.remote_ref or "").strip()
        return (value,) if value else ()
    if not (
        isinstance(request, WorkflowRun)
        and request.operation in RECOVERY_WORKFLOW_OPERATIONS
    ):
        return ()
    names = {
        "modelscope-angle-recovery": ("task_id", "taskId"),
        "modelscope-recovery": ("task_id", "taskId"),
        "runninghub-query": ("taskId", "task_id"),
        "comfyui-recovery": ("prompt_id", "promptId"),
    }[request.operation]
    value = str(_payload_field(request.payload, *names) or "").strip()
    return (value,) if value else ()


def _request_from_run(run: "_Run") -> RunRequest:
    value = run.request_data
    publication = str(value.get("publication") or "")
    context = copy.deepcopy(run.effect_context)
    kind = str(value.get("kind") or run.kind)
    if kind == "image":
        return ImageRun(
            prompt=str(value.get("prompt") or ""),
            settings=copy.deepcopy(value.get("settings") or {}),
            references=tuple(
                copy.deepcopy(value.get("references") or ())
            ),
            count=max(1, int(value.get("count") or 1)),
            submission_count=max(
                1, int(value.get("submission_count") or 1)
            ),
            prompts=tuple(
                str(item) for item in (value.get("prompts") or ())
            ),
            publication=publication,
            effect_context=context,
        )
    if kind == "video":
        return VideoRun(
            payload=copy.deepcopy(value.get("payload")),
            publication=publication,
            effect_context=context,
        )
    if kind in {"text", "text-stream"}:
        return TextRun(
            payload=copy.deepcopy(value.get("payload")),
            history=tuple(copy.deepcopy(value.get("history") or ())),
            messages=tuple(copy.deepcopy(value.get("messages") or ())),
            stream=kind == "text-stream",
            publication=publication,
            effect_context=context,
        )
    if kind == "workflow":
        return WorkflowRun(
            operation=str(value.get("operation") or ""),
            payload=copy.deepcopy(value.get("payload")),
            provider_id=str(value.get("provider_id") or run.provider_id),
            publication=publication,
            effect_context=context,
        )
    return RecoveryRun(
        provider_id=run.provider_id,
        remote_ref=run.remote_refs[0] if run.remote_refs else "",
        media_kind=str(value.get("media_kind") or "image"),
        publication=publication,
        effect_context=context,
    )


def _recovery_request_from_run(run: "_Run") -> RunRequest:
    remote_ref = run.remote_refs[0] if run.remote_refs else ""
    publication = str(run.request_data.get("publication") or "")
    context = copy.deepcopy(run.effect_context)
    if run.kind == "workflow":
        operation = str(run.request_data.get("operation") or "")
        payload = run.request_data.get("payload")
        payload_data = payload if isinstance(payload, Mapping) else {}
        if operation in {
            "modelscope-angle",
            "modelscope-angle-recovery",
        }:
            return WorkflowRun(
                operation="modelscope-angle-recovery",
                payload=SimpleNamespace(
                    task_id=remote_ref,
                    api_key=_stored_credential(
                        payload_data.get("api_key")
                    ),
                    client_id=payload_data.get("client_id"),
                ),
                provider_id=run.provider_id,
                publication=publication,
                effect_context=context,
            )
        if operation in {
            "modelscope",
            "modelscope-cloud",
            "modelscope-recovery",
        }:
            return WorkflowRun(
                operation="modelscope-recovery",
                payload=SimpleNamespace(
                    task_id=remote_ref,
                    api_key=_stored_credential(
                        payload_data.get("api_key")
                    ),
                    client_id=payload_data.get("client_id"),
                ),
                provider_id=run.provider_id or "modelscope",
                publication=publication,
                effect_context=context,
            )
        if operation in {
            "comfyui",
            "comfyui-saved",
            "comfyui-recovery",
        }:
            checkpoint = (
                run.result if isinstance(run.result, Mapping) else {}
            )
            return WorkflowRun(
                operation="comfyui-recovery",
                payload={
                    "prompt_id": remote_ref,
                    "backend": str(
                        checkpoint.get("backend")
                        or payload_data.get("backend")
                        or ""
                    ),
                },
                provider_id=run.provider_id,
                publication=publication,
                effect_context=context,
            )
        if operation in {
            "runninghub-submit",
            "runninghub-app-submit",
            "runninghub-query",
        }:
            return WorkflowRun(
                operation="runninghub-query",
                payload={
                    "taskId": remote_ref,
                    "useWallet": bool(
                        payload_data.get("useWallet")
                        or payload_data.get("use_wallet")
                    ),
                },
                provider_id=run.provider_id or "runninghub",
                publication=publication,
                effect_context=context,
            )
    settings = run.request_data.get("settings")
    image_operation = (
        str(settings.get("operation") or "")
        if isinstance(settings, Mapping)
        else ""
    )
    return RecoveryRun(
        provider_id=run.provider_id,
        remote_ref=remote_ref,
        media_kind=(
            "video"
            if run.kind == "video"
            else (
                "image_layer_decomposition"
                if image_operation == "image.layer_decomposition"
                else str(run.request_data.get("media_kind") or "image")
            )
        ),
        publication=publication,
        effect_context=context,
    )


def _is_recovery_execution(request: RunRequest, run: "_Run") -> bool:
    del run
    if isinstance(request, RecoveryRun):
        return True
    return (
        isinstance(request, WorkflowRun)
        and request.operation in RECOVERY_WORKFLOW_OPERATIONS
    )


def _target_value(target: RunTarget | None) -> dict[str, Any] | None:
    return dataclasses.asdict(target) if target is not None else None


def _generation_node_changes(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    result = copy.deepcopy(dict(value))
    changes: dict[str, Any] = {}
    image_items = result.get("image_items")
    images = result.get("images")
    videos = result.get("videos")
    if isinstance(image_items, list) and image_items:
        changes["images"] = copy.deepcopy(image_items)
    elif isinstance(images, list) and images:
        changes["images"] = [
            (
                copy.deepcopy(item)
                if isinstance(item, Mapping)
                else {"url": str(item), "kind": "image"}
            )
            for item in images
            if isinstance(item, Mapping) or str(item or "").strip()
        ]
    elif isinstance(videos, list) and videos:
        changes["images"] = [
            (
                copy.deepcopy(item)
                if isinstance(item, Mapping)
                else {"url": str(item), "kind": "video"}
            )
            for item in videos
            if isinstance(item, Mapping) or str(item or "").strip()
        ]
    if isinstance(result.get("text"), str):
        changes["text"] = result["text"]
        changes["textGenerationPending"] = False
    if changes:
        changes.update({"pending": 0, "running": False})
    return changes


def _generation_log_request(run: "_Run") -> dict[str, Any]:
    request = run.request_data
    kind = str(request.get("kind") or run.kind)
    if kind == "image":
        settings = request.get("settings")
        settings = dict(settings) if isinstance(settings, Mapping) else {}
        selected = {
            key: copy.deepcopy(settings[key])
            for key in (
                "provider_id",
                "model",
                "size",
                "requested_size",
                "target_aspect_ratio",
                "reference_aspect_ratio",
                "quality",
            )
            if settings.get(key) not in (None, "")
        }
        selected["count"] = max(1, int(request.get("count") or 1))
        selected["submission_count"] = max(
            1,
            int(request.get("submission_count") or 1),
        )
        return selected
    payload = request.get("payload")
    payload = dict(payload) if isinstance(payload, Mapping) else {}
    names = (
        (
            "provider_id",
            "provider",
            "model",
            "duration",
            "aspect_ratio",
            "resolution",
            "size",
        )
        if kind == "video"
        else ("provider_id", "provider", "model", "operation")
    )
    selected = {
        key: copy.deepcopy(payload[key])
        for key in names
        if payload.get(key) not in (None, "")
    }
    if kind == "workflow" and request.get("operation"):
        selected.setdefault("operation", request.get("operation"))
    return selected


def _generation_log_prompt(run: "_Run") -> str:
    request = run.request_data
    if request.get("prompt"):
        return str(request.get("prompt") or "")
    payload = request.get("payload")
    if isinstance(payload, Mapping):
        for key in ("prompt", "message"):
            if payload.get(key):
                return str(payload.get(key) or "")
    history = run.effect_context.get("history")
    if isinstance(history, Mapping) and history.get("prompt"):
        return str(history.get("prompt") or "")
    return ""


def _generation_log_refs(run: "_Run") -> list[Any]:
    request = run.request_data
    references = request.get("references")
    if isinstance(references, (list, tuple)):
        return copy.deepcopy(list(references))
    payload = request.get("payload")
    if not isinstance(payload, Mapping):
        return []
    refs: list[Any] = []
    for key, role in (
        ("images", "image"),
        ("image_urls", "image"),
        ("videos", "video"),
        ("audios", "audio"),
    ):
        values = payload.get(key)
        if not isinstance(values, (list, tuple)):
            continue
        for value in values:
            if isinstance(value, Mapping):
                item = copy.deepcopy(dict(value))
                item.setdefault("role", role)
            else:
                item = {"url": str(value or ""), "role": role}
            if str(item.get("url") or item.get("src") or "").strip():
                refs.append(item)
    return refs


def _generation_log_outputs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, Mapping):
        return []
    source_kind = "image"
    values = value.get("image_items")
    if not isinstance(values, list) or not values:
        values = value.get("images")
    if not isinstance(values, list) or not values:
        values = value.get("videos")
        source_kind = "video"
    if not isinstance(values, list):
        return []
    outputs: list[dict[str, Any]] = []
    for value in values:
        item = copy.deepcopy(dict(value)) if isinstance(value, Mapping) else {
            "url": str(value or "")
        }
        url = str(
            item.get("url")
            or item.get("path")
            or item.get("src")
            or item.get("uri")
            or ""
        ).strip()
        if not url:
            continue
        item["url"] = url
        item.setdefault("kind", item.get("type") or source_kind)
        outputs.append(item)
    return outputs


def _generation_terminal_effect_intent(
    run: "_Run",
) -> GenerationRunEffectIntent | None:
    if run.target is None or run.status not in TERMINAL_STATUSES:
        return None
    if run.status == "discarded":
        return None
    prepared = (
        PreparedGenerationOutput.from_stored(run.prepared_output)
        if isinstance(run.prepared_output, Mapping)
        else None
    )
    canvas_result = prepared.canvas if prepared is not None else {}
    node_changes = (
        _generation_node_changes(canvas_result)
        if run.status == "succeeded"
        else {}
    )
    if not node_changes:
        node_changes = (
            {
                "textGenerationPending": False,
                "pending": 0,
                "running": False,
            }
            if run.kind in {"text", "text-stream"}
            else {"images": [], "pending": 0, "running": False}
        )
    outputs = _generation_log_outputs(canvas_result)
    log_status = {
        "succeeded": "success",
        "failed": "partial" if outputs else "failed",
        "cancelled": "cancelled",
    }[run.status]
    request = run.request_data
    settings = request.get("settings")
    settings = dict(settings) if isinstance(settings, Mapping) else {}
    payload = request.get("payload")
    payload = dict(payload) if isinstance(payload, Mapping) else {}
    platform = str(
        run.public_metadata.get("provider_id")
        or settings.get("provider_id")
        or payload.get("provider_id")
        or payload.get("provider")
        or run.provider_id
        or ""
    )
    model = str(
        run.public_metadata.get("model")
        or settings.get("model")
        or payload.get("model")
        or ""
    )
    tasks = [
        {
            "index": int(attempt.get("index") or index),
            "status": str(attempt.get("status") or ""),
            "upstreamTaskId": str(attempt.get("remote_ref") or ""),
            "technicalError": str(attempt.get("error") or ""),
        }
        for index, attempt in enumerate(run.child_attempts)
        if isinstance(attempt, Mapping)
    ]
    final_log: dict[str, Any] = {
        "runId": run.id,
        "nodeId": run.target.node_id,
        "status": log_status,
        "createdAt": int(run.updated_at * 1000),
        "durationMs": max(0, int((run.updated_at - run.created_at) * 1000)),
        "platform": platform,
        "model": model,
        "prompt": _generation_log_prompt(run),
        "request": _generation_log_request(run),
        "refs": _generation_log_refs(run),
        "outputs": outputs,
        "tasks": tasks,
        "diagnostics": {
            "request_fingerprint": run.request_hash,
            "recoverable": bool(run.recoverable),
            "provider_id": run.provider_id,
            "status_code": int(run.status_code or 0),
            "upstream_task_ids": copy.deepcopy(run.remote_refs),
        },
    }
    if run.error:
        final_log["error"] = run.error
    return GenerationRunEffectIntent(
        terminal_status=run.status,
        node_changes=node_changes,
        final_log=final_log,
    )


def _target_from_value(value: Any) -> RunTarget | None:
    if not isinstance(value, Mapping):
        return None
    try:
        return RunTarget(
            canvas_id=str(value.get("canvas_id") or ""),
            node_id=str(value.get("node_id") or ""),
            operation_id=str(value.get("operation_id") or ""),
            request_index=int(value.get("request_index") or 0),
        )
    except (TypeError, ValueError):
        return None


@dataclass
class _Run:
    id: str
    kind: str
    status: str
    owner: str
    key: str
    request_hash: str
    request_data: dict[str, Any]
    effect_context: dict[str, Any]
    provider_id: str
    created_at: float
    updated_at: float
    result: Any = None
    error: str = ""
    status_code: int = 0
    remote_refs: list[str] = field(default_factory=list)
    target: RunTarget | None = None
    public_metadata: dict[str, Any] = field(default_factory=dict)
    effects_done: bool = False
    recoverable: bool = False
    phase: str = "submitted"
    provider_output: dict[str, Any] | None = None
    prepared_output: dict[str, Any] | None = None
    child_attempts: list[dict[str, Any]] = field(default_factory=list)

    def stored(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "owner": self.owner,
            "key": self.key,
            "request_hash": self.request_hash,
            "request": _json_value(self.request_data),
            "effect_context": _json_value(self.effect_context),
            "provider_id": self.provider_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "result": _json_value(self.result),
            "error": self.error,
            "status_code": self.status_code,
            "remote_refs": list(self.remote_refs),
            "target": _target_value(self.target),
            "public_metadata": _json_value(self.public_metadata),
            "effects_done": self.effects_done,
            "recoverable": self.recoverable,
            "phase": self.phase,
            "provider_output": _json_value(self.provider_output),
            "prepared_output": _json_value(self.prepared_output),
            "child_attempts": _json_value(self.child_attempts),
        }

    @classmethod
    def from_stored(cls, value: Mapping[str, Any]) -> "_Run":
        status = str(value.get("status") or "failed")
        remote_refs = [
            str(item)
            for item in (value.get("remote_refs") or [])
            if str(item or "").strip()
        ]
        phase = str(value.get("phase") or "submitted")
        provider_output = value.get("provider_output")
        prepared_output = value.get("prepared_output")
        child_attempts = [
            copy.deepcopy(dict(item))
            for item in (value.get("child_attempts") or ())
            if isinstance(item, Mapping)
        ]
        indeterminate_child = next(
            (
                item
                for item in child_attempts
                if item.get("status") == "submitting"
                and not str(item.get("remote_ref") or "").strip()
            ),
            None,
        )
        durable_child_progress = any(
            (
                item.get("status") == "succeeded"
                and isinstance(item.get("provider_output"), Mapping)
            )
            or (
                item.get("status") in ACTIVE_STATUSES
                and str(item.get("remote_ref") or "").strip()
            )
            for item in child_attempts
        )
        if status in ACTIVE_STATUSES and indeterminate_child is not None:
            status = "failed"
            error = (
                "应用重启时有一张批量图片处于提交中，但尚未取得远端任务编号；"
                "为避免重复计费，系统不会自动重提"
            )
            status_code = 409
            recoverable = False
        elif (
            status in ACTIVE_STATUSES
            and not remote_refs
            and not durable_child_progress
            and not bool(value.get("recoverable"))
            and not (
                (
                    phase == "provider_completed"
                    and isinstance(provider_output, Mapping)
                )
                or (
                    phase == "output_prepared"
                    and isinstance(prepared_output, Mapping)
                )
            )
        ):
            status = "failed"
            error = (
                "应用重启中断了尚未消费完成的流式生成"
                if phase == "stream_open"
                else "应用重启前生成任务尚未取得可恢复的远端任务编号"
            )
            status_code = 500
            recoverable = False
        else:
            error = str(value.get("error") or "")
            status_code = int(value.get("status_code") or 0)
            recoverable = bool(value.get("recoverable") or remote_refs)
        return cls(
            id=str(value.get("id") or ""),
            kind=str(value.get("kind") or ""),
            status=status,
            owner=str(value.get("owner") or ""),
            key=str(value.get("key") or ""),
            request_hash=str(value.get("request_hash") or ""),
            request_data=dict(value.get("request") or {}),
            effect_context=dict(value.get("effect_context") or {}),
            provider_id=str(value.get("provider_id") or ""),
            created_at=float(value.get("created_at") or 0),
            updated_at=float(value.get("updated_at") or 0),
            result=copy.deepcopy(value.get("result")),
            error=error,
            status_code=status_code,
            remote_refs=remote_refs,
            target=_target_from_value(value.get("target")),
            public_metadata=dict(value.get("public_metadata") or {}),
            effects_done=bool(value.get("effects_done")),
            recoverable=recoverable,
            phase=phase,
            provider_output=(
                copy.deepcopy(dict(provider_output))
                if isinstance(provider_output, Mapping)
                else None
            ),
            prepared_output=(
                copy.deepcopy(dict(prepared_output))
                if isinstance(prepared_output, Mapping)
                else None
            ),
            child_attempts=child_attempts,
        )

    def snapshot(self, *, deduplicated: bool = False) -> GenerationRunSnapshot:
        return GenerationRunSnapshot(
            id=self.id,
            kind=self.kind,
            status=self.status,
            owner=self.owner,
            key=self.key,
            request_hash=self.request_hash,
            created_at=self.created_at,
            updated_at=self.updated_at,
            result=copy.deepcopy(self.result),
            error=self.error,
            status_code=self.status_code,
            remote_refs=tuple(self.remote_refs),
            target=self.target,
            public_metadata=copy.deepcopy(self.public_metadata),
            provider_id=self.provider_id,
            request_data=copy.deepcopy(self.request_data),
            child_attempts=tuple(copy.deepcopy(self.child_attempts)),
            deduplicated=deduplicated,
            recoverable=self.recoverable,
        )


def _lifecycle_attempt_value(attempt: GenerationRunAttempt) -> dict[str, Any]:
    value = copy.deepcopy(dict(attempt.payload))
    value.update(
        {
            "index": attempt.attempt_index,
            "status": attempt.status,
            "provider_id": attempt.provider_id,
            "remote_ref": attempt.remote_ref,
            "provider_output": copy.deepcopy(attempt.provider_output),
            "error": attempt.error,
            "updated_at": attempt.updated_at,
        }
    )
    return value


def _lifecycle_run_value(state: GenerationRunState) -> dict[str, Any]:
    return {
        "id": state.run_id,
        "kind": state.kind,
        "status": state.status,
        "owner": state.owner,
        "key": state.key,
        "request_hash": state.request_hash,
        "request": copy.deepcopy(dict(state.request)),
        "effect_context": copy.deepcopy(dict(state.effect_context)),
        "provider_id": state.provider_id,
        "created_at": state.created_at,
        "updated_at": state.updated_at,
        "result": copy.deepcopy(state.result),
        "error": state.error,
        "status_code": state.status_code,
        "remote_refs": [value for _provider, value in state.remote_refs],
        "target": (
            copy.deepcopy(dict(state.target))
            if state.target is not None
            else None
        ),
        "public_metadata": copy.deepcopy(dict(state.public_metadata)),
        "effects_done": False,
        "recoverable": state.recoverable,
        "phase": state.phase,
        "provider_output": copy.deepcopy(state.provider_output),
        "prepared_output": copy.deepcopy(state.prepared_output),
        "child_attempts": [
            _lifecycle_attempt_value(attempt) for attempt in state.attempts
        ],
    }


class GenerationRuns:
    """Deep Generation Run implementation behind the six lifecycle actions."""

    def __init__(
        self,
        *,
        executor: GenerationExecutor,
        effects: GenerationEffects,
        store_path: Callable[[], str | Path | None] | None = None,
        target_guard: GenerationTargetGuard | None = None,
        lifecycle_store: GenerationRunLifecycleStore | None = None,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._executor = executor
        self._effects = effects
        self._store_path = store_path
        self._target_guard = target_guard
        self._lifecycle_store = lifecycle_store
        self._now = now
        self._lock = threading.RLock()
        self._loaded_path: Path | None = None
        self._runs: dict[str, _Run] = {}
        self._keys: dict[tuple[str, str], str] = {}
        self._remote_runs: dict[tuple[str, str], list[str]] = {}
        self._requests: dict[str, RunRequest] = {}
        self._events: dict[str, asyncio.Event] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._owners: dict[str, asyncio.Task[Any]] = {}
        self._runtime_results: dict[str, Any] = {}
        self._pausing: set[str] = set()
        self._lifecycle_projection_tail: asyncio.Task[None] | None = None
        self._lifecycle_projection_error: Exception | None = None

    async def restore_lifecycle_authority(self, *, limit: int = 1000) -> int:
        """Load unfinished Runs when SQLite is the sole lifecycle authority."""

        if self._path() is not None:
            raise GenerationRunConflict(
                "JSON store 与 lifecycle authority 不能同时恢复"
            )
        lifecycle_store = self._lifecycle_store
        if lifecycle_store is None:
            raise GenerationRunConflict("缺少 lifecycle authority Store")
        states = await lifecycle_store.load_unfinished(
            limit=max(1, int(limit)),
        )
        restored = [_Run.from_stored(_lifecycle_run_value(state)) for state in states]
        with self._lock:
            if self._tasks or self._owners:
                raise GenerationRunConflict(
                    "Generation Run 已开始执行，不能重新恢复 authority"
                )
            self._runs = {}
            self._keys = {}
            self._remote_runs = {}
            self._requests = {}
            self._events = {}
            self._runtime_results = {}
            self._pausing = set()
            for run in restored:
                if not run.id:
                    raise GenerationRunConflict(
                        "lifecycle authority 包含无效 Run identity"
                    )
                self._runs[run.id] = run
                if run.key:
                    self._keys[(run.owner, run.key)] = run.id
                self._index_remote_refs_locked(run)
        return len(restored)

    def _path(self) -> Path | None:
        if self._store_path is None:
            return None
        value = self._store_path()
        if value is None:
            return None
        return Path(value).expanduser().resolve()

    def _load_locked(self) -> None:
        path = self._path()
        if path == self._loaded_path:
            return
        self._loaded_path = path
        self._runs = {}
        self._keys = {}
        self._remote_runs = {}
        self._requests = {}
        self._events = {}
        self._tasks = {}
        self._owners = {}
        self._runtime_results = {}
        self._pausing = set()
        if path is None or not path.exists():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            payload = {}
        for value in payload.get("runs", []) if isinstance(payload, dict) else []:
            if not isinstance(value, Mapping):
                continue
            run = _Run.from_stored(value)
            if not run.id:
                continue
            self._runs[run.id] = run
            if run.key:
                self._keys[(run.owner, run.key)] = run.id
            self._index_remote_refs_locked(run)

    def _index_remote_refs_locked(self, run: _Run) -> None:
        for remote_ref in run.remote_refs:
            key = (run.provider_id, str(remote_ref or "").strip())
            if not key[1]:
                continue
            bucket = self._remote_runs.setdefault(key, [])
            if run.id not in bucket:
                bucket.append(run.id)

    def _persist_locked(
        self,
        changed_run: _Run,
        *,
        lifecycle_effect: GenerationRunEffectIntent | None = None,
    ) -> None:
        path = self._path()
        if path is None:
            self._enqueue_lifecycle_projection_locked(
                changed_run.stored(),
                effect=lifecycle_effect,
            )
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": _STORE_VERSION,
            "runs": [
                run.stored()
                for run in sorted(
                    self._runs.values(),
                    key=lambda item: (item.created_at, item.id),
                )
            ],
        }
        temporary = path.with_name(
            f".{path.name}.{uuid.uuid4().hex}.tmp"
        )
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
        self._enqueue_lifecycle_projection_locked(
            changed_run.stored(),
            effect=lifecycle_effect,
        )

    def _persist_terminal_locked(self, run: _Run) -> None:
        self._persist_locked(
            run,
            lifecycle_effect=_generation_terminal_effect_intent(run),
        )

    def _enqueue_lifecycle_projection_locked(
        self,
        value: Mapping[str, Any],
        *,
        effect: GenerationRunEffectIntent | None = None,
    ) -> None:
        lifecycle_store = self._lifecycle_store
        if lifecycle_store is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError as exc:
            if self._lifecycle_projection_error is None:
                self._lifecycle_projection_error = exc
            return
        previous = self._lifecycle_projection_tail
        snapshot = copy.deepcopy(dict(value))
        effect_snapshot = copy.deepcopy(effect)

        async def project_after_previous() -> None:
            if previous is not None:
                await asyncio.shield(previous)
            try:
                await lifecycle_store.persist(
                    snapshot,
                    effect=effect_snapshot,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                with self._lock:
                    if self._lifecycle_projection_error is None:
                        self._lifecycle_projection_error = exc

        self._lifecycle_projection_tail = loop.create_task(
            project_after_previous()
        )

    async def wait_for_lifecycle_projection(self) -> None:
        """Wait for the optional JSON-to-Store compatibility projection."""

        while True:
            with self._lock:
                tail = self._lifecycle_projection_tail
            if tail is None:
                break
            await asyncio.shield(tail)
            with self._lock:
                if tail is self._lifecycle_projection_tail:
                    break
        with self._lock:
            failure = self._lifecycle_projection_error
        if failure is not None:
            raise GenerationRunLifecycleProjectionError(
                str(failure)
            ) from failure

    @staticmethod
    def _require_owner(run: _Run, owner: str) -> None:
        if run.owner and str(owner or "") != run.owner:
            raise GenerationRunNotFound("Generation Run 不存在")

    async def start(
        self,
        request: RunRequest,
        *,
        key: str = "",
        owner: str = "",
        delivery: Delivery | None = None,
        target: RunTarget | None = None,
        public_metadata: Mapping[str, Any] | None = None,
    ) -> GenerationRunSnapshot:
        delivery = delivery or Inline()
        request_hash = canonical_request_hash(request)
        seeded_remote_refs = list(_request_remote_refs(request))
        key = str(key or "").strip()
        owner = str(owner or "").strip()
        if target is not None and self._target_guard is not None:
            self._target_guard.validate(owner, target)
        with self._lock:
            self._load_locked()
            existing_id = self._keys.get((owner, key)) if key else None
            existing = self._runs.get(existing_id or "")
            if existing is not None:
                if existing.request_hash != request_hash:
                    raise GenerationRunConflict(
                        "相同 Generation operation ID 的请求内容不一致"
                    )
                event = self._events.get(existing.id)
                snapshot = existing.snapshot(deduplicated=True)
            else:
                timestamp = float(self._now())
                run_id = f"run_{uuid.uuid4().hex}"
                run = _Run(
                    id=run_id,
                    kind=_request_kind(request),
                    status="queued",
                    owner=owner,
                    key=key,
                    request_hash=request_hash,
                    request_data=_canonical_request(request),
                    effect_context=dict(
                        _json_value(
                            getattr(request, "effect_context", {}) or {}
                        )
                    ),
                    provider_id=_request_provider_id(request),
                    created_at=timestamp,
                    updated_at=timestamp,
                    remote_refs=seeded_remote_refs,
                    target=target,
                    public_metadata=dict(
                        _json_value(public_metadata or {})
                    ),
                    recoverable=bool(
                        seeded_remote_refs
                        or self._is_restart_recoverable(request)
                    ),
                )
                self._runs[run_id] = run
                self._index_remote_refs_locked(run)
                self._requests[run_id] = request
                self._events[run_id] = asyncio.Event()
                if key:
                    self._keys[(owner, key)] = run_id
                self._persist_locked(run)
                existing = None
                event = None
                snapshot = run.snapshot()

        if existing is not None:
            if isinstance(delivery, Inline) and event is not None:
                await event.wait()
                return self.get(existing.id, owner=owner, deduplicated=True)
            return snapshot

        if isinstance(delivery, Background):
            task = asyncio.create_task(self._execute(run_id, request))
            with self._lock:
                self._tasks[run_id] = task
            add_done_callback = getattr(task, "add_done_callback", None)
            if callable(add_done_callback):
                add_done_callback(
                    lambda completed, rid=run_id: self._task_done(
                        rid, completed
                    )
                )
            return snapshot
        return await self._execute(run_id, request)

    def _task_done(self, run_id: str, task: asyncio.Task[Any]) -> None:
        cancelled = task.cancelled()
        if not cancelled:
            try:
                task.exception()
            except (asyncio.CancelledError, Exception):
                pass

        monitor: asyncio.Task[Any] | None = None
        with self._lock:
            if self._tasks.get(run_id) is not task:
                return
            self._tasks.pop(run_id, None)
            self._load_locked()
            run = self._runs.get(run_id)
            if (
                not cancelled
                and run is not None
                and run.status in ACTIVE_STATUSES
                and run.recoverable
                and run_id not in self._pausing
            ):
                monitor = asyncio.create_task(
                    self._monitor_active(run_id, run.owner)
                )
                self._tasks[run_id] = monitor
        if monitor is not None:
            monitor.add_done_callback(
                lambda completed, rid=run_id: self._task_done(
                    rid, completed
                )
            )

    async def _execute(
        self,
        run_id: str,
        request: RunRequest,
        *,
        replay_output: ProviderOutput | None = None,
        replay_prepared: PreparedGenerationOutput | None = None,
    ) -> GenerationRunSnapshot:
        owner_task = asyncio.current_task()
        with self._lock:
            self._load_locked()
            run = self._runs[run_id]
            if run.status in TERMINAL_STATUSES:
                return run.snapshot()
            run.status = "running"
            run.updated_at = float(self._now())
            if owner_task is not None:
                self._owners[run_id] = owner_task
            self._persist_locked(run)
        try:
            if replay_prepared is not None:
                return await self._complete_prepared(
                    run_id,
                    request,
                    replay_prepared,
                    provider_output=None,
                )
            if (
                replay_output is None
                and isinstance(request, ImageRun)
                and self._requires_child_attempts(request)
            ):
                return await self._execute_image_children(run_id, request)
            result = (
                Completed(replay_output)
                if replay_output is not None
                else await self._execute_provider(
                    run_id,
                    request,
                )
            )
            with self._lock:
                stored_run = self._runs[run_id]
                publication_request = (
                    _request_from_run(stored_run)
                    if _is_recovery_execution(request, stored_run)
                    else request
                )
            return await self._accept_execution(
                run_id,
                publication_request,
                result,
            )
        except asyncio.CancelledError:
            with self._lock:
                run = self._runs[run_id]
                if run.status not in TERMINAL_STATUSES:
                    if run_id in self._pausing:
                        run.error = ""
                        run.status_code = 0
                    else:
                        run.status = "cancelled"
                        run.error = "用户取消了生成任务以立即重启"
                        run.status_code = 409
                    run.updated_at = float(self._now())
                    if run.status in TERMINAL_STATUSES:
                        self._persist_terminal_locked(run)
                    else:
                        self._persist_locked(run)
            raise
        except Exception as exc:
            with self._lock:
                run = self._runs[run_id]
                provider_completed = (
                    (
                        run.phase == "provider_completed"
                        and run.provider_output is not None
                    )
                    or (
                        run.phase == "output_prepared"
                        and run.prepared_output is not None
                    )
                )
                recovery_execution = _is_recovery_execution(
                    request, run
                )
                missing_recovery_credential = (
                    recovery_execution
                    and not provider_completed
                    and _credential_error(exc)
                )
                transient_recovery_failure = (
                    recovery_execution
                    and not provider_completed
                    and not missing_recovery_credential
                    and _transient_recovery_error(exc)
                )
                permanent_recovery_failure = (
                    recovery_execution
                    and not provider_completed
                    and not missing_recovery_credential
                    and not transient_recovery_failure
                )
                run.status = (
                    "running"
                    if (
                        not missing_recovery_credential
                        and not permanent_recovery_failure
                        and (provider_completed or run.recoverable)
                    )
                    else "failed"
                )
                detail = str(getattr(exc, "detail", "") or exc)
                run.error = (
                    "恢复任务缺少当前可用的提供方凭证；"
                    "出于安全考虑，一次性凭证不会写入磁盘，也不会自动重提任务。"
                    "请在 API 设置中保存凭证后使用原任务编号查询。"
                    if missing_recovery_credential
                    else detail
                )
                run.status_code = int(
                    _exception_status_code(exc) or 500
                )
                run.recoverable = (
                    False
                    if (
                        missing_recovery_credential
                        or permanent_recovery_failure
                    )
                    else provider_completed or run.recoverable
                )
                run.updated_at = float(self._now())
                if run.status in TERMINAL_STATUSES:
                    self._persist_terminal_locked(run)
                else:
                    self._persist_locked(run)
            raise
        finally:
            with self._lock:
                self._owners.pop(run_id, None)
                event = self._events.get(run_id)
                if event is not None:
                    event.set()

    def _requires_child_attempts(self, request: ImageRun) -> bool:
        if max(1, int(request.submission_count or 1)) > 1:
            return True
        if max(1, int(request.count or 1)) <= 1:
            return False
        predicate = getattr(
            self._executor, "requires_child_attempts", None
        )
        return bool(callable(predicate) and predicate(request))

    def _is_restart_recoverable(self, request: RunRequest) -> bool:
        predicate = getattr(
            self._executor, "is_restart_recoverable", None
        )
        if not callable(predicate):
            return False
        try:
            return bool(predicate(request))
        except Exception:
            return False

    def _image_child_plan(
        self,
        request: ImageRun,
    ) -> tuple[int, int, int]:
        outputs_per_submission = max(
            1, min(8, int(request.count or 1))
        )
        submission_count = max(
            1, min(8, int(request.submission_count or 1))
        )
        predicate = getattr(
            self._executor, "requires_child_attempts", None
        )
        split_outputs = bool(
            outputs_per_submission > 1
            and callable(predicate)
            and predicate(request)
        )
        if split_outputs:
            return (
                submission_count * outputs_per_submission,
                1,
                outputs_per_submission,
            )
        return submission_count, outputs_per_submission, 1

    async def _execute_provider(
        self,
        run_id: str,
        request: RunRequest,
        *,
        child_index: int | None = None,
    ) -> ExecutionResult:
        """Execute while making a provider submission durable before polling.

        New provider adapters synchronously call ``checkpoint`` as soon as a
        paid remote task identifier exists.  Signature probing preserves
        compatibility with isolated executors and older extensions.
        """

        def checkpoint(result: Pending | Queued) -> None:
            self._checkpoint_remote(run_id, result, child_index=child_index)

        def progress(value: Mapping[str, Any]) -> None:
            self._checkpoint_progress(run_id, value)

        execute = self._executor.execute
        signature = inspect.signature(execute)
        options: dict[str, Any] = {}
        for name, value in (
            ("checkpoint", checkpoint),
            ("progress", progress),
        ):
            candidate = {**options, name: value}
            try:
                signature.bind(request, **candidate)
            except TypeError:
                continue
            options = candidate
        return await execute(request, **options)

    def _checkpoint_progress(
        self,
        run_id: str,
        value: Mapping[str, Any],
    ) -> None:
        if not isinstance(value, Mapping):
            return
        projection: dict[str, Any] = {}
        phase = str(value.get("phase") or "").strip()[:80]
        message = str(value.get("message") or "").strip()[:160]
        if phase:
            projection["phase"] = phase
        if message:
            projection["message"] = message
        if value.get("progress") is not None:
            try:
                percent = int(value["progress"])
            except (TypeError, ValueError, OverflowError):
                percent = None
            if percent is not None:
                projection["progress"] = max(0, min(100, percent))
        if not projection:
            return
        with self._lock:
            self._load_locked()
            run = self._runs.get(run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return
            run.public_metadata.update(projection)
            run.updated_at = float(self._now())
            self._persist_locked(run)

    def _checkpoint_remote(
        self,
        run_id: str,
        result: Pending | Queued,
        *,
        child_index: int | None = None,
    ) -> None:
        if not isinstance(result, (Pending, Queued)):
            raise TypeError("remote checkpoint must be Pending or Queued")
        remote_ref = (
            result.remote_ref
            if isinstance(result, Pending)
            else result.queue_ref
        )
        raw_result = self._normalized_raw(result)
        with self._lock:
            self._load_locked()
            run = self._runs[run_id]
            if child_index is not None:
                while len(run.child_attempts) <= child_index:
                    run.child_attempts.append(
                        {
                            "index": len(run.child_attempts),
                            "status": "running",
                        }
                    )
                run.child_attempts[child_index] = {
                    "index": child_index,
                    "status": result.status,
                    "remote_ref": str(remote_ref),
                    "raw": _json_value(raw_result),
                }
                refs = [
                    str(item.get("remote_ref") or "")
                    for item in run.child_attempts
                    if item.get("status") in ACTIVE_STATUSES
                    and str(item.get("remote_ref") or "")
                ]
            else:
                refs = [str(remote_ref)]
            run.status = result.status
            run.remote_refs = refs
            self._index_remote_refs_locked(run)
            run.result = _json_value(raw_result)
            self._runtime_results[run_id] = raw_result
            run.recoverable = True
            run.updated_at = float(self._now())
            # This atomic replace must finish before the provider may poll.
            self._persist_locked(run)

    @staticmethod
    def _combined_outputs(
        outputs: list[ProviderOutput],
    ) -> ProviderOutput:
        return ProviderOutput(
            text="\n".join(
                item.text for item in outputs if item.text
            ),
            media=tuple(
                media for item in outputs for media in item.media
            ),
            workflow_items=tuple(
                value
                for item in outputs
                for value in item.workflow_items
            ),
            model=next(
                (item.model for item in outputs if item.model),
                "",
            ),
            usage=tuple(item.usage for item in outputs),
            raw=tuple(item.raw for item in outputs),
            remote_refs=tuple(
                ref for item in outputs for ref in item.remote_refs
            ),
            metadata={"batch": tuple(outputs)},
            legacy=tuple(item.legacy for item in outputs),
        )

    async def _execute_image_children(
        self,
        run_id: str,
        request: ImageRun,
    ) -> GenerationRunSnapshot:
        total, child_count, prompt_cycle = self._image_child_plan(request)
        while True:
            with self._lock:
                run = self._runs[run_id]
                attempts = copy.deepcopy(run.child_attempts)
            pending_index = next(
                (
                    index
                    for index, attempt in enumerate(attempts)
                    if attempt.get("status") in ACTIVE_STATUSES
                ),
                None,
            )
            if pending_index is not None:
                attempt = attempts[pending_index]
                remote_ref = str(attempt.get("remote_ref") or "")
                result = await self._execute_provider(
                    run_id,
                    RecoveryRun(
                        provider_id=run.provider_id,
                        remote_ref=remote_ref,
                    ),
                    child_index=pending_index,
                )
                index = pending_index
            elif len(attempts) < total:
                index = len(attempts)
                with self._lock:
                    run = self._runs[run_id]
                    run.child_attempts.append(
                        {
                            "index": index,
                            "status": "submitting",
                            "remote_ref": "",
                        }
                    )
                    run.updated_at = float(self._now())
                    self._persist_locked(run)
                result = await self._execute_provider(
                    run_id,
                    dataclasses.replace(
                        request,
                        prompt=(
                            request.prompts[index % prompt_cycle]
                            if index % prompt_cycle < len(request.prompts)
                            else request.prompt
                        ),
                        count=child_count,
                        submission_count=1,
                        prompts=(),
                    ),
                    child_index=index,
                )
            else:
                outputs = [
                    _provider_output_from_value(
                        attempt.get("provider_output")
                    )
                    for attempt in attempts
                    if attempt.get("status") == "succeeded"
                ]
                return await self._accept_execution(
                    run_id,
                    request,
                    Completed(self._combined_outputs(outputs)),
                )

            result = self._expire_missing_remote_history(run_id, result)

            if isinstance(result, Completed):
                if not isinstance(result.output, ProviderOutput):
                    raise RuntimeError(
                        "image child returned an invalid completed output"
                    )
                with self._lock:
                    run = self._runs[run_id]
                    run.child_attempts[index] = {
                        "index": index,
                        "status": "succeeded",
                        "provider_output": _provider_output_value(
                            result.output
                        ),
                    }
                    run.remote_refs = [
                        str(item.get("remote_ref") or "")
                        for item in run.child_attempts
                        if item.get("status") in ACTIVE_STATUSES
                        and str(item.get("remote_ref") or "")
                    ]
                    self._index_remote_refs_locked(run)
                    run.updated_at = float(self._now())
                    self._persist_locked(run)
                continue

            if isinstance(result, (Pending, Queued)):
                remote_ref = (
                    result.remote_ref
                    if isinstance(result, Pending)
                    else result.queue_ref
                )
                raw_result = self._normalized_raw(result)
                with self._lock:
                    run = self._runs[run_id]
                    run.child_attempts[index] = {
                        "index": index,
                        "status": result.status,
                        "remote_ref": str(remote_ref),
                        "raw": _json_value(raw_result),
                    }
                    run.status = result.status
                    run.remote_refs = [
                        str(item.get("remote_ref") or "")
                        for item in run.child_attempts
                        if item.get("status") in ACTIVE_STATUSES
                        and str(item.get("remote_ref") or "")
                    ]
                    self._index_remote_refs_locked(run)
                    run.result = _json_value(raw_result)
                    self._runtime_results[run_id] = raw_result
                    run.recoverable = True
                    run.updated_at = float(self._now())
                    self._persist_locked(run)
                    return dataclasses.replace(
                        run.snapshot(),
                        result=raw_result,
                    )

            if isinstance(result, Failed):
                with self._lock:
                    run = self._runs[run_id]
                    run.child_attempts[index] = {
                        "index": index,
                        "status": result.status,
                        "error": result.error,
                        "raw": _json_value(self._normalized_raw(result)),
                    }
                    completed = [
                        attempt.get("provider_output", {}).get("legacy")
                        for attempt in run.child_attempts
                        if attempt.get("status") == "succeeded"
                    ]
                    run.status = result.status
                    run.error = result.error
                    run.status_code = 500
                    run.result = {"partial_outputs": completed}
                    run.updated_at = float(self._now())
                    self._persist_terminal_locked(run)
                    return run.snapshot()

            raise RuntimeError("image child returned an invalid result")

    @staticmethod
    def _normalized_raw(result: Completed | Pending | Queued | Failed) -> Any:
        value = result.output if isinstance(result, Completed) else result.raw
        if isinstance(value, ProviderOutput):
            return value.legacy
        return value

    async def _accept_execution(
        self,
        run_id: str,
        request: RunRequest,
        result: ExecutionResult,
    ) -> GenerationRunSnapshot:
        result = self._expire_missing_remote_history(run_id, result)
        if isinstance(result, Failed):
            with self._lock:
                run = self._runs[run_id]
                run.status = result.status
                run.error = result.error
                run.status_code = 500
                run.result = _json_value(self._normalized_raw(result))
                run.updated_at = float(self._now())
                self._persist_terminal_locked(run)
                return run.snapshot()

        if isinstance(result, (Pending, Queued)):
            remote_ref = (
                result.remote_ref
                if isinstance(result, Pending)
                else result.queue_ref
            )
            raw_result = self._normalized_raw(result)
            with self._lock:
                run = self._runs[run_id]
                run.status = result.status
                run.remote_refs = [str(remote_ref)]
                self._index_remote_refs_locked(run)
                run.result = _json_value(raw_result)
                self._runtime_results[run_id] = raw_result
                run.updated_at = float(self._now())
                run.recoverable = True
                self._persist_locked(run)
                return dataclasses.replace(
                    run.snapshot(),
                    result=raw_result,
                )

        output = result.output
        if not isinstance(output, ProviderOutput):
            # Text streams intentionally carry their own typed output.  Their
            # event wrapper is installed by ProviderGenerationAdapter.
            publishable = getattr(self._effects, "publish_typed", None)
            if not callable(publishable):
                raise RuntimeError(
                    "generation adapter returned an invalid completed output"
                )
            published = publishable(run_id, request, output)
            if inspect.isawaitable(published):
                published = await published
            if isinstance(published, TextStreamOutput):
                published = self._track_stream(run_id, published)
            with self._lock:
                run = self._runs[run_id]
                run.status = (
                    "running"
                    if isinstance(published, TextStreamOutput)
                    else "succeeded"
                )
                if isinstance(published, TextStreamOutput):
                    run.phase = "stream_open"
                run.result = _json_value(published)
                self._runtime_results[run_id] = published
                run.effects_done = not isinstance(
                    published, TextStreamOutput
                )
                run.updated_at = float(self._now())
                if run.status in TERMINAL_STATUSES:
                    self._persist_terminal_locked(run)
                else:
                    self._persist_locked(run)
                return dataclasses.replace(
                    run.snapshot(),
                    result=published,
                )

        with self._lock:
            run = self._runs[run_id]
            run.phase = "provider_completed"
            run.provider_output = _provider_output_value(output)
            # Recovery providers often return only the finished media and omit
            # the task identifier.  Keep the identifier that led us here so a
            # refresh or process restart can still resolve the same run.
            if output.remote_refs:
                run.remote_refs = list(output.remote_refs)
            self._index_remote_refs_locked(run)
            run.recoverable = True
            run.error = ""
            run.status_code = 0
            run.updated_at = float(self._now())
            self._persist_locked(run)
            stored_prepared = copy.deepcopy(run.prepared_output)
        if stored_prepared is not None:
            prepared = PreparedGenerationOutput.from_stored(stored_prepared)
        else:
            prepare = getattr(self._effects, "prepare", None)
            if callable(prepare):
                prepared = prepare(run_id, request, output)
                if inspect.isawaitable(prepared):
                    prepared = await prepared
            else:
                prepared = PreparedGenerationOutput(
                    result=output.legacy,
                    canvas=_canvas_output(
                        output,
                        "video" if isinstance(request, VideoRun) else "",
                    ),
                )
            if not isinstance(prepared, PreparedGenerationOutput):
                raise RuntimeError(
                    "generation effects returned an invalid prepared output"
                )
            with self._lock:
                run = self._runs[run_id]
                run.phase = "output_prepared"
                run.prepared_output = prepared.stored()
                run.updated_at = float(self._now())
                self._persist_locked(run)
        return await self._complete_prepared(
            run_id,
            request,
            prepared,
            provider_output=output,
        )

    def _expire_missing_remote_history(
        self,
        run_id: str,
        result: ExecutionResult,
    ) -> ExecutionResult:
        if not isinstance(result, Pending):
            return result
        raw = self._normalized_raw(result)
        if not (
            isinstance(raw, Mapping)
            and raw.get("remote_history_missing") is True
        ):
            return result
        with self._lock:
            run = self._runs.get(run_id)
            if run is None or run.kind != "image":
                return result
            elapsed = max(0.0, float(self._now()) - run.created_at)
            settings = run.request_data.get("settings") or {}
            model = str(settings.get("model") or "未知模型")
        if elapsed <= JIMENG_MISSING_REMOTE_HISTORY_TIMEOUT_SECONDS:
            return result
        return Failed(
            error=(
                f"即梦任务 {result.remote_ref} 查询已超过 30 分钟，"
                f"但仍无远端历史记录（模型：{model}）；任务很可能在"
                "创建阶段被上游拒绝，已停止自动恢复。请检查模型权限、"
                "分辨率和提示词参数后重试"
            ),
            raw=raw,
        )

    def _track_stream(
        self,
        run_id: str,
        output: TextStreamOutput,
    ) -> TextStreamOutput:
        async def events():
            consumer_task = asyncio.current_task()
            if consumer_task is not None:
                with self._lock:
                    self._owners[run_id] = consumer_task
            failed_detail = ""
            completed = False
            saw_complete = False
            paused = False
            try:
                async for event in output.events:
                    if event.kind is TextStreamEventKind.ERROR:
                        failed_detail = (
                            event.detail or "流式生成返回错误"
                        )
                    elif event.kind is TextStreamEventKind.COMPLETE:
                        saw_complete = True
                    yield event
                completed = True
            except asyncio.CancelledError:
                with self._lock:
                    paused = run_id in self._pausing
                if not paused:
                    self._finish_stream(
                        run_id,
                        status="cancelled",
                        error="流式连接已中断",
                    )
                raise
            except BaseException as exc:
                self._finish_stream(
                    run_id,
                    status="failed",
                    error=(
                        failed_detail
                        or str(exc)
                        or "流式连接已提前关闭"
                    ),
                )
                raise
            finally:
                if completed:
                    if not failed_detail and not saw_complete:
                        failed_detail = "流式生成在完成事件前中断"
                    self._finish_stream(
                        run_id,
                        status="failed" if failed_detail else "succeeded",
                        error=failed_detail,
                    )
                elif not paused:
                    self._finish_stream(
                        run_id,
                        status="failed",
                        error=failed_detail or "流式连接已提前关闭",
                    )
                with self._lock:
                    if self._owners.get(run_id) is consumer_task:
                        self._owners.pop(run_id, None)

        return TextStreamOutput(model=output.model, events=events())

    def _finish_stream(
        self,
        run_id: str,
        *,
        status: str,
        error: str,
    ) -> None:
        with self._lock:
            self._load_locked()
            run = self._runs.get(run_id)
            if run is None or run.status in TERMINAL_STATUSES:
                return
            run.status = status
            run.error = error
            run.status_code = 500 if status == "failed" else 0
            run.effects_done = status == "succeeded"
            run.phase = "finished"
            run.updated_at = float(self._now())
            self._persist_terminal_locked(run)

    async def _complete_prepared(
        self,
        run_id: str,
        request: RunRequest,
        prepared: PreparedGenerationOutput,
        *,
        provider_output: ProviderOutput | None,
    ) -> GenerationRunSnapshot:
        with self._lock:
            run = self._runs[run_id]
            target = run.target
            owner = run.owner
            already_published = run.effects_done
        if target is not None and self._target_guard is not None:
            if self._lifecycle_store is None:
                current = await self._target_guard.apply_if_current(
                    run_id,
                    owner,
                    target,
                    copy.deepcopy(dict(prepared.canvas)),
                )
            else:
                # SQLite lifecycle/outbox owns the eventual canvas write.  The
                # synchronous guard remains useful only as a stale-target check;
                # applying here would race the atomic output + final-log intent.
                current = self._target_guard.is_current(owner, target)
            if not current:
                with self._lock:
                    run = self._runs[run_id]
                    run.status = "discarded"
                    run.result = None
                    run.error = ""
                    run.recoverable = True
                    run.updated_at = float(self._now())
                    self._persist_terminal_locked(run)
                    return run.snapshot()
        if already_published:
            published = prepared.result
        else:
            publish_prepared = getattr(
                self._effects, "publish_prepared", None
            )
            if callable(publish_prepared):
                published = publish_prepared(
                    run_id,
                    request,
                    prepared,
                )
                if inspect.isawaitable(published):
                    published = await published
            else:
                publish = getattr(self._effects, "publish", None)
                if callable(publish) and provider_output is not None:
                    published = publish(run_id, request, provider_output)
                    if inspect.isawaitable(published):
                        published = await published
                else:
                    published = prepared.result
        with self._lock:
            run = self._runs[run_id]
            run.status = "succeeded"
            run.result = _json_value(published)
            self._runtime_results[run_id] = published
            run.error = ""
            run.status_code = 0
            run.effects_done = True
            run.phase = "finished"
            run.updated_at = float(self._now())
            self._persist_terminal_locked(run)
            return dataclasses.replace(
                run.snapshot(),
                result=published,
            )

    def get(
        self,
        run_id: str,
        *,
        owner: str = "",
        deduplicated: bool = False,
    ) -> GenerationRunSnapshot:
        with self._lock:
            self._load_locked()
            run = self._runs.get(str(run_id or ""))
            if run is None:
                raise GenerationRunNotFound("Generation Run 不存在")
            self._require_owner(run, owner)
            if (
                run.target is not None
                and run.status in ACTIVE_STATUSES
                and self._target_guard is not None
                and not self._target_guard.is_current(
                    run.owner, run.target
                )
            ):
                run.status = "discarded"
                run.result = None
                run.error = ""
                run.recoverable = True
                run.updated_at = float(self._now())
                self._persist_terminal_locked(run)
            snapshot = run.snapshot(deduplicated=deduplicated)
            if run.id in self._runtime_results:
                snapshot = dataclasses.replace(
                    snapshot,
                    result=self._runtime_results[run.id],
                )
            return snapshot

    def find_by_remote_ref(
        self,
        remote_ref: str,
        *,
        provider_id: str | None = None,
        owner: str = "",
    ) -> GenerationRunSnapshot | None:
        ref = str(remote_ref or "").strip()
        if not ref:
            return None
        with self._lock:
            self._load_locked()
            if provider_id is None:
                run_ids = [
                    run_id
                    for (candidate_provider, candidate_ref), values
                    in self._remote_runs.items()
                    if candidate_ref == ref
                    for run_id in values
                ]
            else:
                run_ids = list(
                    self._remote_runs.get(
                        (str(provider_id or ""), ref),
                        (),
                    )
                )
            candidates = [
                self._runs[run_id]
                for run_id in run_ids
                if run_id in self._runs
            ]
            visible = [
                run
                for run in candidates
                if not run.owner or run.owner == str(owner or "")
            ]
            if not visible:
                return None
            run = max(
                visible,
                key=lambda item: (
                    item.status in ACTIVE_STATUSES,
                    item.updated_at,
                    item.created_at,
                    item.id,
                ),
            )
            return run.snapshot()

    async def resume(
        self,
        run_id: str,
        *,
        owner: str = "",
        delivery: Delivery | None = None,
        recovery_request: RunRequest | None = None,
    ) -> GenerationRunSnapshot:
        delivery = delivery or Inline()
        with self._lock:
            self._load_locked()
            run = self._runs.get(str(run_id or ""))
            if run is None:
                raise GenerationRunNotFound("Generation Run 不存在")
            self._require_owner(run, owner)
            current_task = self._tasks.get(run.id) or self._owners.get(run.id)
            done = getattr(current_task, "done", None)
            if (
                current_task is not None
                and callable(done)
                and not done()
            ):
                event = self._events.get(run.id)
            else:
                event = None
            if run.status in TERMINAL_STATUSES:
                return run.snapshot()
            if recovery_request is not None:
                request_refs = set(
                    _request_remote_refs(recovery_request)
                )
                run_refs = {
                    str(remote_ref or "").strip()
                    for remote_ref in run.remote_refs
                    if str(remote_ref or "").strip()
                }
                request_provider = _request_provider_id(
                    recovery_request
                )
                if (
                    not _is_recovery_execution(recovery_request, run)
                    or run.child_attempts
                    or not request_refs
                    or request_refs != run_refs
                    or (
                        request_provider
                        and run.provider_id
                        and request_provider != run.provider_id
                    )
                ):
                    raise GenerationRunConflict(
                        "恢复请求必须匹配当前提供方与远端任务编号"
                    )
            if event is None:
                (
                    recovery,
                    replay_output,
                    replay_prepared,
                ) = self._recovery_plan_locked(run)
                if (
                    recovery_request is not None
                    and replay_output is None
                    and replay_prepared is None
                ):
                    # A manual query may carry a one-time credential. Use the
                    # current query-shaped request only for this execution;
                    # request_data remains the redacted durable record.
                    recovery = recovery_request
                self._requests[run.id] = recovery
                self._events[run.id] = asyncio.Event()
            else:
                recovery = None
                replay_output = None
                replay_prepared = None
        if event is not None and isinstance(delivery, Background):
            with self._lock:
                current = self._runs[run.id]
                if current.status not in TERMINAL_STATUSES:
                    current.status = "running"
                    current.updated_at = float(self._now())
                    self._persist_locked(current)
                return current.snapshot()
        if event is not None:
            await event.wait()
            snapshot = self.get(run_id, owner=owner)
            if (
                recovery_request is not None
                and snapshot.status in ACTIVE_STATUSES
            ):
                return await self.resume(
                    run_id,
                    owner=owner,
                    delivery=delivery,
                    recovery_request=recovery_request,
                )
            return snapshot
        if isinstance(delivery, Background):
            task = asyncio.create_task(
                self._execute(
                    run.id,
                    recovery,
                    replay_output=replay_output,
                    replay_prepared=replay_prepared,
                )
            )
            with self._lock:
                self._tasks[run.id] = task
            task.add_done_callback(
                lambda completed, rid=run.id: self._task_done(
                    rid, completed
                )
            )
            # _execute has not necessarily run yet; project immediate intent
            # as running and persist it for GET compatibility.
            with self._lock:
                current = self._runs[run.id]
                current.status = "running"
                current.updated_at = float(self._now())
                self._persist_locked(current)
                return current.snapshot()
        return await self._execute(
            run.id,
            recovery,
            replay_output=replay_output,
            replay_prepared=replay_prepared,
        )

    def _recovery_plan_locked(
        self,
        run: _Run,
    ) -> tuple[
        RunRequest,
        ProviderOutput | None,
        PreparedGenerationOutput | None,
    ]:
        if (
            run.phase == "output_prepared"
            and run.prepared_output is not None
        ):
            return (
                _request_from_run(run),
                None,
                PreparedGenerationOutput.from_stored(
                    run.prepared_output
                ),
            )
        if (
            run.phase == "provider_completed"
            and run.provider_output is not None
        ):
            return (
                _request_from_run(run),
                _provider_output_from_value(run.provider_output),
                None,
            )
        if run.child_attempts:
            return (_request_from_run(run), None, None)
        if run.remote_refs:
            return (_recovery_request_from_run(run), None, None)
        request = _request_from_run(run)
        if run.recoverable and self._is_restart_recoverable(request):
            return (request, None, None)
        raise GenerationRunConflict(
            "Generation Run 没有可恢复的远端任务编号"
        )

    async def _monitor_active(
        self,
        run_id: str,
        owner: str,
    ) -> None:
        """Own one restart orphan until it reaches a durable terminal state."""
        attempt = 0
        while True:
            with self._lock:
                self._load_locked()
                run = self._runs.get(run_id)
                if run is None or run.status in TERMINAL_STATUSES:
                    return
                (
                    recovery,
                    replay_output,
                    replay_prepared,
                ) = self._recovery_plan_locked(run)
                self._requests[run.id] = recovery
                self._events[run.id] = asyncio.Event()
            try:
                snapshot = await self._execute(
                    run_id,
                    recovery,
                    replay_output=replay_output,
                    replay_prepared=replay_prepared,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                snapshot = self.get(run_id, owner=owner)
            if snapshot.status in TERMINAL_STATUSES:
                return
            attempt += 1
            await asyncio.sleep(
                min(30.0, float(2 ** min(attempt - 1, 5)))
            )

    async def cancel(
        self,
        run_id: str,
        *,
        owner: str = "",
    ) -> GenerationRunSnapshot:
        return await self._cancel(run_id, owner=owner, privileged=False)

    async def _cancel(
        self,
        run_id: str,
        *,
        owner: str = "",
        privileged: bool,
    ) -> GenerationRunSnapshot:
        with self._lock:
            self._load_locked()
            run = self._runs.get(str(run_id or ""))
            if run is None:
                raise GenerationRunNotFound("Generation Run 不存在")
            if not privileged:
                self._require_owner(run, owner)
            task = self._tasks.get(run.id) or self._owners.get(run.id)
            if run.status in ACTIVE_STATUSES:
                run.status = "cancelled"
                run.error = "用户取消了生成任务以立即重启"
                run.status_code = 409
                run.updated_at = float(self._now())
                self._persist_terminal_locked(run)
            snapshot = run.snapshot()
        done = getattr(task, "done", None)
        cancel = getattr(task, "cancel", None)
        if (
            task is not None
            and task is not asyncio.current_task()
            and callable(done)
            and callable(cancel)
            and not done()
        ):
            cancel()
            await asyncio.gather(task, return_exceptions=True)
        return snapshot

    def active_count(self) -> int:
        with self._lock:
            self._load_locked()
            return sum(
                1
                for run in self._runs.values()
                if run.status in ACTIVE_STATUSES
            )

    def active_for_canvas(
        self,
        canvas_id: str,
    ) -> tuple[GenerationRunSnapshot, ...]:
        """Return durable active runs targeting one Canvas."""

        target_canvas_id = str(canvas_id or "").strip()
        if not target_canvas_id:
            return ()
        with self._lock:
            self._load_locked()
            return tuple(
                run.snapshot()
                for run in self._runs.values()
                if run.status in ACTIVE_STATUSES
                and run.target is not None
                and run.target.canvas_id == target_canvas_id
            )

    async def repair_publication_outputs(
        self,
        publication: str,
    ) -> dict[str, Any]:
        """Materialize legacy successful outputs without re-running providers."""
        requested = str(publication or "").strip()
        with self._lock:
            self._load_locked()
            candidates = [
                (
                    run.id,
                    _request_from_run(run),
                    copy.deepcopy(run.provider_output),
                )
                for run in self._runs.values()
                if run.status == "succeeded"
                and str(run.request_data.get("publication") or "") == requested
                and run.provider_output is not None
                and not _has_workspace_media(run.result)
            ]
        repaired = 0
        failed: dict[str, str] = {}
        prepare = getattr(self._effects, "prepare", None)
        if not callable(prepare):
            return {
                "repaired": 0,
                "failed": {
                    run_id: "Generation effects do not support output repair"
                    for run_id, _request, _output in candidates
                },
            }
        for run_id, request, stored_output in candidates:
            try:
                output = _provider_output_from_value(stored_output)
                prepared = prepare(run_id, request, output)
                if inspect.isawaitable(prepared):
                    prepared = await prepared
                if not isinstance(prepared, PreparedGenerationOutput):
                    raise RuntimeError(
                        "generation effects returned an invalid prepared output"
                    )
                if not _has_workspace_media(prepared.result):
                    raise RuntimeError("Generation Output 未写入 Workspace")
                with self._lock:
                    self._load_locked()
                    current = self._runs.get(run_id)
                    if current is None or _has_workspace_media(current.result):
                        continue
                    current.phase = "output_prepared"
                    current.prepared_output = prepared.stored()
                    current.updated_at = float(self._now())
                    self._persist_locked(current)
                await self._complete_prepared(
                    run_id,
                    request,
                    prepared,
                    provider_output=output,
                )
                repaired += 1
            except Exception as exc:
                failed[run_id] = str(exc) or type(exc).__name__
        return {"repaired": repaired, "failed": failed}

    async def resume_active(
        self,
        *,
        delivery: Delivery | None = None,
    ) -> tuple[GenerationRunSnapshot, ...]:
        """Resume every durable orphan without re-submitting paid work."""
        del delivery
        with self._lock:
            self._load_locked()
            pending = [
                (run.id, run.owner)
                for run in self._runs.values()
                if run.status in ACTIVE_STATUSES
            ]
        resumed: list[GenerationRunSnapshot] = []
        for run_id, owner in pending:
            try:
                with self._lock:
                    existing = self._tasks.get(run_id)
                    done = getattr(existing, "done", None)
                    if (
                        existing is None
                        or not callable(done)
                        or done()
                    ):
                        task = asyncio.create_task(
                            self._monitor_active(run_id, owner)
                        )
                        self._tasks[run_id] = task
                        task.add_done_callback(
                            lambda completed, rid=run_id:
                            self._task_done(rid, completed)
                        )
                    run = self._runs[run_id]
                    run.status = "running"
                    run.updated_at = float(self._now())
                    self._persist_locked(run)
                    resumed.append(
                        run.snapshot()
                    )
            except GenerationRunError:
                # Invalid non-durable active records are converted to failed
                # while loading and therefore normally never reach this path.
                continue
        return tuple(resumed)

    async def recover_legacy_effect_receipts(self) -> dict[str, Any]:
        """Replay terminal legacy effects and prune receipts with no source."""

        pending_receipts = getattr(
            self._effects,
            "legacy_pending_receipts",
            None,
        )
        discard_receipts = getattr(
            self._effects,
            "discard_legacy_pending_receipts",
            None,
        )
        publish_prepared = getattr(self._effects, "publish_prepared", None)
        if not callable(pending_receipts) or not callable(discard_receipts):
            return {
                "recovered": 0,
                "cleaned": 0,
                "skipped": 0,
                "failed": {},
            }
        receipts = pending_receipts()
        recovered = 0
        cleaned = 0
        skipped = 0
        failed: dict[str, str] = {}
        for run_id, names in receipts.items():
            with self._lock:
                self._load_locked()
                stored = self._runs.get(run_id)
                run = copy.deepcopy(stored) if stored is not None else None
            if run is None:
                discard_receipts(run_id, names)
                cleaned += len(names)
                continue
            if run.status not in TERMINAL_STATUSES:
                skipped += len(names)
                continue
            if run.prepared_output is None or not callable(publish_prepared):
                discard_receipts(run_id, names)
                cleaned += len(names)
                continue
            try:
                prepared = PreparedGenerationOutput.from_stored(
                    run.prepared_output
                )
                if not isinstance(prepared.effects, Mapping):
                    raise GenerationRunConflict(
                        "Generation Run 的旧 effect receipt 数据无效"
                    )
                recoverable_effects = {
                    name: copy.deepcopy(prepared.effects[name])
                    for name in names
                    if name in prepared.effects
                }
                stale_names = tuple(
                    name for name in names if name not in recoverable_effects
                )
                if stale_names:
                    discard_receipts(run_id, stale_names)
                    cleaned += len(stale_names)
                if not recoverable_effects:
                    continue
                result = publish_prepared(
                    run_id,
                    _request_from_run(run),
                    dataclasses.replace(
                        prepared,
                        effects=recoverable_effects,
                    ),
                )
                if inspect.isawaitable(result):
                    await result
                recovered += len(recoverable_effects)
            except Exception as exc:
                failed[run_id] = str(exc) or type(exc).__name__
        return {
            "recovered": recovered,
            "cleaned": cleaned,
            "skipped": skipped,
            "failed": failed,
        }

    async def cancel_active(self) -> None:
        with self._lock:
            self._load_locked()
            run_ids = [
                run.id
                for run in self._runs.values()
                if run.status in ACTIVE_STATUSES
            ]
        for run_id in run_ids:
            try:
                await self._cancel(run_id, privileged=True)
            except GenerationRunNotFound:
                continue

    async def pause_active(self) -> None:
        """Stop process-owned work while preserving durable remote runs."""
        with self._lock:
            self._load_locked()
            tasks: list[tuple[str, asyncio.Task[Any]]] = []
            for run in self._runs.values():
                if run.status not in ACTIVE_STATUSES:
                    continue
                task = self._tasks.get(run.id) or self._owners.get(run.id)
                done = getattr(task, "done", None)
                if (
                    task is not None
                    and callable(done)
                    and not done()
                ):
                    self._pausing.add(run.id)
                    tasks.append((run.id, task))
        for _run_id, task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(
                *(task for _run_id, task in tasks),
                return_exceptions=True,
            )
        with self._lock:
            for run_id, _task in tasks:
                self._pausing.discard(run_id)


class ProviderGenerationExecutor:
    """Private adapter from Generation Run types to ProviderRuntime."""

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime

    def requires_child_attempts(self, request: ImageRun) -> bool:
        if len(request.prompts) > 1:
            return True
        supports = getattr(self._runtime, "image_native_count", None)
        if not callable(supports):
            return False
        settings = dict(request.settings)
        settings["_reference_count"] = len(request.references)
        return not bool(
            supports(
                str(settings.get("provider_id") or "comfly"),
                settings,
            )
        )

    async def execute(
        self,
        request: RunRequest,
        checkpoint: RemoteCheckpoint | None = None,
    ) -> ExecutionResult:
        def checkpoint_kwargs(callable_value) -> dict[str, Any]:
            if checkpoint is None:
                return {}
            if isinstance(self._runtime, ProviderRuntime):
                return {"checkpoint": checkpoint}
            try:
                inspect.signature(callable_value).bind_partial(
                    checkpoint=checkpoint
                )
            except TypeError:
                # Compatibility is limited to isolated extension/fake
                # runtimes.  The production ProviderRuntime contract above
                # is mandatory and fail-fast.
                return {}
            return {"checkpoint": checkpoint}

        if isinstance(request, ImageRun):
            settings = dict(request.settings)
            execute_image = self._runtime.execute_image
            transparent_kwargs = (
                {"transparent_png": True}
                if settings.get("transparent_png") is True
                else {}
            )
            operation_kwargs = (
                {
                    "operation": "image.layer_decomposition",
                    "resolution_tier": str(
                        settings.get("resolution_tier") or "2K"
                    ),
                }
                if settings.get("operation") == "image.layer_decomposition"
                else {}
            )
            return await execute_image(
                request.prompt,
                str(settings.get("size") or "1024x1024"),
                str(settings.get("quality") or "auto"),
                str(settings.get("model") or ""),
                [dict(item) for item in request.references],
                str(settings.get("provider_id") or "comfly"),
                settings.get("wait_for_task"),
                count=max(1, min(8, int(request.count or 1))),
                **transparent_kwargs,
                **operation_kwargs,
                **checkpoint_kwargs(execute_image),
            )
        if isinstance(request, VideoRun):
            execute_video = self._runtime.execute_video
            return await execute_video(
                request.payload,
                **checkpoint_kwargs(execute_video),
            )
        if isinstance(request, TextRun):
            if request.stream:
                return Completed(await self._runtime.stream_text(
                    request.payload,
                    [dict(item) for item in request.history],
                    [dict(item) for item in request.messages],
                ))
            return await self._runtime.execute_text(
                request.payload,
                [dict(item) for item in request.history],
                [dict(item) for item in request.messages],
            )
        if isinstance(request, WorkflowRun):
            execute_workflow = self._runtime.execute_workflow
            return await execute_workflow(
                request.operation,
                request.payload,
                request.provider_id,
                **checkpoint_kwargs(execute_workflow),
            )
        recover = self._runtime.execute_recovery
        try:
            inspect.signature(recover).bind(
                request.provider_id,
                request.remote_ref,
                request.media_kind,
            )
        except TypeError:
            return await recover(
                request.provider_id,
                request.remote_ref,
            )
        return await recover(
            request.provider_id,
            request.remote_ref,
            request.media_kind,
        )


@dataclass(frozen=True, kw_only=True)
class GenerationOutputPorts:
    """Managed-media operations shared by both publication authorities."""

    save_image: Callable[..., Awaitable[str]]
    image_meta: Callable[[str, Any], dict[str, Any]]
    extract_images: Callable[[Any], list[Any]]
    now: Callable[[], float] = time.time
    now_ms: Callable[[], int] = lambda: int(time.time() * 1000)
    output_file_from_url: Callable[[str], str | None] | None = None
    save_video: Callable[..., Awaitable[str]] | None = None
    save_asset: Callable[..., Awaitable[str]] | None = None
    save_text: Callable[..., str] | None = None
    materialize_image: Callable[..., Awaitable[str]] | None = None


@dataclass(frozen=True, kw_only=True)
class GenerationEffectPorts(GenerationOutputPorts):
    """Legacy JSON publication plus Managed Media compatibility ports."""

    history_path: Callable[[], str | Path]
    journal_path: Callable[[], str | Path]
    history_lock: Any
    notify: Callable[[dict[str, Any]], Awaitable[None]]


class WorkspaceGenerationEffects:
    """Materialize outputs, then delegate History/notification publication."""

    def __init__(
        self,
        ports: GenerationOutputPorts,
        *,
        publication: GenerationPublication | None = None,
    ) -> None:
        self._ports = ports
        if publication is None:
            if not isinstance(ports, GenerationEffectPorts):
                raise ValueError(
                    "Generation publication is required without legacy JSON ports"
                )
            publication = LegacyGenerationPublication(
                LegacyGenerationPublicationPorts(
                    history_path=ports.history_path,
                    journal_path=ports.journal_path,
                    history_lock=ports.history_lock,
                    notify=ports.notify,
                    now=ports.now,
                    output_file_from_url=ports.output_file_from_url,
                )
            )
        self._publication = publication

    def legacy_pending_receipts(self) -> dict[str, tuple[str, ...]]:
        pending = getattr(self._publication, "legacy_pending_receipts", None)
        try:
            return pending() if callable(pending) else {}
        except GenerationPublicationError as exc:
            raise GenerationRunConflict(str(exc)) from exc

    def discard_legacy_pending_receipts(
        self,
        run_id: str,
        names: tuple[str, ...] | list[str],
    ) -> None:
        discard = getattr(
            self._publication, "discard_legacy_pending_receipts", None
        )
        if callable(discard):
            discard(run_id, names)

    async def history_page(
        self,
        *,
        media_type: str = "",
        limit: int = 50,
        cursor: str = "",
    ):
        return await self._publication.history_page(
            media_type=media_type,
            limit=limit,
            cursor=cursor,
        )

    async def history(
        self, media_type: str | None = None
    ) -> list[dict[str, Any]]:
        page = await self.history_page(
            media_type=str(media_type or ""),
            limit=5000,
        )
        return [dict(item) for item in page.items]

    async def history_by_id(
        self, history_id: str
    ) -> Mapping[str, Any] | None:
        return await self._publication.history_by_id(history_id)

    async def delete_history(
        self,
        timestamp: float | None = None,
        *,
        history_id: str = "",
    ) -> dict[str, Any]:
        deleted = await self._publication.delete_history(
            history_id=history_id,
            timestamp=timestamp,
        )
        if not deleted:
            return {"success": False, "message": "Record not found"}
        return {"success": True}

    async def recover_pending_publications(
        self, *, limit: int = 1000
    ) -> dict[str, Any]:
        return await self._publication.recover_pending(limit=limit)

    @staticmethod
    def _outputs(output: ProviderOutput) -> tuple[ProviderOutput, ...]:
        batch = output.metadata.get("batch")
        if isinstance(batch, tuple) and all(
            isinstance(item, ProviderOutput) for item in batch
        ):
            return batch
        return (output,)

    async def _prepare_images(
        self,
        run_id: str,
        request: ImageRun,
        output: ProviderOutput,
    ) -> PreparedGenerationOutput:
        local_urls: list[str] = []
        local_items: list[dict[str, Any]] = []
        provider_source_urls: list[str] = []
        raw_items: list[Any] = []
        processor_metadata = (
            copy.deepcopy(dict(output.metadata.get("image_processor") or {}))
            if request.publication == "image-processor"
            and isinstance(output.metadata.get("image_processor"), Mapping)
            else {}
        )
        for one in self._outputs(output):
            legacy = one.legacy
            if isinstance(legacy, tuple) and len(legacy) == 2:
                image_data, raw = legacy
            else:
                image_data, raw = legacy, one.raw
            raw_items.append(raw)
            normalized_media = list(one.media)
            try:
                image_values = (
                    self._ports.extract_images(raw)
                    if isinstance(raw, dict)
                    else [image_data]
                )
                if not image_values:
                    image_values = normalized_media or [image_data]
            except Exception:
                image_values = normalized_media or [image_data]
            for image_value in image_values:
                if isinstance(image_value, str):
                    image_value = {
                        "type": "url",
                        "value": image_value,
                    }
                stable_id = f"{run_id}_{len(local_urls)}"
                save_options: dict[str, Any] = {
                    "prefix": "online_",
                    "stable_id": stable_id,
                }
                if request.publication == "batch-generation":
                    context = dict(request.effect_context)
                    try:
                        task_number = str(int(context.get("task_index")) + 1)
                    except (TypeError, ValueError):
                        task_number = ""
                    model_prefix = str(
                        context.get("model_name")
                        or request.settings.get("model")
                        or ""
                    ).strip()[:15]
                    prompt_prefix = request.prompt.strip()[:15]
                    save_options.update({
                        "folder": str(
                            context.get("batch_name")
                            or context.get("batch_id")
                            or "批量生成"
                        ),
                        "name_prefix": "_".join(
                            part for part in (
                                task_number,
                                model_prefix,
                                prompt_prefix,
                            )
                            if part
                        ),
                    })
                try:
                    local_url = await self._ports.save_image(
                        image_value,
                        **save_options,
                    )
                except TypeError:
                    try:
                        local_url = await self._ports.save_image(
                            image_value,
                            prefix="online_",
                            stable_id=stable_id,
                        )
                    except TypeError:
                        local_url = await self._ports.save_image(
                            image_value, prefix="online_"
                        )
                if not local_url:
                    continue
                provider_source_url = local_url
                target_aspect_ratio = str(
                    request.settings.get("target_aspect_ratio") or ""
                ).strip()
                materialization_aspect_ratio = str(
                    request.settings.get("reference_aspect_ratio")
                    or target_aspect_ratio
                ).strip()
                materialize = self._ports.materialize_image
                if materialization_aspect_ratio and callable(materialize):
                    local_url = await materialize(
                        provider_source_url,
                        target_aspect_ratio=materialization_aspect_ratio,
                        stable_id=stable_id,
                    )
                    if not local_url:
                        raise GenerationRunConflict(
                            "Generation Output 画幅物化失败"
                        )
                provider_source_urls.append(provider_source_url)
                local_urls.append(local_url)
                local_item = self._ports.image_meta(local_url, image_value)
                if processor_metadata:
                    local_item["image_processor"] = copy.deepcopy(
                        processor_metadata
                    )
                local_items.append(local_item)
        if request.publication == "chat-image":
            result = {
                "images": local_urls,
                "image_items": local_items,
                "raw_items": raw_items,
            }
            return PreparedGenerationOutput(
                result=result,
                canvas={
                    "images": local_urls,
                    "image_items": local_items,
                },
            )
        settings = dict(request.settings)
        raw = raw_items[0] if raw_items else {}
        result = {
            "prompt": request.prompt,
            "images": local_urls,
            "image_items": local_items,
            "provider_source_images": provider_source_urls,
            "timestamp": float(self._ports.now()),
            "type": "online",
            "model": str(settings.get("model") or ""),
            "provider_id": str(settings.get("provider_id") or ""),
            "provider_name": str(
                settings.get("provider_name")
                or settings.get("provider_id")
                or ""
            ),
            "task_id": (
                raw.get("task_id") or raw.get("taskId")
                if isinstance(raw, dict)
                else None
            ),
            "request_id": (
                raw.get("id") if isinstance(raw, dict) else None
            ),
            "params": {
                "provider_id": str(settings.get("provider_id") or ""),
                "model": str(settings.get("model") or ""),
                "size": str(settings.get("size") or ""),
                "requested_size": str(
                    settings.get("requested_size")
                    or settings.get("size")
                    or ""
                ),
                "target_aspect_ratio": str(
                    settings.get("target_aspect_ratio") or ""
                ),
                "quality": str(settings.get("quality") or "auto"),
                "n": int(request.count or 1),
                "submission_count": int(request.submission_count or 1),
                "reference_images": [
                    dict(item) for item in request.references
                ],
            },
            "raw_usage": (
                raw.get("usage") if isinstance(raw, dict) else None
            ),
        }
        effects = {}
        if request.publication in {"online-image", "history"}:
            effects = {
                "history": result,
                "notification": result,
            }
        elif request.publication == "image-processor":
            result.update(
                {
                    "type": "depth-map",
                    "image_processor": copy.deepcopy(processor_metadata),
                }
            )
            effects = {
                "history": result,
                "notification": result,
            }
        return PreparedGenerationOutput(
            result=result,
            canvas={
                "images": local_urls,
                "image_items": local_items,
            },
            effects=effects,
        )

    async def _prepare_layer_decomposition(
        self,
        run_id: str,
        request: ImageRun | RecoveryRun,
        output: ProviderOutput,
    ) -> PreparedGenerationOutput:
        source = output.legacy
        if not isinstance(source, Mapping) or source.get("kind") != "image_layer_decomposition":
            raise GenerationRunConflict("图层拆分结果结构无效")
        base = source.get("base")
        layers = source.get("layers")
        if not isinstance(base, Mapping) or not isinstance(layers, list):
            raise GenerationRunConflict("图层拆分结果缺少底图或图层")
        output_file = getattr(self._ports, "output_file_from_url", None)
        if not callable(output_file):
            raise GenerationRunConflict("图层拆分缺少 Managed Media 文件检查能力")

        async def save(value: Mapping[str, Any], stable_id: str) -> str:
            try:
                local_url = await self._ports.save_image(
                    {"type": "url", "value": str(value.get("url") or "")},
                    prefix="layer_decomposition_",
                    stable_id=stable_id,
                )
            except TypeError:
                local_url = await self._ports.save_image(
                    {"type": "url", "value": str(value.get("url") or "")},
                    prefix="layer_decomposition_",
                )
            if not local_url:
                raise LayerDecompositionError(
                    "download_failed", "Provider media could not be saved"
                )
            return str(local_url)

        try:
            base_url = await save(base, f"{run_id}_base")
            base_path = output_file(base_url)
            if not base_path:
                raise LayerDecompositionError(
                    "download_failed", "Materialized base image is unavailable"
                )
            inspect_base_image(
                base_path,
                expected_width=int(base.get("width") or 0),
                expected_height=int(base.get("height") or 0),
            )
        except LayerDecompositionError as exc:
            raise GenerationRunConflict(
                f"图层拆分底图校验失败（{exc.code}）：{exc.detail}"
            ) from exc

        manifest_layers: list[dict[str, Any]] = []
        canvas_layers: list[dict[str, Any]] = []
        seen_layer_digests: set[str] = set()
        for ordinal, layer in enumerate(layers, start=1):
            if not isinstance(layer, Mapping):
                raise GenerationRunConflict(f"第 {ordinal} 个图层元数据无效")
            source_index = int(layer.get("source_index") or ordinal)
            try:
                local_url = await save(layer, f"{run_id}_layer_{source_index}")
                local_path = output_file(local_url)
                if not local_path:
                    raise LayerDecompositionError(
                        "download_failed", "Materialized layer is unavailable"
                    )
                inspected = inspect_layer_image(
                    local_path,
                    expected_width=int(layer.get("width") or 0),
                    expected_height=int(layer.get("height") or 0),
                )
                if inspected.sha256 in seen_layer_digests:
                    raise LayerDecompositionError(
                        "duplicate_layer", "Downloaded layer duplicates another layer"
                    )
                seen_layer_digests.add(inspected.sha256)
            except (LayerDecompositionError, OSError, ValueError) as exc:
                code = getattr(exc, "code", "download_failed")
                detail = getattr(exc, "detail", str(exc))
                raise GenerationRunConflict(
                    f"第 {ordinal} 个图层下载或校验失败（{code}）：{detail}；"
                    "已保存的材料会保留，恢复时不会重新提交付费任务"
                ) from exc
            manifest_layer = {
                "output_media_id": local_url,
                "name": str(layer.get("name") or f"Layer {ordinal}"),
                "description": str(layer.get("description") or ""),
                "z_index": int(layer.get("z_index") or 0),
                "absolute_bbox": list(layer.get("absolute_bbox") or ()),
                "normalized_bbox": list(layer.get("normalized_bbox") or ()),
                "pixel_width": inspected.width,
                "pixel_height": inspected.height,
                "output_format": inspected.output_format,
            }
            manifest_layers.append(manifest_layer)
            canvas_layers.append({**manifest_layer, "url": local_url})

        settings = (
            dict(request.settings)
            if isinstance(request, ImageRun)
            else dict(request.effect_context)
        )
        timestamp = float(self._ports.now())
        created_at = datetime.datetime.fromtimestamp(
            timestamp, tz=datetime.timezone.utc
        ).isoformat()
        source_media_id = str(settings.get("source_media_id") or "").strip()
        if not source_media_id and isinstance(request, ImageRun) and request.references:
            source_url = str(request.references[0].get("url") or "")
            if source_url:
                source_media_id = "source:" + hashlib.sha256(
                    source_url.encode("utf-8")
                ).hexdigest()
        if not source_media_id:
            source_url = str(settings.get("source_url") or "")
            if source_url:
                source_media_id = "source:" + hashlib.sha256(
                    source_url.encode("utf-8")
                ).hexdigest()
        manifest = {
            "manifest_version": MANIFEST_VERSION,
            "source_media_id": source_media_id,
            "provider_id": str(settings.get("provider_id") or ""),
            "model": str(settings.get("model") or ""),
            "resolution_tier": str(settings.get("resolution_tier") or ""),
            "generation_run_id": run_id,
            "upstream_task_id": str(source.get("upstream_task_id") or ""),
            "created_at": created_at,
            "base_output_media_id": base_url,
            "canvas_width": int(source.get("canvas_width") or 0),
            "canvas_height": int(source.get("canvas_height") or 0),
            "layers": manifest_layers,
        }
        raw_metadata = source.get("provider_raw_metadata")
        if isinstance(raw_metadata, Mapping) and raw_metadata:
            manifest["provider_raw_metadata"] = copy.deepcopy(dict(raw_metadata))
        result = {
            "kind": "image_layer_decomposition",
            "manifest": manifest,
            "base": {"url": base_url, "output_media_id": base_url},
            "layers": canvas_layers,
            "images": [base_url, *(item["url"] for item in canvas_layers)],
            "timestamp": timestamp,
            "type": "layer-decomposition",
            "model": manifest["model"],
            "provider_id": manifest["provider_id"],
            "task_id": manifest["upstream_task_id"],
        }
        return PreparedGenerationOutput(
            result=result,
            canvas={
                "layer_decomposition_manifest": manifest,
                "base": result["base"],
                "layers": canvas_layers,
            },
            effects={"history": result, "notification": result},
        )

    async def prepare(
        self,
        run_id: str,
        request: RunRequest,
        output: ProviderOutput,
    ) -> PreparedGenerationOutput:
        if (
            isinstance(request, (ImageRun, RecoveryRun))
            and request.publication == "layer-decomposition"
        ):
            return await self._prepare_layer_decomposition(
                run_id, request, output
            )
        if isinstance(request, ImageRun) and request.publication in {
            "online-image",
            "batch-generation",
            "chat-image",
            "history",
            "image-processor",
        }:
            return await self._prepare_images(run_id, request, output)
        legacy = output.legacy
        if isinstance(legacy, Mapping) and isinstance(
            request, (WorkflowRun, VideoRun, TextRun, RecoveryRun)
        ):
            legacy = await self._materialize_legacy(
                run_id,
                copy.deepcopy(dict(legacy)),
            )
        effects: dict[str, Any] = {}
        result: Any = legacy
        if isinstance(request, RecoveryRun):
            if (
                isinstance(legacy, dict)
                and legacy.get("status") == "succeeded"
                and legacy.get("images")
            ):
                effects = {
                    "history": legacy,
                    "notification": legacy,
                }
        elif request.publication == "history" and isinstance(legacy, dict):
            history_record = copy.deepcopy(
                dict(request.effect_context).get("history") or {}
            )
            history_record.update(copy.deepcopy(legacy))
            if history_record.get("url") and not history_record.get("images"):
                history_record["images"] = [history_record["url"]]
            effects = {
                "history": history_record,
                "notification": history_record,
            }
        return PreparedGenerationOutput(
            result=result,
            canvas=_canvas_output(
                dataclasses.replace(
                    output,
                    legacy=legacy,
                    media=tuple(
                        (
                            legacy.get("videos")
                            or legacy.get("images")
                            or legacy.get("urls")
                            or (
                                [legacy.get("url")]
                                if legacy.get("url")
                                else []
                            )
                        )
                        if isinstance(legacy, Mapping)
                        else output.media
                    ),
                ),
                "video"
                if isinstance(request, VideoRun)
                else str(output.metadata.get("media_kind") or ""),
            ),
            effects=effects,
        )

    async def _materialize_legacy(
        self,
        run_id: str,
        legacy: dict[str, Any],
        *,
        _replacements: dict[str, str] | None = None,
        _counters: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        """Materialize remote media only after provider_completed is durable."""
        replacements = (
            _replacements if _replacements is not None else {}
        )
        counters = _counters if _counters is not None else {}

        def next_index(kind: str) -> int:
            index = counters.get(kind, 0)
            counters[kind] = index + 1
            return index

        def inferred_kind(value: Any, fallback: str = "image") -> str:
            path = urllib.parse.urlparse(str(value or "")).path.lower()
            extension = Path(path).suffix
            if extension in {
                ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv",
            }:
                return "video"
            if extension in {
                ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg",
            }:
                return "audio"
            if extension in {
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif",
            }:
                return "image"
            if extension in {".txt", ".md", ".json", ".csv", ".log"}:
                return "text"
            return fallback

        async def materialize(value: Any, kind: str) -> str:
            text = str(value or "")
            if not text or text.startswith("/assets/"):
                return text
            if text in replacements:
                return replacements[text]
            kind = inferred_kind(text, str(kind or "file").lower())
            index = next_index(kind)
            if kind == "image":
                source = {"type": "url", "value": text}
                try:
                    local = await self._ports.save_image(
                        source,
                        prefix="generation_",
                        stable_id=f"{run_id}_image_{index}",
                    )
                except TypeError:
                    local = await self._ports.save_image(
                        source, prefix="generation_"
                    )
            elif kind == "video" and callable(self._ports.save_video):
                try:
                    local = await self._ports.save_video(
                        text,
                        prefix="generation_video_",
                        stable_id=f"{run_id}_video_{index}",
                    )
                except TypeError:
                    local = await self._ports.save_video(
                        text, prefix="generation_video_"
                    )
            elif callable(self._ports.save_asset):
                try:
                    local = await self._ports.save_asset(
                        text,
                        prefix=f"generation_{kind}_",
                        stable_id=f"{run_id}_{kind}_{index}",
                    )
                except TypeError:
                    local = await self._ports.save_asset(
                        text, prefix=f"generation_{kind}_"
                    )
            else:
                local = text
            replacements[text] = str(local or text)
            return replacements[text]

        async def localize_list(field: str, kind: str) -> None:
            values = legacy.get(field)
            if not isinstance(values, list):
                return
            legacy[field] = [
                await materialize(value, kind) for value in values
            ]

        await localize_list("images", "image")
        await localize_list("videos", "video")
        await localize_list("audios", "audio")
        await localize_list("files", "file")
        await localize_list("texts", "text")

        if legacy.get("url"):
            legacy["url"] = await materialize(
                legacy["url"],
                str(legacy.get("kind") or "image"),
            )

        urls = legacy.get("urls")
        if isinstance(urls, list):
            default_kind = str(legacy.get("kind") or "file").lower()
            legacy["urls"] = [
                await materialize(value, default_kind)
                for value in urls
            ]

        save_text = self._ports.save_text
        for field, default_kind in (
            ("image_items", "image"),
            ("items", "file"),
        ):
            items = legacy.get(field)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                kind = str(item.get("kind") or default_kind).lower()
                inline_text = item.get("text")
                if (
                    kind == "text"
                    and inline_text
                    and callable(save_text)
                ):
                    index = next_index("text")
                    stable_id = f"{run_id}_text_{index}"
                    try:
                        item["url"] = save_text(
                            inline_text,
                            prefix="generation_text_",
                            name=str(item.get("name") or "output.txt"),
                            stable_id=stable_id,
                        )
                    except TypeError:
                        item["url"] = save_text(
                            inline_text,
                            prefix="generation_text_",
                            name=str(item.get("name") or "output.txt"),
                        )
                    item.pop("text", None)
                elif item.get("url"):
                    item["url"] = await materialize(
                        item["url"], kind
                    )

        items = legacy.get("items")
        if isinstance(items, list):
            field_by_kind = {
                "image": "images",
                "video": "videos",
                "audio": "audios",
                "text": "texts",
                "file": "files",
            }
            for item in items:
                if not isinstance(item, dict) or not item.get("url"):
                    continue
                kind = str(item.get("kind") or "file").lower()
                field = field_by_kind.get(kind, "files")
                values = legacy.setdefault(field, [])
                if isinstance(values, list) and item["url"] not in values:
                    values.append(item["url"])
                outputs = legacy.setdefault("outputs", [])
                if (
                    isinstance(outputs, list)
                    and item["url"] not in outputs
                ):
                    outputs.append(item["url"])

        outputs = legacy.get("outputs")
        if isinstance(outputs, list):
            legacy["outputs"] = [
                await materialize(
                    value, inferred_kind(value, "file")
                )
                for value in outputs
            ]

        for key, value in list(legacy.items()):
            if isinstance(value, dict):
                legacy[key] = await self._materialize_legacy(
                    run_id,
                    value,
                    _replacements=replacements,
                    _counters=counters,
                )
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, dict):
                        value[index] = await self._materialize_legacy(
                            run_id,
                            item,
                            _replacements=replacements,
                            _counters=counters,
                        )

        def replace_known(value: Any) -> Any:
            if isinstance(value, str):
                return replacements.get(value, value)
            if isinstance(value, dict):
                return {
                    key: replace_known(item)
                    for key, item in value.items()
                }
            if isinstance(value, list):
                return [replace_known(item) for item in value]
            return value

        return replace_known(legacy)

    async def publish_prepared(
        self,
        run_id: str,
        request: RunRequest,
        prepared: PreparedGenerationOutput,
    ) -> Any:
        del request
        effects = dict(prepared.effects)
        history = effects.get("history")
        if isinstance(history, dict):
            await self._publication.publish_history(run_id, history)
        notification = effects.get("notification")
        if isinstance(notification, dict):
            await self._publication.publish_notification(run_id, notification)
        return prepared.result

    async def publish(
        self,
        run_id: str,
        request: RunRequest,
        output: ProviderOutput,
    ) -> Any:
        prepared = await self.prepare(run_id, request, output)
        return await self.publish_prepared(run_id, request, prepared)

    async def publish_typed(
        self,
        run_id: str,
        request: RunRequest,
        output: Any,
    ) -> Any:
        if isinstance(output, TextStreamOutput):
            consumed = False

            async def events():
                nonlocal consumed
                if consumed:
                    return
                consumed = True
                async for event in output.events:
                    yield event

            return TextStreamOutput(model=output.model, events=events())
        if isinstance(output, TextOutput):
            return output
        return output


class CanvasGenerationTargetGuard:
    """Validate before submission and atomically discard late Canvas output."""

    def __init__(
        self,
        *,
        canvas_sync: Any,
        actor_by_id: Callable[[str], Mapping[str, Any] | None],
    ) -> None:
        self._canvas_sync = canvas_sync
        self._actor_by_id = actor_by_id

    def _actor(self, owner: str) -> Mapping[str, Any]:
        actor = self._actor_by_id(str(owner or ""))
        if not actor:
            raise GenerationRunNotFound("Generation Run 的用户已不存在")
        return actor

    def validate(self, owner: str, target: RunTarget) -> None:
        if (
            not target.canvas_id
            or not target.node_id
            or not target.operation_id
            or target.request_index < 0
            or target.request_index > 63
        ):
            raise GenerationRunValidation(
                "生成任务缺少有效的画布、节点或请求序号"
            )
        actor = self._actor(owner)
        try:
            canvas = self._canvas_sync.read(
                target.canvas_id,
                actor,
                write=True,
            )
        except Exception as exc:
            raise GenerationRunError(
                str(getattr(exc, "detail", "") or exc)
            ) from exc
        if str(canvas.get("kind") or "").strip().lower() != "smart":
            raise GenerationRunValidation("生成任务仅支持 Smart Canvas")
        node = next(
            (
                item
                for item in (canvas.get("nodes") or [])
                if str(item.get("id") or "") == target.node_id
            ),
            None,
        )
        if node is None:
            raise GenerationRunConflict("生成任务的目标节点已删除")
        if (
            str(node.get("generationOperationId") or "")
            != target.operation_id
        ):
            raise GenerationRunConflict(
                "生成任务已失效，请使用节点当前的运行状态"
            )

    def is_current(self, owner: str, target: RunTarget) -> bool:
        try:
            self.validate(owner, target)
        except GenerationRunError:
            return False
        return True

    @staticmethod
    def _node_changes(result: Any) -> dict[str, Any]:
        return _generation_node_changes(result)

    async def apply_if_current(
        self,
        run_id: str,
        owner: str,
        target: RunTarget,
        result: Any,
    ) -> bool:
        actor = self._actor(owner)
        applied = await self._canvas_sync.apply_generation_result_if_current(
            target.canvas_id,
            actor,
            node_id=target.node_id,
            operation_id=target.operation_id,
            request_index=target.request_index,
            run_id=run_id,
            node_changes=_generation_node_changes(result),
        )
        return bool(applied.applied)


class GenerationRunControl:
    """Stable runtime-control adapter bound without importing ``main``."""

    def __init__(self) -> None:
        self._runs: GenerationRuns | None = None
        self._lock = threading.Lock()

    def install(self, runs: GenerationRuns) -> None:
        with self._lock:
            self._runs = runs

    def active_count(self) -> int:
        with self._lock:
            runs = self._runs
        return runs.active_count() if runs is not None else 0

    async def cancel_active(self) -> None:
        with self._lock:
            runs = self._runs
        if runs is not None:
            await runs.cancel_active()

    async def pause_active(self) -> None:
        with self._lock:
            runs = self._runs
        if runs is not None:
            await runs.pause_active()

    async def resume_active(self) -> None:
        with self._lock:
            runs = self._runs
        if runs is not None:
            await runs.resume_active(delivery=Background())


generation_run_control = GenerationRunControl()


__all__ = [
    "Background",
    "CanvasGenerationTargetGuard",
    "GenerationEffects",
    "GenerationEffectPorts",
    "GenerationOutputPorts",
    "GenerationExecutor",
    "GenerationRunConflict",
    "GenerationRunControl",
    "GenerationRunError",
    "GenerationRunLifecycleProjectionError",
    "GenerationRunLifecycleStore",
    "GenerationRunNotFound",
    "GenerationRunSnapshot",
    "GenerationRunValidation",
    "GenerationRuns",
    "ImageRun",
    "Inline",
    "ProviderGenerationExecutor",
    "RecoveryRun",
    "RunRequest",
    "RunTarget",
    "TextRun",
    "VideoRun",
    "WorkflowRun",
    "WorkspaceGenerationEffects",
    "canonical_request_hash",
    "generation_run_control",
]
