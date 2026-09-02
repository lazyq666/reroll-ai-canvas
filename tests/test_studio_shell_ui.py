import struct
import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class StudioShellUiRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/index.html").read_text(encoding="utf-8")
        cls.styles = (ROOT / "static/css/studio-shell.css").read_text(encoding="utf-8")
        cls.script = (ROOT / "static/js/studio-shell.js").read_text(encoding="utf-8")
        cls.icons = (ROOT / "static/js/infinite-canvas-ui/icon.js").read_text(encoding="utf-8")

    def test_current_navigation_uses_ic_nav_item_public_state(self):
        self.assertIn("<ic-nav-item", self.page)
        self.assertNotIn('class="nav-item', self.page)
        self.assertIn("item.setAttribute('current', 'page')", self.script)
        self.assertIn("item.removeAttribute('current')", self.script)

    def test_infinite_canvas_navigation_uses_the_pointer_canvas_icon(self):
        self.assertIn('data-page="canvas" href="#canvas" icon="infinite-canvas"', self.page)
        self.assertIn("'infinite-canvas': 'MousePointerSquareDashed'", self.icons)

    def test_online_generation_navigation_uses_the_zap_icon(self):
        self.assertIn('data-page="online" href="#online" icon="online-generate"', self.page)
        self.assertIn("'online-generate': 'Zap'", self.icons)
        self.assertIn("sparkles: 'Zap'", self.icons)

    def test_current_sidebar_navigation_uses_selected_background(self):
        self.assertIn("--ic-nav-item-selected-background: var(--ui-color-action-secondary-selected)", self.styles)
        self.assertIn("--ic-nav-item-selected-color: var(--ui-color-text-primary)", self.styles)
        self.assertIn("--ic-nav-item-selected-shadow: var(--ui-shadow-none)", self.styles)
        self.assertIn(".sidebar ic-nav-item[current]::part(base)", self.styles)
        self.assertIn(".sidebar:not(.is-pinned) .local-nav-disclosure[data-child-current]::part(base)", self.styles)
        self.assertIn("background: var(--ui-color-action-secondary-selected);", self.styles)
        self.assertIn("box-shadow: var(--ui-shadow-none);", self.styles)

    def test_open_local_navigation_is_not_selected_when_an_external_page_is_current(self):
        self.assertIn(".local-nav-disclosure[open]:not([data-child-current])::part(base)", self.styles)
        self.assertIn("background: transparent;", self.styles)
        self.assertIn("font-weight: var(--ui-font-weight-regular);", self.styles)
        self.assertIn(".local-nav-disclosure[open]:not([data-child-current]):hover::part(base)", self.styles)
        self.assertIn("background: var(--ui-color-action-tertiary-hover);", self.styles)
        self.assertIn(".sidebar.is-pinned .local-nav-disclosure[data-child-current]:not([open])::part(base)", self.styles)

    def test_settings_uses_the_same_icon_button_treatment_as_language(self):
        self.assertIn('<ic-icon-button id="settings-fold-toggle"', self.page)
        self.assertIn('hierarchy="quiet" icon="settings" label="设置"', self.page)
        self.assertNotIn(".settings-trigger.active::part(base)", self.styles)
        self.assertNotIn("settings-fold-toggle')?.classList.toggle('active'", self.script)

    def test_token_review_theme_is_stable_and_exposed_to_css(self):
        script = (ROOT / "static/js/theme.js").read_text(encoding="utf-8")
        smart_script = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")

        self.assertIn("token-review-theme", script)
        self.assertIn("document.documentElement.dataset.uiTheme = next", script)
        self.assertIn("const next = REVIEW_THEME ||", script)
        self.assertIn("window.StudioTheme?.get?.()", smart_script)

    def test_theme_script_contains_no_application_ui_scaling_runtime(self):
        script = (ROOT / "static/js/theme.js").read_text(encoding="utf-8")

        for scaling_contract in (
            "StudioScale",
            "studio_ui_scale_mode",
            "studio-ui-scale",
            "studio-scale-managed",
            "--studio-ui-scale",
            "applyScale",
            "autoScale",
        ):
            self.assertNotIn(scaling_contract, script)

    def test_infinite_canvas_precedes_collapsed_local_tools(self):
        canvas = self.page.index('data-page="canvas"')
        online = self.page.index('data-page="online"')
        divider = self.page.index('<ic-divider class="navigation-divider"')
        local = self.page.index('id="local-nav-disclosure"')
        self.assertLess(canvas, online)
        self.assertLess(online, divider)
        self.assertLess(divider, local)
        self.assertIn('<ic-nav-disclosure id="local-nav-disclosure"', self.page)
        self.assertIn("localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) !== '0'", self.script)

    def test_fresh_device_opens_infinite_canvas_by_default(self):
        self.assertIn("const DEFAULT_PAGE_ID = 'canvas';", self.script)

    def test_designer_does_not_see_admin_settings_button(self):
        script = (ROOT / "static/js/account-ui.js").read_text(encoding="utf-8")

        self.assertIn("settingsMenu.hidden = !admin", script)
        self.assertIn("byId(id)?.removeAttribute('data-src')", script)

    def test_language_button_exposes_a_translated_accessible_label(self):
        self.assertIn('id="lang-toggle-btn"', self.page)
        self.assertIn('icon="language"', self.page)
        self.assertIn("button.setAttribute('label', tr(isEnglish ?", self.script)

    def test_shell_landmarks_and_embedded_page_titles_are_localized(self):
        for attribute in (
            'data-i18n-aria-label="common.primaryNavigation"',
            'data-i18n-aria-label="common.pages"',
            'data-i18n-label="common.interfaceOptions"',
            'data-i18n-label="common.settingsMenu"',
            'data-i18n-label="common.account"',
            'data-i18n-aria-label="common.mainContent"',
        ):
            self.assertIn(attribute, self.page)
        self.assertEqual(10, self.page.count("data-i18n-title="))

    def test_collapsed_sidebar_hides_account_copy_and_centers_vertical_utilities(self):
        self.assertIn(".sidebar:not(.is-pinned) .account-trigger-copy", self.styles)
        self.assertIn(".shell-utilities {", self.styles)
        self.assertIn("align-self: center", self.styles)
        self.assertIn('orientation="vertical"', self.page)
        self.assertIn('class="account-trigger-copy"', self.page)

    def test_sidebar_expands_only_from_logo_toggle(self):
        self.assertIn('<ic-button id="sidebarLogoToggle"', self.page)
        self.assertIn('class="sidebar-logo-area"', self.page)
        self.assertIn('class="sidebar-logo-image sidebar-logo-wordmark" src="/static/images/brand/wordmark.svg"', self.page)
        self.assertIn('class="sidebar-logo-image sidebar-logo-mark" src="/static/images/brand/logo.svg"', self.page)
        self.assertNotIn('class="sidebar-logo-core"', self.page)
        self.assertNotIn('class="sidebar-logo-dot"', self.page)
        self.assertNotIn('id="sidebarLogoToggle" class="sidebar-logo-toggle" type="button" hierarchy="secondary" icon="app"', self.page)
        self.assertIn(".sidebar.is-pinned {", self.styles)
        self.assertIn("sidebar.classList.toggle('is-pinned', pinned)", self.script)
        self.assertNotIn(".sidebar:hover", self.styles)
        self.assertNotIn(".sidebar.is-settings-menu-open", self.styles)
        self.assertNotRegex(
            self.styles,
            r"\.sidebar-logo-area\s*\{[^}]*padding-block:",
        )
        self.assertRegex(
            self.styles,
            r"\.sidebar-logo-toggle:hover::part\(base\),\s*\.sidebar-logo-toggle:focus-within::part\(base\)\s*\{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;",
        )
        self.assertIn("--sidebar-logo-size: calc(var(--ui-control-height-m) + var(--ui-control-height-m) + var(--ui-space-1));", self.styles)
        self.assertIn("width: 100%;", self.styles)
        self.assertRegex(
            self.styles,
            r"\.sidebar\s*\{[^}]*transition: none;",
        )
        self.assertIn(".sidebar-logo-image {", self.styles)
        self.assertIn("--ui-density-inline-padding: var(--ui-space-0);", self.styles)
        self.assertIn(".sidebar-logo-wordmark {", self.styles)
        self.assertIn(".sidebar-logo-mark {", self.styles)
        self.assertIn(".sidebar.is-pinned .sidebar-logo-wordmark {", self.styles)
        self.assertIn(".sidebar.is-pinned .sidebar-logo-mark {", self.styles)
        self.assertNotIn(".sidebar.is-pinned .sidebar-logo-toggle", self.styles)
        self.assertNotIn(".sidebar-logo-toggle:active", self.styles)

    def test_browser_favicon_is_a_square_png_separate_from_brand_artwork(self):
        favicon = (ROOT / "static/images/brand/favicon.png").read_bytes()

        self.assertIn('href="/static/images/brand/favicon.png?v=2026.08.29.reroll.1" type="image/png"', self.page)
        self.assertEqual(favicon[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", favicon[16:24]), (128, 128))

    def test_local_tools_follow_the_figma_grouped_list_structure(self):
        self.assertIn('icon="project-default" open-icon="project"', self.page)
        self.assertIn('<ic-nav-disclosure id="local-nav-disclosure"', self.page)
        self.assertNotIn('data-page="zimage" href="#zimage" icon=', self.page)
        self.assertIn("byId('local-nav-disclosure')?.toggleAttribute('open', !collapsed)", self.script)
        self.assertIn("byId('local-nav-disclosure')?.addEventListener('ic-toggle'", self.script)
        self.assertIn("setSidebarPinned(true)", self.script)

    def test_collapsed_primary_navigation_exposes_tooltips(self):
        self.assertEqual(self.page.count('data-collapsed-tooltip-key='), 3)
        self.assertIn('<ic-tooltip id="sidebar-tooltip"', self.page)
        self.assertIn('content="展开导航栏" placement="inline-end"', self.page)
        self.assertIn("function showSidebarTooltip(item)", self.script)
        self.assertIn("tooltip.show(sidebarTooltipAnchor(item))", self.script)
        self.assertNotIn("item.setAttribute('title', label)", self.script)
        self.assertNotIn('id="sidebarLogoToggle" class="sidebar-logo-toggle" type="button" hierarchy="quiet" aria-label="展开导航栏" title=', self.page)

    def test_collapsed_settings_and_account_controls_are_icon_only_and_centered(self):
        self.assertIn('<ic-icon-button id="settings-fold-toggle"', self.page)
        self.assertIn(".sidebar:not(.is-pinned) .account-menu-trigger", self.styles)
        self.assertIn("width: var(--ui-control-height-m)", self.styles)
        self.assertIn("height: var(--ui-control-height-m)", self.styles)
        self.assertIn("justify-content: center", self.styles)
        self.assertIn("border-radius: var(--ui-radius-pill)", self.styles)

    def test_account_trigger_uses_small_label_badge_and_centers_expanded_content(self):
        self.assertIn(
            '<ic-badge id="account-trigger-role" data-component-name="ic-badge-label-small" kind="label" size="small" tone="neutral">',
            self.page,
        )
        self.assertRegex(
            self.styles,
            r'\.account-menu-trigger::part\(base\)\s*\{[^}]*justify-content: center',
        )
        self.assertRegex(
            self.styles,
            r'\.account-trigger-copy\s*\{[^}]*flex: 0 1 auto;[^}]*justify-content: center',
        )

    def test_sidebar_foreground_uses_the_theme_aware_text_semantic(self):
        self.assertIn("--studio-sidebar-foreground: var(--ui-color-text-primary)", self.styles)
        self.assertNotIn("--ui-palette-", self.styles)
        self.assertIn("--ic-nav-item-color: var(--studio-sidebar-foreground)", self.styles)

    def test_sidebar_uses_surface_background(self):
        sidebar_start = self.styles.index("\n.sidebar {")
        sidebar_end = self.styles.index("\n}", sidebar_start)
        sidebar_rule = self.styles[sidebar_start:sidebar_end]
        self.assertIn("background: var(--ui-color-surface);", sidebar_rule)
        self.assertNotIn("background: var(--ui-color-surface-canvas);", sidebar_rule)

    def test_collapsed_primary_navigation_uses_one_centered_control_box(self):
        self.assertIn(".sidebar:not(.is-pinned) .global-navigation > ic-nav-item", self.styles)
        self.assertIn("width: var(--ui-control-height-m)", self.styles)
        self.assertIn("height: var(--ui-control-height-m)", self.styles)
        self.assertIn(".sidebar:not(.is-pinned) .local-nav-disclosure::part(base)", self.styles)

    def test_language_and_theme_controls_are_vertical(self):
        self.assertIn(
            'class="shell-utilities" label="界面选项" '
            'data-i18n-label="common.interfaceOptions" appearance="plain" '
            'orientation="vertical"',
            self.page,
        )

    def test_settings_uses_public_ic_menu_contract(self):
        self.assertIn('<ic-menu id="settings-menu"', self.page)
        self.assertIn(
            'label="设置" data-i18n-label="common.settingsMenu" '
            'trigger="dropdown" selection="command"',
            self.page,
        )
        self.assertNotIn('<ic-menu id="settings-menu" label="设置" placement="inline-end" alignment="end" size="small"', self.page)
        self.assertIn('<ic-menu-item id="preferences-entry"', self.page)
        self.assertIn("menu.show(trigger)", self.script)
        self.assertIn("menu.hide('trigger')", self.script)
        self.assertNotIn("smart-node-context-menu", self.page)

    def test_settings_menu_closes_from_parent_and_iframe_blank_clicks(self):
        self.assertIn("frame.contentDocument?.addEventListener('pointerdown', closeShellMenus, true)", self.script)
        self.assertIn("function closeShellMenus()", self.script)
        self.assertIn("menu.hide('navigation')", self.script)

    def test_canvas_route_survives_studio_shell_refresh(self):
        self.assertIn("const CANVAS_ROUTE_KEY = 'studio_canvas_route';", self.script)
        self.assertIn("function normalizeCanvasFrameRoute(value)", self.script)
        self.assertIn("url.origin !== window.location.origin", self.script)
        self.assertIn("!url.searchParams.get('id')", self.script)
        self.assertIn("sessionStorage.setItem(CANVAS_ROUTE_KEY, route)", self.script)
        self.assertIn("sessionStorage.removeItem(CANVAS_ROUTE_KEY)", self.script)

        restore_start = self.script.index("function restoreActivePage(user)")
        restore_end = self.script.index("function toggleMenu", restore_start)
        restore = self.script[restore_start:restore_end]
        self.assertLess(
            restore.index("restoreCanvasFrameRoute()"),
            restore.index("switchUI("),
        )
        self.assertIn("if (frame.id === 'frame-canvas') rememberCanvasFrameRoute(frame)", self.script)

    def test_default_account_capacity_is_forty(self):
        auth_source = (
            ROOT
            / "backend"
            / "infinite_canvas"
            / "auth_system.py"
        ).read_text(encoding="utf-8")
        account_script = (ROOT / "static/js/account-management.js").read_text(encoding="utf-8")

        self.assertIn("max_accounts: int = 40", auth_source)
        self.assertIn('os.getenv("AUTH_MAX_ACCOUNTS", "40")', auth_source)
        self.assertIn("registration.max_accounts || 40", account_script)

    def test_shortcut_labels_follow_device_platform(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/smart-canvas/task-modals.js").read_text(encoding="utf-8")

        self.assertIn('data-shortcut-key="primary"', page)
        self.assertIn("{primary:'Command',alternate:'Option',delete:'Delete',shift:'Shift'}", script)
        self.assertIn("{primary:'Ctrl',alternate:'Alt',delete:'Del',shift:'Shift'}", script)
        self.assertIn("/Mac|iPhone|iPad/i.test(navigator.platform", script)
        self.assertIn('data-i18n="smart.shortcutAltCopy"', page)
        self.assertNotIn('data-i18n="smart.shortcutAltShiftCopy"', page)
        self.assertNotIn('"smart.shortcutAltShiftCopy"', script)


if __name__ == "__main__":
    unittest.main()
