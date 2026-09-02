import asyncio
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from infinite_canvas.app import create_app
from infinite_canvas.bootstrap import ExistingWorkspaceRecovery
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.controlled_storage_migration import ControlledStorageMigration
from infinite_canvas.runtime import ApplicationRuntime, RuntimeStartup
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.workspace import Workspace, WorkspaceService
from infinite_canvas.workspace_storage_composition import compose_workspace_storage
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


class ApplicationHttpTests(unittest.TestCase):
    def test_startup_shell_is_visible_and_business_routes_are_gated(self):
        legacy_app = FastAPI()

        @legacy_app.get("/api/canvases")
        async def canvases():
            return {"canvases": ["must-not-run"]}

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            app = create_app(runtime)
            client = TestClient(app)

            page = client.get("/")
            status = client.get("/api/runtime/status")
            gated = client.get("/api/canvases")

            self.assertEqual(page.status_code, 200)
            self.assertIn("Reroll 正在启动", page.text)
            self.assertIn('src="/static/images/brand/logo.png"', page.text)
            self.assertIn('/static/css/design-tokens.css', page.text)
            self.assertIn('/static/css/runtime-recovery.css', page.text)
            self.assertIn('<ic-card class="runtime-card"', page.text)
            self.assertIn(
                'data-i18n-label="runtime.startingTitle"',
                page.text,
            )
            self.assertIn('/static/js/infinite-canvas-ui/core.js', page.text)
            self.assertNotIn("<style>", page.text)
            self.assertEqual(status.json()["stage"], "starting")
            self.assertEqual(gated.status_code, 503)
            self.assertEqual(
                gated.json(),
                {
                    "detail": "Reroll 暂时不可用，请等待启动完成。",
                    "runtime_stage": "starting",
                },
            )

    def test_ready_runtime_preserves_existing_business_http_contracts(self):
        legacy_app = FastAPI()

        @legacy_app.get("/api/canvases")
        async def canvases():
            return {"canvases": [{"id": "smart-canvas-1"}]}

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            app = create_app(runtime)
            asyncio.run(runtime.start())

            response = TestClient(app).get("/api/canvases")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                {"canvases": [{"id": "smart-canvas-1"}]},
            )

    def test_setup_required_runtime_allows_workspace_selection_chain(self):
        legacy_app = FastAPI()
        selected_directory = "/tmp/infinite-canvas-empty/workspace"

        @legacy_app.post("/api/setup/select-directory")
        async def select_directory():
            return {"workspace_directory": selected_directory}

        @legacy_app.post("/api/setup/inspect-workspace")
        async def inspect_workspace():
            return {
                "workspace_directory": selected_directory,
                "next_step": "login",
            }

        @legacy_app.post("/api/setup/open-workspace")
        async def open_workspace():
            return {
                "workspace_directory": selected_directory,
                "next_step": "login",
            }

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(
                    application=legacy_app,
                    setup_required=True,
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            app = create_app(runtime)
            asyncio.run(runtime.start())
            client = TestClient(app)

            selected = client.post("/api/setup/select-directory")
            inspected = client.post(
                "/api/setup/inspect-workspace",
                json={"workspace_directory": selected_directory},
            )
            opened = client.post(
                "/api/setup/open-workspace",
                json={"workspace_directory": selected_directory},
            )

            self.assertEqual(200, selected.status_code)
            self.assertEqual(200, inspected.status_code)
            self.assertEqual(200, opened.status_code)
            self.assertEqual("login", inspected.json()["next_step"])
            self.assertEqual("login", opened.json()["next_step"])

    def test_ready_startup_entry_redirects_to_business_root(self):
        legacy_app = FastAPI()

        @legacy_app.get("/")
        async def business_root():
            return {"ready": True}

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            app = create_app(runtime)
            asyncio.run(runtime.start())

            response = TestClient(app).get(
                "/startup",
                follow_redirects=False,
            )

            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/")

    def test_ready_recovery_entry_redirects_to_business_root(self):
        legacy_app = FastAPI()

        @legacy_app.get("/")
        async def business_root():
            return {"ready": True}

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            app = create_app(runtime)
            asyncio.run(runtime.start())

            response = TestClient(app).get(
                "/recovery",
                follow_redirects=False,
            )

            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/")

    def test_recovery_reconnects_existing_workspace_and_requests_restart(self):
        events = []

        class Recovery:
            def inspect(self, parent_dir, *, intent):
                events.append(("inspect", intent, parent_dir))
                return {
                    "workspace_directory": parent_dir,
                    "can_continue": True,
                    "warnings": [],
                }

            def stage(self, parent_dir, *, intent):
                events.append(("stage", intent, parent_dir))
                return {"workspace_directory": parent_dir}

            def prepare_restart(self):
                events.append(("prepare", "", ""))

            def select_directory(self):
                return ""

        with tempfile.TemporaryDirectory() as temporary:
            parent = str(Path(temporary) / "synced-workspace")

            async def initialize():
                raise WorkspaceStorageError("当前工作区目录不存在")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: events.append(("restart", "")),
            )
            asyncio.run(runtime.start())
            app = create_app(runtime, workspace_recovery=Recovery())
            client = TestClient(app)

            page = client.get("/recovery")
            inspected = client.post(
                "/api/runtime/recovery/inspect",
                json={
                    "workspace_directory": parent,
                    "intent": "reconnect",
                },
            )
            create_inspected = client.post(
                "/api/runtime/recovery/inspect",
                json={
                    "workspace_directory": parent,
                    "intent": "create_new",
                },
            )
            response = client.post(
                "/api/runtime/recovery",
                json={
                    "workspace_directory": parent,
                    "intent": "reconnect",
                },
            )

            self.assertIn(
                "workspace_source_repository_overlap",
                page.text,
            )
            self.assertIn(
                "runtime.workspaceSourceRepositoryOverlap",
                page.text,
            )

            self.assertIn("重新连接工作区", page.text)
            self.assertIn("重试当前工作区", page.text)
            self.assertIn("打开另一个已有工作区", page.text)
            self.assertIn("创建新的工作区", page.text)
            self.assertIn("不会删除或修改原工作区", page.text)
            self.assertIn("创建并安全重启", page.text)
            self.assertIn("/api/runtime/recovery/inspect", page.text)
            self.assertIn("/api/runtime/recovery/retry", page.text)
            self.assertIn("/api/runtime/status", page.text)
            self.assertIn("location.replace('/')", page.text)
            self.assertIn("工作区目录", page.text)
            self.assertIn('<ic-form-field label="工作区目录">', page.text)
            self.assertIn('<ic-input id="workspace-directory"', page.text)
            self.assertIn('<ic-alert id="recovery-message"', page.text)
            self.assertIn('hierarchy="secondary"', page.text)
            self.assertIn('hierarchy="primary"', page.text)
            self.assertNotIn("<style>", page.text)
            self.assertNotIn("Workspace Data", page.text)
            self.assertNotIn("data 和 assets", page.text)
            self.assertNotIn("父目录", page.text)
            self.assertEqual(200, inspected.status_code)
            self.assertTrue(inspected.json()["can_continue"])
            self.assertEqual(200, create_inspected.status_code)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["stage"], "stopping")
            self.assertEqual(
                events,
                [
                    ("inspect", "reconnect", parent),
                    ("inspect", "create_new", parent),
                    ("stage", "reconnect", parent),
                    ("prepare", "", ""),
                    ("restart", ""),
                ],
            )

    def test_recovery_http_creates_verified_sqlite_workspace_before_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            missing = root / "missing-original"
            target = root / "new-workspace"
            target.mkdir()
            storage = WorkspaceStorage(root / "project", state_dir=state)
            storage.remember_parent(missing)
            recovery = ExistingWorkspaceRecovery(storage)
            restarts = []

            async def initialize():
                raise WorkspaceStorageError("当前工作区目录不存在")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=state,
                version="test",
                restart_signal=lambda: restarts.append(True),
            )
            runtime.install_restart_preparer(recovery.prepare_restart)
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(runtime, workspace_recovery=recovery)
            )

            inspected = client.post(
                "/api/runtime/recovery/inspect",
                json={
                    "workspace_directory": str(target),
                    "intent": "create_new",
                },
            )
            created = client.post(
                "/api/runtime/recovery",
                json={
                    "workspace_directory": str(target),
                    "intent": "create_new",
                },
            )

            workspace_service = WorkspaceService(storage)
            workspace = workspace_service.current()
            workspace_id = workspace_service.identity(target)
            content = WorkspaceContent(workspace)
            authority = resolve_storage_authority(
                content.storage_authority,
                workspace_id,
                supported_modes=("sqlite",),
            )
            self.assertEqual(200, inspected.status_code)
            self.assertTrue(inspected.json()["can_continue"])
            self.assertEqual(200, created.status_code)
            self.assertEqual("stopping", created.json()["stage"])
            self.assertEqual([True], restarts)
            self.assertEqual(target.resolve(), workspace.directory)
            self.assertEqual("sqlite", authority.mode)
            self.assertTrue(
                compose_workspace_storage(
                    content,
                    workspace_id=workspace_id,
                ).sqlite_ready
            )
            self.assertFalse((target / "data" / "auth.db").exists())
            recovery.release()

    def test_failed_recovery_stays_on_recovery_page_with_original_location(self):
        class Recovery:
            def inspect_current(self):
                return {
                    "workspace_directory": "/missing/original",
                    "can_continue": False,
                    "warnings": ["原工作区目录仍不可用"],
                }

            def stage_retry(self):
                raise WorkspaceStorageError(
                    "原工作区目录仍不可用，请检查后重试"
                )

            def prepare_restart(self):
                raise AssertionError("检查失败时不能请求重启")

            def select_directory(self):
                return ""

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                raise WorkspaceStorageError("当前工作区目录不存在")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(runtime, workspace_recovery=Recovery())
            )

            inspected = client.post("/api/runtime/recovery/inspect-current")
            retried = client.post("/api/runtime/recovery/retry")

            self.assertEqual(200, inspected.status_code)
            self.assertFalse(inspected.json()["can_continue"])
            self.assertEqual(400, retried.status_code)
            self.assertEqual(
                "recovery_required",
                client.get("/api/runtime/status").json()["stage"],
            )
            self.assertIn("原工作区目录", retried.json()["detail"])

    def test_ready_runtime_restart_requires_an_authenticated_admin(self):
        legacy_app = FastAPI()
        restarts = []

        class Authorization:
            def role_for_session(self, token):
                return {
                    "designer-session": "designer",
                    "admin-session": "admin",
                }.get(token, "")

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: restarts.append(True),
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                )
            )

            anonymous = client.post("/api/runtime/restart")
            client.cookies.set("ic_session", "designer-session")
            designer = client.post("/api/runtime/restart")
            client.cookies.set("ic_session", "admin-session")
            admin = client.post("/api/runtime/restart")

            self.assertEqual(anonymous.status_code, 401)
            self.assertEqual(designer.status_code, 403)
            self.assertEqual(admin.status_code, 200)
            self.assertEqual(admin.json()["stage"], "stopping")
            self.assertEqual(restarts, [True])

    def test_storage_migration_rejects_active_generation_runs_with_next_step(self):
        legacy_app = FastAPI()
        migration_calls = []

        class ActiveGenerationRuns:
            def active_count(self):
                return 2

            def cancel_active(self):
                raise AssertionError("存储迁移不能取消正在生成的任务")

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        class StorageMigration:
            def migrate(self, migration_id):
                migration_calls.append(migration_id)

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                generation_runs=ActiveGenerationRuns(),
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=StorageMigration(),
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/storage-migration",
                json={
                    "migration_id": "migration-active-runs",
                    "approved": True,
                },
            )

            self.assertEqual(409, response.status_code)
            self.assertEqual(
                {
                    "detail": "仍有 2 个生成任务正在执行，请等待任务结束或手动取消后重试。",
                    "reason": "active_generation_runs",
                    "blocking_generation_runs": 2,
                    "next_step": "finish_or_cancel_generation_runs",
                },
                response.json(),
            )
            self.assertEqual([], migration_calls)
            self.assertEqual("ready", runtime.status().stage.value)

    def test_storage_migration_requires_explicit_admin_approval(self):
        legacy_app = FastAPI()
        migration_calls = []

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        class StorageMigration:
            def migrate(self, migration_id):
                migration_calls.append(migration_id)

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=StorageMigration(),
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/storage-migration",
                json={"migration_id": "migration-needs-approval"},
            )

            self.assertEqual(409, response.status_code)
            self.assertEqual("explicit_approval_required", response.json()["reason"])
            self.assertEqual("approve_storage_migration", response.json()["next_step"])
            self.assertEqual([], migration_calls)
            self.assertEqual("ready", runtime.status().stage.value)

    def test_storage_migration_freezes_new_writes_and_drains_inflight_write_before_preparation(self):
        legacy_app = FastAPI()
        write_started = threading.Event()
        release_write = threading.Event()
        migration_started = threading.Event()

        @legacy_app.post("/api/canvases")
        async def save_canvas():
            write_started.set()
            await asyncio.to_thread(release_write.wait, 2)
            return {"saved": True}

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        class StorageMigration:
            def migrate(self, migration_id):
                self.migration_id = migration_id
                migration_started.set()
                return {"migration_id": migration_id}

        migration = StorageMigration()
        restarts = []
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: restarts.append(True),
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=migration,
                )
            )
            client.cookies.set("ic_session", "admin-session")

            writer = threading.Thread(
                target=lambda: client.post("/api/canvases"),
                daemon=True,
            )
            writer.start()
            self.assertTrue(write_started.wait(2))
            migration_response = {}
            migrator = threading.Thread(
                target=lambda: migration_response.setdefault(
                    "value",
                    client.post(
                        "/api/runtime/storage-migration",
                        json={
                            "migration_id": "migration-drain-write",
                            "approved": True,
                        },
                    ),
                ),
                daemon=True,
            )
            migrator.start()
            try:
                self.assertFalse(migration_started.wait(0.1))
                blocked = client.post("/api/canvases")
                self.assertEqual(503, blocked.status_code)
                self.assertEqual("maintenance", blocked.json()["runtime_stage"])
            finally:
                release_write.set()
                writer.join(timeout=2)
                migrator.join(timeout=2)

            response = migration_response["value"]
            self.assertEqual(200, response.status_code)
            self.assertEqual("stopping", response.json()["stage"])
            self.assertEqual("migration-drain-write", migration.migration_id)
            self.assertEqual([True], restarts)

    def test_storage_migration_rechecks_runs_after_inflight_generation_start_drains(self):
        legacy_app = FastAPI()
        generation_request_started = threading.Event()
        release_generation_request = threading.Event()
        active_runs = {"count": 0}
        migration_calls = []

        @legacy_app.post("/api/start-generation")
        async def start_generation():
            generation_request_started.set()
            await asyncio.to_thread(release_generation_request.wait, 2)
            active_runs["count"] = 1
            return {"started": True}

        class GenerationRuns:
            def active_count(self):
                return active_runs["count"]

            def cancel_active(self):
                raise AssertionError("迁移入口不能自动取消刚开始的 Run")

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        class StorageMigration:
            def migrate(self, migration_id):
                migration_calls.append(migration_id)

        restarts = []
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                generation_runs=GenerationRuns(),
                restart_signal=lambda: restarts.append(True),
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=StorageMigration(),
                )
            )
            client.cookies.set("ic_session", "admin-session")

            starter = threading.Thread(
                target=lambda: client.post("/api/start-generation"),
                daemon=True,
            )
            starter.start()
            self.assertTrue(generation_request_started.wait(2))
            migration_response = {}
            migrator = threading.Thread(
                target=lambda: migration_response.setdefault(
                    "value",
                    client.post(
                        "/api/runtime/storage-migration",
                        json={
                            "migration_id": "migration-late-active-run",
                            "approved": True,
                        },
                    ),
                ),
                daemon=True,
            )
            migrator.start()
            try:
                deadline = time.monotonic() + 2
                while (
                    runtime.status().stage.value != "maintenance"
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.01)
                self.assertEqual("maintenance", runtime.status().stage.value)
            finally:
                release_generation_request.set()
                starter.join(timeout=2)
                migrator.join(timeout=2)

            response = migration_response["value"]
            self.assertEqual(409, response.status_code)
            self.assertEqual("active_generation_runs", response.json()["reason"])
            self.assertEqual(1, response.json()["blocking_generation_runs"])
            self.assertEqual([], migration_calls)
            self.assertEqual([], restarts)
            self.assertEqual("ready", runtime.status().stage.value)

    def test_public_storage_migration_prepares_backup_publishes_both_databases_and_reopens_them(self):
        legacy_app = FastAPI()
        restarts = []

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            data = root / "data"
            assets = root / "assets"
            canvases = data / "canvases"
            canvases.mkdir(parents=True)
            assets.mkdir(parents=True)
            legacy_canvas = canvases / "canvas-1.json"
            legacy_canvas.write_text(
                json.dumps(
                    {
                        "id": "canvas-1",
                        "kind": "smart",
                        "title": "受控迁移画布",
                        "owner_id": "designer-1",
                        "owner_username": "designer",
                        "visibility": "shared",
                        "revision": 4,
                        "nodes": [],
                        "connections": [],
                    }
                ),
                encoding="utf-8",
            )
            content = WorkspaceContent(
                Workspace(
                    directory=root,
                    _records_directory=data,
                    _media_directory=assets,
                )
            )
            migration = ControlledStorageMigration(
                content_provider=lambda: content,
                workspace_id_provider=lambda: "workspace-1",
            )

            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: restarts.append(True),
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=migration,
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/storage-migration",
                json={
                    "migration_id": "migration-public-cutover",
                    "approved": True,
                },
            )

            self.assertEqual(200, response.status_code)
            self.assertEqual("stopping", response.json()["stage"])
            self.assertEqual([True], restarts)
            self.assertTrue(legacy_canvas.is_file())
            self.assertTrue(content.canvas_content.is_file())
            self.assertTrue(content.generation_run_store.is_file())
            self.assertTrue(content.storage_authority.is_file())
            recovery = (
                data
                / "recovery"
                / "migration-public-cutover"
                / "recovery-manifest.json"
            )
            self.assertTrue(recovery.is_file())
            self.assertTrue(
                (
                    recovery.parent
                    / "source"
                    / "data"
                    / "canvases"
                    / "canvas-1.json"
                ).is_file()
            )
            reopened = compose_workspace_storage(
                content,
                workspace_id="workspace-1",
            )
            self.assertEqual("sqlite", reopened.mode)
            self.assertTrue(reopened.sqlite_ready)

    def test_storage_migration_preparation_failure_returns_actionable_conflict_and_keeps_json(self):
        legacy_app = FastAPI()

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            data = root / "data"
            assets = root / "assets"
            (data / "canvases").mkdir(parents=True)
            assets.mkdir(parents=True)
            content = WorkspaceContent(
                Workspace(
                    directory=root,
                    _records_directory=data,
                    _media_directory=assets,
                )
            )
            migration = ControlledStorageMigration(
                content_provider=lambda: content,
                workspace_id_provider=lambda: "workspace-1",
            )

            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=migration,
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/storage-migration",
                json={"migration_id": "..", "approved": True},
            )

            self.assertEqual(409, response.status_code)
            self.assertEqual("migration_preparation_failed", response.json()["reason"])
            self.assertEqual("review_migration_report_and_retry", response.json()["next_step"])
            self.assertIn("migration ID 无效", response.json()["detail"])
            self.assertEqual("ready", runtime.status().stage.value)
            self.assertFalse(content.storage_authority.exists())
            self.assertFalse(content.canvas_content.exists())
            self.assertFalse(content.generation_run_store.exists())

    def test_storage_migration_restart_failure_rolls_back_authority_and_keeps_recovery_evidence(self):
        legacy_app = FastAPI()

        class Authorization:
            def role_for_session(self, token):
                return "admin" if token == "admin-session" else ""

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            data = root / "data"
            assets = root / "assets"
            canvases = data / "canvases"
            canvases.mkdir(parents=True)
            assets.mkdir(parents=True)
            legacy_canvas = canvases / "canvas-1.json"
            legacy_canvas.write_text(
                json.dumps(
                    {
                        "id": "canvas-1",
                        "kind": "smart",
                        "title": "重启失败回退画布",
                        "owner_id": "designer-1",
                        "owner_username": "designer",
                        "visibility": "shared",
                        "nodes": [],
                        "connections": [],
                    }
                ),
                encoding="utf-8",
            )
            content = WorkspaceContent(
                Workspace(
                    directory=root,
                    _records_directory=data,
                    _media_directory=assets,
                )
            )
            migration = ControlledStorageMigration(
                content_provider=lambda: content,
                workspace_id_provider=lambda: "workspace-1",
            )

            async def initialize():
                return RuntimeStartup(application=legacy_app)

            def fail_restart():
                raise OSError("simulated restart signal failure")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=fail_restart,
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                    storage_migration=migration,
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/storage-migration",
                json={
                    "migration_id": "migration-restart-rollback",
                    "approved": True,
                },
            )

            self.assertEqual(409, response.status_code)
            self.assertEqual("migration_restart_failed", response.json()["reason"])
            self.assertEqual("ready", runtime.status().stage.value)
            self.assertTrue(legacy_canvas.is_file())
            self.assertFalse(content.storage_authority.exists())
            self.assertFalse(content.canvas_content.exists())
            self.assertFalse(content.generation_run_store.exists())
            self.assertTrue(
                (
                    data
                    / "recovery"
                    / "migration-restart-rollback"
                    / "recovery-manifest.json"
                ).is_file()
            )
            self.assertEqual(
                "json",
                compose_workspace_storage(
                    content,
                    workspace_id="workspace-1",
                ).mode,
            )

    def test_maintenance_rejects_business_http_and_websocket_writes(self):
        legacy_app = FastAPI()

        @legacy_app.post("/api/canvases")
        async def save_canvas():
            return {"saved": True}

        @legacy_app.websocket("/ws/canvas")
        async def canvas_socket(websocket):
            await websocket.accept()
            await websocket.receive_text()

        class Authorization:
            def role_for_session(self, _token):
                return "admin"

        with tempfile.TemporaryDirectory() as temporary:
            entered_maintenance = threading.Event()
            release_restart = threading.Event()

            async def initialize():
                return RuntimeStartup(application=legacy_app)

            async def hold_preparation():
                entered_maintenance.set()
                await asyncio.to_thread(release_restart.wait, 2)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            runtime.install_workspace_move_status_provider(
                lambda: {
                    "stage": "copying",
                    "message": "正在把工作区复制到新位置…",
                    "finished": False,
                }
            )
            runtime.install_restart_preparer(hold_preparation)
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                )
            )

            worker = threading.Thread(
                target=lambda: asyncio.run(runtime.request_restart()),
                daemon=True,
            )
            worker.start()
            self.assertTrue(entered_maintenance.wait(2))
            try:
                response = client.post("/api/canvases")
                self.assertEqual(503, response.status_code)
                self.assertEqual(
                    "maintenance",
                    response.json()["runtime_stage"],
                )
                self.assertIn("工作区正在搬家", response.json()["detail"])
                with self.assertRaises(WebSocketDisconnect):
                    with client.websocket_connect("/ws/canvas"):
                        pass
            finally:
                release_restart.set()
                worker.join(timeout=2)

    def test_maintenance_waits_for_an_inflight_business_write_before_copy(self):
        legacy_app = FastAPI()
        write_started = threading.Event()
        release_write = threading.Event()
        preparation_started = threading.Event()

        @legacy_app.post("/api/canvases")
        async def save_canvas():
            write_started.set()
            await asyncio.to_thread(release_write.wait, 2)
            return {"saved": True}

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            def prepare_workspace():
                preparation_started.set()

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            runtime.install_restart_preparer(prepare_workspace)
            asyncio.run(runtime.start())
            client = TestClient(create_app(runtime))

            writer = threading.Thread(
                target=lambda: client.post("/api/canvases"),
                daemon=True,
            )
            writer.start()
            self.assertTrue(write_started.wait(2))
            restarter = threading.Thread(
                target=lambda: asyncio.run(runtime.request_restart()),
                daemon=True,
            )
            restarter.start()
            try:
                self.assertFalse(preparation_started.wait(0.1))
                blocked = client.post("/api/canvases")
                self.assertEqual(503, blocked.status_code)
            finally:
                release_write.set()
                writer.join(timeout=2)
                restarter.join(timeout=2)
            self.assertTrue(preparation_started.is_set())

    def test_workspace_open_can_request_restart_without_waiting_for_itself(self):
        legacy_app = FastAPI()
        runtime_holder = {}
        restarts = []

        @legacy_app.post("/api/workspace-storage-settings/open")
        async def open_workspace():
            status = await runtime_holder["runtime"].request_restart()
            if status.stage.value != "stopping":
                raise HTTPException(
                    status_code=409,
                    detail=status.message,
                )
            return status.public()

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: restarts.append(True),
            )
            runtime_holder["runtime"] = runtime
            asyncio.run(runtime.start())
            client = TestClient(create_app(runtime))

            response = client.post("/api/workspace-storage-settings/open")

            self.assertEqual(200, response.status_code)
            self.assertEqual("stopping", response.json()["stage"])
            self.assertEqual([True], restarts)

    def test_workspace_move_progress_page_stays_available_during_maintenance(self):
        legacy_app = FastAPI()

        class Authorization:
            def role_for_session(self, _token):
                return "admin"

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            runtime.install_workspace_move_status_provider(
                lambda: {
                    "operation_id": "move-123",
                    "stage": "waiting_for_generation_tasks",
                    "message": "正在等待 2 个生成任务完成…",
                    "blocking_generation_tasks": 2,
                    "file_count": 4,
                    "total_bytes": 20,
                    "copied_files": 0,
                    "copied_bytes": 0,
                    "finished": False,
                    "return_url": "/?page=smart-canvas#canvas-1",
                }
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    runtime_authorization=Authorization(),
                )
            )
            public_shell = client.get(
                "/workspace-move?operation_id=move-123"
            )
            protected_status = client.get(
                "/api/workspace-move/status?operation_id=move-123"
            )
            client.cookies.set("ic_session", "admin-session")

            page = client.get(
                "/workspace-move?operation_id=move-123"
            )
            status = client.get(
                "/api/workspace-move/status?operation_id=move-123"
            )
            with client.websocket_connect(
                "/ws/workspace-move?operation_id=move-123"
            ) as socket:
                reconnected = socket.receive_json()

            self.assertEqual(200, page.status_code)
            self.assertEqual(200, public_shell.status_code)
            self.assertEqual(401, protected_status.status_code)
            self.assertIn("工作区搬家进度", page.text)
            self.assertIn("取消活动生成任务并开始搬家", page.text)
            self.assertNotIn("取消搬家", page.text)
            self.assertIn("/static/css/design-tokens.css", page.text)
            self.assertIn("/static/css/workspace-move.css", page.text)
            self.assertIn("/static/js/infinite-canvas-ui/core.js", page.text)
            self.assertIn("/static/js/workspace-move.js", page.text)
            self.assertIn('<ic-progress id="move-progress"', page.text)
            self.assertIn('<ic-card class="workspace-move-card"', page.text)
            self.assertNotIn("<progress", page.text)
            self.assertNotIn("background:#111827", page.text)
            self.assertEqual(200, status.status_code)
            self.assertEqual(
                "waiting_for_generation_tasks",
                status.json()["stage"],
            )
            self.assertEqual("move-123", reconnected["operation_id"])
            self.assertEqual(
                "/?page=smart-canvas#canvas-1",
                reconnected["return_url"],
            )

    def test_workspace_recovery_write_is_rejected_outside_recovery_stage(self):
        legacy_app = FastAPI()
        reconnects = []

        class Recovery:
            def reconnect_parent(self, parent_dir):
                reconnects.append(parent_dir)
                return {}

            def select_directory(self):
                return "/tmp/workspace"

        class Authorization:
            def role_for_session(self, _token):
                return "admin"

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=legacy_app)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(
                create_app(
                    runtime,
                    workspace_recovery=Recovery(),
                    runtime_authorization=Authorization(),
                )
            )
            client.cookies.set("ic_session", "admin-session")

            response = client.post(
                "/api/runtime/recovery",
                json={"parent_dir": "/tmp/workspace"},
            )

            self.assertEqual(response.status_code, 409)
            self.assertEqual(reconnects, [])

    def test_failed_startup_page_is_plain_chinese_with_copy_control(self):
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                raise RuntimeError("sqlite traceback-like technical detail")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(create_app(runtime))

            page = client.get("/")
            diagnostic = client.get(
                f"/api/runtime/diagnostics/{runtime.status().error_id}"
            )

            self.assertIn("Reroll 启动失败", page.text)
            self.assertIn("复制错误信息", page.text)
            self.assertNotIn("traceback-like technical detail", page.text)
            self.assertIn("traceback-like technical detail", diagnostic.text)

    def test_copyable_diagnostic_redacts_json_smart_canvas_payload(self):
        private_content = "PRIVATE_SMART_CANVAS_NODE_PROMPT"

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                raise RuntimeError(
                    'provider failed payload={"canvas":'
                    f'{{"nodes":[{{"prompt":"{private_content}"}}]}}'
                    "}"
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())
            client = TestClient(create_app(runtime))

            diagnostic = client.get(
                f"/api/runtime/diagnostics/{runtime.status().error_id}"
            )

            self.assertEqual(diagnostic.status_code, 200)
            self.assertIn("Smart Canvas 内容已隐藏", diagnostic.text)
            self.assertNotIn(private_content, diagnostic.text)


if __name__ == "__main__":
    unittest.main()
