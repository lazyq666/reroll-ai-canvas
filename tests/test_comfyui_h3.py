"""H3 compilation is isolated from API providers and preserves input identity."""
from copy import deepcopy
import unittest

from infinite_canvas.providers.comfyui_h3 import (
    compile_h3, h3_capability, reference_path, validate_references,
)


def template():
    # Deliberately synthetic; no user's prompt, media or local model names.
    return {
        "1": {"class_type": "VAELoader", "inputs": {"vae_name": "fixture"}},
        "7": {"class_type": "MiniMaxH3AudioConditioningT8", "inputs": {
            "width": ["29", 0], "height": ["29", 1], "prompt": ["97", 0],
            "ref_images.ref_image_0": ["121", 0], "video_vae": ["1", 0],
        }},
        "11": {"class_type": "RandomNoise", "inputs": {"noise_seed": 1}},
        "10": {"class_type": "BasicGuider", "inputs": {"conditioning": ["7", 0]}},
        "12": {"class_type": "SamplerCustomAdvanced", "inputs": {"latent_image": ["7", 1], "noise": ["11", 0], "guider": ["10", 0]}},
        "13": {"class_type": "MiniMaxH3LearnedLatentUpscaleT8Advanced", "inputs": {"av_latent": ["12", 1]}},
        "14": {"class_type": "MiniMaxH3AudioConditioningT8", "inputs": {
            "width": ["13", 1], "height": ["13", 2], "prompt": ["97", 0],
            "ref_images.ref_image_0": ["121", 0], "video_vae": ["1", 0],
        }},
        "15": {"class_type": "MiniMaxH3TwoPassLatentReconcileT8Advanced", "inputs": {
            "learned_latent": ["13", 0], "highres_template": ["14", 1], "positive": ["14", 0],
        }},
        "17": {"class_type": "BasicGuider", "inputs": {"conditioning": ["15", 1]}},
        "19": {"class_type": "SamplerCustomAdvanced", "inputs": {"latent_image": ["15", 0], "noise": ["11", 0], "guider": ["17", 0]}},
        "20": {"class_type": "MiniMaxH3AVDecodeT8", "inputs": {"av_latent": ["19", 0]}},
        "21": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["20", 0], "audio": ["20", 1]}},
        "29": {"class_type": "ResolutionSelector", "inputs": {"megapixels": .5}},
        "97": {"class_type": "CR Prompt Text", "inputs": {"prompt": "private example"}},
        "121": {"class_type": "LoadImage", "inputs": {"image": "private-example.png"}},
        "185": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["20", 0]}},
    }


def reference(number=0, kind="image", **extra):
    return {"kind": kind, "name": f"ref-{number}.png" if kind == "image" else f"ref-{number}.mp4", "subfolder": "batch", "type": "input", "backend": "127.0.0.1:8188", "instance_id": str(number), **extra}


class H3CompilerTests(unittest.TestCase):
    def compile(self, references=None, **inputs):
        return compile_h3(template(), "Animate <Picture 1>.", {"references": references or [reference()], **inputs}, seed=123)

    def test_image_count_and_reordering_are_shared_by_both_stages(self):
        for count in (1, 2, 6):
            refs = [reference(number) for number in reversed(range(count))]
            result = self.compile(refs)
            low = {k: v for k, v in result.graph["7"]["inputs"].items() if k.startswith("ref_")}
            high = {k: v for k, v in result.graph["14"]["inputs"].items() if k.startswith("ref_")}
            self.assertEqual(low, high)
            self.assertEqual(count, len(low))
            for index, ref in enumerate(refs):
                node = result.graph[low[f"ref_images.ref_image_{index}"][0]]
                self.assertEqual(f"batch/{ref['name']}", node["inputs"]["image"])

    def test_duplicate_media_remains_two_reference_instances(self):
        refs = [reference(1), reference(1, instance_id="second")]
        result = self.compile(refs)
        self.assertIn("reroll_h3_ref_0", result.graph)
        self.assertIn("reroll_h3_ref_1", result.graph)

    def test_template_is_immutable_and_private_samples_are_removed(self):
        graph = template()
        original = deepcopy(graph)
        result = compile_h3(graph, "User prompt", {"references": [reference()]}, seed=19)
        self.assertEqual(original, graph)
        for nid in ("121", "97", "29", "185"):
            self.assertNotIn(nid, result.graph)
        self.assertEqual("User prompt", result.graph["7"]["inputs"]["prompt"])
        self.assertEqual("User prompt", result.graph["14"]["inputs"]["prompt"])

    def test_every_size_and_duration_matches_the_public_contract(self):
        cap = h3_capability(template())
        self.assertEqual(list(range(4, 16)), cap["durations"])
        self.assertEqual(4, cap["defaults"]["duration"])
        for resolution, ratios in cap["resolution_sizes"].items():
            for ratio, size in ratios.items():
                for duration in cap["durations"]:
                    result = self.compile(duration=duration, resolution=resolution, aspect_ratio=ratio)
                    self.assertEqual((size["width"], size["height"]), (result.width, result.height))
                    self.assertEqual(0, result.width % 32)
                    self.assertEqual(0, result.height % 32)
                    self.assertEqual(5, result.frame_count % 17)
                    self.assertGreaterEqual(result.frame_count, duration * 24)
                    self.assertEqual(duration * 24, result.graph["reroll_h3_trim_frames"]["inputs"]["length"])
                    self.assertEqual(f"0:{duration:02d}", result.graph["reroll_h3_trim_audio"]["inputs"]["end_time"])
                    self.assertEqual(["13", 1], result.graph["14"]["inputs"]["width"])
                    self.assertEqual(size["width"], result.graph["13"]["inputs"]["target_width"])
        output = self.compile().graph["21"]["inputs"]
        self.assertEqual("mp4", output["format"])
        self.assertEqual("h264", output["format.codec"])
        self.assertEqual("SaveVideo", self.compile().graph["21"]["class_type"])
        video = self.compile().graph["reroll_h3_create_video"]["inputs"]
        self.assertEqual(8, video["bit_depth"])
        self.assertEqual("sRGB", video["color_space"])

    def test_multimodal_order_soundtrack_and_audio_tags(self):
        refs = [reference(0, "audio", duration=4), reference(1, "video", duration=4, include_audio=False), reference(2, "video", duration=4, include_audio=True), reference(3)]
        result = compile_h3(template(), "<Audio 1> <Audio 2> <Video 2> <Picture 1>", {"references": refs}, seed=1)
        low = result.graph["7"]["inputs"]
        self.assertNotIn("ref_video_audios.ref_video_audio_0", low)
        self.assertEqual(["reroll_h3_ref_2", 2], low["ref_video_audios.ref_video_audio_1"])
        self.assertEqual(["reroll_h3_ref_0", 0], low["ref_audios.ref_audio_0"])
        self.assertEqual(24, result.graph["reroll_h3_ref_2"]["inputs"]["force_rate"])
        with self.assertRaisesRegex(ValueError, "prompt_reference_missing"):
            compile_h3(template(), "<Audio 3>", {"references": refs}, seed=1)

    def test_invalid_inputs_fail_without_silent_truncation_or_fallback(self):
        for refs in ([], [reference(i) for i in range(7)], [reference(0, "text")]):
            with self.assertRaises(ValueError):
                compile_h3(template(), "", {"references": refs}, seed=1)
        for inputs in ({"duration": 2}, {"duration": True}, {"resolution": "720p"}, {"aspect_ratio": "auto"}):
            with self.assertRaises(ValueError):
                self.compile(**inputs)
        with self.assertRaisesRegex(ValueError, "prompt_reference_missing"):
            compile_h3(template(), "<Picture 2>", {"references": [reference()]}, seed=1)
        with self.assertRaisesRegex(ValueError, "invalid_template"):
            compile_h3({"7": {"class_type": "SaveImage"}}, "", {"references": [reference()]}, seed=1)
        self.assertIsNone(h3_capability({"7": {"class_type": "SaveImage"}}))

    def test_reference_duration_and_paths_are_checked(self):
        for duration in (1, 16, float("nan")):
            with self.assertRaisesRegex(ValueError, "reference_duration"):
                validate_references([reference(0, "video", duration=duration)])
        with self.assertRaisesRegex(ValueError, "reference_duration_total"):
            validate_references([reference(0, "audio", duration=8), reference(1, "audio", duration=8)])
        with self.assertRaisesRegex(ValueError, "duration_unknown"):
            validate_references([reference(0, "audio")], require_durations=True)
        for name in ("../file.png", "/file.png", "C:/file.png", "file//a.png"):
            with self.assertRaisesRegex(ValueError, "invalid_reference"):
                reference_path(reference(name=name))
