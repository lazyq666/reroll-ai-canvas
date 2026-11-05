"""Agent access to Image Studio's existing local-repair draft, not pixel masks."""

import copy
import math
from urllib.parse import parse_qs, quote, unquote, urlsplit

from fastapi import HTTPException, Request
from PIL import Image

from .agent_api import AgentError, digest
from .canvas_sync import CanvasSyncError


RATIOS = ("1:1", "2:3", "3:2", "16:9", "9:16")


class AgentImageRepairs:
    def __init__(self, api):
        self.api = api

    def source(self, canvas, node_id, image_index):
        if type(image_index) is not int or image_index < 0:
            raise AgentError("invalid_image_index")
        node = next((n for n in canvas["nodes"] if n["id"] == node_id), None)
        if not node or node.get("type") != "smart-image":
            raise AgentError("image_node_required", status=404)
        images = node.get("images", [])
        if image_index >= len(images):
            raise AgentError("image_not_found", status=404)
        media = images[image_index]
        if not media.get("url") or media.get("kind", "image") != "image":
            raise AgentError("image_required", status=422)
        url = media["url"]
        parsed = urlsplit(url)
        if parsed.path == "/api/media-preview":
            url = parse_qs(parsed.query).get("url", [url])[0]
        path = self.api.available_media_path(url)
        if not path:
            raise AgentError("media_unavailable", status=404)
        try:
            with Image.open(path) as picture:
                if picture.width * picture.height > 40_000_000 or max(picture.size) > 30000:
                    raise AgentError("repair_size_limit", status=413)
                width, height = picture.size
                if picture.getexif().get(274) in (5, 6, 7, 8):
                    width, height = height, width
        except (OSError, ValueError, Image.DecompressionBombError) as error:
            if isinstance(error, AgentError):
                raise
            raise AgentError("media_unavailable", status=422) from error
        key = str(media.get("media_id") or media.get("output_media_id") or media["url"])
        draft = copy.deepcopy(node.get("localRepairDrafts", {}).get(key))
        revision = digest([node_id, image_index, media, width, height, draft])
        return node, media, key, draft, width, height, revision

    def model_identity(self, draft):
        if draft.get("modelIdentity"):
            return draft["modelIdentity"]
        selected = next((model for model in self.api.models()
                         if model.get("kind") == "image" and model.get("id")
                         and model["id"] == draft.get("model")), None)
        if selected:
            return {"provider_id": selected["provider_id"], "model": selected["model"]}
        provider, separator, model = str(draft.get("model", "")).partition("|")
        return {"provider_id": provider, "model": unquote(model)} if separator else None

    def detail(self, canvas, node_id, image_index):
        _, media, _, draft, width, height, revision = self.source(canvas, node_id, image_index)
        draft = draft or {}
        return {"canvas_id": canvas["id"], "node_id": node_id, "image_index": image_index,
                "revision": revision, "width": width, "height": height,
                "preview_source": {"node_id": node_id, "media_index": image_index},
                "source_url": media["url"], "has_draft": bool(draft),
                "draft": {"strokes": draft.get("strokes", []), "prompt": draft.get("prompt", ""),
                          "model": self.model_identity(draft), "aspect_ratio": draft.get("ratio", ""),
                          "resolution_tier": draft.get("resolution", ""), "count": draft.get("count", 1),
                          "transparent_png": draft.get("transparentPng", False)},
                "crop": draft.get("box")}

    def model(self, identity):
        models = [m for m in self.api.models() if m.get("kind") == "image"]
        if identity is not None:
            if (not isinstance(identity, dict) or set(identity) != {"provider_id", "model"}
                    or any(not isinstance(v, str) or not v for v in identity.values())):
                raise AgentError("invalid_model")
            models = [m for m in models if all(m.get(k) == v for k, v in identity.items())]
        else:
            def score(model):
                name = str(model.get("model", "")).lower()
                return 0 if "gpt-image-2.5-suburst" in name else 1 if "gpt-image-2" in name else 2
            models = sorted(models, key=score)
        for model in models:
            try:
                capability = self.api.capability(model["provider_id"], model["model"], "image.edit")
            except (HTTPException, AgentError):
                continue
            contract, params = capability.get("media_contract", {}), capability.get("parameters", {})
            ratios = [r for r in RATIOS if r in (contract.get("aspect_ratios") or params.get("aspect_ratio", {}).get("values", []))]
            if capability.get("inputs", {}).get("image", {}).get("maximum", 0) >= 1 and ratios:
                return model, capability, ratios
        raise AgentError("repair_model_unavailable", status=422)

    @staticmethod
    def strokes(value, width, height):
        if not isinstance(value, list) or len(value) > 64:
            raise AgentError("invalid_repair_strokes", {"maximum": 64})
        result, total = [], 0
        for stroke in value:
            if not isinstance(stroke, dict) or set(stroke) - {"tool", "size", "points"}:
                raise AgentError("invalid_repair_stroke")
            tool, points, size = stroke.get("tool"), stroke.get("points"), stroke.get("size", 42)
            if tool not in ("brush", "rectangle") or not isinstance(points, list) or not points:
                raise AgentError("invalid_repair_stroke")
            if type(size) not in (int, float) or not math.isfinite(size) or not 1 <= size <= 500:
                raise AgentError("invalid_brush_size", {"minimum": 1, "maximum": 500})
            total += len(points)
            if total > 16384 or tool == "rectangle" and len(points) != 2:
                raise AgentError("invalid_repair_points")
            for point in points:
                if not isinstance(point, dict) or set(point) != {"x", "y"}:
                    raise AgentError("invalid_repair_point")
                if any(type(point[k]) not in (int, float) or not math.isfinite(point[k])
                       or not 0 <= point[k] <= maximum for k, maximum in (("x", width), ("y", height))):
                    raise AgentError("repair_point_out_of_bounds", {"width": width, "height": height})
            if tool == "rectangle" and (points[0]["x"] == points[1]["x"] or points[0]["y"] == points[1]["y"]):
                raise AgentError("empty_repair_selection")
            result.append({"tool": tool, "size": size, "points": copy.deepcopy(points)})
        return result

    def changed_draft(self, old, changes, width, height):
        fields = {"strokes", "prompt", "model", "aspect_ratio", "resolution_tier", "count", "transparent_png"}
        if not isinstance(changes, dict) or not changes or set(changes) - fields:
            raise AgentError("invalid_repair_changes", {"allowed": sorted(fields)})
        if "model" in changes and changes["model"] is None:
            raise AgentError("invalid_model")
        draft = copy.deepcopy(old or {})
        if draft and (draft.get("width"), draft.get("height")) != (width, height):
            raise AgentError("repair_source_changed", status=409)
        identity = changes.get("model", self.model_identity(draft))
        if "model" not in changes and draft.get("model") and identity is None:
            raise AgentError("repair_model_unavailable", status=422)
        model, capability, ratios = self.model(identity)
        params, contract = capability.get("parameters", {}), capability.get("media_contract", {})
        draft.update(version=1, width=width, height=height, agentPrepared=True,
                     model=model.get("id") or model["provider_id"] + "|" + quote(model["model"], safe=""),
                     modelIdentity={"provider_id": model["provider_id"], "model": model["model"]})
        draft["strokes"] = self.strokes(changes.get("strokes", draft.get("strokes", [])), width, height)
        prompt = changes.get("prompt", draft.get("prompt", ""))
        if not isinstance(prompt, str) or len(prompt) > self.api.image_prompt_maximum:
            raise AgentError("invalid_repair_prompt", {"maximum": self.api.image_prompt_maximum})
        draft["prompt"] = prompt
        ratio = changes.get("aspect_ratio", draft.get("ratio", ""))
        tiers = contract.get("resolution_tiers") or params.get("resolution_tier", {}).get("values", [])
        resolution = changes.get("resolution_tier", draft.get("resolution", ""))
        if not isinstance(ratio, str) or ratio and ratio not in ratios:
            raise AgentError("invalid_repair_ratio", {"allowed": ratios})
        if not isinstance(resolution, str) or resolution and resolution not in tiers:
            raise AgentError("invalid_repair_resolution", {"allowed": tiers})
        count = changes.get("count", draft.get("count", 1))
        maximum = min(8, capability.get("output", {}).get("count", {}).get("maximum")
                      or params.get("count", {}).get("maximum") or 1)
        if type(count) is not int or not 1 <= count <= maximum:
            raise AgentError("invalid_repair_count", {"maximum": maximum})
        transparent = changes.get("transparent_png", draft.get("transparentPng", False))
        if type(transparent) is not bool or transparent and not contract.get("supports_transparent_png"):
            raise AgentError("invalid_repair_transparency")
        draft.update(ratio=ratio, resolution=resolution, count=count, transparentPng=transparent)
        if set(changes) & {"strokes", "model", "aspect_ratio"}:
            draft["box"] = None  # The shared browser geometry owner computes the green crop frame.
        return draft

    async def update(self, request, canvas_id, node_id, body):
        if set(body) - {"image_index", "changes", "expected_revision", "dry_run"} or type(body.get("dry_run", False)) is not bool:
            raise AgentError("invalid_repair_request")
        expected = body.get("expected_revision")
        if not isinstance(expected, str) or not expected:
            raise AgentError("expected_revision_required")
        actor, token = request.state.user, request.state.agent_token
        operation_id = self.api.operation(request, body)
        self.api.rate_limit(actor)
        index = body.get("image_index", 0)

        def prepare(canvas, receipt):
            if receipt:
                meta = self.api.receipt_metadata(receipt)
                if not meta or meta["token_id"] != token["id"] or meta["request_hash"] != digest(body):
                    raise AgentError("operation_collision", status=409)
                return None, {**meta["result"], "duplicate": True}
            _, _, key, old, width, height, revision = self.source(canvas, node_id, index)
            if revision != expected:
                raise AgentError("revision_conflict", {"current_revision": revision}, 409)
            draft = self.changed_draft(old, body.get("changes"), width, height)
            proposal = copy.deepcopy(canvas)
            proposed = next(n for n in proposal["nodes"] if n["id"] == node_id)
            proposed.setdefault("localRepairDrafts", {})[key] = draft
            result = {"submission_id": operation_id, "kind": "image_repair", "task_ids": [node_id], "node_id": node_id,
                      "persisted": not body.get("dry_run", False), "generation_started": False,
                      "after": self.detail(proposal, node_id, index)}
            metadata = {"token_id": token["id"], "request_hash": digest(body), "result": copy.deepcopy(result)}
            updates = [{"id": node_id, "path": ["localRepairDrafts", key], "value": draft},
                       {"id": node_id, "path": ["agentSubmission"], "value": metadata}]
            return {"operation_id": operation_id, "base_revision": canvas.get("revision", 0),
                    "changes": {"node_updates": updates}}, result

        try:
            return await self.api.sync.commit_prepared_operation(canvas_id, actor, operation_id, prepare,
                                                                 dry_run=body.get("dry_run", False))
        except CanvasSyncError as error:
            raise AgentError("repair_save_conflict", status=error.status_code) from error

    def run_snapshot(self, canvas, node_id, spec):
        if not isinstance(spec, dict) or set(spec) != {"image_index", "expected_revision"}:
            raise AgentError("invalid_repair_request")
        _, media, key, draft, width, height, revision = self.source(canvas, node_id, spec["image_index"])
        if revision != spec["expected_revision"]:
            raise AgentError("revision_conflict", {"current_revision": revision}, 409)
        if not draft or not draft.get("strokes") or not str(draft.get("prompt", "")).strip():
            raise AgentError("repair_draft_incomplete", status=422)
        # Recheck capability and coordinate limits immediately before enqueue/claim.
        self.changed_draft(draft, {"prompt": draft["prompt"]}, width, height)
        return {"image_index": spec["image_index"], "expected_revision": revision,
                "source_url": media["url"], "draft_key": key, "draft": draft,
                "width": width, "height": height}

    @staticmethod
    def output_ids(canvas, request_id):
        return [n["id"] for n in canvas["nodes"] if n.get("agentRepairRequestId") == request_id]

    def install(self, app, read_canvas):
        prefix = "/api/agent/v1/canvases/{canvas_id}/image-repairs/{node_id}"

        @app.get(prefix)
        def detail(canvas_id: str, node_id: str, request: Request, image_index: int = 0):
            canvas = read_canvas(request, canvas_id)
            result = self.detail(canvas, node_id, image_index)
            result["run_requests"] = [{"id": r["id"], "state": r["state"], "error": r.get("error", ""),
                                      "output_node_ids": self.output_ids(canvas, r["id"])}
                                      for r in self.api.run_items(request.state.user, canvas_id)
                                      if r["node_id"] == node_id and r.get("image_repair", {}).get("image_index") == image_index]
            return result

        @app.patch(prefix)
        async def update(canvas_id: str, node_id: str, request: Request):
            read_canvas(request, canvas_id)
            return await self.update(request, canvas_id, node_id, await self.api.body(request))
