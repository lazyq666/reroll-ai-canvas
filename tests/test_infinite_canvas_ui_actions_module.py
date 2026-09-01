import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "static" / "js" / "infinite-canvas-ui"
UI_VERSION = (UI_ROOT / "VERSION").read_text(encoding="utf-8").strip()
ACTIONS_ROOT = UI_ROOT / "actions"
ACTIONS_CONTRACT = ROOT / "static/design-system/infinite-canvas-ui/ic-actions-v1.json"
SURFACE_MANIFEST = ROOT / "static/design-system/infinite-canvas-ui/surface-manifest.json"
SURFACE_APP = ROOT / "static/js/ui-component-library/surface-app.js"


class InfiniteCanvasUiActionsModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.entry = (UI_ROOT / "actions.js").read_text(encoding="utf-8")
        cls.index = (ACTIONS_ROOT / "index.js").read_text(encoding="utf-8")
        cls.button = (ACTIONS_ROOT / "button.js").read_text(encoding="utf-8")
        cls.icon_button = (ACTIONS_ROOT / "icon-button.js").read_text(encoding="utf-8")
        cls.button_group = (ACTIONS_ROOT / "button-group.js").read_text(encoding="utf-8")
        cls.video_play_button = (ACTIONS_ROOT / "video-play-button.js").read_text(encoding="utf-8")
        cls.styles = (ACTIONS_ROOT / "styles.js").read_text(encoding="utf-8")
        cls.theme_adapter = (UI_ROOT / "theme-adapter.js").read_text(encoding="utf-8")
        cls.core = (UI_ROOT / "core.js").read_text(encoding="utf-8")
        cls.contract = json.loads(ACTIONS_CONTRACT.read_text(encoding="utf-8"))
        cls.surface_manifest = json.loads(SURFACE_MANIFEST.read_text(encoding="utf-8"))
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")

    def test_stable_entry_hides_the_family_file_layout(self):
        self.assertIn(f"from './actions/index.js?v={UI_VERSION}'", self.entry)
        for public_class in ("IcButton", "IcIconButton", "IcVideoPlayButton", "IcButtonGroup"):
            self.assertIn(public_class, self.entry)
            self.assertIn(public_class, self.index)
        self.assertIn(f"from './actions.js?v={UI_VERSION}'", self.core)

    def test_each_public_control_has_one_family_implementation_file(self):
        self.assertIn("export class IcButton extends", self.button)
        self.assertIn("export class IcIconButton extends IcButton", self.icon_button)
        self.assertIn("export class IcButtonGroup extends", self.button_group)
        self.assertIn("export class IcVideoPlayButton extends HTMLElement", self.video_play_button)
        self.assertIn("const VALID_SIZES = new Set(['s', 'm']);", self.video_play_button)
        self.assertIn("this.setAttribute('size', 'm')", self.video_play_button)
        self.assertIn("--ic-video-play-button-size:4rem", self.video_play_button)
        self.assertIn("define('ic-video-play-button', IcVideoPlayButton)", self.core)

    def test_actions_family_owns_the_video_play_button_contract(self):
        component = next(item for item in self.contract["components"] if item["tag"] == "ic-video-play-button")
        self.assertEqual(component["semanticDimensions"]["size"], ["small", "medium"])
        self.assertIn("medium is the default", component["invariants"][0])
        actions_surface = self.surface_manifest["surfaces"]["target"]["actions"]
        self.assertIn("ic-video-play-button", actions_surface["components"])
        nodes_surface = self.surface_manifest["surfaces"]["target"]["nodes"]
        self.assertNotIn("ic-video-play-button", nodes_surface["components"])
        self.assertFalse((UI_ROOT / "nodes/video-play-button.js").exists())
        self.assertIn("['ic-video-play-button', 'Video Play Button', 'actions']", self.surface_app)
        self.assertNotIn("Icon Button · Node Video Inline Play", self.surface_app)
        self.assertNotIn("class IcIconButton", self.button)
        self.assertNotIn("class IcButtonGroup", self.button)

    def test_actions_visual_implementation_is_owned_by_the_family(self):
        for contract in (
            "export const BUTTON_STYLES",
            "export const ICON_BUTTON_STYLES",
            "export const BUTTON_GROUP_STYLES",
            ":host([size='xs'])",
            ":host([hierarchy='primary'][tone='neutral'])",
            ":host([pressed])",
            ":host([data-ic-contract-status='invalid'])",
            ":host([ghost][hierarchy='secondary'][tone='neutral'])",
            ":host([background='ghost'][hierarchy][tone])",
            ":host([hierarchy='primary'][tone='neutral'])",
            ":host([data-component-variant='generation-kind'])",
            ":host([orientation='vertical'])",
        ):
            self.assertIn(contract, self.styles)

    def test_theme_adapter_does_not_own_standalone_actions_rules(self):
        standalone_actions_selector = re.compile(
            r"(?m)^\s*ic-(?:button|icon-button|button-group)(?=[\s,:\[])"
        )
        self.assertIsNone(standalone_actions_selector.search(self.theme_adapter))
        self.assertNotIn('data-component-variant="generation-kind"', self.theme_adapter)

    def test_actions_styles_only_consume_project_tokens(self):
        self.assertNotRegex(self.styles, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotRegex(self.styles, r"rgba?\(")
        self.assertNotIn("transition: all", self.styles)
        self.assertIn("var(--ui-", self.styles)

    def test_non_circular_buttons_use_squircle_corner_smoothing(self):
        button_styles, icon_button_styles = self.styles.split(
            "export const ICON_BUTTON_STYLES", maxsplit=1
        )
        self.assertIn("corner-shape: squircle;", button_styles)
        self.assertIn("border-radius: var(--ui-radius-m) !important;", button_styles)
        self.assertIn("corner-shape: round;", icon_button_styles)
        self.assertIn(
            "border-radius: var(--ui-radius-pill) !important;",
            icon_button_styles,
        )
        for selector in (
            ":host([hierarchy='secondary'][tone='neutral']) [part~='base']",
            ":host([background='ghost'][hierarchy][tone]) [part~='base']",
        ):
            with self.subTest(selector=selector):
                rule = icon_button_styles.split(selector, 1)[1].split("}", 1)[0]
                self.assertIn("border-radius: var(--ui-radius-m) !important;", rule)
                self.assertIn("corner-shape: squircle;", rule)

    def test_secondary_icon_buttons_use_a_raised_bordered_surface(self):
        icon_button_styles = self.styles.split("export const ICON_BUTTON_STYLES", 1)[1]
        selector = ":host([hierarchy='secondary'][tone='neutral']) [part~='base']"
        rule = icon_button_styles.split(selector, 1)[1].split("}", 1)[0]
        self.assertIn(
            "border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);",
            rule,
        )
        self.assertIn("box-shadow: var(--ui-shadow-raised);", rule)
        self.assertIn(
            "this.pill = this.hierarchy === 'primary' && this.background !== 'ghost';",
            self.icon_button,
        )

    def test_tertiary_icon_buttons_have_no_background_border_or_shadow(self):
        icon_button_styles = self.styles.split("export const ICON_BUTTON_STYLES", 1)[1]
        selector = ":host([background='ghost'][hierarchy][tone]) [part~='base']"
        rule = icon_button_styles.split(selector, 1)[1].split("}", 1)[0]
        self.assertIn("background: var(--ui-color-action-tertiary) !important;", rule)
        self.assertIn("border: var(--ui-border-width-none);", rule)
        self.assertIn("box-shadow: var(--ui-shadow-none);", rule)
        self.assertNotIn("var(--ui-color-border-secondary)", rule)
        self.assertNotIn("var(--ui-shadow-raised)", rule)

    def test_ghost_and_primary_presentations_belong_to_the_actions_family(self):
        self.assertIn("ghost: { type: Boolean, reflect: true }", self.button)
        self.assertIn("ghost presentation requires a secondary neutral action", self.button)
        self.assertIn("ghost presentation requires ic-button with a visible label", self.icon_button)
        self.assertIn("background-color: var(--ui-color-action-tertiary-hover);", self.styles)
        self.assertIn("['auto', 'ghost']", self.icon_button)
        self.assertIn("background must be auto or ghost", self.icon_button)
        self.assertNotIn("primary hierarchy requires a visible label", self.icon_button)
        self.assertIn("background: var(--ui-color-action-primary);", self.styles)

    def test_secondary_ghost_and_danger_keep_regular_stable_foregrounds(self):
        self.assertRegex(
            self.styles,
            r":host\(\[hierarchy='secondary'\]\[tone='neutral'\]\) \[part~='base'\]\s*\{[^}]*color: var\(--ui-color-text-primary\);[^}]*background-color: var\(--ui-color-action-secondary\);[^}]*font-weight: var\(--ui-font-weight-regular\);",
        )
        self.assertRegex(
            self.styles,
            r":host\(\[hierarchy='secondary'\]\[tone='danger'\]\) \[part~='base'\]\s*\{[^}]*color: var\(--ui-color-text-danger\);[^}]*font-weight: var\(--ui-font-weight-regular\);",
        )
        self.assertIn("[tone='neutral'][data-preview-state='hover']) [part~='base']", self.styles)
        self.assertIn("[tone='danger'][data-preview-state='hover']) [part~='base']", self.styles)

    def test_danger_hierarchies_consume_their_semantic_surface_tokens(self):
        for hierarchy, default_token, hover_token in (
            ("primary", "--ui-color-action-primary-danger", "--ui-color-action-primary-danger-hover"),
            ("secondary", "--ui-color-action-secondary-danger", "--ui-color-action-secondary-danger-hover"),
            ("quiet", "--ui-color-action-tertiary-danger", "--ui-color-action-tertiary-danger-hover"),
        ):
            with self.subTest(hierarchy=hierarchy, state="default"):
                self.assertRegex(
                    self.styles,
                    rf":host\(\[hierarchy='{hierarchy}'\]\[tone='danger'\]\) \[part~='base'\]\s*\{{[^}}]*background-color: var\({default_token}\);",
                )
            with self.subTest(hierarchy=hierarchy, state="hover"):
                self.assertRegex(
                    self.styles,
                    rf"\[hierarchy='{hierarchy}'\]\[tone='danger'\]\[data-preview-state='hover'\]\) \[part~='base'\] \{{[^}}]*background-color: var\({hover_token}\);",
                )

    def test_primary_pointer_hover_uses_the_same_semantic_rule_as_preview(self):
        self.assertIn(
            ":host([hierarchy='primary'][tone='neutral']:not([disabled]):not([loading])) [part~='base']:hover,",
            self.styles,
        )
        self.assertRegex(
            self.styles,
            r"\[hierarchy='primary'\]\[tone='neutral'\]\[data-preview-state='hover'\]\) \[part~='base'\] \{[^}]*background-color: var\(--ui-color-action-primary-hover\);",
        )
        button_hover_rule = self.styles.split(
            ":host([hierarchy='primary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {",
            1,
        )[1].split("}", 1)[0]
        self.assertNotIn("box-shadow", button_hover_rule)
        self.assertNotIn("transform", button_hover_rule)

        icon_styles = self.styles.split("export const ICON_BUTTON_STYLES", 1)[1]
        icon_hover_rule = icon_styles.split(
            ":host([hierarchy='primary'][tone='neutral'][data-preview-state='hover']) [part~='base'] {",
            1,
        )[1].split("}", 1)[0]
        self.assertIn("box-shadow: var(--ui-shadow-raised)", icon_hover_rule)
        self.assertIn("transform: translateY(-1px)", icon_hover_rule)

    def test_disabled_actions_consume_disabled_semantic_tokens_without_opacity(self):
        for token in (
            "--ui-color-action-primary-disabled",
            "--ui-color-action-primary-danger-disabled",
            "--ui-color-action-secondary-disabled",
            "--ui-color-action-tertiary-disabled",
            "--ui-color-text-on-action-primary-disabled",
            "--ui-color-text-disabled",
            "--ui-color-icon-disabled",
            "--ui-color-border-disabled",
        ):
            self.assertIn(f"var({token})", self.styles)
        self.assertRegex(
            self.styles,
            r":host\(\[disabled\]\)\s*\{[^}]*opacity:\s*1;",
        )

    def test_all_actions_use_the_selected_pressed_motion_without_pressed_colors(self):
        for token in (
            "--ui-motion-duration-press",
            "--ui-motion-duration-release",
            "--ui-motion-ease-press",
            "--ui-motion-ease-spring",
        ):
            self.assertIn(f"var({token})", self.styles)
        self.assertIn("--ic-action-press-scale: .94;", self.styles)
        self.assertIn(":not([disabled]):not([loading])", self.styles)
        self.assertIn("[data-preview-state='pressed']", self.styles)
        pressed_rule = self.styles.split("[data-preview-state='pressed']", 1)[1].split("}", 1)[0]
        self.assertIn("transform: scale(var(--ic-action-press-scale))", pressed_rule)
        self.assertNotIn("color", pressed_rule)
        self.assertNotIn("background", pressed_rule)


if __name__ == "__main__":
    unittest.main()
