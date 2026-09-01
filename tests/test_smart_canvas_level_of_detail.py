import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/canvas-level-of-detail.js"
FAR_PRESENTATION_MODULE = (
    ROOT / "static/js/smart-canvas/canvas-far-presentation.js"
)


def run_level_of_detail(script):
    program = f"const lod = require({json.dumps(str(MODULE))});{script}"
    result = subprocess.run(
        ["node", "-e", program],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def run_far_presentation(script):
    program = (
        f"const far = require({json.dumps(str(FAR_PRESENTATION_MODULE))});"
        f"{script}"
    )
    result = subprocess.run(
        ["node", "-e", program],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class SmartCanvasLevelOfDetailTests(unittest.TestCase):
    def test_designer_and_share_load_one_far_presentation_owner(self):
        designer = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        share = (ROOT / "static/share.html").read_text(encoding="utf-8")
        host = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        share_host = (ROOT / "static/js/canvas-share.js").read_text(encoding="utf-8")

        for page in (designer, share):
            self.assertEqual(page.count("/canvas-far-presentation.js?v="), 1)
        self.assertIn("canvasFarPresentation.render({", host)
        self.assertIn("canvasFarPresentation.render({", share_host)

    def test_far_presentation_reuses_prompt_group_and_media_surfaces(self):
        result = run_far_presentation(
            """
            const prompt = far.render({
                kind:'prompt', layout:{height:180}, labels:{prompt:'Prompt'}
            });
            const group = far.render({
                kind:'group', group:{count:3,columns:2}, labels:{group:'3 images'}
            });
            const media = far.render({
                kind:'image', layout:{width:320,height:180},
                media:{kind:'image',signature:'image:one',markup:'<img data-preview-size="512">'}
            });
            process.stdout.write(JSON.stringify({prompt, group, media}));
            """
        )

        self.assertIn('class="far-prompt-skeleton"', result["prompt"])
        self.assertIn('data-line-count="7"', result["prompt"])
        self.assertEqual(
            result["group"].count("far-smart-group-media-skeleton-item"),
            3,
        )
        self.assertIn('class="far-node-media"', result["media"])
        self.assertIn('data-preview-size="512"', result["media"])

    def test_default_threshold_keeps_mode_stable_inside_five_percent_gap(self):
        result = run_level_of_detail(
            """
            lod.reset({scale:1});
            const states = [0.22, 0.23, 0.24, 0.28, 0.29]
                .map(scale => lod.update(scale).mode);
            process.stdout.write(JSON.stringify(states));
            """
        )

        self.assertEqual(result, ["far", "far", "far", "far", "detail"])

    def test_custom_thresholds_are_clamped_and_keep_fixed_exit_gap(self):
        result = run_level_of_detail(
            """
            const summaries = [0.10, 0.50, 1.00].map(threshold => {
                lod.reset({enterThreshold:threshold, scale:1});
                const configured = lod.diagnostics();
                lod.update(threshold - 0.01);
                const entered = lod.diagnostics().mode;
                lod.update(threshold + 0.04);
                const held = lod.diagnostics().mode;
                lod.update(threshold + 0.06);
                const exited = lod.diagnostics().mode;
                return {configured, entered, held, exited};
            });
            process.stdout.write(JSON.stringify(summaries));
            """
        )

        self.assertEqual(
            [round(item["configured"]["enterThreshold"], 2) for item in result],
            [0.10, 0.50, 1.00],
        )
        self.assertEqual(
            [round(item["configured"]["exitThreshold"], 2) for item in result],
            [0.15, 0.55, 1.05],
        )
        self.assertTrue(all(item["entered"] == "far" for item in result))
        self.assertTrue(all(item["held"] == "far" for item in result))
        self.assertTrue(all(item["exited"] == "detail" for item in result))

    def test_disabling_far_mode_returns_detail_and_invalidates_late_resources(self):
        result = run_level_of_detail(
            """
            lod.reset({scale:0.2});
            const before = lod.diagnostics();
            const after = lod.configure({enabled:false, scale:0.2});
            process.stdout.write(JSON.stringify({before, after}));
            """
        )

        self.assertEqual(result["before"]["mode"], "far")
        self.assertEqual(result["after"]["mode"], "detail")
        self.assertGreater(
            result["after"]["resourceGeneration"],
            result["before"]["resourceGeneration"],
        )


if __name__ == "__main__":
    unittest.main()
