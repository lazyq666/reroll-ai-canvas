import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.bootstrap import ExistingWorkspaceRecovery
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.device_state import DeviceState
from infinite_canvas.instance_state import InstanceState
from infinite_canvas.runtime import ApplicationRuntime, RuntimeStage
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError
from infinite_canvas.workspace_storage_composition import (
    compose_workspace_storage,
)


class ExistingWorkspaceRecoveryTests(unittest.TestCase):
    @staticmethod
    def _workspace(directory: Path, username: str) -> None:
        del username
        (directory / "data" / "canvases").mkdir(parents=True)
        (directory / "assets" / "output").mkdir(parents=True)
        (directory / "data" / "canvases" / "canvas.json").write_text(
            json.dumps(
                {"id": "canvas", "nodes": [], "connections": []}
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _remember_current(
        storage: WorkspaceStorage,
        device: DeviceState,
    ) -> str:
        identity = WorkspaceService(storage).ensure_identity()
        device.remember_workspace_identity(identity)
        return identity

    def test_reconnects_a_moved_copy_of_the_same_workspace_at_safe_point(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original-workspace"
            moved = root / "moved-workspace"
            state = root / "state"
            self._workspace(source, "owner")
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.save_parent(source)
            device = DeviceState(state)
            identity = self._remember_current(storage, device)
            source.rename(moved)
            recovery = ExistingWorkspaceRecovery(storage)

            summary = recovery.inspect(moved, intent="reconnect")
            staged = recovery.stage(moved, intent="reconnect")

            self.assertTrue(summary["can_continue"])
            self.assertTrue(summary["same_workspace"])
            self.assertNotIn("workspace_id", summary)
            self.assertEqual(
                source.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            self.assertEqual("reconnect", staged["intent"])

            rollback = recovery.prepare_restart()

            self.assertEqual(
                moved.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            self.assertTrue(
                (moved / "data" / "canvases" / "canvas.json").is_file()
            )
            self.assertTrue(callable(rollback))
            recovery.release()

    def test_opening_another_workspace_switches_content_at_safe_point(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "missing-current"
            other = root / "other-workspace"
            state = root / "state"
            self._workspace(other, "other-owner")
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(current)
            device = DeviceState(state)
            device.remember_workspace_identity(
                "00000000-0000-4000-8000-000000000001"
            )
            WorkspaceService(storage).ensure_identity(other)
            recovery = ExistingWorkspaceRecovery(storage)

            reconnect = recovery.inspect(other, intent="reconnect")
            opening = recovery.inspect(other, intent="open_other")

            self.assertFalse(reconnect["can_continue"])
            self.assertIn("另一个已有工作区", reconnect["warnings"][0])
            self.assertTrue(opening["can_continue"])
            recovery.stage(other, intent="open_other")
            recovery.prepare_restart()

            self.assertEqual(
                other.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            self.assertTrue(
                (other / "data" / "canvases" / "canvas.json").is_file()
            )
            recovery.release()

    def test_opening_another_workspace_does_not_revoke_any_sessions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original-workspace"
            other = root / "other-workspace"
            state = root / "state"
            self._workspace(original, "original-owner")
            self._workspace(other, "other-owner")
            global_auth = AuthSystem(
                InstanceState(state).auth_database
            )
            owner = global_auth.create_user(
                username="global-owner",
                password="global-password",
                role="admin",
            )
            session = global_auth.create_session(owner["id"])
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.save_parent(original)
            self._remember_current(storage, DeviceState(state))
            WorkspaceService(storage).ensure_identity(other)
            recovery = ExistingWorkspaceRecovery(storage)

            recovery.stage(other, intent="open_other")
            recovery.prepare_restart()

            self.assertIsNotNone(
                global_auth.user_for_session(session)
            )
            self.assertFalse((original / "data" / "auth.db").exists())
            self.assertFalse((other / "data" / "auth.db").exists())
            recovery.release()

    def test_retry_current_checks_it_without_changing_the_saved_location(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            current = root / "current-workspace"
            state = root / "state"
            self._workspace(current, "owner")
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.save_parent(current)
            self._remember_current(storage, DeviceState(state))
            recovery = ExistingWorkspaceRecovery(storage)
            before = storage.settings_file.read_bytes()

            checked = recovery.inspect_current()
            staged = recovery.stage_retry()

            self.assertTrue(checked["can_continue"])
            self.assertEqual("retry", staged["intent"])
            self.assertEqual(before, storage.settings_file.read_bytes())
            recovery.release()

    def test_failed_recovery_keeps_the_original_selection_for_another_try(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-workspace"
            incomplete = root / "incomplete-workspace"
            state = root / "state"
            incomplete.mkdir()
            (incomplete / "notes.txt").write_text(
                "not a workspace",
                encoding="utf-8",
            )
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)
            before = storage.settings_file.read_bytes()

            current = recovery.inspect_current()
            selected = recovery.inspect(
                incomplete,
                intent="open_other",
            )

            self.assertFalse(current["can_continue"])
            self.assertFalse(selected["can_continue"])
            with self.assertRaises(WorkspaceStorageError):
                recovery.stage(incomplete, intent="open_other")
            self.assertEqual(before, storage.settings_file.read_bytes())
            self.assertEqual(
                missing.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )

    def test_failed_restart_restores_original_selection_and_recovery_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original-workspace"
            moved = root / "moved-workspace"
            state = root / "state"
            self._workspace(original, "owner")
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.save_parent(original)
            self._remember_current(storage, DeviceState(state))
            original.rename(moved)
            recovery = ExistingWorkspaceRecovery(storage)

            async def initialize():
                raise WorkspaceStorageError(
                    "原工作区目录暂时不可用"
                )

            def fail_restart():
                raise RuntimeError("launcher unavailable")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=state,
                version="test",
                restart_signal=fail_restart,
            )
            runtime.install_restart_preparer(recovery.prepare_restart)
            asyncio.run(runtime.start())
            recovery.stage(moved, intent="reconnect")

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(RuntimeStage.RECOVERY_REQUIRED, status.stage)
            self.assertIn("原工作区目录选择已保留", status.message)
            self.assertEqual(
                original.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            # Rollback released the target so the same recovery can be tried.
            recovery.stage(moved, intent="reconnect")
            recovery.release()

    def test_creates_a_fresh_sqlite_workspace_before_switching_selection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-original"
            target = root / "new-workspace"
            state = root / "state"
            target.mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            auth = AuthSystem(InstanceState(state).auth_database)
            owner = auth.create_user(
                username="global-owner",
                password="global-password",
                role="admin",
            )
            session = auth.create_session(owner["id"])
            recovery = ExistingWorkspaceRecovery(storage)

            inspected = recovery.inspect(target, intent="create_new")
            self.assertEqual([], list(target.iterdir()))
            staged = recovery.stage(target, intent="create_new")

            self.assertTrue(inspected["can_continue"])
            self.assertEqual("empty", inspected["type"])
            self.assertIn("不会被修改或删除", inspected["warnings"][0])
            self.assertEqual("create_new", staged["intent"])
            self.assertEqual(
                missing.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )

            rollback = recovery.prepare_restart()
            workspace_id = WorkspaceService(storage).identity(target)
            current_workspace = WorkspaceService(storage).current()
            content = WorkspaceContent(current_workspace)
            authority = resolve_storage_authority(
                content.storage_authority,
                workspace_id,
                supported_modes=("sqlite",),
            )

            self.assertEqual(target.resolve(), current_workspace.directory)
            self.assertEqual("sqlite", authority.mode)
            self.assertTrue(
                compose_workspace_storage(
                    content,
                    workspace_id=workspace_id,
                ).sqlite_ready
            )
            self.assertFalse(content.generation_runs.exists())
            self.assertEqual([], list(content.smart_canvases.glob("*.json")))
            resumed_user = auth.user_for_session(session)
            self.assertIsNotNone(resumed_user)
            self.assertEqual(owner["id"], resumed_user["id"])
            self.assertEqual("admin", resumed_user["role"])
            self.assertFalse((target / "data" / "auth.db").exists())
            self.assertTrue(callable(rollback))
            recovery.release()

    def test_create_new_routes_existing_and_rejects_ordinary_non_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-original"
            existing = root / "existing-workspace"
            ordinary = root / "ordinary-directory"
            state = root / "state"
            self._workspace(existing, "owner")
            ordinary.mkdir()
            (ordinary / "notes.txt").write_text("personal", encoding="utf-8")
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)

            existing_summary = recovery.inspect(
                existing,
                intent="create_new",
            )
            ordinary_summary = recovery.inspect(
                ordinary,
                intent="create_new",
            )

            self.assertFalse(existing_summary["can_continue"])
            self.assertEqual("open_other", existing_summary["recommended_intent"])
            self.assertIn("打开另一个已有工作区", existing_summary["warnings"][0])
            self.assertFalse(ordinary_summary["can_continue"])
            self.assertIn("空目录", ordinary_summary["warnings"][0])

    def test_failed_fresh_bootstrap_keeps_selection_and_can_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-original"
            target = root / "new-workspace"
            state = root / "state"
            target.mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)
            before = storage.settings_file.read_bytes()

            recovery.stage(target, intent="create_new")
            with mock.patch(
                "infinite_canvas.bootstrap.bootstrap_fresh_workspace_sqlite",
                side_effect=RuntimeError("injected bootstrap failure"),
            ):
                with self.assertRaises(WorkspaceStorageError):
                    recovery.prepare_restart()

            self.assertEqual(before, storage.settings_file.read_bytes())
            self.assertFalse((target / "data" / "storage-authority.json").exists())
            self.assertTrue((state / "workspace-recovery-create.json").is_file())

            resumed = recovery.inspect(target, intent="create_new")
            self.assertTrue(resumed["can_continue"])
            self.assertEqual("creation_pending", resumed["type"])
            recovery.stage(target, intent="create_new")
            recovery.prepare_restart()

            self.assertEqual(
                target.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            self.assertFalse((state / "workspace-recovery-create.json").exists())
            recovery.release()

    def test_restart_failure_restores_create_operation_for_same_intent_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-original"
            target = root / "new-workspace"
            state = root / "state"
            target.mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)

            async def initialize():
                raise WorkspaceStorageError("原工作区目录暂时不可用")

            def fail_restart():
                raise RuntimeError("launcher unavailable")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=state,
                version="test",
                restart_signal=fail_restart,
            )
            runtime.install_restart_preparer(recovery.prepare_restart)
            asyncio.run(runtime.start())
            recovery.stage(target, intent="create_new")

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(RuntimeStage.RECOVERY_REQUIRED, status.stage)
            self.assertEqual(
                missing.resolve(),
                Path(storage.configured_parent_hint()).resolve(),
            )
            self.assertTrue((state / "workspace-recovery-create.json").is_file())
            resumed = recovery.inspect(target, intent="create_new")
            self.assertTrue(resumed["can_continue"])
            self.assertEqual("creation_ready", resumed["type"])

    def test_resume_rejects_unknown_files_added_to_partial_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            missing = root / "missing-original"
            target = root / "new-workspace"
            state = root / "state"
            target.mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)

            recovery.stage(target, intent="create_new")
            with mock.patch(
                "infinite_canvas.bootstrap.bootstrap_fresh_workspace_sqlite",
                side_effect=RuntimeError("injected bootstrap failure"),
            ):
                with self.assertRaises(WorkspaceStorageError):
                    recovery.prepare_restart()
            (target / "notes.txt").write_text("user file", encoding="utf-8")

            resumed = recovery.inspect(target, intent="create_new")

            self.assertFalse(resumed["can_continue"])
            self.assertIn("未知内容", resumed["warnings"][0])
            self.assertEqual("", resumed["recommended_intent"])
            with self.assertRaises(WorkspaceStorageError):
                recovery.stage(target, intent="create_new")


if __name__ == "__main__":
    unittest.main()
