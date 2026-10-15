"""HTTP projection and upload contracts used by the Composer workflow path."""
import io
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.runtime_env import ensure_test_workspace
ensure_test_workspace()
import main
from fastapi import UploadFile


class ComfyUploadContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_workflow_upload_targets_one_device_and_preserves_remote_identity(self):
        file = UploadFile(filename="source.png", file=io.BytesIO(b"image"))
        response = Mock(status_code=200)
        response.json.return_value = {"name": "source (1).png", "subfolder": "nested", "type": "input"}
        with patch.object(main._provider_implementation, "get_comfyui_instances", return_value={"instances": ["first:8188", "second:8188"]}), patch.object(main._provider_implementation, "get_workflow", return_value={"name": "custom/H3.json"}) as workflow, patch.object(main.requests, "post", return_value=response) as upload:
            result = await main.upload_image(files=[file], workflow_json="custom/H3.json")
        self.assertEqual(1, upload.call_count)
        self.assertEqual("http://first:8188/upload/image", upload.call_args.args[0])
        workflow.assert_called_once_with("custom/H3.json")
        self.assertEqual({"name": "source (1).png", "subfolder": "nested", "type": "input", "backend": "first:8188"}, result["files"][0]["comfy_upload"])
        self.assertEqual("source (1).png", result["files"][0]["comfy_name"])

    async def test_legacy_upload_still_reaches_its_configured_devices(self):
        response = Mock(status_code=200)
        response.json.return_value = {"name": "source.png"}
        with patch.object(main._provider_implementation, "get_comfyui_instances", return_value={"instances": ["first:8188", "second:8188"]}), patch.object(main.requests, "post", return_value=response) as upload:
            result = await main.upload_image(files=[UploadFile(filename="source.png", file=io.BytesIO(b"image"))])
        self.assertEqual(2, upload.call_count)
        self.assertEqual("source.png", result["files"][0]["comfy_name"])


class ComfyActiveRunContractTests(unittest.TestCase):
    def test_refresh_projects_video_and_progress_without_remote_private_data(self):
        target = SimpleNamespace(canvas_id="canvas", node_id="node", operation_id="operation", request_index=0)
        run = SimpleNamespace(id="job", kind="workflow", status="running", owner="actor", target=target, provider_id="comfyui", created_at=1, updated_at=2, public_metadata={
            "type": "comfy", "output_kind": "video", "workflow_json": "custom/H3.json",
            "stage": "comfy-sampling-first", "progress_percent": 50,
            "progress_current": 2, "progress_total": 4, "queue_position": None,
            "backend": "private-host:8188", "unexpected_secret": "private",
        })
        with patch.object(main, "require_current_user", return_value={"id":"actor"}), patch.object(main.CANVAS_SYNC, "read", return_value={}), patch.object(main._GENERATION_RUNS, "active_for_canvas", return_value=[run]):
            result = main.get_active_canvas_generation_runs("canvas")["runs"][0]
        self.assertEqual("video", result["output_kind"])
        self.assertEqual("comfy", result["type"])
        self.assertEqual(50, result["progress_percent"])
        self.assertNotIn("backend", result)
        self.assertNotIn("unexpected_secret", result)


class ComfyDeliveryContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_canvas_comfy_requires_workspace_delivery_and_freezes_video_kind(self):
        payload = main.GenerateRequest(workflow_json="custom/H3.json")
        accepted = SimpleNamespace(id="run", status="queued", deduplicated=False)
        with patch.object(main.os.path, "isfile", return_value=True), patch.object(main, "workflow_path_from_name", return_value="/test/H3.json"), patch.object(main._provider_implementation, "get_workflow", return_value={"capability": {"output_kind": "video"}}), patch.object(main, "_generation_target", return_value=("actor", "key", None)), patch.object(main._GENERATION_RUNS, "start", new=AsyncMock(return_value=accepted)) as start:
            response = await main.create_canvas_comfy_task(payload)
        request = start.call_args.args[0]
        self.assertEqual({"require_managed_media": True}, request.effect_context)
        self.assertEqual("comfyui", request.operation)
        self.assertEqual("video", start.call_args.kwargs["public_metadata"]["output_kind"])
        self.assertEqual("run", response["task_id"])

    async def test_saved_workflow_uses_same_required_workspace_delivery(self):
        payload = main.WorkflowRunRequest(config=main.WorkflowConfig())
        with patch.object(main, "_run_generation_inline", new=AsyncMock(return_value={"videos": ["/assets/output/result.mp4"]})) as execute:
            await main.run_workflow("custom/H3.json", payload)
        request = execute.call_args.args[0]
        self.assertEqual("comfyui-saved", request.operation)
        self.assertEqual({"require_managed_media": True}, request.effect_context)
        self.assertEqual("custom/H3.json", request.payload["name"])
