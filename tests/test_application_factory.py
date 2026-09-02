import asyncio
import json
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from infinite_canvas.__main__ import _server_host, _server_port
from infinite_canvas.app import create_app
from infinite_canvas.bootstrap import LegacyInitializer
from infinite_canvas.content import WorkspaceContent
from infinite_canvas.generation_runs import GenerationRunControl
from infinite_canvas.runtime import (
    ApplicationRuntime,
    RuntimeStage,
)
from infinite_canvas.workspace_storage import WorkspaceStorageError
from infinite_canvas.workspace import Workspace


ROOT = Path(__file__).resolve().parents[1]


class ApplicationFactoryTests(unittest.TestCase):
    def test_runtime_server_host_uses_the_launcher_environment_contract(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(_server_host(), "0.0.0.0")
        with mock.patch.dict(
            "os.environ",
            {"INFINITE_CANVAS_HOST": "127.0.0.1"},
            clear=True,
        ):
            self.assertEqual(_server_host(), "127.0.0.1")

    def test_runtime_server_port_uses_the_launcher_environment_contract(self):
        with mock.patch.dict(
            "os.environ",
            {"INFINITE_CANVAS_PORT": "4321"},
            clear=True,
        ):
            self.assertEqual(_server_port(), 4321)

    def test_direct_runtime_ctrl_c_exits_without_a_traceback(self):
        from infinite_canvas import __main__ as application_main

        def interrupt(coroutine):
            coroutine.close()
            raise KeyboardInterrupt

        with mock.patch.object(
            application_main.asyncio,
            "run",
            side_effect=interrupt,
        ):
            self.assertEqual(application_main.main(), 130)

    def test_default_application_construction_is_side_effect_free(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "isolated-project"
            project.mkdir()
            script = textwrap.dedent(
                f"""
                import os
                from pathlib import Path

                project = Path({str(project)!r})
                os.environ["INFINITE_CANVAS_PROJECT_DIR"] = str(project)
                from infinite_canvas.bootstrap import create_default_application

                application, runtime, restart_signal = create_default_application()
                assert application is not None
                assert runtime.status().stage.value == "starting"
                assert not restart_signal.is_set()
                assert list(project.iterdir()) == []
                """
            )

            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(
                completed.returncode,
                0,
                msg=completed.stderr or completed.stdout,
            )

    def test_default_application_does_not_migrate_legacy_state_before_start(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "project"
            state = root / "state"
            legacy = project / "local-state"
            legacy.mkdir(parents=True)
            (project / "VERSION").write_text("test", encoding="utf-8")
            (legacy / "api.env").write_text(
                "TOKEN=legacy\n",
                encoding="utf-8",
            )

            with mock.patch.dict(
                "os.environ",
                {
                    "INFINITE_CANVAS_PROJECT_DIR": str(project),
                    "INFINITE_CANVAS_STATE_DIR": str(state),
                },
                clear=True,
            ):
                from infinite_canvas.bootstrap import create_default_application

                create_default_application()

            self.assertFalse(state.exists())

    def test_default_application_exposes_controlled_storage_migration_after_start(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "project"
            workspace = root / "workspace"
            data = workspace / "data"
            assets = workspace / "assets"
            canvases = data / "canvases"
            project.mkdir()
            canvases.mkdir(parents=True)
            assets.mkdir(parents=True)
            (project / "VERSION").write_text("test", encoding="utf-8")
            (canvases / "canvas-1.json").write_text(
                json.dumps(
                    {
                        "id": "canvas-1",
                        "kind": "smart",
                        "title": "默认应用迁移画布",
                        "owner_id": "admin-1",
                        "owner_username": "admin",
                        "visibility": "shared",
                        "nodes": [],
                        "connections": [],
                    }
                ),
                encoding="utf-8",
            )
            content = WorkspaceContent(
                Workspace(
                    directory=workspace,
                    _records_directory=data,
                    _media_directory=assets,
                )
            )
            legacy_app = FastAPI()

            class Authorization:
                def needs_initial_setup(self):
                    return False

                def user_for_session(self, token):
                    if token == "admin-session":
                        return {"id": "admin-1", "role": "admin"}
                    return None

            async def startup_event():
                return None

            async def shutdown_event():
                return None

            fake_main = ModuleType("main")
            fake_main.app = legacy_app
            fake_main.AUTH_SYSTEM = Authorization()
            fake_main.WORKSPACE_CONFIGURED = True
            fake_main.WORKSPACE_SELECTION_PRESENT = True
            fake_main.startup_event = startup_event
            fake_main.shutdown_event = shutdown_event
            fake_main.install_runtime_control = lambda *_args: None
            fake_main.prepare_controlled_restart = None
            fake_main.workspace_move_status = lambda: {}
            fake_main.current_workspace_content = lambda: content
            fake_main.current_workspace_id = lambda: "workspace-1"

            with (
                mock.patch.dict(
                    "os.environ",
                    {
                        "INFINITE_CANVAS_PROJECT_DIR": str(project),
                        "INFINITE_CANVAS_STATE_DIR": str(root / "state"),
                    },
                    clear=False,
                ),
                mock.patch.dict(sys.modules, {"main": fake_main}),
                mock.patch(
                    "infinite_canvas.bootstrap.generation_run_control",
                    GenerationRunControl(),
                ),
            ):
                from infinite_canvas.bootstrap import create_default_application

                application, _runtime, restart_signal = create_default_application()
                with TestClient(application) as client:
                    client.cookies.set("ic_session", "admin-session")
                    response = client.post(
                        "/api/runtime/storage-migration",
                        json={
                            "migration_id": "migration-default-application",
                            "approved": True,
                        },
                    )

            self.assertEqual(200, response.status_code)
            self.assertEqual("stopping", response.json()["stage"])
            self.assertTrue(restart_signal.is_set())
            self.assertTrue(content.storage_authority.is_file())

    def test_configured_missing_workspace_enters_recovery_even_without_accounts(self):
        fake_main = SimpleNamespace(
            app=object(),
            AUTH_SYSTEM=SimpleNamespace(
                needs_initial_setup=lambda: True,
            ),
            WORKSPACE_CONFIGURED=False,
            WORKSPACE_SELECTION_PRESENT=True,
            WORKSPACE_CONFIGURATION_ERROR=(
                "已配置的 Workspace Data 不存在"
            ),
        )

        async def startup_event():
            raise AssertionError("恢复状态不应启动业务应用")

        fake_main.startup_event = startup_event
        fake_main.shutdown_event = lambda: None

        with mock.patch(
            "infinite_canvas.bootstrap.importlib.import_module",
            return_value=fake_main,
        ):
            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "Workspace Data",
            ):
                asyncio.run(LegacyInitializer()())

    def test_recovery_restart_keeps_the_recovery_safe_point_preparer(self):
        events = []
        fake_main = SimpleNamespace(
            app=object(),
            AUTH_SYSTEM=SimpleNamespace(
                needs_initial_setup=lambda: True,
            ),
            WORKSPACE_CONFIGURED=False,
            WORKSPACE_SELECTION_PRESENT=True,
            WORKSPACE_CONFIGURATION_ERROR="已配置的工作区不存在",
            install_runtime_control=lambda *_args: None,
            prepare_controlled_restart=lambda: events.append(
                "legacy-prepare"
            ),
        )

        class Recovery:
            def prepare_restart(self):
                events.append("recovery-prepare")

        with tempfile.TemporaryDirectory() as temporary:
            initializer = LegacyInitializer()
            runtime = ApplicationRuntime(
                initializer=initializer,
                local_state_dir=Path(temporary) / "state",
                version="test",
                restart_signal=lambda: events.append("restart"),
            )
            initializer.bind_runtime(runtime)
            create_app(runtime, workspace_recovery=Recovery())

            with mock.patch(
                "infinite_canvas.bootstrap.importlib.import_module",
                return_value=fake_main,
            ):
                started = asyncio.run(runtime.start())
                restarted = asyncio.run(runtime.request_restart())

        self.assertEqual(RuntimeStage.RECOVERY_REQUIRED, started.stage)
        self.assertEqual(RuntimeStage.STOPPING, restarted.stage)
        self.assertEqual(["recovery-prepare", "restart"], events)

    def test_ready_runtime_uses_the_legacy_workspace_preparer(self):
        events = []
        fake_main = SimpleNamespace(
            app=object(),
            AUTH_SYSTEM=SimpleNamespace(
                needs_initial_setup=lambda: False,
            ),
            WORKSPACE_CONFIGURED=True,
            WORKSPACE_SELECTION_PRESENT=True,
            install_runtime_control=lambda *_args: None,
            prepare_controlled_restart=lambda: events.append(
                "legacy-prepare"
            ),
        )

        async def startup_event():
            return None

        async def shutdown_event():
            return None

        fake_main.startup_event = startup_event
        fake_main.shutdown_event = shutdown_event

        class Recovery:
            def prepare_restart(self):
                events.append("recovery-prepare")

        with tempfile.TemporaryDirectory() as temporary:
            initializer = LegacyInitializer()
            runtime = ApplicationRuntime(
                initializer=initializer,
                local_state_dir=Path(temporary) / "state",
                version="test",
                restart_signal=lambda: events.append("restart"),
            )
            initializer.bind_runtime(runtime)
            create_app(runtime, workspace_recovery=Recovery())

            with mock.patch(
                "infinite_canvas.bootstrap.importlib.import_module",
                return_value=fake_main,
            ):
                started = asyncio.run(runtime.start())
                restarted = asyncio.run(runtime.request_restart())

        self.assertEqual(RuntimeStage.READY, started.stage)
        self.assertEqual(RuntimeStage.STOPPING, restarted.stage)
        self.assertEqual(["legacy-prepare", "restart"], events)

    def test_legacy_module_import_does_not_block_the_runtime_event_loop(self):
        fake_main = SimpleNamespace(
            app=object(),
            AUTH_SYSTEM=SimpleNamespace(
                needs_initial_setup=lambda: False,
            ),
        )

        async def startup_event():
            await asyncio.sleep(0)

        async def shutdown_event():
            return None

        fake_main.startup_event = startup_event
        fake_main.shutdown_event = shutdown_event

        import_started = threading.Event()
        release_import = threading.Event()

        def slow_import(_name):
            import_started.set()
            release_import.wait(timeout=0.5)
            return fake_main

        async def scenario():
            with mock.patch(
                "infinite_canvas.bootstrap.importlib.import_module",
                side_effect=slow_import,
            ):
                initialization = asyncio.create_task(
                    LegacyInitializer()()
                )
                for _ in range(100):
                    if import_started.is_set():
                        break
                    await asyncio.sleep(0.001)
                event_loop_remained_responsive = (
                    import_started.is_set()
                    and not initialization.done()
                )
                release_import.set()
                await initialization
            return event_loop_remained_responsive

        event_loop_remained_responsive = asyncio.run(scenario())

        self.assertTrue(event_loop_remained_responsive)

    def test_direct_main_entry_delegates_to_the_runtime_supervisor(self):
        with tempfile.TemporaryDirectory() as temporary:
            script = textwrap.dedent(
                f"""
                import os
                import runpy
                import sys
                import types
                import uvicorn

                uvicorn.run = lambda *args, **kwargs: None
                replacement = types.ModuleType("infinite_canvas.__main__")
                replacement.main = lambda: 37
                sys.modules["infinite_canvas.__main__"] = replacement
                exit_code = None
                try:
                    runpy.run_path(
                        {str(ROOT / "backend" / "main.py")!r},
                        run_name="__main__",
                    )
                except SystemExit as exc:
                    exit_code = exc.code
                assert exit_code == 37, exit_code
                """
            )

            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(
                completed.returncode,
                0,
                msg=completed.stderr or completed.stdout,
            )

    def test_slow_legacy_startup_work_keeps_the_event_loop_responsive(self):
        with tempfile.TemporaryDirectory() as temporary:
            script = textwrap.dedent(
                f"""
                import asyncio
                import os
                import threading

                os.environ["INFINITE_CANVAS_STATE_DIR"] = {str(Path(temporary) / "state")!r}
                import main

                started = threading.Event()
                release = threading.Event()
                main.AUTH_SYSTEM.needs_initial_setup = lambda: False
                def slow_migration():
                    started.set()
                    release.wait(timeout=0.5)
                main.migrate_all_canvas_access = slow_migration
                main.sync_static_html_versions = lambda: None

                async def scenario():
                    startup = asyncio.create_task(main.startup_event())
                    for _ in range(100):
                        if started.is_set():
                            break
                        await asyncio.sleep(0.001)
                    responsive = started.is_set() and not startup.done()
                    release.set()
                    await startup
                    return responsive

                assert asyncio.run(scenario())
                """
            )

            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(
                completed.returncode,
                0,
                msg=completed.stderr or completed.stdout,
            )


if __name__ == "__main__":
    unittest.main()
