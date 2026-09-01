"""Split team generation choices from device-specific provider connections."""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Iterable


SETTINGS_VERSION = 1
SHARED_PROVIDER_FIELDS = frozenset(
    {
        "id",
        "name",
        "protocol",
        "enabled",
        "primary",
        "image_models",
        "chat_models",
        "video_models",
        "model_names",
        "model_protocols",
        "image_capabilities",
        "default_image_resolution",
        "ms_loras",
        "ms_defaults_version",
        "rh_apps",
        "rh_workflows",
    }
)
LOCAL_PROVIDER_FIELDS = frozenset(
    {
        "base_url",
        "image_request_mode",
        "image_generation_endpoint",
        "image_edit_endpoint",
        "volcengine_project_name",
        "volcengine_region",
    }
)
_SENSITIVE_KEY_PARTS = (
    "api_key",
    "apikey",
    "access_key",
    "private_key",
    "token",
    "secret",
    "password",
    "credential",
    "authorization",
    "cookie",
)
_DEVICE_LOCAL_NESTED_KEYS = frozenset(
    {
        "address",
        "base_url",
        "endpoint",
        "host",
        "hostname",
        "uri",
        "url",
        "volcengine_project_name",
        "volcengine_region",
    }
)


def _sensitive_key(key: object) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(key or "").lower()).strip("_")
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _device_local_nested_key(key: object) -> bool:
    normalized = re.sub(
        r"[^a-z0-9]+",
        "_",
        str(key or "").lower(),
    ).strip("_")
    return (
        normalized in _DEVICE_LOCAL_NESTED_KEYS
        or normalized.endswith(
            ("_address", "_endpoint", "_host", "_uri", "_url")
        )
    )


def _partition_shared(value: Any) -> tuple[Any, Any]:
    if isinstance(value, dict):
        shared = {}
        local = {}
        for key, item in value.items():
            name = str(key)
            if _sensitive_key(name) or _device_local_nested_key(name):
                local[name] = item
                continue
            shared_item, local_item = _partition_shared(item)
            shared[name] = shared_item
            if local_item is not None:
                local[name] = local_item
        return shared, local or None
    if isinstance(value, list):
        shared = []
        local = []
        has_local = False
        for item in value:
            shared_item, local_item = _partition_shared(item)
            shared.append(shared_item)
            local.append(local_item)
            has_local = has_local or local_item is not None
        return shared, local if has_local else None
    if isinstance(value, tuple):
        return _partition_shared(list(value))
    return value, None


def _atomic_json_write(path: Path, payload: Any, *, private: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if private:
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _provider_id(provider: dict[str, Any]) -> str:
    return str(provider.get("id") or "").strip().lower()


def _split_provider(
    provider: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    provider_id = _provider_id(provider)
    if not provider_id:
        return {}, {}, {}
    shared = {}
    nested_local = {}
    for key, value in provider.items():
        if key not in SHARED_PROVIDER_FIELDS:
            continue
        shared_value, local_value = _partition_shared(value)
        shared[key] = shared_value
        if local_value is not None:
            nested_local[key] = local_value
    shared["id"] = provider_id
    local = {
        "id": provider_id,
        **{
            key: value
            for key, value in provider.items()
            if key in LOCAL_PROVIDER_FIELDS
        },
    }
    unknown = {
        key: value
        for key, value in provider.items()
        if key not in SHARED_PROVIDER_FIELDS
        and key not in LOCAL_PROVIDER_FIELDS
    }
    if nested_local:
        unknown["_nested_local"] = nested_local
    return shared, local, unknown


class GenerationSettingsService:
    """Persist one Workspace's shared choices and this device's connections."""

    def __init__(
        self,
        shared_settings_path: str | Path,
        local_connections_path: str | Path,
    ) -> None:
        self.shared_settings_path = (
            Path(shared_settings_path).expanduser().resolve()
        )
        self.local_connections_path = (
            Path(local_connections_path).expanduser().resolve()
        )

    @staticmethod
    def _read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, TypeError):
            return fallback

    def _read_local(
        self,
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        raw = self._read_json(self.local_connections_path, {})
        raw = raw if isinstance(raw, dict) else {}
        connections: dict[str, dict[str, Any]] = {}
        for item in raw.get("connections") or []:
            if not isinstance(item, dict):
                continue
            provider_id = _provider_id(item)
            if provider_id:
                connections[provider_id] = {
                    **item,
                    "id": provider_id,
                }
        raw_unclassified = raw.get("unclassified")
        unclassified = {
            str(provider_id): dict(values)
            for provider_id, values in (
                raw_unclassified.items()
                if isinstance(raw_unclassified, dict)
                else []
            )
            if isinstance(values, dict)
        }
        return connections, unclassified

    def _write_local(
        self,
        connections: dict[str, dict[str, Any]],
        unclassified: dict[str, dict[str, Any]],
    ) -> None:
        _atomic_json_write(
            self.local_connections_path,
            {
                "version": SETTINGS_VERSION,
                "connections": list(connections.values()),
                "unclassified": unclassified,
            },
            private=True,
        )

    def _split_all(
        self,
        providers: Iterable[dict[str, Any]],
    ) -> tuple[
        list[dict[str, Any]],
        dict[str, dict[str, Any]],
        dict[str, dict[str, Any]],
    ]:
        shared_providers = []
        local_connections: dict[str, dict[str, Any]] = {}
        unclassified: dict[str, dict[str, Any]] = {}
        for provider in providers or []:
            if not isinstance(provider, dict):
                continue
            shared, local, unknown = _split_provider(provider)
            if not shared:
                continue
            provider_id = shared["id"]
            shared_providers.append(shared)
            local_connections[provider_id] = local
            if unknown:
                unclassified[provider_id] = unknown
        return shared_providers, local_connections, unclassified

    def load(self) -> list[dict[str, Any]]:
        raw = self._read_json(self.shared_settings_path, [])
        raw_providers = (
            [item for item in raw if isinstance(item, dict)]
            if isinstance(raw, list)
            else []
        )
        shared, migrated_local, migrated_unknown = self._split_all(
            raw_providers
        )
        local, unclassified = self._read_local()
        if shared != raw_providers:
            for provider_id, values in migrated_local.items():
                existing = local.get(provider_id, {})
                local[provider_id] = {**values, **existing, "id": provider_id}
            for provider_id, values in migrated_unknown.items():
                existing = unclassified.get(provider_id, {})
                unclassified[provider_id] = {**values, **existing}
            self._write_local(local, unclassified)
            _atomic_json_write(
                self.shared_settings_path,
                shared,
                private=False,
            )

        merged = []
        for provider in shared:
            provider_id = provider["id"]
            connection = local.get(provider_id, {})
            merged.append(
                {
                    **provider,
                    **{
                        key: value
                        for key, value in connection.items()
                        if key in LOCAL_PROVIDER_FIELDS
                    },
                }
            )
        return merged

    def save(self, providers: Iterable[dict[str, Any]]) -> None:
        shared, updates, new_unknown = self._split_all(providers)
        local, unclassified = self._read_local()
        for provider_id, values in updates.items():
            local[provider_id] = {
                **local.get(provider_id, {}),
                **values,
                "id": provider_id,
            }
        for provider_id, values in new_unknown.items():
            unclassified[provider_id] = {
                **unclassified.get(provider_id, {}),
                **values,
            }
        self._write_local(local, unclassified)
        _atomic_json_write(
            self.shared_settings_path,
            shared,
            private=False,
        )


__all__ = [
    "GenerationSettingsService",
    "LOCAL_PROVIDER_FIELDS",
    "SETTINGS_VERSION",
    "SHARED_PROVIDER_FIELDS",
]
