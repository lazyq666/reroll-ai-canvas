import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "api-settings.html"
STYLE = ROOT / "static" / "css" / "api-settings-t19.css"
LEGACY_STYLE = ROOT / "static" / "css" / "api-settings.css"
SCRIPT = ROOT / "static" / "js" / "api-settings.js"
ICONS = ROOT / "static" / "js" / "infinite-canvas-ui" / "icon.js"
I18N = ROOT / "static" / "js" / "i18n" / "api-settings.js"
BACKEND = ROOT / "backend" / "main.py"
PREVIEW = ROOT / "tests" / "api_settings_browser_app.cjs"


class ApiSettingsRunningHubCliContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.legacy_style = LEGACY_STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.icons = ICONS.read_text(encoding="utf-8")
        cls.i18n = I18N.read_text(encoding="utf-8")
        cls.backend = BACKEND.read_text(encoding="utf-8")
        cls.preview = PREVIEW.read_text(encoding="utf-8")

    def source_between(self, start, end):
        first = self.script.index(start)
        return self.script[first:self.script.index(end, first)]

    def style_rule(self, selector):
        match = re.search(rf'{re.escape(selector)}\s*\{{([^}}]*)\}}', self.style)
        self.assertIsNotNone(match, f'missing style rule: {selector}')
        return match.group(1)

    def test_runninghub_cli_layout_layer_is_loaded(self):
        self.assertRegex(self.page, r'/static/css/api-settings-t19\.css\?v=[^"\']+')
        self.assertIn('.runninghub-workspace-card {', self.style)
        self.assertNotIn('.rh-workflow-editor-dialog::part(dialog)', self.style)
        self.assertNotIn('.jimeng-help-dialog::part(dialog)', self.style)
        self.assertNotRegex(self.style, r'#[0-9a-fA-F]{3,8}\b')
        self.assertNotIn('--wa-', self.style)
        self.assertNotRegex(self.style, r'box-shadow:(?!\s*none\b)\s*[^;]+;')
        self.assertNotRegex(self.legacy_style, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")
        self.assertNotRegex(self.legacy_style, r"var\(\s*--ui-palette-")
        self.assertIn(
            "filter:var(--ui-shadow-none)",
            self.legacy_style,
        )

    def test_runninghub_static_surface_uses_public_components(self):
        start = self.page.index('<ic-card id="runninghubConfigBlock"')
        end = self.page.index('<ic-card id="modelsCard"', start)
        surface = self.page[start:end]
        for tag in ('ic-badge', 'ic-button', 'ic-card', 'ic-heading', 'ic-icon', 'ic-input'):
            self.assertIn(f'<{tag}', surface)
        self.assertNotRegex(surface, r'<(?:button|input|select|textarea)(?:\s|>)')
        self.assertNotRegex(surface, r'<wa-[a-z]')
        self.assertNotIn('data-lucide', surface)

    def test_returned_review_uses_composed_run_path_cards_and_media(self):
        start = self.page.index('<ic-card id="runninghubConfigBlock"')
        end = self.page.index('<ic-card id="modelsCard"', start)
        surface = self.page[start:end]
        self.assertRegex(surface, r'<ic-form-field class="rh-run-path-field"[^>]+hint=')
        self.assertRegex(surface, r'<ic-input id="rhPasteInput"[^>]+end-action>')
        self.assertRegex(surface, r'<ic-button slot="end"[^>]+onclick="createRhEntryFromPaste\(\)"')
        self.assertEqual(surface.count('<ic-card class="rh-entry-collection" size="small" tone="plain"'), 2)
        self.assertNotIn('<ic-card class="rh-entry-collection" size="small" tone="subtle"', surface)
        self.assertEqual(surface.count('<div class="rh-entry-group-head">'), 2)
        self.assertNotIn('<div slot="header" class="rh-entry-group-head">', surface)
        for legacy_class in (
            'runninghub-config-block', 'rh-paste-row', 'rh-card-columns',
            'rh-collection-column', 'rh-group-head', 'rh-card-list',
        ):
            self.assertNotIn(legacy_class, surface)

        entry_source = self.source_between('function rhEntryThumbnailInfo(kind, entry)', 'function dispatchSelectionChange')
        self.assertIn('<ic-card class="rh-entry-card"', entry_source)
        self.assertIn('<ic-image-frame ${common} state="upload">', entry_source)
        self.assertIn('<ic-image-frame ${common} state="normal"', entry_source)
        self.assertIn('size="medium" label=', entry_source)
        self.assertNotIn('fit="cover"', entry_source)
        self.assertNotIn('<ic-media-container class="rh-entry-thumbnail"', entry_source)
        self.assertNotIn('onclick="pickRhThumbnail', entry_source)
        for legacy_class in ('rh-config-card', 'rh-card-main', 'rh-card-actions'):
            self.assertNotIn(legacy_class, entry_source)

        for selector in ('.runninghub-workspace-card', '.rh-entry-collection', '.rh-entry-card', '.rh-entry-thumbnail'):
            self.assertNotRegex(self.style_rule(selector), r'\b(?:background|border|box-shadow|border-radius)\s*:')
        thumbnail_rule = self.style_rule('.rh-entry-thumbnail')
        self.assertIn('inline-size: var(--ui-space-24);', thumbnail_rule)
        self.assertIn('block-size: var(--ui-space-24);', thumbnail_rule)

    def test_entry_image_frame_recovers_from_failed_automatic_thumbnail(self):
        self.assertIn("document.addEventListener('ic-upload-request'", self.script)
        self.assertIn("document.addEventListener('ic-remove'", self.script)
        self.assertIn("document.addEventListener('ic-error'", self.script)
        picker = self.source_between('function pickRhThumbnail(kind, index)', 'async function removeRhEntryThumbnail')
        self.assertIn("if(!entry) return;", picker)
        self.assertNotIn("rhEntryThumbnailInfo(kind, entry).src", picker)
        fallback = self.source_between('function fallbackRhEntryThumbnail(frame)', 'function renderRhEntryThumbnailFrame')
        self.assertLess(fallback.index("frame.setAttribute('state', 'upload')"), fallback.index("frame.removeAttribute('src')"))
        self.assertIn("entry.thumbnailRemoved = true;", self.script)
        self.assertIn("entry.thumbnailRemoved = false;", self.script)
        self.assertIn("await saveProviders({silent:true})", self.script)
        self.assertNotIn('.rh-entry-thumbnail-stack', self.style)
        backend = (ROOT / 'backend/infinite_canvas/providers/http_impl.py').read_text(encoding='utf-8')
        self.assertIn('entry["thumbnailRemoved"] = True', backend)
        self.assertIn('entry.get("thumbnailRemoved") is not True', backend)

    def test_ai_apps_and_workflows_stack_vertically_at_all_widths(self):
        columns_rule = self.style_rule('.rh-entry-columns')
        self.assertIn('grid-template-columns: minmax(0, 1fr);', columns_rule)
        self.assertNotIn('repeat(2', columns_rule)

        list_rule = self.style_rule('.rh-entry-list')
        self.assertNotRegex(list_rule, r'\b(?:max-height|overflow|overscroll-behavior)\s*:')
        self.assertEqual(self.style.count('.rh-entry-list {'), 1)

    def test_runninghub_dynamic_editors_have_no_direct_native_controls(self):
        ranges = (
            ('function renderRhMappedPreviewHtml(config)', 'function renderRhPreviewOutput(url)'),
            ('function renderRhPreviewControl(field)', 'function renderRhPreviewMedia(url'),
            ('function renderRhWorkflowEditorField(field)', 'function renderRhAppFieldCards()'),
            ('function renderRhAppFieldCard(field)', 'function computeRhWorkflowEditorLayers'),
            ('function rhEntryThumbnailInfo(kind, entry)', 'function dispatchSelectionChange'),
        )
        source = ''.join(self.source_between(start, end) for start, end in ranges)
        for tag in ('ic-alert', 'ic-button', 'ic-card', 'ic-media-slot', 'ic-icon-button', 'ic-input', 'ic-number-input', 'ic-select', 'ic-slider', 'ic-switch', 'ic-textarea'):
            self.assertIn(f'<{tag}', source)
        self.assertNotRegex(source, r'<(?:button|input|select|textarea)(?:\s|>)')
        self.assertNotIn('data-lucide', source)
        self.assertNotRegex(source, r'<wa-[a-z]')
        self.assertIn('<ic-image-frame', source)

    def test_workflow_dialog_popover_and_file_selection_use_public_apis(self):
        self.assertRegex(self.page, r'<ic-dialog id="rhWorkflowEditorOverlay"[^>]+dismiss-policy="explicit"')
        self.assertRegex(self.page, r'<ic-file-input id="rhAssetFileInput"[^>]+hidden')
        self.assertIn('await rhWorkflowEditorOverlay.show()', self.script)
        self.assertIn("rhWorkflowEditorOverlay.hide('cancel')", self.script)
        self.assertIn("(rhWorkflowEditorOverlay || document.body).appendChild(pop)", self.script)
        self.assertIn("pop.style.setProperty('--rh-popover-max-height'", self.script)
        self.assertIn('rhAssetFileInput.open()', self.script)
        self.assertNotIn("document.createElement('input')", self.script)
        self.assertNotIn('window.addEventListener(\'keydown\', event => {\n    if(event.key === \'Escape\' && rhWorkflowEditorState.open)', self.script)

    def test_workflow_dialog_surfaces_are_composed_from_public_components(self):
        start = self.page.index('<ic-dialog id="rhWorkflowEditorOverlay"')
        end = self.page.index('<ic-dialog id="apiTransferDialog"', start)
        dialog = self.page[start:end]
        self.assertRegex(dialog, r'<span id="rhWorkflowEditorSub"[^>]*>[^<]+</span>')
        self.assertRegex(dialog, r'<section class="rh-workflow-editor-side"[^>]+aria-label=')
        self.assertRegex(dialog, r'<section class="rh-workflow-editor-canvas"[^>]+aria-label=')
        self.assertNotIn('<ic-card', dialog)
        self.assertNotIn('rh-workflow-editor-title-wrap', dialog)
        footer_buttons = re.findall(r'<ic-button[^>]+slot="footer"[\s\S]*?</ic-button>', dialog)
        self.assertEqual(len(footer_buttons), 3)
        self.assertTrue(all('<ic-icon' not in button for button in footer_buttons))
        self.assertTrue(all(re.search(r'\bsize="medium"', button) for button in footer_buttons))
        for selector in ('.rh-workflow-editor-side', '.rh-workflow-editor-canvas'):
            self.assertNotRegex(self.style_rule(selector), r'\b(?:background|border|box-shadow|border-radius|padding)\s*:')

        side_rule = self.style_rule('.rh-workflow-editor-side')
        self.assertRegex(side_rule, r'padding-block\s*:\s*0')
        self.assertRegex(side_rule, r'padding-inline-start\s*:\s*0')
        self.assertRegex(side_rule, r'padding-inline-end\s*:\s*var\(--ui-space-4\)')

    def test_returned_review_removes_nested_app_cards_and_preserves_footer_space(self):
        app_fields = self.source_between('function renderRhAppFieldCard(field)', 'function openRhAppFieldPopover')
        self.assertIn('<div class="rh-app-field-row', app_fields)
        self.assertIn('<ic-switch class="rh-app-field-enabled"', app_fields)
        self.assertIn('<ic-icon-button class="rh-app-field-open"', app_fields)
        self.assertIn('<span class="rh-app-field-meta"', app_fields)
        self.assertNotIn('<ic-card', app_fields)
        self.assertNotIn('<ic-checkbox', app_fields)
        self.assertNotIn('<ic-badge', app_fields)
        self.assertNotIn('rh-app-field-card', app_fields)
        self.assertIn("this.closest('.rh-app-field-row')", app_fields)

        app_wrap = self.style_rule('.rh-app-field-wrap')
        self.assertNotRegex(app_wrap, r'\b(?:background|border|box-shadow|border-radius|padding)\s*:')
        self.assertIn('.rh-workflow-editor-dialog::part(footer) { padding-block-start: var(--ui-space-4); }', self.style)
        body = self.style_rule('.rh-workflow-editor-body')
        self.assertIn('gap: var(--ui-space-4);', body)
        self.assertIn('padding: var(--ui-space-0) var(--ui-space-4) var(--ui-space-4);', body)

    def test_returned_review_removes_preview_and_popover_frame_duplication(self):
        preview = self.source_between('function renderRhMappedPreviewHtml(config)', 'function renderRhPreviewOutput(url)')
        field_editor = self.source_between('function renderRhWorkflowEditorField(field)', 'function renderRhAppFieldCards()')
        random_control = self.source_between('function renderRhPreviewControl(field)', 'function renderRhPreviewMedia(url')
        positioning = self.source_between('function rhEditorTokenPixels(name)', 'function renderRhNodePopover')

        self.assertIn('<section class="rh-mapped-preview"', preview)
        self.assertNotIn('<ic-card', preview)
        self.assertNotIn('rh-mapped-head', preview)
        self.assertIn('<div class="rh-editor-field-panel', field_editor)
        self.assertNotIn('<ic-card', field_editor)
        self.assertNotIn('<ic-checkbox', field_editor)
        self.assertIn('<ic-switch class="rh-editor-enabled"', field_editor)
        self.assertIn('<ic-switch class="rh-preview-random-control"', random_control)
        self.assertIn('<ic-image-frame class="rh-preview-image-frame"', random_control)
        self.assertIn('state="${frameState}" size="medium" upload-button-label=', random_control)
        self.assertNotIn('fit="contain"', random_control)
        self.assertIn('data-rh-preview-key=', random_control)
        self.assertIn('class="${randomControl ? \'rh-preview-random-input\' : \'\'}"', random_control)
        self.assertIn('const sharedLabel = randomControl', random_control)
        self.assertNotIn('rh-preview-random-btn', random_control)
        self.assertIn('<p class="rh-preview-keep">', random_control)
        self.assertNotIn('<ic-alert class="rh-preview-keep"', random_control)
        self.assertNotIn('toggleRhPreviewRandom', self.script)
        self.assertIn("pickRhPreviewMedia(previewFrame.dataset.rhPreviewKey", self.script)
        self.assertIn("removeRhPreviewImage(previewFrame.dataset.rhPreviewKey", self.script)

        for obsolete_selector in (
            '.rh-editor-summary div {', '.rh-preview-random-btn {',
            '.rh-editor-field-row {', '.rh-editor-check {',
            '.rh-node-popover {', '.rh-app-field-card {',
            '.rh-editor-keep {', '.rh-editor-random {',
            '.rh-preview-keep {',
        ):
            self.assertNotIn(obsolete_selector, self.legacy_style)

        popover_surface = self.style_rule('.rh-node-popover::part(surface)')
        self.assertNotRegex(popover_surface, r'\b(?:background|border|box-shadow|border-radius|padding)\s*:')
        self.assertNotIn('.rh-node-popover {', self.style)
        self.assertRegex(self.style_rule('.rh-preview-random-row'), r'align-items\s*:\s*center')
        self.assertRegex(self.style_rule('.rh-preview-random-control'), r'align-self\s*:\s*center')
        self.assertIn('.rh-preview-random-input::part(form-control-label)', self.style)
        self.assertEqual(self.style.count('.rh-preview-random-row.has-random'), 1)
        for fixed_value in ('const width = 390', ' - 420', ' + 74', ' - 190', ' - 180'):
            self.assertNotIn(fixed_value, positioning)

    def test_workflow_mapping_preview_and_save_endpoints_are_preserved(self):
        for endpoint in (
            '/api/runninghub/app-info',
            '/api/runninghub/workflows/fetch',
            '/api/runninghub/workflows/${encodeURIComponent(workflowId)}',
            '/api/runninghub/upload-asset',
            '/api/runninghub/workflow-submit',
            '/api/runninghub/submit',
        ):
            self.assertIn(endpoint, self.script)
        self.assertIn("method:'PUT'", self.source_between('async function saveRhWorkflowEditor()', 'function renderRhWorkflowEditor()'))
        self.assertIn("broadcastStudioApiChange('workflows-changed')", self.script)
        self.assertIn('optionalImageMode', self.script)
        self.assertIn('nodeInfoList', self.script)
        self.assertIn('rhWorkflowEditorState.previewParams', self.script)

    def test_cli_status_actions_and_help_dialogs_keep_existing_behavior(self):
        for panel_id, status_id in (
            ('jimengCliPanel', 'jimengCliStatus'),
            ('codexCliPanel', 'codexCliStatus'),
            ('geminiCliPanel', 'geminiCliStatus'),
        ):
            self.assertRegex(self.page, rf'<ic-card id="{panel_id}"[^>]+tone="plain"')
            self.assertIn(f'<ic-badge id="{status_id}" kind="status" tone="neutral"', self.page)
        for dialog_id in ('jimengHelpOverlay', 'codexHelpOverlay', 'geminiCliHelpOverlay'):
            self.assertRegex(self.page, rf'<ic-dialog id="{dialog_id}"[^>]+dismiss-policy="explicit"')
        for endpoint in (
            '/api/jimeng/status', '/api/jimeng/credit', '/api/jimeng/help',
            '/api/codex/status', '/api/codex/help',
            '/api/gemini-cli/status', '/api/gemini-cli/help',
        ):
            self.assertIn(endpoint, self.script)
        self.assertIn("jimengHelpCommand?.value === '__root__' ? ''", self.script)
        self.assertIn("codexHelpCommand?.value === '__root__' ? ''", self.script)
        self.assertIn("geminiCliHelpCommand?.value === '__root__' ? ''", self.script)

    def test_orphaned_icon_and_workflow_state_is_removed(self):
        for orphan in (
            'refreshIcons', 'rhWorkflowExpanded', 'rhWorkflowGroupKey',
            'renderRhWorkflowEditorNodeList', 'toggleRhWorkflowEditorGroup',
            'focusRhWorkflowEditorGroup', 'data-lucide',
        ):
            self.assertNotIn(orphan, self.script)
        self.assertNotRegex(self.script, r'document\.createElement\(["\'](?:button|input|select|textarea)["\']\)')
        self.assertNotRegex(self.script, r'<wa-[a-z]')
        self.assertNotIn('--wa-', self.script)
        provider_visibility = self.source_between(
            "document.body.classList.toggle('show-ms'",
            'const deleteBtn = document.getElementById',
        )
        self.assertNotIn('.style.display', provider_visibility)

        for selector in (
            '.rh-workflow-editor-side {',
            '.rh-workflow-editor-canvas {',
            '.rh-preview-media {',
            '.rh-preview-run {',
            '.rh-preview-status {',
        ):
            self.assertNotIn(selector, self.legacy_style)

    def test_semantic_icons_and_i18n_cover_the_workflow_editor(self):
        for icon in ('app', 'audio', 'fit', 'image', 'lock', 'play', 'random', 'video', 'workflow', 'zoom-in', 'zoom-out'):
            self.assertRegex(self.icons, rf"(?:'{re.escape(icon)}'|\b{re.escape(icon)})\s*:")
        self.assertIn('"api.workflowCanvasZoom"', self.i18n)
        self.assertIn('工作流画布缩放', self.i18n)

        for element_id in (
            'jimengCliPanel', 'codexCliPanel', 'geminiCliPanel',
            'runninghubConfigBlock', 'rhWorkflowEditorOverlay', 'rhAssetFileInput',
        ):
            tag = re.search(rf'<ic-[^>]+id="{element_id}"[^>]*>', self.page)
            self.assertIsNotNone(tag, f'missing API settings element: {element_id}')
            self.assertIn('data-i18n-label=', tag.group(0))
        for class_name in ('jimeng-actions', 'rh-editor-graph-controls'):
            for tag in re.findall(rf'<ic-[^>]+class="[^"]*{class_name}[^"]*"[^>]*>', self.page):
                self.assertIn('data-i18n-label=', tag)

    def test_narrow_and_theme_layouts_are_token_driven(self):
        for breakpoint in ('@media (max-width: 64rem)', '@media (max-width: 40rem)'):
            self.assertIn(breakpoint, self.style)
        self.assertIn('grid-template-columns: minmax(0, 1fr);', self.style)
        self.assertIn('grid-template-rows: max-content var(--api-t19-editor-row-narrow);', self.style)
        self.assertIn('.rh-workflow-editor-side { align-self: start; height: max-content; min-height: max-content; overflow: visible; }', self.style)
        self.assertIn('grid-template-rows: max-content var(--api-t19-editor-row-compact);', self.style)
        self.assertIn('var(--ui-color-', self.style)
        self.assertIn('var(--ui-space-', self.style)
        self.assertIn('var(--ui-radius-', self.style)
        self.assertNotIn('rgba(', self.style)
        module_tokens_end = self.style.index('\n}', self.style.index('.api-settings-page {')) + 2
        token_consumers = self.style[module_tokens_end:]
        for literal in ('18rem', '12rem', '34rem', '30rem', '28rem', '24rem'):
            self.assertNotIn(literal, token_consumers)

    def test_backend_routes_and_static_page_permission_contract_are_unchanged(self):
        for route in (
            '@app.get("/api/runninghub/app-info")',
            '@app.post("/api/runninghub/workflows/fetch")',
            '@app.put("/api/runninghub/workflows/{workflow_id:path}")',
            '@app.get("/api/codex/status")',
            '@app.post("/api/codex/help")',
            '@app.get("/api/gemini-cli/status")',
            '@app.post("/api/gemini-cli/help")',
            '@app.get("/api/jimeng/status")',
            '@app.post("/api/jimeng/help")',
        ):
            self.assertIn(route, self.backend)
        auth = (ROOT / 'backend' / 'infinite_canvas' / 'auth_system.py').read_text(encoding='utf-8')
        self.assertIn('"/static/api-settings.html"', auth)

    def test_browser_fixture_covers_ready_runninghub_and_cli_states(self):
        self.assertIn("API_SETTINGS_RUNNINGHUB_READY", self.preview)
        self.assertIn("workflow-001", self.preview)
        self.assertIn("/api/runninghub/workflows/workflow-001", self.preview)
        self.assertIn("/api/jimeng/status", self.preview)
        self.assertIn("/api/codex/status", self.preview)
        self.assertIn("/api/gemini-cli/status", self.preview)



if __name__ == '__main__':
    unittest.main()
