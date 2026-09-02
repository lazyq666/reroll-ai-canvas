import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE_KINDS = ROOT / "static/js/smart-canvas/node-kinds.js"
NODE_SHARED = ROOT / "static/js/infinite-canvas-ui/nodes/shared.js"
NODE_COMPONENT = ROOT / "static/js/infinite-canvas-ui/nodes/node.js"
MULTI_SELECTION_COMPONENT = ROOT / "static/js/infinite-canvas-ui/nodes/multi-selection.js"
PROMPT_FOCUS_SURFACE_COMPONENT = ROOT / "static/js/infinite-canvas-ui/nodes/prompt-focus-surface.js"
NODE_ENTRY = ROOT / "static/js/infinite-canvas-ui/nodes.js"
CORE = ROOT / "static/js/infinite-canvas-ui/core.js"
SMART_CANVAS = ROOT / "static/js/smart-canvas.js"
CANVAS_PERSISTENCE = ROOT / "static/js/smart-canvas/canvas-persistence.js"
NODE_REVIEW_FIXTURE = ROOT / "static/js/smart-canvas/node-review-fixture.js"
SMART_CANVAS_PAGE = ROOT / "static/smart-canvas.html"
LIBRARY_PAGE = ROOT / "static/ui-component-library.html"
LIBRARY_APP = ROOT / "static/js/ui-component-library/surface-app.js"
LIBRARY_CSS = ROOT / "static/css/ui-component-library.css"
NODES_CONTRACT = ROOT / "static/design-system/infinite-canvas-ui/ic-nodes-v1.json"
SURFACE_MANIFEST = ROOT / "static/design-system/infinite-canvas-ui/surface-manifest.json"


class SmartCanvasNodeComponentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node_kinds = NODE_KINDS.read_text(encoding="utf-8")
        cls.node_shared = NODE_SHARED.read_text(encoding="utf-8")
        cls.node_component = NODE_COMPONENT.read_text(encoding="utf-8")
        cls.multi_selection_component = MULTI_SELECTION_COMPONENT.read_text(encoding="utf-8")
        cls.prompt_focus_surface_component = PROMPT_FOCUS_SURFACE_COMPONENT.read_text(encoding="utf-8")
        cls.node_entry = NODE_ENTRY.read_text(encoding="utf-8")
        cls.core = CORE.read_text(encoding="utf-8")
        cls.smart_canvas = SMART_CANVAS.read_text(encoding="utf-8")
        cls.canvas_persistence = CANVAS_PERSISTENCE.read_text(encoding="utf-8")
        cls.node_review_fixture = NODE_REVIEW_FIXTURE.read_text(encoding="utf-8")
        cls.smart_canvas_page = SMART_CANVAS_PAGE.read_text(encoding="utf-8")
        cls.library_page = LIBRARY_PAGE.read_text(encoding="utf-8")
        cls.library_app = LIBRARY_APP.read_text(encoding="utf-8")
        cls.library_css = LIBRARY_CSS.read_text(encoding="utf-8")
        cls.nodes_contract = json.loads(NODES_CONTRACT.read_text(encoding="utf-8"))
        cls.surface_manifest = json.loads(SURFACE_MANIFEST.read_text(encoding="utf-8"))

    def run_node_interface(self):
        script = f"""
            globalThis.window = globalThis;
            await import({json.dumps(NODE_KINDS.as_uri())});
            const ui = await import({json.dumps(NODE_SHARED.as_uri())});
            const roles = window.SmartCanvasModules.nodeKinds.catalog().map(item => item.role);
            const samples = roles.map((kind, index) => ui.renderCanvasNodeMarkup({{
                id:`sample-${{kind}}`, kind, title:kind,
                layout:{{width:300 + index,height:180}},
                states:{{selected:index === 0}}, body:'<span>body</span>',
                controls:{{resizable:true,quickAdd:{{out:{{label:'Add output'}},in:{{label:'Add input'}}}}}}
            }}));
            let unknownError = '';
            try {{ ui.renderCanvasNodeMarkup({{id:'unknown',kind:'unknown',title:'Unknown'}}); }}
            catch (error) {{ unknownError = error.message; }}
            process.stdout.write(JSON.stringify({{
                roles,
                uiKinds:ui.CANVAS_NODE_KINDS,
                samples,
                readOnlyPromptBody:ui.renderReadOnlyPromptNodeBodyMarkup({{content:'👨‍👩‍👧‍👦',characterCountUnit:'字符'}}),
                unknownError
            }}));
        """
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_domain_catalog_and_ui_family_cover_the_same_ten_roles(self):
        result = self.run_node_interface()
        expected = [
            "image",
            "generation",
            "prompt",
            "prompt-generation",
            "splitter",
            "loop",
            "smart-group",
            "frame",
            "text-annotation",
            "brush-stroke",
        ]
        self.assertEqual(result["roles"], expected)
        self.assertEqual(result["uiKinds"], expected)

    def test_render_interface_owns_the_shared_shell_and_rejects_unknown_roles(self):
        result = self.run_node_interface()
        for kind, markup in zip(result["roles"], result["samples"]):
            with self.subTest(kind=kind):
                self.assertIn("<ic-canvas-node", markup)
                self.assertIn(f'kind="{kind}"', markup)
                self.assertIn('class="image-node ', markup)
                self.assertIn('<div class="node-body"><span>body</span></div>', markup)
                self.assertIn('class="node-resize-handle"', markup)
                self.assertIn('class="node-resize-handle-shape"', markup)
                self.assertIn('viewBox="0 0 18 18"', markup)
                self.assertIn('d="M1.5 16.5H2A13.5 13.5 0 0 0 16.5 2v-.5"', markup)
                self.assertEqual(markup.count('data-node-quick-add'), 2)
        frame_markup = result["samples"][result["roles"].index("frame")]
        self.assertIn('frame-color="slate"', frame_markup)
        self.assertIn('data-frame-color="slate"', frame_markup)
        self.assertEqual(result["unknownError"], "Unknown Canvas Node kind: unknown")
        self.assertIn("1 字符", result["readOnlyPromptBody"])

    def test_frame_component_uses_slate_as_its_default_color(self):
        self.assertIn("CANVAS_FRAME_DEFAULT_COLOR = 'slate'", self.node_shared)
        self.assertIn("frameColor || CANVAS_FRAME_DEFAULT_COLOR", self.node_shared)
        self.assertIn("frameColor || CANVAS_FRAME_DEFAULT_COLOR", self.node_component)

    def test_public_family_entry_registers_all_node_components(self):
        self.assertIn("export { IcCanvasNode }", self.node_entry)
        self.assertIn("export { IcCanvasMultiSelection }", self.node_entry)
        self.assertIn("export { IcPromptNodeFocusSurface }", self.node_entry)
        self.assertIn("class IcCanvasNode extends HTMLElement", self.node_component)
        self.assertIn("class IcCanvasMultiSelection extends HTMLElement", self.multi_selection_component)
        self.assertIn("class IcPromptNodeFocusSurface extends HTMLElement", self.prompt_focus_surface_component)
        self.assertIn("define('ic-canvas-node', IcCanvasNode)", self.core)
        self.assertIn("define('ic-canvas-multi-selection', IcCanvasMultiSelection)", self.core)
        self.assertIn("define('ic-prompt-node-focus-surface', IcPromptNodeFocusSurface)", self.core)
        self.assertIn("globalThis.InfiniteCanvasUiNodeComponents", self.core)
        self.assertIn("render: renderCanvasNodeMarkup", self.core)
        self.assertIn("renderReadOnlyPromptBody: renderReadOnlyPromptNodeBodyMarkup", self.core)
        self.assertIn("renderReadOnlyPromptNodeBodyMarkup", self.node_shared)
        self.assertNotIn("bindPreviewInteractions", self.core)
        self.assertIn("return ['kind', 'state', 'frame-color', 'data-id', 'aria-label'];", self.node_component)

    def test_ready_image_node_owns_a_transparent_media_container_shell(self):
        image_rule = self.node_component.split(
            ':host([kind="image"]:not([state~="empty"]):not([state~="failed"])) {', 1
        )[1].split("}", 1)[0]
        self.assertIn('border:var(--ui-border-width-thin) solid var(--ui-color-border-nodes);', self.node_component)
        self.assertIn(
            ':host([kind="image"]:not([state~="empty"]):not([state~="failed"]))',
            self.node_component,
        )
        self.assertIn('padding:2px;', image_rule)
        self.assertIn('border:1px solid var(--ui-color-border-nodes);', image_rule)
        self.assertIn('border-radius:var(--ui-radius-s);', image_rule)
        self.assertIn('background:transparent;', image_rule)
        self.assertNotIn('background:var(--ui-color-surface);', image_rule)
        self.assertIn('box-shadow:var(--ui-shadow-raised);', image_rule)
        self.assertIn(':host(.selected:not([kind="text-annotation"]):not([kind="brush-stroke"]))::before', self.node_component)
        self.assertIn('border:var(--ui-border-width-strong) solid var(--ui-color-border-focus);', self.node_component)

    def test_versioned_contract_records_the_shell_seam_without_absorbing_canvas_logic(self):
        component = self.nodes_contract["components"][0]
        self.assertEqual(component["tag"], "ic-canvas-node")
        self.assertEqual(len(component["kinds"]), 10)
        self.assertEqual(
            component["ownership"]["family"],
            "shared shell, kind and state presentation, read-only Prompt body markup, resize and quick-add control markup, multi-selection overlay presentation and contract validation",
        )
        self.assertEqual(
            component["readOnlyPromptBodyInterface"]["export"],
            "renderReadOnlyPromptNodeBodyMarkup",
        )
        multi_selection = self.nodes_contract["components"][1]
        self.assertEqual(multi_selection["tag"], "ic-canvas-multi-selection")
        self.assertEqual(multi_selection["methods"], ["isResizeEvent(event)"])
        prompt_focus_surface = self.nodes_contract["components"][2]
        self.assertEqual(prompt_focus_surface["tag"], "ic-prompt-node-focus-surface")
        self.assertEqual(prompt_focus_surface["events"], ["ic-dismiss"])
        self.assertIn("Canvas Mutation", component["ownership"]["smartCanvas"])
        self.assertEqual(self.nodes_contract["liveMatrix"]["caseCount"], 22)
        self.assertEqual(self.nodes_contract["liveMatrix"]["labelNodeCount"], 10)
        nodes_surface = self.surface_manifest["surfaces"]["target"]["nodes"]
        self.assertEqual(nodes_surface["contractReviewStatus"], "confirmed")
        self.assertEqual(nodes_surface["implementationStatus"], "implemented")
        self.assertEqual(
            nodes_surface["components"],
            ["ic-canvas-node", "ic-canvas-multi-selection", "ic-prompt-node-focus-surface"],
        )

    def test_production_canvas_consumes_the_node_family_for_every_role(self):
        render_start = self.smart_canvas.index("function render(options={})")
        render_end = self.smart_canvas.index("function measureSmartNodeImages", render_start)
        render_source = self.smart_canvas[render_start:render_end]
        self.assertIn("const nodeRole = nodeKinds.roleOf(node);", render_source)
        self.assertIn("smartCanvasNodeComponentFamily().render({", render_source)
        self.assertIn("controls:{", render_source)
        self.assertNotIn("resizeControl:", render_source)
        active_node_render = render_source[: render_source.index("return {node, html};")]
        self.assertNotIn('<ic-icon-button class="smart-node-quick-add"', active_node_render)
        self.assertNotIn('const html = `<div class="image-node', render_source)
        self.assertIn('/static/js/infinite-canvas-ui/core.js?v=', self.smart_canvas_page)

    def test_ui_component_library_has_a_nodes_category_and_real_preview(self):
        self.assertIn('label="节点" secondary-label="Nodes"', self.library_page)
        self.assertIn('data-target-review="nodes"', self.library_page)
        self.assertIn('data-nodes-matrix', self.library_page)
        self.assertIn('smart-canvas.html?componentReview=nodes', self.library_page)
        self.assertIn("nodes: '节点'", self.library_app)
        self.assertIn("const showNodes = name === 'nodes';", self.library_app)
        self.assertIn("if (nodesMatrix) nodesMatrix.hidden = !showNodes;", self.library_app)

    def test_nodes_review_uses_the_production_canvas_with_data_only_fixture(self):
        self.assertIn("smartCanvasNodeReviewMode", self.smart_canvas)
        self.assertIn("loadSmartCanvasNodeReview", self.smart_canvas)
        self.assertIn("canvasPersistence.startTransientSession({document:canvas})", self.smart_canvas)
        self.assertIn("startTransientSession", self.canvas_persistence)
        self.assertIn("node-review-fixture.js", self.smart_canvas_page)
        self.assertIn("canvasPersistenceTransientSession", self.canvas_persistence)
        self.assertIn("if(canvasPersistenceTransientSession) return true;", self.canvas_persistence)
        self.assertNotIn("renderCanvasNodeMarkup", self.node_review_fixture)
        self.assertNotIn("addEventListener", self.node_review_fixture)
        self.assertNotIn("<ic-canvas-node", self.node_review_fixture)
        for kind in (
            "smart-image",
            "smart-prompt",
            "smart-splitter",
            "smart-loop",
            "smart-group",
            "smart-frame",
            "smart-text",
            "smart-brush",
        ):
            with self.subTest(kind=kind):
                self.assertIn(f"type:'{kind}'", self.node_review_fixture)
        self.assertEqual(self.node_review_fixture.count("id:'review-label-"), 10)
        self.assertEqual(self.node_review_fixture.count("id:'review-"), 37)
        self.assertIn("url:'/static/images/test/fixture.svg'", self.node_review_fixture)
        self.assertIn("id:'review-prompt-generation-upstream-image'", self.node_review_fixture)
        self.assertIn("{from:'review-image-ready',to:'review-prompt-generation-upstream-image',kind:'input'}", self.node_review_fixture)
        self.assertIn("const SMART_UPLOAD_MAX_BYTES = 500 * 1024 * 1024", self.smart_canvas)
        self.assertIn("title=\"${escapeAttr(tr('smart.uploadNodeTitle'))}\"", self.smart_canvas)
        self.assertIn("max-size=\"${SMART_UPLOAD_MAX_BYTES}\"", self.smart_canvas)
        self.assertIn("beginNodeDrag(e);", self.smart_canvas)
        self.assertIn("id:'review-image-video'", self.node_review_fixture)
        self.assertIn("id:'review-image-audio'", self.node_review_fixture)
        self.assertEqual(
            self.node_review_fixture.count("/static/images/test/fixture.mp4"),
            2,
        )
        self.assertIn("kind:'video'", self.node_review_fixture)
        self.assertIn("kind:'audio'", self.node_review_fixture)
        self.assertIn("id:'review-generation-image'", self.node_review_fixture)
        self.assertIn("id:'review-generation-video'", self.node_review_fixture)
        self.assertIn("id:'review-generation-pending'", self.node_review_fixture)
        self.assertIn("id:'review-generation-result'", self.node_review_fixture)
        self.assertIn('<i data-lucide="zap" aria-hidden="true"></i>', self.smart_canvas)
        self.assertIn('<ic-icon name="error" size="medium" aria-hidden="true"></ic-icon>', self.smart_canvas)
        self.assertNotIn('/static/images/node-generation.svg', self.smart_canvas)
        self.assertIn("referenceGenerationKind:'image'", self.node_review_fixture)
        self.assertIn("referenceGenerationKind:'video'", self.node_review_fixture)
        self.assertNotIn("selected:true", self.node_review_fixture)
        self.assertNotIn("dragging:true", self.node_review_fixture)
        self.assertIn("iframe[data-nodes-matrix] { height: 3810px; }", self.library_css)


if __name__ == "__main__":
    unittest.main()
