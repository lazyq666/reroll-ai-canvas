"""Real CanvasSync/SQLite receipts for the frontend no-op acknowledgement tests."""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tests  # Adds the repository backend to the import path.
from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.canvas_sync import CanvasSync
from tests.test_canvas_sync import ADMIN, StoreRealtimeNotifier


async def messages():
    with tempfile.TemporaryDirectory() as directory:
        store = SqliteCanvasStore(Path(directory) / "canvas.sqlite3", workspace_id="fixture")
        initial = {
            "id": "canvas-test", "kind": "smart", "title": "Canvas", "icon": "sparkles",
            "owner_id": ADMIN["id"], "visibility": "shared", "revision": 7,
            "nodes": [{"id": "a", "type": "smart-image", "x": 10, "y": 20,
                       "images": [{"url": "/fixture.svg", "name": "A", "kind": "image"}]}],
            "connections": [], "settings": {"generationBatchLayout": "horizontal"},
        }
        store.commit("canvas-test", ADMIN, CanvasIntent.import_canvas(initial, operation_id="fixture:import"))
        notifier = StoreRealtimeNotifier()
        sync = CanvasSync(content=lambda: None, now_ms=lambda: 1000,
                          notifier=notifier, canvas_store=lambda: store)
        websocket = object()
        session = await sync.open_realtime(websocket, "canvas-test", ADMIN, "fixture-client")
        snapshot = notifier.sent[-1][1]
        operation = {"operation_id": "fixture:no-op", "base_revision": 7, "changes": {
            "node_updates": [{"id": "a", "path": ["images"], "value": [
                {"kind": "image", "name": "A", "url": "/fixture.svg"}
            ]}]
        }}
        async def submit(value):
            await sync.receive_realtime(session, ADMIN, {"type": "canvas_mutation", "operation": value})
        await submit(operation)
        acknowledgement = notifier.sent[-1][1]
        await submit(operation)
        duplicate = notifier.sent[-1][1]
        await submit({"operation_id": "fixture:remote-8", "base_revision": 7,
                      "changes": {"node_updates": [{"id": "a", "path": ["y"], "value": 21}]}})
        remote8 = notifier.broadcasts[-1][1]
        queued_operation = {**operation, "operation_id": "fixture:queued-no-op"}
        await submit(queued_operation)
        queued_acknowledgement = notifier.sent[-1][1]
        await submit({"operation_id": "fixture:remote-9", "base_revision": 8,
                      "changes": {"node_updates": [{"id": "a", "path": ["y"], "value": 22}]}})
        remote9 = notifier.broadcasts[-1][1]
        return dict(snapshot=snapshot, operation=operation, acknowledgement=acknowledgement,
                    duplicate=duplicate, remote8=remote8, remote9=remote9,
                    queued_operation=queued_operation, queued_acknowledgement=queued_acknowledgement)


if __name__ == "__main__":
    print(json.dumps(asyncio.run(messages())))
