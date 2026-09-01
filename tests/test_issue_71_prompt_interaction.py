import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static/smart-canvas.html"
HOST = ROOT / "static/js/smart-canvas.js"
STYLE = ROOT / "static/css/smart-canvas.css"
AUTHORING = ROOT / "static/js/smart-canvas/prompt-authoring.js"


class Issue71PromptInteractionTests(unittest.TestCase):
    def test_prompt_authoring_uses_auto_height_and_one_live_focused_editor(self):
        page = PAGE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        self.assertNotIn('id="promptResize"', page)
        self.assertIn('id="composerFocusToggle"', page)
        self.assertIn('id="composerFocusBackdrop"', page)
        self.assertIn("function syncPromptAuthoringHeight", host)
        self.assertIn("function setPromptAuthoringFocused", host)
        self.assertIn("min-height:120px", style)
        self.assertIn("max-height:12rem", style)
        self.assertIn("width:min(850px", style)
        self.assertIn("height:min(660px", style)
        self.assertIn("backdrop-filter:blur", style)
        self.assertIn("function animateComposerFocusTransition(fromRect)", host)
        self.assertIn("const toRect = composer.getBoundingClientRect()", host)
        self.assertIn("const scaleX = fromRect.width / toRect.width", host)
        self.assertIn("composer.style.setProperty('--composer-focus-dx'", host)
        self.assertIn("composerFocusTransitionFrame = requestAnimationFrame", host)
        self.assertIn("composer.classList.add('focus-transition-active')", host)
        self.assertIn("translate:-50% -50%; transform:none !important", style)
        self.assertIn(".composer.focus-transitioning { transform:translate(var(--composer-focus-dx), var(--composer-focus-dy)) scale(var(--composer-focus-scale-x), var(--composer-focus-scale-y)) !important;", style)
        self.assertIn(".composer.focus-transitioning.focus-transition-active { transform:translate(0, 0) scale(1, 1) !important;", style)
        self.assertIn("visibility:hidden; opacity:0; pointer-events:none", style)

    def test_quick_picker_trigger_and_wheel_precedence_contract(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(AUTHORING))}, 'utf8');
            const sandbox = {{
                window:{{SmartCanvasModules:{{smartContainer:{{isGroup:()=>false}}}}}},
                promptInput:null,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const authoring = sandbox.window.SmartCanvasModules.promptAuthoring;
            const triggers = [
                authoring.quickTrigger({{text:'/',caret:1}}),
                authoring.quickTrigger({{text:'hello @',caret:7}}),
                authoring.quickTrigger({{text:'path/to',caret:5}}),
                authoring.quickTrigger({{text:'email@example.com',caret:6}}),
                authoring.quickTrigger({{text:'line\\n/',caret:6}}),
                authoring.quickTrigger({{text:'hello @role 2',caret:13}}),
                authoring.quickTrigger({{text:'hello @done /',caret:13}}),
                authoring.quickTrigger({{text:'/old text @',caret:11}}),
            ];
            const openIntents = [
                authoring.quickOpenIntent({{data:'/',inputType:'insertText'}}),
                authoring.quickOpenIntent({{data:'@',inputType:'insertText'}}),
                authoring.quickOpenIntent({{data:'x',inputType:'insertText'}}),
                authoring.quickOpenIntent({{data:'/',inputType:'insertFromPaste'}}),
                authoring.quickOpenIntent({{data:'@',inputType:'insertText',isComposing:true}}),
            ];
            const wheel = [
                authoring.wheelIntent({{modal:true,modifier:true,localCanScroll:false}}),
                authoring.wheelIntent({{modal:false,modifier:true,localCanScroll:true}}),
                authoring.wheelIntent({{modal:false,modifier:true,localCanScroll:true,localOwnsWheel:true}}),
                authoring.wheelIntent({{modal:true,modifier:false,farPresentation:true,localOwnsWheel:true}}),
                authoring.wheelIntent({{modal:false,modifier:true,farPresentation:true,localOwnsWheel:true}}),
                authoring.wheelIntent({{modal:false,modifier:false,farPresentation:true,localCanScroll:true,localOwnsWheel:true}}),
                authoring.wheelIntent({{modal:false,modifier:false,localCanScroll:true}}),
                authoring.wheelIntent({{modal:false,modifier:false,localCanScroll:false}}),
            ];
            process.stdout.write(JSON.stringify({{triggers,openIntents,wheel}}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["triggers"], ["/", "@", "", "", "/", "@", "/", "@"])
        self.assertEqual(payload["openIntents"], [True, True, False, False, False])
        self.assertEqual(
            payload["wheel"],
            ["modal", "zoom", "zoom", "modal", "zoom", "pan", "local", "pan"],
        )

    def test_canvas_wheel_and_coordinate_caret_are_integrated(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn("promptAuthoring.wheelIntent", host)
        self.assertIn("function placeCaretFromPointer", host)
        self.assertIn("document.caretPositionFromPoint", host)
        self.assertIn("document.caretRangeFromPoint", host)

    def test_reference_hover_preview_and_read_only_viewer_cover_all_media(self):
        page = PAGE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        self.assertIn('id="referenceViewerBackdrop"', page)
        self.assertIn("function openReferenceViewer", host)
        self.assertIn("data-reference-viewer-open", host)
        self.assertIn("const promise = media.play?.()", host)
        self.assertIn("width:160px", style)
        self.assertIn("pointer-events:auto", style)
        self.assertNotIn("el.addEventListener('pointerenter', () => showReferenceHoverPreview", host)
        self.assertNotIn("thumb.addEventListener('pointerenter', () => showReferenceHoverPreview", host)


if __name__ == "__main__":
    unittest.main()
