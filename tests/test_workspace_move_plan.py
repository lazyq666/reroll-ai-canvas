import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.workspace import WorkspaceLocationCapability
from tests.runtime_env import unload_main
from infinite_canvas.workspace_storage import WorkspaceStorage


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceMovePlanHttpTests(unittest.TestCase):
    def test_admin_reviews_move_scope_without_changing_source_or_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "empty-target"
            state = root / "device-state"
            (source / "data").mkdir(parents=True)
            (source / "assets").mkdir()
            (source / "data" / "content.bin").write_bytes(b"workspace")
            target.mkdir()
            auth = AuthSystem(source / "data" / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            source_content_before = (
                source / "data" / "content.bin"
            ).read_bytes()
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    main.WORKSPACE_SERVICE._storage_classifier = (
                        lambda _path: WorkspaceLocationCapability(
                            kind="synchronized_local",
                            label="已同步到本机的云盘目录",
                            supported=True,
                            warnings=("请确认内容已完整同步到本机。",),
                        )
                    )
                    main.WORKSPACE_SERVICE._disk_usage = (
                        lambda _path: type(
                            "Usage",
                            (),
                            {"free": 1_000_000},
                        )()
                    )
                    with TestClient(main.app) as client:
                        client.post(
                            "/api/auth/login",
                            json={
                                "username": "owner",
                                "password": "owner-password",
                            },
                        )
                        with patch.object(
                            main,
                            "active_generation_run_count",
                            return_value=3,
                        ):
                            response = client.post(
                                "/api/workspace-storage-settings/plan-move",
                                json={
                                    "workspace_directory": str(target),
                                },
                            )
                        self.assertEqual(200, response.status_code)
                        payload = response.json()
                        self.assertEqual(
                            str(source.resolve()),
                            payload["source_workspace_directory"],
                        )
                        self.assertEqual(
                            str(target.resolve()),
                            payload["target_workspace_directory"],
                        )
                        self.assertGreaterEqual(payload["file_count"], 2)
                        self.assertGreater(payload["total_bytes"], 0)
                        self.assertEqual(3, payload["active_generation_tasks"])
                        self.assertEqual(
                            "已同步到本机的云盘目录",
                            payload["storage_label"],
                        )
                        self.assertTrue(payload["warnings"])
                        self.assertTrue(payload["can_continue"])
                        self.assertEqual(
                            source.resolve(),
                            Path(
                                WorkspaceStorage(
                                    ROOT,
                                    state_dir=state,
                                ).configured_parent_hint()
                            ).resolve(),
                        )
            finally:
                unload_main()

            self.assertEqual(
                source_content_before,
                (source / "data" / "content.bin").read_bytes(),
            )
            self.assertEqual([], list(target.iterdir()))


if __name__ == "__main__":
    unittest.main()
