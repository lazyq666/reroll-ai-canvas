import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.instance_state import InstanceState, InstanceStateError
from infinite_canvas.workspace_storage import application_state_directory


class InstanceStateMigrationTests(unittest.TestCase):
    def setUp(self):
        self._environment = mock.patch.dict(
            os.environ,
            {"INFINITE_CANVAS_INSTANCE_STATE_DIR": ""},
        )
        self._environment.start()

    def tearDown(self):
        self._environment.stop()

    @staticmethod
    def _legacy_workspace(root: Path, name: str, workspace_id: str):
        workspace = root / name
        (workspace / "assets").mkdir(parents=True)
        auth = AuthSystem(
            workspace / "data" / "auth.db",
            legacy_workspace_id=workspace_id,
        )
        owner = auth.create_user(
            username=f"{name}-owner",
            password="owner-password",
            role="admin",
        )
        return workspace, auth, owner

    @staticmethod
    def _legacy_setup(root: Path, username: str = "setup-owner"):
        database = root / "device-state" / "setup" / "auth.db"
        auth = AuthSystem(database)
        owner = auth.create_user(
            username=username,
            password="setup-password",
            role="admin",
        )
        return auth, owner

    @staticmethod
    def _assert_database_family_absent(database: Path):
        for path in (
            database,
            Path(f"{database}-wal"),
            Path(f"{database}-shm"),
        ):
            if path.exists():
                raise AssertionError(f"SQLite migration file remains: {path.name}")

    def test_consistent_snapshot_includes_committed_wal_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_id = "10000000-0000-4000-8000-000000000001"
            workspace, auth, owner = self._legacy_workspace(
                root, "workspace-a", workspace_id
            )
            session = auth.create_session(owner["id"])
            writer = sqlite3.connect(str(auth.database_path), timeout=5)
            try:
                writer.execute("PRAGMA journal_mode = WAL")
                writer.execute("PRAGMA wal_autocheckpoint = 0")
                writer.execute(
                    """
                    INSERT INTO audit_events
                        (action, actor_id, target_type, target_id, result,
                         details_json, workspace_id, created_at)
                    VALUES ('wal_committed', 'system', 'canvas', 'canvas-a',
                            'success', '{}', ?, 1)
                    """,
                    (workspace_id,),
                )
                writer.commit()
                self.assertTrue(Path(f"{auth.database_path}-wal").is_file())

                state = InstanceState(root / "device-state")
                prepared = state.prepare_auth_database(
                    workspace_directory=workspace,
                    workspace_id=workspace_id,
                )
            finally:
                writer.close()

            migrated = AuthSystem(
                prepared.database_path,
                legacy_workspace_id=workspace_id,
            )
            self.assertEqual("migrated", prepared.migration_status)
            self.assertEqual(
                owner["id"],
                migrated.user_for_session(session)["id"],
            )
            self.assertIn(
                "wal_committed",
                {event["action"] for event in migrated.list_audit_events()},
            )
            self.assertFalse((workspace / "data" / "auth.db").exists())
            self.assertTrue(
                (state.recovery_directory / prepared.recovery_artifact).is_file()
            )
            self.assertFalse(list(state.directory.glob(".auth.*")))
            self.assertFalse(list(state.recovery_directory.glob("*.db-wal")))
            self.assertFalse(list(state.recovery_directory.glob("*.db-shm")))
            self.assertFalse(list(state.recovery_directory.glob(".*.tmp*")))

    def test_recovery_publication_failure_preserves_source_and_sidecars(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_id = "20000000-0000-4000-8000-000000000002"
            workspace, auth, _owner = self._legacy_workspace(
                root, "workspace-a", workspace_id
            )
            writer = sqlite3.connect(str(auth.database_path), timeout=5)
            writer.execute("PRAGMA journal_mode = WAL")
            writer.execute("PRAGMA wal_autocheckpoint = 0")
            writer.execute(
                """
                INSERT INTO audit_events
                    (action, actor_id, target_type, target_id, result,
                     details_json, workspace_id, created_at)
                VALUES ('before_failure', 'system', 'system', '',
                        'success', '{}', NULL, 1)
                """
            )
            writer.commit()
            source_paths = [
                auth.database_path,
                Path(f"{auth.database_path}-wal"),
                Path(f"{auth.database_path}-shm"),
            ]
            present_before = [path for path in source_paths if path.exists()]
            durable_before = {
                path.name: path.read_bytes()
                for path in source_paths[:2]
                if path.is_file()
            }

            def fail_recovery_publication(source: Path, target: Path):
                if target.parent.name == "account-recovery":
                    raise OSError("simulated recovery failure")
                return os.replace(source, target)

            state = InstanceState(
                root / "device-state",
                replace=fail_recovery_publication,
            )
            try:
                with self.assertRaises(InstanceStateError):
                    state.prepare_auth_database(
                        workspace_directory=workspace,
                        workspace_id=workspace_id,
                    )
                durable_after = {
                    path.name: path.read_bytes()
                    for path in source_paths[:2]
                    if path.is_file()
                }
                sources_remained = all(
                    path.exists() for path in present_before
                )
            finally:
                writer.close()

            # Opening a WAL database may update volatile lock bytes in -shm;
            # the durable database and WAL bytes must remain untouched, and no
            # source/sidecar may be removed on a failed publication.
            self.assertEqual(durable_before, durable_after)
            self.assertTrue(sources_remained)
            self.assertFalse(state.auth_database.exists())

    def test_activation_failure_keeps_source_and_retry_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_id = "30000000-0000-4000-8000-000000000003"
            workspace, auth, owner = self._legacy_workspace(
                root, "workspace-a", workspace_id
            )
            source_before = auth.database_path.read_bytes()

            def fail_activation(source: Path, target: Path):
                if target.name == "auth.db":
                    raise OSError("simulated activation failure")
                return os.replace(source, target)

            failing = InstanceState(
                root / "device-state",
                replace=fail_activation,
            )
            with self.assertRaises(InstanceStateError):
                failing.prepare_auth_database(
                    workspace_directory=workspace,
                    workspace_id=workspace_id,
                )
            self.assertEqual(source_before, auth.database_path.read_bytes())
            self.assertFalse(failing.auth_database.exists())
            self.assertTrue(list(failing.recovery_directory.glob("seed-*.db")))

            state = InstanceState(root / "device-state")
            first = state.prepare_auth_database(
                workspace_directory=workspace,
                workspace_id=workspace_id,
            )
            second = state.prepare_auth_database(
                workspace_directory=workspace,
                workspace_id=workspace_id,
            )
            migrated = AuthSystem(second.database_path)
            self.assertEqual("migrated", first.migration_status)
            self.assertEqual("existing", second.migration_status)
            self.assertEqual([owner["id"]], [u["id"] for u in migrated.list_users()])

    def test_existing_instance_accounts_archive_without_merging_legacy_users(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = InstanceState(root / "device-state")
            global_auth = AuthSystem(state.auth_database)
            global_user = global_auth.create_user(
                username="global-owner",
                password="global-password",
                role="admin",
            )
            workspace_id = "40000000-0000-4000-8000-000000000004"
            workspace, _legacy, legacy_user = self._legacy_workspace(
                root, "workspace-b", workspace_id
            )

            prepared = state.prepare_auth_database(
                workspace_directory=workspace,
                workspace_id=workspace_id,
            )

            selected = AuthSystem(prepared.database_path)
            self.assertEqual([global_user["id"]], [u["id"] for u in selected.list_users()])
            self.assertNotEqual(global_user["id"], legacy_user["id"])
            self.assertFalse((workspace / "data" / "auth.db").exists())
            self.assertTrue(
                (state.recovery_directory / prepared.recovery_artifact).is_file()
            )

    def test_corrupt_legacy_database_stays_in_workspace_for_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            database = workspace / "data" / "auth.db"
            database.parent.mkdir(parents=True)
            (workspace / "assets").mkdir()
            database.write_bytes(b"not-a-sqlite-database")
            before = database.read_bytes()
            state = InstanceState(root / "device-state")

            with self.assertRaises(InstanceStateError):
                state.prepare_auth_database(
                    workspace_directory=workspace,
                    workspace_id="50000000-0000-4000-8000-000000000005",
                )

            self.assertEqual(before, database.read_bytes())
            self.assertFalse(state.auth_database.exists())
            status_text = state.migration_status_file.read_text(
                encoding="utf-8"
            )
            self.assertEqual(
                "recoverable",
                json.loads(status_text)["status"],
            )
            self.assertNotIn(str(root), status_text)
            self.assertNotIn("owner-password", status_text)

    def test_existing_instance_archives_legacy_setup_without_merging_users(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = InstanceState(root / "device-state")
            global_auth = AuthSystem(state.auth_database)
            global_user = global_auth.create_user(
                username="global-owner",
                password="global-password",
                role="admin",
            )
            setup_auth, setup_user = self._legacy_setup(root)
            setup_session = setup_auth.create_session(setup_user["id"])
            workspace_id = "60000000-0000-4000-8000-000000000006"

            first = state.prepare_auth_database(workspace_id=workspace_id)
            second = state.prepare_auth_database(workspace_id=workspace_id)

            selected = AuthSystem(second.database_path)
            self.assertEqual("existing", first.migration_status)
            self.assertEqual("existing", second.migration_status)
            self.assertEqual(
                [global_user["id"]],
                [user["id"] for user in selected.list_users()],
            )
            self.assertIsNone(selected.user_for_session(setup_session))
            self._assert_database_family_absent(setup_auth.database_path)
            artifacts = list(
                state.recovery_directory.glob(
                    f"legacy-setup-{workspace_id}-*.db"
                )
            )
            self.assertEqual(1, len(artifacts))
            archived = AuthSystem(artifacts[0])
            self.assertEqual(
                [setup_user["id"]],
                [user["id"] for user in archived.list_users()],
            )
            self.assertEqual(
                setup_user["id"],
                archived.user_for_session(setup_session)["id"],
            )
            status = json.loads(
                state.migration_status_file.read_text(encoding="utf-8")
            )
            self.assertEqual("completed", status["status"])
            self.assertEqual("archive-setup", status["operation"])

    def test_legacy_setup_seeds_instance_when_workspace_has_no_accounts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir()
            setup_auth, setup_user = self._legacy_setup(root)
            setup_session = setup_auth.create_session(setup_user["id"])
            workspace_id = "70000000-0000-4000-8000-000000000007"
            state = InstanceState(root / "device-state")

            prepared = state.prepare_auth_database(
                workspace_directory=workspace,
                workspace_id=workspace_id,
            )

            selected = AuthSystem(prepared.database_path)
            self.assertEqual("migrated", prepared.migration_status)
            self.assertTrue(prepared.recovery_artifact.startswith("seed-setup-"))
            self.assertEqual(
                setup_user["id"],
                selected.user_for_session(setup_session)["id"],
            )
            self._assert_database_family_absent(setup_auth.database_path)
            status = json.loads(
                state.migration_status_file.read_text(encoding="utf-8")
            )
            self.assertEqual("completed", status["status"])
            self.assertEqual("seed-setup", status["operation"])

    def test_workspace_seed_stays_authoritative_over_legacy_setup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_id = "75000000-0000-4000-8000-000000000007"
            workspace, _workspace_auth, workspace_user = self._legacy_workspace(
                root,
                "workspace-a",
                workspace_id,
            )
            setup_auth, setup_user = self._legacy_setup(root)
            setup_session = setup_auth.create_session(setup_user["id"])
            state = InstanceState(root / "device-state")

            prepared = state.prepare_auth_database(
                workspace_directory=workspace,
                workspace_id=workspace_id,
            )

            selected = AuthSystem(prepared.database_path)
            self.assertEqual("migrated", prepared.migration_status)
            self.assertTrue(prepared.recovery_artifact.startswith("seed-"))
            self.assertEqual(
                [workspace_user["id"]],
                [user["id"] for user in selected.list_users()],
            )
            self.assertIsNone(selected.user_for_session(setup_session))
            self._assert_database_family_absent(setup_auth.database_path)
            self.assertEqual(
                1,
                len(list(state.recovery_directory.glob("legacy-setup-*.db"))),
            )

    def test_setup_seed_failure_preserves_source_for_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            setup_auth, _setup_user = self._legacy_setup(root)
            source_before = setup_auth.database_path.read_bytes()

            def fail_recovery_publication(source: Path, target: Path):
                if target.parent.name == "account-recovery":
                    raise OSError("simulated setup recovery failure")
                return os.replace(source, target)

            state = InstanceState(
                root / "device-state",
                replace=fail_recovery_publication,
            )
            with self.assertRaises(InstanceStateError):
                state.prepare_auth_database(
                    workspace_id="80000000-0000-4000-8000-000000000008",
                )

            self.assertEqual(source_before, setup_auth.database_path.read_bytes())
            self.assertFalse(state.auth_database.exists())
            status = json.loads(
                state.migration_status_file.read_text(encoding="utf-8")
            )
            self.assertEqual("recoverable", status["status"])
            self.assertEqual("seed-setup", status["operation"])

    def test_prepare_removes_only_private_or_recovery_sqlite_debris(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = InstanceState(root / "device-state")
            auth = AuthSystem(state.auth_database)
            owner = auth.create_user(
                username="global-owner",
                password="global-password",
                role="admin",
            )
            state.recovery_directory.mkdir(parents=True)
            debris = (
                state.directory / ".auth.seed-snapshot.orphan.db",
                state.directory / ".auth.activate.orphan.db-shm",
                state.recovery_directory / ".seed-orphan.db.token.tmp-shm",
                state.recovery_directory / "seed-orphan.db-wal",
                state.recovery_directory / "seed-orphan.db-shm",
            )
            for path in debris:
                path.write_bytes(b"orphan")

            first = state.prepare_auth_database()
            second = state.prepare_auth_database()

            self.assertEqual("existing", first.migration_status)
            self.assertEqual("existing", second.migration_status)
            self.assertTrue(state.auth_database.is_file())
            self.assertEqual(
                [owner["id"]],
                [user["id"] for user in AuthSystem(
                    second.database_path
                ).list_users()],
            )
            self.assertTrue(all(not path.exists() for path in debris))

    def test_windows_instance_state_uses_local_app_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            local_app_data = Path(temporary) / "AppData" / "Local"
            with (
                mock.patch(
                    "infinite_canvas.workspace_storage.platform.system",
                    return_value="Windows",
                ),
                mock.patch.dict(
                    os.environ,
                    {
                        "INFINITE_CANVAS_STATE_DIR": "",
                        "INFINITE_CANVAS_INSTANCE_STATE_DIR": "",
                        "LOCALAPPDATA": str(local_app_data),
                        "APPDATA": "",
                    },
                ),
            ):
                device_state = application_state_directory()
                state = InstanceState(device_state)

            self.assertEqual(
                (local_app_data / "Infinite Canvas").resolve(),
                device_state,
            )
            self.assertEqual(
                (
                    local_app_data
                    / "Infinite Canvas"
                    / "instance-state"
                    / "auth.db"
                ).resolve(),
                state.auth_database,
            )


if __name__ == "__main__":
    unittest.main()
