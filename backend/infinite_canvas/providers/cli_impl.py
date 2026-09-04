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

from ..outbound_security import OutboundUrlError, httpx_get_public

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

from .ports import CliPorts, DynamicPorts
from .core import Pending
from .implementation import (
    is_antigravity_cli,
    normalize_gpt_image_2_size,
    parse_gpt_image_2_skill_output,
    parse_size_pair,
    provider_protocol,
    run_codex_cli,
    run_gemini_cli,
    run_jimeng_cli,
    save_ai_image_to_output,
    save_remote_video_to_output,
)

_ports = DynamicPorts("cli")

JIMENG_5_TEXT2IMAGE_PROMPT_MAX_CHARS = 1500
JIMENG_5_TEXT2IMAGE_PROMPT_RECOMMENDED_CHARS = 1400
CLI_REFERENCE_IMAGE_MAX_BYTES = 50 * 1024 * 1024
JIMENG_MODEL_HELP_COMMANDS = (
    ("text2image", "image"),
    ("image2image", "image"),
    ("text2video", "video"),
    ("image2video", "video"),
    ("frames2video", "video"),
    ("multimodal2video", "video"),
)

def configure_ports(ports: CliPorts) -> None:
    _ports.configure(ports)

def bind_ports(ports: CliPorts):
    return _ports.bind(ports)

def gpt_image_2_size_exceeds_supported(size):
    width, height = parse_size_pair(size)
    return bool(width and height and (max(width, height) > _ports.GPT_IMAGE2_MAX_EDGE or width * height > _ports.GPT_IMAGE2_MAX_PIXELS))

def is_jimeng_provider(provider):
    return provider_protocol(provider) == "jimeng" or str((provider or {}).get("id") or "").strip().lower() == "jimeng"

def jimeng_image_prompt_validation_error(
    prompt, model="", reference_images=None
):
    has_reference = False
    for reference in reference_images or []:
        if isinstance(reference, dict):
            value = reference.get("url") or reference.get("value")
        else:
            value = getattr(reference, "url", "") or reference
        if str(value or "").strip():
            has_reference = True
            break
    prompt_length = len(str(prompt or ""))
    if (
        has_reference
        or jimeng_normalize_image_model(model) not in {"5.0", "5.0Pro"}
        or prompt_length <= JIMENG_5_TEXT2IMAGE_PROMPT_MAX_CHARS
    ):
        return ""
    return (
        f"即梦 5.0 文生图提示词长度为 {prompt_length} 个字符，超过稳定上限 "
        f"{JIMENG_5_TEXT2IMAGE_PROMPT_MAX_CHARS}；请压缩到 "
        f"{JIMENG_5_TEXT2IMAGE_PROMPT_RECOMMENDED_CHARS} 字符以内后重试"
    )

def jimeng_remote_history_missing(raw, queue_info=None):
    if queue_info or not isinstance(raw, dict):
        return False
    nested = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    status = str(
        raw.get("gen_status")
        or raw.get("status")
        or nested.get("gen_status")
        or nested.get("status")
        or ""
    ).strip().lower()
    return status in {"querying", "pending", "running", "in_progress"}

def is_codex_provider(provider):
    return provider_protocol(provider) == "codex"

def is_gemini_cli_provider(provider):
    return provider_protocol(provider) == "gemini-cli"

def jimeng_env_value(key):
    return os.getenv(key, "") or _ports.read_api_env_value(key)

def gpt_image_2_size_error_message(size):
    width, height = parse_size_pair(size)
    display_size = size or "未指定"
    return (
        f"GPT-Image-2 不支持当前尺寸 {display_size}：它有最大像素限制"
        "（长边最大 3840、总像素约 829 万）。请改用更小的尺寸，"
        "或切换到 nano-banana 生成更高分辨率。"
    )

async def generate_jimeng_video(
    payload: CanvasVideoRequest, provider, on_remote=None
):
    image_refs = [ref for ref in (payload.images or []) if jimeng_video_ref_url(ref)]
    video_refs = [url for url in (payload.videos or []) if str(url or "").strip()]
    audio_refs = [url for url in (payload.audios or []) if str(url or "").strip()]
    model_version = jimeng_video_model_version(payload.model)
    if model_version == "seedance2.5":
        multimodal_limits = (30, 10, 10, 50)
    else:
        multimodal_limits = (9, 3, 3, 12)
    duration = jimeng_video_duration(payload.duration, payload.model)
    poll_seconds = (
        0 if on_remote is not None else jimeng_poll_seconds()
    )
    temp_paths = []
    try:
        if payload.multimodal or video_refs or audio_refs:
            image_paths = []
            video_paths = []
            audio_paths = []
            for ref in image_refs:
                image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                temp_paths.extend(created)
                image_paths.append(image_path)
            for ref_url in video_refs:
                video_path, created = await jimeng_prepare_local_media(ref_url, "video")
                temp_paths.extend(created)
                video_paths.append(video_path)
            for ref_url in audio_refs:
                audio_path, created = await jimeng_prepare_local_media(ref_url, "audio")
                temp_paths.extend(created)
                audio_paths.append(audio_path)
            args = [
                "multimodal2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--poll={poll_seconds}",
            ]
            ratio = jimeng_video_ratio_arg(payload.aspect_ratio)
            if ratio:
                args.append(f"--ratio={ratio}")
            jimeng_append_model_resolution_args(args, payload, include_model=True)
            for image_path in image_paths:
                args.append(f"--image={jimeng_cli_path_arg(image_path)}")
            for video_path in video_paths:
                args.append(f"--video={jimeng_cli_path_arg(video_path)}")
            for audio_path in audio_paths:
                args.append(f"--audio={jimeng_cli_path_arg(audio_path)}")
        elif any(
            jimeng_video_ref_role(ref) in {"first_frame", "last_frame"}
            for ref in image_refs
        ):
            first_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "first_frame"), None)
            last_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "last_frame"), None)
            if first_frame or last_frame:
                args = [
                    "frames2video",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={poll_seconds}",
                ]
                if first_frame:
                    first_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(first_frame), "image")
                    temp_paths.extend(created)
                    args.insert(1, f"--first={jimeng_cli_path_arg(first_path)}")
                if last_frame:
                    last_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(last_frame), "image")
                    temp_paths.extend(created)
                    args.insert(2 if first_frame else 1, f"--last={jimeng_cli_path_arg(last_path)}")
                jimeng_append_model_resolution_args(args, payload, include_model=True)
            else:
                raise HTTPException(status_code=400, detail="首尾帧模式缺少可用图片")
        elif len(image_refs) >= 2:
            first_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "first_frame"), None)
            last_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "last_frame"), None)
            if first_frame and last_frame:
                first_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(first_frame), "image")
                temp_paths.extend(created)
                last_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(last_frame), "image")
                temp_paths.extend(created)
                args = [
                    "frames2video",
                    f"--first={jimeng_cli_path_arg(first_path)}",
                    f"--last={jimeng_cli_path_arg(last_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={poll_seconds}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
            else:
                image_paths = []
                for ref in image_refs:
                    image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                    temp_paths.extend(created)
                    image_paths.append(image_path)
                args = [
                    "multiframe2video",
                    f"--images={','.join(jimeng_cli_path_arg(path) for path in image_paths)}",
                    f"--poll={poll_seconds}",
                ]
                transition_count = max(1, len(image_paths) - 1)
                transition_duration = jimeng_transition_duration(
                    payload.duration, transition_count
                )
                if len(image_paths) == 2:
                    args.extend([
                        f"--prompt={payload.prompt}",
                        f"--duration={transition_duration:g}",
                    ])
                else:
                    for _index in range(transition_count):
                        args.append(f"--transition-prompt={payload.prompt}")
                        args.append(
                            f"--transition-duration={transition_duration:g}"
                        )
                args.append(
                    "--video_resolution="
                    + jimeng_multiframe_video_resolution(payload.resolution)
                )
        elif image_refs:
            image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(image_refs[0]), "image")
            temp_paths.extend(created)
            ratio = jimeng_video_ratio_arg(payload.aspect_ratio)
            if ratio and jimeng_model_supports_multimodal(payload.model):
                args = [
                    "multimodal2video",
                    f"--image={jimeng_cli_path_arg(image_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--ratio={ratio}",
                    f"--poll={poll_seconds}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
            else:
                args = [
                    "image2video",
                    f"--image={jimeng_cli_path_arg(image_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={poll_seconds}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
        else:
            args = [
                "text2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--ratio={payload.aspect_ratio or '16:9'}",
                f"--poll={poll_seconds}",
            ]
            jimeng_append_model_resolution_args(args, payload, include_model=True)
        raw = await run_jimeng_cli(args, timeout=jimeng_poll_seconds() + 180)
        failure = jimeng_failure_reason(raw)
        if failure:
            raise HTTPException(
                status_code=502,
                detail=f"即梦提交失败：{failure}",
            )
        submit_id = jimeng_submit_id(raw)
        if on_remote is not None and submit_id:
            on_remote(
                Pending(str(submit_id), raw=raw, status="running")
            )
            completed = await wait_for_jimeng_submission(
                str(submit_id), "video", raw
            )
            return {
                "videos": list(completed.get("urls") or []),
                "task_id": str(submit_id),
                "raw": completed.get("raw") or completed,
            }
        if on_remote is not None:
            urls = jimeng_output_values(raw)
            if not urls:
                raise HTTPException(
                    status_code=502,
                    detail="即梦提交未返回 submit_id 或生成结果",
                )
            return {"videos": urls, "task_id": None, "raw": raw}
        urls = await jimeng_store_outputs(raw, "video")
        return {"videos": urls, "task_id": jimeng_submit_id(raw) or None, "raw": raw}
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

def codex_models_payload(raw=None):
    all_models = [*_ports.CODEX_DEFAULT_IMAGE_MODELS, *_ports.CODEX_DEFAULT_CHAT_MODELS]
    return {
        "ok": True,
        "protocol": "codex",
        "status": 200,
        "message": "OpenAI Codex CLI 可用，模型列表来自本机 CLI 默认配置。",
        "model_count": len(all_models),
        "total": len(all_models),
        "image_models": _ports.CODEX_DEFAULT_IMAGE_MODELS,
        "chat_models": _ports.CODEX_DEFAULT_CHAT_MODELS,
        "video_models": [],
        "all": all_models,
        "raw": raw or {},
    }

def codex_timeout(default=CODEX_DEFAULT_TIMEOUT):
    try:
        return max(30, min(3600, int(os.getenv("CODEX_CLI_TIMEOUT", str(default)) or default)))
    except Exception:
        return default

def gemini_cli_models_payload(raw=None):
    all_models = [*_ports.GEMINI_CLI_DEFAULT_IMAGE_MODELS, *_ports.GEMINI_CLI_DEFAULT_CHAT_MODELS]
    all_models = _ports.model_list_from_values(all_models)
    return {
        "ok": True,
        "protocol": "gemini-cli",
        "status": 200,
        "message": "Antigravity CLI 可用，模型列表使用 auto 默认模型。",
        "model_count": len(all_models),
        "total": len(all_models),
        "image_models": _ports.GEMINI_CLI_DEFAULT_IMAGE_MODELS,
        "chat_models": _ports.GEMINI_CLI_DEFAULT_CHAT_MODELS,
        "video_models": [],
        "all": all_models,
        "raw": raw or {},
    }

def jimeng_model_versions_from_help(text):
    """Extract the public model_version values from Dreamina help text."""
    help_text = str(text or "")
    matches = []
    patterns = (
        r"(?mi)^\s*-\s*model_version(?:\s+values)?\s*:\s*([^\r\n]+)",
        r"(?mi)^\s*--model_version\s+\S+\s+supported values\s*:\s*([^;\r\n]+)",
    )
    for pattern in patterns:
        matches.extend(re.findall(pattern, help_text))
    models = []
    for match in matches:
        for item in str(match).split(","):
            value = item.strip().strip("`'\". ")
            if (
                re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", value)
                and value not in models
            ):
                models.append(value)
    return models

async def jimeng_models_payload():
    """Read the installed Dreamina CLI help and return its live model catalog."""
    results = await asyncio.gather(
        *(
            run_jimeng_cli([command, "-h"], timeout=30, raw_text=True)
            for command, _kind in JIMENG_MODEL_HELP_COMMANDS
        ),
        return_exceptions=True,
    )
    discovered = {"image": [], "video": []}
    commands = {}
    errors = {}
    for (command, kind), result in zip(JIMENG_MODEL_HELP_COMMANDS, results):
        if isinstance(result, BaseException):
            detail = getattr(result, "detail", None) or str(result)
            errors[command] = str(detail)[:300]
            continue
        text = "\n".join(
            part
            for part in (
                str((result or {}).get("_stdout") or "").strip(),
                str((result or {}).get("_stderr") or "").strip(),
            )
            if part
        )
        models = jimeng_model_versions_from_help(text)
        commands[command] = {"kind": kind, "models": models}
        if not models:
            errors[command] = "CLI 帮助未提供可解析的 model_version 列表"
            continue
        discovered[kind].extend(models)

    live_images = _ports.model_list_from_values(discovered["image"])
    live_videos = _ports.model_list_from_values(discovered["video"])
    image_models = live_images or list(_ports.JIMENG_DEFAULT_IMAGE_MODELS)
    video_models = live_videos or list(_ports.JIMENG_DEFAULT_VIDEO_MODELS)
    all_models = _ports.model_list_from_values([*image_models, *video_models])
    live_categories = int(bool(live_images)) + int(bool(live_videos))
    source = (
        "cli-help"
        if live_categories == 2
        else "cli-help-partial"
        if live_categories == 1
        else "fallback"
    )
    if source == "cli-help":
        message = "模型列表已从本机 Dreamina CLI 帮助实时读取。"
    elif source == "cli-help-partial":
        message = "部分模型已从本机 Dreamina CLI 读取；未识别的类别使用内置清单。"
    else:
        message = "未能解析本机 Dreamina CLI 模型，已使用内置兼容清单。"
    return {
        "ok": True,
        "protocol": "jimeng",
        "status": 200,
        "message": message,
        "source": source,
        "model_count": len(all_models),
        "total": len(all_models),
        "image_models": image_models,
        "chat_models": [],
        "video_models": video_models,
        "all": all_models,
        "capabilities": {"commands": commands},
        "raw": {"errors": errors},
    }

def gemini_cli_image_size_instruction(size="", model=""):
    size_text = str(size or "").strip()
    model_text = str(model or "").strip()
    match = re.match(r"^\s*(\d{2,5})\s*[xX*]\s*(\d{2,5})\s*$", size_text)
    if match:
        width, height = int(match.group(1)), int(match.group(2))
        if width > 0 and height > 0:
            orientation = "正方形" if width == height else ("横版" if width > height else "竖版")
            return (
                f"目标输出分辨率：{width}x{height} 像素（宽 x 高），画面方向：{orientation}。"
                f"最终保存到输出目录的图片文件实际像素必须是 {width}x{height}。"
                "如果生成器先得到较小图片，请在保存前放大或导出到目标尺寸，不要返回 1024px 小图。"
            )
    combined = f"{size_text} {model_text}".lower()
    if "4k" in combined:
        return "目标输出为 4K 高分辨率图片；最终保存文件需要达到当前画幅对应的 4K 像素尺寸，不要默认输出 1024px 小图。"
    if "2k" in combined:
        return "目标输出为 2K 高分辨率图片；最终保存文件需要达到当前画幅对应的 2K 像素尺寸，不要默认输出 1024px 小图。"
    return f"尺寸/比例参考：{size_text or 'auto'}。如果可以指定分辨率，请优先输出高分辨率图片。"

def jimeng_submit_id(raw):
    found = []
    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() in {"submit_id", "submitid", "task_id", "taskid"} and item:
                    found.append(str(item))
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else ""

def codex_output_url_from_path(path):
    path = os.path.abspath(str(path or ""))
    root = os.path.abspath(_ports.generation_output_directory())
    try:
        if os.path.commonpath([root, path]) == root:
            return _ports.output_url_for(os.path.basename(path), "output")
    except Exception:
        return ""
    return ""

async def gemini_cli_reference_paths(reference_images=None):
    source_paths, source_temp_paths = await codex_reference_paths(
        reference_images
    )
    if not source_paths:
        return [], source_temp_paths
    staging_directory = tempfile.mkdtemp(prefix="gemini_cli_refs_")
    staged_paths = []
    try:
        for index, source_path in enumerate(source_paths, start=1):
            suffix = os.path.splitext(source_path)[1].lower()
            if suffix not in {
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".gif",
                ".bmp",
                ".tif",
                ".tiff",
            }:
                suffix = ".png"
            staged_path = os.path.join(
                staging_directory,
                f"reference_{index:02d}{suffix}",
            )
            await asyncio.to_thread(shutil.copy2, source_path, staged_path)
            staged_paths.append(staged_path)
        return staged_paths, [
            *source_temp_paths,
            *staged_paths,
            staging_directory,
        ]
    except Exception:
        cleanup_cli_temp_paths(
            [*source_temp_paths, *staged_paths, staging_directory]
        )
        raise


def cleanup_cli_temp_paths(paths=None):
    for path in reversed([str(item) for item in paths or [] if item]):
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
        except OSError:
            pass

def gpt_image_2_skill_access_token(auth_data):
    if not isinstance(auth_data, dict):
        return ""
    for key in ("access_token", "accessToken"):
        value = str(auth_data.get(key) or "").strip()
        if value:
            return value
    tokens = auth_data.get("tokens")
    if isinstance(tokens, dict):
        for key in ("access_token", "accessToken"):
            value = str(tokens.get(key) or "").strip()
            if value:
                return value
    return ""

def gpt_image_2_skill_failure_message(stdout_text="", stderr_text="", returncode=0):
    combined = "\n".join([str(stdout_text or "").strip(), str(stderr_text or "").strip()]).strip()
    if not combined:
        return f"exit={returncode}"
    objects = []
    plain_lines = []
    for line in combined.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            objects.append(json.loads(line))
        except Exception:
            plain_lines.append(line)
    if not objects:
        try:
            parsed = json.loads(combined)
            objects = parsed if isinstance(parsed, list) else [parsed]
            plain_lines = []
        except Exception:
            pass
    messages = []
    progress = []
    for item in objects:
        if not isinstance(item, dict):
            continue
        error = item.get("error")
        if isinstance(error, dict):
            msg = error.get("message") or error.get("detail") or error.get("code")
            if msg:
                messages.append(str(msg))
            detail = error.get("detail")
            if detail not in (None, "", msg):
                if isinstance(detail, str):
                    try:
                        detail = json.loads(detail)
                    except Exception:
                        pass
                detail_text = (
                    json.dumps(detail, ensure_ascii=False, separators=(",", ":"))
                    if isinstance(detail, (dict, list))
                    else str(detail)
                ).strip()
                if detail_text:
                    messages.append(detail_text)
        elif isinstance(error, str) and error.strip():
            messages.append(error.strip())
        if item.get("ok") is False:
            msg = item.get("message") or item.get("detail")
            if msg:
                messages.append(str(msg))
        data = item.get("data")
        if isinstance(data, dict):
            msg = data.get("error") or data.get("message") or data.get("status")
            event_type = str(item.get("type") or data.get("phase") or "").strip()
            if msg and event_type not in {"request.started", "request_started"}:
                progress.append(f"{event_type}: {msg}" if event_type else str(msg))
    if messages:
        return "；".join(dict.fromkeys(messages))[:1600]
    if plain_lines:
        return "\n".join(plain_lines)[:1600]
    if progress:
        return ("只收到了进度事件，没有收到最终错误详情：" + "；".join(dict.fromkeys(progress)))[:1600]
    return combined[:1600]

def gpt_image_2_skill_transparent_source_prompt(prompt="", matte="#00ff00"):
    return (
        f"{str(prompt or '').strip()}\n\n"
        "Extraction setup: render exactly one isolated asset, centered with a clear margin, "
        f"on a perfectly flat uniform matte background of pure {matte}. "
        "Do not use gradients, texture, vignette, shadows, reflections, contact shadows, "
        "scenery, props, labels, frames, or background-colored details. "
        "Keep the full subject visible and separated from the matte."
    ).strip()

def jimeng_cli_path_arg(path):
    return windows_path_to_wsl(path) if jimeng_use_wsl() else path

def codex_postprocess_image_to_requested_size(path="", requested_size="", provider=""):
    provider_text = str(provider or "").strip().lower()
    if provider_text not in {"codex", "gemini-cli"}:
        return ""
    width, height = parse_size_pair(requested_size)
    if not width or not height or not path or not os.path.isfile(path):
        return ""
    try:
        with Image.open(path) as img:
            img.load()
            if img.width == width and img.height == height:
                return ""
            resample = getattr(Image, "Resampling", Image).LANCZOS
            oriented = ImageOps.exif_transpose(img)
            converted = oriented.convert("RGBA") if oriented.mode in ("RGBA", "LA", "P") else oriented.convert("RGB")
            resized = ImageOps.fit(converted, (width, height), method=resample, centering=(0.5, 0.5))
            base, _ext = os.path.splitext(path)
            upscaled_path = f"{base}_upscaled_{width}x{height}.png"
            resized.save(upscaled_path, format="PNG")
            return upscaled_path
    except Exception as exc:
        label = "Gemini CLI" if provider_text == "gemini-cli" else "Codex GPT Image 2"
        print(f"{label} 图片尺寸后处理失败：{exc}")
        return ""

def jimeng_decode_cli_output(stdout, stderr):
    out_text = (decode_wsl_output(stdout) if jimeng_use_wsl() else stdout.decode("utf-8", errors="replace")).strip()
    err_text = (decode_wsl_output(stderr) if jimeng_use_wsl() else stderr.decode("utf-8", errors="replace")).strip()
    clean_err_text = jimeng_clean_wsl_stderr(err_text) if jimeng_use_wsl() else err_text
    return out_text, clean_err_text

def gpt_image_2_skill_prompt_arg(prompt="", size="", provider="openai"):
    prompt_text = str(prompt or "").strip()
    if str(provider or "").strip().lower() != "codex":
        return prompt_text
    size_arg = gpt_image_2_skill_size_arg(size, "", prompt, provider)
    size_text = str(size or "").strip()
    width, height = parse_size_pair(size_text)
    ratio_text = ""
    if width and height:
        divisor = math.gcd(width, height) or 1
        ratio_text = f"{width // divisor}:{height // divisor}"
    else:
        ratio_match = re.fullmatch(r"\s*(\d{1,2})\s*:\s*(\d{1,2})\s*", size_text)
        if ratio_match:
            width = int(ratio_match.group(1))
            height = int(ratio_match.group(2))
            ratio_text = f"{width}:{height}"
    if not ratio_text:
        return f"{prompt_text} 画质要求：目标输出 {size_arg} 高分辨率图片。 Image quality requirement: output a {size_arg} high-resolution image."
    orientation_zh = "横版/宽幅" if width > height else ("竖版/长幅" if height > width else "正方形")
    orientation_en = "landscape/wide" if width > height else ("portrait/tall" if height > width else "square")
    return (
        f"{prompt_text} "
        f"画质要求：目标输出 {size_arg} 高分辨率图片。"
        f"画幅要求：必须生成 {orientation_zh} 图片，宽高比 {ratio_text}。"
        f"请不要交换宽高，不要输出反向比例。"
        f" Image quality requirement: output a {size_arg} high-resolution image."
        f" Canvas requirement: generate a {orientation_en} image with aspect ratio {ratio_text}; "
        "do not swap width and height."
    )

def jimeng_collect_media_values(value, outputs):
    media_ext = re.compile(r"\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)", re.I)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return
        if text.startswith(("http://", "https://", "/assets/", "file://")) or media_ext.search(text):
            outputs.append(text)
        return
    if isinstance(value, list):
        for item in value:
            jimeng_collect_media_values(item, outputs)
        return
    if isinstance(value, dict):
        for key in (
            "url", "urls", "image", "images", "image_url", "image_urls",
            "video", "videos", "video_url", "video_urls", "output", "outputs",
            "result", "results", "file", "files", "path", "paths",
            "download_url", "download_urls", "downloadUrl", "file_path", "filePath",
        ):
            if key in value:
                jimeng_collect_media_values(value.get(key), outputs)
        for item in value.values():
            if isinstance(item, (dict, list)):
                jimeng_collect_media_values(item, outputs)

def antigravity_cli_winget_candidates():
    patterns = [
        os.path.join(os.path.expanduser("~"), "AppData", "Local", "Microsoft", "WinGet", "Packages", "Google.AntigravityCLI_*", "agy.exe"),
        os.path.join(os.getenv("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages", "Google.AntigravityCLI_*", "agy.exe"),
    ]
    candidates = []
    for pattern in patterns:
        if not pattern:
            continue
        candidates.extend(glob.glob(pattern))
    return sorted(dict.fromkeys(path for path in candidates if os.path.exists(path)), reverse=True)

def gemini_cli_output_image_files(directory):
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    directory_text = str(directory or "").strip()
    if not directory_text:
        return []
    root = os.path.abspath(directory_text)
    if not os.path.isdir(root):
        return []
    files = []
    try:
        for entry in os.scandir(root):
            if not entry.is_file(follow_symlinks=False):
                continue
            path = os.path.abspath(entry.path)
            try:
                if os.path.commonpath([root, path]) != root:
                    continue
            except ValueError:
                continue
            ext = os.path.splitext(entry.name)[1].lower()
            if ext not in exts:
                continue
            mtime = os.path.getmtime(path)
            files.append((mtime, path))
    except Exception:
        return []
    return [path for _mtime, path in sorted(files, reverse=True)]


def antigravity_cli_brain_directory():
    return os.path.join(
        os.path.expanduser("~"),
        ".gemini",
        "antigravity-cli",
        "brain",
    )


def antigravity_cli_conversation_image_files(conversation_id, image_name):
    conversation_text = str(conversation_id or "").strip().lower()
    image_name_text = str(image_name or "").strip()
    if not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        conversation_text,
    ):
        return []
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", image_name_text):
        return []
    root = os.path.realpath(os.path.abspath(antigravity_cli_brain_directory()))
    conversation_directory = os.path.realpath(
        os.path.join(root, conversation_text)
    )
    try:
        if os.path.commonpath([root, conversation_directory]) != root:
            return []
    except ValueError:
        return []
    matches = []
    for path in gemini_cli_output_image_files(conversation_directory):
        stem = os.path.splitext(os.path.basename(path))[0]
        if stem == image_name_text or stem.startswith(f"{image_name_text}_"):
            matches.append(path)
    return matches


def gemini_cli_diagnostic_text(raw):
    if not isinstance(raw, dict):
        return str(raw or "").strip()
    values = []
    for key in ("text", "_stdout", "_stderr"):
        value = str(raw.get(key) or "").strip()
        if value:
            values.append(value)
    payload = raw.get("raw")
    if isinstance(payload, dict):
        for key in ("result", "response", "text", "error", "status"):
            value = str(payload.get(key) or "").strip()
            if value and value not in values:
                values.append(value)
    return "\n".join(values).strip()


def gemini_cli_quota_failure_message(raw):
    text = gemini_cli_diagnostic_text(raw)
    if re.search(
        r"RESOURCE_EXHAUSTED|QUOTA_EXHAUSTED|"
        r"(?:image\s+generation\s+)?quota\s+(?:is\s+)?(?:exhausted|exceeded)|"
        r"insufficient\s+quota",
        text,
        re.I,
    ):
        return text[:1600]
    return ""


def gemini_cli_image_failure_message(raw):
    if not isinstance(raw, dict):
        return ""
    text = gemini_cli_diagnostic_text(raw)
    if re.search(
        r"无法(?:真正)?(?:生成|创建)图片文件|"
        r"(?:unable|cannot|can't)\s+to\s+(?:generate|create)\s+(?:an?\s+)?image\s+file|"
        r"no\s+image\s+(?:file\s+)?(?:was\s+)?generated",
        text,
        re.I,
    ):
        return text[:1200]
    payload = raw.get("raw")
    if isinstance(payload, dict) and str(payload.get("status") or "").upper() in {
        "ERROR",
        "FAILED",
        "FAILURE",
    }:
        return text[:1200]
    return ""


def gemini_cli_valid_image_file(path):
    try:
        with Image.open(path) as image:
            image.verify()
            return image.width > 0 and image.height > 0
    except Exception:
        return False


def gemini_cli_publish_output(path):
    source = os.path.abspath(str(path or ""))
    if not gemini_cli_valid_image_file(source):
        return ""
    extension = os.path.splitext(source)[1].lower()
    if extension not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        extension = ".png"
    filename = f"gemini_cli_{uuid.uuid4().hex}{extension}"
    destination = os.path.abspath(
        _ports.output_path_for(filename, "output")
    )
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.move(source, destination)
    return _ports.output_url_for(filename, "output")

def gemini_cli_executable():
    for key in ("ANTIGRAVITY_BIN", "AGY_BIN", "GEMINI_BIN"):
        configured = str(gemini_cli_env_value(key) or "").strip().strip('"')
        if configured:
            return configured
    for name in ("agy", "agy.exe"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in antigravity_cli_winget_candidates():
        return candidate
    return shutil.which("gemini") or shutil.which("gemini.exe") or shutil.which("gemini.cmd") or ""

async def jimeng_prepare_local_media(ref_url, kind="image"):
    text = str(ref_url or "").strip()
    if not text:
        return "", []
    if text.startswith("/assets/"):
        path = _ports.output_file_from_url(text)
        if path:
            return path, []
        raise HTTPException(status_code=404, detail=f"即梦参考素材不存在：{text}")
    if text.startswith("file://"):
        path = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        if os.path.isfile(path):
            return path, []
    if os.path.isfile(text):
        return text, []
    suffix = ".mp4" if kind == "video" else (".mp3" if kind == "audio" else ".png")
    temp_paths = []
    if text.startswith("data:"):
        if ";base64," not in text:
            raise HTTPException(
                status_code=400,
                detail="即梦参考图片内容不完整，请重新选择",
            )
        header, encoded = text.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else ""
        suffix = mimetypes.guess_extension(mime) or suffix
        fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(encoded))
        temp_paths.append(path)
        return path, temp_paths
    if text.startswith(("http://", "https://")):
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0), follow_redirects=True) as client:
            response = await client.get(text)
            response.raise_for_status()
            clean_path = urllib.parse.urlparse(text).path
            suffix = os.path.splitext(clean_path)[1] or mimetypes.guess_extension(response.headers.get("content-type", "")) or suffix
            fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(response.content)
            temp_paths.append(path)
            return path, temp_paths
    raise HTTPException(status_code=400, detail=f"即梦 CLI 只支持本地文件参考素材，无法读取：{text[:120]}")

def codex_env_value(key):
    return os.getenv(key, "") or _ports.read_api_env_value(key)

def jimeng_append_model_resolution_args(args, payload: CanvasVideoRequest, include_model=False):
    model_version = jimeng_video_model_version(payload.model)
    if include_model and model_version:
        args.append(f"--model_version={model_version}")
    args.append(
        f"--video_resolution={jimeng_video_resolution_arg(payload.model, payload.resolution)}"
    )

async def generate_codex_provider_image(
    prompt,
    size,
    model,
    reference_images=None,
    provider=None,
    transparent_png=False,
):
    ref_paths, temp_paths = await codex_reference_paths(reference_images)
    try:
        skill_result = await generate_codex_provider_image_via_gpt_image_2_skill(
            prompt,
            size,
            model,
            ref_paths,
            transparent_png=transparent_png,
        )
        if skill_result:
            return skill_result
        raise HTTPException(status_code=400, detail="未找到 GPT Image 2 helper，OpenAI CLI 生图已禁用 $imagegen 回退。请先安装 gpt-image-2-skill 后再生成图片。")
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

def jimeng_use_wsl(
    *,
    env_reader=None,
    native_executable=None,
    wsl_available=None,
):
    env_reader = env_reader or jimeng_env_value
    native_executable = native_executable or jimeng_native_cli_executable
    wsl_available = wsl_available or jimeng_wsl_dreamina_available
    value = str(env_reader("JIMENG_USE_WSL") or "").strip().lower()
    if value:
        return value in {"1", "true", "yes", "on", "wsl"}
    if os.name != "nt" or native_executable():
        return False
    return wsl_available()

def jimeng_video_ref_role(ref):
    role = getattr(ref, "role", "")
    if isinstance(ref, dict):
        role = ref.get("role", role)
    return str(role or "").lower()

def gemini_cli_text_from_raw(raw, fallback_text=""):
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        for key in ("response", "text", "content", "message", "output"):
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        candidates = []
        for value in raw.values():
            if isinstance(value, str) and value.strip():
                candidates.append(value.strip())
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        text = gemini_cli_text_from_raw(item)
                        if text:
                            candidates.append(text)
                    elif isinstance(item, str) and item.strip():
                        candidates.append(item.strip())
        if candidates:
            return "\n".join(candidates).strip()
    if isinstance(raw, list):
        parts = [gemini_cli_text_from_raw(item) for item in raw]
        return "\n".join(part for part in parts if part).strip()
    return str(fallback_text or "").strip()

def codex_model_for_exec(model="", fallback=""):
    value = str(model or fallback or "").strip()
    low = value.lower()
    if not value or low.startswith("$imagegen") or low.startswith("gpt-image"):
        return ""
    return value

def codex_decode_output(stdout, stderr):
    out_text = (stdout or b"").decode("utf-8", errors="replace").strip()
    err_text = (stderr or b"").decode("utf-8", errors="replace").strip()
    return out_text, err_text

def jimeng_video_duration_range(model):
    version = jimeng_video_model_version(model)
    if version == "seedance2.5":
        return 4, 30
    if version == "seedance1.0fast":
        return 5, 10
    if version == "seedance1.5pro":
        return 5, 12
    if version in ("3.0", "3.0fast", "3.0pro"):
        return 3, 10
    if version == "3.5pro":
        return 4, 12
    return 4, 15

def jimeng_image_resolution(model, size, mode="text2image"):
    text = str(model or "").lower()
    version = jimeng_normalize_image_model(model)
    if "4k" in text:
        desired = "4k"
    elif "1k" in text:
        desired = "1k"
    elif "2k" in text:
        desired = "2k"
    else:
        width, height = parse_size_pair(size)
        max_edge = max(width, height)
        if version == "5.0Pro":
            if max_edge >= 3000:
                desired = "4k"
            elif max_edge >= 1800:
                desired = "2k"
            else:
                # The current Dreamina image API rejects 1k for 5.0Pro even
                # though older CLI help still advertises it.  Its live
                # minimum is 1.5k.
                desired = "1.5k"
        else:
            desired = "4k" if max_edge > 2048 else "2k"
    # 按官方规则收敛到模型允许的分辨率
    if version == "5.0Pro":
        # 5.0 Pro 的线上文生图和图生图均以 1.5k 为最低档。
        if desired == "1k":
            return "1.5k"
        return desired
    if mode == "image2image":
        # 其他 image2image 模型只支持 2k/4k。
        return "4k" if desired == "4k" else "2k"
    if version in ("3.0", "3.1"):
        # 3.0/3.1 只支持 1k/2k
        return "1k" if desired == "1k" else "2k"
    # 4.x/5.0 只支持 2k/4k
    return "4k" if desired == "4k" else "2k"

async def jimeng_cli_version():
    for flag in ("--version", "-V", "version"):
        try:
            raw = await run_jimeng_cli([flag], timeout=15)
        except HTTPException:
            continue
        text = raw if isinstance(raw, str) else (raw.get("_stdout") or raw.get("_stderr") or "" if isinstance(raw, dict) else "")
        version = jimeng_parse_version(text)
        if version:
            return version, str(text).strip()
    return None, ""

def jimeng_clean_wsl_stderr(text):
    lines = []
    skip_next_warning_context = False
    for line in str(text or "").splitlines():
        clean = line.replace("\x00", "").strip()
        low = clean.lower()
        is_proxy_warning = "localhost" in low and "wsl" in low and ("nat" in low or "proxy" in low or "代理" in clean)
        is_python_warning = "requestsdependencywarning" in low or (skip_next_warning_context and clean.startswith("warnings.warn("))
        skip_next_warning_context = "requestsdependencywarning" in low
        if clean and not is_proxy_warning and not is_python_warning:
            lines.append(clean)
    return "\n".join(lines).strip()

def jimeng_video_model_version(model):
    value = str(model or "").strip()
    low = value.lower()
    aliases = {
        "seedance2.5": "seedance2.5",
        "seedance2.0mini": "seedance2.0mini",
        "seedance2.0fast_vip": "seedance2.0fast_vip",
        "seedance2.0_vip": "seedance2.0_vip",
        "seedance2.0fast": "seedance2.0fast",
        "seedance2.0": "seedance2.0",
        "seedance1.5pro": "seedance1.5pro",
        "seedance1.0fast": "seedance1.0fast",
        "3.0_fast": "3.0fast",
        "3.0fast": "3.0fast",
        "3.0_pro": "3.0pro",
        "3.0pro": "3.0pro",
        "3.5_pro": "3.5pro",
        "3.5pro": "3.5pro",
        "3.0": "3.0",
    }
    if low in aliases:
        return aliases[low]
    if re.fullmatch(r"seedance[a-z0-9._-]{1,70}", low):
        return low
    for key, mapped in aliases.items():
        if key in low:
            return mapped
    return ""

def jimeng_model_supports_multimodal(model):
    version = jimeng_video_model_version(model)
    return (
        not version
        or version == "seedance2.5"
        or version.startswith("seedance2.0")
    )

def jimeng_parse_version(text):
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", str(text or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())

def jimeng_local_output_url(path, kind="image"):
    path = os.path.abspath(str(path or ""))
    if not os.path.isfile(path):
        return ""
    output_root = os.path.abspath(_ports.generation_output_directory())
    try:
        if os.path.commonpath([output_root, path]) == output_root:
            return _ports.output_url_for(os.path.basename(path), "output")
    except Exception:
        pass
    ext = os.path.splitext(path)[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
    if ext not in allowed:
        ct = _ports.content_type_for_path(path)
        ext = ".mp4" if ct.startswith("video/") else ".png"
    prefix = "jimeng_video_" if kind == "video" else "jimeng_"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    dest = _ports.output_path_for(filename, "output")
    shutil.copyfile(path, dest)
    return _ports.output_url_for(filename, "output")

def jimeng_wsl_base_args(exe="wsl.exe"):
    configured = str(jimeng_env_value("JIMENG_WSL_DISTRO") or "").strip()
    names = []
    try:
        proc = subprocess.run(
            [exe, "-l", "-q"],
            cwd=_ports.BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        names = [
            line.replace("\x00", "").strip().lstrip("*").strip()
            for line in decode_wsl_output(proc.stdout).splitlines()
            if line.replace("\x00", "").strip()
        ]
    except Exception:
        names = []
    if configured and (not names or configured in names):
        return ["-d", configured]
    if configured and names:
        print(f"JIMENG_WSL_DISTRO={configured} 不存在，已回退自动选择。可用发行版：{names}")
    try:
        ubuntu = next((name for name in names if re.match(r"^Ubuntu($|-)", name)), "")
        if ubuntu:
            return ["-d", ubuntu]
    except Exception:
        pass
    return []

def gemini_cli_chat_prompt(payload, history_messages=None):
    parts = []
    system_prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    if system_prompt:
        parts.append(f"系统要求：\n{system_prompt}")
    for item in (history_messages or [])[-_ports.MAX_HISTORY_MESSAGES:]:
        role = str(item.get("role") or "").strip()
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            label = "用户" if role == "user" else "助手"
            parts.append(f"{label}：\n{content}")
    message = str(getattr(payload, "message", "") or "").strip()
    parts.append(f"用户：\n{message}")
    image_values = []
    if hasattr(payload, "images"):
        image_values.extend([{"url": item} for item in (getattr(payload, "images", None) or []) if item])
    if hasattr(payload, "reference_images"):
        image_values.extend([ref.dict() for ref in (getattr(payload, "reference_images", None) or []) if getattr(ref, "url", "")])
    refs = []
    temp_paths = []
    return "\n\n".join(part for part in parts if part).strip(), image_values

async def generate_codex_provider_image_via_gpt_image_2_skill(
    prompt,
    size,
    model,
    ref_paths=None,
    *,
    transparent_png=False,
):
    exe = gpt_image_2_skill_executable()
    if not exe:
        return None
    ref_paths = [str(path) for path in (ref_paths or []) if path and os.path.isfile(str(path))]
    auth_file = gpt_image_2_skill_auth_file()
    auth_data = gpt_image_2_skill_auth_json(auth_file)
    provider_args, tool_provider = gpt_image_2_skill_provider_args(auth_file)
    attempts = [(provider_args, tool_provider)]
    fallback_api_key = gpt_image_2_skill_api_key(auth_data)
    if tool_provider == "codex" and fallback_api_key:
        attempts.append((["--provider", "openai", "--api-key", fallback_api_key], "openai"))
    last_message = ""
    for attempt_index, (attempt_provider_args, attempt_provider) in enumerate(attempts):
        out_path = os.path.join(
            _ports.generation_output_directory(),
            f"gpt_image_2_{uuid.uuid4().hex}.png",
        )
        source_path = ""
        mode = "edit" if ref_paths else "generate"
        use_transparent_pipeline = (
            transparent_png
            and attempt_provider == "codex"
        )
        shared_args = [
            exe,
            "--json",
            *attempt_provider_args,
        ]
        if use_transparent_pipeline:
            source_path = os.path.join(
                _ports.generation_output_directory(),
                f"gpt_image_2_source_{uuid.uuid4().hex}.png",
            )
            commands = [
                ("生成纯色底图", [
                    *shared_args,
                    "images", mode,
                    "--prompt", gpt_image_2_skill_transparent_source_prompt(prompt),
                    "--out", source_path,
                    "--model", gpt_image_2_skill_model_arg(model, attempt_provider),
                    "--size", gpt_image_2_skill_size_arg(size, model, prompt, attempt_provider),
                    "--quality", "high",
                    "--format", "png",
                    *[
                        value
                        for path in ref_paths
                        for value in ("--ref-image", path)
                    ],
                ]),
                ("提取透明通道", [
                    *shared_args,
                    "transparent", "extract",
                    "--input", source_path,
                    "--out", out_path,
                    "--method", "chroma",
                    "--matte-color", "auto",
                    "--profile", "generic",
                    "--strict",
                ]),
            ]
        else:
            args = [
                *shared_args,
                "images", mode,
                "--prompt", gpt_image_2_skill_prompt_arg(prompt, size, attempt_provider),
                "--out", out_path,
                "--model", gpt_image_2_skill_model_arg(model, attempt_provider),
                "--size", gpt_image_2_skill_size_arg(size, model, prompt, attempt_provider),
                "--quality", "high",
                "--format", "png",
            ]
            if transparent_png:
                args.extend(["--background", "transparent"])
            for path in ref_paths:
                args.extend(["--ref-image", path])
            if ref_paths and attempt_provider == "openai":
                args.extend(["--input-fidelity", "high"])
            commands = [("生成图片", args)]
        out_text = ""
        err_text = ""
        retry_with_next_provider = False
        try:
            for stage, args in commands:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    cwd=_ports.BASE_DIR,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=codex_timeout()
                )
                out_text, err_text = codex_decode_output(stdout, stderr)
                if proc.returncode == 0:
                    continue
                message = gpt_image_2_skill_failure_message(
                    out_text, err_text, proc.returncode
                )
                last_message = f"{attempt_provider}/{stage}: {message}"
                auth_failed = bool(re.search(
                    r"\b401\b|unauthori[sz]ed|access[_ -]?token|api[_ -]?key",
                    message,
                    re.I,
                ))
                if (
                    attempt_provider == "codex"
                    and attempt_index + 1 < len(attempts)
                    and auth_failed
                ):
                    retry_with_next_provider = True
                    break
                if auth_failed:
                    return None
                raise HTTPException(
                    status_code=502,
                    detail=f"GPT Image 2 Skill 调用失败：{last_message[:1200]}",
                )
        except asyncio.TimeoutError as exc:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise HTTPException(status_code=504, detail="GPT Image 2 Skill 执行超时。可设置 CODEX_CLI_TIMEOUT 增大等待时间。") from exc
        except FileNotFoundError:
            return None
        finally:
            if source_path:
                cleanup_cli_temp_paths([source_path])
        if retry_with_next_provider:
            continue
        parsed, reported_paths = parse_gpt_image_2_skill_output(out_text, err_text)
        candidate_paths = []
        if os.path.isfile(out_path):
            candidate_paths.append(out_path)
        candidate_paths.extend([path for path in reported_paths if path and os.path.isfile(path)])
        urls = []
        for path in candidate_paths:
            processed_path = codex_postprocess_image_to_requested_size(path, size, attempt_provider)
            url = codex_output_url_from_path(processed_path or path)
            if url:
                urls.append(url)
        if not urls:
            status_text = (out_text or err_text or "")[:1200]
            raise HTTPException(status_code=502, detail=f"GPT Image 2 Skill 已返回，但没有在输出目录发现图片：{status_text}")
        return {"type": "url", "value": urls[0]}, {
            "images": urls,
            "text": out_text,
            "provider": "codex",
            "tool": "gpt-image-2-skill",
            "tool_provider": attempt_provider,
            "raw": parsed or {"stdout": out_text, "stderr": err_text},
        }
    raise HTTPException(status_code=502, detail=f"GPT Image 2 Skill 调用失败：{last_message[:1200]}")

def jimeng_video_resolution(model, resolution):
    version = jimeng_video_model_version(model)
    requested = str(resolution or "").strip().upper()
    if requested not in {"480P", "720P", "1080P", "4K"}:
        text = str(model or "").lower()
        requested = "4K" if "4k" in text else "1080P" if "1080" in text else "720P"
    if version == "seedance2.5":
        return requested if requested in {"480P", "720P", "1080P"} else "720P"
    if version in _ports.JIMENG_VIDEO_1080P_MODELS:
        return requested if requested in {"720P", "1080P", "4K"} else "720P"
    return "720P"

def jimeng_multiframe_video_resolution(resolution):
    requested = str(resolution or "").strip().lower()
    return "1080p" if requested in {"1080", "1080p"} else "720p"

async def codex_reference_paths(reference_images=None):
    paths = []
    temp_paths = []
    try:
        for ref in (reference_images or [])[:_ports.ONLINE_IMAGE_REFERENCE_MAX]:
            url = ref.get("url") if isinstance(ref, dict) else getattr(ref, "url", "")
            if not url:
                continue
            path, created = await codex_prepare_local_media(url)
            if path:
                paths.append(path)
            temp_paths.extend(created)
        return paths, temp_paths
    except Exception:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass
        raise

def jimeng_video_resolution_arg(model, resolution):
    return jimeng_video_resolution(model, resolution).lower()

async def generate_jimeng_provider_image(
    prompt,
    size,
    model,
    reference_images=None,
    provider=None,
    on_remote=None,
):
    validation_error = jimeng_image_prompt_validation_error(
        prompt, model, reference_images
    )
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    if len(refs) > 10:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "input_maximum",
                "field": "image",
                "maximum": 10,
                "actual": len(refs),
            },
        )
    poll_seconds = (
        0 if on_remote is not None else jimeng_poll_seconds()
    )
    temp_paths = []
    try:
        args = []
        if refs:
            image_paths = []
            for ref in refs:
                image_path, created = await jimeng_prepare_local_media(ref.get("url"), "image")
                image_paths.append(jimeng_cli_path_arg(image_path))
                temp_paths.extend(created)
            model_version = jimeng_image_model_version(model, "image2image")
            args = [
                "image2image",
                f"--images={','.join(image_paths)}",
                f"--prompt={prompt}",
                f"--ratio={jimeng_ratio_from_size(size)}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'image2image')}",
                f"--poll={poll_seconds}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        else:
            model_version = jimeng_image_model_version(model, "text2image")
            args = [
                "text2image",
                f"--prompt={prompt}",
                f"--ratio={jimeng_ratio_from_size(size)}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'text2image')}",
                f"--poll={poll_seconds}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        raw = await run_jimeng_cli(args, timeout=jimeng_poll_seconds() + 120)
        failure = jimeng_failure_reason(raw)
        if failure:
            raise HTTPException(
                status_code=502,
                detail=f"即梦提交失败：{failure}",
            )
        submit_id = jimeng_submit_id(raw)
        if on_remote is not None and submit_id:
            on_remote(
                Pending(str(submit_id), raw=raw, status="running")
            )
            completed = await wait_for_jimeng_submission(
                str(submit_id), "image", raw
            )
            urls = list(completed.get("urls") or [])
            return (
                {"type": "url", "value": urls[0]},
                completed.get("raw") or completed,
            )
        if on_remote is not None:
            urls = jimeng_output_values(raw)
            if not urls:
                raise HTTPException(
                    status_code=502,
                    detail="即梦提交未返回 submit_id 或生成结果",
                )
            return {"type": "url", "value": urls[0]}, raw
        urls = await jimeng_store_outputs(raw, "image")
        return {"type": "url", "value": urls[0]}, raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

def windows_path_to_wsl(path):
    text = str(path or "").replace("\\", "/")
    match = re.match(r"^([A-Za-z]):/(.*)$", text)
    if match:
        return f"/mnt/{match.group(1).lower()}/{match.group(2)}"
    return text

def gemini_cli_parse_stdout(out_text):
    text = str(out_text or "").strip()
    if not text:
        return {}, ""
    events = []
    for line in text.splitlines():
        line_text = line.strip()
        if not line_text:
            continue
        try:
            event = json.loads(line_text)
        except Exception:
            events = []
            break
        if not isinstance(event, dict):
            events = []
            break
        events.append(event)
    if events and any(
        str(event.get("type") or "").strip().lower()
        in {"init", "result", "assistant", "tool_use", "step_update"}
        for event in events
    ):
        result_event = next(
            (
                event
                for event in reversed(events)
                if str(event.get("type") or "").strip().lower() == "result"
            ),
            {},
        )
        conversation_id = next(
            (
                str(event.get("conversation_id") or "").strip()
                for event in events
                if str(event.get("conversation_id") or "").strip()
            ),
            "",
        )
        response_text = ""
        if isinstance(result_event, dict):
            for key in ("result", "response", "text", "error"):
                value = result_event.get(key)
                if isinstance(value, str) and value.strip():
                    response_text = value.strip()
                    break
        if not response_text:
            response_parts = []
            for event in events:
                if str(event.get("type") or "").strip().lower() != "assistant":
                    continue
                value = gemini_cli_text_from_raw(event)
                if value:
                    response_parts.append(value)
            response_text = "\n".join(response_parts).strip()
        compact = {}
        if conversation_id:
            compact["conversation_id"] = conversation_id
        for key in ("status", "error"):
            value = result_event.get(key) if isinstance(result_event, dict) else None
            if value not in (None, ""):
                compact[key] = value
        if response_text:
            compact["result"] = response_text
        return compact, response_text or text
    try:
        raw = json.loads(text)
        return raw, gemini_cli_text_from_raw(raw, text)
    except Exception:
        pass
    parsed = jimeng_extract_json(text)
    if isinstance(parsed, (dict, list)) and parsed != {"text": text}:
        return parsed, gemini_cli_text_from_raw(parsed, text)
    return {"text": text}, text

def jimeng_poll_seconds(default=JIMENG_DEFAULT_POLL_SECONDS):
    try:
        return max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", str(default)) or default)))
    except Exception:
        return default

def jimeng_login_qr_from_text(text):
    text = str(text or "")
    candidates = []
    patterns = [
        r"(https?://[^\s\"'<>]+)",
        r"(dreamina://[^\s\"'<>]+)",
        r"(data:image/[^\s\"'<>]+)",
    ]
    for pattern in patterns:
        candidates.extend(re.findall(pattern, text))
    for value in candidates:
        if "login" in value.lower() or "qr" in value.lower() or value.startswith(("data:image", "dreamina://")):
            return value
    return candidates[0] if candidates else ""

def gpt_image_2_skill_model_arg(model="", provider="openai"):
    value = str(model or "").strip()
    low = value.lower()
    provider = str(provider or "").strip().lower()
    if provider == "codex":
        if not value or low.startswith("$imagegen") or low.startswith("gpt-image"):
            return "gpt-5.4"
        return value
    if not value or low.startswith("$imagegen"):
        return "gpt-image-2"
    return value

def gemini_cli_display_name(exe=None):
    return "Antigravity CLI" if is_antigravity_cli(exe or gemini_cli_executable()) else "Gemini CLI"

def jimeng_login_text():
    parts = []
    for key in ("stdout", "stderr"):
        value = str(_ports.JIMENG_LOGIN_SESSION.get(key) or "").strip()
        if value:
            parts.append(value)
    return "\n".join(parts).strip()

def jimeng_wsl_dreamina_available():
    now = time.monotonic()
    if now < float(_ports.JIMENG_WSL_DETECTION.get("expires_at") or 0):
        return bool(_ports.JIMENG_WSL_DETECTION.get("available"))
    exe = jimeng_wsl_executable()
    available = False
    if exe:
        shell_line = (
            "command -v dreamina >/dev/null 2>&1 || "
            "test -n \"$(find \"$HOME\" -maxdepth 4 -type f -name dreamina "
            "2>/dev/null | head -n 1)\""
        )
        try:
            proc = subprocess.run(
                [exe, *jimeng_wsl_base_args(exe), "-e", "sh", "-lc", shell_line],
                cwd=_ports.BASE_DIR,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=8,
                check=False,
            )
            available = proc.returncode == 0
        except Exception:
            available = False
    _ports.JIMENG_WSL_DETECTION.update(
        {"expires_at": now + 10.0, "available": available}
    )
    return available

def jimeng_wsl_executable():
    return shutil.which("wsl.exe") or shutil.which("wsl") or ""

def gpt_image_2_skill_size_arg(size="", model="", prompt="", provider="openai"):
    text = " ".join([str(size or ""), str(model or ""), str(prompt or "")]).lower()
    size_text = str(size or "").strip()
    if str(provider or "").strip().lower() == "codex":
        if "1k" in text or "1024" in text:
            return "1K"
        if "2k" in text or "2048" in text:
            return "2K"
        if "4k" in text or "3840" in text:
            return "4K"
        width, height = parse_size_pair(size_text)
        if 0 < max(width, height) < 1800:
            return "1K"
        if 1800 <= max(width, height) < 3000:
            return "2K"
        return "4K"
    match = re.search(r"(\d{3,5})\s*[x×*]\s*(\d{3,5})", size_text, flags=re.I)
    if match:
        width = int(match.group(1))
        height = int(match.group(2))
        if width > 0 and height > 0:
            return normalize_gpt_image_2_size(f"{width}x{height}")
    ratio_match = re.fullmatch(r"\s*(\d{1,2})\s*:\s*(\d{1,2})\s*", size_text)
    if ratio_match:
        ratio = f"{int(ratio_match.group(1))}:{int(ratio_match.group(2))}"
        options = _ports.CHAT_RATIO_SIZE_OPTIONS.get(ratio)
        if options:
            if "4k" in text or "3840" in text:
                return options[-1]
            if "1k" in text or "1024" in text:
                return options[0]
            return options[1] if len(options) > 1 else options[0]
    if "4k" in text or "3840" in text:
        return "4K"
    if "1k" in text or "1024" in text:
        return "1K"
    return "2K"

def jimeng_image_model_version(model, mode="text2image"):
    version = jimeng_normalize_image_model(model)
    allowed = _ports.JIMENG_IMAGE2IMAGE_MODELS if mode == "image2image" else _ports.JIMENG_TEXT2IMAGE_MODELS
    if version in allowed:
        return version
    known_models = {
        *_ports.JIMENG_TEXT2IMAGE_MODELS,
        *_ports.JIMENG_IMAGE2IMAGE_MODELS,
    }
    if version in known_models:
        return ""
    return (
        version
        if re.fullmatch(r"\d+\.\d+(?:[A-Za-z][A-Za-z0-9_-]*)?", version)
        else ""
    )

def codex_cli_executable():
    configured = str(codex_env_value("CODEX_BIN") or "").strip()
    if configured:
        return configured
    return shutil.which("codex") or shutil.which("codex.exe") or shutil.which("codex.cmd") or ""

async def generate_gemini_cli_provider_image(prompt, size, model, reference_images=None, provider=None):
    ref_paths, temp_paths = await gemini_cli_reference_paths(reference_images)
    try:
        executable = gemini_cli_executable()
        antigravity = is_antigravity_cli(executable)
        run_output_directory = tempfile.mkdtemp(
            prefix="infinite_canvas_gemini_cli_"
        )
        temp_paths.append(run_output_directory)
        image_name = f"ic_{uuid.uuid4().hex}"
        ref_text = ""
        if ref_paths:
            ref_text = "\n参考图片本地路径：\n" + "\n".join(ref_paths)
        size_context = f"{model or ''} {prompt or ''}"
        if antigravity:
            image_paths_instruction = (
                f"ImagePaths: {json.dumps(ref_paths, ensure_ascii=False)}\n"
                if ref_paths
                else "没有参考图时省略 ImagePaths。\n"
            )
            image_prompt = (
                "你正在为 Reroll 生成图片。必须调用内置 generate_image "
                "工具恰好一次，不能只回复文字、写计划，或使用 shell/Python 代替。\n"
                f"ImageName: {image_name}\n"
                f"Prompt: {prompt}\n"
                f"{image_paths_instruction}"
                f"{gemini_cli_image_size_instruction(size, size_context)}\n"
                "如果工具失败，请保留工具返回的原始错误信息，不要改写成通用说明。"
            )
        else:
            image_prompt = (
                f"你正在为 Reroll 生成图片。\n"
                f"任务：{prompt}\n\n"
                f"{gemini_cli_image_size_instruction(size, size_context)}\n"
                f"{ref_text}\n\n"
                f"请把本次任务的最终图片保存到这个独立本地目录：{run_output_directory}\n"
                "不要读取、引用或修改其他输出目录中的图片。\n"
                "文件格式优先 png 或 jpg。只输出最终文件路径和一句简短说明；不要修改项目代码，不要创建额外文档。\n"
                "如果你无法真正创建图片文件，请在 60 秒内直接回复“无法生成图片文件”，不要只写计划，也不要持续尝试。"
            )
        raw = await run_gemini_cli(
            image_prompt,
            model=model or _ports.GEMINI_CLI_DEFAULT_IMAGE_MODELS[0],
            timeout=gemini_cli_image_timeout() if antigravity else gemini_cli_timeout(),
            allow_tools=True,
            workspace_paths=[
                *ref_paths,
                run_output_directory,
            ],
            output_format="stream-json" if antigravity else "",
        )
        quota_failure = gemini_cli_quota_failure_message(raw)
        if quota_failure:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"{gemini_cli_display_name(executable)} 图片生成额度已用尽"
                    f"（insufficient quota）：{quota_failure}"
                ),
            )
        failure = gemini_cli_image_failure_message(raw)
        if failure:
            raise HTTPException(
                status_code=502,
                detail=f"{gemini_cli_display_name()} 未生成图片：{failure}",
            )
        files = []
        preserve_sources = False
        if antigravity:
            payload = raw.get("raw") if isinstance(raw, dict) else {}
            conversation_id = (
                str(payload.get("conversation_id") or "").strip()
                if isinstance(payload, dict)
                else ""
            )
            files = antigravity_cli_conversation_image_files(
                conversation_id,
                image_name,
            )
            preserve_sources = bool(files)
        if not files:
            files = gemini_cli_output_image_files(run_output_directory)
        urls = []
        for path in files:
            if not gemini_cli_valid_image_file(path):
                continue
            publish_source = path
            if preserve_sources:
                extension = os.path.splitext(path)[1].lower() or ".png"
                publish_source = os.path.join(
                    run_output_directory,
                    f"artifact_{uuid.uuid4().hex}{extension}",
                )
                shutil.copy2(path, publish_source)
            processed_path = codex_postprocess_image_to_requested_size(
                publish_source, size, "gemini-cli"
            )
            url = gemini_cli_publish_output(processed_path or publish_source)
            if url and url not in urls:
                urls.append(url)
        if not urls:
            status_text = (raw.get("text") or raw.get("_stdout") or raw.get("_stderr") or "")[:1200]
            raise HTTPException(
                status_code=502,
                detail=(
                    f"{gemini_cli_display_name()} 已返回，但没有在本次任务的"
                    f"独立输出目录发现图片：{status_text}"
                ),
            )
        return {"type": "url", "value": urls[0]}, {"images": urls, "text": raw.get("text"), "provider": "gemini-cli", "raw": raw.get("raw")}
    finally:
        cleanup_cli_temp_paths(temp_paths)

def jimeng_cli_executable():
    if jimeng_use_wsl():
        return jimeng_wsl_executable() or "wsl.exe"
    return jimeng_native_cli_executable()

def wsl_path_to_windows(path):
    text = str(path or "").strip()
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", text)
    if match:
        tail = match.group(2).replace("/", "\\")
        return f"{match.group(1).upper()}:\\{tail}"
    return text

def gpt_image_2_skill_auth_json(auth_file=""):
    path = str(auth_file or "").strip()
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def decode_utf16_auto(raw: bytes) -> str:
    # WSL/Windows interop emits UTF-16 for null-heavy diagnostics, but the
    # endianness varies by source (console vs proxy vs subprocess), so a
    # hard-coded "utf-16le" silently byte-swaps UTF-16BE text into garbage
    # (e.g. "localhost" -> 氀漀挀愀氀栀漀猀琀). Decode both ways and keep
    # whichever produces more plain ASCII, since diagnostics are ASCII-heavy.
    try:
        le = raw.decode("utf-16le", errors="ignore")
    except Exception:
        le = ""
    try:
        be = raw.decode("utf-16be", errors="ignore")
    except Exception:
        be = ""
    def ascii_score(text):
        return sum(1 for ch in text if 0x20 <= ord(ch) <= 0x7e)
    return le if ascii_score(le) >= ascii_score(be) else be

async def jimeng_store_output_value(value, kind="image"):
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("/assets/"):
        return text
    if text.startswith("file://"):
        text = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", text):
            text = text[1:]
    if jimeng_use_wsl() and text.startswith("/mnt/"):
        text = wsl_path_to_windows(text)
    if text.startswith(("http://", "https://")):
        if kind == "video":
            return await save_remote_video_to_output(text, prefix="jimeng_video_")
        return await save_ai_image_to_output({"type": "url", "value": text}, prefix="jimeng_")
    if os.path.isfile(text):
        return jimeng_local_output_url(text, kind)
    return ""

def gemini_cli_reference_note(reference_images=None):
    refs = []
    temp_paths = []
    for ref in (reference_images or [])[:_ports.ONLINE_IMAGE_REFERENCE_MAX]:
        url = ref.get("url") if isinstance(ref, dict) else getattr(ref, "url", "")
        if not url:
            continue
        refs.append(url)
    return refs, temp_paths

async def jimeng_store_outputs(raw, kind="image", allow_query=True):
    failure = jimeng_failure_reason(raw)
    if failure:
        raise HTTPException(status_code=502, detail=f"即梦生成失败：{failure}")
    values = jimeng_output_values(raw)
    urls = []
    for value in values:
        local_url = await jimeng_store_output_value(value, kind)
        if local_url and local_url not in urls:
            urls.append(local_url)
    if urls:
        return urls
    submit_id = jimeng_submit_id(raw)
    if submit_id and allow_query:
        queried = await jimeng_query_result(submit_id, kind)
        try:
            return await jimeng_store_outputs(queried, kind, allow_query=False)
        except HTTPException as exc:
            if getattr(exc, "status_code", None) == 502:
                status_text = json.dumps(queried, ensure_ascii=False)[:800] if isinstance(queried, (dict, list)) else str(queried)[:800]
                raise HTTPException(status_code=502, detail=f"即梦任务已返回但没有下载到媒体：{status_text}") from exc
            raise
    status_text = json.dumps(raw, ensure_ascii=False)[:800] if isinstance(raw, (dict, list)) else str(raw)[:800]
    if submit_id:
        raise _ports.JimengPendingError(submit_id, kind, jimeng_queue_info(raw), raw)
    raise HTTPException(status_code=502, detail=f"即梦 CLI 未返回可用媒体结果：{status_text}")

async def codex_chat_text(payload, history_messages=None):
    image_paths = []
    temp_paths = []
    try:
        image_values = []
        if hasattr(payload, "images"):
            image_values.extend([{"url": item} for item in (getattr(payload, "images", None) or []) if item])
        if hasattr(payload, "reference_images"):
            image_values.extend([ref.dict() for ref in (getattr(payload, "reference_images", None) or []) if getattr(ref, "url", "")])
        image_paths, temp_paths = await codex_reference_paths(image_values)
        raw = await run_codex_cli(
            codex_chat_prompt(payload, history_messages),
            model=getattr(payload, "model", "") or _ports.CODEX_DEFAULT_CHAT_MODELS[0],
            image_paths=image_paths,
            timeout=codex_timeout(),
            output_last_message=True,
        )
        text = str(raw.get("text") or "").strip()
        return text or "Codex CLI 返回了空回复。", raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

def jimeng_command(clean_args, exe=None):
    exe = exe or jimeng_cli_executable()
    if jimeng_use_wsl():
        shell_line = (
            ". ~/.profile >/dev/null 2>&1 || true; . ~/.bashrc >/dev/null 2>&1 || true; "
            "DREAMINA_BIN=$(command -v dreamina || find \"$HOME\" -maxdepth 4 -type f -name dreamina 2>/dev/null | head -n 1); "
            "if [ -z \"$DREAMINA_BIN\" ]; then echo 'dreamina CLI not found in WSL' >&2; exit 127; fi; "
            "\"$DREAMINA_BIN\" " + " ".join(shlex.quote(arg) for arg in clean_args)
        )
        return [exe, *jimeng_wsl_base_args(exe), "-e", "sh", "-lc", shell_line]
    return [exe, *clean_args]

def gpt_image_2_skill_provider_args(auth_file=""):
    auth_data = gpt_image_2_skill_auth_json(auth_file)
    if gpt_image_2_skill_access_token(auth_data):
        return ["--provider", "codex", "--auth-file", auth_file] if auth_file else ["--provider", "codex"], "codex"
    api_key = gpt_image_2_skill_api_key(auth_data)
    if api_key:
        return ["--provider", "openai", "--api-key", api_key], "openai"
    return (["--provider", "codex", "--auth-file", auth_file] if auth_file else ["--provider", "codex"]), "codex"

def jimeng_ratio_from_size(size, fallback="1:1"):
    width, height = parse_size_pair(size)
    if not width or not height:
        return fallback
    ratio = width / max(1, height)
    left, right = min(_ports.JIMENG_RATIO_CHOICES, key=lambda item: abs(ratio - item[0] / item[1]))
    return f"{left}:{right}"

async def jimeng_login_reader(proc):
    async def read_stream(stream, key):
        while True:
            chunk = await stream.readline()
            if not chunk:
                break
            text = (decode_wsl_output(chunk) if jimeng_use_wsl() else chunk.decode("utf-8", errors="replace"))
            if key == "stderr":
                text = jimeng_clean_wsl_stderr(text)
            if text:
                _ports.JIMENG_LOGIN_SESSION[key] = str(_ports.JIMENG_LOGIN_SESSION.get(key) or "") + text
    await asyncio.gather(read_stream(proc.stdout, "stdout"), read_stream(proc.stderr, "stderr"))

def jimeng_video_duration(duration, model=None):
    low, high = jimeng_video_duration_range(model)
    default = max(low, min(high, 5))
    try:
        text = str(duration).strip() if duration is not None else ""
        value = default if text == "" else int(text)
    except Exception:
        value = default
    return max(low, min(high, value))

def validated_cli_reference_image(path):
    path = os.path.abspath(str(path or ""))
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        raise HTTPException(
            status_code=404,
            detail="CLI 参考图片不存在或无法读取",
        ) from exc
    if size <= 0:
        raise HTTPException(status_code=400, detail="CLI 参考图片为空")
    if size > CLI_REFERENCE_IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail="CLI 参考图片过大，请使用 50MB 以内的文件",
        )
    try:
        with Image.open(path) as image:
            image.verify()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="CLI 参考素材不是可识别的图片",
        ) from exc
    return path


async def codex_prepare_local_media(ref_url):
    text = str(ref_url or "").strip()
    if not text:
        return "", []
    if text.startswith(("/assets/")):
        path = _ports.output_file_from_url(text)
        if path:
            return validated_cli_reference_image(path), []
        raise HTTPException(status_code=404, detail=f"OpenAI CLI 参考素材不存在：{text}")
    if text.startswith("file://"):
        path = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        if os.path.isfile(path):
            return validated_cli_reference_image(path), []
    if os.path.isfile(text):
        return validated_cli_reference_image(text), []
    temp_paths = []
    suffix = ".png"
    if text.startswith("data:"):
        if ";base64," not in text:
            raise HTTPException(
                status_code=400,
                detail="OpenAI CLI 参考图片内容不完整，请重新选择",
            )
        header, encoded = text.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else ""
        suffix = mimetypes.guess_extension(mime) or suffix
        try:
            raw = base64.b64decode(encoded)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="CLI 参考图片内容不是有效的 base64 数据",
            ) from exc
        if len(raw) > CLI_REFERENCE_IMAGE_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="CLI 参考图片过大，请使用 50MB 以内的文件",
            )
        fd, path = tempfile.mkstemp(prefix="codex_ref_", suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
            temp_paths.append(path)
            return validated_cli_reference_image(path), temp_paths
        except Exception:
            try:
                os.remove(path)
            except OSError:
                pass
            raise
    if text.startswith(("http://", "https://")):
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=20.0,
                    read=300.0,
                    write=60.0,
                    pool=20.0,
                ),
                follow_redirects=False,
            ) as client:
                response = await httpx_get_public(client, text)
                response.raise_for_status()
                content = response.content
        except OutboundUrlError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if len(content) > CLI_REFERENCE_IMAGE_MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail="CLI 参考图片过大，请使用 50MB 以内的文件",
            )
        clean_path = urllib.parse.urlparse(text).path
        suffix = os.path.splitext(clean_path)[1] or mimetypes.guess_extension(response.headers.get("content-type", "")) or suffix
        fd, path = tempfile.mkstemp(prefix="codex_ref_", suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content)
            temp_paths.append(path)
            return validated_cli_reference_image(path), temp_paths
        except Exception:
            try:
                os.remove(path)
            except OSError:
                pass
            raise
    raise HTTPException(status_code=400, detail=f"OpenAI CLI 无法读取参考素材：{text[:120]}")

def jimeng_video_ref_url(ref):
    url = getattr(ref, "url", "")
    if isinstance(ref, dict):
        url = ref.get("url", url)
    return str(url or "").strip()

def gpt_image_2_skill_api_key(auth_data=None):
    for key in ("GPT_IMAGE_2_SKILL_API_KEY", "OPENAI_API_KEY"):
        value = str(codex_env_value(key) or "").strip()
        if value:
            return value
    if isinstance(auth_data, dict):
        value = str(auth_data.get("OPENAI_API_KEY") or auth_data.get("api_key") or auth_data.get("apiKey") or "").strip()
        if value:
            return value
    user_profile = os.getenv("USERPROFILE", "").strip()
    user_auth = os.path.join(user_profile, ".codex", "auth.json") if user_profile else ""
    if user_auth:
        user_data = gpt_image_2_skill_auth_json(user_auth)
        value = str(user_data.get("OPENAI_API_KEY") or user_data.get("api_key") or user_data.get("apiKey") or "").strip()
        if value:
            return value
    return ""

def gemini_cli_model(model="", fallback=""):
    value = str(model or fallback or "").strip()
    return value or "auto"

def gpt_image_2_skill_auth_file():
    configured = str(codex_env_value("GPT_IMAGE_2_SKILL_AUTH_FILE") or codex_env_value("CODEX_AUTH_FILE") or "").strip()
    if configured:
        return configured
    project_auth = os.path.join(_ports.BASE_DIR, "API", "openai-gpt-account-auth.json")
    user_profile = os.getenv("USERPROFILE", "").strip()
    candidates = [
        project_auth,
        os.path.join(user_profile, ".codex", "auth.json") if user_profile else "",
        os.path.join(os.path.expanduser("~"), ".codex", "auth.json"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return candidates[0] if candidates and candidates[0] else ""

def jimeng_transition_duration(total_duration, transition_count):
    count = max(1, int(transition_count or 1))
    try:
        total = float(total_duration or 5)
    except Exception:
        total = 5.0
    minimum = 2.0 if count == 1 else 1.0
    return max(minimum, min(8.0, total / count))

def gpt_image_2_skill_executable():
    configured = str(codex_env_value("GPT_IMAGE_2_SKILL_BIN") or "").strip()
    if configured:
        return configured
    return (
        shutil.which("gpt-image-2-skill")
        or shutil.which("gpt-image-2-skill.exe")
        or shutil.which("gpt-image-2-skill.cmd")
        or ""
    )

def jimeng_pending_payload(exc: "JimengPendingError"):
    qi = exc.queue_info or {}
    idx = qi.get("queue_idx")
    length = qi.get("queue_length")
    if idx is not None and length is not None:
        msg = f"即梦云端排队中（第 {idx}/{length} 位），任务未丢失，可继续等待或手动查询。submit_id={exc.submit_id}"
    else:
        msg = f"即梦任务仍在生成中，任务未丢失。submit_id={exc.submit_id}"
    return {
        "jimeng_pending": True,
        "submit_id": exc.submit_id,
        "kind": exc.kind,
        "queue_info": qi,
        "message": msg,
    }

def gemini_cli_image_timeout():
    raw = os.getenv("ANTIGRAVITY_IMAGE_TIMEOUT") or os.getenv("GEMINI_CLI_IMAGE_TIMEOUT") or "300"
    try:
        return max(60, min(1800, int(raw)))
    except Exception:
        return 300

def decode_wsl_output(data: bytes) -> str:
    data = data or b""
    if not data:
        return ""

    # WSL can mix UTF-16 diagnostics with UTF-8 command output in the same
    # stream. Decode per line so a WSL proxy warning does not corrupt CLI errors.
    if b"\x00" in data[:400]:
        lines = []
        for raw_line in data.splitlines():
            if not raw_line:
                lines.append("")
                continue
            sample = raw_line[:200]
            nul_ratio = sample.count(0) / max(1, len(sample))
            if nul_ratio > 0.2:
                try:
                    lines.append(decode_utf16_auto(raw_line))
                    continue
                except Exception:
                    pass
            lines.append(raw_line.decode("utf-8-sig", errors="ignore"))
        return "\n".join(lines)
    if b"\x00" in data[:200]:
        try:
            return decode_utf16_auto(data)
        except Exception:
            pass
    return data.decode("utf-8-sig", errors="ignore")

def gemini_cli_timeout(default=GEMINI_CLI_DEFAULT_TIMEOUT):
    try:
        return max(30, min(3600, int(os.getenv("GEMINI_CLI_TIMEOUT", str(default)) or default)))
    except Exception:
        return default

def jimeng_queue_info(raw):
    """从即梦原始返回里就近取出 queue_info（含 queue_idx/queue_length/queue_status）。"""
    found = []
    def visit(value):
        if isinstance(value, dict):
            qi = value.get("queue_info")
            if isinstance(qi, dict) and qi:
                found.append(qi)
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else {}

def jimeng_failure_reason(raw):
    found = []
    def visit(value):
        if isinstance(value, dict):
            status = str(value.get("gen_status") or value.get("status") or "").strip().lower()
            reason = value.get("fail_reason") or value.get("failReason") or value.get("error") or value.get("message") or value.get("msg")
            if reason and (status in {"fail", "failed", "error"} or "fail" in str(reason).lower() or "invalid param" in str(reason).lower()):
                found.append(str(reason))
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else ""

def jimeng_extract_json(text):
    text = str(text or "").strip()
    if not text:
        return {}
    decoder = json.JSONDecoder()
    parsed = []
    for i, ch in enumerate(text):
        if ch not in "[{":
            continue
        try:
            obj, _end = decoder.raw_decode(text[i:])
            if not text[:i].strip():
                return obj
            parsed.append((i, obj))
        except Exception:
            continue
    def score(item):
        _idx, obj = item
        if not isinstance(obj, dict):
            return 1
        keys = {str(key).lower() for key in obj.keys()}
        weight = 0
        for key in ("submit_id", "gen_status", "result_json", "images", "videos", "data", "total_credit"):
            if key in keys:
                weight += 10
        return weight
    return max(parsed, key=score)[1] if parsed else {"text": text}

async def jimeng_query_result(
    submit_id, kind="image", *, download=True
):
    args = [
        "query_result",
        f"--submit_id={submit_id}",
    ]
    if download:
        args.append(
            "--download_dir="
            f"{jimeng_cli_path_arg(_ports.generation_output_directory())}"
        )
    return await run_jimeng_cli(args, timeout=min(300, jimeng_poll_seconds() + 60))

def gemini_cli_env_value(key):
    return os.getenv(key, "") or _ports.read_api_env_value(key)

def jimeng_normalize_image_model(model):
    match = re.search(
        r"(\d+\.\d+)[\s_-]*(pro|lite)?",
        str(model or ""),
        flags=re.I,
    )
    if not match:
        return ""
    version = match.group(1)
    variant = str(match.group(2) or "").lower()
    if variant == "pro":
        return f"{version}Pro"
    return version

def jimeng_output_values(raw):
    outputs = []
    jimeng_collect_media_values(raw, outputs)
    deduped = []
    for value in outputs:
        if value not in deduped:
            deduped.append(value)
    return deduped

async def gemini_cli_chat_text(payload, history_messages=None):
    temp_paths = []
    try:
        prompt, image_values = gemini_cli_chat_prompt(payload, history_messages)
        image_paths, temp_paths = await gemini_cli_reference_paths(image_values)
        if image_paths:
            prompt = f"{prompt}\n\n可参考的本地图片路径：\n" + "\n".join(image_paths)
        prompt = f"{prompt}\n\n请直接回答用户，输出纯文本，不要修改项目文件。"
        raw = await run_gemini_cli(
            prompt,
            model=getattr(payload, "model", "") or _ports.GEMINI_CLI_DEFAULT_CHAT_MODELS[0],
            timeout=gemini_cli_timeout(),
            read_only_tools=bool(image_paths),
            workspace_paths=image_paths,
        )
        text = str(raw.get("text") or "").strip()
        return text or f"{gemini_cli_display_name()} 返回了空回复。", raw
    finally:
        cleanup_cli_temp_paths(temp_paths)

def codex_chat_prompt(payload, history_messages=None):
    parts = []
    system_prompt = str(getattr(payload, "system_prompt", "") or "").strip()
    if system_prompt:
        parts.append(f"系统要求：\n{system_prompt}")
    for item in (history_messages or [])[-_ports.MAX_HISTORY_MESSAGES:]:
        role = str(item.get("role") or "").strip()
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            label = "用户" if role == "user" else "助手"
            parts.append(f"{label}：\n{content}")
    message = str(getattr(payload, "message", "") or "").strip()
    parts.append(f"用户：\n{message}")
    parts.append("请直接回答用户，输出纯文本，不要修改项目文件。")
    return "\n\n".join(part for part in parts if part).strip()

def jimeng_video_ratio_arg(aspect_ratio):
    value = str(aspect_ratio or "").strip()
    allowed = {"1:1", "3:4", "16:9", "4:3", "9:16", "21:9"}
    if value in allowed:
        return value
    return ""

def jimeng_native_cli_executable():
    configured = str(
        jimeng_env_value("JIMENG_BIN")
        or jimeng_env_value("DREAMINA_BIN")
        or ""
    ).strip()
    if configured:
        return configured
    return shutil.which("dreamina") or shutil.which("dreamina.exe") or shutil.which("dreamina.cmd") or ""

async def jimeng_login_status():
    proc = _ports.JIMENG_LOGIN_SESSION.get("proc")
    text = jimeng_login_text()
    running = proc is not None and getattr(proc, "returncode", None) is None
    logged_in = False
    credit_raw = None
    if not running:
        try:
            credit_raw = await run_jimeng_cli(["user_credit"], timeout=20)
            logged_in = True
        except HTTPException:
            logged_in = False
    return {
        "success": True,
        "running": running,
        "logged_in": logged_in,
        "text": text,
        "qr_url": jimeng_login_qr_from_text(text),
        "raw": credit_raw,
    }

async def jimeng_login_start():
    old_proc = _ports.JIMENG_LOGIN_SESSION.get("proc")
    if old_proc and getattr(old_proc, "returncode", None) is None:
        try:
            old_proc.terminate()
        except Exception:
            pass
    exe = jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 dreamina CLI")
    _ports.JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
    args = ["login", "--headless"]
    command = jimeng_command(args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=_ports.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI：{exe}") from exc
    _ports.JIMENG_LOGIN_SESSION["proc"] = proc
    asyncio.create_task(jimeng_login_reader(proc))
    await asyncio.sleep(2)
    text = jimeng_login_text()
    if proc.returncode not in (None, 0) and ("unknown" in text.lower() or "no such option" in text.lower()):
        # 旧版 CLI 可能没有 --headless，退回 debug 输出。
        _ports.JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
        proc = await asyncio.create_subprocess_exec(
            *jimeng_command(["login", "--debug"], exe),
            cwd=_ports.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _ports.JIMENG_LOGIN_SESSION["proc"] = proc
        asyncio.create_task(jimeng_login_reader(proc))
        await asyncio.sleep(2)
        text = jimeng_login_text()
    return {
        "success": True,
        "running": _ports.JIMENG_LOGIN_SESSION.get("proc") is not None and _ports.JIMENG_LOGIN_SESSION["proc"].returncode is None,
        "text": text,
        "qr_url": jimeng_login_qr_from_text(text),
        "started_at": _ports.JIMENG_LOGIN_SESSION.get("started_at") or 0,
    }

async def jimeng_credit():
    raw = await run_jimeng_cli(["user_credit"], timeout=30)
    return {"success": True, "raw": raw}

async def jimeng_logout():
    raw = await run_jimeng_cli(["logout"], timeout=30)
    return {"success": True, "raw": raw}

async def codex_help(payload: CodexHelpRequest):
    exe = codex_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 OpenAI Codex CLI。")
    allowed = {"", "exec", "login", "logout", "doctor", "mcp", "app", "update"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不允许的 Codex CLI 命令")
    args = [exe]
    if command:
        args.append(command)
    args.append("--help")
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=_ports.BASE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
    out_text, err_text = codex_decode_output(stdout, stderr)
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=(err_text or out_text or f"exit={proc.returncode}")[:1000])
    return {"text": out_text or err_text, "raw": {"stdout": out_text, "stderr": err_text}}

async def gemini_cli_status():
    exe = gemini_cli_executable()
    display_name = gemini_cli_display_name(exe)
    if not exe:
        return {
            "installed": False,
            "logged_in": False,
            "provider": "antigravity",
            "message": "未找到 Antigravity CLI，请先安装。",
        }
    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "--version",
            cwd=_ports.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        out_text, err_text = codex_decode_output(stdout, stderr)
        ok = proc.returncode == 0
        is_agy = is_antigravity_cli(exe)
        return {
            "installed": ok,
            "logged_in": None,
            "version": out_text or err_text,
            "path": exe,
            "provider": "antigravity" if is_agy else "gemini",
            "message": f"{display_name} 已安装。登录状态会在首次执行 {'agy' if is_agy else 'gemini'} 时由 CLI 校验。" if ok else (err_text or out_text or f"{display_name} 检测失败"),
            "raw": {"stdout": out_text, "stderr": err_text, "returncode": proc.returncode},
        }
    except Exception as exc:
        return {
            "installed": False,
            "logged_in": False,
            "path": exe,
            "provider": "antigravity" if is_antigravity_cli(exe) else "gemini",
            "message": f"{display_name} 检测失败：{exc}",
        }

async def jimeng_help(payload: JimengHelpRequest):
    command = str(payload.command or "").strip()
    allowed = {"", "login", "logout", "user_credit", "text2image", "image2image", "image_upscale", "text2video", "image2video", "multimodal2video", "frames2video", "multiframe2video", "list_task", "query_result"}
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不支持的帮助命令")
    args = [command, "-h"] if command else ["-h"]
    raw = await run_jimeng_cli(args, timeout=30, raw_text=True)
    text = raw.get("_stdout") or ""
    if raw.get("_stderr"):
        text = f"{text}\n{raw.get('_stderr')}".strip()
    return {"success": True, "command": command, "text": text, "raw": raw}

async def gemini_cli_help(payload: GeminiCliHelpRequest):
    exe = gemini_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 Antigravity CLI。")
    is_agy = is_antigravity_cli(exe)
    allowed = {"", "help", "install", "models", "plugin", "plugins", "update", "changelog"} if is_agy else {"", "help", "mcp", "extensions"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail=f"不允许的 {gemini_cli_display_name(exe)} 命令")
    args = [exe]
    if command:
        args.append(command)
    args.append("--help")
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=_ports.BASE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
    out_text, err_text = codex_decode_output(stdout, stderr)
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=(err_text or out_text or f"exit={proc.returncode}")[:1000])
    return {"text": out_text or err_text, "raw": {"stdout": out_text, "stderr": err_text}}

async def jimeng_status():
    exe = jimeng_cli_executable()
    if not exe:
        return {"installed": False, "logged_in": False, "message": "未找到 dreamina CLI"}
    version, version_text = await jimeng_cli_version()
    version_str = ".".join(str(part) for part in version) if version else None
    version_ok = version >= _ports.JIMENG_MIN_CLI_VERSION if version else None
    min_version_str = ".".join(str(part) for part in _ports.JIMENG_MIN_CLI_VERSION)
    try:
        raw = await run_jimeng_cli(["user_credit"], timeout=30)
        return {
            "installed": True,
            "logged_in": True,
            "raw": raw,
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }
    except HTTPException as exc:
        return {
            "installed": True,
            "logged_in": False,
            "message": str(exc.detail),
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }

async def recover_jimeng_media(
    _provider,
    submit_id,
    kind="image",
):
    """Pure Jimeng recovery seam retaining the legacy query JSON."""
    submit_id = str(submit_id or "").strip()
    if not submit_id:
        raise HTTPException(status_code=400, detail="缺少 submit_id")
    kind = str(kind or "image").strip().lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    queried = await jimeng_query_result(
        submit_id, kind, download=False
    )
    try:
        reason = jimeng_failure_reason(queried)
        if reason:
            raise HTTPException(status_code=502, detail=reason)
        urls = [
            str(value)
            for value in jimeng_output_values(queried)
            if str(value or "").strip()
        ]
        if not urls:
            raise _ports.JimengPendingError(
                submit_id,
                kind,
                jimeng_queue_info(queried),
                queried,
            )
        return {
            "status": "succeeded",
            "submit_id": submit_id,
            "kind": kind,
            "urls": urls,
            "raw": queried,
        }
    except _ports.JimengPendingError as exc:
        return {
            "status": "pending",
            "submit_id": submit_id,
            "kind": kind,
            "queue_info": exc.queue_info,
            "remote_history_missing": jimeng_remote_history_missing(
                queried, exc.queue_info
            ),
            "message": jimeng_pending_payload(exc)["message"],
            "raw": queried,
        }
    except HTTPException as exc:
        return {"status": "failed", "submit_id": submit_id, "kind": kind, "error": str(getattr(exc, "detail", "") or exc)}


async def wait_for_jimeng_submission(
    submit_id,
    kind,
    submitted_raw=None,
):
    """Keep strict inline waiting while querying only the durable task id."""
    timeout = max(1, int(jimeng_poll_seconds()))
    deadline = time.monotonic() + timeout
    last = submitted_raw
    while True:
        result = await recover_jimeng_media(None, submit_id, kind)
        last = result.get("raw") or result
        status = str(result.get("status") or "").lower()
        if status == "succeeded":
            return result
        if status == "failed":
            raise HTTPException(
                status_code=502,
                detail=str(result.get("error") or "即梦任务失败"),
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _ports.JimengPendingError(
                str(submit_id),
                str(kind),
                result.get("queue_info") or {},
                last,
            )
        await asyncio.sleep(min(2.0, remaining))


async def jimeng_query_media(payload: JimengQueryMediaRequest):
    """Legacy request facade for Jimeng media recovery."""
    return await recover_jimeng_media(
        None,
        payload.submit_id,
        payload.kind,
    )


async def codex_status():
    exe = codex_cli_executable()
    image2_exe = gpt_image_2_skill_executable()
    if not exe:
        return {
            "installed": False,
            "logged_in": False,
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": image2_exe,
            "message": "未找到 OpenAI Codex CLI，请先安装。",
        }
    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "--version",
            cwd=_ports.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        out_text, err_text = codex_decode_output(stdout, stderr)
        ok = proc.returncode == 0
        helper_message = "GPT Image 2 helper 已安装，OpenAI CLI 生图会使用 GPT Image 2。" if image2_exe else "未找到 GPT Image 2 helper，OpenAI CLI 生图不可用；已禁用 Codex 内置 $imagegen 回退。"
        return {
            "installed": ok,
            "logged_in": None,
            "version": out_text or err_text,
            "path": exe,
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": image2_exe,
            "message": f"OpenAI Codex CLI 已安装。{helper_message} 登录状态会在首次执行 codex exec 时由 CLI 校验。" if ok else (err_text or out_text or "Codex CLI 检测失败"),
            "raw": {"stdout": out_text, "stderr": err_text, "returncode": proc.returncode},
        }
    except Exception as exc:
        return {
            "installed": False,
            "logged_in": False,
            "path": exe,
            "image2_helper_installed": bool(image2_exe),
            "image2_helper_path": image2_exe,
            "message": f"Codex CLI 检测失败：{exc}",
        }
