import unittest
from pathlib import Path

from tests.runtime_env import ensure_test_workspace


ROOT = Path(__file__).resolve().parents[1]


class GptChatFeatureRemovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_test_workspace()
        import main

        cls.main = main
        cls.shell = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.common_i18n = (ROOT / "static" / "js" / "i18n" / "common.js").read_text(encoding="utf-8")
        cls.studio_i18n = (ROOT / "static" / "js" / "i18n" / "studio.js").read_text(encoding="utf-8")
    def test_page_navigation_and_iframe_are_removed(self):
        self.assertFalse((ROOT / "static" / "gpt-chat.html").exists())
        self.assertNotIn("gpt-chat", self.shell)
        self.assertNotIn("nav.gpt", self.shell)

    def test_gpt_chat_translations_are_removed(self):
        self.assertNotIn('"nav.gpt"', self.common_i18n)
        self.assertNotIn('"chat.', self.studio_i18n)

    def test_chat_and_conversation_routes_are_not_registered(self):
        routes = {route.path for route in self.main.app.routes}
        self.assertFalse(any(path == "/api/chat" or path.startswith("/api/chat/") for path in routes))
        self.assertFalse(any(path == "/api/conversations" or path.startswith("/api/conversations/") for path in routes))

    def test_chat_models_remain_available_to_canvas_llm_nodes(self):
        routes = {route.path for route in self.main.app.routes}
        self.assertIn("/api/canvas-llm", routes)
        self.assertTrue(hasattr(self.main, "CanvasLLMRequest"))
        self.assertFalse(hasattr(self.main, "ChatRequest"))




if __name__ == "__main__":
    unittest.main()
