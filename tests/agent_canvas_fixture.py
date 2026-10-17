"""Temporary Workspace + real Agent HTTP/CanvasSync/WebSocket for browser acceptance."""

import json
import sys
import socket
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tests
from tests.test_agent_api import AgentApiTests, CAPABILITY
from fastapi import Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
import uvicorn

fixture = AgentApiTests()
fixture.setUp()
app = fixture.client.app
from infinite_canvas.auth_system import install_auth_routes
from fastapi.responses import FileResponse
install_auth_routes(app, fixture.auth)

@app.get('/')
async def shell():
    return FileResponse(Path(__file__).resolve().parents[1] / 'static/index.html')

@app.get('/login')
async def login_page():
    return FileResponse(Path(__file__).resolve().parents[1] / 'static/login.html')



class Notifier:
    def __init__(self):
        self.connections = {}

    async def connect_canvas(self, websocket, canvas_id, client_id):
        await websocket.accept()
        self.connections[websocket] = canvas_id
        return True

    def disconnect_canvas(self, websocket, canvas_id):
        self.connections.pop(websocket, None)

    async def send_canvas_message(self, websocket, message):
        await websocket.send_json(message)
        return True

    async def broadcast_canvas_message(self, canvas_id, message):
        for ws, cid in list(self.connections.items()):
            if cid == canvas_id:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def broadcast_canvas_updated(self, *args):
        pass


fixture.sync._notifier = Notifier()
app.mount(
    "/static", StaticFiles(directory=Path(__file__).resolve().parents[1] / "static")
)


@app.get("/api/canvases/{canvas_id}")
async def canvas(canvas_id: str):
    return {"canvas": fixture.sync.read(canvas_id, fixture.admin)}


@app.get("/fixture/auth")
async def auth():
    return {
        "token": fixture.token["token"],
        "cookie": fixture.auth.create_session(fixture.admin["id"]),
        "user": fixture.admin,
    }


@app.get("/assets/input/{name}")
async def image(name: str):
    return Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#b9a3d3"/></svg>',
        media_type="image/svg+xml",
    )


@app.websocket("/ws/canvases/{canvas_id}")
async def websocket(ws: WebSocket, canvas_id: str, client_id: str = ""):
    actor = fixture.auth.user_for_session(ws.cookies.get("ic_session", ""))
    session = await fixture.sync.open_realtime(ws, canvas_id, actor, client_id)
    if session is None:
        return
    try:
        while True:
            message = await ws.receive_json()
            actor = fixture.auth.user_for_session(ws.cookies.get("ic_session", ""))
            if not await fixture.api.receive(session, actor, message):
                await fixture.sync.receive_realtime(session, actor, message)
    except WebSocketDisconnect:
        pass
    finally:
        fixture.api.disconnect(session)
        await fixture.sync.close_realtime(session)


# Bootstrap credentials are only available to this loopback, disposable test app.
# Public middleware requires a session, so the parent receives it over stdout.
if __name__ == "__main__":
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    print(
        json.dumps(
            {
                "port": sock.getsockname()[1],
                "token": fixture.token["token"],
                "cookie": fixture.auth.create_session(fixture.admin["id"]),
                "user": fixture.admin,
            }
        ),
        flush=True,
    )
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    finally:
        fixture.doCleanups()
