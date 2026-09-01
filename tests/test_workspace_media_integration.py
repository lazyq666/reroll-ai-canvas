import asyncio
import importlib
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from starlette.datastructures import Headers, UploadFile

from tests.runtime_env import configure_test_workspace, unload_main


class WorkspaceMediaIntegrationTests(unittest.TestCase):
    def test_reference_upload_accepts_known_extension_without_a_mime_hint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            unload_main()
            try:
                with patch.dict(os.environ, {"INFINITE_CANVAS_STATE_DIR": str(state)}):
                    main = importlib.import_module("main")
                    image = UploadFile(
                        BytesIO(b"portable-image"),
                        filename="reference.png",
                    )

                    result = asyncio.run(main.upload_ai_reference([image]))

                    self.assertEqual(1, result["success_count"])
                    self.assertEqual(0, result["failed_count"])
                    self.assertEqual("image", result["files"][0]["kind"])
            finally:
                unload_main()

    def test_uploaded_video_is_managed_once_and_resolves_for_generation(self):
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
            unload_main()
            try:
                with patch.dict(
                    os.environ,
                    {
                        "INFINITE_CANVAS_STATE_DIR": str(state),
                    },
                ):
                    main = importlib.import_module("main")
                    headers = Headers({"content-type": "video/mp4"})
                    first = UploadFile(
                        BytesIO(b"portable-video"),
                        filename="first.mp4",
                        headers=headers,
                    )
                    duplicate = UploadFile(
                        BytesIO(b"portable-video"),
                        filename="duplicate.mp4",
                        headers=headers,
                    )

                    result = asyncio.run(
                        main.upload_ai_reference([first, duplicate])
                    )

                    self.assertEqual(2, len(result["files"]))
                    self.assertEqual(
                        result["files"][0]["url"],
                        result["files"][1]["url"],
                    )
                    self.assertEqual("video", result["files"][0]["kind"])
                    self.assertNotIn(str(root), repr(result["files"]))
                    resolved = main.output_file_from_url(
                        result["files"][0]["url"]
                    )
                    self.assertEqual(
                        b"portable-video",
                        Path(resolved).read_bytes(),
                    )
                    self.assertEqual(
                        1,
                        len(
                            list(
                                (
                                    assets / "input" / "imported"
                                ).iterdir()
                            )
                        ),
                    )
                    asset_library = asyncio.run(
                        main.list_storage_files(
                            kind="upload",
                            offset=0,
                            limit=80,
                        )
                    )
                    self.assertEqual(1, asset_library["total"])
                    self.assertEqual(
                        "video",
                        asset_library["items"][0]["media_kind"],
                    )
            finally:
                unload_main()

    def test_reference_upload_keeps_successes_when_another_file_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            unload_main()
            try:
                with patch.dict(os.environ, {"INFINITE_CANVAS_STATE_DIR": str(state)}):
                    main = importlib.import_module("main")
                    text = UploadFile(
                        BytesIO("第一段\n第二段".encode("utf-16")),
                        filename="notes.txt",
                        headers=Headers({"content-type": "text/plain"}),
                    )
                    unsupported = UploadFile(
                        BytesIO(b"not-a-supported-reference"),
                        filename="manual.pdf",
                        headers=Headers({"content-type": "application/pdf"}),
                    )

                    result = asyncio.run(main.upload_ai_reference([text, unsupported]))

                    self.assertEqual(1, result["success_count"])
                    self.assertEqual(1, result["failed_count"])
                    self.assertEqual("text", result["files"][0]["kind"])
                    self.assertEqual("第一段\n第二段", result["files"][0]["text_snapshot"])
                    self.assertEqual("", result["files"][0]["text_error"])
                    self.assertEqual(1, result["failures"][0]["index"])
                    self.assertIn("manual.pdf", result["failures"][0]["name"])
            finally:
                unload_main()

    def test_oversized_txt_is_preserved_with_an_explicit_generation_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            unload_main()
            try:
                with patch.dict(os.environ, {"INFINITE_CANVAS_STATE_DIR": str(state)}):
                    main = importlib.import_module("main")
                    oversized = UploadFile(
                        BytesIO(b"a" * (1024 * 1024 + 1)),
                        filename="oversized.txt",
                        headers=Headers({"content-type": "text/plain"}),
                    )

                    result = asyncio.run(main.upload_ai_reference([oversized]))

                    self.assertEqual(1, result["success_count"])
                    self.assertEqual("", result["files"][0]["text_snapshot"])
                    self.assertIn("1MB", result["files"][0]["text_error"])
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
