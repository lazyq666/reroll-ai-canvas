"""Real stdio MCP -> HTTP -> SQLite P0 acceptance; no browser or Provider."""

import asyncio
import base64
import io
import json
import os
from pathlib import Path
import socket
import sys
import threading
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from PIL import Image
import uvicorn

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from tests import test_agent_task_editing as editing


class EditingProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_closed_editor_read_preview_validate_save_restart_and_verify(self):
        fixture = editing.AgentTaskEditingTests()
        await asyncio.to_thread(fixture.setUp)
        listener = socket.socket()
        try:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(fixture.client.app, log_level="error", lifespan="off"))
            thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
            thread.start()
            for _ in range(500):
                if server.started:
                    break
                await asyncio.sleep(.01)
            self.assertTrue(server.started)
            parameters = StdioServerParameters(command=sys.executable,
                args=[str(ROOT / "tools/reroll-mcp/reroll_mcp.py")],
                env={**os.environ, "REROLL_URL": f"http://127.0.0.1:{port}",
                     "REROLL_AGENT_TOKEN": fixture.token["token"], "REROLL_ALLOWED_DIRS": "[]"})
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()

                    async def call(name, arguments):
                        result = await session.call_tool(name, arguments)
                        self.assertFalse(result.isError, result)
                        data = json.loads(result.content[0].text)
                        self.assertNotIn("code", data, data)
                        return data

                    # Exercise the actual capability catalog through the shipped MCP bridge.
                    fixture_resolver = fixture.api.resolve_model
                    fixture.api.resolve_model = fixture.api.catalog.resolve
                    try:
                        capability = await call("get_model_capability", {
                            "provider": "jimeng", "model": "Seedance2.5", "operation": "video.generate",
                        })
                        self.assertEqual({"default": True, "configurable": False}, capability["output"]["audio"])
                        self.assertNotIn("generate_audio", capability["parameters"])
                        self.assertNotIn("generate_audio", capability["authoring"]["parameters"])
                    finally:
                        fixture.api.resolve_model = fixture_resolver

                    await call("use_canvas", {"canvas": "canvas-test"})
                    creation = {"tasks": [{"kind": "video", "prompt": "@hero moves",
                        "model": {"provider_id": "fixture", "model": "video"},
                        "params": {"duration_seconds": 12, "aspect_ratio": "3:4", "resolution": "720p"},
                        "refs": {"hero": {"node": "source-0"}}}], "idempotency_key": "geometry-mcp"}
                    await call("create_generation_tasks", {**creation, "dry_run": True})
                    created = await call("create_generation_tasks", creation)
                    created_id = created["task_ids"][0]
                    created_detail = await call("get_generation_task", {"node_id": created_id})
                    self.assertEqual(created["task_geometries"][created_id], created_detail["geometry"])
                    self.assertEqual(created["frame_geometry"], created_detail["frame_geometry"])
                    summary = await call("get_canvas", {"frame": created["frame_id"]})
                    self.assertEqual(created_detail["geometry"], summary["nodes"][0]["geometry"])
                    before = await call("get_generation_task", {"node_id": "draft"})
                    self.assertEqual(fixture.long_prompt, before["recipe"]["prompt"])
                    self.assertEqual(7, len(before["resolved_inputs"]))
                    self.assertTrue(before["validation"]["valid"])
                    found = await call("search_media", {"query": "参考"})
                    self.assertTrue(found["media"])
                    preview = await session.call_tool("preview_media", {"source": {"node_id": "source-1", "output_id": "chosen"}})
                    self.assertFalse(preview.isError)
                    metadata = json.loads(preview.content[0].text)
                    self.assertEqual("chosen", metadata["output_id"])
                    self.assertEqual("image", preview.content[1].type)
                    pixels = Image.open(io.BytesIO(base64.b64decode(preview.content[1].data)))
                    self.assertEqual((120, 60), pixels.size)
                    self.assertEqual((0, 0, 255, 255), pixels.getpixel((60, 30)))
                    self.assertEqual(0, pixels.getpixel((0, 0))[3])
                    # Six visual inputs and one voice reference, with exact output binding.
                    refs = before["recipe"]["refs"]
                    prompt = "6 人新手局\n" + " ".join("@" + label for label in refs) + "\n" + "完整分镜。\n" * 500 + "文末约束：保留全部人物。"
                    args = {"node_id": "draft", "changes": {"prompt": prompt, "refs": refs},
                            "expected_node_revision": before["node_revision"], "refs_mode": "replace",
                            "idempotency_key": "p0-mcp-save"}
                    snapshot = fixture.document()
                    trial = await call("update_generation_task", {**args, "dry_run": True})
                    self.assertFalse(trial["persisted"])
                    self.assertEqual(snapshot, fixture.document())
                    saved = await call("update_generation_task", args)
                    self.assertTrue(saved["persisted"])
                    self.assertFalse(saved["generation_started"])
                    self.assertEqual(prompt, saved["after"]["recipe"]["prompt"])
                    self.assertEqual(before["recipe"]["params"], saved["after"]["recipe"]["params"])
                    self.assertEqual(7, len(saved["after"]["resolved_inputs"]))
                    retry = await call("update_generation_task", args)
                    self.assertEqual(saved["after"], retry["after"])
            # Independent bridge process; authoritative persisted read, no cached editor.
            completed = {**fixture.node(), "id": "legacy-completed-video",
                "referenceGenerationKind": "image", "generationOutputNode": True,
                "outputKind": "video", "images": [{"url": "/assets/completed.mp4", "kind": "video"}]}
            await asyncio.to_thread(fixture.mutate,
                {"node_creates": [fixture.api.creation(completed)]}, "completed-video")
            persisted_snapshot = fixture.document()
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    created_again = await session.call_tool("get_generation_task", {"canvas": "canvas-test", "node_id": created_id})
                    self.assertEqual(created_detail["geometry"], json.loads(created_again.content[0].text)["geometry"])
                    result = await session.call_tool("get_generation_task", {"canvas": "canvas-test", "node_id": "draft"})
                    current = json.loads(result.content[0].text)
                    self.assertEqual(saved["node_revision"], current["node_revision"])
                    self.assertEqual(saved["after"]["recipe"], current["recipe"])
                    self.assertTrue(current["validation"]["valid"], current["validation"])
                    result = await session.call_tool("get_generation_task", {"canvas": "canvas-test", "node_id": "legacy-completed-video"})
                    completed_detail = json.loads(result.content[0].text)
                    self.assertEqual("video", completed_detail["recipe"]["kind"])
                    self.assertEqual({"provider_id": "fixture", "model": "video"}, completed_detail["recipe"]["model"])
                    self.assertEqual(12, completed_detail["recipe"]["params"]["duration_seconds"])
                    self.assertEqual(persisted_snapshot, fixture.document(), "readback must not migrate history")
            self.assertEqual({}, fixture.api.contexts, "no editor ever connected")
            with fixture.api.data() as state:
                self.assertEqual({}, state["runs"], "saving never queued a generation")
        finally:
            if "server" in locals():
                server.should_exit = True
                await asyncio.to_thread(thread.join, 5)
            listener.close()
            await asyncio.to_thread(fixture.doCleanups)


if __name__ == "__main__":
    unittest.main()
