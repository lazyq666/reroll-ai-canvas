"""Vendor provider implementation behind a capability adapter."""
from __future__ import annotations

import asyncio
import base64
import datetime
import functools
import glob
import hashlib
import hmac
import html
import ipaddress
import json
import math
import mimetypes
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
from fractions import Fraction
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import requests
from fastapi import HTTPException
from PIL import Image, ImageOps

VOLCENGINE_ARK_ASSET_HOST = "open.volcengineapi.com"
VOLCENGINE_ARK_ASSET_SERVICE = "ark"
VOLCENGINE_ARK_ASSET_REGION = "cn-beijing"
VOLCENGINE_ARK_ASSET_VERSION = "2024-01-01"
try:
    CODEX_DEFAULT_TIMEOUT = max(
        30, min(3600, int(os.getenv("CODEX_CLI_TIMEOUT", "900")))
    )
except Exception:
    CODEX_DEFAULT_TIMEOUT = 900
try:
    GEMINI_CLI_DEFAULT_TIMEOUT = max(
        30, min(3600, int(os.getenv("GEMINI_CLI_TIMEOUT", "900")))
    )
except Exception:
    GEMINI_CLI_DEFAULT_TIMEOUT = 900
try:
    JIMENG_DEFAULT_POLL_SECONDS = max(
        1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", "900")))
    )
except Exception:
    JIMENG_DEFAULT_POLL_SECONDS = 900

from .ports import DynamicPorts, InspectorPorts
from .implementation import (
    codex_models_payload,
    codex_status,
    detect_image_request_mode,
    gemini_cli_models_payload,
    gemini_cli_status,
    is_codex_provider,
    is_gemini_cli_provider,
    is_jimeng_provider,
    jimeng_models_payload,
    looks_like_html_response,
    provider_protocol,
    runninghub_models_payload,
    runninghub_openapi_url,
    volcengine_task_probe_url,
)

_ports = DynamicPorts("inspection")

def configure_ports(ports: InspectorPorts) -> None:
    _ports.configure(ports)

def bind_ports(ports: InspectorPorts):
    return _ports.bind(ports)

async def probe_volcengine_auto_detect(client, base_url: str, api_key: str):
    task_ok, task_probe = await probe_volcengine_task_endpoint(client, base_url, api_key)
    if task_ok:
        return True, {
            "status": task_probe.get("status") or 200,
            "message": "检测到方舟/Ark 任务协议",
            "raw": {"task_probe": task_probe.get("raw")},
        }
    compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
    if compat_ok:
        return True, {
            "status": compat_probe.get("status") or 200,
            "message": "检测到方舟/Ark Bearer 鉴权入口（OpenAI 兼容透传）",
            "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
        }
    return False, {
        "status": compat_probe.get("status") or task_probe.get("status") or 0,
        "message": compat_probe.get("message") or task_probe.get("message") or "未检测到方舟/Ark 兼容入口",
        "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
    }

async def probe_openai_compat_bearer_endpoint(client, base_url: str, api_key: str):
    root = openai_compat_root_for_probe(base_url)
    if not root:
        return False, {"status": 0, "message": "Base URL 为空"}
    url = f"{root}/chat/completions"
    response = await client.post(
        url,
        headers={**upstream_model_headers(api_key, "openai"), "Content-Type": "application/json"},
        json={"messages": []},
    )
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI 兼容入口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "OpenAI 兼容 Bearer 鉴权入口可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"OpenAI 兼容入口服务端错误 {response.status_code}", "raw": raw}

def api_key_from_payload(payload, protocol: str = ""):
    explicit = str(getattr(payload, "api_key", "") or "").strip()
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    protocol = str(protocol or protocol_from_payload(payload) or "").strip().lower()
    if explicit:
        return explicit
    if provider_id:
        if provider_id == "runninghub":
            value = os.getenv(_ports.runninghub_wallet_key_env(), "")
            if value:
                return value
        value = _ports.provider_env_key_value(provider_id)
        if value:
            return value
    if protocol == "volcengine":
        return _ports.volcengine_provider_api_key("")
    return ""

def classify_upstream_model(mid):
    lc = str(mid or "").lower()
    video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
    if any(k in lc for k in video_keys):
        return "video"
    image_keys = ["banana", "image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein", "seedream", "doubao-seedream", "text-to-image", "image-to-image"]
    if any(k in lc for k in image_keys):
        return "image"
    return "chat"

def parse_upstream_models(raw, protocol="openai"):
    items = raw.get("data") if isinstance(raw, dict) else None
    if not items and isinstance(raw, dict):
        items = raw.get("models") or raw.get("list") or []
    if not isinstance(items, list):
        items = []
    ids = []
    explicit_categories = {}
    for it in items:
        if isinstance(it, str):
            mid = it
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
        else:
            mid = ""
        if mid:
            mid = str(mid)
            if protocol == "gemini" and mid.startswith("models/"):
                mid = mid[len("models/"):]
            ids.append(mid)
            if isinstance(it, dict):
                category = str(it.get("category") or "").strip().lower()
                if category in {"image", "chat", "video"}:
                    explicit_categories[mid] = category
    ids = sorted(set(ids))
    grouped = {"image": [], "chat": [], "video": []}
    for mid in ids:
        grouped[explicit_categories.get(mid) or classify_upstream_model(mid)].append(mid)
    return grouped, ids


def gemini_model_discovery(raw):
    """Keep only capability-shaped fields from a Gemini Models response."""
    items = raw.get("models") if isinstance(raw, dict) else []
    if not isinstance(items, list):
        return [], {}
    models = []
    model_names = {}
    for item in items[:1000]:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("name") or "").strip()
        if model_id.startswith("models/"):
            model_id = model_id[len("models/"):]
        if not model_id:
            continue
        candidate = {"model_id": model_id}
        for source_key, target_key in (
            ("baseModelId", "base_model_id"),
            ("version", "version"),
            ("displayName", "display_name"),
        ):
            value = str(item.get(source_key) or "").strip()
            if value:
                candidate[target_key] = value
        methods = item.get("supportedGenerationMethods")
        if isinstance(methods, list):
            candidate["supported_generation_methods"] = [
                str(value).strip()
                for value in methods
                if str(value or "").strip()
            ][:50]
        for source_key, target_key in (
            ("inputTokenLimit", "input_token_limit"),
            ("outputTokenLimit", "output_token_limit"),
            ("temperature", "temperature"),
            ("maxTemperature", "max_temperature"),
            ("topP", "top_p"),
            ("topK", "top_k"),
        ):
            value = item.get(source_key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                candidate[target_key] = value
        if isinstance(item.get("thinking"), bool):
            candidate["thinking"] = item["thinking"]
        models.append(candidate)
        display_name = str(candidate.get("display_name") or "").strip()
        if display_name and display_name != model_id:
            model_names[model_id] = display_name
    return models, model_names


def _bounded_json_schema(value, *, depth=0):
    if depth > 6:
        return None
    if isinstance(value, dict):
        result = {}
        scalar_fields = {
            "$schema",
            "type",
            "format",
            "minimum",
            "maximum",
            "exclusiveMinimum",
            "exclusiveMaximum",
            "minLength",
            "maxLength",
            "minItems",
            "maxItems",
            "default",
            "const",
            "additionalProperties",
        }
        for key, child in list(value.items())[:200]:
            name = str(key or "").strip()
            lowered = name.lower()
            if any(fragment in lowered for fragment in ("price", "cost", "credit", "billing", "usage")):
                continue
            if name in scalar_fields and isinstance(child, (str, int, float, bool)):
                result[name] = child
            elif name in {"required", "enum"} and isinstance(child, list):
                result[name] = [
                    item for item in child[:100]
                    if isinstance(item, (str, int, float, bool)) or item is None
                ]
            elif name in {"anyOf", "oneOf", "allOf"} and isinstance(child, list):
                result[name] = [
                    sanitized for item in child[:30]
                    if (sanitized := _bounded_json_schema(item, depth=depth + 1)) is not None
                ]
            elif name == "properties" and isinstance(child, dict):
                properties = {}
                for property_name, contract in list(child.items())[:200]:
                    property_key = str(property_name or "").strip()
                    lowered_property = property_key.lower()
                    if not property_key or any(
                        fragment in lowered_property
                        for fragment in ("price", "cost", "credit", "billing", "usage")
                    ):
                        continue
                    sanitized = _bounded_json_schema(contract, depth=depth + 1)
                    if sanitized is not None:
                        properties[property_key[:120]] = sanitized
                result[name] = properties
            elif name == "items":
                sanitized = _bounded_json_schema(child, depth=depth + 1)
                if sanitized is not None:
                    result[name] = sanitized
        return result
    return value if isinstance(value, (str, int, float, bool)) or value is None else None


def apimart_model_discovery(raw):
    """Keep APIMART's expanded category, tags, and bounded request schema."""
    items = raw.get("data") if isinstance(raw, dict) else []
    if not isinstance(items, list):
        return []
    models = []
    for item in items[:1000]:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        candidate = {"model_id": model_id}
        category = str(item.get("category") or "").strip().lower()
        if category in {"chat", "image", "video", "audio", "unknown"}:
            candidate["category"] = category
        tags = item.get("capability_tags")
        if isinstance(tags, list):
            candidate["capability_tags"] = [
                str(value).strip()
                for value in tags[:50]
                if str(value or "").strip()
            ]
        parameters = item.get("parameters")
        if isinstance(parameters, dict):
            contract = {}
            for key in ("operation", "method", "endpoint", "schema_version", "source"):
                value = str(parameters.get(key) or "").strip()
                if value:
                    contract[key] = value[:500]
            input_schema = _bounded_json_schema(parameters.get("input_schema"))
            if isinstance(input_schema, dict):
                contract["input_schema"] = input_schema
            if contract:
                candidate["parameters"] = contract
        models.append(candidate)
    return models


def is_official_apimart_url(base_url: str) -> bool:
    try:
        host = (urllib.parse.urlsplit(str(base_url or "").strip()).hostname or "").lower()
    except ValueError:
        return False
    return (
        host == "apimart.ai"
        or host.endswith(".apimart.ai")
        or host == "apib.ai"
        or host.endswith(".apib.ai")
    )

def volcengine_default_model_payload(status=200, message="", raw=None):
    return {
        "ok": True,
        "protocol": "volcengine",
        "status": status,
        "message": message or "方舟任务接口可用，模型列表接口未返回模型。请按实际方舟控制台模型名称手动填写视频模型。",
        "model_count": 0,
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "all": [],
        "raw": raw,
    }

async def probe_volcengine_task_endpoint(client, base_url: str, api_key: str):
    probe_url = volcengine_task_probe_url(base_url)
    if not probe_url:
        return False, {"status": 0, "message": "Base URL 为空"}
    response = await client.get(probe_url, headers=upstream_model_headers(api_key, "volcengine"))
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "方舟 API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "任务接口返回 HTML，Base URL 可能不是 API 地址", "raw": raw}
    if response.status_code < 500:
        return True, {"status": response.status_code, "message": "方舟任务查询端点可达", "raw": raw}
    return False, {"status": response.status_code, "message": f"方舟任务接口服务端错误 {response.status_code}", "raw": raw}

def upstream_model_headers(api_key: str, protocol: str):
    if protocol == "gemini":
        return {"x-goog-api-key": api_key, "Accept": "application/json"}
    if protocol == "runninghub":
        return {"Authorization": _ports.bearer_auth_value(api_key), "Accept": "application/json"}
    return {"Authorization": _ports.bearer_auth_value(api_key), "Accept": "application/json"}

async def fetch_models_from_upstream(base_url: str, api_key: str, protocol: str = "openai", image_request_mode: str = "openai"):
    """从上游模型列表端点拉取模型，并按名称做轻量分类。"""
    protocol = protocol if protocol in _ports.SUPPORTED_PROVIDER_PROTOCOLS else "openai"
    if protocol == "codex":
        status = await codex_status()
        payload = codex_models_payload(raw={"status": status})
        payload["message"] = status.get("message") or payload["message"]
        return payload
    if protocol == "gemini-cli":
        status = await gemini_cli_status()
        payload = gemini_cli_models_payload(raw={"status": status})
        payload["message"] = status.get("message") or payload["message"]
        return payload
    if protocol == "jimeng":
        return await jimeng_models_payload()
    if protocol == "runninghub":
        provider = {"id": "runninghub", "name": "RunningHub", "base_url": base_url or _ports.RUNNINGHUB_DEFAULT_BASE_URL, "protocol": "runninghub", "api_key": api_key}
        return await runninghub_models_payload(provider)
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = _ports.volcengine_provider_api_key(api_key) if protocol == "volcengine" else (api_key or "").strip()
    if not api_key:
        key_name = "方舟 API Key" if protocol == "volcengine" else "API Key"
        raise HTTPException(status_code=400, detail=f"请先填写或保存 {key_name}")
    url = upstream_models_url(base_url, protocol)
    request_url = (
        f"{url}?expand=parameters"
        if protocol == "apimart" and is_official_apimart_url(base_url)
        else url
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(request_url, headers=upstream_model_headers(api_key, protocol))
            endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location") or resp.headers.get("location") or ""
                suffix = f"：{location}" if location else ""
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 发生跳转{suffix}，请填写 API Base URL，不要填写网页登录地址")
            if looks_like_html_response(resp.text):
                raise HTTPException(status_code=400, detail=f"上游 {endpoint_label} 返回网页 HTML，请检查请求地址是否为 API Base URL")
            if resp.status_code >= 400:
                if protocol == "volcengine":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or resp.status_code,
                            message=f"{probe.get('message') or '方舟任务接口可达'}；但 /api/v3/models 不可用。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": resp.text[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                elif protocol == "openai":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or resp.status_code,
                            message=f"{probe.get('message') or '检测到方舟/Ark 兼容入口'}；OpenAI /v1/models 不可用，已自动切换为方舟协议。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": resp.text[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
                raise HTTPException(status_code=resp.status_code, detail=f"上游 {endpoint_label} 失败：{resp.text[:300]}")
            raw = resp.json()
    except httpx.HTTPError as e:
        if protocol == "volcengine":
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        payload = volcengine_default_model_payload(
                            status=probe.get("status") or 0,
                            message=f"{probe.get('message') or '方舟任务接口可达'}；但模型列表请求失败。请按实际方舟控制台模型名称手动填写视频模型。",
                            raw={"models_error": str(e)[:300], **(probe.get("raw") or {})},
                        )
                        return {
                            "total": payload["model_count"],
                            "protocol": payload["protocol"],
                            "image_models": payload["image_models"],
                            "chat_models": payload["chat_models"],
                            "video_models": payload["video_models"],
                            "all": payload["all"],
                            "message": payload["message"],
                            "raw": payload["raw"],
                        }
            except Exception:
                pass
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败：{e}")
    grouped, ids = parse_upstream_models(raw, protocol)
    grouped, ids = apply_agnes_model_defaults(base_url, grouped, ids)
    grouped = _ports.apply_locked_recommended_model_rules(base_url, grouped)
    if protocol == "volcengine" and not ids:
        payload = volcengine_default_model_payload(raw=raw)
        return {
            "total": payload["model_count"],
            "image_models": payload["image_models"],
            "chat_models": payload["chat_models"],
            "video_models": payload["video_models"],
            "all": payload["all"],
            "message": payload["message"],
            "raw": payload["raw"],
        }
    result = {
        "total": len(ids),
        "image_models": grouped["image"],
        "chat_models": grouped["chat"],
        "video_models": grouped["video"],
        "all": ids,
        "image_request_mode": detect_image_request_mode(base_url, ids) or _ports.normalize_image_request_mode(image_request_mode),
    }
    if protocol == "gemini":
        metadata, model_names = gemini_model_discovery(raw)
        result["model_names"] = model_names
        result["_capability_discovery"] = {
            "kind": "gemini-api",
            "source_locator": url,
            "models": metadata,
        }
    elif protocol == "apimart" and is_official_apimart_url(base_url):
        result["_capability_discovery"] = {
            "kind": "apimart-api",
            "source_locator": request_url,
            "models": apimart_model_discovery(raw),
        }
    return result

def apply_agnes_model_defaults(base_url, grouped, ids):
    if "apihub.agnes-ai.com" not in str(base_url or "").strip().lower():
        return grouped, ids
    grouped = {key: list(value or []) for key, value in (grouped or {}).items()}
    ids = list(ids or [])
    for model in _ports.AGNES_DEFAULT_VIDEO_MODELS:
        if model not in ids:
            ids.append(model)
        if model not in grouped.setdefault("video", []):
            grouped["video"].append(model)
    ids = sorted(set(ids))
    grouped["video"] = sorted(set(grouped.get("video") or []))
    return grouped, ids

def openai_compat_root_for_probe(base_url: str):
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/api/v3"):
        base = base[: -len("/api/v3")]
    if base.endswith("/v1"):
        return base
    return f"{base}/v1" if base else ""

def protocol_from_payload(payload):
    provider_id = str(getattr(payload, "provider_id", "") or "").strip().lower()
    if provider_id == "volcengine":
        return "volcengine"
    if provider_id == "runninghub":
        return "runninghub"
    if provider_id == "jimeng":
        return "jimeng"
    base_url = str(getattr(payload, "base_url", "") or "").strip().lower()
    if "runninghub.cn" in base_url or "runninghub.ai" in base_url:
        return "runninghub"
    protocol = str(getattr(payload, "protocol", "") or "openai").strip().lower()
    return protocol if protocol in _ports.SUPPORTED_PROVIDER_PROTOCOLS else "openai"

async def probe_openai_models_endpoint(client, base_url: str, api_key: str):
    url = upstream_models_url(base_url, "openai")
    response = await client.get(url, headers=upstream_model_headers(api_key, "openai"))
    try:
        raw = response.json() if response.text else {}
    except Exception:
        raw = response.text[:500]
    if response.status_code in (301, 302, 303, 307, 308):
        location = response.headers.get("Location") or response.headers.get("location") or ""
        suffix = f"：{location}" if location else ""
        return False, {"status": response.status_code, "message": f"OpenAI /v1/models 发生跳转{suffix}，请填写 API Base URL，不要填写网页登录地址", "raw": raw}
    if response.status_code in (401, 403):
        return False, {"status": response.status_code, "message": "OpenAI API Key 无效或无权限", "raw": raw}
    if looks_like_html_response(response.text):
        return False, {"status": response.status_code, "message": "OpenAI /v1/models 返回网页 HTML，请检查请求地址是否为 API Base URL", "raw": raw}
    if response.status_code < 300:
        grouped, ids = parse_upstream_models(raw, "openai") if isinstance(raw, dict) else ({"image": [], "chat": [], "video": []}, [])
        grouped, ids = apply_agnes_model_defaults(base_url, grouped, ids)
        grouped = _ports.apply_locked_recommended_model_rules(base_url, grouped)
        return True, {
            "status": response.status_code,
            "message": f"OpenAI 兼容模型列表端点可用{f'，找到 {len(ids)} 个模型' if ids else ''}",
            "raw": raw,
            "model_count": len(ids),
            "image_models": grouped["image"],
            "chat_models": grouped["chat"],
            "video_models": grouped["video"],
            "all": ids,
        }
    if 400 <= response.status_code < 500:
        return False, {"status": response.status_code, "message": f"OpenAI /v1/models 不可用 (HTTP {response.status_code})", "raw": raw}
    return False, {"status": response.status_code, "message": f"OpenAI /v1/models 服务端错误 {response.status_code}", "raw": raw}

def upstream_models_url(base_url: str, protocol: str):
    if protocol == "gemini":
        return f"{base_url}/models" if base_url.endswith("/v1beta") else f"{base_url}/v1beta/models"
    if protocol == "volcengine":
        return f"{base_url}/models" if base_url.endswith("/api/v3") else f"{base_url}/api/v3/models"
    if protocol == "runninghub":
        return runninghub_openapi_url({"base_url": base_url}, "models")
    return f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"

async def probe_async_endpoint(payload: TestConnectionPayload):
    """验证异步协议：用假 task_id 请求 GET /v1/tasks/{fake_id}。
    收到 400 Invalid task ID = 端点存在且 Key 有效；401/403 = Key 无效；404/连接失败 = 不支持异步端点。"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    protocol = protocol_from_payload(payload)
    if protocol == "codex":
        status = await codex_status()
        return {
            "ok": bool(status.get("installed")),
            "protocol": "codex",
            "status_code": 200 if status.get("installed") else 0,
            "message": status.get("message") or "OpenAI Codex CLI 本机检测完成",
            "raw": status,
        }
    if protocol == "gemini-cli":
        status = await gemini_cli_status()
        return {
            "ok": bool(status.get("installed")),
            "protocol": "gemini-cli",
            "status_code": 200 if status.get("installed") else 0,
            "message": status.get("message") or "Antigravity CLI 本机检测完成",
            "raw": status,
        }
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    api_key = api_key_from_payload(payload, protocol)
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    if protocol == "volcengine":
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                task_ok, task_probe = await probe_volcengine_task_endpoint(client, base_url, api_key)
                if task_ok:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": task_probe.get("status") or 200,
                        "message": "方舟/Ark 任务协议可用",
                        "raw": task_probe.get("raw"),
                    }
                compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
                if compat_ok:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": compat_probe.get("status") or 200,
                        "message": "方舟/Ark Bearer 鉴权入口可用（OpenAI 兼容透传）",
                        "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
                    }
                return {
                    "ok": False,
                    "protocol": "volcengine",
                    "status_code": compat_probe.get("status") or task_probe.get("status") or 0,
                    "message": compat_probe.get("message") or task_probe.get("message") or "方舟/Ark 任务协议不可用",
                    "raw": {"task_probe": task_probe, "openai_compat_probe": compat_probe.get("raw")},
                }
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=str(e)[:300])
    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={"Authorization": _ports.bearer_auth_value(api_key), "Accept": "application/json"})
            try:
                body = resp.json()
            except Exception:
                body = resp.text[:500]
            sc = resp.status_code
            # 判断结果
            err_msg = ""
            if isinstance(body, dict):
                err = body.get("error") or {}
                if isinstance(err, dict):
                    err_msg = str(err.get("message") or "").lower()
                else:
                    err_msg = str(err).lower()
            # 400 + "invalid task id" → 端点存在，Key 有效
            if sc == 400 and "invalid task id" in err_msg:
                return {"ok": True, "protocol": "apimart", "status_code": sc, "message": "APIMart 异步任务端点可用，API Key 已通过认证", "raw": body}

            async_probe = {"status": sc, "message": "", "raw": body}
            if sc in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location") or resp.headers.get("location") or ""
                async_probe["message"] = f"/v1/tasks/ 发生跳转{f'：{location}' if location else ''}"
            elif looks_like_html_response(resp.text):
                async_probe["message"] = "/v1/tasks/ 返回网页 HTML"
            elif sc in (401, 403):
                async_probe["message"] = "/v1/tasks/ 返回鉴权失败"
            elif sc == 404:
                async_probe["message"] = "平台不支持 /v1/tasks/ 端点，可能不是 APIMart 异步协议"
            elif 400 <= sc < 500:
                async_probe["message"] = f"/v1/tasks/ 返回 {sc}"
            elif sc < 300:
                async_probe["message"] = f"/v1/tasks/ 返回 {sc}（意外成功）"
            else:
                async_probe["message"] = f"/v1/tasks/ 服务端错误 {sc}"

            if protocol == "apimart":
                return {"ok": False, "protocol": "apimart", "status_code": sc, "message": async_probe["message"], "raw": body}

            openai_ok, openai_probe = await probe_openai_models_endpoint(client, base_url, api_key)
            if not openai_ok and protocol == "openai":
                # /v1/models 不可用，先确认是不是“没实现 models 接口的 OpenAI 兼容站”：探一下 /v1/chat/completions。
                # 可达就判定为 OpenAI 兼容（很多网关不暴露 /v1/models），避免被下面的方舟探测（404 也算可达）误判成方舟。
                compat_ok, compat_probe = await probe_openai_compat_bearer_endpoint(client, base_url, api_key)
                # 仅当 /v1/chat/completions 确实存在（返回 2xx 或我们发空 messages 触发的 400 等，而非 404 路径不存在）
                # 才判为 OpenAI 兼容；404 说明该路径不存在，留给后面的方舟探测。
                if compat_ok and (compat_probe.get("status") or 0) != 404:
                    return {
                        "ok": True,
                        "protocol": "openai",
                        "status_code": compat_probe.get("status") or openai_probe.get("status") or sc,
                        "message": "OpenAI 兼容入口可达（该站未提供 /v1/models，模型请手动填写）",
                        "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw"), "openai_compat_probe": compat_probe.get("raw")},
                        "model_count": 0,
                        "image_models": [],
                        "chat_models": [],
                        "video_models": [],
                        "all": [],
                    }
                detected, volc_probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                if detected:
                    return {
                        "ok": True,
                        "protocol": "volcengine",
                        "status_code": volc_probe.get("status") or openai_probe.get("status") or sc,
                        "message": f"{volc_probe.get('message') or '检测到方舟/Ark 兼容入口'}，已自动切换为方舟/Ark 任务协议",
                        "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw"), **(volc_probe.get("raw") or {})},
                    }
            return {
                "ok": openai_ok,
                "protocol": "openai",
                "status_code": openai_probe.get("status") or sc,
                "message": openai_probe.get("message") or "OpenAI 兼容验证完成",
                "raw": {"async_probe": async_probe, "openai_probe": openai_probe.get("raw")},
                "model_count": openai_probe.get("model_count") or 0,
                "image_models": openai_probe.get("image_models") or [],
                "chat_models": openai_probe.get("chat_models") or [],
                "video_models": openai_probe.get("video_models") or [],
                "all": openai_probe.get("all") or [],
                "image_request_mode": detect_image_request_mode(base_url, openai_probe.get("all") or []) or _ports.normalize_image_request_mode(getattr(payload, "image_request_mode", "")),
            }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])

async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    """按页面当前表单值拉取模型，支持新增平台未保存时直接使用临时 Base URL / Key。"""
    protocol = protocol_from_payload(payload)
    api_key = api_key_from_payload(payload, protocol)
    return await fetch_models_from_upstream(payload.base_url, api_key, protocol, payload.image_request_mode)

async def fetch_upstream_models(provider_id: str):
    """从已保存的上游 OpenAI 兼容接口拉取 /v1/models 列表，按名称智能分类为 image/chat/video。"""
    provider = _ports.get_api_provider_exact(provider_id)
    if is_codex_provider(provider):
        return await fetch_models_from_upstream("", "", "codex", provider.get("image_request_mode") or "openai")
    if is_gemini_cli_provider(provider):
        return await fetch_models_from_upstream("", "", "gemini-cli", provider.get("image_request_mode") or "openai")
    if is_jimeng_provider(provider):
        return await fetch_models_from_upstream(
            "", "", "jimeng", provider.get("image_request_mode") or "openai"
        )
    api_key = os.getenv(_ports.runninghub_wallet_key_env(), "") if provider["id"] == "runninghub" else ""
    if not api_key:
        api_key = _ports.provider_env_key_value(provider["id"])
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key, provider_protocol(provider), provider.get("image_request_mode") or "openai")

async def test_http_provider_connection(payload: TestConnectionPayload):
    """测试请求地址是否可用：调上游 /v1/models。验证通过时同时把模型清单按类别返回，避免再调一次拉取接口。"""
    protocol = protocol_from_payload(payload)
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = api_key_from_payload(payload, protocol)
    if not api_key:
        key_name = "方舟 API Key" if protocol == "volcengine" else "API Key"
        raise HTTPException(status_code=400, detail=f"请先填写或保存 {key_name}")
    url = upstream_models_url(base_url, protocol)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=upstream_model_headers(api_key, protocol))
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location") or resp.headers.get("location") or ""
                suffix = f"：{location}" if location else ""
                endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
                return {"ok": False, "status": resp.status_code, "message": f"上游 {endpoint_label} 发生跳转{suffix}，请填写 API Base URL，不要填写网页登录地址"}
            if looks_like_html_response(resp.text):
                endpoint_label = "/v1beta/models" if protocol == "gemini" else "/api/v3/models" if protocol == "volcengine" else "/openapi/v2/models" if protocol == "runninghub" else "/v1/models"
                return {"ok": False, "status": resp.status_code, "message": f"上游 {endpoint_label} 返回网页 HTML，请检查请求地址是否为 API Base URL"}
            if resp.status_code >= 400:
                if protocol == "volcengine":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '方舟任务接口可达'}；但 /api/v3/models 不可用。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or resp.status_code, message=message, raw={"models_error": resp.text[:300], **(probe.get("raw") or {})})
                elif protocol == "openai":
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '检测到方舟/Ark 兼容入口'}；OpenAI /v1/models 不可用，已自动切换为方舟协议。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or resp.status_code, message=message, raw={"models_error": resp.text[:300], **(probe.get("raw") or {})})
                return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}
            data = resp.json() if resp.text else {}
            grouped, ids = parse_upstream_models(data, protocol)
            grouped, ids = apply_agnes_model_defaults(base_url, grouped, ids)
            grouped = _ports.apply_locked_recommended_model_rules(base_url, grouped)
            if protocol == "volcengine" and not ids:
                detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                if detected:
                    return volcengine_default_model_payload(status=resp.status_code, raw=data)
            return {
                "ok": True,
                "status": resp.status_code,
                "model_count": len(ids),
                "image_models": grouped["image"],
                "chat_models": grouped["chat"],
                "video_models": grouped["video"],
                "all": ids,
                "image_request_mode": detect_image_request_mode(base_url, ids) or _ports.normalize_image_request_mode(getattr(payload, "image_request_mode", "")),
            }
    except httpx.HTTPError as e:
        if protocol == "volcengine":
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    detected, probe = await probe_volcengine_auto_detect(client, base_url, api_key)
                    if detected:
                        message = f"{probe.get('message') or '方舟任务接口可达'}；但模型列表请求失败。请按实际方舟控制台模型名称手动填写视频模型。"
                        return volcengine_default_model_payload(status=probe.get("status") or 0, message=message, raw={"models_error": str(e)[:300], **(probe.get("raw") or {})})
            except Exception:
                pass
        return {"ok": False, "status": 0, "message": str(e)[:300]}
