"""Agent placement acceptance through the real planner and persisted API."""

import asyncio
import copy
import time
import unittest

from infinite_canvas.agent_api import AgentAPI, node_geometry
from infinite_canvas.canvas_realtime import NODE_GAP
from tests import test_agent_api as agent_fixture


class AgentPlacementTests(unittest.TestCase):
    def setUp(self):
        self.api = AgentAPI.__new__(AgentAPI)
        self.api.context = lambda *_: []
        self.actor = {"id": "account"}

    def plan(self, nodes=(), references=(), viewport=None):
        self.api.context = lambda *_: [{"viewport": viewport}] if viewport is not None else []
        canvas = {"id": "canvas", "nodes": copy.deepcopy(list(nodes))}
        before = copy.deepcopy(canvas)
        result = self.api.layout(self.actor, canvas, [], [{"id": "task", "w": 280, "h": 220}],
                                 "frame", "", reference_ids=set(references))
        self.assertEqual(before, canvas, "Planning must never move existing Nodes")
        return result

    def assert_clear(self, frame, obstacles):
        for node in obstacles:
            self.assertFalse(frame["x"] < node["x"] + node["w"] + NODE_GAP
                             and frame["x"] + frame["w"] + NODE_GAP > node["x"]
                             and frame["y"] < node["y"] + node["h"] + NODE_GAP
                             and frame["y"] + frame["h"] + NODE_GAP > node["y"], node["id"])

    def test_reference_anchor_tracks_source_far_from_viewport(self):
        source = {"id": "source", "x": 1200, "y": -100000, "w": 280, "h": 220}
        frame, tasks = self.plan([source], ["source"], {"x": 0, "y": 0, "width": 1000, "height": 600})
        self.assertLess(abs(frame["x"] - source["x"]), 1000)
        self.assertLess(abs(frame["y"] - source["y"]), 1000)
        self.assert_clear(frame, [source])
        self.assertEqual(frame["x"] + NODE_GAP, tasks[0]["x"])

    def test_multiple_references_and_node_order_are_deterministic(self):
        nodes = [{"id": "one", "x": 1000, "y": 2000, "w": 280, "h": 220},
                 {"id": "two", "x": 1000, "y": 2320, "w": 280, "h": 220},
                 {"id": "unrelated", "x": 50000, "y": 0, "w": 280, "h": 220}]
        frame, _ = self.plan(nodes, ["one", "two"])
        reversed_frame, _ = self.plan(list(reversed(nodes)), ["two", "one"])
        self.assertEqual(frame, reversed_frame)
        self.assert_clear(frame, nodes)
        self.assertLess(abs(frame["x"] - 1000), 1000)
        self.assertLess(abs(frame["y"] - 2160), 1000)

    def test_dense_horizontal_obstacles_can_use_vertical_space(self):
        nodes = [{"id": str(i), "x": i * 300 - 15000, "y": 300, "w": 280, "h": 220}
                 for i in range(100)]
        frame, _ = self.plan(nodes, viewport={"x": 0, "y": 0, "width": 1000, "height": 820})
        self.assertLess(abs(frame["x"]), 1000, "A horizontal row must not push the draft far right")
        self.assert_clear(frame, nodes)

    def test_viewport_centers_whole_frame_and_uses_world_coordinates(self):
        for viewport in ({"x": 0, "y": 0, "width": 1000, "height": 600, "scale": 1},
                         {"x": -500, "y": -300, "width": 2000, "height": 1200, "scale": .5}):
            with self.subTest(viewport=viewport):
                frame, _ = self.plan(viewport=viewport)
                self.assertEqual(500, frame["x"] + frame["w"] / 2)
                self.assertEqual(300, frame["y"] + frame["h"] / 2)

    def test_no_editor_origin_is_stable_despite_remote_unrelated_node(self):
        remote = {"id": "remote", "x": 50000, "y": 0, "w": 280, "h": 220}
        empty_frame, _ = self.plan()
        frame, _ = self.plan([remote])
        self.assertEqual(empty_frame, frame)
        self.assertEqual(0, frame["x"] + frame["w"] / 2)
        self.assertEqual(0, frame["y"] + frame["h"] / 2)


class AgentPlacementPersistenceTests(unittest.TestCase):
    def test_creation_readback_selection_and_retry_keep_final_geometry(self):
        fixture = agent_fixture.AgentApiTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        before = fixture.sync.read("canvas-test", fixture.admin)
        body = {"tasks": [fixture.recipe()]}
        trial = fixture.post({**body, "dry_run": True}, key="geometry-trial")
        self.assertEqual(200, trial.status_code, trial.text)
        self.assertEqual(before, fixture.sync.read("canvas-test", fixture.admin))
        response = fixture.post(body, key="geometry-persist")
        self.assertEqual(200, response.status_code, response.text)
        saved = response.json()
        document = fixture.sync.read("canvas-test", fixture.admin)
        lookup = {n["id"]: n for n in document["nodes"]}
        node_id = saved["task_ids"][0]
        self.assertEqual(node_geometry(lookup[saved["frame_id"]]), saved["frame_geometry"])
        self.assertEqual(node_geometry(lookup[node_id]), saved["task_geometries"][node_id])
        self.assertEqual(trial.json()["frame_geometry"], saved["frame_geometry"])
        self.assertEqual(before["nodes"], document["nodes"][:len(before["nodes"])])

        detail = fixture.client.get(f"/api/agent/v1/canvases/canvas-test/tasks/{node_id}").json()
        self.assertEqual(saved["task_geometries"][node_id], detail["geometry"])
        self.assertEqual(saved["frame_geometry"], detail["frame_geometry"])
        canvas_view = fixture.client.get("/api/agent/v1/canvases/canvas-test").json()
        self.assertEqual(detail["geometry"], next(n for n in canvas_view["nodes"] if n["id"] == node_id)["geometry"])
        fixture.api.contexts["editor"] = {"user_id": fixture.admin["id"], "canvas_id": "canvas-test",
            "seen": time.monotonic(), "focused": 1, "selection": [{"node_id": node_id}], "viewport": {}}
        selection = fixture.client.get("/api/agent/v1/canvases/canvas-test/selection").json()
        self.assertEqual(detail["geometry"], selection["selection"][0]["geometry"])

        async def move():
            await fixture.sync.commit_prepared_operation("canvas-test", fixture.admin, "test:move-draft",
                lambda current, receipt: ({"operation_id": "test:move-draft", "base_revision": current["revision"],
                    "changes": {"node_updates": [{"id": node_id, "path": ["x"], "value": 12345}]}}, {}))

        asyncio.run(move())
        retry = fixture.post(body, key="geometry-persist").json()
        self.assertTrue(retry["duplicate"])
        self.assertEqual(saved["task_geometries"], retry["task_geometries"], "Retry returns its original receipt")
        self.assertEqual(len(document["nodes"]), len(fixture.sync.read("canvas-test", fixture.admin)["nodes"]))
        moved = fixture.client.get(f"/api/agent/v1/canvases/canvas-test/tasks/{node_id}").json()
        self.assertEqual(12345, moved["geometry"]["x"], "Independent read returns current persisted geometry")


if __name__ == "__main__":
    unittest.main()
