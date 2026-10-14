"""Exact image-size contract. UI rounding never substitutes for request validation."""

from __future__ import annotations

import re
from collections.abc import Mapping


CUSTOM_IMAGE_DIMENSIONS = {
    "multiple": 16,
    "maximum_edge": 3840,
    "maximum_aspect": 3,
    "minimum_pixels": 655360,
    "maximum_pixels": 8294400,
}


def custom_size_parameter() -> dict:
    return {"type": "string", "required": False, "dimensions": dict(CUSTOM_IMAGE_DIMENSIONS)}


def validate_custom_image_size(value: object, limits: Mapping | None = None) -> str:
    """Return a localized error code, or an empty string. Never round on the server."""
    limits = limits or CUSTOM_IMAGE_DIMENSIONS
    match = re.fullmatch(r"([0-9]{1,5})x([0-9]{1,5})", value) if isinstance(value, str) else None
    if not match:
        return "custom_size_integer"
    width, height = map(int, match.groups())
    if min(width, height) <= 0:
        return "custom_size_positive"
    if max(width, height) > limits["maximum_edge"]:
        return "custom_size_edge"
    if width % limits["multiple"] or height % limits["multiple"]:
        return "custom_size_multiple"
    if max(width, height) > min(width, height) * limits["maximum_aspect"]:
        return "custom_size_aspect"
    if width * height < limits["minimum_pixels"]:
        return "custom_size_minimum_pixels"
    if width * height > limits["maximum_pixels"]:
        return "custom_size_maximum_pixels"
    return ""
