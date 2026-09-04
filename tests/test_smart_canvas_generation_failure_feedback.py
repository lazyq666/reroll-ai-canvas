import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/generation-failure-feedback.js"
PAGE = ROOT / "static/smart-canvas.html"
APP = ROOT / "static/js/smart-canvas.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
RECOVERY_MODULE = ROOT / "static/js/smart-canvas/generation-recovery.js"
STYLES = ROOT / "static/css/smart-canvas.css"
HARNESS = ROOT / "tests/smart_canvas_generation_failure_feedback_browser_harness.html"
PROMPT_FAILURE_BROWSER_SMOKE = ROOT / "tests/prompt_generation_failure_details_browser_smoke.cjs"
FIXTURE = ROOT / "static/design-system/infinite-canvas-ui/generation-failure-feedback.html"
CURRENT_SPEC = ROOT / "docs/current/smart-canvas-generation-failure-feedback.md"


class SmartCanvasGenerationFailureFeedbackTests(unittest.TestCase):
    def run_module(self, body: str):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}}}};
            vm.createContext(sandbox);
            vm.runInContext(fs.readFileSync({json.dumps(str(MODULE))}, 'utf8'), sandbox);
            const feedback = sandbox.window.SmartCanvasModules.generationFailureFeedback;
            {body}
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_apimart_restriction_wins_over_credential_and_quota_guesses(self):
        payload = self.run_module(
            """
            const value = feedback.classify({
                providerId:'apimart',
                technicalError:'The provider account is temporarily restricted.',
                httpStatus:401,
                billingEvidence:{cost:0},
            });
            process.stdout.write(JSON.stringify(value));
            """
        )
        self.assertEqual(payload["category"], "provider_account_restricted")
        self.assertEqual(payload["billingEvidence"], {"cost": 0})
        self.assertEqual(payload["titleKey"], "smart.error.provider_account_restricted.apimart.title")

    def test_provider_connection_marker_wins_over_generic_502(self):
        payload = self.run_module(
            """
            const value = feedback.classify({
                providerId:'apimart',
                technicalError:'provider_connection_interrupted',
                httpStatus:502,
            });
            process.stdout.write(JSON.stringify(value));
            """
        )
        self.assertEqual(payload["category"], "connection_interrupted")
        self.assertEqual(payload["retryability"], "retry_later")

    def test_apimart_chinese_unavailable_size_is_not_reported_as_unknown(self):
        payload = self.run_module(
            """
            const technicalError = '所选画幅或分辨率已不可用，请重新选择';
            const translate = key => ({
                'smart.error.unsupported_size.title':'尺寸不受支持',
                'smart.listSeparator':'，',
                'smart.sentenceSeparator':'。',
            }[key] || key);
            const format = (key, values) => key === 'smart.failureReasonCount'
                ? `${values.label} ${values.count} 项`
                : key === 'smart.generationActionFailedTitle'
                ? `${values.action_name}失败`
                : key === 'smart.generationFailureReasons'
                    ? values.reasons
                    : key;
            const classified = feedback.classify({providerId:'apimart', technicalError});
            const aggregate = feedback.aggregate(
                [{status:'failed', providerId:'apimart', technicalError}],
                translate,
                format,
                {actionName:'生成图片'},
            );
            process.stdout.write(JSON.stringify({classified, aggregate}));
            """
        )
        self.assertEqual(payload["classified"]["category"], "unsupported_size")
        self.assertEqual(payload["classified"]["retryability"], "modify_then_retry")
        self.assertEqual(payload["classified"]["titleKey"], "smart.error.unsupported_size.title")
        self.assertEqual(payload["aggregate"]["title"], "生成图片失败")
        self.assertEqual(payload["aggregate"]["message"], payload["classified"]["technicalError"])

    def test_gpt_cli_invalid_1k_size_is_not_reported_as_unknown(self):
        payload = self.run_module(
            """
            const technicalError = "GPT Image 2 Skill 调用失败：codex: error: invalid value '1K' for '--size <SIZE>': Image size must be auto, 2K, 4K, or WIDTHxHEIGHT.\\n\\nFor more information, try '--help'.";
            const translate = key => ({
                'smart.error.unsupported_size.title':'尺寸不受支持',
                'smart.listSeparator':'，',
                'smart.sentenceSeparator':'。',
            }[key] || key);
            const format = (key, values) => key === 'smart.failureReasonCount'
                ? `${values.label} ${values.count} 项`
                : key === 'smart.generationActionFailedTitle'
                ? `${values.action_name}失败`
                : key === 'smart.generationFailureReasons'
                    ? values.reasons
                    : key;
            const classified = feedback.classify({providerId:'codex', technicalError});
            const aggregate = feedback.aggregate([
                {status:'failed', providerId:'codex', technicalError},
                {status:'failed', providerId:'codex', technicalError},
            ], translate, format, {actionName:'生成图片'});
            process.stdout.write(JSON.stringify({classified, aggregate}));
            """
        )
        self.assertEqual(payload["classified"]["category"], "unsupported_size")
        self.assertEqual(payload["classified"]["retryability"], "modify_then_retry")
        self.assertEqual(payload["classified"]["titleKey"], "smart.error.unsupported_size.title")
        self.assertEqual(payload["aggregate"]["title"], "生成图片失败")
        self.assertEqual(
            payload["aggregate"]["message"],
            payload["classified"]["technicalError"] + " 2 项",
        )
        self.assertEqual(payload["aggregate"]["failedCount"], 2)

    def test_jimeng_prompt_length_limit_has_specific_copy(self):
        payload = self.run_module(
            """
            const technicalError = '即梦 5.0 文生图提示词长度为 6070 个字符，超过稳定上限 1500；请压缩到 1400 字符以内后重试';
            const translate = key => ({
                'smart.error.prompt_too_long.title':'提示词过长',
                'smart.listSeparator':'，',
                'smart.sentenceSeparator':'。',
            }[key] || key);
            const format = (key, values) => key === 'smart.generationActionFailedTitle'
                ? values.action_name + '失败'
                : key === 'smart.generationFailureReasons'
                    ? values.reasons
                    : key;
            const classified = feedback.classify({
                providerId:'jimeng',
                technicalError,
                httpStatus:400,
            });
            const aggregate = feedback.aggregate(
                [{status:'failed', providerId:'jimeng', technicalError, httpStatus:400}],
                translate,
                format,
                {actionName:'生成图片'},
            );
            process.stdout.write(JSON.stringify({classified, aggregate}));
            """
        )
        self.assertEqual(payload["classified"]["category"], "prompt_too_long")
        self.assertEqual(payload["classified"]["retryability"], "modify_then_retry")
        self.assertEqual(payload["classified"]["titleKey"], "smart.error.prompt_too_long.title")
        self.assertEqual(payload["aggregate"]["title"], "生成图片失败")
        self.assertEqual(payload["aggregate"]["message"], payload["classified"]["technicalError"])

    def test_multiple_failures_are_aggregated_into_one_run_summary(self):
        payload = self.run_module(
            """
            const translate = key => ({
                'smart.error.processing_timeout.title':'timeout',
                'smart.error.safety_blocked.title':'safety',
                'smart.listSeparator':', ',
                'smart.sentenceSeparator':' | ',
            }[key] || key);
            const format = (key, values) => key === 'smart.failureReasonCount'
                ? `${values.label}:${values.count}`
                : key === 'smart.generationPartialTitle'
                    ? `${values.action_name}|${values.success}|${values.failed}`
                    : key === 'smart.generationFailureReasons'
                        ? values.reasons
                    : key;
            const value = feedback.aggregate([
                {status:'succeeded'},
                {status:'failed',technicalError:'maximum processing time'},
                {status:'failed',technicalError:'exceeded 15 minutes'},
                {status:'failed',technicalError:'moderation safety violation'},
            ], translate, format, {actionName:'生成图片'});
            process.stdout.write(JSON.stringify(value));
            """
        )
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["successfulCount"], 1)
        self.assertEqual(payload["failedCount"], 3)
        self.assertEqual(payload["title"], "生成图片|1|3")
        self.assertEqual(
            payload["message"],
            "maximum processing time, exceeded 15 minutes, moderation safety violation",
        )
        self.assertEqual(
            payload["summary"],
            "生成图片|1|3 | maximum processing time, exceeded 15 minutes, moderation safety violation",
        )

    def test_missing_gpt_image_helper_is_not_misreported_as_invalid_parameter(self):
        payload = self.run_module(
            """
            const translate = key => ({
                'smart.error.local_dependency_missing.title':'缺少 GPT Image 2 组件',
                'smart.error.local_dependency_missing.description':'GPT Image 2 helper 尚未安装。',
                'smart.error.local_dependency_missing.action':'请安装组件后重试。',
                'smart.sentenceSeparator':'。',
            }[key] || key);
            const format = (key, values) => key === 'smart.generationActionFailedTitle'
                ? `${values.action_name}失败`
                : key === 'smart.generationFailureReasons'
                    ? values.reasons
                    : key;
            const technicalError = '未找到 GPT Image 2 helper，OpenAI CLI 生图已禁用 $imagegen 回退。请先安装 gpt-image-2-skill 后再生成图片。';
            const classified = feedback.classify({technicalError, httpStatus:400});
            const aggregate = feedback.aggregate(
                [{status:'failed', technicalError, httpStatus:400}],
                translate,
                format,
                {actionName:'生成图片'},
            );
            process.stdout.write(JSON.stringify({classified, aggregate}));
            """
        )
        self.assertEqual(payload["classified"]["category"], "local_dependency_missing")
        self.assertEqual(payload["aggregate"]["title"], "生成图片失败")
        self.assertEqual(payload["aggregate"]["message"], payload["classified"]["technicalError"])
        self.assertNotIn("成功 0", payload["aggregate"]["summary"])
        self.assertNotIn("参数", payload["aggregate"]["summary"])

    def test_action_names_and_all_failed_title_are_operation_specific(self):
        payload = self.run_module(
            """
            const labels = {
                'smart.action.generateImage':'生成图片',
                'smart.action.generateVideo':'生成视频',
                'smart.action.generateText':'生成文字',
                'smart.action.matting':'抠图',
                'smart.error.invalid_parameter.title':'参数不受支持',
                'smart.generationFailureReasons':'{reasons}',
            };
            const translate = key => labels[key] || key;
            const format = (key, values) => key === 'smart.generationActionFailedTitle'
                ? `${values.action_name}失败`
                : key === 'smart.generationFailureReasons'
                    ? values.reasons
                    : key;
            const names = ['image','video','text','matting'].map(kind => feedback.actionName({kind}, translate));
            const aggregate = feedback.aggregate(
                [{status:'failed', technicalError:'Unsupported parameter', httpStatus:400}],
                translate,
                format,
                {actionName:names[1]},
            );
            process.stdout.write(JSON.stringify({names, aggregate}));
            """
        )
        self.assertEqual(payload["names"], ["生成图片", "生成视频", "生成文字", "抠图"])
        self.assertEqual(payload["aggregate"]["title"], "生成视频失败")
        self.assertEqual(payload["aggregate"]["message"], "Unsupported parameter")
        self.assertNotIn("1", payload["aggregate"]["message"])

    def test_smart_canvas_uses_ic_alert_with_optional_secondary_small_button(self):
        page = PAGE.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        styles = STYLES.read_text(encoding="utf-8")
        self.assertIn('id="generationFailureAlertQueue"', page)
        self.assertIn('data-generation-failure-queue', page)
        self.assertNotIn('variant="action"', page)
        self.assertIn("document.createElement('ic-alert')", app)
        self.assertIn("alert.setAttribute('action-label', tr('smart.viewDetails'))", app)
        self.assertIn("alert.addEventListener('ic-action'", app)
        self.assertIn("generationFailureAlertStack.enqueue(alert)", app)
        self.assertNotIn(".toast.persistent", styles)
        self.assertNotIn(".toast-actions", styles)

    def test_failure_alert_targets_stable_generation_run_after_log_reconciliation(self):
        app = APP.read_text(encoding="utf-8")
        run_module = RUN_MODULE.read_text(encoding="utf-8")
        recovery_module = RECOVERY_MODULE.read_text(encoding="utf-8")
        prompt_failure_smoke = PROMPT_FAILURE_BROWSER_SMOKE.read_text(encoding="utf-8")
        self.assertIn("detailRunId", app)
        self.assertIn("data-generation-run-id", app)
        self.assertIn("detailRunId:run?.generationRunId", run_module)
        self.assertIn(
            "logContext:{run:runLog,runLogStart}",
            app,
        )
        self.assertIn(
            "detailRunId:logContext.run?.generationRunId",
            recovery_module,
        )
        self.assertIn("runPromptLLMNode('prompt-source-node')", prompt_failure_smoke)
        self.assertIn("canvasRealtimeApplier.apply", prompt_failure_smoke)
        self.assertIn("generationLogReads === 1", prompt_failure_smoke)
        self.assertIn("immediateLogState.count", prompt_failure_smoke)
        self.assertNotIn("querySelector('.action').click()", prompt_failure_smoke)
        self.assertIn("await page.mouse.click(", prompt_failure_smoke)
        self.assertIn("const actionRect =", prompt_failure_smoke)
        self.assertIn("[data-generation-log-selected-detail]", prompt_failure_smoke)
        self.assertIn("is-focused-target", prompt_failure_smoke)

    def test_browser_harness_contains_full_deterministic_scenario_matrix(self):
        source = FIXTURE.read_text(encoding="utf-8")
        scenarios = (
            "partial-success", "all-failed-mixed", "apimart-restricted",
            "credential-missing", "credential-invalid", "quota-insufficient",
            "provider-account-restricted", "rate-limited", "provider-busy",
            "processing-timeout", "network-timeout", "connection-interrupted",
            "invalid-parameter", "unsupported-size", "safety-blocked",
            "empty-output", "local-dependency-missing", "provider-internal-error",
            "application-internal-error", "cancelled-or-replaced", "unknown-error",
            "text-generation-failed", "matting-failed", "cli-invalid-size",
            "jimeng-prompt-too-long",
        )
        for scenario in scenarios:
            self.assertIn(f"'{scenario}'", source)
        self.assertIn("共 25 个固定场景", source)
        self.assertIn("provider account is temporarily restricted", source.lower())
        self.assertIn("所选画幅或分辨率已不可用，请重新选择", source)
        self.assertIn("invalid value '1K' for '--size <SIZE>'", source)
        self.assertIn("即梦 5.0 文生图提示词长度为 6070 个字符", source)
        self.assertIn("cost:0", source.replace(" ", ""))
        self.assertIn("SmartCanvasModules.generationFailureFeedback", source)
        self.assertIn("feedback.aggregate", source)
        self.assertIn(".details[hidden] { display:none; }", source)
        self.assertIn("show('partial-success');", source)
        self.assertIn("button.setAttribute('aria-pressed'", source)
        self.assertLess(source.index('id="scenario-alert"'), source.index('id="scenario-groups"'))
        redirect = HARNESS.read_text(encoding="utf-8")
        self.assertIn("location.replace", redirect)
        self.assertIn("/static/design-system/infinite-canvas-ui/generation-failure-feedback.html", redirect)


    def test_batch_generation_owns_one_persistent_aggregate_alert(self):
        source = RUN_MODULE.read_text(encoding="utf-8")
        helper_start = source.index("function generationRunReportBatchResult")
        helper_end = source.index("const GENERATION_PRESENTATION_KEYS", helper_start)
        helper = source[helper_start:helper_end]
        self.assertIn("failureFeedback.aggregate", helper)
        self.assertIn("persistent:true", helper)
        self.assertIn("detailLogId:entry?.id", helper)
        self.assertEqual(source.count("\n                generationRunReportBatchResult({"), 2)

    def test_current_spec_records_the_user_visible_failure_contract(self):
        source = CURRENT_SPEC.read_text(encoding="utf-8")
        for contract in (
            "部分成功",
            "全部失败",
            "复制诊断",
            "Target Guard",
            "不得包含 API Key",
            "已成功输出不会因同批其他任务失败而消失",
        ):
            self.assertIn(contract, source)

    def test_diagnostic_report_removes_credentials_paths_urls_and_base64(self):
        payload = self.run_module(
            """
            const report = feedback.diagnosticReport({
                id:'log-1', status:'failed', prompt:'keep this prompt',
                request:{model:'demo', api_key:'secret-value'},
                refs:[{name:'/Users/demo/private/reference.png',url:'https://example.com/source.png'}],
                tasks:[{
                    status:'failed',
                    technicalError:'token=abc123 path=/Users/demo/result.png https://example.com/full data:image/png;base64,AAAA',
                }],
            }, {translate:key => key, format:key => key});
            process.stdout.write(JSON.stringify({report}));
            """
        )["report"]
        self.assertNotIn("keep this prompt", payload)
        self.assertNotIn("reference.png", payload)
        self.assertNotIn("secret-value", payload)
        self.assertNotIn("abc123", payload)
        self.assertNotIn("/Users/demo", payload)
        self.assertNotIn("https://example.com", payload)
        self.assertNotIn("AAAA", payload)


if __name__ == "__main__":
    unittest.main()
