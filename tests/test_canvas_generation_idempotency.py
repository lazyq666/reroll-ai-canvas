import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)
from tests.websocket_helpers import receive_canvas_message

ensure_test_workspace()


class CanvasGenerationIdempotencyTests(unittest.TestCase):
    def test_duplicate_run_is_submitted_once_and_late_result_is_discarded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            configure_test_workspace(root / "workspace", state)
            previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            scheduled = []
            try:
                main = importlib.import_module("main")
                main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    canvas = client.post(
                        "/api/canvases",
                        json={"title": "Generation", "kind": "smart"},
                    ).json()["canvas"]
                    operation_id = "client-a:generation:0001"
                    node = {
                        "id": "generation-node",
                        "type": "smart-image",
                        "generationOperationId": operation_id,
                    }
                    with client.websocket_connect(
                        f"/ws/canvases/{canvas['id']}?client_id=generation-fixture"
                    ) as socket:
                        self.assertEqual(
                            receive_canvas_message(socket, "canvas_snapshot")["revision"],
                            0,
                        )
                        socket.send_json(
                            {
                                "type": "canvas_mutation",
                                "canvas_id": canvas["id"],
                                "operation": {
                                    "operation_id": "fixture:generation-node-create",
                                    "base_revision": 0,
                                    "changes": {"node_creates": [node]},
                                },
                            }
                        )
                        self.assertEqual(
                            receive_canvas_message(socket, "canvas_mutation")["revision"],
                            1,
                        )
                    payload = {
                        "prompt": "A shared generation",
                        "provider_id": "test-provider",
                        "model": "test-model",
                        "canvas_id": canvas["id"],
                        "node_id": node["id"],
                        "generation_operation_id": operation_id,
                        "generation_request_index": 0,
                        "catalog_revision": main.MODEL_CAPABILITY_CATALOG.revision,
                    }

                    def capture_task(coroutine):
                        scheduled.append(coroutine)
                        return object()

                    with patch.object(main.asyncio, "create_task", capture_task):
                        first = client.post(
                            "/api/canvas-image-tasks",
                            json=payload,
                        )
                        duplicate = client.post(
                            "/api/canvas-image-tasks",
                            json=payload,
                        )
                        comfy = client.post(
                            "/api/canvas-comfy-tasks",
                            json={
                                "prompt": "Portrait",
                                "workflow_json": "Portrait.json",
                            },
                        )

                    self.assertEqual(first.status_code, 200)
                    self.assertEqual(duplicate.status_code, 200)
                    actor_id = client.get("/api/auth/me").json()["user"]["id"]
                    self.assertEqual(first.json()["actor_id"], actor_id)
                    self.assertEqual(duplicate.json()["actor_id"], actor_id)
                    self.assertEqual(
                        first.json()["task_id"],
                        duplicate.json()["task_id"],
                    )
                    self.assertFalse(first.json()["deduplicated"])
                    self.assertTrue(duplicate.json()["deduplicated"])
                    self.assertEqual(len(scheduled), 2)

                    changed_payload = {**payload, "prompt": "Changed input"}
                    conflict = client.post(
                        "/api/canvas-image-tasks",
                        json=changed_payload,
                    )
                    self.assertEqual(conflict.status_code, 409)

                    with client.websocket_connect(
                        f"/ws/canvases/{canvas['id']}?client_id=generation-cleanup"
                    ) as socket:
                        self.assertEqual(
                            receive_canvas_message(socket, "canvas_snapshot")["revision"],
                            1,
                        )
                        socket.send_json(
                            {
                                "type": "canvas_mutation",
                                "canvas_id": canvas["id"],
                                "operation": {
                                    "operation_id": "fixture:generation-node-delete",
                                    "base_revision": 1,
                                    "changes": {
                                        "node_deletes": [node["id"]]
                                    },
                                },
                            }
                        )
                        self.assertEqual(
                            receive_canvas_message(socket, "canvas_mutation")["revision"],
                            2,
                        )
                    late = client.get(
                        f"/api/canvas-image-tasks/{first.json()['task_id']}"
                    )
                    self.assertEqual(late.status_code, 200)
                    self.assertEqual(late.json()["status"], "discarded")
                    self.assertIsNone(late.json()["result"])
                    self.assertTrue(late.json()["recoverable"])

                    restarted = main.GenerationRuns(
                        executor=main.ProviderGenerationExecutor(
                            main._PROVIDER_RUNTIME
                        ),
                        effects=main._GENERATION_EFFECTS,
                        store_path=lambda: (
                            main.current_workspace_content().generation_runs
                        ),
                        target_guard=main.CanvasGenerationTargetGuard(
                            canvas_sync=main.CANVAS_SYNC,
                            actor_by_id=main.AUTH_SYSTEM.get_user,
                        ),
                    )
                    main._GENERATION_RUNS = restarted
                    main.generation_run_control.install(restarted)
                    persisted_image = client.get(
                        "/api/canvas-image-tasks/"
                        f"{first.json()['task_id']}"
                    ).json()
                    persisted_comfy = client.get(
                        "/api/canvas-comfy-tasks/"
                        f"{comfy.json()['task_id']}"
                    ).json()
                    self.assertEqual(
                        {
                            "type": "online-image",
                            "provider_id": "test-provider",
                            "model": "test-model",
                        },
                        {
                            key: persisted_image[key]
                            for key in (
                                "type",
                                "provider_id",
                                "model",
                            )
                        },
                    )
                    self.assertEqual(
                        {
                            "type": "comfy",
                            "workflow_json": "Portrait.json",
                        },
                        {
                            key: persisted_comfy[key]
                            for key in ("type", "workflow_json")
                        },
                    )
            finally:
                for coroutine in scheduled:
                    coroutine.close()
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state
                ensure_test_workspace()


if __name__ == "__main__":
    unittest.main()
