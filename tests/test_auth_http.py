import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from infinite_canvas.auth_system import (
    AuthSystem,
    auth_from_environment,
    install_access_control,
    install_auth_routes,
)
from infinite_canvas.instance_state import InstanceState, InstanceStateError


class AuthHttpTests(unittest.TestCase):
    def test_designer_project_permissions_are_workspace_scoped_and_replaceable(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            admin = auth.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            designer = auth.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )

            self.assertIsNone(
                auth.get_user_project_ids(designer["id"], "workspace-a")
            )
            self.assertEqual(
                ["project-a", "project-b"],
                auth.set_user_project_ids(
                    designer["id"],
                    "workspace-a",
                    ["project-b", "project-a", "project-b"],
                    actor_id=admin["id"],
                ),
            )
            self.assertEqual(
                ["project-a", "project-b"],
                auth.get_user_project_ids(designer["id"], "workspace-a"),
            )
            self.assertEqual(
                [],
                auth.set_user_project_ids(
                    designer["id"],
                    "workspace-a",
                    [],
                    actor_id=admin["id"],
                ),
            )
            self.assertEqual(
                [],
                auth.get_user_project_ids(designer["id"], "workspace-a"),
            )
            self.assertIsNone(
                auth.get_user_project_ids(designer["id"], "workspace-b")
            )
            with self.assertRaises(ValueError):
                auth.set_user_project_ids(
                    admin["id"],
                    "workspace-a",
                    ["project-a"],
                    actor_id=admin["id"],
                )

    def test_canvas_view_states_are_private_to_each_account(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            admin = auth.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            designer = auth.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )

            designer_state = auth.save_canvas_view_state(
                designer["id"],
                "workspace-a",
                "canvas-1",
                center_x=125.5,
                center_y=-40,
                scale=1.25,
            )
            self.assertEqual(
                auth.get_canvas_view_state(
                    designer["id"], "workspace-a", "canvas-1"
                ),
                designer_state,
            )
            self.assertIsNone(
                auth.get_canvas_view_state(
                    admin["id"], "workspace-a", "canvas-1"
                )
            )

            admin_state = auth.save_canvas_view_state(
                admin["id"],
                "workspace-a",
                "canvas-1",
                center_x=900,
                center_y=700,
                scale=0.5,
            )
            self.assertEqual(
                auth.get_canvas_view_state(
                    admin["id"], "workspace-a", "canvas-1"
                ),
                admin_state,
            )
            other_workspace_state = auth.save_canvas_view_state(
                admin["id"],
                "workspace-b",
                "canvas-1",
                center_x=-10,
                center_y=20,
                scale=2,
            )
            self.assertEqual(
                other_workspace_state,
                auth.get_canvas_view_state(
                    admin["id"], "workspace-b", "canvas-1"
                ),
            )
            self.assertNotEqual(admin_state, other_workspace_state)
            with self.assertRaises(ValueError):
                auth.save_canvas_view_state(
                    designer["id"],
                    "workspace-a",
                    "canvas-1",
                    center_x=0,
                    center_y=0,
                    scale=0,
                )

            auth.delete_user(designer["id"], actor_id=admin["id"])
            self.assertIsNone(
                auth.get_canvas_view_state(
                    designer["id"], "workspace-a", "canvas-1"
                )
            )
            self.assertEqual(
                auth.delete_canvas_view_states("workspace-a", "canvas-1"),
                1,
            )
            self.assertIsNone(
                auth.get_canvas_view_state(
                    admin["id"], "workspace-a", "canvas-1"
                )
            )
            self.assertEqual(
                other_workspace_state,
                auth.get_canvas_view_state(
                    admin["id"], "workspace-b", "canvas-1"
                ),
            )

    def test_database_connections_are_closed_after_each_operation(self):
        with tempfile.TemporaryDirectory() as tmp:
            captured_connections = []
            real_connect = sqlite3.connect

            def tracked_connect(*args, **kwargs):
                connection = real_connect(*args, **kwargs)
                captured_connections.append(connection)
                return connection

            with mock.patch(
                "infinite_canvas.auth_system.sqlite3.connect",
                side_effect=tracked_connect,
            ):
                auth = AuthSystem(Path(tmp) / "auth.db")
                auth.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                self.assertFalse(auth.needs_initial_setup())

            self.assertGreaterEqual(len(captured_connections), 3)
            for connection in captured_connections:
                with self.assertRaises(sqlite3.ProgrammingError):
                    connection.execute("SELECT 1")

    def test_default_auth_database_belongs_to_instance_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir()
            device_state = root / "device-state"

            auth = auth_from_environment(
                InstanceState(device_state),
                workspace_directory=workspace,
                workspace_id="workspace-a",
            )

            self.assertEqual(
                auth.database_path.resolve(),
                (device_state / "instance-state" / "auth.db").resolve(),
            )
            self.assertTrue(auth.database_path.is_file())
            self.assertFalse((workspace / "data" / "auth.db").exists())

    def test_existing_workspace_accounts_migrate_to_instance_with_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            source = AuthSystem(
                workspace_data / "auth.db",
                legacy_workspace_id="workspace-a",
            )
            owner = source.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            source.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            session = source.create_session(owner["id"])
            share = source.replace_canvas_share(
                "workspace-a", "canvas-1", owner["id"]
            )
            source.save_canvas_view_state(
                owner["id"],
                "workspace-a",
                "canvas-1",
                center_x=45,
                center_y=90,
                scale=0.75,
            )

            migrated = auth_from_environment(
                InstanceState(root / "device-state"),
                workspace_directory=workspace,
                workspace_id="workspace-a",
            )

            self.assertEqual(
                (root / "device-state" / "instance-state" / "auth.db").resolve(),
                migrated.database_path.resolve(),
            )
            self.assertEqual(
                migrated.authenticate("owner", "owner-password")["role"],
                "admin",
            )
            self.assertEqual(
                "owner",
                migrated.user_for_session(session)["username"],
            )
            self.assertEqual(
                "canvas-1",
                migrated.resolve_canvas_share(
                    share["token"], "workspace-a"
                )["canvas_id"],
            )
            self.assertEqual(
                migrated.get_canvas_view_state(
                    owner["id"], "workspace-a", "canvas-1"
                )["scale"],
                0.75,
            )
            self.assertEqual(
                {"owner": "admin", "designer": "designer"},
                {
                    user["username"]: user["role"]
                    for user in migrated.list_users()
                },
            )
            self.assertTrue(migrated.list_audit_events())
            self.assertFalse((workspace_data / "auth.db").exists())
            self.assertTrue(
                any(
                    path.name.startswith("seed-")
                    for path in (
                        root / "device-state" / "instance-state" / "account-recovery"
                    ).glob("*.db")
                )
            )
            app = FastAPI()
            install_auth_routes(app, migrated)
            with TestClient(app) as client:
                login = client.post(
                    "/api/auth/login",
                    json={
                        "username": "owner",
                        "password": "owner-password",
                    },
                )
                self.assertEqual(200, login.status_code)
                self.assertIn("ic_session", login.cookies)

    def test_legacy_content_links_gain_the_source_workspace_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "auth.db"
            current = AuthSystem(database)
            owner = current.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            share = current.replace_canvas_share(
                "temporary-workspace", "canvas-1", owner["id"]
            )
            current.save_canvas_view_state(
                owner["id"],
                "temporary-workspace",
                "canvas-1",
                center_x=10,
                center_y=20,
                scale=1.5,
            )

            with sqlite3.connect(str(database)) as connection:
                connection.executescript(
                    """
                    DROP INDEX IF EXISTS idx_user_canvas_view_states_canvas_id;
                    ALTER TABLE user_canvas_view_states
                        RENAME TO user_canvas_view_states_current;
                    CREATE TABLE user_canvas_view_states (
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        canvas_id TEXT NOT NULL,
                        center_x REAL NOT NULL,
                        center_y REAL NOT NULL,
                        scale REAL NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (user_id, canvas_id)
                    );
                    INSERT INTO user_canvas_view_states
                        (user_id, canvas_id, center_x, center_y, scale, updated_at)
                    SELECT user_id, canvas_id, center_x, center_y, scale, updated_at
                    FROM user_canvas_view_states_current;
                    DROP TABLE user_canvas_view_states_current;

                    DROP INDEX IF EXISTS idx_canvas_shares_canvas_id;
                    ALTER TABLE canvas_shares RENAME TO canvas_shares_current;
                    CREATE TABLE canvas_shares (
                        token_hash TEXT PRIMARY KEY,
                        canvas_id TEXT NOT NULL,
                        created_by TEXT NOT NULL REFERENCES users(id),
                        created_at INTEGER NOT NULL,
                        revoked_at INTEGER,
                        revoked_by TEXT REFERENCES users(id)
                    );
                    INSERT INTO canvas_shares
                        (token_hash, canvas_id, created_by, created_at,
                         revoked_at, revoked_by)
                    SELECT token_hash, canvas_id, created_by, created_at,
                           revoked_at, revoked_by
                    FROM canvas_shares_current;
                    DROP TABLE canvas_shares_current;

                    DROP INDEX IF EXISTS idx_audit_events_created_at;
                    DROP INDEX IF EXISTS idx_audit_events_workspace_id;
                    ALTER TABLE audit_events RENAME TO audit_events_current;
                    CREATE TABLE audit_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        action TEXT NOT NULL,
                        actor_id TEXT NOT NULL,
                        target_type TEXT NOT NULL,
                        target_id TEXT NOT NULL,
                        result TEXT NOT NULL,
                        details_json TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    );
                    INSERT INTO audit_events
                        (id, action, actor_id, target_type, target_id,
                         result, details_json, created_at)
                    SELECT id, action, actor_id, target_type, target_id,
                           result, details_json, created_at
                    FROM audit_events_current;
                    DROP TABLE audit_events_current;
                    """
                )

            migrated = AuthSystem(
                database,
                legacy_workspace_id="source-workspace",
            )

            self.assertEqual(
                1.5,
                migrated.get_canvas_view_state(
                    owner["id"], "source-workspace", "canvas-1"
                )["scale"],
            )
            self.assertEqual(
                "source-workspace",
                migrated.resolve_canvas_share(
                    share["token"], "source-workspace"
                )["workspace_id"],
            )
            share_events = [
                event
                for event in migrated.list_audit_events()
                if event["action"].startswith("share_")
            ]
            self.assertTrue(share_events)
            self.assertTrue(
                all(
                    event["workspace_id"] == "source-workspace"
                    for event in share_events
                )
            )
    def test_existing_instance_accounts_remain_authoritative(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            instance = InstanceState(root / "device-state")
            global_auth = AuthSystem(instance.auth_database)
            global_auth.create_user(
                username="instance-owner",
                password="instance-password",
                role="admin",
            )
            legacy_auth = AuthSystem(workspace_data / "auth.db")
            legacy_auth.create_user(
                username="workspace-owner",
                password="workspace-password",
                role="admin",
            )

            selected = auth_from_environment(
                instance,
                workspace_directory=workspace,
                workspace_id="workspace-a",
            )

            self.assertEqual(instance.auth_database, selected.database_path)
            self.assertIsNotNone(
                selected.authenticate("instance-owner", "instance-password")
            )
            self.assertIsNone(
                selected.authenticate("workspace-owner", "workspace-password")
            )
            self.assertFalse((workspace_data / "auth.db").exists())

    def test_failed_account_migration_keeps_workspace_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            source = AuthSystem(workspace_data / "auth.db")
            source.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            source_bytes = (workspace_data / "auth.db").read_bytes()
            instance = InstanceState(root / "device-state")
            instance.auth_database.mkdir(parents=True)

            with self.assertRaises(InstanceStateError):
                auth_from_environment(
                    instance,
                    workspace_directory=workspace,
                    workspace_id="workspace-a",
                )

            self.assertEqual(
                source_bytes,
                (workspace_data / "auth.db").read_bytes(),
            )
            self.assertTrue(instance.auth_database.is_dir())

    def test_incomplete_workspace_schema_stays_recoverable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            source = AuthSystem(workspace_data / "auth.db")
            source.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            with sqlite3.connect(str(workspace_data / "auth.db")) as connection:
                connection.execute("DROP TABLE audit_events")
            source_bytes = (workspace_data / "auth.db").read_bytes()

            with self.assertRaises(InstanceStateError):
                auth_from_environment(
                    InstanceState(root / "device-state"),
                    workspace_directory=workspace,
                    workspace_id="workspace-a",
                )

            self.assertEqual(
                source_bytes,
                (workspace_data / "auth.db").read_bytes(),
            )

    def test_account_migration_does_not_copy_device_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            device_state = root / "device-state"
            source = AuthSystem(workspace_data / "auth.db")
            source.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            device_state.mkdir()
            (device_state / "api.env").write_text(
                "API_KEY=sk-device-secret\n",
                encoding="utf-8",
            )
            (device_state / "cli-session.json").write_text(
                '{"token":"device-token"}',
                encoding="utf-8",
            )
            (device_state / "provider-address.json").write_text(
                '{"url":"http://127.0.0.1:8188"}',
                encoding="utf-8",
            )

            selected = auth_from_environment(
                InstanceState(device_state),
                workspace_directory=workspace,
                workspace_id="workspace-a",
            )

            self.assertEqual(
                (device_state / "instance-state" / "auth.db").resolve(),
                selected.database_path.resolve(),
            )
            workspace_files = [
                path
                for path in workspace_data.rglob("*")
                if path.is_file()
            ]
            names = {path.name for path in workspace_files}
            self.assertNotIn("api.env", names)
            self.assertNotIn("cli-session.json", names)
            self.assertNotIn("provider-address.json", names)
            for path in workspace_files:
                content = path.read_bytes()
                self.assertNotIn(b"sk-device-secret", content)
                self.assertNotIn(b"device-token", content)

    @unittest.skipUnless(os.name == "posix", "POSIX permission contract")
    def test_instance_auth_files_use_private_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            (workspace / "assets").mkdir(parents=True)
            device_state = root / "device-state"
            source = AuthSystem(workspace_data / "auth.db")
            source.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )

            previous_umask = os.umask(0o022)
            try:
                auth_from_environment(
                    InstanceState(device_state),
                    workspace_directory=workspace,
                    workspace_id="workspace-a",
                )
            finally:
                os.umask(previous_umask)

            instance_directory = device_state / "instance-state"
            self.assertEqual(instance_directory.stat().st_mode & 0o777, 0o700)
            sensitive_files = [
                path
                for path in instance_directory.rglob("*")
                if path.is_file()
                and (
                    path.name.startswith("auth.db")
                    or path.suffix == ".db"
                )
            ]
            self.assertTrue(sensitive_files)
            for path in sensitive_files:
                with self.subTest(path=path):
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_initial_admin_uses_user_credentials_and_can_only_be_created_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")

            self.assertTrue(auth.needs_initial_setup())
            created = auth.create_initial_admin(
                username="owner",
                password="correct horse battery staple",
                display_name="Workspace Owner",
            )

            self.assertEqual(created["username"], "owner")
            self.assertEqual(created["display_name"], "Workspace Owner")
            self.assertEqual(created["role"], "admin")
            self.assertFalse(auth.needs_initial_setup())
            self.assertEqual(auth.list_users(), [created])
            self.assertEqual(
                auth.authenticate("owner", "correct horse battery staple"),
                created,
            )
            self.assertIsNone(auth.authenticate("admin", "admin"))
            with self.assertRaisesRegex(ValueError, "已经完成"):
                auth.create_initial_admin(
                    username="other",
                    password="another safe password",
                )

    def test_initial_admin_does_not_modify_a_non_empty_user_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            designer = auth.create_user(
                username="designer", password="designer-pass", role="designer"
            )

            with self.assertRaisesRegex(ValueError, "已经完成"):
                auth.create_initial_admin(
                    username="owner",
                    password="correct horse battery staple",
                )
            self.assertEqual(auth.list_users(), [designer])
            self.assertIsNone(auth.authenticate("admin", "admin"))

    def test_locally_provisioned_user_can_login_and_read_current_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(
                username="admin",
                password="correct horse battery staple",
                role="admin",
                display_name="Local Admin",
            )
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                login = client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "correct horse battery staple"},
                )

                self.assertEqual(login.status_code, 200)
                self.assertIn("ic_session", login.cookies)
                avatar_color_slot = login.json()["user"]["avatar_color_slot"]
                self.assertIn(avatar_color_slot, range(1, 11))
                self.assertEqual(
                    login.json()["user"],
                    {
                        "id": login.json()["user"]["id"],
                        "username": "admin",
                        "display_name": "Local Admin",
                        "avatar_color_slot": avatar_color_slot,
                        "role": "admin",
                        "status": "active",
                    },
                )

                me = client.get("/api/auth/me")
                self.assertEqual(me.status_code, 200)
                self.assertEqual(me.json()["user"], login.json()["user"])

    def test_explicit_global_session_revocation_invalidates_every_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            admin = auth.create_user(
                username="admin",
                password="correct horse battery staple",
                role="admin",
            )
            designer = auth.create_user(
                username="designer",
                password="another safe password",
                role="designer",
            )
            first = auth.create_session(admin["id"])
            second = auth.create_session(designer["id"])

            revoked = auth.revoke_all_sessions()

            self.assertEqual(2, revoked)
            self.assertIsNone(auth.user_for_session(first))
            self.assertIsNone(auth.user_for_session(second))

    def test_first_run_requires_atomic_admin_and_workspace_setup(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            configured = []
            app = FastAPI()
            install_auth_routes(
                app,
                auth,
                initial_setup_configurator=lambda parent: configured.append(parent)
                or {"parent_dir": parent},
            )

            @app.get("/setup")
            async def setup_page():
                return {"setup": True}

            @app.get("/")
            async def workspace():
                return {"workspace": True}

            install_access_control(app, auth)
            with TestClient(app) as client:
                blocked = client.get("/", follow_redirects=False)
                self.assertEqual(blocked.status_code, 303)
                self.assertEqual(blocked.headers["location"], "/setup")
                self.assertEqual(
                    client.get("/api/setup/status").json(),
                    {"required": True},
                )

                setup = client.post(
                    "/api/setup",
                    json={
                        "username": "owner",
                        "display_name": "Workspace Owner",
                        "password": "correct horse battery staple",
                        "parent_dir": str(Path(tmp) / "workspace"),
                    },
                )

                self.assertEqual(setup.status_code, 200)
                self.assertIn("ic_session", setup.cookies)
                self.assertEqual(setup.json()["user"]["role"], "admin")
                self.assertEqual(
                    configured,
                    [str(Path(tmp) / "workspace")],
                )
                self.assertEqual(
                    client.get("/api/setup/status").json(),
                    {"required": False},
                )
                self.assertEqual(client.get("/").status_code, 200)
                repeated = client.post(
                    "/api/setup",
                    json={
                        "username": "other",
                        "password": "another safe password",
                        "parent_dir": str(Path(tmp) / "other"),
                    },
                )
                self.assertEqual(repeated.status_code, 409)

    def test_first_run_errors_expose_stable_localization_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            app = FastAPI()

            def fail_inspection(_directory):
                raise ValueError("工作区目录不可用")

            install_auth_routes(
                app,
                auth,
                initial_workspace_inspector=fail_inspection,
            )

            with TestClient(app) as client:
                picker = client.post("/api/setup/select-directory")
                inspection = client.post(
                    "/api/setup/inspect-workspace",
                    json={"workspace_directory": str(Path(tmp) / "workspace")},
                )
                invalid_admin = client.post(
                    "/api/setup",
                    json={
                        "username": "x",
                        "password": "password",
                        "workspace_directory": str(Path(tmp) / "workspace"),
                    },
                )

            self.assertEqual(501, picker.status_code)
            self.assertEqual("directory_picker_unavailable", picker.json()["reason"])
            self.assertEqual(409, inspection.status_code)
            self.assertEqual(
                "workspace_inspection_failed",
                inspection.json()["reason"],
            )
            self.assertEqual("工作区目录不可用", inspection.json()["detail"])
            self.assertEqual(400, invalid_admin.status_code)
            self.assertEqual("invalid_username", invalid_admin.json()["reason"])

    def test_first_run_inspects_workspace_before_asking_for_admin(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "setup-state" / "auth.db")
            inspected = []
            app = FastAPI()

            def inspect_workspace(directory):
                inspected.append(directory)
                return {
                    "workspace_directory": directory,
                    "status": "empty",
                    "next_step": "create_admin",
                    "message": "此目录可以创建工作区",
                }

            install_auth_routes(
                app,
                auth,
                initial_workspace_inspector=inspect_workspace,
            )
            install_access_control(app, auth)

            with TestClient(app) as client:
                response = client.post(
                    "/api/setup/inspect-workspace",
                    json={"workspace_directory": str(Path(tmp) / "workspace")},
                )

            self.assertEqual(200, response.status_code)
            self.assertEqual("create_admin", response.json()["next_step"])
            self.assertEqual(
                [str(Path(tmp) / "workspace")],
                inspected,
            )
            self.assertTrue(auth.needs_initial_setup())

    def test_first_run_opens_existing_workspace_then_requests_login(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "setup-state" / "auth.db")
            opened = []
            app = FastAPI()

            def open_workspace(directory):
                opened.append(directory)
                return {
                    "workspace_directory": directory,
                    "next_step": "login",
                    "restart": {"stage": "stopping"},
                }

            install_auth_routes(
                app,
                auth,
                initial_workspace_opener=open_workspace,
            )
            install_access_control(app, auth)

            with TestClient(app) as client:
                response = client.post(
                    "/api/setup/open-workspace",
                    json={"workspace_directory": str(Path(tmp) / "workspace")},
                )

            self.assertEqual(200, response.status_code)
            self.assertEqual("login", response.json()["next_step"])
            self.assertEqual(
                [str(Path(tmp) / "workspace")],
                opened,
            )
            self.assertTrue(auth.needs_initial_setup())

    def test_first_run_workspace_actions_reject_cross_site_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            app = FastAPI()
            install_auth_routes(
                app,
                auth,
                initial_workspace_inspector=lambda directory: {},
                initial_workspace_opener=lambda directory: {},
            )

            with TestClient(app) as client:
                inspect = client.post(
                    "/api/setup/inspect-workspace",
                    headers={"sec-fetch-site": "cross-site"},
                    json={"workspace_directory": str(Path(tmp))},
                )
                open_existing = client.post(
                    "/api/setup/open-workspace",
                    headers={"sec-fetch-site": "cross-site"},
                    json={"workspace_directory": str(Path(tmp))},
                )

            self.assertEqual(403, inspect.status_code)
            self.assertEqual(403, open_existing.status_code)

    def test_first_run_workspace_actions_are_unavailable_to_remote_clients(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            calls = []
            app = FastAPI()
            install_auth_routes(
                app,
                auth,
                initial_setup_configurator=lambda directory: calls.append(
                    ("setup", directory)
                )
                or {},
                initial_directory_picker=lambda: calls.append(("pick", ""))
                or str(Path(tmp) / "workspace"),
                initial_workspace_inspector=lambda directory: calls.append(
                    ("inspect", directory)
                )
                or {},
                initial_workspace_opener=lambda directory: calls.append(
                    ("open", directory)
                )
                or {},
            )

            with TestClient(
                app,
                client=("192.0.2.20", 50000),
            ) as client:
                selected = client.post("/api/setup/select-directory")
                inspected = client.post(
                    "/api/setup/inspect-workspace",
                    json={"workspace_directory": str(Path(tmp))},
                )
                opened = client.post(
                    "/api/setup/open-workspace",
                    json={"workspace_directory": str(Path(tmp))},
                )
                setup = client.post(
                    "/api/setup",
                    json={
                        "username": "owner",
                        "password": "owner-password",
                        "workspace_directory": str(Path(tmp)),
                    },
                )

            self.assertEqual(403, selected.status_code)
            self.assertEqual(403, inspected.status_code)
            self.assertEqual(403, opened.status_code)
            self.assertEqual(403, setup.status_code)
            self.assertEqual([], calls)

    def test_self_registration_creates_pending_application_without_login(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="admin-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                registered = client.post(
                    "/api/auth/register",
                    json={
                        "username": "alice",
                        "display_name": "Alice",
                        "password": "alice-password",
                        "role": "admin",
                    },
                )

                self.assertEqual(registered.status_code, 202)
                application = registered.json()["application"]
                self.assertEqual(application["username"], "alice")
                self.assertEqual(application["role"], "designer")
                self.assertEqual(application["status"], "pending")
                self.assertNotIn("ic_session", registered.cookies)
                self.assertEqual(client.get("/api/auth/me").status_code, 401)
                self.assertIsNone(auth.authenticate("alice", "alice-password"))

    def test_pending_registration_reserves_configured_account_capacity(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db", max_accounts=2)
            auth.create_user(username="admin", password="admin-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                first = client.post(
                    "/api/auth/register",
                    json={"username": "alice", "password": "alice-password"},
                )
                second = client.post(
                    "/api/auth/register",
                    json={"username": "bob", "password": "bobby-password"},
                )

            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 409)
            self.assertIn("2", second.json()["detail"])

    def test_admin_can_list_and_approve_account_application(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="admin-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)
            install_access_control(app, auth)

            with TestClient(app) as client:
                submitted = client.post(
                    "/api/auth/register",
                    json={
                        "username": "alice",
                        "display_name": "Alice",
                        "password": "alice-password",
                    },
                ).json()["application"]
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                accounts = client.get("/api/admin/accounts")
                approved = client.post(
                    f"/api/admin/account-applications/{submitted['id']}/approve"
                )

                self.assertEqual(accounts.status_code, 200)
                self.assertEqual(accounts.json()["applications"], [submitted])
                self.assertEqual(accounts.json()["users"][0]["username"], "admin")
                self.assertEqual(approved.status_code, 200)
                self.assertEqual(approved.json()["user"]["username"], "alice")
                self.assertEqual(approved.json()["user"]["role"], "designer")
                client.post("/api/auth/logout")
                login = client.post(
                    "/api/auth/login",
                    json={"username": "alice", "password": "alice-password"},
                )
                self.assertEqual(login.status_code, 200)

    def test_admin_can_reject_and_applicant_can_resubmit(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="admin-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)
            install_access_control(app, auth)

            with TestClient(app) as client:
                application = client.post(
                    "/api/auth/register",
                    json={"username": "alice", "password": "old-password"},
                ).json()["application"]
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                rejected = client.post(
                    f"/api/admin/account-applications/{application['id']}/reject"
                )
                self.assertEqual(rejected.status_code, 200)
                self.assertEqual(rejected.json()["application"]["status"], "rejected")
                self.assertIsNone(auth.authenticate("alice", "old-password"))

                client.post("/api/auth/logout")
                resubmitted = client.post(
                    "/api/auth/register",
                    json={"username": "alice", "password": "new-password"},
                )
                self.assertEqual(resubmitted.status_code, 202)
                self.assertEqual(
                    resubmitted.json()["application"]["status"], "pending"
                )

    def test_admin_can_reset_account_to_random_temporary_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="admin-password", role="admin")
            designer = auth.create_user(
                username="alice", password="old-password", role="designer"
            )
            app = FastAPI()
            install_auth_routes(app, auth)
            install_access_control(app, auth)

            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                reset = client.post(
                    f"/api/admin/accounts/{designer['id']}/reset-password"
                )
                self.assertEqual(reset.status_code, 200)
                temporary_password = reset.json()["temporary_password"]
                self.assertGreaterEqual(len(temporary_password), 16)
                self.assertNotEqual(temporary_password, "old-password")

                client.post("/api/auth/logout")
                old_login = client.post(
                    "/api/auth/login",
                    json={"username": "alice", "password": "old-password"},
                )
                new_login = client.post(
                    "/api/auth/login",
                    json={"username": "alice", "password": temporary_password},
                )
                self.assertEqual(old_login.status_code, 401)
                self.assertEqual(new_login.status_code, 200)

    def test_admin_can_delete_another_account_but_not_themselves(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            admin = auth.create_user(
                username="admin", password="admin-password", role="admin"
            )
            designer = auth.create_user(
                username="alice", password="alice-password", role="designer"
            )
            app = FastAPI()
            install_auth_routes(app, auth)
            install_access_control(app, auth)

            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                self_delete = client.delete(f"/api/admin/accounts/{admin['id']}")
                deleted = client.delete(f"/api/admin/accounts/{designer['id']}")

                self.assertEqual(self_delete.status_code, 409)
                self.assertEqual(deleted.status_code, 200)
                self.assertEqual(deleted.json(), {"ok": True})
                self.assertIsNone(
                    auth.authenticate("alice", "alice-password")
                )
                self.assertEqual(auth.list_users(), [admin])

    def test_self_registration_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(
                Path(tmp) / "auth.db", registration_enabled=False, max_accounts=10
            )
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                status = client.get("/api/auth/registration")
                registration = client.post(
                    "/api/auth/register",
                    json={"username": "alice", "password": "alice-password"},
                )

            self.assertEqual(status.json()["enabled"], False)
            self.assertEqual(registration.status_code, 403)

    def test_self_registration_waits_for_first_local_admin(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                status = client.get("/api/auth/registration")
                registration = client.post(
                    "/api/auth/register",
                    json={"username": "alice", "password": "alice-password"},
                )

            self.assertEqual(status.json()["enabled"], False)
            self.assertEqual(registration.status_code, 403)

    def test_role_gate_allows_design_work_but_rejects_settings_and_guest_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="designer", password="designer-pass", role="designer")
            auth.create_user(username="guest", password="guest-pass", role="guest")
            app = FastAPI()
            install_auth_routes(app, auth)

            @app.get("/api/canvases")
            async def canvases():
                return {"canvases": []}

            @app.get("/api/providers")
            async def providers():
                return {"providers": []}

            install_access_control(app, auth)

            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                self.assertEqual(client.get("/api/canvases").status_code, 200)
                self.assertEqual(client.get("/api/providers").status_code, 403)
                self.assertEqual(client.get("/api/admin/accounts").status_code, 403)

                client.post("/api/auth/logout")
                client.post(
                    "/api/auth/login",
                    json={"username": "guest", "password": "guest-pass"},
                )
                self.assertEqual(client.get("/api/canvases").status_code, 403)

    def test_local_user_lifecycle_revokes_existing_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            user = auth.create_user(
                username="designer", password="old-password", role="designer"
            )
            token = auth.create_session(user["id"])

            self.assertEqual(auth.list_users(), [user])
            updated = auth.set_user_role(user["id"], "admin")
            self.assertEqual(updated["role"], "admin")

            disabled = auth.set_user_status(user["id"], "disabled")
            self.assertEqual(disabled["status"], "disabled")
            self.assertIsNone(auth.user_for_session(token))

            auth.set_user_status(user["id"], "active")
            auth.reset_password(user["id"], "new-password")
            self.assertIsNone(auth.authenticate("designer", "old-password"))
            self.assertEqual(auth.authenticate("designer", "new-password")["role"], "admin")

    def test_canvas_share_tokens_are_hashed_revocable_and_replaceable(self):
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "auth.db"
            auth = AuthSystem(database)
            user = auth.create_user(
                username="admin", password="password", role="admin"
            )

            first = auth.replace_canvas_share(
                "workspace-a", "canvas-1", user["id"]
            )
            self.assertNotEqual(first["token"], first["token_hash"])
            self.assertEqual(
                auth.resolve_canvas_share(
                    first["token"], "workspace-a"
                )["canvas_id"], "canvas-1"
            )
            self.assertIsNone(
                auth.resolve_canvas_share(first["token"], "workspace-b")
            )

            workspace_b = auth.replace_canvas_share(
                "workspace-b", "canvas-1", user["id"]
            )
            self.assertTrue(
                auth.canvas_share_status("workspace-a", "canvas-1")["active"]
            )
            self.assertTrue(
                auth.canvas_share_status("workspace-b", "canvas-1")["active"]
            )

            second = auth.replace_canvas_share(
                "workspace-a", "canvas-1", user["id"]
            )
            self.assertIsNone(
                auth.resolve_canvas_share(first["token"], "workspace-a")
            )
            self.assertEqual(
                auth.resolve_canvas_share(
                    second["token"], "workspace-a"
                )["canvas_id"], "canvas-1"
            )
            self.assertEqual(
                auth.canvas_share_status("workspace-a", "canvas-1")["active"],
                True,
            )

            auth.revoke_canvas_share(
                "workspace-a", "canvas-1", user["id"]
            )
            self.assertIsNone(
                auth.resolve_canvas_share(second["token"], "workspace-a")
            )
            self.assertEqual(
                auth.canvas_share_status("workspace-a", "canvas-1")["active"],
                False,
            )
            self.assertEqual(
                "canvas-1",
                auth.resolve_canvas_share(
                    workspace_b["token"], "workspace-b"
                )["canvas_id"],
            )
            events = auth.list_audit_events()
            actions = [event["action"] for event in events]
            self.assertIn("share_created", actions)
            self.assertIn("share_regenerated", actions)
            self.assertIn("share_revoked", actions)
            self.assertNotIn(first["token"], str(events))
            self.assertTrue(
                all(
                    event["workspace_id"] in {"workspace-a", "workspace-b"}
                    for event in events
                    if event["action"].startswith("share_")
                )
            )

    def test_repeated_bad_passwords_are_rate_limited(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="right-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                responses = [
                    client.post(
                        "/api/auth/login",
                        json={"username": "admin", "password": "wrong-password"},
                    )
                    for _ in range(6)
                ]

            self.assertEqual([response.status_code for response in responses[:5]], [401] * 5)
            self.assertEqual(responses[5].status_code, 429)

    def test_ten_sessions_can_be_validated_concurrently(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            tokens = []
            for index in range(10):
                user = auth.create_user(
                    username=f"designer-{index}",
                    password=f"password-{index}",
                    role="designer",
                )
                tokens.append(auth.create_session(user["id"]))

            with ThreadPoolExecutor(max_workers=10) as pool:
                users = list(pool.map(auth.user_for_session, tokens * 5))

            self.assertEqual(len(users), 50)
            self.assertTrue(all(user and user["role"] == "designer" for user in users))
            share = auth.replace_canvas_share(
                "workspace-a", "canvas-concurrent", users[0]["id"]
            )
            with ThreadPoolExecutor(max_workers=10) as pool:
                shares = list(
                    pool.map(
                        lambda token: auth.resolve_canvas_share(
                            token, "workspace-a"
                        ),
                        [share["token"]] * 50,
                    )
                )
            self.assertTrue(
                all(item and item["canvas_id"] == "canvas-concurrent" for item in shares)
            )

    def test_cross_site_authenticated_write_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(
                username="designer", password="designer-pass", role="designer"
            )
            app = FastAPI()
            install_auth_routes(app, auth)

            @app.post("/api/canvases/change")
            async def change_canvas():
                return {"ok": True}

            install_access_control(app, auth)
            with TestClient(app) as client:
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                response = client.post(
                    "/api/canvases/change",
                    headers={"Origin": "https://attacker.example"},
                )

            self.assertEqual(response.status_code, 403)

    def test_cross_site_self_registration_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(username="admin", password="admin-password", role="admin")
            app = FastAPI()
            install_auth_routes(app, auth)

            with TestClient(app) as client:
                response = client.post(
                    "/api/auth/register",
                    headers={"Origin": "https://attacker.example"},
                    json={"username": "alice", "password": "alice-password"},
                )

            self.assertEqual(response.status_code, 403)
            self.assertIsNone(auth.authenticate("alice", "alice-password"))


if __name__ == "__main__":
    unittest.main()
