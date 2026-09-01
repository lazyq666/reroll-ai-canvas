import importlib
import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from infinite_canvas.generation_runs import GenerationRuns, ImageRun
from infinite_canvas.providers.core import Completed
from infinite_canvas.providers.runtime import ProviderOutput
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)
from tests.websocket_helpers import receive_canvas_message

ensure_test_workspace()


class CapturingDepthExecutor:
    def __init__(self):
        self.calls = []

    def is_restart_recoverable(self, request):
        return isinstance(request, ImageRun)

    async def execute(self, request, **_callbacks):
        self.calls.append(request)
        return Completed(
            ProviderOutput(
                media=("depth.png",),
                legacy={"images": ["depth.png"]},
            )
        )


class PassthroughEffects:
    async def publish(self, _run_id, _request, output):
        return {"images": list(output.media)}


class Issue152DepthMapHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.state = self.root / "state"
        configure_test_workspace(self.root / "workspace", self.state)
        self.previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
        self.previous_cache = os.environ.get("INFINITE_CANVAS_CACHE_DIR")
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(self.state)
        os.environ["INFINITE_CANVAS_CACHE_DIR"] = str(self.root / "cache")
        unload_main()
        self.main = importlib.import_module("main")
        self.main.AUTH_SYSTEM.create_user(
            username="admin",
            password="admin-password",
            role="admin",
        )
        self.client_context = TestClient(self.main.app)
        self.client = self.client_context.__enter__()
        login = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin-password"},
        )
        self.assertEqual(200, login.status_code)
        self.canvas = self.client.post(
            "/api/canvases",
            json={"title": "Depth", "kind": "smart"},
        ).json()["canvas"]
        self.executor = CapturingDepthExecutor()
        self.runs = GenerationRuns(
            executor=self.executor,
            effects=PassthroughEffects(),
            store_path=lambda: self.root / "generation-runs.json",
        )
        self.original_runs = self.main._GENERATION_RUNS
        self.main._GENERATION_RUNS = self.runs

    def tearDown(self):
        self.main._GENERATION_RUNS = self.original_runs
        self.client_context.__exit__(None, None, None)
        unload_main()
        if self.previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self.previous_state
        if self.previous_cache is None:
            os.environ.pop("INFINITE_CANVAS_CACHE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_CACHE_DIR"] = self.previous_cache
        self.temporary.cleanup()

    def _create_nodes(self, source_url):
        operation_id = "client:depth:1"
        nodes = [
            {
                "id": "source",
                "type": "smart-image",
                "images": [
                    {"url": source_url, "kind": "image", "name": "source"}
                ],
            },
            {
                "id": "depth-pending",
                "type": "smart-image",
                "generationOperationId": operation_id,
            },
        ]
        with self.client.websocket_connect(
            f"/ws/canvases/{self.canvas['id']}?client_id=depth-fixture"
        ) as socket:
            revision = receive_canvas_message(socket, "canvas_snapshot")["revision"]
            socket.send_json(
                {
                    "type": "canvas_mutation",
                    "canvas_id": self.canvas["id"],
                    "operation": {
                        "operation_id": "fixture:depth-nodes",
                        "base_revision": revision,
                        "changes": {"node_creates": nodes},
                    },
                }
            )
            self.assertEqual(
                revision + 1,
                receive_canvas_message(socket, "canvas_mutation")["revision"],
            )
        return operation_id

    def test_submit_depth_map_creates_background_generation_run(self):
        source_path = Path(self.main.managed_media_directory()) / "source.png"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 6), (120, 90, 60)).save(source_path)
        operation_id = self._create_nodes("/assets/source.png")

        response = self.client.post(
            "/api/smart-canvas/depth-map",
            json={
                "canvas_id": self.canvas["id"],
                "source_node_id": "source",
                "source_image_index": 0,
                "node_id": "depth-pending",
                "generation_operation_id": operation_id,
                "generation_request_index": 0,
            },
        )

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["task_id"].startswith("run_"))
        for _attempt in range(20):
            if self.executor.calls:
                break
            time.sleep(0.01)
        request = self.executor.calls[0]
        self.assertEqual("image-processor", request.publication)
        self.assertEqual(
            "depth-anything-v2-small",
            request.settings["processor_id"],
        )
        self.assertEqual("/assets/source.png", request.references[0]["url"])

    def test_submit_depth_map_rejects_remote_source(self):
        operation_id = self._create_nodes("https://example.com/source.png")

        response = self.client.post(
            "/api/smart-canvas/depth-map",
            json={
                "canvas_id": self.canvas["id"],
                "source_node_id": "source",
                "source_image_index": 0,
                "node_id": "depth-pending",
                "generation_operation_id": operation_id,
                "generation_request_index": 0,
            },
        )

        self.assertEqual(400, response.status_code)
        self.assertIn("受控的本地图片", response.json()["detail"])
        self.assertEqual([], self.executor.calls)


if __name__ == "__main__":
    unittest.main()
