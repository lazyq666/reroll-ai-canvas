import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / "static/js/i18n/smart-canvas.js"
SMART_CANVAS = ROOT / "static/js/smart-canvas.js"
CANVAS_MUTATION = ROOT / "static/js/smart-canvas/canvas-mutation.js"
SMART_CANVAS_HTML = ROOT / "static/smart-canvas.html"
TOOLBAR_FIXTURE = ROOT / "static/design-system/infinite-canvas-ui/smart-node-toolbar.html"
EMPTY_STATES_FIXTURE = ROOT / "static/design-system/infinite-canvas-ui/empty-states.html"
CONTEXT = ROOT / "CONTEXT.md"
CURRENT_SPEC = ROOT / "docs/current/smart-canvas-container-terminology.md"


class SmartCanvasContainerTerminologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.i18n = I18N.read_text(encoding="utf-8")
        cls.script = SMART_CANVAS.read_text(encoding="utf-8")
        cls.mutation = CANVAS_MUTATION.read_text(encoding="utf-8")
        cls.html = SMART_CANVAS_HTML.read_text(encoding="utf-8")
        cls.toolbar = TOOLBAR_FIXTURE.read_text(encoding="utf-8")
        cls.empty_states = EMPTY_STATES_FIXTURE.read_text(encoding="utf-8")
        cls.context = CONTEXT.read_text(encoding="utf-8")
        cls.current_spec = CURRENT_SPEC.read_text(encoding="utf-8")

    def translation(self, key):
        match = re.search(
            rf'"{re.escape(key)}": \{{ zh: "([^"]*)", en:',
            self.i18n,
        )
        self.assertIsNotNone(match, key)
        return match.group(1)

    def test_primary_names_and_operations_use_group_and_region(self):
        expected = {
            "smart.group": "编组",
            "smart.smartGroup": "编组",
            "smart.groupActions": "编组操作",
            "smart.contextCreateGroup": "创建编组",
            "smart.contextUngroup": "解散编组",
            "smart.contextRemoveFromGroup": "移出编组",
            "smart.frame": "分区",
            "smart.frameDefault": "分区",
            "smart.frameNumber": "分区 {number}",
            "smart.frameActions": "分区操作",
            "smart.contextCreateFrame": "创建分区",
            "smart.contextRenameFrame": "重命名分区",
            "smart.contextUngroupFrame": "取消分区",
            "smart.contextDeleteFrameAll": "删除分区及 {n} 个内容",
        }
        for key, label in expected.items():
            with self.subTest(key=key):
                self.assertEqual(label, self.translation(key))

    def test_unrelated_prompt_template_categories_keep_group_wording(self):
        self.assertEqual("所属分组", self.translation("smart.tplGroup"))
        self.assertEqual("新分组名称", self.translation("smart.tplNewGroupPrompt"))

    def test_static_fallbacks_and_component_fixtures_match_runtime_labels(self):
        self.assertIn('value="group" icon="group" label="编组"', self.html)
        self.assertIn('value="frame" icon="frame" label="分区"', self.html)
        self.assertIn('label="编组内图片位置"', self.html)
        self.assertIn('label="编组操作"', self.toolbar)
        self.assertIn('label="分区操作"', self.toolbar)
        self.assertIn("解散编组", self.toolbar)
        self.assertIn("取消分区", self.toolbar)
        self.assertIn("编组图片格", self.empty_states)
        self.assertNotIn("智能分组操作", self.toolbar)
        self.assertNotIn("画布框操作", self.toolbar)

    def test_creation_defaults_and_legacy_defaults_resolve_to_new_names(self):
        self.assertIn("'smart.smartGroup':'编组'", self.mutation)
        self.assertIn("'smart.frameNumber':'分区 {number}'", self.mutation)
        self.assertIn("['万能分组', '智能分组', 'Smart Group']", self.script)
        self.assertIn("/^(?:画布|Frame)(?:\\s+(\\d+))?$/i", self.script)
        self.assertIn("node.title = tr('smart.smartGroup')", self.script)
        self.assertIn("`${tr('smart.frameDefault')}${defaultTitle[1]", self.script)

    def test_authoritative_docs_define_the_same_distinction(self):
        self.assertIn("**Smart Group（编组，中文界面名称）**", self.context)
        self.assertIn("**Frame（分区，中文界面名称）**", self.context)
        self.assertIn("显式拥有一组有序 Node 或媒体成员", self.current_spec)
        self.assertIn("按空间包含关系组织 Node", self.current_spec)
        self.assertIn("不拥有其中内容", self.current_spec)


if __name__ == "__main__":
    unittest.main()
