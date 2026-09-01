import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from infinite_canvas.batch_generation import (
    BatchGeneration,
    BatchGenerationValidation,
)


class FakeGenerationRuns:
    def __init__(self):
        self.submissions = []

    async def submit(self, task, *, owner, batch_id):
        self.submissions.append((task, owner, batch_id))
        return {
            "run_id": f"run-{len(self.submissions)}",
            "status": "succeeded",
            "outputs": [f"/assets/output/{len(self.submissions)}.png"],
        }


class PendingGenerationRuns:
    def __init__(self):
        self.submissions = []
        self.cancellations = []
        self.runs = {}

    async def submit(self, task, *, owner, batch_id):
        run_id = f"pending-{len(self.submissions) + 1}"
        self.submissions.append((task, owner, batch_id, run_id))
        self.runs[run_id] = SimpleNamespace(
            status="running", result=None, error=""
        )
        return {"run_id": run_id, "status": "running", "outputs": []}

    def inspect(self, run_id, *, owner):
        return self.runs[run_id]

    async def cancel(self, run_id, *, owner):
        self.cancellations.append((run_id, owner))
        self.runs[run_id] = SimpleNamespace(
            status="cancelled", result=None, error="cancelled"
        )
        return self.runs[run_id]


class BatchGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_name_uses_models_ratio_resolution_and_short_time(self):
        with tempfile.TemporaryDirectory() as temporary:
            timestamp = time.mktime((2026, 8, 5, 15, 7, 0, 0, 0, -1))
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=FakeGenerationRuns().submit,
                now=lambda: timestamp,
            )
            created = await batches.start({
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": [
                    {
                        "provider_id": "openai",
                        "model": "gpt-image-2",
                        "name": "GPT Image 2",
                    },
                    {
                        "provider_id": "gemini",
                        "model": "nano-banana-pro",
                        "name": "Nano Banana Pro",
                    },
                ],
                "ratios": ["1:1", "16:9"],
                "settings": {"resolution": "2k", "outputs_per_run": 1},
            }, owner="designer-1")

            self.assertEqual(
                "GPT Image 2+Nano Banana Pro·1:1+16:9·2k·08-05 15:07",
                created["name"],
            )

            prefixed = await batches.start({
                "name_prefix": " 角色探索_ ",
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": [{"model": "gpt-image-2", "name": "GPT Image 2"}],
                "ratios": ["1:1"],
                "settings": {"resolution": "2k", "outputs_per_run": 1},
            }, owner="designer-1")
            self.assertEqual(
                "角色探索_GPT Image 2·1:1·2k·08-05 15:07",
                prefixed["name"],
            )

    async def test_background_scheduler_refills_slots_without_client_queries(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
                system_limit=2,
                provider_limit=2,
                user_limit=2,
                scheduler_interval=0.01,
            )
            request = {
                "prompt_modules": [{
                    "name": "主体", "options": ["A", "B", "C"]
                }],
                "models": [{"provider_id": "fake", "model": "fake-v1"}],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1, "desired_concurrency": 2},
            }

            await batches.start_scheduler()
            try:
                await batches.start(request, owner="designer-1")
                self.assertEqual(2, len(pending.submissions))
                first_run_id = pending.submissions[0][3]
                pending.runs[first_run_id] = SimpleNamespace(
                    status="succeeded",
                    result={"urls": [f"/{first_run_id}.png"]},
                    error="",
                )
                for _ in range(30):
                    if len(pending.submissions) == 3:
                        break
                    await asyncio.sleep(0.01)
            finally:
                await batches.stop_scheduler()

            self.assertEqual(3, len(pending.submissions))

    async def test_default_limits_allow_32_concurrent_tasks(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
            )
            request = {
                "prompt_modules": [{
                    "name": "主体",
                    "options": [str(index) for index in range(40)],
                }],
                "models": [{"provider_id": "fake", "model": "fake-v1"}],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1, "desired_concurrency": 32},
            }

            await batches.start(request, owner="designer-1")

            self.assertEqual(32, len(pending.submissions))

    async def test_concurrency_defaults_to_2_and_rejects_values_above_32(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=FakeGenerationRuns().submit,
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }

            preview = batches.preview(request)
            self.assertEqual(
                2, preview["tasks"][0]["settings"]["desired_concurrency"]
            )
            request["settings"]["desired_concurrency"] = 32
            self.assertEqual(
                32,
                batches.preview(request)["tasks"][0]["settings"][
                    "desired_concurrency"
                ],
            )
            request["settings"]["desired_concurrency"] = 33
            with self.assertRaisesRegex(
                BatchGenerationValidation, "1 到 32"
            ):
                batches.preview(request)

    def test_concurrency_control_defaults_to_2_and_offers_32(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "online.html").read_text(encoding="utf-8")
        javascript = (
            root / "static" / "js" / "batch-generation.js"
        ).read_text(encoding="utf-8")

        self.assertIn(
            '<ic-radio-group id="batchConcurrency" class="batch-inline-options" '
            'name="batchConcurrency" label="期望并发" '
            'data-i18n-label="batch.desiredConcurrency" value="2" '
            'appearance="tabs" orientation="horizontal" '
            'data-legal-combination="horizontal-tab-label">',
            html,
        )
        self.assertIn('<ic-radio value="32" label="32"></ic-radio>', html)
        self.assertIn(
            "setChoice('batchConcurrency', settings.desired_concurrency, '2')",
            javascript,
        )
        self.assertRegex(javascript, r"addModule\(\);\s+addImageVariable\(\);")

    def test_batch_configuration_uses_recipe_table_and_fixed_uniform_sidebar(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "online.html").read_text(encoding="utf-8")
        javascript = (
            root / "static" / "js" / "batch-generation.js"
        ).read_text(encoding="utf-8")
        stylesheet = (
            root / "static" / "css" / "batch-generation.css"
        ).read_text(encoding="utf-8")
        setup = html.split('id="batchSetupStep"', 1)[1].split(
            'id="batchPreviewStep"', 1
        )[0]

        self.assertIn('class="batch-dimension-table"', setup)
        self.assertIn('data-i18n="batch.combinationDimensions">变量（多选）', setup)
        self.assertIn('data-i18n="batch.uniformSettings">其他设置（单选）', setup)
        self.assertNotIn('data-i18n="batch.uniformDesc"', setup)
        self.assertIn('id="addPromptModule"', setup)
        self.assertIn('id="addImageVariable"', setup)
        self.assertIn('data-i18n="batch.addPromptVariable">新增提示词变量', setup)
        self.assertIn('data-i18n="batch.addImageVariable">新增参考图变量', setup)
        self.assertIn('class="batch-uniform-sidebar"', setup)
        self.assertIn('id="batchOutputCount"', setup)
        self.assertNotIn('id="batchRunCount"', setup)
        self.assertNotIn('id="batchSubmissionCount"', setup)
        self.assertIn("modelDisplayName", javascript)
        self.assertIn(
            "document.documentElement.appendChild(batchUniformSidebar)",
            javascript,
        )
        self.assertNotIn("batch-prompt-option-list", javascript)
        self.assertNotIn("batch-prompt-source-editor", javascript)
        self.assertIn(
            'data-component-name="ic-form-field-textarea-s"',
            javascript,
        )
        self.assertIn('<div slot="hint" class="batch-parse-row">', javascript)
        self.assertIn("window.innerWidth / scale > 1100", javascript)
        self.assertIn(
            "classList.toggle('batch-wide-layout', desktop)", javascript
        )
        self.assertIn(
            "html:not(.batch-wide-layout) .batch-config-layout", stylesheet
        )
        self.assertIn(
            "const top = Math.max(placeholderRect.top, topPadding)",
            javascript,
        )
        self.assertIn('appearance="checkmark-end"', javascript)
        self.assertNotIn('class="batch-image-picker batch-pick-single-image"', javascript)
        self.assertNotIn('<ic-image-frame class="batch-image-picker', javascript)
        self.assertIn("frame.addEventListener('ic-preview'", javascript)
        self.assertIn("openBatchImagePreview(0, [{url:src, name, prompt:'', task:null}])", javascript)
        self.assertIn("function openBatchImagePreview(index, items = batchDetailOutputs)", javascript)
        self.assertIn('<ic-aspect-ratio-picker', setup)
        self.assertIn('class="batch-ratio-row"', setup)
        self.assertIn('multiple hide-label', setup)
        self.assertIn("const ratioPresetValues = Object.freeze", javascript)
        self.assertNotIn("const defaultBatchRatios", javascript)
        self.assertIn('<ic-select class="batch-parse-mode"', javascript)
        self.assertNotIn('<ic-radio-group class="batch-parse-mode"', javascript)
        self.assertIn('class="batch-import-menu ${menuClass}"', javascript)
        self.assertIn('class="batch-import-trigger"', javascript)
        self.assertIn('data-button-variant="import-menu"', javascript)
        self.assertIn("trigger.setAttribute('aria-haspopup', 'menu')", javascript)
        self.assertIn("trigger.setAttribute('aria-expanded', 'false')", javascript)
        self.assertIn("menu.show(trigger)", javascript)
        self.assertIn("handlers[event.detail?.value]", javascript)
        self.assertIn("menuClass:'batch-prompt-import-menu'", javascript)
        self.assertIn("menuClass:'batch-image-import-menu'", javascript)
        self.assertIn('class="batch-image-actions"', javascript)
        self.assertIn("bindImportButtonVariant(card.querySelector('.batch-image-import-menu')", javascript)
        self.assertNotIn('class="batch-pick-text-files"', javascript)
        self.assertNotIn('class="batch-pick-text-folder"', javascript)
        self.assertNotIn('class="batch-folder-entry batch-pick-folder"', javascript)
        self.assertIn('class="batch-file-count" hidden', javascript)
        self.assertNotIn('<figcaption title="${escape(file.webkitRelativePath', javascript)
        self.assertNotIn('data-i18n="batch.impact"', setup)
        self.assertIn("width:75px;height:75px", stylesheet)
        self.assertIn('.batch-import-trigger[data-button-variant="import-menu"]', stylesheet)
        self.assertIn(".batch-image-actions{display:flex;flex:none;justify-content:flex-end;margin-inline-start:auto}", stylesheet)
        self.assertNotIn(
            "#batchModelChoices .batch-choice-card::part(base){border-color:transparent;background:transparent}",
            stylesheet,
        )
        self.assertIn(
            "grid-template-columns:minmax(0,7.5rem) minmax(0,1fr)",
            stylesheet,
        )
        self.assertIn("--ic-table-min-width:100%", stylesheet)
        self.assertNotIn("--ic-table-min-width:900px", stylesheet)
        self.assertIn(".batch-dimension-table th:nth-child(2){width:8rem}", stylesheet)
        self.assertIn(".batch-dimension-table th:nth-child(4),.batch-dimension-table th:nth-child(5){width:3rem}", stylesheet)
        self.assertIn("flex:1 1 100%", stylesheet)
        self.assertIn("padding:var(--ui-space-2) var(--ui-space-4)", stylesheet)
        self.assertIn("gap:var(--ui-space-3)", stylesheet)
        self.assertIn("min-block-size:var(--ui-density-control-height)", stylesheet)
        self.assertIn(
            ".batch-output-estimate{display:grid;grid-template-columns:minmax(0,7.5rem) minmax(0,1fr);align-items:center",
            stylesheet,
        )
        self.assertIn(
            ".batch-output-estimate>span{display:flex;inline-size:auto;max-inline-size:7.5rem;align-items:center",
            stylesheet,
        )
        self.assertNotIn(".batch-output-estimate>span{display:flex;inline-size:4em;min-block-size", stylesheet)
        self.assertIn("font:var(--ui-text-body)", stylesheet)
        self.assertIn("font-size:var(--ui-font-size-2)", stylesheet)
        self.assertNotIn(".batch-choice-card>.model-vendor-icon", stylesheet)
        self.assertIn("#batchGenerationMode ic-table th{vertical-align:middle}", stylesheet)
        self.assertIn("#batchGenerationMode ic-table td{vertical-align:top}", stylesheet)
        self.assertIn("#batchSteps{margin-block:var(--ui-space-0);padding-block:var(--ui-space-2)}", stylesheet)
        self.assertIn(
            "#batchGenerationMode ic-table{--ic-table-cell-padding-inline:var(--ui-space-2);"
            "--ic-table-row-hover-background:var(--ic-table-row-background)}",
            stylesheet,
        )
        self.assertIn(".batch-uniform-placeholder{min-width:0;grid-column:2;grid-row:1}", stylesheet)
        self.assertIn(
            ".batch-uniform-sidebar{position:sticky;top:var(--ui-space-3);display:grid;"
            "max-height:calc(100vh - var(--ui-space-6));overflow:auto;"
            "border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary);"
            "border-radius:var(--ui-radius-l);background:var(--ui-color-surface);"
            "box-shadow:var(--ui-shadow-raised)}",
            stylesheet,
        )
        self.assertNotIn(".batch-uniform-placeholder{min-width:0;box-sizing:border-box", stylesheet)
        self.assertNotIn(".batch-module-options:focus-within", stylesheet)
        self.assertIn("grid-template-columns:max-content auto minmax(0,1fr)", stylesheet)
        self.assertIn(".batch-prompt-field .batch-parse-row:has(.batch-custom-delimiter[hidden]){grid-template-columns:max-content minmax(0,1fr)}", stylesheet)
        self.assertIn(".batch-prompt-field .batch-parse-mode{display:block;width:fit-content;min-width:0}", stylesheet)
        self.assertIn(".batch-prompt-field .batch-parse-mode::part(form-control){display:grid;min-width:0;grid-template-columns:auto max-content", stylesheet)
        self.assertIn(".batch-prompt-field .batch-file-actions{display:flex;min-width:0;grid-column:-2/-1", stylesheet)
        self.assertIn("align-items:start", stylesheet)
        self.assertIn("justify-content:flex-start", stylesheet)
        self.assertIn(
            ".batch-output-estimate{display:grid;grid-template-columns:minmax(0,7.5rem) minmax(0,1fr);align-items:center;gap:var(--ui-space-3)",
            stylesheet,
        )
        self.assertIn(
            ".batch-output-estimate>span{display:flex;inline-size:auto;max-inline-size:7.5rem;align-items:center",
            stylesheet,
        )
        self.assertIn(
            "padding:0;color:var(--ui-color-text-primary);font:var(--ui-text-body);overflow-wrap:anywhere;text-align:right",
            stylesheet,
        )
        self.assertIn(".batch-output-estimate>div{display:flex;min-width:0;align-items:baseline;gap:var(--ui-space-2);padding:var(--ui-focus-ring-width)}", stylesheet)
        self.assertIn(".batch-output-estimate strong{color:var(--ui-color-text-primary);font-size:var(--ui-font-size-5)", stylesheet)
        self.assertIn('label="单次出图"', setup)
        self.assertIn('label="重复次数"', setup)
        self.assertIn('aria-label="任务名称"', setup)
        self.assertIn('placeholder="任务名称（可选）"', setup)
        self.assertNotIn('online-page-head', html)
        self.assertNotRegex(setup, r'batch-count-cell[^>]*>[^<]*<strong[^>]*>[^<]*</strong><small')
        self.assertNotIn(".batch-option-count,.batch-image-count{margin-left:auto;padding:", stylesheet)
        self.assertIn(
            "grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr))",
            stylesheet,
        )
        self.assertIn("#batchModelChoices{grid-template-columns:repeat(3,minmax(0,1fr));padding:var(--ui-space-1);border-radius:var(--ui-radius-s);background:transparent}", stylesheet)
        self.assertNotIn("--ic-checkbox-checkmark-end-selected-background", stylesheet)
        self.assertNotIn("--ic-aspect-ratio-selected-background", stylesheet)
        self.assertIn(".batch-dimension-table .batch-ratio-grid{display:block;width:100%}", stylesheet)
        self.assertIn('data-component-variant="list"', javascript)
        self.assertIn('data-component-name="ic-checkbox-list"', javascript)
        self.assertIn('data-component-variant="multiple"', html)
        self.assertIn('data-component-name="ic-aspect-ratio-picker-multiple"', html)
        self.assertIn(".batch-prompt-field .batch-module-options{display:block;box-sizing:border-box;width:100%;overflow:hidden;border:var(--ui-border-width-none)", stylesheet)
        self.assertIn("border-top:var(--ui-border-width-none);background:transparent", stylesheet)
        self.assertIn(".batch-prompt-field .batch-parse-mode::part(form-control){display:grid;min-width:0;grid-template-columns:auto max-content", stylesheet)
        self.assertIn("@media(max-width:1100px){#batchModelChoices{grid-template-columns:repeat(2,minmax(0,1fr))}", stylesheet)

    def test_online_page_is_batch_only_and_model_choices_start_unselected(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static" / "online.html").read_text(encoding="utf-8")
        javascript = (
            root / "static" / "js" / "batch-generation.js"
        ).read_text(encoding="utf-8")
        stylesheet = (
            root / "static" / "css" / "batch-generation.css"
        ).read_text(encoding="utf-8")

        self.assertIn('class="batch-page-header"', html)
        self.assertIn('id="batchHistoryButton"', html)
        self.assertIn('id="batchGenerationMode" class="batch-shell"', html)
        self.assertNotIn('id="batchGenerationMode" class="batch-shell" hidden', html)
        for removed_id in (
            "generationModeTabs", "batchModeTab", "singleModeTab",
            "singleGenerationMode", "singleGenerationHistory", "genBtn",
        ):
            with self.subTest(removed_id=removed_id):
                self.assertNotIn(f'id="{removed_id}"', html)
        self.assertNotIn("showMode(", javascript)
        self.assertIn("showBatchSetup();", javascript)
        self.assertIn("await initializeBatchConfiguration();", javascript)
        self.assertNotIn("!selected.size && index === 0", javascript)
        self.assertNotIn(": index === 0", javascript)
        self.assertIn('label="${escape(modelDisplayName(entry))}" appearance="checkmark-end"', javascript)
        self.assertNotIn('subtitle="${escape(entry.provider_name || entry.provider_id)}"', javascript)
        self.assertIn("flex-flow:row wrap", stylesheet)
        self.assertIn("overflow-x:visible", stylesheet)
        self.assertIn("::part(form-control-label)", stylesheet)

    async def test_empty_default_image_variable_counts_as_no_image_variable(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=fake.submit,
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "image_variables": [{"name": "IMG 01", "options": []}],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }

            preview = batches.preview(request)
            self.assertEqual(1, preview["generation_run_count"])
            self.assertEqual([], preview["tasks"][0]["reference_images"])

            created = await batches.start(request, owner="designer-1")
            self.assertEqual([], created["snapshot"]["image_variables"])
            self.assertEqual(1, len(fake.submissions))

    async def test_preview_distinguishes_submissions_from_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=FakeGenerationRuns().submit,
            )

            preview = batches.preview({
                "prompt_modules": [
                    {"name": "主体", "options": ["狐狸"]}
                ],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {
                    "outputs_per_submission": 2,
                    "submissions_per_task": 3,
                },
            })

            self.assertEqual(1, preview["generation_run_count"])
            self.assertEqual(3, preview["estimated_submission_count"])
            self.assertEqual(6, preview["estimated_output_count"])
            self.assertEqual(3, preview["tasks"][0]["submissions"])
            self.assertEqual(
                2, preview["tasks"][0]["outputs_per_submission"]
            )
            self.assertEqual(6, preview["tasks"][0]["outputs"])

    async def test_scheduler_applies_batch_user_provider_and_system_limits(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
                system_limit=4,
                provider_limit=3,
                user_limit=2,
            )
            request = {
                "prompt_modules": [{
                    "name": "主体", "options": [str(index) for index in range(8)]
                }],
                "models": [{
                    "provider_id": "fake", "model": "fake-v1"
                }],
                "ratios": ["1:1"],
                "settings": {
                    "outputs_per_run": 1, "desired_concurrency": 1
                },
            }

            first = await batches.start(request, owner="designer-1")
            self.assertEqual(1, len(pending.submissions))
            request["settings"]["desired_concurrency"] = 8
            second = await batches.start(request, owner="designer-1")
            self.assertEqual(2, len(pending.submissions))
            request["models"] = [{
                "provider_id": "fake-2", "model": "fake-v2"
            }]
            await batches.start(request, owner="designer-2")

            self.assertEqual(4, len(pending.submissions))
            self.assertEqual(
                {"designer-1": 2, "designer-2": 2},
                {
                    owner: sum(1 for _, current, _, _ in pending.submissions if current == owner)
                    for owner in {"designer-1", "designer-2"}
                },
            )
            self.assertEqual("running", first["status"])
            self.assertEqual("running", second["status"])

    async def test_scheduler_reconciles_other_batches_before_counting_slots(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
                system_limit=2,
                provider_limit=2,
                user_limit=2,
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["A", "B"]}],
                "models": [{"provider_id": "fake", "model": "fake-v1"}],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1, "desired_concurrency": 2},
            }
            first = await batches.start(request, owner="designer-1")
            for run_id in tuple(pending.runs):
                pending.runs[run_id] = SimpleNamespace(
                    status="succeeded",
                    result={"urls": [f"/{run_id}.png"]},
                    error="",
                )

            request["prompt_modules"][0]["options"].append("C")
            second = await batches.start(request, owner="designer-1")

            self.assertEqual(4, len(pending.submissions))
            self.assertEqual(2, second["progress"]["running"])
            refreshed_first = batches.get(first["id"], owner="designer-1")
            self.assertEqual(2, refreshed_first["progress"]["succeeded"])

    async def test_cancel_stops_submitted_runs_and_releases_slots(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
                cancel_run=pending.cancel,
                system_limit=2,
                provider_limit=2,
                user_limit=2,
            )
            request = {
                "prompt_modules": [{
                    "name": "主体", "options": ["A", "B", "C"]
                }],
                "models": [{"provider_id": "fake", "model": "fake-v1"}],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1, "desired_concurrency": 2},
            }
            first = await batches.start(request, owner="designer-1")

            cancelled = await batches.cancel(
                first["id"], owner="designer-1"
            )
            second = await batches.start(request, owner="designer-1")

            self.assertEqual(
                {"pending-1", "pending-2"},
                {run_id for run_id, _ in pending.cancellations},
            )
            self.assertEqual(3, cancelled["progress"]["cancelled"])
            self.assertEqual(2, second["progress"]["running"])
            self.assertEqual(4, len(pending.submissions))

    async def test_pause_stops_new_submissions_and_resume_continues(self):
        with tempfile.TemporaryDirectory() as temporary:
            pending = PendingGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=pending.submit,
                inspect_run=pending.inspect,
                system_limit=2,
                provider_limit=2,
                user_limit=2,
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["A", "B", "C"]}],
                "models": [{"provider_id": "fake", "model": "fake-v1"}],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1, "desired_concurrency": 1},
            }
            created = await batches.start(request, owner="designer-1")
            batches.pause(created["id"], owner="designer-1")
            pending.runs["pending-1"] = SimpleNamespace(
                status="succeeded", result={"urls": ["/one.png"]}, error=""
            )

            paused = await batches.query(created["id"], owner="designer-1")
            self.assertEqual("paused", paused["status"])
            self.assertEqual(1, len(pending.submissions))

            resumed = await batches.resume(created["id"], owner="designer-1")
            self.assertEqual("running", resumed["status"])
            self.assertEqual(2, len(pending.submissions))

    async def test_history_is_owner_scoped_and_admin_lists_every_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3", submit=fake.submit
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"], "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }
            first = await batches.start(
                {**request, "name": "用户一"}, owner="designer-1"
            )
            second = await batches.start(
                {**request, "name": "用户二"}, owner="designer-2"
            )

            self.assertEqual(
                [first["id"]],
                [item["id"] for item in batches.list(owner="designer-1")],
            )
            self.assertEqual(
                {first["id"], second["id"]},
                {item["id"] for item in batches.list(admin=True)},
            )
            renamed = batches.rename(
                first["id"], "角色探索", owner="designer-1"
            )
            self.assertEqual("角色探索", renamed["name"])
            with self.assertRaises(KeyError):
                batches.rename(first["id"], "越权", owner="designer-2")

    async def test_failed_task_retry_keeps_attempt_count_and_rerun_copies_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = 0

            async def flaky(task, *, owner, batch_id):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise RuntimeError("temporary provider failure")
                return {
                    "run_id": f"run-{calls}", "status": "succeeded",
                    "outputs": [f"/{calls}.png"],
                }

            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3", submit=flaky
            )
            request = {
                "name": "原批次",
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"], "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }
            failed = await batches.start(request, owner="designer-1")
            self.assertEqual("failed", failed["status"])
            self.assertEqual(1, failed["tasks"][0]["attempt_count"])

            retried = await batches.retry_failed(
                failed["id"], owner="designer-1"
            )
            self.assertEqual("completed", retried["status"])
            self.assertEqual(2, retried["tasks"][0]["attempt_count"])

            rerun = await batches.rerun(
                retried["id"], owner="designer-1"
            )
            self.assertNotEqual(retried["id"], rerun["id"])
            self.assertEqual("原批次 · 重跑", rerun["name"])
            self.assertEqual(
                retried["snapshot"]["prompt_modules"],
                rerun["snapshot"]["prompt_modules"],
            )
    async def test_query_reconciles_background_generation_run_completion(self):
        with tempfile.TemporaryDirectory() as temporary:
            runs = {}

            async def submit(task, *, owner, batch_id):
                runs["run-1"] = SimpleNamespace(status="running", result=None, error="")
                return {"run_id": "run-1", "status": "queued", "outputs": []}

            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=submit,
                inspect_run=lambda run_id, owner: runs[run_id],
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"], "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }
            created = await batches.start(request, owner="designer-1")
            self.assertEqual("running", created["status"])

            runs["run-1"] = SimpleNamespace(
                status="succeeded",
                result={"urls": ["/assets/output/fox.png"]},
                error="",
            )
            completed = batches.get(created["id"], owner="designer-1")

            self.assertEqual("completed", completed["status"])
            self.assertEqual(
                ["/assets/output/fox.png"], completed["tasks"][0]["outputs"]
            )

    async def test_query_recovers_outputs_from_legacy_list_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            runs = {}

            async def submit(task, *, owner, batch_id):
                runs["legacy-run"] = SimpleNamespace(
                    status="running", result=None, error=""
                )
                return {
                    "run_id": "legacy-run",
                    "status": "running",
                    "outputs": [],
                }

            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=submit,
                inspect_run=lambda run_id, owner: runs[run_id],
            )
            created = await batches.start({
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }, owner="designer-1")
            runs["legacy-run"] = SimpleNamespace(
                status="succeeded",
                result=[
                    {
                        "type": "url",
                        "value": "/assets/output/recovered.png",
                    },
                    {"usage": {"images": 1}},
                ],
                error="",
            )

            completed = await batches.query(
                created["id"], owner="designer-1"
            )

            self.assertEqual("completed", completed["status"])
            self.assertEqual(
                ["/assets/output/recovered.png"],
                completed["tasks"][0]["outputs"],
            )

    async def test_query_backfills_empty_outputs_for_succeeded_task(self):
        run = SimpleNamespace(
            status="succeeded",
            result={"images": ["/assets/output/backfilled.png"]},
            error="",
        )

        async def submit(task, *, owner, batch_id):
            return {
                "run_id": "already-succeeded",
                "status": "succeeded",
                "outputs": [],
            }

        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch.sqlite3",
                submit=submit,
                inspect_run=lambda run_id, owner: run,
            )
            created = await batches.start({
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }, owner="designer-1")

            refreshed = await batches.query(
                created["id"], owner="designer-1"
            )

            self.assertEqual(
                ["/assets/output/backfilled.png"],
                refreshed["tasks"][0]["outputs"],
            )

    async def test_preview_then_start_freezes_and_executes_every_combination(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeGenerationRuns()
            batches = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=fake.submit,
            )
            request = {
                "name": "角色探索",
                "prompt_modules": [
                    {"name": "主体", "options": ["红狐", "雪豹"]},
                    {"name": "环境", "options": ["森林", "雪山"]},
                ],
                "image_variables": [],
                "models": ["fake-image-v1"],
                "ratios": ["1:1"],
                "settings": {
                    "provider_id": "fake",
                    "quality": "high",
                    "resolution": "1k",
                    "outputs_per_run": 1,
                    "desired_concurrency": 2,
                },
                "excluded": [1],
            }

            preview = batches.preview(request)
            self.assertEqual(4, preview["generation_run_count"])
            self.assertEqual(4, preview["estimated_output_count"])
            self.assertEqual(
                ["红狐,\n森林", "红狐,\n雪山", "雪豹,\n森林", "雪豹,\n雪山"],
                [task["prompt"] for task in preview["tasks"]],
            )

            created = await batches.start(request, owner="designer-1")
            stored = batches.get(created["id"], owner="designer-1")

            self.assertEqual("completed", stored["status"])
            self.assertEqual(3, stored["progress"]["succeeded"])
            self.assertEqual(3, len(fake.submissions))
            self.assertEqual(
                {"designer-1"},
                {owner for _, owner, _ in fake.submissions},
            )
            self.assertEqual(
                {"角色探索"},
                {task["batch_name"] for task, _, _ in fake.submissions},
            )
            request["prompt_modules"][0]["options"][0] = "被篡改"
            self.assertEqual(
                "红狐",
                stored["snapshot"]["prompt_modules"][0]["options"][0],
            )

            reopened = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=fake.submit,
            )
            self.assertEqual(created["id"], reopened.get(
                created["id"], owner="designer-1"
            )["id"])
            with self.assertRaises(KeyError):
                reopened.get(created["id"], owner="designer-2")

    async def test_prompt_file_options_keep_the_selected_source_filename(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=FakeGenerationRuns().submit,
            )
            request = {
                "prompt_modules": [{
                    "name": "主体",
                    "options": [
                        {
                            "value": "红狐，森林",
                            "name": "fox.txt",
                            "relative_path": "prompts/animals/fox.txt",
                        },
                        {
                            "value": "雪豹，雪山",
                            "name": "snow.md",
                            "relative_path": "prompts/animals/snow.md",
                        },
                    ],
                }],
                "image_variables": [],
                "models": ["fake-image-v1"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }

            preview = batches.preview(request)

            self.assertEqual(
                ["红狐，森林", "雪豹，雪山"],
                [task["prompt"] for task in preview["tasks"]],
            )
            self.assertEqual(
                [{
                    "module": "主体",
                    "name": "fox.txt",
                    "relative_path": "prompts/animals/fox.txt",
                }],
                preview["tasks"][0]["prompt_references"],
            )
            self.assertEqual(
                "prompts/animals/snow.md",
                preview["tasks"][1]["prompt_references"][0]["relative_path"],
            )

    async def test_limits_are_rejected_instead_of_truncated(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=FakeGenerationRuns().submit,
            )
            request = {
                "prompt_modules": [
                    {"name": "A", "options": [str(index) for index in range(251)]},
                    {"name": "B", "options": ["x", "y"]},
                ],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }

            with self.assertRaisesRegex(
                BatchGenerationValidation, "500 个 Generation Run"
            ):
                batches.preview(request)

    async def test_image_variable_limit_is_twenty(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=FakeGenerationRuns().submit,
            )
            request = {
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "image_variables": [
                    {
                        "name": f"IMG {index + 1:02d}",
                        "options": [{"url": f"/assets/input/{index}.png"}],
                    }
                    for index in range(20)
                ],
                "models": ["fake"],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            }

            preview = batches.preview(request)
            self.assertEqual(20, len(preview["tasks"][0]["reference_images"]))

            request["image_variables"].append({
                "name": "IMG 21",
                "options": [{"url": "/assets/input/20.png"}],
            })
            with self.assertRaisesRegex(
                BatchGenerationValidation, "最多支持 20 个图片变量"
            ):
                batches.preview(request)

    def test_batch_page_allows_twenty_image_variable_slots(self):
        root = Path(__file__).resolve().parents[1]
        javascript = (
            root / "static" / "js" / "batch-generation.js"
        ).read_text(encoding="utf-8")

        self.assertIn("const maxImageVariables = 20;", javascript)
        self.assertIn(
            "length >= maxImageVariables) return;",
            javascript,
        )

    async def test_model_choices_keep_their_provider_in_each_derived_task(self):
        with tempfile.TemporaryDirectory() as temporary:
            batches = BatchGeneration(
                Path(temporary) / "batch-generation.sqlite3",
                submit=FakeGenerationRuns().submit,
            )
            preview = batches.preview({
                "prompt_modules": [{"name": "主体", "options": ["狐狸"]}],
                "models": [
                    {"provider_id": "openai", "model": "gpt-image-2", "name": "GPT Image 2"},
                    {"provider_id": "gemini", "model": "nano-banana-pro", "name": "Nano Banana Pro"},
                ],
                "ratios": ["1:1"],
                "settings": {"outputs_per_run": 1},
            })

            self.assertEqual(
                [("openai", "gpt-image-2"), ("gemini", "nano-banana-pro")],
                [(task["provider_id"], task["model"]) for task in preview["tasks"]],
            )


if __name__ == "__main__":
    unittest.main()
