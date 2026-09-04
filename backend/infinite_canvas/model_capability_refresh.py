"""Automatic source refresh for reviewed model capability drafts.

The refresh layer may collect and cache source material, but it never publishes a
runtime capability.  A changed source becomes Evidence plus a Draft in the
administrator workbench; the existing review boundary remains the only path to
the active catalog.
"""

from __future__ import annotations

import asyncio
import copy
import datetime as _datetime
import hashlib
import json
import os
import random
import re
import shutil
import shlex
import urllib.parse
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any

import httpx

from .model_capability_workbench import ModelCapabilityWorkbench
from .outbound_security import httpx_get_public


REFRESH_CACHE_VERSION = 1
SOURCE_PAYLOAD_VERSION = 1
DEFAULT_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_BACKOFF_SECONDS = 5 * 60
MAX_BACKOFF_SECONDS = 6 * 60 * 60
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_SOURCE_RECORDS = 1000
MAX_CONFIGURED_SOURCES = 20
MAX_OBSERVED_FINGERPRINTS = 50000
AUTOMATION_ACTOR = "model-capability-refresh"
APIMART_SEEDREAM_DOCS_URL = (
    "https://docs.apimart.ai/en/api-reference/images/"
    "seedream-5-0-pro/generation"
)


def _utc_now() -> _datetime.datetime:
    return _datetime.datetime.now(_datetime.timezone.utc)


def _iso(value: _datetime.datetime) -> str:
    return value.astimezone(_datetime.timezone.utc).isoformat()


def _clean(value: object) -> str:
    return str(value or "").strip()


def _leaf_paths(value: Any, path: str = "") -> list[str]:
    if isinstance(value, Mapping):
        result: list[str] = []
        for key, child in value.items():
            escaped = str(key).replace("~", "~0").replace("/", "~1")
            result.extend(_leaf_paths(child, f"{path}/{escaped}"))
        return result
    if isinstance(value, (list, tuple)):
        result = []
        for index, child in enumerate(value):
            result.extend(_leaf_paths(child, f"{path}/{index}"))
        return result
    return [path or "/"]


def _fingerprint(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _record_fingerprint(value: Mapping[str, Any]) -> str:
    stable = copy.deepcopy(dict(value))
    evidence = stable.get("evidence")
    if isinstance(evidence, dict):
        evidence.pop("fetched_at", None)
    return _fingerprint(stable)


@dataclass(frozen=True)
class CapabilitySourceSnapshot:
    name: str
    records: tuple[Mapping[str, Any], ...]
    etag: str = ""
    last_modified: str = ""
    not_modified: bool = False


class JsonUrlCapabilitySource:
    """Fetch one bounded, schema-shaped capability source over public HTTP."""

    def __init__(
        self,
        name: str,
        url: str,
        *,
        fetcher: Callable[
            [str, Mapping[str, str]],
            Awaitable[tuple[int, Mapping[str, str], bytes]],
        ]
        | None = None,
    ) -> None:
        self.name = _clean(name)
        self.url = _clean(url)
        if not self.name or not self.url:
            raise ValueError("capability source name and URL are required")
        self._fetcher = fetcher or self._fetch

    async def collect(
        self, cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        cached_value = cached if isinstance(cached, Mapping) else {}
        headers = {"Accept": "application/json"}
        if _clean(cached_value.get("etag")):
            headers["If-None-Match"] = _clean(cached_value.get("etag"))
        if _clean(cached_value.get("last_modified")):
            headers["If-Modified-Since"] = _clean(cached_value.get("last_modified"))
        status, response_headers, body = await self._fetcher(self.url, headers)
        if status == 304:
            records = cached_value.get("records")
            if not isinstance(records, list):
                raise ValueError("capability source returned 304 without a cached snapshot")
            return CapabilitySourceSnapshot(
                name=self.name,
                records=tuple(copy.deepcopy(records)),
                etag=_clean(cached_value.get("etag")),
                last_modified=_clean(cached_value.get("last_modified")),
                not_modified=True,
            )
        if status < 200 or status >= 300:
            raise ValueError(f"capability source returned HTTP {status}")
        if len(body) > MAX_SOURCE_BYTES:
            raise ValueError("capability source exceeded the response size limit")
        try:
            payload = json.loads(body.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("capability source returned invalid JSON") from error
        if not isinstance(payload, Mapping) or payload.get("version") != SOURCE_PAYLOAD_VERSION:
            raise ValueError("unsupported capability source schema")
        records = payload.get("records")
        if not isinstance(records, list) or len(records) > MAX_SOURCE_RECORDS:
            raise ValueError("capability source records are invalid")
        if any(not isinstance(record, Mapping) for record in records):
            raise ValueError("capability source record must be an object")
        lowered_headers = {str(key).lower(): str(value) for key, value in response_headers.items()}
        return CapabilitySourceSnapshot(
            name=self.name,
            records=tuple(copy.deepcopy(records)),
            etag=_clean(lowered_headers.get("etag")),
            last_modified=_clean(lowered_headers.get("last-modified")),
        )

    @staticmethod
    async def _fetch(
        url: str, headers: Mapping[str, str]
    ) -> tuple[int, Mapping[str, str], bytes]:
        timeout = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await httpx_get_public(client, url, headers=dict(headers))
            try:
                body = await response.aread()
                return response.status_code, dict(response.headers), body
            finally:
                await response.aclose()


class ApiMartSeedreamDocsSource:
    """Extract only reviewed layer-decomposition facts from APIMART Markdown."""

    url = APIMART_SEEDREAM_DOCS_URL
    _REQUIRED_MARKERS = (
        '<ParamField body="layer_decomposition" type="boolean"',
        "returns one base image and up to 16 PNG layers with alpha channels",
        "Exactly one PNG or JPEG image is required",
        "[262144, 36000000]",
        "no larger than 30 MB",
        "`size` accepts only `1K`, `1.5K`, `2K`, or `auto`",
        '<ParamField body="n" type="integer" default="1"',
        "Number of images to generate. Only `1` is supported",
        "index `0` is always the base image",
        '"z_index"',
        '"bounding_box"',
        '"absolute"',
        '"normalized"',
    )

    def __init__(
        self,
        *,
        provider_id: str = "apimart",
        fetcher: Callable[
            [str, Mapping[str, str]],
            Awaitable[tuple[int, Mapping[str, str], bytes]],
        ]
        | None = None,
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
        self.provider_id = _clean(provider_id).lower()
        if not self.provider_id:
            raise ValueError("APIMART provider ID is required")
        self.name = (
            "apimart-seedream-5-0-pro-docs"
            if self.provider_id == "apimart"
            else f"apimart-seedream-5-0-pro-docs:{self.provider_id}"
        )
        self._fetcher = fetcher or self._fetch
        self._clock = clock

    async def collect(
        self, cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        cached_value = cached if isinstance(cached, Mapping) else {}
        headers = {"Accept": "text/markdown"}
        if _clean(cached_value.get("etag")):
            headers["If-None-Match"] = _clean(cached_value.get("etag"))
        if _clean(cached_value.get("last_modified")):
            headers["If-Modified-Since"] = _clean(cached_value.get("last_modified"))
        status, response_headers, body = await self._fetcher(self.url, headers)
        if status == 304:
            records = cached_value.get("records")
            if not isinstance(records, list):
                raise ValueError("APIMART docs returned 304 without a cached snapshot")
            return CapabilitySourceSnapshot(
                name=self.name,
                records=tuple(copy.deepcopy(records)),
                etag=_clean(cached_value.get("etag")),
                last_modified=_clean(cached_value.get("last_modified")),
                not_modified=True,
            )
        if status < 200 or status >= 300:
            raise ValueError(f"APIMART docs returned HTTP {status}")
        if len(body) > MAX_SOURCE_BYTES:
            raise ValueError("APIMART docs exceeded the response size limit")
        lowered_headers = {
            str(key).lower(): str(value) for key, value in response_headers.items()
        }
        content_type = _clean(lowered_headers.get("content-type")).lower()
        if not content_type.startswith("text/markdown"):
            raise ValueError("APIMART docs did not return machine-readable Markdown")
        try:
            markdown = body.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("APIMART docs returned invalid UTF-8") from error
        normalized = re.sub(r"\s+", " ", markdown)
        if any(marker not in normalized for marker in self._REQUIRED_MARKERS):
            raise ValueError("APIMART layer-decomposition documentation changed")
        digest = hashlib.sha256(
            "\n".join(self._REQUIRED_MARKERS).encode("utf-8")
        ).hexdigest()
        record = self._record(
            fetched_at=_iso(self._clock()),
            applicable_version=f"semantic-sha256:{digest}",
        )
        return CapabilitySourceSnapshot(
            name=self.name,
            records=(record,),
            etag=_clean(lowered_headers.get("etag")),
            last_modified=_clean(lowered_headers.get("last-modified")),
        )

    def _record(self, *, fetched_at: str, applicable_version: str) -> Mapping[str, Any]:
        capability = {
            "support_state": "supported",
            "source": "APIMART official documentation",
            "source_url": self.url,
            "inputs": {
                "image": {
                    "minimum": 1,
                    "maximum": 1,
                    "required": True,
                    "roles": ["source"],
                    "formats": ["png", "jpeg"],
                    "pixel_count": {"minimum": 262144, "maximum": 36000000},
                    "maximum_megabytes": 30,
                }
            },
            "output": {
                "kind": "image_layer_decomposition",
                "count": {"minimum": 1, "maximum": 1, "default": 1},
                "manifest": {
                    "fields": {
                        "layers": {
                            "maximum": 16,
                            "media": {
                                "formats": ["png"],
                                "alpha_channel": "required",
                            },
                            "items": {
                                "fields": {
                                    "z_index": {"type": "integer"},
                                    "absolute_bbox": {
                                        "type": "array",
                                        "length": 4,
                                        "order": ["left", "top", "right", "bottom"],
                                    },
                                    "normalized_bbox": {
                                        "type": "array",
                                        "length": 4,
                                        "order": ["left", "top", "right", "bottom"],
                                    },
                                }
                            },
                        }
                    }
                },
            },
            "parameters": {
                "resolution_tier": {
                    "type": "enum",
                    "required": True,
                    "visible": True,
                    "editable": True,
                    "values": ["auto", "1K", "1.5K", "2K"],
                    "invalidation_behavior": "clear",
                },
                "count": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1,
                    "default": 1,
                    "required": True,
                    "visible": False,
                    "editable": False,
                },
            },
        }
        return {
            "provider_id": self.provider_id,
            "model_id": "seedream-5-0-pro",
            "operation": "image.layer_decomposition",
            "capability": capability,
            "confidence": "high",
            "evidence": {
                "source_type": "official_docs",
                "source_locator": self.url,
                "fetched_at": fetched_at,
                "applicable_version": applicable_version,
                "content_location": (
                    "layer_decomposition and n parameters; "
                    "Layer-decomposition response and reconstruction"
                ),
                "excerpt": (
                    "Exactly one PNG or JPEG image is required; total pixels are "
                    "262144-36000000 and the file is no larger than 30 MB. size accepts "
                    "only auto, 1K, 1.5K, or 2K. Only one image is generated. The response "
                    "contains one base image and up to 16 alpha PNG layers with z_index and "
                    "absolute and normalized bounding boxes."
                ),
            },
        }

    @staticmethod
    async def _fetch(
        url: str, headers: Mapping[str, str]
    ) -> tuple[int, Mapping[str, str], bytes]:
        timeout = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await httpx_get_public(client, url, headers=dict(headers))
            try:
                body = await response.aread()
                return response.status_code, dict(response.headers), body
            finally:
                await response.aclose()


class GeminiApiCapabilitySource:
    """Translate explicit Gemini Models fields into reviewable text candidates."""

    def __init__(
        self,
        provider_id: str,
        source_locator: str,
        models: Sequence[Mapping[str, Any]],
        *,
        eligible_model_ids: Sequence[str] = (),
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
        self.provider_id = _clean(provider_id).lower()
        self.source_locator = _clean(source_locator)
        self.models = tuple(copy.deepcopy(list(models)))
        self.eligible_model_ids = {
            _clean(value) for value in eligible_model_ids if _clean(value)
        }
        if not self.provider_id or not self.source_locator:
            raise ValueError("Gemini model discovery identity is required")
        self.name = f"gemini-models-api:{self.provider_id}"
        self._clock = clock

    async def collect(
        self, _cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        records = []
        fetched_at = _iso(self._clock())
        for item in self.models:
            if not isinstance(item, Mapping):
                continue
            model_id = _clean(item.get("model_id"))
            methods = [
                _clean(value)
                for value in item.get("supported_generation_methods") or []
                if _clean(value)
            ]
            if (
                not model_id
                or model_id not in self.eligible_model_ids
                or "generateContent" not in methods
            ):
                continue
            capability: dict[str, Any] = {
                "support_state": "unknown",
                "source": "Gemini Models API",
                "source_url": self.source_locator,
                "inputs": {},
                "output": {},
                "parameters": {},
                "media_contract": {
                    "supported_generation_methods": methods,
                },
            }
            input_limit = item.get("input_token_limit")
            output_limit = item.get("output_token_limit")
            if isinstance(input_limit, int) and input_limit > 0:
                capability["media_contract"]["input_token_limit"] = input_limit
            if isinstance(output_limit, int) and output_limit > 0:
                capability["media_contract"]["output_token_limit"] = output_limit
            for key in ("base_model_id", "version", "thinking"):
                value = item.get(key)
                if value not in (None, ""):
                    capability["media_contract"][key] = value
            for field, parameter_type in (
                ("temperature", "number"),
                ("top_p", "number"),
                ("top_k", "integer"),
            ):
                value = item.get(field)
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    continue
                parameter = {
                    "type": parameter_type,
                    "default": value,
                    "required": False,
                    "visible": False,
                    "editable": False,
                }
                if field == "temperature":
                    maximum = item.get("max_temperature")
                    if isinstance(maximum, (int, float)) and not isinstance(maximum, bool):
                        parameter["maximum"] = maximum
                capability["parameters"][field] = parameter
            details = [f"supportedGenerationMethods: {', '.join(methods)}"]
            if isinstance(input_limit, int) and input_limit > 0:
                details.append(f"inputTokenLimit: {input_limit}")
            if isinstance(output_limit, int) and output_limit > 0:
                details.append(f"outputTokenLimit: {output_limit}")
            records.append(
                {
                    "provider_id": self.provider_id,
                    "model_id": model_id,
                    "operation": "text.generate",
                    "capability": capability,
                    "confidence": "medium",
                    "evidence": {
                        "source_type": "structured_api",
                        "source_locator": self.source_locator,
                        "fetched_at": fetched_at,
                        "applicable_version": _clean(item.get("version"))
                        or "Gemini Models API",
                        "content_location": f"models/{model_id}",
                        "excerpt": "; ".join(details),
                    },
                }
            )
            if len(records) >= MAX_SOURCE_RECORDS:
                break
        return CapabilitySourceSnapshot(
            name=self.name,
            records=tuple(records),
            etag=_fingerprint({"models": self.models}),
        )


class ApiMartModelsCapabilitySource:
    """Translate APIMART expanded model metadata into review candidates."""

    _TAG_OPERATIONS = {
        "text to image": "image.generate",
        "image to image": "image.edit",
        "text to video": "video.generate",
        "image to video": "video.generate",
        "video to video": "video.generate",
    }
    _PARAMETER_NAMES = {
        "duration": "duration_seconds",
        "resolution": "resolution",
        "video_resolution": "resolution",
        "aspect_ratio": "aspect_ratio",
        "ratio": "aspect_ratio",
        "size": "size",
        "n": "count",
        "count": "count",
        "generate_num": "count",
        "width": "width",
        "height": "height",
        "quality": "quality",
        "background": "background",
        "response_format": "response_format",
        "seed": "seed",
        "fps": "fps",
        "steps": "steps",
        "guidance_scale": "guidance_scale",
        "enhance_prompt": "enhance_prompt",
        "generate_audio": "generate_audio",
        "enable_upsample": "enable_upsample",
    }

    def __init__(
        self,
        provider_id: str,
        source_locator: str,
        models: Sequence[Mapping[str, Any]],
        *,
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
        self.provider_id = _clean(provider_id).lower()
        self.source_locator = _clean(source_locator)
        self.models = tuple(copy.deepcopy(list(models)))
        if not self.provider_id or not self.source_locator:
            raise ValueError("APIMART model discovery identity is required")
        self.name = f"apimart-models-api:{self.provider_id}"
        self._clock = clock

    async def collect(
        self, _cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        fetched_at = _iso(self._clock())
        records = []
        for item in self.models:
            if not isinstance(item, Mapping):
                continue
            model_id = _clean(item.get("model_id"))
            category = _clean(item.get("category")).lower()
            tags = [_clean(value) for value in item.get("capability_tags") or [] if _clean(value)]
            parameters = item.get("parameters")
            parameters = parameters if isinstance(parameters, Mapping) else {}
            schema = parameters.get("input_schema")
            schema = schema if isinstance(schema, Mapping) else {}
            schema_properties = schema.get("properties")
            schema_properties = (
                schema_properties if isinstance(schema_properties, Mapping) else {}
            )
            operations: dict[str, str] = {}
            for tag in tags:
                operation = self._TAG_OPERATIONS.get(tag.lower())
                if operation:
                    operations[operation] = "supported"
                elif category == "chat" and tag.lower() == "text":
                    operations["text.generate"] = "supported"
            declared_operation = _clean(parameters.get("operation")).lower()
            if declared_operation == "video_generation":
                operations.setdefault("video.generate", "supported")
            elif declared_operation == "image_generation" and not any(
                operation.startswith("image.") for operation in operations
            ):
                operations["image.generate"] = "unknown"
            if not model_id or not operations:
                continue
            candidate_parameters = self._parameters(schema)
            for operation, support_state in operations.items():
                output_kind = operation.split(".", 1)[0]
                output: dict[str, Any] = {"kind": output_kind}
                count = candidate_parameters.get("count")
                if isinstance(count, Mapping):
                    output["count"] = {
                        key: count[key]
                        for key in ("minimum", "maximum", "default")
                        if key in count
                    }
                resolution = candidate_parameters.get("resolution")
                if isinstance(resolution, Mapping) and isinstance(resolution.get("values"), list):
                    output["resolutions"] = copy.deepcopy(resolution["values"])
                aspect_ratio = candidate_parameters.get("aspect_ratio")
                if isinstance(aspect_ratio, Mapping) and isinstance(aspect_ratio.get("values"), list):
                    output["aspect_ratios"] = copy.deepcopy(aspect_ratio["values"])
                duration = candidate_parameters.get("duration_seconds")
                if operation == "video.generate" and isinstance(duration, Mapping):
                    output["duration_seconds"] = {
                        key: duration[key]
                        for key in ("minimum", "maximum", "default")
                        if key in duration
                    }
                schema_version = _clean(parameters.get("schema_version"))
                media_contract = {
                    "category": category or "unknown",
                    "capability_tags": tags,
                    "model_parameters": copy.deepcopy(dict(parameters)),
                }
                records.append(
                    {
                        "provider_id": self.provider_id,
                        "model_id": model_id,
                        "operation": operation,
                        "capability": {
                            "support_state": support_state,
                            "source": "APIMART Models API",
                            "source_url": self.source_locator,
                            "inputs": {},
                            "output": output,
                            "parameters": candidate_parameters,
                            "media_contract": media_contract,
                        },
                        "confidence": "medium",
                        "evidence": {
                            "source_type": "structured_api",
                            "source_locator": self.source_locator,
                            "fetched_at": fetched_at,
                            "applicable_version": schema_version or "APIMART Models API",
                            "content_location": f"data[id={model_id}]",
                            "excerpt": (
                                f"category: {category or 'unknown'}; capability_tags: "
                                f"{', '.join(tags) or 'none'}; operation: "
                                f"{declared_operation or 'not supplied'}; input properties: "
                                f"{', '.join(sorted(schema_properties.keys())) or 'none'}"
                            ),
                        },
                    }
                )
                if len(records) >= MAX_SOURCE_RECORDS:
                    break
            if len(records) >= MAX_SOURCE_RECORDS:
                break
        return CapabilitySourceSnapshot(
            name=self.name,
            records=tuple(records),
            etag=_fingerprint({"models": self.models}),
        )

    @classmethod
    def _parameters(cls, schema: Mapping[str, Any]) -> dict[str, Any]:
        properties = schema.get("properties")
        if not isinstance(properties, Mapping):
            return {}
        required = {
            _clean(value) for value in schema.get("required") or [] if _clean(value)
        }
        result = {}
        for raw_name, raw_contract in properties.items():
            name = cls._PARAMETER_NAMES.get(_clean(raw_name).lower())
            if not name or not isinstance(raw_contract, Mapping):
                continue
            values = raw_contract.get("enum")
            if (
                _clean(raw_name).lower() == "size"
                and isinstance(values, list)
                and values
                and all(re.fullmatch(r"\d+(?:\.\d+)?:\d+(?:\.\d+)?", _clean(value)) for value in values)
            ):
                name = "aspect_ratio"
            parameter_type = "enum" if isinstance(values, list) and values else _clean(raw_contract.get("type")).lower()
            if parameter_type not in {"array", "boolean", "integer", "number", "string", "enum"}:
                continue
            contract: dict[str, Any] = {
                "type": parameter_type,
                "required": _clean(raw_name) in required,
                "visible": False,
                "editable": False,
            }
            if parameter_type == "enum":
                contract["values"] = copy.deepcopy(values[:100])
            for key in ("minimum", "maximum", "default"):
                value = raw_contract.get(key)
                if isinstance(value, (str, int, float, bool)) or value is None:
                    if key != "default" or "default" in raw_contract:
                        contract[key] = value
            existing = result.get(name)
            if existing is None or len(contract) > len(existing):
                result[name] = contract
        return result


class DreaminaCliCapabilitySource:
    """Extract explicit image and video limits printed by Dreamina CLI help."""

    _HELP_COMMANDS = (
        "text2image",
        "image2image",
        "text2video",
        "image2video",
        "frames2video",
        "multimodal2video",
    )

    def __init__(
        self,
        executable: str,
        *,
        provider_id: str = "jimeng",
        discovery: Mapping[str, Any] | None = None,
        runner: Callable[[Sequence[str]], Awaitable[tuple[int, str, str]]] | None = None,
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
        self.executable = _clean(executable)
        if not self.executable:
            raise ValueError("Dreamina executable is required")
        self.provider_id = _clean(provider_id).lower()
        if not self.provider_id:
            raise ValueError("Dreamina provider ID is required")
        self.name = (
            "dreamina-cli"
            if self.provider_id == "jimeng"
            else f"dreamina-cli:{self.provider_id}"
        )
        self._discovery = copy.deepcopy(dict(discovery or {}))
        self._runner = runner or self._run
        self._clock = clock

    async def collect(
        self, _cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        if self._discovery:
            raw_help = self._discovery.get("help_outputs")
            raw_help = raw_help if isinstance(raw_help, Mapping) else {}
            help_outputs = {
                command: _clean(raw_help.get(command))
                for command in self._HELP_COMMANDS
                if _clean(raw_help.get(command))
            }
            version = self._version(_clean(self._discovery.get("version_output")))
        else:
            version_status, version_stdout, version_stderr = await self._runner(
                (self.executable, "--version")
            )
            if version_status != 0:
                raise ValueError(version_stderr or "Dreamina version check failed")
            version = self._version(version_stdout)
            help_outputs = {}
            for command in self._HELP_COMMANDS:
                status, stdout, stderr = await self._runner(
                    (self.executable, command, "-h")
                )
                if status != 0:
                    raise ValueError(stderr or f"Dreamina {command} help failed")
                help_outputs[command] = stdout
        records = [
            *self._image_records(help_outputs, version),
            *self._video_records(help_outputs, version),
        ]
        if not records:
            raise ValueError("Dreamina help did not expose exact model limits")
        return CapabilitySourceSnapshot(
            name=self.name,
            records=tuple(records),
            etag=_fingerprint(
                {"version": version, "help": help_outputs}
            ),
        )

    def _image_records(
        self, help_outputs: Mapping[str, str], version: str
    ) -> list[Mapping[str, Any]]:
        records = []
        fetched_at = _iso(self._clock())
        for command, operation in (
            ("text2image", "image.generate"),
            ("image2image", "image.edit"),
        ):
            help_text = _clean(help_outputs.get(command))
            models = self._model_values(help_text)
            ratios = self._line_values(help_text, "ratio")
            count_match = re.search(r"generate_num:\s*(\d+)\s*[-–]\s*(\d+)", help_text, re.I)
            if not models or not ratios or count_match is None:
                continue
            count_minimum, count_maximum = map(int, count_match.groups())
            for model in models:
                resolutions = self._image_resolutions(model, help_text)
                if not resolutions:
                    continue
                inputs: dict[str, Any] = {}
                if operation == "image.edit":
                    image_count = re.search(
                        r"Upload\s+(\d+)\s+to\s+(\d+)\s+local images",
                        help_text,
                        re.I,
                    )
                    if image_count is None:
                        continue
                    inputs["image"] = {
                        "minimum": int(image_count.group(1)),
                        "maximum": int(image_count.group(2)),
                        "required": True,
                    }
                capability = {
                    "support_state": "supported",
                    "source": "Dreamina CLI help",
                    "inputs": inputs,
                    "output": {
                        "kind": "image",
                        "count": {
                            "minimum": count_minimum,
                            "maximum": count_maximum,
                            "default": 1,
                        },
                        "aspect_ratios": ratios,
                        "resolutions": resolutions,
                    },
                    "parameters": {
                        "count": {
                            "type": "integer",
                            "minimum": count_minimum,
                            "maximum": count_maximum,
                            "default": 1,
                            "required": False,
                            "visible": True,
                            "editable": True,
                        },
                        "aspect_ratio": {
                            "type": "enum",
                            "values": ratios,
                            "required": False,
                            "visible": True,
                            "editable": True,
                        },
                        "resolution": {
                            "type": "enum",
                            "values": resolutions,
                            "required": True,
                            "visible": True,
                            "editable": True,
                        },
                    },
                    "media_contract": {"cli_command": command},
                }
                records.append(
                    self._record(
                        model=model,
                        operation=operation,
                        capability=capability,
                        version=version,
                        fetched_at=fetched_at,
                        location=f"{command} supported combinations",
                        excerpt=(
                            f"model_version: {model}; ratio: {', '.join(ratios)}; "
                            f"resolution_type: {', '.join(resolutions)}; "
                            f"generate_num: {count_minimum}-{count_maximum}"
                        ),
                    )
                )
        return records

    def _video_records(
        self, help_outputs: Mapping[str, str], version: str
    ) -> list[Mapping[str, Any]]:
        combined = "\n".join(help_outputs.values())
        model_values: list[str] = []
        commands_by_model: dict[str, list[str]] = {}
        for command in ("text2video", "image2video", "frames2video", "multimodal2video"):
            for model in self._model_values(_clean(help_outputs.get(command))):
                if model and model not in model_values:
                    model_values.append(model)
                commands_by_model.setdefault(model, []).append(command)
        ratios = self._line_values(
            "\n".join(
                _clean(help_outputs.get(command))
                for command in ("text2video", "multimodal2video")
            ),
            "ratio",
        )
        records: list[Mapping[str, Any]] = []
        fetched_at = _iso(self._clock())
        for model in model_values:
            limits = self._video_limits(model, combined)
            if limits is None:
                continue
            minimum, maximum, resolutions, excerpt = limits
            inputs, input_rules = self._video_inputs(model, combined, commands_by_model)
            capability = {
                "support_state": "supported",
                "source": "Dreamina CLI help",
                "inputs": inputs,
                "input_rules": input_rules,
                "output": {
                    "kind": "video",
                    "duration_seconds": {"minimum": minimum, "maximum": maximum},
                    "aspect_ratios": ratios,
                    "resolutions": resolutions,
                },
                "parameters": {
                    "duration_seconds": {
                        "type": "integer",
                        "minimum": minimum,
                        "maximum": maximum,
                        "required": True,
                        "visible": True,
                        "editable": True,
                    },
                    "aspect_ratio": {
                        "type": "enum",
                        "values": ratios,
                        "required": False,
                        "visible": True,
                        "editable": True,
                    },
                    "resolution": {
                        "type": "enum",
                        "values": resolutions,
                        "required": False,
                        "visible": True,
                        "editable": True,
                    },
                },
                "media_contract": {
                    "cli_commands": commands_by_model.get(model, []),
                },
            }
            records.append(
                self._record(
                    model=model,
                    operation="video.generate",
                    capability=capability,
                    version=version,
                    fetched_at=fetched_at,
                    location="video commands supported combinations",
                    excerpt=(
                        f"model_version: {model}; commands: "
                        f"{', '.join(commands_by_model.get(model, []))}; "
                        f"ratio: {', '.join(ratios)}; {excerpt}"
                    ),
                )
            )
        return records

    def _record(
        self,
        *,
        model: str,
        operation: str,
        capability: Mapping[str, Any],
        version: str,
        fetched_at: str,
        location: str,
        excerpt: str,
    ) -> Mapping[str, Any]:
        locator = " ; ".join(
            shlex.join((self.executable, command, "-h"))
            for command in self._HELP_COMMANDS
        )
        return {
            "provider_id": self.provider_id,
            "model_id": model,
            "operation": operation,
            "capability": capability,
            "confidence": "high",
            "evidence": {
                "source_type": "cli_help",
                "source_locator": locator,
                "fetched_at": fetched_at,
                "applicable_version": version,
                "content_location": location,
                "excerpt": excerpt,
            },
        }

    @staticmethod
    def _model_values(help_text: str) -> list[str]:
        values = []
        for match in re.finditer(
            r"(?mi)^\s*-\s*model_version(?:\s+values)?\s*:\s*([^\r\n]+)",
            help_text,
        ):
            for raw in match.group(1).split(","):
                model = raw.strip().strip("`'\". ")
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", model) and model not in values:
                    values.append(model)
        if not values:
            flag = re.search(
                r"(?mi)^\s*--model_version\s+\S+\s+supported values\s*:\s*([^;\r\n]+)",
                help_text,
            )
            if flag:
                for raw in flag.group(1).split(","):
                    model = raw.strip().strip("`'\". ")
                    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", model) and model not in values:
                        values.append(model)
        return values

    @staticmethod
    def _line_values(help_text: str, field: str) -> list[str]:
        match = re.search(
            rf"(?mi)^\s*-\s*{re.escape(field)}:\s*([^\r\n]+)", help_text
        )
        if not match:
            return []
        return [value.strip().rstrip(".") for value in match.group(1).split(",")]

    @staticmethod
    def _image_resolutions(model: str, help_text: str) -> list[str]:
        for line in re.findall(
            r"(?mi)^\s*-\s*([^\r\n]+?)\s*->\s*resolution_type\s+([^\r\n;]+)",
            help_text,
        ):
            group, values = line
            models = [value.strip().lower() for value in group.split("/")]
            if model.lower() not in models:
                continue
            resolutions = []
            for value in re.findall(r"\b(?:1k|2k|4k)\b", values, re.I):
                normalized = value.upper()
                if normalized not in resolutions:
                    resolutions.append(normalized)
            return resolutions
        return []

    @staticmethod
    def _video_inputs(
        model: str,
        help_text: str,
        commands_by_model: Mapping[str, Sequence[str]],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        commands = commands_by_model.get(model, ())
        inputs: dict[str, Any] = {"text": {"minimum": 0, "maximum": 1}}
        rules: dict[str, Any] = {"totals": [], "requirements": []}
        normalized = model.lower()
        if "multimodal2video" in commands:
            if normalized == "seedance2.5" and all(
                marker in help_text
                for marker in ("image<=30", "video<=10", "audio<=10", "total inputs<=50")
            ):
                maxima = (30, 10, 10, 50)
            elif normalized.startswith("seedance2.0") and all(
                marker in help_text
                for marker in ("image<=9", "video<=3", "audio<=3", "total inputs<=12")
            ):
                maxima = (9, 3, 3, 12)
            else:
                maxima = None
            if maxima is not None:
                image_maximum, video_maximum, audio_maximum, total_maximum = maxima
                inputs.update(
                    {
                        "image": {"minimum": 0, "maximum": image_maximum},
                        "video": {"minimum": 0, "maximum": video_maximum},
                        "audio": {"minimum": 0, "maximum": audio_maximum},
                    }
                )
                rules["totals"].append(
                    {
                        "id": "reference_media",
                        "inputs": ["image", "video", "audio"],
                        "minimum": 0,
                        "maximum": total_maximum,
                        "active_when_any_present": True,
                    }
                )
                if normalized.startswith("seedance2.0"):
                    rules["requirements"].append(
                        {
                            "id": "visual_reference",
                            "when": {"input": "audio", "minimum": 1},
                            "any_of": ["image", "video"],
                            "minimum": 1,
                        }
                    )
                return inputs, rules
        if "frames2video" in commands:
            inputs["image"] = {"minimum": 0, "maximum": 2}
        elif "image2video" in commands:
            inputs["image"] = {"minimum": 0, "maximum": 1}
        return inputs, rules

    @staticmethod
    def _video_limits(
        model: str, help_text: str
    ) -> tuple[int, int, list[str], str] | None:
        normalized = model.lower()
        if normalized == "seedance2.5":
            expected = (4, 30, ["480p", "720p"])
        elif normalized == "seedance2.0_vip":
            expected = (4, 15, ["720p", "1080p", "4k"])
        elif normalized == "seedance1.0fast":
            expected = (5, 10, ["720p"])
        elif normalized == "seedance1.5pro":
            expected = (5, 12, ["720p"])
        elif normalized.startswith("seedance2.0"):
            expected = (4, 15, ["720p"])
        else:
            return None
        minimum, maximum, resolutions = expected
        lowered = help_text.lower()
        if model.lower() not in lowered:
            return None
        duration_pattern = rf"{minimum}\s*[-–]\s*{maximum}"
        if not re.search(duration_pattern, lowered):
            return None
        if any(value.lower() not in lowered for value in resolutions):
            return None
        excerpt = (
            f"video_resolution: {', '.join(resolutions)}; "
            f"duration: {minimum}-{maximum}s"
        )
        return minimum, maximum, resolutions, excerpt

    @staticmethod
    def _version(value: str) -> str:
        text = _clean(value)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"(?m)^\s*(\{[^\r\n]+\})\s*$", text)
            if match:
                try:
                    payload = json.loads(match.group(1))
                except json.JSONDecodeError:
                    payload = {}
            else:
                payload = {}
        version = _clean(payload.get("version")) if isinstance(payload, Mapping) else ""
        if not version:
            match = re.search(r"\b(?:v)?([0-9]+(?:\.[0-9A-Za-z_-]+)+)\b", text)
            version = match.group(1) if match else "unknown"
        return f"dreamina {version}"

    @staticmethod
    async def _run(command: Sequence[str]) -> tuple[int, str, str]:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
        except asyncio.CancelledError:
            if process.returncode is None:
                process.kill()
            await process.communicate()
            raise
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            raise ValueError("Dreamina help check timed out")
        return (
            int(process.returncode or 0),
            stdout.decode("utf-8", errors="replace").strip(),
            stderr.decode("utf-8", errors="replace").strip(),
        )


def sources_from_model_discovery(
    *,
    provider_id: str,
    base_url: str,
    protocol: str,
    discovery: Mapping[str, Any] | None,
    model_ids: Sequence[str],
    chat_model_ids: Sequence[str] = (),
) -> tuple[Any, ...]:
    """Build first-batch adapters for one API Settings model-list fetch."""
    provider = _clean(provider_id).lower()
    selected_protocol = _clean(protocol).lower()
    snapshot = discovery if isinstance(discovery, Mapping) else {}
    sources: list[Any] = []
    if selected_protocol == "jimeng" and snapshot.get("kind") == "dreamina-cli":
        sources.append(
            DreaminaCliCapabilitySource(
                "dreamina",
                provider_id=provider or "jimeng",
                discovery=snapshot,
            )
        )
    if selected_protocol == "gemini" and snapshot.get("kind") == "gemini-api":
        models = snapshot.get("models")
        if isinstance(models, Sequence) and not isinstance(models, (str, bytes)):
            sources.append(
                GeminiApiCapabilitySource(
                    provider or "gemini",
                    _clean(snapshot.get("source_locator")),
                    [item for item in models if isinstance(item, Mapping)],
                    eligible_model_ids=chat_model_ids,
                )
            )
    host = ""
    try:
        host = (urllib.parse.urlsplit(_clean(base_url)).hostname or "").lower()
    except ValueError:
        host = ""
    is_apimart = (
        selected_protocol == "apimart"
        and (
            host == "apimart.ai"
            or host.endswith(".apimart.ai")
            or host == "apib.ai"
            or host.endswith(".apib.ai")
        )
    )
    if is_apimart and snapshot.get("kind") == "apimart-api":
        models = snapshot.get("models")
        if isinstance(models, Sequence) and not isinstance(models, (str, bytes)):
            sources.append(
                ApiMartModelsCapabilitySource(
                    provider or "apimart",
                    _clean(snapshot.get("source_locator")),
                    [item for item in models if isinstance(item, Mapping)],
                )
            )
    if is_apimart and "seedream-5-0-pro" in {_clean(value) for value in model_ids}:
        sources.append(ApiMartSeedreamDocsSource(provider_id=provider or "apimart"))
    return tuple(sources)


class ModelCapabilityRefreshManager:
    """Collect sources, create reviewable differences, and schedule rechecks."""

    def __init__(
        self,
        *,
        workbench: ModelCapabilityWorkbench,
        catalog: Any,
        sources: Sequence[Any],
        cache_path: str | Path,
        interval_seconds: int = DEFAULT_REFRESH_INTERVAL_SECONDS,
        backoff_seconds: int = DEFAULT_BACKOFF_SECONDS,
        maximum_backoff_seconds: int = MAX_BACKOFF_SECONDS,
        jitter_ratio: float = 0.2,
        clock: Callable[[], _datetime.datetime] = _utc_now,
        random_value: Callable[[], float] = random.random,
    ) -> None:
        self.workbench = workbench
        self.catalog = catalog
        self.sources = tuple(sources)
        self.cache_path = Path(cache_path)
        self.interval_seconds = max(60, int(interval_seconds))
        self.backoff_seconds = max(1, int(backoff_seconds))
        self.maximum_backoff_seconds = max(
            self.backoff_seconds, int(maximum_backoff_seconds)
        )
        self.jitter_ratio = min(0.5, max(0.0, float(jitter_ratio)))
        self._clock = clock
        self._random = random_value
        self._active_refresh: asyncio.Task | None = None
        self._scheduler: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._materialize_lock = RLock()
        self._status: dict[str, Any] = {
            "enabled": bool(self.sources),
            "checking": False,
            "source_count": len(self.sources),
            "last_started_at": None,
            "last_success_at": None,
            "next_check_at": None,
            "consecutive_failures": 0,
            "last_error": None,
            "drafts_created": 0,
            "evidence_created": 0,
            "sources": [],
        }

    def status(self) -> dict[str, Any]:
        return copy.deepcopy(self._status)

    def start(self) -> asyncio.Task | None:
        if self._scheduler is not None and not self._scheduler.done():
            return self._scheduler
        self._stop_event = asyncio.Event()
        self._scheduler = asyncio.create_task(self._run_scheduler())
        return self._scheduler

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        tasks = [
            task
            for task in (self._scheduler, self._active_refresh)
            if task is not None and not task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._scheduler = None
        self._active_refresh = None
        self._stop_event = None

    async def refresh(self, *, force: bool = False) -> dict[str, Any]:
        active = self._active_refresh
        if active is None or active.done():
            active = asyncio.create_task(self._refresh_once(force=force))
            self._active_refresh = active
        return await asyncio.shield(active)

    async def collect_sources_for_review(
        self, sources: Sequence[Any]
    ) -> dict[str, Any]:
        """Collect fetch-time sources without publishing or failing model discovery."""
        source_statuses = []
        drafts_created = 0
        evidence_created = 0
        record_count = 0
        errors = []
        if not sources:
            return {
                "ok": True,
                "source_count": 0,
                "record_count": 0,
                "drafts_created": 0,
                "evidence_created": 0,
                "sources": [],
                "errors": [],
            }
        try:
            catalog = await asyncio.to_thread(self.catalog.refresh)
        except Exception as error:
            catalog = {"ok": False, "error": str(error)}
        if not catalog.get("ok"):
            errors.append(_clean(catalog.get("error")) or "catalog refresh failed")
        else:
            for source in sources:
                source_name = _clean(getattr(source, "name", "")) or "unnamed"
                try:
                    snapshot = await source.collect()
                    result = await asyncio.to_thread(
                        self._materialize, snapshot, set()
                    )
                    record_count += len(snapshot.records)
                    drafts_created += result["drafts_created"]
                    evidence_created += result["evidence_created"]
                    source_statuses.append(
                        {
                            "name": source_name,
                            "ok": True,
                            "record_count": len(snapshot.records),
                            "error": None,
                        }
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    errors.append(f"{source_name}: {error}")
                    source_statuses.append(
                        {
                            "name": source_name,
                            "ok": False,
                            "record_count": 0,
                            "error": str(error),
                        }
                    )
        return {
            "ok": not errors,
            "source_count": len(sources),
            "record_count": record_count,
            "drafts_created": drafts_created,
            "evidence_created": evidence_created,
            "sources": source_statuses,
            "errors": errors,
        }

    async def _run_scheduler(self) -> None:
        while self._stop_event is not None and not self._stop_event.is_set():
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            delay = self._next_delay()
            self._status["next_check_at"] = _iso(
                self._clock() + _datetime.timedelta(seconds=delay)
            )
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
            except asyncio.TimeoutError:
                continue

    def _next_delay(self) -> float:
        failures = int(self._status.get("consecutive_failures") or 0)
        base = self.interval_seconds if failures == 0 else min(
            self.maximum_backoff_seconds,
            self.backoff_seconds * (2 ** max(0, failures - 1)),
        )
        jitter = base * self.jitter_ratio * ((self._random() * 2) - 1)
        return max(1.0, base + jitter)

    async def _refresh_once(self, *, force: bool) -> dict[str, Any]:
        started = self._clock()
        self._status.update(
            {"checking": True, "last_started_at": _iso(started), "last_error": None}
        )
        cache = self._read_cache()
        source_cache = cache.setdefault("sources", {})
        observed = set(cache.setdefault("observed_fingerprints", []))
        source_statuses: list[dict[str, Any]] = []
        drafts_created = 0
        evidence_created = 0
        errors: list[str] = []
        try:
            local_catalog = await asyncio.to_thread(self.catalog.refresh)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            local_catalog = {"ok": False, "error": str(error)}
        if not local_catalog.get("ok"):
            errors.append(_clean(local_catalog.get("error")) or "catalog refresh failed")
        else:
            for source in self.sources:
                source_name = _clean(getattr(source, "name", "")) or "unnamed"
                try:
                    snapshot = await source.collect(source_cache.get(source_name))
                    result = await asyncio.to_thread(
                        self._materialize,
                        snapshot,
                        observed,
                    )
                    drafts_created += result["drafts_created"]
                    evidence_created += result["evidence_created"]
                    source_cache[source_name] = {
                        "etag": snapshot.etag,
                        "last_modified": snapshot.last_modified,
                        "records": copy.deepcopy(list(snapshot.records)),
                        "checked_at": _iso(self._clock()),
                    }
                    source_statuses.append(
                        {
                            "name": source_name,
                            "ok": True,
                            "not_modified": snapshot.not_modified,
                            "record_count": len(snapshot.records),
                            "error": None,
                        }
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    message = f"{source_name}: {error}"
                    errors.append(message)
                    source_statuses.append(
                        {
                            "name": source_name,
                            "ok": False,
                            "not_modified": False,
                            "record_count": 0,
                            "error": str(error),
                        }
                    )
        cache["observed_fingerprints"] = sorted(observed)[-MAX_OBSERVED_FINGERPRINTS:]
        cache["updated_at"] = _iso(self._clock())
        cache_write_failed = False
        try:
            await asyncio.to_thread(self._write_cache, cache)
        except (OSError, TypeError, ValueError) as error:
            cache_write_failed = True
            errors.append(f"cache: {error}")
        all_failed = bool(self.sources) and not any(item["ok"] for item in source_statuses)
        failed = not local_catalog.get("ok") or all_failed or cache_write_failed
        if failed:
            self._status["consecutive_failures"] = int(
                self._status.get("consecutive_failures") or 0
            ) + 1
        else:
            self._status["consecutive_failures"] = 0
            self._status["last_success_at"] = _iso(self._clock())
        self._status.update(
            {
                "checking": False,
                "last_error": "; ".join(errors) or None,
                "drafts_created": drafts_created,
                "evidence_created": evidence_created,
                "sources": source_statuses,
            }
        )
        delay = self._next_delay()
        self._status["next_check_at"] = _iso(
            self._clock() + _datetime.timedelta(seconds=delay)
        )
        return {"ok": not failed, "forced": bool(force), **self.status()}

    def _materialize(
        self,
        snapshot: CapabilitySourceSnapshot,
        observed: set[str],
    ) -> dict[str, int]:
        with self._materialize_lock:
            return self._materialize_unlocked(snapshot, observed)

    def _materialize_unlocked(
        self,
        snapshot: CapabilitySourceSnapshot,
        observed: set[str],
    ) -> dict[str, int]:
        workbench_snapshot = self.workbench.snapshot()
        evidence_created = 0
        drafts_created = 0
        for raw_record in snapshot.records:
            record = copy.deepcopy(dict(raw_record))
            fingerprint = _record_fingerprint(record)
            if fingerprint in observed:
                continue
            identity = {
                "provider_id": _clean(record.get("provider_id")).lower(),
                "model_id": _clean(record.get("model_id")),
                "operation": _clean(record.get("operation")).lower(),
            }
            raw_evidence = record.get("evidence")
            if not isinstance(raw_evidence, Mapping):
                raise ValueError("capability source record evidence is required")
            evidence_values = {
                "source_type": _clean(raw_evidence.get("source_type")),
                "source_locator": _clean(raw_evidence.get("source_locator")),
                "fetched_at": _clean(raw_evidence.get("fetched_at")),
                "applicable_version": _clean(raw_evidence.get("applicable_version")),
                "content_location": _clean(raw_evidence.get("content_location")),
                "excerpt": _clean(raw_evidence.get("excerpt")),
            }
            actor_id = f"{AUTOMATION_ACTOR}:{snapshot.name}"
            self.workbench.validate_evidence(
                **identity,
                **evidence_values,
                actor_id=actor_id,
            )
            evidence = next(
                (
                    item
                    for item in workbench_snapshot.get("evidence", [])
                    if all(item.get(key) == value for key, value in identity.items())
                    and all(item.get(key) == value for key, value in evidence_values.items())
                ),
                None,
            )
            capability = record.get("capability")
            if capability is not None:
                if not isinstance(capability, Mapping):
                    raise ValueError("capability source candidate must be an object")
                capability = self.workbench.validate_capability(capability)
                confidence = _clean(record.get("confidence")).lower() or "medium"
                if confidence not in {"low", "medium", "high"}:
                    raise ValueError("capability source confidence is invalid")
            published = next(
                (
                    item
                    for item in workbench_snapshot.get("published", {}).get("capabilities", [])
                    if all(item.get(key) == value for key, value in identity.items())
                ),
                None,
            )
            existing_draft = next(
                (
                    item
                    for item in workbench_snapshot.get("drafts", [])
                    if item.get("review_state") != "published"
                    and all(item.get(key) == value for key, value in identity.items())
                    and item.get("capability") == capability
                ),
                None,
            )
            if isinstance(capability, Mapping) and (
                published is None or published.get("capability") != capability
            ) and existing_draft is None:
                if evidence is None:
                    evidence = self.workbench.record_evidence(
                        **identity,
                        **evidence_values,
                        actor_id=actor_id,
                    )
                    evidence_created += 1
                    workbench_snapshot.setdefault("evidence", []).append(evidence)
                field_evidence = {
                    path: {
                        "evidence_ids": [evidence["id"]],
                        "confidence": confidence,
                    }
                    for path in _leaf_paths(capability)
                }
                draft = self.workbench.save_draft(
                    **identity,
                    capability=capability,
                    field_evidence=field_evidence,
                    base_catalog_revision=self.catalog.revision,
                    actor_id=actor_id,
                )
                drafts_created += 1
                workbench_snapshot.setdefault("drafts", []).append(draft)
            elif capability is None and evidence is None:
                evidence = self.workbench.record_evidence(
                    **identity,
                    **evidence_values,
                    actor_id=actor_id,
                )
                evidence_created += 1
                workbench_snapshot.setdefault("evidence", []).append(evidence)
            observed.add(fingerprint)
        return {
            "drafts_created": drafts_created,
            "evidence_created": evidence_created,
        }

    def _read_cache(self) -> dict[str, Any]:
        if not self.cache_path.exists():
            return {
                "version": REFRESH_CACHE_VERSION,
                "updated_at": None,
                "sources": {},
                "observed_fingerprints": [],
            }
        try:
            value = json.loads(self.cache_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            return {
                "version": REFRESH_CACHE_VERSION,
                "updated_at": None,
                "sources": {},
                "observed_fingerprints": [],
            }
        if not isinstance(value, dict) or value.get("version") != REFRESH_CACHE_VERSION:
            return {
                "version": REFRESH_CACHE_VERSION,
                "updated_at": None,
                "sources": {},
                "observed_fingerprints": [],
            }
        if not isinstance(value.get("sources"), dict):
            value["sources"] = {}
        if not isinstance(value.get("observed_fingerprints"), list):
            value["observed_fingerprints"] = []
        return value

    def _write_cache(self, value: Mapping[str, Any]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_path.with_name(
            f".{self.cache_path.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("x", encoding="utf-8") as output:
                json.dump(value, output, ensure_ascii=False, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.cache_path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def sources_from_environment() -> tuple[Any, ...]:
    """Build installed local CLI and optional structured HTTP sources."""

    sources: list[Any] = []
    apimart_docs_enabled = _clean(
        os.getenv("INFINITE_CANVAS_MODEL_CAPABILITY_APIMART_DOCS", "1")
    ).lower() not in {"0", "false", "no", "off"}
    if apimart_docs_enabled:
        sources.append(ApiMartSeedreamDocsSource())
    local_cli_enabled = _clean(
        os.getenv("INFINITE_CANVAS_MODEL_CAPABILITY_LOCAL_CLI", "1")
    ).lower() not in {"0", "false", "no", "off"}
    dreamina = _clean(
        os.getenv("DREAMINA_BIN") or os.getenv("JIMENG_BIN")
    ) or _clean(shutil.which("dreamina"))
    if local_cli_enabled and dreamina:
        sources.append(DreaminaCliCapabilitySource(dreamina))
    value = _clean(os.getenv("INFINITE_CANVAS_MODEL_CAPABILITY_SOURCE_URLS"))
    if not value:
        return tuple(sources)
    for index, raw_url in enumerate(value.split(",")[:MAX_CONFIGURED_SOURCES], start=1):
        url = _clean(raw_url)
        if url:
            sources.append(JsonUrlCapabilitySource(f"structured-{index}", url))
    return tuple(sources)


def refresh_interval_from_environment() -> int:
    value = _clean(os.getenv("INFINITE_CANVAS_MODEL_CAPABILITY_REFRESH_SECONDS"))
    try:
        return max(60, int(value or DEFAULT_REFRESH_INTERVAL_SECONDS))
    except ValueError:
        return DEFAULT_REFRESH_INTERVAL_SECONDS


__all__ = [
    "APIMART_SEEDREAM_DOCS_URL",
    "AUTOMATION_ACTOR",
    "ApiMartModelsCapabilitySource",
    "ApiMartSeedreamDocsSource",
    "CapabilitySourceSnapshot",
    "DEFAULT_REFRESH_INTERVAL_SECONDS",
    "DreaminaCliCapabilitySource",
    "GeminiApiCapabilitySource",
    "JsonUrlCapabilitySource",
    "ModelCapabilityRefreshManager",
    "REFRESH_CACHE_VERSION",
    "SOURCE_PAYLOAD_VERSION",
    "refresh_interval_from_environment",
    "sources_from_environment",
    "sources_from_model_discovery",
]
