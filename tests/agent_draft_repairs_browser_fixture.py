"""Disposable real CanvasSync server for cost-free Agent draft repair acceptance."""

import asyncio
import copy
import json
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.agent_canvas_fixture import app, fixture
from fastapi import Request
import uvicorn


MODELS = ["seedance2.0_vip", "seedance2.0fast_vip", "Seedance2.5", "Seedance2.0",
          "seedance2.0fast", "seedance2.0mini", "seedance2.5"]
hidden = False
fixture.api.resolve_model = fixture.api.catalog.resolve
fixture.api.models = lambda: [
    {"provider_id": "jimeng", "model": model, "kind": "video"}
    for model in ["seedance2.0_vip", "seedance2.5"]
    if not (hidden and model == "seedance2.5")
]


def settings():
    return {"engine": "api", "apiKind": "video", "videoProvider": "jimeng",
            "videoModel": "Seedance2.5", "videoDuration": 22,
            "videoAspect": "3:4", "videoResolution": "720p",
            "videoReferenceMode": "multimodal_all_around", "videoMultimodal": True,
            "videoUseFrameRoles": False, "videoGenerateAudio": False}


drafts = [{"id": "alias-draft", "type": "smart-image", "title": "Seedance 2.5 draft",
           "x": 400, "y": 0, "w": 260, "h": 180, "images": [],
           "referenceGenerationKind": "video", "runSettings": settings(),
           "promptDraftText": "A quiet original test scene", "promptDraftHtml": "A quiet original test scene"}]
legacy = {**copy.deepcopy(drafts[0]), "id": "legacy-video", "title": "Existing video",
          "x": 400, "y": 280, "generationOutputNode": True,
          "referenceGenerationKind": "image", "outputKind": "video",
          "images": [{"url": "/static/images/test/fixture.mp4", "kind": "video", "generatedResult": True}],
          "generationInputSnapshot": {"settings": settings()}}
drafts.append(legacy)
asyncio.run(fixture.sync.commit_staged_operation("canvas-test", fixture.admin, {
    "operation_id": "fixture:draft-repairs", "base_revision": 0,
    "changes": {"node_creates": [fixture.api.creation(node) for node in drafts],
                "canvas_updates": [{"path": ["settings"], "value": settings()}]},
}))


@app.get("/api/config")
async def config():
    return {"api_providers": [{"id": "jimeng", "name": "Dreamina", "enabled": True,
                               "image_models": [], "video_models": MODELS, "chat_models": []}],
            "available_models": {"image": [], "text": [], "video": [
                {"id": "jimeng|" + model, "provider_id": "jimeng", "provider_name": "Dreamina",
                 "model": model, "name": "Seedance 2.5 custom" if "2.5" in model else model,
                 "visible": True}
                for model in MODELS if not (hidden and "2.5" in model)]},
            "comfy_instances": []}


@app.get("/api/model-capabilities")
async def capability(provider_id: str, model: str = "", operation: str = "video.generate"):
    return fixture.api.catalog.resolve(provider_id, model, operation)


@app.patch("/fixture/model-visibility")
async def visibility(request: Request):
    global hidden
    hidden = bool((await request.json()).get("hidden"))
    return {"hidden": hidden}


if __name__ == "__main__":
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    print(json.dumps({"port": sock.getsockname()[1], "token": fixture.token["token"],
                      "cookie": fixture.auth.create_session(fixture.admin["id"]), "user": fixture.admin}), flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    finally:
        fixture.doCleanups()
