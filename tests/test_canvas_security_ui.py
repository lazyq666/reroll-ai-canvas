import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CanvasSecurityUiTests(unittest.TestCase):
    def test_node_ids_are_not_interpolated_into_inline_event_handlers(self):
        script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")

        self.assertNotIn(
            'onclick="deleteNodeFromButton(\'${node.id}\', event)"',
            script,
        )
        self.assertIn("deleteButton.addEventListener('click'", script)


if __name__ == "__main__":
    unittest.main()
