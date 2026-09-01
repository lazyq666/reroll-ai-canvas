import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Issue129PromptCharacterCountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.host = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.authoring = (
            ROOT / "static/js/smart-canvas/prompt-authoring.js"
        ).read_text(encoding="utf-8")
        cls.styles = (ROOT / "static/css/smart-canvas.css").read_text(
            encoding="utf-8"
        )
        cls.i18n = (ROOT / "static/js/i18n/smart-canvas.js").read_text(
            encoding="utf-8"
        )
        cls.composer_case = (
            ROOT / "static/design-system/infinite-canvas-ui/composer.html"
        ).read_text(encoding="utf-8")
        cls.composer_case_script = (
            ROOT / "static/js/infinite-canvas-ui/composer-case.js"
        ).read_text(encoding="utf-8")

    def test_unicode_grapheme_clusters_are_counted_as_visible_characters(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__AUTHORING__, 'utf8');
            const sandbox = {
                window:{SmartCanvasModules:{smartContainer:{}}},
                promptInput:null,
            };
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const count = sandbox.window.SmartCanvasModules.promptAuthoring.characterCount;
            process.stdout.write(JSON.stringify({
                ascii:count('abc'),
                combining:count('e\\u0301'),
                family:count('👨‍👩‍👧‍👦'),
                flag:count('🇨🇳'),
                whitespace:count('a b\\n'),
            }));
            """
        ).replace(
            "__AUTHORING__",
            json.dumps(str(ROOT / "static/js/smart-canvas/prompt-authoring.js")),
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {
                "ascii": 3,
                "combining": 1,
                "family": 1,
                "flag": 1,
                "whitespace": 4,
            },
            json.loads(result.stdout),
        )

    def test_all_three_prompt_surfaces_use_the_reserved_status_area(self):
        self.assertIn('class="prompt-row prompt-editor-shell"', self.page)
        self.assertIn('id="promptCharacterCount"', self.page)
        self.assertIn("function promptEditorShellHtml(editorHtml='')", self.host)
        self.assertIn("promptEditorShellHtml(`<ic-prompt-composer", self.host)
        self.assertEqual(2, self.host.count("promptEditorShellHtml(`<ic-prompt-composer"))
        self.assertIn("bindPromptCharacterCount(promptInput)", self.host)
        self.assertIn("bindPromptCharacterCount(editor)", self.host)
        self.assertIn('class="prompt-row prompt-editor-shell"', self.composer_case)
        self.assertIn("syncPromptCharacterCount()", self.composer_case_script)

    def test_counter_visuals_use_the_approved_tokens_without_an_overlay(self):
        self.assertIn(
            "grid-template-rows:minmax(0,1fr) var(--prompt-character-count-row-size)",
            self.styles,
        )
        self.assertIn("font-size:var(--ui-font-size-1)", self.styles)
        self.assertIn("color:var(--ui-color-text-tertiary)", self.styles)
        self.assertIn("font-weight:var(--ui-font-weight-regular)", self.styles)
        self.assertIn(
            ".prompt-node-card:not(.prompt-node-composer) > .prompt-editor-shell > .prompt-character-count { padding-right:calc(var(--ui-space-2) + var(--ui-space-3)); }",
            self.styles,
        )
        counter_rule = self.styles[
            self.styles.index(".prompt-character-count {") : self.styles.index(
                "\n.prompt-node-card > .prompt-editor-shell",
                self.styles.index(".prompt-character-count {"),
            )
        ]
        self.assertNotIn("position:absolute", counter_rule)
        self.assertNotIn("background:", counter_rule)

    def test_counter_is_informational_without_a_limit_or_live_announcements(self):
        self.assertIn('"smart.characterCount": { zh: "{count} 字符"', self.i18n)
        self.assertIn("promptAuthoring.characterText(editor)", self.host)
        self.assertIn("promptAuthoring.characterCount(", self.host)
        self.assertNotIn("aria-live", self.page[self.page.index('id="promptCharacterCount"') - 120 : self.page.index('id="promptCharacterCount"') + 180])
        self.assertNotRegex(self.host, r"characterCount.{0,120}(max|limit)")


if __name__ == "__main__":
    unittest.main()
