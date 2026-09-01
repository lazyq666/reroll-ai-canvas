import tempfile
import unittest
import sqlite3
from dataclasses import replace
from pathlib import Path

from infinite_canvas.generation_run_store import (
    EffectResolution,
    GenerationRunAttempt,
    GenerationRunEffect,
    GenerationRunState,
    GenerationRunStoreError,
    SqliteGenerationRunStore,
)


class SqliteGenerationRunStoreContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "generation-runs.sqlite3"
        self.clock = 1000.0
        self.store = SqliteGenerationRunStore(
            self.database,
            workspace_id="workspace-a",
            now=lambda: self.clock,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def sample_run(self, run_id: str = "run-1") -> GenerationRunState:
        return GenerationRunState(
            run_id=run_id,
            kind="image",
            status="running",
            phase="provider_completed",
            owner="designer-1",
            key="node-a:operation-a:0",
            request_hash="request-hash-1",
            provider_id="provider-a",
            created_at=900.0,
            updated_at=1000.0,
            request={"prompt": "draw a lighthouse", "count": 1},
            effect_context={"publication": "history"},
            target={
                "canvas_id": "canvas-1",
                "node_id": "node-a",
                "operation_id": "operation-a",
                "request_index": 0,
            },
            public_metadata={"model": "image-v1"},
            recoverable=True,
            attempts=(
                GenerationRunAttempt(
                    attempt_index=0,
                    status="succeeded",
                    provider_id="provider-a",
                    remote_ref="remote-1",
                    payload={"prompt_index": 0},
                    provider_output={"images": ["/assets/output/one.png"]},
                    updated_at=995.0,
                ),
            ),
            remote_refs=(("provider-a", "remote-1"),),
            provider_output={"images": ["/assets/output/one.png"]},
            prepared_output={
                "result": {"images": ["/assets/output/one.png"]},
                "canvas": {"images": ["/assets/output/one.png"]},
            },
        )

    def test_save_and_load_unfinished_run_through_the_store_interface(self):
        expected = self.sample_run()

        self.store.save(expected)

        self.assertEqual(self.store.load("run-1"), expected)
        self.assertEqual(self.store.load_unfinished(), (expected,))
        self.assertEqual(
            self.store.integrity()["counts"],
            {
                "runs": 1,
                "payloads": 1,
                "attempts": 1,
                "remote_refs": 1,
                "outputs": 1,
                "effects": 0,
                "pending_effects": 0,
                "history": 0,
                "publications": 0,
                "pending_publications": 0,
                "orphan_pending_publications": 0,
            },
        )

    def test_save_makes_one_stable_effect_claimable_with_the_run(self):
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={
                "node_id": "node-a",
                "generation_operation_id": "operation-a",
                "request_index": 0,
                "node_changes": {
                    "images": [{"url": "/assets/output/one.png"}]
                },
                "final_log": {"id": "log-1", "status": "success"},
            },
            created_at=1000.0,
        )

        self.store.save(self.sample_run(), effect=effect)
        claim = self.store.claim_effect("worker-a", lease_seconds=30)

        self.assertIsNotNone(claim)
        self.assertEqual(claim.effect_id, effect.effect_id)
        self.assertEqual(claim.run_id, effect.run_id)
        self.assertEqual(claim.canvas_id, effect.canvas_id)
        self.assertEqual(claim.payload, effect.payload)
        self.assertEqual(claim.lease_owner, "worker-a")
        self.assertEqual(claim.lease_expires_at, 1030.0)
        self.assertEqual(claim.attempt_count, 1)
        self.assertEqual(self.store.integrity()["counts"]["pending_effects"], 1)

        changed = GenerationRunEffect(
            effect_id=effect.effect_id,
            run_id=effect.run_id,
            canvas_id=effect.canvas_id,
            payload={"node_changes": {"images": [{"url": "changed.png"}]}},
            created_at=effect.created_at,
        )
        changed_run = replace(
            self.sample_run(),
            status="queued",
            request={"prompt": "must roll back with the collision"},
        )
        with self.assertRaises(GenerationRunStoreError) as rejected:
            self.store.save(changed_run, effect=changed)
        self.assertEqual(rejected.exception.code, "effect_collision")
        self.assertEqual(self.store.load("run-1"), self.sample_run())

    def test_effect_requires_a_real_terminal_run_status(self):
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={"node_changes": {}},
            created_at=1000.0,
            terminal_status="running",
        )

        with self.assertRaises(GenerationRunStoreError) as rejected:
            self.store.save(self.sample_run(), effect=effect)

        self.assertEqual(rejected.exception.code, "invalid_terminal_status")
        self.assertIsNone(self.store.load("run-1"))

    def test_inline_media_must_be_materialized_before_run_persistence(self):
        run = replace(
            self.sample_run(),
            prepared_output={
                "result": {
                    "images": ["data:image/png;base64,AAAA"]
                }
            },
        )

        with self.assertRaises(GenerationRunStoreError) as rejected:
            self.store.save(run)

        self.assertEqual(
            rejected.exception.code,
            "inline_media_not_materialized",
        )
        self.assertIsNone(self.store.load("run-1"))

    def test_expired_lease_is_replayed_and_stale_claim_cannot_settle(self):
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={"node_changes": {"images": ["/assets/output/one.png"]}},
            created_at=1000.0,
        )
        self.store.save(self.sample_run(), effect=effect)
        first = self.store.claim_effect("worker-a", lease_seconds=30)

        self.assertIsNone(self.store.claim_effect("worker-b", lease_seconds=30))
        self.clock = 1031.0
        restarted = SqliteGenerationRunStore(
            self.database,
            workspace_id="workspace-a",
            now=lambda: self.clock,
        )
        replay = restarted.claim_effect("worker-b", lease_seconds=45)

        self.assertIsNotNone(replay)
        self.assertNotEqual(replay.lease_token, first.lease_token)
        self.assertEqual(replay.lease_owner, "worker-b")
        self.assertEqual(replay.lease_expires_at, 1076.0)
        self.assertEqual(replay.attempt_count, 2)
        self.assertFalse(
            restarted.settle_effect(first, EffectResolution.APPLIED)
        )
        self.assertTrue(
            restarted.settle_effect(
                replay,
                EffectResolution.RETRY,
                detail="database is busy",
                retry_delay_seconds=10,
            )
        )
        self.clock = 1040.0
        self.assertIsNone(self.store.claim_effect("worker-c", lease_seconds=30))
        self.clock = 1041.0
        third = self.store.claim_effect("worker-c", lease_seconds=30)
        self.assertIsNotNone(third)
        self.assertEqual(third.attempt_count, 3)

    def test_applied_effect_completes_run_and_only_then_cleans_large_details(self):
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={
                "node_changes": {
                    "images": [{"url": "/assets/output/one.png"}]
                },
                "final_log": {"id": "log-1", "status": "success"},
            },
            created_at=1000.0,
        )
        self.store.save(self.sample_run(), effect=effect)
        before = self.store.integrity()["counts"]
        self.assertEqual(before["payloads"], 1)
        self.assertEqual(before["attempts"], 1)
        self.assertEqual(before["outputs"], 1)
        claim = self.store.claim_effect("worker-a", lease_seconds=30)

        self.assertTrue(
            self.store.settle_effect(
                claim,
                EffectResolution.APPLIED,
                detail="canvas commit accepted effect",
            )
        )

        completed = self.store.load("run-1")
        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(completed.phase, "finished")
        self.assertEqual(completed.request, {})
        self.assertEqual(completed.attempts, ())
        self.assertEqual(completed.remote_refs, ())
        self.assertIsNone(completed.provider_output)
        self.assertIsNone(completed.prepared_output)
        self.assertEqual(self.store.load_unfinished(), ())
        self.assertIsNone(self.store.claim_effect("worker-b", lease_seconds=30))
        self.assertEqual(
            self.store.integrity()["counts"],
            {
                "runs": 1,
                "payloads": 0,
                "attempts": 0,
                "remote_refs": 0,
                "outputs": 0,
                "effects": 1,
                "pending_effects": 0,
                "history": 0,
                "publications": 0,
                "pending_publications": 0,
                "orphan_pending_publications": 0,
            },
        )
        with self.assertRaises(GenerationRunStoreError) as rejected:
            self.store.save(self.sample_run())
        self.assertEqual(rejected.exception.code, "run_finalized")

    def test_terminal_run_remains_unfinished_until_its_final_log_effect_is_done(self):
        failed = replace(
            self.sample_run(),
            status="failed",
            phase="output_prepared",
            error="provider rejected the request",
            status_code=422,
        )
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={
                "node_changes": {},
                "final_log": {"id": "log-1", "status": "failed"},
            },
            terminal_status="failed",
            created_at=1000.0,
        )

        self.store.save(failed, effect=effect)
        self.assertEqual(self.store.load_unfinished(), (failed,))
        claim = self.store.claim_effect("worker-a", lease_seconds=30)
        self.assertTrue(
            self.store.settle_effect(claim, EffectResolution.APPLIED)
        )

        completed = self.store.load("run-1")
        self.assertEqual(completed.status, "failed")
        self.assertEqual(completed.error, "provider rejected the request")
        self.assertEqual(completed.status_code, 422)
        self.assertEqual(self.store.load_unfinished(), ())

    def test_target_guard_discard_is_a_terminal_outcome_and_cleans_details(self):
        effect = GenerationRunEffect(
            effect_id="effect:run-1",
            run_id="run-1",
            canvas_id="canvas-1",
            payload={"node_changes": {"images": ["late.png"]}},
            created_at=1000.0,
        )
        self.store.save(self.sample_run(), effect=effect)
        claim = self.store.claim_effect("worker-a", lease_seconds=30)

        self.assertTrue(
            self.store.settle_effect(
                claim,
                EffectResolution.DISCARDED,
                detail="generation operation was replaced",
            )
        )

        completed = self.store.load("run-1")
        self.assertEqual(completed.status, "discarded")
        self.assertEqual(completed.phase, "finished")
        self.assertEqual(self.store.integrity()["counts"]["pending_effects"], 0)
        self.assertEqual(self.store.integrity()["counts"]["outputs"], 0)

    def test_database_cannot_be_reopened_for_another_workspace(self):
        self.store.save(self.sample_run())

        with self.assertRaises(GenerationRunStoreError) as rejected:
            SqliteGenerationRunStore(
                self.database,
                workspace_id="workspace-b",
            )

        self.assertEqual(rejected.exception.code, "workspace_mismatch")
        self.assertEqual(self.store.load("run-1"), self.sample_run())

    def test_phase_one_schema_upgrades_in_place_before_sqlite_runtime_use(self):
        phase_one = Path(self.temporary.name) / "phase-one-generation-runs.sqlite3"
        connection = sqlite3.connect(phase_one)
        connection.execute(
            "CREATE TABLE generation_run_store_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        connection.executemany(
            "INSERT INTO generation_run_store_metadata(key, value) VALUES (?, ?)",
            (("schema_version", "1"), ("workspace_id", "workspace-a")),
        )
        connection.commit()
        connection.close()

        upgraded = SqliteGenerationRunStore(
            phase_one,
            workspace_id="workspace-a",
        )

        self.assertEqual(2, upgraded.integrity()["schema_version"])
        connection = sqlite3.connect(phase_one)
        try:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            version = connection.execute(
                "SELECT value FROM generation_run_store_metadata WHERE key = 'schema_version'"
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual("2", version)
        self.assertIn("generation_history", tables)
        self.assertIn("generation_publication_receipts", tables)

    def test_global_history_has_stable_identity_cursor_paging_and_delete(self):
        records = (
            (
                "run-image",
                "history-image",
                {
                    "timestamp": 30.0,
                    "type": "image",
                    "provider_id": "provider-image",
                    "model": "image-v2",
                    "images": ["/assets/output/image.png"],
                },
            ),
            (
                "run-video",
                "history-video",
                {
                    "timestamp": 20.0,
                    "type": "video",
                    "provider": "provider-video",
                    "model": "video-v1",
                    "videos": ["/assets/output/video.mp4"],
                },
            ),
            (
                "run-text",
                "history-text",
                {
                    "timestamp": 10.0,
                    "type": "text",
                    "params": {"provider_id": "provider-text", "model": "text-v1"},
                    "texts": ["/assets/output/transcript.txt"],
                },
            ),
        )
        for run_id, history_id, record in records:
            self.store.publish_history(run_id, history_id, record)

        first = self.store.history_page(limit=2)
        second = self.store.history_page(limit=2, cursor=first.next_cursor)

        self.assertEqual(
            ["history-image", "history-video"],
            [item["history_id"] for item in first.items],
        )
        self.assertTrue(first.next_cursor)
        self.assertEqual(["history-text"], [item["history_id"] for item in second.items])
        self.assertEqual("", second.next_cursor)
        self.assertEqual(
            ["history-video"],
            [
                item["history_id"]
                for item in self.store.history_page(media_type="video").items
            ],
        )
        self.assertEqual(
            "provider-text",
            self.store.history_by_id("history-text")["params"]["provider_id"],
        )
        deleted = self.store.delete_history(history_id="history-video")
        self.assertEqual(["history-video"], [item["history_id"] for item in deleted])
        self.assertIsNone(self.store.history_by_id("history-video"))

    def test_history_identity_collision_never_overwrites_newer_content(self):
        self.store.publish_history(
            "run-1",
            "history-1",
            {"timestamp": 1, "images": ["/assets/output/one.png"]},
        )

        with self.assertRaises(GenerationRunStoreError) as rejected:
            self.store.publish_history(
                "run-1",
                "history-1",
                {"timestamp": 2, "images": ["/assets/output/two.png"]},
            )

        self.assertEqual(rejected.exception.code, "history_collision")
        self.assertEqual(
            ["/assets/output/one.png"],
            self.store.history_by_id("history-1")["images"],
        )

    def test_publication_receipt_claim_restart_and_legacy_projection(self):
        self.store.save(
            replace(
                self.sample_run("run-notify"),
                status="succeeded",
                phase="output_prepared",
            )
        )
        payload = {"images": ["/assets/output/notice.png"]}
        self.store.seed_publication_receipt(
            "run-notify",
            "notification",
            completed=False,
            payload=payload,
            created_at=900,
        )

        claim = self.store.claim_publication(
            "worker-a", lease_seconds=30
        )
        self.assertEqual("generation-run:run-notify:notification", claim.effect_id)
        self.assertEqual(payload, claim.payload)
        self.assertTrue(self.store.settle_publication(claim, completed=True))

        reopened = SqliteGenerationRunStore(
            self.database,
            workspace_id="workspace-a",
            now=lambda: self.clock,
        )
        self.assertIsNone(
            reopened.claim_publication("worker-b", lease_seconds=30)
        )
        snapshot = reopened.legacy_publication_snapshot()
        self.assertEqual(
            {"run-notify": ("notification",)},
            snapshot.completed,
        )
        self.assertEqual({}, snapshot.pending)


if __name__ == "__main__":
    unittest.main()
