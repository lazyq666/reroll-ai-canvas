import subprocess
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RealtimePresenceFrontendContractTests(unittest.TestCase):
    def test_account_avatar_manifest_and_renderer_use_local_images_only(self):
        manifest = json.loads(
            (ROOT / "static/images/avatars/manifest.json").read_text(encoding="utf-8")
        )
        assets = manifest["assets"]
        self.assertEqual(32, len(assets))
        self.assertEqual(32, len(set(assets)))
        for asset in assets:
            self.assertTrue((ROOT / "static/images/avatars" / asset).is_file())

        renderer = (ROOT / "static/js/account-avatar.js").read_text(encoding="utf-8")
        self.assertIn("avatar_asset", renderer)
        self.assertIn("manifest.json", renderer)
        self.assertIn("document.createElement('img')", renderer)
        self.assertIn("icon.setAttribute('name', 'account')", renderer)
        self.assertNotIn("firstGrapheme", renderer)
        self.assertNotIn("avatar_color_slot", renderer)

    def test_account_menu_has_large_avatar_and_non_command_random_action(self):
        markup = (ROOT / "static/index.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/account-ui.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/studio-shell.css").read_text(encoding="utf-8")
        self.assertIn('id="account-random-avatar"', markup)
        self.assertNotIn('id="account-random-avatar" value=', markup)
        self.assertIn("/api/auth/avatar/random", script)
        self.assertIn("button.loading = true", script)
        self.assertIn("width: 35px", styles)
        self.assertIn("width: 80px", styles)

    def test_light_avatar_glyphs_use_the_lighter_400_color_scale(self):
        tokens = (ROOT / "static/css/design-tokens.css").read_text(encoding="utf-8")
        palette = {
            "red": "#F87171",
            "orange": "#FB923C",
            "amber": "#FBBF24",
            "green": "#34D399",
            "teal": "#2DD4BF",
            "cyan": "#22D3EE",
            "lime": "#A3E635",
            "indigo": "#818CF8",
            "violet": "#A78BFA",
            "pink": "#F472B6",
        }
        for slot, (hue, value) in enumerate(palette.items(), 1):
            self.assertIn(f"--ui-palette-{hue}-400: {value}", tokens)
            self.assertIn(
                f"--ui-color-collaborator-avatar-text-{slot}: light-dark(var(--ui-palette-{hue}-400), var(--ui-palette-{hue}-200))",
                tokens,
            )

    def test_real_page_browser_smoke_covers_required_presence_boundaries(self):
        smoke = (ROOT / "tests/realtime_presence_browser_smoke.cjs").read_text(
            encoding="utf-8"
        )
        for contract in (
            "presence_snapshot",
            "presence_update",
            "presence_resync",
            "membership_version: 9",
            "viewport.scale = 2",
            "cursor: { x: 10000, y: 10000 }",
            "reducedMotion: 'reduce'",
            "presence-dark-reduced.png",
        ):
            self.assertIn(contract, smoke)

        avatar_smoke = (ROOT / "tests/account_avatar_browser_smoke.cjs").read_text(
            encoding="utf-8"
        )
        for contract in (
            "bear.png",
            "publish",
            "../secret.png",
            "cat.png",
            "Account Avatar browser smoke passed",
        ):
            self.assertIn(contract, avatar_smoke)

    def test_presence_and_avatar_modules_parse_as_javascript(self):
        for relative in (
            "static/js/account-avatar.js",
            "static/js/smart-canvas/realtime-presence.js",
            "tests/realtime_presence_browser_smoke.cjs",
            "tests/account_avatar_browser_smoke.cjs",
        ):
            completed = subprocess.run(
                ["node", "--check", str(ROOT / relative)],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(0, completed.returncode, completed.stderr)


if __name__ == "__main__":
    unittest.main()
