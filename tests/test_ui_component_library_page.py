import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "ui-component-library.html"
APP = ROOT / "static" / "js" / "ui-component-library" / "catalog-app.js"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
MATRIX_PRESENTATION = ROOT / "static" / "js" / "ui-component-library" / "matrix-presentation.js"
NAVIGATION_COMMAND = ROOT / "static" / "js" / "infinite-canvas-ui" / "navigation-command.js"
NAVIGATION_COMMAND_ROOT = ROOT / "static" / "js" / "infinite-canvas-ui" / "navigation-command"
CORE = ROOT / "static" / "js" / "infinite-canvas-ui" / "core.js"
UI_VERSION = (ROOT / "static" / "js" / "infinite-canvas-ui" / "VERSION").read_text(encoding="utf-8").strip()
NAVIGATION_COMMAND_CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "navigation-command-case.html"
STYLE = ROOT / "static" / "css" / "ui-component-library.css"
PREVIEW_STYLE = ROOT / "static" / "css" / "ui-component-library-preview.css"
SANDBOX_RUNTIME = ROOT / "static" / "js" / "ui-component-library" / "sandbox-runtime.js"
FULL_HARNESS = ROOT / "tests" / "ui_component_library_full_harness.html"
HEADING_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "heading.html"
ACTION_CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "action-case.html"
ACTION_CASE_APP = ROOT / "static" / "js" / "infinite-canvas-ui" / "action-case.js"
HEADING_CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "heading-case.html"
HEADING_STYLE = ROOT / "static" / "css" / "infinite-canvas-ui-component-surfaces.css"
DESIGN_TOKENS = ROOT / "static" / "css" / "design-tokens.css"
DESIGN_TOKEN_EXPLORER = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "design-tokens.html"
DESIGN_TOKEN_EXPLORER_APP = ROOT / "static" / "js" / "ui-component-library" / "design-token-explorer.js"
DESIGN_TOKEN_EXPLORER_STYLE = ROOT / "static" / "css" / "design-token-explorer.css"
EMPTY_STATES = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "empty-states.html"
SEARCH_NAVIGATION_SIDEBAR = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "search-navigation-sidebar.html"
FILE_MEDIA_INPUT_CASE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "file-media-input-case.html"
MENU_POPOVER_CASE = ROOT / "static" / "js" / "infinite-canvas-ui" / "menu-popover-case.js"
MENU_POPOVER = ROOT / "static" / "js" / "infinite-canvas-ui" / "menu-popover.js"
COMPOSER_CASE = ROOT / "static" / "js" / "infinite-canvas-ui" / "composer-case.js"
REFERENCE_THUMBNAIL = ROOT / "static" / "js" / "infinite-canvas-ui" / "file-media-input" / "reference-thumbnail.js"
IMAGE_EDIT_MODE_TOOLBAR_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "image-edit-mode-toolbar.html"
SMART_NODE_TOOLBAR_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "smart-node-toolbar.html"
SMART_NODE_CONTEXT_MENU_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "smart-node-context-menu.html"
SMART_CANVAS_DOCK_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "smart-canvas-dock.html"
SMART_MINIMAP_PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "smart-minimap.html"
BLOCK_STYLES = ROOT / "static" / "js" / "infinite-canvas-ui" / "blocks" / "styles.js"


class UiComponentLibraryPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.app = APP.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.matrix_presentation = MATRIX_PRESENTATION.read_text(encoding="utf-8")
        cls.navigation_command = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(NAVIGATION_COMMAND_ROOT.glob("*.js"))
        )
        cls.core = CORE.read_text(encoding="utf-8")
        cls.navigation_command_case = NAVIGATION_COMMAND_CASE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.preview_style = PREVIEW_STYLE.read_text(encoding="utf-8")
        cls.sandbox_runtime = SANDBOX_RUNTIME.read_text(encoding="utf-8")
        cls.heading_page = HEADING_PAGE.read_text(encoding="utf-8")
        cls.action_case = ACTION_CASE.read_text(encoding="utf-8")
        cls.action_case_app = ACTION_CASE_APP.read_text(encoding="utf-8")
        cls.heading_case = HEADING_CASE.read_text(encoding="utf-8")
        cls.heading_style = HEADING_STYLE.read_text(encoding="utf-8")
        cls.design_tokens = DESIGN_TOKENS.read_text(encoding="utf-8")
        cls.design_token_explorer = DESIGN_TOKEN_EXPLORER.read_text(encoding="utf-8")
        cls.design_token_explorer_app = DESIGN_TOKEN_EXPLORER_APP.read_text(encoding="utf-8")
        cls.design_token_explorer_style = DESIGN_TOKEN_EXPLORER_STYLE.read_text(encoding="utf-8")
        cls.search_navigation_sidebar = SEARCH_NAVIGATION_SIDEBAR.read_text(encoding="utf-8")
        cls.file_media_input_case = FILE_MEDIA_INPUT_CASE.read_text(encoding="utf-8")
        cls.menu_popover_case = MENU_POPOVER_CASE.read_text(encoding="utf-8")
        cls.menu_popover = MENU_POPOVER.read_text(encoding="utf-8")
        cls.composer_case = COMPOSER_CASE.read_text(encoding="utf-8")
        cls.reference_thumbnail = REFERENCE_THUMBNAIL.read_text(encoding="utf-8")
        cls.image_edit_mode_toolbar_page = IMAGE_EDIT_MODE_TOOLBAR_PAGE.read_text(encoding="utf-8")
        cls.smart_node_toolbar_page = SMART_NODE_TOOLBAR_PAGE.read_text(encoding="utf-8")
        cls.smart_canvas_dock_page = SMART_CANVAS_DOCK_PAGE.read_text(encoding="utf-8")
        cls.smart_minimap_page = SMART_MINIMAP_PAGE.read_text(encoding="utf-8")
        cls.block_styles = BLOCK_STYLES.read_text(encoding="utf-8")

    def test_reference_thumbnail_is_visible_in_file_media_input_review(self):
        self.assertIn("['ic-reference-thumbnail', 'Reference Thumbnail', 'file-media-input']", self.surface_app)
        for component_name in (
            "ic-reference-thumbnail-image",
            "ic-reference-thumbnail-video",
            "ic-reference-thumbnail-audio",
            "ic-reference-thumbnail-text",
            "ic-reference-thumbnail-hover",
        ):
            with self.subTest(component_name=component_name):
                self.assertIn(
                    f'data-component-name="{component_name}"',
                    self.file_media_input_case,
                )

    def test_thumb_hovercard_is_visible_in_menu_popover_review(self):
        self.assertIn("['ic-thumb-hovercard', 'Thumb Hovercard', 'menu-popover']", self.surface_app)
        self.assertNotIn("['ic-thumb-hovercard', 'Thumb Hovercard', 'file-media-input']", self.surface_app)
        self.assertIn("?'ic-thumb-hovercard':''", self.menu_popover_case)
        for kind in ("image", "video", "audio", "text"):
            self.assertIn(f'data-thumb-hovercard-kind="{kind}"', self.menu_popover_case)
        self.assertIn("video:{src:'/static/images/test/fixture.mp4'}", self.menu_popover_case)

    def test_reference_generate_menu_is_catalogued_as_a_visible_business_variant(self):
        self.assertIn(
            "['ic-menu', 'Menu · 引用该节点生成', 'menu-popover', 'ic-menu-reference-generate']",
            self.surface_app,
        )
        self.assertIn(
            'data-component-name="ic-menu-reference-generate"',
            self.menu_popover_case,
        )
        self.assertIn('variant="reference-generate"', self.menu_popover_case)
        self.assertIn('data-reference-generate-menu', self.menu_popover_case)
        self.assertIn('data-reference-generate-trigger', self.menu_popover_case)
        self.assertIn('引用该节点生成', self.menu_popover_case)
        for value in ("text", "image", "video"):
            self.assertIn(f'value="{value}"', self.menu_popover_case)
        reference_surface = self.menu_popover.split(
            ':host([variant="reference-generate"]) [part="surface"]{', 1
        )[1].split("}", 1)[0]
        reference_label = self.menu_popover.split(
            ':host([variant="reference-generate"]) ::slotted(.reference-generate-label){', 1
        )[1].split("}", 1)[0]
        self.assertIn("border-radius:var(--ui-radius-m)", reference_surface)
        self.assertIn("font-weight:var(--ui-font-weight-regular)", reference_label)

    def test_composer_reuses_named_reference_thumbnail_variants_and_hovercard(self):
        self.assertIn(
            'data-component-name="ic-reference-thumbnail-image"',
            self.composer_case,
        )
        self.assertIn(
            'data-component-name="ic-reference-thumbnail-text"',
            self.composer_case,
        )
        self.assertIn(
            "document.createElement('ic-thumb-hovercard')",
            self.reference_thumbnail,
        )

    def test_page_loads_public_modules_before_catalog_app(self):
        protocol = self.page.index("/static/js/ui-component-library/sandbox-protocol.js")
        decisions = self.page.index("/static/js/ui-component-library/decision-store.js")
        app = self.page.index("/static/js/ui-component-library/catalog-app.js")

        self.assertLess(protocol, app)
        self.assertLess(decisions, app)

    def test_actions_matrix_uses_component_owned_preview_states(self):
        self.assertNotIn("target-component-demo-hover", self.page)
        self.assertNotIn("target-component-demo-focus", self.page)
        self.assertNotIn("target-component-demo-hover", self.style)
        self.assertNotIn("target-component-demo-focus", self.style)
        self.assertEqual(9, len(re.findall(r'data-component-name="ic-(?:button|icon-button)[^"]*-hover"', self.page)))
        self.assertEqual(9, len(re.findall(r'data-preview-state="hover"', self.page)))
        self.assertNotIn('<th scope="col">键盘焦点</th>', self.page)
        self.assertNotRegex(self.page, r'data-component-name="ic-(?:button|icon-button)[^"]*-focus"')
        self.assertNotIn('data-preview-state="focus-visible"', self.page)
        self.assertNotIn('<th scope="col">按下</th>', self.page)
        self.assertNotRegex(self.page, r'data-component-name="ic-(?:button|icon-button)[^"]*-pressed"')
        self.assertNotIn('data-preview-state="pressed"', self.page)
        self.assertNotIn('data-preview-state="active"', self.page)
        self.assertNotIn('data-component-name="ic-button-ghost', self.page)

    def test_actions_matrix_keeps_horizontal_scrollbar_at_viewport_bottom(self):
        matrix_scroll = re.search(
            r'\.target-component-matrix-scroll\s*\{(?P<rules>[^}]*)\}',
            self.style,
        )
        self.assertIsNotNone(matrix_scroll)
        rules = matrix_scroll.group("rules")
        self.assertIn("height: calc(100vh", rules)
        self.assertIn("overflow: auto", rules)

    def test_actions_case_uses_component_owned_preview_states(self):
        self.assertIn("button.dataset.previewState = state", self.action_case_app)
        for state in ("hover", "focus-visible", "pressed"):
            self.assertNotIn(
                f'.action-state-sample[data-state="{state}"] ic-button::part(base)',
                self.heading_style,
            )

    def test_component_directory_uses_bilingual_section_names_and_chinese_items(self):
        families = (
            "按钮",
            "标题",
            "文本输入",
            "选择与调节",
            "文件与媒体输入",
            "容器与数据展示",
            "导航与命令",
            "对话框",
            "菜单、浮层与提示",
            "反馈与进度",
            "节点",
        )
        for chinese, english in (
            ("基础", "Foundations"),
            ("组件", "Components"),
            ("组合模块", "Blocks"),
            ("参考", "Reference"),
            ("实验", "Experiments"),
        ):
            self.assertRegex(
                self.page,
                rf'<h2[^>]*><span>{chinese}</span><small lang="en">{english}</small></h2>',
            )
        for chinese in families:
            with self.subTest(chinese=chinese):
                self.assertIn(f'label="{chinese}"', self.page)
        self.assertNotIn("Component families", self.page)
        self.assertNotIn("Component specs", self.page)
        self.assertNotIn("Actions · confirmed", self.page)
        self.assertNotIn("Legacy 映射", self.page)
        self.assertIn("组件检查器", self.page)
        self.assertIn("${component.reviewLabel}", self.surface_app)

    def test_target_directory_uses_section_navigation_without_a_rail(self):
        self.assertNotIn('class="target-review-rail"', self.page)
        self.assertNotIn('class="target-review-rail-button', self.page)
        self.assertIn(
            '<nav class="target-review-tabs" data-navigation-pattern="section-navigation" aria-label="组件验收页面">',
            self.page,
        )
        for group, label, english in (
            ("foundations", "基础", "Foundations"),
            ("families", "组件", "Components"),
            ("blocks", "组合模块", "Blocks"),
            ("auxiliary", "参考", "Reference"),
            ("experiments", "实验", "Experiments"),
        ):
            with self.subTest(group=group):
                self.assertRegex(
                    self.page,
                    rf'<section[^>]+data-target-review-group="{group}"[^>]+aria-labelledby="[^"]+">[\s\S]*?<h2[^>]*><span>{label}</span><small lang="en">{english}</small></h2>',
                )
        first_item = re.search(r'<ic-nav-item[^>]+data-target-review="([^"]+)"', self.page)
        self.assertIsNotNone(first_item)
        self.assertEqual(first_item.group(1), "design-tokens")
        self.assertNotIn('data-target-review-group="contract"', self.page)
        self.assertNotIn('data-target-review-group="business"', self.page)
        self.assertNotIn('label="规范"', self.page)
        for experiment in ("动画实验 A", "动画实验 B", "动画性能对比"):
            self.assertRegex(
                self.page,
                rf'<ic-nav-item[^>]+label="{experiment}"[^>]+data-target-review-group="experiments"',
            )
        self.assertRegex(
            self.page,
            r'<ic-nav-item[^>]+data-target-review="actions"[^>]+current="page"',
        )
        sidebar_start = self.page.index('class="target-review-sidebar"')
        sidebar_end = self.page.index('</aside>', sidebar_start)
        search_trigger = self.page.index('data-target-review-search-trigger')
        self.assertLess(sidebar_start, search_trigger)
        self.assertLess(search_trigger, sidebar_end)
        self.assertIn(
            "grid-template-columns: calc(var(--ui-space-24) + var(--ui-space-24) + var(--ui-space-10) + var(--ui-space-2)) minmax(0, 1fr)",
            self.style,
        )
        self.assertNotIn(".target-review-rail", self.style)
        self.assertIn(".target-review-section[data-target-review-group]", self.surface_app)
        self.assertIn("section.toggleAttribute('data-child-current'", self.surface_app)
        self.assertIn("item.setAttribute('current', 'page')", self.surface_app)
        self.assertIn("item.removeAttribute('current')", self.surface_app)
        self.assertNotIn("disclosure.addEventListener('ic-toggle'", self.surface_app)

    def test_target_directory_items_show_english_secondary_names(self):
        expected_names = {
            "design-tokens": "Design tokens",
            "foundations": "Design foundations",
            "scrollbar": "Scrollbar",
            "actions": "Button",
            "heading": "Heading",
            "text-entry": "Text entry",
            "selection-adjustment": "Selection & adjustment",
            "file-media-input": "File & media input",
            "containers-data": "Containers & data",
            "navigation-command": "Navigation & commands",
            "dialog": "Dialogs",
            "menu-popover": "Menus, popovers & tooltips",
            "feedback-progress": "Feedback & progress",
            "nodes": "Nodes",
            "empty-states": "Empty states",
            "generation-failure-feedback": "Generation failure",
            "composer": "Generation editor",
            "prompt-template-library": "Prompt template library",
            "search-navigation-sidebar": "Search navigation sidebar",
            "image-editing": "Image editing",
            "image-edit-mode-toolbar": "Image edit mode toolbar",
            "smart-node-toolbar": "Smart node toolbar",
            "smart-node-context-menu": "Smart node context menu",
            "smart-canvas-dock": "Smart Canvas dock",
            "components": "Component inspector",
            "pending-motion-reference": "Motion experiment A",
            "pending-halftone-reference": "Motion experiment B",
            "pending-performance-prototype": "Motion performance",
        }
        for review, english in expected_names.items():
            with self.subTest(review=review):
                attribute_value = re.escape(english.replace("&", "&amp;"))
                self.assertRegex(
                    self.page,
                    rf'<ic-nav-item[^>]+secondary-label="{attribute_value}"[^>]+data-target-review="{review}"',
                )
        self.assertIn(
            "static observedAttributes = ['label', 'secondary-label', 'href', 'icon', 'current', 'compact']",
            self.navigation_command,
        )
        self.assertIn('class="secondary-label" lang="en"', self.navigation_command)

    def test_components_and_blocks_are_classified_by_reuse_scope(self):
        component_reviews = (
            "text-entry",
            "selection-adjustment",
            "navigation-command",
            "dialog",
            "menu-popover",
            "nodes",
        )
        block_reviews = (
            "composer",
            "prompt-template-library",
            "search-navigation-sidebar",
            "image-editing",
            "image-edit-mode-toolbar",
            "smart-node-toolbar",
            "smart-node-context-menu",
            "smart-canvas-dock",
            "smart-minimap",
        )
        for review in component_reviews:
            with self.subTest(review=review, group="families"):
                self.assertRegex(
                    self.page,
                    rf'<ic-nav-item[^>]+data-target-review="{review}"[^>]+data-target-review-group="families"',
                )
        for review in block_reviews:
            with self.subTest(review=review, group="blocks"):
                self.assertRegex(
                    self.page,
                    rf'<ic-nav-item[^>]+data-target-review="{review}"[^>]+data-target-review-group="blocks"',
                )
        self.assertRegex(
            self.page,
            r'<ic-nav-item[^>]+label="图片编辑区"[^>]+data-target-review="image-editing"',
        )

    def test_smart_minimap_is_catalogued_with_interactive_production_preview(self):
        self.assertRegex(
            self.page,
            r'<ic-nav-item[^>]+secondary-label="Smart minimap"[^>]+data-target-review="smart-minimap"[^>]+data-target-review-group="blocks"',
        )
        self.assertIn("data-smart-minimap-matrix", self.page)
        self.assertIn("['ic-smart-minimap', 'Smart Minimap', 'smart-minimap']", self.surface_app)
        self.assertIn('data-component-name="ic-smart-minimap"', self.smart_minimap_page)
        self.assertIn("ic-minimap-navigate", self.smart_minimap_page)

    def test_target_directory_restores_and_updates_the_hash_selected_state(self):
        self.assertIn("function targetReviewFromHash()", self.surface_app)
        self.assertIn("'replaceState' : 'pushState'", self.surface_app)
        self.assertIn("updateTargetReviewHistory(name, historyMode)", self.surface_app)
        self.assertIn("window.addEventListener('popstate'", self.surface_app)
        self.assertIn("const initialReview = targetReviewFromHash() || 'actions'", self.surface_app)
        self.assertIn("switchTargetReview(initialReview)", self.surface_app)
        self.assertIn(f"./navigation-command.js?v={UI_VERSION}", self.core)

    def test_design_token_explorer_removes_redundant_supporting_copy(self):
        for redundant in (
            'class="token-hero"',
            'class="token-kicker"',
            'class="token-summary"',
            'data-source-status',
            'data-results-description',
            'class="token-description"',
        ):
            with self.subTest(redundant=redundant):
                self.assertNotIn(redundant, self.design_token_explorer)
        self.assertNotIn("resultsDescription", self.design_token_explorer_app)
        self.assertNotIn("statusHost", self.design_token_explorer_app)
        self.assertNotIn(".token-description", self.design_token_explorer_style)
        self.assertIn('placeholder="搜索参数…"', self.design_token_explorer)
        self.assertIn('<h1 data-results-title>全部参数</h1>', self.design_token_explorer)

    def test_design_token_explorer_exposes_safe_editing_and_save_controls(self):
        for marker in (
            "data-token-edit-toggle",
            "data-token-change-count",
            "data-token-discard",
            "data-token-review",
            "data-token-save",
            "data-token-diff-dialog",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.design_token_explorer)
        self.assertIn("/api/admin/design-tokens", self.design_token_explorer_app)
        self.assertIn("data-live-token-overrides", self.design_token_explorer_app)
        self.assertIn("expected_revision", self.design_token_explorer_app)
        self.assertIn("token-edit-field", self.design_token_explorer_style)
        self.assertIn("token-change-bar", self.design_token_explorer_style)

    def test_sidebar_disclosure_icons_cannot_escape_their_control_box(self):
        disclosure_style = re.search(
            r"\.trigger>ic-icon\{(?P<rules>[^}]+)\}",
            self.navigation_command,
        )
        self.assertIsNotNone(disclosure_style)
        rules = disclosure_style.group("rules")
        self.assertIn("inline-size:var(--ui-density-icon-size)", rules)
        self.assertIn("block-size:var(--ui-density-icon-size)", rules)
        self.assertIn("overflow:hidden", rules)
        self.assertIn("contain:size layout paint", rules)

    def test_navigation_component_samples_keep_icons_and_selected_surfaces(self):
        manual_icon_tabs = re.search(
            r'<ic-tabs[^>]+data-legal-combination="horizontal-manual-label-icon"[\s\S]*?</ic-tabs>',
            self.navigation_command_case,
        )
        self.assertIsNotNone(manual_icon_tabs)
        self.assertIn("<ic-icon ", manual_icon_tabs.group(0))

        medium_tabs = re.search(
            r'<ic-tabs[^>]+data-component-name="ic-tabs-medium"[^>]*>',
            self.navigation_command_case,
        )
        self.assertIsNotNone(medium_tabs)
        self.assertIn('data-legal-combination="horizontal-automatic-label"', medium_tabs.group(0))

        selected_segment_rules = re.findall(
            r'(?:::slotted\(\[role="radio"\]\[aria-checked="true"\]\)\s*\{[^}]+\})',
            self.navigation_command,
        )
        self.assertTrue(selected_segment_rules)
        self.assertTrue(all(
            "background:var(--ui-color-surface)" in re.sub(r"\s+", "", rules)
            for rules in selected_segment_rules
        ))

    def test_search_navigation_sidebar_and_section_navigation_are_catalogued(self):
        self.assertIn('label="检索导航侧栏"', self.page)
        self.assertIn('data-target-review="search-navigation-sidebar"', self.page)
        self.assertIn('data-search-navigation-sidebar-matrix', self.page)
        self.assertIn('search-navigation-sidebar.html', self.page)
        self.assertIn("'search-navigation-sidebar': '检索导航侧栏'", self.surface_app)
        self.assertIn("['search-navigation-sidebar', 'Search Navigation Sidebar', 'search-navigation-sidebar']", self.surface_app)
        self.assertIn('data-component-name="search-navigation-sidebar"', self.search_navigation_sidebar)
        self.assertIn('::part(sidebar)', self.search_navigation_sidebar)
        self.assertIn('分区导航 · Section Navigation', self.navigation_command_case)
        self.assertIn('data-component-name="section-navigation"', self.navigation_command_case)
        self.assertIn("['section-navigation', 'Section Navigation', 'navigation-command']", self.surface_app)

    def test_navigation_and_command_review_follows_human_task_groups(self):
        groups = (
            'data-navigation-command-group="view-switching"',
            'data-navigation-command-group="wayfinding"',
            'data-navigation-command-group="pagination"',
            'data-navigation-command-group="commands"',
            'data-navigation-command-group="progress"',
            'data-navigation-command-group="states"',
        )
        positions = [self.navigation_command_case.index(group) for group in groups]
        self.assertEqual(positions, sorted(positions))
        for heading in (
            "视图切换 · View switching",
            "位置导航 · Wayfinding",
            "内容翻页 · Pagination",
            "内容操作 · Commands",
            "流程进度 · Progress",
            "状态 · States",
        ):
            self.assertIn(heading, self.navigation_command_case)
        self.assertNotIn("legal combinations</h2>", self.navigation_command_case)
        self.assertNotIn("Complete states", self.navigation_command_case)
        self.assertLess(
            self.navigation_command_case.index("分区导航 · Section Navigation"),
            self.navigation_command_case.index("Breadcrumb"),
        )
        self.assertNotIn('data-legal-combination="horizontal-menu-overflow"', self.navigation_command_case)
        self.assertNotIn('data-legal-combination="wrap-clip"', self.navigation_command_case)
        self.assertIn('data-legal-combination="vertical-inline-plain"', self.navigation_command_case)
        self.assertIn('data-ui-library-matrix-label="纵向无边框"', self.navigation_command_case)
        self.assertIn('data-legal-combination="inline-clip"', self.navigation_command_case)
        self.assertIn("if (layout !== 'inline') return 'layout must be inline';", self.navigation_command)
        self.assertNotIn(':host([layout="wrap"])', self.navigation_command)
        self.assertIn('data-ui-library-matrix-label="上一页与下一页"', self.navigation_command_case)
        for alias in ("ic-tabs-horizontal", "ic-tabs-horizontal-icon", "ic-tabs-vertical"):
            self.assertIn(f'data-component-name="{alias}"', self.navigation_command_case)
        self.assertNotIn('data-ui-library-matrix-label="横向自动切换"', self.navigation_command_case)
        self.assertNotIn('data-ui-library-matrix-label="横向手动切换"', self.navigation_command_case)
        horizontal_tabs = re.search(
            r'<ic-tabs[^>]+data-component-name="ic-tabs-horizontal"[^>]*>',
            self.navigation_command_case,
        )
        self.assertIsNotNone(horizontal_tabs)
        self.assertIn('space="0.125rem"', horizontal_tabs.group(0))
        self.assertIn('gap:var(--ic-tabs-space,0.125rem)', re.sub(r"\s+", "", self.navigation_command))
        self.assertIn(
            ':host([data-legal-combination="horizontal-automatic-label"]){border-radius:10px}',
            re.sub(r"\s+", "", self.navigation_command),
        )
        self.assertIn('border-radius:var(--ui-radius-s)', re.sub(r"\s+", "", self.navigation_command))
        self.assertIn('font-size:var(--ic-navigation-font-size)!important', re.sub(r"\s+", "", self.navigation_command))
        self.assertNotIn('data-component-name="ic-tabs-horizontal-automatic-label"', self.navigation_command_case)
        for alias in ("ic-segmented-control", "ic-segmented-control-icon"):
            self.assertIn(f'data-component-name="{alias}"', self.navigation_command_case)
        self.assertNotIn('data-component-name="ic-segmented-control-single-label"', self.navigation_command_case)
        self.assertNotIn('data-component-name="ic-segmented-control-single-icon-label"', self.navigation_command_case)
        segmented_source = re.sub(r"\s+", "", self.navigation_command)
        self.assertIn("border:var(--ui-border-width-thin)solidvar(--ui-color-border-segmented-control)", segmented_source)
        self.assertIn("border-radius:10px", segmented_source)
        self.assertIn("border-radius:var(--ui-radius-s)", segmented_source)
        self.assertIn(
            'outline:var(--ui-border-width-thin)solidvar(--ui-color-border-secondary)',
            segmented_source,
        )
        self.assertIn('outline-offset:0', segmented_source)
        self.assertIn(
            "--ui-color-border-segmented-control: var(--ui-palette-gray-100);",
            self.design_tokens,
        )
        for size, height, font_size, padding in (
            ("small", "--ui-control-height-s", "--ui-font-size-1", "var(--ui-space-2)"),
            ("medium", "--ui-control-height-m", "--ui-font-size-2", "10px"),
            ("large", "--ui-control-height-l", "--ui-font-size-3", "var(--ui-space-3)"),
        ):
            with self.subTest(size=size):
                size_rule = re.search(rf':host\(\[size="{size}"\]\)\{{(?P<rules>[^}}]+)\}}', segmented_source)
                self.assertIsNotNone(size_rule)
                rules = size_rule.group("rules")
                self.assertIn(f"--ic-navigation-control-height:var({height})", rules)
                self.assertIn(f"--ic-navigation-font-size:var({font_size})", rules)
                self.assertIn(f"--ic-navigation-inline-padding:{padding}", rules)
        self.assertIn(
            '::slotted([role="radio"]:hover:not(:disabled):not([aria-checked="true"]))',
            self.navigation_command,
        )

    def test_component_reviews_use_matrix_without_the_removed_layout_switch(self):
        self.assertNotIn('data-target-presentation-control', self.page)
        self.assertNotIn('data-target-presentation-status', self.page)
        self.assertNotIn('原始布局', self.page)
        matrix_script = self.page.index(
            "/static/js/ui-component-library/matrix-presentation.js"
        )
        surface_script = self.page.index(
            "/static/js/ui-component-library/surface-app.js"
        )
        self.assertLess(matrix_script, surface_script)
        self.assertIn("matrixPresentation.apply(previewDocument)", self.surface_app)
        self.assertNotIn("TARGET_PRESENTATION_STORAGE_KEY", self.surface_app)
        self.assertNotIn("authored", self.surface_app)
        self.assertNotIn("needsDecision", self.surface_app)

    def test_preview_matrix_adapter_builds_semantic_tables_as_the_only_layout(self):
        for selector in (
            "[data-heading-combinations]",
            ".grid",
            ".text-entry-size-grid",
            ".selection-combination-grid",
            ".selection-size-grid",
            "[data-selection-states]",
            ".image-frame-grid",
            ".launchers",
            ".node-runtime-grid",
            ".generation-recovery-grid",
        ):
            with self.subTest(selector=selector):
                self.assertIn(selector, self.matrix_presentation)
        self.assertIn("createElement('table')", self.matrix_presentation)
        self.assertIn("columnHeader.scope = 'col'", self.matrix_presentation)
        self.assertIn("rowHeader.scope = 'row'", self.matrix_presentation)
        self.assertNotIn("function restore", self.matrix_presentation)
        self.assertNotIn("requestedMode", self.matrix_presentation)
        self.assertNotIn("authored", self.matrix_presentation)
        self.assertNotIn("needsDecision", self.matrix_presentation)
        self.assertNotIn("needsWidthDecision", self.matrix_presentation)
        self.assertIn(".ui-library-state-matrix", self.preview_style)

    def test_target_review_uses_one_global_theme_and_direct_case_previews(self):
        self.assertIn("data-target-theme-toggle", self.page)
        self.assertIn("data-target-review-title", self.page)
        self.assertIn("applyTargetTheme", self.surface_app)
        self.assertIn("prepareTargetPreviewDocument", self.surface_app)
        self.assertIn("root.dataset.uiLibraryLayout = 'compact'", self.surface_app)
        for case in (
            "heading-case.html",
            "text-entry-case.html",
            "selection-adjustment-case.html",
            "file-media-input-case.html",
            "containers-data-case.html",
            "navigation-command-case.html",
            "dialog-case.html",
            "menu-popover-case.html",
            "feedback-progress-case.html",
        ):
            with self.subTest(case=case):
                self.assertIn(case, self.page)
        self.assertIn("ui-component-library-preview.css", self.surface_app)
        self.assertIn('html[data-ui-library-layout="compact"]', self.preview_style)
        self.assertIn("body > main > header:first-child", self.preview_style)
        self.assertIn(".action-case-section > header span", self.preview_style)
        self.assertIn(
            'html[data-feedback-progress-case-status][data-ui-library-layout="compact"]',
            self.preview_style,
        )
        self.assertRegex(
            self.preview_style,
            r'html\[data-feedback-progress-case-status\][^{]+\{\s*background: var\(--ui-color-surface\) !important;',
        )
        self.assertNotRegex(self.preview_style, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")
        self.assertNotIn("--ui-palette-", self.preview_style)
        self.assertIn("component-name-tag.js", self.action_case)
        self.assertIn("component-name-tag.js", self.heading_case)
        self.assertIn("data-component-name=", self.action_case)
        self.assertIn("data-actions-matrix", self.page)
        self.assertIn("component-name-tag.js", self.page)

    def test_actions_review_matches_scheme_c_comparison_matrices(self):
        self.assertIn('class="target-component-matrix" data-actions-matrix', self.page)
        self.assertNotRegex(
            self.page,
            r'<iframe[^>]+data-actions-matrix',
        )
        for label in (
            "状态矩阵",
            "类型",
            "默认",
            "悬停",
            "处理中",
            "不可用",
            "尺寸与组合",
            "超小",
            "小",
            "中",
            "大",
        ):
            with self.subTest(label=label):
                self.assertIn(label, self.page)
        for component_name in (
            "ic-button-primary",
            "ic-button-primary-hover",
            "ic-button-primary-loading",
            "ic-button-primary-disabled",
            "ic-button-primary-danger",
            "ic-button-primary-danger-hover",
            "ic-button-primary-danger-loading",
            "ic-button-primary-danger-disabled",
            "ic-button-secondary-danger",
            "ic-button-secondary-danger-hover",
            "ic-button-secondary-danger-loading",
            "ic-button-secondary-danger-disabled",
            "ic-button-tertiary-danger",
            "ic-button-tertiary-danger-hover",
            "ic-button-tertiary-danger-loading",
            "ic-button-tertiary-danger-disabled",
            "ic-button-tertiary",
            "ic-button-tertiary-hover",
            "ic-button-tertiary-loading",
            "ic-button-tertiary-disabled",
            "ic-icon-button-primary",
            "ic-icon-button-primary-hover",
            "ic-icon-button-primary-loading",
            "ic-icon-button-primary-disabled",
            "ic-icon-button-secondary",
            "ic-icon-button-secondary-hover",
            "ic-icon-button-secondary-loading",
            "ic-icon-button-secondary-disabled",
            "ic-icon-button-tertiary",
            "ic-icon-button-tertiary-hover",
            "ic-icon-button-tertiary-loading",
            "ic-icon-button-tertiary-disabled",
            "ic-button-xsmall",
            "ic-button-group-horizontal",
        ):
            with self.subTest(component_name=component_name):
                self.assertIn(
                    f'data-component-name="{component_name}"',
                    self.page,
                )
        for label in ("一级图标按钮", "二级图标按钮", "三级图标按钮"):
            with self.subTest(label=label):
                self.assertIn(f'<th scope="row">{label}</th>', self.page)
        for legacy_name in (
            "ic-icon-button-ghost",
            "ic-icon-button-ghost-hover",
            "ic-icon-button-ghost-loading",
            "ic-icon-button-ghost-disabled",
            "ic-icon-button",
            "ic-icon-button-hover",
            "ic-icon-button-loading",
            "ic-icon-button-disabled",
        ):
            with self.subTest(legacy_name=legacy_name):
                self.assertNotIn(f'data-component-name="{legacy_name}"', self.page)
        self.assertIn("component-name-tag.js", self.page)
        self.assertIn(".target-component-matrix-table", self.style)
        self.assertIn("visibleFrame?.contentDocument || document", self.surface_app)
        self.assertNotRegex(
            self.page,
            r'<ic-tabs[^>]+data-legal-combination=',
        )

    def test_toolbar_blocks_use_public_production_elements_without_case_style_overrides(self):
        self.assertIn('data-component-name="ic-image-edit-mode-toolbar"', self.image_edit_mode_toolbar_page)
        self.assertIn('data-component-name="ic-smart-node-toolbar"', self.smart_node_toolbar_page)
        self.assertIn('data-component-name="ic-smart-canvas-dock-left"', self.smart_canvas_dock_page)
        self.assertIn('data-component-name="ic-smart-canvas-dock-bottom"', self.smart_canvas_dock_page)
        self.assertIn("['ic-image-edit-mode-toolbar', 'Image Edit Mode Toolbar', 'image-edit-mode-toolbar']", self.surface_app)
        self.assertIn("['ic-smart-node-toolbar', 'Smart Node Toolbar', 'smart-node-toolbar']", self.surface_app)
        self.assertIn("['ic-smart-canvas-dock', 'Smart Canvas Dock', 'smart-canvas-dock']", self.surface_app)
        self.assertNotIn('ic-image-edit-mode-toolbar::part', self.image_edit_mode_toolbar_page)
        self.assertNotIn('ic-smart-node-toolbar::part', self.smart_node_toolbar_page)
        self.assertNotIn('ic-smart-canvas-dock::part', self.smart_canvas_dock_page)
        self.assertIn('ic-image-edit-mode-toolbar::part(surface)', self.block_styles)
        image_edit_surface_rule = self.block_styles.split('ic-image-edit-mode-toolbar::part(surface) {', 1)[1].split('}', 1)[0]
        self.assertIn('border-radius:10px', image_edit_surface_rule)
        self.assertIn('ic-smart-node-toolbar::part(surface)', self.block_styles)
        self.assertIn('ic-smart-canvas-dock.smart-canvas-dock', self.block_styles)
        dock_surface_rule = self.block_styles.split('ic-smart-canvas-dock.smart-canvas-dock {', 1)[1].split('}', 1)[0]
        dock_item_rule = self.block_styles.split('ic-smart-canvas-dock .smart-canvas-dock-btn {', 1)[1].split('}', 1)[0]
        self.assertIn('border-radius:var(--ui-radius-l)', dock_surface_rule)
        self.assertIn('--ic-smart-canvas-dock-cross-size:calc(var(--ui-control-height-s) + 2 * var(--ui-space-2))', dock_surface_rule)
        self.assertIn('color:var(--ui-color-text-secondary)', dock_item_rule)
        self.assertNotIn('color:var(--ui-color-text-tertiary)', dock_item_rule)
        self.assertIn("'ic-smart-canvas-dock'", (ROOT / "static/js/infinite-canvas-ui/component-name-tag.js").read_text(encoding="utf-8"))
        component_name_tags = (ROOT / "static/js/infinite-canvas-ui/component-name-tag.js").read_text(encoding="utf-8")
        self.assertIn("namedCompositeAncestor", component_name_tags)
        self.assertIn("node.dataset.legalCombination && namedCompositeAncestor", component_name_tags)

    def test_smart_node_context_menu_is_catalogued_as_a_block(self):
        self.assertTrue(
            SMART_NODE_CONTEXT_MENU_PAGE.exists(),
            "The production smart-node context menu needs a component-library preview page.",
        )
        context_menu_page = SMART_NODE_CONTEXT_MENU_PAGE.read_text(encoding="utf-8")
        self.assertRegex(
            self.page,
            r'<ic-nav-item[^>]+secondary-label="Smart node context menu"[^>]+data-target-review="smart-node-context-menu"[^>]+data-target-review-group="blocks"',
        )
        self.assertIn("data-smart-node-context-menu-matrix", self.page)
        self.assertIn(
            "/static/design-system/infinite-canvas-ui/smart-node-context-menu.html",
            self.page,
        )
        self.assertIn("'smart-node-context-menu': '节点右键菜单'", self.surface_app)
        self.assertIn(
            "['ic-smart-node-context-menu', 'Smart Node Context Menu', 'smart-node-context-menu']",
            self.surface_app,
        )
        self.assertIn('data-component-name="ic-smart-node-context-menu"', context_menu_page)
        self.assertIn("<ic-smart-node-context-menu", context_menu_page)
        self.assertIn("复制节点 ID", context_menu_page)

    def test_target_directory_exposes_smart_canvas_empty_states(self):
        empty_states = EMPTY_STATES.read_text(encoding="utf-8")
        feedback_progress = (
            ROOT / "static" / "design-system" / "infinite-canvas-ui" / "feedback-progress-case.html"
        ).read_text(encoding="utf-8")
        self.assertIn('<ic-nav-item label="空状态"', self.page)
        self.assertIn('data-empty-states-matrix', self.page)
        self.assertIn('/static/design-system/infinite-canvas-ui/empty-states.html', self.page)
        self.assertIn("'empty-states': '空状态'", self.surface_app)
        self.assertIn("['ic-empty-state', 'Empty State', 'empty-states']", self.surface_app)
        self.assertNotIn("['ic-empty-state', 'Empty State', 'feedback-progress']", self.surface_app)
        self.assertIn('data-component-name="ic-empty-state"', empty_states)
        self.assertEqual(2, empty_states.count('<ic-empty-state'))
        self.assertNotIn('<ic-empty-state', feedback_progress)
        for component_name in (
            "smart-canvas-far-generation-pending",
            "smart-canvas-far-prompt-skeleton",
            "smart-canvas-far-smart-group-media-skeleton",
            "smart-canvas-far-audio-placeholder",
            "smart-canvas-far-video-placeholder",
        ):
            with self.subTest(component_name=component_name):
                self.assertIn(f'data-component-name="{component_name}"', empty_states)
                self.assertIn(component_name, self.surface_app)
        self.assertIn('/static/css/smart-canvas.css', empty_states)

    def test_narrow_sidebar_backdrop_uses_the_global_overlay_semantic(self):
        self.assertIn("background: var(--ui-color-backdrop);", self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")
        self.assertNotIn("--ui-palette-", self.style)

    def test_manifest_failure_is_blocking_without_embedded_fallback(self):
        self.assertIn("/static/design-system/live-catalog/manifest.json", self.app)
        self.assertIn("cache: 'no-store'", self.app)
        self.assertIn("Manifest 无法加载", self.app)
        self.assertNotIn("__COMPONENT_DATA__", self.page)
        self.assertNotIn("fallbackManifest", self.app)

    def test_candidate_iframe_uses_the_opaque_origin_sandbox(self):
        self.assertIn("iframe.setAttribute('sandbox', 'allow-scripts')", self.app)
        self.assertIn(
            "'/static/design-system/live-catalog/sandbox.html?v=",
            self.app,
        )
        self.assertNotIn("allow-same-origin", self.app)
        self.assertNotIn("allow-forms", self.app)
        self.assertNotIn("allow-downloads", self.app)
        self.assertNotIn("allow-top-navigation", self.app)

    def test_derived_requirement_is_a_record_only_form(self):
        self.assertIn("data-derived-requirement", self.app)
        self.assertIn("派生要求只记录契约，不生成预览", self.app)
        self.assertNotIn("derived-preview", self.app)

    def test_button_decision_slots_are_grouped_by_layout_and_size(self):
        for content_form in (
            "icon-stacked",
            "icon-inline",
            "text-only",
            "icon-only",
        ):
            self.assertIn(f"'{content_form}'", self.app)
        self.assertIn("decisionApi.targetDimensions(target)", self.app)
        self.assertIn("种内容布局 ×", self.app)
        self.assertIn("如何创建这个槽位", self.app)
        self.assertIn("选择现有候选作为基准", self.app)
        self.assertIn("记录一个待实现的派生要求", self.app)

    def test_catalog_exposes_state_controls_reset_and_source_evidence(self):
        self.assertIn("data-fixture-state-preview", self.app)
        self.assertIn("data-fixture-reset-all", self.app)
        self.assertIn("源码与核验依据", self.app)
        self.assertIn("stateReferences", self.app)
        self.assertNotIn('<select data-fixture-state', self.app)

    def test_catalog_lists_every_appearance_and_interaction_as_a_preview(self):
        self.assertIn("candidate.coverage?.componentStates", self.app)
        self.assertIn("candidate.coverage?.interactionStates", self.app)
        self.assertIn("previewStates(candidate)", self.app)
        self.assertIn("postFixtureState(iframe, state)", self.app)

    def test_candidate_header_hides_technical_identity_in_collapsed_evidence(self):
        self.assertIn('class="source-evidence-meta"', self.app)
        self.assertNotIn("<p>${escapeHtml(candidate.id)} · ${escapeHtml(candidate.sourceHash)}</p>", self.app)

    def test_every_candidate_exposes_a_readable_business_path(self):
        self.assertIn("data-component-path", self.app)
        self.assertIn("candidateUsagePaths(candidate)", self.app)
        self.assertIn("设置", self.app)
        self.assertIn("即梦 CLI 模块", self.app)
        self.assertIn("componentPathLabel", self.app)
        self.assertIn("usagePath(candidate, source)", self.app)
        self.assertIn("pathSegmentKey", self.app)

    def test_business_paths_use_the_current_settings_navigation_names(self):
        for surface in (
            "数据存储位置",
            "账号管理",
            "UI 组件库",
            "API 设置",
            "可用模型管理",
            "工作流设置",
        ):
            self.assertIn(f"'{surface}'", self.app)
        self.assertIn("['ComfyUI 设置', '工作流设置']", self.app)
        self.assertIn("['模型管理', '可用模型管理']", self.app)
        self.assertIn("sourceSurface(source)", self.app)

    def test_sandbox_flattens_source_ancestors_without_dropping_selector_context(self):
        self.assertIn("dataset.liveFixtureContextWrapper", self.sandbox_runtime)
        self.assertIn("setProperty('display', 'contents', 'important')", self.sandbox_runtime)
        self.assertIn("dataset.liveFixtureWidthFallback", self.sandbox_runtime)

    def test_every_retained_candidate_is_searchable_as_a_live_fixture(self):
        self.assertIn("data-candidate-search", self.app)
        self.assertIn("renderLiveCandidates", self.app)
        self.assertIn("candidate.fixture", self.app)
        self.assertIn("data-fixture-retry", self.app)
        self.assertIn("data-fixture-error", self.app)
        self.assertNotIn("待建立 Live Fixture 的库存", self.app)
        self.assertNotIn("inventory-only：保留来源证据", self.app)
        self.assertNotIn("candidate.appearances", self.app)
        self.assertNotIn("candidate.styles", self.app)

    def test_full_browser_harness_audits_every_fixture_in_an_opaque_sandbox(self):
        harness = FULL_HARNESS.read_text(encoding="utf-8")
        self.assertIn('sandbox="allow-scripts"', harness)
        self.assertNotIn("allow-same-origin", harness)
        self.assertIn("manifest.candidates", harness)
        self.assertIn("fixture-ready", harness)
        self.assertIn("fixture-error", harness)
        self.assertIn("rendered", harness)
        self.assertIn("set-state", harness)
        self.assertIn("data-audit-complete", harness)

    def test_heading_page_previews_every_composed_text_token(self):
        defined_tokens = set(re.findall(
            r"^\s*(--ui-text-[\w-]+):",
            self.design_tokens,
            flags=re.MULTILINE,
        ))
        previewed_tokens = {
            f"--ui-text-{name}"
            for name in re.findall(
                r'data-heading-text-token="([\w-]+)"',
                self.heading_page,
            )
        }

        self.assertEqual(defined_tokens, previewed_tokens)
        self.assertEqual(9, len(previewed_tokens))
        self.assertEqual(
            9,
            self.heading_page.count("data-heading-token-metrics"),
        )
        for token in previewed_tokens:
            with self.subTest(token=token):
                self.assertIn(f"font: var({token});", self.heading_style)


if __name__ == "__main__":
    unittest.main()
