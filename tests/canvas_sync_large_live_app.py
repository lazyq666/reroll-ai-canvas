"""Disposable full application with a >16 MiB Canvas; no Provider configuration."""
import json
import os
import socket
import tempfile
from pathlib import Path

import uvicorn
from fastapi.responses import Response
from tests.runtime_env import configure_test_workspace


def main():
    with tempfile.TemporaryDirectory(prefix="reroll-large-sync-") as directory:
        root = Path(directory)
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(root / "state")
        os.environ["INFINITE_CANVAS_INSTANCE_STATE_DIR"] = str(root / "instance")
        configure_test_workspace(root / "workspace", root / "state")
        from infinite_canvas.content import WorkspaceContent
        from infinite_canvas.sqlite_workspace_bootstrap import bootstrap_fresh_workspace_sqlite
        from infinite_canvas.workspace import WorkspaceService
        from infinite_canvas.workspace_storage import WorkspaceStorage
        service = WorkspaceService(WorkspaceStorage(root / "installation", state_dir=root / "state"))
        bootstrap_fresh_workspace_sqlite(WorkspaceContent(service.current()), workspace_id=service.ensure_identity())
        import main as application
        from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection

        user = application.AUTH_SYSTEM.create_user(
            username="sync_admin", password=os.environ["CANVAS_SYNC_TEST_PASSWORD"], role="admin",
        )
        store = application.CANVAS_SYNC._canvas_store()
        canvas = {
            "id": "large-sync-test", "kind": "smart", "title": "Large sync regression",
            "icon": "sparkles", "owner_id": user["id"], "visibility": "shared", "revision": 0,
            "connections": [], "settings": {"generationBatchLayout": "horizontal"},
            "nodes": [{
                "id": f"large-node-{index}", "type": "smart-image", "title": f"Image {index + 1}",
                "x": (index % 20) * 280, "y": (index // 20) * 240, "w": 200, "h": 160,
                "images": [{"url": "/fixture.svg", "kind": "image", "name": f"Image {index + 1}",
                            "natural_w": 200, "natural_h": 160}],
                # Representative persisted generation input: large, but not rendered
                # as a huge DOM text node or interpreted as an unfinished Run.
                "generationInputSnapshot": {"prompt": "同步 test " * 8000},
            } for index in range(212)],
        }
        store.commit(canvas["id"], user, CanvasIntent.import_canvas(canvas, operation_id="large-sync:import"))
        snapshot = store.read(canvas["id"], user, CanvasProjection.public_snapshot()).canvas
        snapshot_bytes = len(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode())
        assert snapshot_bytes > 16 * 1024 * 1024

        @application.app.get("/fixture.svg")
        async def fixture_image():
            return Response('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160">'
                            '<rect width="200" height="160" fill="#90a1b3"/></svg>', media_type="image/svg+xml")

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        sock.listen(128)
        print(json.dumps({"port": sock.getsockname()[1], "canvas_id": canvas["id"],
                          "snapshot_bytes": snapshot_bytes,
                          "cookie": application.AUTH_SYSTEM.create_session(user["id"])}), flush=True)
        try:
            uvicorn.Server(uvicorn.Config(application.app, log_level="warning",
                                         ws_ping_interval=None, ws_ping_timeout=None)).run(sockets=[sock])
        finally:
            application.release_workspace_occupation()


if __name__ == "__main__":
    main()
