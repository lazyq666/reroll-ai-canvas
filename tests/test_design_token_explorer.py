import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "static" / "ui-component-library.html"
SURFACE_APP = ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
PAGE = ROOT / "static" / "design-system" / "infinite-canvas-ui" / "design-tokens.html"
APP = ROOT / "static" / "js" / "ui-component-library" / "design-token-explorer.js"
STYLE = ROOT / "static" / "css" / "design-token-explorer.css"


class DesignTokenExplorerTests(unittest.TestCase):
    def test_component_library_exposes_design_token_subpage(self):
        library = LIBRARY.read_text(encoding="utf-8")
        surface_app = SURFACE_APP.read_text(encoding="utf-8")

        self.assertIn('data-target-review="design-tokens"', library)
        self.assertIn('data-design-tokens-explorer', library)
        self.assertIn('class="catalog-header" hidden', library)
        self.assertIn('/static/design-system/infinite-canvas-ui/design-tokens.html', library)
        self.assertIn("const showDesignTokens = name === 'design-tokens'", surface_app)
        self.assertIn('designTokensExplorer.hidden = !showDesignTokens', surface_app)
        self.assertIn('document.body.dataset.activeReview = name', surface_app)

    def test_explorer_uses_an_independently_scrollable_iframe(self):
        surface_app = SURFACE_APP.read_text(encoding="utf-8")
        style = (ROOT / "static" / "css" / "ui-component-library.css").read_text(
            encoding="utf-8"
        )

        self.assertIn("usesIndependentScroll ? 'yes' : 'no'", surface_app)
        self.assertIn("frame.matches('[data-design-tokens-explorer]')", surface_app)
        self.assertIn('body[data-active-review="design-tokens"]', style)
        self.assertIn('iframe[data-design-tokens-explorer]', style)
        self.assertIn('height: calc(100vh - var(--ui-space-16)) !important', style)

    def test_explorer_reads_the_live_css_source_instead_of_a_token_snapshot(self):
        page = PAGE.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")

        self.assertIn('/static/css/design-tokens.css', page)
        self.assertIn("const SOURCE_URL = '/static/css/design-tokens.css'", app)
        self.assertIn("fetch(SOURCE_URL, { cache: 'no-store' })", app)
        self.assertIn('function parseTokens(cssText)', app)
        self.assertIn('liveSource.textContent = cssText', app)
        self.assertNotIn('--ui-color-surface-canvas:', page)
        self.assertNotIn('--ui-color-surface-canvas:', app)

    def test_explorer_supports_mapping_preview_search_and_token_copy(self):
        page = PAGE.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        for marker in (
            'data-token-search',
            'data-token-grid',
            'data-semantic-color-guide',
        ):
            self.assertIn(marker, page)
        for removed_marker in (
            'data-copy-format',
            'data-copy-visible',
            'data-theme="light"',
            'data-theme="dark"',
        ):
            self.assertNotIn(removed_marker, page)
        self.assertNotIn('copyVisibleButton', app)
        self.assertNotIn('themeButtons', app)
        self.assertIn("attributeFilter: ['data-ui-theme']", app)
        self.assertIn('navigator.clipboard.writeText', app)
        self.assertIn('resolveValue(token)', app)
        self.assertIn("name.startsWith('--ui-color-prompt-template-placeholder-')", app)
        self.assertIn('probe.style.backgroundImage = `var(${name})`', app)
        self.assertIn('token.rawValue', app)
        self.assertIn('var(${token.name})', app)
        self.assertIn("new Intl.Collator('en'", app)
        self.assertIn("numeric: true", app)
        self.assertIn('.token-preview', style)
        self.assertIn('.preview-color', style)

    def test_color_values_show_square_light_and_dark_previews(self):
        app = APP.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        self.assertIn('class="preview-color-pair"', app)
        self.assertIn('data-preview-theme="light"', app)
        self.assertIn('data-preview-theme="dark"', app)
        preview_rule = style.split('.preview-color {', 1)[1].split('}', 1)[0]
        self.assertIn('aspect-ratio: 1', preview_rule)
        self.assertIn('.preview-color[data-preview-theme="light"] { color-scheme: light; }', style)
        self.assertIn('.preview-color[data-preview-theme="dark"] { color-scheme: dark; }', style)

    def test_token_toolbar_is_not_a_decorated_surface(self):
        style = STYLE.read_text(encoding="utf-8")
        toolbar_rule = style.split('.token-toolbar {', 1)[1].split('}', 1)[0]

        self.assertNotIn('background:', toolbar_rule)
        self.assertNotIn('border:', toolbar_rule)
        self.assertNotIn('box-shadow:', toolbar_rule)

    def test_category_filter_reuses_section_navigation(self):
        page = PAGE.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        self.assertIn('data-navigation-pattern="section-navigation"', page)
        self.assertIn('/static/js/infinite-canvas-ui/core.js', page)
        self.assertIn('<ic-nav-item class="token-filter-family"', app)
        self.assertIn('class="token-filter-count"', app)
        self.assertIn('data-filter-family=', app)
        self.assertIn('function selectFamily(category, family)', app)
        self.assertNotIn('filter-chip', app)
        self.assertNotIn('.filter-chip', style)
        self.assertIn('.token-workspace {', style)
        self.assertIn('grid-template-columns: 10rem minmax(0, 1fr)', style)
        self.assertIn('.token-filters {', style)
        self.assertIn('width: 10rem', style)
        self.assertIn('.token-filter-families {', style)

    def test_token_name_and_usage_use_font_size_3(self):
        style = STYLE.read_text(encoding="utf-8")

        self.assertIn('.token-name {', style)
        self.assertIn('font-size: var(--ui-font-size-3)', style)
        usage_rule = style.split('.token-usage-cell p {', 1)[1].split('}', 1)[0]
        self.assertIn('font-size: var(--ui-font-size-3)', usage_rule)

    def test_explorer_documents_semantic_colors_and_groups_each_family(self):
        page = PAGE.read_text(encoding="utf-8")
        app = APP.read_text(encoding="utf-8")
        style = STYLE.read_text(encoding="utf-8")

        self.assertIn('data-token-family-list', page)
        for heading in ('Token Name', '使用规则', 'Value'):
            self.assertIn(f'<th scope="col">{heading}</th>', app)
        for marker in (
            'data-token-anatomy',
            'data-semantic-color-flow',
            '职责',
            '强调度 / 意图',
            '交互状态',
            '原子色',
            '语义色',
            '组件',
        ):
            self.assertIn(marker, page)
        self.assertNotIn('semantic-guide-intro', page)
        self.assertNotIn('.semantic-guide-intro', style)
        self.assertIn('function usageRuleFor(token)', app)
        self.assertIn('function semanticColorRule(name)', app)
        self.assertIn('const familyDefinitions = Object.freeze', app)
        self.assertIn('function familyFor(token)', app)
        self.assertIn('function groupTokensByFamily(visible)', app)
        self.assertIn('function compareTokensWithinFamily(a, b)', app)
        self.assertIn("'--ui-shadow-overlay'", app)
        self.assertIn('tokenFamilyOrder.get(a.token.name)', app)
        self.assertIn('data-token-family="${escapeHtml(group.id)}"', app)
        self.assertIn('<h2 id="${escapeHtml(headingId)}">${escapeHtml(group.label)}</h2>', app)
        self.assertNotIn("label: '其他'", app)
        self.assertIn('semanticGuide.hidden', app)
        self.assertIn('class="token-row', app)
        self.assertIn('data-token-raw-value', app)
        self.assertIn('data-token-resolved', app)
        self.assertIn('.token-family-list', style)
        self.assertIn('.token-family-section', style)
        self.assertIn('.token-table', style)
        self.assertIn('.semantic-color-guide', style)


if __name__ == "__main__":
    unittest.main()
