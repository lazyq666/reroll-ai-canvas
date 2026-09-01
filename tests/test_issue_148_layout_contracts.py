import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETTINGS = ROOT / "static/js/smart-canvas/generation-settings.js"
HOST = ROOT / "static/js/smart-canvas.js"
PERSISTENCE = ROOT / "static/js/smart-canvas/canvas-persistence.js"
PAGE = ROOT / "static/smart-canvas.html"
STYLE = ROOT / "static/css/smart-canvas.css"


class Issue148LayoutContractTests(unittest.TestCase):
    def test_canvas_settings_exposes_horizontal_default_without_personal_storage_key(self):
        page = PAGE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        persistence = PERSISTENCE.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")
        self.assertIn('id="smartGenerationBatchLayoutControl"', page)
        self.assertIn('<ic-tabs id="smartGenerationBatchLayoutControl"', page)
        self.assertIn('data-component-name="ic-tabs-small"', page)
        self.assertIn('size="small" orientation="horizontal" activation="automatic"', page)
        self.assertIn('data-value="horizontal"', page)
        self.assertIn('data-value="vertical"', page)
        self.assertIn('value="horizontal"', page)
        self.assertIn('value="vertical"', page)
        self.assertIn("let smartGenerationBatchLayout = 'horizontal'", host)
        self.assertIn("generationBatchLayout:smartGenerationBatchLayout", host)
        self.assertIn("smartGenerationBatchLayoutControl?.addEventListener('ic-change'", host)
        self.assertIn("sharedSettings.generationBatchLayout", persistence)
        self.assertIn("refreshSmartCanvasSettings();", persistence)
        self.assertNotIn("GENERATION_BATCH_LAYOUT_STORAGE_KEY", host)
        self.assertIn(".smart-canvas-generation-layout-control", style)

    def test_recent_generation_settings_strips_canvas_batch_layout(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS))}, 'utf8');
            const values = new Map();
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                localStorage:{{
                    getItem:key => values.get(key) || null,
                    setItem:(key,value) => values.set(key,value)
                }},
                nodes:[],
                activeComposerSubject:null,lastComposerNodeId:'',
                stripOutpaintDisplaySettings:value => ({{...value}}),
                sanitizeSmartApiSelection:value => value,
                clearVolcengineSelectionOutsideVolcengine:value => value,
                isSmartRunnableNode:() => false,
                normalizeSmartVideoModeSettings:value => value,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(source,sandbox);
            sandbox.SmartCanvasModules.generationSettings.remember({{
                engine:'api',apiKind:'image',model:'demo',generationBatchLayout:'vertical'
            }});
            process.stdout.write(values.get('smart_canvas_recent_run_settings_v1'));
            """
        )
        completed = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        stored = json.loads(completed.stdout)
        self.assertNotIn("generationBatchLayout", stored["api:image"])

    def test_selection_arrangement_is_a_separate_deep_module_and_mutation(self):
        page = PAGE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        self.assertIn("/static/js/smart-canvas/selection-arrangement.js", page)
        self.assertIn("const arrangement = window.SmartCanvasModules.selectionArrangement", host)
        self.assertIn("const plan = arrangement.plan({", host)
        self.assertIn("canvasMutation.arrange({placements:plan.placements,frameUpdates})", host)
        self.assertNotIn("SMART_ARRANGE_DEFAULT_GAP", host)
        self.assertNotIn("function smartArrangementGap(", host)


if __name__ == "__main__":
    unittest.main()
