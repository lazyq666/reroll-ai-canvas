import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace_storage_composition import (
    compose_workspace_storage,
)
from tests.runtime_env import unload_main


class WorkspaceBootstrapTests(unittest.TestCase):
    def test_first_setup_creates_admin_in_instance_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            selected_parent = root / "selected-workspace"
            state.mkdir()
            selected_parent.mkdir()
            (state / "workspace-storage.json").write_text(
                json.dumps({}),
                encoding="utf-8",
            )
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    self.assertFalse(main.WORKSPACE_CONFIGURED)
                    self.assertIsNone(main._CONFIGURED_WORKSPACE)

                    with TestClient(main.app) as client:
                        status = client.get("/api/setup/status").json()
                        self.assertTrue(status["required"])
                        self.assertFalse(status["workspace_configured"])
                        inspection = client.post(
                            "/api/setup/inspect-workspace",
                            json={
                                "workspace_directory": str(selected_parent),
                            },
                        )
                        self.assertEqual(200, inspection.status_code)
                        self.assertEqual(
                            "create_admin",
                            inspection.json()["next_step"],
                        )
                        self.assertEqual([], list(selected_parent.iterdir()))

                        response = client.post(
                            "/api/setup",
                            json={
                                "username": "owner",
                                "display_name": "Owner",
                                "password": "owner-password",
                                "workspace_directory": str(selected_parent),
                            },
                        )

                    self.assertEqual(200, response.status_code)
                    self.assertTrue((selected_parent / "data").is_dir())
                    self.assertTrue((selected_parent / "assets").is_dir())
                    self.assertEqual(
                        (state / "instance-state" / "auth.db").resolve(),
                        main.AUTH_SYSTEM.database_path,
                    )
                    self.assertTrue(
                        (state / "instance-state" / "auth.db").is_file()
                    )
                    self.assertFalse(
                        (selected_parent / "data" / "auth.db").exists()
                    )
                    content = WorkspaceContent(
                        main.WORKSPACE_SERVICE.current()
                    )
                    authority = resolve_storage_authority(
                        content.storage_authority,
                        main.WORKSPACE_SERVICE.identity(selected_parent),
                        supported_modes=("sqlite",),
                    )
                    self.assertEqual("sqlite", authority.mode)
                    self.assertTrue(content.canvas_content.is_file())
                    self.assertTrue(content.generation_run_store.is_file())
                    self.assertTrue(
                        compose_workspace_storage(
                            content,
                            workspace_id=authority.workspace_id,
                        ).sqlite_ready
                    )
                    self.assertFalse(content.generation_runs.exists())
                    self.assertEqual(
                        {
                            "workspace_directory": str(
                                selected_parent.resolve()
                            )
                        },
                        response.json()["workspace"],
                    )
                    self.assertEqual(
                        "owner",
                        main.AUTH_SYSTEM.list_users()[0]["username"],
                    )
                    unload_main()
                    restarted = importlib.import_module("main")
                    self.assertTrue(restarted.WORKSPACE_CONFIGURED)
                    self.assertEqual(
                        "sqlite",
                        restarted.WORKSPACE_STORAGE_COMPOSITION.mode,
                    )
                    self.assertTrue(
                        restarted.WORKSPACE_STORAGE_COMPOSITION.sqlite_ready
                    )
            finally:
                unload_main()

    def test_first_setup_opens_existing_workspace_and_requests_login_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            selected_workspace = root / "existing-workspace"
            (selected_workspace / "assets").mkdir(parents=True)
            accounts = AuthSystem(
                selected_workspace / "data" / "auth.db"
            )
            accounts.create_user(
                username="existing-owner",
                password="existing-password",
                role="admin",
            )
            state.mkdir()
            events = []
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    main.install_runtime_control(
                        lambda *, cancel_active=False: events.append(
                            cancel_active
                        )
                        or {"stage": "stopping"}
                    )

                    with TestClient(main.app) as client:
                        inspection = client.post(
                            "/api/setup/inspect-workspace",
                            json={
                                "workspace_directory": str(
                                    selected_workspace
                                ),
                            },
                        )
                        rejected_creation = client.post(
                            "/api/setup",
                            json={
                                "username": "replacement-owner",
                                "display_name": "Replacement",
                                "password": "replacement-password",
                                "workspace_directory": str(
                                    selected_workspace
                                ),
                            },
                        )
                        opened = client.post(
                            "/api/setup/open-workspace",
                            json={
                                "workspace_directory": str(
                                    selected_workspace
                                ),
                            },
                        )

                self.assertEqual("login", inspection.json()["next_step"])
                self.assertEqual(409, rejected_creation.status_code)
                self.assertIn("可迁移账号", rejected_creation.text)
                self.assertEqual(200, opened.status_code)
                self.assertEqual("continue", opened.json()["next_step"])
                self.assertEqual([False], events)
                configured = json.loads(
                    (state / "workspace-storage.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual(
                    str(selected_workspace.resolve()),
                    configured["parent_dir"],
                )
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
