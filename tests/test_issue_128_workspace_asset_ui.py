import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = (ROOT / "static" / "smart-canvas.html").read_text(encoding="utf-8")
SCRIPT = (ROOT / "static" / "js" / "smart-canvas.js").read_text(encoding="utf-8")
PICKER = (
    ROOT / "static" / "js" / "infinite-canvas-ui" / "mention-picker.js"
).read_text(encoding="utf-8")
LIBRARY = (
    ROOT / "static" / "js" / "infinite-canvas-ui" / "workspace-asset-library.js"
).read_text(encoding="utf-8")
AUTHORING = (
    ROOT / "static" / "js" / "smart-canvas" / "prompt-authoring.js"
).read_text(encoding="utf-8")
GENERATION = (
    ROOT / "static" / "js" / "smart-canvas" / "generation-run.js"
).read_text(encoding="utf-8")


class Issue128WorkspaceAssetUiTests(unittest.TestCase):
    def test_reference_picker_has_two_media_tabs_and_bounded_dom(self):
        self.assertIn("{value:'canvas', label:tr('smart.currentCanvas')}", SCRIPT)
        self.assertIn("{value:'assets', label:tr('smart.workspaceAssetLibrary')}", SCRIPT)
        self.assertNotIn("value.slice(0, 60)", PICKER)
        self.assertIn("columns:var(--ic-mention-picker-card-width, 5.625rem)", PICKER)
        self.assertIn('<div class="media-columns"></div>', PICKER)
        self.assertIn("const optionContainer = this.mediaMode", PICKER)
        self.assertIn("optionContainer.append(option)", PICKER)
        self.assertIn("<ic-segmented-control data-source-tabs", PICKER)
        self.assertIn('size="small"', PICKER)
        self.assertIn("inline-size:max-content", PICKER)
        self.assertIn("border-color:var(--ui-color-border-secondary)", PICKER)
        self.assertIn("border-color:var(--ui-color-border-focus)", PICKER)
        self.assertIn("border-radius:var(--ui-radius-xs)", PICKER)
        self.assertIn("box-shadow:var(--ui-shadow-raised)", PICKER)
        self.assertIn('.media-grid [part="option"]:hover,', PICKER)
        self.assertIn("color:var(--ui-color-text-white)", PICKER)
        self.assertIn("font-size:var(--ui-font-size-1)", PICKER)
        self.assertIn("font-weight:var(--ui-font-weight-regular)", PICKER)
        self.assertIn(
            "linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%)",
            PICKER,
        )
        self.assertIn("overflow-x:hidden", PICKER)
        self.assertIn("overflow-y:auto", PICKER)
        harness = (
            ROOT / "tests" / "infinite_canvas_ui_mention_picker_browser_harness.html"
        ).read_text(encoding="utf-8")
        self.assertIn("masonryUsesVerticalScroll", harness)
        self.assertIn("masonryScrollRemainsReversible", harness)
        self.assertIn("smartMediaPreviewUrl(img, 512)", SCRIPT)
        self.assertNotIn("smartMediaPreviewUrl(img, 256)", SCRIPT)
        self.assertIn("moveVisual(direction)", PICKER)
        self.assertIn("if (this.mediaMode &&", PICKER)
        self.assertIn("this.requestMore('keyboard')", PICKER)
        self.assertIn(
            "allCanvasCandidates.slice(0, mentionCanvasOffset + 60)", SCRIPT
        )
        self.assertIn(
            "mentionAssetItems = mentionAssetItems.concat(loadedItems.filter",
            SCRIPT,
        )
        self.assertNotIn("mentionPicker.setActiveIndex(0, {ensureVisible:true})", SCRIPT)

    def test_picker_uses_poster_images_and_one_manual_audio_player(self):
        self.assertNotIn("document.createElement('video')", PICKER)
        self.assertNotIn("document.createElement('audio')", PICKER)
        self.assertIn("const audio = new Audio(source)", PICKER)
        self.assertIn("option.addEventListener('pointerleave', () => this.stopAudio())", PICKER)
        self.assertIn("this._activeTab = next;", PICKER)
        self.assertIn("this.stopAudio();\n    this.dispatchEvent(new CustomEvent('ic-tab-change'", PICKER)

    def test_local_reference_upload_is_multi_file_and_target_frozen(self):
        self.assertIn('id="referenceFileInput"', PAGE)
        self.assertIn("text/plain,.txt,image/*,video/*,audio/*", PAGE)
        self.assertIn("multiple", PAGE)
        self.assertIn("referenceUploadTargetId = node.id", SCRIPT)
        self.assertIn("const targetId = referenceUploadTargetId", SCRIPT)
        self.assertIn("smart.referenceTargetMissing", SCRIPT)
        self.assertIn("bindLocalTextReferenceDrag", SCRIPT)

    def test_txt_prompt_order_and_generation_validation_are_explicit(self):
        self.assertIn(
            "promptAuthoringJoinUnique([groupPrompt, inputPrompt, localTextPrompt, body])",
            AUTHORING,
        )
        self.assertIn("本次生成合并的 TXT 文本超过 2MB", AUTHORING)
        self.assertIn("request.validationErrors?.length", GENERATION)
        self.assertIn("generationRunUnsupportedReferences", GENERATION)
        self.assertIn("smart.unsupportedReferences", GENERATION)

    def test_asset_management_modal_supports_search_pagination_and_batch_import(self):
        self.assertIn('id="workspaceAssetDialog"', PAGE)
        self.assertIn('aria-label="资产库"', PAGE)
        self.assertNotIn('aria-label="工作区资产库"', PAGE)
        self.assertIn('data-component-name="ic-form-field-search-s"', LIBRARY)
        self.assertIn('<ic-icon slot="start" name="search"></ic-icon>', LIBRARY)
        self.assertIn('size="s" background="ghost" icon="close"', LIBRARY)
        self.assertIn('data-search-clear', LIBRARY)
        self.assertIn("/api/workspace-assets?", LIBRARY)
        self.assertIn("limit: '60'", LIBRARY)
        self.assertIn("slice(-120)", LIBRARY)
        self.assertIn("loading=\"lazy\"", LIBRARY)
        self.assertIn('gap:var(--ui-space-1)', LIBRARY)
        self.assertIn('border-radius:var(--ui-radius-xs)', LIBRARY)
        self.assertIn('color:var(--ui-color-text-secondary)', LIBRARY)
        self.assertIn('font-size:var(--ui-font-size-2)', LIBRARY)
        self.assertIn('font-weight:var(--ui-font-weight-regular)', LIBRARY)
        self.assertIn('icon="edit"', LIBRARY)
        self.assertIn('icon="delete"', LIBRARY)
        self.assertIn('data-component-name="ic-form-field-text-s"', LIBRARY)
        self.assertIn('data-delete-confirmation', LIBRARY)
        self.assertIn('consequence="destructive"', LIBRARY)
        self.assertIn("从资产库移除", LIBRARY)
        self.assertIn("画布中的图片和已经插入的引用不受影响", LIBRARY)
        self.assertNotIn("取消共享", LIBRARY)
        self.assertNotIn('class="confirm"', LIBRARY)
        self.assertIn("moveCardFocus", LIBRARY)
        self.assertIn("data-import-trigger", LIBRARY)
        self.assertIn("data-import-input", LIBRARY)
        self.assertIn('accept="image/*" multiple', LIBRARY)
        self.assertIn("/api/workspace-assets/import", LIBRARY)
        self.assertIn("data-folder-new", LIBRARY)
        self.assertIn("data-folder-id", LIBRARY)
        self.assertIn("application/x-workspace-asset", LIBRARY)
        self.assertIn("/api/workspace-assets/folders", LIBRARY)
        self.assertNotIn("insertWorkspaceAssetsIntoCanvas", SCRIPT)

    def test_asset_actions_use_product_language(self):
        self.assertIn("smart.addToAssetLibrary", SCRIPT)
        self.assertIn("smart.addedBy", SCRIPT)
        self.assertNotIn("发布到工作区资产库", SCRIPT)
        self.assertNotIn("已发布到工作区资产库", SCRIPT)

    def test_asset_source_metadata_survives_reference_snapshots(self):
        self.assertIn("media_id:ref.media_id || ref.mediaId", SCRIPT)
        self.assertIn("assetLibraryEntryId:ref.assetLibraryEntryId", SCRIPT)
        self.assertIn("sourceNodeTitle:ref.sourceNodeTitle", SCRIPT)


if __name__ == "__main__":
    unittest.main()
