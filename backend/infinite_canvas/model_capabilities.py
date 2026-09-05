"""Unified model capability catalog for image, video, and text generation.

The public interface is intentionally small: resolve one exact capability,
validate one proposed request against it, refresh the reviewed sources, or
inspect refresh status. Media-specific registries remain responsible for
their detailed contracts.
"""

from __future__ import annotations

import copy
import datetime as _datetime
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Iterable, Mapping, Sequence

from .image_capabilities import ImageCapabilityRegistry
from .video_capabilities import VideoCapabilityRegistry


CAPABILITY_SCHEMA_VERSION = 1
SUPPORTED_OPERATIONS = frozenset(
    {
        "text.generate",
        "image.generate",
        "image.edit",
        "image.layer_decomposition",
        "video.generate",
    }
)
SUPPORT_STATES = frozenset({"supported", "unknown"})
_FORBIDDEN_FIELD_FRAGMENTS = (
    "price",
    "pricing",
    "billing",
    "charge",
    "credit",
    "cost",
    "currency",
    "fee",
    "quota_balance",
    "usage",
    "consumption",
    "价格",
    "计价",
    "计费",
    "消耗",
    "积分",
    "费用",
    "金额",
    "货币",
    "余额",
)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _utc_now() -> str:
    return _datetime.datetime.now(_datetime.timezone.utc).isoformat()


def _unique(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    for value in values:
        text = _clean(value)
        if text and text not in result:
            result.append(text)
    return result


def _count_bounds(values: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    minimums: list[float] = []
    maximums: list[float] = []
    for value in values:
        minimum = value.get("minimum")
        maximum = value.get("maximum")
        if isinstance(minimum, (int, float)):
            minimums.append(minimum)
        if isinstance(maximum, (int, float)):
            maximums.append(maximum)
    return {
        "minimum": min(minimums) if minimums else None,
        "maximum": max(maximums) if maximums else None,
    }


def _assert_no_forbidden_fields(value: Any, *, path: str = "catalog") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            field = _clean(key)
            lowered = field.lower()
            if any(fragment in lowered for fragment in _FORBIDDEN_FIELD_FRAGMENTS):
                raise ValueError(f"unsupported catalog field: {path}.{field}")
            if lowered == "support_state" and _clean(child) not in SUPPORT_STATES:
                raise ValueError(
                    f"unsupported capability state: {path}.{field}={child}"
                )
            _assert_no_forbidden_fields(child, path=f"{path}.{field}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_forbidden_fields(child, path=f"{path}[{index}]")


@dataclass(frozen=True)
class ModelCapabilityContext:
    """Execution facts that can narrow, but never widen, a reviewed contract."""

    protocol: str = ""
    base_url: str = ""
    image_request_mode: str = ""
    discovered_image: Mapping[str, Any] | None = None
    default_image_resolution: str = ""
    image_reference_maximum: int = 20
    video_reference_maximum: int | None = None
    text_image_maximum: int = 8
    text_video_maximum: int = 3
    text_history_maximum: int = 30


class ModelCapabilityCatalog:
    """Resolve and validate all media capabilities through one interface."""

    def __init__(
        self,
        *,
        image_registry: ImageCapabilityRegistry,
        video_registry: VideoCapabilityRegistry,
        text_path: str | Path | None = None,
        revision_paths: Sequence[str | Path] = (),
        published_path: str | Path | None = None,
    ) -> None:
        self._image_registry = image_registry
        self._video_registry = video_registry
        self._text_path = Path(text_path) if text_path is not None else None
        self._revision_paths = tuple(Path(path) for path in revision_paths)
        self._published_path = (
            Path(published_path) if published_path is not None else None
        )
        self._lock = RLock()
        self._payloads: dict[Path, Mapping[str, Any]] = {}
        self._published_capabilities: dict[
            tuple[str, str, str], Mapping[str, Any]
        ] = {}
        self._revision = ""
        self._last_success_at: str | None = None
        self._last_error: str | None = None
        result = self.refresh()
        if not result["ok"]:
            raise ValueError(result["error"])

    @property
    def revision(self) -> str:
        with self._lock:
            return self._revision

    def refresh(self) -> dict[str, Any]:
        """Atomically validate and publish the current reviewed source files."""
        try:
            payloads: dict[Path, Mapping[str, Any]] = {}
            digest_payload: list[dict[str, Any]] = [
                {"capability_schema_version": CAPABILITY_SCHEMA_VERSION}
            ]
            for path in self._revision_paths:
                value = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(value, Mapping):
                    raise ValueError(f"catalog source must be an object: {path}")
                if not isinstance(value.get("version"), int):
                    raise ValueError(f"catalog source version is missing: {path}")
                _assert_no_forbidden_fields(value, path=path.name)
                payloads[path] = value
                digest_payload.append(
                    {"path": path.name, "payload": value}
                )
            published_capabilities: dict[
                tuple[str, str, str], Mapping[str, Any]
            ] = {}
            published_projection: list[dict[str, Any]] = []
            if self._published_path is not None and self._published_path.exists():
                workbench = json.loads(
                    self._published_path.read_text(encoding="utf-8-sig")
                )
                if not isinstance(workbench, Mapping):
                    raise ValueError("model capability workbench must be an object")
                published = workbench.get("published")
                records = (
                    published.get("capabilities")
                    if isinstance(published, Mapping)
                    else None
                )
                if not isinstance(records, list):
                    raise ValueError(
                        "model capability workbench published capabilities must be a list"
                    )
                for record in records:
                    if not isinstance(record, Mapping):
                        raise ValueError("published model capability must be an object")
                    identity = (
                        _clean(record.get("provider_id")).lower(),
                        _clean(record.get("model_id")),
                        _clean(record.get("operation")).lower(),
                    )
                    if not all(identity) or identity[2] not in SUPPORTED_OPERATIONS:
                        raise ValueError("published model capability identity is invalid")
                    capability = record.get("capability")
                    if not isinstance(capability, Mapping):
                        raise ValueError("published model capability patch is invalid")
                    _assert_no_forbidden_fields(
                        capability,
                        path="workbench.published.capability",
                    )
                    published_capabilities[identity] = copy.deepcopy(capability)
                    published_projection.append(
                        {
                            "provider_id": identity[0],
                            "model_id": identity[1],
                            "operation": identity[2],
                            "capability": capability,
                        }
                    )
            published_projection.sort(
                key=lambda item: (
                    item["provider_id"],
                    item["model_id"],
                    item["operation"],
                )
            )
            if self._published_path is not None:
                digest_payload.append(
                    {
                        "path": self._published_path.name,
                        "published_capabilities": published_projection,
                    }
                )
            revision = hashlib.sha256(
                json.dumps(
                    digest_payload,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()[:24]
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
            with self._lock:
                self._last_error = str(error)
            return {
                "ok": False,
                "catalog_revision": self.revision,
                "error": str(error),
            }
        timestamp = _utc_now()
        with self._lock:
            image_path = self._image_registry.source_path
            video_path = self._video_registry.source_path
            if image_path is not None and image_path in payloads:
                self._image_registry.replace_payload(payloads[image_path])
            if video_path is not None and video_path in payloads:
                self._video_registry.replace_payload(payloads[video_path])
            self._payloads = payloads
            self._published_capabilities = published_capabilities
            self._revision = revision
            self._last_success_at = timestamp
            self._last_error = None
        return {
            "ok": True,
            "catalog_revision": revision,
            "last_success_at": timestamp,
            "error": None,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "capability_schema_version": CAPABILITY_SCHEMA_VERSION,
                "catalog_revision": self._revision,
                "last_success_at": self._last_success_at,
                "last_error": self._last_error,
                "source_files": [path.name for path in self._revision_paths],
                "published_source": (
                    self._published_path.name
                    if self._published_path is not None
                    else None
                ),
            }

    def resolve(
        self,
        provider_id: str,
        model_id: str,
        operation: str,
        *,
        context: ModelCapabilityContext | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            provider = _clean(provider_id).lower()
            model = _clean(model_id)
            normalized_operation = _clean(operation).lower()
            active_context = context or ModelCapabilityContext()
            if normalized_operation.startswith("image."):
                capability = self._resolve_image(
                    provider, model, normalized_operation, active_context
                )
            elif normalized_operation == "video.generate":
                capability = self._resolve_video(
                    provider, model, normalized_operation, active_context
                )
            elif normalized_operation == "text.generate":
                capability = self._resolve_text(
                    provider, model, normalized_operation, active_context
                )
            else:
                capability = self._base(
                    provider,
                    model,
                    normalized_operation,
                    support_state="unknown",
                    source="fallback",
                )
            return self._apply_published_capability(capability, active_context)

    def _apply_published_capability(
        self,
        capability: Mapping[str, Any],
        context: ModelCapabilityContext,
    ) -> dict[str, Any]:
        identity = (
            _clean(capability.get("provider_id")).lower(),
            _clean(capability.get("model_id")),
            _clean(capability.get("operation")).lower(),
        )
        patch = self._published_capabilities.get(identity)
        if not isinstance(patch, Mapping):
            return copy.deepcopy(dict(capability))
        merged = self._merge_capability(capability, patch)
        inputs = merged.get("inputs")
        if isinstance(inputs, Mapping):
            if identity[2].startswith("image."):
                self._clamp_input_maximum(
                    inputs, "image", context.image_reference_maximum
                )
            elif identity[2] == "video.generate":
                if context.video_reference_maximum is not None:
                    for kind in ("image", "video", "audio"):
                        self._clamp_input_maximum(
                            inputs, kind, context.video_reference_maximum
                        )
            elif identity[2] == "text.generate":
                self._clamp_input_maximum(
                    inputs, "image", context.text_image_maximum
                )
                self._clamp_input_maximum(
                    inputs, "video", context.text_video_maximum
                )
        merged.update(
            {
                "provider_id": identity[0],
                "model_id": identity[1],
                "operation": identity[2],
                "capability_schema_version": CAPABILITY_SCHEMA_VERSION,
                "catalog_revision": self._revision,
            }
        )
        return merged

    @classmethod
    def _merge_capability(
        cls,
        base: Mapping[str, Any],
        patch: Mapping[str, Any],
    ) -> dict[str, Any]:
        merged = copy.deepcopy(dict(base))
        for key, value in patch.items():
            current = merged.get(key)
            if isinstance(current, Mapping) and isinstance(value, Mapping):
                merged[key] = cls._merge_capability(current, value)
            else:
                merged[key] = copy.deepcopy(value)
        return merged

    @staticmethod
    def _clamp_input_maximum(
        inputs: Mapping[str, Any],
        kind: str,
        runtime_maximum: int,
    ) -> None:
        contract = inputs.get(kind)
        if not isinstance(contract, dict):
            return
        maximum = contract.get("maximum")
        if isinstance(maximum, (int, float)):
            contract["maximum"] = min(maximum, max(0, int(runtime_maximum)))

    def validate(
        self,
        capability: Mapping[str, Any],
        *,
        input_counts: Mapping[str, int],
        input_roles: Mapping[str, Sequence[str]] | None = None,
        parameters: Mapping[str, Any],
        catalog_revision: str = "",
    ) -> dict[str, Any]:
        errors: list[dict[str, Any]] = []
        expected_revision = _clean(capability.get("catalog_revision"))
        supplied_revision = _clean(catalog_revision)
        if not supplied_revision or supplied_revision != expected_revision:
            errors.append(
                {
                    "code": "catalog_changed",
                    "field": "catalog_revision",
                    "expected": expected_revision,
                    "actual": supplied_revision,
                }
            )
            return self._validation_result(capability, errors, parameters)
        contracts = capability.get("inputs")
        input_contracts = contracts if isinstance(contracts, Mapping) else {}
        normalized_counts: dict[str, int] = {}
        for kind in ("text", "image", "video", "audio", "file"):
            raw_count = input_counts.get(kind, 0)
            if (
                not isinstance(raw_count, (int, float))
                or isinstance(raw_count, bool)
                or int(raw_count) != raw_count
                or raw_count < 0
            ):
                errors.append(
                    {"code": "input_invalid", "field": kind, "actual": raw_count}
                )
                continue
            count = int(raw_count)
            normalized_counts[kind] = count
            contract = input_contracts.get(kind)
            values = contract if isinstance(contract, Mapping) else {}
            minimum = values.get("minimum")
            maximum = values.get("maximum")
            if isinstance(minimum, (int, float)) and count < minimum:
                errors.append(
                    {
                        "code": "input_minimum",
                        "field": kind,
                        "minimum": minimum,
                        "actual": count,
                    }
                )
            if isinstance(maximum, (int, float)) and count > maximum:
                errors.append(
                    {
                        "code": "input_maximum",
                        "field": kind,
                        "maximum": maximum,
                        "actual": count,
                    }
                )

        raw_rules = capability.get("input_rules")
        input_rules = raw_rules if isinstance(raw_rules, Mapping) else {}
        for rule in input_rules.get("totals") or []:
            if not isinstance(rule, Mapping):
                continue
            kinds = [_clean(kind) for kind in rule.get("inputs") or []]
            actual = sum(normalized_counts.get(kind, 0) for kind in kinds)
            if rule.get("active_when_any_present") and actual == 0:
                continue
            minimum = rule.get("minimum")
            maximum = rule.get("maximum")
            field = _clean(rule.get("id")) or "input_total"
            if isinstance(minimum, (int, float)) and actual < minimum:
                errors.append({
                    "code": "input_total_minimum",
                    "field": field,
                    "minimum": minimum,
                    "actual": actual,
                })
            if isinstance(maximum, (int, float)) and actual > maximum:
                errors.append({
                    "code": "input_total_maximum",
                    "field": field,
                    "maximum": maximum,
                    "actual": actual,
                })
        for rule in input_rules.get("requirements") or []:
            if not isinstance(rule, Mapping):
                continue
            when = rule.get("when")
            condition = when if isinstance(when, Mapping) else {}
            when_input = _clean(condition.get("input"))
            when_minimum = condition.get("minimum", 1)
            if normalized_counts.get(when_input, 0) < when_minimum:
                continue
            kinds = [_clean(kind) for kind in rule.get("any_of") or []]
            actual = sum(normalized_counts.get(kind, 0) for kind in kinds)
            minimum = rule.get("minimum", 1)
            if actual < minimum:
                errors.append({
                    "code": "input_combination",
                    "field": _clean(rule.get("id")) or "input_combination",
                    "minimum": minimum,
                    "actual": actual,
                })
        roles_by_input = input_roles if isinstance(input_roles, Mapping) else {}
        for rule in input_rules.get("role_groups") or []:
            if not isinstance(rule, Mapping):
                continue
            kind = _clean(rule.get("input"))
            actual_roles = [_clean(role) for role in roles_by_input.get(kind, ())]
            if not any(actual_roles):
                continue
            expected_roles = [_clean(role) for role in rule.get("roles") or []]
            minimum = int(rule.get("minimum") or 0)
            maximum = int(rule.get("maximum") or len(expected_roles))
            ordered_roles = [role for role in actual_roles if role]
            invalid_roles = (
                len(ordered_roles) < minimum
                or len(ordered_roles) > maximum
                or ordered_roles != expected_roles[: len(ordered_roles)]
            )
            if invalid_roles:
                errors.append({
                    "code": "input_role",
                    "field": kind,
                    "allowed": expected_roles,
                    "actual": ordered_roles,
                })
            exclusive_inputs = [
                _clean(value) for value in rule.get("exclusive_inputs") or []
            ]
            if any(normalized_counts.get(value, 0) for value in exclusive_inputs):
                errors.append({
                    "code": "input_combination",
                    "field": _clean(rule.get("id")) or kind,
                    "actual": sum(
                        normalized_counts.get(value, 0)
                        for value in exclusive_inputs
                    ),
                })

        definitions = capability.get("parameters")
        parameter_contracts = definitions if isinstance(definitions, Mapping) else {}
        normalized: dict[str, Any] = {}
        for key, value in parameters.items():
            contract = parameter_contracts.get(key)
            if not isinstance(contract, Mapping):
                errors.append(
                    {"code": "parameter_unknown", "field": key, "actual": value}
                )
                continue
            expected_type = contract.get("type")
            if expected_type == "boolean" and not isinstance(value, bool):
                errors.append(
                    {"code": "parameter_type", "field": key, "expected": "boolean"}
                )
                continue
            if expected_type == "number" and (
                not isinstance(value, (int, float)) or isinstance(value, bool)
            ):
                errors.append(
                    {"code": "parameter_type", "field": key, "expected": "number"}
                )
                continue
            if expected_type == "string" and not isinstance(value, str):
                errors.append(
                    {"code": "parameter_type", "field": key, "expected": "string"}
                )
                continue
            if expected_type == "array" and not isinstance(value, (list, tuple)):
                errors.append(
                    {"code": "parameter_type", "field": key, "expected": "array"}
                )
                continue
            if expected_type == "integer" and (
                not isinstance(value, int) or isinstance(value, bool)
            ):
                errors.append(
                    {"code": "parameter_type", "field": key, "expected": "integer"}
                )
                continue
            allowed = contract.get("values")
            if isinstance(allowed, list) and allowed and value not in allowed:
                errors.append(
                    {
                        "code": "parameter_value",
                        "field": key,
                        "allowed": list(allowed),
                        "actual": value,
                    }
                )
                continue
            minimum = contract.get("minimum")
            maximum = contract.get("maximum")
            measured_value: Any = value
            if isinstance(value, (str, list, tuple)):
                measured_value = len(value)
            if isinstance(measured_value, (int, float)) and not isinstance(
                measured_value, bool
            ):
                if isinstance(minimum, (int, float)) and measured_value < minimum:
                    errors.append(
                        {
                            "code": "parameter_minimum",
                            "field": key,
                            "minimum": minimum,
                            "actual": measured_value,
                        }
                    )
                    continue
                if isinstance(maximum, (int, float)) and measured_value > maximum:
                    errors.append(
                        {
                            "code": "parameter_maximum",
                            "field": key,
                            "maximum": maximum,
                            "actual": measured_value,
                        }
                    )
                    continue
            normalized[key] = value
        return self._validation_result(capability, errors, normalized)

    def _validation_result(
        self,
        capability: Mapping[str, Any],
        errors: list[dict[str, Any]],
        normalized: Mapping[str, Any],
    ) -> dict[str, Any]:
        return {
            "valid": not errors,
            "errors": errors,
            "catalog_revision": capability.get("catalog_revision"),
            "capability_schema_version": capability.get(
                "capability_schema_version"
            ),
            "normalized_parameters": dict(normalized) if not errors else {},
        }

    def _base(
        self,
        provider_id: str,
        model_id: str,
        operation: str,
        *,
        support_state: str,
        source: str,
        source_url: str | None = None,
        confirmed_at: str | None = None,
        inputs: Mapping[str, Any] | None = None,
        output: Mapping[str, Any] | None = None,
        parameters: Mapping[str, Any] | None = None,
        media_contract: Mapping[str, Any] | None = None,
        input_rules: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = support_state if support_state in SUPPORT_STATES else "unknown"
        return {
            "provider_id": provider_id,
            "model_id": model_id,
            "operation": operation,
            "capability_schema_version": CAPABILITY_SCHEMA_VERSION,
            "catalog_revision": self.revision,
            "support_state": state,
            "source": source,
            "source_url": source_url,
            "confirmed_at": confirmed_at,
            "fetched_at": None,
            "expires_at": None,
            "inputs": copy.deepcopy(dict(inputs or {})),
            "input_rules": copy.deepcopy(dict(input_rules or {})),
            "output": copy.deepcopy(dict(output or {})),
            "parameters": copy.deepcopy(dict(parameters or {})),
            "media_contract": copy.deepcopy(dict(media_contract or {})),
        }

    def _resolve_image(
        self,
        provider_id: str,
        model_id: str,
        operation: str,
        context: ModelCapabilityContext,
    ) -> dict[str, Any]:
        media = self._image_registry.resolve(
            provider_id,
            model_id,
            discovered=context.discovered_image,
            provider_default_resolution=context.default_image_resolution,
        )
        operations = set(getattr(media, "operations", ()) or ())
        state = "supported" if media.known and operation in operations else "unknown"
        operation_contracts = getattr(media, "operation_contracts", {})
        operation_contract = (
            operation_contracts.get(operation)
            if isinstance(operation_contracts, Mapping)
            else None
        )
        if isinstance(operation_contract, Mapping):
            return self._base(
                provider_id,
                model_id,
                operation,
                support_state=state,
                source=media.source,
                confirmed_at=media.confirmed_at,
                inputs=operation_contract.get("inputs"),
                input_rules=operation_contract.get("input_rules"),
                output=operation_contract.get("output"),
                parameters=operation_contract.get("parameters"),
                media_contract=media.public(),
            )
        is_edit = operation == "image.edit"
        reference_maximum = max(0, int(context.image_reference_maximum or 0))
        declared_reference_maximum = int(
            getattr(media, "image_input_maximum", reference_maximum)
            or reference_maximum
        )
        if reference_maximum:
            declared_reference_maximum = min(
                declared_reference_maximum, reference_maximum
            )
        output_maximum = max(
            1, int(getattr(media, "output_count_maximum", 4) or 4)
        )
        inputs = {
            "text": {
                "minimum": 1,
                "maximum": 1,
                "required": True,
            },
            "image": {
                "minimum": 1 if is_edit else 0,
                "maximum": declared_reference_maximum if is_edit else 0,
                "required": is_edit,
                "roles": ["reference", "mask"] if is_edit else [],
                "sources": ["managed_media", "local_upload", "remote_url"]
                if is_edit
                else [],
            },
            "video": {"minimum": 0, "maximum": 0},
            "audio": {"minimum": 0, "maximum": 0},
            "file": {"minimum": 0, "maximum": 0},
        }
        parameters = {
            "aspect_ratio": {
                "type": "enum",
                "required": True,
                "visible": True,
                "editable": True,
                "values": list(media.aspect_ratios),
                "invalidation_behavior": "clear",
            },
            "resolution_tier": {
                "type": "enum",
                "required": bool(media.resolution_tiers),
                "visible": media.show_resolution_control,
                "editable": media.show_resolution_control,
                "values": list(media.resolution_tiers),
                "default": media.default_resolution_tier,
                "invalidation_behavior": "clear",
            },
            "count": {
                "type": "integer",
                "minimum": 1,
                "maximum": output_maximum,
                "default": 1,
                "required": True,
                "visible": True,
                "editable": True,
            },
            "quality": {
                "type": "enum",
                "values": ["auto", "low", "medium", "high"],
                "default": "auto",
                "required": False,
                "visible": False,
                "editable": False,
            },
            "seed": {
                "type": "integer",
                "required": False,
                "visible": False,
                "editable": False,
            },
            "style": {
                "type": "string",
                "required": False,
                "visible": False,
                "editable": False,
            },
            "prompt_enhancement": {
                "type": "boolean",
                "required": False,
                "visible": False,
                "editable": False,
            },
            "transparent_png": {
                "type": "boolean",
                "values": [False, True] if media.supports_transparent_png else [False],
                "default": False,
                "required": False,
                "visible": media.supports_transparent_png,
                "editable": media.supports_transparent_png,
                "invalidation_behavior": "clear",
            },
        }
        return self._base(
            provider_id,
            model_id,
            operation,
            support_state=state,
            source=media.source,
            confirmed_at=media.confirmed_at,
            inputs=inputs,
            output={
                "kind": "image",
                "count": {"minimum": 1, "maximum": output_maximum, "default": 1},
                "aspect_ratios": list(media.aspect_ratios),
                "resolution_tiers": list(media.resolution_tiers),
                "formats": ["png"] if media.supports_transparent_png else [],
                "transparent_alpha": media.supports_transparent_png,
            },
            parameters=parameters,
            media_contract=media.public(),
        )

    def _resolve_video(
        self,
        provider_id: str,
        model_id: str,
        operation: str,
        context: ModelCapabilityContext,
    ) -> dict[str, Any]:
        media = self._video_registry.public(
            provider_id,
            model_id,
            protocol=context.protocol,
            base_url=context.base_url,
        )
        state = "supported" if media.get("known") else "unknown"
        commands = media.get("commands")
        command_contracts = commands if isinstance(commands, Mapping) else {}
        image_limits: list[Mapping[str, Any]] = []
        video_limits: list[Mapping[str, Any]] = []
        audio_limits: list[Mapping[str, Any]] = []
        durations: list[Mapping[str, Any]] = []
        ratios: list[Any] = []
        resolutions: list[Any] = []
        for command in command_contracts.values():
            if not isinstance(command, Mapping):
                continue
            duration = command.get("duration_seconds")
            if isinstance(duration, Mapping):
                durations.append(duration)
            ratios.extend(command.get("aspect_ratios") or [])
            resolutions.extend(command.get("video_resolutions") or [])
            image_limit = command.get("image_count")
            if isinstance(image_limit, Mapping):
                image_limits.append(image_limit)
            inputs = command.get("inputs")
            if isinstance(inputs, Mapping):
                for name, target in (
                    ("image_count", image_limits),
                    ("video_count", video_limits),
                    ("audio_count", audio_limits),
                ):
                    limit = inputs.get(name)
                    if isinstance(limit, Mapping):
                        target.append(limit)
        duration_bounds = _count_bounds(durations)
        if state == "unknown" and duration_bounds == {"minimum": None, "maximum": None}:
            duration_bounds = {"minimum": 1, "maximum": 60}
        if state == "unknown" and not ratios:
            ratios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]
        if state == "unknown" and not resolutions:
            resolutions = ["480p", "720p", "1080p", "4k"]
        composer_options = media.get("composer_options")
        option_modes = composer_options if isinstance(composer_options, Mapping) else {}
        parameters = {
            "duration_seconds": {
                "type": "integer",
                **duration_bounds,
                "required": True,
                "visible": True,
                "editable": True,
            },
            "aspect_ratio": {
                "type": "enum",
                "values": _unique(ratios),
                "required": False,
                "visible": True,
                "editable": True,
            },
            "resolution": {
                "type": "enum",
                "values": _unique(resolutions),
                "required": False,
                "visible": True,
                "editable": True,
            },
            "seed": {
                "type": "integer",
                "required": False,
                "visible": False,
                "editable": False,
            },
        }
        for key, mode in option_modes.items():
            parameters[_clean(key)] = {
                "type": "boolean",
                "values": [False, True] if mode == "user_toggle" else [False],
                "default": False,
                "required": False,
                "visible": mode == "user_toggle",
                "editable": mode == "user_toggle",
            }
        fallback_reference_maximum = (
            context.video_reference_maximum
            if context.video_reference_maximum is not None
            else 10
        )
        inputs = {
            "text": {
                "minimum": 1,
                "maximum": 1,
                "required": True,
            },
            "image": {
                **(
                    _count_bounds(image_limits)
                    if image_limits
                    else {"minimum": 0, "maximum": fallback_reference_maximum}
                ),
            },
            "video": {
                **(
                    _count_bounds(video_limits)
                    if video_limits
                    else {"minimum": 0, "maximum": fallback_reference_maximum}
                ),
            },
            "audio": {
                **(
                    _count_bounds(audio_limits)
                    if audio_limits
                    else {"minimum": 0, "maximum": fallback_reference_maximum}
                ),
            },
            "file": {"minimum": 0, "maximum": 0},
        }
        multimodal_inputs = command_contracts.get("multimodal2video", {}).get(
            "inputs", {}
        )
        total_count = (
            multimodal_inputs.get("total_count")
            if isinstance(multimodal_inputs, Mapping)
            else None
        )
        frame_count = command_contracts.get("frames2video", {}).get(
            "image_count", {}
        )
        frame_roles = (
            ["first_frame", "last_frame"]
            if isinstance(frame_count, Mapping) and frame_count
            else []
        )
        input_rules: dict[str, Any] = {
            "totals": ([{
                "id": "reference_media",
                "inputs": ["image", "video", "audio"],
                "minimum": total_count.get("minimum"),
                "maximum": total_count.get("maximum"),
                "active_when_any_present": True,
            }] if isinstance(total_count, Mapping) else []),
            "requirements": ([{
                "id": "visual_reference",
                "when": {"input": "audio", "minimum": 1},
                "any_of": ["image", "video"],
                "minimum": 1,
            }] if isinstance(multimodal_inputs, Mapping)
            and multimodal_inputs.get("audio_only_supported") is False else []),
            "role_groups": ([{
                "id": "first_last_frames",
                "input": "image",
                "roles": frame_roles,
                "minimum": frame_count.get("minimum"),
                "maximum": frame_count.get("maximum"),
                "exclusive_inputs": ["video", "audio"],
            }] if frame_roles else []),
        }
        return self._base(
            provider_id,
            model_id,
            operation,
            support_state=state,
            source=_clean(media.get("source")) or "fallback",
            confirmed_at=_clean(media.get("confirmed_at")) or None,
            inputs=inputs,
            input_rules=input_rules,
            output={
                "kind": "video",
                "count": {"minimum": 1, "maximum": 1, "default": 1},
                "duration_seconds": duration_bounds,
                "aspect_ratios": _unique(ratios),
                "resolutions": _unique(resolutions),
            },
            parameters=parameters,
            media_contract=media,
        )

    def _resolve_text(
        self,
        provider_id: str,
        model_id: str,
        operation: str,
        context: ModelCapabilityContext,
    ) -> dict[str, Any]:
        entry = self._text_entry(provider_id, model_id, operation)
        if entry is not None:
            state = (
                "supported"
                if _clean(entry.get("support_state")) == "supported"
                else "unknown"
            )
            return self._base(
                provider_id,
                model_id,
                operation,
                support_state=state,
                source=_clean(entry.get("source")) or "maintained",
                source_url=_clean(entry.get("source_url")) or None,
                confirmed_at=_clean(entry.get("confirmed_at")) or None,
                inputs=entry.get("inputs") if isinstance(entry.get("inputs"), Mapping) else {},
                output=entry.get("output") if isinstance(entry.get("output"), Mapping) else {},
                parameters=entry.get("parameters") if isinstance(entry.get("parameters"), Mapping) else {},
                media_contract=entry,
            )
        return self._base(
            provider_id,
            model_id,
            operation,
            support_state="unknown",
            source="fallback",
            inputs={
                "text": {
                    "minimum": 1,
                    "maximum": 1,
                    "required": True,
                },
                "image": {
                    "minimum": 0,
                    "maximum": max(0, int(context.text_image_maximum)),
                },
                "video": {
                    "minimum": 0,
                    "maximum": max(0, int(context.text_video_maximum)),
                    "frames_per_item_maximum": 6,
                },
                "audio": {"minimum": 0, "maximum": 0},
                "file": {"minimum": 0, "maximum": 0},
            },
            output={
                "kind": "text",
                "count": {"minimum": 1, "maximum": 1, "default": 1},
                "structured": "unknown",
            },
            parameters={
                "system_prompt": {
                    "type": "string",
                    "required": False,
                    "visible": True,
                    "editable": True,
                },
                "history": {
                    "type": "array",
                    "minimum": 0,
                    "maximum": max(0, int(context.text_history_maximum)),
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
                "temperature": {
                    "type": "number",
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
                "top_p": {
                    "type": "number",
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
                "reasoning_effort": {
                    "type": "enum",
                    "values": [],
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
                "tool_calling": {
                    "type": "boolean",
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
                "structured_output": {
                    "type": "boolean",
                    "required": False,
                    "visible": False,
                    "editable": False,
                },
            },
        )

    def _text_entry(
        self, provider_id: str, model_id: str, operation: str
    ) -> Mapping[str, Any] | None:
        path = self._text_path
        if path is None:
            return None
        with self._lock:
            payload = self._payloads.get(path, {})
        entries = payload.get("capabilities") if isinstance(payload, Mapping) else []
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, Mapping):
                continue
            if (
                _clean(entry.get("provider_id")).lower() == provider_id
                and _clean(entry.get("model_id")) == model_id
                and _clean(entry.get("operation")).lower() == operation
            ):
                return entry
        return None


__all__ = [
    "CAPABILITY_SCHEMA_VERSION",
    "ModelCapabilityCatalog",
    "ModelCapabilityContext",
    "SUPPORTED_OPERATIONS",
    "SUPPORT_STATES",
]
