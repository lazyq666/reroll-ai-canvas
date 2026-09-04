import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/model-capabilities.js"
HTML = ROOT / "static/smart-canvas.html"
PAGE_SCRIPT = ROOT / "static/js/smart-canvas.js"
PAGE_STYLES = ROOT / "static/css/smart-canvas.css"
I18N = ROOT / "static/js/i18n/smart-canvas.js"


class SmartCanvasModelCapabilityTests(unittest.TestCase):
    def run_module(self, expression):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}}, URLSearchParams}};
            vm.createContext(sandbox);
            vm.runInContext(fs.readFileSync({json.dumps(str(MODULE))}, 'utf8'), sandbox);
            const api = sandbox.window.SmartCanvasModules.modelCapabilities;
            process.stdout.write(JSON.stringify({expression}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_validation_rejects_input_and_parameter_limits(self):
        result = self.run_module(
            """api.validate({
                support_state:'supported',catalog_revision:'rev-1',
                inputs:{image:{support_state:'supported',minimum:1,maximum:2}},
                parameters:{count:{support_state:'supported',minimum:1,maximum:4}}
            },{inputs:{image:3},parameters:{count:5},catalogRevision:'rev-1'})"""
        )

        self.assertFalse(result["valid"])
        self.assertEqual(["input_maximum", "parameter_maximum"], [
            item["code"] for item in result["errors"]
        ])

    def test_stale_revision_wins_before_other_validation(self):
        result = self.run_module(
            "api.validate({support_state:'supported',catalog_revision:'new',inputs:{},parameters:{}},{catalogRevision:'old'})"
        )

        self.assertFalse(result["valid"])
        self.assertEqual("catalog_changed", result["errors"][0]["code"])

    def test_missing_revision_requires_catalog_reload_before_submission(self):
        result = self.run_module(
            "api.validate({catalog_revision:'rev-1',inputs:{},parameters:{}},{})"
        )

        self.assertFalse(result["valid"])
        self.assertEqual("catalog_changed", result["errors"][0]["code"])

    def test_frontend_rejects_invalid_types_like_the_backend(self):
        result = self.run_module(
            """api.validate({
                support_state:'supported',catalog_revision:'rev-1',
                inputs:{image:{support_state:'supported',minimum:0,maximum:2}},
                parameters:{count:{support_state:'supported',type:'integer',minimum:1,maximum:4}}
            },{inputs:{image:1.5},parameters:{count:'4'},catalogRevision:'rev-1'})"""
        )

        self.assertEqual(["input_invalid", "parameter_type"], [
            item["code"] for item in result["errors"]
        ])

    def test_frontend_validates_cross_media_totals_and_dependencies(self):
        capability = """{
            catalog_revision:'rev-1',inputs:{},parameters:{},input_rules:{
                totals:[{id:'reference_media',inputs:['image','video','audio'],maximum:12,active_when_any_present:true}],
                requirements:[{id:'visual_reference',when:{input:'audio',minimum:1},any_of:['image','video'],minimum:1}]
            }
        }"""
        audio_only = self.run_module(
            f"api.validate({capability},{{inputs:{{audio:1}},catalogRevision:'rev-1'}})"
        )
        overflow = self.run_module(
            f"api.validate({capability},{{inputs:{{image:9,video:3,audio:1}},catalogRevision:'rev-1'}})"
        )

        self.assertEqual("input_combination", audio_only["errors"][0]["code"])
        self.assertEqual("visual_reference", audio_only["errors"][0]["field"])
        self.assertEqual("input_total_maximum", overflow["errors"][0]["code"])
        self.assertEqual("reference_media", overflow["errors"][0]["field"])

    def test_frontend_validates_first_last_frame_role_order(self):
        result = self.run_module(
            """api.validate({
                catalog_revision:'rev-1',inputs:{},parameters:{},input_rules:{
                    role_groups:[{id:'first_last_frames',input:'image',roles:['first_frame','last_frame'],minimum:1,maximum:2,exclusive_inputs:['video','audio']}]
                }
            },{inputs:{image:2},inputRoles:{image:['last_frame','first_frame']},catalogRevision:'rev-1'})"""
        )

        self.assertEqual("input_role", result["errors"][0]["code"])
        self.assertEqual("image", result["errors"][0]["field"])

    def test_output_count_maximum_comes_from_the_contract(self):
        result = self.run_module(
            "api.outputCountMaximum({model_capability:{output:{count:{maximum:3}}}},8)"
        )

        self.assertEqual(3, result)

    def test_current_returns_cached_capability_after_load(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                URLSearchParams,
                fetch:async () => ({{ok:true,json:async () => ({{
                    provider_id:'demo',model_id:'m1',operation:'text.generate',
                    support_state:'experimental',catalog_revision:'rev-1'
                }})}})
            }};
            vm.createContext(sandbox);
            vm.runInContext(fs.readFileSync({json.dumps(str(MODULE))}, 'utf8'), sandbox);
            const api = sandbox.window.SmartCanvasModules.modelCapabilities;
            api.load('demo','m1','text.generate').then(() => {{
                process.stdout.write(JSON.stringify(api.current('demo','m1','text.generate')));
            }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("unknown", json.loads(result.stdout)["support_state"])

    def test_capability_confirmation_state_is_not_rendered_to_users(self):
        page_script = PAGE_SCRIPT.read_text(encoding="utf-8")
        page_styles = PAGE_STYLES.read_text(encoding="utf-8")
        translations = I18N.read_text(encoding="utf-8")

        self.assertNotIn("renderModelCapabilityState", page_script)
        self.assertNotIn("data-model-capability-state", page_script)
        self.assertNotIn(".model-capability-state", page_styles)
        self.assertNotIn("smart.capabilityState.", translations)

    def test_module_loads_before_media_specific_capabilities(self):
        html = HTML.read_text(encoding="utf-8")

        self.assertIn("smart-canvas/model-capabilities.js", html)
        self.assertLess(
            html.index("smart-canvas/model-capabilities.js"),
            html.index("smart-canvas/image-capabilities.js"),
        )
        self.assertLess(
            html.index("smart-canvas/model-capabilities.js"),
            html.index("smart-canvas/video-capabilities.js"),
        )


if __name__ == "__main__":
    unittest.main()
