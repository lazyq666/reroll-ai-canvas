"""Verified, resource-bounded local relative-depth processing."""

from __future__ import annotations

import hashlib
import math
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

import requests
from PIL import Image, ImageOps


@dataclass(frozen=True)
class DepthModelSpec:
    processor_id: str
    revision: str
    filename: str
    url: str
    size: int
    sha256: str
    license: str


DEPTH_ANYTHING_V2_SMALL = DepthModelSpec(
    processor_id="depth-anything-v2-small",
    revision="4472b7362082ad9968fee890ca0f1e5aca36b93d",
    filename="model.onnx",
    url=(
        "https://huggingface.co/onnx-community/depth-anything-v2-small/"
        "resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/"
        "onnx/model.onnx"
    ),
    size=99_060_839,
    sha256=(
        "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c"
    ),
    license="Apache-2.0",
)


class DepthProcessorDependencyError(RuntimeError):
    """Raised when the local numeric runtime is unavailable."""


class DepthProcessorModelError(RuntimeError):
    """Raised when the pinned model cannot be downloaded or verified."""


class DepthProcessorInputError(ValueError):
    """Raised when a source image cannot be processed safely."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bounded_int(
    value: Any,
    fallback: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


class DepthAnythingV2SmallProcessor:
    """One verified Depth Anything V2 Small session and PNG output seam."""

    _shared_lock = threading.RLock()
    _download_locks: dict[Path, threading.RLock] = {}
    _sessions: dict[tuple[Path, int], Any] = {}

    def __init__(
        self,
        model_dir: str | Path,
        *,
        spec: DepthModelSpec = DEPTH_ANYTHING_V2_SMALL,
        http_get: Callable[..., Any] | None = None,
        session_factory: Callable[[Path], Any] | None = None,
        cpu_threads: int | None = None,
        max_source_pixels: int | None = None,
        max_inference_pixels: int | None = None,
    ) -> None:
        self.model_dir = Path(model_dir).expanduser().resolve()
        self.spec = spec
        self._http_get = http_get or requests.get
        self._session_factory = session_factory
        self.cpu_threads = _bounded_int(
            cpu_threads
            if cpu_threads is not None
            else os.getenv("DEPTH_PROCESSOR_CPU_THREADS", "2"),
            2,
            minimum=1,
            maximum=8,
        )
        self.max_source_pixels = _bounded_int(
            max_source_pixels
            if max_source_pixels is not None
            else os.getenv("DEPTH_PROCESSOR_MAX_SOURCE_PIXELS", "40000000"),
            40_000_000,
            minimum=1,
            maximum=200_000_000,
        )
        self.max_inference_pixels = _bounded_int(
            max_inference_pixels
            if max_inference_pixels is not None
            else os.getenv("DEPTH_PROCESSOR_MAX_INFERENCE_PIXELS", "2000000"),
            2_000_000,
            minimum=518 * 518,
            maximum=8_000_000,
        )
        self._session = None

    @property
    def model_path(self) -> Path:
        return self.model_dir / self.spec.filename

    @classmethod
    def _download_lock(cls, path: Path) -> threading.RLock:
        with cls._shared_lock:
            return cls._download_locks.setdefault(path, threading.RLock())

    @staticmethod
    def _emit(
        progress: Callable[[Mapping[str, Any]], None] | None,
        *,
        phase: str,
        percent: int,
        message: str,
    ) -> None:
        if progress is not None:
            progress(
                {
                    "phase": phase,
                    "progress": max(0, min(100, int(percent))),
                    "message": message,
                }
            )

    def _model_valid(self, path: Path) -> bool:
        try:
            return (
                path.is_file()
                and path.stat().st_size == self.spec.size
                and _sha256(path) == self.spec.sha256
            )
        except OSError:
            return False

    def _ensure_model(
        self,
        progress: Callable[[Mapping[str, Any]], None] | None,
    ) -> Path:
        self.model_dir.mkdir(parents=True, exist_ok=True)
        target = self.model_path
        with self._download_lock(target):
            if self._model_valid(target):
                return target
            if target.exists():
                target.unlink()
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{self.spec.processor_id}-",
                suffix=".download",
                dir=str(self.model_dir),
            )
            os.close(descriptor)
            temporary = Path(temporary_name)
            downloaded = 0
            last_percent = -1
            try:
                self._emit(
                    progress,
                    phase="downloading-model",
                    percent=0,
                    message="正在下载模型 0%",
                )
                with self._http_get(
                    self.spec.url,
                    stream=True,
                    timeout=(15, 300),
                ) as response:
                    response.raise_for_status()
                    with temporary.open("wb") as handle:
                        for chunk in response.iter_content(
                            chunk_size=1024 * 1024
                        ):
                            if not chunk:
                                continue
                            downloaded += len(chunk)
                            if downloaded > self.spec.size:
                                raise DepthProcessorModelError(
                                    "深度模型下载内容超过固定大小"
                                )
                            handle.write(chunk)
                            percent = int(downloaded * 100 / self.spec.size)
                            if percent > last_percent:
                                last_percent = percent
                                self._emit(
                                    progress,
                                    phase="downloading-model",
                                    percent=percent,
                                    message=f"正在下载模型 {percent}%",
                                )
                if downloaded != self.spec.size or not self._model_valid(
                    temporary
                ):
                    raise DepthProcessorModelError(
                        "深度模型校验失败，请稍后重试"
                    )
                os.replace(temporary, target)
                return target
            except DepthProcessorModelError:
                raise
            except Exception as exc:
                raise DepthProcessorModelError(
                    f"深度模型下载失败：{exc}"
                ) from exc
            finally:
                if temporary.exists():
                    temporary.unlink()

    def _create_session(self, model_path: Path) -> Any:
        if self._session_factory is not None:
            return self._session_factory(model_path)
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise DepthProcessorDependencyError(
                "深度图处理依赖未安装，请通过统一启动入口修复依赖后重试"
            ) from exc
        options = ort.SessionOptions()
        options.intra_op_num_threads = self.cpu_threads
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        options.enable_cpu_mem_arena = False
        return ort.InferenceSession(
            str(model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )

    def _ensure_session(self, model_path: Path) -> Any:
        if self._session is not None:
            return self._session
        cache_key = (model_path, self.cpu_threads)
        with self._shared_lock:
            if self._session_factory is None:
                self._session = self._sessions.get(cache_key)
            if self._session is None:
                self._session = self._create_session(model_path)
                if self._session_factory is None:
                    self._sessions[cache_key] = self._session
            return self._session

    def _inference_size(self, width: int, height: int) -> tuple[int, int]:
        scale = max(518.0 / width, 518.0 / height)
        target_width = max(14, int(round(width * scale / 14.0)) * 14)
        target_height = max(14, int(round(height * scale / 14.0)) * 14)
        pixels = target_width * target_height
        if pixels > self.max_inference_pixels:
            bounded_scale = math.sqrt(self.max_inference_pixels / pixels)
            target_width = max(
                14, int(math.floor(target_width * bounded_scale / 14.0)) * 14
            )
            target_height = max(
                14, int(math.floor(target_height * bounded_scale / 14.0)) * 14
            )
        return target_width, target_height

    def process(
        self,
        source_path: str | Path,
        output_path: str | Path,
        *,
        progress: Callable[[Mapping[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        with Image.open(Path(source_path)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        width, height = image.size
        if width < 1 or height < 1 or width * height > self.max_source_pixels:
            raise DepthProcessorInputError("来源图片尺寸超出本地深度处理上限")
        model_path = self._ensure_model(progress)
        session = self._ensure_session(model_path)
        try:
            import numpy as np
        except ImportError as exc:
            raise DepthProcessorDependencyError(
                "深度图处理依赖未安装，请通过统一启动入口修复依赖后重试"
            ) from exc
        inference_size = self._inference_size(width, height)
        resampling = getattr(Image, "Resampling", Image)
        resized = image.resize(inference_size, resampling.BICUBIC)
        array = np.asarray(resized, dtype=np.float32) / 255.0
        mean = np.asarray((0.485, 0.456, 0.406), dtype=np.float32)
        std = np.asarray((0.229, 0.224, 0.225), dtype=np.float32)
        tensor = np.ascontiguousarray(
            ((array - mean) / std).transpose((2, 0, 1))[None, ...]
        )

        self._emit(
            progress,
            phase="processing",
            percent=0,
            message="正在生成深度图",
        )
        input_name = session.get_inputs()[0].name
        raw = np.asarray(
            session.run(None, {input_name: tensor})[0],
            dtype=np.float32,
        ).squeeze()
        if raw.ndim != 2:
            raise RuntimeError("深度模型返回了无法识别的结果尺寸")
        finite = np.isfinite(raw)
        normalized = np.zeros(raw.shape, dtype=np.float32)
        if finite.any():
            low = float(np.min(raw[finite]))
            high = float(np.max(raw[finite]))
            if high > low:
                normalized[finite] = (raw[finite] - low) / (high - low)
        depth = Image.fromarray(
            np.rint(normalized * 255.0).astype(np.uint8),
            mode="L",
        ).resize((width, height), resampling.BICUBIC)

        output = Path(output_path).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{output.stem}-",
            suffix=".png.tmp",
            dir=str(output.parent),
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            depth.save(temporary, format="PNG")
            os.replace(temporary, output)
        finally:
            if temporary.exists():
                temporary.unlink()
        self._emit(
            progress,
            phase="completed",
            percent=100,
            message="深度图处理完成",
        )
        return {
            "processor_id": self.spec.processor_id,
            "model_revision": self.spec.revision,
            "model_sha256": self.spec.sha256,
            "license": self.spec.license,
            "source_size": [width, height],
            "inference_size": list(inference_size),
            "output_size": [width, height],
            "output_format": "png",
            "bit_depth": 8,
            "polarity": "near_white",
            "normalization": "per_image_min_max",
        }


__all__ = [
    "DEPTH_ANYTHING_V2_SMALL",
    "DepthAnythingV2SmallProcessor",
    "DepthProcessorDependencyError",
    "DepthProcessorInputError",
    "DepthProcessorModelError",
    "DepthModelSpec",
]
