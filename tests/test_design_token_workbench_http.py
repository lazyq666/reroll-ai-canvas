import importlib
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.infinite_canvas.design_tokens import DesignTokenWorkbench
from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main


ensure_test_workspace()


TOKEN_SOURCE = """:root {
    --ui-palette-gray-0: #FFFFFF;
    --ui-palette-gray-800: #212121;
    --ui-palette-gray-950: #141414;
    --ui-color-text-primary: light-dark(var(--ui-palette-gray-950), var(--ui-palette-gray-0));
}
"""


class DesignTokenWorkbenchHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")

    def tearDown(self):
        unload_main()
        if self._previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self._previous_state
        ensure_test_workspace()

    def test_only_admin_can_load_and_save_global_color_tokens(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            configure_test_workspace(root / "workspace", state)
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            main = importlib.import_module("main")
            token_source = root / "design-tokens.css"
            token_source.write_text(TOKEN_SOURCE, encoding="utf-8")
            main.DESIGN_TOKEN_WORKBENCH = DesignTokenWorkbench(token_source)
            main.AUTH_SYSTEM.create_user(
                username="admin", password="admin-password", role="admin"
            )
            main.AUTH_SYSTEM.create_user(
                username="designer", password="designer-password", role="designer"
            )

            with TestClient(main.app) as client:
                self.assertEqual(client.get("/api/admin/design-tokens").status_code, 401)
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-password"},
                )
                self.assertEqual(client.get("/api/admin/design-tokens").status_code, 403)
                client.post("/api/auth/logout")
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                snapshot = client.get("/api/admin/design-tokens")
                self.assertEqual(snapshot.status_code, 200)
                saved = client.put(
                    "/api/admin/design-tokens",
                    json={
                        "expected_revision": snapshot.json()["revision"],
                        "changes": [
                            {
                                "name": "--ui-color-text-primary",
                                "light": "--ui-palette-gray-800",
                                "dark": "--ui-palette-gray-0",
                            }
                        ],
                    },
                )

            self.assertEqual(saved.status_code, 200)
            self.assertIn(
                "--ui-color-text-primary: light-dark(var(--ui-palette-gray-800), var(--ui-palette-gray-0));",
                token_source.read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
