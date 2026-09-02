import json
import subprocess
import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasFloatingUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.script = read_smart_canvas_scripts(ROOT)
        cls.node_component = (
            ROOT / "static/js/infinite-canvas-ui/nodes/shared.js"
        ).read_text(encoding="utf-8")
        cls.reference_thumbnail = (
            ROOT / "static/js/infinite-canvas-ui/file-media-input/reference-thumbnail.js"
        ).read_text(encoding="utf-8")
        cls.menu_popover = (
            ROOT / "static/js/infinite-canvas-ui/menu-popover.js"
        ).read_text(encoding="utf-8")

    def test_composer_and_toolbar_portal_are_outside_scaled_world(self):
        world = self.page.index('<div id="world" class="world"></div>')
        portal = self.page.index('id="smartNodeFloatingPortal"')
        composer = self.page.index('id="composer"')
        self.assertLess(world, portal)
        self.assertLess(portal, composer)
        self.assertNotIn("world.appendChild(composer", self.script)

    def test_floating_ui_uses_screen_coordinates(self):
        self.assertIn("const nodeLeft = viewport.x + rect.x * viewport.scale", self.script)
        self.assertIn("composer.style.top = `${nodeBottom + gap}px`", self.script)
        self.assertIn("positionCanvasFloatingOverlays()", self.script)
        self.assertIn(".smart-node-floating-portal.open", self.style)

    def test_prompt_generation_node_shares_prompt_selection_visual(self):
        self.assertIn(
            "const nodeRole = nodeKinds.roleOf(node)",
            self.script,
        )
        self.assertIn(
            "'prompt-generation': ['prompt-smart-node', 'prompt-generation-smart-node']",
            self.node_component,
        )
        self.assertIn(
            ".image-node.prompt-smart-node.selected",
            self.style,
        )
        self.assertIn(
            ".image-node.smart-group-member-node.prompt-smart-node.selected",
            self.style,
        )
        self.assertIn(
            ".theme-dark .image-node.prompt-smart-node.selected",
            self.style,
        )
        self.assertNotIn(
            ".prompt-smart-node:not(.prompt-generation-smart-node).selected",
            self.style,
        )
        self.assertNotIn(
            ".prompt-generation-smart-node:not(.selected):hover",
            self.style,
        )

    def test_composer_uses_compact_headerless_layout(self):
        composer_start = self.page.index('id="composer"')
        composer_end = self.page.index('id="inputTextPreviewTooltip"', composer_start)
        composer = self.page[composer_start:composer_end]
        settings_start = self.page.index('id="smartSettingsPanel"')
        settings_end = self.page.index("</ic-toolbar>", settings_start)
        settings_panel = self.page[settings_start:settings_end]

        self.assertNotIn('class="composer-head"', composer)
        self.assertNotIn('id="engineSelect"', composer)
        self.assertNotIn('id="cascadeRunBtn"', composer)
        self.assertIn('id="engineSelect"', settings_panel)
        self.assertLess(composer.index('id="apiKindToggle"'), composer.index('id="dynamicParams"'))
        self.assertIn(".composer { --ctrl-font:10.5px;", self.style)
        self.assertIn("width:48rem", self.style)
        self.assertIn("Math.min(48 * rootFontSize, shell.clientWidth - 28)", self.script)
        self.assertIn('<ic-icon-button id="composerFocusToggle"', composer)
        self.assertIn('size="s"', composer)
        self.assertIn('label="展开"', composer)
        self.assertIn('data-i18n-label="smart.focusEdit"', composer)
        self.assertIn('hierarchy="quiet"', composer)
        self.assertIn('data-action-combination="quiet-icon-action"', composer)
        self.assertNotIn('<button id="composerFocusToggle"', composer)
        self.assertNotIn("mode:'cascade'", self.script)

    def test_focused_composer_keeps_only_prompt_area_scrollable(self):
        self.assertIn(
            ".composer.focused .composer-card { height:100%; min-height:0; overflow:hidden;",
            self.style,
        )
        self.assertIn(
            ".composer.focused #promptInput { height:100% !important; max-height:none; min-height:0; overflow-y:auto; overscroll-behavior:contain; }",
            self.style,
        )
        self.assertIn(
            ".composer.focused .prompt-row { min-height:0; height:100%; align-self:stretch;",
            self.style,
        )
        self.assertIn(
            ".composer.focused .param-row,.composer.focused .composer-actions",
            self.style,
        )
        focused_footer = self.style.split(
            ".composer.focused .param-row,.composer.focused .composer-actions",
            1,
        )[1].split("}", 1)[0]
        self.assertNotIn("background:", focused_footer)
        self.assertNotIn("--ui-color-surface-subtle", focused_footer)
        self.assertIn(
            ".composer.focused .param-row { margin-left:-10px; border:var(--ui-border-width-none);",
            self.style,
        )
        self.assertIn(
            ".composer.focused .composer-actions { margin-right:-10px; border:var(--ui-border-width-none);",
            self.style,
        )

    def test_add_reference_button_is_last_thumbnail_and_matches_its_size(self):
        start = self.script.index("function renderInputThumbsRow")
        end = self.script.index("\nfunction showInputTextPreviewTooltip", start)
        render_thumbs = self.script[start:end]
        self.assertIn("${thumbsHtml}${textThumbsHtml}${addButton}", render_thumbs)
        self.assertIn('<div class="input-thumb-list empty">${addButton}</div>', render_thumbs)
        self.assertNotIn("input-thumb-actions", render_thumbs)
        self.assertIn(".input-thumb-add { width:45px; height:45px; flex:0 0 45px;", self.style)
        self.assertIn("border:var(--ui-border-width-thin) dashed", self.style)
        self.assertIn(".input-thumb-add:hover { background:var(--ui-color-action-tertiary-hover);", self.style)
        self.assertIn(".input-thumb-add:focus-visible { background:var(--ui-color-action-tertiary-hover);", self.style)
        self.assertIn("border-color:var(--ui-color-border-focus)", self.style)

    def test_composer_preview_labels_and_template_button_have_paired_colors(self):
        self.assertIn(
            "ic-reference-thumbnail .input-thumb-label",
            self.reference_thumbnail,
        )
        self.assertIn("background: var(--ui-color-surface-canvas)", self.reference_thumbnail)
        self.assertIn("color: var(--ui-color-text-secondary)", self.reference_thumbnail)

    def test_composer_uses_medium_radius_in_default_and_focused_layouts(self):
        self.assertIn(".composer-card {", self.style)
        self.assertIn("border-radius:var(--ui-radius-m)", self.style)
        self.assertIn(
            "border-radius:var(--ui-radius-none) var(--ui-radius-none) var(--ui-radius-none) var(--ui-radius-m)",
            self.style,
        )
        self.assertIn(
            "border-radius:var(--ui-radius-none) var(--ui-radius-none) var(--ui-radius-m) var(--ui-radius-none)",
            self.style,
        )

    def test_dark_image_studio_controls_use_dark_surfaces(self):
        self.assertIn(
            ".image-edit-dialog { --ic-dialog-backdrop-color:var(--ui-color-backdrop);",
            self.style,
        )
        self.assertNotIn("--ic-dialog-backdrop-color:color-mix", self.style)
        self.assertIn(
            ".image-edit-dialog::part(header)",
            self.style,
        )
        self.assertIn(
            '<ic-icon-button id="previewGroupPrevBtn"',
            self.page,
        )
        self.assertIn('<ic-button id="compareToggleBtn"', self.page)
        self.assertNotIn(".theme-dark .compare-toggle", self.style)
        self.assertNotIn(".theme-dark .preview-nav-btn", self.style)
        self.assertIn(
            ".composer-template-btn::part(base) { "
            "color:var(--ui-color-text-primary);",
            self.style,
        )

    def test_legacy_generation_output_gallery_layout_is_removed(self):
        for legacy in (
            'class="generation-output-count"',
            'class="generation-output-carousel"',
            'class="generation-output-page"',
            "data-generation-output-open",
            "generationOutputGalleryLayout",
            ".generation-output-active",
            ".generation-output-thumb",
        ):
            with self.subTest(legacy=legacy):
                self.assertNotIn(legacy, self.script)
                self.assertNotIn(legacy, self.style)

    def test_pending_output_skeletons_explain_their_state(self):
        self.assertIn("function generationPendingNodeHtml", self.script)
        self.assertIn("function generationPendingNodeKind", self.script)
        self.assertIn("<ic-generation-pending", self.script)
        self.assertIn("tr('smart.imageGenerating')", self.script)
        self.assertIn("tr('smart.videoGenerating')", self.script)
        self.assertIn("tr('smart.textGenerating')", self.script)
        self.assertNotIn(".loading-skeleton {", self.style)

    def test_run_timer_pill_consumes_the_approved_status_badge(self):
        start = self.style.index(".run-time-pill {")
        end = self.style.index("}", start)
        rule = self.style[start:end]

        self.assertIn('<ic-badge class="run-time-pill image-name-badge image-name-badge-outside${cls}"', self.script)
        self.assertIn('kind="status"', self.script)
        self.assertIn('data-component-name="ic-badge-node-runtime-status"', self.script)
        self.assertNotIn('<span class="run-time-pill${cls}"', self.script)
        self.assertIn("pointer-events:none", rule)
        self.assertIn(".image-name-badge.image-name-badge-outside { left:0; top:-20px;", self.style)
        self.assertIn(".run-time-pill::part(base)", self.style)
        self.assertIn(
            '.run-time-pill[data-run-timer-state="running"]::part(base) { color:var(--ui-color-text-secondary); }',
            self.style,
        )
        self.assertIn("runTimePillText(node)", self.script)

    def test_every_input_thumbnail_has_hover_remove_action(self):
        self.assertIn('class="input-thumb-remove"', self.reference_thumbnail)
        self.assertIn('<ic-icon name="close" size="x-small" aria-hidden="true"></ic-icon>', self.reference_thumbnail)
        self.assertIn("requestRemove()", self.reference_thumbnail)
        self.assertIn("new CustomEvent('ic-remove'", self.reference_thumbnail)
        self.assertIn('ic-reference-thumbnail:hover .input-thumb-remove', self.reference_thumbnail)
        self.assertIn('ic-reference-thumbnail:focus-within .input-thumb-remove', self.reference_thumbnail)
        self.assertIn("opacity: 0", self.reference_thumbnail)
        self.assertIn("pointer-events: none", self.reference_thumbnail)
        self.assertNotIn(".input-thumb-remove {", self.style)

    def test_generated_result_preview_uses_the_prompt_authoring_recipe(self):
        self.assertIn(
            "const authoring = node ? promptAuthoring.resolve({node})",
            self.script,
        )
        self.assertIn("const dedup = authoring.refs || []", self.script)
        self.assertIn(
            "['recipeSourceRefs','runInputRefs','runPromptRefs']",
            self.script,
        )

    def test_input_thumbnail_matches_figma_card_and_single_item_does_not_scroll(self):
        self.assertIn("inline-size: 45px", self.reference_thumbnail)
        self.assertIn("block-size: 45px", self.reference_thumbnail)
        self.assertIn('ic-reference-thumbnail:hover', self.reference_thumbnail)
        self.assertIn("background: var(--ui-color-action-tertiary-hover)", self.reference_thumbnail)
        self.assertIn("block-size: 14px", self.reference_thumbnail)
        self.assertIn("background:var(--ui-color-action-primary)", self.style)
        self.assertIn("trf('smart.mediaNumber'", self.script)
        self.assertIn("totalInputCount > 1 ? 'is-scrollable' : 'is-single'", self.script)
        self.assertIn(".input-thumb-list { display:flex; flex:1 1 auto;", self.style)
        self.assertIn("overflow:hidden; padding:var(--ui-space-0)", self.style)
        self.assertIn(".input-thumb-list.is-scrollable { overflow-x:auto;", self.style)
        self.assertIn("border: var(--ui-border-width-thin) solid var(--ui-color-border-primary)", self.reference_thumbnail)
        self.assertIn("ic-reference-thumbnail.input-self", self.reference_thumbnail)

    def test_upstream_text_uses_figma_icon_card_inside_input_thumb_list(self):
        self.assertNotIn('id="inputPromptPreview"', self.page)
        self.assertNotIn("input-prompt-preview-text", self.style)
        self.assertNotIn("function renderInputPromptPreview", self.script)
        self.assertIn("function composerTextReferenceNodesFor", self.script)
        self.assertIn('<ic-reference-thumbnail class="input-text-reference" kind="text"', self.script)
        self.assertIn('name="square-text"', self.reference_thumbnail)
        self.assertIn("const label = trf('smart.textNumber', {number: index + 1})", self.script)
        self.assertIn("${thumbsHtml}${textThumbsHtml}", self.script)
        self.assertIn('ic-reference-thumbnail[data-kind="text"]', self.reference_thumbnail)
        self.assertIn("ic-reference-thumbnail .ic-reference-thumbnail__kind", self.reference_thumbnail)

    def test_text_input_thumb_can_disconnect_its_upstream_reference(self):
        self.assertIn("data-input-remove-text-reference", self.script)
        self.assertIn("function removeTextInputReferenceFromSelectedNode", self.script)
        self.assertIn("canvasMutation.disconnect({indexes:connectionIndexes})", self.script)
        self.assertIn(
            "node.inputNodeIds = node.inputNodeIds.filter(id => id !== sourceNodeId)",
            self.script,
        )

    def test_text_input_thumb_uses_public_tooltip_on_focus(self):
        self.assertIn('<ic-tooltip id="inputTextPreviewTooltip"', self.page)
        self.assertIn('placement="block-start"', self.page)
        self.assertIn('data-text-preview="${escapeAttr(preview)}"', self.script)
        self.assertIn("function showInputTextPreviewTooltip", self.script)
        self.assertIn("inputTextPreviewTooltip.setAttribute('content', text)", self.script)
        self.assertIn("inputTextPreviewTooltip.show(anchor)", self.script)
        self.assertIn("inputTextPreviewTooltip?.hide?.('programmatic')", self.script)
        self.assertNotIn("function positionInputTextPreviewTooltip", self.script)
        self.assertNotIn('aria-describedby="inputTextPreviewTooltip"', self.script)
        self.assertIn(".input-text-preview-tooltip::part(surface)", self.style)
        self.assertIn("max-width:min(300px, calc(100vw - 20px))", self.style)
        self.assertNotIn(".input-text-preview-tooltip.open", self.style)

    def test_input_thumbnail_drag_persists_target_specific_order(self):
        self.assertIn("el.draggable = items.length > 1 && Boolean(key)", self.script)
        self.assertIn("currentNode.inputRefOrder = [...nextVisible", self.script)
        self.assertIn("orderReferenceImagesForNode(node", self.script)
        self.assertIn("renderInputThumbsRow(currentNode)", self.script)

    def test_selected_catalog_model_uses_the_public_select_contract(self):
        self.assertIn('class="catalog-model-select"', self.script)
        self.assertIn('data-component-variant="model-picker"', self.script)
        self.assertIn('data-smart-select-param="model"', self.script)
        self.assertNotIn('.catalog-model-control .direct-option', self.style)

    def test_compact_model_popovers_show_vendor_icons(self):
        self.assertIn("function smartModelVendorIcon(model='', providerId='', providerName='')", self.script)
        self.assertIn("window.ModelVendorIcons?.resolve(model, providerId, providerName)", self.script)
        self.assertIn("/static/images/providers/chatgpt.svg", self.script)
        self.assertIn("/static/images/providers/gemini.svg", self.script)
        self.assertIn("/static/images/providers/midjourney.svg", self.script)
        self.assertIn("if (/mid[-_ ]?journey/.test(value)) return 'midjourney';", self.script)
        self.assertIn("/static/images/providers/modelscope.gif", self.script)
        self.assertIn("smartModelVendorOptionAttributes(entry.model, entry.provider_id, entry.provider_name)", self.script)
        self.assertIn("smartModelVendorIconMarkup(current?.model || model, current?.provider_id || providerId, current?.provider_name)", self.script)
        self.assertIn(".dynamic-params .model-vendor-icon { width:18px;", self.style)
        self.assertIn(".theme-dark .dynamic-params .model-vendor-icon img[data-monochrome=\"true\"]", self.style)

    def test_generation_settings_picker_replaces_legacy_hover_popover(self):
        self.assertIn("<ic-generation-settings-picker", self.script)
        for legacy in (
            ".size-picker-control",
            ".size-picker-option",
            ".smart-control.pinned",
            ".smart-popover::after",
            "if(!wasPinned) ctrl.classList.add('pinned')",
        ):
            self.assertNotIn(legacy, self.style + self.script)

    def test_hover_popovers_only_bridge_the_visible_control_to_an_open_panel(self):
        self.assertNotIn(
            '.smart-control::before { content:""; position:absolute; left:-6px; '
            'right:-6px; bottom:100%; height:var(--ui-control-height-xs); '
            'display:block; pointer-events:auto; }',
            self.style,
        )
        self.assertNotIn('.smart-popover::after', self.style)
        self.assertNotIn(".loop-number-control::before", self.style)
        self.assertNotIn(".loop-number-popover { position:absolute", self.style)
        self.assertIn('<ic-popover class="loop-number-popover"', self.script)
        self.assertIn("control?.addEventListener('mouseenter', showPopover)", self.script)
        self.assertIn("control?.addEventListener('mouseleave', hidePopover)", self.script)

    def test_default_text_node_requires_double_click_before_editing(self):
        start = self.script.index("function promptNodeBodyHtml")
        end = self.script.index("function splitterNodeBodyHtml", start)
        function_source = self.script[start:end]
        self.assertIn('<ic-prompt-composer class="prompt-node-text prompt-node-control"', function_source)
        self.assertIn('contenteditable="false"', function_source)
        self.assertNotIn("prompt-node-tools", function_source)
        self.assertNotIn("prompt-split-toggle", function_source)
        self.assertNotIn("prompt-llm-toggle", function_source)
        self.assertIn("syncPromptNodeEditor(node, editor)", self.script)
        self.assertIn("bindScrollableText(editor)", self.script)
        self.assertIn("function beginPromptNodeTextEdit", self.script)
        self.assertIn("text.contentEditable = 'true'", self.script)
        self.assertIn("editor.contentEditable = 'false'", self.script)
        self.assertIn('.prompt-node-text[contenteditable="false"]', self.style)

    def test_prompt_text_only_captures_pointer_events_while_editing(self):
        start = self.script.index("function bindScrollableText")
        end = self.script.index("function updatePortDragVisual", start)
        function_source = self.script[start:end]
        script = f"""
            let textSelectionGuard = null;
            let selectionState = null;
            let panState = null;
            let smartSpacePan = false;
            let smartMiddlePan = false;
            let smartBaseTool = 'pointer';
            class FakeElement {{
                constructor() {{
                    this.dataset = {{}};
                    this.isContentEditable = false;
                    this.scrollTop = 0;
                    this.scrollLeft = 0;
                    this.listeners = {{}};
                    this.classList = {{contains:name => name === 'prompt-node-text'}};
                }}
                addEventListener(type, handler) {{
                    (this.listeners[type] ||= []).push(handler);
                }}
                dispatch(type) {{
                    const state = {{stopped:false}};
                    const event = {{
                        clientY:0,
                        stopPropagation() {{ state.stopped = true; }}
                    }};
                    (this.listeners[type] || []).forEach(handler => handler(event));
                    return state.stopped;
                }}
            }}
            {function_source}
            const el = new FakeElement();
            bindScrollableText(el);
            const readonlyDown = el.dispatch('mousedown');
            const readonlyMove = el.dispatch('mousemove');
            el.isContentEditable = true;
            const editingDown = el.dispatch('mousedown');
            const editingMove = el.dispatch('mousemove');
            smartSpacePan = true;
            const panDown = el.dispatch('mousedown');
            const panMove = el.dispatch('mousemove');
            const panUp = el.dispatch('mouseup');
            smartSpacePan = false;
            selectionState = {{startScreen:{{x:0,y:0}}, startWorld:{{x:0,y:0}}}};
            const marqueeMove = el.dispatch('mousemove');
            const marqueeUp = el.dispatch('mouseup');
            process.stdout.write(JSON.stringify([
                readonlyDown,
                readonlyMove,
                editingDown,
                editingMove,
                panDown,
                panMove,
                panUp,
                marqueeMove,
                marqueeUp
            ]));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            [False, False, True, True, False, False, False, False, False],
        )

    def test_prompt_editors_keep_hand_cursor_during_canvas_pan(self):
        self.assertIn(
            ".shell.tool-hand :is(.prompt-node-text, .prompt-node-text *, .prompt-llm-instruction)",
            self.style,
        )
        self.assertIn(
            ".shell.temporary-pan :is(.prompt-node-text, .prompt-node-text *, .prompt-llm-instruction) { cursor:grab !important; }",
            self.style,
        )
        self.assertIn(
            ".shell.panning :is(.prompt-node-text, .prompt-node-text *, .prompt-llm-instruction) { cursor:grabbing !important; }",
            self.style,
        )

    def test_reference_text_node_creates_a_timed_pending_output_before_fetch(self):
        body_start = self.script.index("function promptNodeBodyHtml")
        body_end = self.script.index("function splitterNodeBodyHtml", body_start)
        body = self.script[body_start:body_end]
        run_start = self.script.index("async function runPromptLLMNode")
        run_end = self.script.index("function ungroupNode", run_start)
        run = self.script[run_start:run_end]
        self.assertIn("if(node.llmEnabled)", body)
        self.assertIn('class="prompt-node-card prompt-node-composer"', body)
        self.assertIn("promptNodeModelSelectHtml(node)", body)
        self.assertIn("composerRunButtonHtml({className:'prompt-node-run prompt-node-control'})", body)
        self.assertNotIn("disabled:Boolean(node.running)", body)
        self.assertIn("kind:'prompt'", run)
        self.assertLess(
            run.index("outputNode = canvasMutation.create"),
            run.index("await fetch"),
        )
        self.assertIn("textGenerationPending:true", run)
        self.assertIn("outputNode.runStartedAt = nowMs()", run)
        self.assertIn("outputNode.generationOperationId", run)
        self.assertIn("beginPromptNodeRun(node)", run)
        self.assertIn("finishPromptNodeRun(node.id)", run)
        self.assertNotIn("node.type !== 'smart-prompt' || node.running", run)
        self.assertIn("await canvasPersistence.save()", run)
        self.assertIn("await canvasPersistence.synced({timeout:5000})", run)
        self.assertIn("fetch('/api/canvas-llm-tasks'", run)
        self.assertIn("generation_operation_id:outputNode.generationOperationId", run)
        self.assertIn("await recovery.settle", run)
        self.assertIn("kind:'text'", run)
        self.assertIn("tr('smart.textGenerating')", body)
        self.assertNotIn("fetch('/api/canvas-llm'", run)
        self.assertIn("fromId:node.id", run)
        self.assertIn("toId:outputNode.id", run)
        self.assertNotIn("node.text = (result.text", run)
        self.assertIn("n.textGenerationOutput", self.script)

    def test_prompt_composer_merges_connected_media_into_input_thumbnails(self):
        start = self.script.index("function promptNodeInputMediaForLLM")
        end = self.script.index("function smartNodeInputThumbsHtml", start)
        function_source = self.script[start:end]
        upstream_start = self.script.index("function upstreamConnectionsForKinds")
        upstream_end = self.script.index("function upstreamNodesForKinds", upstream_start)
        upstream_source = self.script[upstream_start:upstream_end]
        self.assertIn("inputImagesFor(node)", function_source)
        self.assertIn("function outputImagesForConnection", self.script)
        self.assertIn("connection?.sourceOutputId", self.script)
        self.assertIn("[...pinned, ...connected, ...manual]", function_source)
        self.assertIn("promptNodeInputThumbsHtml(node)", self.script)
        self.assertIn('class="input-thumbs-row prompt-node-input-thumbs prompt-node-control has-items"', self.script)
        self.assertIn("to.type === 'smart-prompt'", self.script)
        self.assertIn("to.llmEnabled = true", self.script)
        self.assertIn("if(allowed.has('input'))", upstream_source)
        self.assertNotIn("if(!canvasUsesConnections", upstream_source)

    def test_separator_is_a_separate_connectable_node(self):
        self.assertIn('value="splitter" icon="split"', self.page)
        self.assertIn("type:'smart-splitter'", self.script)
        self.assertIn("function splitterNodePromptItems", self.script)
        self.assertIn("function splitterNodeBodyHtml", self.script)
        self.assertIn("targetNode.type === 'smart-splitter'", self.script)
        self.assertIn("sourceNode.type === 'smart-splitter'", self.script)
        self.assertIn("migrateLegacyPromptSplitNodes()", self.script)
        prompt_start = self.script.index("function promptNodeBodyHtml")
        prompt_end = self.script.index("function splitterNodeBodyHtml", prompt_start)
        self.assertNotIn("promptSplitEnabled", self.script[prompt_start:prompt_end])

    def test_separator_node_splits_each_upstream_text_item(self):
        start = self.script.index("const splitterPromptVisiting")
        end = self.script.index("// 编组的图片网格布局", start)
        function_source = self.script[start:end]
        script = f"""
            const smartLoopContext = {{}};
            function inputNodesFor(node) {{ return node.inputs || []; }}
            function promptTextItemsForNode(node, context) {{
                if(node.type === 'smart-splitter') return splitterNodePromptItems(node, context);
                return node.text ? [node.text] : [];
            }}
            {function_source}
            const splitter = {{
                id:'splitter-1',
                type:'smart-splitter',
                separator:';',
                inputs:[
                    {{type:'smart-prompt', text:'镜头一; 镜头二'}},
                    {{type:'smart-prompt', text:'镜头三'}}
                ]
            }};
            process.stdout.write(JSON.stringify(splitterNodePromptItems(splitter)));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["镜头一", "镜头二", "镜头三"])

    def test_dropping_a_port_opens_reference_generation_menu(self):
        menu = self.page.index('id="referenceGenerateMenu"')
        text_option = self.page.index('value="text"', menu)
        image_option = self.page.index('value="image"', menu)
        video_option = self.page.index('value="video"', menu)
        self.assertLess(text_option, image_option)
        self.assertLess(image_option, video_option)
        self.assertIn('引用该节点生成', self.page)
        self.assertIn('function openReferenceGenerateMenu', self.script)
        self.assertIn('const menuOpened = openReferenceGenerateMenu(drag, e, {', self.script)
        self.assertIn('return menuOpened', self.script)
        self.assertIn('const keepPortDragVisual = handlePortDrop(drag, e)', self.script)
        self.assertIn('if(!keepPortDragVisual) clearPortDragVisual()', self.script)
        self.assertIn('if(hadPendingChoice) clearPortDragVisual()', self.script)
        self.assertIn("created.llmEnabled = true", self.script)
        self.assertIn("created.referenceGenerationKind = kind", self.script)
        self.assertIn("apiKind:kind", self.script)
        self.assertIn("el.querySelector('.node-drop[data-upload-action=\"files\"]')", self.script)
        self.assertIn("el.querySelector('[data-reference-generation-target]')", self.script)
        self.assertNotIn("const nodeDrop = el.querySelector('.node-drop');", self.script)
        self.assertNotIn('class="node-drop reference-generation-target"', self.script)
        self.assertIn('menu.showAt(clientX, clientY, options.trigger || shell)', self.script)
        self.assertIn("referenceGenerateMenu?.addEventListener('ic-select'", self.script)
        self.assertNotIn('function positionReferenceGenerateMenu', self.script)
        self.assertIn('variant="reference-generate"', self.page)
        self.assertNotIn('.reference-generate-menu::part(surface)', self.style)
        self.assertIn(':host([variant="reference-generate"]) [part="surface"]', self.menu_popover)
        self.assertNotIn('.reference-generate-menu.open', self.style)
        self.assertIn('.reference-generation-target', self.style)

    def test_hovered_node_has_sticky_reference_generation_button(self):
        self.assertIn('smart-node-quick-add-zone--${side}', self.node_component)
        self.assertIn("quickAddMarkup(standardControls.quickAdd.out, 'out')", self.node_component)
        self.assertIn("quickAddMarkup(standardControls.quickAdd.in, 'in')", self.node_component)
        self.assertIn('data-node-quick-add', self.node_component)
        self.assertIn("menuId:'referenceGenerateMenu'", self.script)
        self.assertIn("menuId:'upstreamInputMenu'", self.script)
        self.assertIn('function openReferenceGenerateMenuFromNode(', self.script)
        self.assertIn(
            "openReferenceGenerateMenu(\n        {fromId:node.id,fromPort}",
            self.script,
        )
        self.assertIn(
            ".smart-node-quick-add-zone { --smart-node-quick-add-size:1.5rem; --smart-node-quick-add-zone-size:3rem; position:absolute; top:50%;",
            self.style,
        )
        self.assertIn(
            ".smart-node-quick-add-zone:is(.is-preview,.is-active,.is-port-target,.is-exit-grace,.is-menu-locked,.is-keyboard-locked)",
            self.style,
        )
        self.assertIn(
            ".smart-node-quick-add-zone:is(.is-active,.is-port-target) { pointer-events:auto; }",
            self.style,
        )
        self.assertIn("quickAddTrigger?.addEventListener('mousedown'", self.script)
        self.assertIn("quickAddTrigger?.addEventListener('click'", self.script)
        self.assertIn("quickAddTrigger?.addEventListener('keydown'", self.script)


if __name__ == "__main__":
    unittest.main()
