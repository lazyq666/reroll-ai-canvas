"""Real Agent/CanvasSync with a local, deterministic replacement for the Provider."""

import asyncio
import copy
import io
import json
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.agent_canvas_fixture import app, fixture
from fastapi import Request
from fastapi.responses import FileResponse
from PIL import Image, ImageDraw
import uvicorn
from infinite_canvas.image_repair import compose_repair


def media(picture, name):
    buffer = io.BytesIO()
    picture.save(buffer, "PNG")
    return fixture.media.import_bytes(buffer.getvalue(), name=name, content_type="image/png").public()


source = Image.new("RGB", (1000, 800), "#f3e8d2")
draw = ImageDraw.Draw(source)
draw.ellipse((210, 100, 790, 680), fill="#c07b52")
draw.ellipse((300, 250, 430, 390), fill="#40312d")
draw.ellipse((570, 250, 700, 390), fill="#40312d")
draw.ellipse((345, 275, 365, 295), fill="white")
draw.ellipse((615, 275, 635, 295), fill="white")
original = media(source, "Repair study.png")
asyncio.run(fixture.sync.commit_staged_operation("canvas-test", fixture.admin, {
    "operation_id": "fixture:repair-source", "base_revision": 0,
    "changes": {"node_updates": [{"id": "source-0", "path": ["images"], "value": [original]}]},
}))
capability = {
    "provider_id": "apimart", "model_id": "gpt-image-2.5-suburst", "operation": "image.edit",
    "capability_schema_version": 1, "catalog_revision": "repair-fixture-v1", "support_state": "supported",
    "inputs": {"text": {"minimum": 0, "maximum": 1}, "image": {"minimum": 0, "maximum": 1},
               "video": {"maximum": 0}, "audio": {"maximum": 0}, "file": {"maximum": 0}},
    "parameters": {"count": {"type": "integer", "minimum": 1, "maximum": 2},
                   "aspect_ratio": {"type": "enum", "values": ["1:1", "2:3", "3:2", "16:9", "9:16"]},
                   "resolution_tier": {"type": "enum", "values": ["1K", "2K", "4K"]},
                   "quality": {"type": "enum", "values": ["auto"]}},
    "output": {"kind": "image", "count": {"minimum": 1, "maximum": 2}},
    "media_contract": {"known": True, "aspect_ratios": ["1:1", "2:3", "3:2", "16:9", "9:16"],
                       "resolution_tiers": ["1K", "2K", "4K"], "default_resolution_tier": "1K"},
}
fixture.api.resolve_model = lambda *args: copy.deepcopy(capability)
fixture.api.models = lambda: [{"kind": "image", "provider_id": "apimart", "model": "gpt-image-2.5-suburst"}]
submissions = []
outputs = {}


@app.get("/assets/{path:path}")
async def asset(request: Request, path: str):
    return FileResponse(fixture.media.resolve_reference(request.url.path))


@app.get("/api/config")
async def config():
    return {"api_providers": [{"id": "apimart", "enabled": True, "image_models": ["gpt-image-2.5-suburst"]}],
            "available_models": {"image": [{"id": "flagship", "provider_id": "apimart",
                "model": "gpt-image-2.5-suburst", "name": "GPT Image 2.5"}], "text": [], "video": []}, "comfy_instances": []}


@app.get("/api/model-capabilities")
async def capabilities():
    return capability


@app.post("/api/ai/upload")
async def upload(request: Request):
    form = await request.form()
    files = []
    for _, part in form.multi_items():
        if hasattr(part, "read"):
            files.append(fixture.media.import_bytes(await part.read(), name=part.filename, content_type=part.content_type).public())
    return {"files": files}


@app.post("/api/canvas-image-tasks")
async def submit(request: Request):
    body = await request.json()
    submissions.append(body)
    task_id = "repair-task-" + str(len(submissions))
    recipe = body["local_repair"]
    size = (recipe["crop"]["width"], recipe["crop"]["height"])
    patch = media(Image.new("RGBA", size, "#5295a2"), "repair-patch.png")
    composite, saved_recipe = compose_repair({**recipe, "patch": patch}, fixture.media.resolve_reference)
    result = {**media(composite, "repair-result.png"), "kind": "image", "natural_w": 1000, "natural_h": 800,
              "local_repair": saved_recipe}
    outputs[task_id] = result
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/canvas-image-tasks/{task_id}")
async def result(task_id: str):
    item = outputs[task_id]
    return {"task_id": task_id, "status": "succeeded", "result": {"images": [item["url"]], "image_items": [item]}}


@app.get("/fixture/state")
async def state():
    return {"submissions": submissions, "canvas": fixture.sync.read("canvas-test", fixture.admin)}


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
