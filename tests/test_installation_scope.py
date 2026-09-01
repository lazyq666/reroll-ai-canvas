import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from infinite_canvas.app import create_app
from infinite_canvas.installation import (
    installation_directory,
    installation_identity,
)
from infinite_canvas.runtime import ApplicationRuntime, RuntimeStartup
from infinite_canvas.workspace_storage import application_state_directory


class InstallationScopeTests(unittest.TestCase):
    def test_project_directories_have_stable_distinct_installation_scopes(self):
        root = Path("/tmp/infinite-canvas")
        first = Path("/tmp/infinite-canvas-one")
        second = Path("/tmp/infinite-canvas-two")

        self.assertEqual(
            installation_identity(first), installation_identity(first)
        )
        self.assertNotEqual(
            installation_identity(first), installation_identity(second)
        )
        self.assertEqual(
            installation_directory(root, first).parent,
            root.resolve() / "installations",
        )

    def test_default_device_state_is_scoped_but_explicit_override_is_exact(self):
        first = Path("/tmp/infinite-canvas-one")
        second = Path("/tmp/infinite-canvas-two")
        with mock.patch.dict(os.environ, {}, clear=True):
            first_state = application_state_directory(first)
            second_state = application_state_directory(second)
            shared_root = application_state_directory()

        self.assertNotEqual(first_state, second_state)
        self.assertEqual(first_state.parent, shared_root / "installations")
        self.assertEqual(second_state.parent, shared_root / "installations")

        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.dict(
                os.environ,
                {"INFINITE_CANVAS_STATE_DIR": temporary},
                clear=True,
            ):
                self.assertEqual(
                    application_state_directory(first), Path(temporary).resolve()
                )

    def test_runtime_status_exposes_installation_identity(self):
        async def initialize():
            return RuntimeStartup(application=lambda *_args: None)

        with tempfile.TemporaryDirectory() as temporary:
            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "state",
                version="test",
            )
            app = create_app(runtime, installation_id="installation-test")
            with TestClient(app) as client:
                payload = client.get("/api/runtime/status").json()

        self.assertEqual(payload["installation_id"], "installation-test")


if __name__ == "__main__":
    unittest.main()
