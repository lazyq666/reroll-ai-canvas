import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "smart-canvas.html"
HOST = ROOT / "static" / "js" / "smart-canvas.js"
MODULE = ROOT / "static" / "js" / "smart-canvas" / "generation-log-modal.js"
STYLE = ROOT / "static" / "css" / "generation-log-modal.css"
SCROLLBAR = ROOT / "static" / "js" / "infinite-canvas-ui" / "scrollbar.js"
TOKENS = ROOT / "static" / "css" / "design-tokens.css"
FAILURE = ROOT / "static" / "js" / "smart-canvas" / "generation-failure-feedback.js"
DIALOG_CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "dialog-case.html"
DIALOG_CASE_JS = ROOT / "static" / "js" / "infinite-canvas-ui" / "dialog-case.js"
UI_LIBRARY = ROOT / "static" / "ui-component-library.html"
UI_LIBRARY_SURFACE = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"


class GenerationLogModalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.module = MODULE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.scrollbar = SCROLLBAR.read_text(encoding="utf-8")
        cls.tokens = TOKENS.read_text(encoding="utf-8")
        cls.failure = FAILURE.read_text(encoding="utf-8")
        cls.dialog_case = DIALOG_CASE.read_text(encoding="utf-8")
        cls.dialog_case_js = DIALOG_CASE_JS.read_text(encoding="utf-8")
        cls.ui_library = UI_LIBRARY.read_text(encoding="utf-8")
        cls.ui_library_surface = UI_LIBRARY_SURFACE.read_text(encoding="utf-8")

    def test_page_uses_independent_master_detail_modal(self):
        self.assertIn("/static/css/generation-log-modal.css", self.page)
        self.assertIn("/static/js/smart-canvas/generation-log-modal.js", self.page)
        self.assertIn('class="generation-log-master-detail"', self.page)
        self.assertIn("data-generation-log-index", self.page)
        self.assertIn("data-generation-log-detail", self.page)
        modal = self.page.split('<ic-dialog id="smartLogModal"', 1)[1].split(
            '</ic-dialog>', 1
        )[0]
        self.assertIn(
            '</div>\n    <ic-dialog id="smartLogModal"',
            self.page,
        )
        self.assertNotIn('class="log-panel"', modal)
        self.assertNotIn('class="log-head"', modal)
        self.assertNotIn("data-theme", modal)
        self.assertNotIn("sun-moon", modal)

    def test_modal_header_has_only_title_and_close_action(self):
        opening = self.page.split('<ic-dialog id="smartLogModal"', 1)[1].split(">", 1)[0]
        self.assertIn('label="生成日志"', opening)
        self.assertIn('size="large"', opening)
        self.assertIn('dismiss-policy="light"', opening)
        self.assertNotIn('without-visible-header', opening)
        self.assertNotIn('generation-log-header', self.page)

    def test_new_module_owns_required_interactions_and_primary_copy_action(self):
        self.assertIn("data-generation-log-select", self.module)
        self.assertIn("data-generation-log-preview", self.module)
        self.assertIn("generation-log-technical", self.module)
        self.assertIn('hierarchy=\"primary\"', self.module)
        self.assertIn('name=\"duplicate\"', self.module)
        self.assertIn("options.onClose", self.module)
        self.assertIn("root.addEventListener('contextmenu', event => event.stopPropagation())", self.module)
        self.assertIn("const sharedDialog = root.localName === 'ic-dialog';", self.module)
        self.assertNotIn("runCounts", self.module)
        self.assertNotIn("successfulCount", self.module)
        self.assertNotIn("failedCount", self.module)

    def test_video_references_use_the_existing_media_preview_pipeline(self):
        self.assertIn("previewMediaUrl:smartMediaPreviewUrl", self.host)
        self.assertIn("options.previewMediaUrl", self.module)
        self.assertIn('data-preview-kind="video"', self.module)
        self.assertIn("referenceLooksVideo", self.module)

    def test_index_uses_status_prompt_titles_and_failed_reason_icon(self):
        self.assertIn("smart.generationLog.taskSucceeded", self.module)
        self.assertIn("smart.generationLog.taskFailed", self.module)
        self.assertIn("firstSentence(log?.prompt", self.module)
        self.assertIn('${failureIcon()}<span>', self.module)
        self.assertNotIn('name="check"', self.module)

    def test_title_fallback_uses_prompt_first_sentence_without_summarization(self):
        script = f"""
global.window = global;
eval({json.dumps(self.module)});
const module = window.SmartCanvasModules.generationLogModal;
process.stdout.write(JSON.stringify({{
  chinese:module.firstSentence('第一句描述主体。第二句补充光线。'),
  newline:module.firstSentence('第一行任务\\n第二行细节'),
  size:module.normalizedSize('2048x2048'),
}}));
"""
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["chinese"], "第一句描述主体。")
        self.assertEqual(payload["newline"], "第一行任务")
        self.assertEqual(payload["size"], "2048 × 2048")

    def test_safe_diagnostic_report_includes_support_fields_and_redacts_secrets(self):
        script = f"""
global.window = global;
eval({json.dumps(self.failure)});
const feedback = window.SmartCanvasModules.generationFailureFeedback;
const report = feedback.diagnosticReport({{
  id:'log-1',runId:'run-1',createdAt:123,durationMs:18700,status:'failed',
  platform:'APIMART',model:'GPT Image 2',prompt:'prompt',refs:[{{url:'data:image/png;base64,AAAA'}}],
  request:{{size:'2048x2048',api_key:'secret-value'}},
  tasks:[{{status:'failed',upstreamTaskId:'task-9',technicalError:'HTTP 400 token=secret-token',httpStatus:400,errorCode:'invalid_resolution'}}]
}}, {{
  translate:key=>key,
  task:'smart.kindImageGeneration · 香氛主视觉',
  node:'smart.generationLog.imageNode · …7BF2',
  outputSettings:'2048 × 2048',
}});
process.stdout.write(report);
"""
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = result.stdout
        for value in [
            "run-1",
            "18700 ms",
            "task-9",
            "APIMART",
            "GPT Image 2",
            "2048 × 2048",
            "invalid_resolution",
            "smart.diagnosticReferenceCount: 1",
        ]:
            self.assertIn(value, report)
        self.assertNotIn("secret-value", report)
        self.assertNotIn("secret-token", report)
        self.assertNotIn("base64,AAAA", report)

    def test_host_switches_only_the_entry_path_to_the_new_renderer(self):
        open_start = self.host.index("async function openSmartCanvasLog")
        open_end = self.host.index("\nfunction closeSmartCanvasLog", open_start)
        open_function = self.host[open_start:open_end]
        self.assertIn("await loadSmartCanvasLogs();", open_function)
        self.assertIn("smartGenerationLogModal.select", open_function)
        self.assertIn("smartGenerationLogModal.beforeOpen", open_function)
        self.assertIn("smartGenerationLogModal.afterOpen", open_function)
        self.assertIn("await smartLogModal.show();", open_function)
        self.assertNotIn("smartLogModal.classList.add('open');", open_function)

    def test_open_focuses_the_selected_task_instead_of_the_close_tooltip(self):
        self.assertIn("selected?.focus();", self.module)
        self.assertNotIn("closeButton.focus();", self.module)

    def test_open_generation_log_modal_owns_wheel_input(self):
        self.assertIn("ic-dialog[open]", self.host)

    def test_dialog_library_opens_the_production_generation_log_preview(self):
        self.assertIn("data-open-generation-log", self.dialog_case)
        self.assertIn('id="generation-log-preview"', self.dialog_case)
        self.assertIn("/static/css/generation-log-modal.css", self.dialog_case)
        self.assertIn("generation-log-modal.js", self.dialog_case_js)
        self.assertIn("generationFailureFeedback", self.dialog_case_js)
        self.assertIn("generationLogModal.create", self.dialog_case_js)
        self.assertIn("generationLogController.afterOpen", self.dialog_case_js)
        self.assertIn("dialog-case.html", self.ui_library)
        self.assertIn("['generation-log-modal', 'Generation Log Modal', 'dialog']", self.ui_library_surface)

    def test_styles_are_scoped_and_follow_theme_tokens(self):
        self.assertIn(".generation-log-modal", self.style)
        self.assertIn(
            ".generation-log-modal::part(header) { padding:var(--ui-space-4); }",
            self.style,
        )
        self.assertIn(".generation-log-modal::part(body)", self.style)
        self.assertIn("var(--ui-color-surface)", self.style)
        self.assertIn("var(--ui-color-text-danger)", self.style)
        self.assertNotIn(".log-panel", self.style)
        self.assertNotIn(".theme-dark", self.style)
        self.assertIn("padding:var(--ui-space-3)", self.style)
        self.assertIn("gap:var(--ui-space-3)", self.style)
        self.assertIn("font-weight:var(--ui-font-weight-regular)", self.style)
        self.assertIn("padding:var(--ui-space-5)", self.style)
        self.assertIn("background:var(--ui-color-surface-canvas)", self.style)
        self.assertNotIn("scrollbar-width", self.style)
        self.assertNotIn("::-webkit-scrollbar", self.style)
        self.assertIn("scrollbar-width: thin", self.scrollbar)
        self.assertIn("scrollbar-color: var(--ui-color-border-primary) transparent", self.scrollbar)
        self.assertIn("*::-webkit-scrollbar", self.scrollbar)
        self.assertIn("width: 4px", self.scrollbar)
        self.assertNotIn(".generation-log-status-icon.success", self.style)
        status_icon_rule = self.style.split(".generation-log-status-icon {", 1)[1].split("}", 1)[0]
        self.assertIn("width:var(--ui-icon-size-xs)", status_icon_rule)
        self.assertIn("height:var(--ui-icon-size-xs)", status_icon_rule)
        failed_icon_rule = self.style.split(".generation-log-status-icon.failed {", 1)[1].split("}", 1)[0]
        self.assertNotIn("background", failed_icon_rule)
        detail_icon_rule = self.style.split(".generation-log-status-icon.is-detail {", 1)[1].split("}", 1)[0]
        self.assertIn("width:var(--ui-icon-size-s)", detail_icon_rule)
        self.assertIn("height:var(--ui-icon-size-s)", detail_icon_rule)
        failure_rule = self.style.split(".generation-log-failure-summary {", 1)[1].split("}", 1)[0]
        self.assertIn("background:var(--ui-color-action-secondary-danger)", failure_rule)
        self.assertIn("border-radius:var(--ui-radius-s)", failure_rule)
        self.assertNotIn("border-left", failure_rule)
        actions_rule = self.style.split(".generation-log-actions {", 1)[1].split("}", 1)[0]
        self.assertIn("padding:var(--ui-space-4)", actions_rule)
        self.assertNotIn("var(--ui-space-3)", actions_rule)

    def test_modal_references_only_declared_design_tokens(self):
        declared = set(re.findall(r"(--ui-[a-z0-9-]+)\s*:", self.tokens))
        referenced = set(re.findall(r"var\((--ui-[a-z0-9-]+)", self.style))
        self.assertEqual([], sorted(referenced - declared))
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")


if __name__ == "__main__":
    unittest.main()
