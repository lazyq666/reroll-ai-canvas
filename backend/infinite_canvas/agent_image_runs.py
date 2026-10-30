"""Account-owned direct image Runs using the shared GenerationRuns authority."""
from __future__ import annotations

import asyncio
import copy
from collections import defaultdict
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from .generation_runs import Background, ACTIVE_STATUSES, GenerationRunError
from .image_capabilities import AUTOMATIC_ASPECT_RATIO_TOLERANCE, normalize_image_aspect


class AgentImageRuns:
    surface = "agent-image"

    def __init__(self, api):
        self.api = api
        self._submission_locks = defaultdict(asyncio.Lock)

    @staticmethod
    def language(request):
        return "zh" if request.headers.get("accept-language", "").lower().startswith("zh") else "en"

    @staticmethod
    def message(code, language):
        from .agent_installer import catalog
        messages = catalog(language, namespace="agent.cli.")
        return messages.get("agent.cli." + code, messages.get("agent.cli.api_error", code))

    @staticmethod
    def fail(code, details=None, status=422):
        from .agent_api import AgentError
        raise AgentError(code, details, status)

    def service(self):
        runs = self.api.image_runs() if callable(self.api.image_runs) else None
        if runs is None or not callable(self.api.compile_image):
            self.fail("image_runs_unavailable", status=503)
        return runs

    def permission(self, actor, token):
        if "run" not in token.get("scopes", []):
            self.fail("run_scope_required", status=403)
        if actor.get("role") not in ("admin", "designer"):
            self.fail("forbidden", status=403)

    def request(self, body):
        if set(body) - {"request_id", "prompt", "provider_id", "model", "images", "ratio", "resolution"}:
            self.fail("invalid_request")
        for key in ("request_id", "provider_id", "model"):
            if not isinstance(body.get(key), str) or not body[key].strip() or len(body[key]) > 160:
                self.fail("invalid_request", {"field": key})
        if not body["request_id"].isprintable():
            self.fail("invalid_request_id")
        if not isinstance(body.get("prompt"), str) or not body["prompt"].strip():
            self.fail("prompt_required")
        images = body.get("images", [])
        if not isinstance(images, list) or len(images) > 100:
            self.fail("invalid_refs")
        inputs = []
        for index, image in enumerate(images, 1):
            if (not isinstance(image, dict) or set(image) - {"media_id", "name"}
                    or not isinstance(image.get("media_id"), str) or not image["media_id"]
                    or not isinstance(image.get("name", ""), str)):
                self.fail("invalid_refs")
            name = image.get("name", "")
            if len(name) > 512 or "/" in name or "\\" in name:
                self.fail("invalid_refs")
            inputs.append({"index": index, "media_id": image["media_id"], "name": name})
        value = {**body, "images": inputs}
        for key in ("ratio", "resolution"):
            if key in value and value[key] is not None and (not isinstance(value[key], str) or not value[key].strip()):
                self.fail("invalid_request", {"field": key})
            value[key] = value.get(key)
        return value

    def capability(self, value):
        if not any(row.get("provider_id") == value["provider_id"] and row.get("model") == value["model"]
                   and row.get("kind") == "image" for row in self.api.models()):
            self.fail("model_unavailable", status=409)
        operation = "image.edit" if value["images"] else "image.generate"
        capability = self.api.capability(value["provider_id"], value["model"], operation)
        return operation, capability

    def references(self, actor, inputs):
        with self.api.data() as state:
            available = copy.deepcopy(state["media"].get(actor["id"], {}))
        # Only media explicitly imported by this Account may enter this flat
        # request. Canvas-only attachments need a Canvas authorization boundary.
        refs = []
        for item in inputs:
            media = available.get(item["media_id"])
            if not media or media.get("kind") != "image":
                self.fail("media_unavailable", {"index": item["index"]}, 404)
            path = self.api.available_media_path(media.get("url"))
            if path is None:
                self.fail("media_unavailable", {"index": item["index"]}, 404)
            try:
                if path.stat().st_size > self.api.max_upload_bytes:
                    self.fail("media_size_limit", {"index": item["index"]}, 413)
                with Image.open(path) as image:
                    width, height = image.size
                    image.load()
            except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
                self.fail("invalid_image", {"index": item["index"]})
            refs.append({**media, "name": item["name"] or media.get("name", ""),
                         "natural_w": width, "natural_h": height})
        return refs

    def parameter(self, capability, field, requested):
        definition = capability.get("parameters", {}).get(field)
        applicable = isinstance(definition, dict) and definition.get("values") != []
        if not applicable:
            if requested is not None:
                self.fail("parameter_not_applicable", {"field": field, "allowed": []})
            return None
        options = definition.get("values", [])
        if requested is None:
            default = definition.get("default")
            if default not in (None, ""):
                return default
            if definition.get("required"):
                self.fail("parameter_required", {"field": field, "allowed": options})
            return None
        for option in options:
            if isinstance(option, str) and option.casefold() == requested.casefold():
                return option
        if options:
            self.fail("parameter_value", {"field": field, "allowed": options})
        return requested

    def compile(self, actor, value):
        if len(value["prompt"]) > self.api.image_prompt_maximum:
            self.fail("prompt_too_long", {"maximum": self.api.image_prompt_maximum})
        operation, capability = self.capability(value)
        refs = self.references(actor, value["images"])
        if len(refs) > 1 and (value["ratio"] is None or value["ratio"].casefold() == "auto"):
            self.fail("explicit_ratio_required")
        reference_aspect_ratio = ""
        if value["ratio"] is not None and value["ratio"].casefold() == "auto":
            if len(refs) != 1:
                self.fail("auto_ratio_requires_one_image")
            ratio, _ = normalize_image_aspect(refs[0]["natural_w"], refs[0]["natural_h"],
                capability.get("parameters", {}).get("aspect_ratio", {}).get("values", []),
                tolerance=AUTOMATIC_ASPECT_RATIO_TOLERANCE)
            if ratio is None:
                self.fail("auto_ratio_unavailable")
            reference_aspect_ratio = f'{refs[0]["natural_w"]}:{refs[0]["natural_h"]}'
        else:
            ratio = self.parameter(capability, "aspect_ratio", value["ratio"])
        resolution = self.parameter(capability, "resolution_tier", value["resolution"])
        parameters = {"count": 1} if "count" in capability.get("parameters", {}) else {}
        if ratio is not None:
            parameters["aspect_ratio"] = ratio
        if resolution is not None:
            parameters["resolution_tier"] = resolution
        report = self.api.catalog.validate(capability, input_counts={"text": 1, "image": len(refs)},
                    parameters=parameters, catalog_revision=capability.get("catalog_revision", ""))
        if not report["valid"]:
            self.fail("capability_validation_failed", {"errors": report["errors"]})
        command = {"prompt": value["prompt"], "provider_id": value["provider_id"], "model": value["model"],
            "ratio": ratio, "resolution": resolution, "reference_aspect_ratio": reference_aspect_ratio,
            "references": refs, "catalog_revision": capability["catalog_revision"]}
        try:
            request = self.api.compile_image(command)
        except ValidationError:
            self.fail("capability_validation_failed")
        except HTTPException as error:
            details = error.detail if isinstance(error.detail, dict) else {}
            code = details.get("code", "capability_validation_failed")
            self.fail(code, {k: v for k, v in details.items() if k in {"field", "allowed", "errors"}}, error.status_code)
        return request, {"provider_id": value["provider_id"], "model": value["model"], "operation": operation,
            "settings": {"requested_ratio": value["ratio"], "ratio": ratio,
                "requested_resolution": value["resolution"], "resolution": resolution},
            "inputs": [{**item, "name": item["name"] or ref.get("name", "")} for item, ref in zip(value["images"], refs)]}

    async def submit(self, actor, token, body, language="en"):
        from .agent_api import digest
        self.permission(actor, token)
        if self.api.auth.agent_settings(actor["id"])["confirmation"]:
            self.fail("confirmation_required", status=409)
        value = self.request(body)
        signature = digest(value)
        owner, key = str(actor["id"]), self.surface + ":" + value["request_id"]
        runs = self.service()
        # Serialize receipt checks for idempotency, not background generation.
        async with self._submission_locks[owner]:
            existing = await runs.find_by_key(owner=owner, key=key)
            if existing is not None:
                if existing.public_metadata.get("input_hash") != signature:
                    self.fail("request_conflict", status=409)
                return self.public(existing, language)
            request, metadata = self.compile(actor, value)
            try:
                run = await runs.start(request, owner=owner, key=key, delivery=Background(),
                    public_metadata={"surface": self.surface, "request_id": value["request_id"],
                                     "input_hash": signature, "image_request": metadata})
            except GenerationRunError:
                self.fail("image_run_submission_failed", status=409)
            await runs.wait_for_lifecycle_projection(through_current=True)
            return self.public(run, language)

    async def lookup(self, actor, token, request_id):
        self.permission(actor, token)
        if not request_id or len(request_id) > 160 or not request_id.isprintable():
            self.fail("invalid_request_id")
        run = await self.service().find_by_key(owner=str(actor["id"]), key=self.surface + ":" + request_id)
        if run is None or run.public_metadata.get("surface") != self.surface:
            self.fail("run_not_found", status=404)
        return run

    async def query(self, actor, token, run_id):
        self.permission(actor, token)
        try:
            run = await self.service().query(run_id, owner=str(actor["id"]))
        except GenerationRunError:
            self.fail("run_not_found", status=404)
        if run.public_metadata.get("surface") != self.surface:
            self.fail("run_not_found", status=404)
        return run

    def output(self, run, index):
        if index != 0 or run.status != "succeeded" or not isinstance(run.result, dict):
            self.fail("output_unavailable", status=404)
        images = run.result.get("images") or []
        if not images:
            self.fail("output_unavailable", status=404)
        url = images[0].get("url") if isinstance(images[0], dict) else images[0]
        path = self.api.available_media_path(url)
        if path is None:
            self.fail("output_unavailable", status=404)
        try:
            with Image.open(path) as image:
                width, height = image.size
                image.load()
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
            self.fail("output_unavailable", status=404)
        return path, width, height

    def public(self, run, language="en"):
        metadata = copy.deepcopy(run.public_metadata.get("image_request", {}))
        status = "succeeded" if run.status == "succeeded" else "pending" if run.status in ACTIVE_STATUSES else "failed"
        result = {"status": status, "request_id": run.public_metadata.get("request_id"), "run_id": run.id,
                  **metadata, "outputs": [], "error": None}
        if status == "succeeded":
            from .agent_api import AgentError
            try:
                path, width, height = self.output(run, 0)
                result["outputs"] = [{"download_url": f"/api/agent/v1/image-runs/{run.id}/outputs/0",
                    "name": path.name, "width": width, "height": height}]
            except AgentError:
                result.update(status="failed", error={"code": "output_unavailable", "message": self.message("output_unavailable", language), "details": {}})
        elif status == "failed":
            # Provider exception text may contain credentials. Expose a stable
            # public code; diagnostics remain in the existing protected Run log.
            result["error"] = {"code": "generation_failed", "message": self.message("generation_failed", language), "details": {}}
        return result

    async def download(self, actor, token, run_id, index):
        run = await self.query(actor, token, run_id)
        path, _, _ = self.output(run, index)
        return FileResponse(path, filename=Path(path).name)
