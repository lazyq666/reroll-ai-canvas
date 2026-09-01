import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = (
    ROOT / "static" / "js" / "infinite-canvas-ui" / "workspace-asset-library.js"
).read_text(encoding="utf-8")
SCRIPT = (ROOT / "static" / "js" / "smart-canvas.js").read_text(encoding="utf-8")
ASSET_SPEC = (
    ROOT / "docs" / "current" / "workspace-asset-library.md"
).read_text(encoding="utf-8")
UI_GUIDE = (
    ROOT / "docs" / "current" / "ui-design-guidelines.md"
).read_text(encoding="utf-8")


class Issue177WorkspaceAssetInsertTests(unittest.TestCase):
    def test_asset_card_contract_is_insertion_not_preview(self):
        self.assertIn("cursor:pointer", LIBRARY)
        self.assertNotIn("cursor:zoom-in", LIBRARY)
        self.assertIn("ic-asset-insert", LIBRARY)
        self.assertNotIn("ic-asset-open", LIBRARY)
        self.assertIn("smart.assetLibraryInsertAsset", LIBRARY)
        self.assertIn("workspaceAssetImageFromItem", SCRIPT)
        self.assertIn("createImageNodeAt(null, [image])", SCRIPT)
        self.assertIn("assetLibraryEntryId:String(item.id || '')", SCRIPT)

    def test_library_uses_prompt_library_style_sidebar_layout(self):
        self.assertIn(
            "grid-template-columns:calc(13 * var(--ui-space-4)) minmax(0,1fr)",
            LIBRARY,
        )
        self.assertIn('class="sidebar"', LIBRARY)
        self.assertIn('data-folder-id=""', LIBRARY)

    def test_current_authorities_describe_card_insertion(self):
        for document in (ASSET_SPEC, UI_GUIDE):
            self.assertIn("插入", document)
            self.assertNotIn("Pointer 点击 Card 打开预览", document)


if __name__ == "__main__":
    unittest.main()
