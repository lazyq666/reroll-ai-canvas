import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/infinite-canvas-ui/ai-processor-dialog.js"
OLD_MODULE = ROOT / "static/js/infinite-canvas-ui/reverse-prompt-dialog.js"
CORE = ROOT / "static/js/infinite-canvas-ui/core.js"
AI_STYLES = ROOT / "static/js/infinite-canvas-ui/ai-processor-dialog/styles.js"
DIALOG_STYLES = ROOT / "static/js/infinite-canvas-ui/dialog/styles.js"
ASPECT_PICKER = ROOT / "static/js/infinite-canvas-ui/aspect-ratio-picker.js"
CASE = ROOT / "static/design-system/infinite-canvas-ui/dialog-case.html"
CASE_APP = ROOT / "static/js/infinite-canvas-ui/dialog-case.js"


def owned_styles():
    return (
        DIALOG_STYLES.read_text(encoding="utf-8")
        + AI_STYLES.read_text(encoding="utf-8")
    )


class InfiniteCanvasUiAiProcessorDialogTests(unittest.TestCase):
    def test_generic_component_replaces_the_reverse_specific_component(self):
        module = MODULE.read_text(encoding="utf-8")
        core = CORE.read_text(encoding="utf-8")
        self.assertFalse(OLD_MODULE.exists())
        self.assertIn("class IcAiProcessorDialog extends IcDialog", module)
        self.assertIn("define('ic-ai-processor-dialog', IcAiProcessorDialog)", core)
        self.assertNotIn("ic-reverse-prompt-dialog", core + module)

    def test_interface_keeps_business_io_at_the_host_seam(self):
        source = MODULE.read_text(encoding="utf-8")
        for value in (
            "'reverse-prompt', 'outpaint', 'angle-control'",
            "groups:{attribute:false}",
            "models:{attribute:false}",
            "sourceImage:{attribute:'source-image'",
            "selectedGroup:{attribute:'selected-group'",
            "selectedTemplate:{attribute:'selected-template'",
            "selectedModel:{attribute:'selected-model'",
            "ic-confirm",
            "ic-cancel",
        ):
            self.assertIn(value, source)
        self.assertNotIn("fetch(", source)

    def test_presets_own_the_confirmed_layout_and_validation_contracts(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        self.assertIn("this.dismissPolicy = 'explicit'", module)
        self.assertIn("this.size=this.processor==='reverse-prompt'?'medium':'large'", module)
        self.assertIn("name.includes('反推')", module)
        self.assertIn("this.selectedModel=this.models[0]?.id||''", module)
        self.assertIn("Remove the solid-color area and fill the scene", module)
        self.assertIn("OUTPAINT_LONG_EDGE_LIMIT = 8192", module)
        self.assertIn("OUTPAINT_PIXEL_LIMIT = 64_000_000", module)
        self.assertIn("!this.angleState.command", module)
        self.assertIn("createAngleCameraController", module)
        self.assertIn('appearance="checkmark-end"', module)
        self.assertIn("ic-ai-processor-dialog::part(close-button)", adapter)
        self.assertIn('[data-ai-processor-layout="reverse-prompt"]', adapter)
        self.assertIn('[data-ai-processor-layout="outpaint"]', adapter)
        self.assertIn('[data-ai-processor-layout="angle-control"]', adapter)

    def test_outpaint_uses_compact_ratio_aware_controls(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        aspect_picker = ASPECT_PICKER.read_text(encoding="utf-8")
        self.assertNotIn("ai-processor-field-label", module + adapter)
        self.assertIn('name="outpaint-generation-settings"', module)
        self.assertIn('ratio-presets="adaptive,source,1:1,2:3,3:2,3:4,4:3,9:16,16:9,21:9,9:21"', module)
        self.assertIn('resolutions="auto,1k,2k,4k"', module)
        self.assertIn('adaptive-label="自由"', module)
        self.assertIn('source-label="原图"', module)
        self.assertIn('ratio-variant="outpaint"', module)
        self.assertIn("outpaintResolution:{attribute:'outpaint-resolution',reflect:true}", module)
        self.assertIn("outpaintResolution:this.outpaintResolution", module)
        self.assertIn(':host([data-component-variant="outpaint"]) .ratio-options', aspect_picker)
        self.assertIn('grid-template-columns: repeat(4, minmax(0, 1fr))', aspect_picker)
        self.assertIn("if(this.processor==='outpaint'&&!this.selectedGroup) return '';", module)
        self.assertIn('grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)', adapter)
        self.assertIn('object-fit: contain', adapter)
        self.assertIn('conic-gradient(', adapter)
        self.assertIn('data-custom-color-option data-has-custom-color=', module)
        self.assertIn('data-custom-color-hint aria-hidden="true"', module)
        self.assertIn('[data-custom-color-option] ic-color-field::part(form-control-label) { display: none; }', adapter)
        self.assertIn('background: conic-gradient(from 90deg, #ff3b30', adapter)
        self.assertIn('[data-fill-color][aria-pressed="true"] { box-shadow: inset 0 0 0', adapter)
        self.assertIn('[data-custom-color-option][data-selected="true"] { box-shadow: inset 0 0 0', adapter)
        self.assertNotIn('[data-outpaint-color-options] ic-color-field { inline-size: 9rem; }', adapter)
        self.assertIn('ic-ai-processor-dialog[size="x-large"]::part(dialog) {\n      inline-size: var(--ui-dialog-size-x-large);\n      block-size:', adapter)
        self.assertIn('--ui-dialog-size-large: 72rem', adapter)
        self.assertIn('--ui-dialog-block-size-large: min(48rem, calc(100dvh - 6rem))', adapter)
        self.assertIn('--ui-dialog-size-x-large: 90vw', adapter)
        self.assertIn('--ui-dialog-block-size-x-large: 92vh', adapter)
        self.assertNotIn('ic-ai-processor-dialog[size="x-large"]::part(dialog) { inline-size: calc(100dvw', adapter)
        self.assertIn('ic-ai-processor-dialog[size="large"]::part(dialog)', adapter)

    def test_visual_workbenches_fill_available_height_and_locked_ratios_survive_dragging(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        self.assertIn("lockedOutpaint(proposed,handle)", module)
        move_start = module.index("moveOutpaintDrag(event)")
        move_end = module.index("ratioOutpaint(ratio)", move_start)
        move_body = module[move_start:move_end]
        self.assertIn("this.lockedOutpaint(next,handle)", move_body)
        self.assertNotIn("this.outpaintAspectRatio='adaptive'", move_body)
        self.assertIn("grid-template-rows: minmax(0, 1fr) auto", adapter)
        self.assertIn('[data-ai-processor-layout="outpaint"] {\n      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);\n      min-block-size: 0;\n      block-size: 100%;', adapter)
        self.assertIn("block-size: 100%", adapter)
        self.assertNotIn("block-size: clamp(19rem, 48dvh, 26rem)", adapter)
        self.assertNotIn("block-size: clamp(24rem, 56dvh, 31rem)", adapter)

    def test_angle_controls_live_in_the_settings_panel_not_the_preview(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        self.assertIn('<div data-ai-processor-layout="angle-control" data-angle-controller>', module)
        self.assertIn('<section data-angle-controller-column>${angleViewportMarkup()}</section><section data-ai-processor-panel>\n      ${cameraControlsMarkup()}', module)
        self.assertIn('name="angle-generation-settings"', module)
        self.assertIn('ratio-presets="source,square,portrait,landscape,portrait43,landscape43,story,wide,ultrawide"', module)
        self.assertIn('resolutions="auto,1k,2k,4k"', module)
        self.assertIn('ratio-variant="outpaint"', module)
        self.assertIn('source-label="原图" resolution-auto-label="自动"', module)
        self.assertIn("this.angleAspectRatio='source'", module)
        self.assertIn("this.angleResolution='auto'", module)
        self.assertIn('[data-angle-controller-column]', adapter)
        self.assertNotIn('.ai-angle-controller { display: grid; grid-template-columns:', adapter)

    def test_angle_output_settings_and_controls_follow_the_compact_two_column_layout(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        angle_start = module.index('<div data-ai-processor-layout="angle-control"')
        settings_start = module.index('<div class="ai-processor-output-settings">', angle_start)
        prompt_start = module.index('<ic-form-field label="生成提示词"', settings_start)
        settings_markup = module[settings_start:prompt_start]
        self.assertLess(settings_markup.index("${this.modelMarkup('图像模型')}"), settings_markup.index('画幅与分辨率'))
        self.assertIn('grid-template-columns: repeat(2, minmax(0, 1fr))', adapter)
        self.assertIn('padding-inline: var(--ui-space-3)', adapter)
        self.assertIn('min-block-size: var(--ui-control-height-s)', adapter)
        self.assertIn('[data-angle-prompt]::part(textarea) { block-size: 7rem; }', adapter)
        self.assertIn('ic-ai-processor-dialog::part(header)', adapter)
        self.assertNotIn('ic-ai-processor-dialog[processor="angle-control"]::part(header)', adapter)
        self.assertIn('padding-block-start: var(--ui-space-6)', adapter)
        self.assertIn('[data-ai-processor-layout="angle-control"] > [data-ai-processor-panel] { min-block-size: 0; gap: var(--ui-space-3);', adapter)

    def test_outpaint_output_settings_match_angle_layout_and_precede_prompt(self):
        module = MODULE.read_text(encoding="utf-8")
        outpaint_start = module.index('<div data-ai-processor-layout="outpaint"')
        settings_start = module.index('<div class="ai-processor-output-settings">', outpaint_start)
        prompt_start = module.index('<div data-outpaint-prompt>', settings_start)
        settings_markup = module[settings_start:prompt_start]
        self.assertLess(settings_markup.index("${this.modelMarkup('图像模型')}"), settings_markup.index('画幅与分辨率'))
        self.assertNotIn('name="outpaint-generation-settings"', module[prompt_start:module.index('  angleMarkup(){', prompt_start)])

    def test_outpaint_template_picker_follows_prompt_title_without_a_visible_label(self):
        module = MODULE.read_text(encoding="utf-8")
        adapter = owned_styles()
        prompt_start = module.index('<div data-outpaint-prompt>')
        prompt_end = module.index('  angleMarkup(){', prompt_start)
        prompt_markup = module[prompt_start:prompt_end]
        self.assertIn('<div data-outpaint-prompt-heading><span class="ai-processor-option-title">提示词</span>${this.groupSelectMarkup(true,false)}</div>', prompt_markup)
        self.assertIn('<option value="">${optional?\'不使用模板\':\'请选择分组\'}</option>', module)
        self.assertIn("name=\"ai-processor-group\"${showLabel?` label=\"${label}\"`:''} aria-label=\"${label}\"", module)
        self.assertIn('[data-outpaint-prompt-heading] { display: flex; align-items: center;', adapter)

    def test_live_case_supplies_groups_models_and_a_direct_source_image(self):
        html = CASE.read_text(encoding="utf-8")
        app = CASE_APP.read_text(encoding="utf-8")
        self.assertIn('<ic-ai-processor-dialog id="reverse-prompt-dialog"', html)
        self.assertIn("aiProcessorDialog.groups =", app)
        self.assertIn("aiProcessorDialog.models =", app)
        self.assertIn("'ic-ai-processor-dialog'", app)


if __name__ == "__main__":
    unittest.main()
