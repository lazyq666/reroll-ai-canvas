import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from infinite_canvas.device_state import DeviceState
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage, WorkspaceStorageError


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceOccupationTests(unittest.TestCase):
    def _service(self, root: Path) -> WorkspaceService:
        workspace = root / "workspace"
        (workspace / "data").mkdir(parents=True, exist_ok=True)
        (workspace / "assets").mkdir(exist_ok=True)
        storage = WorkspaceStorage(root, state_dir=root / "state")
        if not storage.settings_file.exists():
            storage.save_parent(workspace)
        return WorkspaceService(storage)

    def _abandon_in_subprocess(
        self,
        root: Path,
        server_id: str,
    ) -> subprocess.CompletedProcess:
        script = textwrap.dedent(
            """
            import os
            from pathlib import Path
            from infinite_canvas.workspace import WorkspaceService
            from infinite_canvas.workspace_storage import WorkspaceStorage

            root = Path(os.environ["OCCUPATION_TEST_ROOT"])
            service = WorkspaceService(
                WorkspaceStorage(root, state_dir=root / "state")
            )
            service.acquire_occupation(
                os.environ["OCCUPATION_TEST_SERVER"],
                directory=root / "workspace",
            )
            os._exit(0)
            """
        )
        environment = {
            **os.environ,
            "OCCUPATION_TEST_ROOT": str(root),
            "OCCUPATION_TEST_SERVER": server_id,
        }
        return subprocess.run(
            [sys.executable, "-c", script],
            cwd=ROOT,
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def test_second_service_is_refused_while_first_has_write_ownership(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self._service(root).acquire_occupation(
                "server-a",
                directory=root / "workspace",
            )
            self.addCleanup(first.release)

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "工作区正在被另一个 Reroll 服务使用",
            ):
                self._service(root).acquire_occupation(
                    "server-b",
                    directory=root / "workspace",
                )

    def test_concurrent_startup_uses_one_persistent_server_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"

            with ThreadPoolExecutor(max_workers=2) as executor:
                identities = list(
                    executor.map(
                        lambda _index: DeviceState(state).server_identity(),
                        range(2),
                    )
                )

            self.assertEqual(identities[0], identities[1])
            self.assertEqual(
                identities[0],
                DeviceState(state).server_identity(),
            )

    def test_normal_release_allows_another_service_to_open_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self._service(root).acquire_occupation(
                "server-a",
                directory=root / "workspace",
            )

            first.release()
            second = self._service(root).acquire_occupation(
                "server-b",
                directory=root / "workspace",
            )
            try:
                self.assertTrue(second.active)
            finally:
                second.release()

    def test_same_server_cleans_its_confirmed_stale_ownership(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._service(root)
            abandoned = self._abandon_in_subprocess(root, "server-a")
            self.assertEqual(0, abandoned.returncode, abandoned.stderr)

            recovered = self._service(root).acquire_occupation(
                "server-a",
                directory=root / "workspace",
            )
            try:
                self.assertTrue(recovered.active)
                self.assertEqual("server-a", recovered.server_id)
            finally:
                recovered.release()

    def test_unknown_server_ownership_stays_refused_without_takeover(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._service(root)
            abandoned = self._abandon_in_subprocess(root, "server-a")
            self.assertEqual(0, abandoned.returncode, abandoned.stderr)

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "无法确认原服务已经安全退出",
            ):
                self._service(root).acquire_occupation(
                    "server-b",
                    directory=root / "workspace",
                )

    def test_confirmed_takeover_replaces_foreign_stale_ownership(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._service(root)
            abandoned = self._abandon_in_subprocess(root, "server-a")
            self.assertEqual(0, abandoned.returncode, abandoned.stderr)

            recovered = self._service(root).acquire_occupation(
                "server-b",
                directory=root / "workspace",
                allow_foreign_takeover=True,
            )
            try:
                self.assertTrue(recovered.active)
                self.assertEqual("server-b", recovered.server_id)
            finally:
                recovered.release()

    def test_confirmed_takeover_cannot_bypass_an_active_file_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self._service(root).acquire_occupation(
                "server-a",
                directory=root / "workspace",
            )
            self.addCleanup(first.release)

            with self.assertRaisesRegex(
                WorkspaceStorageError,
                "工作区正在被另一个 Reroll 服务使用",
            ):
                self._service(root).acquire_occupation(
                    "server-b",
                    directory=root / "workspace",
                    allow_foreign_takeover=True,
                )

    def test_runtime_refuses_before_initializing_accounts_in_occupied_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            service = self._service(root)
            occupation = service.acquire_occupation(
                "server-a",
                directory=root / "workspace",
            )
            self.addCleanup(occupation.release)
            workspace = root / "workspace"
            other_state = root / "other-state"
            WorkspaceStorage(
                ROOT,
                state_dir=other_state,
            ).save_parent(workspace)
            environment = {
                **os.environ,
                "INFINITE_CANVAS_STATE_DIR": str(other_state),
            }

            completed = subprocess.run(
                [sys.executable, "-c", "import main"],
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertNotEqual(0, completed.returncode)
            self.assertIn(
                "工作区正在被另一个 Reroll 服务使用",
                completed.stderr,
            )
            self.assertFalse((workspace / "data" / "auth.db").exists())

    def test_runtime_honors_explicit_foreign_takeover_confirmation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._service(root)
            server_id = "server-a"
            abandoned = self._abandon_in_subprocess(root, server_id)
            self.assertEqual(0, abandoned.returncode, abandoned.stderr)
            workspace = root / "workspace"
            other_state = root / "other-state"
            WorkspaceStorage(
                ROOT,
                state_dir=other_state,
            ).save_parent(workspace)
            environment = {
                **os.environ,
                "INFINITE_CANVAS_STATE_DIR": str(other_state),
                "INFINITE_CANVAS_WORKSPACE_TAKEOVER": "1",
            }

            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import main; "
                        "assert main.WORKSPACE_OCCUPATION.active; "
                        "main.release_workspace_occupation()"
                    ),
                ],
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(0, completed.returncode, completed.stderr)


if __name__ == "__main__":
    unittest.main()
