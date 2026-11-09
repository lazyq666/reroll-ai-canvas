"""Format-specific image contracts shared by catalog validation and transport."""

import re


APIMART_QUALITY_MODELS = frozenset({
    "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
    "gpt-image-2.6-flare", "gpt-image-2.6-sunburst",
})
APIMART_FORMAT_MODELS = frozenset({
    "gpt-image-2.6-flare", "gpt-image-2.6-sunburst",
})
IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"]
IMAGE_FORMATS = ["png", "jpeg", "webp", "gif", "svg"]


def format_parameters(formats, svg_model=""):
    return {
        "output_format": {"type": "enum", "values": list(formats), "default": "png", "visible": True},
        "output_compression": {"type": "integer", "minimum": 0, "maximum": 100},
        "frame_size": {"type": "string", "default": "512x512"},
        "frame_count": {"type": "integer", "minimum": 2, "maximum": 16, "default": 9},
        "frame_duration_ms": {"type": "integer", "minimum": 20, "default": 200},
        "svg_model": {"type": "string", "default": svg_model},
    }


def validate_image_format(capability, parameters, image_count=0):
    errors = []
    output_format = parameters.get("output_format") or capability.get("parameters", {}).get("output_format", {}).get("default")
    if not output_format:
        return errors

    def reject(field, code="image_format_conflict"):
        errors.append({"code": code, "field": field, "format": output_format})

    if parameters.get("transparent_png") and output_format not in {"png", "webp"}:
        reject("transparent_png")
    if "output_compression" in parameters and output_format not in {"jpeg", "webp"}:
        reject("output_compression")
    if output_format != "gif":
        for field in ("frame_size", "frame_count", "frame_duration_ms"):
            if field in parameters:
                reject(field)
    if output_format != "svg" and "svg_model" in parameters:
        reject("svg_model")
    if output_format == "svg":
        if image_count:
            reject("image")
        if parameters.get("count", 1) != 1:
            reject("count")
        if not str(parameters.get("svg_model") or "").strip():
            reject("svg_model", "svg_model_required")
    if output_format == "gif":
        if image_count > 16:
            reject("image")
        if parameters.get("count", 1) not in (1, 2, 3, 4):
            reject("count")
        for field in ("aspect_ratio", "resolution_tier", "custom_size"):
            if field in parameters:
                reject(field)
        frames = parameters.get("frame_count", 9)
        duration = parameters.get("frame_duration_ms", 200)
        if isinstance(duration, int) and duration % 10:
            reject("frame_duration_ms")
        size = parameters.get("frame_size", "512x512")
        match = re.fullmatch(r"([0-9]{1,5})x([0-9]{1,5})", str(size))
        valid_size = False
        if match and isinstance(frames, int) and 2 <= frames <= 16:
            width, height = map(int, match.groups())
            columns, rows = (4, 2) if frames <= 8 else (3, 3) if frames == 9 else (4, 3) if frames <= 12 else (4, 4)
            if width > 0 and height > 0 and width % 16 == height % 16 == 0:
                for columns, rows in ((columns, rows), (rows, columns)):
                    sheet_width, sheet_height = width * columns, height * rows
                    if (max(sheet_width, sheet_height) <= 3840
                            and sheet_width * sheet_height <= 8_294_400
                            and max(sheet_width, sheet_height) <= 3 * min(sheet_width, sheet_height)):
                        valid_size = True
        if not valid_size:
            reject("frame_size", "gif_sheet_invalid")
    return errors
