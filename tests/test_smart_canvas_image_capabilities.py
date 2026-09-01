import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/image-capabilities.js"


class SmartCanvasImageCapabilityTests(unittest.TestCase):
    def run_module(self, expression):
        script = textwrap.dedent(f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}}, URLSearchParams}};
            vm.createContext(sandbox);
            vm.runInContext(fs.readFileSync({json.dumps(str(MODULE))}, 'utf8'), sandbox);
            const api = sandbox.window.SmartCanvasModules.imageCapabilities;
            process.stdout.write(JSON.stringify({expression}));
        """)
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_automatic_requires_exactly_one_supported_reference(self):
        value = self.run_module("({one:api.automatic([{url:'x',natural_w:1919,natural_h:1080}],api.fallback()),many:api.automatic([{url:'a',width:100,height:100},{url:'b',width:100,height:100}],api.fallback())})")
        self.assertTrue(value["one"]["available"])
        self.assertEqual("16:9", value["one"]["ratio"])
        self.assertFalse(value["many"]["available"])
        self.assertEqual("multiple-references", value["many"]["reason"])

    def test_automatic_accepts_closest_supported_ratio_within_seven_percent_only(self):
        value = self.run_module("""({
            issue192:api.automatic(
                [{url:'issue-192.png',width:405,height:240}],
                api.fallback()
            ),
            within:api.automatic(
                [{url:'within.png',width:1069,height:1000}],
                {aspect_ratios:['1:1']}
            ),
            outside:api.automatic(
                [{url:'outside.png',width:1071,height:1000}],
                {aspect_ratios:['1:1']}
            )
        })""")
        self.assertTrue(value["issue192"]["available"])
        self.assertEqual("16:9", value["issue192"]["ratio"])
        self.assertTrue(value["within"]["available"])
        self.assertEqual("1:1", value["within"]["ratio"])
        self.assertFalse(value["outside"]["available"])
        self.assertEqual("unsupported-reference-ratio", value["outside"]["reason"])

    def test_current_reference_always_wins_over_a_saved_auto_match(self):
        value = self.run_module("""(() => {
            const settings = {ratio:'source',resolution:'2k',customRatio:'1:1'};
            const capability = api.fallback();
            return {
                resolved:api.resolveForSubmission(
                    settings,
                    [{url:'issue-192.png',natural_w:405,natural_h:240}],
                    capability
                ),
                reconciled:api.reconcile(
                    settings,
                    capability,
                    [{url:'issue-192.png',natural_w:405,natural_h:240}]
                )
            };
        })()""")
        self.assertTrue(value["resolved"]["valid"])
        self.assertEqual("16:9", value["resolved"]["target_aspect_ratio"])
        self.assertEqual("source", value["reconciled"]["settings"]["ratio"])
        self.assertEqual("16:9", value["reconciled"]["automatic"]["ratio"])
        self.assertEqual("16:9", value["reconciled"]["settings"]["customRatio"])
        self.assertEqual(16, value["reconciled"]["settings"]["customRatioWidth"])
        self.assertEqual(9, value["reconciled"]["settings"]["customRatioHeight"])

    def test_saved_auto_match_cannot_bypass_current_reference_requirements(self):
        value = self.run_module("""(() => {
            const settings = {ratio:'source',resolution:'1k',customRatio:'1:1'};
            const capability = api.fallback();
            return {
                unknownDimensions:api.resolveForSubmission(
                    settings,
                    [{url:'unknown.png',natural_w:0,natural_h:0}],
                    capability
                ),
                unsupportedRatio:api.resolveForSubmission(
                    settings,
                    [{url:'unsupported.png',natural_w:1080,natural_h:1000}],
                    {aspect_ratios:['1:1'],resolution_tiers:['1K']}
                ),
                noReference:api.resolveForSubmission(settings,[],capability),
                multipleReferences:api.resolveForSubmission(
                    settings,
                    [
                        {url:'a.png',natural_w:1000,natural_h:1000},
                        {url:'b.png',natural_w:1600,natural_h:900}
                    ],
                    capability
                ),
                reconciled:api.reconcile(
                    settings,
                    capability,
                    [{url:'unknown.png',natural_w:0,natural_h:0}]
                )
            };
        })()""")
        self.assertFalse(value["unknownDimensions"]["valid"])
        self.assertEqual("dimensions-unknown", value["unknownDimensions"]["reason"])
        self.assertFalse(value["unsupportedRatio"]["valid"])
        self.assertEqual("unsupported-reference-ratio", value["unsupportedRatio"]["reason"])
        self.assertFalse(value["noReference"]["valid"])
        self.assertEqual("reference-required", value["noReference"]["reason"])
        self.assertFalse(value["multipleReferences"]["valid"])
        self.assertEqual("multiple-references", value["multipleReferences"]["reason"])
        self.assertEqual("", value["reconciled"]["settings"]["ratio"])
        self.assertEqual(["aspect_ratio"], value["reconciled"]["invalidated"])
        self.assertNotIn("customRatio", value["reconciled"]["settings"])
        self.assertNotIn("customRatioWidth", value["reconciled"]["settings"])
        self.assertNotIn("customRatioHeight", value["reconciled"]["settings"])

    def test_reconcile_clears_unsupported_ratio_and_uses_supported_resolution_default(self):
        value = self.run_module("api.reconcile({ratio:'ultrawide',resolution:'4k'},{aspect_ratios:['1:1','16:9'],resolution_tiers:['1K'],default_resolution_tier:'1K'},[])")
        self.assertEqual("", value["settings"]["ratio"])
        self.assertEqual("1k", value["settings"]["resolution"])
        self.assertEqual(["aspect_ratio", "resolution_tier"], value["invalidated"])

    def test_resolution_defaults_to_1k_then_2k(self):
        value = self.run_module("""({
            supports1k:api.reconcile(
                {ratio:'square',resolution:''},
                {aspect_ratios:['1:1'],resolution_tiers:['4K','2K','1K'],default_resolution_tier:'4K'},
                []
            ),
            supports2k:api.reconcile(
                {ratio:'square',resolution:'1k'},
                {aspect_ratios:['1:1'],resolution_tiers:['4K','2K'],default_resolution_tier:'4K'},
                []
            ),
            supportsNeither:api.reconcile(
                {ratio:'square',resolution:'1k'},
                {aspect_ratios:['1:1'],resolution_tiers:['4K'],default_resolution_tier:'4K'},
                []
            )
        })""")
        self.assertEqual("1k", value["supports1k"]["settings"]["resolution"])
        self.assertEqual("2k", value["supports2k"]["settings"]["resolution"])
        self.assertEqual("4k", value["supportsNeither"]["settings"]["resolution"])

    def test_unknown_capability_has_no_custom_or_extended_ratios(self):
        value = self.run_module("({capability:api.fallback('p','m'),selection:api.reconcile({ratio:'square',resolution:'4k'},api.fallback('p','m'),[])})")
        capability = value["capability"]
        self.assertNotIn("21:9", capability["aspect_ratios"])
        self.assertEqual(["1K", "2K", "4K"], capability["resolution_tiers"])
        self.assertTrue(capability["show_resolution_control"])
        self.assertFalse(capability["supports_transparent_png"])
        self.assertEqual("4k", value["selection"]["settings"]["resolution"])
        self.assertEqual([], value["selection"]["invalidated"])

    def test_transparent_png_support_is_strict_boolean_and_intersected(self):
        value = self.run_module("""({
            supported:api.clean({supports_transparent_png:true},'p','m'),
            truthy:api.clean({supports_transparent_png:'true'},'p','m'),
            all:api.intersect([
                {aspect_ratios:['1:1'],resolution_tiers:['1K'],known:true,supports_transparent_png:true},
                {aspect_ratios:['1:1'],resolution_tiers:['1K'],known:true,supports_transparent_png:true}
            ]),
            mixed:api.intersect([
                {aspect_ratios:['1:1'],resolution_tiers:['1K'],known:true,supports_transparent_png:true},
                {aspect_ratios:['1:1'],resolution_tiers:['1K'],known:true,supports_transparent_png:false}
            ])
        })""")
        self.assertTrue(value["supported"]["supports_transparent_png"])
        self.assertFalse(value["truthy"]["supports_transparent_png"])
        self.assertTrue(value["all"]["supports_transparent_png"])
        self.assertFalse(value["mixed"]["supports_transparent_png"])

    def test_warning_only_follows_a_confirmed_incompatible_model_transition(self):
        value = self.run_module("""(() => {
            const capability = {known:true};
            const validTransition = {
                prefix:'', fromKey:'provider-a\\u001fmodel-a', toKey:'provider-b\\u001fmodel-b',
                previousSettingsSupported:true
            };
            const input = {prefix:'',currentKey:'provider-b\\u001fmodel-b',capability,invalidated:['aspect_ratio']};
            return {
                incompatibleSwitch:api.shouldWarnForTransition(validTransition,input),
                compatibleSwitch:api.shouldWarnForTransition(validTransition,{...input,invalidated:[]}),
                unchangedModel:api.shouldWarnForTransition({...validTransition,fromKey:validTransition.toKey},input),
                unsupportedBeforeSwitch:api.shouldWarnForTransition({...validTransition,previousSettingsSupported:false},input),
                unknownNewModel:api.shouldWarnForTransition(validTransition,{...input,capability:{known:false}}),
                unrelatedModel:api.shouldWarnForTransition(validTransition,{...input,currentKey:'provider-c\\u001fmodel-c'})
            };
        })()""")
        self.assertTrue(value["incompatibleSwitch"])
        self.assertFalse(value["compatibleSwitch"])
        self.assertFalse(value["unchangedModel"])
        self.assertFalse(value["unsupportedBeforeSwitch"])
        self.assertFalse(value["unknownNewModel"])
        self.assertFalse(value["unrelatedModel"])


if __name__ == "__main__":
    unittest.main()
