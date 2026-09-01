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

from .ports import DynamicPorts, ModelScopePorts
from .core import Pending
from .implementation import (
    extract_image,
    parse_size_pair,
    selected_model,
)

_ports = DynamicPorts("modelscope")


def _checkpoint_task(on_remote, task_id, raw, *, status="running"):
    if on_remote is not None and str(task_id or "").strip():
        on_remote(Pending(str(task_id), raw=raw, status=status))


async def _cloud_status(req, task_id, status, **values):
    client_id = str(getattr(req, "client_id", "") or "")
    manager = getattr(_ports, "progress_manager", None)
    send = getattr(manager, "send_personal_message", None)
    if not client_id or not callable(send):
        return
    await send(
        {
            "type": "cloud_status",
            "status": status,
            "task_id": task_id,
            **values,
        },
        client_id,
    )

def configure_ports(ports: ModelScopePorts) -> None:
    _ports.configure(ports)

def bind_ports(ports: ModelScopePorts):
    return _ports.bind(ports)

async def generate_modelscope_provider_image(
    prompt,
    size,
    model,
    reference_images=None,
    provider=None,
    on_remote=None,
):
    clean_token = _ports.modelscope_api_key()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
    width, height = parse_size_pair(size)
    refs = []
    for ref in (reference_images or [])[:_ports.ONLINE_IMAGE_REFERENCE_MAX]:
        if not ref.get("url"):
            continue
        # 本地参考图转为 data URL；前端已生成的 data URL 保持原样，贴近旧版稳定链路。
        refs.append(modelscope_image_url(ref.get("url", ""), max_size=1536))
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
    }
    payload = {
        "model": selected_model(model, "Tongyi-MAI/Z-Image-Turbo"),
        "prompt": prompt.strip(),
    }
    if width and height:
        payload["width"] = width
        payload["height"] = height
        payload["size"] = f"{width}x{height}"
    if refs:
        payload["image_url"] = refs

    api_root = _ports.modelscope_image_api_root()
    async with httpx.AsyncClient(timeout=_ports.AI_REQUEST_TIMEOUT) as client:
        submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
        submit_res.raise_for_status()
        raw = submit_res.json()
        task_id = raw.get("task_id")
        if not task_id:
            try:
                return extract_image(raw), raw
            except HTTPException:
                raise HTTPException(status_code=502, detail=f"ModelScope 未返回 task_id：{raw}")
        _checkpoint_task(on_remote, task_id, raw)

        deadline = time.monotonic() + _ports.AI_REQUEST_TIMEOUT
        last_payload = raw
        while time.monotonic() < deadline:
            await asyncio.sleep(_ports.IMAGE_POLL_INTERVAL)
            result = await client.get(
                f"{api_root}/tasks/{task_id}",
                headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
            )
            result.raise_for_status()
            data = result.json()
            last_payload = data
            status = str(data.get("task_status") or "").upper()
            if status == "SUCCEED":
                images = data.get("output_images") or []
                if not images:
                    raise HTTPException(status_code=502, detail=f"ModelScope 成功但没有返回图片：{data}")
                return {"type": "url", "value": images[0]}, data
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                detail = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{detail}")
        raise HTTPException(status_code=504, detail=f"ModelScope 生图任务超时：{last_payload}")


async def recover_modelscope_provider_image(
    _provider,
    task_id,
):
    """Query one durable ModelScope image task without submitting again."""
    task_id = str(task_id or "").strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="缺少 ModelScope task_id")
    clean_token = _ports.modelscope_api_key()
    if not clean_token:
        raise HTTPException(
            status_code=400,
            detail="未配置 ModelScope API Key，无法恢复原任务",
        )
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
        "X-ModelScope-Task-Type": "image_generation",
    }
    api_root = _ports.modelscope_image_api_root()
    async with httpx.AsyncClient(
        timeout=_ports.AI_REQUEST_TIMEOUT
    ) as client:
        response = await client.get(
            f"{api_root}/tasks/{task_id}",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
    status = str(data.get("task_status") or "").upper()
    if status == "SUCCEED":
        images = [
            str(value)
            for value in (data.get("output_images") or ())
            if str(value or "").strip()
        ]
        if not images:
            return {
                "status": "failed",
                "task_id": task_id,
                "error": "ModelScope 任务成功但没有返回图片",
            }
        return {
            "status": "succeeded",
            "task_id": task_id,
            "images": images,
        }
    if status in {
        "FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED",
        "TIMEOUT", "REVOKED",
    }:
        return {
            "status": "failed",
            "task_id": task_id,
            "error": str(
                data.get("error_info")
                or data.get("message")
                or data.get("detail")
                or data
            ),
        }
    return {
        "status": "pending",
        "task_id": task_id,
        "raw": data,
    }


def modelscope_size(value, fallback="1024x1024"):
    size = str(value or fallback).strip().lower().replace("*", "x")
    if re.fullmatch(r"\d{2,5}x\d{2,5}", size):
        return size
    raise HTTPException(status_code=400, detail=f"ModelScope size 格式不正确：{value or fallback}，应为 WxH，例如 1024x1024")

def modelscope_image_url(value, max_size=1536):
    if not value:
        return value
    if isinstance(value, str) and (value.startswith("/assets/")):
        return _ports.reference_to_data_url({"url": value}, max_size=max_size)
    return value

async def ms_generate(
    req: MsGenerateRequest,
    *,
    publish: bool = True,
    on_remote=None,
):
    """Legacy route facade; pure adapters pass ``publish=False``."""
    api_root = _ports.modelscope_image_api_root()
    clean_token = _ports.modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写，或重新保存 ModelScope Token。")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": req.model,
        "prompt": req.prompt.strip(),
    }
    if req.width and req.height:
        payload["width"] = req.width
        payload["height"] = req.height
        payload["size"] = modelscope_size(req.size or f"{req.width}x{req.height}")
    elif req.size:
        payload["size"] = modelscope_size(req.size)
    if req.image_urls:
        payload["image_url"] = [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{api_root}/images/generations",
                headers=headers,
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            _checkpoint_task(on_remote, task_id, submit_res.json())
            print(f"MS Generate Task submitted ({req.model}), ID: {task_id}")

            TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{api_root}/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")
                    print(f"MS Task {task_id} poll {i}: status={status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        if not publish:
                            return {"url": img_url, "task_id": task_id}
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                    file_path = _ports.output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = _ports.output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        return {"url": local_path, "task_id": task_id}

                    elif status in TERMINAL_FAILED_STATUSES:
                        error_info = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                        raise HTTPException(status_code=502, detail=f"MS task {status}: {error_info}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    print(f"MS polling error: {loop_e}")
                    continue

            raise HTTPException(status_code=504, detail="MS 生图超时")

    except HTTPException:
        raise
    except Exception as e:
        print(f"MS generate error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

async def poll_angle_cloud(req: CloudPollRequest, *, publish: bool = True):
    """Legacy route facade; pure adapters pass ``publish=False``."""
    api_root = _ports.modelscope_image_api_root()
    clean_token = _ports.modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    task_id = req.task_id
    print(f"Resuming polling for Angle Task: {task_id}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(300):
                await asyncio.sleep(2)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                result.raise_for_status()
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    await _cloud_status(req, task_id, "SUCCEED")
                    if not publish:
                        return {"url": img_url, "task_id": task_id}
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_angle_{int(time.time())}.png"
                                file_path = _ports.output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = _ports.output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception:
                        local_path = img_url

                    return {"url": local_path}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    await _cloud_status(req, task_id, "FAILED")
                    raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                if i % 5 == 0:
                    await _cloud_status(
                        req,
                        task_id,
                        f"{status} ({i}/300)",
                        progress=i,
                        total=300,
                    )

            await _cloud_status(req, task_id, "TIMEOUT")
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Angle polling error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

async def generate_cloud(
    req: CloudGenRequest,
    *,
    publish: bool = True,
    on_remote=None,
):
    """Legacy route facade; pure adapters pass ``publish=False``."""
    api_root = _ports.modelscope_image_api_root()
    clean_token = _ports.modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": req.prompt.strip(),
        "size": modelscope_size(req.resolution),
        "n": 1
    }
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{api_root}/images/generations",
                headers={**headers, "X-ModelScope-Async-Mode": "true"},
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            _checkpoint_task(on_remote, task_id, submit_res.json())
            print(f"Z-Image Task submitted, ID: {task_id}")

            for i in range(200):
                await asyncio.sleep(3)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                result.raise_for_status()
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if i % 5 == 0:
                    print(f"Task {task_id} status check {i}: {status}")

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    if not publish:
                        return {"url": img_url, "task_id": task_id}
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_{int(time.time())}.png"
                                file_path = _ports.output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = _ports.output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception as dl_e:
                        print(f"Download error: {dl_e}")
                        local_path = img_url

                    return {"url": local_path}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

            raise Exception("Cloud generation timeout")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Cloud generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

async def generate_angle_cloud(
    req: CloudGenRequest,
    *,
    publish: bool = True,
    on_remote=None,
):
    """Legacy route facade; pure adapters pass ``publish=False``."""
    api_root = _ports.modelscope_image_api_root()
    clean_token = _ports.modelscope_api_key(req.api_key)
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    model = selected_model(req.model, "Qwen/Qwen-Image-Edit-2511")
    payload = {
        "model": model,
        "prompt": req.prompt.strip(),
        "image_url": [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    }
    if req.resolution:
        payload["size"] = modelscope_size(req.resolution)
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            _checkpoint_task(on_remote, task_id, submit_res.json())
            print(f"Angle Task submitted, ID: {task_id}")

            for i in range(300):
                await asyncio.sleep(2)
                result = await client.get(
                    f"{api_root}/tasks/{task_id}",
                    headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                )
                result.raise_for_status()
                data = result.json()
                status = str(data.get("task_status") or "").upper()

                if status == "SUCCEED":
                    img_url = data["output_images"][0]
                    await _cloud_status(req, task_id, "SUCCEED")
                    if not publish:
                        return {"url": img_url, "task_id": task_id}
                    local_path = ""
                    try:
                        async with httpx.AsyncClient() as dl_client:
                            img_res = await dl_client.get(img_url)
                            if img_res.status_code == 200:
                                filename = f"cloud_angle_{int(time.time())}.png"
                                file_path = _ports.output_path_for(filename, "output")
                                with open(file_path, "wb") as f:
                                    f.write(img_res.content)
                                local_path = _ports.output_url_for(filename, "output")
                            else:
                                local_path = img_url
                    except Exception:
                        local_path = img_url

                    return {"url": local_path, "task_id": task_id}

                elif status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                    await _cloud_status(req, task_id, "FAILED")
                    raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                if i % 5 == 0:
                    await _cloud_status(
                        req,
                        task_id,
                        f"{status} ({i}/300)",
                        progress=i,
                        total=300,
                    )

            await _cloud_status(req, task_id, "TIMEOUT")
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Angle generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


async def execute_modelscope_workflow(
    payload: MsGenerateRequest,
    on_remote=None,
):
    """Pure ModelScope executor; publication belongs to Generation Runs."""
    return await ms_generate(
        payload, publish=False, on_remote=on_remote
    )


async def execute_modelscope_cloud_workflow(
    payload: CloudGenRequest,
    on_remote=None,
):
    """Pure legacy cloud executor; publication belongs to Generation Runs."""
    return await generate_cloud(
        payload, publish=False, on_remote=on_remote
    )


async def execute_modelscope_angle_workflow(
    payload: CloudGenRequest,
    on_remote=None,
):
    """Pure Angle executor; publication belongs to Generation Runs."""
    return await generate_angle_cloud(
        payload, publish=False, on_remote=on_remote
    )


async def execute_modelscope_angle_recovery(payload: CloudPollRequest):
    """Pure Angle recovery executor; publication belongs to Generation Runs."""
    return await poll_angle_cloud(payload, publish=False)


async def execute_modelscope_recovery(payload):
    """Resume any ModelScope image task without submitting again."""
    return await poll_angle_cloud(payload, publish=False)
