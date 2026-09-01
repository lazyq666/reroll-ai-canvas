import importlib
import os
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


class CanvasTextGenerationRecoveryTests(unittest.TestCase):
    def test_text_task_is_idempotent_and_targets_the_output_node(self):
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
                        json={"title": "Text recovery", "kind": "smart"},
                    ).json()["canvas"]
                    operation_id = "client-a:text-generation:0001"
                    output_node = {
                        "id": "text-output",
                        "type": "smart-prompt",
                        "generationOperationId": operation_id,
                        "textGenerationOutput": True,
                        "textGenerationPending": True,
                        "running": True,
                        "text": "",
                    }
                    with client.websocket_connect(
                        f"/ws/canvases/{canvas['id']}?client_id=text-fixture"
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
                                    "operation_id": "fixture:text-output-create",
                                    "base_revision": 0,
                                    "changes": {
                                        "node_creates": [output_node]
                                    },
                                },
                            }
                        )
                        self.assertEqual(
                            receive_canvas_message(socket, "canvas_mutation")["revision"],
                            1,
                        )
                    payload = {
                        "message": "Write a recoverable answer",
                        "provider": "codex",
                        "model": "gpt-5.5",
                        "canvas_id": canvas["id"],
                        "node_id": output_node["id"],
                        "generation_operation_id": operation_id,
                        "generation_request_index": 0,
                    }

                    def capture_task(coroutine):
                        scheduled.append(coroutine)
                        return object()

                    with patch.object(main.asyncio, "create_task", capture_task):
                        first = client.post("/api/canvas-llm-tasks", json=payload)
                        duplicate = client.post("/api/canvas-llm-tasks", json=payload)

                    self.assertEqual(first.status_code, 200, first.text)
                    self.assertEqual(duplicate.status_code, 200, duplicate.text)
                    self.assertEqual(first.json()["task_id"], duplicate.json()["task_id"])
                    self.assertFalse(first.json()["deduplicated"])
                    self.assertTrue(duplicate.json()["deduplicated"])
                    self.assertEqual(len(scheduled), 1)
                    actor_id = client.get("/api/auth/me").json()["user"]["id"]
                    self.assertEqual(first.json()["actor_id"], actor_id)

                    stored = main._GENERATION_RUNS.get(
                        first.json()["task_id"],
                        owner=actor_id,
                    )
                    self.assertEqual(stored.status, "queued")
                    self.assertEqual(stored.target.canvas_id, canvas["id"])
                    self.assertEqual(stored.target.node_id, output_node["id"])
                    self.assertEqual(stored.target.operation_id, operation_id)

                    changes = main.CanvasGenerationTargetGuard._node_changes(
                        {"text": "Recovered text"}
                    )
                    self.assertEqual(changes["text"], "Recovered text")
                    self.assertFalse(changes["textGenerationPending"])
                    self.assertFalse(changes["running"])
                    self.assertEqual(changes["pending"], 0)
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
