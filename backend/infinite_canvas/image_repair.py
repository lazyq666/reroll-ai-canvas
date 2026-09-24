"""Local repair geometry and compositing in original-image pixels.

The source and generated patch remain immutable Managed Media. A recipe is
stored on the resulting image, so a later adjustment never resamples a prior
composite. Feathering affects alpha only, using the same edge-distance ramp
as the browser preview.
"""
from __future__ import annotations

import copy
import math
from collections.abc import Mapping
from typing import Any, Callable

from PIL import Image, ImageChops, ImageOps

MAX_DIMENSION = 30000
MAX_PIXELS = 40_000_000


class ImageRepairError(ValueError):
    pass


def _number(value: Any, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ImageRepairError("repair_invalid")
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ImageRepairError("repair_invalid")
    return float(value)


def _media(value: Any) -> dict:
    if not isinstance(value, Mapping):
        raise ImageRepairError("repair_media_missing")
    url = str(value.get("url") or "")
    if not url.startswith(("/assets/", "/api/storage-files/")):
        raise ImageRepairError("repair_media_missing")
    return {key: value[key] for key in ("url", "media_id", "output_media_id", "name", "natural_w", "natural_h") if key in value}


def validate_recipe(value: Any, *, require_patch: bool = True) -> dict:
    if not isinstance(value, Mapping) or value.get("version") != 1:
        raise ImageRepairError("repair_invalid")
    width = int(_number(value.get("width"), 1, MAX_DIMENSION))
    height = int(_number(value.get("height"), 1, MAX_DIMENSION))
    if width * height > MAX_PIXELS:
        raise ImageRepairError("repair_too_large")
    result = {"version": 1, "width": width, "height": height, "source": _media(value.get("source"))}
    for name in ("crop", "transform"):
        box = value.get(name)
        if not isinstance(box, Mapping):
            raise ImageRepairError("repair_invalid")
        box = {
            "x": round(_number(box.get("x"), -MAX_DIMENSION, MAX_DIMENSION)),
            "y": round(_number(box.get("y"), -MAX_DIMENSION, MAX_DIMENSION)),
            "width": max(1, round(_number(box.get("width"), 1, MAX_DIMENSION))),
            "height": max(1, round(_number(box.get("height"), 1, MAX_DIMENSION))),
        }
        if box["width"] * box["height"] > MAX_PIXELS:
            raise ImageRepairError("repair_too_large")
        if box["x"] >= width or box["y"] >= height or box["x"] + box["width"] <= 0 or box["y"] + box["height"] <= 0:
            raise ImageRepairError("repair_invalid")
        result[name] = box
    result["feather"] = _number(value.get("feather", 0), 0, min(result["transform"]["width"], result["transform"]["height"]) / 2)
    if require_patch:
        result["patch"] = _media(value.get("patch"))
    return result


def open_media(media: dict, resolve_media: Callable) -> Image.Image:
    try:
        path = resolve_media(media["url"])
        if not path:
            raise ImageRepairError("repair_media_missing")
        with Image.open(path) as image:
            if image.width * image.height > MAX_PIXELS or max(image.size) > MAX_DIMENSION:
                raise ImageRepairError("repair_too_large")
            return ImageOps.exif_transpose(image).convert("RGBA")
    except ImageRepairError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ImageRepairError("repair_media_missing") from exc


def feather_alpha(image: Image.Image, feather: float) -> Image.Image:
    if feather <= 0:
        return image
    width, height = image.size
    def ramp(length):
        return bytes(max(0, min(255, int(min(i + .5, length - i - .5) / feather * 255 + .5))) for i in range(length))
    horizontal = Image.frombytes("L", (width, 1), ramp(width)).resize((width, height))
    vertical = Image.frombytes("L", (1, height), ramp(height)).resize((width, height))
    edge = ImageChops.darker(horizontal, vertical)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), edge))
    return image


def repair_layers(value: Any, resolve_media: Callable) -> tuple[dict, Image.Image, Image.Image, tuple[int, int, int, int]]:
    recipe = validate_recipe(value)
    source = open_media(recipe["source"], resolve_media)
    if source.size != (recipe["width"], recipe["height"]):
        raise ImageRepairError("repair_source_changed")
    box = recipe["transform"]
    patch = open_media(recipe["patch"], resolve_media)
    # Keep the generated image proportional. Model-output rounding is handled
    # by a centered cover; no nonuniform stretching is introduced here.
    patch = ImageOps.fit(patch, (box["width"], box["height"]), method=Image.Resampling.LANCZOS)
    patch = feather_alpha(patch, recipe["feather"])
    left, top = max(0, box["x"]), max(0, box["y"])
    right, bottom = min(source.width, box["x"] + box["width"]), min(source.height, box["y"] + box["height"])
    patch = patch.crop((left - box["x"], top - box["y"], right - box["x"], bottom - box["y"]))
    return recipe, source, patch, (left, top, right, bottom)


def compose_repair(value: Any, resolve_media: Callable) -> tuple[Image.Image, dict]:
    recipe, source, patch, bounds = repair_layers(value, resolve_media)
    source.alpha_composite(patch, bounds[:2])
    return source, copy.deepcopy(recipe)
