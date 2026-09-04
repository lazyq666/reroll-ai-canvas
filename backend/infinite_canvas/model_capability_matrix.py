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
            for variant in row["variants"]:
                for operation in OPERATIONS_BY_TYPE.get(variant["type"], ()):
                    capability = self.catalog.resolve(
                        variant["provider_id"], row["model_id"], operation
                    )
                    draft = draft_capabilities.get(
                        (variant["provider_id"], row["model_id"], operation)
                    )
                    if isinstance(draft, Mapping):
                        capability = _merge(capability, draft)
                    operation_records.setdefault(operation, []).append(capability)
            row["operations"] = [
                self._operation_projection(operation, capabilities)
                for operation, capabilities in operation_records.items()
            ]
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
    def _operation_projection(
        operation: str, capabilities: Sequence[Mapping[str, Any]]
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
        return {
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
                if (
                    not isinstance(imported_operation, Mapping)
                    or set(imported_operation) != set(IMPORT_OPERATION_FIELDS)
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
        return candidate

__all__ = [
    "IMPORT_SCHEMA_VERSION",
    "INPUT_TYPES",
    "MODEL_TYPES",
    "ModelCapabilityImportInvalid",
    "ModelCapabilityMatrix",
]
