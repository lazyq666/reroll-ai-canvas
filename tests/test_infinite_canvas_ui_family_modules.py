import re
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "static" / "js" / "infinite-canvas-ui"
UI_VERSION = (UI_ROOT / "VERSION").read_text(encoding="utf-8").strip()


class InfiniteCanvasUiFamilyModulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = (UI_ROOT / "core.js").read_text(encoding="utf-8")
        cls.theme = (UI_ROOT / "theme-adapter.js").read_text(encoding="utf-8")

    def test_text_entry_has_a_stable_entry_and_per_control_files(self):
        entry = (UI_ROOT / "text-entry.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "text-entry" / "index.js").read_text(encoding="utf-8")
        self.assertIn(f"from './text-entry/index.js?v={UI_VERSION}'", entry)
        for public_class, filename in (
            ("IcInput", "input.js"),
            ("IcTextarea", "textarea.js"),
            ("IcFormField", "form-field.js"),
        ):
            implementation = (UI_ROOT / "text-entry" / filename).read_text(encoding="utf-8")
            self.assertIn(f"export class {public_class}", implementation)
            self.assertIn(public_class, index)
        self.assertIn(f"from './text-entry.js?v={UI_VERSION}'", self.core)

    def test_text_entry_and_prompt_styles_are_owned_locally(self):
        styles = (UI_ROOT / "text-entry" / "styles.js").read_text(encoding="utf-8")
        prompt = (UI_ROOT / "prompt-composer.js").read_text(encoding="utf-8")
        for selector in (
            "ic-input::part(base)",
            "ic-textarea::part(base)",
            'ic-input[appearance="subtle"]::part(base)',
            'ic-input[end-action] > ic-icon-button[slot="end"]::part(base)',
            'ic-form-field[invalid] ic-input::part(base)',
        ):
            self.assertIn(selector, styles)
        self.assertIn("ic-prompt-composer:empty::before", prompt)
        self.assertIn('ic-prompt-composer[contenteditable="false"]', prompt)

    def test_theme_adapter_no_longer_owns_text_entry_or_prompt_rules(self):
        owner_selector = re.compile(
            r"(?m)^\s*ic-(?:input|textarea|form-field|prompt-composer)(?=[\s,:\[])"
        )
        self.assertIsNone(owner_selector.search(self.theme))
        self.assertNotIn("ic-prompt-composer", self.theme)

    def test_selection_adjustment_has_a_stable_entry_and_per_control_files(self):
        entry = (UI_ROOT / "selection-adjustment.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "selection-adjustment" / "index.js").read_text(encoding="utf-8")
        self.assertIn(f"from './selection-adjustment/index.js?v={UI_VERSION}'", entry)
        for public_class, filename in (
            ("IcCheckbox", "checkbox.js"),
            ("IcRadio", "radio.js"),
            ("IcRadioGroup", "radio-group.js"),
            ("IcSwitch", "switch.js"),
            ("IcSelect", "select.js"),
            ("IcSlider", "slider.js"),
            ("IcNumberInput", "number-input.js"),
            ("IcColorField", "color-field.js"),
        ):
            implementation = (UI_ROOT / "selection-adjustment" / filename).read_text(encoding="utf-8")
            self.assertIn(f"export class {public_class}", implementation)
            self.assertIn(public_class, index)
        self.assertIn(f"from './selection-adjustment.js?v={UI_VERSION}'", self.core)

    def test_selection_adjustment_styles_are_owned_locally(self):
        styles = (UI_ROOT / "selection-adjustment" / "styles.js").read_text(encoding="utf-8")
        for selector in (
            "ic-checkbox::part(control)",
            "ic-radio::part(control)",
            "ic-switch::part(control)",
            "ic-select::part(combobox)",
            "ic-slider::part(slider)",
            "ic-number-input::part(base)",
            "ic-color-field::part(trigger)",
        ):
            self.assertIn(selector, styles)

    def test_theme_adapter_no_longer_owns_selection_adjustment_rules(self):
        owner_selector = re.compile(
            r"(?m)^\s*ic-(?:checkbox|radio|radio-group|switch|select|slider|number-input|color-field)(?=[\s,:\[])"
        )
        self.assertIsNone(owner_selector.search(self.theme))
        self.assertNotRegex(
            self.theme,
            r"(?m)^\s*ic-select\[data-component-variant=\"model-picker\"\]",
        )

    def test_dialog_has_a_stable_entry_and_per_control_files(self):
        entry = (UI_ROOT / "dialog.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "dialog" / "index.js").read_text(encoding="utf-8")
        dialog = (UI_ROOT / "dialog" / "dialog.js").read_text(encoding="utf-8")
        confirmation = (UI_ROOT / "dialog" / "confirmation-dialog.js").read_text(encoding="utf-8")
        self.assertIn(f"from './dialog/index.js?v={UI_VERSION}'", entry)
        self.assertIn("export class IcDialog", dialog)
        self.assertIn("export class IcConfirmationDialog", confirmation)
        self.assertIn("IcDialog", index)
        self.assertIn("IcConfirmationDialog", index)
        self.assertIn(f"from './dialog.js?v={UI_VERSION}'", self.core)

    def test_dialog_and_ai_processor_styles_are_owned_locally(self):
        dialog_styles = (UI_ROOT / "dialog" / "styles.js").read_text(encoding="utf-8")
        ai_styles = (UI_ROOT / "ai-processor-dialog" / "styles.js").read_text(encoding="utf-8")
        ai_module = (UI_ROOT / "ai-processor-dialog.js").read_text(encoding="utf-8")
        self.assertIn("ic-dialog::part(dialog)", dialog_styles)
        self.assertIn("ic-confirmation-dialog::part(dialog)", dialog_styles)
        self.assertIn("--ui-dialog-size-medium", dialog_styles)
        self.assertIn("ic-ai-processor-dialog::part(dialog)", ai_styles)
        self.assertIn('[data-ai-processor-layout="outpaint"]', ai_styles)
        self.assertIn("ensureAiProcessorDialogStyles();", ai_module)

    def test_dialog_shells_use_the_medium_radius_token(self):
        dialog_styles = (UI_ROOT / "dialog" / "styles.js").read_text(encoding="utf-8")
        ai_styles = (UI_ROOT / "ai-processor-dialog" / "styles.js").read_text(encoding="utf-8")
        self.assertRegex(
            dialog_styles,
            r"ic-dialog::part\(dialog\),\s*ic-confirmation-dialog::part\(dialog\)\s*\{[^}]*border-radius: var\(--ui-radius-m\)",
        )
        self.assertRegex(
            ai_styles,
            r"ic-ai-processor-dialog::part\(dialog\)\s*\{[^}]*border-radius: var\(--ui-radius-m\)",
        )

    def test_theme_adapter_no_longer_owns_dialog_rules(self):
        self.assertNotRegex(
            self.theme,
            r"(?m)^\s*ic-(?:dialog|confirmation-dialog|ai-processor-dialog)(?=[\s,:\[])",
        )
        self.assertNotIn("--ui-dialog-size-", self.theme)

    def test_navigation_command_has_a_stable_entry_and_per_control_files(self):
        entry = (UI_ROOT / "navigation-command.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "navigation-command" / "index.js").read_text(encoding="utf-8")
        self.assertIn(f"from './navigation-command/index.js?v={UI_VERSION}'", entry)
        for public_class, filename in (
            ("IcTabs", "tabs.js"),
            ("IcSegmentedControl", "segmented-control.js"),
            ("IcToolbar", "toolbar.js"),
            ("IcFloatingToolbar", "floating-toolbar.js"),
            ("IcNavItem", "nav-item.js"),
            ("IcNavDisclosure", "nav-disclosure.js"),
            ("IcBreadcrumb", "breadcrumb.js"),
            ("IcPagination", "pagination.js"),
            ("IcSteps", "steps.js"),
        ):
            implementation = (UI_ROOT / "navigation-command" / filename).read_text(encoding="utf-8")
            self.assertIn(f"export class {public_class}", implementation)
            self.assertIn(public_class, index)
        self.assertIn(f"from './navigation-command.js?v={UI_VERSION}'", self.core)

    def test_blocks_have_one_public_entry_and_locally_owned_implementations(self):
        entry = (UI_ROOT / "blocks.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "blocks" / "index.js").read_text(encoding="utf-8")
        styles = (UI_ROOT / "blocks" / "styles.js").read_text(encoding="utf-8")
        image_toolbar = (UI_ROOT / "blocks" / "image-edit-mode-toolbar.js").read_text(encoding="utf-8")
        canvas_dock = (UI_ROOT / "blocks" / "smart-canvas-dock.js").read_text(encoding="utf-8")
        node_context_menu = (UI_ROOT / "blocks" / "smart-node-context-menu.js").read_text(encoding="utf-8")
        node_toolbar = (UI_ROOT / "blocks" / "smart-node-toolbar.js").read_text(encoding="utf-8")
        self.assertIn(f"from './blocks/index.js?v={UI_VERSION}'", entry)
        self.assertIn("IcImageEditModeToolbar", index)
        self.assertIn("IcSmartCanvasDock", index)
        self.assertIn("IcSmartNodeContextMenu", index)
        self.assertIn("IcSmartNodeToolbar", index)
        self.assertIn("export class IcImageEditModeToolbar", image_toolbar)
        self.assertIn("export class IcSmartCanvasDock", canvas_dock)
        self.assertIn("export class IcSmartNodeContextMenu", node_context_menu)
        self.assertIn("export class IcSmartNodeToolbar", node_toolbar)
        self.assertIn("ic-image-edit-mode-toolbar", styles)
        self.assertIn("ic-smart-canvas-dock", styles)
        self.assertIn("ic-smart-node-context-menu", styles)
        self.assertIn("ic-smart-node-toolbar", styles)
        self.assertIn(f"from './blocks.js?v={UI_VERSION}'", self.core)
        self.assertIn("define('ic-smart-node-context-menu', IcSmartNodeContextMenu)", self.core)

    def test_canvas_navigation_has_a_stable_entry_and_owned_minimap(self):
        entry = (UI_ROOT / "canvas-navigation.js").read_text(encoding="utf-8")
        index = (UI_ROOT / "canvas-navigation" / "index.js").read_text(encoding="utf-8")
        minimap = (UI_ROOT / "canvas-navigation" / "smart-minimap.js").read_text(encoding="utf-8")
        smart_canvas = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        self.assertIn(f"from './canvas-navigation/index.js?v={UI_VERSION}'", entry)
        self.assertIn("IcSmartMinimap", index)
        self.assertIn("export class IcSmartMinimap", minimap)
        self.assertIn(f"from './canvas-navigation.js?v={UI_VERSION}'", self.core)
        self.assertIn("define('ic-smart-minimap', IcSmartMinimap)", self.core)
        self.assertNotIn(".smart-minimap-content", smart_canvas)
        self.assertNotIn(".smart-minimap-viewport", smart_canvas)

    def test_divider_uses_compact_token_spacing_in_both_orientations(self):
        containers = (UI_ROOT / "containers-data.js").read_text(encoding="utf-8")
        self.assertIn("margin-block:var(--ui-space-1)", containers)
        self.assertIn("margin:0 var(--ui-space-1)", containers)
        self.assertNotIn("margin-block:var(--ui-space-3)", containers)
        self.assertNotIn("margin:0 var(--ui-space-3)", containers)

    def test_smart_canvas_styles_do_not_own_public_block_visuals(self):
        smart_canvas = (ROOT / "static" / "css" / "smart-canvas.css").read_text(encoding="utf-8")
        self.assertNotIn(".smart-node-floating-menu", smart_canvas)
        self.assertNotIn(".image-edit-mode-toolbar", smart_canvas)
        self.assertNotIn(".smart-canvas-dock .smart-canvas-dock-btn::part(base)", smart_canvas)
        self.assertNotIn("#panoramaToggleBtn::part(base)", smart_canvas)

    def test_navigation_command_uses_only_shadow_owned_control_styles(self):
        sources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (UI_ROOT / "navigation-command").glob("*.js")
        )
        self.assertNotIn("ensureNavigationCommandStyles", sources)
        self.assertNotIn("NAVIGATION_COMMAND_STYLE_ID", sources)
        self.assertIn('::slotted([role="tab"])', sources)
        self.assertIn('::slotted([role="radio"])', sources)

    def test_reference_thumbnail_is_public_and_owns_its_ui_and_actions(self):
        file_media = (UI_ROOT / "file-media-input.js").read_text(encoding="utf-8")
        thumbnail = (
            UI_ROOT / "file-media-input" / "reference-thumbnail.js"
        ).read_text(encoding="utf-8")
        hovercard = (
            UI_ROOT / "file-media-input" / "thumb-hovercard.js"
        ).read_text(encoding="utf-8")
        smart_canvas_style = (
            ROOT / "static" / "css" / "smart-canvas.css"
        ).read_text(encoding="utf-8")
        self.assertIn("IcReferenceThumbnail", file_media)
        self.assertIn("IcThumbHovercard", file_media)
        self.assertIn("define('ic-thumb-hovercard', IcThumbHovercard)", self.core)
        self.assertIn("define('ic-reference-thumbnail', IcReferenceThumbnail)", self.core)
        self.assertIn("export class IcReferenceThumbnail", thumbnail)
        self.assertIn("ic-reference-thumbnail:hover .input-thumb-remove", thumbnail)
        self.assertIn(
            "border-radius: calc(var(--ui-radius-s) - var(--ui-border-width-thin))",
            thumbnail,
        )
        self.assertIn("inset: 0 0 var(--ic-reference-thumbnail-label-block-size)", thumbnail)
        self.assertIn('ic-icon name="audio-lines"', thumbnail)
        self.assertIn('ic-icon name="square-text"', thumbnail)
        self.assertIn('ic-reference-thumbnail[data-kind="text"]', thumbnail)
        self.assertIn("background: var(--ui-color-surface);", thumbnail)
        self.assertIn("_showPreview()", thumbnail)
        self.assertIn("_hidePreview()", thumbnail)
        self.assertIn("document.createElement('ic-thumb-hovercard')", thumbnail)
        self.assertIn("this.getAttribute('aria-label')", thumbnail)
        self.assertNotIn("view-label", thumbnail)
        self.assertIn("new CustomEvent('ic-activate'", thumbnail)
        self.assertIn("new CustomEvent('ic-remove'", thumbnail)
        self.assertIn("export class IcThumbHovercard", hovercard)
        self.assertIn("inline-size: 12rem", hovercard)
        self.assertIn("block-size: 8rem", hovercard)
        self.assertIn("max-inline-size: 12rem", hovercard)
        self.assertIn('autoplay muted loop playsinline', hovercard)
        self.assertIn('class="audio-wave"', hovercard)
        self.assertEqual(hovercard.count('<span></span>'), 9)
        self.assertNotIn('<ic-icon name="audio-lines"', hovercard)
        self.assertIn("animation: ic-thumb-hovercard-audio-wave-pulse 1.2s ease-in-out infinite", hovercard)
        self.assertIn("0%, 100% { transform: scaleY(.32); }", hovercard)
        self.assertIn("50% { transform: scaleY(1); }", hovercard)
        self.assertIn("animation-delay: -.6s", hovercard)
        self.assertIn("color: var(--ui-color-text-white)", hovercard)
        self.assertIn("overflow: hidden", hovercard)
        self.assertIn("destroyMedia()", hovercard)
        self.assertIn("anchorRect.left + (anchorRect.width - cardRect.width) / 2", hovercard)
        self.assertIn("inline-size: var(--ui-space-2)", hovercard)
        self.assertIn("querySelector('[data-gap-probe]')", hovercard)
        self.assertNotIn("<ic-button", hovercard)
        self.assertNotIn("查看原", hovercard)
        self.assertNotIn(".input-thumb-remove {", smart_canvas_style)
        manifest = json.loads(
            (ROOT / "static/design-system/infinite-canvas-ui/surface-manifest.json").read_text(encoding="utf-8")
        )
        self.assertIn(
            "ic-reference-thumbnail",
            manifest["surfaces"]["target"]["fileMediaInput"]["components"],
        )
        self.assertIn(
            "ic-thumb-hovercard",
            manifest["surfaces"]["target"]["menuPopover"]["components"],
        )
        self.assertNotIn(
            "ic-thumb-hovercard",
            manifest["surfaces"]["target"]["fileMediaInput"]["components"],
        )
        self.assertIn(
            "ic-reference-thumbnail",
            manifest["surfaces"]["migration"]["targetComponentIds"],
        )
        self.assertIn(
            "ic-thumb-hovercard",
            manifest["surfaces"]["migration"]["targetComponentIds"],
        )


if __name__ == "__main__":
    unittest.main()
