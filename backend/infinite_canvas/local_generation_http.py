"""Authenticated local staging API. Staging alone grants no Canvas access."""

from __future__ import annotations

import asyncio
from typing import Callable

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .auth_system import require_current_user
from .local_generation_submissions import LocalSubmissionError


class StagedGeneration(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=240)
    actor_id: str = Field(min_length=1, max_length=240)
    canvas_id: str = Field(min_length=1, max_length=240)
    operation_id: str = Field(min_length=1, max_length=240)
    request_index: int = Field(default=0, ge=0, le=7)
    client_id: str = Field(default="", max_length=240)
    endpoint: str = Field(max_length=120)
    payload: dict
    checkpoints: list[dict] = Field(default_factory=list, max_length=128)
    target_ids: list[str] = Field(min_length=1, max_length=8)


def public_submission(record):
    command = record["command"]
    return {
        "id": record["id"], "canvas_id": record["canvas_id"],
        "operation_id": record["operation_id"], "status": record["status"],
        "request_index": record["request_index"],
        "target_ids": command.get("target_ids", []),
        "endpoint": command.get("endpoint", ""),
        "result": record["result"], "error": record["error"],
    }


def install_local_generation_routes(app, *, service: Callable, workspace_id: Callable,
                                    validate: Callable, available: Callable):
    @app.exception_handler(LocalSubmissionError)
    async def local_error(_request, error):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=error.status_code, content={"code": error.code})

    @app.get("/api/local-generation-submissions")
    async def list_submissions(canvas_id: str = ""):
        actor = require_current_user("admin", "designer")
        current = service()
        records = []
        if current is not None and canvas_id:
            records = await asyncio.to_thread(current.journal.list, workspace_id(), owner=str(actor["id"]), canvas_id=canvas_id)
            for record in records:
                current.wake(record)
        return {
            "enabled": current is not None,
            "workspace_id": workspace_id(), "actor_id": str(actor["id"]),
            "submissions": [public_submission(record) for record in records if record["status"] not in {"accepted", "cancelled"}],
        }

    @app.post("/api/local-generation-submissions")
    async def stage_submission(payload: StagedGeneration):
        actor = require_current_user("admin", "designer")
        if payload.actor_id != str(actor["id"]):
            raise LocalSubmissionError("local_generation_permission_lost", 403)
        if payload.workspace_id != workspace_id():
            raise LocalSubmissionError("local_generation_workspace_changed")
        current = service()
        if current is None or not available():
            raise LocalSubmissionError("local_generation_unavailable", 503)
        command = payload.model_dump()
        command["payload"] = validate(command)
        record = await current.accept(str(actor["id"]), command)
        return public_submission(record)

    @app.get("/api/local-generation-submissions/{submission_id}")
    async def read_submission(submission_id: str):
        actor = require_current_user("admin", "designer")
        current = service()
        if current is None:
            raise HTTPException(status_code=404)
        record = await asyncio.to_thread(current.journal.read, submission_id, workspace_id(), str(actor["id"]))
        current.wake(record)
        return public_submission(record)

    @app.post("/api/local-generation-submissions/{submission_id}/retry")
    async def retry_submission(submission_id: str):
        actor = require_current_user("admin", "designer")
        current = service()
        if current is None or not available():
            raise LocalSubmissionError("local_generation_unavailable", 503)
        record = await asyncio.to_thread(current.journal.read, submission_id, workspace_id(), str(actor["id"]))
        return public_submission(await current.retry(record))
