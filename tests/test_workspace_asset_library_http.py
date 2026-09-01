import importlib
import json
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from infinite_canvas.asset_library import AssetPublicationCandidate
from tests.runtime_env import configure_test_workspace, unload_main


class WorkspaceAssetLibraryHttpTests(unittest.TestCase):
    @staticmethod
    def png_bytes(color):
        output = BytesIO()
        Image.new("RGB", (2, 2), color).save(output, format="PNG")
        return output.getvalue()

    @staticmethod
    def login(client, username):
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": "workspace-password"},
        )
        if response.status_code != 200:
            raise AssertionError(response.text)

    def test_http_contract_hides_source_and_enforces_management_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            unload_main()
            try:
                with patch.dict(os.environ, {"INFINITE_CANVAS_STATE_DIR": str(state)}):
                    main = importlib.import_module("main")
                    for username, role in (
                        ("publisher", "designer"),
                        ("other", "designer"),
                        ("administrator", "admin"),
                        ("visitor", "guest"),
                    ):
                        main.AUTH_SYSTEM.create_user(
                            username=username,
                            password="workspace-password",
                            role=role,
                        )
                    candidate = AssetPublicationCandidate(
                        media_id="a" * 64,
                        media_url="/assets/output/shared.png",
                        name="共享图片",
                        project_id="secret-project",
                        canvas_id="secret-canvas",
                        node_id="secret-node",
                    )
                    with patch.object(
                        main,
                        "workspace_asset_candidate",
                        return_value=candidate,
                    ):
                        with TestClient(main.app) as publisher:
                            self.login(publisher, "publisher")
                            published = publisher.post(
                                "/api/workspace-assets/publish",
                                json={"items": [{"canvas_id": "one", "node_id": "two"}]},
                            )
                            self.assertEqual(200, published.status_code, published.text)
                            self.assertEqual(1, published.json()["created"])
                            entry_id = published.json()["entries"][0]["id"]
                            listing = publisher.get("/api/workspace-assets")
                            self.assertEqual(200, listing.status_code)
                            serialized = json.dumps(listing.json(), ensure_ascii=False)
                            self.assertNotIn("secret-project", serialized)
                            self.assertNotIn("secret-canvas", serialized)
                            self.assertNotIn("secret-node", serialized)
                            self.assertTrue(listing.json()["items"][0]["can_manage"])
                            folder = publisher.post(
                                "/api/workspace-assets/folders",
                                json={"name": "角色"},
                            )
                            self.assertEqual(200, folder.status_code, folder.text)
                            folder_id = folder.json()["folder"]["id"]
                            classified = publisher.patch(
                                f"/api/workspace-assets/{entry_id}",
                                json={"folder_id": folder_id},
                            )
                            self.assertEqual(200, classified.status_code, classified.text)
                            filtered = publisher.get(
                                "/api/workspace-assets",
                                params={"folder_id": folder_id},
                            )
                            self.assertEqual([entry_id], [item["id"] for item in filtered.json()["items"]])
                            imported = publisher.post(
                                "/api/workspace-assets/import",
                                data={"folder_id": folder_id},
                                files=[
                                    ("files", ("角色正面.png", self.png_bytes("red"), "image/png")),
                                    ("files", ("角色侧面.png", self.png_bytes("blue"), "image/png")),
                                    ("files", ("说明.txt", b"not-an-image", "text/plain")),
                                ],
                            )
                            self.assertEqual(200, imported.status_code, imported.text)
                            self.assertEqual(2, imported.json()["created"])
                            self.assertEqual(1, imported.json()["failed"])
                            imported_listing = publisher.get(
                                "/api/workspace-assets",
                                params={"folder_id": folder_id},
                            ).json()
                            self.assertEqual(3, len(imported_listing["items"]))
                            deleted_folder = publisher.delete(
                                f"/api/workspace-assets/folders/{folder_id}"
                            )
                            self.assertEqual(3, deleted_folder.json()["moved"])

                        with TestClient(main.app) as other:
                            self.login(other, "other")
                            self.assertEqual(
                                403,
                                other.patch(
                                    f"/api/workspace-assets/{entry_id}",
                                    json={"name": "越权改名"},
                                ).status_code,
                            )
                            self.assertEqual(
                                403,
                                other.delete(
                                    f"/api/workspace-assets/{entry_id}"
                                ).status_code,
                            )

                        with TestClient(main.app) as visitor:
                            self.login(visitor, "visitor")
                            self.assertEqual(
                                403,
                                visitor.get("/api/workspace-assets").status_code,
                            )

                        with TestClient(main.app) as administrator:
                            self.login(administrator, "administrator")
                            renamed = administrator.patch(
                                f"/api/workspace-assets/{entry_id}",
                                json={"name": "管理员改名"},
                            )
                            self.assertEqual(200, renamed.status_code)
                            self.assertEqual(
                                "管理员改名", renamed.json()["item"]["name"]
                            )
                            self.assertEqual(
                                200,
                                administrator.delete(
                                    f"/api/workspace-assets/{entry_id}"
                                ).status_code,
                            )
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
