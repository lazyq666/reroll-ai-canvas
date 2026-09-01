import unittest
from pathlib import Path

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.video_capabilities import VideoCapabilityRegistry


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "resources" / "video-model-capabilities.json"


class VideoCapabilityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.registry = VideoCapabilityRegistry(REGISTRY_PATH)

    def test_catalog_only_exposes_product_supported_seedance_models(self):
        catalog = self.registry.public("jimeng")

        self.assertFalse(catalog["known"])
        self.assertEqual(
            [
                "seedance2.0",
                "seedance2.0fast",
                "seedance2.0_vip",
                "seedance2.0fast_vip",
                "seedance2.0mini",
                "seedance2.5",
            ],
            catalog["supported_model_ids"],
        )
        self.assertNotIn("seedance1.5pro", catalog["supported_model_ids"])

    def test_model_ids_are_matched_case_insensitively(self):
        capability = self.registry.public("jimeng", "Seedance2.5")

        self.assertTrue(capability["known"])
        self.assertEqual("seedance2.5-vip", capability["capability_profile_id"])

    def test_model_profiles_expose_exact_resolution_and_reference_limits(self):
        standard = self.registry.public("jimeng", "seedance2.0fast")
        vip = self.registry.public("jimeng", "seedance2.0_vip")
        latest = self.registry.public("jimeng", "seedance2.5")

        self.assertEqual(
            ["720p"], standard["commands"]["text2video"]["video_resolutions"]
        )
        self.assertEqual(
            ["720p", "1080p", "4k"],
            vip["commands"]["text2video"]["video_resolutions"],
        )
        for command in (
            "text2video",
            "image2video",
            "frames2video",
            "multimodal2video",
        ):
            self.assertEqual(
                ["480p", "720p", "1080p"],
                latest["commands"][command]["video_resolutions"],
            )
        self.assertEqual(
            {"minimum": 4, "maximum": 30},
            latest["commands"]["multimodal2video"]["duration_seconds"],
        )
        self.assertEqual(
            50,
            latest["commands"]["multimodal2video"]["inputs"]["total_count"]["maximum"],
        )
        self.assertTrue(
            latest["commands"]["multimodal2video"]["inputs"]["audio_only_supported"]
        )

    def test_every_supported_seedance_model_supports_first_last_frames(self):
        catalog = self.registry.public("jimeng")

        for model_id in catalog["supported_model_ids"]:
            with self.subTest(model_id=model_id):
                capability = self.registry.public("jimeng", model_id)
                self.assertIn("frames2video", capability["commands"])
                self.assertGreaterEqual(
                    capability["commands"]["frames2video"]["duration_seconds"]["minimum"],
                    1,
                )
                self.assertEqual(
                    {"minimum": 1, "maximum": 2},
                    capability["commands"]["frames2video"]["image_count"],
                )

    def test_composer_policy_keeps_text_automatic_and_only_locks_frames(self):
        capability = self.registry.public("jimeng", "seedance2.5")
        policy = capability["composer_policy"]

        self.assertFalse(policy["text_to_video"]["selectable_mode"])
        modes = policy["reference_mode_control"]["modes"]
        self.assertTrue(
            modes["multimodal_all_around"]["aspect_ratio_control"]["editable"]
        )
        self.assertNotIn("image_to_video", modes)
        self.assertFalse(
            modes["first_last_frames"]["aspect_ratio_control"]["editable"]
        )
        self.assertEqual(
            "adaptive",
            modes["first_last_frames"]["aspect_ratio_control"]["value"],
        )

    def test_backend_path_contract_matches_the_actual_video_adapter(self):
        cases = [
            (
                self.registry.public(
                    "custom", "veo3-fast", protocol="openai", base_url="https://video.example"
                ),
                "generic_json_video",
                {
                    "enhance_prompt": "user_toggle",
                    "enable_upsample": "user_toggle",
                    "generate_audio": "user_toggle",
                    "camera_fixed": "user_toggle",
                    "watermark": "user_toggle",
                },
            ),
            (
                self.registry.public(
                    "volcengine",
                    "doubao-seedance-2-0-fast-260128",
                    protocol="volcengine",
                    base_url="https://ark.cn-beijing.volces.com/api/v3",
                ),
                "volcengine_native",
                {
                    "enhance_prompt": "unsupported",
                    "enable_upsample": "unsupported",
                    "generate_audio": "user_toggle",
                    "camera_fixed": "user_toggle",
                    "watermark": "user_toggle",
                },
            ),
            (
                self.registry.public(
                    "yuli", "doubao", base_url="https://api.yuli.host"
                ),
                "yuli_create",
                {
                    "enhance_prompt": "automatic",
                    "enable_upsample": "user_toggle",
                    "generate_audio": "unsupported",
                    "camera_fixed": "unsupported",
                    "watermark": "unsupported",
                },
            ),
            (
                self.registry.public(
                    "yuli", "veo_3_1-fast", base_url="https://api.yuli.host/v1"
                ),
                "yuli_veo_openai",
                {"watermark": "user_toggle"},
            ),
            (
                self.registry.public(
                    "lingjing", "veo_3_1-fast", base_url="https://api.apistudio.vip"
                ),
                "lingjing_openai_video",
                {"watermark": "user_toggle"},
            ),
            (
                self.registry.public(
                    "apimart",
                    "doubao-seedance-2-0",
                    protocol="apimart",
                    base_url="https://api.apimart.ai/v1",
                ),
                "apimart_seedance",
                {"generate_audio": "user_toggle"},
            ),
            (
                self.registry.public(
                    "apimart",
                    "veo3.1-fast",
                    protocol="apimart",
                    base_url="https://api.apimart.ai/v1",
                ),
                "apimart_veo31",
                {},
            ),
            (
                self.registry.public(
                    "runninghub", "rh-video", protocol="runninghub"
                ),
                "runninghub_schema",
                {"generate_audio": "schema", "watermark": "schema"},
            ),
            (
                self.registry.public(
                    "agnes", "agnes-video-v2.0", base_url="https://apihub.agnes-ai.com"
                ),
                "agnes_openai_video",
                {},
            ),
        ]

        for capability, contract_id, expected in cases:
            with self.subTest(contract_id=contract_id):
                self.assertEqual(contract_id, capability["backend_path"]["id"])
                for option, mode in expected.items():
                    self.assertEqual(mode, capability["composer_options"][option])
        veo_options = cases[6][0]["composer_options"]
        self.assertTrue(all(mode == "unsupported" for mode in veo_options.values()))
        agnes_options = cases[8][0]["composer_options"]
        self.assertTrue(all(mode == "unsupported" for mode in agnes_options.values()))

    def test_volcengine_proxy_path_falls_back_to_generic_json_contract(self):
        capability = self.registry.public(
            "volcengine",
            "proxy-model",
            protocol="volcengine",
            base_url="https://proxy.example/custom/video",
        )

        self.assertEqual("generic_json_video", capability["backend_path"]["id"])
        self.assertEqual("user_toggle", capability["composer_options"]["enhance_prompt"])

    async def test_api_returns_resolved_model_capability(self):
        response = await main.video_model_capability("jimeng", "seedance2.5")

        self.assertTrue(response["known"])
        self.assertEqual("seedance2.5", response["model_id"])
        self.assertEqual("seedance2.5-vip", response["capability_profile_id"])


if __name__ == "__main__":
    unittest.main()
