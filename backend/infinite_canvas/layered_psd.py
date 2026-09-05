"""Build an editable PSD from one persisted Layer Decomposition Node."""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from PIL import Image, UnidentifiedImageError


PSD_MAX_DIMENSION = 30_000
PSD_MAX_LAYERS = 17  # one composite base plus at most sixteen generated layers
PSD_MAX_CANVAS_PIXELS = 64_000_000
PSD_MAX_LAYER_PIXELS = 128_000_000


class LayeredPsdError(ValueError):
    """A stable, non-sensitive PSD export failure."""

    def __init__(self, code: str) -> None:
        self.code = str(code or "export_failed")
        super().__init__(self.code)


@dataclass(frozen=True)
class LayeredPsdResult:
    content: bytes
    filename: str


@dataclass(frozen=True)
class _Layer:
    name: str
    bounds: tuple[int, int, int, int]
    z_index: int
    hidden: bool
    image: Image.Image


def _pack_u16(value: int) -> bytes:
    return struct.pack(">H", value)


def _pack_i16(value: int) -> bytes:
    return struct.pack(">h", value)


def _pack_u32(value: int) -> bytes:
    return struct.pack(">I", value)


def _pack_i32(value: int) -> bytes:
    return struct.pack(">i", value)


def _integer(value: Any, *, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise LayeredPsdError("node_invalid")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise LayeredPsdError("node_invalid") from exc
    try:
        if float(value) != result:
            raise LayeredPsdError("node_invalid")
    except (TypeError, ValueError, OverflowError) as exc:
        raise LayeredPsdError("node_invalid") from exc
    if result < minimum or result > maximum:
        raise LayeredPsdError("node_invalid")
    return result


def _filename(title: Any) -> str:
    name = str(title or "").strip()
    if name.lower().endswith(".psd"):
        name = name[:-4]
    name = re.sub(r'[\\/:*?"<>|]+', "-", name)
    name = re.sub(r"\s+", "-", name)
    name = re.sub(r"-+", "-", name).strip(" .-")
    return f"{(name[:80] or 'layered-export')}.psd"


def _open_media(
    media: Mapping[str, Any],
    *,
    resolve_media: Callable[[str], Any],
    require_alpha: bool,
) -> Image.Image:
    url = str(media.get("url") or media.get("output_media_id") or "").strip()
    if not url:
        raise LayeredPsdError("media_unavailable")
    try:
        resolved = resolve_media(url)
    except OSError:
        raise
    except Exception as exc:
        raise LayeredPsdError("media_unavailable") from exc
    if not resolved:
        raise LayeredPsdError("media_unavailable")
    path = Path(resolved)
    if not path.is_file():
        raise LayeredPsdError("media_unavailable")
    try:
        with Image.open(path) as source:
            source.load()
            if require_alpha and not (
                source.mode in {"RGBA", "LA"}
                or (source.mode == "P" and "transparency" in source.info)
            ):
                raise LayeredPsdError("media_invalid")
            return source.convert("RGBA")
    except LayeredPsdError:
        raise
    except (OSError, ValueError, UnidentifiedImageError) as exc:
        raise LayeredPsdError("media_invalid") from exc


def _extract_layers(
    canvas: Mapping[str, Any],
    node_id: str,
    resolve_media: Callable[[str], Any],
) -> tuple[Mapping[str, Any], int, int, list[_Layer]]:
    nodes = canvas.get("nodes")
    if not isinstance(nodes, list):
        raise LayeredPsdError("node_not_found")
    node = next(
        (
            item
            for item in nodes
            if isinstance(item, Mapping) and str(item.get("id") or "") == str(node_id or "")
        ),
        None,
    )
    if (
        not isinstance(node, Mapping)
        or node.get("type") != "smart-layer-decomposition"
        or not isinstance(node.get("layerDecompositionManifest"), Mapping)
    ):
        raise LayeredPsdError("node_not_found")
    manifest = node["layerDecompositionManifest"]
    if _integer(manifest.get("manifest_version"), minimum=1, maximum=1) != 1:
        raise LayeredPsdError("node_invalid")
    width = _integer(manifest.get("canvas_width"), minimum=1, maximum=PSD_MAX_DIMENSION)
    height = _integer(manifest.get("canvas_height"), minimum=1, maximum=PSD_MAX_DIMENSION)
    if width * height > PSD_MAX_CANVAS_PIXELS:
        raise LayeredPsdError("node_invalid")
    raw_items = node.get("layerDecompositionItems")
    if (
        not isinstance(raw_items, list)
        or not raw_items
        or len(raw_items) > PSD_MAX_LAYERS
        or not all(isinstance(item, Mapping) for item in raw_items)
    ):
        raise LayeredPsdError("node_invalid")
    layers: list[_Layer] = []
    base_count = 0
    layer_pixels = 0
    for position, item in enumerate(raw_items):
        role = str(item.get("role") or "").strip().lower()
        if role not in {"base", "layer"}:
            raise LayeredPsdError("node_invalid")
        if role == "base":
            base_count += 1
        raw_bounds = item.get("absolute_bbox")
        if not isinstance(raw_bounds, list) or len(raw_bounds) != 4:
            raise LayeredPsdError("node_invalid")
        left, top, right, bottom = (
            _integer(raw_bounds[0], minimum=0, maximum=width),
            _integer(raw_bounds[1], minimum=0, maximum=height),
            _integer(raw_bounds[2], minimum=0, maximum=width),
            _integer(raw_bounds[3], minimum=0, maximum=height),
        )
        if right <= left or bottom <= top:
            raise LayeredPsdError("node_invalid")
        layer_pixels += (right - left) * (bottom - top)
        if layer_pixels > PSD_MAX_LAYER_PIXELS:
            raise LayeredPsdError("node_invalid")
        if role == "base" and (left, top, right, bottom) != (0, 0, width, height):
            raise LayeredPsdError("node_invalid")
        media = item.get("media")
        if not isinstance(media, Mapping):
            raise LayeredPsdError("media_unavailable")
        image = _open_media(media, resolve_media=resolve_media, require_alpha=role == "layer")
        target_size = (right - left, bottom - top)
        if image.size != target_size:
            image = image.resize(target_size, Image.Resampling.LANCZOS)
        name = str(
            item.get("name")
            or media.get("name")
            or ("Composite base" if role == "base" else f"Layer {position}")
        ).strip()
        layers.append(
            _Layer(
                name=name[:255] or ("Composite base" if role == "base" else f"Layer {position}"),
                bounds=(left, top, right, bottom),
                z_index=_integer(item.get("z_index", position), minimum=-32_768, maximum=32_767),
                hidden=bool(item.get("hidden", False)),
                image=image,
            )
        )
    if base_count != 1:
        raise LayeredPsdError("node_invalid")
    return node, width, height, layers


def _packbits(row: bytes) -> bytes:
    output = bytearray()
    index = 0
    size = len(row)
    while index < size:
        run = 1
        while index + run < size and run < 128 and row[index + run] == row[index]:
            run += 1
        if run >= 3:
            output.append(257 - run)
            output.append(row[index])
            index += run
            continue
        literal_start = index
        index += run
        while index < size and index - literal_start < 128:
            next_run = 1
            while (
                index + next_run < size
                and next_run < 128
                and row[index + next_run] == row[index]
            ):
                next_run += 1
            if next_run >= 3:
                break
            # A two-byte run may straddle the literal packet's 128-byte limit.
            # Leave the excess for the next packet; 0x80 is a no-op, not 129 literals.
            index += min(next_run, 128 - (index - literal_start))
        literal = row[literal_start:index]
        output.append(len(literal) - 1)
        output.extend(literal)
    return bytes(output)


def _channel_rows(channel: Image.Image) -> tuple[list[int], list[bytes]]:
    width, height = channel.size
    pixels = channel.tobytes()
    packed = [_packbits(pixels[row * width : (row + 1) * width]) for row in range(height)]
    lengths = [len(row) for row in packed]
    if any(length > 65_535 for length in lengths):
        raise LayeredPsdError("export_failed")
    return lengths, packed


def _layer_channel_data(image: Image.Image) -> list[tuple[int, bytes]]:
    result = []
    for channel_id, channel in zip((0, 1, 2, -1), image.split()):
        lengths, rows = _channel_rows(channel)
        data = b"\x00\x01" + b"".join(_pack_u16(length) for length in lengths) + b"".join(rows)
        result.append((channel_id, data))
    return result


def _pascal_name(name: str) -> bytes:
    encoded = name.encode("macroman", errors="replace")[:255]
    data = bytes((len(encoded),)) + encoded
    return data + b"\x00" * ((4 - len(data) % 4) % 4)


def _unicode_name(name: str) -> bytes:
    encoded = name.encode("utf-16-be")
    payload = _pack_u32(len(encoded) // 2) + encoded
    block = b"8BIMluni" + _pack_u32(len(payload)) + payload
    return block + b"\x00" * (len(payload) % 2)


def _layer_record(layer: _Layer, channels: list[tuple[int, bytes]]) -> bytes:
    left, top, right, bottom = layer.bounds
    extra = _pack_u32(0) + _pack_u32(0) + _pascal_name(layer.name) + _unicode_name(layer.name)
    flags = 0x02 if layer.hidden else 0
    return b"".join(
        (
            _pack_i32(top),
            _pack_i32(left),
            _pack_i32(bottom),
            _pack_i32(right),
            _pack_u16(len(channels)),
            b"".join(_pack_i16(channel_id) + _pack_u32(len(data)) for channel_id, data in channels),
            b"8BIMnorm",
            bytes((255, 0, flags, 0)),
            _pack_u32(len(extra)),
            extra,
        )
    )


def _composite(width: int, height: int, layers: list[_Layer]) -> Image.Image:
    result = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for layer in sorted(layers, key=lambda item: item.z_index):
        if layer.hidden:
            continue
        left, top, _right, _bottom = layer.bounds
        result.alpha_composite(layer.image, (left, top))
    return result


def _composite_data(image: Image.Image) -> bytes:
    lengths: list[int] = []
    rows: list[bytes] = []
    for channel in image.split():
        channel_lengths, channel_rows = _channel_rows(channel)
        lengths.extend(channel_lengths)
        rows.extend(channel_rows)
    return b"\x00\x01" + b"".join(_pack_u16(length) for length in lengths) + b"".join(rows)


def _build_psd(width: int, height: int, layers: list[_Layer]) -> bytes:
    ordered = sorted(layers, key=lambda item: item.z_index, reverse=True)
    encoded = [(layer, _layer_channel_data(layer.image)) for layer in ordered]
    records = b"".join(_layer_record(layer, channels) for layer, channels in encoded)
    channel_data = b"".join(data for _layer, channels in encoded for _channel_id, data in channels)
    layer_info = _pack_i16(len(ordered)) + records + channel_data
    if len(layer_info) % 2:
        layer_info += b"\x00"
    layer_and_mask = _pack_u32(len(layer_info)) + layer_info + _pack_u32(0)
    header = b"8BPS" + _pack_u16(1) + b"\x00" * 6 + _pack_u16(4)
    header += _pack_u32(height) + _pack_u32(width) + _pack_u16(8) + _pack_u16(3)
    return b"".join(
        (
            header,
            _pack_u32(0),  # color mode data
            _pack_u32(0),  # image resources
            _pack_u32(len(layer_and_mask)),
            layer_and_mask,
            _composite_data(_composite(width, height, layers)),
        )
    )


def build_layer_decomposition_psd(
    canvas: Mapping[str, Any],
    node_id: str,
    *,
    resolve_media: Callable[[str], Any],
) -> LayeredPsdResult:
    """Return a complete PSD built only from the persisted current node state."""

    try:
        node, width, height, layers = _extract_layers(
            canvas,
            node_id,
            resolve_media,
        )
        content = _build_psd(width, height, layers)
    except LayeredPsdError:
        raise
    except (MemoryError, OSError, OverflowError, struct.error, ValueError) as exc:
        raise LayeredPsdError("export_failed") from exc
    return LayeredPsdResult(content=content, filename=_filename(node.get("title")))


__all__ = [
    "LayeredPsdError",
    "LayeredPsdResult",
    "build_layer_decomposition_psd",
]
