"""Account-scoped Agent authoring. CanvasSync remains the only Canvas writer."""

from __future__ import annotations

import copy
import hashlib
import html
import json
import math
import re
import time
import base64
import io
import heapq
from collections import defaultdict, deque
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from fastapi import Request, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler

from .canvas_realtime import NODE_GAP, apply_operation, CanvasRealtimeError
from .canvas_sync import CanvasSyncError
from . import agent_inputs
from .node_references import parse_reference, NodeReferenceError
from .workspace_storage import WorkspaceStorageError


class AgentError(ValueError):
    def __init__(self, code, details=None, status=400):
        self.code, self.details, self.status = code, details or {}, status
        super().__init__(code.replace("_", " "))


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def task_state(node):
    if node.get("pending") or node.get("queued"):
        return "pending"
    if node.get("running"):
        return "running"
    if (
        node.get("error")
        or node.get("failed")
        or node.get("generationFailed")
        or node.get("generationError")
        or (
            node.get("generationRunFeedback", {}).get("failedCount", 0) > 0
            and not node.get("generationRunFeedback", {}).get("successfulCount")
        )
    ):
        return "failed"
    if node.get("images") or node.get("runAt") or node.get("generationOutputNode"):
        return "succeeded"
    return "draft"


def node_role(node):
    if node.get("referenceGenerationKind"):
        return "generation"
    if node.get("type") == "smart-prompt":
        return "prompt-generation" if node.get("llmEnabled") else "prompt"
    return {
        "smart-image": "image",
        "smart-frame": "frame",
        "smart-group": "smart-group",
        "smart-loop": "loop",
        "smart-splitter": "splitter",
        "smart-brush": "brush-stroke",
        "smart-text": "text-annotation",
    }.get(node.get("type"), "image")


def node_geometry(node):
    """Public Canvas coordinates, independent of a private editor viewport."""
    return {"x": node.get("x", 0), "y": node.get("y", 0),
            "width": node.get("w", node.get("width", 280)),
            "height": node.get("h", node.get("height", 220))}


def visual_order(items):
    """Mirror multi-input.visualOrder; shared fixtures guard visual selection order."""
    center = lambda n: n.get("y", 0) + n.get("height", n.get("h", 220)) / 2
    mean = lambda band, read: sum(read(n) for n in band) / len(band)
    bands = []
    for item in sorted(
        items, key=lambda n: (center(n), n.get("y", 0), n.get("x", 0), n["id"])
    ):
        best = None
        for band in bands:
            candidates = [*band, item]
            ys = [n.get("y", 0) for n in candidates]
            centers = [center(n) for n in candidates]
            tolerance = max(
                16, min(n.get("height", n.get("h", 220)) for n in candidates) / 2
            )
            if min(max(ys) - min(ys), max(centers) - min(centers)) > tolerance:
                continue
            score = min(
                abs(item.get("y", 0) - mean(band, lambda n: n.get("y", 0))),
                abs(center(item) - mean(band, center)),
            )
            if best is None or score < best[0]:
                best = (score, band)
        if best is None:
            bands.append([item])
        else:
            best[1].append(item)
    bands.sort(
        key=lambda band: (
            mean(band, center),
            min(n.get("y", 0) for n in band),
            min(n.get("x", 0) for n in band),
            min(n["id"] for n in band),
        )
    )
    return [
        n
        for band in bands
        for n in sorted(band, key=lambda n: (n.get("x", 0), n.get("y", 0), n["id"]))
    ]


def media_refs(canvas):
    result = []
    for node in canvas.get("nodes", []):
        result.extend(agent_inputs.node_media(node))
    for ref in result:
        ref["media_id"] = agent_inputs.media_id(ref)
    return result


def mention_html(prompt, refs):
    """Match declared labels longest-first, including adjacent Chinese text."""
    warnings = []
    pattern = (
        re.compile(
            "@("
            + "|".join(re.escape(k) + (r"(?!\d)" if k[-1:].isdigit() else "") for k in sorted(refs, key=len, reverse=True))
            + ")"
        )
        if refs
        else None
    )
    chunks, cursor = [], 0
    for match in pattern.finditer(prompt) if pattern else []:
        chunks.append(html.escape(prompt[cursor : match.start()]))
        ref = refs[match[1]]
        attrs = {
            "url": ref.get("url", ""),
            "kind": ref["kind"],
            # Prompt Authoring reads data-name as the authored alias, not as
            # the media filename. Keep both text and token bound to that alias.
            "name": match[1],
            "node-id": ref.get("nodeId", ""),
            "image-index": ref.get("imageIndex", 0),
            "output-id": ref.get("outputId", ""),
            "input-instance-id": ref.get("inputInstanceId", ""),
            "reference-mode": ref.get("referenceMode", ""),
        }
        attributes = " ".join(
            f'data-{key}="{html.escape(str(value), quote=True)}"'
            for key, value in attrs.items()
        )
        chunks.append(
            f'<span class="mention-image-token" contenteditable="false" {attributes}><span class="mention-token-label">{html.escape(match[1])}</span></span>'
        )
        cursor = match.end()
    chunks.append(html.escape(prompt[cursor:]))
    remaining = pattern.sub("", prompt) if pattern else prompt
    for value in re.findall(r"@[^\s@]+", remaining):
        warnings.append({"code": "undeclared_mention", "mention": value})
    return "".join(chunks).replace("\n", "<br>"), warnings


# Capability parameter names map to the existing Generation Settings contract.
IMAGE_PARAMS = {
    "aspect_ratio": "ratio",
    "resolution_tier": "resolution",
    "count": "count",
    "quality": "quality",
    "transparent_png": "transparentPng",
    "custom_size": "customSize",
}
VIDEO_PARAMS = {
    "duration_seconds": "videoDuration",
    "aspect_ratio": "videoAspect",
    "resolution": "videoResolution",
    "generate_audio": "videoGenerateAudio",
    "enhance_prompt": "videoEnhancePrompt",
    "enable_upsample": "videoEnableUpsample",
    "watermark": "videoWatermark",
    "camera_fixed": "videoCameraFixed",
    "reference_mode": "videoReferenceMode",
    "fps": "videoFps",
}
IMAGE_RATIOS = {
    "square": "1:1",
    "portrait": "2:3",
    "landscape": "3:2",
    "portrait43": "3:4",
    "landscape43": "4:3",
    "story": "9:16",
    "wide": "16:9",
    "ultrawide": "21:9",
    "ultratall": "9:21",
}


class AgentAPI:
    def __init__(
        self,
        *,
        auth,
        sync,
        catalog,
        resolve_model: Callable,
        list_models: Callable,
        media: Callable,
        assets: Callable,
        database: Callable,
        media_path: Callable,
        upload_extensions,
        max_upload_bytes,
        version="",
        image_runs=None,
        compile_image=None,
        image_prompt_maximum=20000,
    ):
        self.auth, self.sync, self.catalog = auth, sync, catalog
        self.resolve_model, self.models = resolve_model, list_models
        self.media, self.assets, self.database, self.media_path = (
            media,
            assets,
            database,
            media_path,
        )
        self.upload_extensions, self.max_upload_bytes, self.version = (
            upload_extensions,
            max_upload_bytes,
            version,
        )
        self.image_prompt_maximum = image_prompt_maximum
        self.image_runs, self.compile_image = image_runs, compile_image
        from .agent_image_runs import AgentImageRuns
        self.direct_images = AgentImageRuns(self)
        self.contexts = {}
        self.writes = defaultdict(deque)
        self._databases = set()

    @contextmanager
    def data(self):
        if self.sync._canvas_store is not None:
            with self.sync._canvas_store().agent_state() as state:
                state.setdefault("runs", {})
                state.setdefault("media", {})
                state.setdefault("receipts", {})
                yield state
            return
        # Legacy JSON Workspaces still keep non-Canvas intents in Workspace SQLite.
        import sqlite3

        path = Path(self.database())
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=5)
        try:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS store_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)"
            )
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT value FROM store_metadata WHERE key='agent_v1'"
            ).fetchone()
            state = (
                json.loads(row[0]) if row else {"runs": {}, "media": {}, "receipts": {}}
            )
            yield state
            connection.execute(
                "INSERT OR REPLACE INTO store_metadata VALUES ('agent_v1',?)",
                (json.dumps(state),),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def rate_limit(self, actor):
        queue, now = self.writes[actor["id"]], time.monotonic()
        while queue and queue[0] < now - 60:
            queue.popleft()
        if len(queue) >= 30:
            raise AgentError(
                "rate_limited", {"retry_after": math.ceil(60 - (now - queue[0]))}, 429
            )
        queue.append(now)

    def operation(self, request, body):
        key = request.headers.get("idempotency-key") or body.get("idempotency_key")
        if not isinstance(key, str) or not 1 <= len(key) <= 160:
            raise AgentError("idempotency_key_required")
        operation_id = "agent:" + digest([request.state.agent_token["id"], key])
        if body.get("dry_run") is not True:
            signature = digest([request.method, request.url.path, body])
            with self.data() as state:
                operations = state.setdefault("operations", {})
                if operation_id in operations and operations[operation_id] != signature:
                    raise AgentError("operation_collision", status=409)
                operations[operation_id] = signature
        return operation_id

    @staticmethod
    async def body(request):
        try:
            body = await request.json()
        except ValueError:
            raise AgentError("invalid_json") from None
        if not isinstance(body, dict):
            raise AgentError("invalid_request")
        return body

    def canvases(self, actor):
        return [
            item
            for item in self.sync.list_documents(
                actor, deleted=False, trash_retention_ms=0
            )
            if item.get("kind", "smart") == "smart"
        ]

    def context(self, actor, canvas_id=""):
        now = time.monotonic()
        self.contexts = {k: v for k, v in self.contexts.items() if now - v["seen"] < 60}
        items = [
            v
            for v in self.contexts.values()
            if v["user_id"] == actor["id"]
            and (not canvas_id or v["canvas_id"] == canvas_id)
        ]
        return sorted(items, key=lambda v: v["focused"], reverse=True)

    def target(self, actor):
        canvases = self.canvases(actor)
        allowed = {c["id"]: c for c in canvases}
        contexts = [
            c
            for c in self.context(actor)
            if c["canvas_id"] in allowed and c["focused"] > 0
        ]
        if contexts:
            latest = contexts[0]
            if not any(
                c["canvas_id"] != latest["canvas_id"]
                and latest["focused"] - c["focused"] <= 10
                for c in contexts[1:]
            ):
                return {"canvas": self.identity(allowed[latest["canvas_id"]])}
        ids = {c["canvas_id"] for c in contexts}
        recent = sorted(canvases, key=lambda c: c.get("updated_at", 0), reverse=True)[
            :5
        ]
        ids.update(c["id"] for c in recent)
        raise AgentError(
            "canvas_ambiguous",
            {"candidates": [self.identity(c) for c in canvases if c["id"] in ids]},
            409,
        )

    @staticmethod
    def identity(canvas):
        return {"id": canvas["id"], "name": canvas.get("title", "")}

    def selection(self, actor, canvas):
        contexts = self.context(actor, canvas["id"])
        if not contexts:
            raise AgentError("no_editor_context", status=409)
        selected = contexts[0]["selection"]
        lookup = {item["node_id"]: item for item in selected}
        # Same stable row-major visual order used by the multi-input owner.
        nodes = visual_order([n for n in canvas.get("nodes", []) if n["id"] in lookup])
        return [
            {
                "node_id": n["id"],
                "name": n.get("title", ""),
                "indices": lookup[n["id"]].get("indices"),
                "geometry": node_geometry(n),
            }
            for n in nodes
        ]

    def library(self, actor, query=""):
        result = []
        cursor = ""
        while True:
            page = self.assets().list(actor, query=query, cursor=cursor, limit=60)
            result.extend(page["items"])
            cursor = page.get("next_cursor", "")
            if not cursor or query:
                return result

    def known_media(self, actor, canvas):
        refs = media_refs(canvas)
        # Persisted direct attachments and mention snapshots are authorized by
        # their owning Canvas, even when they have no standalone Image Node.
        for node in canvas.get("nodes", []):
            for field in ("manualInputRefs", "recipeSourceRefs", "runInputRefs", "runPromptRefs"):
                refs.extend(agent_inputs.display_media(r) for r in node.get(field, []) if r.get("url"))
            refs.extend(r for r in agent_inputs.MentionParser(node.get("promptDraftHtml", "")).tokens if r.get("url"))
        refs.extend(self.library(actor))
        with self.data() as state:
            refs.extend(state["media"].get(actor["id"], {}).values())
        return refs

    def resolve_refs(self, actor, canvas, refs, *, dry_run=False, current_node=None):
        if not isinstance(refs, dict) or len(refs) > 100:
            raise AgentError("invalid_refs")
        available = media_refs(canvas)
        resolved, errors, warnings = {}, [], []
        seen = set()
        for label, source in refs.items():
            if not re.fullmatch(r"[^@\r\n]{1,512}", label) or not label.strip() or not isinstance(source, dict):
                raise AgentError("invalid_reference_label")
            selectors = set(source) & {
                "node",
                "node_name",
                "selection",
                "asset",
                "media",
                "file",
                "search",
                "input",
            }
            if len(selectors) != 1 or set(source) - selectors - {
                "kind",
                "role",
                "index",
                "output_id",
            }:
                raise AgentError("invalid_reference_source", {"label": label})
            selector = next(iter(selectors))
            value = source[selector]
            candidates = []
            if selector == "node":
                candidates = [r for r in available if r["nodeId"] == value]
            elif selector == "input" and current_node:
                candidates = [r for r in agent_inputs.effective_inputs(canvas, current_node)[0]
                              if agent_inputs.ref_key(r) == value]
            elif selector == "node_name":
                candidates = [r for r in available if r["sourceNodeTitle"] == value]
            elif selector == "selection":
                selection = self.selection(actor, canvas)
                if type(value) is int and 1 <= value <= len(selection):
                    selected = selection[value - 1]
                    candidates = [
                        r
                        for r in available
                        if r["nodeId"] == selected["node_id"]
                        and (
                            selected["indices"] is None
                            or r["imageIndex"] in selected["indices"]
                        )
                    ]
            elif selector == "asset":
                entries = self.library(actor)
                candidates = [
                    r for r in entries if r.get("id") == value
                ] or self.library(actor, str(value))
            elif selector == "media":
                candidates = [
                    r
                    for r in self.known_media(actor, canvas)
                    if agent_inputs.media_id(r) == value
                ]
                unique = {}
                for r in candidates:
                    unique.setdefault(r.get("media_id") or r.get("url"), r)
                candidates = list(unique.values())
            elif selector == "file" and dry_run and isinstance(value, dict):
                name = value.get("name", "")
                if (
                    Path(name).name != name
                    or Path(name).suffix.lower() not in self.upload_extensions
                    or value.get("kind") not in ("image", "video", "audio")
                    or type(value.get("size")) is not int
                    or not 0 < value["size"] <= self.max_upload_bytes
                ):
                    raise AgentError("invalid_local_media_descriptor")
                candidates = [
                    {
                        "name": name,
                        "kind": value["kind"],
                        "url": "/dry-run/" + digest(value),
                        "media_id": digest(value),
                    }
                ]
            elif selector == "search":
                query = str(value).casefold()
                candidates = [
                    r for r in available if query in r["sourceNodeTitle"].casefold()
                ]
                if not candidates:
                    candidates = [
                        r for r in available if query in r.get("name", "").casefold()
                    ]
                if not candidates:
                    candidates = self.library(actor, query)
            if "index" in source:
                if type(source["index"]) is not int or source["index"] < 0:
                    raise AgentError("invalid_reference_index")
                candidates = [
                    r for r in candidates if r.get("imageIndex") == source["index"]
                ]
            if "output_id" in source:
                if "index" in source or selector != "node" or not isinstance(source["output_id"], str) or not source["output_id"]:
                    raise AgentError("invalid_reference_source", {"label": label})
                candidates = [r for r in candidates if r.get("outputId") == source["output_id"]]
            if len(candidates) != 1:
                errors.append(
                    {
                        "label": label,
                        "code": (
                            "ambiguous_reference" if candidates else "missing_reference"
                        ),
                        "candidates": candidates[:10],
                    }
                )
                continue
            ref = copy.deepcopy(candidates[0])
            if source.get("kind") and source["kind"] != ref.get("kind", "image"):
                errors.append({"label": label, "code": "reference_kind_mismatch"})
                continue
            if source.get("role") not in (None, "first_frame", "last_frame"):
                raise AgentError("invalid_reference_role")
            ref["role"] = source.get("role", "")
            ref.setdefault("kind", "image")
            key = agent_inputs.ref_key(ref)
            if key in seen:
                warnings.append({"code": "duplicate_reference", "label": label})
            seen.add(key)
            resolved[label] = ref
        return resolved, errors, warnings

    def capability(self, provider, model, operation):
        capability = copy.deepcopy(self.resolve_model(provider, model, operation))
        commands = capability.get("media_contract", {}).get("commands", {})
        if operation == "video.generate" and commands:
            modes = [
                mode
                for command, mode in [
                    ("image2video", "image_to_video"),
                    ("multimodal2video", "multimodal_all_around"),
                    ("frames2video", "first_last_frames"),
                ]
                if command in commands
            ]
            capability["parameters"]["reference_mode"] = {
                "type": "enum",
                "values": modes,
                "default": (
                    "multimodal_all_around"
                    if "multimodal_all_around" in modes
                    else modes[0] if modes else ""
                ),
            }
        capability["authoring"] = {
            "parameters": [
                key for key in (VIDEO_PARAMS if operation == "video.generate" else IMAGE_PARAMS)
                if key in capability.get("parameters", {})
            ],
            "prompt_maximum_characters": 100000,
        }
        return capability

    def current_task_refs(self, canvas, node):
        return agent_inputs.effective_inputs(canvas, node)[1]

    def available_media_path(self, url):
        try:
            path = self.media_path(url)
            return Path(path) if path and Path(path).is_file() else None
        except (OSError, ValueError, WorkspaceStorageError):
            return None

    @staticmethod
    def task_node(canvas, node_id):
        node = next((n for n in canvas["nodes"] if n["id"] == node_id), None)
        if node is None:
            raise AgentError("node_not_found", {"node_id": node_id}, 404)
        if not node.get("referenceGenerationKind"):
            raise AgentError("not_generation_task", {"node_id": node_id}, 422)
        return node

    def task_recipe(self, canvas, node):
        kind = node["referenceGenerationKind"]
        if node.get("generationOutputNode") is True:
            outputs = [item for item in node.get("images", []) if item.get("url")]
            result_kind = (outputs[0].get("kind") if outputs and all(
                item.get("kind") == outputs[0].get("kind") for item in outputs) else None)
            kind = next((value for value in (result_kind, node.get("outputKind"),
                node.get("generationInputSnapshot", {}).get("settings", {}).get("apiKind"), kind)
                if value in ("image", "video")), kind)
        current = node.get("runSettings", canvas.get("settings", {}))
        mapping = VIDEO_PARAMS if kind == "video" else IMAGE_PARAMS
        params = {k: copy.deepcopy(current[v]) for k, v in mapping.items()
                  if v in current and current[v] not in ("", None)}
        if kind == "video" and "generate_audio" in params and current.get("engine", "api") == "api":
            capability = self.capability(
                current.get("videoProvider"), current.get("videoModel"), "video.generate"
            )
            if "generate_audio" not in capability.get("parameters", {}):
                # Old UI drafts persisted this flag even when the adapter had no
                # audio control. Keep runSettings intact; expose only writable input.
                params.pop("generate_audio")
        if kind == "image":
            if "aspect_ratio" in params:
                params["aspect_ratio"] = IMAGE_RATIOS.get(params["aspect_ratio"], params["aspect_ratio"])
            if "resolution_tier" in params:
                params["resolution_tier"] = str(params["resolution_tier"]).upper()
            if current.get("pixelWidth") and current.get("pixelHeight"):
                params["custom_size"] = f"{current['pixelWidth']}x{current['pixelHeight']}"
                params.pop("aspect_ratio", None)
                params.pop("resolution_tier", None)
        bindings = self.current_task_refs(canvas, node)
        return {"kind": kind, "title": node.get("title", ""),
                "prompt": agent_inputs.draft_prompt(node),
                "model": {"provider_id": current.get("videoProvider" if kind == "video" else "provider_id"),
                          "model": current.get("videoModel" if kind == "video" else "model")},
                "params": params,
                "refs": {label: agent_inputs.reference_source(ref) for label, ref in bindings.items()}}

    def task_detail(self, actor, canvas, node_id, *, validate=True):
        node = self.task_node(canvas, node_id)
        frame = next((n for n in canvas["nodes"] if n.get("type") == "smart-frame"
                      and node_id in n.get("items", [])), None)
        refs, _, errors, warnings = agent_inputs.effective_inputs(canvas, node)
        editable = task_state(node) == "draft"
        settings = node.get("runSettings", canvas.get("settings", {}))
        reason = None if editable else "node_not_editable"
        if settings.get("engine", "api") != "api":
            editable, reason = False, "engine_not_authorable"
        if validate and editable:
            try:
                _, report = self.compile(actor, {"id": "validation"}, canvas,
                    {"tasks": [{}], "dry_run": True, "strict_update": True},
                    "agent:validation", node_id)
                warnings.extend(report["warnings"])
            except AgentError as error:
                errors.extend(error.details.get("errors") or error.details.get("references")
                              or [{"code": error.code, **error.details}])
        if not editable:
            errors.append({"code": reason, "field": "state"})
        return {"canvas_id": canvas["id"], "node_id": node_id,
                "frame_id": frame["id"] if frame else None,
                "geometry": node_geometry(node),
                "frame_geometry": node_geometry(frame) if frame else None,
                "state": task_state(node), "editable": editable, "edit_block_reason": reason,
                "node_revision": agent_inputs.revision(canvas, node),
                "canvas_revision": canvas.get("revision", 0),
                "recipe": self.task_recipe(canvas, node),
                "run_settings": copy.deepcopy(settings),
                "text_inputs": agent_inputs.text_inputs(canvas, node),
                "resolved_inputs": [{"reference_id": r["reference_id"], "labels": r["labels"],
                    "binding_label": r["binding_label"], "display_number": r["display_number"],
                    "position": r["position"], "kind": r["kind"], "name": r.get("name", ""),
                    "node_id": r.get("nodeId"), "media_index": r.get("imageIndex"),
                    "output_id": r.get("outputId"), "input_instance_id": r.get("inputInstanceId"),
                    "media_id": r["media_id"], "preview_source": {"media_id": r["media_id"]},
                    "origin": r["origin"], "source_path": r.get("source_path", []),
                    "role": r.get("role", "")} for r in refs],
                "validation": {"valid": not errors, "errors": errors, "warnings": warnings}}

    def preview(self, actor, canvas, source, max_edge):
        from PIL import Image, ImageOps, UnidentifiedImageError

        if not isinstance(source, dict) or type(max_edge) is not int or not 64 <= max_edge <= 4096:
            raise AgentError("invalid_preview_request", {"max_edge": {"minimum": 64, "maximum": 4096}})
        selectors = set(source) & {"node_id", "media_id", "asset_id"}
        if len(selectors) != 1 or set(source) - selectors - {"media_index", "output_id"}:
            raise AgentError("invalid_media_source")
        selector = next(iter(selectors))
        if not isinstance(source[selector], str) or not source[selector]:
            raise AgentError("invalid_media_source")
        if selector != "node_id" and set(source) != {selector}:
            raise AgentError("invalid_media_source")
        if selector == "node_id":
            candidates = [r for r in media_refs(canvas) if r["nodeId"] == source[selector]]
            if "media_index" in source and "output_id" in source:
                raise AgentError("invalid_media_source")
            if "media_index" in source:
                if type(source["media_index"]) is not int or source["media_index"] < 0:
                    raise AgentError("invalid_media_source")
                candidates = [r for r in candidates if r["imageIndex"] == source["media_index"]]
            if "output_id" in source:
                if not isinstance(source["output_id"], str) or not source["output_id"]:
                    raise AgentError("invalid_media_source")
                candidates = [r for r in candidates if r.get("outputId") == source["output_id"]]
        elif selector == "asset_id":
            candidates = [agent_inputs.display_media(r) for r in self.library(actor) if r.get("id") == source[selector]]
        else:
            candidates = [agent_inputs.display_media(r) for r in self.known_media(actor, canvas)
                          if agent_inputs.media_id(r) == source[selector]]
            candidates = list({r["url"]: r for r in candidates}.values())
        if not candidates:
            raise AgentError("reference_not_found", {"field": "source"}, 404)
        if len(candidates) != 1:
            raise AgentError("ambiguous_reference", {"candidates": [
                {"node_id": r.get("nodeId"), "media_index": r.get("imageIndex"), "output_id": r.get("outputId"),
                 "media_id": agent_inputs.media_id(r), "name": r.get("name", "")} for r in candidates]}, 409)
        ref = candidates[0]
        if ref.get("kind", "image") != "image":
            raise AgentError("preview_type_unsupported", {"kind": ref.get("kind")}, 422)
        path = self.available_media_path(ref["url"])
        if not path:
            raise AgentError("media_unavailable", status=404)
        if Path(path).stat().st_size > 32 * 1024 * 1024:
            raise AgentError("preview_size_limit", status=413)
        try:
            content = Path(path).read_bytes()
            with Image.open(io.BytesIO(content)) as original:
                if original.width * original.height > 40_000_000:
                    raise AgentError("preview_size_limit", status=413)
                picture = ImageOps.exif_transpose(original)
                original_size = list(picture.size)
                alpha = "A" in picture.getbands() or "transparency" in picture.info
                picture = picture.convert("RGBA" if alpha else "RGB")
                picture.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                picture.save(buffer, format="PNG")
                pixels = buffer.getvalue()
                if len(pixels) > 12 * 1024 * 1024:
                    raise AgentError("preview_size_limit", {"hint": "Retry with a smaller max_edge."}, 413)
                return {"metadata": {"media_id": agent_inputs.media_id(ref), "node_id": ref.get("nodeId"),
                    "output_id": ref.get("outputId"), "media_index": ref.get("imageIndex"),
                    "kind": "image", "name": ref.get("name", ""), "original_size": original_size,
                    "preview_size": list(picture.size), "thumbnail": list(picture.size) != original_size,
                    "has_alpha": alpha, "content_sha256": hashlib.sha256(content).hexdigest()},
                    "image": {"mimeType": "image/png", "data": base64.b64encode(pixels).decode("ascii")}}
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
            if isinstance(error, AgentError):
                raise
            raise AgentError("preview_decode_failed", status=422) from error

    def compile(self, actor, token, canvas, body, operation_id, update_id=""):
        strict_update = bool(update_id and body.get("strict_update"))
        recipes = body.get("tasks")
        reports = []
        prompts_only = body.get("type") == "prompts"
        if not isinstance(recipes, list) or not 1 <= len(recipes) <= 50:
            raise AgentError("invalid_task_count", {"minimum": 1, "maximum": 50})
        imported, created, connections, warnings, errors, unresolved = (
            {},
            [],
            [],
            [],
            [],
            [],
        )
        if update_id:
            original = self.task_node(canvas, update_id)
            if (
                not original
                or task_state(original) != "draft"
                or not original.get("referenceGenerationKind")
            ):
                raise AgentError("node_not_editable" if strict_update else "task_not_draft", status=409)
            patch = recipes[0]
            previous = self.task_recipe(canvas, original)
            if body.get("expected_node_revision") is not None:
                actual = agent_inputs.revision(canvas, original)
                if body["expected_node_revision"] != actual:
                    raise AgentError("revision_conflict", {"field": "expected_node_revision",
                        "current_node_revision": actual, "canvas_revision": canvas.get("revision", 0)}, 409)
            if strict_update and original.get("runSettings", {}).get("engine", "api") != "api":
                raise AgentError("engine_not_authorable", status=422)
            recipes = [{**previous, **patch}]
            if "params" in patch:
                recipes[0]["params"] = {**previous["params"], **patch["params"]}

        for i, recipe in enumerate(recipes):
            if not isinstance(recipe, dict) or set(recipe) - {
                "title",
                "kind",
                "model",
                "params",
                "refs",
                "prompt",
            }:
                raise AgentError("invalid_recipe", {"task": i + 1})
            if "title" in recipe and (
                not isinstance(recipe["title"], str) or len(recipe["title"]) > 120
            ):
                raise AgentError("invalid_title", {"task": i + 1, "maximum": 120})
            prompt = recipe.get("prompt", "")
            if not isinstance(prompt, str):
                raise AgentError("invalid_prompt", {"task": i + 1, "maximum": 100000})
            if len(prompt) > 100000:
                errors.append(
                    {
                        "task": i + 1,
                        "field": "prompt",
                        "code": "prompt_length",
                        "actual": len(prompt),
                        "maximum": 100000,
                    }
                )
                continue
            if update_id and "refs" not in patch:
                refs, missing, notices = (
                    self.current_task_refs(canvas, original),
                    [],
                    [],
                )
                if strict_update:
                    _, _, input_errors, input_warnings = agent_inputs.effective_inputs(canvas, original)
                    errors.extend(input_errors)
                    warnings.extend(input_warnings)
            else:
                refs, missing, notices = self.resolve_refs(
                    actor,
                    canvas,
                    recipe.get("refs", {}),
                    dry_run=body.get("dry_run") is True,
                    current_node=original if update_id else None,
                )
            unresolved.extend({"task": i + 1, **e} for e in missing)
            warnings.extend({"task": i + 1, **e} for e in notices)
            if strict_update:
                errors.extend(agent_inputs.unresolved_mentions(prompt, refs))
                errors.extend({"code": "unresolved_reference", "field": "text_inputs", "reference_id": ref["reference_id"]}
                              for ref in agent_inputs.text_inputs(canvas, original) if ref.get("error"))
                for mention in agent_inputs.MentionParser(original.get("promptDraftHtml", "")).tokens:
                    label = mention.get("name")
                    if label and "@" + label in prompt and label not in refs:
                        errors.append({"code": "unresolved_reference", "field": "prompt", "label": label})
                for label, ref in refs.items():
                    if not self.available_media_path(ref["url"]):
                        errors.append({"code": "reference_not_found", "field": "refs", "label": label})
            settings = copy.deepcopy(original.get("runSettings", canvas.get("settings", {}))
                                     if update_id else canvas.get("settings") or {})
            kind = recipe.get("kind", "image")
            if not prompts_only:
                if kind not in ("image", "video"):
                    raise AgentError("invalid_kind")
                model = recipe.get("model") or {
                    "provider_id": settings.get(
                        "videoProvider" if kind == "video" else "provider_id"
                    ),
                    "model": settings.get("videoModel" if kind == "video" else "model"),
                }
                if (
                    not isinstance(model, dict)
                    or not model.get("provider_id")
                    or not model.get("model")
                ):
                    errors.append(
                        {"task": i + 1, "field": "model", "code": "model_required"}
                    )
                    continue
                identity = self.catalog.canonical_model_id(model["provider_id"], model["model"], kind)
                if not any(
                    m.get("provider_id") == model["provider_id"]
                    and self.catalog.canonical_model_id(m.get("provider_id"), m.get("model"), kind) == identity
                    and m.get("kind") == kind
                    for m in self.models()
                ):
                    errors.append(
                        {"task": i + 1, "field": "model", "code": "model_unavailable"}
                    )
                    continue
                if not update_id or "model" in patch:
                    model = {**model, "model": identity}
                operation = (
                    "video.generate"
                    if kind == "video"
                    else "image.edit" if refs else "image.generate"
                )
                capability = self.capability(
                    model["provider_id"], model["model"], operation
                )
                if strict_update and capability.get("support_state") != "supported":
                    errors.append({"code": "capability_unknown", "field": "model", "operation": operation})
                params = recipe.get("params", {})
                if not isinstance(params, dict):
                    raise AgentError("invalid_params")
                counts = {k: 0 for k in ("image", "video", "audio", "text")}
                counts["text"] = int(bool(prompt) or bool(update_id and agent_inputs.text_inputs(canvas, original)))
                unique = {
                    (
                        agent_inputs.ref_key(r)
                    ): r
                    for r in refs.values()
                }
                roles = defaultdict(list)
                for ref in unique.values():
                    counts[ref["kind"]] = counts.get(ref["kind"], 0) + 1
                    roles[ref["kind"]].append(ref.get("role", ""))
                mapping = VIDEO_PARAMS if kind == "video" else IMAGE_PARAMS
                defaults = {
                    key: settings[field]
                    for key, field in mapping.items()
                    if key in capability.get("parameters", {})
                    and field in settings
                    and settings[field] not in ("", None)
                }
                if kind == "image":
                    if "aspect_ratio" in defaults:
                        defaults["aspect_ratio"] = IMAGE_RATIOS.get(
                            defaults["aspect_ratio"], defaults["aspect_ratio"]
                        )
                    if "resolution_tier" in defaults:
                        defaults["resolution_tier"] = str(
                            defaults["resolution_tier"]
                        ).upper()
                    if settings.get("pixelWidth") and settings.get("pixelHeight"):
                        defaults["custom_size"] = (
                            f"{settings['pixelWidth']}x{settings['pixelHeight']}"
                        )
                defaults.update(
                    {
                        key: value["default"]
                        for key, value in capability.get("parameters", {}).items()
                        if "default" in value and key not in defaults
                    }
                )
                params = {**defaults, **params}
                if "custom_size" in params:
                    for key in ("aspect_ratio", "resolution_tier"):
                        if key not in recipe.get("params", {}):
                            params.pop(key, None)

                if any(
                    r.get("role") for r in unique.values()
                ) and "reference_mode" not in recipe.get("params", {}):
                    params["reference_mode"] = "first_last_frames"
                mode = params.get("reference_mode", "multimodal_all_around")
                if kind == "video" and mode == "first_last_frames":
                    image_refs = [r for r in unique.values() if r["kind"] == "image"]
                    if (
                        counts.get("audio")
                        or counts.get("video")
                        or not 1 <= len(image_refs) <= 2
                        or [r.get("role") for r in image_refs]
                        != ["first_frame", "last_frame"][: len(image_refs)]
                    ):
                        errors.append(
                            {
                                "task": i + 1,
                                "field": "refs",
                                "code": "input_role",
                                "allowed": ["first_frame", "last_frame"],
                            }
                        )
                if (
                    kind == "video"
                    and mode != "first_last_frames"
                    and any(r.get("role") for r in unique.values())
                ):
                    errors.append(
                        {"task": i + 1, "field": "refs", "code": "input_role"}
                    )
                commands = capability.get("media_contract", {}).get("commands", {})
                command = (
                    "frames2video"
                    if mode == "first_last_frames"
                    else (
                        "multimodal2video"
                        if mode == "multimodal_all_around"
                        else "image2video" if counts.get("image") else "text2video"
                    )
                )
                contract = commands.get(command, {})
                if commands and command not in commands:
                    errors.append(
                        {
                            "task": i + 1,
                            "field": "reference_mode",
                            "code": "mode_unsupported",
                        }
                    )
                if contract.get("image_count"):
                    limits = contract["image_count"]
                    if counts["image"] < limits.get("minimum", 0) or counts[
                        "image"
                    ] > limits.get("maximum", 100):
                        errors.append(
                            {
                                "task": i + 1,
                                "field": "image",
                                "code": "input_count",
                                **limits,
                                "actual": counts["image"],
                            }
                        )
                for field, contract_key in [
                    ("aspect_ratio", "aspect_ratios"),
                    ("resolution", "video_resolutions"),
                ]:
                    allowed = contract.get(contract_key)
                    if (
                        allowed
                        and params.get(field) is not None
                        and params[field] not in allowed
                    ):
                        errors.append(
                            {
                                "task": i + 1,
                                "field": field,
                                "code": "parameter_value",
                                "actual": params[field],
                                "allowed": allowed,
                            }
                        )
                duration = contract.get("duration_seconds", {})
                actual = params.get("duration_seconds")
                if isinstance(actual, (int, float)) and any(
                    duration.get(bound) is not None
                    and (
                        actual < duration[bound]
                        if bound == "minimum"
                        else actual > duration[bound]
                    )
                    for bound in ("minimum", "maximum")
                ):
                    errors.append(
                        {
                            "task": i + 1,
                            "field": "duration_seconds",
                            "code": "parameter_range",
                            "actual": actual,
                            **duration,
                        }
                    )
                validation = self.catalog.validate(
                    capability,
                    input_counts=counts,
                    input_roles=roles,
                    parameters=params,
                    catalog_revision=capability["catalog_revision"],
                )
                errors.extend({"task": i + 1, **e} for e in validation["errors"])
                settings.update({"engine": "api", "apiKind": kind})
                settings.update(
                    {
                        "videoProvider": model["provider_id"],
                        "videoModel": model["model"],
                    }
                    if kind == "video"
                    else model
                )
                mapping = VIDEO_PARAMS if kind == "video" else IMAGE_PARAMS
                # Freeze catalog defaults too; omitted settings must not inherit unrelated model values.
                values = {
                    k: v["default"]
                    for k, v in capability.get("parameters", {}).items()
                    if "default" in v
                }
                values.update(params)
                for key, value in values.items():
                    if key in mapping:
                        settings[mapping[key]] = value
                    elif key in recipe.get("params", {}) and key != "custom_resolution":
                        errors.append(
                            {
                                "task": i + 1,
                                "field": key,
                                "code": "parameter_not_authorable",
                            }
                        )
                if kind == "video":
                    mode = settings.get("videoReferenceMode", "multimodal_all_around")
                    settings.update(
                        videoUseFrameRoles=mode == "first_last_frames",
                        videoMultimodal=mode == "multimodal_all_around",
                        _videoMultimodalUserSet=True,
                    )
                if kind == "image" and params.get("custom_size"):
                    if re.fullmatch(
                        r"[0-9]{1,5}x[0-9]{1,5}", str(params["custom_size"])
                    ):
                        settings["pixelWidth"], settings["pixelHeight"] = map(
                            int, params["custom_size"].split("x")
                        )
                elif kind == "image":
                    settings["pixelWidth"] = settings["pixelHeight"] = ""
                settings["catalog_revision"] = capability["catalog_revision"]
                if update_id:
                    preserved = copy.deepcopy(original.get("runSettings", canvas.get("settings", {})))
                    requested_params = patch.get("params", {})
                    setting_fields = {mapping[key] for key in requested_params if key in mapping}
                    if "custom_size" in requested_params or (kind == "image" and set(requested_params) & {"aspect_ratio", "resolution_tier"}):
                        setting_fields.update(("pixelWidth", "pixelHeight"))
                    if "reference_mode" in requested_params:
                        setting_fields.update(("videoUseFrameRoles", "videoMultimodal", "_videoMultimodalUserSet"))
                    if set(patch) & {"model", "kind"}:
                        setting_fields.update(("engine", "apiKind"))
                        setting_fields.update(("videoProvider", "videoModel") if kind == "video" else ("provider_id", "model"))
                    if setting_fields:
                        setting_fields.add("catalog_revision")
                    preserved.update({key: settings[key] for key in setting_fields if key in settings})
                    settings = preserved
            node_id = update_id or f"{operation_id}:task:{i}"
            manual, order, roles_map = [], [], {}
            source_items = defaultdict(set)
            for ref in refs.values():
                if ref.get("nodeId"):
                    source_items[ref["nodeId"]].add(ref.get("imageIndex"))
            for ref in refs.values():
                if update_id and "refs" not in patch:
                    continue
                if not ref.get("nodeId") and not ref.get("inputInstanceId"):
                    media_key = ref.get("media_id") or ref["url"]
                    if media_key not in imported:
                        source_id = f"{operation_id}:media:{len(imported)}"
                        imported[media_key] = {
                            "id": source_id,
                            "type": "smart-image",
                            "title": ref.get("name", ""),
                            "images": [
                                {
                                    k: v
                                    for k, v in ref.items()
                                    if k
                                    not in (
                                        "nodeId",
                                        "imageIndex",
                                        "role",
                                        "inputInstanceId",
                                        "outputId",
                                    )
                                }
                            ],
                            "w": 280,
                            "h": 220,
                        }
                    ref.pop("inputInstanceId", None)
                    ref.pop("outputId", None)
                    ref.update(nodeId=imported[media_key]["id"], imageIndex=0)
                source = next(
                    (n for n in canvas.get("nodes", []) if n["id"] == ref.get("nodeId")),
                    None,
                )
                snapshot = bool(ref.get("inputInstanceId") or source and source.get("type") == "smart-group" or (
                    source
                    and len(source.get("images", [])) > 1
                    and (len(source_items[ref["nodeId"]]) > 1
                         or not (source.get("generationOutputNode") and ref.get("outputId")))
                ))
                if snapshot:
                    ref["referenceMode"] = "snapshot"
                    ref["inputInstanceId"] = ref.get("inputInstanceId") or (
                        "agent-ref:"
                        + digest([node_id, ref.get("nodeId"), ref.get("imageIndex")])[:24]
                    )
                    if not any(
                        m["inputInstanceId"] == ref["inputInstanceId"] for m in manual
                    ):
                        manual.append(copy.deepcopy(ref))
                    warnings.append(
                        {
                            "task": i + 1,
                            "code": "snapshot_reference",
                            "node_id": ref.get("nodeId"),
                            "index": ref.get("imageIndex"),
                        }
                    )
                else:
                    # Live connection identity must match the mention's node/index identity.
                    ref["referenceMode"] = "connection"
                    edge = {"from": ref["nodeId"], "to": node_id, "kind": "input"}
                    if (
                        source
                        and source.get("generationOutputNode")
                        and ref.get("outputId")
                    ):
                        edge["sourceOutputId"] = ref["outputId"]
                    if edge not in connections:
                        connections.append(edge)
                key = (
                    "instance|" + ref["inputInstanceId"]
                    if ref.get("inputInstanceId")
                    else (
                        "output|" + ref["outputId"]
                        if ref.get("outputId")
                        else f"{ref['nodeId']}|{ref['imageIndex']}"
                    )
                )
                if key not in order:
                    order.append(key)
                if ref.get("role"):
                    roles_map[key] = ref["role"]
            markup, notices = mention_html(prompt, refs)
            reports.append(
                {
                    "task": i + 1,
                    "kind": "prompt" if prompts_only else kind,
                    "references": [
                        {
                            "label": label,
                            "kind": ref["kind"],
                            "node_id": ref.get("nodeId"),
                            "index": ref.get("imageIndex"),
                            "media_id": ref.get("media_id"),
                            "role": ref.get("role", ""),
                            "mode": ref.get("referenceMode", "snapshot"),
                        }
                        for label, ref in refs.items()
                    ],
                }
            )
            warnings.extend({"task": i + 1, **e} for e in notices)
            node = {
                "id": node_id,
                "type": "smart-prompt" if prompts_only else "smart-image",
                "title": recipe.get("title", ""),
                "w": 316 if prompts_only else 280,
                "h": 220,
                "images": [],
            }
            if prompts_only:
                node.update(text=prompt)
            else:
                if update_id and "refs" in patch:
                    order.extend(ref["reference_id"] for ref in agent_inputs.text_inputs(canvas, original)
                                 if ref["reference_id"] not in order)
                node.update(
                    referenceGenerationKind=kind,
                    runSettings=settings,
                    promptDraftHtml=markup,
                    promptDraftText=prompt,
                    promptDraftTouched=True,
                    manualInputRefs=manual,
                    inputRefOrder=order,
                    videoFrameRoles=roles_map,
                    agentRecipe=recipe,
                )
            created.append(node)
        if unresolved:
            raise AgentError(
                "needs_input", {"references": unresolved, "warnings": warnings}, 409
            )
        if errors:
            raise AgentError("rejected", {"errors": errors, "warnings": warnings}, 422)
        if len(imported) > 100:
            raise AgentError("media_node_limit")
        frame_id = f"{operation_id}:frame"
        frame, layout = self.layout(
            actor,
            canvas,
            list(imported.values()),
            [] if update_id else created,
            frame_id,
            body.get("title", ""),
            reference_ids={ref["node_id"] for report in reports
                           for ref in report["references"] if ref.get("node_id")},
        )
        if update_id:
            changes = {
                "node_updates": [
                    {"id": update_id, "path": [k], "value": v}
                    for k, v in created[0].items()
                    if k not in {"id", "type", "w", "h", "images", "title"}
                    or k == "title"
                    and "title" in recipes[0]
                ],
                "connection_removes": [
                    e
                    for e in canvas.get("connections", [])
                    if e["to"] == update_id and e.get("kind") == "input"
                    and e["from"] not in {ref.get("node_id") for ref in agent_inputs.text_inputs(canvas, original)}
                ],
                "connection_adds": connections,
            }
            if imported:
                changes["node_creates"] = [self.creation(n) for n in [frame, *layout]]
        else:
            changes = {
                "node_creates": [self.creation(n) for n in [frame, *layout]],
                "connection_adds": connections,
            }
        if update_id:
            changed = set(body["tasks"][0])
            fields = {"agentRecipe"}
            if changed & {"model", "params", "kind"}:
                fields.add("runSettings")
            if "prompt" in changed:
                fields.update(
                    ("promptDraftHtml", "promptDraftText", "promptDraftTouched")
                )
            if "refs" in changed:
                fields.update(
                    (
                        "manualInputRefs",
                        "inputRefOrder",
                        "videoFrameRoles",
                        "promptDraftHtml",
                        "promptDraftText",
                        "recipeSourceRefs",
                        "blockedInputRefs",
                        "inputNodeIds",
                    )
                )
                # Historical references become a fallback when there are no
                # live connections. Keep history but block obsolete inputs.
                old_refs = [r for key in ("recipeSourceRefs", "runInputRefs", "runPromptRefs", "manualInputRefs")
                            for r in original.get(key, [])]
                old_refs.extend(agent_inputs.node_media(original))
                old_refs.extend(agent_inputs.effective_inputs(canvas, original)[0])
                blocked = sorted({agent_inputs.ref_key(r) for r in old_refs if agent_inputs.ref_key(r)}
                                 - set(created[0]["inputRefOrder"]))
                text_nodes = {ref.get("node_id") for ref in agent_inputs.text_inputs(canvas, original)}
                changes["node_updates"].extend(
                    {"id": update_id, "path": [key], "value": value}
                    for key, value in (("recipeSourceRefs", []), ("blockedInputRefs", blocked),
                                       ("inputNodeIds", [key for key in original.get("inputNodeIds", []) if key in text_nodes])))
            if "title" in changed:
                fields.add("title")
            if "kind" in changed:
                fields.add("referenceGenerationKind")
            changes["node_updates"] = [
                entry for entry in changes["node_updates"] if entry["path"][0] in fields
            ]
            if "refs" not in changed:
                changes.pop("connection_removes", None)
                changes.pop("connection_adds", None)
                changes.pop("node_creates", None)
                if strict_update and any(r.get("url") and not r.get("inputInstanceId")
                                                       for r in original.get("manualInputRefs", [])):
                    normalized = copy.deepcopy(original.get("manualInputRefs", []))
                    for index, ref in enumerate(normalized):
                        if ref.get("url") and ref.get("kind") != "text" and not ref.get("inputInstanceId"):
                            ref["inputInstanceId"] = "legacy-manual:" + agent_inputs.fingerprint([original["id"], index, ref])[:24]
                    changes["node_updates"].append({"id": update_id, "path": ["manualInputRefs"], "value": normalized})
        result = {
            "status": "success",
            "submission_id": operation_id,
            "canvas": self.identity(canvas),
            "task_ids": [n["id"] for n in created],
            "frame_id": frame_id if not update_id or imported else None,
            "node_count": len(changes.get("node_creates", [])),
            "warnings": warnings,
            "frame_geometry": node_geometry(frame) if not update_id or imported else None,
            "task_geometries": {n["id"]: node_geometry(original if update_id else n)
                                for n in created},
        }
        if body.get("dry_run") is True:
            result["resolved_tasks"] = reports
        metadata = {
            "token_id": token["id"],
            "request_hash": digest(body),
            "result": result,
        }
        if update_id:
            changes["node_updates"].append(
                {"id": update_id, "path": ["agentSubmission"], "value": metadata}
            )
        else:
            changes["node_creates"][0]["node"]["agentSubmission"] = metadata
        return {
            "operation_id": operation_id,
            "base_revision": canvas.get("revision", 0),
            "changes": changes,
        }, result

    @staticmethod
    def creation(node):
        return {"node": node, "placement": {"mode": "exact", "gap": NODE_GAP}}

    def layout(self, actor, canvas, media, tasks, frame_id, title, *, reference_ids=()):
        columns = min(5, max(1, math.ceil(math.sqrt(len(tasks)))))
        task_width = max((node["w"] for node in tasks), default=280)
        task_stride = task_width + NODE_GAP
        row_stride = 220 + NODE_GAP
        width = NODE_GAP + task_stride * columns + (280 + NODE_GAP if media else 0)
        height = NODE_GAP * 2 + row_stride * max(
            len(media), math.ceil(len(tasks) / columns), 1
        )
        contexts = self.context(actor, canvas["id"])
        viewport = contexts[0]["viewport"] if contexts else {}
        obstacles = [node_geometry(n) for n in canvas.get("nodes", [])]
        references = [node_geometry(n) for n in canvas.get("nodes", []) if n["id"] in reference_ids]
        if references:
            left, top = min(n["x"] for n in references), min(n["y"] for n in references)
            right = max(n["x"] + n["width"] for n in references)
            bottom = max(n["y"] + n["height"] for n in references)
            center_x, center_y = (left + right) / 2, (top + bottom) / 2
        else:
            # Editor Context already contains world coordinates after zoom.
            # With no online editor, origin is stable regardless of remote Nodes.
            center_x = viewport.get("x", 0) + viewport.get("width", 0) / 2
            center_y = viewport.get("y", 0) + viewport.get("height", 0) / 2
        x, y = self.nearby_position(center_x - width / 2, center_y - height / 2,
                                    width, height, obstacles)
        frame = {
            "id": frame_id,
            "type": "smart-frame",
            "title": "Agent" + (" · " + str(title)[:120] if title else ""),
            "x": x,
            "y": y,
            "w": width,
            "h": height,
            "items": [node["id"] for node in [*media, *tasks]],
        }
        for i, n in enumerate(media):
            n.update(x=x + NODE_GAP, y=y + NODE_GAP + i * row_stride)
        for i, n in enumerate(tasks):
            n.update(
                x=x
                + NODE_GAP
                + (280 + NODE_GAP if media else 0)
                + (i % columns) * task_stride,
                y=y + NODE_GAP + (i // columns) * row_stride,
            )
        return frame, [*media, *tasks]

    @staticmethod
    def nearby_position(origin_x, origin_y, width, height, obstacles):
        """Search obstacle boundaries in both axes, nearest displacement first.

        Each candidate keeps one coordinate and moves the other to a blocking
        edge. Coordinates therefore come from finite edge sets, and the stable
        priority is independent of Canvas array order. Only new Nodes move.
        """
        pending, seen = [], set()

        def offer(x, y):
            if (x, y) in seen:
                return
            seen.add((x, y))
            dx, dy = x - origin_x, y - origin_y
            # Equal distances prefer right, then down, for readable input flow.
            heapq.heappush(pending, (dx * dx + dy * dy, -dx, -dy, x, y))

        offer(origin_x, origin_y)
        while pending:
            _, _, _, x, y = heapq.heappop(pending)
            collisions = [n for n in obstacles
                          if x < n["x"] + n["width"] + NODE_GAP
                          and x + width + NODE_GAP > n["x"]
                          and y < n["y"] + n["height"] + NODE_GAP
                          and y + height + NODE_GAP > n["y"]]
            if not collisions:
                return x, y
            for n in collisions:
                offer(n["x"] + n["width"] + NODE_GAP, y)
                offer(n["x"] - width - NODE_GAP, y)
                offer(x, n["y"] + n["height"] + NODE_GAP)
                offer(x, n["y"] - height - NODE_GAP)
        raise AgentError("placement_failed", status=409)

    @staticmethod
    def receipt_metadata(receipt):
        changes = (receipt or {}).get("changes", {})
        for item in changes.get("node_creates", []):
            meta = item.get("node", item).get("agentSubmission")
            if meta:
                return meta
        return next(
            (
                v["value"]
                for v in changes.get("node_updates", [])
                if v["path"] == ["agentSubmission"]
            ),
            None,
        )

    async def submit(self, request, canvas_id, body, update_id=""):
        if "dry_run" in body and type(body["dry_run"]) is not bool:
            raise AgentError("invalid_dry_run")
        actor, token = request.state.user, request.state.agent_token
        operation_id = self.operation(request, body)
        self.rate_limit(actor)

        def prepare(canvas, receipt):
            if receipt:
                meta = self.receipt_metadata(receipt)
                if (
                    not meta
                    or meta["token_id"] != token["id"]
                    or meta["request_hash"] != digest(body)
                ):
                    raise AgentError("operation_collision", status=409)
                return None, {
                    **meta["result"],
                    "revision": receipt.get("revision"),
                    "duplicate": True,
                }
            operation, result = self.compile(actor, token, canvas, body, operation_id, update_id)
            if update_id and body.get("strict_update"):
                # Use the same deterministic mutation engine as persistence for
                # the proposal and frozen retry receipt, never an echo of changes.
                proposal = copy.deepcopy(canvas)
                try:
                    apply_operation(proposal, operation, actor["id"])
                except CanvasRealtimeError as error:
                    raise AgentError(error.code, status=409) from error
                after = self.task_detail(actor, proposal, update_id)
                if not after["validation"]["valid"]:
                    raise AgentError("rejected", after["validation"], 422)
                after["validation"]["warnings"].extend(result["warnings"])
                result.update(after=after, node_revision=after["node_revision"],
                    canvas_revision=after["canvas_revision"],
                    changed_fields=sorted(body["tasks"][0]),
                    persisted=not body.get("dry_run"), generation_started=False,
                    validation=after["validation"])
                # Metadata stores an immutable snapshot for retries after later
                # edits. Copy it so the response cannot acquire a reference cycle.
                for item in operation["changes"].get("node_updates", []):
                    if item["path"] == ["agentSubmission"]:
                        item["value"]["result"] = copy.deepcopy(result)
            return operation, result

        def readback(persisted, result):
            nodes = {n["id"]: n for n in persisted.get("nodes", [])}
            frame = nodes.get(result["frame_id"])
            result = {**result,
                      "frame_geometry": node_geometry(frame) if frame else None,
                      "task_geometries": {node_id: node_geometry(nodes[node_id])
                                          for node_id in result["task_ids"] if node_id in nodes}}
            if not update_id or not body.get("strict_update"):
                return result
            after = self.task_detail(actor, persisted, update_id, validate=False)
            after["validation"] = copy.deepcopy(result["after"]["validation"])
            return {**result, "after": after, "node_revision": after["node_revision"],
                    "canvas_revision": after["canvas_revision"], "validation": after["validation"]}

        try:
            result = await self.sync.commit_prepared_operation(
                canvas_id,
                actor,
                operation_id,
                prepare,
                dry_run=body.get("dry_run") is True,
                readback=readback,
            )
        except CanvasSyncError as error:
            code = (
                error.detail.get("code", "conflict")
                if isinstance(error.detail, dict)
                else "conflict"
            )
            raise AgentError(code, status=error.status_code) from error
        if body.get("dry_run"):
            return {**result, "status": "dry_run"}
        if not result.get("duplicate"):
            await self.notice(
                actor,
                canvas_id,
                {
                    "type": "agent_submission_notice",
                    **result,
                    "count": len(result["task_ids"]),
                },
            )
        return result

    async def notice(self, actor, canvas_id, message):
        for context in self.context(actor, canvas_id):
            try:
                await self.sync._notifier.send_canvas_message(
                    context["socket"], message
                )
            except Exception:
                pass

    async def receive(self, session, actor, message):
        if not isinstance(message, dict):
            return False
        kind = message.get("type", "")
        if not isinstance(kind, str):
            return False
        if kind != "editor_context" and not kind.startswith("agent_run_"):
            return False
        self.sync._require_realtime_session_actor(session, actor)
        if kind == "editor_context":
            now = time.monotonic()
            previous = self.contexts.get(session.websocket, {})
            if now - previous.get("seen", 0) < 0.5:
                return True
            viewport = message.get("viewport", {})
            if not isinstance(viewport, dict) or any(
                type(v) not in (float, int) or not math.isfinite(v) or abs(v) > 1e9
                for v in viewport.values()
            ):
                return True
            selection = message.get("selection", [])
            if not isinstance(selection, list) or len(selection) > 200:
                return True
            if any(
                not isinstance(s, dict)
                or not isinstance(s.get("node_id"), str)
                or s.get("indices") is not None
                and (
                    not isinstance(s["indices"], list)
                    or len(s["indices"]) > 200
                    or any(type(i) is not int or i < 0 for i in s["indices"])
                )
                for s in selection
            ):
                return True
            self.contexts[session.websocket] = {
                "user_id": actor["id"],
                "canvas_id": session.canvas_id,
                "socket": session.websocket,
                "client_id": session.client_id,
                "seen": now,
                "focused": (
                    now
                    if message.get("focused") is True
                    else previous.get("focused", 0)
                ),
                "selection": selection,
                "viewport": viewport,
            }
            await self.send_runs(session, actor)
        else:
            await self.handle_run_message(session, actor, message)
        return True

    def disconnect(self, session):
        self.contexts.pop(session.websocket, None)

    @staticmethod
    def refresh_runs(state):
        now = time.time()
        for rid, row in list(state["runs"].items()):
            if (
                row["state"] in ("submitted", "failed", "cancelled", "expired")
                and row["created_at"] < now - 7 * 86400
            ):
                del state["runs"][rid]
            elif (
                row["state"] in ("queued", "claimed", "awaiting_confirmation")
                and row["created_at"] < now - 86400
            ):
                row["state"] = "expired"
            elif row["state"] == "claimed" and row["lease_until"] < now:
                row.update(state="queued", client_id="")

    def run_items(self, actor, canvas_id):
        with self.data() as state:
            self.refresh_runs(state)
            return [
                copy.deepcopy(r)
                for r in state["runs"].values()
                if r["user_id"] == actor["id"] and r["canvas_id"] == canvas_id
            ]

    async def send_runs(self, session, actor):
        enabled = self.auth.agent_settings()["enabled"]
        items = [
            r
            for r in self.run_items(actor, session.canvas_id)
            if enabled and r["state"] in ("queued", "awaiting_confirmation", "claimed")
        ]
        await self.sync._notifier.send_canvas_message(
            session.websocket, {"type": "agent_run_requests", "requests": items}
        )

    async def handle_run_message(self, session, actor, message):
        if not self.auth.agent_settings()["enabled"]:
            return
        request_id = message.get("id")
        canvas = self.sync.read(session.canvas_id, actor, write=True)
        with self.data() as state:
            self.refresh_runs(state)
            row = state["runs"].get(request_id)
            if (
                not row
                or row["user_id"] != actor["id"]
                or row["canvas_id"] != session.canvas_id
            ):
                return
            valid = any(
                t["id"] == row["token_id"]
                and t["revoked_at"] is None
                and (not t["expires_at"] or t["expires_at"] > time.time())
                and "run" in t["scopes"]
                for t in self.auth.list_agent_tokens(actor)
            )
            if not valid:
                row["state"] = "cancelled"
                return
            kind = message["type"]
            if kind == "agent_run_confirm" and row["state"] == "awaiting_confirmation":
                row["state"] = (
                    "queued" if message.get("accept") is True else "cancelled"
                )
            elif kind == "agent_run_cancel" and row["state"] in (
                "queued",
                "awaiting_confirmation",
            ):
                row["state"] = "cancelled"
            elif kind == "agent_run_claim" and row["state"] == "queued":
                node = next(
                    (n for n in canvas["nodes"] if n["id"] == row["node_id"]), None
                )
                if not node or task_state(node) != "draft":
                    row["state"] = "submitted" if node else "failed"
                else:
                    active = sum(
                        r["user_id"] == actor["id"] and r["state"] == "claimed"
                        for r in state["runs"].values()
                    )
                    if active < self.auth.agent_settings(actor["id"])["concurrency"]:
                        row.update(
                            state="claimed",
                            client_id=session.client_id,
                            lease_until=time.time() + 60,
                        )
            elif row["state"] == "claimed" and row["client_id"] == session.client_id:
                if kind == "agent_run_renew":
                    row["lease_until"] = time.time() + 60
                elif kind == "agent_run_report":
                    row.update(
                        state=(
                            "submitted"
                            if message.get("submitted") is True
                            else "failed"
                        ),
                        error=(
                            ""
                            if message.get("submitted") is True
                            else "editor_validation_failed"
                        ),
                    )
            response = {
                "type": "agent_run_claim",
                "id": request_id,
                "node_id": row["node_id"],
                "claimed": row["state"] == "claimed"
                and row["client_id"] == session.client_id,
                "state": row["state"],
            }
        await self.sync._notifier.send_canvas_message(session.websocket, response)

    def install(self, app):
        from .agent_pairing import AgentPairing
        self.pairing = AgentPairing(self.auth)
        self.pairing.install(app)
        from .agent_installer import install_routes
        install_routes(app)

        @app.exception_handler(RequestValidationError)
        async def invalid_request(request, error):
            if not request.url.path.startswith("/api/agent/v1/"):
                return await request_validation_exception_handler(request, error)
            return JSONResponse(
                status_code=422,
                content={
                    "code": "invalid_request",
                    "message": "invalid request",
                    "details": {
                        "errors": [
                            {"field": list(e["loc"]), "code": e["type"]}
                            for e in error.errors()
                        ]
                    },
                },
            )

        @app.exception_handler(AgentError)
        async def error_handler(request, error):
            message = str(error)
            if request.url.path.startswith("/api/agent/v1/image-runs"):
                message = self.direct_images.message(error.code, self.direct_images.language(request))
            return JSONResponse(
                status_code=error.status,
                content={"code": error.code, "message": message, "details": error.details},
            )

        def actor(request):
            return request.state.user

        @app.get("/api/account/agent-access")
        async def settings(request: Request):
            return {
                **self.auth.agent_settings(actor(request)["id"]),
                "tokens": self.auth.list_agent_tokens(actor(request)),
            }

        @app.patch("/api/account/agent-access")
        async def save_settings(request: Request):
            try:
                return self.auth.save_agent_settings(
                    actor(request), await self.body(request)
                )
            except (ValueError, PermissionError) as error:
                raise AgentError(
                    str(error),
                    status=403 if isinstance(error, PermissionError) else 400,
                )

        @app.post("/api/account/agent-tokens")
        async def create_token(request: Request):
            body = await self.body(request)
            try:
                return self.auth.create_agent_token(
                    actor(request),
                    body.get("name", ""),
                    body.get("scopes", ["authoring"]),
                    body.get("days", 0),
                )
            except (ValueError, PermissionError) as error:
                raise AgentError(
                    str(error),
                    status=403 if isinstance(error, PermissionError) else 400,
                )

        @app.delete("/api/account/agent-tokens/{token_id}")
        async def revoke_token(token_id: str, request: Request):
            try:
                self.auth.revoke_agent_token(actor(request), token_id)
            except PermissionError:
                raise AgentError("forbidden", status=403)
            return {"revoked": True}

        prefix = "/api/agent/v1"

        @app.get(prefix + "/info")
        async def info(request: Request):
            return {
                "api_version": "v1",
                "version": self.version,
                "account": actor(request),
                "scopes": request.state.agent_token["scopes"],
            }

        @app.get(prefix + "/canvases")
        async def list_canvases(request: Request):
            return {
                "canvases": [self.identity(c) for c in self.canvases(actor(request))]
            }

        @app.post(prefix + "/canvases")
        async def create_canvas(request: Request):
            body = await self.body(request)
            self.rate_limit(actor(request))
            operation_id = self.operation(request, body)
            # Deterministic Canvas ID also makes a lost creation response recoverable.
            canvas_id = operation_id.replace(":", "-")
            title = str(body.get("title", "Agent"))[:120]
            try:
                result = await self.sync.create_agent_canvas(
                    actor(request), canvas_id, title
                )
            except CanvasSyncError as error:
                raise AgentError(
                    "forbidden" if error.status_code == 403 else "conflict",
                    status=error.status_code,
                )
            return {"canvas": self.identity(result.canvas)}

        @app.get(prefix + "/context/target")
        async def get_target(request: Request):
            return self.target(actor(request))

        def read_canvas(request, canvas_id):
            try:
                return self.sync.read(canvas_id, actor(request), write=True)
            except CanvasSyncError:
                raise AgentError("forbidden", status=403)

        def reference_targets(request, body, canvas_id=None):
            if set(body) != {"reference"}:
                raise AgentError("invalid_node_reference")
            try:
                reference = parse_reference(body["reference"])
            except NodeReferenceError as error:
                raise AgentError(error.code, error.details) from None
            if reference["workspace_id"] != self.sync.workspace_identity():
                raise AgentError("workspace_mismatch", status=409)
            if canvas_id is not None and reference["canvas_id"] != canvas_id:
                raise AgentError("canvas_mismatch", status=409)
            # Read one authorized persisted snapshot. Do not reveal missing IDs
            # until access to this exact Canvas has succeeded.
            document = read_canvas(request, reference["canvas_id"])
            by_id = {node["id"]: node for node in document["nodes"]}
            missing = [node_id for node_id in reference["node_ids"] if node_id not in by_id]
            if missing:
                raise AgentError("node_not_found", {"node_ids": missing}, 404)
            return reference, document, by_id

        @app.post("/api/canvases/{canvas_id}/node-reference")
        async def confirm_node_reference(canvas_id: str, request: Request):
            reference, document, _ = reference_targets(request, await self.body(request), canvas_id)
            return {**reference, "canvas_revision": document.get("revision", 0)}

        @app.post(prefix + "/node-references/read")
        async def read_node_reference(request: Request):
            reference, document, by_id = reference_targets(request, await self.body(request))
            targets = []
            for node_id in reference["node_ids"]:
                node = by_id[node_id]
                detail = {"node_id": node_id, "type": node.get("type"),
                          "node_revision": agent_inputs.revision(document, node),
                          "content": copy.deepcopy(node)}
                if node.get("referenceGenerationKind"):
                    detail["generation_task"] = self.task_detail(actor(request), document, node_id)
                targets.append(detail)
            return {**reference, "canvas_revision": document.get("revision", 0), "nodes": targets}

        @app.get(prefix + "/canvases/{canvas_id}")
        async def get_canvas(
            canvas_id: str,
            request: Request,
            role: str = "",
            frame: str = "",
            query: str = "",
            selected: bool = False,
            offset: int = 0,
            limit: int = 200,
        ):
            canvas = read_canvas(request, canvas_id)
            membership = {
                item: node["id"]
                for node in canvas.get("nodes", [])
                if node.get("type") == "smart-frame"
                for item in node.get("items", [])
            }
            selected_ids = (
                {s["node_id"] for s in self.selection(actor(request), canvas)}
                if selected
                else set()
            )
            nodes = [
                n
                for n in canvas.get("nodes", [])
                if (not role or node_role(n) == role)
                and (not frame or membership.get(n["id"]) == frame)
                and (not query or query.casefold() in n.get("title", "").casefold())
                and (not selected or n["id"] in selected_ids)
            ]
            offset = max(0, offset)
            limit = max(1, min(limit, 200))
            return {
                "canvas": self.identity(canvas),
                "revision": canvas.get("revision", 0),
                "nodes": [
                    {
                        "id": n["id"],
                        "role": node_role(n),
                        "name": n.get("title", ""),
                        "media": [
                            {
                                "kind": m.get("kind", "image"),
                                "name": m.get("name", ""),
                                "index": i,
                            }
                            for i, m in enumerate(n.get("images", []))
                        ],
                        "prompt": str(n.get("promptDraftText", n.get("text", "")))[
                            :200
                        ],
                        "prompt_length": len(str(n.get("promptDraftText", n.get("text", "")))),
                        "prompt_truncated": len(str(n.get("promptDraftText", n.get("text", "")))) > 200,
                        "frame_id": membership.get(n["id"]),
                        "state": task_state(n),
                        "geometry": node_geometry(n),
                    }
                    for n in nodes[offset : offset + limit]
                ],
                "connections": canvas.get("connections", []),
                "next_offset": offset + limit if len(nodes) > offset + limit else None,
            }

        @app.get(prefix + "/canvases/{canvas_id}/selection")
        async def get_selection(canvas_id: str, request: Request):
            return {
                "selection": self.selection(
                    actor(request), read_canvas(request, canvas_id)
                )
            }

        @app.post(prefix + "/image-runs")
        async def submit_image_run(request: Request):
            self.rate_limit(actor(request))
            return await self.direct_images.submit(actor(request), request.state.agent_token, await self.body(request), self.direct_images.language(request))

        @app.get(prefix + "/image-runs/by-request")
        async def lookup_image_run(request_id: str, request: Request):
            run = await self.direct_images.lookup(actor(request), request.state.agent_token, request_id)
            return self.direct_images.public(run, self.direct_images.language(request))

        @app.get(prefix + "/image-runs/{run_id}")
        async def get_image_run(run_id: str, request: Request):
            return self.direct_images.public(await self.direct_images.query(actor(request), request.state.agent_token, run_id), self.direct_images.language(request))

        @app.get(prefix + "/image-runs/{run_id}/outputs/{index}")
        async def download_image_run(run_id: str, index: int, request: Request):
            return await self.direct_images.download(actor(request), request.state.agent_token, run_id, index)

        @app.get(prefix + "/models")
        async def models():
            return {"models": self.models(), "image_prompt_maximum": self.image_prompt_maximum, "media_upload": {"maximum_bytes": self.max_upload_bytes,
                    "extensions": sorted(self.upload_extensions)}}

        @app.get(prefix + "/models/{provider}/{model:path}")
        async def capability(
            provider: str, model: str, operation: str = "image.generate"
        ):
            if operation not in ("image.generate", "image.edit", "video.generate"):
                raise AgentError("invalid_operation")
            return self.capability(provider, model, operation)

        @app.get(prefix + "/media/search")
        async def search_media(request: Request, canvas: str, query: str = ""):
            document = read_canvas(request, canvas)
            refs = media_refs(document)
            return {
                "media": (
                    [
                        r
                        for r in refs
                        if query.casefold()
                        in (
                            r.get("name", "") + " " + r.get("sourceNodeTitle", "")
                        ).casefold()
                    ]
                    + self.library(actor(request), query)
                )[:200]
            }

        @app.post(prefix + "/canvases/{canvas_id}/media/preview")
        async def preview_media(canvas_id: str, request: Request):
            document = read_canvas(request, canvas_id)
            body = await self.body(request)
            if set(body) - {"source", "max_edge"}:
                raise AgentError("invalid_preview_request")
            return self.preview(actor(request), document, body.get("source"), body.get("max_edge", 1600))

        @app.post(prefix + "/media")
        async def import_media(request: Request, file: UploadFile = File(...)):
            operation_id = self.operation(request, {})
            self.rate_limit(actor(request))
            name = Path(file.filename or "").name
            mime = (file.content_type or "").split(";")[0]
            if (
                Path(name).suffix.lower() not in self.upload_extensions
                or mime
                and mime != "application/octet-stream"
                and mime != "text/plain"
                and not mime.startswith(("image/", "video/", "audio/"))
            ):
                raise AgentError("unsupported_media")
            content = await file.read(self.max_upload_bytes + 1)
            if not content or len(content) > self.max_upload_bytes:
                raise AgentError("media_size_limit", status=413)
            media_id = hashlib.sha256(content).hexdigest()
            request_hash = digest([media_id, name, mime])
            with self.data() as state:
                receipt = state["receipts"].get(operation_id)
                if receipt:
                    if receipt["hash"] != request_hash:
                        raise AgentError("operation_collision", status=409)
                    return receipt["result"]
                existing = next(
                    (
                        items[media_id]
                        for items in state["media"].values()
                        if media_id in items
                    ),
                    None,
                )
                result = (
                    {**existing, "name": name}
                    if existing
                    else self.media()
                    .import_bytes(content, name=name, content_type=mime)
                    .public()
                )
                state["media"].setdefault(actor(request)["id"], {})[media_id] = result
                state["receipts"][operation_id] = {
                    "hash": request_hash,
                    "result": result,
                }
            return result

        @app.get(prefix + "/media/{media_id}/content")
        async def content(media_id: str, request: Request, canvas: str = ""):
            document = read_canvas(request, canvas) if canvas else {"nodes": []}
            refs = self.known_media(actor(request), document)
            found = next(
                (
                    r
                    for r in refs
                    if (r.get("media_id") or digest(r.get("url", ""))) == media_id
                ),
                None,
            )
            if not found:
                raise AgentError("forbidden", status=403)
            path = self.media_path(found["url"])
            if not path or not Path(path).is_file():
                raise AgentError("media_unavailable", status=404)
            return FileResponse(path, filename=Path(found.get("name") or "output").name)

        @app.post(prefix + "/canvases/{canvas_id}/submissions")
        async def submission(canvas_id: str, request: Request):
            read_canvas(request, canvas_id)
            try:
                return await self.submit(request, canvas_id, await self.body(request))
            except CanvasSyncError as error:
                raise AgentError(
                    (
                        error.detail.get("code", "conflict")
                        if isinstance(error.detail, dict)
                        else "conflict"
                    ),
                    status=409,
                )

        @app.patch(prefix + "/canvases/{canvas_id}/tasks/{node_id}")
        async def update_task(canvas_id: str, node_id: str, request: Request):
            read_canvas(request, canvas_id)
            body = await self.body(request)
            if "changes" in body:
                if set(body) - {"changes", "expected_node_revision", "dry_run", "refs_mode", "return_after"}:
                    raise AgentError("invalid_update_request")
                if not isinstance(body["changes"], dict):
                    raise AgentError("invalid_recipe")
                if not isinstance(body.get("expected_node_revision"), str) or not body["expected_node_revision"]:
                    raise AgentError("expected_node_revision_required")
                if "refs" in body["changes"] and body.get("refs_mode") != "replace":
                    raise AgentError("refs_mode_required", {"allowed": ["replace"]})
                if body.get("refs_mode", "replace") != "replace":
                    raise AgentError("invalid_refs_mode", {"allowed": ["replace"]})
                if "return_after" in body and type(body["return_after"]) is not bool:
                    raise AgentError("invalid_return_after")
                # File import is a separate, explicit action. Updating a task
                # cannot upload as a side effect, in either validation or save.
                if "refs" in body["changes"] and not isinstance(body["changes"]["refs"], dict):
                    raise AgentError("invalid_refs")
                if any("file" in ref for ref in body["changes"].get("refs", {}).values() if isinstance(ref, dict)):
                    raise AgentError("import_media_first")
                return await self.submit(request, canvas_id, {"tasks": [body["changes"]],
                    "expected_node_revision": body["expected_node_revision"],
                    "dry_run": body.get("dry_run", False), "strict_update": True,
                    "refs_mode": body.get("refs_mode", "replace")}, node_id)
            return await self.submit(request, canvas_id, {"tasks": [body]}, node_id)

        @app.get(prefix + "/canvases/{canvas_id}/tasks/{node_id}")
        async def generation_task(canvas_id: str, node_id: str, request: Request):
            return self.task_detail(actor(request), read_canvas(request, canvas_id), node_id)

        @app.post(prefix + "/canvases/{canvas_id}/submissions/{submission_id}/undo")
        async def undo(canvas_id: str, submission_id: str, request: Request):
            body = await self.body(request)
            operation_id = self.operation(request, body)
            self.rate_limit(actor(request))
            read_canvas(request, canvas_id)

            def prepare(canvas, receipt):
                if receipt:
                    if receipt.get("reverts_operation_id") != submission_id:
                        raise AgentError("operation_collision", status=409)
                    return None, {
                        "status": "success",
                        "canvas": self.identity(canvas),
                        "submission_id": operation_id,
                        "duplicate": True,
                    }
                original = self.sync.mutation_receipt(
                    canvas_id, actor(request), submission_id
                )
                meta = self.receipt_metadata(original)
                if not meta or meta["token_id"] != request.state.agent_token["id"]:
                    raise AgentError("forbidden", status=403)
                targets = set(meta["result"]["task_ids"])
                if any(
                    task_state(n) != "draft"
                    for n in canvas["nodes"]
                    if n["id"] in targets
                ):
                    raise AgentError("undo_blocked_by_run", status=409)
                if any(
                    r["node_id"] in targets
                    and r["state"]
                    in ("queued", "claimed", "awaiting_confirmation", "submitted")
                    for r in self.run_items(actor(request), canvas_id)
                ):
                    raise AgentError("undo_blocked_by_run", status=409)
                return {
                    "operation_id": operation_id,
                    "base_revision": canvas.get("revision", 0),
                    "reverts_operation_id": submission_id,
                }, {
                    "status": "success",
                    "canvas": self.identity(canvas),
                    "submission_id": operation_id,
                }

            try:
                return await self.sync.commit_prepared_operation(
                    canvas_id, actor(request), operation_id, prepare
                )
            except CanvasSyncError:
                raise AgentError("undo_conflict", status=409)

        @app.get(prefix + "/canvases/{canvas_id}/tasks")
        async def tasks(
            canvas_id: str,
            request: Request,
            submission_id: str = "",
            node_ids: str = "",
        ):
            canvas = read_canvas(request, canvas_id)
            ids = set(node_ids.split(",")) if node_ids else set()
            if submission_id:
                receipt = self.sync.mutation_receipt(
                    canvas_id, actor(request), submission_id
                )
                meta = self.receipt_metadata(receipt)
                if not meta or meta["token_id"] != request.state.agent_token["id"]:
                    raise AgentError("forbidden", status=403)
                ids.update(meta["result"]["task_ids"])
            runs = {r["node_id"]: r for r in self.run_items(actor(request), canvas_id)}
            result = []
            for n in canvas["nodes"]:
                if (
                    ids
                    and n["id"] not in ids
                    or not ids
                    and not n.get("referenceGenerationKind")
                ):
                    continue
                state = task_state(n)
                run = runs.get(n["id"])
                if state == "draft" and run:
                    state = run["state"]
                    if state == "queued":
                        state = (
                            "run_requested"
                            if self.context(actor(request), canvas_id)
                            else "waiting_for_editor"
                        )
                outputs = []
                for media in n.get("images", []):
                    mid = media.get("media_id") or digest(media.get("url", ""))
                    outputs.append(
                        {
                            "media_id": mid,
                            "kind": media.get("kind", "image"),
                            "name": media.get("name", "output"),
                            "download_url": f"{prefix}/media/{mid}/content?canvas={canvas_id}",
                        }
                    )
                result.append({"node_id": n["id"], "state": state, "outputs": outputs})
            return {"canvas": self.identity(canvas), "tasks": result}

        @app.post(prefix + "/canvases/{canvas_id}/run-requests")
        async def run_tasks(canvas_id: str, request: Request):
            if "run" not in request.state.agent_token["scopes"]:
                raise AgentError("run_scope_required", status=403)
            body = await self.body(request)
            operation_id = self.operation(request, body)
            self.rate_limit(actor(request))
            canvas = read_canvas(request, canvas_id)
            ids = body.get("node_ids")
            if (
                not isinstance(ids, list)
                or not 1 <= len(ids) <= 50
                or any(not isinstance(i, str) for i in ids)
                or len(set(ids)) != len(ids)
            ):
                raise AgentError("invalid_task_count")
            with self.data() as state:
                self.refresh_runs(state)
                existing = [
                    r
                    for r in state["runs"].values()
                    if r["operation_id"] == operation_id
                ]
                if existing:
                    if existing[0]["request_hash"] != digest([canvas_id, body]):
                        raise AgentError("operation_collision", status=409)
                    return {"canvas": self.identity(canvas), "requests": existing}
                for nid in ids:
                    n = next((n for n in canvas["nodes"] if n["id"] == nid), None)
                    if (
                        not n
                        or task_state(n) != "draft"
                        or not n.get("referenceGenerationKind")
                    ):
                        raise AgentError("task_not_draft", {"node_id": nid}, 409)
                    if any(
                        r["canvas_id"] == canvas_id
                        and r["node_id"] == nid
                        and r["state"] in ("queued", "claimed", "awaiting_confirmation")
                        for r in state["runs"].values()
                    ):
                        raise AgentError("run_already_requested", status=409)
                initial = (
                    "awaiting_confirmation"
                    if self.auth.agent_settings(actor(request)["id"])["confirmation"]
                    else "queued"
                )
                for index, nid in enumerate(ids):
                    rid = f"{operation_id}:{index}"
                    state["runs"][rid] = {
                        "id": rid,
                        "user_id": actor(request)["id"],
                        "token_id": request.state.agent_token["id"],
                        "canvas_id": canvas_id,
                        "node_id": nid,
                        "operation_id": operation_id,
                        "request_hash": digest([canvas_id, body]),
                        "state": initial,
                        "created_at": time.time(),
                        "lease_until": 0,
                        "client_id": "",
                        "error": "",
                    }
            items = self.run_items(actor(request), canvas_id)
            await self.notice(
                actor(request),
                canvas_id,
                {"type": "agent_run_requests", "requests": items},
            )
            return {
                "canvas": self.identity(canvas),
                "requests": [r for r in items if r["operation_id"] == operation_id],
            }

        @app.delete(prefix + "/canvases/{canvas_id}/run-requests/{request_id}")
        async def cancel_run(canvas_id: str, request_id: str, request: Request):
            read_canvas(request, canvas_id)
            self.operation(request, {})
            self.rate_limit(actor(request))
            with self.data() as state:
                row = state["runs"].get(request_id)
                if (
                    not row
                    or row["user_id"] != actor(request)["id"]
                    or row["canvas_id"] != canvas_id
                ):
                    raise AgentError("forbidden", status=403)
                if row["state"] not in ("queued", "awaiting_confirmation", "cancelled"):
                    raise AgentError("run_already_started", status=409)
                row["state"] = "cancelled"
            return {
                "cancelled": True,
                "canvas": self.identity(read_canvas(request, canvas_id)),
            }
