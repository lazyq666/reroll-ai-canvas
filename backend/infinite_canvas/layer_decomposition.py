"""Provider-independent Layer Decomposition parsing and validation.

The module translates APIMart's parallel response arrays into one stable
domain value.  It deliberately contains no HTTP, Canvas, or persistence
logic so provider response handling can be tested without paid requests.
"""

from __future__ import annotations

import json
import hashlib
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from PIL import Image, UnidentifiedImageError


MANIFEST_VERSION = 1
MAX_LAYERS = 16
PROVIDER_METADATA_MAX_BYTES = 8 * 1024
_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|authorization|cookie|credential|password|secret|signature|token)",
    re.IGNORECASE,
)


class LayerDecompositionError(ValueError):
    """A response or downloaded layer cannot satisfy the stable contract."""

    def __init__(self, code: str, detail: str):
        self.code = str(code)
        self.detail = str(detail)
        super().__init__(self.detail)


@dataclass(frozen=True)
class ProviderImage:
    url: str
    width: int
    height: int
    output_format: str

    def source(self) -> dict[str, str]:
        return {"type": "url", "value": self.url}


@dataclass(frozen=True)
class ProviderLayer(ProviderImage):
    name: str
    description: str
    z_index: int
    absolute_bbox: tuple[int, int, int, int]
    normalized_bbox: tuple[int, int, int, int]
    source_index: int


@dataclass(frozen=True)
class ParsedLayerDecomposition:
    upstream_task_id: str
    canvas_width: int
    canvas_height: int
    base: ProviderImage
    layers: tuple[ProviderLayer, ...]
    raw_metadata: Mapping[str, Any]


@dataclass(frozen=True)
class LayerImageInspection:
    width: int
    height: int
    output_format: str
    has_alpha: bool
    sha256: str


def _size(value: Any, *, code: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*", str(value or ""))
    if not match:
        raise LayerDecompositionError(code, f"Invalid image size: {value}")
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        raise LayerDecompositionError(code, f"Invalid image size: {value}")
    return width, height


def _bbox(
    value: Any,
    *,
    coordinate_space: str,
    maximum: tuple[int, int],
) -> tuple[int, int, int, int]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != 4:
        raise LayerDecompositionError(
            "bbox_shape", f"{coordinate_space} bbox must contain four coordinates"
        )
    try:
        left, top, right, bottom = tuple(int(item) for item in value)
    except (TypeError, ValueError) as exc:
        raise LayerDecompositionError(
            "bbox_shape", f"{coordinate_space} bbox contains a non-integer coordinate"
        ) from exc
    if min(left, top, right, bottom) < 0:
        raise LayerDecompositionError(
            "bbox_negative", f"{coordinate_space} bbox contains a negative coordinate"
        )
    if right <= left or bottom <= top:
        raise LayerDecompositionError(
            "bbox_reversed", f"{coordinate_space} bbox has reversed or empty bounds"
        )
    max_width, max_height = maximum
    if right > max_width or bottom > max_height:
        raise LayerDecompositionError(
            "bbox_out_of_bounds", f"{coordinate_space} bbox exceeds its coordinate space"
        )
    return left, top, right, bottom


def _task_payload(raw: Mapping[str, Any]) -> Mapping[str, Any]:
    current: Mapping[str, Any] = raw
    data = current.get("data")
    if isinstance(data, Mapping):
        current = data
    result = current.get("result")
    if not isinstance(result, Mapping):
        raise LayerDecompositionError(
            "response_shape", "Layer decomposition response has no result object"
        )
    images = result.get("images")
    if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], Mapping):
        raise LayerDecompositionError(
            "response_shape", "Layer decomposition response must contain one image record"
        )
    return images[0]


def _task_id(raw: Mapping[str, Any]) -> str:
    candidates: list[Any] = [raw.get("id"), raw.get("task_id"), raw.get("taskId")]
    data = raw.get("data")
    if isinstance(data, Mapping):
        candidates.extend((data.get("id"), data.get("task_id"), data.get("taskId")))
    return next((str(value).strip() for value in candidates if str(value or "").strip()), "")


def parse_apimart_layer_decomposition(
    raw: Mapping[str, Any],
) -> ParsedLayerDecomposition:
    """Translate the documented APIMart response without repairing bad data."""

    if not isinstance(raw, Mapping):
        raise LayerDecompositionError("response_shape", "Provider response must be an object")
    record = _task_payload(raw)
    if record.get("layer_decomposition") is not True:
        raise LayerDecompositionError(
            "response_shape", "Provider response is not a layer decomposition result"
        )
    urls = record.get("url")
    sizes = record.get("sizes")
    formats = record.get("output_formats")
    layers = record.get("layers")
    arrays = (urls, sizes, formats, layers)
    if not all(isinstance(value, list) for value in arrays):
        raise LayerDecompositionError(
            "parallel_arrays", "Provider response arrays are missing"
        )
    lengths = {len(value) for value in arrays}
    if len(lengths) != 1 or not urls:
        raise LayerDecompositionError(
            "parallel_arrays", "Provider response arrays do not align by index"
        )
    layer_count = len(urls) - 1
    if layer_count < 1 or layer_count > MAX_LAYERS:
        raise LayerDecompositionError(
            "layer_count", f"Layer count must be between 1 and {MAX_LAYERS}"
        )
    clean_urls = [str(value or "").strip() for value in urls]
    if any(not value for value in clean_urls):
        raise LayerDecompositionError("media_url", "Provider returned an empty media URL")
    if len(set(clean_urls)) != len(clean_urls):
        raise LayerDecompositionError("duplicate_media", "Provider returned duplicate media")

    canvas_width, canvas_height = _size(sizes[0], code="base_dimensions")
    base_format = str(formats[0] or "").strip().lower()
    base_metadata = layers[0]
    if not isinstance(base_metadata, Mapping):
        raise LayerDecompositionError("base_metadata", "Base metadata must be an object")
    try:
        base_z_index = int(base_metadata.get("z_index"))
    except (TypeError, ValueError) as exc:
        raise LayerDecompositionError("base_metadata", "Base z-index is invalid") from exc
    metadata_base_size = _size(
        base_metadata.get("size") or sizes[0], code="base_metadata"
    )
    metadata_base_format = str(
        base_metadata.get("output_format") or base_format
    ).strip().lower()
    if (
        base_z_index != 0
        or metadata_base_size != (canvas_width, canvas_height)
        or metadata_base_format != base_format
    ):
        raise LayerDecompositionError("base_metadata", "Base metadata does not align")
    if base_format != "png":
        raise LayerDecompositionError("base_format", "Base image must be PNG")
    base = ProviderImage(
        url=clean_urls[0],
        width=canvas_width,
        height=canvas_height,
        output_format="jpeg" if base_format == "jpg" else base_format,
    )

    parsed_layers: list[ProviderLayer] = []
    seen_z: set[int] = {base_z_index}
    previous_z: int | None = base_z_index
    for index in range(1, len(urls)):
        metadata = layers[index]
        if not isinstance(metadata, Mapping):
            raise LayerDecompositionError("layer_metadata", "Layer metadata must be an object")
        try:
            z_index = int(metadata.get("z_index"))
        except (TypeError, ValueError) as exc:
            raise LayerDecompositionError("z_index", "Layer z-index is invalid") from exc
        if z_index in seen_z:
            raise LayerDecompositionError(
                "duplicate_z_index", f"Duplicate layer z-index: {z_index}"
            )
        if previous_z is not None and z_index < previous_z:
            raise LayerDecompositionError(
                "z_index_order", "Provider layer order does not follow ascending z-index"
            )
        seen_z.add(z_index)
        previous_z = z_index
        layer_format = str(formats[index] or "").strip().lower()
        metadata_format = str(metadata.get("output_format") or layer_format).strip().lower()
        if layer_format != "png" or metadata_format != "png":
            raise LayerDecompositionError("layer_format", "Every decomposed layer must be PNG")
        width, height = _size(sizes[index], code="layer_dimensions")
        metadata_width, metadata_height = _size(
            metadata.get("size") or sizes[index], code="layer_dimensions"
        )
        if (width, height) != (metadata_width, metadata_height):
            raise LayerDecompositionError(
                "layer_dimensions", "Layer size arrays disagree with metadata"
            )
        bounding_box = metadata.get("bounding_box")
        if not isinstance(bounding_box, Mapping):
            raise LayerDecompositionError("bbox_shape", "Layer bounding box is missing")
        absolute = _bbox(
            bounding_box.get("absolute"),
            coordinate_space="absolute",
            maximum=(canvas_width, canvas_height),
        )
        normalized = _bbox(
            bounding_box.get("normalized"),
            coordinate_space="normalized",
            maximum=(1000, 1000),
        )
        expected_normalized = (
            absolute[0] / canvas_width * 1000,
            absolute[1] / canvas_height * 1000,
            absolute[2] / canvas_width * 1000,
            absolute[3] / canvas_height * 1000,
        )
        if any(
            abs(actual - expected) > 2
            for actual, expected in zip(normalized, expected_normalized)
        ):
            raise LayerDecompositionError(
                "bbox_inconsistent",
                "Absolute and normalized bounding boxes disagree",
            )
        parsed_layers.append(
            ProviderLayer(
                url=clean_urls[index],
                width=width,
                height=height,
                output_format="png",
                name=str(metadata.get("name") or f"Layer {index}")[:240],
                description=str(metadata.get("description") or "")[:2000],
                z_index=z_index,
                absolute_bbox=absolute,
                normalized_bbox=normalized,
                source_index=index,
            )
        )
    return ParsedLayerDecomposition(
        upstream_task_id=_task_id(raw),
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        base=base,
        layers=tuple(parsed_layers),
        raw_metadata=sanitize_provider_metadata(raw),
    )


def layer_decomposition_mapping(
    value: ParsedLayerDecomposition,
) -> dict[str, Any]:
    """Serialize a parsed result for durable Generation Run storage."""

    return {
        "kind": "image_layer_decomposition",
        "upstream_task_id": value.upstream_task_id,
        "canvas_width": value.canvas_width,
        "canvas_height": value.canvas_height,
        "base": {
            "url": value.base.url,
            "width": value.base.width,
            "height": value.base.height,
            "output_format": value.base.output_format,
        },
        "layers": [
            {
                "url": layer.url,
                "width": layer.width,
                "height": layer.height,
                "output_format": layer.output_format,
                "name": layer.name,
                "description": layer.description,
                "z_index": layer.z_index,
                "absolute_bbox": list(layer.absolute_bbox),
                "normalized_bbox": list(layer.normalized_bbox),
                "source_index": layer.source_index,
            }
            for layer in value.layers
        ],
        "provider_raw_metadata": dict(value.raw_metadata),
    }


def inspect_layer_image(
    path: str | Path,
    *,
    expected_width: int,
    expected_height: int,
) -> LayerImageInspection:
    """Verify the downloaded file rather than trusting response metadata."""

    try:
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            output_format = str(image.format or "").upper()
            has_alpha = "A" in image.getbands()
            if output_format != "PNG":
                raise LayerDecompositionError("layer_mime", "Layer content is not PNG")
            if (width, height) != (int(expected_width), int(expected_height)):
                raise LayerDecompositionError(
                    "layer_dimensions", "Downloaded layer dimensions do not match metadata"
                )
            if not has_alpha:
                raise LayerDecompositionError("alpha_required", "Layer PNG has no alpha channel")
            alpha = image.getchannel("A")
            if alpha.getbbox() is None:
                raise LayerDecompositionError("empty_layer", "Layer alpha channel is empty")
            if alpha.getextrema()[0] >= 255:
                raise LayerDecompositionError(
                    "alpha_transparency_required",
                    "Layer PNG has no transparent pixels",
                )
            digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
            return LayerImageInspection(width, height, "png", True, digest)
    except LayerDecompositionError:
        raise
    except (OSError, UnidentifiedImageError, ValueError) as exc:
        raise LayerDecompositionError("corrupt_image", "Layer image is corrupt") from exc


def inspect_base_image(
    path: str | Path,
    *,
    expected_width: int,
    expected_height: int,
) -> LayerImageInspection:
    """Verify that the materialized base is the requested PNG and dimensions."""

    try:
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            if str(image.format or "").upper() != "PNG":
                raise LayerDecompositionError("base_mime", "Base image content is not PNG")
            if (width, height) != (int(expected_width), int(expected_height)):
                raise LayerDecompositionError(
                    "base_dimensions", "Downloaded base dimensions do not match metadata"
                )
            return LayerImageInspection(
                width=width,
                height=height,
                output_format="png",
                has_alpha="A" in image.getbands(),
                sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            )
    except LayerDecompositionError:
        raise
    except (OSError, UnidentifiedImageError, ValueError) as exc:
        raise LayerDecompositionError("corrupt_image", "Base image is corrupt") from exc


def _safe_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        return value[:1000]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))[:1000]


def _sanitize(value: Any, *, depth: int = 0) -> Any:
    if depth > 6:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        text = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", value)
        return _safe_url(text) if text.startswith(("http://", "https://")) else text[:2000]
    if isinstance(value, Mapping):
        return {
            str(key)[:120]: (
                "[redacted]" if _SENSITIVE_KEY.search(str(key)) else _sanitize(item, depth=depth + 1)
            )
            for key, item in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize(item, depth=depth + 1) for item in value[:100]]
    return str(value)[:1000]


def sanitize_provider_metadata(
    raw: Any,
    *,
    max_bytes: int = PROVIDER_METADATA_MAX_BYTES,
) -> Mapping[str, Any]:
    """Return a secret-free, bounded diagnostic snapshot."""

    limit = max(128, int(max_bytes))
    safe = _sanitize(raw)
    if not isinstance(safe, Mapping):
        safe = {"value": safe}
    encoded = json.dumps(safe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= limit:
        return safe
    summary: dict[str, Any] = {"truncated": True}
    if isinstance(safe, Mapping):
        for key in ("id", "task_id", "taskId", "status", "code", "progress"):
            if key in safe:
                summary[key] = safe[key]
    encoded = json.dumps(summary, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= limit:
        return summary
    return {"truncated": True}


__all__ = [
    "LayerDecompositionError",
    "LayerImageInspection",
    "MANIFEST_VERSION",
    "MAX_LAYERS",
    "ParsedLayerDecomposition",
    "ProviderImage",
    "ProviderLayer",
    "inspect_layer_image",
    "inspect_base_image",
    "layer_decomposition_mapping",
    "parse_apimart_layer_decomposition",
    "sanitize_provider_metadata",
]
