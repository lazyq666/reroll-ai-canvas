"""Administrator-owned evidence and review state for model capabilities."""

from __future__ import annotations

import copy
import datetime as _datetime
import json
import os
import uuid
from pathlib import Path
from threading import RLock
from collections.abc import Mapping
from typing import Any, Callable

from .model_capabilities import (
    SUPPORTED_OPERATIONS,
    SUPPORT_STATES,
    _assert_no_forbidden_fields,
)


WORKBENCH_SCHEMA_VERSION = 1
EVIDENCE_SOURCE_TYPES = frozenset(
    {"official_docs", "structured_api", "cli_help", "workflow_schema", "manual"}
)
EVIDENCE_CONFIDENCE = frozenset({"low", "medium", "high"})
CAPABILITY_FIELDS = frozenset(
    {
        "support_state",
        "source",
        "source_url",
        "confirmed_at",
        "inputs",
        "input_rules",
        "output",
        "parameters",
        "media_contract",
    }
)
CAPABILITY_PARAMETER_TYPES = frozenset(
    {"array", "boolean", "enum", "integer", "number", "string"}
)


class ModelCapabilityWorkbenchError(RuntimeError):
    """Base error returned across the workbench interface."""


class ModelCapabilityWorkbenchValidation(ModelCapabilityWorkbenchError):
    """The requested evidence or review transition is invalid."""


class ModelCapabilityWorkbenchConflict(ModelCapabilityWorkbenchError):
    """The requested transition conflicts with current workbench state."""


class ModelCapabilityWorkbenchPublication(ModelCapabilityWorkbenchError):
    """The published snapshot could not become the active runtime catalog."""


def _now() -> str:
    return _datetime.datetime.now(_datetime.timezone.utc).isoformat()


def _clean(value: object) -> str:
    return str(value or "").strip()


def _empty_state() -> dict[str, Any]:
    return {
        "version": WORKBENCH_SCHEMA_VERSION,
        "evidence": [],
        "drafts": [],
        "published": {"published_at": None, "capabilities": []},
    }


class ModelCapabilityWorkbench:
    """Own the Evidence → Draft → Review → Publish lifecycle behind one seam."""

    def __init__(
        self,
        path: str | Path,
        *,
        clock: Callable[[], str] = _now,
    ) -> None:
        self.path = Path(path)
        self._clock = clock
        self._lock = RLock()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._read())

    def record_evidence(
        self,
        *,
        provider_id: str,
        model_id: str,
        operation: str,
        source_type: str,
        source_locator: str,
        fetched_at: str,
        applicable_version: str,
        content_location: str,
        excerpt: str,
        actor_id: str,
    ) -> dict[str, Any]:
        identity = self._identity(provider_id, model_id, operation)
        values = {
            "source_locator": _clean(source_locator),
            "fetched_at": _clean(fetched_at),
            "applicable_version": _clean(applicable_version),
            "content_location": _clean(content_location),
            "excerpt": _clean(excerpt),
            "actor_id": _clean(actor_id),
        }
        missing = next((key for key, value in values.items() if not value), None)
        if missing:
            raise ModelCapabilityWorkbenchValidation(
                f"evidence field is required: {missing}"
            )
        normalized_source_type = _clean(source_type).lower()
        if normalized_source_type not in EVIDENCE_SOURCE_TYPES:
            raise ModelCapabilityWorkbenchValidation(
                f"unsupported evidence source type: {normalized_source_type or 'empty'}"
            )
        evidence = {
            "id": str(uuid.uuid4()),
            **identity,
            "source_type": normalized_source_type,
            "source_locator": values["source_locator"],
            "fetched_at": values["fetched_at"],
            "applicable_version": values["applicable_version"],
            "content_location": values["content_location"],
            "excerpt": values["excerpt"],
            "created_by": values["actor_id"],
            "created_at": self._clock(),
        }
        with self._lock:
            state = self._read()
            state["evidence"].append(evidence)
            self._write(state)
        return copy.deepcopy(evidence)

    def save_draft(
        self,
        *,
        draft_id: str = "",
        provider_id: str,
        model_id: str,
        operation: str,
        capability: Mapping[str, Any],
        field_evidence: Mapping[str, Any],
        base_catalog_revision: str,
        actor_id: str,
    ) -> dict[str, Any]:
        identity = self._identity(provider_id, model_id, operation)
        actor = _clean(actor_id)
        base_revision = _clean(base_catalog_revision)
        if not actor:
            raise ModelCapabilityWorkbenchValidation("draft actor is required")
        if not base_revision:
            raise ModelCapabilityWorkbenchValidation(
                "draft base catalog revision is required"
            )
        candidate = copy.deepcopy(dict(capability or {}))
        unsupported = sorted(set(candidate) - CAPABILITY_FIELDS)
        if unsupported:
            raise ModelCapabilityWorkbenchValidation(
                f"unsupported draft capability field: {unsupported[0]}"
            )
        support_state = _clean(candidate.get("support_state"))
        if support_state not in SUPPORT_STATES:
            raise ModelCapabilityWorkbenchValidation(
                "draft support_state must be supported or unknown"
            )
        for required_mapping in ("inputs", "output", "parameters"):
            if not isinstance(candidate.get(required_mapping), Mapping):
                raise ModelCapabilityWorkbenchValidation(
                    f"draft capability field must be an object: {required_mapping}"
                )
        _assert_no_forbidden_fields(candidate, path="draft.capability")
        self._validate_capability_contract(candidate)
        bindings = copy.deepcopy(dict(field_evidence or {}))
        leaf_paths = set(self._leaf_paths(candidate))
        if set(bindings) != leaf_paths:
            missing = sorted(leaf_paths - set(bindings))
            extra = sorted(set(bindings) - leaf_paths)
            field = missing[0] if missing else extra[0]
            raise ModelCapabilityWorkbenchValidation(
                f"draft field evidence does not match capability: {field}"
            )

        with self._lock:
            state = self._read()
            evidence_by_id = {
                _clean(item.get("id")): item
                for item in state["evidence"]
                if isinstance(item, Mapping)
            }
            for path, raw_binding in bindings.items():
                binding = raw_binding if isinstance(raw_binding, Mapping) else {}
                if set(binding) != {"evidence_ids", "confidence"}:
                    raise ModelCapabilityWorkbenchValidation(
                        f"draft field evidence has unsupported fields: {path}"
                    )
                raw_evidence_ids = binding.get("evidence_ids")
                if not isinstance(raw_evidence_ids, (list, tuple)):
                    raise ModelCapabilityWorkbenchValidation(
                        f"draft field evidence ids must be a list: {path}"
                    )
                evidence_ids = [
                    _clean(value) for value in raw_evidence_ids
                ]
                confidence = _clean(binding.get("confidence")).lower()
                if not evidence_ids or confidence not in EVIDENCE_CONFIDENCE:
                    raise ModelCapabilityWorkbenchValidation(
                        f"draft field evidence is incomplete: {path}"
                    )
                for evidence_id in evidence_ids:
                    evidence = evidence_by_id.get(evidence_id)
                    if evidence is None:
                        raise ModelCapabilityWorkbenchValidation(
                            f"draft evidence does not exist: {evidence_id}"
                        )
                    if any(evidence.get(key) != value for key, value in identity.items()):
                        raise ModelCapabilityWorkbenchValidation(
                            f"draft evidence identity does not match: {evidence_id}"
                        )
            timestamp = self._clock()
            requested_draft_id = _clean(draft_id)
            if requested_draft_id:
                draft = self._draft(state, requested_draft_id)
                if draft.get("review_state") not in {"draft", "returned"}:
                    raise ModelCapabilityWorkbenchConflict(
                        "only a draft or returned capability can be edited"
                    )
                if any(draft.get(key) != value for key, value in identity.items()):
                    raise ModelCapabilityWorkbenchConflict(
                        "a capability draft identity cannot be changed"
                    )
                draft.update(
                    {
                        "capability": candidate,
                        "field_evidence": bindings,
                        "base_catalog_revision": base_revision,
                        "review_state": "draft",
                        "updated_by": actor,
                        "updated_at": timestamp,
                        "submitted_at": None,
                        "reviewed_by": None,
                        "reviewed_at": None,
                        "review_note": "",
                        "published_at": None,
                    }
                )
            else:
                draft = {
                    "id": str(uuid.uuid4()),
                    **identity,
                    "capability": candidate,
                    "field_evidence": bindings,
                    "base_catalog_revision": base_revision,
                    "review_state": "draft",
                    "created_by": actor,
                    "created_at": timestamp,
                    "updated_by": actor,
                    "updated_at": timestamp,
                    "submitted_at": None,
                    "reviewed_by": None,
                    "reviewed_at": None,
                    "review_note": "",
                    "published_at": None,
                }
                state["drafts"].append(draft)
            self._write(state)
        return copy.deepcopy(draft)

    def submit_for_review(self, draft_id: str, *, actor_id: str) -> dict[str, Any]:
        actor = self._required_actor(actor_id)
        with self._lock:
            state = self._read()
            draft = self._draft(state, draft_id)
            if draft.get("review_state") not in {"draft", "returned"}:
                raise ModelCapabilityWorkbenchConflict(
                    "only a draft or returned capability can enter review"
                )
            timestamp = self._clock()
            draft["review_state"] = "in_review"
            draft["submitted_at"] = timestamp
            draft["updated_by"] = actor
            draft["updated_at"] = timestamp
            draft["review_note"] = ""
            self._write(state)
            return copy.deepcopy(draft)

    def return_for_changes(
        self,
        draft_id: str,
        *,
        actor_id: str,
        note: str,
    ) -> dict[str, Any]:
        actor = self._required_actor(actor_id)
        review_note = _clean(note)
        if not review_note:
            raise ModelCapabilityWorkbenchValidation("review note is required")
        with self._lock:
            state = self._read()
            draft = self._draft(state, draft_id)
            if draft.get("review_state") != "in_review":
                raise ModelCapabilityWorkbenchConflict(
                    "only a capability in review can be returned"
                )
            timestamp = self._clock()
            draft["review_state"] = "returned"
            draft["reviewed_by"] = actor
            draft["reviewed_at"] = timestamp
            draft["review_note"] = review_note
            draft["updated_by"] = actor
            draft["updated_at"] = timestamp
            self._write(state)
            return copy.deepcopy(draft)

    def publish(
        self,
        draft_id: str,
        *,
        actor_id: str,
        active_catalog_revision: str,
        activate: Callable[[], Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        actor = self._required_actor(actor_id)
        active_revision = _clean(active_catalog_revision)
        if not active_revision:
            raise ModelCapabilityWorkbenchValidation(
                "active catalog revision is required"
            )
        with self._lock:
            state = self._read()
            previous_state = copy.deepcopy(state)
            draft = self._draft(state, draft_id)
            if draft.get("review_state") != "in_review":
                raise ModelCapabilityWorkbenchConflict(
                    "only a capability in review can be published"
                )
            if draft.get("base_catalog_revision") != active_revision:
                raise ModelCapabilityWorkbenchConflict(
                    "catalog changed after this draft was created"
                )
            timestamp = self._clock()
            published_record = {
                "draft_id": draft["id"],
                "provider_id": draft["provider_id"],
                "model_id": draft["model_id"],
                "operation": draft["operation"],
                "capability": copy.deepcopy(draft["capability"]),
                "field_evidence": copy.deepcopy(draft["field_evidence"]),
                "published_by": actor,
                "published_at": timestamp,
            }
            identity = (
                draft["provider_id"],
                draft["model_id"],
                draft["operation"],
            )
            current = state["published"]["capabilities"]
            state["published"]["capabilities"] = [
                item
                for item in current
                if not isinstance(item, Mapping)
                or (
                    item.get("provider_id"),
                    item.get("model_id"),
                    item.get("operation"),
                )
                != identity
            ]
            state["published"]["capabilities"].append(published_record)
            state["published"]["published_at"] = timestamp
            draft["review_state"] = "published"
            draft["reviewed_by"] = actor
            draft["reviewed_at"] = timestamp
            draft["published_at"] = timestamp
            draft["updated_by"] = actor
            draft["updated_at"] = timestamp
            self._write(state)
            if activate is not None:
                try:
                    activation = activate()
                except Exception as error:
                    self._write(previous_state)
                    raise ModelCapabilityWorkbenchPublication(
                        "model capability catalog activation failed"
                    ) from error
                if not isinstance(activation, Mapping) or not activation.get("ok"):
                    self._write(previous_state)
                    raise ModelCapabilityWorkbenchPublication(
                        "model capability catalog activation failed"
                    )
            return copy.deepcopy(draft)

    @staticmethod
    def _required_actor(actor_id: object) -> str:
        actor = _clean(actor_id)
        if not actor:
            raise ModelCapabilityWorkbenchValidation("actor is required")
        return actor

    @staticmethod
    def _draft(state: Mapping[str, Any], draft_id: object) -> dict[str, Any]:
        requested = _clean(draft_id)
        draft = next(
            (
                item
                for item in state.get("drafts") or []
                if isinstance(item, dict) and item.get("id") == requested
            ),
            None,
        )
        if draft is None:
            raise ModelCapabilityWorkbenchValidation("capability draft does not exist")
        return draft

    @classmethod
    def _leaf_paths(cls, value: Any, path: str = "") -> list[str]:
        if isinstance(value, Mapping):
            paths: list[str] = []
            for key, child in value.items():
                escaped = str(key).replace("~", "~0").replace("/", "~1")
                paths.extend(cls._leaf_paths(child, f"{path}/{escaped}"))
            return paths
        if isinstance(value, (list, tuple)):
            paths = []
            for index, child in enumerate(value):
                paths.extend(cls._leaf_paths(child, f"{path}/{index}"))
            return paths
        return [path or "/"]

    @classmethod
    def _validate_capability_contract(cls, capability: Mapping[str, Any]) -> None:
        for group_name in ("inputs", "parameters"):
            group = capability.get(group_name)
            if not isinstance(group, Mapping):
                continue
            for field, contract in group.items():
                if not isinstance(contract, Mapping):
                    raise ModelCapabilityWorkbenchValidation(
                        f"capability contract must be an object: {group_name}.{field}"
                    )
                if group_name == "parameters" and contract.get("type") is not None:
                    parameter_type = _clean(contract.get("type")).lower()
                    if parameter_type not in CAPABILITY_PARAMETER_TYPES:
                        raise ModelCapabilityWorkbenchValidation(
                            f"unsupported capability parameter type: {parameter_type}"
                        )
        cls._validate_bounds(capability)

    @classmethod
    def _validate_bounds(cls, value: Any, path: str = "capability") -> None:
        if isinstance(value, Mapping):
            minimum = value.get("minimum")
            maximum = value.get("maximum")
            numeric_minimum = isinstance(minimum, (int, float)) and not isinstance(
                minimum, bool
            )
            numeric_maximum = isinstance(maximum, (int, float)) and not isinstance(
                maximum, bool
            )
            if numeric_minimum and numeric_maximum and minimum > maximum:
                raise ModelCapabilityWorkbenchValidation(
                    f"capability minimum exceeds maximum: {path}"
                )
            for key, child in value.items():
                cls._validate_bounds(child, f"{path}.{key}")
        elif isinstance(value, (list, tuple)):
            for index, child in enumerate(value):
                cls._validate_bounds(child, f"{path}[{index}]")

    @staticmethod
    def _identity(
        provider_id: object,
        model_id: object,
        operation: object,
    ) -> dict[str, str]:
        identity = {
            "provider_id": _clean(provider_id).lower(),
            "model_id": _clean(model_id),
            "operation": _clean(operation).lower(),
        }
        missing = next((key for key, value in identity.items() if not value), None)
        if missing:
            raise ModelCapabilityWorkbenchValidation(
                f"capability identity is required: {missing}"
            )
        if identity["operation"] not in SUPPORTED_OPERATIONS:
            raise ModelCapabilityWorkbenchValidation(
                f"unsupported model operation: {identity['operation']}"
            )
        return identity

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return _empty_state()
        try:
            state = json.loads(self.path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            raise ModelCapabilityWorkbenchValidation(
                "model capability workbench state is unreadable"
            ) from error
        if not isinstance(state, dict) or state.get("version") != WORKBENCH_SCHEMA_VERSION:
            raise ModelCapabilityWorkbenchValidation(
                "unsupported model capability workbench schema"
            )
        if not isinstance(state.get("evidence"), list):
            raise ModelCapabilityWorkbenchValidation("workbench evidence must be a list")
        if not isinstance(state.get("drafts"), list):
            raise ModelCapabilityWorkbenchValidation("workbench drafts must be a list")
        published = state.get("published")
        if not isinstance(published, dict) or not isinstance(
            published.get("capabilities"), list
        ):
            raise ModelCapabilityWorkbenchValidation(
                "workbench published capabilities must be a list"
            )
        return state

    def _write(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as output:
                json.dump(state, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


__all__ = [
    "EVIDENCE_SOURCE_TYPES",
    "ModelCapabilityWorkbench",
    "ModelCapabilityWorkbenchConflict",
    "ModelCapabilityWorkbenchError",
    "ModelCapabilityWorkbenchPublication",
    "ModelCapabilityWorkbenchValidation",
    "WORKBENCH_SCHEMA_VERSION",
]
