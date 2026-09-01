import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem
from tests.runtime_env import unload_main
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceOpenTests(unittest.TestCase):
    @staticmethod
    def _workspace(
        directory: Path,
        *,
        username: str,
        password: str,
        provider_name: str,
    ) -> AuthSystem:
        (directory / "data" / "canvases").mkdir(parents=True)
        (directory / "assets").mkdir()
        (directory / "data" / "canvases" / "canvas.json").write_text(
            json.dumps(
                {
                    "id": "canvas",
                    "nodes": [],
                    "connections": [],
                }
            ),
            encoding="utf-8",
        )
        (directory / "data" / "api_providers.json").write_text(
            json.dumps(
                [
                    {
                        "id": "team-provider",
                        "name": provider_name,
                        "protocol": "openai",
                        "enabled": True,
                        "primary": True,
                        "image_models": ["team-image"],
                        "chat_models": [],
                        "video_models": [],
                    }
                ],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        auth = AuthSystem(directory / "data" / "auth.db")
        auth.create_user(
            username=username,
            password=password,
            role="admin",
        )
        return auth

    def test_confirmed_open_switches_only_at_restart_safe_point(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "current-workspace"
            target = root / "target-workspace"
            state = root / "device-state"
            current_auth = self._workspace(
                current,
                username="current-owner",
                password="current-password",
                provider_name="Current Shared Provider",
            )
            self._workspace(
                target,
                username="current-owner",
                password="target-password",
                provider_name="Target Shared Provider",
            )
            WorkspaceStorage(ROOT, state_dir=state).save_parent(current)
            credentials = state / "api.env"
            credentials.write_text(
                "API_PROVIDER_TEAM_PROVIDER_API_KEY=device-only-secret\n",
                encoding="utf-8",
            )
            (state / "provider-connections.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "connections": [
                            {
                                "id": "team-provider",
                                "base_url": "http://127.0.0.1:9000/v1",
                            }
                        ],
                        "unclassified": {},
                    }
                ),
                encoding="utf-8",
            )
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            old_session = ""
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")
                    restart_events = []

                    async def controlled_restart(*, cancel_active=False):
                        restart_events.append(("requested", cancel_active))
                        main.prepare_controlled_restart()
                        restart_events.append(("prepared", False))
                        return {
                            "stage": "stopping",
                            "message": "正在安全关闭并重启 Reroll…",
                            "blocking_generation_runs": 0,
                            "error_id": "",
                            "unavailable_features": [],
                        }

                    main.install_runtime_control(
                        lambda *, cancel_active=False: {},
                        controlled_restart,
                    )
                    with TestClient(main.app) as client:
                        login = client.post(
                            "/api/auth/login",
                            json={
                                "username": "current-owner",
                                "password": "current-password",
                            },
                        )
                        self.assertEqual(200, login.status_code)
                        old_session = client.cookies.get("ic_session")

                        response = client.post(
                            "/api/workspace-storage-settings/open",
                            json={
                                "workspace_directory": str(target),
                                "cancel_active": False,
                            },
                        )

                        self.assertEqual(200, response.status_code)
                        self.assertEqual("stopping", response.json()["stage"])
                        self.assertEqual(
                            [
                                ("requested", False),
                                ("prepared", False),
                            ],
                            restart_events,
                        )
                        self.assertEqual(
                            (state / "instance-state" / "auth.db").resolve(),
                            main.AUTH_SYSTEM.database_path,
                        )
                        self.assertIsNotNone(
                            main.AUTH_SYSTEM.user_for_session(old_session)
                        )
                        self.assertEqual(
                            target.resolve(),
                            Path(
                                WorkspaceStorage(
                                    ROOT,
                                    state_dir=state,
                                ).configured_parent_hint()
                            ).resolve(),
                        )
                        self.assertEqual(
                            "API_PROVIDER_TEAM_PROVIDER_API_KEY="
                            "device-only-secret\n",
                            credentials.read_text(encoding="utf-8"),
                        )
            finally:
                unload_main()

            try:
                with patch.dict(os.environ, environment):
                    switched = importlib.import_module("main")
                    self.assertIsNotNone(
                        switched.AUTH_SYSTEM.authenticate(
                            "current-owner", "current-password"
                        )
                    )
                    self.assertIsNone(
                        switched.AUTH_SYSTEM.authenticate(
                            "current-owner", "target-password"
                        )
                    )
                    self.assertIsNotNone(
                        switched.AUTH_SYSTEM.user_for_session(old_session)
                    )
                    self.assertFalse((current / "data" / "auth.db").exists())
                    self.assertFalse((target / "data" / "auth.db").exists())
                    providers = switched.load_api_providers()
                    target_provider = next(
                        item
                        for item in providers
                        if item.get("id") == "team-provider"
                    )
                    self.assertEqual(
                        "Target Shared Provider",
                        target_provider["name"],
                    )
                    self.assertEqual(
                        "http://127.0.0.1:9000/v1",
                        target_provider["base_url"],
                    )
                    self.assertEqual(
                        "API_PROVIDER_TEAM_PROVIDER_API_KEY="
                        "device-only-secret\n",
                        credentials.read_text(encoding="utf-8"),
                    )
            finally:
                unload_main()

    def test_active_generation_tasks_leave_current_selection_until_safe_point(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "current-workspace"
            target = root / "target-workspace"
            state = root / "device-state"
            self._workspace(
                current,
                username="current-owner",
                password="current-password",
                provider_name="Current Provider",
            )
            self._workspace(
                target,
                username="target-owner",
                password="target-password",
                provider_name="Target Provider",
            )
            storage = WorkspaceStorage(ROOT, state_dir=state)
            storage.save_parent(current)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")

                    async def wait_for_safe_point(*, cancel_active=False):
                        return {
                            "stage": "restart_waiting",
                            "message": "正在等待 1 个生成任务完成…",
                            "blocking_generation_runs": 1,
                            "error_id": "",
                            "unavailable_features": [],
                        }

                    main.install_runtime_control(
                        lambda *, cancel_active=False: {},
                        wait_for_safe_point,
                    )
                    with TestClient(main.app) as client:
                        client.post(
                            "/api/auth/login",
                            json={
                                "username": "current-owner",
                                "password": "current-password",
                            },
                        )
                        response = client.post(
                            "/api/workspace-storage-settings/open",
                            json={
                                "workspace_directory": str(target),
                                "cancel_active": False,
                            },
                        )
                        self.assertEqual(200, response.status_code)
                        self.assertEqual(
                            "restart_waiting",
                            response.json()["stage"],
                        )
                        self.assertEqual(
                            current.resolve(),
                            Path(storage.configured_parent_hint()).resolve(),
                        )

                        main.prepare_controlled_restart()
                        self.assertEqual(
                            target.resolve(),
                            Path(storage.configured_parent_hint()).resolve(),
                        )
            finally:
                unload_main()

    def test_invalid_or_occupied_target_does_not_change_current_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "current-workspace"
            target = root / "target-workspace"
            invalid = root / "ordinary-folder"
            incomplete = root / "incomplete-workspace"
            state = root / "device-state"
            self._workspace(
                current,
                username="current-owner",
                password="current-password",
                provider_name="Current Provider",
            )
            self._workspace(
                target,
                username="target-owner",
                password="target-password",
                provider_name="Target Provider",
            )
            invalid.mkdir()
            (invalid / "notes.txt").write_text("keep", encoding="utf-8")
            (incomplete / "data").mkdir(parents=True)
            storage = WorkspaceStorage(ROOT, state_dir=state)
            storage.save_parent(current)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    main = importlib.import_module("main")

                    async def should_not_restart(*, cancel_active=False):
                        raise AssertionError("无效目标不应请求重启")

                    main.install_runtime_control(
                        lambda *, cancel_active=False: {},
                        should_not_restart,
                    )
                    with TestClient(main.app) as client:
                        login = client.post(
                            "/api/auth/login",
                            json={
                                "username": "current-owner",
                                "password": "current-password",
                            },
                        )
                        current_session = login.cookies.get("ic_session")
                        rejected = client.post(
                            "/api/workspace-storage-settings/open",
                            json={
                                "workspace_directory": str(invalid),
                                "cancel_active": False,
                            },
                        )
                        self.assertEqual(400, rejected.status_code)
                        self.assertEqual(
                            current.resolve(),
                            Path(storage.configured_parent_hint()).resolve(),
                        )
                        incomplete_response = client.post(
                            "/api/workspace-storage-settings/open",
                            json={
                                "workspace_directory": str(incomplete),
                                "cancel_active": False,
                            },
                        )
                        self.assertEqual(
                            400,
                            incomplete_response.status_code,
                        )
                        self.assertEqual(
                            current.resolve(),
                            Path(storage.configured_parent_hint()).resolve(),
                        )

                        occupation = (
                            main.WORKSPACE_SERVICE.acquire_occupation(
                                "another-server",
                                directory=target,
                            )
                        )
                        try:
                            occupied = client.post(
                                "/api/workspace-storage-settings/open",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            )
                            self.assertEqual(400, occupied.status_code)
                            self.assertIn(
                                "另一个 Reroll 服务",
                                occupied.text,
                            )
                            self.assertEqual(
                                current.resolve(),
                                Path(
                                    storage.configured_parent_hint()
                                ).resolve(),
                            )
                        finally:
                            occupation.release()

                        async def fail_at_safe_point(
                            *,
                            cancel_active=False,
                        ):
                            main.prepare_controlled_restart()
                            return {"stage": "stopping"}

                        main.install_runtime_control(
                            lambda *, cancel_active=False: {},
                            fail_at_safe_point,
                        )
                        with patch.object(
                            main.WORKSPACE_SERVICE,
                            "open_existing",
                            side_effect=WorkspaceStorageError(
                                "目标工作区无法完整读取"
                            ),
                        ):
                            failed = client.post(
                                "/api/workspace-storage-settings/open",
                                json={
                                    "workspace_directory": str(target),
                                    "cancel_active": False,
                                },
                            )
                        self.assertEqual(400, failed.status_code)
                        self.assertEqual(
                            current.resolve(),
                            Path(storage.configured_parent_hint()).resolve(),
                        )
                        self.assertIsNotNone(
                            main.AUTH_SYSTEM.user_for_session(
                                current_session
                            )
                        )
                        self.assertIsNone(main.PENDING_WORKSPACE_OPEN)
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
