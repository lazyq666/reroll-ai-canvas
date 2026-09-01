"""Materialize provider images to the aspect ratio promised by the product."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from .image_capabilities import (
    ASPECT_RATIO_TOLERANCE,
    aspect_ratio_value,
    relative_aspect_error,
)


@dataclass(frozen=True)
class ImageMaterialization:
    source_path: Path
    output_path: Path
    source_size: tuple[int, int]
    output_size: tuple[int, int]
    target_aspect_ratio: str
    relative_error: float
    cropped: bool


def _cover_box(width: int, height: int, target: float) -> tuple[int, int, int, int]:
    actual = width / height
    if actual > target:
        crop_width = max(1, min(width, round(height * target)))
        left = (width - crop_width) // 2
        return left, 0, left + crop_width, height
    crop_height = max(1, min(height, round(width / target)))
    top = (height - crop_height) // 2
    return 0, top, width, top + crop_height


def materialize_image_cover(
    source_path: str | Path,
    target_aspect_ratio: str,
    output_path: str | Path,
    *,
    tolerance: float = ASPECT_RATIO_TOLERANCE,
) -> ImageMaterialization:
    """Center-crop without stretching or padding and atomically save output."""
    source = Path(source_path)
    destination = Path(output_path)
    target = aspect_ratio_value(target_aspect_ratio)
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        image.load()
        width, height = image.size
        error = relative_aspect_error(width / height, target)
        if error <= float(tolerance) + 1e-12:
            return ImageMaterialization(
                source, source, (width, height), (width, height),
                target_aspect_ratio, error, False,
            )
        cropped = image.crop(_cover_box(width, height, target))
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(
            f".{destination.stem}.{uuid.uuid4().hex}{destination.suffix}"
        )
        save_format = (destination.suffix.lstrip(".") or opened.format or "PNG").upper()
        if save_format == "JPG":
            save_format = "JPEG"
        if save_format == "JPEG" and cropped.mode not in {"RGB", "L"}:
            cropped = cropped.convert("RGB")
        try:
            cropped.save(temporary, format=save_format)
            os.replace(temporary, destination)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return ImageMaterialization(
            source,
            destination,
            (width, height),
            cropped.size,
            target_aspect_ratio,
            error,
            True,
        )
