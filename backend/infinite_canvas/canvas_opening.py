"""Progressive opening projection for one authorized Canvas snapshot."""

from __future__ import annotations

import asyncio
import json
import math
import re
from collections.abc import AsyncIterator, Mapping
from typing import Any


_NODE_GEOMETRY_NUMBERS = (
    "w",
    "h",
    "scale",
    "generationMediaW",
    "generationMediaH",
    "pending",
)
_MEDIA_WIDTH_KEYS = ("natural_w", "width", "w", "layout_w", "preview_w")
_MEDIA_HEIGHT_KEYS = ("natural_h", "height", "h", "layout_h", "preview_h")
_NON_STILL_MEDIA_KINDS = {"audio", "video", "text", "file"}
_GENERATION_OUTPUT_GALLERY_SPLIT_VERSION = 1
_NON_STILL_MEDIA_URL = re.compile(
    r"\.(?:mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac|txt|json|csv|srt|vtt|md)(?:\?|$)",
    re.IGNORECASE,
)


def _finite_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _coordinate(value: object) -> float:
    number = _finite_number(value)
    return number if number is not None else 0.0


def _js_truthy(value: object) -> bool:
    return value not in (None, False, 0, 0.0, "")


def _first_truthy(mapping: Mapping[str, Any], keys: tuple[str, ...]) -> object:
    for key in keys:
        value = mapping.get(key)
        if _js_truthy(value):
            return value
    return None


def _project_media(raw_media: object) -> dict[str, Any]:
    media = raw_media if isinstance(raw_media, Mapping) else {}
    kind = str(media.get("kind") or "")[:40]
    url = str(media.get("url") or "")
    projected: dict[str, Any] = {
        "is_still_image": kind.lower() not in _NON_STILL_MEDIA_KINDS
        and _NON_STILL_MEDIA_URL.search(url) is None,
    }
    if kind:
        projected["kind"] = kind
    width = _finite_number(_first_truthy(media, _MEDIA_WIDTH_KEYS))
    height = _finite_number(_first_truthy(media, _MEDIA_HEIGHT_KEYS))
    if width is not None and width > 0 and height is not None and height > 0:
        projected["natural_w"] = width
        projected["natural_h"] = height
    grid = media.get("grid")
    if isinstance(grid, Mapping) and grid.get("type") == "grid-split":
        projected_grid: dict[str, Any] = {"type": "grid-split"}
        for key in ("cols", "rows"):
            number = _finite_number(grid.get(key))
            if number is not None:
                projected_grid[key] = number
        projected["grid"] = projected_grid
    return projected


def _prompt_has_input_media(node: Mapping[str, Any]) -> bool:
    if node.get("promptHasInputMedia") is True:
        return True
    for key in ("llmInputMedia", "manualInputRefs"):
        items = node.get(key)
        if isinstance(items, list) and any(
            isinstance(item, Mapping) and _js_truthy(item.get("url"))
            for item in items
        ):
            return True
    return False


def _is_legacy_generation_gallery(node: Mapping[str, Any]) -> bool:
    images = node.get("images")
    return (
        node.get("generationOutputNode") is True
        and isinstance(images, list)
        and sum(
            1
            for image in images
            if isinstance(image, Mapping) and _js_truthy(image.get("url"))
        )
        > 1
    )


def _nonnegative_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def canvas_outline(canvas: Mapping[str, Any]) -> dict[str, Any]:
    """Return the presentation-only inputs needed to measure opening Nodes."""

    raw_nodes = canvas.get("nodes")
    migration_versions = canvas.get("migrationVersions")
    gallery_split_complete = (
        isinstance(migration_versions, Mapping)
        and _nonnegative_int(migration_versions.get("generationOutputGallerySplit"))
        >= _GENERATION_OUTPUT_GALLERY_SPLIT_VERSION
    )
    nodes = []
    for raw_node in raw_nodes if isinstance(raw_nodes, list) else []:
        if not isinstance(raw_node, Mapping):
            continue
        node_id = str(raw_node.get("id") or "").strip()
        if not node_id:
            continue
        if not gallery_split_complete and _is_legacy_generation_gallery(raw_node):
            continue
        node_type = str(raw_node.get("type") or "smart-image")[:80]
        projected: dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "x": _coordinate(raw_node.get("x")),
            "y": _coordinate(raw_node.get("y")),
        }
        for key in _NODE_GEOMETRY_NUMBERS:
            number = _finite_number(raw_node.get(key))
            if number is not None:
                projected[key] = number
        if _js_truthy(raw_node.get("queued")):
            projected["queued"] = True
        if node_type == "smart-image":
            raw_images = raw_node.get("images")
            images = raw_images if isinstance(raw_images, list) else []
            projected["images"] = [
                _project_media(image)
                for image in images
            ]
        elif node_type == "smart-prompt":
            projected.update(
                {
                    "llmEnabled": _js_truthy(raw_node.get("llmEnabled")),
                    "promptHasInputMedia": _prompt_has_input_media(raw_node),
                    "promptHasUpstreamText": raw_node.get("promptHasUpstreamText")
                    is True,
                }
            )
        nodes.append(projected)
    return {
        "type": "canvas_outline",
        "canvas_id": str(canvas.get("id") or canvas.get("canvas_id") or ""),
        "revision": _nonnegative_int(canvas.get("revision")),
        "nodes": nodes,
    }


def opening_event_line(event: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


async def stream_canvas_opening(
    canvas: Mapping[str, Any],
) -> AsyncIterator[bytes]:
    """Yield outline before serializing the complete authorized document."""

    yield opening_event_line(canvas_outline(canvas))
    await asyncio.sleep(0)
    yield opening_event_line(
        {
            "type": "canvas_document",
            "canvas": canvas,
        }
    )


__all__ = [
    "canvas_outline",
    "opening_event_line",
    "stream_canvas_opening",
]
