"""Issue #22 uses the existing atomic operation, ordering and safe Undo seam."""
import copy
import unittest

from infinite_canvas.canvas_realtime import CanvasRealtimeError, apply_operation, public_snapshot
from tests.test_canvas_realtime import operation


class MultiInputRealtimeTests(unittest.TestCase):
    def setUp(self):
        self.canvas = {
            "id": "multi-input", "kind": "smart", "title": "Canvas", "revision": 0,
            "nodes": [{"id": name, "type": "smart-image", "x": index * 300, "y": 0}
                      for index, name in enumerate(("a", "b", "c", "d"))],
            "connections": [], "settings": {},
        }

    def create(self):
        return operation("batch:create", 0, node_creates=[{
            "id": "target", "type": "smart-image", "x": 1400, "y": 0,
            "referenceGenerationKind": "image", "inputNodeIds": ["a", "b"],
        }], connection_adds=[
            {"from": "a", "to": "target", "kind": "input", "sourceOutputId": "out-a"},
            {"from": "b", "to": "target", "kind": "input"},
        ])

    def test_create_retry_undo_redo_and_snapshot_preserve_identity_and_order(self):
        request = self.create()
        apply_operation(self.canvas, request, "editor-a")
        original = public_snapshot(self.canvas)
        retry = apply_operation(self.canvas, request, "editor-a")
        self.assertTrue(retry.duplicate)
        self.assertEqual(self.canvas["revision"], 1)
        apply_operation(self.canvas, {"operation_id": "batch:undo", "base_revision": 1,
                                    "reverts_operation_id": "batch:create"}, "editor-a")
        self.assertEqual(len(self.canvas["nodes"]), 4)
        self.assertEqual(self.canvas["connections"], [])
        apply_operation(self.canvas, {"operation_id": "batch:redo", "base_revision": 2,
                                    "reverts_operation_id": "batch:undo"}, "editor-a")
        restored = public_snapshot(self.canvas)
        self.assertEqual(restored["nodes"], original["nodes"])
        self.assertEqual(restored["connections"], original["connections"])

    def test_deleted_source_rejects_entire_new_target_and_all_connections(self):
        apply_operation(self.canvas, operation("batch:delete", 0, node_deletes=["b"]), "editor-b")
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(self.canvas, self.create(), "editor-a")
        self.assertEqual(rejected.exception.code, "invalid_connection")
        self.assertEqual(self.canvas, before)

    def test_two_stale_append_blocks_keep_server_order_and_deduplicate_existing_inputs(self):
        apply_operation(self.canvas, self.create(), "editor-a")
        for name, inputs in (("append-c", ["a", "c"]), ("append-d", ["b", "d"])):
            apply_operation(self.canvas, operation(name, 1, connection_adds=[
                {"from": node_id, "to": "target", "kind": "input"} for node_id in inputs
            ]), name)
        self.assertEqual([edge["from"] for edge in self.canvas["connections"]], ["a", "b", "c", "d"])
        apply_operation(self.canvas, {"operation_id": "batch:undo-c", "base_revision": 3,
                                    "reverts_operation_id": "append-c"}, "append-c")
        self.assertEqual([edge["from"] for edge in self.canvas["connections"]], ["a", "b", "d"])

    def test_other_editor_cannot_revert_the_batch(self):
        apply_operation(self.canvas, self.create(), "editor-a")
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(self.canvas, {"operation_id": "foreign-undo", "base_revision": 1,
                                        "reverts_operation_id": "batch:create"}, "editor-b")
        self.assertEqual(rejected.exception.code, "undo_forbidden")
        self.assertEqual(self.canvas, before)
