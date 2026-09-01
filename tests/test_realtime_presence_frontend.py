import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RealtimePresenceFrontendContractTests(unittest.TestCase):
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

    def test_presence_and_avatar_modules_parse_as_javascript(self):
        for relative in (
            "static/js/account-avatar.js",
            "static/js/smart-canvas/realtime-presence.js",
            "tests/realtime_presence_browser_smoke.cjs",
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
