import copy
import json
import math
import platform
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

from infinite_canvas.canvas_store import (
    CanvasIntent,
    CanvasProjection,
    CanvasStoreError,
    SqliteCanvasStore,
)


ADMIN = {
    "id": "admin-1",
    "username": "admin",
    "role": "admin",
    "status": "active",
}
DESIGNER = {
    "id": "designer-1",
    "username": "designer",
    "role": "designer",
    "status": "active",
    "project_ids": ["default"],
}


def representative_canvas():
    payload = "p" * 6650
    nodes = [
        {
            "id": f"node-{index:03d}",
            "type": "smart-prompt" if index % 2 else "smart-image",
            "x": index * 10,
            "y": index * -5,
            "prompt": payload,
            "metadata": {"fixture": True, "index": index},
        }
        for index in range(461)
    ]
    connections = [
        {
            "from": f"node-{index:03d}",
            "to": f"node-{index + 1:03d}",
            "kind": "input",
        }
        for index in range(321)
    ]
    return {
        "id": "canvas-fast-path",
        "kind": "smart",
        "title": "Representative Canvas",
        "icon": "sparkles",
        "owner_id": ADMIN["id"],
        "owner_username": ADMIN["username"],
        "visibility": "shared",
        "created_by": ADMIN["id"],
        "updated_by": ADMIN["id"],
        "owner": "Performance Fixture",
        "color": "blue",
        "pinned": False,
        "project": "default",
        "created_at": 1,
        "updated_at": 1,
        "revision": 0,
        "settings": {"quality": "high"},
        "extensionPayload": {"preserved": True},
        "nodes": nodes,
        "connections": connections,
    }


def behavior_canvas(canvas_id="canvas-fast-path"):
    canvas = representative_canvas()
    canvas.update(
        {
            "id": canvas_id,
            "title": "Behavior Canvas",
            "extensionPayload": {"preserved": True},
            "nodes": [
                {
                    "id": "node-a",
                    "type": "smart-image",
                    "x": 10,
                    "y": 20,
                    "width": 300,
                    "metadata": {"prompt": "private fixture text"},
                },
                {
                    "id": "node-b",
                    "type": "smart-prompt",
                    "x": 30,
                    "y": 40,
                    "title": "Prompt",
                },
                {
                    "id": "group-a",
                    "type": "smart-group",
                    "x": 0,
                    "y": 0,
                    "items": ["node-a"],
                },
                {
                    "id": "frame-a",
                    "type": "smart-frame",
                    "x": -100,
                    "y": -100,
                    "width": 1000,
                    "height": 1000,
                },
            ],
            "connections": [
                {"from": "node-a", "to": "node-b", "kind": "input"}
            ],
        }
    )
    return canvas


class CanvasStoreSingleNodeMoveBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "canvas-content.sqlite3"
        self.store = SqliteCanvasStore(
            self.database,
            workspace_id="synthetic-behavior-workspace",
            now_ms=lambda: 1234,
        )
        self.canvas = behavior_canvas()
        self.store.commit(
            self.canvas["id"],
            ADMIN,
            CanvasIntent.import_canvas(
                self.canvas,
                operation_id="fixture:behavior-import",
            ),
        )

    def tearDown(self):
        self.temporary.cleanup()

    def snapshot(self):
        return self.store.read(
            self.canvas["id"],
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas

    def mutate(
        self,
        operation_id,
        base_revision,
        changes=None,
        *,
        actor=ADMIN,
        reverts_operation_id="",
    ):
        operation = {
            "operation_id": operation_id,
            "base_revision": base_revision,
        }
        if reverts_operation_id:
            operation["reverts_operation_id"] = reverts_operation_id
        else:
            operation["changes"] = changes or {}
        return self.store.commit(
            self.canvas["id"],
            actor,
            CanvasIntent.canvas_mutation(operation),
        )

    def test_x_y_and_combined_moves_preserve_the_rest_of_the_canvas(self):
        before = self.snapshot()

        first = self.mutate(
            "move:node-a-x-only",
            0,
            {"node_updates": [{"id": "node-a", "path": ["x"], "value": 0}]},
        )
        second = self.mutate(
            "move:node-a-y-only",
            0,
            {
                "node_updates": [
                    {"id": "node-a", "path": ["y"], "value": -12.5}
                ]
            },
        )
        third = self.mutate(
            "move:node-b-both",
            2,
            {
                "node_updates": [
                    {"id": "node-b", "path": ["x"], "value": 44.25},
                    {"id": "node-b", "path": ["y"], "value": -0.0},
                ]
            },
        )

        after = self.snapshot()
        nodes = {node["id"]: node for node in after["nodes"]}
        self.assertEqual([first.revision, second.revision, third.revision], [1, 2, 3])
        self.assertEqual((nodes["node-a"]["x"], nodes["node-a"]["y"]), (0, -12.5))
        self.assertEqual((nodes["node-b"]["x"], nodes["node-b"]["y"]), (44.25, -0.0))
        self.assertEqual(nodes["node-a"]["metadata"], before["nodes"][0]["metadata"])
        self.assertEqual(after["connections"], before["connections"])
        self.assertEqual(after["settings"], before["settings"])
        self.assertEqual(after["extensionPayload"], before["extensionPayload"])
        self.assertEqual(third.event["changes"]["node_updates"], [
            {"id": "node-b", "path": ["x"], "value": 44.25},
            {"id": "node-b", "path": ["y"], "value": -0.0},
        ])
        self.assertEqual(self.store.integrity()["counts"]["mutations"], 3)
        self.assertEqual(self.store.integrity()["counts"]["events"], 3)

    def test_receipt_retry_collision_revision_and_permission_errors_are_unchanged(self):
        intent = CanvasIntent.canvas_mutation(
            {
                "operation_id": "move:receipt-boundary",
                "base_revision": 0,
                "changes": {
                    "node_updates": [
                        {"id": "node-a", "path": ["x"], "value": 101}
                    ]
                },
            }
        )
        first = self.store.commit(self.canvas["id"], ADMIN, intent)
        duplicate = self.store.commit(self.canvas["id"], ADMIN, intent)

        self.assertEqual(first.revision, 1)
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(duplicate.revision, 1)
        self.assertTrue(all(not entries for entries in duplicate.event["changes"].values()))
        self.assertEqual(self.store.integrity()["counts"]["events"], 1)

        changed = copy.deepcopy(intent.payload["operation"])
        changed["changes"]["node_updates"][0]["value"] = 102
        for actor, operation in ((ADMIN, changed), (DESIGNER, intent.payload["operation"])):
            with self.subTest(actor=actor["id"]):
                with self.assertRaises(CanvasStoreError) as rejected:
                    self.store.commit(
                        self.canvas["id"],
                        actor,
                        CanvasIntent.canvas_mutation(operation),
                    )
                self.assertEqual(rejected.exception.code, "operation_collision")

        with self.assertRaises(CanvasStoreError) as ahead:
            self.mutate(
                "move:revision-ahead",
                9,
                {"node_updates": [{"id": "node-a", "path": ["y"], "value": 3}]},
            )
        self.assertEqual((ahead.exception.code, ahead.exception.revision), ("revision_ahead", 1))

        with self.assertRaises(CanvasStoreError) as missing:
            self.mutate(
                "move:deleted-node",
                1,
                {"node_updates": [{"id": "missing", "path": ["x"], "value": 3}]},
            )
        self.assertEqual((missing.exception.code, missing.exception.revision), ("node_deleted", 1))

        denied = {**DESIGNER, "project_ids": []}
        with self.assertRaises(CanvasStoreError) as forbidden:
            self.mutate(
                "move:permission-denied",
                1,
                {"node_updates": [{"id": "node-a", "path": ["y"], "value": 3}]},
                actor=denied,
            )
        self.assertEqual(forbidden.exception.code, "not_found")
        self.assertEqual(self.snapshot()["revision"], 1)

    def test_field_level_collaboration_and_undo_keep_existing_semantics(self):
        moved_x = self.mutate(
            "move:admin-x",
            0,
            {"node_updates": [{"id": "node-a", "path": ["x"], "value": 111}]},
        )
        moved_y = self.mutate(
            "move:designer-y",
            0,
            {"node_updates": [{"id": "node-a", "path": ["y"], "value": -222}]},
            actor=DESIGNER,
        )
        with self.assertLogs("infinite_canvas.canvas_store", level="DEBUG") as captured:
            undone_x = self.mutate(
                "move:admin-undo-x",
                moved_y.revision,
                reverts_operation_id=moved_x.operation_id,
            )
        trace = json.loads(captured.records[-1].getMessage().split(" ", 1)[1])

        node = self.snapshot()["nodes"][0]
        self.assertEqual(undone_x.revision, 3)
        self.assertEqual((node["x"], node["y"]), (10, -222))
        self.assertEqual((trace["hit"], trace["fallback"]), (False, "undo"))

        first_x = self.mutate(
            "move:admin-x-again",
            3,
            {"node_updates": [{"id": "node-a", "path": ["x"], "value": 333}]},
        )
        latest_x = self.mutate(
            "move:designer-x-later",
            3,
            {"node_updates": [{"id": "node-a", "path": ["x"], "value": 444}]},
            actor=DESIGNER,
        )
        with self.assertRaises(CanvasStoreError) as conflict:
            self.mutate(
                "move:admin-unsafe-undo",
                latest_x.revision,
                reverts_operation_id=first_x.operation_id,
            )
        self.assertEqual(conflict.exception.code, "undo_conflict")
        self.assertEqual(self.snapshot()["nodes"][0]["x"], 444)

    def test_unknown_or_internal_metadata_falls_back_without_partial_write(self):
        operation = {
            "operation_id": "move:unknown-action",
            "base_revision": 0,
            "changes": {
                "node_updates": [
                    {"id": "node-a", "path": ["x"], "value": 77}
                ],
                "future_action": [{"opaque": True}],
            },
        }
        with self.assertLogs("infinite_canvas.canvas_store", level="DEBUG") as captured:
            committed = self.store.commit(
                self.canvas["id"],
                ADMIN,
                CanvasIntent.canvas_mutation(operation),
            )
        trace = json.loads(captured.records[-1].getMessage().split(" ", 1)[1])
        self.assertEqual((trace["eligible"], trace["hit"], trace["fallback"]), (False, False, "unknown_action"))
        self.assertEqual(committed.revision, 1)
        self.assertEqual(self.snapshot()["nodes"][0]["x"], 77)

        before = self.snapshot()
        with self.assertLogs("infinite_canvas.canvas_store", level="DEBUG") as captured:
            with self.assertRaises(CanvasStoreError) as rejected:
                self.mutate(
                    "move:internal-metadata",
                    1,
                    {
                        "node_updates": [
                            {
                                "id": "node-a",
                                "path": ["x"],
                                "value": 88,
                                "if_operation": "client-supplied-lineage",
                            }
                        ]
                    },
                )
        trace = json.loads(captured.records[-1].getMessage().split(" ", 1)[1])
        self.assertEqual(trace["fallback"], "node_update_metadata")
        self.assertEqual(rejected.exception.code, "invalid_changes")
        self.assertEqual(self.snapshot(), before)

    def test_fallback_matrix_keeps_generic_mutations_atomic(self):
        cases = [
            (
                "multiple_nodes",
                {
                    "node_updates": [
                        {"id": "node-a", "path": ["x"], "value": 1},
                        {"id": "node-b", "path": ["y"], "value": 2},
                    ]
                },
            ),
            ("non_position_field", {"node_updates": [{"id": "node-a", "path": ["width"], "value": 320}]}),
            ("node_unsets", {"node_unsets": [{"id": "node-a", "path": ["width"]}]}),
            ("node_creates", {"node_creates": [{"id": "node-new", "type": "smart-image", "x": 1, "y": 2}]}),
            ("connection_adds", {"connection_adds": [{"from": "node-b", "to": "node-a", "kind": "flow"}]}),
            ("canvas_updates", {"canvas_updates": [{"path": ["title"], "value": "Changed"}]}),
            ("non_position_field", {"node_updates": [{"id": "group-a", "path": ["items"], "value": ["node-a", "node-b"]}]}),
            ("non_position_field", {"node_updates": [{"id": "frame-a", "path": ["width"], "value": 1200}]}),
            ("node_deletes", {"node_deletes": ["node-new"]}),
        ]
        revision = 0
        for index, (expected_fallback, changes) in enumerate(cases):
            with self.subTest(fallback=expected_fallback):
                with self.assertLogs("infinite_canvas.canvas_store", level="DEBUG") as captured:
                    committed = self.mutate(
                        f"fallback:case-{index:02d}",
                        revision,
                        changes,
                    )
                trace = json.loads(captured.records[-1].getMessage().split(" ", 1)[1])
                self.assertFalse(trace["hit"])
                self.assertEqual(trace["fallback"], expected_fallback)
                revision = committed.revision
        self.assertEqual(self.snapshot()["revision"], len(cases))
        self.assertEqual(self.store.integrity()["counts"]["events"], len(cases))

    def test_storage_stage_failures_roll_back_node_revision_history_event_and_receipt(self):
        failure_points = (
            ("node", "UPDATE", "canvas_nodes"),
            ("revision", "UPDATE", "canvases"),
            ("realtime", "UPDATE", "canvas_realtime_state"),
            ("history", "INSERT", "canvas_mutations"),
            ("event", "INSERT", "canvas_events"),
            ("receipt", "INSERT", "canvas_operation_receipts"),
        )
        for name, action, table in failure_points:
            with self.subTest(stage=name):
                with sqlite3.connect(str(self.database)) as connection:
                    connection.execute(
                        f"""
                        CREATE TRIGGER fail_{name}
                        BEFORE {action} ON {table}
                        BEGIN
                            SELECT RAISE(ABORT, 'injected failure');
                        END
                        """
                    )
                    connection.commit()
                before = self.snapshot()
                with self.assertRaises(CanvasStoreError) as rejected:
                    self.mutate(
                        f"rollback:{name}",
                        0,
                        {"node_updates": [{"id": "node-a", "path": ["x"], "value": 999}]},
                    )
                self.assertEqual(rejected.exception.code, "constraint_violation")
                self.assertEqual(self.snapshot(), before)
                self.assertEqual(self.store.integrity()["counts"]["mutations"], 0)
                self.assertEqual(self.store.integrity()["counts"]["events"], 0)
                with sqlite3.connect(str(self.database)) as connection:
                    connection.execute(f"DROP TRIGGER fail_{name}")

    def test_fast_and_forced_generic_paths_have_equivalent_public_results_and_undo(self):
        second_database = Path(self.temporary.name) / "generic.sqlite3"
        generic_store = SqliteCanvasStore(
            second_database,
            workspace_id="synthetic-generic-workspace",
            now_ms=lambda: 1234,
        )
        generic_store.commit(
            self.canvas["id"],
            ADMIN,
            CanvasIntent.import_canvas(
                self.canvas,
                operation_id="fixture:generic-import",
            ),
        )
        fast_operation = {
            "operation_id": "equivalence:fast-move",
            "base_revision": 0,
            "changes": {
                "node_updates": [
                    {"id": "group-a", "path": ["x"], "value": -45.5},
                    {"id": "group-a", "path": ["y"], "value": 91},
                ]
            },
        }
        generic_operation = copy.deepcopy(fast_operation)
        generic_operation["operation_id"] = "equivalence:generic-move"
        generic_operation["changes"]["future_action"] = []

        fast = self.store.commit(
            self.canvas["id"], ADMIN, CanvasIntent.canvas_mutation(fast_operation)
        )
        generic = generic_store.commit(
            self.canvas["id"], ADMIN, CanvasIntent.canvas_mutation(generic_operation)
        )
        fast_snapshot = self.snapshot()
        generic_snapshot = generic_store.read(
            self.canvas["id"], ADMIN, CanvasProjection.public_snapshot()
        ).canvas

        self.assertEqual(fast_snapshot, generic_snapshot)
        self.assertEqual(fast.event["changes"], generic.event["changes"])
        self.assertEqual(fast.revision, generic.revision)

        self.mutate(
            "equivalence:fast-undo",
            fast.revision,
            reverts_operation_id=fast.operation_id,
        )
        generic_store.commit(
            self.canvas["id"],
            ADMIN,
            CanvasIntent.canvas_mutation(
                {
                    "operation_id": "equivalence:generic-undo",
                    "base_revision": generic.revision,
                    "reverts_operation_id": generic.operation_id,
                }
            ),
        )
        self.assertEqual(
            self.snapshot(),
            generic_store.read(
                self.canvas["id"], ADMIN, CanvasProjection.public_snapshot()
            ).canvas,
        )

    def test_history_trims_at_two_hundred_and_survives_store_reopen(self):
        revision = 0
        for index in range(205):
            revision = self.mutate(
                f"history:move-{index:04d}",
                revision,
                {"node_updates": [{"id": "node-a", "path": ["x"], "value": index}]},
            ).revision

        self.assertEqual(self.store.integrity()["counts"]["mutations"], 200)
        reopened = SqliteCanvasStore(
            self.database,
            workspace_id="synthetic-behavior-workspace",
            now_ms=lambda: 1234,
        )
        self.assertEqual(
            reopened.read(
                self.canvas["id"], ADMIN, CanvasProjection.public_snapshot()
            ).canvas["nodes"][0]["x"],
            204,
        )
        with self.assertRaises(CanvasStoreError) as expired:
            reopened.commit(
                self.canvas["id"],
                ADMIN,
                CanvasIntent.canvas_mutation(
                    {
                        "operation_id": "history:undo-expired",
                        "base_revision": revision,
                        "reverts_operation_id": "history:move-0000",
                    }
                ),
            )
        self.assertEqual(expired.exception.code, "undo_not_found")
        undone = reopened.commit(
            self.canvas["id"],
            ADMIN,
            CanvasIntent.canvas_mutation(
                {
                    "operation_id": "history:undo-latest",
                    "base_revision": revision,
                    "reverts_operation_id": "history:move-0204",
                }
            ),
        )
        self.assertEqual(undone.revision, 206)
        self.assertEqual(
            reopened.read(
                self.canvas["id"], ADMIN, CanvasProjection.public_snapshot()
            ).canvas["nodes"][0]["x"],
            203,
        )

    def test_timing_trace_is_sanitized_and_identifies_a_hit(self):
        with self.assertLogs("infinite_canvas.canvas_store", level="DEBUG") as captured:
            self.mutate(
                "trace:sanitized-move",
                0,
                {"node_updates": [{"id": "node-a", "path": ["x"], "value": 55}]},
            )
        message = captured.records[-1].getMessage()
        trace = json.loads(message.split(" ", 1)[1])

        self.assertTrue(trace["eligible"])
        self.assertTrue(trace["hit"])
        self.assertEqual(trace["fallback"], "")
        self.assertIn("total_ms", trace)
        self.assertIn("transaction_commit_ms", trace)
        self.assertNotIn("node-a", message)
        self.assertNotIn("trace:sanitized-move", message)
        self.assertNotIn("private fixture text", message)


class CanvasStoreSingleNodeMovePerformanceTests(unittest.TestCase):
    def test_representative_canvas_move_workload_records_diagnostic_latency(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "canvas-content.sqlite3"
            store = SqliteCanvasStore(
                database,
                workspace_id="synthetic-performance-workspace",
            )
            canvas = representative_canvas()
            store.commit(
                canvas["id"],
                ADMIN,
                CanvasIntent.import_canvas(
                    canvas,
                    operation_id="fixture:import-canvas",
                ),
            )

            revision = 0
            for index in range(200):
                commit = store.commit(
                    canvas["id"],
                    ADMIN,
                    CanvasIntent.canvas_mutation(
                        {
                            "operation_id": f"fixture:history-{index:04d}",
                            "base_revision": revision,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": "node-000",
                                        "path": ["x"],
                                        "value": index,
                                    }
                                ]
                            },
                        }
                    ),
                )
                revision = commit.revision

            latencies_ms = []
            for index in range(25):
                started_ns = time.perf_counter_ns()
                commit = store.commit(
                    canvas["id"],
                    ADMIN,
                    CanvasIntent.canvas_mutation(
                        {
                            "operation_id": f"fixture:measured-{index:04d}",
                            "base_revision": revision,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": "node-000",
                                        "path": ["y"],
                                        "value": -index - 0.5,
                                    }
                                ]
                            },
                        }
                    ),
                )
                latencies_ms.append(
                    (time.perf_counter_ns() - started_ns) / 1_000_000
                )
                revision = commit.revision

            ordered = sorted(latencies_ms)
            p95_ms = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
            fixture_manifest = {
                "node_count": len(canvas["nodes"]),
                "connection_count": len(canvas["connections"]),
                "history_count": 200,
                "node_payload_bytes": sum(
                    len(str(node).encode("utf-8")) for node in canvas["nodes"]
                ),
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "samples": len(latencies_ms),
                "p50_ms": ordered[len(ordered) // 2],
                "p95_ms": p95_ms,
                "p99_ms": ordered[max(0, math.ceil(len(ordered) * 0.99) - 1)],
            }

            self.assertEqual(461, fixture_manifest["node_count"])
            self.assertEqual(321, fixture_manifest["connection_count"])
            self.assertGreaterEqual(fixture_manifest["node_payload_bytes"], 3_000_000)
            self.assertEqual(25, fixture_manifest["samples"])
            self.assertEqual(224, revision)
            self.assertGreater(p95_ms, 0, fixture_manifest)


if __name__ == "__main__":
    unittest.main()
