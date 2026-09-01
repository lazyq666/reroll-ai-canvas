import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "static" / "js" / "smart-canvas.js"
STUDIO = ROOT / "static" / "js" / "smart-canvas" / "image-studio.js"
HTML = ROOT / "static" / "smart-canvas.html"
I18N = ROOT / "static" / "js" / "i18n" / "smart-canvas.js"
GUIDELINES = ROOT / "docs" / "current" / "ui-design-guidelines.md"


class Issue199VideoPlaybackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.studio = STUDIO.read_text(encoding="utf-8")
        cls.html = HTML.read_text(encoding="utf-8")
        cls.i18n = I18N.read_text(encoding="utf-8")
        cls.guidelines = GUIDELINES.read_text(encoding="utf-8")

    def test_inline_player_loops_and_excludes_native_fullscreen(self):
        start = self.script.index("function smartVideoPlayerHtml(url, attrs='')")
        end = self.script.index("function smartVideoPlayButtonHtml", start)
        source = self.script[start:end]
        self.assertIn('controls autoplay loop playsinline', source)
        self.assertIn('controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"', source)
        self.assertIn(
            'controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"',
            self.html,
        )

    def test_fullscreen_video_tools_offer_an_explicit_loop_toggle(self):
        self.assertIn('id="previewVideoLoopBtn"', self.html)
        self.assertIn('toggle onclick="togglePreviewVideoLoop()"', self.html)
        self.assertIn('data-i18n="smart.action.autoLoop"', self.html)
        self.assertIn(
            '"smart.action.autoLoop": { zh: "自动循环", en: "Auto loop" }',
            self.i18n,
        )
        self.assertIn(
            '"smart.action.autoLoopOn": { zh: "循环已开启", en: "Loop on" }',
            self.i18n,
        )
        self.assertIn("function togglePreviewVideoLoop()", self.studio)
        self.assertIn("video.loop = !video.loop", self.studio)
        self.assertIn("function syncPreviewVideoLoopControl(enabled=false)", self.studio)
        self.assertIn("button.setAttribute('hierarchy', 'secondary')", self.studio)
        self.assertNotIn("button.setAttribute('hierarchy', active ? 'primary' : 'secondary')", self.studio)
        self.assertIn("icon.setAttribute('name', active ? 'check' : 'loop')", self.studio)
        self.assertIn("label.textContent = tr(active ? 'smart.action.autoLoopOn' : 'smart.action.autoLoop')", self.studio)

    def test_playback_session_is_keyed_by_node_media_instance(self):
        self.assertIn("const smartPlaybackSession =", self.script)
        self.assertIn("function smartPlaybackKey(nodeId, imageIndex=0)", self.script)
        self.assertIn("function smartPlaybackEntry(nodeId, imageIndex=0)", self.script)
        self.assertIn("smartPlaybackSession.entries", self.script)
        self.assertNotIn("states.set(`${tag}:${url}`", self.script)

    def test_selection_and_interruption_rules_use_one_coordinator(self):
        self.assertIn("function smartPlaybackActivateVideo(nodeId, imageIndex=0", self.script)
        self.assertIn("function smartPlaybackPauseForSelection", self.script)
        self.assertIn("function smartPlaybackPauseForInterruption", self.script)
        self.assertIn("video._smartPlaybackClickTimer = setTimeout", self.script)
        self.assertIn("clearTimeout(video._smartPlaybackClickTimer)", self.script)
        self.assertIn("event.code !== 'Space'", self.script)
        self.assertIn("document.addEventListener('visibilitychange'", self.script)
        self.assertIn("smartPlaybackPauseForInterruption('visibility')", self.script)

    def test_failed_inline_video_returns_to_an_explicit_retry_cover(self):
        self.assertIn("media.addEventListener('error'", self.script)
        self.assertIn("media.dataset.inlineVideoActive === '1'", self.script)
        self.assertIn("smartPlaybackSetInlineActive(target.nodeId, target.imageIndex, false)", self.script)
        self.assertIn("nodeIds:[target.nodeId]", self.script)

    def test_node_and_fullscreen_loop_controls_share_session_state(self):
        self.assertIn("key:'video-loop'", self.script)
        self.assertIn("function toggleSmartVideoLoop(nodeId, imageIndex=0)", self.script)
        self.assertIn("window.smartPlaybackTogglePreviewLoop", self.script)
        self.assertIn("smartPlaybackTogglePreviewLoop(video)", self.studio)

    def test_fullscreen_playback_takes_over_the_inline_playback_state(self):
        start = self.script.index("function openSmartVideoFullscreen(nodeId, imageIndex=0)")
        end = self.script.index("function runSmartNodeToolbarAction", start)
        source = self.script[start:end]
        self.assertIn("captureMediaPlaybackState(inlineVideo)", source)
        self.assertIn("inlineVideo.pause", source)
        self.assertIn("smartPlaybackSession.previewTransfer", source)
        self.assertIn("smartPlaybackRemember(inlineVideo", source)
        self.assertIn("smartPlaybackPreparePreviewVideo", self.studio)

    def test_fullscreen_video_uses_the_media_session_loop_state(self):
        open_start = self.studio.index("function openImageEditor(nodeId, imageIndex=0, options={})")
        open_end = self.studio.index("function applyImageEdit", open_start)
        open_source = self.studio[open_start:open_end]
        self.assertIn("smartPlaybackPreparePreviewVideo", open_source)
        self.assertNotIn("if(previewVideo) previewVideo.loop = true", open_source)

        close_start = self.studio.index("function closeImageEditor(options={})")
        close_end = self.studio.index("function applyImageCrop", close_start)
        close_source = self.studio[close_start:close_end]
        self.assertIn("smartPlaybackClosePreviewVideo", close_source)

    def test_video_double_click_and_toolbar_share_the_same_fullscreen_action(self):
        self.assertIn("function openSmartVideoFullscreen(nodeId, imageIndex=0)", self.script)
        self.assertGreaterEqual(
            self.script.count("openSmartVideoFullscreen(target.targetNodeId, target.imageIndex)"),
            2,
        )
        self.assertIn(
            "if(action === 'video-play' && kind === 'video'){\n        openSmartVideoFullscreen(nodeId, index);",
            self.script,
        )

    def test_current_contract_records_toggle_and_double_click_behavior(self):
        self.assertIn("自动循环", self.guidelines)
        self.assertIn("默认开启", self.guidelines)
        self.assertIn("双击 Video", self.guidelines)
        self.assertIn("加载或重绘时不自动播放", self.guidelines)
        self.assertIn("按 Node 媒体实例保留当前进度", self.guidelines)
        self.assertIn("任一时刻只允许一处播放", self.guidelines)
        self.assertIn("关闭或返回后不自动恢复", self.guidelines)


if __name__ == "__main__":
    unittest.main()
