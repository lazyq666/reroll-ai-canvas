import json
import subprocess
import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class Issue112GenerationInfoModalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = read_smart_canvas_scripts(ROOT)
        cls.html = (ROOT / "static" / "smart-canvas.html").read_text()
        cls.styles = (ROOT / "static" / "css" / "smart-canvas.css").read_text()
        cls.translations = (ROOT / "static" / "js" / "i18n" / "smart-canvas.js").read_text()

    def test_fill_prompt_uses_only_the_explicit_prompt_and_closes(self):
        start = self.script.index("function applySmartContextResultToComposer")
        end = self.script.index(
            "\nsmartContextResultApply?.addEventListener",
            start,
        )
        helper = self.script[start:end]
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
const nodes = [
    {{id:'selected-node', type:'smart-image', manualInputRefs:[{{url:'keep-this-image'}}]}},
    {{id:'stale-dialog-target', type:'smart-image'}},
];
let selectedId = 'selected-node';
let selectedIds = [];
let selectedImage = {{nodeId:'', index:-1}};
let smartContextResultState = {{
    targetNodeId:'stale-dialog-target',
    targetImageIndex:2,
    applyText:'根据附件图的角色生成 4 宫格设定图'
}};
const smartContextResultText = {{value:`生成时间：8/23/2026, 12:23:39 AM
生成时长：59s
引擎：api
模型：gpt-image-2
提示词：根据附件图的角色生成 4 宫格设定图
尺寸 / 分辨率：2k
时长：5s
数量：1`}};
const window = {{SmartCanvasModules:{{viewportSelection:{{selection:{{
    node:() => nodes.find(node => node.id === selectedId),
}}}}}}}};
const isSmartRunnableNode = node => node?.type === 'smart-image';
const setPromptDraftForNode = (node, value) => {{
    node.promptDraftText = value;
    node.promptDraftHtml = value;
}};
let renders = 0;
let composerUpdates = 0;
let saves = 0;
let closes = 0;
let notices = 0;
const render = () => {{ renders += 1; }};
const updateComposer = () => {{ composerUpdates += 1; }};
const canvasPersistence = {{schedule:() => {{ saves += 1; }}}};
const closeSmartContextResult = () => {{ closes += 1; smartContextResultState = null; }};
const toast = () => {{ notices += 1; }};
const tr = key => key;
{helper}
const applied = applySmartContextResultToComposer();
process.stdout.write(JSON.stringify({{
    applied,
    selectedId,
    selectedIds,
    selectedImage,
    selectedPrompt:nodes[0].promptDraftText || '',
    stalePrompt:nodes[1].promptDraftText || '',
    inputRefs:nodes[0].manualInputRefs,
    renders,
    composerUpdates,
    saves,
    closes,
    notices,
}}));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "applied": True,
                "selectedId": "selected-node",
                "selectedIds": [],
                "selectedImage": {"nodeId": "", "index": -1},
                "selectedPrompt": "根据附件图的角色生成 4 宫格设定图",
                "stalePrompt": "",
                "inputRefs": [{"url": "keep-this-image"}],
                "renders": 1,
                "composerUpdates": 1,
                "saves": 1,
                "closes": 1,
                "notices": 1,
            },
        )

    def test_apply_button_is_bound_to_the_tested_helper(self):
        self.assertIn(
            "smartContextResultApply?.addEventListener('click', "
            "applySmartContextResultToComposer)",
            self.script,
        )

    def test_generation_info_reads_frozen_images_and_elapsed_time(self):
        start = self.script.index("function smartRunInfoElapsedMs")
        end = self.script.index("\nfunction renderSmartContextResultInputs", start)
        helpers = self.script[start:end]
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
const mediaKindForItem = ref => ref.kind || 'image';
{helpers}
const first = {{url:'/assets/input.png', name:'input.png', kind:'image', inputInstanceId:'instance-1'}};
const second = {{url:'/assets/input.png', name:'input.png', kind:'image', inputInstanceId:'instance-2'}};
const node = {{
    runElapsedMs:3250,
    runInputRefs:[{{url:'/assets/legacy.png', kind:'image'}}],
    generationInputSnapshot:{{refs:[first, second, {{url:'/assets/input.mp4', kind:'video'}}]}}
}};
const images = smartRunInfoInputImages(node);
process.stdout.write(JSON.stringify({{
    elapsed:smartRunInfoElapsedMs(node),
    imageInstances:images.map(ref => ref.inputInstanceId),
    fallback:smartRunInfoInputImages({{runInputRefs:[{{url:'/assets/legacy.png', kind:'image'}}]}}).map(ref => ref.url),
    emptySnapshotFallback:smartRunInfoInputImages({{
        generationInputSnapshot:{{refs:[]}},
        runInputRefs:[{{url:'/assets/legacy.png', kind:'image'}}]
    }}).map(ref => ref.url),
    derivedElapsed:smartRunInfoElapsedMs({{runStartedAt:1000, runFinishedAt:4250}}),
    unknownElapsed:smartRunInfoElapsedMs({{}}),
}}));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "elapsed": 3250,
                "imageInstances": ["instance-1", "instance-2"],
                "fallback": ["/assets/legacy.png"],
                "emptySnapshotFallback": ["/assets/legacy.png"],
                "derivedElapsed": 3250,
                "unknownElapsed": None,
            },
        )

    def test_image_generation_info_omits_video_duration(self):
        start = self.script.index("function smartRunInfoOutputKind")
        end = self.script.index("\nfunction aiProcessorPromptLibrary", start)
        helper = self.script[start:end]
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
const smartRunInfoElapsedMs = () => 59000;
const formatRunDuration = ms => `${{Math.floor(ms / 1000)}}s`;
const tr = key => key;
const trf = (key, values) => `${{key}}:${{values.value}}`;
const mediaKindForItem = item => item.kind || (/\\.mp4$/.test(item.url || '') ? 'video' : 'image');
{helper}
const settings = {{engine:'api',model:'gpt-image-2',videoDuration:5,count:1}};
const imageText = smartRunInfoText({{
    runAt:1700000000000,
    runPrompt:'prompt',
    runSettings:settings,
    images:[{{url:'/assets/result.png',kind:'image'}}]
}});
const videoText = smartRunInfoText({{
    runAt:1700000000000,
    runPrompt:'prompt',
    runSettings:settings,
    images:[{{url:'/assets/result.mp4',kind:'video'}}]
}});
process.stdout.write(JSON.stringify({{
    imageHasVideoDuration:imageText.includes('smart.durationInfo:5'),
    videoHasVideoDuration:videoText.includes('smart.durationInfo:5')
}}));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {"imageHasVideoDuration": False, "videoHasVideoDuration": True},
        )

    def test_view_generation_info_wires_duration_and_input_image_ui(self):
        self.assertIn('id="smartContextResultInputs"', self.html)
        self.assertIn('id="smartContextResultInputList"', self.html)
        self.assertIn('"smart.runElapsed"', self.translations)
        self.assertIn('"smart.runInputImages"', self.translations)
        self.assertIn("inputImages:smartRunInfoInputImages(node)", self.script)
        self.assertIn("applyText:node.runPrompt || node.runModelPrompt || ''", self.script)
        self.assertIn("allowApply:true", self.script)
        self.assertIn("renderSmartContextResultInputs(options.inputImages)", self.script)
        self.assertIn(".smart-context-result-panel footer button[hidden]", self.styles)


if __name__ == "__main__":
    unittest.main()
