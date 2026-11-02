"""Disposable Agent API/SQLite/WebSocket server for output spacing acceptance."""
import asyncio
import json
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.agent_canvas_fixture import app, fixture
from fastapi.responses import Response
import uvicorn

fixture.api.resolve_model = fixture.api.catalog.resolve
fixture.api.models = lambda: [
    {"provider_id": "apimart", "model": "gpt-image-2-official", "kind": "image"}
]

# Minimized from the reported Canvas: identical portrait outputs, one retaining
# only a square pending w/h, plus a valid user resize that must remain larger.
portraits = [{"id": node_id, "type": "smart-image", "x": 5000 + i * 1000, "y": 0,
              "generationOutputNode": True, "referenceGenerationKind": "image",
              "images": [{"url": "/fixture/portrait.svg", "kind": "image",
                          "natural_w": 1696, "natural_h": 2528}], **size}
             for i, (node_id, size) in enumerate([
                 ("normal-portrait", {"scale": 2}),
                 ("legacy-pending-size", {"w": 440, "h": 440}),
                 ("user-resized-portrait", {"w": 640, "h": 954}),
             ])]
asyncio.run(fixture.sync.commit_staged_operation("canvas-test", fixture.admin, {
    "operation_id": "fixture:portrait-sizes", "base_revision": 0,
    "changes": {"node_creates": [fixture.api.creation(node) for node in portraits]},
}))


@app.get("/fixture/portrait.svg")
async def portrait():
    return Response('<svg xmlns="http://www.w3.org/2000/svg" width="1696" height="2528">'
                    '<rect width="1696" height="2528" fill="#90a1b3"/></svg>', media_type="image/svg+xml")


@app.get("/api/model-capabilities")
async def capability(provider_id: str, model: str, operation: str):
    return fixture.api.catalog.resolve(provider_id, model, operation)


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
