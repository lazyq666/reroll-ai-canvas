import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "canvas-list.html"
STYLE = ROOT / "static" / "css" / "canvas-list.css"
SCRIPT = ROOT / "static" / "js" / "canvas-list.js"


class CanvasListBrowseNavigationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")

    def test_static_browse_surfaces_compose_public_components(self):
        for tag in (
            "ic-badge",
            "ic-button",
            "ic-empty-state",
            "ic-icon",
            "ic-icon-button",
            "ic-loading",
            "ic-toolbar",
        ):
            self.assertIn(f"<{tag}", self.page)
        self.assertIn('<ic-tabs id="projectList"', self.page)
        self.assertIn('data-legal-combination="vertical-manual-label"', self.page)
        self.assertIn("/static/js/infinite-canvas-ui/core.js", self.page)
        self.assertNotIn("tailwindcss-cdn", self.page)
        self.assertIn('aria-label="项目筛选"', self.page)
        self.assertIn('aria-busy="true"', self.page)
        self.assertNotIn('id="boardStatus"', self.page)

    def test_dynamic_project_filter_cards_statuses_and_actions_use_public_components(self):
        for markup in (
            '<span class="ws-project-nav">',
            '<ic-icon class="ws-project-icon"',
            '<ic-badge class="ws-project-count" kind="count"',
            '<ic-card class="ws-card-surface"',
            '<ic-media-container class="ws-card-thumb',
            '<ic-badge class="ws-card-kind classic"',
            '<ic-badge class="ws-card-access"',
            '<ic-badge class="ws-card-privacy"',
            '<ic-icon-button class="ws-card-menu"',
            '<ic-menu-item kind="command"',
        ):
            self.assertIn(markup, self.script)
        self.assertIn("const toast = document.createElement('ic-toast');", self.script)
        self.assertIn("setBoardLoading(true)", self.script)
        self.assertIn("setBoardLoading(false)", self.script)
        self.assertIn("projectListEl.setAttribute('value', currentProjectId)", self.script)
        self.assertIn("projectListEl.addEventListener('ic-change'", self.script)
        self.assertIn("window.location.href = canvasHref(c);", self.script)
        self.assertNotIn('class="ws-card-enter"', self.script)

    def test_loading_filtering_and_navigation_behavior_remains_wired(self):
        for contract in (
            "fetch('/api/projects')",
            "`/api/canvases?project=${encodeURIComponent(currentProjectId)}",
            "async function selectProject(pid)",
            "rememberProjectId(pid)",
            "await loadCurrentProjectBatch({ reset: true })",
            "boardLoadMoreBtn?.addEventListener('click', loadNextCanvasBatch);",
            "boardRefreshBtn.addEventListener('click'",
            "boardResetViewBtn.addEventListener('click', resetView);",
        ):
            self.assertIn(contract, self.script)
        self.assertIn("? `/static/smart-canvas.html?id=${enc}&project=${project}&v=${Date.now()}`", self.script)
        self.assertIn(": `/static/canvas.html?id=${enc}&project=${project}&v=${Date.now()}`", self.script)

    def test_browse_component_chrome_is_not_reimplemented_in_page_css(self):
        for selector in (
            ".ws-status",
            ".ws-board-empty-icon",
            ".ws-board-empty-text",
            ".ws-board-empty-sub",
            ".ws-project-row.active { background:",
            ".theme-dark .ws-project-row.active",
            ".ws-load-more-btn:hover",
            ".ws-icon-btn:hover",
            ".ws-card-kind.classic { background:",
        ):
            self.assertNotIn(selector, self.style)
        self.assertNotIn("--wa-", self.style)
        self.assertNotRegex(self.style, r"#[0-9a-fA-F]{3,8}\b")

if __name__ == "__main__":
    unittest.main()
