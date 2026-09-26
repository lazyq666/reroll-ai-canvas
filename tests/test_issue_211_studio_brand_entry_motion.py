from tests.frontend_asset_helpers import asset_url
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "index.html"
STYLE = ROOT / "static" / "css" / "studio-entry-motion.css"
SCRIPT = ROOT / "static" / "js" / "studio-entry-motion.js"
ENGINE = ROOT / "static" / "js" / "infinite-canvas-ui" / "brand-motion.js"
SHELL = ROOT / "static" / "js" / "studio-shell.js"
SPEC = ROOT / "docs" / "active" / "2026-08-29-issue-211-studio-brand-entry-motion.md"
RETIRED_VIDEO = ROOT / "static" / "images" / "brand" / "reroll-logo-motion-transparent.webm"


def constant(source, name):
    return int(re.search(rf"const {name} = (\d+);", source).group(1))


class StudioBrandEntryMotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.engine = ENGINE.read_text(encoding="utf-8")
        cls.shell = SHELL.read_text(encoding="utf-8")
        cls.spec = SPEC.read_text(encoding="utf-8")
        cls.common_i18n = (
            ROOT / "static" / "js" / "i18n" / "common.js"
        ).read_text(encoding="utf-8")

    def test_production_shell_draws_the_vector_mark_instead_of_video(self):
        self.assertIn('id="studioEntryMotion"', self.page)
        self.assertIn('<svg class="studio-entry-mark" viewBox="0 0 355 355"', self.page)
        self.assertIn('id="studioEntryMarkPath" fill="currentColor" fill-rule="evenodd" d=""', self.page)
        self.assertIn(f'<script type="module" src="{asset_url("/static/js/studio-entry-motion.js")}"></script>', self.page)
        self.assertIn(asset_url("/static/js/infinite-canvas-ui/brand-motion.js"), self.script)
        self.assertIn(asset_url("/static/images/brand/word.svg"), self.page)
        self.assertIn(asset_url("/static/images/brand/wordmark.svg"), self.page)
        self.assertIn(asset_url("/static/css/studio-entry-motion.css"), self.page)
        self.assertNotIn("<video", self.page)
        self.assertNotIn("reroll-logo-motion", self.page)
        self.assertFalse(RETIRED_VIDEO.exists())

    def test_entry_status_is_localized_for_the_saved_language(self):
        self.assertIn(
            'class="studio-entry-status" data-i18n="common.preparingCreativeSpace"',
            self.page,
        )
        self.assertIn(
            'zh: "正在准备你的创作空间…", en: "Preparing your creative space…"',
            self.common_i18n,
        )

    def test_whole_entry_completes_within_four_seconds(self):
        splash = constant(self.engine, "SPLASH_MS")
        cycle = constant(self.engine, "LOADER_CYCLE_MS")
        wait = constant(self.script, "WAIT_AT")
        fade_lead = constant(self.script, "FADE_LEAD")
        fade = constant(self.script, "FADE_MS")
        dock = constant(self.script, "DOCK_MS")
        self.assertLessEqual(wait + max(dock, fade_lead + fade), 4000)
        self.assertLess(constant(self.script, "LOCK_START"), splash)
        self.assertLessEqual(splash, wait)
        self.assertLessEqual(cycle, 4000)

    def test_slow_start_runs_the_loader_until_the_next_exact_logo_beat(self):
        self.assertIn("function nextBeat(ms)", self.script)
        self.assertIn("LOADER_BEATS.find(beat => beat >= rest)", self.script)
        self.assertIn("loadStart + nextBeat(time - loadStart)", self.script)
        self.assertIn("loaderScene(time - loadStart)", self.script)
        self.assertIn("root.classList.add('is-loading')", self.script)

    def test_motion_targets_the_real_expanded_sidebar_wordmark(self):
        self.assertIn(".sidebar-logo-image.sidebar-logo-wordmark", self.script)
        self.assertIn("studio-entry-motion-dock", self.script)
        self.assertIn("studio-entry-motion-dock", self.shell)
        self.assertIn("setSidebarPinned(true, { skipRemember: true })", self.shell)
        for value in ("30.07", "8.14", "73.68", "22.69"):
            self.assertIn(value, self.script)

    def test_motion_never_owns_or_blocks_route_readiness(self):
        self.assertIn("studio-route-booting", self.script)
        self.assertIn("MutationObserver", self.script)
        self.assertIn("if (routeIsReady())", self.script)
        self.assertIn("pointer-events: none", self.style)
        self.assertIn('aria-hidden="true"', self.page)

    def test_layer_is_removed_when_its_runtime_fails_to_load(self):
        self.assertIn("root.dataset.entryRuntime = 'ready'", self.script)
        self.assertIn("if (entry && !entry.dataset.entryRuntime) entry.remove();", self.page)

    def test_fade_keeps_the_docked_geometry(self):
        self.assertIn("time < dockStart + DOCK_MS", self.script)
        finished = re.search(r'\.studio-entry-motion\[data-entry-state="finished"\] \{([^}]*)\}', self.style).group(1)
        self.assertIn("opacity: 0", finished)
        self.assertNotIn("transform", finished)

    def test_mark_and_word_follow_the_theme_color(self):
        self.assertIn('fill="currentColor"', self.page)
        self.assertIn("fill.setAttribute('fill', 'currentColor')", self.script)
        self.assertIn("html.studio-theme-dark img.studio-entry-word", self.style)

    def test_first_entry_is_persisted_locally_and_reduced_motion_is_static(self):
        self.assertIn("const STORAGE_KEY = 'studio_brand_entry_seen'", self.script)
        self.assertIn("localStorage.getItem(STORAGE_KEY)", self.script)
        self.assertIn("localStorage.setItem(STORAGE_KEY, '1')", self.script)
        self.assertNotIn("sessionStorage", self.script)
        self.assertIn("(prefers-reduced-motion: reduce)", self.script)
        self.assertIn('data-entry-state="reduced"', self.style)
        self.assertIn("Reduced Motion", self.spec)

    def test_reload_and_persisted_completion_are_suppressed_before_the_overlay_can_paint(self):
        self.assertIn("navigation?.type === 'reload'", self.page)
        self.assertIn(
            "localStorage.getItem('studio_brand_entry_seen') === '1'",
            self.page,
        )
        self.assertIn("reloading || entrySeen", self.page)
        self.assertIn("studio-entry-motion-skip", self.page)
        self.assertIn("html.studio-entry-motion-skip .studio-entry-motion", self.style)
        self.assertIn("function isReloadNavigation()", self.script)
        self.assertIn("if (isReloadNavigation() || alreadySeen())", self.script)


if __name__ == "__main__":
    unittest.main()
