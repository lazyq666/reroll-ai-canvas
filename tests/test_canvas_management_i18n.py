import re
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGES = (
    ROOT / "static" / "canvas.html",
    ROOT / "static" / "smart-canvas.html",
    ROOT / "static" / "api-settings.html",
    ROOT / "static" / "account-management.html",
    ROOT / "static" / "available-model-management.html",
)
HAN = re.compile(r"[\u3400-\u9fff]")


class CanvasManagementI18nTests(unittest.TestCase):
    def test_static_chinese_fallbacks_have_i18n_bindings(self):
        missing = []
        for page in PAGES:
            lines = page.read_text(encoding="utf-8").splitlines()
            for number, line in enumerate(lines, 1):
                stripped = line.strip()
                nearby = " ".join(lines[max(0, number - 3) : min(len(lines), number + 2)])
                if (
                    HAN.search(line)
                    and "data-i18n" not in nearby
                    and not stripped.startswith(("<!--", "//", "/*", "*"))
                ):
                    missing.append(f"{page.name}:{number}: {stripped}")
        self.assertEqual([], missing)

    def test_runtime_alerts_are_not_overwritten_by_static_i18n(self):
        for relative_path, alert_ids in {
            "static/api-settings.html": ("jimengCredit", "codexCliInfo", "geminiCliInfo"),
            "static/account-management.html": ("page-message",),
            "static/available-model-management.html": ("page-message",),
        }.items():
            html = (ROOT / relative_path).read_text(encoding="utf-8")
            for alert_id in alert_ids:
                match = re.search(rf'<ic-alert\b[^>]*\bid="{re.escape(alert_id)}"[^>]*>(.*?)</ic-alert>', html, re.S)
                self.assertIsNotNone(match, f"missing runtime alert {relative_path}#{alert_id}")
                self.assertNotIn("data-i18n", match.group(0))
                self.assertEqual("", match.group(1).strip())

    def test_custom_component_attributes_and_composer_placeholder_are_translated(self):
        core = (ROOT / "static/js/i18n-core.js").read_text(encoding="utf-8")
        for binding in (
            "['data-i18n-hint', 'hint']",
            "['data-i18n-empty-label', 'empty-label']",
            "['data-i18n-adaptive-label', 'adaptive-label']",
            "['data-i18n-keep-ratio-label', 'keep-ratio-label']",
        ):
            self.assertIn(binding, core)
        self.assertIn("if(el.hasAttribute('data-placeholder'))", core)

    def test_smart_canvas_dynamic_nodes_refresh_for_language_changes(self):
        script = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        signature = script[
            script.index("function smartCanvasNodeRenderSignature") :
            script.index("function smartCanvasActiveEditorWithin")
        ]
        self.assertIn("window.StudioI18n?.lang?.()", signature)
        self.assertIn("smart.summaryImageSingle", script)
        resources = (ROOT / "static/js/i18n/smart-canvas.js").read_text(encoding="utf-8")
        self.assertIn('"smart.summaryImageSingle"', resources)
        self.assertIn('en: "{count} image"', resources)

    def test_classic_canvas_node_titles_and_accessible_names_are_localized(self):
        script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        self.assertNotIn("node.type === 'prompt' ? 'Prompt'", script)
        self.assertNotIn("node.type === 'image' ? 'Image'", script)
        self.assertIn("node.type === 'prompt' ? tr('canvas.prompt')", script)
        page = (ROOT / "static/canvas.html").read_text(encoding="utf-8")
        for element_id in ("backToManagerBtn", "canvasLogToggle", "outputDownloadBtn"):
            tag = re.search(rf'<button\b[^>]*\bid="{element_id}"[^>]*>', page)
            self.assertIsNotNone(tag)
            self.assertIn("data-i18n-aria-label", tag.group(0))

    def test_classic_canvas_status_messages_use_translation_keys(self):
        script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        for literal in (
            "setStatus('Saving...')",
            "setStatus('Synced')",
            "setStatus('Saved')",
            "setStatus('Ready')",
            "setStatus('Sync failed')",
            "setStatus('Moving to trash...')",
        ):
            self.assertNotIn(literal, script)
        self.assertIn("setStatus(tr('canvas.saving'))", script)
        self.assertIn("setStatus(tr('canvas.ready'))", script)

    def test_classic_canvas_time_refreshes_when_language_changes(self):
        script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        language_handlers = script[script.index("function applyLanguage") : script.index("const shell =")]
        self.assertGreaterEqual(
            language_handlers.count(
                "currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at || canvas.created_at)"
            ),
            2,
        )

    def test_smart_canvas_default_titles_and_separators_are_localized(self):
        scripts = "\n".join(
            (ROOT / relative_path).read_text(encoding="utf-8")
            for relative_path in (
                "static/js/smart-canvas.js",
                "static/js/smart-canvas/canvas-interaction.js",
                "static/js/smart-canvas/image-studio.js",
                "static/js/smart-canvas/generation-run.js",
            )
        )
        for literal in ("title = 'Image'", "title = 'Grid'", "title = 'Grid Join'", ".join('；')"):
            self.assertNotIn(literal, scripts)
        self.assertIn("tr('smart.kindImage')", scripts)
        self.assertIn("tr('smart.messageSeparator')", scripts)

    def test_api_sidebar_uses_a_single_column_for_long_english_actions(self):
        styles = (ROOT / "static/css/api-settings-t18.css").read_text(encoding="utf-8")
        block = styles[styles.index(".api-settings-page .layout .api-transfer-actions") :]
        block = block[: block.index("}")]
        self.assertIn("grid-template-columns: minmax(0, 1fr);", block)

    def test_management_english_copy_uses_action_oriented_sentence_case(self):
        resources = "\n".join(
            (ROOT / "static/js/i18n" / filename).read_text(encoding="utf-8")
            for filename in ("model-management.js", "auth.js", "api-settings.js")
        )
        for expected in (
            'en: "Manage available models"',
            'en: "Set the names, visibility, and order shown to users."',
            'en: "Sign out"',
        ):
            self.assertIn(expected, resources)
        self.assertNotIn('en: "Sign Out"', resources)

    def test_batch_i18n_resources_do_not_repeat_keys(self):
        for filename in (
            "canvas.js",
            "smart-canvas.js",
            "api-settings.js",
            "auth.js",
            "model-management.js",
        ):
            source = (ROOT / "static/js/i18n" / filename).read_text(encoding="utf-8")
            keys = re.findall(r'^\s*"([^"]+)"\s*:', source, re.M)
            duplicates = [key for key, count in Counter(keys).items() if count > 1]
            self.assertEqual([], duplicates, filename)


if __name__ == "__main__":
    unittest.main()
