import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CanvasShareUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/share.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/canvas-share.css").read_text(encoding="utf-8")
        cls.smart_style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.script = (ROOT / "static/js/canvas-share.js").read_text(encoding="utf-8")
        cls.node_shared = (ROOT / "static/js/infinite-canvas-ui/nodes/shared.js").read_text(encoding="utf-8")
        cls.containers = (ROOT / "static/js/infinite-canvas-ui/containers-data.js").read_text(encoding="utf-8")

    def test_shared_images_use_original_media_names(self):
        self.assertIn("const mediaName = (item, node, url)", self.script)
        self.assertIn("item?.name || item?.filename", self.script)
        self.assertIn("fileNameFromUrl(url)", self.script)
        self.assertNotIn("const meaningfulName", self.script)
        self.assertNotIn("/^[a-f\\d]{32}$/i", self.script)
        self.assertNotIn("node.title || node.name || node.type", self.script)

    def test_every_shared_node_role_uses_the_public_node_family(self):
        for kind in (
            "'image'", "'generation'", "'prompt'", "'prompt-generation'",
            "'splitter'", "'loop'", "'smart-group'", "'frame'",
            "'text-annotation'", "'brush-stroke'",
        ):
            self.assertIn(kind, self.script)
        self.assertIn("const renderNode = (record, lodMode) =>", self.script)
        self.assertIn("family.render({", self.script)
        self.assertIn("element.classList.add('share-node')", self.script)
        self.assertNotIn("document.createElement('article')", self.script)
        self.assertNotIn("share-structure-card", self.script)

    def test_prompt_content_uses_public_read_only_node_and_composer(self):
        self.assertIn("const isPromptNode", self.script)
        self.assertNotIn(
            "const renderNode = (node, index) => {\n    if (isPromptNode(node)) return;",
            self.script,
        )
        self.assertIn("window.InfiniteCanvasUiNodeComponents", self.script)
        self.assertIn("family.render({", self.script)
        self.assertIn("family.renderReadOnlyPromptBody({", self.script)
        self.assertIn("renderReadOnlyPromptNodeBodyMarkup", self.node_shared)
        self.assertIn("<ic-prompt-composer", self.node_shared)
        self.assertIn('contenteditable="false"', self.node_shared)
        self.assertIn('/static/css/smart-canvas.css?v=', self.page)
        self.assertNotIn("share-prompt-card", self.style)
        self.assertIn("node?.promptDraftText", self.script)
        self.assertIn("node?.prompt", self.script)

    def test_ready_media_fallback_is_hidden_without_inline_style(self):
        self.assertIn("state === 'ready' ? ' hidden' : ''", self.containers)

    def test_read_only_composer_is_browse_only(self):
        self.assertIn('id="share-composer" class="composer"', self.page)
        self.assertIn('<div class="composer-card">', self.page)
        self.assertIn('id="promptInput" contenteditable="false"', self.page)
        self.assertNotIn('class="composer-focus-toggle"', self.page)
        self.assertNotIn('class="param-row"', self.page)
        self.assertNotIn('class="composer-actions"', self.page)
        self.assertNotIn("只读 Composer", self.page)
        self.assertNotIn("share-composer-head", self.page)
        self.assertIn("openReadonlyComposer", self.script)
        self.assertIn("clearReadonlySelection", self.script)
        self.assertIn("element?.classList.add('selected')", self.script)
        self.assertIn("clearReadonlySelection(); drag =", self.script)
        self.assertNotIn("share-node-selected", self.script)
        self.assertNotIn("share-node-selected", self.style)
        self.assertIn("readonlyComposerEditor.setAttribute('contenteditable', 'false')", self.script)
        self.assertNotIn("closeReadonlyComposer", self.script)
        self.assertNotIn("method: 'POST'", self.script)
        self.assertNotIn("method: 'PUT'", self.script)
        self.assertNotIn("method: 'PATCH'", self.script)
        self.assertNotIn("method: 'DELETE'", self.script)

    def test_shared_images_reuse_production_geometry_and_media_dom(self):
        self.assertIn('/static/js/smart-canvas/node-geometry.js?v=', self.page)
        self.assertIn('/static/js/smart-image-resolution.js?v=', self.page)
        self.assertIn('/static/js/smart-canvas/canvas-level-of-detail.js?v=', self.page)
        self.assertIn('/static/js/smart-canvas/canvas-virtualization.js?v=', self.page)
        self.assertIn('/static/js/smart-canvas/canvas-far-presentation.js?v=', self.page)
        self.assertIn('sharedGeometrySession = window.SmartCanvasModules?.nodeGeometry?.createSession(canvas)', self.script)
        self.assertIn('window.SmartCanvasModules?.canvasLevelOfDetail', self.script)
        self.assertIn('window.SmartCanvasModules?.canvasVirtualization', self.script)
        self.assertIn('window.SmartCanvasModules?.canvasFarPresentation', self.script)
        self.assertIn('SmartImageResolution.choosePreviewSize({', self.script)
        self.assertIn("searchParams.set('w', String(width))", self.script)
        self.assertIn('class="node-img"', self.script)
        self.assertIn('class="thumb-media-frame"', self.script)
        self.assertIn(
            '.image-node:is([kind="image"],[kind="generation"]):not(.empty-node) .image-wrap > .node-img',
            self.smart_style,
        )
        self.assertNotIn('<ic-media-container', self.script)
        self.assertNotIn('const mediaFallbackSize', self.script)

    def test_share_canvas_uses_the_shared_far_presentation_module(self):
        far_module = (
            ROOT / "static/js/smart-canvas/canvas-far-presentation.js"
        ).read_text(encoding="utf-8")
        smart_script = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        self.assertIn("root.SmartCanvasModules.canvasFarPresentation", far_module)
        self.assertIn("canvasFarPresentation.render({", smart_script)
        self.assertIn("canvasFarPresentation.render({", self.script)
        self.assertNotIn("function farPromptSkeletonLineCount", smart_script)

    def test_smart_frames_are_rendered_in_read_only_canvas(self):
        self.assertIn("const isFrameNode", self.script)
        self.assertIn("const DEFAULT_FRAME_COLOR = 'slate'", self.script)
        self.assertIn("return FRAME_COLORS.has(color) ? color : DEFAULT_FRAME_COLOR", self.script)
        self.assertIn("if (isFrameNode(node)) return 'frame'", self.script)
        self.assertIn("if (kind === 'frame') element.classList.add('share-frame-node')", self.script)
        self.assertIn("frameColor:frameColor(node)", self.script)
        self.assertIn(".share-frame-node {", self.style)
        self.assertIn(".minimap-frame {", self.style)

    def test_structural_nodes_reuse_existing_read_only_surfaces(self):
        self.assertIn('class="smart-group-card', self.script)
        self.assertIn('class="splitter-node-card"', self.script)
        self.assertIn('class="loop-smart-card', self.script)
        self.assertIn('class="reference-generation-target"', self.script)
        self.assertIn('class="reference-generation-target node-drop-readonly"', self.script)
        self.assertIn("control.setAttribute('disabled', '')", self.script)

    def test_share_assets_are_cache_busted_together(self):
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertIn(f"/static/css/canvas-share.css?v={version}.", self.page)
        self.assertIn(f"/static/js/canvas-share.js?v={version}.", self.page)


if __name__ == "__main__":
    unittest.main()
