import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STYLE = ROOT / "static/css/smart-canvas.css"
SCRIPT = ROOT / "static/js/smart-canvas.js"
NODE_COMPONENT = ROOT / "static/js/infinite-canvas-ui/nodes/shared.js"


class SmartCanvasNodePortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.node_component = NODE_COMPONENT.read_text(encoding="utf-8")

    def test_legacy_manual_connection_ports_are_removed(self):
        self.assertNotIn(".node-port", self.style)
        self.assertNotIn('class="node-port', self.script)
        self.assertNotIn("querySelectorAll('.node-port')", self.script)

    def test_quick_add_buttons_own_both_connection_directions(self):
        self.assertIn('data-port="${side}"', self.node_component)
        self.assertIn('smart-node-quick-add-zone--${side}', self.node_component)
        self.assertIn("quickAddMarkup(standardControls.quickAdd.out, 'out')", self.node_component)
        self.assertIn("quickAddMarkup(standardControls.quickAdd.in, 'in')", self.node_component)
        self.assertIn("beginSmartNodePortDrag(id, portType, event, {trigger:quickAddTrigger})", self.script)


if __name__ == "__main__":
    unittest.main()
