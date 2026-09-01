import tempfile
import unittest
from pathlib import Path

from infinite_canvas.asset_library import (
    AssetLibraryBatchError,
    AssetLibraryError,
    AssetPublicationCandidate,
    WorkspaceAssetLibrary,
)


class WorkspaceAssetLibraryTests(unittest.TestCase):
    @staticmethod
    def candidate(root: Path, key: str, name: str) -> AssetPublicationCandidate:
        path = root / f"{key}.png"
        path.write_bytes(f"image-{key}".encode("utf-8"))
        return AssetPublicationCandidate.from_file(
            path,
            media_url=f"/assets/output/{key}.png",
            name=name,
            project_id="private-project",
            canvas_id="private-canvas",
            node_id=f"node-{key}",
        )

    def test_publish_is_content_idempotent_and_keeps_first_publisher(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(root / "workspace_asset_library.json")
            first = self.candidate(root, "same", "第一版名称")

            created = library.publish(
                [first], {"id": "user-a", "username": "A", "role": "designer"}
            )
            duplicate = library.publish(
                [first], {"id": "user-b", "username": "B", "role": "designer"}
            )

            self.assertEqual((1, 0), (created["created"], created["existing"]))
            self.assertEqual((0, 1), (duplicate["created"], duplicate["existing"]))
            item = library.list(
                {"id": "user-b", "username": "B", "role": "designer"}
            )["items"][0]
            self.assertEqual("A", item["publisher"])
            self.assertFalse(item["can_manage"])

    def test_capacity_failure_is_atomic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(
                root / "workspace_asset_library.json", capacity=1
            )
            actor = {"id": "owner", "username": "Owner", "role": "designer"}
            candidates = [
                self.candidate(root, "one", "一"),
                self.candidate(root, "two", "二"),
            ]

            with self.assertRaises(AssetLibraryBatchError) as raised:
                library.publish(candidates, actor)

            self.assertEqual("capacity_exceeded", raised.exception.code)
            self.assertEqual(
                "资产库最多可保存 1 项；本次没有添加任何图片",
                str(raised.exception),
            )
            self.assertEqual(0, raised.exception.result["created"])
            self.assertEqual([], library.list(actor)["items"])

    def test_search_uses_nfkc_casefold_and_cursor_freezes_new_publications(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(root / "workspace_asset_library.json")
            actor = {"id": "owner", "username": "Owner", "role": "designer"}
            library.publish(
                [
                    self.candidate(root, "one", "Ａlpha"),
                    self.candidate(root, "two", "alpha two"),
                    self.candidate(root, "three", "Other"),
                ],
                actor,
            )

            first = library.list(actor, query="alpha", limit=1)
            library.publish([self.candidate(root, "new", "Alpha newest")], actor)
            second = library.list(
                actor, query="alpha", cursor=first["next_cursor"], limit=1
            )

            self.assertEqual(1, len(first["items"]))
            self.assertEqual(1, len(second["items"]))
            self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
            self.assertNotEqual("Alpha newest", second["items"][0]["name"])

    def test_public_shape_hides_source_and_management_requires_publisher_or_admin(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(root / "workspace_asset_library.json")
            owner = {"id": "owner", "username": "Owner", "role": "designer"}
            other = {"id": "other", "username": "Other", "role": "designer"}
            admin = {"id": "admin", "username": "Admin", "role": "admin"}
            entry = library.publish([self.candidate(root, "one", "一")], owner)[
                "entries"
            ][0]

            self.assertNotIn("source", repr(entry))
            self.assertNotIn("private-project", repr(entry))
            with self.assertRaises(AssetLibraryError) as denied:
                library.rename(entry["id"], "其他人改名", other)
            self.assertEqual("forbidden", denied.exception.code)
            self.assertEqual("只有添加者或管理员可以修改名称", str(denied.exception))

            with self.assertRaises(AssetLibraryError) as remove_denied:
                library.unpublish(entry["id"], other)
            self.assertEqual("forbidden", remove_denied.exception.code)
            self.assertEqual(
                "只有添加者或管理员可以从资产库移除这张图片",
                str(remove_denied.exception),
            )

            renamed = library.rename(entry["id"], "管理员改名", admin)
            self.assertEqual("管理员改名", renamed["name"])
            removed = library.unpublish(entry["id"], admin)
            self.assertEqual(1, removed["removed"])
            self.assertTrue((root / "one.png").exists())

    def test_folders_filter_classify_and_delete_without_removing_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(root / "workspace_asset_library.json")
            actor = {"id": "owner", "username": "Owner", "role": "designer"}
            published = library.publish(
                [
                    self.candidate(root, "one", "角色"),
                    self.candidate(root, "two", "场景"),
                ],
                actor,
            )
            folder = library.create_folder("角色资产", actor)
            moved = library.classify(published["entries"][0]["id"], folder["id"], actor)

            self.assertEqual(folder["id"], moved["folder_id"])
            listing = library.list(actor, folder_id=folder["id"])
            self.assertEqual(["角色"], [item["name"] for item in listing["items"]])
            self.assertEqual(2, listing["all_count"])
            self.assertEqual(1, listing["folders"][0]["item_count"])

            removed = library.delete_folder(folder["id"], actor)
            self.assertEqual(1, removed["moved"])
            all_items = library.list(actor)["items"]
            self.assertEqual({"角色", "场景"}, {item["name"] for item in all_items})
            self.assertTrue((root / "one.png").exists())

    def test_legacy_catalog_without_folders_remains_readable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            library = WorkspaceAssetLibrary(root / "workspace_asset_library.json")
            actor = {"id": "owner", "username": "Owner", "role": "designer"}
            library.publish([self.candidate(root, "one", "旧素材")], actor)
            payload = library._load()
            payload.pop("folders", None)
            payload["version"] = 1
            library._save(payload)

            listing = library.list(actor)
            self.assertEqual("旧素材", listing["items"][0]["name"])
            self.assertEqual([], listing["folders"])


if __name__ == "__main__":
    unittest.main()
