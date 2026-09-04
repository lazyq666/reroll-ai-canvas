from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any

from fastapi import HTTPException

from .core import (
    Capability,
    Completed,
    ExecutionResult,
    Failed,
    Pending,
    ProviderAdapter,
    ProviderRegistry,
    Queued,
)


ImageExecutor = Callable[..., Awaitable[Any]]
ProviderLookup = Callable[[str], dict[str, Any]]
RemoteCheckpoint = Callable[[Pending | Queued], None]


async def _call_with_remote_checkpoint(
    executor: ImageExecutor,
    *args: Any,
    checkpoint: RemoteCheckpoint | None = None,
    require_checkpoint: bool = False,
    **kwargs: Any,
) -> Any:
    if checkpoint is not None:
        try:
            inspect.signature(executor).bind(
                *args, **kwargs, on_remote=checkpoint
            )
        except TypeError:
            if require_checkpoint:
                raise RuntimeError(
                    "async provider executor does not accept "
                    "the required remote checkpoint"
                )
        else:
            kwargs["on_remote"] = checkpoint
    return await executor(*args, **kwargs)


@dataclass(frozen=True)
class ImageExecutors:
    """Concrete image behaviours required by the production registry."""

    http: ImageExecutor
    modelscope: ImageExecutor
    codex: ImageExecutor
    gemini_cli: ImageExecutor
    jimeng: ImageExecutor
    runninghub: ImageExecutor
    gemini_native: ImageExecutor
    volcengine: ImageExecutor


@dataclass(frozen=True)
class VideoExecutors:
    http: ImageExecutor
    jimeng: ImageExecutor
    runninghub: ImageExecutor


@dataclass(frozen=True)
class ProviderOutput:
    """Normalized provider result consumed by Generation Runs."""

    text: str = ""
    media: tuple[Any, ...] = ()
    workflow_items: tuple[Any, ...] = ()
    model: str = ""
    usage: Any = None
    raw: Any = None
    remote_refs: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    legacy: Any = None


@dataclass(frozen=True)
class TextOutput:
    text: str
    model: str
    raw_usage: Any = None
    raw: Any = None
    expose_raw: bool = False


class TextDelivery(str, Enum):
    """How a text adapter presents output to an HTTP streaming caller."""

    BUFFERED = "buffered"
    STREAMING = "streaming"


class TextStreamEventKind(str, Enum):
    DELTA = "delta"
    USAGE = "usage"
    ERROR = "error"
    COMPLETE = "complete"


@dataclass(frozen=True)
class TextStreamEvent:
    kind: TextStreamEventKind
    delta: str = ""
    usage: Any = None
    detail: str = ""
    raw: Any = None
    expose_raw: bool = False


@dataclass(frozen=True)
class TextStreamOutput:
    model: str
    events: AsyncIterator[TextStreamEvent]


@dataclass(frozen=True)
class TextExecutors:
    http: ImageExecutor
    http_stream: ImageExecutor
    codex: ImageExecutor
    gemini_cli: ImageExecutor
    codex_default_model: str
    gemini_cli_default_model: str


@dataclass(frozen=True)
class RecoveryExecutors:
    http: ImageExecutor
    runninghub: ImageExecutor
    jimeng: ImageExecutor | None = None
    modelscope: ImageExecutor | None = None


@dataclass(frozen=True)
class WorkflowExecutors:
    comfyui: ImageExecutor
    modelscope: ImageExecutor
    modelscope_cloud: ImageExecutor
    modelscope_angle: ImageExecutor
    modelscope_angle_recovery: ImageExecutor
    runninghub_submit: ImageExecutor
    runninghub_query: ImageExecutor
    runninghub_app_submit: ImageExecutor
    runninghub_upload_asset: ImageExecutor
    comfyui_saved: ImageExecutor | None = None
    comfyui_recovery: ImageExecutor | None = None
    modelscope_recovery: ImageExecutor | None = None


def _protocol(provider: dict[str, Any]) -> str:
    return str(provider.get("protocol") or "openai").strip().lower()


def _provider_id(provider: dict[str, Any]) -> str:
    return str(provider.get("id") or "").strip().lower()


def _model_protocol(
    provider: dict[str, Any], request: dict[str, Any]
) -> str:
    protocol = _protocol(provider)
    if _provider_id(provider) in {
        "modelscope",
        "volcengine",
        "jimeng",
        "runninghub",
    }:
        return protocol
    model = str(request.get("model") or "").strip()
    overrides = provider.get("model_protocols")
    if isinstance(overrides, dict):
        override = str(overrides.get(model) or "").strip().lower()
        if override in {"openai", "gemini"}:
            return override
    return protocol


def _apimart(provider: dict[str, Any]) -> bool:
    return _protocol(provider) == "apimart" or "apimart.ai" in str(
        provider.get("base_url") or ""
    ).lower()


def _http_image_native_count(
    provider: dict[str, Any],
    request: Mapping[str, Any],
) -> bool:
    mode = str(
        provider.get("image_request_mode") or "auto"
    ).strip().lower()
    if mode in {
        "openai-video-proxy",
        "openai-responses",
        "openai-json",
    }:
        return False
    model = str(request.get("model") or "").strip().lower()
    if _apimart(provider) and model == "midjourney":
        return False
    if (
        model in {"gpt-image-2", "gpt-image-2.0"}
        and int(request.get("_reference_count") or 0) == 0
    ):
        return False
    return True


def _media_values(value: Any) -> tuple[Any, ...]:
    if isinstance(value, dict):
        for key in ("media", "images", "videos", "outputs", "urls"):
            items = value.get(key)
            if isinstance(items, list):
                return tuple(items)
        if value.get("url"):
            return (value["url"],)
        if value.get("type") in {"url", "base64", "path"}:
            return (value,)
    if isinstance(value, (list, tuple)):
        return tuple(value)
    return (value,) if value is not None else ()


def _image_output(value: Any) -> ProviderOutput:
    if (
        isinstance(value, Mapping)
        and value.get("kind") == "image_layer_decomposition"
    ):
        base = value["base"]
        layers = value["layers"]
        upstream_task_id = str(value.get("upstream_task_id") or "")
        return ProviderOutput(
            media=tuple(
                {"type": "url", "value": item["url"]}
                for item in (base, *layers)
            ),
            raw=dict(value.get("provider_raw_metadata") or {}),
            remote_refs=(upstream_task_id,) if upstream_task_id else (),
            metadata={"kind": "image_layer_decomposition"},
            legacy=dict(value),
        )
    media_value = value
    raw = None
    if isinstance(value, tuple) and len(value) == 2:
        media_value, raw = value
    return ProviderOutput(
        media=_media_values(media_value),
        raw=raw,
        legacy=value,
    )


def _structured_output(value: Any) -> ProviderOutput:
    remote_refs = ()
    if isinstance(value, dict):
        refs = [
            value.get("prompt_id"),
            value.get("task_id"),
            value.get("taskId"),
            (value.get("data") or {}).get("taskId")
            if isinstance(value.get("data"), dict)
            else None,
        ]
        remote_refs = tuple(
            str(item).strip() for item in refs if str(item or "").strip()
        )
    return ProviderOutput(
        media=_media_values(value),
        workflow_items=(value,) if isinstance(value, dict) else (),
        raw=value,
        remote_refs=remote_refs,
        legacy=value,
    )


def _failure_result(
    output: Any,
    normalized: ProviderOutput,
    status: str,
    nested_status: str = "",
) -> Failed | None:
    failure_statuses = {
        "failed",
        "failure",
        "error",
        "cancelled",
        "canceled",
    }
    upstream_status = next(
        (
            item
            for item in (nested_status, status)
            if item in failure_statuses
        ),
        "",
    )
    if not upstream_status:
        return None
    details: list[Any] = []
    if isinstance(output, dict):
        data = output.get("data")
        if isinstance(data, dict):
            details.extend(
                (
                    data.get("failReason"),
                    data.get("fail_reason"),
                    data.get("error"),
                    data.get("message"),
                    data.get("msg"),
                )
            )
        details.extend(
            (
                output.get("failReason"),
                output.get("fail_reason"),
                output.get("error"),
                output.get("message"),
                output.get("msg"),
            )
        )
    error = next(
        (str(item).strip() for item in details if str(item or "").strip()),
        upstream_status,
    )
    canonical_status = (
        "cancelled"
        if upstream_status in {"cancelled", "canceled"}
        else "failed"
    )
    return Failed(error=error, raw=normalized, status=canonical_status)


def _image_call(
    executor: ImageExecutor,
    *,
    include_quality: bool = False,
    require_checkpoint: bool = False,
):
    async def execute(
        *,
        provider: dict[str, Any],
        prompt: str,
        size: str,
        quality: str,
        model: str,
        reference_images: list[dict[str, Any]] | None = None,
        wait_for_task: Callable[..., Awaitable[Any]] | None = None,
        count: int = 1,
        checkpoint: RemoteCheckpoint | None = None,
        transparent_png: bool = False,
        operation: str = "image.generate",
        resolution_tier: str = "",
    ) -> ExecutionResult:
        transparent_kwargs = {"transparent_png": True} if transparent_png else {}
        operation_kwargs = (
            {
                "operation": operation,
                "resolution_tier": resolution_tier,
            }
            if operation == "image.layer_decomposition"
            else {}
        )
        if include_quality:
            args = (
                prompt,
                size,
                quality,
                model,
                reference_images,
                provider.get("id") or "comfly",
            )
            requested_count = max(1, min(8, int(count or 1)))
            kwargs: dict[str, Any] = {}
            if requested_count > 1:
                kwargs["n"] = requested_count
            if wait_for_task is not None:
                kwargs["wait_for_task"] = wait_for_task
            output = await _call_with_remote_checkpoint(
                executor,
                *args,
                checkpoint=checkpoint,
                require_checkpoint=require_checkpoint,
                **transparent_kwargs,
                **operation_kwargs,
                **kwargs,
            )
        else:
            output = await _call_with_remote_checkpoint(
                executor,
                prompt,
                size,
                model,
                reference_images,
                provider,
                checkpoint=checkpoint,
                require_checkpoint=require_checkpoint,
                **transparent_kwargs,
                **operation_kwargs,
            )
        return Completed(_image_output(output))

    return execute


def _jimeng_image_call(executor: ImageExecutor):
    base = _image_call(executor)

    async def execute(**request: Any) -> ExecutionResult:
        try:
            return await base(**request)
        except Exception as exc:
            submit_id = str(getattr(exc, "submit_id", "") or "").strip()
            if not submit_id:
                raise
            return Queued(submit_id, raw=exc, status="jimeng_pending")

    return execute


def build_image_registry(executors: ImageExecutors) -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.extend(
        [
            ProviderAdapter(
                "modelscope",
                lambda provider, _request: _provider_id(provider) == "modelscope",
                {
                    Capability.IMAGE: _image_call(
                        executors.modelscope,
                        require_checkpoint=True,
                    )
                },
                priority=900,
                metadata={
                    "image_engine": "modelscope",
                    "chat_image_enabled": False,
                },
            ),
            ProviderAdapter(
                "codex-cli",
                lambda provider, _request: _protocol(provider) == "codex",
                {Capability.IMAGE: _image_call(executors.codex)},
                priority=850,
                metadata={"image_engine": "api"},
            ),
            ProviderAdapter(
                "gemini-cli",
                lambda provider, _request: _protocol(provider) == "gemini-cli",
                {Capability.IMAGE: _image_call(executors.gemini_cli)},
                priority=840,
                metadata={"image_engine": "api"},
            ),
            ProviderAdapter(
                "jimeng-cli",
                lambda provider, _request: _protocol(provider) == "jimeng"
                or _provider_id(provider) == "jimeng",
                {Capability.IMAGE: _jimeng_image_call(executors.jimeng)},
                priority=830,
                metadata={"image_engine": "api"},
            ),
            ProviderAdapter(
                "runninghub",
                lambda provider, _request: _protocol(provider) == "runninghub"
                or _provider_id(provider) == "runninghub",
                {
                    Capability.IMAGE: _image_call(
                        executors.runninghub,
                        require_checkpoint=True,
                    )
                },
                priority=820,
                metadata={"image_engine": "runninghub"},
            ),
            ProviderAdapter(
                "gemini-native",
                lambda provider, request: _model_protocol(provider, request)
                == "gemini"
                and not _apimart(provider),
                {Capability.IMAGE: _image_call(executors.gemini_native)},
                priority=810,
                metadata={"image_engine": "api"},
            ),
            ProviderAdapter(
                "volcengine",
                lambda provider, _request: _protocol(provider) == "volcengine",
                {Capability.IMAGE: _image_call(executors.volcengine)},
                priority=800,
                metadata={"image_engine": "volcengine"},
            ),
            ProviderAdapter(
                "http-image",
                lambda _provider, _request: True,
                {
                    Capability.IMAGE: _image_call(
                        executors.http,
                        include_quality=True,
                        require_checkpoint=True,
                    )
                },
                metadata={
                    "image_engine": "api",
                    "native_count": _http_image_native_count,
                },
            ),
        ]
    )
    return registry


def build_video_registry(executors: VideoExecutors) -> ProviderRegistry:
    async def video_call(
        executor: ImageExecutor,
        *,
        provider,
        payload,
        checkpoint=None,
    ):
        output = await _call_with_remote_checkpoint(
            executor,
            payload,
            provider,
            checkpoint=checkpoint,
            require_checkpoint=True,
        )
        normalized = _structured_output(output)
        status = (
            str(output.get("status") or "").strip().lower()
            if isinstance(output, dict)
            else ""
        )
        nested = (
            str((output.get("data") or {}).get("status") or "").lower()
            if isinstance(output, dict)
            and isinstance(output.get("data"), dict)
            else ""
        )
        return _failure_result(
            output, normalized, status, nested
        ) or Completed(normalized)

    async def runninghub_call(
        *, provider, payload, checkpoint=None
    ):
        try:
            return await video_call(
                executors.runninghub,
                provider=provider,
                payload=payload,
                checkpoint=checkpoint,
            )
        except HTTPException:
            raise
        except Exception as exc:
            # Preserve the legacy HTTP error mapping without leaking it into
            # route orchestration.
            try:
                import httpx

                if isinstance(exc, httpx.HTTPStatusError):
                    raise HTTPException(
                        status_code=exc.response.status_code,
                        detail=(
                            "RunningHub 视频接口错误："
                            f"{exc.response.text}"
                        ),
                    ) from exc
                if isinstance(exc, httpx.HTTPError):
                    raise HTTPException(
                        status_code=502,
                        detail=f"请求 RunningHub 视频接口失败：{exc}",
                    ) from exc
            except ImportError:
                pass
            raise

    async def jimeng_call(*, provider, payload, checkpoint=None):
        try:
            return await video_call(
                executors.jimeng,
                provider=provider,
                payload=payload,
                checkpoint=checkpoint,
            )
        except Exception as exc:
            submit_id = str(
                getattr(exc, "submit_id", "") or ""
            ).strip()
            if not submit_id:
                raise
            return Queued(
                submit_id,
                raw=exc,
                status="jimeng_pending",
            )

    registry = ProviderRegistry()
    registry.extend(
        [
            ProviderAdapter(
                "jimeng-cli-video",
                lambda provider, _request: _protocol(provider) == "jimeng"
                or _provider_id(provider) == "jimeng",
                {
                    Capability.VIDEO: jimeng_call
                },
                priority=900,
            ),
            ProviderAdapter(
                "runninghub-video",
                lambda provider, _request: _protocol(provider) == "runninghub"
                or _provider_id(provider) == "runninghub",
                {Capability.VIDEO: runninghub_call},
                priority=850,
            ),
            ProviderAdapter(
                "http-video",
                lambda _provider, _request: True,
                {
                    Capability.VIDEO: lambda **request: video_call(
                        executors.http, **request
                    )
                },
            ),
        ]
    )
    return registry


def build_text_registry(executors: TextExecutors) -> ProviderRegistry:
    def normalized_text(output: TextOutput) -> ProviderOutput:
        return ProviderOutput(
            text=output.text,
            model=output.model,
            usage=output.raw_usage,
            raw=output.raw,
            metadata={"expose_raw": output.expose_raw},
            legacy=output,
        )

    async def http_text(*, provider, payload, history, messages):
        raw = await executors.http(provider, payload, messages)
        return Completed(normalized_text(TextOutput(**raw)))

    async def http_text_stream(*, provider, payload, history, messages):
        raw = await executors.http_stream(provider, payload, messages)

        async def events():
            async for item in raw["events"]:
                kind = TextStreamEventKind(str(item.get("type") or "error"))
                yield TextStreamEvent(
                    kind=kind,
                    delta=str(item.get("delta") or ""),
                    usage=item.get("usage"),
                    detail=str(item.get("detail") or ""),
                    raw=item.get("raw"),
                    expose_raw=bool(item.get("expose_raw")),
                )

        return Completed(
            TextStreamOutput(model=str(raw["model"]), events=events())
        )

    def cli_text(executor, default_model):
        async def execute(*, provider, payload, history, messages):
            configured = provider.get("chat_models") or [default_model]
            model = str(payload.model or configured[0]).strip()
            payload.model = model
            text, raw = await executor(payload, history)
            return Completed(
                normalized_text(
                    TextOutput(
                    text=text,
                    model=model,
                    raw_usage=None,
                    raw=raw,
                    expose_raw=True,
                    )
                )
            )

        return execute

    def cli_text_stream(executor, default_model):
        async def execute(*, provider, payload, history, messages):
            configured = provider.get("chat_models") or [default_model]
            model = str(payload.model or configured[0]).strip()
            payload.model = model

            async def events():
                try:
                    text, raw = await executor(payload, history)
                except HTTPException as exc:
                    yield TextStreamEvent(
                        TextStreamEventKind.ERROR,
                        detail=str(exc.detail),
                    )
                    return
                yield TextStreamEvent(
                    TextStreamEventKind.DELTA, delta=text
                )
                yield TextStreamEvent(
                    TextStreamEventKind.COMPLETE,
                    raw=raw,
                    expose_raw=True,
                )

            return Completed(TextStreamOutput(model=model, events=events()))

        return execute

    registry = ProviderRegistry()
    registry.extend(
        [
            ProviderAdapter(
                "codex-cli-text",
                lambda provider, _request: _protocol(provider) == "codex",
                {
                    Capability.TEXT: cli_text(
                        executors.codex, executors.codex_default_model
                    ),
                    Capability.TEXT_STREAM: cli_text_stream(
                        executors.codex, executors.codex_default_model
                    ),
                },
                priority=900,
                metadata={
                    "text_delivery": TextDelivery.BUFFERED,
                    "default_model": executors.codex_default_model,
                },
            ),
            ProviderAdapter(
                "gemini-cli-text",
                lambda provider, _request: _protocol(provider) == "gemini-cli",
                {
                    Capability.TEXT: cli_text(
                        executors.gemini_cli,
                        executors.gemini_cli_default_model,
                    ),
                    Capability.TEXT_STREAM: cli_text_stream(
                        executors.gemini_cli,
                        executors.gemini_cli_default_model,
                    ),
                },
                priority=850,
                metadata={
                    "text_delivery": TextDelivery.BUFFERED,
                    "default_model": executors.gemini_cli_default_model,
                },
            ),
            ProviderAdapter(
                "http-text",
                lambda _provider, _request: True,
                {
                    Capability.TEXT: http_text,
                    Capability.TEXT_STREAM: http_text_stream,
                },
                metadata={"text_delivery": TextDelivery.STREAMING},
            ),
        ]
    )
    return registry


def build_recovery_registry(
    executors: RecoveryExecutors,
) -> ProviderRegistry:
    def supports_http_recovery(
        provider: dict[str, Any], _request: dict[str, Any]
    ) -> bool:
        return (
            _protocol(provider)
            not in {
                "codex",
                "gemini-cli",
                "jimeng",
                "modelscope",
                "comfyui",
                "local",
            }
            and _provider_id(provider)
            not in {"jimeng", "modelscope", "comfyui"}
        )

    async def recover(
        executor: ImageExecutor,
        *,
        provider,
        task_id,
        kind="image",
        include_kind=False,
    ):
        if include_kind:
            try:
                inspect.signature(executor).bind(
                    provider, task_id, kind
                )
            except TypeError:
                output = await executor(provider, task_id)
            else:
                output = await executor(provider, task_id, kind)
        else:
            output = await executor(provider, task_id)
        normalized = _structured_output(output)
        if include_kind:
            normalized = replace(
                normalized,
                metadata={
                    **dict(normalized.metadata),
                    "media_kind": str(kind or "image"),
                },
            )
        status = str(
            output.get("status") if isinstance(output, dict) else ""
        ).strip().lower()
        failed = _failure_result(output, normalized, status)
        if failed is not None:
            return failed
        remote_ref = (
            normalized.remote_refs[0]
            if normalized.remote_refs
            else str(task_id)
        )
        if status == "queued":
            return Queued(remote_ref, raw=normalized)
        if status in {"running", "pending", "in_progress"}:
            return Pending(remote_ref, raw=normalized, status=status)
        return Completed(normalized)

    registry = ProviderRegistry()
    registry.extend(
        [
            ProviderAdapter(
                "modelscope-image-recovery",
                lambda provider, _request: (
                    executors.modelscope is not None
                    and (
                        _protocol(provider) == "modelscope"
                        or _provider_id(provider) == "modelscope"
                    )
                ),
                {
                    Capability.IMAGE_RECOVERY: lambda **request: recover(
                        executors.modelscope,
                        provider=request["provider"],
                        task_id=request["task_id"],
                    )
                },
                priority=975,
            ),
            ProviderAdapter(
                "jimeng-recovery",
                lambda provider, _request: (
                    executors.jimeng is not None
                    and (
                        _protocol(provider) == "jimeng"
                        or _provider_id(provider) == "jimeng"
                    )
                ),
                {
                    Capability.IMAGE_RECOVERY: lambda **request: recover(
                        executors.jimeng,
                        provider=request["provider"],
                        task_id=request["task_id"],
                        kind=request.get("kind") or "image",
                        include_kind=True,
                    )
                },
                priority=950,
            ),
            ProviderAdapter(
                "runninghub-recovery",
                lambda provider, _request: _protocol(provider) == "runninghub"
                or _provider_id(provider) == "runninghub",
                {
                    Capability.IMAGE_RECOVERY: lambda **request: recover(
                        executors.runninghub,
                        **request,
                        include_kind=True,
                    )
                },
                priority=900,
            ),
            ProviderAdapter(
                "http-image-recovery",
                supports_http_recovery,
                {
                    Capability.IMAGE_RECOVERY: lambda **request: recover(
                        executors.http, **request, include_kind=True
                    )
                },
            ),
        ]
    )
    return registry


def build_workflow_registry(
    executors: WorkflowExecutors,
) -> ProviderRegistry:
    def operation(name: str):
        return lambda _provider, request: request.get("operation") == name

    async def workflow(
        executor: ImageExecutor,
        *,
        provider,
        payload,
        operation,
        checkpoint=None,
    ):
        output = await _call_with_remote_checkpoint(
            executor,
            payload,
            checkpoint=checkpoint,
        )
        normalized = _structured_output(output)
        status = (
            str(output.get("status") or "").strip().lower()
            if isinstance(output, dict)
            else ""
        )
        nested_status = (
            str((output.get("data") or {}).get("status") or "").lower()
            if isinstance(output, dict)
            and isinstance(output.get("data"), dict)
            else ""
        )
        failed = _failure_result(output, normalized, status, nested_status)
        if failed is not None:
            return failed
        if operation in {
            "runninghub-submit",
            "runninghub-app-submit",
        } and normalized.remote_refs:
            return Queued(
                normalized.remote_refs[0], raw=normalized
            )
        if status == "queued" or nested_status == "queued":
            remote_ref = (
                normalized.remote_refs[0]
                if normalized.remote_refs
                else nested_status or status
            )
            return Queued(remote_ref, raw=normalized)
        if status in {"pending", "running", "timeout"} or nested_status in {
            "pending",
            "running",
        }:
            remote_ref = (
                normalized.remote_refs[0] if normalized.remote_refs else status
            )
            pending_status = nested_status or status
            if pending_status == "timeout":
                pending_status = "pending"
            return Pending(
                remote_ref, raw=normalized, status=pending_status
            )
        return Completed(normalized)

    registry = ProviderRegistry()
    registry.extend(
        [
            ProviderAdapter(
                "comfyui-workflow",
                operation("comfyui"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.comfyui, **request
                    )
                },
            ),
            ProviderAdapter(
                "comfyui-saved-workflow",
                operation("comfyui-saved"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.comfyui_saved, **request
                    )
                },
            ),
            ProviderAdapter(
                "comfyui-workflow-recovery",
                operation("comfyui-recovery"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.comfyui_recovery, **request
                    )
                },
            ),
            ProviderAdapter(
                "modelscope-workflow",
                operation("modelscope"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.modelscope, **request
                    )
                },
            ),
            ProviderAdapter(
                "modelscope-workflow-recovery",
                operation("modelscope-recovery"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.modelscope_recovery, **request
                    )
                },
            ),
            ProviderAdapter(
                "modelscope-cloud-workflow",
                operation("modelscope-cloud"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.modelscope_cloud, **request
                    )
                },
            ),
            ProviderAdapter(
                "modelscope-angle-workflow",
                operation("modelscope-angle"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.modelscope_angle, **request
                    )
                },
            ),
            ProviderAdapter(
                "modelscope-angle-recovery",
                operation("modelscope-angle-recovery"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.modelscope_angle_recovery, **request
                    )
                },
            ),
            ProviderAdapter(
                "runninghub-workflow-submit",
                operation("runninghub-submit"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.runninghub_submit, **request
                    )
                },
            ),
            ProviderAdapter(
                "runninghub-workflow-query",
                operation("runninghub-query"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.runninghub_query, **request
                    )
                },
            ),
            ProviderAdapter(
                "runninghub-ai-app-submit",
                operation("runninghub-app-submit"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.runninghub_app_submit, **request
                    )
                },
            ),
            ProviderAdapter(
                "runninghub-upload-asset",
                operation("runninghub-upload-asset"),
                {
                    Capability.WORKFLOW: lambda **request: workflow(
                        executors.runninghub_upload_asset, **request
                    )
                },
            ),
        ]
    )
    return registry


@dataclass
class ProviderRuntime:
    provider_lookup: ProviderLookup
    image_registry: ProviderRegistry
    video_registry: ProviderRegistry | None = None
    text_registry: ProviderRegistry | None = None
    recovery_registry: ProviderRegistry | None = None
    workflow_registry: ProviderRegistry | None = None

    def image_native_count(
        self,
        provider_id: str,
        settings: Mapping[str, Any] | None = None,
    ) -> bool:
        provider = self.provider_lookup(provider_id)
        request = dict(settings or {})
        adapter = self.image_registry.select(
            provider,
            Capability.IMAGE,
            request,
        )
        native_count = adapter.metadata.get("native_count")
        if callable(native_count):
            return bool(native_count(provider, request))
        return bool(native_count)

    async def execute_image(
        self,
        prompt: str,
        size: str,
        quality: str,
        model: str,
        reference_images: list[dict[str, Any]] | None = None,
        provider_id: str = "comfly",
        wait_for_task: Callable[..., Awaitable[Any]] | None = None,
        count: int = 1,
        checkpoint: RemoteCheckpoint | None = None,
        transparent_png: bool = False,
        operation: str = "image.generate",
        resolution_tier: str = "",
    ) -> ExecutionResult:
        provider = self.provider_lookup(provider_id)
        return await self.image_registry.execute(
            provider,
            Capability.IMAGE,
            prompt=prompt,
            size=size,
            quality=quality,
            model=model,
            reference_images=reference_images,
            wait_for_task=wait_for_task,
            count=count,
            checkpoint=checkpoint,
            transparent_png=transparent_png,
            operation=operation,
            resolution_tier=resolution_tier,
        )

    async def generate_image(
        self,
        prompt: str,
        size: str,
        quality: str,
        model: str,
        reference_images: list[dict[str, Any]] | None = None,
        provider_id: str = "comfly",
        wait_for_task: Callable[..., Awaitable[Any]] | None = None,
    ) -> Any:
        """Strict-compatibility facade; new orchestration uses execute_image."""
        result = await self.execute_image(
            prompt,
            size,
            quality,
            model,
            reference_images,
            provider_id,
            wait_for_task,
        )
        if isinstance(result, Completed):
            if not isinstance(result.output, ProviderOutput):
                raise RuntimeError("image adapter returned invalid output")
            return result.output.legacy
        # Generation Runs consumes Pending/Queued directly.  The compatibility
        # facade retains the legacy raw payload until candidate 03 lands.
        if isinstance(result, Queued) and isinstance(result.raw, BaseException):
            raise result.raw
        return result.raw

    async def execute_video(
        self,
        payload: Any,
        checkpoint: RemoteCheckpoint | None = None,
    ) -> ExecutionResult:
        if self.video_registry is None:
            raise RuntimeError("video provider registry is not configured")
        provider = self.provider_lookup(payload.provider_id)
        return await self.video_registry.execute(
            provider,
            Capability.VIDEO,
            payload=payload,
            checkpoint=checkpoint,
        )

    async def generate_video(self, payload: Any) -> Any:
        """Strict-compatibility facade; new orchestration uses execute_video."""
        result = await self.execute_video(payload)
        if isinstance(result, Completed):
            if not isinstance(result.output, ProviderOutput):
                raise RuntimeError("video adapter returned invalid output")
            return result.output.legacy
        return result.raw

    async def execute_recovery(
        self,
        provider_id: str,
        task_id: str,
        kind: str = "image",
    ) -> ExecutionResult:
        if self.recovery_registry is None:
            raise RuntimeError("image recovery registry is not configured")
        provider = self.provider_lookup(provider_id)
        return await self.recovery_registry.execute(
            provider,
            Capability.IMAGE_RECOVERY,
            task_id=task_id,
            kind=kind,
        )

    async def recover_image_task(
        self, provider_id: str, task_id: str
    ) -> dict[str, Any]:
        """Strict-compatibility facade for the legacy recovery route."""
        result = await self.execute_recovery(provider_id, task_id)
        normalized = result.output if isinstance(result, Completed) else result.raw
        if not isinstance(normalized, ProviderOutput):
            raise RuntimeError("image recovery adapter returned invalid output")
        if not isinstance(normalized.legacy, dict):
            raise RuntimeError("image recovery legacy output is not a mapping")
        return normalized.legacy

    async def execute_text(
        self,
        payload: Any,
        history: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> ExecutionResult:
        if self.text_registry is None:
            raise RuntimeError("text provider registry is not configured")
        provider = self.provider_lookup(payload.provider)
        return await self.text_registry.execute(
            provider,
            Capability.TEXT,
            payload=payload,
            history=history,
            messages=messages,
        )

    async def generate_text(
        self,
        payload: Any,
        history: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> TextOutput:
        """Strict-compatibility facade; new orchestration uses execute_text."""
        result = await self.execute_text(payload, history, messages)
        if not isinstance(result, Completed) or not isinstance(
            result.output, ProviderOutput
        ):
            raise RuntimeError("text adapter returned a non-completed result")
        if not isinstance(result.output.legacy, TextOutput):
            raise RuntimeError("text adapter has no compatibility projection")
        return result.output.legacy

    async def execute_text_stream(
        self,
        payload: Any,
        history: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> ExecutionResult:
        if self.text_registry is None:
            raise RuntimeError("text provider registry is not configured")
        provider = self.provider_lookup(payload.provider)
        return await self.text_registry.execute(
            provider,
            Capability.TEXT_STREAM,
            payload=payload,
            history=history,
            messages=messages,
        )

    async def stream_text(
        self,
        payload: Any,
        history: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> TextStreamOutput:
        """Compatibility projection for HTTP streaming routes."""
        result = await self.execute_text_stream(payload, history, messages)
        if not isinstance(result, Completed) or not isinstance(
            result.output, TextStreamOutput
        ):
            raise RuntimeError("text stream adapter returned invalid output")
        return result.output

    async def execute_workflow(
        self,
        operation: str,
        payload: Any,
        provider_id: str = "",
        checkpoint: RemoteCheckpoint | None = None,
    ) -> ExecutionResult:
        if self.workflow_registry is None:
            raise RuntimeError("workflow registry is not configured")
        provider = (
            self.provider_lookup(provider_id)
            if provider_id
            and operation
            not in {"comfyui", "comfyui-saved", "comfyui-recovery"}
            else {"id": operation, "protocol": "local"}
        )
        return await self.workflow_registry.execute(
            provider,
            Capability.WORKFLOW,
            operation=operation,
            payload=payload,
            checkpoint=checkpoint,
        )

    def text_delivery(self, payload: Any) -> TextDelivery:
        """Return delivery shape without exposing vendor identity to callers."""
        if self.text_registry is None:
            raise RuntimeError("text provider registry is not configured")
        provider = self.provider_lookup(payload.provider)
        adapter = self.text_registry.select(
            provider,
            Capability.TEXT,
            {
                "payload": payload,
                "history": [],
                "messages": [],
            },
        )
        delivery = adapter.metadata.get("text_delivery")
        if not isinstance(delivery, TextDelivery):
            raise RuntimeError(
                f"text adapter {adapter.name} has no typed delivery metadata"
            )
        return delivery

    def text_model(self, payload: Any) -> str:
        """Resolve a text model through the selected adapter's metadata."""
        if self.text_registry is None:
            raise RuntimeError("text provider registry is not configured")
        provider = self.provider_lookup(payload.provider)
        adapter = self.text_registry.select(
            provider,
            Capability.TEXT,
            {"payload": payload, "history": [], "messages": []},
        )
        configured = provider.get("chat_models") or []
        fallback = str(
            configured[0] if configured else adapter.metadata.get("default_model") or ""
        ).strip()
        return str(payload.model or fallback).strip()

    def image_engine(self, provider_id: str, model: str = "") -> str:
        """Return the parameter-schema engine declared by the image adapter."""
        provider = self.provider_lookup(provider_id)
        adapter = self.image_registry.select(
            provider, Capability.IMAGE, {"model": model}
        )
        return str(adapter.metadata.get("image_engine") or "api")

    def chat_image_provider_id(
        self, provider_id: str, fallback_id: str = "comfly"
    ) -> str:
        """Preserve legacy chat-image eligibility without route vendor checks."""
        provider = self.provider_lookup(provider_id)
        adapter = self.image_registry.select(
            provider, Capability.IMAGE, {"model": ""}
        )
        if adapter.metadata.get("chat_image_enabled", True):
            return str(provider.get("id") or provider_id)
        return fallback_id
