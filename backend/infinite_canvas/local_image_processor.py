"""Generation executor adapter for deterministic local image processors."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from .generation_runs import ImageRun, canonical_request_hash
from .providers.core import Completed, Failed
from .providers.runtime import ProviderOutput


class LocalImageProcessorGenerationExecutor:
    """Route known local processors and delegate every other Generation Run."""

    PROCESSOR_ID = "depth-anything-v2-small"

    def __init__(
        self,
        *,
        delegate: Any,
        processor: Any,
        resolve_media: Callable[[str], str | Path | None],
        result_path: Callable[[str], str | Path],
    ) -> None:
        self._delegate = delegate
        self._processor = processor
        self._resolve_media = resolve_media
        self._result_path = result_path

    @classmethod
    def _is_depth(cls, request: Any) -> bool:
        return (
            isinstance(request, ImageRun)
            and request.settings.get("processor_id") == cls.PROCESSOR_ID
        )

    def is_restart_recoverable(self, request: Any) -> bool:
        return self._is_depth(request)

    def requires_child_attempts(self, request: ImageRun) -> bool:
        if self._is_depth(request):
            return False
        predicate = getattr(self._delegate, "requires_child_attempts", None)
        return bool(callable(predicate) and predicate(request))

    async def _delegate_execute(
        self,
        request: Any,
        *,
        checkpoint: Any = None,
        progress: Any = None,
    ) -> Any:
        execute = self._delegate.execute
        signature = inspect.signature(execute)
        options = {}
        for name, value in (
            ("checkpoint", checkpoint),
            ("progress", progress),
        ):
            if value is None:
                continue
            candidate = {**options, name: value}
            try:
                signature.bind(request, **candidate)
            except TypeError:
                continue
            options = candidate
        return await execute(request, **options)

    async def execute(
        self,
        request: Any,
        *,
        checkpoint: Any = None,
        progress: Any = None,
    ) -> Any:
        if not self._is_depth(request):
            return await self._delegate_execute(
                request,
                checkpoint=checkpoint,
                progress=progress,
            )
        reference = next(
            (
                item
                for item in request.references
                if isinstance(item, Mapping)
                and str(item.get("url") or "").strip()
            ),
            None,
        )
        if reference is None:
            return Failed("深度图处理缺少来源图片")
        source = self._resolve_media(str(reference["url"]))
        if source is None:
            return Failed("来源图片文件不可访问")
        cache_key = canonical_request_hash(request)
        output = Path(self._result_path(cache_key)).expanduser().resolve()
        try:
            metadata = await asyncio.to_thread(
                self._processor.process,
                Path(source),
                output,
                progress=progress,
            )
        except Exception as exc:
            return Failed(str(exc) or "深度图处理失败")
        image_value = {"type": "url", "value": str(output)}
        return Completed(
            ProviderOutput(
                media=(str(output),),
                model=self.PROCESSOR_ID,
                metadata={"image_processor": dict(metadata)},
                legacy=(
                    image_value,
                    {"image_processor": dict(metadata)},
                ),
            )
        )


__all__ = ["LocalImageProcessorGenerationExecutor"]
