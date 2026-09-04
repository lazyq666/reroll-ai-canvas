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
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
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

    name = "apimart-seedream-5-0-pro-docs"
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
        fetcher: Callable[
            [str, Mapping[str, str]],
            Awaitable[tuple[int, Mapping[str, str], bytes]],
        ]
        | None = None,
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
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
            "provider_id": "apimart",
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


class DreaminaCliCapabilitySource:
    """Extract the explicit video limits printed by the installed Dreamina CLI."""

    name = "dreamina-cli"
    _HELP_COMMANDS = ("text2video", "frames2video")

    def __init__(
        self,
        executable: str,
        *,
        runner: Callable[[Sequence[str]], Awaitable[tuple[int, str, str]]] | None = None,
        clock: Callable[[], _datetime.datetime] = _utc_now,
    ) -> None:
        self.executable = _clean(executable)
        if not self.executable:
            raise ValueError("Dreamina executable is required")
        self._runner = runner or self._run
        self._clock = clock

    async def collect(
        self, _cached: Mapping[str, Any] | None = None
    ) -> CapabilitySourceSnapshot:
        version_status, version_stdout, version_stderr = await self._runner(
            (self.executable, "--version")
        )
        if version_status != 0:
            raise ValueError(version_stderr or "Dreamina version check failed")
        version = self._version(version_stdout)
        help_outputs: dict[str, str] = {}
        for command in self._HELP_COMMANDS:
            status, stdout, stderr = await self._runner(
                (self.executable, command, "-h")
            )
            if status != 0:
                raise ValueError(stderr or f"Dreamina {command} help failed")
            help_outputs[command] = stdout
        records = self._video_records(help_outputs, version)
        return CapabilitySourceSnapshot(
            name=self.name,
            records=tuple(records),
            etag=_fingerprint(
                {"version": version, "help": help_outputs}
            ),
        )

    def _video_records(
        self, help_outputs: Mapping[str, str], version: str
    ) -> list[Mapping[str, Any]]:
        combined = "\n".join(help_outputs.values())
        model_values: list[str] = []
        for match in re.finditer(r"model_version:\s*([^\n]+)", combined, re.I):
            for raw in match.group(1).split(","):
                model = raw.strip().rstrip(".")
                if model and model not in model_values:
                    model_values.append(model)
        ratio_match = re.search(r"^\s*-\s*ratio:\s*([^\n]+)", help_outputs.get("text2video", ""), re.I | re.M)
        ratios = []
        if ratio_match:
            ratios = [value.strip().rstrip(".") for value in ratio_match.group(1).split(",")]
        records: list[Mapping[str, Any]] = []
        fetched_at = _iso(self._clock())
        locator = " ; ".join(
            shlex.join((self.executable, command, "-h"))
            for command in self._HELP_COMMANDS
        )
        for model in model_values:
            limits = self._video_limits(model, combined)
            if limits is None or not ratios:
                continue
            minimum, maximum, resolutions, excerpt = limits
            capability = {
                "support_state": "supported",
                "inputs": {},
                "output": {
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
            }
            records.append(
                {
                    "provider_id": "jimeng",
                    "model_id": model,
                    "operation": "video.generate",
                    "capability": capability,
                    "confidence": "high",
                    "evidence": {
                        "source_type": "cli_help",
                        "source_locator": locator,
                        "fetched_at": fetched_at,
                        "applicable_version": version,
                        "content_location": "Supported combinations and video flags",
                        "excerpt": f"model_version: {model}; ratio: {', '.join(ratios)}; {excerpt}",
                    },
                }
            )
        if not records:
            raise ValueError("Dreamina help did not expose exact video model limits")
        return records

    @staticmethod
    def _video_limits(
        model: str, help_text: str
    ) -> tuple[int, int, list[str], str] | None:
        normalized = model.lower()
        if normalized == "seedance2.5":
            expected = (4, 30, ["480p", "720p", "1080p"])
        elif normalized == "seedance2.0_vip":
            expected = (4, 15, ["720p", "1080p", "4k"])
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
    "ApiMartSeedreamDocsSource",
    "CapabilitySourceSnapshot",
    "DEFAULT_REFRESH_INTERVAL_SECONDS",
    "DreaminaCliCapabilitySource",
    "JsonUrlCapabilitySource",
    "ModelCapabilityRefreshManager",
    "REFRESH_CACHE_VERSION",
    "SOURCE_PAYLOAD_VERSION",
    "refresh_interval_from_environment",
    "sources_from_environment",
]
