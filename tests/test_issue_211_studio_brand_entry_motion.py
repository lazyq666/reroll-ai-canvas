import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static" / "index.html"
STYLE = ROOT / "static" / "css" / "studio-entry-motion.css"
SCRIPT = ROOT / "static" / "js" / "studio-entry-motion.js"
SHELL = ROOT / "static" / "js" / "studio-shell.js"
SPEC = ROOT / "docs" / "active" / "2026-08-29-issue-211-studio-brand-entry-motion.md"


class StudioBrandEntryMotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.script = SCRIPT.read_text(encoding="utf-8")
        cls.shell = SHELL.read_text(encoding="utf-8")
        cls.spec = SPEC.read_text(encoding="utf-8")
        cls.common_i18n = (
            ROOT / "static" / "js" / "i18n" / "common.js"
        ).read_text(encoding="utf-8")

    def test_production_shell_uses_brand_motion_assets(self):
        self.assertIn('id="studioEntryMotion"', self.page)
        self.assertIn('/static/images/reroll-logo-motion-transparent.webm', self.page)
        self.assertIn('/static/images/word.svg', self.page)
        self.assertIn('/static/images/wordmark.svg', self.page)
        self.assertIn('/static/css/studio-entry-motion.css', self.page)
        self.assertIn('/static/js/studio-entry-motion.js', self.page)

    def test_entry_status_is_localized_for_the_saved_language(self):
        self.assertIn(
            'class="studio-entry-status" data-i18n="common.preparingCreativeSpace"',
            self.page,
        )
        self.assertIn(
            'zh: "正在准备你的创作空间…", en: "Preparing your creative space…"',
            self.common_i18n,
        )

    def test_motion_targets_the_real_expanded_sidebar_wordmark(self):
        self.assertIn(".sidebar-logo-image.sidebar-logo-wordmark", self.script)
        self.assertIn("studio-entry-motion-dock", self.script)
        self.assertIn("studio-entry-motion-dock", self.shell)
        self.assertIn("setSidebarPinned(true, { skipRemember: true })", self.shell)
        for value in ("30.07", "8.14", "73.68", "22.69", "2.986"):
            self.assertIn(value, self.script)
        self.assertIn("transform: scale(1.436)", self.style)

    def test_motion_never_owns_or_blocks_route_readiness(self):
        self.assertIn("studio-route-booting", self.script)
        self.assertIn("MutationObserver", self.script)
        self.assertIn("video.addEventListener('error'", self.script)
        self.assertIn("video.querySelector('source')?.addEventListener('error'", self.script)
        self.assertIn("playback.catch(mediaFailed)", self.script)
        self.assertIn("const MEDIA_WATCHDOG_MS = 6500", self.script)
        self.assertIn("pointer-events: none", self.style)
        self.assertIn('aria-hidden="true"', self.page)

    def test_normal_playback_has_no_static_logo_under_the_video(self):
        self.assertNotIn('poster="/static/images/logo.svg"', self.page)
        self.assertIn("background: none", self.style)
        self.assertIn(".studio-entry-motion.has-media-error .studio-entry-mark-frame", self.style)
        self.assertIn("background: url('/static/images/logo.svg')", self.style)

    def test_video_surface_is_removed_before_the_mark_moves_or_fades(self):
        self.assertIn("async function resolveVideoToStaticMark()", self.script)
        self.assertIn("root.classList.add('has-resolved-mark')", self.script)
        self.assertIn("video.pause()", self.script)
        self.assertIn("video.remove()", self.script)
        self.assertIn("await resolveVideoToStaticMark()", self.script)
        self.assertIn("cancelLater(mediaWatchdog)", self.script)
        self.assertIn(".studio-entry-motion.has-resolved-mark .studio-entry-mark-frame", self.style)

    def test_finished_state_keeps_the_docked_geometry_while_fading(self):
        for selector in (
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-lockup',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-grid',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-mark-frame',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-word-frame',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-word-reveal',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-word-scan',
            '.studio-entry-motion[data-entry-state="finished"] .studio-entry-status',
        ):
            self.assertIn(selector, self.style)

    def test_first_entry_is_session_scoped_and_reduced_motion_is_static(self):
        self.assertIn("const SESSION_KEY = 'studio_brand_entry_seen'", self.script)
        self.assertIn("sessionStorage.getItem(SESSION_KEY)", self.script)
        self.assertIn("sessionStorage.setItem(SESSION_KEY, '1')", self.script)
        self.assertIn("(prefers-reduced-motion: reduce)", self.script)
        self.assertIn('data-entry-state="reduced"', self.style)
        self.assertIn("Reduced Motion", self.spec)

    def test_reload_is_suppressed_before_the_overlay_can_paint(self):
        self.assertIn("navigation?.type === 'reload'", self.page)
        self.assertIn("studio-entry-motion-skip", self.page)
        self.assertIn("html.studio-entry-motion-skip .studio-entry-motion", self.style)
        self.assertIn("function isReloadNavigation()", self.script)
        self.assertIn("if (isReloadNavigation() || alreadySeen())", self.script)


if __name__ == "__main__":
    unittest.main()
