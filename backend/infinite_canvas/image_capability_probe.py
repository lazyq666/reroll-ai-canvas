"""Pure reporting rules for opt-in real image capability probes."""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Mapping

from .image_capabilities import (
    ASPECT_RATIO_TOLERANCE,
    MATERIALIZABLE_ASPECT_RATIO_TOLERANCE,
    aspect_ratio_value,
    relative_aspect_error,
)


INCONCLUSIVE_ERRORS = frozenset(
    {"network", "timeout", "rate_limit", "insufficient_balance", "server"}
)


@dataclass(frozen=True)
class ProbeAttempt:
    provider_id: str
    model_id: str
    environment: str
    requested_aspect_ratio: str
    requested_resolution_tier: str
    attempt: int
    accepted: bool
    output_width: int | None
    output_height: int | None
    elapsed_seconds: float
    tested_at: str
    error_category: str = ""
    error: str = ""

    def evaluated(self) -> dict[str, Any]:
        value = asdict(self)
        error = None
        actual_ratio = None
        if self.output_width and self.output_height:
            actual_ratio = self.output_width / self.output_height
            error = relative_aspect_error(
                actual_ratio,
                aspect_ratio_value(self.requested_aspect_ratio),
            )
        if self.accepted and error is not None:
            if error <= ASPECT_RATIO_TOLERANCE + 1e-12:
                status = "supported"
            elif error <= MATERIALIZABLE_ASPECT_RATIO_TOLERANCE + 1e-12:
                status = "supported_with_materialization"
            else:
                status = "accepted_but_not_honored"
        elif self.error_category in INCONCLUSIVE_ERRORS:
            status = "inconclusive"
        else:
            status = "unsupported"
        value.update({
            "status": status,
            "actual_aspect_ratio": actual_ratio,
            "relative_aspect_error": error,
            "parameter_honored": status == "supported",
            "materialization_required": status == "supported_with_materialization",
        })
        return value


def _candidate_status(attempts: list[dict[str, Any]]) -> str:
    statuses = [item["status"] for item in attempts]
    if "supported" in statuses:
        return "supported"
    if "supported_with_materialization" in statuses:
        return "supported_with_materialization"
    if "accepted_but_not_honored" in statuses:
        return "accepted_but_not_honored"
    if statuses and all(status == "unsupported" for status in statuses):
        return "unsupported"
    return "inconclusive"


def build_probe_report(attempts: Iterable[ProbeAttempt]) -> dict[str, Any]:
    evaluated = [attempt.evaluated() for attempt in attempts]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in evaluated:
        key = (
            item["requested_aspect_ratio"],
            item["requested_resolution_tier"],
        )
        grouped.setdefault(key, []).append(item)
    candidates = []
    for (ratio, tier), values in grouped.items():
        candidates.append({
            "aspect_ratio": ratio,
            "resolution_tier": tier,
            "status": _candidate_status(values),
            "attempt_count": len(values),
            "attempts": values,
        })
    supported = [
        item for item in candidates
        if item["status"] in {"supported", "supported_with_materialization"}
    ]
    provider_id = evaluated[0]["provider_id"] if evaluated else ""
    model_id = evaluated[0]["model_id"] if evaluated else ""
    environment = evaluated[0]["environment"] if evaluated else ""
    supported_tiers_in_order = list(dict.fromkeys(
        item["resolution_tier"] for item in supported
    ))
    supported_by_tier = {
        tier: {
            item["aspect_ratio"]
            for item in supported
            if item["resolution_tier"] == tier
        }
        for tier in supported_tiers_in_order
    }
    anchor_tier = max(
        supported_tiers_in_order,
        key=lambda tier: len(supported_by_tier[tier]),
        default=None,
    )
    ratio_order = list(dict.fromkeys(item["aspect_ratio"] for item in candidates))
    supported_ratios = (
        [ratio for ratio in ratio_order if ratio in supported_by_tier[anchor_tier]]
        if anchor_tier
        else []
    )
    supported_tiers = [
        tier
        for tier in supported_tiers_in_order
        if all(ratio in supported_by_tier[tier] for ratio in supported_ratios)
    ]
    suggestion = {
        "provider_id": provider_id,
        "model_id": model_id,
        "aspect_ratios": supported_ratios,
        "resolution_tiers": supported_tiers,
        "default_resolution_tier": supported_tiers[0] if len(supported_tiers) == 1 else None,
        "confirmed_at": None,
    }
    return {
        "version": 1,
        "provider_id": provider_id,
        "model_id": model_id,
        "environment": environment,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "request_count": len(evaluated),
        "candidates": candidates,
        "suggested_capability": suggestion,
        "requires_human_confirmation": True,
    }
