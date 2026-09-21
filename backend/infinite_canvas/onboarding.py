"""First-run orchestration; delegates storage, discovery and authentication."""
from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth_system import AuthSystem, _local_client, require_current_user

SERVICES = {
    "apimart": ("APIMart", "https://api.apimart.ai/v1", "apimart"),
    "modelscope": ("ModelScope", "https://api-inference.modelscope.cn/v1", "openai"),
    "runninghub": ("RunningHub", "https://www.runninghub.cn", "runninghub"),
    "volcengine": ("Volcengine", "https://ark.cn-beijing.volces.com/api/v3", "volcengine"),
    "jimeng": ("Dreamina CLI", "", "jimeng"),
    "codex": ("GPT CLI", "", "codex"),
    "gemini-cli": ("Antigravity CLI", "", "gemini-cli"),
}
CLI = {"jimeng", "codex", "gemini-cli"}
MODEL_FIELDS = ("image_models", "video_models", "chat_models")


class ConnectRequest(BaseModel):
    service: str
    name: str = Field(default="", max_length=120)
    base_url: str = Field(default="", max_length=2048)
    api_key: str = Field(default="", max_length=8192)
    protocol: str = ""


@dataclass
class OnboardingPorts:
    load: Callable
    save: Callable
    test: Callable
    models: Callable
    cli_status: Callable
    fingerprint: Callable
    workspace: Callable


def service_config(payload: ConnectRequest) -> dict:
    if payload.service in SERVICES:
        name, base_url, protocol = SERVICES[payload.service]
        return dict(id=payload.service, name=name, base_url=base_url, protocol=protocol)
    if payload.service != "other":
        raise HTTPException(400, detail={"code": "unknown_service"})
    url = payload.base_url.strip().rstrip("/")
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise HTTPException(400, detail={"code": "invalid_url"})
    if not payload.name.strip():
        raise HTTPException(400, detail={"code": "name_required"})
    if payload.protocol not in {"", "openai", "gemini", "apimart"}:
        raise HTTPException(400, detail={"code": "invalid_protocol"})
    identity = hashlib.sha256(url.encode()).hexdigest()[:16]
    return dict(id="onboarding-" + identity, name=payload.name.strip(),
                base_url=url, protocol=payload.protocol or "openai")


def install_onboarding_routes(app: FastAPI, auth: AuthSystem, ports: OnboardingPorts):
    # Serialise first-run edits in this process; storage also uses its existing lock.
    lock = asyncio.Lock()

    def authorize(request: Request):
        require_current_user("admin")
        if not _local_client(request):
            raise HTTPException(403, detail={"code": "local_client_required"})

    def connected():
        records = auth.onboarding_status()["services"]
        result = {}
        for provider in ports.load():
            record = records.get(provider["id"])
            if not record or not provider.get("enabled", True):
                continue
            if record.get("fingerprint") != ports.fingerprint(provider):
                continue
            count = len(set(model for field in MODEL_FIELDS for model in provider.get(field, [])))
            if count:
                result[provider["id"]] = {"name": provider["name"], "count": count}
        return result

    @app.get("/api/admin/onboarding")
    async def status(request: Request):
        authorize(request)
        return {**auth.onboarding_status(), "services": connected(), "workspace": ports.workspace()}

    @app.get("/api/admin/onboarding/cli/{service}")
    async def cli_status(service: str, request: Request):
        authorize(request)
        if service not in CLI:
            raise HTTPException(404)
        status = await ports.cli_status(service)
        # Never return raw CLI output, local executable paths or account identifiers.
        return {key: status.get(key) for key in
                ("installed", "logged_in", "version_ok", "image2_helper_installed")}

    @app.post("/api/admin/onboarding/connect")
    async def connect(payload: ConnectRequest, request: Request):
        authorize(request)
        if not auth.onboarding_status()["pending"]:
            raise HTTPException(409, detail={"code": "onboarding_finished"})
        config = service_config(payload)
        provider_id = config["id"]
        if provider_id not in CLI and not payload.api_key.strip():
            current = next((p for p in ports.load() if p["id"] == provider_id), None)
            if current is None:
                raise HTTPException(400, detail={"code": "key_required"})

        async def events():
            def event(stage, **values):
                return json.dumps({"stage": stage, **values}) + "\n"

            async with lock:
                if not auth.onboarding_status()["pending"]:
                    yield event("error", code="onboarding_finished")
                    return
                try:
                    if provider_id in CLI:
                        status = await ports.cli_status(provider_id)
                        if not status.get("installed"):
                            yield event("error", code="not_installed")
                            return
                        if status.get("version_ok") is False:
                            yield event("error", code="cli_outdated")
                            return
                        if status.get("logged_in") is not True:
                            yield event("error", code="login_unverified" if status.get("logged_in") is None else "login_required")
                            return
                    # Failed validation invalidates this service only, never the queue.
                    auth.record_onboarding_service(provider_id, {})
                    yield event("saving")
                    initial = await ports.save(config, payload.api_key.strip(), None)
                    revision = ports.fingerprint(initial)
                    yield event("verifying")
                    test = None
                    protocols = [config["protocol"]]
                    if payload.service == "other" and not payload.protocol:
                        protocols = ["openai", "gemini", "apimart"]
                    for protocol in protocols:
                        config["protocol"] = protocol
                        try:
                            test = await ports.test(config)
                        except (HTTPException, OSError, RuntimeError, ValueError):
                            test = None
                        if test and test.get("ok"):
                            break
                    if not test or not test.get("ok"):
                        yield event("error", code="auto_failed" if payload.service == "other" and not payload.protocol else "connection_failed")
                        return
                    if test.get("protocol") in {"openai", "gemini", "apimart", "volcengine", "runninghub", *CLI}:
                        config["protocol"] = test["protocol"]
                    if test.get("image_request_mode"):
                        config["image_request_mode"] = test["image_request_mode"]
                    yield event("fetching")
                    models = await ports.models(config)
                    selected = {field: list(dict.fromkeys(
                        str(m).strip() for m in models.get(field, []) if isinstance(m, str) and m.strip()
                    )) for field in MODEL_FIELDS}
                    if provider_id == "codex" and not status.get("image2_helper_installed"):
                        selected["image_models"] = []
                    if not any(selected.values()):
                        yield event("error", code="no_models")
                        return
                    selected["model_protocols"] = models.get("model_protocols", {})
                    saved = await ports.save(config, "", selected, expected=revision)
                    count = len(set(m for field in MODEL_FIELDS for m in saved.get(field, [])))
                    auth.record_onboarding_service(provider_id, {
                        "fingerprint": ports.fingerprint(saved),
                    })
                    yield event("complete", provider_id=provider_id, count=count)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Upstream exception strings can echo credentials; expose stable codes.
                    yield event("error", code="connection_failed")
        return StreamingResponse(events(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @app.post("/api/admin/onboarding/complete")
    async def complete(request: Request):
        authorize(request)
        async with lock:
            if not connected():
                raise HTTPException(409, detail={"code": "no_source"})
            auth.finish_onboarding()
        return {"next_url": "/static/canvas-list.html"}
