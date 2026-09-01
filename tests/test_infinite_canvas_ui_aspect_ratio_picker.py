import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "static/js/infinite-canvas-ui/aspect-ratio-picker.js"
CORE = ROOT / "static/js/infinite-canvas-ui/core.js"
CASE = ROOT / "static/js/infinite-canvas-ui/selection-adjustment-case.js"
SMART_CANVAS = ROOT / "static/js/smart-canvas.js"


class InfiniteCanvasUiAspectRatioPickerTests(unittest.TestCase):
    def test_picker_uses_existing_project_parameter_keys(self):
        source = RUNTIME.read_text(encoding="utf-8")
        smart_canvas = SMART_CANVAS.read_text(encoding="utf-8")
        project_presets = {
            "square": "1:1", "portrait": "2:3", "landscape": "3:2",
            "portrait43": "3:4", "landscape43": "4:3", "story": "9:16",
            "wide": "16:9", "ultrawide": "21:9", "ultratall": "9:21",
        }
        for value in ("source", *project_presets):
            self.assertIn(f"value: '{value}'", source)
        for value, ratio in project_presets.items():
            self.assertIn(f"label: '{ratio}'", source)
        self.assertIn("standardToRatioKey(ratio)", smart_canvas)
        self.assertIn('ratio-presets="${escapeAttr(presets.join(\',\'))}"', smart_canvas)

    def test_source_ratio_is_consistently_named_original(self):
        source = RUNTIME.read_text(encoding="utf-8")
        smart_canvas = SMART_CANVAS.read_text(encoding="utf-8")
        self.assertIn("value: 'source', label: '原图'", source)
        self.assertIn("isEnglish ? 'Original' : '原图'", source)
        self.assertIn("tr('smart.sourceOriginal')", smart_canvas)
        self.assertNotIn("source-label=\"${escapeAttr(tr('smart.auto'))}\"", smart_canvas)

    def test_picker_is_form_associated_and_keyboard_operable(self):
        source = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("static formAssociated = true", source)
        self.assertIn("this.attachInternals()", source)
        self.assertIn("this.internals.setFormValue(values)", source)
        self.assertIn("role=\"radio\"", source)
        for key in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"):
            self.assertIn(key, source)
        self.assertIn("new InputEvent('input'", source)
        self.assertIn("new Event('change'", source)

    def test_picker_supports_opt_in_multiple_selection(self):
        source = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("get multiple()", source)
        self.assertIn("get values()", source)
        self.assertIn("set values(values)", source)
        self.assertIn("this.multiple ? 'role=\"checkbox\"' : 'role=\"radio\"'", source)
        self.assertIn("selected.add(value)", source)
        self.assertIn("selected.delete(value)", source)

    def test_picker_visuals_use_shared_design_tokens(self):
        source = RUNTIME.read_text(encoding="utf-8")
        for token in (
            "--ui-color-surface-subtle", "--ui-color-text-tertiary", "--ui-color-surface",
            "--ui-color-action-secondary", "--ui-color-border-primary", "--ui-shadow-raised",
            "--ui-icon-stroke-width-m",
            "--ui-space-1", "--ui-space-2", "--ui-radius-xs", "--ui-focus-ring",
            "--ui-control-height-l", "--ui-icon-size-l", "--ui-motion-duration-fast",
        ):
            self.assertIn(f"var({token})", source)
        self.assertIn('button[aria-checked="true"] { border-radius: var(--ui-radius-s); color: var(--ic-aspect-ratio-selected-foreground, var(--ui-color-text-primary)); border-color: var(--ic-aspect-ratio-selected-border-color, var(--ui-color-border-primary));', source)
        self.assertIn('background: var(--ic-aspect-ratio-selected-background, var(--ui-color-action-secondary))', source)
        self.assertIn('box-shadow: var(--ic-aspect-ratio-selected-shadow, var(--ui-shadow-raised))', source)
        self.assertIn(':host([data-component-variant="multiple"]) { --ic-aspect-ratio-options-background: var(--ui-color-action-tertiary); --ic-aspect-ratio-selected-background: var(--ui-color-surface-subtle); --ic-aspect-ratio-selected-border-color: transparent; --ic-aspect-ratio-selected-shadow: none; }', source)
        self.assertIn(':host([data-component-variant="multiple"]) button:hover { background: var(--ui-color-surface-subtle); }', source)
        self.assertIn(':host([data-component-variant="generation-settings"]) .options { display: flex; flex-wrap: nowrap; align-items: stretch; gap: var(--ui-space-2); padding: var(--ui-space-2); }', source)
        self.assertNotIn(':host([data-component-variant="generation-settings"]) .options { display: flex; flex-wrap: nowrap; align-items: stretch; gap: var(--ui-space-2); padding: var(--ui-space-2); border-radius: var(--ui-radius-m); }', source)
        self.assertIn('.ratio-options { display: contents; }', source)
        self.assertIn("sizedName('ic-aspect-ratio-picker-multiple', size)", CASE.read_text(encoding="utf-8"))
        self.assertIn('border: calc(var(--ui-icon-stroke-width-m) * 1px) solid currentColor', source)
        self.assertNotRegex(source, r"#[0-9a-fA-F]{3,8}\\b")

    def test_custom_option_is_commented_out_but_implementation_is_retained(self):
        source = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("自定义画幅暂不开放", source)
        self.assertIn("// Object.freeze({ value: 'custom'", source)
        self.assertIn("get customRatioWidth()", source)
        self.assertIn("get customRatioHeight()", source)
        self.assertIn("get customRatio()", source)
        self.assertIn("Ratio, not pixel resolution", source)
        self.assertIn("输入比例，不是像素分辨率", source)
        self.assertIn("分辨率请在独立的尺寸控件中设置", source)
        self.assertIn("${this.name}-custom-ratio", source)
        self.assertIn('background: var(--ui-color-surface)', source)

    def test_picker_is_registered_and_visible_in_component_library_matrix(self):
        core = CORE.read_text(encoding="utf-8")
        case = CASE.read_text(encoding="utf-8")
        self.assertIn("define('ic-aspect-ratio-picker', IcAspectRatioPicker)", core)
        self.assertIn("PROJECT_ASPECT_RATIO_PRESETS", core)
        self.assertIn("<ic-aspect-ratio-picker", case)
        self.assertIn("sizedName('ic-aspect-ratio-picker', size)", case)
        self.assertIn("data-aspect-ratio-value", case)


if __name__ == "__main__":
    unittest.main()
