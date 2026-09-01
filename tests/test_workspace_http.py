import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.runtime_env import configure_test_workspace, unload_main


class WorkspaceHttpTests(unittest.TestCase):
    def test_admin_reads_one_workspace_directory_without_internal_layout(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_directory = root / "workspace"
            data_directory = workspace_directory / "data"
            media_directory = workspace_directory / "assets"
            state_directory = root / "device-state"
            data_directory.mkdir(parents=True)
            media_directory.mkdir()
            state_directory.mkdir()
            configure_test_workspace(
                workspace_directory,
                state_directory,
            )
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state_directory),
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    main.AUTH_SYSTEM.create_user(
                        username="workspace-admin",
                        password="workspace-password",
                        role="admin",
                    )
                    with TestClient(main.app) as client:
                        login = client.post(
                            "/api/auth/login",
                            json={
                                "username": "workspace-admin",
                                "password": "workspace-password",
                            },
                        )
                        self.assertEqual(200, login.status_code)

                        response = client.get("/api/workspace-storage-settings")

                self.assertEqual(200, response.status_code)
                payload = response.json()
                self.assertEqual(
                    {"workspace_directory": str(workspace_directory.resolve())},
                    payload["active"],
                )
                self.assertEqual(payload["active"], payload["configured"])
                serialized = json.dumps(payload, ensure_ascii=False)
                self.assertNotIn('"data_dir"', serialized)
                self.assertNotIn('"assets_dir"', serialized)
                self.assertNotIn('"settings_file"', serialized)
                self.assertNotIn('"parent_dir"', serialized)
            finally:
                unload_main()

    def test_workspace_management_requires_admin_and_local_directory_selection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "current-workspace"
            target = root / "target-workspace"
            state_directory = root / "device-state"
            (current / "data").mkdir(parents=True)
            (current / "assets").mkdir()
            (target / "data" / "canvases").mkdir(parents=True)
            (target / "assets").mkdir()
            (target / "data" / "canvases" / "one.json").write_text(
                "{}",
                encoding="utf-8",
            )
            (target / "assets" / "reference.png").write_bytes(b"image")

            from infinite_canvas.auth_system import AuthSystem

            current_auth = AuthSystem(current / "data" / "auth.db")
            current_auth.create_user(
                username="workspace-admin",
                password="workspace-password",
                role="admin",
            )
            current_auth.create_user(
                username="workspace-designer",
                password="designer-password",
                role="designer",
            )
            target_auth = AuthSystem(target / "data" / "auth.db")
            target_auth.create_user(
                username="target-owner",
                password="target-password",
                role="admin",
            )
            target_auth.create_user(
                username="target-member",
                password="target-member-password",
                role="designer",
            )
            target_before = [
                (
                    str(path.relative_to(target)),
                    path.stat().st_size,
                    path.stat().st_mtime_ns,
                )
                for path in sorted(target.rglob("*"))
            ]
            configure_test_workspace(current, state_directory)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state_directory),
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    with TestClient(main.app) as admin_client:
                        login = admin_client.post(
                            "/api/auth/login",
                            json={
                                "username": "workspace-admin",
                                "password": "workspace-password",
                            },
                        )
                        self.assertEqual(200, login.status_code)
                        with patch.object(
                            main,
                            "choose_workspace_parent_directory",
                            return_value=str(target),
                        ):
                            selected = admin_client.post(
                                "/api/workspace-storage-settings/select-directory"
                            )
                        self.assertEqual(200, selected.status_code)
                        summary = admin_client.post(
                            "/api/workspace-storage-settings/inspect",
                            json={
                                "workspace_directory": selected.json()[
                                    "workspace_directory"
                                ],
                                "intent": "open",
                            },
                        )
                        self.assertEqual(200, summary.status_code)
                        payload = summary.json()
                        self.assertEqual("已有工作区", payload["type_label"])
                        self.assertEqual(1, payload["smart_canvas_count"])
                        self.assertEqual(1, payload["managed_media_count"])
                        self.assertNotIn("member_count", payload)
                        self.assertGreaterEqual(payload["file_count"], 2)
                        self.assertGreater(payload["total_bytes"], 0)
                        self.assertTrue(payload["recent_modified_at"])
                        self.assertTrue(payload["warnings"])
                        self.assertIn(
                            "账号、会话和全局角色保持不变",
                            " ".join(payload["warnings"]),
                        )

                        still_current = admin_client.get(
                            "/api/workspace-storage-settings"
                        ).json()
                        self.assertEqual(
                            str(current.resolve()),
                            still_current["active"]["workspace_directory"],
                        )
                        self.assertEqual(
                            str(current.resolve()),
                            still_current["configured"]["workspace_directory"],
                        )

                    with TestClient(main.app) as designer_client:
                        designer_client.post(
                            "/api/auth/login",
                            json={
                                "username": "workspace-designer",
                                "password": "designer-password",
                            },
                        )
                        self.assertEqual(
                            403,
                            designer_client.get(
                                "/api/workspace-storage-settings"
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            designer_client.post(
                                "/api/workspace-storage-settings/inspect",
                                json={
                                    "workspace_directory": str(target),
                                    "intent": "open",
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            designer_client.put(
                                "/api/workspace-storage-settings",
                                json={
                                    "workspace_directory": str(target),
                                    "migrate": False,
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            designer_client.post(
                                "/api/workspace-storage-settings/open",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            designer_client.post(
                                "/api/workspace-storage-settings/plan-move",
                                json={
                                    "workspace_directory": str(target),
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            designer_client.post(
                                "/api/workspace-storage-settings/move",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            ).status_code,
                        )

                    with TestClient(
                        main.app,
                        client=("203.0.113.20", 50000),
                    ) as remote_client:
                        remote_client.post(
                            "/api/auth/login",
                            json={
                                "username": "workspace-admin",
                                "password": "workspace-password",
                            },
                        )
                        self.assertEqual(
                            403,
                            remote_client.post(
                                "/api/workspace-storage-settings/select-directory"
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            remote_client.post(
                                "/api/workspace-storage-settings/inspect",
                                json={
                                    "workspace_directory": str(target),
                                    "intent": "open",
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            remote_client.put(
                                "/api/workspace-storage-settings",
                                json={
                                    "workspace_directory": str(target),
                                    "migrate": False,
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            remote_client.post(
                                "/api/workspace-storage-settings/open",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            remote_client.post(
                                "/api/workspace-storage-settings/plan-move",
                                json={
                                    "workspace_directory": str(target),
                                },
                            ).status_code,
                        )
                        self.assertEqual(
                            403,
                            remote_client.post(
                                "/api/workspace-storage-settings/move",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            ).status_code,
                        )

                    with TestClient(main.app) as anonymous_client:
                        self.assertEqual(
                            401,
                            anonymous_client.get(
                                "/api/workspace-storage-settings"
                            ).status_code,
                        )
            finally:
                unload_main()

            target_after = [
                (
                    str(path.relative_to(target)),
                    path.stat().st_size,
                    path.stat().st_mtime_ns,
                )
                for path in sorted(target.rglob("*"))
            ]
            self.assertEqual(target_before, target_after)


if __name__ == "__main__":
    unittest.main()
