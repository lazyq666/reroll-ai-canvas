import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORE_PAGES = (
    ROOT / "static" / "zimage.html",
    ROOT / "static" / "enhance.html",
    ROOT / "static" / "klein.html",
    ROOT / "static" / "angle.html",
    ROOT / "static" / "online.html",
)
HAN = re.compile(r"[\u3400-\u9fff]")


class CoreCreationI18nTests(unittest.TestCase):
    def test_visible_chinese_fallbacks_on_core_pages_have_i18n_bindings(self):
        missing = []
        for page in CORE_PAGES:
            for number, line in enumerate(page.read_text(encoding="utf-8").splitlines(), 1):
                if HAN.search(line) and "data-i18n" not in line:
                    missing.append(f"{page.name}:{number}: {line.strip()}")
        self.assertEqual([], missing)

    def test_angle_dynamic_feedback_uses_translation_keys(self):
        script = (ROOT / "static" / "js" / "angle.js").read_text(encoding="utf-8")
        for literal in (
            "请选择图片文件",
            "视角生成完成",
            "已选择 ${archiveSelection.size} 项",
            "取消全选' : '全选",
            "删除失败",
            "所选归档已删除",
        ):
            self.assertNotIn(literal, script)
        self.assertIn("tf('studio.selectedArchives'", script)
        self.assertIn("tr('studio.angleGenerationComplete')", script)

    def test_batch_model_compatibility_error_is_language_safe(self):
        script = (ROOT / "static" / "js" / "batch-generation.js").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("所选模型没有共同的画幅", script)
        self.assertIn("tr('batch.noSharedModelOptions')", script)
        self.assertIn("dataset.errorCode = 'no-shared-model-options'", script)

    def test_batch_language_refresh_updates_dynamic_controls(self):
        script = (ROOT / "static" / "js" / "batch-generation.js").read_text(
            encoding="utf-8"
        )
        refresh = script[script.index("function refreshBatchLanguage()") :]
        self.assertIn("option.label = label", refresh)
        self.assertIn(
            "parseSelect.displayLabel = tr(parseKeys[parseSelect.value])",
            refresh,
        )
        self.assertIn("renderGenerationChoices();", refresh)
        self.assertIn(
            "batch-remove-module').setAttribute('label'",
            script,
        )
        self.assertIn(
            "batch-remove-image-variable').setAttribute('label'",
            script,
        )

    def test_english_copy_avoids_parenthesized_plural_suffixes(self):
        resources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "static" / "js" / "i18n").glob("*.js"))
        )
        self.assertNotIn("(s)", resources)

    def test_second_english_copy_audit_preserves_native_product_language(self):
        resources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "static" / "js" / "i18n").glob("*.js"))
        )
        for expected in (
            'en: "API settings"',
            'en: "Data storage location"',
            'en: "Open an existing workspace"',
            'en: "Workflow settings"',
            'en: "Import / export nodes"',
            'en: "ModelScope generation failed"',
            'en: "Image-to-video"',
            'en: "Dreamina CLI help"',
            'en: "Local references added: {count}"',
        ):
            self.assertIn(expected, resources)
        for stale in (
            'en: "API Settings"',
            'en: "Data Storage Location"',
            'en: "Open an Existing Workspace"',
            'en: "Workflow Settings"',
            'en: "Import / Export Nodes"',
        ):
            self.assertNotIn(stale, resources)
        self.assertNotRegex(resources, r'en: "[^"]*Modelscope')


if __name__ == "__main__":
    unittest.main()
