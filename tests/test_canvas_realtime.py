import copy
import unittest
from unittest.mock import patch

from infinite_canvas import canvas_realtime
from infinite_canvas.canvas_realtime import (
    CanvasRealtimeError,
    apply_operation,
    public_snapshot,
    realtime_enabled,
)


def changes(**values):
    base = {
        "node_creates": [],
        "node_updates": [],
        "node_unsets": [],
        "node_deletes": [],
        "connection_adds": [],
        "connection_removes": [],
        "canvas_updates": [],
        "canvas_unsets": [],
    }
    base.update(values)
    return base


def operation(operation_id, base_revision, **change_values):
    return {
        "operation_id": operation_id,
        "base_revision": base_revision,
        "changes": changes(**change_values),
    }


class CanvasRealtimeTests(unittest.TestCase):
    def test_undo_restore_replans_when_confirmed_node_occupies_original_slot(self):
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:create-restorable",
                0,
                node_creates=[
                    {
                        "id": "restorable-1",
                        "type": "smart-prompt",
                        "x": 2000,
                        "y": 2000,
                        "w": 316,
                        "h": 180,
                    },
                    {
                        "id": "restorable-2",
                        "type": "smart-prompt",
                        "x": 2000,
                        "y": 2276,
                        "w": 316,
                        "h": 180,
                    },
                ],
            ),
            "actor-a",
        )
        deleted = apply_operation(
            self.canvas,
            operation(
                "client-a:delete-restorable",
                created.revision,
                node_deletes=["restorable-1", "restorable-2"],
            ),
            "actor-a",
        )
        occupied = apply_operation(
            self.canvas,
            operation(
                "client-b:occupy-restorable-slot",
                deleted.revision,
                node_creates=[{
                    "id": "occupant",
                    "type": "smart-prompt",
                    "x": 2000,
                    "y": 2000,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-b",
        )

        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-delete-conflict",
                    "base_revision": occupied.revision,
                    "reverts_operation_id": deleted.operation_id,
                },
                "actor-a",
            )

        self.assertEqual(rejected.exception.code, "placement_conflict")
        retry_changes = rejected.exception.retry_changes
        self.assertEqual(
            [entry["id"] for entry in retry_changes["node_creates"]],
            ["restorable-1", "restorable-2"],
        )
        self.assertEqual(self.node("occupant")["x"], 2000)
        self.assertFalse(any(node["id"].startswith("restorable-") for node in self.canvas["nodes"]))

        restored = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-delete-replanned",
                "base_revision": occupied.revision,
                "reverts_operation_id": deleted.operation_id,
                "placement_overrides": {
                    "restorable-1": {"x": 2516, "y": 2000},
                    "restorable-2": {"x": 2516, "y": 2276},
                },
            },
            "actor-a",
        )
        self.assertEqual(restored.reverts_operation_id, deleted.operation_id)
        self.assertEqual((self.node("restorable-1")["x"], self.node("restorable-1")["y"]), (2516, 2000))
        self.assertEqual((self.node("restorable-2")["x"], self.node("restorable-2")["y"]), (2516, 2276))
        self.assertEqual((self.node("occupant")["x"], self.node("occupant")["y"]), (2000, 2000))

    def test_stale_node_creation_is_rejected_for_client_replacement_retry(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:placement-1",
                0,
                node_creates=[{
                    "id": "created-a",
                    "type": "smart-prompt",
                    "x": 400,
                    "y": 0,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-a",
        )
        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(
                self.canvas,
                operation(
                    "client-b:placement-1",
                    0,
                    node_creates=[{
                        "id": "created-b",
                        "type": "smart-prompt",
                        "x": 400,
                        "y": 0,
                        "w": 316,
                        "h": 180,
                    }],
                ),
                "actor-b",
            )
        self.assertEqual(first.revision, 1)
        self.assertEqual(rejected.exception.code, "placement_conflict")
        self.assertFalse(any(node["id"] == "created-b" for node in self.canvas["nodes"]))
        retried = apply_operation(
            self.canvas,
            operation(
                "client-b:placement-2",
                1,
                node_creates=[{
                    "id": "created-b",
                    "type": "smart-prompt",
                    "x": 916,
                    "y": 0,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-b",
        )
        self.assertEqual(retried.revision, 2)

    def test_stale_node_creation_is_accepted_after_unrelated_node_move(self):
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:move-unrelated",
                0,
                node_updates=[{
                    "id": "node-a",
                    "path": ["x"],
                    "value": 1200,
                }],
            ),
            "actor-a",
        )

        created = apply_operation(
            self.canvas,
            operation(
                "client-b:create-after-unrelated-move",
                0,
                node_creates=[{
                    "id": "created-b",
                    "type": "smart-prompt",
                    "x": 2000,
                    "y": 2000,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-b",
        )

        self.assertEqual(moved.revision, 1)
        self.assertEqual(created.revision, 2)
        self.assertEqual(
            (self.node("created-b")["x"], self.node("created-b")["y"]),
            (2000, 2000),
        )

    def test_stale_node_creation_is_rejected_when_node_moves_into_target(self):
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:move-into-target",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 2000},
                    {"id": "node-a", "path": ["y"], "value": 2000},
                ],
            ),
            "actor-a",
        )

        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(
                self.canvas,
                operation(
                    "client-b:create-in-moved-target",
                    0,
                    node_creates=[{
                        "id": "created-b",
                        "type": "smart-prompt",
                        "x": 2000,
                        "y": 2000,
                        "w": 316,
                        "h": 180,
                    }],
                ),
                "actor-b",
            )

        self.assertEqual(moved.revision, 1)
        self.assertEqual(rejected.exception.code, "placement_conflict")
        self.assertFalse(any(node["id"] == "created-b" for node in self.canvas["nodes"]))

    def test_stale_node_creation_remains_safe_beyond_retained_history(self):
        for index in range(canvas_realtime.REALTIME_HISTORY_LIMIT + 5):
            apply_operation(
                self.canvas,
                operation(
                    f"client-a:move-{index:04d}",
                    index,
                    node_updates=[{
                        "id": "node-a",
                        "path": ["x"],
                        "value": 1200 + index,
                    }],
                ),
                "actor-a",
            )

        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(
                self.canvas,
                operation(
                    "client-b:create-in-old-moved-target",
                    0,
                    node_creates=[{
                        "id": "colliding",
                        "type": "smart-prompt",
                        "x": 1404,
                        "y": 20,
                        "w": 316,
                        "h": 180,
                    }],
                ),
                "actor-b",
            )
        created = apply_operation(
            self.canvas,
            operation(
                "client-b:create-away-from-old-history",
                0,
                node_creates=[{
                    "id": "non-colliding",
                    "type": "smart-prompt",
                    "x": 5000,
                    "y": 5000,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-b",
        )

        self.assertEqual(rejected.exception.code, "placement_conflict")
        self.assertEqual(
            created.revision,
            canvas_realtime.REALTIME_HISTORY_LIMIT + 6,
        )
        self.assertEqual(
            (
                self.node("non-colliding")["x"],
                self.node("non-colliding")["y"],
            ),
            (5000, 5000),
        )

    def test_stale_batch_creation_is_rejected_atomically(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:batch-winner",
                0,
                node_creates=[{
                    "id": "winner",
                    "type": "smart-prompt",
                    "x": 400,
                    "y": 0,
                    "w": 316,
                    "h": 180,
                }],
            ),
            "actor-a",
        )
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as rejected:
            apply_operation(
                self.canvas,
                operation(
                    "client-b:batch-loser",
                    0,
                    node_creates=[
                        {
                            "id": "batch-1",
                            "type": "smart-image",
                            "x": 400,
                            "y": 0,
                            "w": 200,
                            "h": 100,
                        },
                        {
                            "id": "batch-2",
                            "type": "smart-image",
                            "x": 400,
                            "y": 148,
                            "w": 200,
                            "h": 100,
                        },
                    ],
                ),
                "actor-b",
            )
        self.assertEqual(rejected.exception.code, "placement_conflict")
        self.assertEqual(self.canvas, before)

    def setUp(self):
        self.canvas = {
            "id": "canvas-1",
            "kind": "smart",
            "title": "Realtime",
            "revision": 0,
            "viewport": {"x": 1, "y": 2, "scale": 3},
            "nodes": [
                {
                    "id": "node-a",
                    "type": "smart-image",
                    "x": 10,
                    "y": 20,
                    "title": "A",
                },
                {
                    "id": "node-b",
                    "type": "smart-prompt",
                    "x": 50,
                    "y": 60,
                    "title": "B",
                },
            ],
            "connections": [],
            "settings": {},
        }

    def node(self, node_id):
        return next(
            node for node in self.canvas["nodes"] if node["id"] == node_id
        )

    def test_parallel_fields_merge_in_server_order(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:0001",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 120}
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-b:0001",
                0,
                node_updates=[
                    {
                        "id": "node-b",
                        "path": ["title"],
                        "value": "Renamed",
                    }
                ],
            ),
            "actor-b",
        )
        self.assertEqual(first.revision, 1)
        self.assertEqual(second.revision, 2)
        self.assertEqual(self.node("node-a")["x"], 120)
        self.assertEqual(self.node("node-b")["title"], "Renamed")

    def test_same_field_is_last_server_operation_wins(self):
        undo = apply_operation(
            self.canvas,
            operation(
                "client-a:0002",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["title"], "value": "One"}
                ],
            ),
            "actor-a",
        )
        undo = apply_operation(
            self.canvas,
            operation(
                "client-b:0002",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["title"], "value": "Two"}
                ],
            ),
            "actor-b",
        )
        self.assertEqual(self.node("node-a")["title"], "Two")
        self.assertEqual(self.canvas["revision"], 2)

    def test_duplicate_operation_is_idempotent(self):
        payload = operation(
            "client-a:0003",
            0,
            node_creates=[
                {"id": "node-c", "type": "smart-image", "x": 1, "y": 2}
            ],
        )
        accepted = apply_operation(self.canvas, payload, "actor-a")
        duplicate = apply_operation(self.canvas, payload, "actor-a")
        self.assertFalse(accepted.duplicate)
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(self.canvas["revision"], 1)
        self.assertEqual(
            sum(node["id"] == "node-c" for node in self.canvas["nodes"]),
            1,
        )
        with self.assertRaisesRegex(
            CanvasRealtimeError,
            "Mutation 内容不一致",
        ):
            apply_operation(
                self.canvas,
                operation(
                    "client-a:0003",
                    1,
                    node_creates=[
                        {
                            "id": "node-d",
                            "type": "smart-image",
                            "x": 3,
                            "y": 4,
                        }
                    ],
                ),
                "actor-a",
            )

    def test_delete_tombstone_rejects_late_update_and_recreate(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:0004",
                0,
                node_deletes=["node-a"],
            ),
            "actor-a",
        )
        before = copy.deepcopy(self.canvas)
        with self.assertRaisesRegex(CanvasRealtimeError, "目标 Node 已删除"):
            apply_operation(
                self.canvas,
                operation(
                    "client-b:0004",
                    0,
                    node_updates=[
                        {"id": "node-a", "path": ["x"], "value": 999}
                    ],
                ),
                "actor-b",
            )
        self.assertEqual(self.canvas, before)
        with self.assertRaisesRegex(CanvasRealtimeError, "不能被迟到操作重新创建"):
            apply_operation(
                self.canvas,
                operation(
                    "client-b:0005",
                    1,
                    node_creates=[{"id": "node-a", "type": "smart-image"}],
                ),
                "actor-b",
            )

    def test_archived_receipt_still_prevents_duplicate_application(self):
        with patch.object(canvas_realtime, "REALTIME_RECEIPT_LIMIT", 2):
            for index in range(3):
                apply_operation(
                    self.canvas,
                    operation(
                        f"client-a:archive-{index}",
                        index,
                        node_updates=[
                            {
                                "id": "node-a",
                                "path": ["x"],
                                "value": 100 + index,
                            }
                        ],
                    ),
                    "actor-a",
                )
            self.assertNotIn(
                "client-a:archive-0",
                self.canvas["_realtime"]["receipts"],
            )
            before = copy.deepcopy(self.canvas)
            duplicate = apply_operation(
                self.canvas,
                operation(
                    "client-a:archive-0",
                    3,
                    node_updates=[
                        {
                            "id": "node-a",
                            "path": ["x"],
                            "value": 999,
                        }
                    ],
                ),
                "actor-a",
            )
            self.assertTrue(duplicate.duplicate)
            self.assertEqual(duplicate.revision, 3)
            self.assertEqual(self.canvas, before)

    def test_connections_are_deduplicated_and_validated(self):
        connection = {"from": "node-a", "to": "node-b", "kind": "input"}
        apply_operation(
            self.canvas,
            operation(
                "client-a:0006",
                0,
                connection_adds=[connection, connection],
            ),
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [connection])
        with self.assertRaisesRegex(CanvasRealtimeError, "不能自环"):
            apply_operation(
                self.canvas,
                operation(
                    "client-a:0007",
                    1,
                    connection_adds=[
                        {"from": "node-a", "to": "node-a", "kind": "input"}
                    ],
                ),
                "actor-a",
            )

    def test_group_members_are_unique_and_acyclic(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:0008",
                0,
                node_creates=[
                    {
                        "id": "group-a",
                        "type": "smart-group",
                        "items": ["node-a"],
                    },
                    {
                        "id": "group-b",
                        "type": "smart-group",
                        "items": ["group-a"],
                    },
                ],
            ),
            "actor-a",
        )
        before = copy.deepcopy(self.canvas)
        with self.assertRaisesRegex(CanvasRealtimeError, "循环包含"):
            apply_operation(
                self.canvas,
                operation(
                    "client-a:0009",
                    1,
                    node_updates=[
                        {
                            "id": "group-a",
                            "path": ["items"],
                            "value": ["group-b"],
                        }
                    ],
                ),
                "actor-a",
            )
        self.assertEqual(self.canvas, before)

    def test_actor_undo_preserves_other_users_changes(self):
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:0010",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 400}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:0010",
                1,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["title"],
                        "value": "Collaborator title",
                    },
                    {"id": "node-b", "path": ["x"], "value": 75},
                ],
                node_creates=[
                    {"id": "node-c", "type": "smart-image", "x": 7, "y": 8}
                ],
            ),
            "actor-b",
        )
        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-1",
                "base_revision": 2,
                "reverts_operation_id": moved.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(undo.reverts_operation_id, moved.operation_id)
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.node("node-a")["title"], "Collaborator title")
        self.assertEqual(self.node("node-b")["x"], 75)
        self.assertEqual(self.node("node-c")["x"], 7)
        self.assertEqual(self.canvas["revision"], 3)

    def test_actor_can_undo_stacked_updates_to_the_same_node_field(self):
        operations = []
        for index, value in enumerate((100, 200, 300, 400), start=1):
            operations.append(
                apply_operation(
                    self.canvas,
                    operation(
                        f"client-a:stacked-{index}",
                        self.canvas["revision"],
                        node_updates=[
                            {"id": "node-a", "path": ["x"], "value": value}
                        ],
                    ),
                    "actor-a",
                )
            )

        for index, (source, expected_x) in enumerate(
            zip(reversed(operations), (300, 200, 100, 10)),
            start=1,
        ):
            apply_operation(
                self.canvas,
                {
                    "operation_id": f"client-a:stacked-undo-{index}",
                    "base_revision": self.canvas["revision"],
                    "reverts_operation_id": source.operation_id,
                },
                "actor-a",
            )
            self.assertEqual(self.node("node-a")["x"], expected_x)

        self.assertEqual(self.canvas["revision"], 8)

    def test_undo_redo_undo_restores_node_field_lineage(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:redo-first",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100}
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:redo-second",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 200}
                ],
            ),
            "actor-a",
        )
        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-undo",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 100)

        redo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-redo",
                "base_revision": 3,
                "reverts_operation_id": undo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 200)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-undo-again",
                "base_revision": 4,
                "reverts_operation_id": redo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 100)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-first-undo",
                "base_revision": 5,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.canvas["revision"], 6)

    def test_stacked_undo_restores_node_set_unset_and_absent_version(self):
        set_value = apply_operation(
            self.canvas,
            operation(
                "client-a:set-label",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "label"],
                        "value": "v1",
                    }
                ],
            ),
            "actor-a",
        )
        unset_value = apply_operation(
            self.canvas,
            operation(
                "client-a:unset-label",
                1,
                node_unsets=[
                    {"id": "node-a", "path": ["metadata", "label"]}
                ],
            ),
            "actor-a",
        )
        self.assertNotIn("label", self.node("node-a").get("metadata", {}))

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-unset-label",
                "base_revision": 2,
                "reverts_operation_id": unset_value.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["metadata"]["label"], "v1")

        undo_set = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-set-label",
                "base_revision": 3,
                "reverts_operation_id": set_value.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("label", self.node("node-a").get("metadata", {}))

        apply_operation(
            self.canvas,
            operation(
                "client-b:set-label-later",
                4,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "label"],
                        "value": "collaborator",
                    }
                ],
            ),
            "actor-b",
        )
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:redo-set-label",
                    "base_revision": 5,
                    "reverts_operation_id": undo_set.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(self.canvas, before)

    def test_stacked_undo_restores_multi_node_arrangement_atomically(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:arrange-first",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100},
                    {"id": "node-a", "path": ["y"], "value": 200},
                    {"id": "node-b", "path": ["x"], "value": 300},
                    {"id": "node-b", "path": ["y"], "value": 400},
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:arrange-second",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 110},
                    {"id": "node-a", "path": ["y"], "value": 210},
                    {"id": "node-b", "path": ["x"], "value": 310},
                    {"id": "node-b", "path": ["y"], "value": 410},
                ],
            ),
            "actor-a",
        )

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:arrange-undo-second",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(
            (
                self.node("node-a")["x"],
                self.node("node-a")["y"],
                self.node("node-b")["x"],
                self.node("node-b")["y"],
            ),
            (100, 200, 300, 400),
        )

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:arrange-undo-first",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(
            (
                self.node("node-a")["x"],
                self.node("node-a")["y"],
                self.node("node-b")["x"],
                self.node("node-b")["y"],
            ),
            (10, 20, 50, 60),
        )
        self.assertEqual(self.canvas["revision"], 4)

    def test_repeated_field_write_in_one_mutation_undoes_atomically(self):
        repeated = apply_operation(
            self.canvas,
            operation(
                "client-a:repeated-field-write",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100},
                    {"id": "node-a", "path": ["x"], "value": 200},
                ],
            ),
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 200)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-repeated-field-write",
                "base_revision": 1,
                "reverts_operation_id": repeated.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.canvas["revision"], 2)

    def test_multi_node_undo_conflict_is_atomic(self):
        arranged = apply_operation(
            self.canvas,
            operation(
                "client-a:atomic-arrange",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100},
                    {"id": "node-b", "path": ["y"], "value": 400},
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:atomic-conflict",
                1,
                node_updates=[
                    {"id": "node-b", "path": ["y"], "value": 500}
                ],
            ),
            "actor-b",
        )

        before = copy.deepcopy(self.canvas)
        with self.assertRaisesRegex(CanvasRealtimeError, "无法安全撤销"):
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:atomic-undo",
                    "base_revision": 2,
                    "reverts_operation_id": arranged.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(self.canvas, before)

    def test_stacked_undo_restores_canvas_title_settings_and_absent_version(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:canvas-first",
                0,
                canvas_updates=[
                    {"path": ["title"], "value": "First"},
                    {"path": ["settings", "model"], "value": "model-a"},
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:canvas-second",
                1,
                canvas_updates=[{"path": ["title"], "value": "Second"}],
                canvas_unsets=[{"path": ["settings", "model"]}],
            ),
            "actor-a",
        )

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:canvas-undo-second",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["title"], "First")
        self.assertEqual(self.canvas["settings"]["model"], "model-a")

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:canvas-undo-first",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["title"], "Realtime")
        self.assertNotIn("model", self.canvas["settings"])
        self.assertEqual(self.canvas["revision"], 4)

    def test_undo_rejects_same_field_changed_later(self):
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:0011",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 400}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:0011",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 500}
                ],
            ),
            "actor-b",
        )
        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-2",
                    "base_revision": 2,
                    "reverts_operation_id": moved.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertIn("无法安全撤销", raised.exception.message)
        self.assertEqual(self.canvas, before)

    def test_stacked_undo_ignores_a_later_same_value_no_op(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:same-value-first",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100}
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:same-value-second",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 200}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:same-value-undo-second",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        same_value = apply_operation(
            self.canvas,
            operation(
                "client-b:same-value-write",
                3,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100}
                ],
            ),
            "actor-b",
        )
        self.assertEqual(same_value.revision, 3)
        self.assertTrue(all(not entries for entries in same_value.changes.values()))

        undone = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:same-value-undo-first",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(undone.revision, 4)
        self.assertEqual(self.node("node-a")["x"], 10)

    def test_undo_rejects_later_descendant_node_field_change(self):
        self.node("node-a")["metadata"] = {"label": "initial"}
        parent = apply_operation(
            self.canvas,
            operation(
                "client-a:parent-node-field",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata"],
                        "value": {"label": "parent"},
                    }
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:child-node-field",
                1,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "label"],
                        "value": "collaborator",
                    }
                ],
            ),
            "actor-b",
        )

        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-parent-node-field",
                    "base_revision": 2,
                    "reverts_operation_id": parent.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertEqual(self.canvas, before)

    def test_undo_rejects_later_ancestor_canvas_field_change(self):
        self.canvas["settings"] = {"model": "initial", "quality": "high"}
        child = apply_operation(
            self.canvas,
            operation(
                "client-a:child-canvas-field",
                0,
                canvas_updates=[
                    {"path": ["settings", "model"], "value": "model-a"}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:parent-canvas-field",
                1,
                canvas_updates=[
                    {
                        "path": ["settings"],
                        "value": {"model": "model-b", "quality": "low"},
                    }
                ],
            ),
            "actor-b",
        )

        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-child-canvas-field",
                    "base_revision": 2,
                    "reverts_operation_id": child.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertEqual(self.canvas, before)

    def test_same_mutation_rejects_parent_and_child_paths_atomically(self):
        for index, change_values in enumerate(
            (
                {
                    "node_updates": [
                        {
                            "id": "node-a",
                            "path": ["metadata"],
                            "value": {"label": "parent"},
                        },
                        {
                            "id": "node-a",
                            "path": ["metadata", "label"],
                            "value": "child",
                        },
                    ]
                },
                {
                    "canvas_updates": [
                        {
                            "path": ["settings"],
                            "value": {"model": "parent"},
                        }
                    ],
                    "canvas_unsets": [{"path": ["settings", "model"]}],
                },
            )
        ):
            with self.subTest(index=index):
                canvas = copy.deepcopy(self.canvas)
                before = copy.deepcopy(canvas)
                with self.assertRaises(CanvasRealtimeError) as raised:
                    apply_operation(
                        canvas,
                        operation(
                            f"client-a:path-overlap-{index}",
                            0,
                            **change_values,
                        ),
                        "actor-a",
                    )
                self.assertEqual(raised.exception.code, "invalid_changes")
                self.assertEqual(canvas, before)

    def test_parent_child_paths_can_be_undone_in_lifo_order(self):
        self.node("node-a")["metadata"] = {"label": "initial"}
        parent = apply_operation(
            self.canvas,
            operation(
                "client-a:lifo-parent-field",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata"],
                        "value": {"label": "parent"},
                    }
                ],
            ),
            "actor-a",
        )
        child = apply_operation(
            self.canvas,
            operation(
                "client-a:lifo-child-field",
                1,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "label"],
                        "value": "child",
                    }
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:lifo-undo-child",
                "base_revision": 2,
                "reverts_operation_id": child.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["metadata"], {"label": "parent"})
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:lifo-undo-parent",
                "base_revision": 3,
                "reverts_operation_id": parent.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["metadata"], {"label": "initial"})

    def test_child_then_parent_writes_round_trip_through_full_undo_redo(self):
        for scope, root in (("node", "metadata"), ("canvas", "settings")):
            with self.subTest(scope=scope):
                canvas = copy.deepcopy(self.canvas)
                if scope == "node":
                    owner = next(
                        node for node in canvas["nodes"] if node["id"] == "node-a"
                    )
                    action = "node_updates"
                else:
                    owner = canvas
                    action = "canvas_updates"
                owner[root] = {"label": "initial", "keep": "base"}

                def update(path, value):
                    entry = {"path": path, "value": value}
                    if scope == "node":
                        entry["id"] = "node-a"
                    return {action: [entry]}

                def current_value():
                    current_owner = (
                        next(
                            node
                            for node in canvas["nodes"]
                            if node["id"] == "node-a"
                        )
                        if scope == "node"
                        else canvas
                    )
                    return current_owner[root]

                child = apply_operation(
                    canvas,
                    operation(
                        f"client-a:{scope}-child-before-parent",
                        0,
                        **update([root, "label"], "child"),
                    ),
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "child", "keep": "base"}
                )
                parent = apply_operation(
                    canvas,
                    operation(
                        f"client-a:{scope}-parent-after-child",
                        1,
                        **update(
                            [root], {"label": "parent", "keep": "parent"}
                        ),
                    ),
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "parent", "keep": "parent"}
                )

                undo_parent = apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:{scope}-undo-parent",
                        "base_revision": 2,
                        "reverts_operation_id": parent.operation_id,
                    },
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "child", "keep": "base"}
                )
                undo_child = apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:{scope}-undo-child",
                        "base_revision": 3,
                        "reverts_operation_id": child.operation_id,
                    },
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "initial", "keep": "base"}
                )

                apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:{scope}-redo-child",
                        "base_revision": 4,
                        "reverts_operation_id": undo_child.operation_id,
                    },
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "child", "keep": "base"}
                )
                apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:{scope}-redo-parent",
                        "base_revision": 5,
                        "reverts_operation_id": undo_parent.operation_id,
                    },
                    "actor-a",
                )
                self.assertEqual(
                    current_value(), {"label": "parent", "keep": "parent"}
                )
                self.assertEqual(canvas["revision"], 6)

    def test_redo_child_write_rejects_later_parent_write_atomically(self):
        for scope, root in (("node", "metadata"), ("canvas", "settings")):
            with self.subTest(scope=scope):
                canvas = copy.deepcopy(self.canvas)
                if scope == "node":
                    owner = next(
                        node for node in canvas["nodes"] if node["id"] == "node-a"
                    )
                    action = "node_updates"
                else:
                    owner = canvas
                    action = "canvas_updates"
                owner[root] = {"label": "initial", "keep": "base"}

                def update(path, value):
                    entry = {"path": path, "value": value}
                    if scope == "node":
                        entry["id"] = "node-a"
                    return {action: [entry]}

                child = apply_operation(
                    canvas,
                    operation(
                        f"client-a:{scope}-child-before-conflict",
                        0,
                        **update([root, "label"], "actor-a"),
                    ),
                    "actor-a",
                )
                undo_child = apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:{scope}-undo-child-conflict",
                        "base_revision": 1,
                        "reverts_operation_id": child.operation_id,
                    },
                    "actor-a",
                )
                apply_operation(
                    canvas,
                    operation(
                        f"client-b:{scope}-parent-after-undo",
                        2,
                        **update(
                            [root],
                            {"label": "actor-b", "keep": "collaborator"},
                        ),
                    ),
                    "actor-b",
                )

                before = copy.deepcopy(canvas)
                with self.assertRaises(CanvasRealtimeError) as raised:
                    apply_operation(
                        canvas,
                        {
                            "operation_id": f"client-a:{scope}-redo-child-conflict",
                            "base_revision": 3,
                            "reverts_operation_id": undo_child.operation_id,
                        },
                        "actor-a",
                    )
                self.assertEqual(raised.exception.code, "undo_conflict")
                self.assertEqual(canvas, before)

    def test_nested_write_undo_restores_absent_or_scalar_ancestor(self):
        for index, (canvas, expected) in enumerate(
            (
                (copy.deepcopy(self.canvas), None),
                (copy.deepcopy(self.canvas), "scalar"),
            )
        ):
            with self.subTest(index=index):
                node = next(node for node in canvas["nodes"] if node["id"] == "node-a")
                if expected is not None:
                    node["metadata"] = expected
                nested = apply_operation(
                    canvas,
                    operation(
                        f"client-a:nested-ancestor-{index}",
                        0,
                        node_updates=[
                            {
                                "id": "node-a",
                                "path": ["metadata", "label"],
                                "value": "nested",
                            }
                        ],
                    ),
                    "actor-a",
                )
                apply_operation(
                    canvas,
                    {
                        "operation_id": f"client-a:undo-nested-ancestor-{index}",
                        "base_revision": 1,
                        "reverts_operation_id": nested.operation_id,
                    },
                    "actor-a",
                )
                restored = next(
                    node for node in canvas["nodes"] if node["id"] == "node-a"
                )
                if expected is None:
                    self.assertNotIn("metadata", restored)
                else:
                    self.assertEqual(restored["metadata"], expected)

    def test_sibling_writes_in_one_mutation_restore_missing_ancestor(self):
        written = apply_operation(
            self.canvas,
            operation(
                "client-a:sibling-created-ancestor",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["metadata", "x"], "value": 1},
                    {"id": "node-a", "path": ["metadata", "y"], "value": 2},
                ],
            ),
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["metadata"], {"x": 1, "y": 2})
        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-sibling-created-ancestor",
                "base_revision": 1,
                "reverts_operation_id": written.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("metadata", self.node("node-a"))
        redo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-sibling-created-ancestor",
                "base_revision": 2,
                "reverts_operation_id": undo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["metadata"], {"x": 1, "y": 2})
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-redo-sibling-created-ancestor",
                "base_revision": 3,
                "reverts_operation_id": redo.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("metadata", self.node("node-a"))

    def test_sibling_field_undo_preserves_later_sibling_change(self):
        self.node("node-a")["metadata"] = {
            "x": 0,
            "y": 0,
            "marker": False,
        }
        apply_operation(
            self.canvas,
            operation(
                "client-a:sibling-parent-clock",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata"],
                        "value": {"x": 0, "y": 0, "marker": True},
                    }
                ],
            ),
            "actor-a",
        )
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:sibling-x",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["metadata", "x"], "value": 1}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:sibling-y",
                2,
                node_updates=[
                    {"id": "node-a", "path": ["metadata", "y"], "value": 2}
                ],
            ),
            "actor-b",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-sibling-x",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(
            self.node("node-a")["metadata"],
            {"x": 0, "y": 2, "marker": True},
        )

    def test_undo_nested_write_rejects_later_sibling_when_ancestor_was_created(self):
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:create-nested-metadata",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "x"],
                        "value": 1,
                    }
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:later-nested-sibling",
                1,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "y"],
                        "value": 2,
                    }
                ],
            ),
            "actor-b",
        )

        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-create-nested-metadata",
                    "base_revision": 2,
                    "reverts_operation_id": created.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertEqual(self.canvas, before)

    def test_redo_nested_write_rejects_later_sibling_after_ancestor_removed(self):
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:redo-create-nested",
                0,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "x"],
                        "value": 1,
                    }
                ],
            ),
            "actor-a",
        )
        undone = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-undo-nested",
                "base_revision": 1,
                "reverts_operation_id": created.operation_id,
            },
            "actor-a",
        )
        apply_operation(
            self.canvas,
            operation(
                "client-b:redo-later-sibling",
                2,
                node_updates=[
                    {
                        "id": "node-a",
                        "path": ["metadata", "y"],
                        "value": 2,
                    }
                ],
            ),
            "actor-b",
        )

        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:redo-nested-after-sibling",
                    "base_revision": 3,
                    "reverts_operation_id": undone.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertEqual(self.canvas, before)

    def test_interleaved_disjoint_undos_do_not_revive_node_aggregate(self):
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:aggregate-create",
                0,
                node_creates=[
                    {"id": "node-c", "type": "smart-image", "x": 1, "y": 2}
                ],
            ),
            "actor-a",
        )
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:aggregate-move",
                1,
                node_updates=[
                    {"id": "node-c", "path": ["x"], "value": 100},
                    {"id": "node-c", "path": ["y"], "value": 200},
                ],
            ),
            "actor-a",
        )
        titled = apply_operation(
            self.canvas,
            operation(
                "client-b:aggregate-title",
                2,
                node_updates=[
                    {"id": "node-c", "path": ["title"], "value": "Later"}
                ],
            ),
            "actor-b",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:aggregate-undo-move",
                "base_revision": 3,
                "reverts_operation_id": moved.operation_id,
            },
            "actor-a",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-b:aggregate-undo-title",
                "base_revision": 4,
                "reverts_operation_id": titled.operation_id,
            },
            "actor-b",
        )

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:aggregate-undo-create",
                "base_revision": 5,
                "reverts_operation_id": created.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("node-c", {node["id"] for node in self.canvas["nodes"]})
        self.assertEqual(self.canvas["revision"], 6)

    def test_stacked_undo_migrates_legacy_field_history(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:legacy-first",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100}
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:legacy-second",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 200}
                ],
            ),
            "actor-a",
        )
        internal_fields = {
            "restore_version",
            "if_version_absent",
            "if_node_operation",
            "if_node_version_absent",
            "restore_node_version",
            "preserve_node_version",
        }
        for record in self.canvas["_realtime"]["history"]:
            for action in ("node_updates", "node_unsets"):
                for entry in record["inverse"][action]:
                    for field in internal_fields:
                        entry.pop(field, None)
        self.canvas["_realtime"].pop("lineage_schema", None)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:legacy-undo-second",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 100)
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:legacy-undo-first",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.canvas["revision"], 4)

    def test_migration_rejects_ambiguous_legacy_repeated_field_history(self):
        written = apply_operation(
            self.canvas,
            operation(
                "client-a:legacy-repeated-field",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 200}
                ],
            ),
            "actor-a",
        )
        record = self.canvas["_realtime"]["history"][0]
        record["changes"]["node_updates"] = [
            {"id": "node-a", "path": ["x"], "value": 100},
            {"id": "node-a", "path": ["x"], "value": 200},
        ]
        record["inverse"]["node_updates"] = [
            {
                "id": "node-a",
                "path": ["x"],
                "value": 10,
                "if_operation": written.operation_id,
            },
            {
                "id": "node-a",
                "path": ["x"],
                "value": 100,
                "if_operation": written.operation_id,
            },
        ]
        self.canvas["_realtime"].pop("lineage_schema", None)

        before = copy.deepcopy(self.canvas)
        with self.assertRaises(CanvasRealtimeError) as raised:
            apply_operation(
                self.canvas,
                {
                    "operation_id": "client-a:undo-legacy-repeated-field",
                    "base_revision": 1,
                    "reverts_operation_id": written.operation_id,
                },
                "actor-a",
            )
        self.assertEqual(raised.exception.code, "undo_conflict")
        self.assertEqual(self.canvas, before)

    def test_migration_repairs_lineage_after_a_persisted_legacy_undo(self):
        first = apply_operation(
            self.canvas,
            operation(
                "client-a:persisted-legacy-first",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 100}
                ],
            ),
            "actor-a",
        )
        second = apply_operation(
            self.canvas,
            operation(
                "client-a:persisted-legacy-second",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 200}
                ],
            ),
            "actor-a",
        )
        undone = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:persisted-legacy-undo",
                "base_revision": 2,
                "reverts_operation_id": second.operation_id,
            },
            "actor-a",
        )
        internal_fields = {
            "restore_version",
            "if_version_absent",
            "if_overlap_versions",
            "restore_overlap_versions",
            "if_node_operation",
            "if_node_version_absent",
            "restore_node_version",
            "preserve_node_version",
        }
        for record in self.canvas["_realtime"]["history"]:
            for action in ("node_updates", "node_unsets"):
                for entry in record["inverse"][action]:
                    for field in internal_fields:
                        entry.pop(field, None)
        field_key = next(
            key
            for key in self.canvas["_realtime"]["versions"]
            if key.startswith("node:node-a:[")
        )
        self.canvas["_realtime"]["versions"][field_key] = undone.operation_id
        self.canvas["_realtime"]["versions"]["node:node-a:changed"] = (
            undone.operation_id
        )
        self.canvas["_realtime"].pop("lineage_schema", None)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:persisted-legacy-undo-first",
                "base_revision": 3,
                "reverts_operation_id": first.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.canvas["revision"], 4)

    def test_create_move_stacked_undo_restores_node_existence(self):
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:create-move-node",
                0,
                node_creates=[
                    {"id": "node-c", "type": "smart-image", "x": 10, "y": 20}
                ],
            ),
            "actor-a",
        )
        moved = apply_operation(
            self.canvas,
            operation(
                "client-a:move-created-node",
                1,
                node_updates=[
                    {"id": "node-c", "path": ["x"], "value": 100}
                ],
            ),
            "actor-a",
        )
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-created-node-move",
                "base_revision": 2,
                "reverts_operation_id": moved.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-c")["x"], 10)

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-created-node",
                "base_revision": 3,
                "reverts_operation_id": created.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("node-c", {node["id"] for node in self.canvas["nodes"]})
        self.assertEqual(self.canvas["revision"], 4)

    def test_connection_add_remove_stacked_undo_restores_existence(self):
        connection = {"from": "node-a", "to": "node-b", "kind": "input"}
        added = apply_operation(
            self.canvas,
            operation(
                "client-a:add-connection",
                0,
                connection_adds=[connection],
            ),
            "actor-a",
        )
        removed = apply_operation(
            self.canvas,
            operation(
                "client-a:remove-connection",
                1,
                connection_removes=[connection],
            ),
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-remove-connection",
                "base_revision": 2,
                "reverts_operation_id": removed.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [connection])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-add-connection",
                "base_revision": 3,
                "reverts_operation_id": added.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])
        self.assertEqual(self.canvas["revision"], 4)

    def test_stacked_undo_migrates_legacy_connection_history(self):
        connection = {"from": "node-a", "to": "node-b", "kind": "input"}
        added = apply_operation(
            self.canvas,
            operation(
                "client-a:legacy-connection-add",
                0,
                connection_adds=[connection],
            ),
            "actor-a",
        )
        removed = apply_operation(
            self.canvas,
            operation(
                "client-a:legacy-connection-remove",
                1,
                connection_removes=[connection],
            ),
            "actor-a",
        )
        for record in self.canvas["_realtime"]["history"]:
            inverse = record["inverse"]
            inverse["connection_adds"] = [
                copy.deepcopy(entry.get("connection", entry))
                for entry in inverse["connection_adds"]
            ]
            for entry in inverse["connection_adds"] + inverse["connection_removes"]:
                entry.pop("restore_version", None)
                entry.pop("if_version_absent", None)
        self.canvas["_realtime"].pop("lineage_schema", None)

        restored = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:legacy-connection-undo-remove",
                "base_revision": 2,
                "reverts_operation_id": removed.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [connection])
        self.assertEqual(restored.changes["connection_adds"], [connection])
        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:legacy-connection-undo-add",
                "base_revision": 3,
                "reverts_operation_id": added.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])

    def test_normal_mutation_cannot_submit_internal_restore_wrappers(self):
        before = copy.deepcopy(self.canvas)
        for index, change_values in enumerate(
            (
                {
                    "node_creates": [
                        {
                            "node": {"id": "node-c", "type": "smart-image"},
                            "restore_from": "client-a:fake-delete",
                        }
                    ]
                },
                {
                    "connection_adds": [
                        {
                            "connection": {
                                "from": "node-a",
                                "to": "node-b",
                                "kind": "input",
                            },
                            "restore_version": "client-a:fake-version",
                        }
                    ]
                },
                {
                    "node_unsets": [
                        {
                            "id": "node-a",
                            "path": ["x"],
                            "lineage_path": ["title"],
                        }
                    ]
                },
            )
        ):
            with self.subTest(index=index):
                with self.assertRaises(CanvasRealtimeError) as raised:
                    apply_operation(
                        self.canvas,
                        operation(
                            f"client-a:internal-wrapper-{index}",
                            0,
                            **change_values,
                        ),
                        "actor-a",
                    )
                self.assertEqual(raised.exception.code, "invalid_changes")
                self.assertEqual(self.canvas, before)

    def test_raw_creates_with_internal_lineage_fields_are_rejected_atomically(self):
        for action in ("node_creates", "connection_adds"):
            for index, field in enumerate(
                sorted(canvas_realtime.INTERNAL_LINEAGE_FIELDS)
            ):
                with self.subTest(action=action, field=field):
                    canvas = copy.deepcopy(self.canvas)
                    if action == "node_creates":
                        raw_create = {
                            "id": f"node-forged-{index}",
                            "type": "smart-image",
                            field: "forged-server-lineage",
                        }
                    else:
                        raw_create = {
                            "from": "node-a",
                            "to": "node-b",
                            "kind": f"forged-{index}",
                            field: "forged-server-lineage",
                        }
                    before = copy.deepcopy(canvas)
                    public_changes = []
                    error_code = None
                    try:
                        accepted = apply_operation(
                            canvas,
                            operation(
                                f"client-a:raw-internal-{action}-{index}",
                                0,
                                **{
                                    action: [raw_create],
                                    "canvas_updates": [
                                        {
                                            "path": ["title"],
                                            "value": "must-not-commit",
                                        }
                                    ],
                                },
                            ),
                            "actor-a",
                        )
                    except CanvasRealtimeError as raised:
                        error_code = raised.code
                    else:
                        public_changes.append(accepted.changes)

                    self.assertEqual(
                        {
                            "error_code": error_code,
                            "canvas_unchanged": canvas == before,
                            "public_changes": public_changes,
                        },
                        {
                            "error_code": "invalid_changes",
                            "canvas_unchanged": True,
                            "public_changes": [],
                        },
                    )

    def test_connection_replacement_round_trips_through_undo_redo(self):
        original = {
            "from": "node-a",
            "to": "node-b",
            "kind": "input",
            "label": "original",
        }
        replacement = {**original, "label": "replacement"}
        apply_operation(
            self.canvas,
            operation(
                "client-a:add-original-connection",
                0,
                connection_adds=[original],
            ),
            "actor-a",
        )
        replaced = apply_operation(
            self.canvas,
            operation(
                "client-a:replace-connection",
                1,
                connection_removes=[original],
                connection_adds=[replacement],
            ),
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [replacement])

        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-replace-connection",
                "base_revision": 2,
                "reverts_operation_id": replaced.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [original])

        redo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-replace-connection",
                "base_revision": 3,
                "reverts_operation_id": undo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [replacement])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-redo-replace-connection",
                "base_revision": 4,
                "reverts_operation_id": redo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [original])
        self.assertEqual(self.canvas["revision"], 5)

    def test_undo_create_with_connection_is_atomic(self):
        connection = {"from": "node-a", "to": "node-c", "kind": "input"}
        created = apply_operation(
            self.canvas,
            operation(
                "client-a:create-with-connection",
                0,
                node_creates=[
                    {"id": "node-c", "type": "smart-image", "x": 1, "y": 2}
                ],
                connection_adds=[connection],
            ),
            "actor-a",
        )

        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-create-with-connection",
                "base_revision": 1,
                "reverts_operation_id": created.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(
            undo.changes,
            changes(
                node_deletes=[{"id": "node-c"}],
                connection_removes=[
                    {"from": "node-a", "to": "node-c", "kind": "input"}
                ],
            ),
        )
        self.assertNotIn("node-c", {node["id"] for node in self.canvas["nodes"]})
        self.assertEqual(self.canvas["connections"], [])
        self.assertEqual(self.canvas["revision"], 2)

    def test_undo_create_rejects_later_collaboration_references(self):
        reference_changes = (
            (
                "connection",
                {"id": "node-c", "type": "smart-image", "x": 1, "y": 2},
                {
                    "connection_adds": [
                        {"from": "node-a", "to": "node-c", "kind": "input"}
                    ]
                },
            ),
            (
                "smart-group",
                {"id": "node-c", "type": "smart-image", "x": 1, "y": 2},
                {
                    "node_updates": [
                        {
                            "id": "group-a",
                            "path": ["items"],
                            "value": ["node-c"],
                        }
                    ]
                },
            ),
            (
                "frame",
                {"id": "frame-c", "type": "smart-frame", "title": "Created"},
                {
                    "node_updates": [
                        {
                            "id": "node-a",
                            "path": ["frameId"],
                            "value": "frame-c",
                        }
                    ]
                },
            ),
            (
                "input-node-ids",
                {"id": "node-c", "type": "smart-image", "x": 1, "y": 2},
                {
                    "node_updates": [
                        {
                            "id": "node-b",
                            "path": ["inputNodeIds"],
                            "value": ["node-c"],
                        }
                    ]
                },
            ),
            (
                "history-group",
                {"id": "node-c", "type": "smart-image", "x": 1, "y": 2},
                {
                    "node_creates": [
                        {
                            "id": "history-c",
                            "type": "smart-image",
                            "historyFor": "node-c",
                            "isHistoryGroup": True,
                        }
                    ]
                },
            ),
        )
        for index, (case, created_node, later_changes) in enumerate(reference_changes):
            with self.subTest(case=case):
                canvas = copy.deepcopy(self.canvas)
                canvas["nodes"].extend(
                    [
                        {"id": "group-a", "type": "smart-group", "items": []},
                        {"id": "frame-a", "type": "smart-frame", "title": "Frame"},
                    ]
                )
                created = apply_operation(
                    canvas,
                    operation(
                        f"client-a:reference-create-{index}",
                        0,
                        node_creates=[created_node],
                    ),
                    "actor-a",
                )
                apply_operation(
                    canvas,
                    operation(
                        f"client-b:reference-later-{index}",
                        1,
                        **later_changes,
                    ),
                    "actor-b",
                )

                before = copy.deepcopy(canvas)
                with self.assertRaises(CanvasRealtimeError) as raised:
                    apply_operation(
                        canvas,
                        {
                            "operation_id": f"client-a:reference-undo-{index}",
                            "base_revision": 2,
                            "reverts_operation_id": created.operation_id,
                        },
                        "actor-a",
                    )
                self.assertEqual(raised.exception.code, "undo_conflict")
                self.assertEqual(canvas, before)

    def test_node_delete_normalizes_numeric_structural_reference_ids(self):
        self.canvas["nodes"].append(
            {"id": "123", "type": "smart-image", "title": "Numeric ID"}
        )
        self.node("node-b")["inputNodeIds"] = [123]
        self.canvas["nodes"].append(
            {"id": "group-a", "type": "smart-group", "items": [123]}
        )

        apply_operation(
            self.canvas,
            operation(
                "client-a:delete-numeric-reference",
                0,
                node_deletes=["123"],
            ),
            "actor-a",
        )

        self.assertEqual(self.node("node-b")["inputNodeIds"], [])
        self.assertEqual(self.node("group-a")["items"], [])

    def test_node_delete_restores_input_reference_lineage(self):
        linked = apply_operation(
            self.canvas,
            operation(
                "client-a:set-input-reference",
                0,
                node_updates=[
                    {
                        "id": "node-b",
                        "path": ["inputNodeIds"],
                        "value": ["node-a"],
                    }
                ],
            ),
            "actor-a",
        )
        deleted = apply_operation(
            self.canvas,
            operation(
                "client-a:delete-input-source",
                1,
                node_deletes=["node-a"],
            ),
            "actor-a",
        )
        self.assertEqual(self.node("node-b")["inputNodeIds"], [])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-delete-input-source",
                "base_revision": 2,
                "reverts_operation_id": deleted.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-b")["inputNodeIds"], ["node-a"])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-set-input-reference",
                "base_revision": 3,
                "reverts_operation_id": linked.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("inputNodeIds", self.node("node-b"))

    def test_node_delete_cascade_restores_connection_lineage(self):
        connection = {"from": "node-a", "to": "node-b", "kind": "input"}
        added = apply_operation(
            self.canvas,
            operation(
                "client-a:add-cascade-connection",
                0,
                connection_adds=[connection],
            ),
            "actor-a",
        )
        deleted = apply_operation(
            self.canvas,
            operation(
                "client-a:delete-connection-endpoint",
                1,
                node_deletes=["node-b"],
            ),
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])

        undo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-delete-connection-endpoint",
                "base_revision": 2,
                "reverts_operation_id": deleted.operation_id,
            },
            "actor-a",
        )
        restored_node = next(
            node for node in undo.changes["node_creates"] if node["id"] == "node-b"
        )
        self.assertNotIn("restore_from", restored_node)
        self.assertEqual(undo.changes["connection_adds"], [connection])
        self.assertEqual(self.canvas["connections"], [connection])

        redo = apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:redo-delete-connection-endpoint",
                "base_revision": 3,
                "reverts_operation_id": undo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])
        self.assertNotIn("node-b", {node["id"] for node in self.canvas["nodes"]})

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-redo-delete-connection-endpoint",
                "base_revision": 4,
                "reverts_operation_id": redo.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [connection])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-add-cascade-connection",
                "base_revision": 5,
                "reverts_operation_id": added.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.canvas["connections"], [])
        self.assertEqual(self.canvas["revision"], 6)

    def test_node_delete_cascade_restores_smart_group_items_lineage(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:create-cascade-group",
                0,
                node_creates=[
                    {"id": "group-a", "type": "smart-group", "items": []}
                ],
            ),
            "actor-a",
        )
        membership = apply_operation(
            self.canvas,
            operation(
                "client-a:set-cascade-members",
                1,
                node_updates=[
                    {
                        "id": "group-a",
                        "path": ["items"],
                        "value": ["node-a", "node-b"],
                    }
                ],
            ),
            "actor-a",
        )
        deleted = apply_operation(
            self.canvas,
            operation(
                "client-a:delete-cascade-members",
                2,
                node_deletes=["node-a", "node-b"],
            ),
            "actor-a",
        )
        self.assertEqual(self.node("group-a")["items"], [])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-delete-cascade-members",
                "base_revision": 3,
                "reverts_operation_id": deleted.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("group-a")["items"], ["node-a", "node-b"])

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-set-cascade-members",
                "base_revision": 4,
                "reverts_operation_id": membership.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("group-a")["items"], [])
        self.assertEqual(self.canvas["revision"], 5)

    def test_frame_delete_cascade_restores_frame_id_lineage(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:create-cascade-frame",
                0,
                node_creates=[
                    {"id": "frame-a", "type": "smart-frame", "title": "Frame"}
                ],
            ),
            "actor-a",
        )
        framed = apply_operation(
            self.canvas,
            operation(
                "client-a:set-cascade-frame",
                1,
                node_updates=[
                    {"id": "node-a", "path": ["frameId"], "value": "frame-a"}
                ],
            ),
            "actor-a",
        )
        deleted = apply_operation(
            self.canvas,
            operation(
                "client-a:delete-cascade-frame",
                2,
                node_deletes=["frame-a"],
            ),
            "actor-a",
        )
        self.assertNotIn("frameId", self.node("node-a"))

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-delete-cascade-frame",
                "base_revision": 3,
                "reverts_operation_id": deleted.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["frameId"], "frame-a")

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-set-cascade-frame",
                "base_revision": 4,
                "reverts_operation_id": framed.operation_id,
            },
            "actor-a",
        )
        self.assertNotIn("frameId", self.node("node-a"))
        self.assertEqual(self.canvas["revision"], 5)

    def test_snapshot_excludes_internal_and_local_view_state(self):
        apply_operation(
            self.canvas,
            operation(
                "client-a:0012",
                0,
                canvas_updates=[
                    {"path": ["settings", "model"], "value": "v1"}
                ],
            ),
            "actor-a",
        )
        snapshot = public_snapshot(self.canvas)
        self.assertTrue(realtime_enabled(self.canvas))
        self.assertNotIn("_realtime", snapshot)
        self.assertNotIn("viewport", snapshot)
        self.assertEqual(snapshot["revision"], 1)
        self.assertEqual(snapshot["settings"]["model"], "v1")

    def test_generation_logs_are_persisted_but_excluded_from_undo_history(self):
        self.canvas["logs"] = [{"id": "old-log", "prompt": "old"}]
        new_logs = [{"id": "new-log", "prompt": "x" * 4096}]
        accepted = apply_operation(
            self.canvas,
            operation(
                "client-a:logs-with-node",
                0,
                node_updates=[
                    {"id": "node-a", "path": ["x"], "value": 120}
                ],
                canvas_updates=[
                    {"path": ["logs"], "value": new_logs}
                ],
            ),
            "actor-a",
        )

        self.assertEqual(self.canvas["logs"], new_logs)
        self.assertEqual(accepted.changes["canvas_updates"], [])
        source = self.canvas["_realtime"]["history"][-1]
        for action in ("canvas_updates", "canvas_unsets"):
            self.assertFalse(
                any(
                    entry.get("path", [""])[0] == "logs"
                    for entry in source["changes"][action]
                )
            )
            self.assertFalse(
                any(
                    entry.get("path", [""])[0] == "logs"
                    for entry in source["inverse"][action]
                )
            )

        apply_operation(
            self.canvas,
            {
                "operation_id": "client-a:undo-logs-node",
                "base_revision": accepted.revision,
                "reverts_operation_id": accepted.operation_id,
            },
            "actor-a",
        )
        self.assertEqual(self.node("node-a")["x"], 10)
        self.assertEqual(self.canvas["logs"], new_logs)

    def test_log_only_mutation_is_not_added_to_the_undo_window(self):
        accepted = apply_operation(
            self.canvas,
            operation(
                "client-a:log-only",
                0,
                canvas_updates=[
                    {
                        "path": ["logs"],
                        "value": [{"id": "final-log", "status": "success"}],
                    }
                ],
            ),
            "actor-a",
        )

        self.assertFalse(accepted.undoable)
        self.assertEqual(accepted.non_undoable_canvas_roots, ("logs",))
        self.assertEqual(self.canvas["_realtime"]["history"], [])
        self.assertEqual(
            self.canvas["_realtime"]["receipts"][accepted.operation_id][
                "undoable"
            ],
            False,
        )

    def test_server_history_is_capped_at_two_hundred_mutations(self):
        for index in range(205):
            apply_operation(
                self.canvas,
                operation(
                    f"client-a:history-{index:04d}",
                    index,
                    canvas_updates=[
                        {"path": ["title"], "value": f"Title {index}"}
                    ],
                ),
                "actor-a",
            )

        history = self.canvas["_realtime"]["history"]
        self.assertEqual(len(history), canvas_realtime.REALTIME_HISTORY_LIMIT)
        self.assertEqual(history[0]["operation_id"], "client-a:history-0005")
        self.assertEqual(history[-1]["operation_id"], "client-a:history-0204")

    def test_local_view_and_interaction_state_cannot_enter_shared_mutations(self):
        for index, root in enumerate(
            (
                "viewport",
                "selection",
                "activeTool",
                "dragPreview",
                "resizePreview",
                "pointer",
            )
        ):
            before = public_snapshot(self.canvas)
            with self.subTest(root=root), self.assertRaisesRegex(
                CanvasRealtimeError,
                "不属于共享实时文档",
            ):
                apply_operation(
                    self.canvas,
                    operation(
                        f"client-a:local-{index}",
                        0,
                        canvas_updates=[
                            {
                                "path": [root],
                                "value": {"local": True},
                            }
                        ],
                    ),
                    "actor-a",
                )
            self.assertEqual(public_snapshot(self.canvas), before)

    def test_rejected_first_mutation_leaves_all_canvas_state_unchanged(self):
        before = copy.deepcopy(self.canvas)
        with self.assertRaisesRegex(
            CanvasRealtimeError,
            "不属于共享实时文档",
        ):
            apply_operation(
                self.canvas,
                operation(
                    "client-a:first-rejected",
                    0,
                    canvas_updates=[
                        {"path": ["viewport"], "value": {"x": 999}}
                    ],
                ),
                "actor-a",
            )
        self.assertEqual(self.canvas, before)


if __name__ == "__main__":
    unittest.main()
