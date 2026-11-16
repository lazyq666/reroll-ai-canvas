import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ImageSettingsCompatibilityTests(unittest.TestCase):
    def run_javascript(self, expression):
        script = """
const fs = require('fs');
const vm = require('vm');
const host = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
const settingsSource = fs.readFileSync('static/js/smart-canvas/generation-settings.js', 'utf8');
const sandbox = {
    window:{SmartCanvasModules:{}},
    settings:{engine:'api',apiKind:'image',quality:'xhigh',outputFormat:'gif',pixelWidth:800,pixelHeight:600},
    cloneSmartSettings:value=>structuredClone(value),
    smartSettingsForNode:()=>({}),
    smartLoopRoundSettings:value=>value,
    normalizeSmartVideoModeSettings:()=>{},
    isApiLikeEngine:engine=>engine==='api',
    nodes:[],
    tr:key=>key
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/image-capabilities.js','utf8'), sandbox);
vm.runInContext(host.slice(host.indexOf('function aiProcessorRunSettings('),host.indexOf('async function aiProcessorWorkingFile(')),sandbox);
vm.runInContext(settingsSource.slice(settingsSource.indexOf('function smartGenerationSettingsForRun('),settingsSource.indexOf('function activeSettingsSubject(')),sandbox);
const result = vm.runInContext(EXPRESSION, sandbox);
process.stdout.write(JSON.stringify(result));
""".replace("EXPRESSION", json.dumps(expression))
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_processor_does_not_inherit_other_model_generation_parameters(self):
        result = self.run_javascript("""(() => {
            const overrides = aiProcessorRunSettings(
                {provider_id:'apimart',model:'target'},
                {ratio:'3:4',resolution:'4k',capability:{model_capability:{parameters:{quality:{default:'auto'}}}}}
            );
            return smartGenerationSettingsForRun({node:{id:'padded'},overrides}).settings;
        })()""")
        self.assertEqual("auto", result["quality"])
        self.assertEqual("", result["outputFormat"])
        self.assertEqual("", result["pixelWidth"])
        self.assertEqual("", result["pixelHeight"])

    def test_processor_preserves_all_published_standard_ratios(self):
        result = self.run_javascript("""['4:5','5:4','1:3','3:1','3:4','2:3'].map(ratio => {
            const settings = aiProcessorRunSettings(
                {provider_id:'apimart',model:'target'}, {ratio,resolution:'4k'}
            );
            return window.SmartCanvasModules.imageCapabilities.resolveForSubmission(
                settings, [], {known:true,aspect_ratios:[ratio],resolution_tiers:['4K']}
            );
        })""")
        for validation in result:
            self.assertTrue(validation["valid"], validation)

    def test_processor_preflight_happens_before_upload_and_node_creation(self):
        source = (ROOT / "static/js/smart-canvas.js").read_text()
        body = source[source.index("async function submitOutpaintProcessor"):source.index("async function submitAngleProcessor")]
        self.assertLess(body.index("prepareApiImage("), body.index("uploadBlob("))
        self.assertLess(body.index("prepareApiImage("), body.index("canvasMutation.create("))
        plan = source[source.index("async function aiProcessorImagePlan"):source.index("function aiProcessorRunSettings")]
        self.assertIn("model.model,'image.edit'", plan)

    def test_invalid_quality_is_preserved_for_explicit_correction(self):
        result = self.run_javascript("""window.SmartCanvasModules.imageCapabilities.reconcile(
            {ratio:'square',resolution:'1k',quality:'xhigh'},
            {known:true,aspect_ratios:['1:1'],resolution_tiers:['1K'],
             model_capability:{parameters:{quality:{values:['auto','high'],default:'auto'}}}}, []
        )""")
        self.assertEqual("xhigh", result["settings"]["quality"])
        self.assertIn("quality", result["invalidated"])

