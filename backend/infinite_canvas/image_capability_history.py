"""Infer conservative image capabilities from existing generation history."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any, Mapping

from .image_capabilities import (
    ASPECT_RATIO_TOLERANCE,
    EXTENDED_ASPECT_RATIOS,
    FALLBACK_RESOLUTION_TIERS,
    MATERIALIZABLE_ASPECT_RATIO_TOLERANCE,
    aspect_ratio_value,
    normalize_image_aspect,
    relative_aspect_error,
)


LEGACY_RATIO_VALUES = {
    "square": "1:1",
    "portrait": "2:3",
    "landscape": "3:2",
    "portrait43": "3:4",
    "landscape43": "4:3",
    "story": "9:16",
    "wide": "16:9",
    "ultrawide": "21:9",
    "ultratall": "9:21",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _size_pair(value: Any) -> tuple[int, int] | None:
    text = _text(value).lower().replace("*", "x")
    parts = text.split("x")
    if len(parts) != 2:
        return None
    try:
        width, height = (int(float(part.strip())) for part in parts)
    except (TypeError, ValueError):
        return None
    return (width, height) if width > 0 and height > 0 else None


def requested_ratio(settings: Mapping[str, Any]) -> str | None:
    raw = _text(
        settings.get("target_aspect_ratio")
        or settings.get("aspect_ratio")
        or settings.get("ratio")
    )
    if raw in LEGACY_RATIO_VALUES:
        return LEGACY_RATIO_VALUES[raw]
    if raw in EXTENDED_ASPECT_RATIOS:
        return raw
    size = _size_pair(settings.get("requested_size") or settings.get("size"))
    if not size:
        return None
    ratio, _error = normalize_image_aspect(*size, EXTENDED_ASPECT_RATIOS)
    return ratio


def requested_tier(settings: Mapping[str, Any]) -> str | None:
    raw = _text(
        settings.get("resolution_tier") or settings.get("resolution")
    ).upper()
    if raw in FALLBACK_RESOLUTION_TIERS:
        return raw
    size = _size_pair(settings.get("requested_size") or settings.get("size"))
    if not size:
        return None
    width, height = size
    long_edge = max(width, height)
    pixels = width * height
    if long_edge >= 3000 or pixels > 4_500_000:
        return "4K"
    if long_edge >= 1800 or pixels > 1_800_000:
        return "2K"
    return "1K"


def _image_dimensions(item: Mapping[str, Any]) -> tuple[int, int] | None:
    try:
        width = int(float(
            item.get("natural_w") or item.get("width") or item.get("w") or 0
        ))
        height = int(float(
            item.get("natural_h") or item.get("height") or item.get("h") or 0
        ))
    except (TypeError, ValueError):
        return None
    return (width, height) if width > 0 and height > 0 else None


def build_history_capability_report(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Aggregate successful historical runs without retaining private content."""
    grouped: dict[tuple[str, str], dict[tuple[str, str], list[dict[str, Any]]]] = (
        defaultdict(lambda: defaultdict(list))
    )
    successful_runs = 0
    evaluated_images = 0
    for run in payload.get("runs") or []:
        if not isinstance(run, Mapping):
            continue
        if run.get("kind") != "image" or run.get("status") != "succeeded":
            continue
        request = run.get("request") if isinstance(run.get("request"), Mapping) else {}
        settings = request.get("settings") if isinstance(request.get("settings"), Mapping) else {}
        if _text(settings.get("reference_aspect_ratio")):
            # Automatic-reference runs are intentionally cropped away from
            # the provider request ratio before their public result is saved.
            # Their Materialized Output is not evidence of provider behavior.
            continue
        result = run.get("result") if isinstance(run.get("result"), Mapping) else {}
        provider_id = _text(run.get("provider_id") or settings.get("provider_id"))
        model_id = _text(settings.get("model") or result.get("model"))
        ratio = requested_ratio(settings)
        tier = requested_tier(settings)
        if not provider_id or not model_id or not ratio or not tier:
            continue
        successful_runs += 1
        items = result.get("image_items") if isinstance(result.get("image_items"), list) else []
        for item in items:
            if not isinstance(item, Mapping):
                continue
            dimensions = _image_dimensions(item)
            if not dimensions:
                continue
            width, height = dimensions
            error = relative_aspect_error(
                width / height,
                aspect_ratio_value(ratio),
            )
            grouped[(provider_id, model_id)][(ratio, tier)].append({
                "width": width,
                "height": height,
                "relative_aspect_error": error,
                "status": (
                    "supported"
                    if error <= ASPECT_RATIO_TOLERANCE + 1e-12
                    else "supported_with_materialization"
                    if error <= MATERIALIZABLE_ASPECT_RATIO_TOLERANCE + 1e-12
                    else "accepted_but_not_honored"
                ),
            })
            evaluated_images += 1

    models = []
    for (provider_id, model_id), pairs in sorted(grouped.items()):
        pair_rows = []
        supported_pairs: set[tuple[str, str]] = set()
        for ratio in EXTENDED_ASPECT_RATIOS:
            for tier in FALLBACK_RESOLUTION_TIERS:
                attempts = pairs.get((ratio, tier), [])
                supported_count = sum(
                    item["status"] in {"supported", "supported_with_materialization"}
                    for item in attempts
                )
                materialized_count = sum(
                    item["status"] == "supported_with_materialization"
                    for item in attempts
                )
                mismatch_count = len(attempts) - supported_count
                if supported_count:
                    supported_pairs.add((ratio, tier))
                pair_rows.append({
                    "aspect_ratio": ratio,
                    "resolution_tier": tier,
                    "status": (
                        "supported_with_materialization"
                        if supported_count and supported_count == materialized_count
                        else "supported"
                        if supported_count
                        else "accepted_but_not_honored"
                        if mismatch_count
                        else "untested"
                    ),
                    "supported_samples": supported_count,
                    "materialized_samples": materialized_count,
                    "mismatch_samples": mismatch_count,
                    "actual_sizes": sorted({
                        f"{item['width']}x{item['height']}" for item in attempts
                    }),
                })

        anchor_tier = max(
            FALLBACK_RESOLUTION_TIERS,
            key=lambda value: sum(
                (ratio, value) in supported_pairs
                for ratio in EXTENDED_ASPECT_RATIOS
            ),
        )
        suggested_ratios = [
            ratio for ratio in EXTENDED_ASPECT_RATIOS
            if (ratio, anchor_tier) in supported_pairs
        ]
        suggested_tiers = [
            tier for tier in FALLBACK_RESOLUTION_TIERS
            if suggested_ratios
            and all((ratio, tier) in supported_pairs for ratio in suggested_ratios)
        ]
        missing = [
            {"aspect_ratio": row["aspect_ratio"], "resolution_tier": row["resolution_tier"]}
            for row in pair_rows if row["status"] == "untested"
        ]
        models.append({
            "provider_id": provider_id,
            "model_id": model_id,
            "evaluated_images": sum(len(values) for values in pairs.values()),
            "supported_pair_count": len(supported_pairs),
            "candidate_pair_count": len(EXTENDED_ASPECT_RATIOS) * len(FALLBACK_RESOLUTION_TIERS),
            "pairs": pair_rows,
            "missing_pairs": missing,
            "suggested_capability": {
                "provider_id": provider_id,
                "model_id": model_id,
                "aspect_ratios": suggested_ratios,
                "resolution_tiers": suggested_tiers,
                "default_resolution_tier": (
                    suggested_tiers[0] if suggested_tiers else None
                ),
                "confirmed_at": None,
            },
        })
    return {
        "version": 1,
        "source": "local-generation-history",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "external_request_count": 0,
        "successful_runs_evaluated": successful_runs,
        "images_evaluated": evaluated_images,
        "models": models,
        "privacy": "Prompts, image contents, URLs, and credentials are excluded.",
    }


__all__ = [
    "build_history_capability_report",
    "requested_ratio",
    "requested_tier",
]
