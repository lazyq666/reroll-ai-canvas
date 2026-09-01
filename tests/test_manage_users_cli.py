import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.auth_system import AuthSystem
from scripts.admin.manage_users import main
from infinite_canvas.workspace_storage import WorkspaceStorage
from infinite_canvas.instance_state import InstanceState


class ManageUsersCliTests(unittest.TestCase):
    def test_create_and_list_instance_accounts(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state"
            database = state / "instance-state" / "auth.db"
            self.assertEqual(
                main(
                    [
                        "--state-dir",
                        str(state),
                        "create",
                        "admin",
                        "--password",
                        "local-password",
                        "--role",
                        "admin",
                    ]
                ),
                0,
            )

            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(
                    main(["--state-dir", str(state), "list"]), 0
                )

            self.assertIn("admin\tadmin\tactive", output.getvalue())
            self.assertEqual(AuthSystem(database).list_users()[0]["username"], "admin")

    def test_default_database_comes_from_instance_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            workspace = root / "workspace"
            workspace_data = workspace / "data"
            workspace_assets = workspace / "assets"
            state.mkdir()
            workspace_data.mkdir(parents=True)
            workspace_assets.mkdir()
            database = InstanceState(state).auth_database
            AuthSystem(database).create_user(
                username="owner",
                password="owner-password",
                role="admin",
            )
            WorkspaceStorage(root / "installation", state_dir=state).save_parent(
                workspace
            )
            environment = {
                "INFINITE_CANVAS_STATE_DIR": str(state),
            }

            output = io.StringIO()
            with patch.dict(os.environ, environment), redirect_stdout(output):
                self.assertEqual(main(["list"]), 0)

            self.assertIn("owner\tadmin\tactive", output.getvalue())
            self.assertFalse((workspace_data / "auth.db").exists())


if __name__ == "__main__":
    unittest.main()
