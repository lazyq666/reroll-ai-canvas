import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.runtime_env import configure_test_workspace, unload_main


class WorkspaceArtifactIntegrationTests(unittest.TestCase):
    def test_runtime_uses_selected_workspace_and_keeps_legacy_media_urls(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            data = workspace / "data"
            assets = workspace / "assets"
            state = root / "state"
            data.mkdir(parents=True)
            assets.mkdir()
            state.mkdir()
            configure_test_workspace(workspace, state)
            elsewhere = root / "other-working-directory"
            elsewhere.mkdir()
            unload_main()
            original = Path.cwd()
            try:
                with patch.dict(
                    os.environ,
                    {
                        "INFINITE_CANVAS_STATE_DIR": str(state),
                    },
                ):
                    main = importlib.import_module("main")
                    output = assets / "output" / "legacy-result.png"
                    output.write_bytes(b"legacy-result")
                    os.chdir(elsewhere)

                    self.assertEqual(
                        assets.resolve(),
                        Path(main.managed_media_directory()),
                    )
                    self.assertEqual(
                        output.resolve(),
                        Path(
                            main.output_file_from_url(
                                "/assets/output/legacy-result.png"
                            )
                        ),
                    )
                    self.assertEqual(
                        output.resolve(),
                        Path(
                            main.output_file_from_url(
                                "/api/storage-files/generated/"
                                "legacy-result.png"
                            )
                        ),
                    )
                    self.assertEqual(
                        (data / "available_models.json").resolve(),
                        Path(main.available_models_file()),
                    )
                    self.assertEqual(
                        (data / "update_staging").resolve(),
                        Path(main.update_staging_directory()),
                    )
                    self.assertEqual(
                        (data / "update_backups").resolve(),
                        Path(main.update_backup_directory()),
                    )
                    self.assertEqual(
                        (data / "recovery").resolve(),
                        Path(main.recovery_copy_directory()),
                    )
                    self.assertEqual(
                        (root / "cache" / "media-previews").resolve(),
                        Path(main.media_preview_directory()),
                    )
                    self.assertFalse(
                        Path(main.media_preview_directory()).is_relative_to(
                            workspace
                        )
                    )
            finally:
                os.chdir(original)
                unload_main()


if __name__ == "__main__":
    unittest.main()
