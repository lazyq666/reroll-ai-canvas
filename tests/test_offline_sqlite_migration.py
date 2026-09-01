import base64
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.artifacts import APPLICATION_UPDATE_RUNTIME_FILES
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.offline_sqlite_migration import (
    OfflineSqliteMigrationError,
    migrate_workspace_sqlite_authority,
    rollback_workspace_sqlite_authority,
)
from infinite_canvas.sqlite_migration import prepare_sqlite_migration
from infinite_canvas import sqlite_publication_upgrade
from infinite_canvas.workspace import Workspace


class OfflineSqliteMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "workspace"
        self.data = self.root / "data"
        self.assets = self.root / "assets"
        self.output = self.assets / "output"
        self.reports = Path(self.temporary.name) / "reports"
        (self.data / "canvases").mkdir(parents=True)
        self.output.mkdir(parents=True)
        (self.root / ".infinite-canvas-workspace.json").write_text(
            json.dumps({"version": 1, "workspace_id": "workspace-offline"}),
            encoding="utf-8",
        )
        (self.data / "canvases" / "canvas-1.json").write_text(
            json.dumps(
                {
                    "id": "canvas-1",
                    "kind": "smart",
                    "title": "Historical canvas",
                    "owner_id": "designer-1",
                    "owner_username": "designer",
                    "visibility": "shared",
                    "revision": 1,
                    "nodes": [],
                    "connections": [],
                    "logs": [],
                }
            ),
            encoding="utf-8",
        )
        for name, payload in (
            ("image.png", b"image"),
            ("video.mp4", b"video"),
            ("transcript.txt", b"text"),
        ):
            (self.output / name).write_bytes(payload)
        self.history = [
            {
                "timestamp": 30.0,
                "type": "image",
                "provider_id": "provider-image",
                "model": "image-v2",
                "images": ["/assets/output/image.png"],
                "_effect_id": "generation-run:run-image",
            },
            {
                "id": "legacy-video-id",
                "timestamp": 20.0,
                "type": "video",
                "provider": "provider-video",
                "model": "video-v1",
                "videos": ["/assets/output/video.mp4"],
                "_effect_id": "generation-run:run-video",
            },
            {
                "timestamp": 10.0,
                "type": "text",
                "provider_id": "provider-text",
                "model": "text-v1",
                "texts": ["/assets/output/transcript.txt"],
                "_effect_id": "generation-run:run-text",
            },
        ]
        self.runs = [self._run(kind) for kind in ("image", "video", "text")]
        self._write_sources()

    def tearDown(self):
        self.temporary.cleanup()

    def _run(self, kind):
        url = {
            "image": "/assets/output/image.png",
            "video": "/assets/output/video.mp4",
            "text": "/assets/output/transcript.txt",
        }[kind]
        field = {"image": "images", "video": "videos", "text": "texts"}[kind]
        record = {"type": kind, field: [url], "timestamp": 10.0}
        return {
            "id": f"run-{kind}",
            "kind": kind,
            "status": "succeeded",
            "phase": "finished",
            "owner": "designer-1",
            "key": f"key-{kind}",
            "request_hash": f"hash-{kind}",
            "provider_id": f"provider-{kind}",
            "created_at": 1.0,
            "updated_at": 2.0,
            "request": {"publication": "history"},
            "prepared_output": {
                "result": record,
                "effects": {"history": record, "notification": record},
            },
            "result": record,
            "effects_done": True,
        }

    def _write_sources(self, *, effects=None):
        (self.data / "generation-history.json").write_text(
            json.dumps(self.history, ensure_ascii=False), encoding="utf-8"
        )
        (self.data / "generation-runs.json").write_text(
            json.dumps({"version": 1, "runs": self.runs}, ensure_ascii=False),
            encoding="utf-8",
        )
        completed = {
            run["id"]: ["history", "notification"] for run in self.runs
        }
        (self.data / "generation-effects.json").write_text(
            json.dumps(
                effects
                or {"version": 2, "effects": completed, "pending": {}},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _sha256(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def _publish_early_sqlite_authority(self, *, remove_run=""):
        prepared = prepare_sqlite_migration(
            WorkspaceContent(
                Workspace(
                    directory=self.root,
                    _records_directory=self.data,
                    _media_directory=self.assets,
                )
            ),
            workspace_id="workspace-offline",
            migration_id="early-cutover",
        )
        early_report = json.loads(
            prepared.preparation_report.read_text(encoding="utf-8")
        )
        early_report.pop("global_history_audit", None)
        early_report.pop("publication_audit", None)
        prepared.preparation_report.write_text(
            json.dumps(early_report, sort_keys=True), encoding="utf-8"
        )
        shutil.copy2(prepared.canvas_database, self.data / "canvas-content.sqlite3")
        shutil.copy2(
            prepared.generation_run_database,
            self.data / "generation-runs.sqlite3",
        )
        connection = sqlite3.connect(self.data / "generation-runs.sqlite3")
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript(
                """
                DROP TABLE generation_publication_receipts;
                DROP TABLE generation_history;
                UPDATE generation_run_store_metadata
                SET value = '1' WHERE key = 'schema_version';
                """
            )
            if remove_run:
                connection.execute(
                    "DELETE FROM generation_runs WHERE run_id = ?",
                    (remove_run,),
                )
            connection.commit()
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            connection.close()
        manifest = {
            "schema_version": 1,
            "workspace_id": "workspace-offline",
            "migration_id": "early-cutover",
            "canvas": "sqlite",
            "generation_runs": "sqlite",
            "canvas_sha256": self._sha256(
                self.data / "canvas-content.sqlite3"
            ),
            "generation_runs_sha256": self._sha256(
                self.data / "generation-runs.sqlite3"
            ),
        }
        (self.data / "storage-authority.json").write_text(
            json.dumps(manifest, sort_keys=True), encoding="utf-8"
        )
        return manifest

    def test_migrates_all_global_history_receipts_and_repeats_without_duplicates(self):
        original = {
            name: (self.data / name).read_bytes()
            for name in (
                "generation-history.json",
                "generation-effects.json",
                "generation-runs.json",
            )
        }

        first = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-cutover-1",
            report_directory=self.reports,
        )
        repeated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-cutover-1",
            report_directory=self.reports,
        )

        self.assertEqual("complete", first.status)
        self.assertEqual("already_complete", repeated.status)
        for name, payload in original.items():
            self.assertFalse((self.data / name).exists())
            self.assertEqual(
                payload,
                (
                    self.data
                    / "recovery"
                    / "offline-cutover-1"
                    / "legacy"
                    / name
                ).read_bytes(),
            )
        store = SqliteGenerationRunStore(
            self.data / "generation-runs.sqlite3",
            workspace_id="workspace-offline",
        )
        page = store.history_page(limit=2)
        self.assertEqual(
            ["history:run:run-image", "legacy-video-id"],
            [item["history_id"] for item in page.items],
        )
        self.assertEqual(
            ["history:run:run-text"],
            [
                item["history_id"]
                for item in store.history_page(limit=2, cursor=page.next_cursor).items
            ],
        )
        counts = store.integrity()["counts"]
        self.assertEqual(3, counts["history"])
        self.assertEqual(6, counts["publications"])
        self.assertEqual(0, counts["pending_publications"])
        report = json.loads(first.report.read_text(encoding="utf-8"))
        self.assertEqual("data/storage-authority.json", report["manifest"])
        self.assertEqual(
            "data/recovery/offline-cutover-1/legacy/legacy-archive-report.json",
            report["legacy_archive_report"],
        )
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_rollback_restores_exact_sources_and_same_migration_can_republish(self):
        original = (self.data / "generation-history.json").read_bytes()
        migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-rollback-1",
            report_directory=self.reports,
        )

        rollback = rollback_workspace_sqlite_authority(
            self.root,
            migration_id="offline-rollback-1",
            report_directory=self.reports,
        )

        self.assertTrue(rollback.ok)
        self.assertFalse((self.data / "storage-authority.json").exists())
        self.assertFalse((self.data / "canvas-content.sqlite3").exists())
        self.assertFalse((self.data / "generation-runs.sqlite3").exists())
        self.assertEqual(original, (self.data / "generation-history.json").read_bytes())
        self.assertTrue(
            (rollback.retired_sqlite_directory / "storage-authority.json").is_file()
        )
        rollback_report = json.loads(rollback.report.read_text(encoding="utf-8"))
        self.assertEqual(
            "data/recovery/offline-rollback-1/rollback/retired-sqlite-authority",
            rollback_report["retired_sqlite_directory"],
        )
        self.assertNotIn(str(self.root), json.dumps(rollback_report))

        repeated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-rollback-1",
            report_directory=self.reports,
        )
        self.assertEqual("complete", repeated.status)
        self.assertFalse((self.data / "generation-history.json").exists())

    def test_upgrades_early_sqlite_authority_and_rolls_back_exactly(self):
        old_manifest = self._publish_early_sqlite_authority(
            remove_run="run-image"
        )
        old_manifest_bytes = (self.data / "storage-authority.json").read_bytes()
        old_run_database = (self.data / "generation-runs.sqlite3").read_bytes()
        legacy_sources = {
            name: (self.data / name).read_bytes()
            for name in (
                "generation-history.json",
                "generation-effects.json",
                "generation-runs.json",
            )
        }

        migrated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-upgrade",
            report_directory=self.reports,
        )

        self.assertEqual("complete", migrated.status)
        manifest = json.loads(
            (self.data / "storage-authority.json").read_text(encoding="utf-8")
        )
        self.assertEqual("phase-two-upgrade", manifest["migration_id"])
        self.assertEqual(old_manifest["migration_id"], manifest["previous_migration_id"])
        store = SqliteGenerationRunStore(
            self.data / "generation-runs.sqlite3",
            workspace_id="workspace-offline",
        )
        self.assertIsNotNone(store.load("run-image"))
        counts = store.integrity()["counts"]
        self.assertEqual(3, counts["history"])
        self.assertEqual(6, counts["publications"])
        for name, value in legacy_sources.items():
            self.assertFalse((self.data / name).exists())
            self.assertEqual(
                value,
                (
                    self.data
                    / "recovery"
                    / "phase-two-upgrade"
                    / "legacy"
                    / name
                ).read_bytes(),
            )

        rollback = rollback_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-upgrade",
            report_directory=self.reports,
        )

        self.assertEqual(
            old_manifest_bytes,
            (self.data / "storage-authority.json").read_bytes(),
        )
        self.assertEqual(
            old_run_database,
            (self.data / "generation-runs.sqlite3").read_bytes(),
        )
        for name, value in legacy_sources.items():
            self.assertEqual(value, (self.data / name).read_bytes())
        rollback_report = json.loads(rollback.report.read_text(encoding="utf-8"))
        self.assertEqual("sqlite", rollback_report["authority"])
        self.assertEqual("early-cutover", rollback_report["restored_migration_id"])

        repeated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-upgrade",
            report_directory=self.reports,
        )
        self.assertEqual("complete", repeated.status)

    def test_existing_sqlite_upgrade_checks_authoritative_nonterminal_runs_first(self):
        self._publish_early_sqlite_authority()
        connection = sqlite3.connect(self.data / "generation-runs.sqlite3")
        try:
            connection.execute(
                "UPDATE generation_runs SET status = 'running' WHERE run_id = 'run-image'"
            )
            connection.commit()
        finally:
            connection.close()
        (self.data / "generation-history.json").write_bytes(b"[corrupt")

        with self.assertRaisesRegex(OfflineSqliteMigrationError, "未结束"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="phase-two-active-run",
                report_directory=self.reports,
            )

        self.assertEqual(b"[corrupt", (self.data / "generation-history.json").read_bytes())
        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )

    def test_early_cutover_old_migration_id_cannot_archive_phase_two_sources(self):
        self._publish_early_sqlite_authority()
        history = (self.data / "generation-history.json").read_bytes()

        with self.assertRaisesRegex(OfflineSqliteMigrationError, "新的 migration ID"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="early-cutover",
                report_directory=self.reports,
            )

        self.assertEqual(history, (self.data / "generation-history.json").read_bytes())
        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )

    def test_existing_sqlite_upgrade_missing_media_preserves_old_authority(self):
        self._publish_early_sqlite_authority()
        old_database = (self.data / "generation-runs.sqlite3").read_bytes()
        original_history = (self.data / "generation-history.json").read_bytes()
        (self.output / "video.mp4").unlink()

        with self.assertRaisesRegex(OfflineSqliteMigrationError, "人工处理"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="phase-two-missing-media",
                report_directory=self.reports,
            )

        self.assertEqual(
            old_database,
            (self.data / "generation-runs.sqlite3").read_bytes(),
        )
        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )
        report = json.loads(
            (
                self.data
                / "recovery"
                / "phase-two-missing-media"
                / "preparation-report.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual("failed", report["status"])
        self.assertEqual(
            "global_history_managed_media",
            report["manual_actions"][0]["kind"],
        )

        migrated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-missing-media",
            report_directory=self.reports,
            quarantine_missing_global_history_ids=("legacy-video-id",),
        )

        self.assertEqual("complete", migrated.status)
        store = SqliteGenerationRunStore(
            self.data / "generation-runs.sqlite3",
            workspace_id="workspace-offline",
        )
        self.assertIsNone(store.history_by_id("legacy-video-id"))
        self.assertEqual(2, store.integrity()["counts"]["history"])
        ready = json.loads(
            (
                self.data
                / "recovery"
                / "phase-two-missing-media"
                / "preparation-report.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            ["legacy-video-id"],
            [
                item["history_id"]
                for item in ready["quarantined_global_history"]
            ],
        )
        self.assertEqual(
            ["legacy-video-id"],
            ready["operator_resolution"][
                "quarantine_missing_global_history_ids"
            ],
        )
        self.assertEqual(
            original_history,
            (
                self.data
                / "recovery"
                / "phase-two-missing-media"
                / "legacy"
                / "generation-history.json"
            ).read_bytes(),
        )

        rollback_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-missing-media",
            report_directory=self.reports,
        )
        self.assertEqual(
            original_history,
            (self.data / "generation-history.json").read_bytes(),
        )

    def test_existing_sqlite_upgrade_rejects_quarantine_for_valid_history(self):
        self._publish_early_sqlite_authority()

        with self.assertRaisesRegex(
            OfflineSqliteMigrationError, "History 仍可验证"
        ):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="phase-two-invalid-quarantine",
                report_directory=self.reports,
                quarantine_missing_global_history_ids=(
                    "history:run:run-image",
                ),
            )

        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(
                    encoding="utf-8"
                )
            )["migration_id"],
        )
        self.assertTrue((self.data / "generation-history.json").is_file())

    def test_existing_sqlite_upgrade_resumes_after_database_before_manifest_crash(self):
        self._publish_early_sqlite_authority()
        original_write = sqlite_publication_upgrade._write_json_atomic

        def crash_before_manifest(path, value):
            if path.name == "storage-authority.json":
                raise KeyboardInterrupt("simulated upgrade commit-point crash")
            return original_write(path, value)

        with patch(
            "infinite_canvas.sqlite_publication_upgrade._write_json_atomic",
            side_effect=crash_before_manifest,
        ):
            with self.assertRaises(KeyboardInterrupt):
                migrate_workspace_sqlite_authority(
                    self.root,
                    migration_id="phase-two-crash-resume",
                    report_directory=self.reports,
                )

        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )
        self.assertTrue((self.data / "generation-history.json").is_file())

        resumed = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-crash-resume",
            report_directory=self.reports,
        )

        self.assertEqual("complete", resumed.status)
        self.assertEqual(
            "phase-two-crash-resume",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )
        self.assertFalse((self.data / "generation-history.json").exists())

    def test_existing_sqlite_upgrade_materializes_inline_input_and_retires_it_on_rollback(self):
        self._publish_early_sqlite_authority(remove_run="run-image")
        payload = b"\x89PNG\r\n\x1a\nphase-two-inline-input"
        data_url = "data:image/png;base64," + base64.b64encode(payload).decode(
            "ascii"
        )
        self.runs[0]["request"] = {
            "messages": [
                {
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}}
                    ]
                }
            ]
        }
        self._write_sources()

        migrated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-inline-input",
            report_directory=self.reports,
        )

        self.assertEqual("complete", migrated.status)
        digest = hashlib.sha256(payload).hexdigest()
        relative = (
            Path("assets")
            / "input"
            / "migrations"
            / "phase-two-inline-input"
            / f"{digest}.png"
        )
        materialized = self.root / relative
        self.assertEqual(payload, materialized.read_bytes())
        store = SqliteGenerationRunStore(
            self.data / "generation-runs.sqlite3",
            workspace_id="workspace-offline",
        )
        stored_url = store.load("run-image").request["messages"][0]["content"][
            0
        ]["image_url"]["url"]
        self.assertEqual("/" + relative.as_posix(), stored_url)
        preparation = json.loads(
            (
                self.data
                / "recovery"
                / "phase-two-inline-input"
                / "preparation-report.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            [relative.as_posix()],
            [
                item["relative_path"]
                for item in preparation["materialized_inline_media"]
            ],
        )

        rollback = rollback_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-inline-input",
            report_directory=self.reports,
        )

        self.assertFalse(materialized.exists())
        retired = (
            self.data
            / "recovery"
            / "phase-two-inline-input"
            / "rollback"
            / "retired-materialized-media"
            / relative
        )
        self.assertEqual(payload, retired.read_bytes())
        rollback_report = json.loads(rollback.report.read_text(encoding="utf-8"))
        self.assertEqual(1, rollback_report["retired_materialized_media_count"])

    def test_existing_sqlite_upgrade_cleans_materialized_input_on_publish_failure(self):
        self._publish_early_sqlite_authority(remove_run="run-image")
        payload = b"\x89PNG\r\n\x1a\nphase-two-failed-publication"
        self.runs[0]["request"] = {
            "image_url": "data:image/png;base64,"
            + base64.b64encode(payload).decode("ascii")
        }
        self._write_sources()
        digest = hashlib.sha256(payload).hexdigest()
        materialized = (
            self.assets
            / "input"
            / "migrations"
            / "phase-two-inline-failure"
            / f"{digest}.png"
        )

        with patch(
            "infinite_canvas.sqlite_publication_upgrade."
            "archive_legacy_generation_json",
            side_effect=RuntimeError("simulated archive failure"),
        ):
            with self.assertRaisesRegex(
                OfflineSqliteMigrationError, "simulated archive failure"
            ):
                migrate_workspace_sqlite_authority(
                    self.root,
                    migration_id="phase-two-inline-failure",
                    report_directory=self.reports,
                )

        self.assertFalse(materialized.exists())
        self.assertTrue((self.data / "generation-runs.json").is_file())
        self.assertEqual(
            "early-cutover",
            json.loads(
                (self.data / "storage-authority.json").read_text(encoding="utf-8")
            )["migration_id"],
        )

        repeated = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="phase-two-inline-failure",
            report_directory=self.reports,
        )
        self.assertEqual("complete", repeated.status)
        self.assertEqual(payload, materialized.read_bytes())

    def test_preflight_and_source_failures_do_not_change_json_authority(self):
        cases = []

        self.runs[0]["status"] = "running"
        self._write_sources()
        cases.append("未结束 Generation Run")
        with self.assertRaisesRegex(OfflineSqliteMigrationError, cases[-1]):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-active-run",
                report_directory=self.reports,
            )
        self.assertFalse((self.data / "storage-authority.json").exists())
        self.runs[0]["status"] = "succeeded"

        self.history[1]["id"] = "conflict"
        self.history[2]["id"] = "conflict"
        self._write_sources()
        with self.assertRaisesRegex(OfflineSqliteMigrationError, "History ID 冲突"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-history-conflict",
                report_directory=self.reports,
            )
        self.assertFalse((self.data / "storage-authority.json").exists())

    def test_missing_media_and_unsafe_pending_effect_stop_with_manual_report(self):
        (self.output / "video.mp4").unlink()
        with self.assertRaisesRegex(OfflineSqliteMigrationError, "Managed Media 缺失"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-missing-media",
                report_directory=self.reports,
            )
        self.assertFalse((self.data / "storage-authority.json").exists())

        (self.output / "video.mp4").write_bytes(b"video")
        self.runs = [run for run in self.runs if run["id"] != "run-text"]
        self._write_sources(
            effects={
                "version": 2,
                "effects": {},
                "pending": {"run-text": ["notification"]},
            }
        )
        with self.assertRaisesRegex(OfflineSqliteMigrationError, "人工处理"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-unsafe-pending",
                report_directory=self.reports,
            )
        preparation = json.loads(
            (
                self.data
                / "recovery"
                / "offline-unsafe-pending"
                / "preparation-report.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual("failed", preparation["status"])
        self.assertEqual(
            "durable_run_or_prepared_output_missing",
            preparation["publication_audit"]["manual_actions"][0]["reason"],
        )

    def test_unmanaged_history_output_stops_before_authority_publication(self):
        self.history[0]["images"] = ["legacy-relative-image.png"]
        self._write_sources()

        with self.assertRaisesRegex(OfflineSqliteMigrationError, "未托管输出"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-unmanaged-output",
                report_directory=self.reports,
            )

        self.assertFalse((self.data / "storage-authority.json").exists())
        self.assertTrue((self.data / "generation-history.json").is_file())

    def test_safe_pending_notification_is_durable_and_claimable(self):
        effects = {
            "version": 2,
            "effects": {
                "run-image": ["history"],
                "run-video": ["history", "notification"],
                "run-text": ["history", "notification"],
            },
            "pending": {"run-image": ["notification"]},
        }
        self._write_sources(effects=effects)

        migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-pending-notification",
            report_directory=self.reports,
        )

        store = SqliteGenerationRunStore(
            self.data / "generation-runs.sqlite3",
            workspace_id="workspace-offline",
        )
        claim = store.claim_publication("restart-worker", lease_seconds=30)
        self.assertEqual("run-image", claim.run_id)
        self.assertEqual("notification", claim.effect_kind)
        self.assertEqual(
            ["/assets/output/image.png"], claim.payload["images"]
        )

    def test_corrupt_source_stops_before_formal_databases_are_published(self):
        (self.data / "generation-effects.json").write_bytes(b'{"pending":')

        with self.assertRaises(OfflineSqliteMigrationError):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="offline-corrupt-json",
                report_directory=self.reports,
            )

        self.assertFalse((self.data / "storage-authority.json").exists())
        self.assertFalse((self.data / "canvas-content.sqlite3").exists())
        self.assertFalse((self.data / "generation-runs.sqlite3").exists())
        self.assertEqual(b'{"pending":', (self.data / "generation-effects.json").read_bytes())

    def test_integrity_gate_failure_keeps_sources_and_json_authority(self):
        source = (self.data / "generation-history.json").read_bytes()
        with patch(
            "infinite_canvas.sqlite_migration.SqliteGenerationRunStore.integrity",
            return_value={
                "ok": False,
                "counts": {
                    "runs": 3,
                    "history": 3,
                    "publications": 6,
                    "pending_publications": 0,
                },
            },
        ):
            with self.assertRaisesRegex(
                OfflineSqliteMigrationError, "完整性检查失败"
            ):
                migrate_workspace_sqlite_authority(
                    self.root,
                    migration_id="offline-integrity-failure",
                    report_directory=self.reports,
                )

        self.assertEqual(source, (self.data / "generation-history.json").read_bytes())
        self.assertFalse((self.data / "storage-authority.json").exists())
        self.assertFalse((self.data / "canvas-content.sqlite3").exists())

    def test_crash_after_manifest_resumes_same_migration_and_finishes_archive(self):
        sources = {
            name: (self.data / name).read_bytes()
            for name in (
                "generation-history.json",
                "generation-effects.json",
                "generation-runs.json",
            )
        }
        with patch(
            "infinite_canvas.sqlite_authority_publish.archive_legacy_generation_json",
            side_effect=KeyboardInterrupt("simulated crash after manifest"),
        ):
            with self.assertRaises(KeyboardInterrupt):
                migrate_workspace_sqlite_authority(
                    self.root,
                    migration_id="offline-crash-resume",
                    report_directory=self.reports,
                )

        self.assertTrue((self.data / "storage-authority.json").is_file())
        for name, payload in sources.items():
            self.assertEqual(payload, (self.data / name).read_bytes())

        resumed = migrate_workspace_sqlite_authority(
            self.root,
            migration_id="offline-crash-resume",
            report_directory=self.reports,
        )
        self.assertEqual("already_complete", resumed.status)
        for name, payload in sources.items():
            self.assertFalse((self.data / name).exists())
            self.assertEqual(
                payload,
                (
                    self.data
                    / "recovery"
                    / "offline-crash-resume"
                    / "legacy"
                    / name
                ).read_bytes(),
            )

    def test_cli_requires_stop_confirmation_and_absolute_workspace_path(self):
        script = (
            Path(__file__).resolve().parents[1]
            / "scripts"
            / "storage"
            / "migrate_workspace_sqlite_authority.py"
        )
        common = [
            sys.executable,
            str(script),
            "migrate",
            "--workspace",
            str(self.root),
            "--migration-id",
            "offline-cli-contract",
            "--report-directory",
            str(self.reports),
        ]
        missing_confirmation = subprocess.run(
            common,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        relative_workspace = subprocess.run(
            [
                *common[:4],
                "relative-workspace",
                *common[5:],
                "--confirm-service-stopped",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        missing_quarantine_confirmation = subprocess.run(
            [
                *common,
                "--confirm-service-stopped",
                "--quarantine-missing-history-id",
                "history:broken",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(2, missing_confirmation.returncode)
        self.assertIn("--confirm-service-stopped is required", missing_confirmation.stderr)
        self.assertEqual(2, relative_workspace.returncode)
        self.assertIn("--workspace must be an absolute path", relative_workspace.stderr)
        self.assertEqual(2, missing_quarantine_confirmation.returncode)
        self.assertIn(
            "--confirm-quarantine-broken-history must be used together",
            missing_quarantine_confirmation.stderr,
        )

    def test_invalid_migration_id_cannot_escape_report_or_recovery_directories(self):
        with self.assertRaisesRegex(OfflineSqliteMigrationError, "migration ID"):
            migrate_workspace_sqlite_authority(
                self.root,
                migration_id="../outside",
                report_directory=self.reports,
            )

        self.assertFalse(Path(self.temporary.name, "outside").exists())
        self.assertFalse((self.data / "storage-authority.json").exists())

    def test_phase_two_runtime_modules_are_in_application_updates(self):
        self.assertTrue(
            {
                "backend/infinite_canvas/generation_publication.py",
                "backend/infinite_canvas/generation_run_store.py",
                "backend/infinite_canvas/legacy_generation_archive.py",
                "backend/infinite_canvas/offline_sqlite_migration.py",
                "backend/infinite_canvas/sqlite_authority_publish.py",
                "backend/infinite_canvas/sqlite_legacy_export.py",
                "backend/infinite_canvas/sqlite_migration.py",
                "backend/infinite_canvas/sqlite_publication_upgrade.py",
            }.issubset(APPLICATION_UPDATE_RUNTIME_FILES)
        )


if __name__ == "__main__":
    unittest.main()
