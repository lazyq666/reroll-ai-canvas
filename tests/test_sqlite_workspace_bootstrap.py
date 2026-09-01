import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.sqlite_workspace_bootstrap import (
    FreshWorkspaceSqliteBootstrapError,
    bootstrap_fresh_workspace_sqlite,
    fresh_workspace_bootstrap_pending,
    fresh_workspace_sqlite_bootstrap_required,
)
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace import Workspace
from infinite_canvas.workspace_storage_composition import (
    compose_workspace_storage,
)


class FreshWorkspaceSqliteBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "workspace"
        self.data = self.root / "data"
        self.assets = self.root / "assets"
        self.data.mkdir(parents=True)
        self.assets.mkdir()
        self.content = WorkspaceContent(
            Workspace(
                directory=self.root,
                _records_directory=self.data,
                _media_directory=self.assets,
            )
        )
        self.workspace_id = "workspace-bootstrap-1"

    def tearDown(self):
        self.temporary.cleanup()

    def test_bootstraps_both_databases_before_sqlite_manifest(self):
        result = bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )

        authority = resolve_storage_authority(
            self.content.storage_authority,
            self.workspace_id,
            supported_modes=("sqlite",),
        )
        report = json.loads(result.recovery_report.read_text(encoding="utf-8"))
        composition = compose_workspace_storage(
            self.content,
            workspace_id=self.workspace_id,
        )

        self.assertEqual("sqlite", authority.mode)
        self.assertTrue(composition.sqlite_ready)
        self.assertEqual("databases_durable", report["phase"])
        self.assertFalse(self.content.generation_runs.exists())
        self.assertEqual([], list(self.content.smart_canvases.glob("*.json")))

    def test_retry_keeps_existing_sqlite_business_data(self):
        bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )
        composition = compose_workspace_storage(
            self.content,
            workspace_id=self.workspace_id,
        )
        composition.canvas_store.commit(
            "canvas-1",
            {"id": "owner-1", "username": "owner", "role": "admin"},
            CanvasIntent.create_canvas(
                {
                    "id": "canvas-1",
                    "kind": "smart",
                    "title": "Retained",
                    "owner_id": "owner-1",
                    "owner_username": "owner",
                    "visibility": "shared",
                    "nodes": [],
                    "connections": [],
                },
                operation_id="create-canvas-1",
            )
        )

        bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )
        reopened = compose_workspace_storage(
            self.content,
            workspace_id=self.workspace_id,
        )

        self.assertEqual(
            "Retained",
            reopened.canvas_store.read(
                "canvas-1",
                {"id": "owner-1", "username": "owner", "role": "admin"},
                CanvasProjection.public_snapshot(),
            ).canvas["title"],
        )

    def test_failure_between_databases_can_resume_without_manifest(self):
        with mock.patch(
            "infinite_canvas.sqlite_workspace_bootstrap.SqliteGenerationRunStore",
            side_effect=RuntimeError("injected run store failure"),
        ):
            with self.assertRaises(FreshWorkspaceSqliteBootstrapError):
                bootstrap_fresh_workspace_sqlite(
                    self.content,
                    workspace_id=self.workspace_id,
                )

        self.assertTrue(self.content.canvas_content.is_file())
        self.assertFalse(self.content.storage_authority.exists())
        self.assertTrue(
            fresh_workspace_bootstrap_pending(
                self.content,
                self.workspace_id,
            )
        )

        bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )

        self.assertTrue(
            compose_workspace_storage(
                self.content,
                workspace_id=self.workspace_id,
            ).sqlite_ready
        )

    def test_setup_retries_even_when_crash_preceded_recovery_report(self):
        self.assertTrue(
            fresh_workspace_sqlite_bootstrap_required(
                self.content,
                self.workspace_id,
            )
        )

        with mock.patch(
            "infinite_canvas.sqlite_workspace_bootstrap._write_atomic_json",
            side_effect=OSError("injected pre-report failure"),
        ):
            with self.assertRaises(FreshWorkspaceSqliteBootstrapError):
                bootstrap_fresh_workspace_sqlite(
                    self.content,
                    workspace_id=self.workspace_id,
                )

        self.assertFalse(self.content.storage_authority.exists())
        self.assertFalse(self.content.canvas_content.exists())
        self.assertTrue(
            fresh_workspace_sqlite_bootstrap_required(
                self.content,
                self.workspace_id,
            )
        )

        bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )
        self.assertTrue(self.content.storage_authority.is_file())

    def test_manifest_commit_failure_leaves_verified_retry_state(self):
        from infinite_canvas import sqlite_workspace_bootstrap as bootstrap

        real_write = bootstrap._write_atomic_json

        def fail_manifest(path, value):
            if Path(path) == self.content.storage_authority:
                raise OSError("injected manifest failure")
            return real_write(path, value)

        with mock.patch.object(
            bootstrap,
            "_write_atomic_json",
            side_effect=fail_manifest,
        ):
            with self.assertRaises(FreshWorkspaceSqliteBootstrapError):
                bootstrap_fresh_workspace_sqlite(
                    self.content,
                    workspace_id=self.workspace_id,
                )

        self.assertTrue(self.content.canvas_content.is_file())
        self.assertTrue(self.content.generation_run_store.is_file())
        self.assertFalse(self.content.storage_authority.exists())
        self.assertTrue(
            fresh_workspace_bootstrap_pending(
                self.content,
                self.workspace_id,
            )
        )

        bootstrap_fresh_workspace_sqlite(
            self.content,
            workspace_id=self.workspace_id,
        )

        self.assertEqual(
            "sqlite",
            resolve_storage_authority(
                self.content.storage_authority,
                self.workspace_id,
                supported_modes=("sqlite",),
            ).mode,
        )

    def test_legacy_json_is_never_overwritten_by_fresh_bootstrap(self):
        self.content.smart_canvases.mkdir(parents=True)
        legacy = self.content.smart_canvas("legacy-1")
        original = b'{"id":"legacy-1"}'
        legacy.write_bytes(original)

        self.assertFalse(
            fresh_workspace_sqlite_bootstrap_required(
                self.content,
                self.workspace_id,
            )
        )

        with self.assertRaisesRegex(
            FreshWorkspaceSqliteBootstrapError,
            "受控迁移",
        ):
            bootstrap_fresh_workspace_sqlite(
                self.content,
                workspace_id=self.workspace_id,
            )

        self.assertEqual(original, legacy.read_bytes())
        self.assertFalse(self.content.storage_authority.exists())
        self.assertFalse(self.content.canvas_content.exists())
        self.assertFalse(self.content.generation_run_store.exists())


if __name__ == "__main__":
    unittest.main()
