"""Shipped stdio tools against an isolated real Agent API and SQLite Workspace."""

import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import uvicorn

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from tests import test_agent_image_repairs as repairs


class ImageRepairProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepare_readback_restart_run_and_retry(self):
        fixture = repairs.AgentImageRepairTests()
        await asyncio.to_thread(fixture.setUp)
        listener = socket.socket()
        server = None
        try:
            listener.bind(("127.0.0.1", 0))
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
                env={**os.environ, "REROLL_URL": f"http://127.0.0.1:{listener.getsockname()[1]}",
                     "REROLL_AGENT_TOKEN": fixture.token["token"], "REROLL_ALLOWED_DIRS": "[]"})

            async def call(session, name, args):
                result = await session.call_tool(name, {"canvas": "canvas-test", **args})
                self.assertFalse(result.isError, result)
                data = json.loads(result.content[0].text)
                self.assertNotIn("code", data, data)
                return data

            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    names = {tool.name for tool in (await session.list_tools()).tools}
                    self.assertTrue({"get_image_repair", "update_image_repair", "run_image_repair"} <= names)
                    before = await call(session, "get_image_repair", {"node_id": "source-0"})
                    args = {"node_id": "source-0", "changes": fixture.changes,
                            "expected_revision": before["revision"], "idempotency_key": "prepare"}
                    trial = await call(session, "update_image_repair", args)
                    self.assertFalse(trial["persisted"])
                    self.assertFalse((await call(session, "get_image_repair", {"node_id": "source-0"}))["has_draft"])
                    saved = await call(session, "update_image_repair", {**args, "dry_run": False})
                    self.assertTrue(saved["persisted"])
                    self.assertFalse(saved["generation_started"])
                    after = await call(session, "get_image_repair", {"node_id": "source-0"})
                    self.assertEqual(fixture.changes["prompt"], after["draft"]["prompt"])
                    self.assertEqual(fixture.changes["strokes"][0], after["draft"]["strokes"][0])
                    self.assertEqual(saved["after"]["revision"], after["revision"])
                    retry = await call(session, "update_image_repair", {**args, "dry_run": False})
                    self.assertTrue(retry["duplicate"])
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    after = await call(session, "get_image_repair", {"node_id": "source-0"})
                    args = {"node_id": "source-0", "expected_revision": after["revision"], "idempotency_key": "run"}
                    first = await call(session, "run_image_repair", args)
                    second = await call(session, "run_image_repair", args)
                    self.assertEqual(first["requests"][0]["id"], second["requests"][0]["id"])
                    self.assertEqual("queued", first["requests"][0]["state"])
                    pending = await call(session, "get_image_repair", {"node_id": "source-0"})
                    self.assertEqual(1, len(pending["run_requests"]))
                    self.assertEqual([], pending["run_requests"][0]["output_node_ids"])
        finally:
            if server:
                server.should_exit = True
                await asyncio.to_thread(thread.join, 5)
            listener.close()
            await asyncio.to_thread(fixture.doCleanups)
