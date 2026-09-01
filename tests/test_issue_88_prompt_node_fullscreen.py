import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "smart-canvas.html"
HOST = ROOT / "static" / "js" / "smart-canvas.js"
STYLE = ROOT / "static" / "css" / "smart-canvas.css"
COMPONENT = ROOT / "static" / "js" / "infinite-canvas-ui" / "nodes" / "prompt-focus-surface.js"
CORE = ROOT / "static" / "js" / "infinite-canvas-ui" / "core.js"


class Issue88PromptNodeFullscreenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.component = COMPONENT.read_text(encoding="utf-8")
        cls.core = CORE.read_text(encoding="utf-8")

    def test_prompt_node_focus_surface_is_a_modal_peer_of_composer(self):
        self.assertIn('<ic-prompt-node-focus-surface id="promptNodeFocusSurface"', self.page)
        self.assertIn("define('ic-prompt-node-focus-surface', IcPromptNodeFocusSurface)", self.core)
        self.assertIn("function setPromptNodeFocused(nodeId, focused)", self.host)
        self.assertIn("setPromptAuthoringFocused(false)", self.host)
        self.assertIn('part="surface" role="dialog" aria-modal="true"', self.component)
        self.assertIn("width:min(850px", self.component)
        self.assertIn("height:min(660px", self.component)

    def test_both_prompt_node_modes_expose_expand_in_the_floating_menu(self):
        self.assertIn("{key:'focus-editor', icon:'focus-editor', label:tr('smart.focusEdit'), enabled:true}", self.host)
        self.assertIn("if(action === 'focus-editor' && nodeKinds.isPromptFamily(node))", self.host)
        self.assertIn("setPromptNodeFocused(node.id, true)", self.host)
        self.assertIn("focusControl:''", self.host)

    def test_fullscreen_surface_owns_light_dismiss_without_a_collapse_button(self):
        self.assertNotIn("function promptNodeFocusToggleHtml", self.host)
        self.assertNotIn('class="composer-focus-toggle prompt-node-focus-toggle"', self.host)
        self.assertIn("nodeKinds.isPromptFamily(node)", self.host)
        self.assertIn("requestDismiss('backdrop')", self.component)
        self.assertIn("requestDismiss('escape')", self.component)
        self.assertIn("event.defaultPrevented", self.component)
        self.assertIn("promptNodeFocusSurface?.addEventListener('ic-dismiss'", self.host)
        self.assertNotIn("body:has(.prompt-node-focus-surface", self.style)
        self.assertNotIn("--ui-z-tooltip:", self.style)
        self.assertIn("z-index:var(--ui-z-backdrop)", self.component)
        self.assertIn("z-index:var(--ui-z-modal)", self.component)
        self.assertIn("'ic-overlay-scope-activate'", self.host)

    def test_fullscreen_editor_uses_existing_node_edit_and_persistence_chain(self):
        self.assertIn("bindPromptNodeControls(dialog, node)", self.host)
        self.assertIn("beginPromptNodeTextEdit(node.id)", self.host)
        self.assertIn("node.llmEnabled ? '.prompt-llm-instruction' : '.prompt-node-text'", self.host)
        self.assertIn("bindPromptNodeRichEditor(el, node, textEl)", self.host)
        self.assertIn("syncPromptLlmInstructionEditor(node, editor)", self.host)
        self.assertIn("bindPromptNodeRichEditor(el, node, instructionEl, {instruction:true})", self.host)
        self.assertIn("canvasPersistence.schedule()", self.host)

    def test_escape_and_backdrop_dismiss_restore_the_canvas_node(self):
        self.assertIn("setPromptNodeFocused('', false)", self.host)
        self.assertIn("promptNodeFocusSurface.removeAttribute('open')", self.host)
        self.assertIn("render({nodeIds:[restoreNodeId], syncVirtualization:false})", self.host)


if __name__ == "__main__":
    unittest.main()
