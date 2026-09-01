import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.auth_system import AuthSystem
from infinite_canvas.device_state import DeviceState
from infinite_canvas.instance_state import InstanceState
from infinite_canvas.workspace import (
    WorkspaceLocationCapability,
    WorkspaceService,
)
from infinite_canvas.workspace_storage import WorkspaceStorage


class WorkspaceServiceTests(unittest.TestCase):
    def setUp(self):
        self._environment = patch.dict(
            os.environ,
            {
                "INFINITE_CANVAS_DATA_DIR": "",
                "INFINITE_CANVAS_ASSETS_DIR": "",
            },
        )
        self._environment.start()

    def tearDown(self):
        self._environment.stop()

    @staticmethod
    def _tree_state(directory: Path):
        return [
            (
                str(path.relative_to(directory)),
                path.is_dir(),
                path.stat().st_size,
                path.stat().st_mtime_ns,
            )
            for path in sorted(directory.rglob("*"))
        ]

    def test_current_workspace_exposes_business_locations_from_one_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_directory = root / "team-workspace"
            (workspace_directory / "data").mkdir(parents=True)
            (workspace_directory / "assets").mkdir()
            storage = WorkspaceStorage(root, state_dir=root / "device-state")
            storage.save_parent(workspace_directory)

            workspace = WorkspaceService(storage).current()

            self.assertEqual(workspace_directory.resolve(), workspace.directory)
            self.assertEqual(
                (workspace_directory / "data" / "canvases").resolve(),
                workspace.smart_canvases,
            )
            self.assertEqual(
                (workspace_directory / "assets").resolve(),
                workspace.managed_media,
            )
            self.assertEqual(
                (workspace_directory / "data" / "generation-history.json").resolve(),
                workspace.generation_history,
            )
            self.assertEqual(
                {"workspace_directory": str(workspace_directory.resolve())},
                workspace.public(),
            )

    def test_summary_warns_about_unavailable_legacy_external_references(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_directory = root / "workspace"
            canvases = workspace_directory / "data" / "canvases"
            canvases.mkdir(parents=True)
            (workspace_directory / "assets").mkdir()
            canvas = canvases / "legacy.json"
            canvas.write_text(
                json.dumps(
                    {
                        "nodes": [
                            {
                                "image": (
                                    "/missing/old-computer/reference.png"
                                ),
                                "video": (
                                    r"C:\Users\old\missing-video.mp4"
                                ),
                                "managed": "/assets/input/imported/abc.png",
                                "remote": "https://example.com/image.png",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            original = canvas.read_bytes()
            auth = AuthSystem(workspace_directory / "data" / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "state")
            )

            summary = service.summarize(workspace_directory, intent="open")

            self.assertTrue(summary.can_continue)
            self.assertEqual(2, summary.unavailable_external_reference_count)
            self.assertIn("2 个旧媒体引用", summary.warnings[-1])
            self.assertEqual(original, canvas.read_bytes())

    def test_selected_workspace_directory_is_the_only_storage_entry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_directory = root / "workspace"
            workspace_directory.mkdir()
            state_directory = root / "device-state"
            storage = WorkspaceStorage(root, state_dir=state_directory)
            storage.save_parent(workspace_directory)

            workspace = WorkspaceService(storage).current()
            paths = storage.paths()

            self.assertEqual(workspace_directory.resolve(), workspace.directory)
            self.assertFalse(hasattr(workspace, "accounts"))
            self.assertEqual(paths.data_dir, workspace.smart_canvases.parent)
            self.assertEqual(paths.assets_dir, workspace.managed_media)

    def test_accounts_and_provider_credentials_stay_outside_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_directory = root / "workspace"
            (workspace_directory / "data").mkdir(parents=True)
            (workspace_directory / "assets").mkdir()
            device_state_directory = root / "device-state"
            storage = WorkspaceStorage(
                root,
                state_dir=device_state_directory,
            )
            storage.save_parent(workspace_directory)

            workspace = WorkspaceService(storage).current()
            device_state = DeviceState(device_state_directory)
            instance_state = InstanceState(device_state_directory)

            self.assertFalse(hasattr(workspace, "accounts"))
            self.assertFalse(
                instance_state.auth_database.is_relative_to(workspace.directory)
            )
            self.assertFalse(
                device_state.provider_credentials.is_relative_to(
                    workspace.directory
                )
            )
            self.assertFalse(
                device_state.provider_connections.is_relative_to(
                    workspace.directory
                )
            )
            self.assertEqual(
                (device_state_directory / "instance-state" / "auth.db").resolve(),
                instance_state.auth_database,
            )
            self.assertEqual(
                (device_state_directory / "api.env").resolve(),
                device_state.provider_credentials,
            )
            self.assertEqual(
                (
                    device_state_directory / "server-identity.json"
                ).resolve(),
                device_state.server_identity_file,
            )

    def test_inspection_is_read_only_and_classifies_empty_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "empty-workspace"
            candidate.mkdir()
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )
            before = self._tree_state(root)

            inspection = service.inspect(candidate)

            self.assertEqual("empty", inspection.status)
            self.assertEqual("create_workspace", inspection.next_step)
            self.assertEqual(candidate.resolve(), inspection.directory)
            self.assertEqual(before, self._tree_state(root))
            self.assertFalse((root / "device-state").exists())

    def test_inspection_routes_existing_workspace_to_content_open(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "existing-workspace"
            records = candidate / "data"
            (candidate / "assets").mkdir(parents=True)
            auth = AuthSystem(records / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )
            before = self._tree_state(candidate)

            inspection = service.inspect(candidate)

            self.assertEqual("existing", inspection.status)
            self.assertEqual("open", inspection.next_step)
            self.assertEqual(before, self._tree_state(candidate))
            serialized = json.dumps(inspection.public(), ensure_ascii=False)
            self.assertNotIn("data", serialized)
            self.assertNotIn("assets", serialized)

    def test_existing_workspace_summary_is_business_facing_and_read_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "existing-workspace"
            canvases = candidate / "data" / "canvases"
            media = candidate / "assets" / "imports"
            canvases.mkdir(parents=True)
            media.mkdir(parents=True)
            (canvases / "first.json").write_text("{}", encoding="utf-8")
            (canvases / "second.json").write_text("{}", encoding="utf-8")
            (media / "reference.png").write_bytes(b"image")
            auth = AuthSystem(candidate / "data" / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            auth.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )
            before = self._tree_state(candidate)

            summary = service.summarize(candidate, intent="open")

            self.assertEqual("existing", summary.kind)
            self.assertEqual("已有工作区", summary.kind_label)
            self.assertEqual(2, summary.smart_canvas_count)
            self.assertEqual(1, summary.managed_media_count)
            self.assertEqual(3, summary.file_count)
            self.assertGreater(summary.total_bytes, 0)
            self.assertTrue(summary.recent_modified_at)
            self.assertTrue(summary.can_continue)
            self.assertTrue(summary.warnings)
            self.assertEqual(before, self._tree_state(candidate))
            serialized = json.dumps(summary.public(), ensure_ascii=False)
            self.assertNotIn('"data"', serialized)
            self.assertNotIn('"assets"', serialized)
            self.assertNotIn("parent_dir", serialized)
            self.assertNotIn("member_count", serialized)

    def test_move_summary_directs_existing_workspace_to_open_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "existing-workspace"
            (candidate / "assets").mkdir(parents=True)
            auth = AuthSystem(candidate / "data" / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            summary = service.summarize(candidate, intent="move")

            self.assertFalse(summary.can_continue)
            self.assertIn("打开已有工作区", " ".join(summary.warnings))

    def test_move_plan_summarizes_source_target_tasks_and_portability_warnings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "empty-target"
            (source / "data").mkdir(parents=True)
            (source / "assets" / "imports").mkdir(parents=True)
            (source / "data" / "canvas.json").write_bytes(b"canvas")
            (source / "assets" / "imports" / "image.png").write_bytes(
                b"image-bytes"
            )
            (source / "data" / "media_previews").mkdir()
            (
                source / "data" / "media_previews" / "cache.webp"
            ).write_bytes(b"device-cache")
            target.mkdir()
            storage = WorkspaceStorage(
                root,
                state_dir=root / "device-state",
            )
            storage.save_parent(source)
            service = WorkspaceService(
                storage,
                storage_classifier=lambda _path: WorkspaceLocationCapability(
                    kind="external",
                    label="外接磁盘",
                    supported=True,
                    warnings=("搬家期间请保持外接磁盘连接。",),
                ),
                disk_usage=lambda _path: type(
                    "Usage",
                    (),
                    {"free": 10_000},
                )(),
            )
            before_source = self._tree_state(source)
            before_target = self._tree_state(target)

            plan = service.plan_move(
                target,
                active_generation_tasks=2,
            )

            self.assertEqual(source.resolve(), plan.source)
            self.assertEqual(target.resolve(), plan.target)
            self.assertEqual(2, plan.file_count)
            self.assertEqual(len(b"canvas") + len(b"image-bytes"), plan.total_bytes)
            self.assertEqual(2, plan.active_generation_tasks)
            self.assertEqual("外接磁盘", plan.storage_label)
            self.assertIn("保持外接磁盘连接", " ".join(plan.warnings))
            self.assertTrue(plan.can_continue)
            self.assertEqual(before_source, self._tree_state(source))
            self.assertEqual(before_target, self._tree_state(target))

    def test_move_plan_rejects_network_storage_without_bypass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            target = root / "network-target"
            (source / "data").mkdir(parents=True)
            (source / "assets").mkdir()
            (source / "data" / "canvas.json").write_bytes(b"content")
            target.mkdir()
            (target / "remote-note.txt").write_text(
                "must stay untouched",
                encoding="utf-8",
            )
            storage = WorkspaceStorage(
                root,
                state_dir=root / "device-state",
            )
            storage.save_parent(source)
            service = WorkspaceService(
                storage,
                storage_classifier=lambda _path: WorkspaceLocationCapability(
                    kind="network",
                    label="网络磁盘",
                    supported=False,
                ),
            )
            before = self._tree_state(root)

            with self.assertRaisesRegex(
                ValueError,
                "数据安全.*不支持 NAS 或局域网磁盘",
            ):
                service.plan_move(target)

            self.assertEqual(before, self._tree_state(root))

    def test_inspection_rejects_network_workspace_for_every_entry_flow(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "network-workspace"
            (candidate / "assets").mkdir(parents=True)
            auth = AuthSystem(candidate / "data" / "auth.db")
            auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state"),
                storage_classifier=lambda _path: WorkspaceLocationCapability(
                    kind="network",
                    label="NAS 或局域网磁盘",
                    supported=False,
                ),
            )

            inspection = service.inspect(candidate)
            opening = service.summarize(candidate, intent="open")

            self.assertEqual("unavailable", inspection.status)
            self.assertEqual(
                "workspace_storage_network_unsupported",
                inspection.message_code,
            )
            self.assertFalse(opening.can_continue)
            self.assertIn("不支持 NAS 或局域网磁盘", inspection.message)

    def test_move_plan_rejects_unsafe_or_insufficient_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "current-workspace"
            existing = root / "existing-workspace"
            ordinary = root / "ordinary-folder"
            too_small = root / "small-disk-target"
            unwritable = root / "unwritable-target"
            nested = source / "nested-target"
            (source / "data").mkdir(parents=True)
            (source / "assets").mkdir()
            (source / "data" / "large.bin").write_bytes(b"x" * 32)
            (existing / "assets").mkdir(parents=True)
            existing_auth = AuthSystem(existing / "data" / "auth.db")
            existing_auth.create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            ordinary.mkdir()
            (ordinary / "notes.txt").write_text("keep", encoding="utf-8")
            too_small.mkdir()
            unwritable.mkdir()
            nested.mkdir()
            storage = WorkspaceStorage(
                root,
                state_dir=root / "device-state",
            )
            storage.save_parent(source)
            local = WorkspaceLocationCapability(
                kind="local",
                label="本机磁盘",
                supported=True,
            )
            service = WorkspaceService(
                storage,
                storage_classifier=lambda _path: local,
                disk_usage=lambda _path: type(
                    "Usage",
                    (),
                    {"free": 1},
                )(),
            )

            with self.assertRaisesRegex(ValueError, "当前工作区目录"):
                service.plan_move(source)
            with self.assertRaisesRegex(ValueError, "互相包含"):
                service.plan_move(nested)
            with self.assertRaisesRegex(ValueError, "打开已有工作区"):
                service.plan_move(existing)
            with self.assertRaisesRegex(ValueError, "空目录"):
                service.plan_move(ordinary)
            with patch(
                "infinite_canvas.workspace.os.access",
                side_effect=lambda path, _mode: (
                    Path(path).resolve() != unwritable.resolve()
                ),
            ):
                with self.assertRaisesRegex(ValueError, "不可访问或不可写"):
                    service.plan_move(unwritable)
            with self.assertRaisesRegex(ValueError, "可用空间不足"):
                service.plan_move(too_small)

    def test_inspection_treats_accountless_workspace_as_existing_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "legacy-workspace"
            (candidate / "data" / "canvases").mkdir(parents=True)
            (candidate / "data" / "canvases" / "first.json").write_text(
                "{}",
                encoding="utf-8",
            )
            (candidate / "assets").mkdir()
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            inspection = service.inspect(candidate)

            self.assertEqual("existing", inspection.status)
            self.assertEqual("open", inspection.next_step)
            self.assertEqual("workspace_existing", inspection.message_code)
            self.assertIn("现有内容", inspection.message)

    def test_inspection_rejects_ordinary_non_empty_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "documents"
            candidate.mkdir()
            (candidate / "notes.txt").write_text("not a workspace", encoding="utf-8")
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            inspection = service.inspect(candidate)

            self.assertEqual("ordinary_non_empty", inspection.status)
            self.assertEqual("choose_another", inspection.next_step)
            self.assertEqual(
                "workspace_directory_non_empty",
                inspection.message_code,
            )
            self.assertIn("空目录", inspection.message)

    def test_inspection_rejects_incomplete_workspace_without_internal_terms(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "incomplete-workspace"
            (candidate / "data").mkdir(parents=True)
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            inspection = service.inspect(candidate)

            self.assertEqual("incomplete", inspection.status)
            self.assertEqual("choose_another", inspection.next_step)
            self.assertEqual(
                "workspace_directory_incomplete",
                inspection.message_code,
            )
            self.assertIn("不完整", inspection.message)
            self.assertNotIn("data", inspection.message)
            self.assertNotIn("assets", inspection.message)

    def test_inspection_rejects_unavailable_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "missing"
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            inspection = service.inspect(candidate)

            self.assertEqual("unavailable", inspection.status)
            self.assertEqual("choose_another", inspection.next_step)
            self.assertEqual(
                "workspace_directory_unavailable",
                inspection.message_code,
            )
            self.assertIn("不可访问", inspection.message)

    def test_prepare_initial_workspace_rechecks_selection_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ordinary = root / "documents"
            ordinary.mkdir()
            (ordinary / "notes.txt").write_text("keep me", encoding="utf-8")
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "device-state")
            )

            with self.assertRaisesRegex(ValueError, "空目录"):
                service.prepare_initial(ordinary)

            self.assertEqual(
                "keep me",
                (ordinary / "notes.txt").read_text(encoding="utf-8"),
            )
            self.assertFalse((root / "device-state").exists())


if __name__ == "__main__":
    unittest.main()
