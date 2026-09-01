import unittest
import json
import subprocess
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasAnnotationUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.smart_page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.smart_style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.smart_script = read_smart_canvas_scripts(ROOT)
        cls.block_styles = (ROOT / "static/js/infinite-canvas-ui/blocks/styles.js").read_text(encoding="utf-8")
        cls.selection_component = (ROOT / "static/js/infinite-canvas-ui/selection-adjustment/switch.js").read_text(encoding="utf-8")
        cls.selection_styles = (ROOT / "static/js/infinite-canvas-ui/selection-adjustment/styles.js").read_text(encoding="utf-8")
        cls.classic_page = (ROOT / "static/canvas.html").read_text(encoding="utf-8")

    def test_toolbar_is_on_smart_canvas_only(self):
        self.assertIn('id="smartCanvasDock"', self.smart_page)
        self.assertIn('id="smartPointerTool"', self.smart_page)
        self.assertIn('id="smartBrushTool"', self.smart_page)
        self.assertIn('id="smartTextTool"', self.smart_page)
        self.assertNotIn('id="smartCanvasDock"', self.classic_page)
        self.assertNotIn('id="canvasAnnotationPreview"', self.classic_page)

    def test_toolbar_groups_are_separated_in_figma_order(self):
        pointer = self.smart_page.index('id="smartPointerTool"')
        brush = self.smart_page.index('id="smartBrushTool"')
        text = self.smart_page.index('id="smartTextTool"')
        divider = self.smart_page.index('class="smart-canvas-dock-divider"')
        logs = self.smart_page.index('id="smartLogToggle"')
        settings = self.smart_page.index('id="smartSettingsToggle"')
        self.assertLess(pointer, brush)
        self.assertLess(brush, text)
        self.assertLess(text, divider)
        self.assertLess(divider, logs)
        self.assertLess(logs, settings)
        self.assertNotIn('id="smartNodeTransferToggle"', self.smart_page)
        self.assertNotIn('id="smartShortcutToggle"', self.smart_page)

    def test_every_dock_icon_has_a_tooltip(self):
        for tooltip in ("指针", "抓手", "画笔", "文字", "分区", "日志", "提示词模板", "资产库", "设置"):
            self.assertIn(f'label="{tooltip}"', self.smart_page)
        for shortcut in ("V", "H", "P", "T", "Shift+S"):
            self.assertIn(f'shortcut="{shortcut}"', self.smart_page)
        self.assertNotIn('data-tooltip=', self.smart_page[self.smart_page.index('id="smartCanvasDock"'):self.smart_page.index('</ic-toolbar>')])
        self.assertNotIn(".smart-canvas-dock-btn:hover::before", self.smart_style)

    def test_dock_position_is_inside_toolbar_settings_panel(self):
        settings = self.smart_page.index('id="smartSettingsToggle"')
        settings_panel = self.smart_page.index('id="smartSettingsPanel"')
        position = self.smart_page.index('id="smartCanvasDockPositionControl"')
        dock_end = self.smart_page.index('</ic-toolbar>', settings)
        self.assertLess(settings, settings_panel)
        self.assertLess(settings_panel, position)
        self.assertLess(position, dock_end)
        self.assertNotIn('id="smartCanvasDockPositionToggle"', self.smart_page)
        self.assertNotIn('id="assetToggle"', self.smart_page)
        self.assertIn('aria-controls="smartSettingsPanel"', self.smart_page)
        self.assertIn('<ic-tabs id="smartCanvasDockPositionControl"', self.smart_page)
        self.assertIn('data-component-name="ic-tabs-small"', self.smart_page)
        self.assertIn('size="small" orientation="horizontal" activation="automatic"', self.smart_page)
        self.assertIn('data-legal-combination="horizontal-automatic-label"', self.smart_page)
        self.assertIn('<button type="button" data-value="bottom" data-i18n="smart.dockBottom">底部</button>', self.smart_page)
        self.assertIn('<button type="button" data-value="left" data-i18n="smart.dockLeft">左侧</button>', self.smart_page)
        self.assertIn('id="smartImagePerformanceToggle"', self.smart_page)
        self.assertEqual(self.smart_page.count('class="smart-canvas-setting-switch"'), 1)
        panel = self.smart_page.split('id="smartSettingsPanel"', 1)[1].split('</div>\n        </ic-smart-canvas-dock>', 1)[0]
        self.assertIn('id="smartShortcutSettingsAction"', panel)
        self.assertNotIn('id="smartNodeImportSettingsAction"', panel)
        self.assertEqual(panel.count('<ic-icon name="forward"'), 1)
        for heading in ('smart.canvasSection', 'smart.generationSection', 'smart.operationSection'):
            self.assertIn(f'data-i18n="{heading}"', panel)
        self.assertIn('data-component-name="ic-select-small"', panel)
        self.assertEqual(panel.count('data-component-name="ic-tabs-small"'), 2)
        self.assertIn('<option value="api" data-i18n="smart.engineApi" selected>', panel)

    def test_image_performance_setting_persists_and_switches_image_sources(self):
        self.assertIn("const SMART_IMAGE_PERFORMANCE_STORAGE_KEY = 'smartCanvasImagePerformanceOptimization'", self.smart_script)
        self.assertIn("localStorage.getItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY) !== 'off'", self.smart_script)
        self.assertIn("localStorage.setItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY, enabled ? 'on' : 'off')", self.smart_script)
        self.assertIn("const src = smartImagePerformanceOptimization ? preview : originalDisplay", self.smart_script)
        self.assertIn("if(!smartImagePerformanceOptimization)", self.smart_script)
        self.assertIn("smartImagePerformanceToggle?.addEventListener('change'", self.smart_script)
        self.assertIn("setSmartImagePerformanceOptimization(event.currentTarget.checked)", self.smart_script)

    def test_canvas_settings_use_icon_action_for_persisted_theme_preference(self):
        self.assertIn('id="smartCanvasThemeToggle"', self.smart_page)
        self.assertIn('<ic-icon-button id="smartCanvasThemeToggle"', self.smart_page)
        self.assertIn('icon="theme" label="切换深色模式" data-i18n-label="smart.switchToDarkTheme"', self.smart_page)
        self.assertIn('aria-labelledby="smartImagePerformanceLabel"', self.smart_page)
        image_switch = self.smart_page.split('<ic-switch id="smartImagePerformanceToggle"', 1)[1].split('</ic-switch>', 1)[0]
        self.assertNotIn('size=', image_switch)
        self.assertIn("smartCanvasThemeToggle?.addEventListener('click'", self.smart_script)
        self.assertIn("window.StudioTheme.set(theme)", self.smart_script)
        self.assertIn("smartCanvasThemeToggle.setAttribute('icon', dark ? 'light' : 'theme')", self.smart_script)
        self.assertIn("localStorage.setItem('studio_theme', theme)", self.smart_script)
        self.assertIn("localStorage.setItem('canvas_theme', theme)", self.smart_script)
        self.assertNotIn("function detachSmartCanvasThemeOwnedLabel()", self.smart_script)
        self.assertIn("if (this.hasAttribute('aria-labelledby'))", self.selection_component)
        self.assertIn("ic-switch[aria-labelledby]::part(label) {", self.selection_styles)
        self.assertIn("margin-inline-start: 0", self.selection_styles)
        self.assertNotIn(".smart-canvas-setting-switch > [data-ic-owned-label]", self.smart_style)

    def test_image_performance_settings_panel_has_visible_open_and_switch_states(self):
        self.assertIn(".smart-canvas-settings-panel {", self.smart_style)
        self.assertIn(".smart-canvas-settings-panel.open", self.smart_style)
        self.assertIn('<ic-switch id="smartImagePerformanceToggle"', self.smart_page)
        self.assertNotIn('class="smart-settings-switch"', self.smart_page)
        self.assertIn('label="设置" data-i18n-label="common.settings"', self.smart_page)

    def test_canvas_speed_settings_are_persisted_and_applied(self):
        self.assertIn('id="smartCanvasZoomSpeed"', self.smart_page)
        self.assertIn('id="smartCanvasPanSpeed"', self.smart_page)
        self.assertIn("SMART_CANVAS_ZOOM_SPEED_STORAGE_KEY", self.smart_script)
        self.assertIn("SMART_CANVAS_PAN_SPEED_STORAGE_KEY", self.smart_script)
        self.assertIn("setSmartCanvasInteractionSpeed('zoom'", self.smart_script)
        self.assertIn("setSmartCanvasInteractionSpeed('pan'", self.smart_script)
        self.assertIn("const sensitivity = 0.0016;", self.smart_script)
        self.assertIn("macMultiplier * smartCanvasZoomSpeed", self.smart_script)
        self.assertIn("Number(e.deltaY || 0) * smartCanvasPanSpeed", self.smart_script)
        self.assertEqual(self.smart_page.count('<ic-slider id="smartCanvas'), 2)
        self.assertIn('class="smart-canvas-settings-slider"', self.smart_page)
        self.assertIn('.smart-canvas-settings-slider { width:8rem; flex:0 0 8rem; }', self.smart_style)
        self.assertIn('size="s" min="50" max="200" step="10" value="100" value-text="1×"', self.smart_page)
        self.assertIn("function syncSmartCanvasSpeedControl", self.smart_script)
        self.assertIn("input.setAttribute('value-text'", self.smart_script)
        self.assertNotIn("--smart-range-progress", self.smart_script)
        self.assertNotIn('type="range"', self.smart_page)
        self.assertEqual(self.smart_page.count('<output id="smartCanvas'), 2)
        self.assertIn("if(output) output.textContent = `${multiplier}×`", self.smart_script)

    def test_settings_menu_matches_dropdown_command_density_and_keeps_simplification_on(self):
        panel_rule = self.smart_style.split(".smart-canvas-settings-panel { box-sizing", 1)[1].split("}", 1)[0]
        self.assertIn("width:21.5rem", panel_rule)
        self.assertIn("padding:var(--ui-space-0)", panel_rule)
        self.assertIn("border-radius:var(--ui-radius-m)", panel_rule)
        self.assertIn("background:var(--ui-color-surface)", panel_rule)
        self.assertIn("box-shadow:var(--ui-shadow-overlay)", panel_rule)
        for description in (
            "smart.dockPositionDesc",
            "smart.generationEngineDesc",
            "smart.darkThemeDesc",
            "smart.imagePerformanceDesc",
            "smartImagePerformanceDescription",
        ):
            self.assertNotIn(description, self.smart_page)
        self.assertIn(
            ".smart-canvas-settings-copy { min-width:0; flex:1 1 auto; display:flex; flex-direction:column; align-items:flex-start; gap:var(--ui-space-1); }",
            self.smart_style,
        )
        self.assertIn(
            ".smart-canvas-settings-copy > span { color:var(--ui-color-text-tertiary); font-size:var(--ui-font-size-2);",
            self.smart_style,
        )
        self.assertIn(
            ".smart-canvas-settings-body { min-height:0; overflow:auto; padding:var(--ui-space-0) var(--ui-space-3); }",
            self.smart_style,
        )
        self.assertIn(
            ".smart-canvas-settings-section-heading { margin:var(--ui-space-2) var(--ui-space-2) var(--ui-space-0); }",
            self.smart_style,
        )
        self.assertEqual(self.smart_page.count('class="smart-canvas-settings-section"'), 3)
        panel = self.smart_page.split('id="smartSettingsPanel"', 1)[1].split('</div>\n        </ic-smart-canvas-dock>', 1)[0]
        self.assertNotIn('smart.zoomSpeedDesc', panel)
        self.assertNotIn('smart.panSpeedDesc', panel)
        self.assertNotIn('id="smartFarModeToggle"', self.smart_page)
        self.assertNotIn('id="smartFarModeThreshold"', self.smart_page)
        self.assertNotIn("SMART_CANVAS_FAR_MODE_STORAGE_KEY", self.smart_script)
        self.assertNotIn("SMART_CANVAS_FAR_THRESHOLD_STORAGE_KEY", self.smart_script)
        self.assertIn("canvasLevelOfDetail.configure({\n    enabled:true", self.smart_script)

    def test_adaptive_preview_resolution_matches_rendered_pixels(self):
        module_path = ROOT / "static/js/smart-image-resolution.js"
        script = f"""
            const resolution = require({json.dumps(str(module_path))});
            const cases = [
                resolution.choosePreviewSize({{width:240, height:180, canvasScale:1, devicePixelRatio:2}}),
                resolution.choosePreviewSize({{width:320, height:180, canvasScale:1.5, devicePixelRatio:2}}),
                resolution.choosePreviewSize({{width:600, height:400, canvasScale:2, devicePixelRatio:2}})
            ];
            process.stdout.write(JSON.stringify(cases));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [512, 1024, 2048])

    def test_adaptive_preview_resolution_uses_hysteresis_near_boundaries(self):
        module_path = ROOT / "static/js/smart-image-resolution.js"
        script = f"""
            const resolution = require({json.dumps(str(module_path))});
            const choose = requiredPixels => resolution.choosePreviewSize({{
                width:requiredPixels,
                height:1,
                canvasScale:1,
                devicePixelRatio:1,
                currentSize:512
            }});
            const holdHigh = resolution.choosePreviewSize({{
                width:500,
                height:1,
                canvasScale:1,
                devicePixelRatio:1,
                currentSize:1024
            }});
            process.stdout.write(JSON.stringify([choose(540), choose(600), holdHigh]));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [512, 1024, 1024])

    def test_canvas_recomputes_adaptive_image_sources_after_viewport_changes(self):
        adaptive_script = '/static/js/smart-image-resolution.js'
        canvas_script = '/static/js/smart-canvas.js'
        self.assertLess(self.smart_page.index(adaptive_script), self.smart_page.index(canvas_script))
        self.assertIn("SmartImageResolution.choosePreviewSize({", self.smart_script)
        self.assertIn("width:img.offsetWidth || img.clientWidth", self.smart_script)
        self.assertIn("canvasScale:viewport.scale", self.smart_script)
        self.assertIn("devicePixelRatio:window.devicePixelRatio || 1", self.smart_script)
        self.assertIn("smartMediaPreviewUrl(original, targetSize)", self.smart_script)
        self.assertIn("scheduleSmartAdaptiveImageResolution();", self.smart_script)
        self.assertNotIn("SMART_SELECTED_HIGH_RES_DELAY", self.smart_script)

    def test_pointer_mode_shortcuts_and_custom_cursors_are_wired(self):
        self.assertIn("(key === 'v' || key === 'h')", self.smart_script)
        self.assertIn("(key === 'p' || key === 't')", self.smart_script)
        self.assertIn("activateSmartAnnotationTool(key === 'p' ? 'brush' : 'text')", self.smart_script)
        self.assertGreaterEqual(
            self.smart_script.count("focusSmartCanvasAfterToolShortcut();"),
            2,
        )
        self.assertIn(
            "smartCanvasDock?.classList.add('suppress-shortcut-hover')",
            self.smart_script,
        )
        self.assertIn(
            "ic-smart-canvas-dock.suppress-shortcut-hover",
            self.block_styles,
        )
        activate_start = self.smart_script.index("function activateSmartAnnotationTool")
        activate_end = self.smart_script.index("\nfunction deactivateSmartAnnotationTool", activate_start)
        activate = self.smart_script[activate_start:activate_end]
        self.assertIn("smartAnnotationOptionsOpen = true;", activate)
        self.assertIn("setSmartBaseTool(next, {keepOptions:true})", activate)
        self.assertIn("smartPointerTool?.addEventListener('click'", self.smart_script)
        self.assertIn('id="smartAnnotationCursor"', self.smart_page)
        self.assertIn('class="smart-annotation-brush-cursor-icon"', self.smart_page)
        self.assertIn(".smart-annotation-brush-cursor-shape { fill:#fff; stroke:#111827", self.smart_style)
        self.assertIn("smartAnnotationCursorSymbol.textContent = textActive ? '+'", self.smart_script)
        self.assertIn("smartAnnotationCursorLabel.textContent = textActive ? tr('smart.annotationAdd')", self.smart_script)
        self.assertIn("shell.addEventListener('mousemove', updateSmartAnnotationCursor, true)", self.smart_script)
        self.assertIn("body.smart-annotation-text .shell { cursor:none; }", self.smart_style)
        self.assertIn("width:18px; height:18px", self.smart_style)

    def test_brush_and_text_quick_options_are_present(self):
        for size in ("3", "6", "10"):
            self.assertIn(f'data-smart-brush-size="{size}"', self.smart_page)
        for color in ("#111827", "#ef4444", "#f59e0b", "#3b82f6", "#22c55e"):
            self.assertIn(f'data-smart-brush-color="{color}"', self.smart_page)
        for size in ("small", "medium", "large"):
            self.assertIn(f'data-smart-text-size="{size}"', self.smart_page)

    def test_annotation_nodes_are_backgroundless_and_borderless(self):
        self.assertIn(".image-node.smart-annotation-node", self.smart_style)
        self.assertIn("border:var(--ui-border-width-none) !important", self.smart_style)
        self.assertIn("background:transparent !important", self.smart_style)
        annotation_start = self.smart_style.index(".image-node.smart-annotation-node,")
        annotation_rule = self.smart_style[
            annotation_start : self.smart_style.index("}", annotation_start) + 1
        ]
        self.assertIn("box-shadow:var(--ui-shadow-none)", annotation_rule)
        self.assertNotIn("box-shadow:var(--ui-shadow-raised)", annotation_rule)
        self.assertIn(
            ".image-node:hover:not(.smart-group-node):not(.smart-frame-node):not(.smart-annotation-node)",
            self.smart_style,
        )
        self.assertIn('.smart-canvas-text[contenteditable="true"]', self.smart_style)
        self.assertIn("background:transparent", self.smart_style)

    def test_offscreen_images_are_reduced_to_the_smallest_preview(self):
        helper_start = self.smart_script.index("function smartImageNearViewport")
        helper_end = self.smart_script.index(
            "\nfunction preloadSmartAdaptivePreview", helper_start
        )
        helper = self.smart_script[helper_start:helper_end]
        script = f"""
            const SMART_ADAPTIVE_VIEWPORT_MARGIN = 256;
            {helper}
            const shell = {{
                getBoundingClientRect() {{
                    return {{left:0,top:0,right:1000,bottom:700,width:1000,height:700}};
                }}
            }};
            const image = rect => ({{getBoundingClientRect:() => rect}});
            process.stdout.write(JSON.stringify([
                smartImageNearViewport(image({{left:100,top:100,right:300,bottom:300}})),
                smartImageNearViewport(image({{left:1400,top:100,right:1600,bottom:300}}))
            ]));
        """
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [True, False])
        adaptive_start = self.smart_script.index(
            "function refreshSmartAdaptiveImageResolution"
        )
        adaptive_end = self.smart_script.index(
            "\nfunction scheduleSmartAdaptiveImageResolution", adaptive_start
        )
        adaptive = self.smart_script[adaptive_start:adaptive_end]
        self.assertIn(": 512", adaptive)

    def test_annotations_use_smart_node_selection_move_and_delete_flow(self):
        self.assertIn(
            "node?.type === 'smart-brush' || nodeKinds.isTextAnnotation(node)",
            self.smart_script,
        )
        self.assertIn("shell.addEventListener('mousedown', beginSmartAnnotationPointer, true)", self.smart_script)
        self.assertIn("if(isSmartAnnotationNode(nodeForControls)) bindSmartAnnotationNodeControls", self.smart_script)
        self.assertNotIn("node-delete", self.smart_script)
        self.assertIn("el.onmousedown = beginNodeDrag", self.smart_script)

    def test_brush_and_text_tools_take_priority_over_canvas_nodes(self):
        helper_start = self.smart_script.index("function smartAnnotationIgnoredTarget")
        helper_end = self.smart_script.index("\nfunction beginSmartAnnotationPointer", helper_start)
        helper = self.smart_script[helper_start:helper_end]
        script = f"""
            function smartCanvasChromeTarget(candidate) {{
                return Boolean(candidate?.closest?.('canvas-chrome'));
            }}
            {helper}
            function target(editing = false, blocked = false) {{
                return {{
                    closest(selector) {{
                        if(selector === '[contenteditable="true"]') return editing ? {{}} : null;
                        return blocked ? {{}} : null;
                    }}
                }};
            }}
            process.stdout.write(JSON.stringify([
                smartAnnotationIgnoredTarget(target()),
                smartAnnotationIgnoredTarget(target(false, true)),
                smartAnnotationIgnoredTarget(target(true, false))
            ]));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [False, True, True])
        self.assertNotIn(".image-node", helper)
        self.assertIn("body.smart-annotation-brush .image-node", self.smart_style)
        self.assertIn("body.smart-annotation-text .image-node", self.smart_style)

    def test_brush_tool_draws_through_existing_brush_marks(self):
        self.assertIn(
            "body.smart-annotation-brush .smart-brush-mark path",
            self.smart_style,
        )
        self.assertIn(
            "pointer-events:none !important",
            self.smart_style[
                self.smart_style.index(
                    "body.smart-annotation-brush .smart-brush-mark path"
                ):
                self.smart_style.index(
                    "body.smart-annotation-brush .smart-brush-mark path"
                ) + 180
            ],
        )

    def test_annotations_created_inside_frames_join_frame_membership(self):
        brush_start = self.smart_script.index("function finishSmartAnnotationStroke")
        brush_end = self.smart_script.index("\nfunction beginSmartTextAnnotationEdit", brush_start)
        text_start = self.smart_script.index("function createSmartTextAnnotation")
        text_end = self.smart_script.index("\nfunction smartAnnotationIgnoredTarget", text_start)
        self.assertIn("smartContainer.reconcileFrames();", self.smart_script[brush_start:brush_end])
        self.assertIn("smartContainer.reconcileFrames();", self.smart_script[text_start:text_end])

    def test_selected_annotations_have_a_four_corner_selection_box(self):
        self.assertIn('class="smart-annotation-selection"', self.smart_script)
        for corner in ("nw", "ne", "se", "sw"):
            self.assertIn(f'data-corner="{corner}"', self.smart_script)
        self.assertIn(".smart-annotation-node.selected .smart-annotation-selection", self.smart_style)
        self.assertIn(
            ".smart-annotation-selection span { --smart-selection-handle-scale:var(--smart-selection-handle-inverse-scale, 1);",
            self.smart_style,
        )
        self.assertIn(
            "box-sizing:border-box; width:12px; height:12px;",
            self.smart_style,
        )
        self.assertIn(
            "border:var(--ui-border-width-thin) solid var(--ui-color-border-focus);",
            self.smart_style,
        )
        self.assertIn("box-shadow:var(--ui-shadow-none);", self.smart_style)
        self.assertIn(
            "scale(var(--smart-selection-handle-scale))",
            self.smart_style,
        )
        self.assertNotIn(".theme-dark .smart-annotation-selection", self.smart_style)
        self.assertIn(".image-node.smart-annotation-node.selected { z-index:22;", self.smart_style)

    def test_new_text_annotations_show_a_collapsed_blinking_caret(self):
        edit_start = self.smart_script.index("function beginSmartTextAnnotationEdit")
        edit_end = self.smart_script.index("\nfunction createSmartTextAnnotation", edit_start)
        create_start = edit_end + 1
        create_end = self.smart_script.index("\nfunction smartAnnotationIgnoredTarget", create_start)
        self.assertIn("if(options.selectAll === false) range.collapse(false);", self.smart_script[edit_start:edit_end])
        self.assertIn("text:''", self.smart_script[create_start:create_end])
        self.assertIn("beginSmartTextAnnotationEdit(nodeId, {selectAll:false})", self.smart_script)
        self.assertIn("data-placeholder=\"${escapeAttr(tr('smart.annotationDefault'))}\"", self.smart_script)
        self.assertIn("caret-color:var(--ui-color-text-caret)", self.smart_style)
        empty_rule_start = self.smart_style.index(
            '.smart-canvas-text[contenteditable="true"]:empty {'
        )
        empty_rule_end = self.smart_style.index("}", empty_rule_start)
        self.assertIn(
            "caret-color:transparent",
            self.smart_style[empty_rule_start:empty_rule_end],
        )
        self.assertIn('.smart-canvas-text[contenteditable="true"]:empty::before', self.smart_style)
        self.assertIn("position:absolute", self.smart_style[
            self.smart_style.index(
                '.smart-canvas-text[contenteditable="true"]:empty::before'
            ):
            self.smart_style.index(
                '.smart-canvas-text[contenteditable="true"]:empty::before'
            ) + 260
        ])
        self.assertIn(
            '.smart-canvas-text[contenteditable="true"]:empty::after',
            self.smart_style,
        )
        self.assertIn("@keyframes smart-text-caret-blink", self.smart_style)
        self.assertIn("nodeEl?.classList.add('is-text-editing')", self.smart_script)
        self.assertIn(
            ".smart-text-node.is-text-editing .smart-annotation-selection",
            self.smart_style,
        )

    def test_text_annotation_immediately_returns_to_pointer_and_commits_on_enter_or_escape(self):
        create_start = self.smart_script.index(
            "function createSmartTextAnnotation"
        )
        create_end = self.smart_script.index(
            "\nfunction smartAnnotationIgnoredTarget",
            create_start,
        )
        create = self.smart_script[create_start:create_end]
        bind_start = self.smart_script.index(
            "function bindSmartAnnotationNodeControls"
        )
        bind_end = self.smart_script.index(
            "\nfunction bindNodeEvents",
            bind_start,
        )
        bind = self.smart_script[bind_start:bind_end]

        self.assertIn("setSmartBaseTool('pointer')", create)
        self.assertIn("event.key === 'Escape'", bind)
        self.assertIn(
            "event.key === 'Enter' && !event.shiftKey",
            bind,
        )
        self.assertIn("clearSelectedSmartTextAnnotation();", bind)
        self.assertNotIn("text.dataset.originalText", bind)

    def test_selected_text_options_float_above_the_single_text_node(self):
        portal = self.smart_page.index('id="smartNodeFloatingPortal"')
        options = self.smart_page.index('id="smartTextOptions"')
        dock = self.smart_page.index('id="smartCanvasDock"')
        self.assertLess(portal, options)
        self.assertLess(options, dock)
        self.assertIn(
            "function positionSmartTextOptionsForNode",
            self.smart_script,
        )
        self.assertIn(
            "smartTextOptions.classList.toggle('node-floating'",
            self.smart_script,
        )
        self.assertIn(
            ".smart-text-options.node-floating",
            self.smart_style,
        )
        shell_mousedown = self.smart_script[
            self.smart_script.index("shell.onmousedown = e => {"):
            self.smart_script.index("\nshell.oncontextmenu", self.smart_script.index("shell.onmousedown = e => {"))
        ]
        self.assertIn("smartCanvasChromeTarget(e.target)", shell_mousedown)
        self.assertNotIn(
            "e.target.closest('.smart-canvas-dock,.image-node",
            shell_mousedown,
        )


if __name__ == "__main__":
    unittest.main()
