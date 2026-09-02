import importlib.util
import atexit
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from infinite_canvas.workspace_storage import WorkspaceStorage


PROJECT_DIR = Path(__file__).resolve().parents[1]
_LAUNCHER_STATE = tempfile.TemporaryDirectory(
    prefix="infinite-canvas-launcher-tests-"
)
atexit.register(_LAUNCHER_STATE.cleanup)
os.environ.setdefault(
    "INFINITE_CANVAS_STATE_DIR",
    _LAUNCHER_STATE.name,
)
SPEC = importlib.util.spec_from_file_location(
    "infinite_canvas_launcher", PROJECT_DIR / "backend" / "launcher.py"
)
assert SPEC and SPEC.loader
launcher = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = launcher
SPEC.loader.exec_module(launcher)


class LauncherPathTests(unittest.TestCase):
    def test_only_documented_operator_entry_scripts_are_exposed(self):
        script_suffixes = {".bat", ".command", ".sh", ".ps1"}
        ignored_directory_names = {
            ".agents",
            ".codex",
            ".git",
            ".scratch",
            ".test-venv",
            ".venv",
            ".worktrees",
            "node_modules",
        }
        scripts = {
            path.relative_to(PROJECT_DIR).as_posix()
            for path in PROJECT_DIR.rglob("*")
            if path.is_file()
            and path.suffix.lower() in script_suffixes
            and ignored_directory_names.isdisjoint(path.parts)
        }
        self.assertEqual(
            scripts,
            {
                "启动服务-Windows.bat",
                "启动服务-macOS.command",
                "安装GPT-Image-2助手-Windows.bat",
                "安装GPT-Image-2助手-macOS.command",
                "scripts/install_gpt_image_2_helper_windows.ps1",
                "admin-tools/多人协作性能测试-macOS.command",
                "admin-tools/抠图并行容量测试-macOS.command",
            },
        )

    def test_platform_entries_delegate_to_shared_launcher(self):
        windows_entry = (PROJECT_DIR / "启动服务-Windows.bat").read_text(
            encoding="utf-8"
        )
        macos_entry = (PROJECT_DIR / "启动服务-macOS.command").read_text(
            encoding="utf-8"
        )
        self.assertIn("backend\\launcher.py", windows_entry)
        self.assertIn("backend/launcher.py", macos_entry)
        self.assertTrue((PROJECT_DIR / "启动服务-macOS.command").stat().st_mode & 0o100)

    def test_platform_entries_bootstrap_project_owned_python(self):
        windows_entry = (PROJECT_DIR / "启动服务-Windows.bat").read_text(
            encoding="utf-8"
        )
        macos_entry = (PROJECT_DIR / "启动服务-macOS.command").read_text(
            encoding="utf-8"
        )
        for platform_name, entry in (
            ("windows", windows_entry),
            ("macos", macos_entry),
        ):
            with self.subTest(platform=platform_name):
                self.assertIn("UV_PYTHON_INSTALL_DIR", entry)
                self.assertIn("python install", entry)
                self.assertIn("--managed-python", entry)
                self.assertIn("UV_NO_MODIFY_PATH", entry)
                self.assertIn("3.12", entry)

        self.assertIn("UV_UNMANAGED_INSTALL", windows_entry)
        self.assertIn("UV_UNMANAGED_INSTALL", macos_entry)
        self.assertIn("LOCALAPPDATA", windows_entry)
        self.assertIn("Library/Application Support/Infinite Canvas", macos_entry)

    @unittest.skipIf(os.name == "nt", "POSIX bootstrap test")
    def test_posix_entry_uses_existing_managed_python_without_network(self):
        entry_source = (PROJECT_DIR / "启动服务-macOS.command").read_text(
            encoding="utf-8"
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "project"
            state = Path(temporary) / "state"
            uv = state / "runtime" / "uv" / "uv"
            fake_python = Path(temporary) / "managed-python"
            launch_log = Path(temporary) / "launch.log"
            entry = root / "启动服务-macOS.command"

            (root / "backend").mkdir(parents=True)
            (root / "backend" / "launcher.py").write_text(
                "# delegated launcher\n", encoding="utf-8"
            )
            entry.write_text(entry_source, encoding="utf-8")
            uv.parent.mkdir(parents=True)
            uv.write_text(
                "#!/bin/sh\n"
                "if [ \"$1 $2\" = \"python install\" ]; then exit 0; fi\n"
                "if [ \"$1 $2 $3\" = \"python find --managed-python\" ]; then\n"
                "  printf '%s\\n' \"$FAKE_MANAGED_PYTHON\"\n"
                "  exit 0\n"
                "fi\n"
                "exit 1\n",
                encoding="utf-8",
            )
            fake_python.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = \"-c\" ]; then exit 0; fi\n"
                "printf '%s\\n' \"$@\" > \"$BOOTSTRAP_LAUNCH_LOG\"\n",
                encoding="utf-8",
            )
            uv.chmod(0o755)
            fake_python.chmod(0o755)

            environment = os.environ.copy()
            environment.update(
                {
                    "INFINITE_CANVAS_STATE_DIR": str(state),
                    "FAKE_MANAGED_PYTHON": str(fake_python),
                    "BOOTSTRAP_LAUNCH_LOG": str(launch_log),
                }
            )
            completed = subprocess.run(
                ["bash", str(entry), "check", "--no-browser"],
                cwd=str(root),
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(
                launch_log.read_text(encoding="utf-8").splitlines(),
                ["backend/launcher.py", "check", "--no-browser"],
            )

    def test_supported_python_baseline_is_312(self):
        self.assertEqual(launcher.MIN_PYTHON, (3, 12))
        self.assertEqual(launcher.MAX_PYTHON, (3, 13))

    def test_current_bootstrap_python_is_the_first_base_candidate(self):
        with mock.patch.object(launcher.sys, "executable", "/managed/python"):
            candidates = launcher._base_python_candidates()
        self.assertEqual(candidates[0], ("/managed/python",))

    def test_windows_virtualenv_python_path(self):
        root = Path("project") / ".venv"
        self.assertEqual(
            launcher.venv_python_path(root, "nt"),
            root / "Scripts" / "python.exe",
        )

    def test_posix_virtualenv_python_path(self):
        root = Path("project") / ".venv"
        self.assertEqual(
            launcher.venv_python_path(root, "posix"),
            root / "bin" / "python",
        )

    def test_platform_label_contains_system_and_architecture(self):
        self.assertEqual(
            launcher.platform_label("Darwin", "arm64"), "Darwin arm64"
        )


class LauncherDependencyTests(unittest.TestCase):
    def test_hash_pinned_lock_is_preferred_over_source_requirements(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            requirements = root / "requirements.txt"
            lock = root / "requirements.lock.txt"
            requirements.write_text("fastapi\n", encoding="utf-8")
            self.assertEqual(
                launcher.dependency_requirements_file(lock, requirements),
                requirements,
            )
            lock.write_text("fastapi==1.2.3 --hash=sha256:abc\n", encoding="utf-8")
            self.assertEqual(
                launcher.dependency_requirements_file(lock, requirements), lock
            )

    def test_requirements_digest_changes_with_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            requirements = Path(temporary) / "requirements.txt"
            requirements.write_text("fastapi\n", encoding="utf-8")
            first = launcher.requirements_digest(requirements)
            requirements.write_text("fastapi\nuvicorn\n", encoding="utf-8")
            second = launcher.requirements_digest(requirements)
        self.assertNotEqual(first, second)

    def test_local_package_dirs_include_one_level_platform_folders(self):
        with tempfile.TemporaryDirectory() as temporary:
            packages = Path(temporary) / "packages"
            (packages / "windows-x64").mkdir(parents=True)
            (packages / "macos-arm64").mkdir()
            result = launcher.local_package_dirs(packages)
        self.assertEqual(result[0], packages)
        self.assertIn(packages / "windows-x64", result)
        self.assertIn(packages / "macos-arm64", result)


class LauncherPortTests(unittest.TestCase):
    def test_instance_state_file_is_isolated_by_project_directory(self):
        state_dir = Path("/tmp/infinite-canvas-state")
        first_instance = launcher.instance_state_file(
            Path("/tmp/infinite-canvas-one"), state_dir
        )
        second_instance = launcher.instance_state_file(
            Path("/tmp/infinite-canvas-two"), state_dir
        )
        first_lock = launcher.launch_claim_file(
            Path("/tmp/infinite-canvas-one"), state_dir
        )
        second_lock = launcher.launch_claim_file(
            Path("/tmp/infinite-canvas-two"), state_dir
        )

        self.assertNotEqual(first_instance, second_instance)
        self.assertNotEqual(first_lock, second_lock)

    def test_project_environment_enables_persistent_lan_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment_file = Path(temporary) / ".env"
            environment_file.write_text(
                """
                # Device-local launcher settings
                INFINITE_CANVAS_HOST=0.0.0.0
                INFINITE_CANVAS_PORT="4321"
                """,
                encoding="utf-8",
            )
            with mock.patch.dict(os.environ, {}, clear=True):
                launcher.load_project_environment(environment_file)
                self.assertEqual(os.environ["INFINITE_CANVAS_HOST"], "0.0.0.0")
                self.assertEqual(os.environ["INFINITE_CANVAS_PORT"], "4321")

    def test_project_environment_does_not_override_explicit_process_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            environment_file = Path(temporary) / ".env"
            environment_file.write_text(
                "INFINITE_CANVAS_HOST=0.0.0.0\n",
                encoding="utf-8",
            )
            with mock.patch.dict(
                os.environ,
                {"INFINITE_CANVAS_HOST": "127.0.0.1"},
                clear=True,
            ):
                launcher.load_project_environment(environment_file)
                self.assertEqual(
                    os.environ["INFINITE_CANVAS_HOST"],
                    "127.0.0.1",
                )

    def test_server_is_loopback_only_unless_lan_access_is_explicit(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(launcher.server_bind_host(), "127.0.0.1")
        with mock.patch.dict(
            os.environ,
            {"INFINITE_CANVAS_HOST": "0.0.0.0"},
            clear=True,
        ):
            self.assertEqual(launcher.server_bind_host(), "0.0.0.0")

    def test_preferred_server_port_defaults_to_3000_and_can_be_overridden(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(launcher.preferred_server_port(), 3000)
        with mock.patch.dict(
            os.environ,
            {"INFINITE_CANVAS_PORT": "4321"},
            clear=True,
        ):
            self.assertEqual(launcher.preferred_server_port(), 4321)

    def test_invalid_preferred_server_port_is_rejected(self):
        for value in ("not-a-port", "0", "65536"):
            with self.subTest(value=value):
                with mock.patch.dict(
                    os.environ,
                    {"INFINITE_CANVAS_PORT": value},
                    clear=True,
                ):
                    with self.assertRaises(launcher.LauncherError):
                        launcher.preferred_server_port()

    @mock.patch.object(
        launcher,
        "_port_is_open",
        side_effect=lambda host="127.0.0.1", port=3000: port in {3000, 3001},
    )
    def test_available_port_skips_occupied_ports(self, _port_open):
        self.assertEqual(launcher._find_available_port(3000), 3002)

    def test_application_response_requires_project_markers(self):
        page = """
        <html><head><title>AI Studio</title></head>
        <body><img src="/static/images/brand/wordmark.svg"></body></html>
        """
        self.assertTrue(launcher.application_response_matches(page))
        login_page = """
        <html><head><title>登录 · Reroll</title></head>
        <body><img src="/static/images/brand/logo.png"></body></html>
        """
        self.assertTrue(launcher.application_response_matches(login_page))
        legacy_login_page = """
        <html><head><title>登录 · Infinite Canvas</title></head>
        <body><img src="/static/images/brand/logo.png"></body></html>
        """
        self.assertTrue(launcher.application_response_matches(legacy_login_page))
        self.assertFalse(
            launcher.application_response_matches(
                "<html><title>Another App</title></html>"
            )
        )

    @mock.patch.object(launcher, "existing_instance_url", return_value=None)
    @mock.patch.object(launcher, "_acquire_launch_claim")
    @mock.patch.object(launcher, "supervise_application", return_value=0)
    @mock.patch.object(launcher, "_application_is_running", return_value=False)
    @mock.patch.object(
        launcher,
        "_port_is_open",
        side_effect=lambda host="127.0.0.1", port=3000: port == 3000,
    )
    def test_occupied_port_switches_to_next_available_port(
        self,
        _port_open,
        _app_running,
        supervise,
        acquire_claim,
        _existing_instance,
    ):
        acquire_claim.return_value = mock.Mock()
        runtime = launcher.Runtime(Path("/python"), (3, 11, 0), "test")
        result = launcher.start_application(runtime, open_browser=False)
        self.assertEqual(result, 0)
        supervise.assert_called_once_with(runtime, port=3001)

    @mock.patch.object(launcher.webbrowser, "open")
    @mock.patch.object(launcher, "supervise_application")
    @mock.patch.object(
        launcher,
        "existing_instance_url",
        return_value=launcher.LOCAL_URL,
    )
    def test_existing_infinite_canvas_is_reused(
        self, _existing_instance, supervise, browser_open
    ):
        runtime = launcher.Runtime(Path("/python"), (3, 11, 0), "test")
        result = launcher.start_application(runtime, open_browser=True)
        self.assertEqual(result, 0)
        supervise.assert_not_called()
        browser_open.assert_called_once_with(launcher.LOCAL_URL, new=2)


class LauncherSupervisionTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "POSIX launcher lifecycle test")
    def test_terminating_launcher_stops_backend_and_releases_workspace(self):
        self._assert_launcher_signal_stops_backend(signal.SIGTERM)

    @unittest.skipIf(os.name == "nt", "POSIX launcher lifecycle test")
    def test_closing_launcher_terminal_stops_backend_and_releases_workspace(
        self,
    ):
        self._assert_launcher_signal_stops_backend(signal.SIGHUP)

    def _assert_launcher_signal_stops_backend(self, stop_signal):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            workspace = root / "workspace"
            cache = root / "cache"
            static_html_snapshots = {
                path: path.read_bytes()
                for path in (PROJECT_DIR / "static").glob("*.html")
            }
            workspace.mkdir()
            cache.mkdir()
            WorkspaceStorage(PROJECT_DIR, state_dir=state).save_parent(
                workspace
            )

            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]

            environment = os.environ.copy()
            environment.update(
                {
                    "INFINITE_CANVAS_CACHE_DIR": str(cache),
                    "INFINITE_CANVAS_HOST": "127.0.0.1",
                    "INFINITE_CANVAS_PORT": str(port),
                    "INFINITE_CANVAS_STATE_DIR": str(state),
                }
            )
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(PROJECT_DIR / "backend" / "launcher.py"),
                    "start",
                    "--no-browser",
                ],
                cwd=PROJECT_DIR,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            child_pid = 0
            try:
                status_url = f"http://127.0.0.1:{port}/api/runtime/status"
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    try:
                        with urllib.request.urlopen(
                            status_url,
                            timeout=0.25,
                        ):
                            break
                    except OSError:
                        if process.poll() is not None:
                            output = process.communicate(timeout=1)[0]
                            self.fail(
                                "launcher exited before runtime became ready:\n"
                                + output
                            )
                        time.sleep(0.1)
                else:
                    self.fail("runtime did not become ready within 30 seconds")

                deadline = time.monotonic() + 5
                instance_files = []
                while time.monotonic() < deadline:
                    instance_files = list(state.glob("instance-*.json"))
                    if instance_files:
                        break
                    time.sleep(0.05)
                self.assertEqual(1, len(instance_files))
                child_pid = int(
                    json.loads(
                        instance_files[0].read_text(encoding="utf-8")
                    )["pid"]
                )
                occupation = (
                    workspace
                    / ".infinite-canvas-service"
                    / "occupation.json"
                )
                self.assertTrue(occupation.is_file())

                process.send_signal(stop_signal)
                process.wait(timeout=10)

                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    try:
                        os.kill(child_pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.1)
                else:
                    self.fail(
                        "backend remained alive after its launcher terminated"
                    )

                with socket.socket() as closed_port_probe:
                    closed_port_probe.settimeout(0.25)
                    self.assertNotEqual(
                        0,
                        closed_port_probe.connect_ex(("127.0.0.1", port)),
                    )
                self.assertFalse(occupation.exists())
                import fcntl

                writer_lock = occupation.with_name("writer.lock")
                with writer_lock.open("a+b") as guard:
                    fcntl.flock(
                        guard.fileno(),
                        fcntl.LOCK_EX | fcntl.LOCK_NB,
                    )
                    fcntl.flock(guard.fileno(), fcntl.LOCK_UN)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                if child_pid:
                    try:
                        os.killpg(child_pid, signal.SIGINT)
                    except ProcessLookupError:
                        pass
                if process.stdout is not None:
                    process.stdout.close()
                for path, content in static_html_snapshots.items():
                    if path.read_bytes() != content:
                        path.write_bytes(content)

    def test_takeover_flag_is_forwarded_only_to_the_spawned_application(self):
        child = mock.Mock()
        child.pid = 2468
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher.subprocess,
                "Popen",
                return_value=child,
            ) as popen,
            mock.patch.object(launcher.threading, "Thread"),
        ):
            launcher._spawn_application(
                runtime,
                takeover_workspace=True,
            )

        self.assertEqual(
            popen.call_args.kwargs["env"][
                "INFINITE_CANVAS_WORKSPACE_TAKEOVER"
            ],
            "1",
        )

    def test_takeover_environment_is_removed_without_the_cli_confirmation(self):
        child = mock.Mock()
        child.pid = 2468
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.dict(
                os.environ,
                {"INFINITE_CANVAS_WORKSPACE_TAKEOVER": "1"},
            ),
            mock.patch.object(
                launcher.subprocess,
                "Popen",
                return_value=child,
            ) as popen,
            mock.patch.object(launcher.threading, "Thread"),
        ):
            launcher._spawn_application(runtime)

        self.assertNotIn(
            "INFINITE_CANVAS_WORKSPACE_TAKEOVER",
            popen.call_args.kwargs["env"],
        )

    def test_runtime_health_requires_the_expected_installation_identity(self):
        with mock.patch.object(
            launcher,
            "_runtime_status_payload",
            return_value={
                "stage": "ready",
                "installation_id": "another-installation",
            },
        ):
            self.assertFalse(
                launcher._runtime_is_healthy(
                    "http://127.0.0.1:3456/api/runtime/status",
                    expected_installation_id=launcher.INSTALLATION_ID,
                )
            )

    def test_instance_record_persists_its_installation_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_file = Path(temporary) / "instance.json"

            launcher._write_instance_state(
                1234,
                3456,
                state_file,
                installation_id="checkout-test-id",
            )

            record = json.loads(state_file.read_text(encoding="utf-8"))
            self.assertEqual(record["installation_id"], "checkout-test-id")

    def test_unexpected_child_exit_is_reported_without_restart(self):
        child = mock.Mock()
        child.wait.return_value = 9
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with mock.patch.object(
            launcher,
            "_spawn_application",
            return_value=child,
        ) as spawn:
            result = launcher.supervise_application(runtime)

        self.assertEqual(result, 9)
        spawn.assert_called_once_with(runtime, launcher.PORT)

    def test_explicit_restart_is_honored_once_in_the_existing_launcher(self):
        first = mock.Mock()
        first.wait.return_value = launcher.RESTART_EXIT_CODE
        second = mock.Mock()
        second.wait.return_value = 0
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_spawn_application",
                side_effect=[first, second],
            ) as spawn,
            mock.patch.object(
                launcher,
                "_wait_for_runtime_health",
                return_value=True,
            ) as health,
        ):
            result = launcher.supervise_application(runtime)

        self.assertEqual(result, 0)
        self.assertEqual(spawn.call_count, 2)
        spawn.assert_has_calls(
            [
                mock.call(runtime, launcher.PORT),
                mock.call(runtime, launcher.PORT),
            ]
        )
        health.assert_called_once_with(
            timeout_seconds=30.0,
            port=launcher.PORT,
        )

    def test_later_restart_after_runtime_recovers_is_honored(self):
        first = mock.Mock()
        first.wait.return_value = launcher.RESTART_EXIT_CODE
        second = mock.Mock()
        second.wait.return_value = launcher.RESTART_EXIT_CODE
        third = mock.Mock()
        third.wait.return_value = 0
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_spawn_application",
                side_effect=[first, second, third],
            ) as spawn,
            mock.patch.object(
                launcher,
                "_wait_for_runtime_health",
                return_value=True,
            ) as health,
        ):
            result = launcher.supervise_application(runtime)

        self.assertEqual(0, result)
        self.assertEqual(3, spawn.call_count)
        self.assertEqual(2, health.call_count)

    def test_stale_instance_state_is_removed_without_signalling_its_pid(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_file = Path(temporary) / "instance.json"
            state_file.write_text(
                json.dumps(
                    {
                        "pid": 424242,
                        "port": 3000,
                        "installation_id": launcher.INSTALLATION_ID,
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(
                launcher,
                "_runtime_matches_installation",
                return_value=False,
            ):
                existing = launcher.existing_instance_url(state_file)

            self.assertIsNone(existing)
            self.assertFalse(state_file.exists())

    def test_healthy_instance_state_resolves_the_existing_application_url(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_file = Path(temporary) / "instance.json"
            state_file.write_text(
                json.dumps(
                    {
                        "pid": 1234,
                        "port": 3456,
                        "installation_id": launcher.INSTALLATION_ID,
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(
                launcher,
                "_runtime_matches_installation",
                return_value=True,
            ) as healthy:
                existing = launcher.existing_instance_url(state_file)

            self.assertEqual(existing, "http://127.0.0.1:3456/")
            healthy.assert_called_once_with(
                "http://127.0.0.1:3456/api/runtime/status",
                launcher.INSTALLATION_ID,
            )

    def test_instance_record_from_another_directory_is_never_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_file = Path(temporary) / "instance.json"
            state_file.write_text(
                json.dumps(
                    {
                        "pid": 1234,
                        "port": 3456,
                        "installation_id": "another-installation",
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(
                launcher, "_runtime_matches_installation"
            ) as matches:
                existing = launcher.existing_instance_url(state_file)

            self.assertIsNone(existing)
            self.assertFalse(state_file.exists())
            matches.assert_not_called()

    def test_first_interrupt_allows_ten_seconds_then_forces_stuck_child(self):
        child = mock.Mock()
        child.pid = 2468
        child.wait.side_effect = [
            KeyboardInterrupt(),
            launcher.subprocess.TimeoutExpired("app", 10),
            130,
        ]

        with mock.patch.object(launcher.os, "killpg") as kill_process_group:
            result = launcher.wait_for_child(
                child,
                grace_period_seconds=10,
            )

        self.assertEqual(result, 130)
        kill_process_group.assert_called_once_with(2468, launcher.signal.SIGINT)
        child.send_signal.assert_not_called()
        child.kill.assert_called_once()

    def test_spawn_uses_an_isolated_process_group_in_the_same_terminal(self):
        child = mock.Mock()
        child.pid = 2468
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher.subprocess,
                "Popen",
                return_value=child,
            ) as popen,
            mock.patch.object(launcher.threading, "Thread") as thread,
        ):
            spawned = launcher._spawn_application(runtime, port=4321)

        self.assertIs(spawned, child)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual(
            popen.call_args.kwargs["env"]["INFINITE_CANVAS_PORT"],
            "4321",
        )
        self.assertEqual(
            popen.call_args.kwargs["env"]["INFINITE_CANVAS_PROJECT_DIR"],
            str(launcher.PROJECT_DIR),
        )
        self.assertEqual(
            popen.call_args.kwargs["env"][launcher.SUPERVISOR_PID_ENV],
            str(os.getpid()),
        )
        self.assertEqual(
            popen.call_args.kwargs["env"][
                "INFINITE_CANVAS_INSTANCE_STATE_DIR"
            ],
            str(launcher.application_state_directory() / "instance-state"),
        )
        self.assertEqual(thread.call_args.kwargs["args"], (child, 4321))
        thread.assert_called_once()

    def test_instance_state_is_only_written_for_a_healthy_live_runtime(self):
        child = mock.Mock()
        child.pid = 2468
        child.poll.side_effect = [None, 0]

        with (
            mock.patch.object(
                launcher,
                "_runtime_is_healthy",
                return_value=False,
            ),
            mock.patch.object(
                launcher,
                "_application_is_running",
                return_value=True,
            ),
            mock.patch.object(launcher.time, "sleep"),
            mock.patch.object(launcher, "_write_instance_state") as write,
        ):
            launcher._record_instance_when_ready(child)

        write.assert_not_called()

    def test_restart_before_runtime_recovers_does_not_create_a_loop(self):
        first = mock.Mock()
        first.wait.return_value = launcher.RESTART_EXIT_CODE
        second = mock.Mock()
        second.wait.return_value = launcher.RESTART_EXIT_CODE
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_spawn_application",
                side_effect=[first, second],
            ) as spawn,
            mock.patch.object(
                launcher,
                "_wait_for_runtime_health",
                return_value=False,
            ),
        ):
            with self.assertRaisesRegex(
                launcher.LauncherError,
                "再次请求重启",
            ):
                launcher.supervise_application(runtime)

        self.assertEqual(spawn.call_count, 2)

    def test_restart_health_timeout_stops_after_the_second_child(self):
        first = mock.Mock()
        first.wait.return_value = launcher.RESTART_EXIT_CODE
        second = mock.Mock()
        second.wait.return_value = 7
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_spawn_application",
                side_effect=[first, second],
            ) as spawn,
            mock.patch.object(
                launcher,
                "_wait_for_runtime_health",
                return_value=False,
            ),
        ):
            output = StringIO()
            with redirect_stdout(output):
                launcher.supervise_application(runtime)

        self.assertEqual(spawn.call_count, 2)
        second.wait.assert_called_once()
        self.assertIn("30 秒", output.getvalue())

    def test_interrupt_during_restart_health_check_stops_the_restarted_child(self):
        first = mock.Mock()
        first.wait.return_value = launcher.RESTART_EXIT_CODE
        second = mock.Mock()
        second.pid = 2468
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_spawn_application",
                side_effect=[first, second],
            ),
            mock.patch.object(
                launcher,
                "_wait_for_runtime_health",
                side_effect=KeyboardInterrupt,
            ),
            mock.patch.object(
                launcher,
                "_stop_child_after_interrupt",
                return_value=130,
            ) as stop,
        ):
            result = launcher.supervise_application(runtime)

        self.assertEqual(result, 130)
        stop.assert_called_once_with(
            second,
            grace_period_seconds=10.0,
        )

    def test_launch_claim_prevents_parallel_application_spawns(self):
        runtime = launcher.Runtime(Path("/python"), (3, 12, 0), "test")

        with (
            mock.patch.object(
                launcher,
                "_port_is_open",
                return_value=False,
            ),
            mock.patch.object(
                launcher,
                "_acquire_launch_claim",
                return_value=None,
                create=True,
            ),
            mock.patch.object(
                launcher,
                "supervise_application",
            ) as supervise,
        ):
            with self.assertRaisesRegex(
                launcher.LauncherError,
                "另一个启动器",
            ):
                launcher.start_application(runtime, open_browser=False)

        supervise.assert_not_called()

    def test_launch_claim_is_exclusive_and_reusable_after_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            claim_file = Path(temporary) / "launch.lock"
            first = launcher._acquire_launch_claim(claim_file)
            second = launcher._acquire_launch_claim(claim_file)

            self.assertIsNotNone(first)
            self.assertIsNone(second)
            first.release()

            third = launcher._acquire_launch_claim(claim_file)
            self.assertIsNotNone(third)
            third.release()

    def test_launch_claim_is_acquired_before_environment_preparation(self):
        events = []
        claim = mock.Mock()
        runtime = launcher.Runtime(
            Path("/python"),
            (3, 12, 0),
            "test",
        )

        with (
            mock.patch.object(
                launcher,
                "_acquire_launch_claim",
                side_effect=lambda: events.append("claim") or claim,
            ),
            mock.patch.object(
                launcher,
                "resolve_runtime",
                side_effect=lambda create=True: (
                    events.append("runtime") or runtime
                ),
            ),
            mock.patch.object(launcher, "install_dependencies"),
        ):
            result = launcher.main(["install"])

        self.assertEqual(result, 0)
        self.assertEqual(events[:2], ["claim", "runtime"])
        claim.release.assert_called_once()


if __name__ == "__main__":
    unittest.main()
