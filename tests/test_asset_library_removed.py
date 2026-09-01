import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AssetLibraryRemovalTests(unittest.TestCase):
    def test_standalone_asset_manager_files_are_deleted(self):
        for relative in (
            "static/asset-manager.html",
            "static/js/asset-manager.js",
            "static/css/asset-manager.css",
            "static/js/smart-canvas/asset-library.js",
            "static/js/smart-canvas/asset-library-model.js",
        ):
            self.assertFalse((ROOT / relative).exists(), relative)

    def test_internal_asset_library_api_is_removed(self):
        server = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        self.assertNotIn('"/api/asset-library', server)
        self.assertNotIn("ASSET_LIBRARY_PATH", server)
        self.assertNotIn("migrate_asset_library_into_dirs", server)
        self.assertNotIn('"/api/local-assets', server)
        self.assertNotIn('"/api/shared-folders', server)

    def test_canvas_pages_do_not_load_or_show_asset_library(self):
        classic = (ROOT / "static/canvas.html").read_text(encoding="utf-8")
        smart = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        classic_script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        smart_script = (ROOT / "static/js/smart-canvas.js").read_text(
            encoding="utf-8"
        )
        for source in (classic, smart, classic_script, smart_script):
            self.assertNotIn("/api/asset-library", source)
        self.assertNotIn("canvasAssetToggle", classic)
        self.assertNotIn("assetManagerModal", classic)
        self.assertNotIn("assetToggle", smart)
        self.assertNotIn("assetPanel", smart)
        self.assertNotIn("/smart-canvas/asset-library.js", smart)
        self.assertNotIn("素材库链接", smart_script)

    def test_workspace_migration_no_longer_copies_asset_catalog(self):
        workspace = (
            ROOT
            / "backend"
            / "infinite_canvas"
            / "workspace_storage.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn('"asset_library.json"', workspace)


if __name__ == "__main__":
    unittest.main()
