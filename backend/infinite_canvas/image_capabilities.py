"""Image model capability contracts used by Smart Canvas.

The registry deliberately separates a confirmed project-owned capability from
runtime discovery and the conservative product fallback.  Provider adapters
must not infer capabilities from model names.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


COMMON_ASPECT_RATIOS = (
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
)
EXTENDED_ASPECT_RATIOS = (*COMMON_ASPECT_RATIOS, "21:9", "9:21")
FALLBACK_RESOLUTION_TIERS = ("1K", "2K", "4K")
ASPECT_RATIO_TOLERANCE = 0.01
# Some providers align image dimensions to a latent/image grid.  Keep the
# reference-image matching contract at 1%, while allowing a tiny additional
# margin for outputs that the existing cover materializer can turn into the
# promised ratio with a negligible edge crop. Nano Banana 2 returns 33:14 for
# a requested 21:9 (1.0204%).
MATERIALIZABLE_ASPECT_RATIO_TOLERANCE = 0.011


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _ordered_unique(values: Iterable[Any]) -> tuple[str, ...]:
    result: list[str] = []
    for value in values:
        text = _clean_text(value)
        if text and text not in result:
            result.append(text)
    return tuple(result)


def aspect_ratio_value(value: str) -> float:
    """Return the numeric value for a positive ``W:H`` ratio."""
    parts = _clean_text(value).split(":")
    if len(parts) != 2:
        raise ValueError(f"invalid aspect ratio: {value}")
    width, height = (float(part) for part in parts)
    if not math.isfinite(width) or not math.isfinite(height):
        raise ValueError(f"invalid aspect ratio: {value}")
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid aspect ratio: {value}")
    return width / height


def relative_aspect_error(actual: float, target: float) -> float:
    if not math.isfinite(actual) or not math.isfinite(target) or target <= 0:
        raise ValueError("aspect ratios must be positive finite values")
    return abs(actual - target) / target


def normalize_image_aspect(
    width: int | float,
    height: int | float,
    supported: Sequence[str],
    *,
    tolerance: float = ASPECT_RATIO_TOLERANCE,
) -> tuple[str | None, float | None]:
    """Match real dimensions to the closest supported standard ratio."""
    width_value = float(width)
    height_value = float(height)
    if width_value <= 0 or height_value <= 0:
        return None, None
    actual = width_value / height_value
    matches: list[tuple[float, str]] = []
    for ratio in _ordered_unique(supported):
        try:
            error = relative_aspect_error(actual, aspect_ratio_value(ratio))
        except ValueError:
            continue
        matches.append((error, ratio))
    if not matches:
        return None, None
    error, ratio = min(matches, key=lambda item: (item[0], item[1]))
    if error > float(tolerance) + 1e-12:
        return None, error
    return ratio, error


@dataclass(frozen=True)
class ImageModelCapability:
    provider_id: str
    model_id: str
    aspect_ratios: tuple[str, ...]
    resolution_tiers: tuple[str, ...]
    default_resolution_tier: str | None
    source: str
    confirmed_at: str | None = None
    known: bool = True
    supports_transparent_png: bool = False

    @property
    def show_resolution_control(self) -> bool:
        # Unknown models still need usable compatibility choices so they can
        # be tested before their provider capability has been confirmed.
        return len(self.resolution_tiers) > 1

    def public(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "model_id": self.model_id,
            "aspect_ratios": list(self.aspect_ratios),
            "resolution_tiers": list(self.resolution_tiers),
            "default_resolution_tier": self.default_resolution_tier,
            "source": self.source,
            "confirmed_at": self.confirmed_at,
            "known": self.known,
            "show_resolution_control": self.show_resolution_control,
            "supports_transparent_png": self.supports_transparent_png,
        }


def _capability_from_mapping(
    provider_id: str,
    model_id: str,
    value: Mapping[str, Any],
    *,
    source: str,
    known: bool = True,
) -> ImageModelCapability:
    ratios = _ordered_unique(value.get("aspect_ratios") or ())
    valid_ratios: list[str] = []
    for ratio in ratios:
        try:
            aspect_ratio_value(ratio)
        except ValueError:
            continue
        valid_ratios.append(ratio)
    tiers = _ordered_unique(
        _clean_text(item).upper()
        for item in (value.get("resolution_tiers") or ())
    )
    default = _clean_text(value.get("default_resolution_tier")).upper() or None
    if default and tiers and default not in tiers:
        default = None
    return ImageModelCapability(
        provider_id=_clean_text(provider_id),
        model_id=_clean_text(model_id),
        aspect_ratios=tuple(valid_ratios),
        resolution_tiers=tiers,
        default_resolution_tier=default,
        source=source,
        confirmed_at=_clean_text(value.get("confirmed_at")) or None,
        known=known,
        supports_transparent_png=value.get("supports_transparent_png") is True,
    )


class ImageCapabilityRegistry:
    """Resolve exact model capabilities in documented priority order."""

    def __init__(self, maintained_path: str | Path | None = None) -> None:
        self._maintained_path = (
            Path(maintained_path) if maintained_path is not None else None
        )

    def _maintained(self) -> dict[tuple[str, str], Mapping[str, Any]]:
        path = self._maintained_path
        if path is None or not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, TypeError, ValueError):
            return {}
        items = payload.get("capabilities") if isinstance(payload, dict) else []
        result: dict[tuple[str, str], Mapping[str, Any]] = {}
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, Mapping):
                continue
            provider_id = _clean_text(item.get("provider_id"))
            model_id = _clean_text(item.get("model_id"))
            if provider_id and model_id:
                result[(provider_id, model_id)] = item
        return result

    def resolve(
        self,
        provider_id: str,
        model_id: str,
        *,
        discovered: Mapping[str, Any] | None = None,
        provider_default_resolution: str | None = None,
    ) -> ImageModelCapability:
        provider_id = _clean_text(provider_id)
        model_id = _clean_text(model_id)
        maintained = self._maintained().get((provider_id, model_id))
        if maintained is not None:
            return _capability_from_mapping(
                provider_id,
                model_id,
                maintained,
                source="maintained",
            )
        if isinstance(discovered, Mapping) and (
            discovered.get("aspect_ratios")
            or discovered.get("resolution_tiers")
        ):
            return _capability_from_mapping(
                provider_id,
                model_id,
                discovered,
                source="discovered",
            )
        default = _clean_text(provider_default_resolution).upper() or None
        fallback_tiers = _ordered_unique(
            (default, *FALLBACK_RESOLUTION_TIERS) if default else FALLBACK_RESOLUTION_TIERS
        )
        return ImageModelCapability(
            provider_id=provider_id,
            model_id=model_id,
            aspect_ratios=COMMON_ASPECT_RATIOS,
            resolution_tiers=fallback_tiers,
            default_resolution_tier=default,
            source="fallback",
            confirmed_at=None,
            known=False,
            supports_transparent_png=False,
        )


def intersect_capabilities(
    capabilities: Sequence[ImageModelCapability],
) -> dict[str, Any]:
    """Return ordered shared options for a multi-model generation run."""
    if not capabilities:
        return {
            "aspect_ratios": [],
            "resolution_tiers": [],
            "default_resolution_tier": None,
            "known": False,
            "blocked": True,
            "supports_transparent_png": False,
        }
    first = capabilities[0]
    ratio_sets = [set(item.aspect_ratios) for item in capabilities[1:]]
    ratios = [
        ratio
        for ratio in first.aspect_ratios
        if all(ratio in values for values in ratio_sets)
    ]
    all_tiers_confirmed = all(
        item.known and item.resolution_tiers for item in capabilities
    )
    tier_sets = [set(item.resolution_tiers) for item in capabilities[1:]]
    tiers = (
        [
            tier
            for tier in first.resolution_tiers
            if all(tier in values for values in tier_sets)
        ]
        if all(item.resolution_tiers for item in capabilities)
        else []
    )
    defaults = [item.default_resolution_tier for item in capabilities]
    default = defaults[0] if defaults and all(item == defaults[0] for item in defaults) else None
    if default not in tiers:
        default = tiers[0] if len(tiers) == 1 else None
    return {
        "aspect_ratios": ratios,
        "resolution_tiers": tiers,
        "default_resolution_tier": default,
        "known": all(item.known for item in capabilities),
        "blocked": not ratios or (all_tiers_confirmed and not tiers),
        "supports_transparent_png": all(
            item.supports_transparent_png for item in capabilities
        ),
    }


def reconcile_capability_selection(
    capability: ImageModelCapability,
    *,
    aspect_ratio: str | None,
    resolution_tier: str | None,
) -> dict[str, Any]:
    """Clear unsupported selections without silently choosing a near match."""
    aspect = _clean_text(aspect_ratio) or None
    resolution = _clean_text(resolution_tier).upper() or None
    invalid: list[str] = []
    if aspect not in capability.aspect_ratios:
        if aspect is not None:
            invalid.append("aspect_ratio")
        aspect = None
    if capability.resolution_tiers:
        if len(capability.resolution_tiers) == 1:
            only_tier = capability.resolution_tiers[0]
            if resolution not in {None, only_tier}:
                invalid.append("resolution_tier")
            resolution = only_tier
        elif resolution not in capability.resolution_tiers:
            if resolution is not None:
                invalid.append("resolution_tier")
            resolution = None
    else:
        resolution = capability.default_resolution_tier
    return {
        "aspect_ratio": aspect,
        "resolution_tier": resolution,
        "invalidated": invalid,
        "requires_selection": aspect is None,
    }
