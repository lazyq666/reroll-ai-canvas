import copy
import sqlite3
import tempfile
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
    "project_ids": ["project-a"],
}
OTHER_ADMIN = {
    "id": "admin-2",
    "username": "other-admin",
    "role": "admin",
    "status": "active",
}


def sample_canvas(canvas_id="canvas-1"):
    return {
        "id": canvas_id,
        "kind": "smart",
        "title": "SQLite Canvas",
        "icon": "sparkles",
        "owner_id": ADMIN["id"],
        "owner_username": ADMIN["username"],
        "visibility": "shared",
        "created_by": ADMIN["id"],
        "updated_by": ADMIN["id"],
        "owner": "Studio",
        "color": "blue",
        "pinned": True,
        "project": "project-a",
        "created_at": 100,
        "updated_at": 200,
        "revision": 7,
        "viewport": {"x": 3, "y": 4, "scale": 1.2},
        "settings": {"quality": "high"},
        "extensionPayload": {"future": True},
        "nodes": [
            {"id": "node-a", "type": "smart-image", "x": 10, "y": 20},
            {"id": "node-b", "type": "smart-prompt", "x": 30, "y": 40},
        ],
        "connections": [
            {"from": "node-a", "to": "node-b", "kind": "input"}
        ],
        "logs": [{"id": "legacy-log", "prompt": "do not import"}],
        "_realtime": {"history": [{"large": "do not import"}]},
        "_generation_runs": {"old-run": {"status": "done"}},
    }


class SqliteCanvasStoreContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "canvas-content.sqlite3"
        self.clock = 1000
        self.store = SqliteCanvasStore(
            self.database,
            workspace_id="workspace-a",
            now_ms=lambda: self.clock,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def import_canvas(self, document=None, operation_id="migration:canvas-1"):
        document = document or sample_canvas()
        return self.store.commit(
            document["id"],
            ADMIN,
            CanvasIntent.import_canvas(
                document,
                operation_id=operation_id,
            ),
        )

    def edit_facts(self, actor=ADMIN):
        item = next(
            item
            for item in self.store.list_items(actor)
            if item["id"] == "canvas-1"
        )
        return (
            item["updated_at"],
            item["updated_by"],
            item["revision"],
        )

    def receipt_count(self):
        with sqlite3.connect(self.database) as connection:
            return connection.execute(
                "SELECT COUNT(*) FROM canvas_operation_receipts"
            ).fetchone()[0]

    def mutate(
        self,
        operation_id,
        base_revision,
        *,
        actor=ADMIN,
        changes=None,
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
            "canvas-1",
            actor,
            CanvasIntent.canvas_mutation(operation),
        )

    def generation(
        self,
        effect_id,
        *,
        run_id,
        request_index=0,
        generation_operation_id="generation-operation-1",
        node_changes=None,
        final_log=None,
    ):
        return self.store.commit(
            "canvas-1",
            ADMIN,
            CanvasIntent.generation_output_commit(
                effect_id=effect_id,
                node_id="node-a",
                generation_operation_id=generation_operation_id,
                request_index=request_index,
                run_id=run_id,
                node_changes=node_changes or {},
                final_log=final_log,
            ),
        )

    def import_generation_canvas(self):
        document = sample_canvas()
        document["nodes"][0].update(
            {
                "generationOperationId": "generation-operation-1",
                "images": [],
                "pending": 2,
                "pendingTasks": [
                    {"taskId": "generation-run-1"},
                    {"taskId": "generation-run-2"},
                ],
                "running": True,
            }
        )
        return self.import_canvas(document)

    def test_import_and_closed_projections_preserve_public_canvas_only(self):
        committed = self.import_canvas()

        self.assertTrue(committed.changed)
        self.assertEqual(committed.revision, 7)
        snapshot = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual([node["id"] for node in snapshot["nodes"]], ["node-a", "node-b"])
        self.assertEqual(snapshot["connections"][0]["kind"], "input")
        self.assertEqual(snapshot["viewport"], {"x": 3, "y": 4, "scale": 1.2})
        self.assertEqual(snapshot["extensionPayload"], {"future": True})
        self.assertNotIn("logs", snapshot)
        self.assertNotIn("_realtime", snapshot)
        self.assertNotIn("_generation_runs", snapshot)
        self.assertEqual(self.store.integrity()["counts"]["logs"], 0)

        item = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.list_item(),
        ).canvas
        self.assertEqual(item["node_count"], 2)
        self.assertNotIn("nodes", item)
        self.assertNotIn("settings", item)

    def test_generation_history_backfill_is_atomic_and_includes_deleted_canvas(self):
        first = sample_canvas("canvas-1")
        second = sample_canvas("canvas-2")
        second["deleted_at"] = 400
        self.import_canvas(first)
        self.import_canvas(second, operation_id="migration:canvas-2")

        with self.assertRaises(CanvasStoreError):
            self.store.backfill_generation_history(
                {
                    "canvas-1": [
                        {
                            "id": "legacy-log-1",
                            "status": "success",
                            "prompt": "first",
                        }
                    ],
                    "canvas-2": [
                        {
                            "id": "legacy-log-2",
                            "status": "still-running",
                        }
                    ],
                },
                ADMIN,
                operation_id="history-backfill:test-failure",
                source_fingerprint="a" * 64,
            )
        self.assertEqual(0, self.store.integrity()["counts"]["logs"])

        imported = self.store.backfill_generation_history(
            {
                "canvas-1": [
                    {
                        "id": "legacy-log-1",
                        "status": "success",
                        "prompt": "first",
                    }
                ],
                "canvas-2": [
                    {
                        "id": "legacy-log-2",
                        "status": "failed",
                        "error": "second",
                    }
                ],
            },
            ADMIN,
            operation_id="history-backfill:test-success",
            source_fingerprint="a" * 64,
        )

        self.assertEqual(2, imported)
        self.assertEqual(2, self.store.integrity()["counts"]["logs"])
        with sqlite3.connect(self.database) as connection:
            self.assertEqual(
                1,
                connection.execute(
                    """
                    SELECT COUNT(*) FROM canvas_logs
                    WHERE canvas_id = ? AND log_id = ?
                    """,
                    ("canvas-2", "legacy-log-2"),
                ).fetchone()[0],
            )
        with self.assertRaises(CanvasStoreError) as repeated:
            self.store.backfill_generation_history(
                {},
                ADMIN,
                operation_id="history-backfill:test-repeat",
                source_fingerprint="a" * 64,
            )
        self.assertEqual(
            "generation_history_already_backfilled",
            repeated.exception.code,
        )

    def test_import_is_idempotent_and_operation_collision_is_rejected(self):
        intent = CanvasIntent.import_canvas(
            sample_canvas(),
            operation_id="migration:canvas-1",
        )
        first = self.store.commit("canvas-1", ADMIN, intent)
        duplicate = self.store.commit("canvas-1", ADMIN, intent)

        self.assertFalse(first.duplicate)
        self.assertTrue(duplicate.duplicate)
        changed = sample_canvas()
        changed["title"] = "Different"
        with self.assertRaises(CanvasStoreError) as rejected:
            self.store.commit(
                "canvas-1",
                ADMIN,
                CanvasIntent.import_canvas(
                    changed,
                    operation_id="migration:canvas-1",
                ),
            )
        self.assertEqual(rejected.exception.code, "operation_collision")
        self.assertEqual(
            self.store.read(
                "canvas-1", ADMIN, CanvasProjection.list_item()
            ).canvas["title"],
            "SQLite Canvas",
        )

    def test_management_preserves_edit_facts_while_identity_edits_advance_them(self):
        self.import_canvas()
        original_facts = (200, ADMIN["id"], 7)
        receipts_before_touch = self.receipt_count()
        self.clock = 1100

        touched = self.store.commit(
            "canvas-1",
            DESIGNER,
            CanvasIntent.touch_canvas(operation_id="touch:compat-0001"),
        )
        self.assertFalse(touched.changed)
        self.assertEqual(self.edit_facts(), original_facts)
        self.assertEqual(self.receipt_count(), receipts_before_touch)

        metadata = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.update_metadata(
                {
                    "owner": "Operations",
                    "color": "amber",
                    "pinned": False,
                    "project": "project-b",
                    "board_x": 91,
                    "board_y": 73,
                    "cover_url": "/assets/management-cover.png",
                    "cover_node_id": "node-a",
                    "cover_image_index": 1,
                },
                operation_id="management:metadata-0001",
            ),
        )
        self.assertTrue(metadata.changed)
        self.assertEqual(self.edit_facts(OTHER_ADMIN), original_facts)

        trashed = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.trash_canvas(
                operation_id="management:trash-0001"
            ),
        )
        self.assertTrue(trashed.changed)
        self.assertEqual(self.edit_facts(OTHER_ADMIN), original_facts)
        restored = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.restore_canvas(
                operation_id="management:restore-0001"
            ),
        )
        self.assertTrue(restored.changed)
        self.assertEqual(self.edit_facts(OTHER_ADMIN), original_facts)

        self.assertEqual(
            self.store.reassign_owned_canvases(ADMIN["id"], OTHER_ADMIN),
            1,
        )
        self.assertEqual(self.edit_facts(OTHER_ADMIN), original_facts)

        visibility = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.set_visibility(
                "private",
                operation_id="management:visibility-0001",
            ),
        )
        self.assertTrue(visibility.changed)
        self.assertEqual(self.edit_facts(OTHER_ADMIN), original_facts)

        self.clock = 1200
        identity_edit = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.update_metadata(
                {"title": "Renamed", "icon": "image"},
                operation_id="edit:identity-0001",
            ),
        )
        self.assertTrue(identity_edit.changed)
        self.assertEqual(
            self.edit_facts(OTHER_ADMIN),
            (1200, OTHER_ADMIN["id"], 7),
        )

        self.clock = 1300
        repeated_identity = self.store.commit(
            "canvas-1",
            OTHER_ADMIN,
            CanvasIntent.update_metadata(
                {"title": "Renamed", "icon": "image"},
                operation_id="edit:identity-0002",
            ),
        )
        self.assertFalse(repeated_identity.changed)
        self.assertEqual(
            self.edit_facts(OTHER_ADMIN),
            (1200, OTHER_ADMIN["id"], 7),
        )

    def test_classic_equal_snapshot_is_no_op_and_real_difference_updates_edit_facts(self):
        document = sample_canvas()
        document["kind"] = "classic"
        self.import_canvas(document)
        values = {
            "title": document["title"],
            "icon": document["icon"],
            "nodes": copy.deepcopy(document["nodes"]),
            "connections": copy.deepcopy(document["connections"]),
            "settings": copy.deepcopy(document["settings"]),
            "base_updated_at": document["updated_at"],
        }

        self.clock = 1100
        unchanged = self.store.commit(
            "canvas-1",
            DESIGNER,
            CanvasIntent.save_snapshot(
                values,
                operation_id="snapshot:classic-noop-0001",
            ),
        )

        self.assertFalse(unchanged.changed)
        self.assertEqual(self.edit_facts(), (200, ADMIN["id"], 7))

        self.clock = 1200
        changed_values = copy.deepcopy(values)
        changed_values["nodes"][0]["x"] = 333
        changed = self.store.commit(
            "canvas-1",
            DESIGNER,
            CanvasIntent.save_snapshot(
                changed_values,
                operation_id="snapshot:classic-edit-0001",
            ),
        )

        self.assertTrue(changed.changed)
        self.assertEqual(self.edit_facts(), (1200, DESIGNER["id"], 7))

    def test_failed_import_rolls_back_the_whole_transaction(self):
        invalid = sample_canvas("invalid-canvas")
        invalid["nodes"].append({"type": "missing-id"})

        with self.assertRaises(CanvasStoreError) as rejected:
            self.import_canvas(
                invalid,
                operation_id="migration:invalid-canvas",
            )
        self.assertEqual(rejected.exception.code, "invalid_node")
        with self.assertRaises(CanvasStoreError) as missing:
            self.store.read(
                "invalid-canvas",
                ADMIN,
                CanvasProjection.public_snapshot(),
            )
        self.assertEqual(missing.exception.code, "not_found")

    def test_permissions_are_checked_for_every_projection_and_commit(self):
        self.import_canvas()
        denied = {**DESIGNER, "project_ids": []}

        with self.assertRaises(CanvasStoreError) as rejected:
            self.store.read(
                "canvas-1",
                denied,
                CanvasProjection.public_snapshot(),
            )
        self.assertEqual(rejected.exception.code, "not_found")
        with self.assertRaises(CanvasStoreError):
            self.store.commit(
                "canvas-1",
                denied,
                CanvasIntent.append_final_log(
                    {"id": "denied-log", "status": "failed"},
                    operation_id="log:denied-0001",
                ),
            )

    def test_mutation_commits_document_event_and_idempotent_receipt(self):
        self.import_canvas()
        intent = CanvasIntent.canvas_mutation(
            {
                "operation_id": "mutation:document-0001",
                "base_revision": 7,
                "changes": {
                    "node_updates": [
                        {"id": "node-a", "path": ["x"], "value": 111}
                    ],
                    "canvas_updates": [
                        {"path": ["title"], "value": "Realtime title"},
                        {
                            "path": ["settings", "quality"],
                            "value": "ultra",
                        },
                    ],
                },
            }
        )

        committed = self.store.commit("canvas-1", ADMIN, intent)
        duplicate = self.store.commit("canvas-1", ADMIN, intent)

        self.assertEqual(committed.revision, 8)
        self.assertTrue(committed.changed)
        self.assertEqual(committed.event["type"], "canvas_mutation")
        self.assertEqual(committed.event["canvas_id"], "canvas-1")
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(duplicate.revision, 8)
        snapshot = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(snapshot["revision"], 8)
        self.assertEqual(snapshot["title"], "Realtime title")
        self.assertEqual(snapshot["settings"]["quality"], "ultra")
        self.assertEqual(snapshot["nodes"][0]["x"], 111)
        self.assertEqual(self.store.integrity()["counts"]["mutations"], 1)
        self.assertEqual(self.store.integrity()["counts"]["events"], 1)

        with self.assertRaises(CanvasStoreError) as wrong_actor:
            self.store.commit("canvas-1", DESIGNER, intent)
        self.assertEqual(wrong_actor.exception.code, "operation_collision")

        changed_operation = copy.deepcopy(intent.payload["operation"])
        changed_operation["changes"]["node_updates"][0]["value"] = 222
        with self.assertRaises(CanvasStoreError) as rejected:
            self.store.commit(
                "canvas-1",
                ADMIN,
                CanvasIntent.canvas_mutation(changed_operation),
            )
        self.assertEqual(rejected.exception.code, "operation_collision")

    def test_empty_and_equal_mutations_preserve_edit_facts_until_real_change(self):
        self.import_canvas()
        original_facts = (200, ADMIN["id"], 7)
        self.clock = 1100

        empty = self.mutate(
            "mutation:empty-0001",
            7,
            actor=DESIGNER,
            changes={},
        )
        equal = self.mutate(
            "mutation:equal-0001",
            7,
            actor=DESIGNER,
            changes={
                "node_updates": [
                    {"id": "node-a", "path": ["x"], "value": 10}
                ]
            },
        )

        self.assertFalse(empty.changed)
        self.assertFalse(equal.changed)
        self.assertEqual(empty.revision, 7)
        self.assertEqual(equal.revision, 7)
        self.assertEqual(self.edit_facts(), original_facts)
        self.assertEqual(self.store.integrity()["counts"]["mutations"], 0)
        self.assertEqual(self.store.integrity()["counts"]["events"], 0)

        self.clock = 1200
        changed = self.mutate(
            "mutation:real-0001",
            7,
            actor=DESIGNER,
            changes={
                "node_updates": [
                    {"id": "node-a", "path": ["x"], "value": 11}
                ]
            },
        )
        self.assertTrue(changed.changed)
        self.assertEqual(changed.revision, 8)
        self.assertEqual(self.edit_facts(), (1200, DESIGNER["id"], 8))

        self.clock = 1300
        duplicate = self.mutate(
            "mutation:real-0001",
            7,
            actor=DESIGNER,
            changes={
                "node_updates": [
                    {"id": "node-a", "path": ["x"], "value": 11}
                ]
            },
        )
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(self.edit_facts(), (1200, DESIGNER["id"], 8))

    def test_mutation_undo_preserves_disjoint_collaborator_change(self):
        self.import_canvas()
        moved = self.mutate(
            "mutation:admin-move-0001",
            7,
            changes={
                "node_updates": [
                    {"id": "node-a", "path": ["x"], "value": 400}
                ]
            },
        )
        titled = self.mutate(
            "mutation:designer-title-0001",
            7,
            actor=DESIGNER,
            changes={
                "node_updates": [
                    {
                        "id": "node-a",
                        "path": ["title"],
                        "value": "Collaborator title",
                    }
                ]
            },
        )
        with self.assertRaises(CanvasStoreError) as rejected:
            self.mutate(
                "mutation:designer-undo-0001",
                titled.revision,
                actor=DESIGNER,
                reverts_operation_id=moved.operation_id,
            )
        self.assertEqual(rejected.exception.code, "undo_forbidden")

        undone = self.mutate(
            "mutation:admin-undo-0001",
            titled.revision,
            reverts_operation_id=moved.operation_id,
        )

        snapshot = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(undone.revision, 10)
        self.assertEqual(snapshot["revision"], 10)
        self.assertEqual(snapshot["nodes"][0]["x"], 10)
        self.assertEqual(
            snapshot["nodes"][0]["title"],
            "Collaborator title",
        )
        self.assertEqual(self.store.integrity()["counts"]["mutations"], 3)
        self.assertEqual(self.store.integrity()["counts"]["events"], 3)

    def test_invalid_or_log_mutation_rolls_back_atomically(self):
        self.import_canvas()
        before = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas

        with self.assertRaises(CanvasStoreError) as invalid:
            self.mutate(
                "mutation:invalid-path-0001",
                7,
                changes={
                    "node_updates": [
                        {"id": "node-a", "path": ["x"], "value": 999}
                    ],
                    "canvas_updates": [
                        {"path": ["viewport", "x"], "value": 999}
                    ],
                },
            )
        self.assertEqual(invalid.exception.code, "invalid_path")
        with self.assertRaises(CanvasStoreError) as legacy_log:
            self.mutate(
                "mutation:legacy-log-0001",
                7,
                changes={
                    "canvas_updates": [
                        {"path": ["logs"], "value": [{"id": "legacy"}]}
                    ]
                },
            )
        self.assertEqual(
            legacy_log.exception.code,
            "logs_require_final_log",
        )
        after = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(after, before)
        self.assertEqual(self.store.integrity()["counts"]["mutations"], 0)
        self.assertEqual(self.store.integrity()["counts"]["events"], 0)

    def test_generation_output_and_final_log_commit_atomically(self):
        self.import_generation_canvas()
        intent = CanvasIntent.generation_output_commit(
            effect_id="effect:generation-run-1",
            node_id="node-a",
            generation_operation_id="generation-operation-1",
            request_index=0,
            run_id="generation-run-1",
            node_changes={
                "images": [{"url": "/assets/output/first.png"}],
                "pending": 0,
                "running": False,
            },
            final_log={
                "id": "generation-log-1",
                "status": "success",
                "platform": "provider-a",
                "model": "image-v1",
                "outputs": [{"url": "/assets/output/first.png"}],
            },
        )

        committed = self.store.commit("canvas-1", ADMIN, intent)
        duplicate = self.store.commit("canvas-1", ADMIN, intent)

        self.assertTrue(committed.effect_applied)
        self.assertTrue(committed.changed)
        self.assertEqual(committed.revision, 8)
        self.assertEqual(committed.log_id, "generation-log-1")
        self.assertEqual(committed.event["type"], "canvas_updated")
        self.assertTrue(duplicate.duplicate)
        self.assertTrue(duplicate.effect_applied)
        self.assertEqual(duplicate.reason, "already_applied")
        snapshot = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        node = snapshot["nodes"][0]
        self.assertEqual(
            [image["url"] for image in node["images"]],
            ["/assets/output/first.png"],
        )
        self.assertEqual(node["pending"], 1)
        self.assertEqual(
            node["pendingTasks"],
            [{"taskId": "generation-run-2"}],
        )
        self.assertTrue(node["running"])
        detail = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.log_detail("generation-log-1"),
        ).log
        self.assertEqual(detail["runId"], "generation-run-1")
        self.assertEqual(detail["nodeId"], "node-a")
        report = self.store.integrity()["counts"]
        self.assertEqual(report["generation_effects"], 1)
        self.assertEqual(report["logs"], 1)
        self.assertEqual(report["events"], 1)

    def test_split_generation_effect_can_complete_its_missing_final_log(self):
        self.import_generation_canvas()
        base = dict(
            effect_id="effect:generation-run-split",
            node_id="node-a",
            generation_operation_id="generation-operation-1",
            request_index=0,
            run_id="generation-run-split",
            node_changes={
                "images": [{"url": "/assets/output/split.png"}],
                "pending": 0,
                "running": False,
            },
        )
        first = self.store.commit(
            "canvas-1",
            ADMIN,
            CanvasIntent.generation_output_commit(**base),
        )
        completed_intent = CanvasIntent.generation_output_commit(
            **base,
            final_log={
                "id": "generation-log-split",
                "status": "success",
                "outputs": [{"url": "/assets/output/split.png"}],
            },
        )

        completed = self.store.commit(
            "canvas-1",
            ADMIN,
            completed_intent,
        )
        duplicate = self.store.commit(
            "canvas-1",
            ADMIN,
            completed_intent,
        )

        self.assertTrue(first.effect_applied)
        self.assertEqual(first.revision, 8)
        self.assertTrue(completed.effect_applied)
        self.assertEqual(completed.revision, 8)
        self.assertEqual(completed.log_id, "generation-log-split")
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(duplicate.log_id, "generation-log-split")
        counts = self.store.integrity()["counts"]
        self.assertEqual(counts["generation_effects"], 1)
        self.assertEqual(counts["logs"], 1)
        self.assertEqual(counts["events"], 1)

    def test_generation_outputs_accumulate_and_run_id_is_idempotent(self):
        self.import_generation_canvas()
        first = self.generation(
            "effect:generation-run-1",
            run_id="generation-run-1",
            node_changes={
                "images": [{"url": "/assets/output/first.png"}],
                "pending": 0,
                "running": False,
            },
        )
        second = self.generation(
            "effect:generation-run-2",
            run_id="generation-run-2",
            request_index=1,
            node_changes={
                "images": [{"url": "/assets/output/second.png"}],
                "pending": 0,
                "running": False,
            },
        )
        late_retry = self.generation(
            "effect:generation-run-2-late",
            run_id="generation-run-2",
            request_index=1,
            node_changes={"images": [{"url": "must-not-apply.png"}]},
        )

        self.assertEqual(first.revision, 8)
        self.assertEqual(second.revision, 9)
        self.assertTrue(late_retry.duplicate)
        self.assertEqual(late_retry.reason, "already_applied")
        node = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas["nodes"][0]
        self.assertEqual(
            [image["url"] for image in node["images"]],
            [
                "/assets/output/first.png",
                "/assets/output/second.png",
            ],
        )
        self.assertEqual(node["pending"], 0)
        self.assertNotIn("pendingTasks", node)
        self.assertFalse(node["running"])
        self.assertEqual(
            self.store.integrity()["counts"]["generation_effects"],
            2,
        )

    def test_shared_run_commits_slots_atomically_before_browser_recovery(self):
        # Exercise durable delivery, then reopen the database as on refresh.
        for scenario in (
            "normal", "before_task_saved", "browser_first", "replaced_sibling",
            "independent_sibling", "deleted_sibling", "fewer", "surplus", "failed",
        ):
            with self.subTest(scenario=scenario):
                database = Path(self.temporary.name) / f"{scenario}.sqlite3"
                self.store = SqliteCanvasStore(database, workspace_id="workspace-a")
                document = sample_canvas()
                document["nodes"] = [
                    {
                        "id": node_id,
                        "type": "smart-image",
                        "images": [],
                        "generationOutputNode": True,
                        "generationOperationId": "generation-operation-1",
                        "generationBatchId": "shared-batch",
                        "generationSlotIndex": index,
                        "generationSlotCount": 2,
                        "generationInputSnapshot": {"settings": {"count": 2}},
                        "pending": 1,
                        "running": True,
                        "pendingTasks": [{
                            "taskId": "shared-run",
                            "generationSlotIndex": index,
                            "generationSlotCount": 2,
                        }],
                    }
                    for index, node_id in enumerate(["node-a", "slot-b"])
                ]
                document["connections"] = []
                first, second = document["nodes"]
                outputs = [{"url": "first.png"}, {"url": "second.png"}]
                expected = [["first.png"], ["second.png"]]
                if scenario == "before_task_saved":
                    for node in document["nodes"]:
                        node.pop("pendingTasks")
                elif scenario == "browser_first":
                    second.update(images=[outputs[1]], pending=0, running=False)
                    second.pop("pendingTasks")
                elif scenario == "replaced_sibling":
                    second["generationOperationId"] = "new-operation"
                    expected[1] = []
                elif scenario == "independent_sibling":
                    second["pendingTasks"][0]["taskId"] = "other-run"
                    expected[1] = []
                elif scenario == "deleted_sibling":
                    document["nodes"] = [first]
                    expected.pop()
                elif scenario == "fewer":
                    outputs.pop()
                    expected[1] = []
                elif scenario == "surplus":
                    outputs.append({"url": "third.png"})
                    expected[1].append("third.png")
                elif scenario == "failed":
                    outputs.clear()
                    expected = [[], []]
                self.import_canvas(document)
                result = self.generation(
                    "effect:shared-run", run_id="shared-run",
                    node_changes={"images": outputs, "pending": 0, "running": False},
                )
                self.assertEqual(result.revision, 8)
                reloaded = SqliteCanvasStore(database, workspace_id="workspace-a")
                snapshot = reloaded.read(
                    "canvas-1", ADMIN, CanvasProjection.public_snapshot(),
                ).canvas
                nodes = snapshot["nodes"]
                self.assertEqual(
                    [[img["url"] for img in node["images"]] for node in nodes],
                    expected,
                )
                for node in nodes:
                    if node["id"] == "slot-b" and scenario in (
                        "replaced_sibling", "independent_sibling",
                    ):
                        self.assertEqual(node, second)
                    else:
                        self.assertEqual(node["pending"], 0)
                        self.assertFalse(node["running"])
                        self.assertNotIn("pendingTasks", node)
                retry = self.generation(
                    "effect:shared-run-retry", run_id="shared-run",
                    node_changes={"images": outputs},
                )
                self.assertTrue(retry.duplicate)
                self.assertEqual(retry.revision, 8)
                self.assertEqual(reloaded.read(
                    "canvas-1", ADMIN, CanvasProjection.public_snapshot(),
                ).canvas, snapshot)

    def test_generation_target_guard_records_terminal_discard(self):
        self.import_generation_canvas()

        discarded = self.generation(
            "effect:replaced-run-0001",
            run_id="replaced-run",
            generation_operation_id="newer-operation",
            node_changes={"images": [{"url": "/assets/late.png"}]},
            final_log={"id": "must-not-log", "status": "success"},
        )
        retry = self.generation(
            "effect:replaced-run-retry",
            run_id="replaced-run",
            generation_operation_id="newer-operation",
            node_changes={"images": [{"url": "/assets/late-again.png"}]},
        )

        self.assertFalse(discarded.effect_applied)
        self.assertEqual(discarded.reason, "operation_replaced")
        self.assertTrue(retry.duplicate)
        self.assertFalse(retry.effect_applied)
        self.assertEqual(retry.reason, "operation_replaced")
        snapshot = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(snapshot["revision"], 7)
        self.assertEqual(snapshot["nodes"][0]["images"], [])
        report = self.store.integrity()["counts"]
        self.assertEqual(report["generation_effects"], 1)
        self.assertEqual(report["logs"], 0)
        self.assertEqual(report["events"], 0)

    def test_invalid_generation_log_rolls_back_node_effect_and_event(self):
        self.import_generation_canvas()
        before = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas

        with self.assertRaises(CanvasStoreError) as rejected:
            self.generation(
                "effect:rollback-run-0001",
                run_id="rollback-run",
                node_changes={
                    "images": [{"url": "/assets/output/valid.png"}],
                    "pending": 0,
                },
                final_log={
                    "id": "rollback-log",
                    "status": "success",
                    "outputs": [
                        {"url": "data:image/png;base64,AAAA"}
                    ],
                },
            )

        self.assertEqual(
            rejected.exception.code,
            "inline_media_not_materialized",
        )
        after = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.public_snapshot(),
        ).canvas
        self.assertEqual(after, before)
        report = self.store.integrity()["counts"]
        self.assertEqual(report["generation_effects"], 0)
        self.assertEqual(report["logs"], 0)
        self.assertEqual(report["events"], 0)

    def test_final_logs_page_details_dedup_and_do_not_change_revision(self):
        self.import_canvas()
        common = {
            "status": "success",
            "nodeId": "node-a",
            "platform": "provider-a",
            "model": "image-v1",
            "durationMs": 42,
            "prompt": "shared prompt",
            "request": {
                "size": "1024x1024",
                "api_key": "must-not-leak",
                "callback": "https://example.test/done?signature=secret&safe=1",
            },
            "outputs": [
                {
                    "url": "/media/output.png",
                    "kind": "image",
                    "width": 1024,
                    "height": 1024,
                }
            ],
        }
        commits = []
        for index in range(7):
            log = {
                **copy.deepcopy(common),
                "id": f"log-{index}",
                "runId": f"run-{index}",
                "createdAt": 100 + index,
            }
            commits.append(
                self.store.commit(
                    "canvas-1",
                    ADMIN,
                    CanvasIntent.append_final_log(
                        log,
                        operation_id=f"log:append-{index:04d}",
                    ),
                )
            )
        self.assertTrue(all(commit.revision == 7 for commit in commits))
        self.assertTrue(all(not commit.changed for commit in commits))

        first_page = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.log_page(),
        )
        self.assertEqual([item["id"] for item in first_page.logs], ["log-6", "log-5", "log-4", "log-3", "log-2"])
        self.assertTrue(first_page.next_cursor)
        detailed_page = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.log_page(include_details=True),
        )
        self.assertEqual(detailed_page.logs[0]["prompt"], "shared prompt")
        self.assertEqual(
            detailed_page.logs[0]["outputs"][0]["url"],
            "/media/output.png",
        )
        second_page = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.log_page(cursor=first_page.next_cursor),
        )
        self.assertEqual([item["id"] for item in second_page.logs], ["log-1", "log-0"])
        node_page = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.log_page(node_id="node-b"),
        )
        self.assertEqual(node_page.logs, ())

        detail = self.store.read(
            "canvas-1",
            DESIGNER,
            CanvasProjection.log_detail("log-6"),
        ).log
        self.assertEqual(detail["username"], "admin")
        self.assertEqual(detail["request"]["api_key"], "[REDACTED]")
        self.assertEqual(
            detail["request"]["callback"],
            "https://example.test/done?safe=1",
        )
        self.assertEqual(detail["outputs"][0]["width"], 1024)
        self.assertEqual(self.store.integrity()["counts"]["log_payloads"], 1)
        self.assertNotIn(
            "logs",
            self.store.read(
                "canvas-1", ADMIN, CanvasProjection.public_snapshot()
            ).canvas,
        )
        exported = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.full_export(),
        ).canvas
        self.assertEqual(len(exported["logs"]), 7)

    def test_run_and_operation_idempotency_prevent_duplicate_final_logs(self):
        self.import_canvas()
        first_intent = CanvasIntent.append_final_log(
            {
                "id": "log-first",
                "runId": "stable-run",
                "status": "failed",
                "rawError": "Authorization: Bearer top-secret api_key=abc",
            },
            operation_id="log:stable-operation",
        )
        first = self.store.commit("canvas-1", ADMIN, first_intent)
        retry = self.store.commit("canvas-1", ADMIN, first_intent)
        late = self.store.commit(
            "canvas-1",
            ADMIN,
            CanvasIntent.append_final_log(
                {
                    "id": "log-late",
                    "runId": "stable-run",
                    "status": "failed",
                },
                operation_id="log:late-callback",
            ),
        )

        self.assertEqual(first.log_id, "log-first")
        self.assertTrue(retry.duplicate)
        self.assertTrue(late.duplicate)
        self.assertEqual(late.log_id, "log-first")
        self.assertEqual(self.store.integrity()["counts"]["logs"], 1)
        detail = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.log_detail("log-first"),
        ).log
        self.assertNotIn("top-secret", detail["rawError"])
        self.assertNotIn("api_key=abc", detail["rawError"])

    def test_inline_log_output_is_rejected_and_transaction_rolls_back(self):
        self.import_canvas()

        with self.assertRaises(CanvasStoreError) as rejected:
            self.store.commit(
                "canvas-1",
                ADMIN,
                CanvasIntent.append_final_log(
                    {
                        "id": "inline-log",
                        "runId": "inline-run",
                        "status": "success",
                        "outputs": [
                            {"url": "data:image/png;base64,AAAA"}
                        ],
                    },
                    operation_id="log:inline-output",
                ),
            )
        self.assertEqual(
            rejected.exception.code,
            "inline_media_not_materialized",
        )
        self.assertEqual(self.store.integrity()["counts"]["logs"], 0)

    def test_raw_error_is_utf8_bounded_after_sanitization(self):
        self.import_canvas()
        self.store.commit(
            "canvas-1",
            ADMIN,
            CanvasIntent.append_final_log(
                {
                    "id": "bounded-error",
                    "status": "failed",
                    "rawError": "token=secret " + "错误" * 40000,
                },
                operation_id="log:bounded-error",
            ),
        )

        detail = self.store.read(
            "canvas-1",
            ADMIN,
            CanvasProjection.log_detail("bounded-error"),
        ).log
        self.assertLessEqual(
            len(detail["rawError"].encode("utf-8")),
            64 * 1024,
        )
        self.assertNotIn("token=secret", detail["rawError"])

    def test_integrity_uses_wal_and_database_is_workspace_scoped(self):
        report = self.store.integrity()
        self.assertTrue(report["ok"])
        self.assertEqual(report["journal_mode"], "wal")
        self.assertEqual(report["schema_version"], 1)

        with self.assertRaises(CanvasStoreError) as rejected:
            SqliteCanvasStore(
                self.database,
                workspace_id="workspace-b",
            )
        self.assertEqual(rejected.exception.code, "workspace_mismatch")


if __name__ == "__main__":
    unittest.main()
