import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InfiniteCanvasUiMentionPickerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = (
            ROOT / "static/js/infinite-canvas-ui/mention-picker.js"
        ).read_text(encoding="utf-8")
        cls.icons = (
            ROOT / "static/js/infinite-canvas-ui/icon.js"
        ).read_text(encoding="utf-8")
        cls.core = (ROOT / "static/js/infinite-canvas-ui/core.js").read_text(
            encoding="utf-8"
        )
        cls.surface_app = (
            ROOT / "static/js/ui-component-library/surface-app.js"
        ).read_text(encoding="utf-8")
        cls.case = (
            ROOT / "static/js/infinite-canvas-ui/menu-popover-case.js"
        ).read_text(encoding="utf-8")
        cls.contract = json.loads(
            (
                ROOT
                / "static/design-system/infinite-canvas-ui/ic-menu-popover-v1.json"
            ).read_text(encoding="utf-8")
        )
        cls.surface_manifest = json.loads(
            (
                ROOT
                / "static/design-system/infinite-canvas-ui/surface-manifest.json"
            ).read_text(encoding="utf-8")
        )
        cls.smart_canvas_html = (ROOT / "static/smart-canvas.html").read_text(
            encoding="utf-8"
        )
        cls.smart_canvas_js = (ROOT / "static/js/smart-canvas.js").read_text(
            encoding="utf-8"
        )
        cls.smart_canvas_css = (ROOT / "static/css/smart-canvas.css").read_text(
            encoding="utf-8"
        )

    def test_component_is_registered_under_menu_popover_family(self):
        self.assertIn("define('ic-mention-picker', IcMentionPicker)", self.core)
        self.assertIn(
            "['ic-mention-picker', 'Mention Picker', 'menu-popover']",
            self.surface_app,
        )
        self.assertIn('data-copy-value="ic-mention-picker-prompt"', self.case)
        self.assertIn('data-copy-value="ic-mention-picker-media"', self.case)
        self.assertIn(
            "ic-mention-picker",
            self.surface_manifest["surfaces"]["target"]["menuPopover"]["components"],
        )
        self.assertIn(
            "ic-mention-picker",
            self.surface_manifest["surfaces"]["migration"]["targetComponentIds"],
        )

    def test_component_owns_picker_geometry_and_visual_contract(self):
        for contract_rule in (
            "height:var(--ic-mention-picker-height, 18rem)",
            "max-height:var(--ic-mention-picker-max-height, 18rem)",
            "height:1.5rem",
            "gap:var(--ui-space-2)",
            "max-width:60%",
            "color:var(--ui-color-text-secondary)",
            "color:var(--ui-color-text-tertiary)",
            "const gap = rootFontSize * 0.25",
            "`${anchor.width}px`",
            "show(anchor = document.activeElement, { invoker = anchor, placement = 'block-start' } = {})",
            "classList.toggle('media-option'",
            "badge: String(source.badge ?? '')",
            "badge.className = 'media-badge'",
            "height:3.125rem",
            "grid-template-columns:4.5rem minmax(0, 1fr)",
            "pointer-events:auto",
            "box-shadow:var(--ui-shadow-raised)",
            "padding:var(--ui-space-2)",
            "padding:var(--ui-space-1) var(--ui-space-2) var(--ui-space-2)",
            '<ic-segmented-control data-source-tabs',
            'size="small"',
            "inline-size:max-content",
            "columns:var(--ic-mention-picker-card-width, 5.625rem)",
            '<div class="media-columns"></div>',
            ".media-columns {",
            "const optionContainer = this.mediaMode",
            "optionContainer.append(option)",
            "border-color:var(--ui-color-border-secondary)",
            "border-color:var(--ui-color-border-focus)",
            "border-radius:var(--ui-radius-xs)",
            '.media-grid [part="option"]:hover,',
            "linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%)",
            "color:var(--ui-color-text-white)",
            "font-size:var(--ui-font-size-1)",
            "font-weight:var(--ui-font-weight-regular)",
            "sourceTabs?.addEventListener('ic-change'",
        ):
            with self.subTest(contract_rule=contract_rule):
                self.assertIn(contract_rule, self.component)

    def test_component_supports_fullscreen_editor_overlay_placement(self):
        for contract_rule in (
            "const PLACEMENTS = new Set(['block-start', 'block-end', 'overlay-block-end'])",
            "this._placement = PLACEMENTS.has(placement)",
            "anchor.bottom - overlay.height",
            "anchor.bottom + gap",
            "anchor.bottom - viewportInset",
            "anchor.top - gap - viewportInset",
            "window.innerHeight - anchor.bottom - gap - viewportInset",
        ):
            with self.subTest(contract_rule=contract_rule):
                self.assertIn(contract_rule, self.component)

    def test_leading_media_uses_reference_thumbnail_badge_style(self):
        mention_contract = next(
            component
            for component in self.contract["components"]
            if component["tag"] == "ic-mention-picker"
        )
        self.assertEqual(
            {
                "itemField": "badge",
                "defaultPlacement": "block-start inline-end",
                "leadingPlacement": "block-end full-width",
                "leadingContent": "reference-slot-label",
            },
            mention_contract["visualContract"]["mediaBadge"],
        )
        self.assertEqual(
            {
                "itemField": "leading",
                "layout": "row-major-before-masonry",
                "cardWidth": "4.0625rem",
                "visualModel": "ic-reference-thumbnail",
            },
            mention_contract["visualContract"]["mediaLeading"],
        )
        self.assertIn(
            "inset:var(--ui-space-1) var(--ui-space-1) auto auto",
            self.component,
        )
        self.assertIn(
            "listbox.querySelector(item.leading ? '.media-leading' : '.media-columns')",
            self.component,
        )
        self.assertIn(
            "--ic-mention-picker-leading-card-width, 4.0625rem",
            self.component,
        )
        for style_rule in (
            '.media-leading .media-badge {',
            "inset:auto 0 0",
            "height:var(--ic-mention-picker-leading-label-block-size, 0.875rem)",
            "border-radius:var(--ui-radius-s)",
            "object-fit:cover",
            "background:var(--ui-color-surface-canvas)",
            "font:var(--ui-text-caption)",
        ):
            with self.subTest(style_rule=style_rule):
                self.assertIn(style_rule, self.component)

    def test_prompt_icon_is_registered(self):
        self.assertIn("'book-text': 'BookText'", self.icons)

    def test_component_owns_selection_and_canvas_wheel_isolation(self):
        for behavior in (
            "handleKeydown(event)",
            "event.key === 'ArrowDown' || event.key === 'ArrowUp'",
            "this.moveActive(event.key === 'ArrowDown' ? 1 : -1)",
            "this.selectActive()",
            "event => event.stopPropagation()",
            "scrollIntoView?.({ block: 'nearest' })",
        ):
            with self.subTest(behavior=behavior):
                self.assertIn(behavior, self.component)

    def test_contract_records_public_mention_picker_interface(self):
        mention_picker = next(
            component
            for component in self.contract["components"]
            if component["tag"] == "ic-mention-picker"
        )
        self.assertEqual(mention_picker["requiredAttributes"], ["label"])
        self.assertIn("items", mention_picker["properties"])
        for property_name in (
            "tabs",
            "activeTab",
            "loading",
            "error",
            "hasMore",
            "mediaMode",
        ):
            with self.subTest(property_name=property_name):
                self.assertIn(property_name, mention_picker["properties"])
        self.assertIn("ic-select", mention_picker["events"])
        for event_name in ("ic-tab-change", "ic-load-more", "ic-retry"):
            with self.subTest(event_name=event_name):
                self.assertIn(event_name, mention_picker["events"])
        self.assertEqual(
            mention_picker["legalCombinations"][0]["id"],
            "anchored-suggestion-list",
        )
        self.assertEqual(
            mention_picker["legalCombinations"][1]["id"],
            "fullscreen-editor-suggestion-list",
        )
        self.assertEqual(
            mention_picker["legalCombinations"][2]["id"],
            "anchored-reference-media-picker",
        )
        self.assertEqual(
            mention_picker["visualContract"]["mediaHoverText"],
            {
                "color": "--ui-color-text-white",
                "fontSize": "--ui-font-size-1",
                "fontWeight": "--ui-font-weight-regular",
            },
        )
        self.assertEqual(
            mention_picker["visualContract"]["mediaScroll"],
            {
                "axis": "vertical",
                "layoutContainer": "media-leading-and-media-columns-inside-listbox",
                "horizontalOverflow": "prohibited",
                "reverseScroll": "required",
                "pagination": "append-preserve-position",
            },
        )
        self.assertEqual(
            mention_picker["visualContract"]["listboxPadding"],
            {
                "blockStart": "--ui-space-1",
                "inline": "--ui-space-2",
                "blockEnd": "--ui-space-2",
            },
        )

    def test_component_library_exposes_prompt_and_input_media_variants(self):
        self.assertIn(
            "['ic-mention-picker', 'Mention Picker · 提示词', 'menu-popover', 'ic-mention-picker-prompt']",
            self.surface_app,
        )
        self.assertIn(
            "['ic-mention-picker', 'Mention Picker · 输入图', 'menu-popover', 'ic-mention-picker-media']",
            self.surface_app,
        )
        self.assertIn('data-copy-value="ic-mention-picker-prompt"', self.case)
        self.assertIn('data-copy-value="ic-mention-picker-media"', self.case)
        self.assertIn('id="mention-media-picker"', self.case)
        self.assertIn("{value:'canvas',label:label('当前画布','Canvas')}", self.case)
        self.assertIn("{value:'assets',label:label('资产库','Asset Library')}", self.case)
        self.assertIn("mentionMediaPicker.items=mentionMediaSources.canvas", self.case)
        self.assertIn("mentionMediaPicker.addEventListener('ic-tab-change'", self.case)
        self.assertIn("media:{kind:'image'", self.case)
        self.assertIn("media:{kind:'video'", self.case)
        self.assertIn("media:{kind:'audio'", self.case)
        self.assertNotIn("mention-scroll-picker", self.case)

    def test_smart_canvas_consumes_the_public_mention_picker(self):
        self.assertIn('<ic-mention-picker id="mentionPicker"', self.smart_canvas_html)
        prompt_row_start = self.smart_canvas_html.index('<div class="prompt-row prompt-editor-shell">')
        prompt_row_end = self.smart_canvas_html.index("</div>", prompt_row_start)
        self.assertNotIn(
            '<ic-mention-picker id="mentionPicker"',
            self.smart_canvas_html[prompt_row_start:prompt_row_end],
        )
        composer_end = self.smart_canvas_html.index(
            '        <ic-mention-picker id="mentionPicker"'
        )
        self.assertGreater(composer_end, prompt_row_end)
        self.assertIn("mentionPicker.items =", self.smart_canvas_js)
        self.assertIn("mentionPicker.show(", self.smart_canvas_js)
        self.assertIn("mentionPicker.addEventListener('ic-select'", self.smart_canvas_js)
        self.assertNotIn("mentionPicker.innerHTML =", self.smart_canvas_js)
        self.assertNotIn("positionMentionPickerAtContainer", self.smart_canvas_js)
        self.assertNotIn(".mention-picker {", self.smart_canvas_css)

    def test_smart_canvas_switches_only_fullscreen_editors_to_bottom_overlay(self):
        presentation_start = self.smart_canvas_js.index(
            "function promptQuickPickerPresentation"
        )
        presentation_end = self.smart_canvas_js.index(
            "function maybeOpenMentionPicker", presentation_start
        )
        presentation = self.smart_canvas_js[presentation_start:presentation_end]
        self.assertIn("composer?.classList.contains('focused')", presentation)
        self.assertIn("editor?.closest?.('.prompt-node-focus-surface')", presentation)
        self.assertIn("{anchor:editor, placement:'overlay-block-end'}", presentation)
        self.assertIn(
            "{anchor:promptQuickPickerContainer(editor), placement:'block-start'}",
            presentation,
        )
        self.assertEqual(
            self.smart_canvas_js.count("placement:presentation.placement"), 2
        )


if __name__ == "__main__":
    unittest.main()
