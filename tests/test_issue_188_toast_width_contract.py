import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = (
    ROOT
    / "static"
    / "design-system"
    / "infinite-canvas-ui"
    / "ic-feedback-progress-v1.json"
)


class ToastWidthContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.toast = next(
            component
            for component in contract["components"]
            if component["tag"] == "ic-toast"
        )

    def test_toast_width_is_auto_between_the_legacy_width_and_its_1_6x_cap(self):
        self.assertEqual(
            self.toast["presentation"]["width"],
            {
                "sizing": "auto",
                "minimum": "17rem",
                "maximum": "27.2rem",
                "narrowViewport": "clamp both bounds to the viewport minus two --ui-space-4 insets",
            },
        )


if __name__ == "__main__":
    unittest.main()
