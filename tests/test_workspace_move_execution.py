import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.runtime import (
    ApplicationRuntime,
    RuntimeStage,
    RuntimeStartup,
)
from infinite_canvas.workspace import WorkspaceMoveExecutor
from infinite_canvas.workspace import WorkspaceMoveError
from tests.runtime_env import unload_main
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceMoveExecutorTests(unittest.TestCase):
    @staticmethod
    def _source(root: Path) -> Path:
        source = root / "current-workspace"
        (source / "data" / "canvases").mkdir(parents=True)
        (source / "assets" / "output").mkdir(parents=True)
        (source / "data" / "canvases" / "one.json").write_text(
            '{"id":"one"}',
            encoding="utf-8",
        )
        (source / "assets" / "output" / "one.png").write_bytes(
            b"image-content"
        )
        (source / "data" / "media_previews").mkdir()
        (source / "data" / "media_previews" / "cache.webp").write_bytes(
            b"regenerable-preview"
        )
        (source / "data" / "models" / "matting").mkdir(parents=True)
        (
            source
            / "data"
            / "models"
            / "matting"
            / "legacy.onnx"
        ).write_bytes(b"regenerable-model")
        (source / "data" / "auth.db").write_bytes(b"legacy-account-store")
        (source / "data" / "recovery").mkdir()
        (source / "data" / "recovery" / "auth.pre-v0.db").write_bytes(
            b"legacy-account-recovery"
        )
        occupation = source / ".infinite-canvas-service"
        occupation.mkdir()
        (occupation / "occupation.json").write_text(
            '{"server":"current"}',
            encoding="utf-8",
        )
        return source

    def test_copy_uses_identifiable_stage_and_verifies_every_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self._source(root)
            target = root / "new-workspace"
            target.mkdir()
            observed_stages = []
            progress = []

            def copy_tree(source_path, stage_path, **kwargs):
                observed_stages.append(stage_path)
                import shutil

                return shutil.copytree(source_path, stage_path, **kwargs)

            result = WorkspaceMoveExecutor(
                source,
                target,
                operation_id="move-123",
                copy_tree=copy_tree,
                progress=lambda stage, files, size: progress.append(
                    (stage, files, size)
                ),
            ).copy_and_verify()

            self.assertEqual(
                b"image-content",
                (target / "assets" / "output" / "one.png").read_bytes(),
            )
            self.assertTrue(
                (source / "data" / "canvases" / "one.json").is_file()
            )
            self.assertFalse(
                (target / ".infinite-canvas-service").exists()
            )
            self.assertTrue(
                (source / "data" / "media_previews" / "cache.webp").is_file()
            )
            self.assertFalse((target / "data" / "media_previews").exists())
            self.assertTrue(
                (
                    source
                    / "data"
                    / "models"
                    / "matting"
                    / "legacy.onnx"
                ).is_file()
            )
            self.assertFalse((target / "data" / "models").exists())
            self.assertTrue((source / "data" / "auth.db").is_file())
            self.assertFalse((target / "data" / "auth.db").exists())
            self.assertTrue(
                (source / "data" / "recovery" / "auth.pre-v0.db").is_file()
            )
            self.assertFalse(
                (target / "data" / "recovery" / "auth.pre-v0.db").exists()
            )
            self.assertEqual(result.file_count, 2)
            self.assertEqual(
                result.total_bytes,
                len(b'{"id":"one"}') + len(b"image-content"),
            )
            self.assertEqual(1, len(observed_stages))
            self.assertIn(
                ".infinite-canvas-moving-move-123",
                observed_stages[0].name,
            )
            self.assertFalse(observed_stages[0].exists())
            self.assertEqual(
                ["copying", "verifying", "prepared"],
                list(dict.fromkeys(item[0] for item in progress)),
            )

    def test_digest_mismatch_keeps_source_selected_and_target_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self._source(root)
            target = root / "new-workspace"
            target.mkdir()

            def corrupt_copy(source_path, stage_path, **kwargs):
                import shutil

                copied = shutil.copytree(source_path, stage_path, **kwargs)
                (stage_path / "data" / "canvases" / "one.json").write_text(
                    '{"id":"changed"}',
                    encoding="utf-8",
                )
                return copied

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "逐文件校验失败",
            ) as raised:
                WorkspaceMoveExecutor(
                    source,
                    target,
                    operation_id="move-456",
                    copy_tree=corrupt_copy,
                ).copy_and_verify()

            self.assertEqual("verifying", raised.exception.stage)
            self.assertEqual(
                "data/canvases/one.json",
                raised.exception.relative_path,
            )
            self.assertNotIn(str(root), str(raised.exception))
            self.assertEqual(
                '{"id":"one"}',
                (source / "data" / "canvases" / "one.json").read_text(
                    encoding="utf-8"
                ),
            )
            self.assertEqual([], list(target.iterdir()))
            self.assertEqual(
                [],
                list(root.glob(".*.infinite-canvas-moving-*")),
            )

    def test_copy_failure_reports_stage_and_relative_path_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self._source(root)
            target = root / "new-workspace"
            target.mkdir()
            failing = source / "data" / "canvases" / "one.json"

            def fail_copy(_source_path, _stage_path, **_kwargs):
                raise OSError(5, "read failed", str(failing))

            with self.assertRaises(WorkspaceMoveError) as raised:
                WorkspaceMoveExecutor(
                    source,
                    target,
                    operation_id="move-copy-failure",
                    copy_tree=fail_copy,
                ).copy_and_verify()

            self.assertEqual("copying", raised.exception.stage)
            self.assertEqual(
                "data/canvases/one.json",
                raised.exception.relative_path,
            )
            self.assertNotIn(str(root), str(raised.exception))
            self.assertEqual([], list(target.iterdir()))

    def test_retry_cleanup_removes_only_the_named_operation_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "new-workspace"
            target.mkdir()
            owned = (
                root
                / ".new-workspace.infinite-canvas-moving-move-owned"
            )
            unknown = (
                root
                / ".new-workspace.infinite-canvas-moving-move-unknown"
            )
            owned.mkdir()
            unknown.mkdir()
            (owned / "partial").write_text("owned", encoding="utf-8")
            (unknown / "partial").write_text("unknown", encoding="utf-8")

            removed = WorkspaceMoveExecutor.cleanup_temporary(
                target,
                operation_id="move-owned",
            )

            self.assertTrue(removed)
            self.assertFalse(owned.exists())
            self.assertTrue(unknown.is_dir())


class WorkspaceMoveIntegrationTests(unittest.TestCase):
    @staticmethod
    def _workspace(directory: Path) -> AuthSystem:
        (directory / "data" / "canvases").mkdir(parents=True)
        (directory / "assets" / "output").mkdir(parents=True)
        (directory / "data" / "canvases" / "canvas.json").write_text(
            json.dumps(
                {"id": "canvas", "nodes": [], "connections": []}
            ),
            encoding="utf-8",
        )
        (directory / "assets" / "output" / "result.png").write_bytes(
            b"result"
        )
        auth = AuthSystem(directory / "data" / "auth.db")
        auth.create_user(
            username="owner",
            password="owner-password",
            role="admin",
        )
        return auth

    def test_safe_point_moves_workspace_and_preserves_login_and_old_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    session = main.AUTH_SYSTEM.create_session(
                        main.AUTH_SYSTEM.authenticate(
                            "owner",
                            "owner-password",
                        )["id"]
                    )
                    main.stage_workspace_move(
                        str(target),
                        actor_id="admin",
                        return_url="/?page=smart-canvas#canvas-1",
                    )

                    rollback = asyncio.run(
                        main.prepare_controlled_restart()
                    )

                    configured = WorkspaceStorage(
                        ROOT,
                        state_dir=state,
                    ).configured_parent_hint()
                    self.assertEqual(
                        target.resolve(),
                        Path(configured).resolve(),
                    )
                    self.assertIsNotNone(
                        main.AUTH_SYSTEM.user_for_session(session)
                    )
                    self.assertFalse((source / "data" / "auth.db").exists())
                    self.assertFalse((target / "data" / "auth.db").exists())
                    self.assertEqual(
                        b"result",
                        (
                            source
                            / "assets"
                            / "output"
                            / "result.png"
                        ).read_bytes(),
                    )
                    self.assertEqual(
                        b"result",
                        (
                            target
                            / "assets"
                            / "output"
                            / "result.png"
                        ).read_bytes(),
                    )
                    self.assertTrue(callable(rollback))
                    self.assertEqual(
                        "restarting",
                        main.workspace_move_status()["stage"],
                    )
                    self.assertEqual(
                        "/?page=smart-canvas#canvas-1",
                        main.workspace_move_status()["return_url"],
                    )
            finally:
                unload_main()

            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    restarted = importlib.import_module("main")
                    self.assertEqual(
                        "completed",
                        restarted.workspace_move_status()["stage"],
                    )
                    self.assertIsNotNone(
                        restarted.AUTH_SYSTEM.user_for_session(session)
                    )
                    self.assertEqual(
                        target.resolve(),
                        restarted.WORKSPACE_SERVICE.current().directory,
                    )
                    self.assertEqual(
                        "/?page=smart-canvas#canvas-1",
                        restarted.workspace_move_status()["return_url"],
                    )
                    self.assertFalse((source / "data" / "auth.db").exists())
                    self.assertFalse((target / "data" / "auth.db").exists())
            finally:
                unload_main()

    def test_move_endpoint_waits_for_generation_tasks_without_freezing_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    restart_requests = []

                    async def wait_for_runs(*, cancel_active=False):
                        restart_requests.append(cancel_active)
                        return {
                            "stage": "restart_waiting",
                            "message": "正在等待 2 个生成任务完成…",
                            "blocking_generation_runs": 2,
                        }

                    main.install_runtime_control(
                        lambda *, cancel_active=False: {},
                        wait_for_runs,
                    )
                    with (
                        patch.object(
                            main,
                            "active_generation_run_count",
                            return_value=2,
                        ),
                        TestClient(main.app) as client,
                    ):
                        login = client.post(
                            "/api/auth/login",
                            json={
                                "username": "owner",
                                "password": "owner-password",
                            },
                        )
                        self.assertEqual(200, login.status_code)

                        response = client.post(
                            "/api/workspace-storage-settings/move",
                            json={
                                "workspace_directory": str(target),
                                "cancel_active": False,
                                "return_url": "/?page=canvas-list",
                            },
                        )
                        repeated = client.post(
                            "/api/workspace-storage-settings/move",
                            json={
                                "workspace_directory": str(target),
                                "cancel_active": False,
                                "return_url": "/?page=canvas-list",
                            },
                        )

                        self.assertEqual(200, response.status_code)
                        self.assertEqual(
                            "waiting_for_generation_tasks",
                            response.json()["stage"],
                        )
                        self.assertEqual(
                            (
                                "/workspace-move?operation_id="
                                + response.json()["operation_id"]
                            ),
                            response.json()["progress_url"],
                        )
                        self.assertEqual(200, repeated.status_code)
                        self.assertEqual(
                            response.json()["operation_id"],
                            repeated.json()["operation_id"],
                        )
                        self.assertTrue(
                            repeated.json()["existing_operation"]
                        )
                        self.assertEqual([False], restart_requests)
                        self.assertEqual([], list(target.iterdir()))
                        self.assertEqual(
                            source.resolve(),
                            Path(
                                WorkspaceStorage(
                                    ROOT,
                                    state_dir=state,
                                ).configured_parent_hint()
                            ).resolve(),
                        )
                        self.assertTrue(
                            (
                                source
                                / "data"
                                / "canvases"
                                / "canvas.json"
                            ).is_file()
                        )
            finally:
                unload_main()

    def test_verification_failure_keeps_original_workspace_running(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    main.stage_workspace_move(
                        str(target),
                        actor_id="admin",
                    )

                    with patch.object(
                        main.WorkspaceMoveExecutor,
                        "copy_and_verify",
                        side_effect=WorkspaceStorageError(
                            "工作区逐文件校验失败，当前工作区继续可用"
                        ),
                    ):
                        with self.assertRaises(WorkspaceStorageError):
                            asyncio.run(
                                main.prepare_controlled_restart()
                            )

                    self.assertEqual(
                        source.resolve(),
                        Path(
                            WorkspaceStorage(
                                ROOT,
                                state_dir=state,
                            ).configured_parent_hint()
                        ).resolve(),
                    )
                    self.assertTrue(main.WORKSPACE_OCCUPATION.active)
                    self.assertEqual(
                        source.resolve(),
                        main.WORKSPACE_OCCUPATION.directory,
                    )
                    self.assertEqual([], list(target.iterdir()))
                    self.assertEqual(
                        "failed",
                        main.workspace_move_status()["stage"],
                    )
                    self.assertIn(
                        "当前工作区继续可用",
                        main.workspace_move_status()["message"],
                    )
            finally:
                unload_main()

    def test_restart_failure_rolls_back_workspace_selection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    main.stage_workspace_move(
                        str(target),
                        actor_id="admin",
                    )

                    async def scenario():
                        async def initialize():
                            return RuntimeStartup(application=object())

                        def fail_restart():
                            raise RuntimeError("launcher unavailable")

                        runtime = ApplicationRuntime(
                            initializer=initialize,
                            local_state_dir=state,
                            version="test",
                            restart_signal=fail_restart,
                        )
                        runtime.install_restart_preparer(
                            main.prepare_controlled_restart
                        )
                        await runtime.start()
                        return await runtime.request_restart()

                    status = asyncio.run(scenario())

                    self.assertEqual(RuntimeStage.READY, status.stage)
                    self.assertIn(
                        "当前工作区继续可用",
                        status.message,
                    )
                    self.assertEqual(
                        source.resolve(),
                        Path(
                            WorkspaceStorage(
                                ROOT,
                                state_dir=state,
                            ).configured_parent_hint()
                        ).resolve(),
                    )
                    self.assertEqual(
                        source.resolve(),
                        main.WORKSPACE_OCCUPATION.directory,
                    )
                    self.assertTrue(
                        (
                            target
                            / "data"
                            / "canvases"
                            / "canvas.json"
                        ).is_file()
                    )
                    self.assertEqual(
                        "failed",
                        main.workspace_move_status()["stage"],
                    )
            finally:
                unload_main()

    def test_failed_status_hides_internal_relative_path_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    main.stage_workspace_move(
                        str(target),
                        actor_id="admin",
                    )
                    with patch.object(
                        main.WorkspaceMoveExecutor,
                        "copy_and_verify",
                        side_effect=WorkspaceMoveError(
                            "copying",
                            "data/canvases/canvas.json",
                            "无法复制工作区文件",
                        ),
                    ):
                        with self.assertRaises(WorkspaceStorageError):
                            asyncio.run(
                                main.prepare_controlled_restart()
                            )

                    status = main.workspace_move_status()
                    self.assertEqual("copying", status["failed_stage"])
                    self.assertEqual(
                        "Smart Canvas/canvas.json",
                        status["related_path"],
                    )
                    self.assertNotIn("data/", status["related_path"])
                    self.assertNotIn("assets/", status["related_path"])
            finally:
                unload_main()

    def test_progress_is_monotonic_and_retry_starts_with_a_new_operation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "new-workspace"
            state = root / "device-state"
            self._workspace(source)
            target.mkdir()
            WorkspaceStorage(ROOT, state_dir=state).save_parent(source)
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
                "AUTH_DB_PATH": "",
            }
            unload_main()
            try:
                with patch.dict(os.environ, environment):
                    import importlib

                    main = importlib.import_module("main")
                    old_id = "old-operation"
                    main.update_workspace_move_status(
                        operation_id=old_id,
                        stage="copying",
                        message="正在复制",
                        target_workspace_directory=str(target),
                        file_count=10,
                        total_bytes=100,
                        copied_files=6,
                        copied_bytes=60,
                        finished=False,
                    )
                    main.update_workspace_move_status(
                        operation_id=old_id,
                        stage="preparing",
                        message="不应倒退",
                        copied_files=2,
                        copied_bytes=20,
                    )
                    progress = main.workspace_move_status()
                    self.assertEqual("copying", progress["stage"])
                    self.assertEqual("正在复制", progress["message"])
                    self.assertEqual(6, progress["copied_files"])
                    self.assertEqual(60, progress["copied_bytes"])

                    old_stage = (
                        target.parent
                        / (
                            f".{target.name}.infinite-canvas-moving-"
                            f"{old_id}"
                        )
                    )
                    unknown_stage = (
                        target.parent
                        / (
                            f".{target.name}.infinite-canvas-moving-"
                            "unknown-operation"
                        )
                    )
                    old_stage.mkdir()
                    unknown_stage.mkdir()
                    main.update_workspace_move_status(
                        operation_id=old_id,
                        stage="failed",
                        message="上次失败",
                        finished=True,
                    )

                    retried = main.stage_workspace_move(
                        str(target),
                        actor_id="admin",
                    )

                    self.assertNotEqual(
                        old_id,
                        retried["operation_id"],
                    )
                    self.assertEqual(0, retried["copied_files"])
                    self.assertEqual(0, retried["copied_bytes"])
                    self.assertFalse(old_stage.exists())
                    self.assertTrue(unknown_stage.is_dir())
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
