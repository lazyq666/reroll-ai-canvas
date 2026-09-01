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

from .ports import ComfyUiPorts, DynamicPorts
from .core import Pending
_ports = DynamicPorts("comfyui")
NEXT_TASK_ID = 1
COMFYUI_INSTANCES = ["127.0.0.1:8188"]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]
BACKEND_LOCAL_LOAD = {COMFYUI_ADDRESS: 0}

def configure_ports(ports: ComfyUiPorts) -> None:
    _ports.configure(ports)
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
    COMFYUI_INSTANCES = _ports.COMFYUI_INSTANCES
    COMFYUI_ADDRESS = _ports.COMFYUI_ADDRESS
    BACKEND_LOCAL_LOAD = _ports.BACKEND_LOCAL_LOAD

def bind_ports(ports: ComfyUiPorts):
    return _ports.bind(ports)

def comfy_class_is_debug_text(class_type):
    ct = str(class_type or "").lower()
    return bool(ct) and any(h in ct for h in _ports.COMFY_DEBUG_TEXT_CLASS_HINTS)

def collect_comfy_file_items(node_output):
    items = []
    for key, value in (node_output or {}).items():
        if key in {"text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions"}:
            continue
        candidates = value if isinstance(value, list) else [value]
        for item in candidates:
            if isinstance(item, dict) and item.get("filename"):
                items.append((key, item))
    return items

def comfy_text_values_from_output(node_output):
    values = []
    text_keys = ("text", "texts", "prompt", "prompts", "string", "strings", "caption", "captions")
    for key in text_keys:
        if key not in node_output:
            continue
        value = node_output.get(key)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict):
                text = item.get("text") or item.get("prompt") or item.get("caption") or item.get("value")
                name = item.get("filename") or item.get("name") or f"{key}.txt"
            else:
                text = item
                name = f"{key}.txt"
            if text is None:
                continue
            text = str(text)
            if text.strip():
                values.append((text, name))
    return values

def comfy_class_is_preview(class_type):
    ct = str(class_type or "").lower()
    return bool(ct) and any(h in ct for h in _ports.COMFY_PREVIEW_CLASS_HINTS)

def download_comfy_output(comfy_address, item, prefix="studio_"):
    ext = comfy_output_extension(item)
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    local_path = _ports.output_path_for(filename, "output")
    subfolder = urllib.parse.quote(str(item.get("subfolder") or ""))
    file_type = urllib.parse.quote(str(item.get("type") or "output"))
    comfy_url_path = f"/view?filename={urllib.parse.quote(str(item['filename']))}&subfolder={subfolder}&type={file_type}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url, timeout=_ports.COMFYUI_DOWNLOAD_TIMEOUT) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return _ports.output_url_for(filename, "output")
    except Exception as e:
        print(f"下载 ComfyUI 输出失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def upload_workflow(payload: WorkflowUploadRequest):
    name = os.path.basename(payload.name.strip())
    if not name.endswith(".json"):
        name = name + ".json"
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法，请使用中文/英文/数字/_-.")
    if not isinstance(payload.workflow, dict) or not payload.workflow:
        raise HTTPException(status_code=400, detail="工作流 JSON 为空")
    # 简单校验：是 API 格式（节点 id 为 key，含 class_type）
    sample = next(iter(payload.workflow.values()), None)
    if not isinstance(sample, dict) or "class_type" not in sample:
        raise HTTPException(status_code=400, detail="不是有效的 ComfyUI API 工作流 JSON（需包含 class_type）")
    os.makedirs(_ports.user_workflow_directory(), exist_ok=True)
    stored_name = f"{_ports.CUSTOM_WORKFLOW_FOLDER}/{name}"
    path = workflow_path_from_name(stored_name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload.workflow, f, ensure_ascii=False, indent=2)
    return {"name": stored_name}

def get_comfy_history(comfy_address, prompt_id):
    try:
        with urllib.request.urlopen(f"http://{comfy_address}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except Exception as e:
        return {}

def reserve_best_backend(required_images: List[str] = None):
    backend_stats = {}
    for addr in COMFYUI_INSTANCES:
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                has_images = _ports.check_images_exist(addr, required_images)
                backend_stats[addr] = {"remote_load": remote_load, "has_images": has_images}
        except Exception as e:
            print(f"Backend {addr} unreachable: {e}")
            continue
    with _ports.LOAD_LOCK:
        best_backend = COMFYUI_INSTANCES[0]
        min_load = float('inf')
        if backend_stats:
            for addr, stats in backend_stats.items():
                load = max(stats["remote_load"], BACKEND_LOCAL_LOAD.get(addr, 0))
                if load < min_load or (load == min_load and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
                    min_load = load
                    best_backend = addr
        BACKEND_LOCAL_LOAD[best_backend] = BACKEND_LOCAL_LOAD.get(best_backend, 0) + 1
        return best_backend

def save_comfyui_instances(payload: ComfyInstancesPayload):
    # 宽容校验：去前后空白、去 http(s):// 前缀、去尾部斜杠；要求形如 host:port
    cleaned = []
    for item in payload.instances:
        s = str(item or "").strip()
        if not s:
            continue
        s = re.sub(r"^https?://", "", s)
        s = s.rstrip("/")
        if ":" not in s:
            raise HTTPException(status_code=400, detail=f"地址缺少端口号：{item}（应为 host:port，例如 127.0.0.1:8188）")
        host, _, port = s.rpartition(":")
        if not host or not port.isdigit():
            raise HTTPException(status_code=400, detail=f"地址不合法：{item}（应为 host:port，例如 127.0.0.1:8188）")
        if s in cleaned:
            continue
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="至少保留一个 ComfyUI 后端地址")
    # 写入 env 文件
    try:
        _ports.update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入 env 失败：{e}")
    # 更新进程中的全局变量
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
    COMFYUI_INSTANCES = cleaned
    COMFYUI_ADDRESS = cleaned[0]
    new_load = {addr: 0 for addr in cleaned}
    for addr, n in (BACKEND_LOCAL_LOAD or {}).items():
        if addr in new_load:
            new_load[addr] = n
    BACKEND_LOCAL_LOAD = new_load
    return {"instances": COMFYUI_INSTANCES}

def generate(
    req: GenerateRequest,
    *,
    publish: bool = True,
    on_remote=None,
):
    """Legacy route facade; pure adapters pass ``publish=False``."""
    global NEXT_TASK_ID
    current_task = None
    target_backend = None
    with _ports.QUEUE_LOCK:
        task_id = NEXT_TASK_ID
        NEXT_TASK_ID += 1
        current_task = {"task_id": task_id, "client_id": req.client_id}
        _ports.QUEUE.append(current_task)

    try:
        required_images = collect_required_comfy_media(req.params)

        target_backend = reserve_best_backend(required_images)

        for image_name in required_images:
            need_sync = False
            try:
                check_url = f"http://{target_backend}/view?filename={urllib.parse.quote(image_name)}&type=input"
                resp = requests.get(check_url, stream=True, timeout=0.5)
                resp.close()
                if resp.status_code != 200:
                    need_sync = True
            except:
                need_sync = True

            if need_sync:
                image_content = None
                image_type = "image/png"
                for addr in COMFYUI_INSTANCES:
                    if addr == target_backend: continue
                    try:
                        src_url = f"http://{addr}/view?filename={urllib.parse.quote(image_name)}&type=input"
                        r = requests.get(src_url, timeout=5)
                        if r.status_code == 200:
                            image_content = r.content
                            image_type = r.headers.get("Content-Type", "image/png")
                            break
                    except: continue

                if image_content:
                    try:
                        files = {'image': (image_name, image_content, image_type)}
                        requests.post(f"http://{target_backend}/upload/image", files=files, timeout=10)
                    except Exception as e:
                        print(f"Sync upload failed: {e}")

        workflow_path = workflow_path_from_name(req.workflow_json)
        if not os.path.exists(workflow_path):
            raise Exception(f"Workflow file not found: {req.workflow_json}")

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        seed = random.randint(1, 4294967295)

        if "23" in workflow and req.prompt:
            workflow["23"]["inputs"]["text"] = req.prompt
        if "144" in workflow:
            workflow["144"]["inputs"]["width"] = req.width
            workflow["144"]["inputs"]["height"] = req.height
        if "22" in workflow:
            workflow["22"]["inputs"]["seed"] = seed
        if "158" in workflow:
            workflow["158"]["inputs"]["noise_seed"] = seed
        for node_id in ["146", "181"]:
            if node_id in workflow and "inputs" in workflow[node_id] and "seed" in workflow[node_id]["inputs"]:
                workflow[node_id]["inputs"]["seed"] = seed
        if "184" in workflow and "inputs" in workflow["184"] and "seed" in workflow["184"]["inputs"]:
            workflow["184"]["inputs"]["seed"] = seed
        if "172" in workflow and "inputs" in workflow["172"] and "seed" in workflow["172"]["inputs"]:
            workflow["172"]["inputs"]["seed"] = seed
        if "14" in workflow and "inputs" in workflow["14"] and "seed" in workflow["14"]["inputs"]:
            workflow["14"]["inputs"]["seed"] = seed

        for node_id, node_inputs in req.params.items():
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    workflow[node_id]["inputs"][input_name] = value

        p = {"prompt": workflow, "client_id": _ports.CLIENT_ID}
        data = json.dumps(p).encode('utf-8')
        try:
            post_req = urllib.request.Request(f"http://{target_backend}/prompt", data=data)
            prompt_id = json.loads(urllib.request.urlopen(post_req, timeout=10).read())['prompt_id']
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            raise Exception(f"HTTP Error {e.code}: {error_body}")
        if on_remote is not None:
            on_remote(
                Pending(
                    str(prompt_id),
                    raw={
                        "task_id": task_id,
                        "prompt_id": prompt_id,
                        "backend": target_backend,
                    },
                    status="running",
                )
            )

        history_data = None
        for i in range(_ports.COMFYUI_HISTORY_TIMEOUT):
            try:
                res = get_comfy_history(target_backend, prompt_id)
                if prompt_id in res:
                    history_data = res[prompt_id]
                    break
            except Exception:
                pass
            time.sleep(1)

        if not history_data:
            raise Exception("ComfyUI 渲染超时")

        local_images = []
        local_videos = []
        local_audios = []
        local_texts = []
        local_files = []
        local_items = []
        local_urls = []
        current_timestamp = time.time()
        if 'outputs' in history_data:
            # 先把所有节点的输出收集为候选（带上 class_type），再决定下载哪些，
            # 避免把冗余的预览/对比图、调试文本一起下载进结果（后端层过滤，历史记录也更干净）。
            workflow_nodes = workflow if isinstance(workflow, dict) else {}
            def _class_type_of(nid):
                node_def = workflow_nodes.get(str(nid))
                return str(node_def.get("class_type") or "") if isinstance(node_def, dict) else ""
            file_candidates = []   # (node_id, class_type, output_key, item, kind)
            text_candidates = []   # (node_id, class_type, text, name)
            for node_id in history_data['outputs']:
                node_output = history_data['outputs'][node_id]
                class_type = _class_type_of(node_id)
                for output_key, item in collect_comfy_file_items(node_output):
                    file_candidates.append((node_id, class_type, output_key, item, comfy_output_kind(item)))
                for text, name in comfy_text_values_from_output(node_output):
                    text_candidates.append((node_id, class_type, text, name))

            # 只要存在“非预览节点”产出的图片，就把 PreviewImage/对比节点的图片视为冗余丢弃；
            # 若整个工作流只有预览图（没有 SaveImage 等），则保留预览图作为唯一结果，避免零输出。
            has_primary_image = any(
                kind == "image" and not comfy_class_is_preview(ct)
                for (_nid, ct, _ok, _it, kind) in file_candidates
            )
            prefix = f"{req.type}_{int(current_timestamp)}_"
            for node_id, class_type, output_key, item, kind in file_candidates:
                if kind == "image" and has_primary_image and comfy_class_is_preview(class_type):
                    continue  # 跳过冗余的预览/对比图
                if publish:
                    local_path = download_comfy_output(
                        target_backend, item, prefix=prefix
                    )
                else:
                    query = urllib.parse.urlencode(
                        {
                            "filename": item.get("filename") or "",
                            "subfolder": item.get("subfolder") or "",
                            "type": item.get("type") or "output",
                        }
                    )
                    local_path = f"http://{target_backend}/view?{query}"
                if publish and kind == "image" and req.convert_to_jpg:
                    local_path = _ports.convert_output_to_jpg(local_path)
                name = os.path.basename(str(item.get("filename") or "")) or os.path.basename(str(local_path).split("?", 1)[0])
                entry = {
                    "url": local_path,
                    "kind": kind,
                    "name": name,
                    "node_id": str(node_id),
                    "output_key": str(output_key),
                    "class_type": class_type,
                }
                if kind == "image":
                    local_images.append(local_path)
                elif kind == "video":
                    local_videos.append(local_path)
                elif kind == "audio":
                    local_audios.append(local_path)
                elif kind == "text":
                    local_texts.append(local_path)
                else:
                    local_files.append(local_path)
                local_items.append(entry)
                local_urls.append(local_path)

            # 默认抑制 show/utility 类节点的调试文本，避免 .txt 噪声混入结果。
            for node_id, class_type, text, name in text_candidates:
                if comfy_class_is_debug_text(class_type):
                    continue
                local_path = (
                    save_comfy_text_output(text, prefix=prefix, name=name)
                    if publish
                    else ""
                )
                entry = {
                    "url": local_path,
                    "kind": "text",
                    "name": os.path.basename(str(local_path).split("?", 1)[0]),
                    "node_id": str(node_id),
                    "output_key": "text",
                    "class_type": class_type,
                    "text": text if not publish else "",
                }
                if local_path:
                    local_texts.append(local_path)
                local_items.append(entry)
                if local_path:
                    local_urls.append(local_path)

        result = {
            "prompt": req.prompt if req.prompt else "Detail Enhance",
            "images": local_images,
            "videos": local_videos,
            "audios": local_audios,
            "texts": local_texts,
            "files": local_files,
            "items": local_items,
            "outputs": local_urls,
            "seed": seed,
            "timestamp": current_timestamp,
            "type": req.type,
            "workflow_json": req.workflow_json,
            "task_id": task_id,
            "prompt_id": prompt_id,
            "backend": target_backend,
            "params": req.params
        }
        return result

    except Exception as e:
        return {"images": [], "error": str(e)}
    finally:
        if target_backend:
            with _ports.LOAD_LOCK:
                if BACKEND_LOCAL_LOAD.get(target_backend, 0) > 0:
                    BACKEND_LOCAL_LOAD[target_backend] -= 1
        if current_task:
            with _ports.QUEUE_LOCK:
                if current_task in _ports.QUEUE:
                    _ports.QUEUE.remove(current_task)


async def execute_comfyui_workflow(payload: GenerateRequest, on_remote=None):
    """Pure Provider execution seam; Generation Runs owns publication."""
    result = await asyncio.to_thread(
        generate,
        payload,
        publish=False,
        on_remote=on_remote,
    )
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(str(result.get("error") or "ComfyUI 生成失败"))
    return result

def workflow_path_from_name(name: str) -> str:
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    parts = name.replace("\\", "/").split("/")
    if len(parts) == 2:
        workflow_root = os.path.abspath(_ports.user_workflow_directory())
        try:
            path = str(
                _ports.current_workspace_content().user_workflow(parts[1])
            )
        except _ports.WorkspaceStorageError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc
    else:
        workflow_root = os.path.abspath(_ports.RESOURCE_WORKFLOW_DIR)
        path = os.path.abspath(os.path.join(workflow_root, parts[0]))
    if os.path.commonpath([workflow_root, path]) != workflow_root:
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    return path

def save_workflow_config(name: str, payload: WorkflowConfig):
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流配置不可修改")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    cfg_path = workflow_config_path(name)
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(payload.dict(), f, ensure_ascii=False, indent=2)
    return {"config": payload.dict()}

def comfy_output_kind(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"} or "image" in fmt:
        return "image"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or "video" in fmt:
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or "audio" in fmt or "sound" in fmt:
        return "audio"
    if ext in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"} or "text" in fmt or "json" in fmt:
        return "text"
    return "file"

def get_comfyui_instances():
    return {"instances": COMFYUI_INSTANCES}

async def upload_comfyui_base64(payload: Base64UploadRequest):
    """base64 方式把图片传到 ComfyUI 各后端的 input 目录，返回 comfy 用文件名（供 UXP 做 ComfyUI 图生图）。"""
    raw = (payload.data or "").strip()
    ct = (payload.content_type or "").split(";", 1)[0].strip().lower()
    if raw.startswith("data:"):
        header, _, raw = raw.partition(",")
        if not ct:
            ct = header[5:].split(";", 1)[0].strip().lower()
    try:
        content = base64.b64decode(raw, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="数据无法解码")
    if not content:
        raise HTTPException(status_code=400, detail="内容为空")
    _, ext = _ports._local_upload_kind_ext(payload.name or "", ct or "image/png")
    filename = f"dx_{uuid.uuid4().hex[:12]}{ext or '.png'}"
    comfy_name = None
    for addr in COMFYUI_INSTANCES:
        try:
            resp = requests.post(f"http://{addr}/upload/image",
                                 files={'image': (filename, content, ct or 'image/png')}, timeout=10)
            if resp.status_code == 200:
                comfy_name = resp.json().get("name", filename)
        except Exception as exc:
            print(f"ComfyUI base64 upload error for {addr}: {exc}")
    if not comfy_name:
        raise HTTPException(status_code=502, detail="上传到 ComfyUI 失败")
    return {"name": comfy_name}

def delete_workflow(name: str):
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流不可删除")
    workflow_path = workflow_path_from_name(name)
    cfg_path = workflow_config_path(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    os.remove(workflow_path)
    if os.path.exists(cfg_path):
        os.remove(cfg_path)
    return {"ok": True}

def is_comfy_input_media_value(input_name: str, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    key = str(input_name or "").lower()
    if any(token in key for token in _ports.MEDIA_INPUT_KEYS):
        return True
    return bool(_ports.MEDIA_INPUT_EXT_RE.search(value))

def list_workflows():
    items = []
    if os.path.isdir(_ports.RESOURCE_WORKFLOW_DIR):
        for fn in sorted(os.listdir(_ports.RESOURCE_WORKFLOW_DIR)):
            if (
                not fn.endswith(".json")
                or fn.endswith(".config.json")
                or fn in _ports.HIDDEN_BUILTIN_WORKFLOWS
            ):
                continue
            name = fn
            cfg = {}
            cfg_path = workflow_config_path(name)
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}
            items.append({
                "name": name,
                "title": cfg.get("title") or fn.replace(".json", ""),
                "builtin": True,
                "field_count": len(cfg.get("fields") or []),
            })
    user_workflows = _ports.user_workflow_directory()
    if not os.path.isdir(user_workflows):
        return {"workflows": items}
    for fn in sorted(os.listdir(user_workflows)):
        if not fn.endswith(".json") or fn.endswith(".config.json"):
            continue
        path = os.path.join(user_workflows, fn)
        if not os.path.isfile(path):
            continue
        name = f"{_ports.CUSTOM_WORKFLOW_FOLDER}/{fn}"
        cfg = {}
        cfg_path = workflow_config_path(name)
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            except Exception:
                cfg = {}
        items.append({
            "name": name,
            "title": cfg.get("title") or fn.replace(".json", ""),
            "builtin": False,
            "field_count": len(cfg.get("fields") or []),
        })
    items.sort(key=lambda item: (not item["builtin"], item["title"]))
    return {"workflows": items}

def collect_required_comfy_media(params: Dict[str, Any]) -> List[str]:
    required = []
    for node_inputs in (params or {}).values():
        if not isinstance(node_inputs, dict):
            continue
        for input_name, value in node_inputs.items():
            if is_comfy_input_media_value(input_name, value):
                required.append(value)
    return list(dict.fromkeys(required))

def run_workflow(
    name: str,
    payload: WorkflowRunRequest,
    *,
    publish: bool = True,
    on_remote=None,
):
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if not os.path.exists(workflow_path_from_name(name)):
        raise HTTPException(status_code=404, detail="Workflow not found")
    # 根据 config 的字段把值映射成 params 节点覆盖
    params: Dict[str, Dict[str, Any]] = {}
    for field in payload.config.fields:
        if not field.node or not field.input:
            continue
        if field.id in payload.fields:
            value = payload.fields[field.id]
            # 类型转换
            if field.type in ("number", "slider"):
                try:
                    value = float(value) if (field.step and field.step < 1) else int(float(value))
                except Exception:
                    pass
            elif field.type == "boolean":
                value = bool(value)
            elif field.type == "dropdown":
                # 下拉值如果看起来是数字（如 "1024" / "2048" / "0.8"），自动转成 int/float
                if isinstance(value, str):
                    s = value.strip()
                    try:
                        if s and ('.' in s or 'e' in s.lower()):
                            value = float(s)
                        elif s and (s.lstrip('-').isdigit()):
                            value = int(s)
                    except (ValueError, TypeError):
                        pass
            params.setdefault(field.node, {})[field.input] = value
    req = _ports.GenerateRequest(
        prompt="",
        workflow_json=name,
        params=params,
        type="workflow-test",
        client_id=payload.client_id or str(uuid.uuid4()),
    )
    return generate(req, publish=publish, on_remote=on_remote)


async def execute_comfyui_saved_workflow(payload, on_remote=None):
    """Pure saved-workflow execution seam for Generation Runs."""
    name = str(payload.get("name") or "")
    request = payload.get("payload")
    return await asyncio.to_thread(
        run_workflow,
        name,
        request,
        publish=False,
        on_remote=on_remote,
    )


async def execute_comfyui_recovery(payload):
    """Resume a submitted Comfy prompt without creating another prompt."""
    prompt_id = str((payload or {}).get("prompt_id") or "").strip()
    backend = str((payload or {}).get("backend") or "").strip()
    if not prompt_id or not backend:
        raise HTTPException(
            status_code=409,
            detail="ComfyUI 恢复信息缺少 prompt_id 或 backend",
        )

    def poll():
        history_data = None
        for _ in range(_ports.COMFYUI_HISTORY_TIMEOUT):
            result = get_comfy_history(backend, prompt_id)
            if prompt_id in result:
                history_data = result[prompt_id]
                break
            time.sleep(1)
        if not history_data:
            raise HTTPException(
                status_code=504,
                detail="ComfyUI 渲染超时",
            )
        projected = {
            "images": [],
            "videos": [],
            "audios": [],
            "texts": [],
            "files": [],
            "items": [],
            "outputs": [],
            "prompt_id": prompt_id,
            "backend": backend,
        }
        for node_id, node_output in (
            history_data.get("outputs") or {}
        ).items():
            for output_key, item in collect_comfy_file_items(node_output):
                kind = comfy_output_kind(item)
                query = urllib.parse.urlencode(
                    {
                        "filename": item.get("filename") or "",
                        "subfolder": item.get("subfolder") or "",
                        "type": item.get("type") or "output",
                    }
                )
                url = f"http://{backend}/view?{query}"
                projected[f"{kind}s" if kind != "audio" else "audios"].append(
                    url
                )
                projected["outputs"].append(url)
                projected["items"].append(
                    {
                        "url": url,
                        "kind": kind,
                        "name": str(item.get("filename") or ""),
                        "node_id": str(node_id),
                        "output_key": str(output_key),
                    }
                )
            for text, name in comfy_text_values_from_output(node_output):
                projected["items"].append(
                    {
                        "url": "",
                        "kind": "text",
                        "name": str(name or "output.txt"),
                        "node_id": str(node_id),
                        "output_key": "text",
                        "text": text,
                    }
                )
        return projected

    return await asyncio.to_thread(poll)

def download_image(comfy_address, comfy_url_path, prefix="studio_"):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    local_path = _ports.output_path_for(filename, "output")
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url, timeout=_ports.COMFYUI_DOWNLOAD_TIMEOUT) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return _ports.output_url_for(filename, "output")
    except Exception as e:
        print(f"下载图片失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def is_builtin_workflow(name: str) -> bool:
    return "/" not in name and os.path.isfile(workflow_path_from_name(name))

def get_workflow(name: str):
    if not _ports.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)
    cfg = {"title": name.replace(".json", ""), "fields": []}
    cfg_path = workflow_config_path(name)
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or cfg
        except Exception:
            pass
    return {"name": name, "workflow": workflow, "config": cfg, "builtin": is_builtin_workflow(name)}

def workflow_config_path(name: str) -> str:
    return workflow_path_from_name(name).replace(".json", ".config.json")

def comfy_output_extension(item):
    filename = str((item or {}).get("filename") or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext in {
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
        ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv",
        ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
        ".txt", ".json", ".csv", ".srt", ".vtt", ".md",
    }:
        return ext
    fmt = str((item or {}).get("format") or "").lower()
    if "mpeg" in fmt or "mp3" in fmt:
        return ".mp3"
    if "wav" in fmt or "wave" in fmt:
        return ".wav"
    if "ogg" in fmt:
        return ".ogg"
    if "flac" in fmt:
        return ".flac"
    if "text" in fmt or "plain" in fmt:
        return ".txt"
    if "json" in fmt:
        return ".json"
    if "webm" in fmt:
        return ".webm"
    if "quicktime" in fmt or "mov" in fmt:
        return ".mov"
    if "mp4" in fmt or "h264" in fmt or "video" in fmt:
        return ".mp4"
    return ext or ".bin"

def save_comfy_text_output(
    value, prefix="studio_", name="", stable_id=""
):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    stem = _ports.sanitize_export_filename(name or "comfy_text.txt", "comfy_text.txt")
    _, ext = os.path.splitext(stem)
    if ext.lower() not in {".txt", ".json", ".csv", ".srt", ".vtt", ".md"}:
        stem += ".txt"
    clean_id = re.sub(
        r"[^a-zA-Z0-9_-]+", "_", str(stable_id or "")
    ).strip("_")[:100]
    filename = (
        f"{prefix}{clean_id}_{stem}"
        if clean_id
        else f"{prefix}{uuid.uuid4().hex[:10]}_{stem}"
    )
    path = _ports.output_path_for(filename, "output")
    if clean_id and os.path.isfile(path):
        return _ports.output_url_for(filename, "output")
    temporary = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)
    return _ports.output_url_for(filename, "output")

def get_best_backend(required_images: List[str] = None):
    best_backend = COMFYUI_INSTANCES[0]
    min_queue_size = float('inf')
    backend_stats = {}

    for addr in COMFYUI_INSTANCES:
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                with _ports.LOAD_LOCK:
                    local_load = BACKEND_LOCAL_LOAD.get(addr, 0)
                effective_load = max(remote_load, local_load)
                has_images = _ports.check_images_exist(addr, required_images)
                backend_stats[addr] = {"load": effective_load, "has_images": has_images}
        except Exception as e:
            print(f"Backend {addr} unreachable: {e}")
            continue

    if not backend_stats:
        return COMFYUI_INSTANCES[0]

    for addr, stats in backend_stats.items():
        load = stats["load"]
        if load < min_queue_size or (load == min_queue_size and stats.get("has_images") and not backend_stats.get(best_backend, {}).get("has_images")):
            min_queue_size = load
            best_backend = addr

    return best_backend
