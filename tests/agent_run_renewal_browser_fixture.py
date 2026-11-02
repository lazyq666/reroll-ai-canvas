"""Disposable image-capable Agent API/SQLite server for delayed-reply acceptance."""
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


@app.get("/api/model-capabilities")
async def capability(provider_id: str, model: str, operation: str):
    return fixture.api.catalog.resolve(provider_id, model, operation)


@app.get("/fixture/output.svg")
async def output():
    return Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="2048">'
        '<rect width="1360" height="2048" fill="#90a1b3"/></svg>',
        media_type="image/svg+xml",
    )


if __name__ == "__main__":
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    print(json.dumps({"port": sock.getsockname()[1], "token": fixture.token["token"],
                      "cookie": fixture.auth.create_session(fixture.admin["id"]),
                      "user": fixture.admin}), flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    finally:
        fixture.doCleanups()
