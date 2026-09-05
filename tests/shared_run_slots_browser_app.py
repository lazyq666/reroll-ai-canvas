"""Real SQLite + HTTP + WebSocket fixture; only Provider responses are synthetic."""

import importlib
import json
import time
from dataclasses import asdict
from pathlib import Path

from PIL import Image

from tests.runtime_env import ensure_test_workspace, unload_main
from infinite_canvas.sqlite_authority_publish import publish_sqlite_authority
from infinite_canvas.sqlite_migration import prepare_sqlite_migration

ensure_test_workspace()
import main

PASSWORD = "shared-slots-test-password"
actor = main.AUTH_SYSTEM.create_user(
    username="shared-slots-test", password=PASSWORD, role="admin",
)
outputs = []
for index, color in enumerate(("red", "blue")):
    name = f"shared-slot-{index}.png"
    Image.new("RGB", (1024, 1024), color).save(main.output_path_for(name, "output"))
    outputs.append({
        "url": main.output_url_for(name, "output"), "name": name,
        "outputId": f"output-{index}", "natural_w": 1024, "natural_h": 1024,
    })

for scenario in ("server-first", "browser-first", "reload-pending", "offline"):
    nodes = [{
        "id": "source", "type": "smart-prompt", "text": "Two colored squares",
        "x": 100, "y": 100, "w": 240, "h": 180,
    }]
    for index in range(2):
        nodes.append({
            "id": f"slot-{index}", "type": "smart-image", "images": [],
            "x": 450 + 360 * index, "y": 100, "w": 300, "h": 300, "scale": 2,
            "generationOutputNode": True, "outputKind": "image",
            "generationOperationId": "shared-operation", "generationBatchId": "shared-batch",
            "generationSlotIndex": index, "generationSlotCount": 2,
            "generationBatchSourceNodeId": "source",
            "generationInputSnapshot": {"prompt": "Two colored squares", "settings": {"count": 2}},
            "runPrompt": "Two colored squares", "runAt": int(time.time() * 1000),
            "pending": 1, "running": True,
            "pendingTasks": [{
                "taskId": f"run-{scenario}", "kind": "image", "actorId": actor["id"],
                "nodeId": "slot-0", "generationSlotIndex": index, "generationSlotCount": 2,
            }],
        })
    document = {
        "id": scenario, "kind": "smart", "title": scenario, "project": "default",
        "owner_id": actor["id"], "owner_username": actor["username"],
        "created_by": actor["id"], "updated_by": actor["id"], "visibility": "shared",
        "created_at": 100, "updated_at": 200, "revision": 1, "nodes": nodes,
        "connections": [{"from": "source", "to": f"slot-{index}", "kind": "input"} for index in range(2)],
    }
    path = Path(main.current_workspace_content().smart_canvas(scenario))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")

content = main.current_workspace_content()
prepared = prepare_sqlite_migration(
    content, workspace_id=main.current_workspace_id(), migration_id="shared-slots-browser",
)
publish_sqlite_authority(content, prepared)
unload_main()
main = importlib.import_module("main")
main.WORKSPACE_CONFIGURED = True
app = main.app


@app.get("/_test/outputs")
async def get_outputs():
    return {"outputs": outputs}


@app.post("/_test/complete/{scenario}")
async def complete(scenario: str):
    result = await main.CANVAS_SYNC.apply_generation_result_if_current(
        scenario, actor, node_id="slot-0", operation_id="shared-operation",
        request_index=0, run_id=f"run-{scenario}",
        node_changes={"images": outputs, "pending": 0, "running": False},
    )
    return asdict(result)
