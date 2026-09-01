import json
import unittest
from pathlib import Path

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


ROOT = Path(__file__).resolve().parents[1]


class UpdateSourceConfigurationTests(unittest.TestCase):
    def test_update_allowlist_includes_runtime_modules_and_excludes_user_data(self):
        for path in (
            "VERSION",
            "backend/launcher.py",
            "backend/main.py",
            "backend/infinite_canvas/api_settings_transfer.py",
            "backend/infinite_canvas/auth_system.py",
            "backend/infinite_canvas/canvas_permissions.py",
            "backend/infinite_canvas/canvas_list_index.py",
            "backend/infinite_canvas/canvas_realtime.py",
            "backend/infinite_canvas/device_cache.py",
            "backend/infinite_canvas/matting_capacity.py",
            "backend/infinite_canvas/matting_service.py",
            "backend/infinite_canvas/outbound_security.py",
            "requirements.lock.txt",
            "requirements.txt",
            "backend/infinite_canvas/workspace_storage.py",
            "resources/workflows/Z-Image.json",
            "backend/scripts/admin/manage_users.py",
            "backend/infinite_canvas/__init__.py",
            "backend/infinite_canvas/__main__.py",
            "backend/infinite_canvas/app.py",
            "backend/infinite_canvas/bootstrap.py",
            "backend/infinite_canvas/canvas_sync.py",
            "backend/infinite_canvas/connection_manager.py",
            "backend/infinite_canvas/realtime_presence.py",
            "backend/infinite_canvas/device_state.py",
            "backend/infinite_canvas/installation.py",
            "backend/infinite_canvas/instance_state.py",
            "backend/infinite_canvas/generation_settings.py",
            "backend/infinite_canvas/legacy_migration.py",
            "backend/infinite_canvas/providers/__init__.py",
            "backend/infinite_canvas/providers/cli_impl.py",
            "backend/infinite_canvas/providers/comfyui_impl.py",
            "backend/infinite_canvas/providers/core.py",
            "backend/infinite_canvas/providers/http_impl.py",
            "backend/infinite_canvas/providers/implementation.py",
            "backend/infinite_canvas/providers/inspection_impl.py",
            "backend/infinite_canvas/providers/inspector.py",
            "backend/infinite_canvas/providers/modelscope_impl.py",
            "backend/infinite_canvas/providers/ports.py",
            "backend/infinite_canvas/providers/runninghub_impl.py",
            "backend/infinite_canvas/providers/runtime.py",
            "backend/infinite_canvas/prompt_library.py",
            "backend/infinite_canvas/runtime.py",
            "backend/infinite_canvas/workspace.py",
            "backend/scripts/migrate_legacy_data.py",
            "static/index.html",
            "static/js/smart-canvas.js",
        ):
            with self.subTest(path=path):
                self.assertTrue(main.update_allowed_file(path))

        for path in (
            "API/.env",
            "data/auth.db",
            "local-state/workspace-storage.json",
            "assets/input/private.png",
            "backend/infinite_canvas/__pycache__/runtime.pyc",
            "backend/infinite_canvas/private.json",
            "../backend/main.py",
            "static/../API/.env",
        ):
            with self.subTest(path=path):
                self.assertFalse(main.update_allowed_file(path))

    def test_version_and_update_notes_versions_match(self):
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        notes = json.loads(
            (ROOT / "static/update-notes.json").read_text(encoding="utf-8")
        )
        self.assertEqual(notes["version"], version)


if __name__ == "__main__":
    unittest.main()
