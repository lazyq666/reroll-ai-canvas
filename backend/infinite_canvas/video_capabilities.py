"""Maintained video model capabilities for Smart Canvas Composer."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from threading import RLock
from typing import Any, Mapping
from urllib.parse import urlsplit


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _normalized_model_id(value: Any) -> str:
    return "".join(
        character
        for character in _clean_text(value).lower()
        if character not in {"_", ".", "-"}
    )


def _url_parts(value: Any) -> tuple[str, str]:
    text = _clean_text(value)
    if not text:
        return "", ""
    try:
        parsed = urlsplit(text if "://" in text else f"https://{text}")
    except ValueError:
        return "", ""
    return (parsed.hostname or "").lower(), (parsed.path or "").rstrip("/")


def _host_matches(host: str, expected: Any) -> bool:
    suffix = _clean_text(expected).lower().lstrip(".")
    return bool(suffix and (host == suffix or host.endswith(f".{suffix}")))


class VideoCapabilityRegistry:
    """Read the project-owned video capability contract without model-name inference."""

    def __init__(self, maintained_path: str | Path | None = None) -> None:
        self._maintained_path = (
            Path(maintained_path) if maintained_path is not None else None
        )
        self._lock = RLock()
        self._maintained_payload: Mapping[str, Any] | None = None

    @property
    def source_path(self) -> Path | None:
        return self._maintained_path

    def replace_payload(self, payload: Mapping[str, Any]) -> None:
        """Publish a validated catalog snapshot for subsequent resolutions."""
        with self._lock:
            self._maintained_payload = copy.deepcopy(dict(payload))

    def _payload(self) -> dict[str, Any]:
        path = self._maintained_path
        with self._lock:
            value = copy.deepcopy(self._maintained_payload)
        if value is None:
            if path is None or not path.exists():
                return {}
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, TypeError, ValueError):
                return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _route_matches(
        route: Mapping[str, Any],
        *,
        provider_id: str,
        model_id: str,
        protocol: str,
        base_url: str,
    ) -> bool:
        host, path = _url_parts(base_url)
        provider_ids = {
            _clean_text(value).lower() for value in route.get("provider_ids", [])
        }
        protocols = {
            _clean_text(value).lower() for value in route.get("protocols", [])
        }
        hosts = route.get("base_url_hosts", [])
        has_identity_matcher = bool(provider_ids or protocols or hosts)
        identity_matches = (
            provider_id in provider_ids
            or protocol in protocols
            or any(_host_matches(host, value) for value in hosts)
        )
        if has_identity_matcher and not identity_matches:
            return False
        paths = {
            _clean_text(value).rstrip("/") for value in route.get("base_url_paths", [])
        }
        if paths and path not in paths:
            return False
        normalized_models = {
            _normalized_model_id(value)
            for value in route.get("normalized_model_ids", [])
        }
        if normalized_models and _normalized_model_id(model_id) not in normalized_models:
            return False
        prefixes = [
            _clean_text(value).lower()
            for value in route.get("model_prefixes", [])
            if _clean_text(value)
        ]
        if prefixes and not any(model_id.lower().startswith(value) for value in prefixes):
            return False
        return True

    def _backend_path(
        self,
        payload: Mapping[str, Any],
        *,
        provider_id: str,
        model_id: str,
        protocol: str,
        base_url: str,
    ) -> dict[str, Any]:
        contracts = payload.get("backend_path_contracts")
        routes = payload.get("backend_path_routing")
        contract_items = contracts if isinstance(contracts, Mapping) else {}
        route_items = routes if isinstance(routes, list) else []
        for route in route_items:
            if not isinstance(route, Mapping) or not self._route_matches(
                route,
                provider_id=provider_id,
                model_id=model_id,
                protocol=protocol,
                base_url=base_url,
            ):
                continue
            contract_id = _clean_text(route.get("contract_id"))
            contract = contract_items.get(contract_id)
            if not isinstance(contract, Mapping):
                continue
            return {"id": contract_id, **copy.deepcopy(dict(contract))}
        return {}

    def public(
        self,
        provider_id: str,
        model_id: str = "",
        *,
        protocol: str = "",
        base_url: str = "",
    ) -> dict[str, Any]:
        payload = self._payload()
        requested_provider = _clean_text(provider_id).lower()
        requested_model = _clean_text(model_id)
        requested_protocol = _clean_text(protocol).lower()
        backend_path = self._backend_path(
            payload,
            provider_id=requested_provider,
            model_id=requested_model,
            protocol=requested_protocol,
            base_url=_clean_text(base_url),
        )
        option_contract = payload.get("composer_option_contract")
        option_definitions = (
            option_contract.get("definitions")
            if isinstance(option_contract, Mapping)
            and isinstance(option_contract.get("definitions"), Mapping)
            else {}
        )
        maintained_provider = _clean_text(payload.get("provider_id")).lower()
        models = payload.get("models")
        profiles = payload.get("capability_profiles")
        model_items = models if isinstance(models, list) else []
        profile_items = profiles if isinstance(profiles, Mapping) else {}
        supported_models = [
            _clean_text(item.get("model_id"))
            for item in model_items
            if isinstance(item, Mapping) and _clean_text(item.get("model_id"))
        ]
        base = {
            "provider_id": requested_provider,
            "model_id": requested_model,
            "known": False,
            "source": "fallback",
            "confirmed_at": None,
            "supported_model_ids": (
                supported_models if requested_provider == maintained_provider else []
            ),
            "backend_path": backend_path,
            "composer_options": copy.deepcopy(
                backend_path.get("composer_options")
                if isinstance(backend_path.get("composer_options"), Mapping)
                else {}
            ),
            "composer_option_definitions": copy.deepcopy(option_definitions),
            "composer_policy": copy.deepcopy(
                payload.get("composer_policy")
                if requested_provider == maintained_provider
                and isinstance(payload.get("composer_policy"), Mapping)
                else {}
            ),
            "commands": {},
        }
        if requested_provider != maintained_provider or not requested_model:
            return base
        model = next(
            (
                item
                for item in model_items
                if isinstance(item, Mapping)
                and _clean_text(item.get("model_id")).lower()
                == requested_model.lower()
            ),
            None,
        )
        if model is None:
            return base
        profile_id = _clean_text(model.get("capability_profile_id"))
        profile = profile_items.get(profile_id)
        if not isinstance(profile, Mapping):
            return base
        source = payload.get("source")
        return {
            **base,
            "known": True,
            "source": "maintained",
            "confirmed_at": (
                _clean_text(source.get("confirmed_at")) or None
                if isinstance(source, Mapping)
                else None
            ),
            "access_requirement": _clean_text(
                model.get("access_requirement")
            ) or None,
            "capability_profile_id": profile_id,
            "commands": copy.deepcopy(
                profile.get("commands")
                if isinstance(profile.get("commands"), Mapping)
                else {}
            ),
        }

    def validate_references(
        self,
        provider_id: str,
        model_id: str,
        *,
        images: list[Any] | None = None,
        videos: list[Any] | None = None,
        audios: list[Any] | None = None,
        multimodal: bool = False,
    ) -> dict[str, Any]:
        capability = self.public(provider_id, model_id)
        if not capability.get("known"):
            return {"valid": True, "reason": "unknown-capability"}
        image_items = list(images or [])
        video_items = list(videos or [])
        audio_items = list(audios or [])
        roles = {
            _clean_text(
                item.get("role", "")
                if isinstance(item, Mapping)
                else getattr(item, "role", "")
            ).lower()
            for item in image_items
        }
        command = (
            "frames2video"
            if roles & {"first_frame", "last_frame"}
            else "multimodal2video"
            if multimodal or video_items or audio_items
            else "image2video"
            if image_items
            else "text2video"
        )
        command_capability = capability.get("commands", {}).get(command, {})
        if command in {"frames2video", "image2video"}:
            reason = "frame-count" if command == "frames2video" else "image-count"
            result = self._validate_count(
                len(image_items), command_capability.get("image_count", {}), reason
            )
            return {**result, "command": command}
        if command != "multimodal2video":
            return {"valid": True, "reason": "", "command": command}
        inputs = command_capability.get("inputs", {})
        if (
            inputs.get("audio_only_supported") is False
            and audio_items
            and not image_items
            and not video_items
        ):
            return {
                "valid": False,
                "reason": "visual-reference-required",
                "count": len(audio_items),
                "minimum": None,
                "maximum": None,
                "command": command,
            }
        for kind, count in (
            ("image", len(image_items)),
            ("video", len(video_items)),
            ("audio", len(audio_items)),
        ):
            result = self._validate_count(
                count, inputs.get(f"{kind}_count", {}), f"{kind}-count"
            )
            if not result["valid"]:
                return {**result, "command": command}
        result = self._validate_count(
            len(image_items) + len(video_items) + len(audio_items),
            inputs.get("total_count", {}),
            "total-count",
        )
        return {**result, "command": command}

    @staticmethod
    def _validate_count(count: int, limit: Any, reason: str) -> dict[str, Any]:
        values = limit if isinstance(limit, Mapping) else {}
        minimum = values.get("minimum")
        maximum = values.get("maximum")
        if isinstance(minimum, (int, float)) and count < minimum:
            return {
                "valid": False,
                "reason": reason,
                "count": count,
                "minimum": minimum,
                "maximum": maximum,
            }
        if isinstance(maximum, (int, float)) and count > maximum:
            return {
                "valid": False,
                "reason": reason,
                "count": count,
                "minimum": minimum,
                "maximum": maximum,
            }
        return {
            "valid": True,
            "reason": "",
            "count": count,
            "minimum": minimum,
            "maximum": maximum,
        }
