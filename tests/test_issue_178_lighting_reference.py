import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
DIALOG = (ROOT / "static/js/infinite-canvas-ui/ai-processor-dialog.js").read_text(encoding="utf-8")
CONTROLLER = (ROOT / "static/js/smart-canvas/lighting-reference-controller.js").read_text(encoding="utf-8")
INTENT = ROOT / "static/js/smart-canvas/lighting-intent.js"
SPEC = (ROOT / "docs/current/smart-canvas-lighting-reference.md").read_text(encoding="utf-8")


class LightingIntentContractTests(unittest.TestCase):
    def node_probe(self, source: str) -> dict:
        process = subprocess.run(
            ["node", "-e", source],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(process.stdout)

    def compile_cases(self, cases: list[dict]) -> dict:
        source = (
            "const l=require('./static/js/smart-canvas/lighting-intent.js');"
            f"const cases={json.dumps(cases)};"
            "console.log(JSON.stringify(Object.fromEntries(cases.map(item=>[item.name,l.compileLightingPrompts(item.intent)]))));"
        )
        return self.node_probe(source)

    def test_prompt_and_left_coordinate_are_deterministic(self):
        probe = self.node_probe(
            "const l=require('./static/js/smart-canvas/lighting-intent.js');"
            "const input={lights:[{azimuth_degrees:-45,elevation_degrees:35,color_mode:'temperature',temperature_kelvin:4200,relative_exposure_ev:0,angular_size_degrees:8,casts_shadow:true}],environment:{relative_exposure_ev:-2}};"
            "const a=l.normalizeLightingIntent(input),b=l.normalizeLightingIntent(JSON.parse(JSON.stringify(input)));"
            "console.log(JSON.stringify({samePrompt:JSON.stringify(l.compileLightingPrompts(a))===JSON.stringify(l.compileLightingPrompts(b)),hasJsonExporter:'stableLightingIntentJson' in l,vector:l.lightingDirectionVector(a),prompts:l.compileLightingPrompts(a)}));"
        )
        self.assertTrue(probe["samePrompt"])
        self.assertFalse(probe["hasJsonExporter"])
        self.assertLess(probe["vector"]["x"], 0)
        self.assertIn("画面左侧", probe["prompts"]["zh"])
        self.assertIn("image-left", probe["prompts"]["en"])
        self.assertIn("one dominant, unseen off-camera warm-neutral-white key", probe["prompts"]["en"])
        self.assertIn("toward image-right", probe["prompts"]["en"])
        self.assertIn("medium-soft directional illumination", probe["prompts"]["en"])
        self.assertIn("Preserve the original overall exposure", probe["prompts"]["en"])
        self.assertNotRegex(probe["prompts"]["en"], r"\b(?:4200|45|35|8|2)\b")
        self.assertNotIn("camera-left", probe["prompts"]["en"])
        self.assertNotIn("azimuth", probe["prompts"]["en"])
        self.assertNotIn("elevation", probe["prompts"]["en"])
        self.assertNotIn(" EV", probe["prompts"]["en"])
        self.assertNotIn("电影", probe["prompts"]["zh"])
        self.assertNotIn("cinematic", probe["prompts"]["en"].lower())

    def test_direction_and_height_buckets_use_observable_language(self):
        cases = []
        directions = {
            "rear_neg": (-180, "behind the subject near image-center", "toward the camera-facing foreground"),
            "rear_left": (-157.5, "image-left, raised above eye level and slightly behind", "toward image-right and the camera-facing foreground"),
            "left": (-112.5, "image-left at the subject's side", "toward image-right"),
            "front_left": (-67.5, "image-left, raised above eye level and slightly toward", "toward image-right"),
            "front_left_inner": (-22.6, "image-left, raised above eye level and slightly toward", "toward image-right"),
            "front_neg_edge": (-22.5, "near image-center, raised above eye level and toward", "behind the subject, away from the camera"),
            "front_right": (22.5, "image-right, raised above eye level and slightly toward", "toward image-left"),
            "right": (67.5, "image-right at the subject's side", "toward image-left"),
            "rear_right": (112.5, "image-right, raised above eye level and slightly behind", "toward image-left and the camera-facing foreground"),
            "rear_pos": (157.5, "behind the subject near image-center", "toward the camera-facing foreground"),
        }
        for name, (azimuth, _, _) in directions.items():
            cases.append({"name": name, "intent": {"lights": [{"azimuth_degrees": azimuth, "elevation_degrees": 35}]}})
        heights = {
            "below": (-0.1, "below the subject"),
            "eye": (0, "near eye level"),
            "raised": (15, "raised above eye level"),
            "high": (45, "high above the subject"),
            "overhead": (70, "near-overhead"),
        }
        for name, (elevation, _) in heights.items():
            cases.append({"name": f"height_{name}", "intent": {"lights": [{"azimuth_degrees": -45, "elevation_degrees": elevation}]}})
        prompts = self.compile_cases(cases)
        for name, (_, source_phrase, shadow_phrase) in directions.items():
            self.assertIn(source_phrase, prompts[name]["en"])
            self.assertIn(shadow_phrase, prompts[name]["en"])
        for name, (_, phrase) in heights.items():
            self.assertIn(phrase, prompts[f"height_{name}"]["en"])

    def test_source_size_shadow_color_and_fill_compile_to_semantic_buckets(self):
        prompts = self.compile_cases([
            {"name": "hard", "intent": {"lights": [{"angular_size_degrees": 2}]}},
            {"name": "medium", "intent": {"lights": [{"angular_size_degrees": 2.1}]}},
            {"name": "medium_edge", "intent": {"lights": [{"angular_size_degrees": 10}]}},
            {"name": "soft", "intent": {"lights": [{"angular_size_degrees": 10.1}]}},
            {"name": "shadow_off", "intent": {"lights": [{"casts_shadow": False}]}},
            {"name": "warm", "intent": {"lights": [{"temperature_kelvin": 2700}]}},
            {"name": "warm_neutral", "intent": {"lights": [{"temperature_kelvin": 4200}]}},
            {"name": "cool", "intent": {"lights": [{"temperature_kelvin": 6500}]}},
            {"name": "rgb", "intent": {"lights": [{"color_mode": "rgb", "rgb": "#ff0000"}]}},
            {"name": "fill_high", "intent": {"lights": [{"relative_exposure_ev": 0}], "environment": {"relative_exposure_ev": 0}}},
            {"name": "fill_medium", "intent": {"lights": [{"relative_exposure_ev": 0}], "environment": {"relative_exposure_ev": -2}}},
            {"name": "fill_low", "intent": {"lights": [{"relative_exposure_ev": 0}], "environment": {"relative_exposure_ev": -4}}},
        ])
        self.assertIn("small apparent source", prompts["hard"]["en"])
        self.assertIn("moderate apparent size", prompts["medium"]["en"])
        self.assertIn("moderate apparent size", prompts["medium_edge"]["en"])
        self.assertIn("large apparent source", prompts["soft"]["en"])
        self.assertIn("Keep visible directional cast shadows minimal", prompts["shadow_off"]["en"])
        self.assertNotIn("physically coherent with this key", prompts["shadow_off"]["en"])
        self.assertNotIn("penumbra", prompts["shadow_off"]["en"])
        self.assertIn("very-warm amber-white", prompts["warm"]["en"])
        self.assertIn("warm-neutral-white", prompts["warm_neutral"]["en"])
        self.assertIn("cool-daylight-white", prompts["cool"]["en"])
        self.assertIn("red-colored key", prompts["rgb"]["en"])
        self.assertNotIn("#FF0000", prompts["rgb"]["en"])
        self.assertNotIn("RGB", prompts["rgb"]["en"])
        self.assertIn("generous ambient fill", prompts["fill_high"]["en"])
        self.assertIn("enough ambient fill", prompts["fill_medium"]["en"])
        self.assertIn("ambient fill restrained", prompts["fill_low"]["en"])
        for prompt in prompts.values():
            self.assertNotIn(" EV", prompt["en"])
            self.assertNotIn("°", prompt["en"])
            self.assertNotRegex(prompt["en"], r"\d")

    def test_invalid_values_normalize_into_versioned_contract(self):
        probe = self.node_probe(
            "const l=require('./static/js/smart-canvas/lighting-intent.js');"
            "console.log(JSON.stringify(l.normalizeLightingIntent({lights:[{azimuth_degrees:-999,elevation_degrees:999,color_mode:'unknown',temperature_kelvin:100,rgb:'bad',angular_size_degrees:80}],environment:{relative_exposure_ev:-99}})));"
        )
        self.assertEqual(probe["schema"], "ic-lighting-intent/1")
        self.assertEqual(probe["compiler_version"], "lighting-prompt/2")
        self.assertEqual(probe["lights"][0]["azimuth_degrees"], -180)
        self.assertEqual(probe["lights"][0]["elevation_degrees"], 90)
        self.assertEqual(probe["lights"][0]["color_mode"], "temperature")
        self.assertEqual(probe["environment"]["relative_exposure_ev"], -8)


class LightingReferenceIntegrationContractTests(unittest.TestCase):
    def test_toolbar_entry_follows_angle_control(self):
        angle = "{key:'angle-control', icon:'angle-control', label:tr('nav.angle'), enabled:true}"
        lighting = "{key:'lighting-reference', icon:'lighting-reference', label:tr('smart.contextLightingReference'), enabled:true}"
        self.assertIn(angle, HOST)
        self.assertIn(lighting, HOST)
        self.assertLess(HOST.index(angle), HOST.index(lighting))

    def test_dialog_reuses_two_column_processor_shell(self):
        self.assertIn("'lighting-reference'", DIALOG)
        self.assertIn('data-ai-processor-layout="lighting-reference"', DIALOG)
        self.assertIn("<section data-lighting-controller-column>", DIALOG)
        self.assertIn("<section data-ai-processor-panel>", DIALOG)
        self.assertIn('<ic-segmented-control class="ai-lighting-color-mode" size="small" label="颜色模式"', DIALOG)
        self.assertIn('data-lighting-color-mode', DIALOG)
        self.assertIn('<ic-number-input name="ai-lighting-${key}" label="${label}" size="small"', DIALOG)
        self.assertIn('<ic-color-field name="ai-lighting-rgb" label="RGB 颜色" size="small"', DIALOG)
        self.assertIn('<ic-textarea label="中文 Prompt" size="small"', DIALOG)
        self.assertIn('<ic-textarea label="English Prompt" size="small"', DIALOG)
        self.assertIn('<span id="ai-lighting-casts-shadow-label">开启投影</span>', DIALOG)
        self.assertIn('label="开启投影" aria-labelledby="ai-lighting-casts-shadow-label"', DIALOG)
        self.assertNotIn('启用主光投影', DIALOG)
        for copy in (
            "选择一个 Prompt 权威值",
            "相机相对坐标；负方位角始终在左侧",
            "相对于当前场景的 EV",
            "来源图 · 仅作视觉上下文",
            "同一状态固定生成，不调用模型",
        ):
            self.assertNotIn(copy, DIALOG)
        self.assertNotIn("exportLightingSnapshot", DIALOG)

    def test_single_ball_preview_disposes_all_runtime_resources_without_export_pipeline(self):
        self.assertIn("const referenceMaterial = new THREE.MeshPhysicalMaterial", CONTROLLER)
        self.assertIn("clearcoatRoughness", CONTROLLER)
        self.assertIn("const referenceBall = new THREE.Mesh", CONTROLLER)
        self.assertIn("KEY_LIGHT_SAMPLE_OFFSETS", CONTROLLER)
        self.assertNotIn("bundle.key.shadow.radius", CONTROLLER)
        self.assertNotIn("const chromeMaterial", CONTROLLER)
        self.assertNotIn("const matteMaterial", CONTROLLER)
        self.assertNotIn("exportSnapshot()", CONTROLLER)
        self.assertNotIn("renderRigDiagram", CONTROLLER)
        self.assertNotIn("renderContactSheet", CONTROLLER)
        self.assertNotIn("new File(", CONTROLLER)
        self.assertNotIn("canvasBlob", CONTROLLER)
        self.assertIn("observer.disconnect()", CONTROLLER)
        self.assertIn("cancelAnimationFrame(animationFrame)", CONTROLLER)
        self.assertIn("renderer.forceContextLoss?.()", CONTROLLER)
        self.assertNotIn("toDataURL", CONTROLLER)
        self.assertIn("removeEventListener?.('lighting-controller-change'", DIALOG)
        self.assertIn("mountToken!==this.lightingMountToken", DIALOG)

    def test_confirmation_creates_one_image_generation_node_with_composer_prompt(self):
        start = HOST.index("async function submitLightingReferenceProcessor")
        end = HOST.index("\nfunction aiProcessorAngleTarget", start)
        submission = HOST[start:end]
        self.assertNotIn("uploadFiles", submission)
        self.assertNotIn("lightingReferenceKind", submission)
        self.assertEqual(submission.count("canvasMutation.create({"), 1)
        self.assertEqual(submission.count("canvasMutation.history({action:'capture'})"), 1)
        self.assertEqual(submission.count("canvasMutation.history({action:'commit'})"), 1)
        self.assertIn("metadata.lightingIntent", SPEC)
        self.assertIn("kind:'image'", submission)
        self.assertNotIn("kind:'prompt'", submission)
        self.assertIn("referenceGenerationKind='image'", submission)
        self.assertIn("setPromptDraftForNode", submission)
        self.assertIn("source.metadata", submission)
        self.assertIn("generationNode.metadata", submission)
        self.assertIn("const promptText=String(detail.lightingPrompts?.en||'').trim()", submission)
        self.assertNotIn("lighting-intent.json", submission)

    def test_current_spec_records_staged_generation_boundary(self):
        self.assertIn("不调用 Provider、Model 或 Generation Run", SPEC)
        self.assertIn("Generation Node", SPEC)
        self.assertIn("smartNodeFloatingPortal", SPEC)
        self.assertIn("azimuth < 0", SPEC)


if __name__ == "__main__":
    unittest.main()
