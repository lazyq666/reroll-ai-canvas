import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "static" / "js" / "infinite-canvas-ui"
UI_VERSION = (UI_ROOT / "VERSION").read_text(encoding="utf-8").strip()


class FileMediaPlayerControlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.player = (UI_ROOT / "file-media-input" / "media-player-controls.js").read_text(encoding="utf-8")
        cls.family = (UI_ROOT / "file-media-input.js").read_text(encoding="utf-8")
        cls.core = (UI_ROOT / "core.js").read_text(encoding="utf-8")
        cls.icons = (UI_ROOT / "icon.js").read_text(encoding="utf-8")
        cls.case = (ROOT / "static" / "design-system" / "infinite-canvas-ui" / "file-media-input-case.html").read_text(encoding="utf-8")
        cls.contract = json.loads(
            (ROOT / "static" / "design-system" / "infinite-canvas-ui" / "ic-file-media-input-v1.json").read_text(encoding="utf-8")
        )
        cls.manifest = json.loads(
            (ROOT / "static" / "design-system" / "infinite-canvas-ui" / "surface-manifest.json").read_text(encoding="utf-8")
        )
        cls.surface_app = (UI_ROOT / "../ui-component-library" / "surface-app.js").resolve().read_text(encoding="utf-8")

    def test_shared_player_is_a_family_owned_public_module(self):
        self.assertIn("export class IcMediaPlayerControls", self.player)
        self.assertIn(f"./file-media-input/media-player-controls.js?v={UI_VERSION}", self.family)
        self.assertIn(f"./file-media-input.js?v={UI_VERSION}", self.core)
        self.assertIn("define('ic-media-player-controls', IcMediaPlayerControls)", self.core)
        self.assertIn("IcMediaPlayerControls", self.core)

    def test_media_slots_compose_project_controls_over_native_engines(self):
        self.assertIn('<ic-media-player-controls kind="video"', self.family)
        self.assertIn('<ic-media-player-controls kind="audio"', self.family)
        self.assertNotIn(' controls preload="metadata"', self.family)
        for tag in ("ic-icon-button", "ic-slider"):
            self.assertIn(f"<{tag}", self.player)
        for icon in ("pause", "volume", "volume-muted"):
            self.assertIn(f"{icon}:", self.icons.replace("'", ""))
        for control in ("data-volume", "data-pip", "data-fullscreen", "data-stage-play"):
            self.assertNotIn(control, self.player)
        self.assertIn("background:linear-gradient(180deg,transparent 0%,var(--ui-color-mask) 100%)", self.player)
        self.assertIn("color:var(--ui-color-text-white)", self.player)
        self.assertIn("grid-column:1/-1", self.player)
        self.assertIn(
            "ic-slider::part(slider){display:flex;min-height:var(--ui-space-4);align-items:flex-end}",
            self.player,
        )
        self.assertIn("column-gap:var(--ui-space-2);row-gap:var(--ui-space-0)", self.player)
        self.assertIn("ic-slider::part(slider){min-height:var(--ui-space-2)}", self.player)
        self.assertIn("ic-slider::part(track){width:100%", self.player)
        self.assertIn("overflow:hidden;border-radius:inherit", self.player)

    def test_node_upload_uses_the_small_primary_button_size(self):
        self.assertIn('<ic-button type="button" hierarchy="primary" size="small"', self.family)
        self.assertIn(':host([shape="node"]) .node{gap:var(--ui-space-3)}', self.family)

    def test_contract_records_shared_controls_and_keyboard_behavior(self):
        player = next(component for component in self.contract["components"] if component["tag"] == "ic-media-player-controls")
        self.assertEqual(player["semanticDimensions"]["kind"], ["video", "audio"])
        self.assertTrue(any("mute/unmute only" in item for item in player["invariants"]))
        self.assertIn("player", self.contract["keyboard"])
        self.assertEqual(self.contract["ticket"], "145")

    def test_ready_media_slot_showcases_are_removed_from_the_component_library(self):
        for name in ("ic-media-slot-video", "ic-media-slot-audio", "ic-media-slot-file"):
            self.assertNotIn(f'data-component-name="{name}"', self.case)
        for name in ("ic-media-slot-empty", "ic-media-slot-uploading", "ic-media-slot-error"):
            self.assertIn(f'data-component-name="{name}"', self.case)

    def test_component_library_registry_can_find_the_player(self):
        family = self.manifest["surfaces"]["target"]["fileMediaInput"]
        self.assertIn("ic-media-player-controls", family["components"])
        self.assertIn("['ic-media-player-controls', 'Media Player Controls', 'file-media-input']", self.surface_app)


if __name__ == "__main__":
    unittest.main()
