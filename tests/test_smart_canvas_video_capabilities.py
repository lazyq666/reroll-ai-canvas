import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/video-capabilities.js"
HOST = ROOT / "static/js/smart-canvas.js"
PROVIDER = ROOT / "static/js/smart-canvas/generation-provider.js"
HTML = ROOT / "static/smart-canvas.html"


class SmartCanvasVideoCapabilityTests(unittest.TestCase):
    def run_module(self, expression):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}}, URLSearchParams}};
            vm.createContext(sandbox);
            vm.runInContext(fs.readFileSync({json.dumps(str(MODULE))}, 'utf8'), sandbox);
            const api = sandbox.window.SmartCanvasModules.videoCapabilities;
            process.stdout.write(JSON.stringify({expression}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_no_references_routes_to_text_without_a_selectable_mode(self):
        value = self.run_module(
            "api.resolve({videoReferenceMode:'multimodal_all_around'},[],api.fallback('jimeng','m'))"
        )

        self.assertEqual("text2video", value["command"])
        self.assertIsNone(value["reference_mode"])
        self.assertEqual(0, value["counts"]["total"])

    def test_model_id_canonicalization_is_case_insensitive(self):
        value = self.run_module(
            "api.canonicalModel('jimeng','Seedance2.5',['seedance2.0','seedance2.5'])"
        )

        self.assertEqual("seedance2.5", value)

    def test_first_last_frames_are_the_only_locked_aspect_mode(self):
        value = self.run_module(
            """(() => {
                const capability = api.clean({known:true,commands:{
                    frames2video:{duration_seconds:{minimum:4,maximum:15},video_resolutions:['720p','1080p']},
                    multimodal2video:{duration_seconds:{minimum:4,maximum:15},video_resolutions:['720p'],aspect_ratios:['16:9','9:16']}
                }},'jimeng','seedance2.0_vip');
                return {
                    frames:api.reconcile(
                        {videoReferenceMode:'first_last_frames',videoAspect:'9:16',videoResolution:'1080p',videoDuration:5},
                        [{url:'a.png',kind:'image'},{url:'b.png',kind:'image'}],capability
                    ),
                    omni:api.reconcile(
                        {videoReferenceMode:'multimodal_all_around',videoAspect:'9:16',videoResolution:'720p',videoDuration:5},
                        [{url:'a.png',kind:'image'}],capability
                    )
                };
            })()"""
        )

        self.assertTrue(value["frames"]["state"]["aspect_ratio_locked"])
        self.assertEqual("adaptive", value["frames"]["settings"]["videoAspect"])
        self.assertEqual("1080p", value["frames"]["settings"]["videoResolution"])
        self.assertFalse(value["omni"]["state"]["aspect_ratio_locked"])
        self.assertEqual("9:16", value["omni"]["settings"]["videoAspect"])

    def test_seedance_has_no_image_to_video_mode_and_frames_can_be_selected_early(self):
        value = self.run_module(
            """(() => {
                const capability = api.clean({provider_id:'jimeng',known:true,commands:{
                    frames2video:{duration_seconds:{minimum:4,maximum:15},video_resolutions:['720p'],image_count:{minimum:1,maximum:2}},
                    multimodal2video:{duration_seconds:{minimum:4,maximum:15},video_resolutions:['720p'],aspect_ratios:['16:9','9:16']}
                }},'jimeng','seedance2.0');
                const oneImage = [{url:'a.png',kind:'image'}];
                const legacyImageMode = api.resolve({videoReferenceMode:'image_to_video'},oneImage,capability);
                const selectedFrames = api.resolve({videoReferenceMode:'first_last_frames'},oneImage,capability);
                return {
                    legacyImageMode,
                    selectedFrames,
                    validation:api.validateReferences(selectedFrames)
                };
            })()"""
        )

        self.assertEqual("multimodal_all_around", value["legacyImageMode"]["reference_mode"])
        self.assertEqual("multimodal2video", value["legacyImageMode"]["command"])
        self.assertEqual("first_last_frames", value["selectedFrames"]["reference_mode"])
        self.assertEqual("frames2video", value["selectedFrames"]["command"])
        self.assertTrue(value["selectedFrames"]["aspect_ratio_locked"])
        self.assertTrue(value["validation"]["valid"])

    def test_model_constraints_reconcile_duration_resolution_and_reference_count(self):
        value = self.run_module(
            """(() => {
                const capability = api.clean({known:true,commands:{
                    multimodal2video:{
                        duration_seconds:{minimum:4,maximum:30},
                        video_resolutions:['480p','720p','1080p'],
                        aspect_ratios:['16:9','9:16'],
                        inputs:{image_count:{maximum:30},video_count:{maximum:10},audio_count:{maximum:10},total_count:{maximum:50},audio_only_supported:true}
                    }
                }},'jimeng','seedance2.5');
                const refs = Array.from({length:51},(_,index) => ({url:`${index}.png`,kind:'image'}));
                const reconciled = api.reconcile({videoDuration:60,videoResolution:'4k',videoAspect:'16:9'},refs,capability);
                return {reconciled,validation:api.validateReferences(reconciled.state)};
            })()"""
        )

        self.assertEqual(30, value["reconciled"]["settings"]["videoDuration"])
        self.assertEqual("720p", value["reconciled"]["settings"]["videoResolution"])
        self.assertFalse(value["validation"]["valid"])
        self.assertIn(value["validation"]["reason"], {"image-count", "total-count"})

    def test_backend_options_only_keep_user_toggle_settings(self):
        value = self.run_module(
            """(() => {
                const capability = api.clean({
                    backend_path:{id:'yuli_create'},
                    composer_option_definitions:{
                        enhance_prompt:{setting_key:'videoEnhancePrompt'},
                        enable_upsample:{setting_key:'videoEnableUpsample'},
                        generate_audio:{setting_key:'videoGenerateAudio'},
                        camera_fixed:{setting_key:'videoCameraFixed'},
                        watermark:{setting_key:'videoWatermark'}
                    },
                    composer_options:{
                        enhance_prompt:'automatic',
                        enable_upsample:'user_toggle',
                        generate_audio:'unsupported',
                        camera_fixed:'unsupported',
                        watermark:'unsupported'
                    }
                },'yuli','doubao');
                return {
                    enhance:api.optionMode(capability,'enhance_prompt'),
                    upsample:api.optionMode(capability,'enable_upsample'),
                    settings:api.applyComposerOptions({
                        videoEnhancePrompt:true,
                        videoEnableUpsample:true,
                        videoGenerateAudio:true,
                        videoCameraFixed:true,
                        videoWatermark:true
                    },capability)
                };
            })()"""
        )

        self.assertEqual("automatic", value["enhance"])
        self.assertEqual("user_toggle", value["upsample"])
        self.assertFalse(value["settings"]["videoEnhancePrompt"])
        self.assertTrue(value["settings"]["videoEnableUpsample"])
        self.assertFalse(value["settings"]["videoGenerateAudio"])
        self.assertFalse(value["settings"]["videoCameraFixed"])
        self.assertFalse(value["settings"]["videoWatermark"])

    def test_composer_and_submission_consume_the_capability_module(self):
        host = HOST.read_text(encoding="utf-8")
        provider = PROVIDER.read_text(encoding="utf-8")
        html = HTML.read_text(encoding="utf-8")

        self.assertIn("smart-canvas/video-capabilities.js", html)
        self.assertLess(
            html.index("smart-canvas/video-capabilities.js"),
            html.index("smart-canvas/generation-settings.js"),
        )
        self.assertIn("smartVideoComposerState()", host)
        self.assertIn("renderJimengReferenceModeControl(videoState)", host)
        self.assertNotIn("label:tr('smart.videoImageToVideo')", host)
        self.assertIn("renderVideoCapabilityToggle(capability, 'enhance_prompt'", host)
        self.assertIn("renderVideoCapabilityToggle(capability, 'generate_audio'", host)
        self.assertIn("videoState?.aspect_ratio_locked ? 'lock-ratio'", host)
        self.assertNotIn("JIMENG_SEEDANCE_VIDEO_MODELS", host)
        self.assertIn("await videoCapabilities?.load", provider)
        self.assertIn("videoCapabilities?.applyComposerOptions", provider)
        self.assertIn("videoCapabilities.reconcile", provider)
        self.assertIn("videoCapabilities.validateReferences", provider)


if __name__ == "__main__":
    unittest.main()
