"""Product-facing model capability matrix.

The matrix groups provider-specific runtime records by stable Model ID and
translates detailed contracts into a small set of administrator choices.
"""

from __future__ import annotations

import copy
import datetime as _datetime
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .model_capability_workbench import (
    ModelCapabilityWorkbench,
    ModelCapabilityWorkbenchValidation,
)


MODEL_TYPES = ("image", "video", "text")
OPERATIONS_BY_TYPE = {
    "image": ("image.generate", "image.edit", "image.layer_decomposition"),
    "video": ("video.generate",),
    "text": ("text.generate",),
}
INPUT_TYPES = ("text", "image", "video", "audio", "file")
EDITABLE_CAPABILITY_FIELDS = (
    "support_state",
    "source",
    "source_url",
    "confirmed_at",
    "inputs",
    "input_rules",
    "output",
    "parameters",
    "media_contract",
)
RESOLUTION_PARAMETERS = ("resolution_tier", "resolution")
VIDEO_PROFILE_KEY = "video_profile"
VIDEO_MODE_FIRST_LAST_FRAMES = "first_last_frames"
VIDEO_MODE_ALL_AROUND = "multimodal_all_around"
IMPORT_SCHEMA_VERSION = 1
IMPORT_SOURCE_TYPES = frozenset(
    {"official_docs", "structured_api", "cli_help", "workflow_schema"}
)
IMPORT_BUNDLE_FIELDS = frozenset({"schema_version", "models"})
IMPORT_MODEL_FIELDS = frozenset({"model_id", "name", "operations"})
IMPORT_OPERATION_FIELDS = frozenset(
    {
        "operation",
        "confirmed",
        "inputs",
        "resolutions",
        "aspect_ratios",
        "output_count_maximum",
        "options",
        "sources",
    }
)
IMPORT_VIDEO_FIELDS = frozenset(
    {
        "input_total_maximum",
        "reference_media_duration_seconds",
        "audio_only_supported",
        "modes",
        "output_duration_seconds",
    }
)
IMPORT_VIDEO_DURATION_FIELDS = frozenset({"each", "combined_total"})
IMPORT_BOUNDS_FIELDS = frozenset({"minimum", "maximum"})
IMPORT_VIDEO_MODE_FIELDS = frozenset(
    {VIDEO_MODE_FIRST_LAST_FRAMES, VIDEO_MODE_ALL_AROUND}
)
IMPORT_SOURCE_FIELDS = frozenset({"type", "url", "title", "excerpt"})
IMPORT_OPTIONS_BY_OPERATION = {
    "image.generate": frozenset({"transparent_png", "prompt_enhancement"}),
    "image.edit": frozenset({"transparent_png", "prompt_enhancement"}),
    "image.layer_decomposition": frozenset(),
    "video.generate": frozenset(
        {
            "enhance_prompt",
            "generate_audio",
            "enable_upsample",
            "camera_fixed",
            "watermark",
        }
    ),
    "text.generate": frozenset(),
}


class ModelCapabilityImportInvalid(ValueError):
    """An external capability package cannot be safely applied."""

    def __init__(
        self, reason: str, *, model_id: str = "", operation: str = ""
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.model_id = model_id
        self.operation = operation


def _clean(value: object) -> str:
    return str(value or "").strip()


def _unique(values: Sequence[object]) -> list[str]:
    result: list[str] = []
    for value in values:
        text = _clean(value)
        if text and text not in result:
            result.append(text)
    return result


def _maximum(contract: object) -> int:
    if not isinstance(contract, Mapping):
        return 0
    value = contract.get("maximum")
    return max(0, int(value)) if isinstance(value, (int, float)) else 0


def _enum_values(contract: object) -> list[str]:
    if not isinstance(contract, Mapping):
        return []
    values = contract.get("values")
    return _unique(values) if isinstance(values, (list, tuple)) else []


def _number(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _bounds(contract: object) -> dict[str, int | None]:
    values = contract if isinstance(contract, Mapping) else {}
    return {
        "minimum": _number(values.get("minimum")),
        "maximum": _number(values.get("maximum")),
    }


def _common_bounds(contracts: Sequence[object]) -> dict[str, int]:
    bounds = [_bounds(contract) for contract in contracts]
    if not bounds or any(
        item["minimum"] is None or item["maximum"] is None for item in bounds
    ):
        return {"minimum": 0, "maximum": 0}
    minimum = max(int(item["minimum"] or 0) for item in bounds)
    maximum = min(int(item["maximum"] or 0) for item in bounds)
    return {
        "minimum": min(minimum, maximum),
        "maximum": max(0, maximum),
    }


def _normalized_bounds(
    contract: object,
    *,
    minimum_allowed: int,
    maximum_allowed: int,
) -> dict[str, int]:
    values = contract if isinstance(contract, Mapping) else {}
    minimum = _number(values.get("minimum"))
    maximum = _number(values.get("maximum"))
    minimum = max(minimum_allowed, min(maximum_allowed, minimum or minimum_allowed))
    maximum = max(minimum_allowed, min(maximum_allowed, maximum or minimum))
    return {"minimum": min(minimum, maximum), "maximum": maximum}


def _merge(left: Mapping[str, Any], right: Mapping[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(dict(left))
    for key, value in right.items():
        if isinstance(merged.get(key), Mapping) and isinstance(value, Mapping):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


class ModelCapabilityMatrix:
    """Hide provider routing and contract JSON behind product choices."""

    def __init__(
        self,
        *,
        inventory: Callable[[], Mapping[str, Sequence[Mapping[str, Any]]]],
        catalog: Any,
        workbench: ModelCapabilityWorkbench,
    ) -> None:
        self._inventory = inventory
        self.catalog = catalog
        self.workbench = workbench

    def snapshot(self) -> dict[str, Any]:
        inventory = self._inventory()
        workbench = self.workbench.snapshot()
        rows: dict[str, dict[str, Any]] = {}
        for model_type in MODEL_TYPES:
            for item in inventory.get(model_type, ()):
                if not isinstance(item, Mapping):
                    continue
                model_id = _clean(item.get("model"))
                if not model_id:
                    continue
                row = rows.setdefault(
                    model_id,
                    {
                        "id": model_id,
                        "model_id": model_id,
                        "names": [],
                        "types": [],
                        "providers": [],
                        "variants": [],
                    },
                )
                name = _clean(item.get("name")) or model_id
                if name not in row["names"]:
                    row["names"].append(name)
                if model_type not in row["types"]:
                    row["types"].append(model_type)
                provider = {
                    "id": _clean(item.get("provider_id")),
                    "name": _clean(item.get("provider_name"))
                    or _clean(item.get("provider_id")),
                }
                if provider["id"] and provider not in row["providers"]:
                    row["providers"].append(provider)
                variant = {
                    "provider_id": provider["id"],
                    "provider_name": provider["name"],
                    "type": model_type,
                }
                if variant["provider_id"] and variant not in row["variants"]:
                    row["variants"].append(variant)

        evidence = [
            item
            for item in workbench.get("evidence", [])
            if isinstance(item, Mapping)
        ]
        drafts = [
            item
            for item in workbench.get("drafts", [])
            if isinstance(item, Mapping)
        ]
        published_model_ids = {
            _clean(item.get("model_id"))
            for item in workbench.get("published", {}).get("capabilities", [])
            if isinstance(item, Mapping) and _clean(item.get("model_id"))
        }
        draft_capabilities: dict[tuple[str, str, str], Mapping[str, Any]] = {}
        for draft in sorted(drafts, key=lambda item: _clean(item.get("updated_at"))):
            capability = draft.get("capability")
            if not isinstance(capability, Mapping):
                continue
            identity = (
                _clean(draft.get("provider_id")),
                _clean(draft.get("model_id")),
                _clean(draft.get("operation")),
            )
            if all(identity):
                draft_capabilities[identity] = capability
        result_rows = []
        for row in rows.values():
            row["name"] = row["names"][0] if row["names"] else row["model_id"]
            operation_records: dict[str, list[Mapping[str, Any]]] = {}
            catalog_operation_records: dict[str, list[Mapping[str, Any]]] = {}
            for variant in row["variants"]:
                for operation in OPERATIONS_BY_TYPE.get(variant["type"], ()):
                    capability = self.catalog.resolve(
                        variant["provider_id"], row["model_id"], operation
                    )
                    catalog_operation_records.setdefault(operation, []).append(
                        capability
                    )
                    identity = (variant["provider_id"], row["model_id"], operation)
                    if row["model_id"] not in published_model_ids:
                        draft = draft_capabilities.get(identity)
                        if isinstance(draft, Mapping):
                            capability = _merge(capability, draft)
                    operation_records.setdefault(operation, []).append(capability)
            row["operations"] = [
                self._operation_projection(operation, capabilities)
                for operation, capabilities in operation_records.items()
            ]
            catalog_operations = [
                self._operation_projection(operation, capabilities)
                for operation, capabilities in catalog_operation_records.items()
            ]
            row["capability_tags"] = self._capability_tags(catalog_operations)
            row_evidence = [
                item for item in evidence if _clean(item.get("model_id")) == row["model_id"]
            ]
            row_drafts = [
                item for item in drafts if _clean(item.get("model_id")) == row["model_id"]
            ]
            state_counts = Counter(_clean(item.get("review_state")) for item in row_drafts)
            row["evidence_count"] = len(row_evidence)
            row["review"] = {
                "draft": state_counts["draft"] + state_counts["returned"],
                "in_review": state_counts["in_review"],
                "published": state_counts["published"],
            }
            row["confirmed_count"] = sum(
                1 for operation in row["operations"] if operation["confirmed"]
            )
            row["operation_count"] = len(row["operations"])
            row.pop("variants", None)
            result_rows.append(row)
        result_rows.sort(key=lambda item: (item["name"].casefold(), item["model_id"]))
        return {
            "models": result_rows,
            "summary": {
                "models": len(result_rows),
                "confirmed": sum(bool(row["confirmed_count"]) for row in result_rows),
                "needs_sources": sum(not row["evidence_count"] for row in result_rows),
                "with_sources": sum(bool(row["evidence_count"]) for row in result_rows),
            },
            "catalog_revision": _clean(self.catalog.revision),
        }

    @staticmethod
    def _capability_tags(operations: Sequence[Mapping[str, Any]]) -> list[str]:
        confirmed = [operation for operation in operations if operation.get("confirmed")]
        has_layer_decomposition = any(
            _clean(operation.get("operation")) == "image.layer_decomposition"
            for operation in confirmed
        )
        has_transparent_png = any(
            _clean(operation.get("operation"))
            in {"image.generate", "image.edit"}
            and isinstance(operation.get("options"), Mapping)
            and operation["options"].get("transparent_png") is True
            for operation in confirmed
        )
        return [
            tag
            for tag, enabled in (
                ("layer_decomposition", has_layer_decomposition),
                ("transparent_png", has_transparent_png),
            )
            if enabled
        ]

    @staticmethod
    def _video_capability_projection(capability: Mapping[str, Any]) -> dict[str, Any]:
        media_contract = capability.get("media_contract")
        media_contract = (
            media_contract if isinstance(media_contract, Mapping) else {}
        )
        saved_profile = media_contract.get(VIDEO_PROFILE_KEY)
        saved_profile = saved_profile if isinstance(saved_profile, Mapping) else {}
        commands = media_contract.get("commands")
        commands = commands if isinstance(commands, Mapping) else {}
        cli_commands = {
            _clean(value)
            for value in media_contract.get("cli_commands", [])
            if _clean(value)
        }
        multimodal = commands.get("multimodal2video")
        multimodal = multimodal if isinstance(multimodal, Mapping) else {}
        multimodal_inputs = multimodal.get("inputs")
        multimodal_inputs = (
            multimodal_inputs if isinstance(multimodal_inputs, Mapping) else {}
        )
        reference_duration = saved_profile.get("reference_media_duration_seconds")
        if not isinstance(reference_duration, Mapping):
            reference_duration = multimodal_inputs.get(
                "reference_media_duration_seconds"
            )
        reference_duration = (
            reference_duration if isinstance(reference_duration, Mapping) else {}
        )
        input_rules = capability.get("input_rules")
        input_rules = input_rules if isinstance(input_rules, Mapping) else {}
        totals = input_rules.get("totals")
        totals = totals if isinstance(totals, list) else []
        total_rule = next(
            (
                item
                for item in totals
                if isinstance(item, Mapping)
                and _clean(item.get("id")) == "reference_media"
            ),
            {},
        )
        role_groups = input_rules.get("role_groups")
        role_groups = role_groups if isinstance(role_groups, list) else []
        requirements = input_rules.get("requirements")
        requirements = requirements if isinstance(requirements, list) else []
        modes = saved_profile.get("modes")
        modes = modes if isinstance(modes, Mapping) else {}
        total_maximum = _number(saved_profile.get("input_total_maximum"))
        if total_maximum is None:
            total_maximum = _number(total_rule.get("maximum"))
        if total_maximum is None:
            total_count = multimodal_inputs.get("total_count")
            total_maximum = _number(
                total_count.get("maximum")
                if isinstance(total_count, Mapping)
                else None
            )
        audio_only = saved_profile.get("audio_only_supported")
        if not isinstance(audio_only, bool):
            audio_only = multimodal_inputs.get("audio_only_supported")
        if not isinstance(audio_only, bool):
            audio_only = not any(
                isinstance(item, Mapping)
                and _clean(item.get("id")) == "visual_reference"
                for item in requirements
            ) and (bool(multimodal_inputs) or "multimodal2video" in cli_commands)
        supports_first_last = modes.get(VIDEO_MODE_FIRST_LAST_FRAMES)
        if not isinstance(supports_first_last, bool):
            supports_first_last = "frames2video" in cli_commands or bool(
                commands.get("frames2video")
            ) or any(
                isinstance(item, Mapping)
                and _clean(item.get("id")) == VIDEO_MODE_FIRST_LAST_FRAMES
                for item in role_groups
            )
        supports_all_around = modes.get(VIDEO_MODE_ALL_AROUND)
        if not isinstance(supports_all_around, bool):
            supports_all_around = (
                "multimodal2video" in cli_commands or bool(multimodal)
            )
        output = capability.get("output")
        output = output if isinstance(output, Mapping) else {}
        return {
            "input_total_maximum": max(0, total_maximum or 0),
            "reference_media_duration_seconds": {
                "each": _bounds(reference_duration.get("each")),
                "combined_total": _bounds(
                    reference_duration.get("combined_total")
                ),
            },
            "audio_only_supported": bool(audio_only),
            "modes": {
                VIDEO_MODE_FIRST_LAST_FRAMES: bool(supports_first_last),
                VIDEO_MODE_ALL_AROUND: bool(supports_all_around),
            },
            "output_duration_seconds": _bounds(output.get("duration_seconds")),
        }

    @classmethod
    def _video_projection(
        cls, capabilities: Sequence[Mapping[str, Any]]
    ) -> dict[str, Any]:
        profiles = [cls._video_capability_projection(item) for item in capabilities]
        return {
            "input_total_maximum": min(
                (item["input_total_maximum"] for item in profiles), default=0
            ),
            "reference_media_duration_seconds": {
                "each": _common_bounds(
                    [
                        item["reference_media_duration_seconds"]["each"]
                        for item in profiles
                    ]
                ),
                "combined_total": _common_bounds(
                    [
                        item["reference_media_duration_seconds"]["combined_total"]
                        for item in profiles
                    ]
                ),
            },
            "audio_only_supported": bool(profiles)
            and all(item["audio_only_supported"] for item in profiles),
            "modes": {
                mode: bool(profiles)
                and all(item["modes"][mode] for item in profiles)
                for mode in (
                    VIDEO_MODE_FIRST_LAST_FRAMES,
                    VIDEO_MODE_ALL_AROUND,
                )
            },
            "output_duration_seconds": _common_bounds(
                [item["output_duration_seconds"] for item in profiles]
            ),
        }

    @classmethod
    def _operation_projection(
        cls, operation: str, capabilities: Sequence[Mapping[str, Any]]
    ) -> dict[str, Any]:
        inputs = {
            input_type: min(
                (_maximum(item.get("inputs", {}).get(input_type)) for item in capabilities),
                default=0,
            )
            for input_type in INPUT_TYPES
        }
        resolution_sets: list[set[str]] = []
        aspect_ratio_sets: list[set[str]] = []
        option_support: list[dict[str, bool]] = []
        output_maximums: list[int] = []
        for capability in capabilities:
            output = capability.get("output")
            output = output if isinstance(output, Mapping) else {}
            output_maximums.append(max(1, _maximum(output.get("count"))))
            parameters = capability.get("parameters")
            parameters = parameters if isinstance(parameters, Mapping) else {}
            capability_resolutions: list[str] = _unique(
                output.get("resolution_tiers") or output.get("resolutions") or []
            )
            for key in RESOLUTION_PARAMETERS:
                capability_resolutions.extend(_enum_values(parameters.get(key)))
            resolution_sets.append(set(_unique(capability_resolutions)))
            capability_ratios = _unique(output.get("aspect_ratios") or [])
            capability_ratios.extend(_enum_values(parameters.get("aspect_ratio")))
            aspect_ratio_sets.append(set(_unique(capability_ratios)))
            count = parameters.get("count")
            if _maximum(count):
                output_maximums[-1] = min(
                    output_maximums[-1], _maximum(count)
                )
            current_options: dict[str, bool] = {}
            for key, contract in parameters.items():
                if isinstance(contract, Mapping) and contract.get("type") == "boolean":
                    values = contract.get("values")
                    current_options[key] = (
                        isinstance(values, (list, tuple)) and True in values
                    )
            option_support.append(current_options)
        common_resolutions = (
            set.intersection(*resolution_sets) if resolution_sets else set()
        )
        common_ratios = (
            set.intersection(*aspect_ratio_sets) if aspect_ratio_sets else set()
        )
        option_keys = {
            key for options in option_support for key in options
        }
        boolean_options = {
            key: all(options.get(key, False) for options in option_support)
            for key in option_keys
        }
        result = {
            "operation": operation,
            "confirmed": all(
                _clean(item.get("support_state")) == "supported"
                for item in capabilities
            ),
            "inputs": inputs,
            "resolutions": sorted(common_resolutions),
            "aspect_ratios": sorted(common_ratios),
            "output_count_maximum": min(output_maximums, default=1),
            "options": boolean_options,
        }
        if operation == "video.generate":
            result["video"] = cls._video_projection(capabilities)
        return result

    def apply(
        self,
        *,
        model_id: str,
        name: str,
        operations: Sequence[Mapping[str, Any]],
        actor_id: str,
    ) -> dict[str, Any]:
        requested_model = _clean(model_id)
        if not requested_model:
            raise ValueError("model_id is required")
        current = self.snapshot()
        row = next(
            (item for item in current["models"] if item["model_id"] == requested_model),
            None,
        )
        if row is None:
            raise ValueError("model does not exist in the current environment")
        selected = {
            _clean(item.get("operation")): item
            for item in operations
            if isinstance(item, Mapping) and _clean(item.get("operation"))
        }
        inventory = self._inventory()
        records = []
        for model_type in MODEL_TYPES:
            for item in inventory.get(model_type, ()):
                if _clean(item.get("model")) != requested_model:
                    continue
                provider_id = _clean(item.get("provider_id"))
                for operation in OPERATIONS_BY_TYPE.get(model_type, ()):
                    choice = selected.get(operation)
                    if choice is None:
                        continue
                    base = self.catalog.resolve(provider_id, requested_model, operation)
                    records.append(
                        {
                            "provider_id": provider_id,
                            "model_id": requested_model,
                            "operation": operation,
                            "capability": self._apply_choice(base, choice),
                        }
                    )
        if not records:
            raise ValueError("no capability choices were supplied for this model")
        return self.workbench.publish_manual_capabilities(
            records=records,
            model_name=_clean(name) or row["name"],
            active_catalog_revision=current["catalog_revision"],
            actor_id=actor_id,
            activate=self.catalog.refresh,
        )

    def import_bundle(
        self,
        *,
        bundle: Mapping[str, Any],
        actor_id: str,
        apply: bool = False,
    ) -> dict[str, Any]:
        """Validate or atomically apply one provider-independent import package."""

        schema_version = bundle.get("schema_version")
        if (
            set(bundle) != set(IMPORT_BUNDLE_FIELDS)
            or isinstance(schema_version, bool)
            or schema_version != IMPORT_SCHEMA_VERSION
        ):
            raise ModelCapabilityImportInvalid("schema_version")
        imported_models = bundle.get("models")
        if (
            not isinstance(imported_models, list)
            or not imported_models
            or len(imported_models) > 100
        ):
            raise ModelCapabilityImportInvalid("models_required")
        current = self.snapshot()
        current_rows = {row["model_id"]: row for row in current["models"]}
        inventory = self._inventory()
        timestamp = _datetime.datetime.now(_datetime.timezone.utc).isoformat()
        seen_models: set[str] = set()
        records: list[dict[str, Any]] = []
        affected_variants: set[tuple[str, str]] = set()
        operation_count = 0

        for imported_model in imported_models:
            if (
                not isinstance(imported_model, Mapping)
                or set(imported_model) != set(IMPORT_MODEL_FIELDS)
            ):
                raise ModelCapabilityImportInvalid("model_format")
            model_id = _clean(imported_model.get("model_id"))
            if not model_id or model_id in seen_models:
                raise ModelCapabilityImportInvalid(
                    "duplicate_model", model_id=model_id
                )
            seen_models.add(model_id)
            row = current_rows.get(model_id)
            if row is None:
                raise ModelCapabilityImportInvalid(
                    "model_not_found", model_id=model_id
                )
            name = _clean(imported_model.get("name"))
            known_names = {
                _clean(value).casefold()
                for value in row.get("names", [])
                if _clean(value)
            }
            if not name or name.casefold() not in known_names:
                raise ModelCapabilityImportInvalid(
                    "name_mismatch", model_id=model_id
                )
            imported_operations = imported_model.get("operations")
            if (
                not isinstance(imported_operations, list)
                or not imported_operations
                or len(imported_operations) > 5
            ):
                raise ModelCapabilityImportInvalid(
                    "operations_required", model_id=model_id
                )
            available_operations = {
                operation["operation"] for operation in row["operations"]
            }
            seen_operations: set[str] = set()
            for imported_operation in imported_operations:
                imported_operation_fields = (
                    set(imported_operation)
                    if isinstance(imported_operation, Mapping)
                    else set()
                )
                if (
                    not isinstance(imported_operation, Mapping)
                    or imported_operation_fields
                    not in (
                        set(IMPORT_OPERATION_FIELDS),
                        set(IMPORT_OPERATION_FIELDS | {"video"}),
                    )
                ):
                    raise ModelCapabilityImportInvalid(
                        "operation_format", model_id=model_id
                    )
                operation = _clean(imported_operation.get("operation"))
                if not operation or operation in seen_operations:
                    raise ModelCapabilityImportInvalid(
                        "duplicate_operation",
                        model_id=model_id,
                        operation=operation,
                    )
                seen_operations.add(operation)
                if operation not in available_operations:
                    raise ModelCapabilityImportInvalid(
                        "operation_not_available",
                        model_id=model_id,
                        operation=operation,
                    )
                if imported_operation.get("confirmed") is not True:
                    raise ModelCapabilityImportInvalid(
                        "operation_not_confirmed",
                        model_id=model_id,
                        operation=operation,
                    )
                imported_inputs = imported_operation.get("inputs")
                if not isinstance(imported_inputs, Mapping) or set(imported_inputs) != set(
                    INPUT_TYPES
                ):
                    raise ModelCapabilityImportInvalid(
                        "inputs_incomplete",
                        model_id=model_id,
                        operation=operation,
                    )
                if any(
                    isinstance(value, bool)
                    or not isinstance(value, int)
                    or value < 0
                    or value > 100
                    for value in imported_inputs.values()
                ):
                    raise ModelCapabilityImportInvalid(
                        "inputs_incomplete",
                        model_id=model_id,
                        operation=operation,
                    )
                output_count = imported_operation.get("output_count_maximum")
                sequence_fields = (
                    imported_operation.get("resolutions"),
                    imported_operation.get("aspect_ratios"),
                    imported_operation.get("options"),
                )
                if (
                    isinstance(output_count, bool)
                    or not isinstance(output_count, int)
                    or not 1 <= output_count <= 100
                    or any(
                        not isinstance(values, list)
                        or len(values) > 40
                        or any(not isinstance(value, str) or not value.strip() for value in values)
                        for values in sequence_fields
                    )
                    or not set(imported_operation.get("options") or []).issubset(
                        IMPORT_OPTIONS_BY_OPERATION.get(operation, frozenset())
                    )
                ):
                    raise ModelCapabilityImportInvalid(
                        "operation_format",
                        model_id=model_id,
                        operation=operation,
                    )
                self._validate_import_video(
                    imported_operation.get("video"),
                    model_id=model_id,
                    operation=operation,
                )
                evidence = self._import_evidence(
                    imported_operation.get("sources"),
                    model_id=model_id,
                    operation=operation,
                    fetched_at=timestamp,
                )
                for model_type in MODEL_TYPES:
                    if operation not in OPERATIONS_BY_TYPE.get(model_type, ()):
                        continue
                    for item in inventory.get(model_type, ()):
                        if _clean(item.get("model")) != model_id:
                            continue
                        provider_id = _clean(item.get("provider_id"))
                        base = self.catalog.resolve(provider_id, model_id, operation)
                        try:
                            for evidence_item in evidence:
                                self.workbench.validate_evidence(
                                    provider_id=provider_id,
                                    model_id=model_id,
                                    operation=operation,
                                    actor_id=actor_id,
                                    **evidence_item,
                                )
                        except ModelCapabilityWorkbenchValidation as error:
                            raise ModelCapabilityImportInvalid(
                                "source_format",
                                model_id=model_id,
                                operation=operation,
                            ) from error
                        records.append(
                            {
                                "provider_id": provider_id,
                                "model_id": model_id,
                                "model_name": name,
                                "operation": operation,
                                "capability": self._apply_choice(
                                    base, imported_operation
                                ),
                                "evidence": evidence,
                            }
                        )
                        affected_variants.add((provider_id, model_id))
                operation_count += 1

        preview = {
            "schema_version": IMPORT_SCHEMA_VERSION,
            "models": len(seen_models),
            "operations": operation_count,
            "platform_variants": len(affected_variants),
            "models_unchanged": max(0, len(current_rows) - len(seen_models)),
            "model_ids": sorted(seen_models),
        }
        if not apply:
            return {"applied": False, "preview": preview}
        publication = self.workbench.publish_manual_capabilities(
            records=records,
            model_name="",
            active_catalog_revision=current["catalog_revision"],
            actor_id=actor_id,
            activate=self.catalog.refresh,
        )
        return {
            "applied": True,
            "preview": preview,
            "published": publication["published"],
            "catalog": publication["catalog"],
            "matrix": self.snapshot(),
        }

    @staticmethod
    def _validate_import_video(
        profile: object, *, model_id: str, operation: str
    ) -> None:
        if profile is None:
            return
        invalid = ModelCapabilityImportInvalid(
            "operation_format", model_id=model_id, operation=operation
        )
        if (
            operation != "video.generate"
            or not isinstance(profile, Mapping)
            or set(profile) != set(IMPORT_VIDEO_FIELDS)
        ):
            raise invalid
        total_maximum = profile.get("input_total_maximum")
        if (
            isinstance(total_maximum, bool)
            or not isinstance(total_maximum, int)
            or not 0 <= total_maximum <= 100
            or not isinstance(profile.get("audio_only_supported"), bool)
        ):
            raise invalid
        reference_duration = profile.get("reference_media_duration_seconds")
        modes = profile.get("modes")
        if (
            not isinstance(reference_duration, Mapping)
            or set(reference_duration) != set(IMPORT_VIDEO_DURATION_FIELDS)
            or not isinstance(modes, Mapping)
            or set(modes) != set(IMPORT_VIDEO_MODE_FIELDS)
            or any(not isinstance(value, bool) for value in modes.values())
        ):
            raise invalid
        bounds = [
            reference_duration.get("each"),
            reference_duration.get("combined_total"),
            profile.get("output_duration_seconds"),
        ]
        for index, value in enumerate(bounds):
            minimum_allowed, maximum_allowed = ((0, 3600) if index < 2 else (1, 600))
            if not isinstance(value, Mapping) or set(value) != set(IMPORT_BOUNDS_FIELDS):
                raise invalid
            minimum = value.get("minimum")
            maximum = value.get("maximum")
            if (
                isinstance(minimum, bool)
                or isinstance(maximum, bool)
                or not isinstance(minimum, int)
                or not isinstance(maximum, int)
                or not minimum_allowed <= minimum <= maximum <= maximum_allowed
            ):
                raise invalid

    @staticmethod
    def _import_evidence(
        sources: object,
        *,
        model_id: str,
        operation: str,
        fetched_at: str,
    ) -> list[dict[str, str]]:
        if not isinstance(sources, list) or not sources or len(sources) > 20:
            raise ModelCapabilityImportInvalid(
                "sources_required", model_id=model_id, operation=operation
            )
        result: list[dict[str, str]] = []
        for source in sources:
            if (
                not isinstance(source, Mapping)
                or set(source) != set(IMPORT_SOURCE_FIELDS)
            ):
                raise ModelCapabilityImportInvalid(
                    "source_format", model_id=model_id, operation=operation
                )
            source_type = _clean(source.get("type"))
            url = _clean(source.get("url"))
            title = _clean(source.get("title"))
            excerpt = _clean(source.get("excerpt"))
            if (
                source_type not in IMPORT_SOURCE_TYPES
                or not url.startswith(("https://", "http://"))
                or not title
                or not excerpt
            ):
                raise ModelCapabilityImportInvalid(
                    "source_format", model_id=model_id, operation=operation
                )
            result.append(
                {
                    "source_type": source_type,
                    "source_locator": url,
                    "fetched_at": fetched_at,
                    "applicable_version": model_id,
                    "content_location": title,
                    "excerpt": excerpt,
                }
            )
        return result

    @staticmethod
    def _apply_video_profile(
        candidate: dict[str, Any], choice: Mapping[str, Any]
    ) -> None:
        profile = choice.get("video")
        if not isinstance(profile, Mapping):
            return
        total_maximum = _number(profile.get("input_total_maximum"))
        total_maximum = max(0, min(100, total_maximum or 0))
        reference_duration = profile.get("reference_media_duration_seconds")
        reference_duration = (
            reference_duration if isinstance(reference_duration, Mapping) else {}
        )
        each_duration = _normalized_bounds(
            reference_duration.get("each"),
            minimum_allowed=0,
            maximum_allowed=3600,
        )
        combined_duration = _normalized_bounds(
            reference_duration.get("combined_total"),
            minimum_allowed=0,
            maximum_allowed=3600,
        )
        output_duration = _normalized_bounds(
            profile.get("output_duration_seconds"),
            minimum_allowed=1,
            maximum_allowed=600,
        )
        modes = profile.get("modes")
        modes = modes if isinstance(modes, Mapping) else {}
        supports_first_last = bool(modes.get(VIDEO_MODE_FIRST_LAST_FRAMES))
        supports_all_around = bool(modes.get(VIDEO_MODE_ALL_AROUND))
        audio_maximum = _maximum(candidate.get("inputs", {}).get("audio"))
        audio_only_supported = bool(profile.get("audio_only_supported")) and bool(
            audio_maximum
        )

        input_rules = candidate.get("input_rules")
        input_rules = copy.deepcopy(input_rules) if isinstance(input_rules, Mapping) else {}
        totals = [
            copy.deepcopy(item)
            for item in input_rules.get("totals", [])
            if isinstance(item, Mapping)
            and _clean(item.get("id")) != "reference_media"
        ]
        if total_maximum:
            totals.append(
                {
                    "id": "reference_media",
                    "inputs": ["image", "video", "audio"],
                    "minimum": 1,
                    "maximum": total_maximum,
                    "active_when_any_present": True,
                }
            )
        requirements = [
            copy.deepcopy(item)
            for item in input_rules.get("requirements", [])
            if isinstance(item, Mapping)
            and _clean(item.get("id")) != "visual_reference"
        ]
        if audio_maximum and not audio_only_supported:
            requirements.append(
                {
                    "id": "visual_reference",
                    "when": {"input": "audio", "minimum": 1},
                    "any_of": ["image", "video"],
                    "minimum": 1,
                }
            )
        role_groups = [
            copy.deepcopy(item)
            for item in input_rules.get("role_groups", [])
            if isinstance(item, Mapping)
            and _clean(item.get("id")) != VIDEO_MODE_FIRST_LAST_FRAMES
        ]
        if supports_first_last:
            role_groups.append(
                {
                    "id": VIDEO_MODE_FIRST_LAST_FRAMES,
                    "input": "image",
                    "roles": ["first_frame", "last_frame"],
                    "minimum": 1,
                    "maximum": 2,
                    "exclusive_inputs": ["video", "audio"],
                }
            )
        input_rules.update(
            {
                "totals": totals,
                "requirements": requirements,
                "role_groups": role_groups,
            }
        )
        candidate["input_rules"] = input_rules

        output = candidate.get("output")
        output = output if isinstance(output, dict) else {}
        output["duration_seconds"] = copy.deepcopy(output_duration)
        candidate["output"] = output
        parameters = candidate.get("parameters")
        parameters = parameters if isinstance(parameters, dict) else {}
        duration_parameter = parameters.get("duration_seconds")
        duration_parameter = (
            duration_parameter if isinstance(duration_parameter, dict) else {}
        )
        duration_parameter.update(output_duration)
        if duration_parameter.get("default") is not None:
            duration_parameter["default"] = max(
                output_duration["minimum"],
                min(
                    output_duration["maximum"],
                    int(duration_parameter.get("default") or output_duration["minimum"]),
                ),
            )
        parameters["duration_seconds"] = duration_parameter
        candidate["parameters"] = parameters

        media_contract = candidate.get("media_contract")
        media_contract = (
            media_contract if isinstance(media_contract, dict) else {}
        )
        media_contract[VIDEO_PROFILE_KEY] = {
            "input_total_maximum": total_maximum,
            "reference_media_duration_seconds": {
                "each": each_duration,
                "combined_total": combined_duration,
            },
            "audio_only_supported": audio_only_supported,
            "modes": {
                VIDEO_MODE_FIRST_LAST_FRAMES: supports_first_last,
                VIDEO_MODE_ALL_AROUND: supports_all_around,
            },
        }
        candidate["media_contract"] = media_contract

    @staticmethod
    def _apply_choice(
        base: Mapping[str, Any], choice: Mapping[str, Any]
    ) -> dict[str, Any]:
        operation = _clean(base.get("operation"))
        candidate = {
            key: copy.deepcopy(base[key])
            for key in EDITABLE_CAPABILITY_FIELDS
            if key in base
        }
        candidate.setdefault("support_state", "unknown")
        candidate.setdefault("inputs", {})
        candidate.setdefault("output", {})
        candidate.setdefault("parameters", {})
        candidate["support_state"] = (
            "supported" if bool(choice.get("confirmed")) else "unknown"
        )
        chosen_inputs = choice.get("inputs")
        chosen_inputs = chosen_inputs if isinstance(chosen_inputs, Mapping) else {}
        if operation == "image.layer_decomposition":
            chosen_inputs = {
                "text": 1,
                "image": 1,
                "video": 0,
                "audio": 0,
                "file": 0,
            }
        for input_type in INPUT_TYPES:
            raw_maximum = chosen_inputs.get(input_type, 0)
            maximum = max(0, min(100, int(raw_maximum or 0)))
            contract = candidate["inputs"].get(input_type)
            contract = copy.deepcopy(contract) if isinstance(contract, Mapping) else {}
            contract["maximum"] = maximum
            contract["minimum"] = min(
                maximum,
                max(0, int(contract.get("minimum") or 0)),
            )
            contract["required"] = bool(contract["minimum"])
            candidate["inputs"][input_type] = contract

        resolutions = _unique(choice.get("resolutions") or [])
        aspect_ratios = _unique(choice.get("aspect_ratios") or [])
        output_count = max(1, min(100, int(choice.get("output_count_maximum") or 1)))
        if operation == "image.layer_decomposition":
            resolutions = [
                value
                for value in resolutions
                if value in {"auto", "1K", "1.5K", "2K"}
            ]
            aspect_ratios = []
            output_count = 1
        output = candidate["output"]
        if isinstance(output.get("count"), Mapping):
            output["count"]["maximum"] = output_count
            output["count"]["minimum"] = min(
                output_count, max(1, int(output["count"].get("minimum") or 1))
            )
            output["count"]["default"] = min(
                output_count, max(1, int(output["count"].get("default") or 1))
            )
        if "resolution_tiers" in output:
            output["resolution_tiers"] = resolutions
        if "resolutions" in output:
            output["resolutions"] = resolutions
        if "aspect_ratios" in output:
            output["aspect_ratios"] = aspect_ratios

        parameters = candidate["parameters"]
        for key in RESOLUTION_PARAMETERS:
            contract = parameters.get(key)
            if isinstance(contract, Mapping):
                contract["values"] = resolutions
                if contract.get("default") not in resolutions:
                    contract["default"] = resolutions[0] if resolutions else None
        aspect = parameters.get("aspect_ratio")
        if isinstance(aspect, Mapping):
            aspect["values"] = aspect_ratios
            if aspect.get("default") not in aspect_ratios:
                aspect["default"] = aspect_ratios[0] if aspect_ratios else None
        count = parameters.get("count")
        if isinstance(count, Mapping):
            count["maximum"] = output_count
            count["minimum"] = min(output_count, max(1, int(count.get("minimum") or 1)))
            count["default"] = min(output_count, max(1, int(count.get("default") or 1)))
        selected_options = set(_unique(choice.get("options") or []))
        if operation == "image.layer_decomposition":
            selected_options.clear()
        for key, contract in parameters.items():
            if isinstance(contract, Mapping) and contract.get("type") == "boolean":
                supported = key in selected_options
                contract["values"] = [False, True] if supported else [False]
                contract["default"] = False
                contract["visible"] = supported
                contract["editable"] = supported
        media_contract = candidate.get("media_contract")
        if isinstance(media_contract, dict):
            media_contract["output_count_maximum"] = output_count
            if "resolution_tiers" in media_contract:
                media_contract["resolution_tiers"] = resolutions
            if "aspect_ratios" in media_contract:
                media_contract["aspect_ratios"] = aspect_ratios
            if "supports_transparent_png" in media_contract:
                media_contract["supports_transparent_png"] = (
                    "transparent_png" in selected_options
                )
            if operation == "video.generate":
                composer_options = media_contract.get("composer_options")
                composer_options = (
                    composer_options if isinstance(composer_options, dict) else {}
                )
                for key in IMPORT_OPTIONS_BY_OPERATION["video.generate"]:
                    composer_options[key] = (
                        "user_toggle" if key in selected_options else "unsupported"
                    )
                media_contract["composer_options"] = composer_options
        if operation == "video.generate":
            ModelCapabilityMatrix._apply_video_profile(candidate, choice)
        return candidate

__all__ = [
    "IMPORT_SCHEMA_VERSION",
    "INPUT_TYPES",
    "MODEL_TYPES",
    "ModelCapabilityImportInvalid",
    "ModelCapabilityMatrix",
]
