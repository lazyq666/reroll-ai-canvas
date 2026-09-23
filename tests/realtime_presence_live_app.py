"""Disposable real server for the LAZ-61 multi-account browser regression."""

import argparse
import os
import tempfile
from pathlib import Path

import uvicorn

from tests.runtime_env import configure_test_workspace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="reroll-presence-live-") as tmp:
        root = Path(tmp)
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(root / "state")
        os.environ["INFINITE_CANVAS_INSTANCE_STATE_DIR"] = str(root / "instance")
        configure_test_workspace(root / "workspace", root / "state")
        import main as application

        password = os.environ["PRESENCE_TEST_PASSWORD"]
        admin = application.AUTH_SYSTEM.create_user(
            username="presence_admin", password=password, role="admin",
            display_name="Presence Admin",
        )
        for index in range(1, 7):
            user = application.AUTH_SYSTEM.create_user(
                username=f"presence_designer_{index}", password=password,
                role="designer", display_name=f"Presence Designer {index}",
            )
            application.AUTH_SYSTEM.set_user_project_ids(
                user["id"], application.current_workspace_id(), ["default"],
                actor_id=admin["id"],
            )
        uvicorn.run(application.app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
