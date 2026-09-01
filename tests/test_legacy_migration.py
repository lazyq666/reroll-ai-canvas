import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.legacy_migration import (
    LegacyMigrationError,
    build_migration_plan,
    execute_migration,
)


class LegacyMigrationTests(unittest.TestCase):
    def _paths(self, root: Path):
        return (
            root / "legacy",
            root / "new-workspace",
            root / "device-cache",
            root / "device-state",
        )

    def test_plan_splits_workspace_cache_and_discarded_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace, cache, state = self._paths(root)
            (source / "canvases").mkdir(parents=True)
            (source / "canvases" / "one.json").write_text(
                "{}",
                encoding="utf-8",
            )
            (source / "media_previews").mkdir()
            (source / "media_previews" / "one.webp").write_bytes(b"preview")
            (source / "models" / "matting").mkdir(parents=True)
            (source / "models" / "matting" / "model.onnx").write_bytes(
                b"model"
            )
            (source / "storage_settings.json").write_text(
                "{}",
                encoding="utf-8",
            )

            plan = build_migration_plan(
                source,
                workspace,
                cache,
                state,
            )

            mapped = {
                item.source_relative: (
                    item.destination_kind,
                    item.destination_relative,
                )
                for item in plan.items
            }
            self.assertEqual(
                ("workspace-data", "canvases/one.json"),
                mapped["canvases/one.json"],
            )
            self.assertEqual(
                ("device-cache", "media-previews/one.webp"),
                mapped["media_previews/one.webp"],
            )
            self.assertEqual(
                ("device-cache", "models/matting/model.onnx"),
                mapped["models/matting/model.onnx"],
            )
            self.assertEqual(("storage_settings.json",), plan.discarded)
            self.assertEqual((), plan.unknown)

    def test_unknown_file_blocks_all_writes_and_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace, cache, state = self._paths(root)
            source.mkdir()
            (source / "mystery.bin").write_bytes(b"unknown")
            plan = build_migration_plan(
                source,
                workspace,
                cache,
                state,
            )

            with self.assertRaises(LegacyMigrationError):
                execute_migration(plan, delete_source=True)

            self.assertTrue(source.is_dir())
            self.assertFalse(workspace.exists())
            self.assertFalse(cache.exists())
            self.assertFalse(state.exists())

    def test_verified_migration_splits_settings_and_deletes_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace, cache, state = self._paths(root)
            (source / "canvases").mkdir(parents=True)
            (source / "canvases" / "one.json").write_text(
                '{"id": "one"}',
                encoding="utf-8",
            )
            (source / "media_previews").mkdir()
            (source / "media_previews" / "one.webp").write_bytes(b"preview")
            (source / "models" / "matting").mkdir(parents=True)
            (source / "models" / "matting" / "model.onnx").write_bytes(
                b"model"
            )
            legacy_auth = AuthSystem(source / "auth.db")
            legacy_auth.create_user(
                username="legacy-owner",
                password="legacy-password",
                role="admin",
            )
            secret = "legacy-secret"
            (source / "api_providers.json").write_text(
                json.dumps(
                    [
                        {
                            "id": "legacy",
                            "name": "Legacy",
                            "protocol": "openai",
                            "image_models": ["image"],
                            "base_url": "http://localhost:8188",
                            "api_key": secret,
                        }
                    ]
                ),
                encoding="utf-8",
            )
            plan = build_migration_plan(
                source,
                workspace,
                cache,
                state,
            )

            result = execute_migration(plan, delete_source=True)

            self.assertFalse(source.exists())
            self.assertTrue(workspace.joinpath("data/canvases/one.json").is_file())
            self.assertEqual(
                b"preview",
                cache.joinpath("media-previews/one.webp").read_bytes(),
            )
            self.assertEqual(
                b"model",
                cache.joinpath("models/matting/model.onnx").read_bytes(),
            )
            shared = workspace.joinpath(
                "data/api_providers.json"
            ).read_text(encoding="utf-8")
            local = state.joinpath(
                "provider-connections.json"
            ).read_text(encoding="utf-8")
            self.assertNotIn(secret, shared)
            self.assertIn(secret, local)
            self.assertFalse(workspace.joinpath("data/auth.db").exists())
            instance_auth = AuthSystem(
                state / "instance-state" / "auth.db"
            )
            self.assertEqual(
                "admin",
                instance_auth.authenticate(
                    "legacy-owner", "legacy-password"
                )["role"],
            )
            self.assertTrue(
                list(
                    (state / "instance-state" / "account-recovery").glob(
                        "seed-*.db"
                    )
                )
            )
            self.assertTrue(result.source_deleted)
            report = json.loads(result.report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["source_deleted"])

    def test_nonempty_workspace_is_rejected_before_hashing_or_copying(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace, cache, state = self._paths(root)
            source.mkdir()
            (source / "projects.json").write_text("[]", encoding="utf-8")
            workspace.mkdir()
            (workspace / "existing.txt").write_text(
                "keep",
                encoding="utf-8",
            )

            with self.assertRaises(LegacyMigrationError):
                build_migration_plan(
                    source,
                    workspace,
                    cache,
                    state,
                )

            self.assertEqual(
                "keep",
                (workspace / "existing.txt").read_text(encoding="utf-8"),
            )

    def test_workspace_cache_and_state_cannot_contain_each_other(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace, _, state = self._paths(root)
            source.mkdir()
            (source / "projects.json").write_text("[]", encoding="utf-8")

            with self.assertRaises(LegacyMigrationError):
                build_migration_plan(
                    source,
                    workspace,
                    workspace / "cache",
                    state,
                )


if __name__ == "__main__":
    unittest.main()
