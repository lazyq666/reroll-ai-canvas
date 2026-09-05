import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "api-settings.html"
STYLE = ROOT / "static" / "css" / "api-settings-t18.css"
SCRIPT = ROOT / "static" / "js" / "api-settings.js"
I18N = ROOT / "static" / "js" / "i18n" / "api-settings.js"
SELECTION = ROOT / "static" / "js" / "infinite-canvas-ui" / "selection-adjustment" / "select.js"
SELECTION_STYLES = ROOT / "static" / "js" / "infinite-canvas-ui" / "selection-adjustment" / "styles.js"
THEME_ADAPTER = ROOT / "static" / "js" / "infinite-canvas-ui" / "theme-adapter.js"
FEEDBACK = ROOT / "static" / "js" / "infinite-canvas-ui" / "feedback-progress.js"
FILE_INPUT = ROOT / "static" / "js" / "infinite-canvas-ui" / "file-media-input.js"
BACKEND = ROOT / "backend" / "main.py"
AUTH = ROOT / "backend" / "infinite_canvas" / "auth_system.py"


class ApiSettingsStandardContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.legacy_style = (ROOT / "static" / "css" / "api-settings.css").read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.i18n = I18N.read_text(encoding="utf-8")
        cls.selection = SELECTION.read_text(encoding="utf-8")
        cls.selection_styles = SELECTION_STYLES.read_text(encoding="utf-8")
        cls.theme_adapter = THEME_ADAPTER.read_text(encoding="utf-8")
        cls.feedback = FEEDBACK.read_text(encoding="utf-8")
        cls.file_input = FILE_INPUT.read_text(encoding="utf-8")
        cls.backend = BACKEND.read_text(encoding="utf-8")
        cls.auth = AUTH.read_text(encoding="utf-8")

    def test_standard_surface_composes_public_infinite_canvas_components(self):
        component_source = self.page + self.script
        for tag in (
            "ic-badge",
            "ic-button",
            "ic-card",
            "ic-checkbox",
            "ic-dialog",
            "ic-empty-state",
            "ic-file-input",
            "ic-form-field",
            "ic-heading",
            "ic-icon",
            "ic-icon-button",
            "ic-input",
            "ic-number-input",
            "ic-select",
            "ic-tabs",
            "ic-table",
            "ic-toolbar",
        ):
            self.assertIn(f"<{tag}", component_source)
        self.assertIn("/static/js/infinite-canvas-ui/core.js", self.page)
        self.assertIn('data-studio-scale="off"', self.page)
        self.assertNotRegex(self.page, r"<wa-[a-z]")
        self.assertNotIn("--wa-", self.page)
        self.assertNotIn("/static/vendor/js/lucide.js", self.page)

    def test_navigation_platform_list_and_standard_editor_use_public_controls(self):
        self.assertRegex(
            self.page,
            r'<ic-card id="providerNavigation"[^>]+class="sidebar"[^>]+label="API 设置导航"[^>]+size="small">\s*<nav class="provider-navigation-content"',
        )
        self.assertIn('id="providerList"', self.page)
        self.assertRegex(
            self.page,
            r'<ic-tabs id="providerList"[^>]+data-legal-combination="vertical-manual-label"[^>]+orientation="vertical"[^>]+activation="manual"',
        )
        self.assertIn('id="nameInput"', self.page)
        self.assertIn('class="provider-nav-item', self.script)
        self.assertIn("<ic-badge", self.script)
        self.assertIn("<ic-input", self.script)
        self.assertIn("<ic-icon-button", self.script)
        self.assertNotIn('<button class="provider-card', self.script)
        for legacy_class in (
            "provider-card",
            "provider-card-banner",
            "onboarding-key-btn",
            "onboarding-save-btn",
            "recommend-card",
            "recommend-guide-key-btn",
            "recommend-guide-save-btn",
            "picker-row",
        ):
            self.assertNotRegex(
                self.script,
                rf'<ic-(?:button|card)[^>]*class="[^"]*(?<![\w-]){re.escape(legacy_class)}(?![\w-])',
            )
        self.assertNotIn('<input value="${escapeAttr(model', self.script)
        provider_list = self.script[self.script.index("function renderProviderList()"):self.script.index("function handleProviderDragStart")]
        self.assertNotIn('<ic-button class="provider-nav-item', provider_list)
        self.assertIn('data-value="${tabValue}"', provider_list)

    def test_provider_onboarding_has_one_card_and_only_public_controls(self):
        self.assertIn(
            '<div id="providerOnboardingHost" hidden></div>',
            self.page,
        )
        start = self.script.index("function renderProviderOnboarding(item)")
        end = self.script.index("function syncOnboardingKeyInput", start)
        onboarding = self.script[start:end]
        self.assertEqual(onboarding.count('<ic-card class="provider-onboarding-surface"'), 2)
        self.assertEqual(onboarding.count("data-provider-onboarding-content"), 2)
        for tag in ("ic-button", "ic-button-group", "ic-card", "ic-divider", "ic-heading", "ic-icon", "ic-input"):
            self.assertIn(f"<{tag}", onboarding)
        self.assertNotIn("<ic-badge", onboarding)
        for native_tag in ("a", "button", "input", "label"):
            self.assertNotRegex(onboarding, rf"<{native_tag}(?:\\s|>)")
        for legacy_class in ("onboarding-step-panel", "onboarding-key-btn", "onboarding-save-btn"):
            self.assertNotIn(legacy_class, onboarding)
        self.assertIn("#providerOnboardingHost {", self.style)
        self.assertIn(".provider-onboarding-surface { width: 100%; min-width: 0; }", self.style)
        self.assertNotIn("api.msOnboardingStep", self.script)
        self.assertNotIn("获取 Token 后填写，移开焦点自动保存", (ROOT / "static" / "js" / "i18n" / "api-settings.js").read_text(encoding="utf-8"))

    def test_cli_account_panels_use_card_and_badge_components(self):
        for panel_id, status_id in (
            ("jimengCliPanel", "jimengCliStatus"),
            ("codexCliPanel", "codexCliStatus"),
            ("geminiCliPanel", "geminiCliStatus"),
        ):
            self.assertRegex(self.page, rf'<ic-card id="{panel_id}"[^>]+class="jimeng-cli-panel jimeng-cli-card"')
            self.assertIn(f'<ic-badge id="{status_id}" kind="status" tone="neutral"', self.page)
            self.assertNotIn(f'<div id="{status_id}"', self.page)
            start = self.page.index(f'<ic-card id="{panel_id}"')
            panel = self.page[start:self.page.index('</ic-card>', start)]
            for tag in ("ic-heading", "ic-button-group", "ic-button"):
                self.assertIn(f'<{tag}', panel)
            self.assertNotRegex(panel, r'<button(?:\s|>)')
            self.assertNotIn('<ic-icon', panel)
            buttons = re.findall(r'<ic-button\s[^>]*>', panel)
            self.assertTrue(buttons)
            self.assertTrue(all('size="medium"' in button for button in buttons))
        self.assertIn("function setCliStatusBadge(badge, text, ok=null)", self.script)
        self.assertIn("badge.setAttribute('tone', ok === true ? 'success' : (ok === false ? 'danger' : 'neutral'))", self.script)

    def test_sidebar_actions_and_provider_status_follow_the_reviewed_hierarchy(self):
        self.assertRegex(
            self.page,
            r'<ic-button class="sidebar-action sidebar-primary-action"[^>]+size="medium"[^>]+hierarchy="primary"[^>]+addProvider\(\)',
        )
        provider_list_start = self.script.index("function renderProviderList()")
        provider_list_end = self.script.index("function handleProviderDragStart", provider_list_start)
        provider_list = self.script[provider_list_start:provider_list_end]
        for provider_id, next_provider_id in (
            ("modelscope", "runninghub"),
            ("runninghub", "volcengine"),
            ("volcengine", None),
        ):
            start = provider_list.index(f"if(item.id === '{provider_id}')")
            end = provider_list.index(
                f"if(item.id === '{next_provider_id}')" if next_provider_id else "return `\n            <span class=\"provider-nav-item provider-nav-sortable",
                start,
            )
            self.assertNotIn("<ic-badge", provider_list[start:end])
        self.assertIn('class="provider-protocol-tag" kind="label" size="small" tone="neutral"', self.script)
        self.assertNotIn('class="provider-status-dot"', self.script)
        self.assertIn('font-size:var(--ui-font-size-1)', self.feedback)

    def test_provider_navigation_uses_platform_icons_compact_rows_and_token_spacing(self):
        for name in ("chatgpt", "doubao", "flux", "gemini", "grok", "jimeng"):
            asset = ROOT / "static" / "images" / "providers" / f"{name}.svg"
            self.assertTrue(asset.exists(), name)
            self.assertIn("<svg", asset.read_text(encoding="utf-8"))
            self.assertIn(f"{name}:'/static/images/providers/{name}.svg'", self.script)
        for name in ("jimeng", "chatgpt", "gemini"):
            self.assertIn(f'src="/static/images/providers/{name}.svg"', self.page)
        self.assertRegex(
            self.page,
            r'class="provider-platform-icon provider-platform-icon-monochrome" src="/static/images/providers/jimeng\.svg"',
        )
        provider_list = self.script[
            self.script.index("function renderProviderList()"):
            self.script.index("function handleProviderDragStart")
        ]
        self.assertIn('<ic-icon name="drag" size="small"', provider_list)
        self.assertNotIn('name="more"', provider_list)
        self.assertNotIn("provider-meta", provider_list)
        self.assertNotIn("api.addressNotConfigured", provider_list)
        self.assertRegex(self.style, r"\.provider-name \{[\s\S]*?font: var\(--ui-text-body\);")
        self.assertRegex(self.style, r"\.provider-list \{\s+gap: var\(--ui-space-2\);")
        self.assertIn("grid-template-columns: auto auto minmax(0, 1fr) auto;", self.style)
        self.assertEqual(
            self.page.count('<ic-heading class="side-section-title" level="3"'),
            3,
        )
        self.assertGreaterEqual(self.page.count('data-legal-combination="h3-title"'), 4)
        self.assertRegex(
            self.style,
            r'#providerNavigation \.side-section-title \{[\s\S]*?color: var\(--ui-color-text-primary\);',
        )
        self.assertRegex(
            self.style,
            r'\.provider-navigation-content \{[\s\S]*?display: grid;[\s\S]*?gap: var\(--ui-space-2\);',
        )

    def test_requested_text_actions_use_expected_button_sizes(self):
        self.assertEqual(
            len(re.findall(r'<ic-button class="sidebar-cli-action" size="medium"', self.page)),
            4,
        )
        for button_id in ("deleteBtn",):
            self.assertRegex(
                self.page,
                rf'<ic-button id="{button_id}" size="medium"',
            )
        for button_id in ("fetchModelsBtn", "openPickerBtn"):
            self.assertRegex(
                self.page,
                rf'<ic-button id="{button_id}" size="medium" hierarchy="secondary"',
            )

    def test_page_navigation_and_card_titles_use_heading_components(self):
        self.assertRegex(
            self.page,
            r'<ic-heading class="page-heading" level="1"[^>]+data-legal-combination="h1-with-subtitle"',
        )
        self.assertNotIn('<header class="page-head">', self.page)
        self.assertRegex(
            self.page,
            r'<ic-heading id="editorTitle" class="card-heading" level="3"[^>]+data-legal-combination="h3-with-subtitle"',
        )
        self.assertGreaterEqual(self.page.count('data-legal-combination="h3-with-subtitle"'), 6)
        onboarding = self.script[
            self.script.index("function renderProviderOnboarding(item)"):
            self.script.index("function syncOnboardingKeyInput")
        ]
        self.assertEqual(onboarding.count('data-legal-combination="h3-with-subtitle"'), 2)
        self.assertIn("[data-i18n-subtitle]", (ROOT / "static" / "js" / "i18n-core.js").read_text(encoding="utf-8"))

    def test_sidebar_is_content_height_and_transfer_actions_share_one_row(self):
        self.assertIn(".api-settings-page .layout #providerNavigation {", self.style)
        self.assertIn("background: transparent !important;", self.style)
        self.assertIn("max-height: none !important;", self.style)
        self.assertIn("overflow: visible !important;", self.style)
        self.assertNotRegex(self.page, r'<ic-button class="cli-quick-btn')
        self.assertEqual(self.page.count('class="sidebar-cli-action"'), 4)
        self.assertRegex(
            self.page,
            r'<ic-heading[^>]+data-i18n="api.settingsMigration"[^>]*>API 设置迁移</ic-heading>',
        )
        self.assertIn('class="api-transfer-actions"', self.page)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", self.style)
        self.assertLess(self.page.index('class="cli-quick-group"'), self.page.index('class="api-transfer-group"'))
        self.assertRegex(
            self.page,
            r'class="api-transfer-group"[\s\S]*?data-i18n="api.settingsMigration"[\s\S]*?class="api-transfer-note"[\s\S]*?class="api-transfer-actions"[\s\S]*?exportEncryptedApiSettings\(\)[\s\S]*?chooseEncryptedApiSettings\(\)',
        )
        self.assertRegex(self.page, r'<ic-file-input[^>]+id="apiSettingsImportInput"[^>]+hidden')
        self.assertIn(".layout .cli-quick-group,", self.style)
        self.assertIn("border-top: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);", self.style)
        self.assertRegex(self.style, r"\.provider-list \{[\s\S]*?border-bottom: 0;")

    def test_sidebar_width_alignment_and_redundant_copy_follow_visual_review(self):
        self.assertIn("grid-template-columns: clamp(17rem, 25vw, 20rem) minmax(0, 1fr)", self.style)
        self.assertIn("align-items: center", self.style)
        self.assertIn("width: min(132px, 100%);", self.style)
        for copy in (
            "需要先安装 CLI 文件夹中的依赖。",
            "显示名供工作区共用，请求地址只保存在当前电脑",
            "用于在平台列表中识别此 Provider",
            "从当前电脑连接的服务拉取模型；保存后的模型选择与显示名供工作区成员共用。",
        ):
            self.assertNotIn(copy, self.page + self.script)

    def test_surface_has_no_recommendation_debt_and_supports_narrow_layout(self):
        self.assertNotRegex(self.page, r'<ic-button[^>]+openRecommendApi\(')
        self.assertNotIn('id="recommendContent"', self.page)
        self.assertNotIn('id="recommendPanel"', self.page)
        self.assertNotIn('id="recommendApiOverlay"', self.page)
        self.assertNotIn("recommendInlineOpen", self.script)
        self.assertNotIn("renderRecommendApi", self.script)
        self.assertNotRegex(self.legacy_style, r"\.recommend-[\w-]*")
        self.assertIn("min-width: 0;", self.style)
        self.assertIn("@media (max-width: 64rem)", self.style)
        self.assertRegex(
            self.style,
            r"@media \(max-width: 64rem\)[\s\S]*?\.api-settings-page \.layout,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);",
        )

    def test_select_focus_ring_is_keyboard_only(self):
        self.assertNotIn("icPointerFocus", self.selection)
        self.assertIn(
            "ic-select:focus-visible::part(combobox)",
            self.selection_styles,
        )
        self.assertNotIn("data-ic-pointer-focus", self.theme_adapter)
        self.assertRegex(self.page, r'<ic-select id="protocolInput"[^>]+aria-label="协议"(?![^>]+\slabel=)')
        self.assertRegex(self.page, r'<ic-select id="imageRequestModeInput"[^>]+aria-label="图片接口"(?![^>]+\slabel=)')

    def test_verification_actions_use_public_input_action_variants(self):
        self.assertRegex(
            self.page,
            r'<ic-form-field id="keyFormField"[^>]+label="API Key"[^>]+hint="">\s*<ic-input id="keyInput"[^>]+slot="control"[^>]+end-action>\s*<ic-icon-button id="clearSavedKeyBtn"[^>]+slot="end"[^>]+icon="delete"[^>]+hidden>[\s\S]*?<ic-button id="testUrlBtn"[^>]+slot="end"[^>]+hierarchy="quiet"[^>]*>[\s\S]*?api\.testUrl[\s\S]*?检测地址',
        )
        self.assertNotIn('id="probeAsyncBtn"', self.page)
        self.assertNotIn('class="verify-action-row"', self.page)
        self.assertRegex(self.page, r'<div class="protocol-state-controls" hidden aria-hidden="true">[\s\S]*?id="protocolInput"[\s\S]*?id="imageRequestModeInput"')

    def test_api_key_field_uses_conditional_dual_end_actions(self):
        self.assertRegex(
            self.page,
            r'<ic-input id="keyInput"[^>]+end-action>\s*'
            r'<ic-icon-button id="clearSavedKeyBtn"[^>]+slot="end"[^>]+icon="delete"[^>]+hidden></ic-icon-button>\s*'
            r'<ic-button id="testUrlBtn"[^>]+slot="end"[^>]*>[\s\S]*?检测地址[\s\S]*?</ic-button>',
        )
        self.assertNotIn('class="key-meta-row"', self.page)
        self.assertIn("if(clearSavedKeyBtn) clearSavedKeyBtn.hidden = !item.has_key;", self.script)

    def test_hint_inputs_use_native_form_field_combinations(self):
        self.assertRegex(
            self.page,
            r'<ic-form-field id="nameFormField"[^>]+hint="平台 ID：—">\s*<ic-input id="nameInput"[^>]+slot="control"',
        )
        self.assertRegex(
            self.page,
            r'<ic-form-field id="baseUrlFormField"[^>]+hint="">\s*<ic-input id="baseInput"[^>]+slot="control"',
        )
        self.assertNotIn('id="keyHint"', self.page)
        self.assertNotIn('id="idPreview"', self.page)
        self.assertIn("nameFormField.setAttribute('hint'", self.script)
        self.assertIn("baseUrlFormField.setAttribute('hint'", self.script)
        self.assertIn("keyFormField.setAttribute('hint'", self.script)
        for selector in (".layout .hint,", ".layout .form-supporting-text {"):
            self.assertIn(selector, self.style)
        for token in (
            "--ui-color-text-tertiary",
            "--ui-text-body-compact",
            "--ui-line-height-body",
            "--ui-letter-spacing-normal",
        ):
            self.assertIn(f"var({token})", self.style)

    def test_provider_card_key_action_and_plain_toolbars_follow_visual_review(self):
        self.assertRegex(
            self.page,
            r'<ic-card id="providerSettingsCard"[\s\S]*?<div class="content-head">[\s\S]*?<ic-divider></ic-divider>[\s\S]*?<section class="block">',
        )
        self.assertRegex(self.page, r'<div class="provider-delete-action">\s*<ic-button id="deleteBtn" size="medium"')
        provider_actions = self.page[
            self.page.index('<div class="provider-delete-action"'):
            self.page.index('</div>', self.page.index('<div class="provider-delete-action"'))
        ]
        self.assertNotIn('<ic-icon', provider_actions)
        self.assertIn('id="deleteBtn" size="medium"', provider_actions)
        self.assertNotIn('id="saveProvidersBtn"', self.page)
        self.assertRegex(self.page, r'<ic-input id="keyInput"[^>]+end-action>\s*<ic-icon-button id="clearSavedKeyBtn"[^>]+slot="end"[\s\S]*?<ic-button id="testUrlBtn"[^>]+slot="end"')
        self.assertIn('id="clearSavedKeyBtn"', self.page)
        self.assertIn('清除已保存 Key', self.page)
        self.assertNotIn('class="key-meta-row"', self.page)
        self.assertNotRegex(self.page, r'<ic-button id="clearSavedKeyBtn"')
        self.assertNotIn('class="key-actions" label="API Key 操作"', self.page)
        self.assertNotIn('class="inline-code"', self.page)
        self.assertNotIn('.inline-code', (ROOT / "static" / "css" / "api-settings.css").read_text(encoding="utf-8"))
        self.assertIn("if(clearSavedKeyBtn) clearSavedKeyBtn.hidden = !item.has_key;", self.script)
        self.assertIn("if(btn) btn.loading = true;", self.script)
        self.assertIn("if(btn) btn.loading = false;", self.script)
        self.assertIn(".provider-settings-card .content-head { padding: 0; }", self.style)
        self.assertIn(".provider-settings-card .form { padding: 0; }", self.style)
        self.assertIn("justify-content: flex-start", self.style)
        self.assertRegex(self.style, r"#clearSavedKeyBtn::part\(base\)[\s\S]*?inline-size: var\(--ui-control-height-s\);")
        self.assertNotIn(".verify-action-row", self.style)

    def test_standard_form_controls_keep_existing_ids_and_behaviour(self):
        for control_id, tag in (
            ("nameInput", "ic-input"),
            ("baseInput", "ic-input"),
            ("keyInput", "ic-input"),
            ("protocolInput", "ic-select"),
            ("imageRequestModeInput", "ic-select"),
        ):
            self.assertRegex(self.page, rf"<{tag}[^>]*id=\"{control_id}\"")
        for endpoint in (
            "/api/providers",
            "/api/providers/export-encrypted",
            "/api/providers/import-encrypted",
            "/api/providers/test-connection",
            "/api/providers/fetch-models",
        ):
            self.assertIn(endpoint, self.script)
        self.assertIn("method:'PUT'", self.script)
        self.assertIn("broadcastStudioApiChange('providers-changed')", self.script)
        self.assertIn("updateProtocolFromInput();", self.script)
        self.assertIn("requestAutoSave({affectsVerification:true});", self.script)
        self.assertIn("modelCapabilityReviewNote(data.capability_review)", self.script)
        self.assertIn('api.modelCapabilityReviewCollected', self.i18n)
        self.assertIn('api.modelCapabilityReviewFailed', self.i18n)
        self.assertIn("document.addEventListener('focusout', handleAutoSaveFocusOut)", self.script)
        self.assertIn("document.addEventListener('keydown', handleAutoSaveKeyDown)", self.script)
        self.assertRegex(self.page, r'id="baseInput"[^>]+data-auto-save="connection"')
        self.assertRegex(self.page, r'id="nameInput"[^>]+data-auto-save="setting"')
        self.assertNotIn('id="autoSaveStatus"', self.page)
        self.assertNotIn('id="autoSaveRetryBtn"', self.page)
        self.assertIn('value="inherit"', self.script)

    def test_models_area_uses_component_cards_and_compact_unlabelled_controls(self):
        self.assertRegex(
            self.page,
            r'<ic-card id="modelsCard"[^>]+>[\s\S]*?<ic-heading id="modelsTitle"[^>]+level="3"[^>]+data-legal-combination="h3-title"[^>]*>模型列表</ic-heading>[\s\S]*?<ic-toolbar id="modelsHead" class="models-actions-toolbar"',
        )
        self.assertNotIn('class="models-head', self.page)
        self.assertEqual(self.page.count('class="model-section-card'), 1)
        self.assertEqual(self.page.count('slot="header" class="block-head"'), 1)
        self.assertEqual(self.page.count('slot="header" class="model-section-divider"'), 1)
        self.assertIn('id="modelCategoryTabs" class="model-category-tabs"', self.page)
        self.assertIn('data-legal-combination="horizontal-automatic-label"', self.page)
        self.assertIn('data-i18n="api.modelCategoryImage">图片模型</button>', self.page)
        self.assertIn('data-i18n="api.modelCategoryVideo">视频模型</button>', self.page)
        self.assertIn('data-i18n="api.modelCategoryText">文本模型</button>', self.page)
        self.assertNotRegex(self.page, r'id="(?:fetchModelsBtn|openPickerBtn)"[^>]*<ic-icon')
        self.assertEqual(self.page.count('size="medium" hierarchy="quiet" type="button" onclick="addModel('), 3)
        self.assertEqual(self.page.count('data-i18n="api.manualAddModel">手动添加模型</span>'), 3)
        self.assertNotRegex(self.page, r'<ic-button[^>]+onclick="addModel[^>]*><ic-icon')
        self.assertEqual(self.page.count('class="model-panel-footer-actions"'), 3)
        self.assertRegex(
            self.style,
            r'\.model-panel-footer-actions\s*\{[^}]*justify-content:\s*center;',
        )
        for kind, list_id in (("image", "imageModelList"), ("video", "videoModelList"), ("chat", "chatModelList")):
            self.assertLess(
                self.page.index(f'id="{list_id}"'),
                self.page.index(f'onclick="addModel(\'{kind}\')"'),
            )
        self.assertIn('class="model-grid" data-ui-density="small" id="modelExtensions" hidden', self.page)
        self.assertIn("modelExtensions.hidden = !isModelScope", self.script)
        self.assertNotIn("msLoraBlock.style.display", self.script)
        self.assertIn('class="model-list" role="list"', self.page)
        self.assertIn("modelCategoryTabs.addEventListener('ic-change'", self.script)
        self.assertIn('role="listitem"', self.script)
        self.assertRegex(self.script, r'<ic-input name="\$\{kind\}_model_\$\{index\}"[^>]+aria-label=')
        self.assertNotRegex(self.script, r'<ic-input name="\$\{kind\}_model_\$\{index\}"[^>]+\slabel=')
        self.assertIn("const hasModelId = Boolean(String(model || '').trim())", self.script)
        self.assertIn("? 'readonly'", self.script)
        self.assertRegex(self.script, r'<ic-select class="model-protocol-select"[^>]+aria-label=')
        self.assertNotRegex(self.script, r'<ic-select class="model-protocol-select"[^>]+\slabel=')
        legacy_models = (ROOT / "static" / "css" / "api-settings.css").read_text(encoding="utf-8")
        self.assertNotIn(".model-row {", legacy_models)
        self.assertNotIn(".model-row:focus-within", legacy_models)
        self.assertNotRegex(legacy_models, r"(?:^|,)\s*(?:body|html)[^{]+\.model-row")

    def test_model_picker_uses_dialog_filters_semantic_table_and_public_selection(self):
        dialog_start = self.page.index('<ic-dialog id="modelPickerOverlay"')
        dialog = self.page[dialog_start:self.page.index('</ic-dialog>', dialog_start)]
        self.assertIn('class="model-picker-dialog"', dialog)
        self.assertRegex(dialog, r'label="选择模型"[^>]+data-i18n-label="api\.selectModels"[^>]+data-legal-combination="h2-with-subtitle"')
        self.assertRegex(dialog, r'<span slot="label" class="model-selection-heading">[^<]*<span[^>]+api\.selectModels[^>]*>选择模型</span><span id="pickerCount" class="model-selection-count">—</span></span>')
        self.assertRegex(dialog, r'<ic-toolbar class="model-selection-filters"[^>]+appearance="plain"')
        self.assertRegex(dialog, r'<ic-input id="pickerFilter"[^>]+type="search"[^>]+aria-label="搜索模型"')
        self.assertNotRegex(dialog, r'<ic-input id="pickerFilter"[^>]+\slabel=')
        self.assertRegex(dialog, r'<ic-tabs id="pickerCategoryTabs"[^>]+activation="automatic"[^>]+data-legal-combination="horizontal-automatic-label"')
        self.assertLess(dialog.index('id="pickerCategoryTabs"'), dialog.index('id="pickerFilter"'))
        self.assertRegex(
            dialog,
            r'<ic-table id="pickerList"[^>]+label="上游模型清单"[^>]+row-selection="multiple"',
        )
        self.assertRegex(dialog, r'<ic-toolbar id="pickerSummary"[^>]+class="model-selection-summary"[^>]+appearance="plain"')
        self.assertNotRegex(dialog, r'class="[^"]*(?:picker-toolbar|picker-body|picker-summary|picker-cat-tab)')
        picker_start = self.script.index('function renderModelPicker(event)')
        picker = self.script[picker_start:self.script.index('function selectPickerCat(cat)', picker_start)]
        for tag in ('table', 'caption', 'thead', 'tbody', 'th', 'ic-checkbox', 'ic-badge', 'ic-empty-state'):
            self.assertIn(f'<{tag}', picker)
        self.assertNotIn('<ic-button class="model-picker-row"', picker)
        self.assertIn('setPickerRowSelectionByIndex', picker)

    def test_model_picker_legacy_hardcoded_style_system_is_removed(self):
        for selector in (
            '.picker-toolbar',
            '.picker-search',
            '.picker-cat-tabs',
            '.picker-cat-tab',
            '.picker-body',
            '.picker-row',
            '.picker-checkbox',
            '.picker-model-',
            '.picker-other-',
            '.picker-summary',
            '.picker-sum-chip',
        ):
            self.assertNotIn(selector, self.legacy_style)
        start = self.style.index('.model-picker-dialog .model-selection-count')
        picker_styles = self.style[start:self.style.index('.api-transfer-dialog', start)]
        self.assertNotRegex(picker_styles, r'#[0-9a-fA-F]{3,8}\b')
        self.assertNotIn('box-shadow', picker_styles)
        self.assertNotIn('background: rgba(', picker_styles)
        self.assertNotIn('.model-picker-dialog::part(dialog)', self.style)
        self.assertIn('.model-picker-dialog::part(header) { padding-block-start: var(--ui-space-8); }', self.style)
        self.assertRegex(self.style, r'\.model-picker-dialog::part\(body\) \{[^}]+grid-template-rows: auto minmax\(0, 1fr\) auto;[^}]+padding-block: var\(--ui-space-4\);[^}]+overflow: hidden;')
        self.assertIn('.model-picker-dialog::part(footer) { padding-block-end: var(--ui-space-8); }', self.style)
        self.assertIn('.model-picker-dialog .model-selection-table { min-block-size: 0; }', self.style)

    def test_feedback_components_keep_valid_public_contracts(self):
        self.assertNotIn('id="status" class="status"', self.page)
        self.assertIn('<ic-alert', self.page + self.script)
        self.assertNotIn('id="verifyResult"', self.page + self.script)
        self.assertNotIn('id="apiTransferPasswordError"', self.page + self.script)
        self.assertNotIn("alert(", self.script)
        self.assertIn("customElements.get('ic-toast')?.notify(message, {tone})", self.script)
        self.assertIn("function showVerificationToast(content, tone='info')", self.script)
        self.assertIn("showError(tr('api.passwordMismatch'))", self.script)
        for empty_title in ("api.noMatches", "api.noModels", "api.loraEmpty"):
            self.assertRegex(self.script, rf'<ic-empty-state title=.*{re.escape(empty_title)}')

    def test_cli_card_actions_and_select_spacing_follow_latest_review(self):
        self.assertRegex(self.page, r'<ic-card id="jimengCliPanel"[^>]+class="jimeng-cli-panel jimeng-cli-card"[^>]+tone="plain"')
        self.assertRegex(self.page, r'<ic-button-group class="jimeng-actions"[^>]+>[\s\S]*?data-i18n="api.scanLogin"')
        self.assertEqual(self.page.count('<ic-button size="medium" hierarchy="primary" type="button" onclick="startJimengLogin()"'), 1)
        self.assertNotIn("--ic-card-background", (ROOT / "static" / "css" / "api-settings.css").read_text(encoding="utf-8"))
        self.assertIn("--wa-form-control-padding-inline: var(--ui-space-3)", self.selection_styles)
        self.assertIn("--wa-form-control-padding-inline: var(--ui-space-2)", self.selection_styles)

    def test_standard_import_export_and_confirmation_use_public_components(self):
        self.assertRegex(self.page, r'<ic-file-input[^>]*id="apiSettingsImportInput"')
        self.assertRegex(self.page, r'<ic-dialog[^>]*id="apiTransferDialog"')
        self.assertRegex(self.page, r'<ic-confirmation-dialog[^>]*id="apiImportConfirmation"')
        self.assertIn("input.open()", self.script)
        self.assertIn("acceptedFiles", self.script)
        self.assertIn("apiImportConfirmation", self.script)
        self.assertNotIn("if(!confirm(tr('api.confirmPackageImport')))", self.script)

    def test_all_standard_confirmation_actions_use_public_dialogs(self):
        self.assertRegex(self.page, r'<ic-confirmation-dialog[^>]*id="apiActionConfirmation"')
        for function_name, next_function_name in (
            ("clearKeyOnly", "providerSupportsModelProtocol"),
            ("deleteProvider", "saveRhKeyOnly"),
            ("clearRhKeyOnly", "saveVolcengineAssetKeys"),
            ("clearVolcengineAssetKeys", "addModel"),
        ):
            start = self.script.index(f"function {function_name}(")
            end = self.script.index(f"function {next_function_name}(", start)
            source = self.script[start:end]
            self.assertNotIn("confirm(", source)
            self.assertIn("requestApiActionConfirmation", source)

    def test_component_attribute_i18n_and_standard_form_labels_are_not_hardcoded(self):
        i18n_core = (ROOT / "static" / "js" / "i18n-core.js").read_text(encoding="utf-8")
        for attribute in ("label", "description", "confirm-label", "cancel-label", "button-label"):
            self.assertIn(f"['data-i18n-{attribute}', '{attribute}']", i18n_core)
        for marker in (
            'data-i18n-label="api.platformName"',
            'data-i18n-label="api.baseUrl"',
            'data-i18n-label="api.encryptedPackage"',
            'data-i18n-label="api.encryptionPassword"',
            'data-i18n-label="api.passwordAgain"',
        ):
            self.assertIn(marker, self.page)

    def test_provider_brand_icons_only_use_explicit_provider_identity(self):
        start = self.script.index("const PROVIDER_ICON_ALIASES")
        end = self.script.index("function providerIconMarkup", start)
        icon_mapping = self.script[start:end]
        self.assertNotIn("item?.protocol", icon_mapping)
        self.assertNotIn(".includes(", icon_mapping)
        self.assertIn("PROVIDER_ICON_ALIASES", icon_mapping)

    def test_runninghub_and_volcengine_key_surfaces_use_public_components(self):
        runninghub_start = self.page.index('<div class="rh-key-stack">')
        volcengine_start = self.page.index('<div class="volcengine-key-stack"', runninghub_start)
        volcengine_end = self.page.index('<div class="ms-hint form-supporting-text ', volcengine_start)
        key_surfaces = self.page[runninghub_start:volcengine_start] + self.page[volcengine_start:volcengine_end]
        for tag in ("ic-card", "ic-input", "ic-button", "ic-button-group", "ic-icon-button"):
            self.assertIn(f"<{tag}", key_surfaces)
        self.assertNotRegex(key_surfaces, r'<(?:input|button|a)(?:\s|>)')
        self.assertNotIn('class="rh-key-item', key_surfaces)
        self.assertNotIn('class="field-frame', key_surfaces)
        legacy_style = (ROOT / "static" / "css" / "api-settings.css").read_text(encoding="utf-8")
        for selector in (".rh-key-item", ".rh-key-head", ".rh-key-links", ".field-frame"):
            self.assertNotIn(selector, legacy_style)

    def test_runninghub_and_cli_special_editors_remain_available(self):
        for element_id in (
            "runninghubConfigBlock",
            "rhWorkflowEditorOverlay",
            "jimengCliPanel",
            "codexCliPanel",
            "geminiCliPanel",
        ):
            self.assertIn(f'id="{element_id}"', self.page)
        self.assertIn("renderRunningHubCards", self.script)
        self.assertIn("renderRhWorkflowEditor", self.script)
        self.assertIn("refreshJimengStatus", self.script)

    def test_permissions_remain_server_enforced(self):
        providers_route = self.backend.index('@app.get("/api/providers")')
        providers_guard = self.backend.index('require_current_user("admin")', providers_route)
        save_route = self.backend.index('@app.put("/api/providers")')
        save_guard = self.backend.index('require_current_user("admin")', save_route)
        self.assertLess(providers_route, providers_guard)
        self.assertLess(save_route, save_guard)
        self.assertIn('"/static/api-settings.html"', self.auth)

    def test_standard_layout_styles_do_not_recreate_component_chrome(self):
        start = self.style.index("/* T18 standard Provider surface */")
        end = self.style.index("/* T19 boundary */", start)
        standard = self.style[start:end]
        self.assertIn(".api-settings-page {", standard)
        self.assertIn(".api-settings-page .layout {", standard)
        self.assertIn("@media (max-width: 64rem)", standard)
        self.assertIn(".api-settings-page .layout .content-head {", standard)
        self.assertIn("padding: var(--ui-space-4);", standard)
        self.assertIn(".api-settings-page .layout .block-head { padding: var(--ui-space-4) var(--ui-space-4) 0; }", standard)
        self.assertIn(".api-settings-page .layout .model-section-card .block-head { padding: 0; border-block-end: 0; }", standard)
        self.assertIn(".api-settings-page .layout .model-section-card .model-section-divider { margin-block: var(--ui-space-4) 0; }", standard)
        self.assertNotRegex(standard, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotIn("--wa-", standard)
        self.assertNotIn("box-shadow", standard)
        self.assertNotIn("translateY", standard)
        self.assertNotIn("margin-top: .5em", standard)
        for selector in (
            ".add-btn",
            ".api-link-btn",
            ".key-btn",
            ".action-btn.save-btn",
            ".provider-card.active",
            ".provider-card:hover",
            ".recommend-card:hover",
            ".onboarding-key-btn:hover",
            ".onboarding-save-btn:hover",
            ".picker-row:hover",
            ".picker-cat-tab.active",
        ):
            self.assertNotIn(selector, standard)

    def test_loaded_legacy_styles_delegate_page_palette_to_semantic_tokens(self):
        self.assertIn("--api-readable-bg:var(--ui-color-surface-canvas)", self.legacy_style)
        self.assertIn("background:var(--ui-color-surface-canvas)", self.legacy_style)
        self.assertNotRegex(self.legacy_style, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")
        self.assertNotRegex(self.legacy_style, r"var\(\s*--ui-palette-")
        self.assertNotIn("scrollbar-color", self.legacy_style)
        self.assertNotIn("::-webkit-scrollbar", self.legacy_style)



if __name__ == "__main__":
    unittest.main()
