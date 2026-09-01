"""Resource-bounded local image matting for Reroll.

The implementation intentionally keeps the heavyweight dependencies optional at
module import time. The web app can still start and report a useful error when
the matting extras have not been installed yet.
"""

from __future__ import annotations

import hashlib
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Optional, Tuple

import requests
from PIL import Image, ImageOps


class MattingDependencyError(RuntimeError):
    """Raised when the optional local matting runtime is unavailable."""


class MattingModelError(RuntimeError):
    """Raised when the model cannot be downloaded or verified."""


@dataclass(frozen=True)
class MattingModelSpec:
    name: str
    filename: str
    url: str
    md5: str


MODEL_SPECS = {
    "birefnet-general": MattingModelSpec(
        name="birefnet-general",
        filename="birefnet-general.onnx",
        url=(
            "https://github.com/danielgatis/rembg/releases/download/"
            "v0.0.0/BiRefNet-general-epoch_244.onnx"
        ),
        md5="7a35a0141cbbc80de11d9c9a28f52697",
    ),
    "birefnet-general-lite": MattingModelSpec(
        name="birefnet-general-lite",
        filename="birefnet-general-lite.onnx",
        url=(
            "https://github.com/danielgatis/rembg/releases/download/"
            "v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx"
        ),
        md5="4fab47adc4ff364be1713e97b7e66334",
    ),
}


def _positive_int(value: Any, fallback: int, minimum: int = 1, maximum: int = 100_000_000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _scaled_size(size: Tuple[int, int], max_pixels: int) -> Tuple[int, int]:
    width, height = size
    pixels = width * height
    if pixels <= max_pixels:
        return width, height
    ratio = math.sqrt(max_pixels / float(pixels))
    return max(1, int(round(width * ratio))), max(1, int(round(height * ratio)))


class BiRefNetMattingEngine:
    """One cached BiRefNet ONNX session plus bounded alpha refinement."""

    def __init__(
        self,
        model_dir: str,
        model_name: Optional[str] = None,
        cpu_threads: Optional[int] = None,
        refine_max_pixels: Optional[int] = None,
        max_source_pixels: Optional[int] = None,
    ):
        requested_model = str(model_name or os.getenv("MATTING_MODEL", "birefnet-general")).strip()
        self.spec = MODEL_SPECS.get(requested_model, MODEL_SPECS["birefnet-general"])
        self.model_dir = Path(model_dir).expanduser().resolve()
        self.cpu_threads = _positive_int(
            cpu_threads if cpu_threads is not None else os.getenv("MATTING_CPU_THREADS", "2"),
            2,
            maximum=8,
        )
        self.refine_max_pixels = _positive_int(
            refine_max_pixels
            if refine_max_pixels is not None
            else os.getenv("MATTING_REFINE_MAX_PIXELS", "1500000"),
            1_500_000,
            minimum=262_144,
            maximum=8_000_000,
        )
        self.max_source_pixels = _positive_int(
            max_source_pixels
            if max_source_pixels is not None
            else os.getenv("MATTING_MAX_SOURCE_PIXELS", "40000000"),
            40_000_000,
            minimum=1_048_576,
            maximum=200_000_000,
        )
        self._np = None
        self._ort = None
        self._binary_erosion = None
        self._estimate_alpha_cf = None
        self._estimate_foreground_ml = None
        self._session = None
        self._session_lock = Lock()
        # pymatting's default Numba workqueue aborts the process when entered
        # concurrently. ONNX prediction remains parallel; only alpha refinement
        # shares this single-file lane.
        self._refine_lock = Lock()

    @property
    def model_path(self) -> Path:
        return self.model_dir / self.spec.filename

    def model_ready(self) -> bool:
        return self.model_path.is_file()

    def _load_dependencies(self) -> None:
        if self._np is not None:
            return
        # Native numeric runtimes otherwise tend to use every performance core.
        thread_text = str(self.cpu_threads)
        for key in (
            "OMP_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
            "MKL_NUM_THREADS",
            "NUMBA_NUM_THREADS",
        ):
            os.environ[key] = thread_text
        try:
            import numpy as np
            import onnxruntime as ort
            from pymatting.alpha.estimate_alpha_cf import estimate_alpha_cf
            from pymatting.foreground.estimate_foreground_ml import estimate_foreground_ml
            from scipy.ndimage import binary_erosion
        except ImportError as exc:
            raise MattingDependencyError(
                "抠图依赖未安装，请通过统一启动入口运行 install --force 后重启服务"
            ) from exc
        self._np = np
        self._ort = ort
        self._binary_erosion = binary_erosion
        self._estimate_alpha_cf = estimate_alpha_cf
        self._estimate_foreground_ml = estimate_foreground_ml

    def _ensure_model(self) -> Path:
        self.model_dir.mkdir(parents=True, exist_ok=True)
        target = self.model_path
        if target.is_file() and _md5(target) == self.spec.md5:
            return target
        if target.exists():
            target.unlink()

        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{self.spec.name}-",
            suffix=".download",
            dir=str(self.model_dir),
        )
        os.close(fd)
        temporary = Path(temporary_name)
        try:
            with requests.get(self.spec.url, stream=True, timeout=(15, 300)) as response:
                response.raise_for_status()
                with temporary.open("wb") as handle:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
            if _md5(temporary) != self.spec.md5:
                raise MattingModelError("BiRefNet 模型校验失败，请稍后重试")
            os.replace(str(temporary), str(target))
        except MattingModelError:
            raise
        except Exception as exc:
            raise MattingModelError(f"BiRefNet 模型下载失败：{exc}") from exc
        finally:
            if temporary.exists():
                temporary.unlink()
        return target

    def _ensure_session(self):
        if self._session is not None:
            return self._session
        with self._session_lock:
            if self._session is not None:
                return self._session
            self._load_dependencies()
            model_path = self._ensure_model()
            options = self._ort.SessionOptions()
            options.intra_op_num_threads = self.cpu_threads
            options.inter_op_num_threads = 1
            options.execution_mode = self._ort.ExecutionMode.ORT_SEQUENTIAL
            options.graph_optimization_level = (
                self._ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            )
            options.enable_cpu_mem_arena = False
            self._session = self._ort.InferenceSession(
                str(model_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        return self._session

    def _predict_mask(self, image: Image.Image) -> Image.Image:
        session = self._ensure_session()
        np = self._np
        resampling = getattr(Image, "Resampling", Image)
        resized = image.convert("RGB").resize((1024, 1024), resampling.LANCZOS)
        array = np.asarray(resized, dtype=np.float32)
        array = array / max(float(np.max(array)), 1e-6)
        mean = np.asarray((0.485, 0.456, 0.406), dtype=np.float32)
        std = np.asarray((0.229, 0.224, 0.225), dtype=np.float32)
        tensor = ((array - mean) / std).transpose((2, 0, 1))[None, ...]
        input_name = session.get_inputs()[0].name
        logits = session.run(None, {input_name: tensor})[0][:, 0, :, :]
        prediction = 1.0 / (1.0 + np.exp(-np.clip(logits, -30.0, 30.0)))
        prediction = np.squeeze(prediction)
        low = float(np.min(prediction))
        high = float(np.max(prediction))
        if high > low:
            prediction = (prediction - low) / (high - low)
        mask = Image.fromarray((prediction * 255.0).astype("uint8"), mode="L")
        return mask.resize(image.size, resampling.LANCZOS)

    def _refine(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        np = self._np
        resampling = getattr(Image, "Resampling", Image)
        work_size = _scaled_size(image.size, self.refine_max_pixels)
        work_image = (
            image.resize(work_size, resampling.LANCZOS)
            if work_size != image.size
            else image.copy()
        ).convert("RGB")
        work_mask = (
            mask.resize(work_size, resampling.LANCZOS)
            if work_size != mask.size
            else mask.copy()
        )
        rgb = np.asarray(work_image, dtype=np.float64) / 255.0
        mask_array = np.asarray(work_mask, dtype=np.uint8)
        structure_size = _positive_int(os.getenv("MATTING_ERODE_SIZE", "10"), 10, maximum=40)
        structure = np.ones((structure_size, structure_size), dtype=np.uint8)
        foreground = self._binary_erosion(mask_array > 240, structure=structure)
        background = self._binary_erosion(
            mask_array < 10,
            structure=structure,
            border_value=1,
        )
        trimap = np.full(mask_array.shape, 0.5, dtype=np.float64)
        trimap[foreground] = 1.0
        trimap[background] = 0.0

        # Closed-form matting needs at least one known foreground and background
        # region. Difficult masks fall back to the already soft BiRefNet alpha.
        if not foreground.any() or not background.any():
            return self._apply_alpha(image, mask)
        try:
            alpha = np.clip(self._estimate_alpha_cf(rgb, trimap), 0.0, 1.0)
            estimated_foreground = np.clip(
                self._estimate_foreground_ml(rgb, alpha),
                0.0,
                1.0,
            )
        except (ValueError, ArithmeticError):
            return self._apply_alpha(image, mask)

        alpha_image = Image.fromarray((alpha * 255.0).astype("uint8"), mode="L")
        if work_size == image.size:
            rgba = np.dstack((estimated_foreground, alpha))
            return Image.fromarray((rgba * 255.0).astype("uint8"), mode="RGBA")

        # For very large inputs, refine alpha at a safe size but retain the
        # original-resolution RGB detail instead of upscaling a softened RGB
        # foreground estimate.
        alpha_image = alpha_image.resize(image.size, resampling.LANCZOS)
        return self._apply_alpha(image, alpha_image)

    @staticmethod
    def _apply_alpha(image: Image.Image, alpha: Image.Image) -> Image.Image:
        rgba = image.convert("RGBA")
        if image.mode == "RGBA":
            # Re-matting an already transparent PNG must never resurrect pixels.
            original_alpha = image.getchannel("A")
            try:
                import PIL.ImageChops as ImageChops

                alpha = ImageChops.darker(alpha, original_alpha)
            except Exception:
                pass
        rgba.putalpha(alpha)
        return rgba

    def remove_background(self, source_path: str, output_path: str) -> Dict[str, Any]:
        with Image.open(source_path) as opened:
            if opened.width * opened.height > self.max_source_pixels:
                raise ValueError(
                    f"图片过大（{opened.width}×{opened.height}），"
                    f"当前上限约 {self.max_source_pixels // 1_000_000} 百万像素"
                )
            image = ImageOps.exif_transpose(opened)
            image.load()
            original_size = image.size
            mask = self._predict_mask(image)
            with self._refine_lock:
                result = self._refine(image, mask)

        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{target.stem}-",
            suffix=".png",
            dir=str(target.parent),
        )
        os.close(file_descriptor)
        temporary = Path(temporary_name)
        try:
            result.save(str(temporary), "PNG", optimize=False, compress_level=4)
            os.replace(str(temporary), str(target))
        finally:
            if temporary.exists():
                temporary.unlink()
        return {
            "width": original_size[0],
            "height": original_size[1],
            "model": self.spec.name,
            "refined": True,
        }
