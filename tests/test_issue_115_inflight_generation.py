import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InFlightGenerationInteractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.generation_run = (
            ROOT / "static/js/smart-canvas/generation-run.js"
        ).read_text(encoding="utf-8")

    def test_run_button_does_not_disable_for_in_flight_node(self):
        start = self.host.index("function syncRunButtonState")
        end = self.host.index("\nfunction canvasImageDragPayload", start)
        body = self.host[start:end]
        self.assertNotIn("smartNodeInFlight(node)", body)
        self.assertIn("generationRun.status({node}).loopRunning", body)

    def test_busy_node_floating_menu_has_duplicate_and_regenerate(self):
        start = self.host.index("function smartNodeToolbarHtml")
        end = self.host.index("\nfunction duplicateSmartNodeMediaToCanvas", start)
        toolbar = self.host[start:end]
        self.assertIn("smartNodeInFlight(node)", toolbar)
        self.assertIn("key:'duplicate'", toolbar)
        self.assertIn("label:tr('smart.contextDuplicate')", toolbar)
        self.assertIn("key:'regenerate'", toolbar)
        self.assertIn("label:tr('smart.contextRegenerate')", toolbar)

    def test_floating_menu_actions_route_to_existing_duplicate_and_regenerate(self):
        start = self.host.index("function runSmartNodeToolbarAction")
        end = self.host.index("\nfunction createPromptNodeFromContextText", start)
        handler = self.host[start:end]
        self.assertIn("if(action === 'duplicate')", handler)
        self.assertIn("canvasMutation.duplicate({", handler)
        self.assertIn("if(action === 'regenerate')", handler)
        self.assertIn("generationRun.regenerate({nodeId:node.id})", handler)

    def test_busy_run_and_regeneration_are_not_rejected(self):
        run_start = self.generation_run.index("async function runGeneration")
        run_end = self.generation_run.index("\nfunction generationRunStatus", run_start)
        run_body = self.generation_run[run_start:run_end]
        self.assertNotIn("if(smartNodeInFlight(node)) return", run_body)
        self.assertIn("const sourceInFlight = smartNodeInFlight(node)", run_body)

        regenerate_start = self.generation_run.index(
            "async function regenerateGenerationRun"
        )
        regenerate_body = self.generation_run[regenerate_start:]
        self.assertNotIn("if(smartNodeInFlight(source)) return", regenerate_body)


if __name__ == "__main__":
    unittest.main()
