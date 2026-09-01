import colorsys
import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "static/js/infinite-canvas-ui"
MODULE = UI_ROOT / "canvas-navigation/smart-minimap.js"
ENTRY = UI_ROOT / "canvas-navigation.js"
CORE = UI_ROOT / "core.js"
PAGE = ROOT / "static/smart-canvas.html"
STYLE = ROOT / "static/css/smart-canvas.css"
VIEWPORT = ROOT / "static/js/smart-canvas/viewport-selection.js"
HOST = ROOT / "static/js/smart-canvas.js"
PREVIEW = ROOT / "static/design-system/infinite-canvas-ui/smart-minimap.html"
LIBRARY = ROOT / "static/ui-component-library.html"
SURFACE_APP = ROOT / "static/js/ui-component-library/surface-app.js"
MANIFEST = ROOT / "static/design-system/infinite-canvas-ui/surface-manifest.json"
TOKENS = ROOT / "static/css/design-tokens.css"


class SmartCanvasMinimapUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = MODULE.read_text(encoding="utf-8")
        cls.entry = ENTRY.read_text(encoding="utf-8")
        cls.core = CORE.read_text(encoding="utf-8")
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.viewport = VIEWPORT.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.preview = PREVIEW.read_text(encoding="utf-8")
        cls.library = LIBRARY.read_text(encoding="utf-8")
        cls.surface_app = SURFACE_APP.read_text(encoding="utf-8")
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.tokens = TOKENS.read_text(encoding="utf-8")

    def palette_hls(self, family, step):
        match = re.search(
            rf"--ui-palette-{family}-{step}: #(\w{{6}});",
            self.tokens,
        )
        self.assertIsNotNone(match)
        rgb = tuple(int(match.group(1)[index:index + 2], 16) / 255 for index in (0, 2, 4))
        return colorsys.rgb_to_hls(*rgb)

    def test_new_minimap_palette_steps_are_between_200_and_400(self):
        for family in ("blue", "green"):
            _, lightness_200, saturation_200 = self.palette_hls(family, 200)
            _, lightness_300, saturation_300 = self.palette_hls(family, 300)
            _, lightness_400, saturation_400 = self.palette_hls(family, 400)
            self.assertGreater(lightness_200, lightness_300)
            self.assertGreater(lightness_300, lightness_400)
            self.assertLess(
                abs(saturation_300 - saturation_200),
                abs(saturation_300 - saturation_400),
            )

    def test_minimap_is_a_public_ui_module_with_owned_dom_and_styles(self):
        self.assertIn("export { IcSmartMinimap", self.entry)
        self.assertIn("export class IcSmartMinimap extends HTMLElement", self.module)
        self.assertIn("define('ic-smart-minimap', IcSmartMinimap)", self.core)
        self.assertIn('<ic-smart-minimap id="minimap"', self.page)
        self.assertNotIn('id="minimapContent"', self.page)
        self.assertNotIn('id="minimapViewport"', self.page)
        self.assertNotIn(".smart-minimap-content", self.style)
        self.assertNotIn(".smart-minimap-viewport", self.style)
        self.assertIn(".smart-minimap { position:absolute;", self.style)

    def test_viewport_outside_mask_and_semantic_layers_are_owned_by_component(self):
        self.assertIn("smart-minimap-outside-mask", self.module)
        self.assertIn('maskUnits="userSpaceOnUse"', self.module)
        self.assertIn("fill:var(--ui-color-mask); opacity:.12", self.module)
        self.assertNotIn("smart-minimap-viewport", self.module)
        for kind in ("frame", "frame-member", "group", "text", "media"):
            self.assertIn(f'data-minimap-kind="{kind}"', self.module)
        self.assertIn("background-color:var(--ui-color-surface)", self.module)
        self.assertIn("var(--ui-color-minimap-group)", self.module)
        self.assertIn("var(--ui-color-minimap-media)", self.module)
        self.assertIn("var(--ui-color-minimap-text)", self.module)
        self.assertIn(
            "--ui-color-minimap-group: light-dark(var(--ui-palette-gray-300), var(--ui-palette-gray-600));",
            self.tokens,
        )
        self.assertIn(
            "--ui-palette-blue-300: #A9D1FD;",
            self.tokens,
        )
        self.assertIn(
            "--ui-palette-green-300: #8BECC5;",
            self.tokens,
        )
        self.assertIn(
            "--ui-color-minimap-media: light-dark(var(--ui-palette-blue-300), var(--ui-palette-blue-700));",
            self.tokens,
        )
        self.assertIn(
            "--ui-color-minimap-text: light-dark(var(--ui-palette-green-300), var(--ui-palette-green-700));",
            self.tokens,
        )
        self.assertIn('path[data-minimap-kind="frame"] { fill:var(--ic-minimap-frame-color); fill-opacity:.2; }', self.module)
        self.assertIn('path[data-minimap-kind="frame-member"] { fill:var(--ic-minimap-frame-color); fill-opacity:.3; }', self.module)
        self.assertIn("const SMART_MINIMAP_MIN_ITEM_SIZE = 1.5", self.module)
        self.assertIn("const SMART_MINIMAP_MIN_VIEWPORT_AREA_RATIO = 0.1", self.module)
        self.assertIn("const SMART_MINIMAP_MAX_FOCUS_ZOOM = 2", self.module)
        for color in ("blue", "violet", "amber", "green", "slate"):
            self.assertIn(f'data-frame-color="{color}"', self.module)

    def test_viewport_adapter_maps_domain_roles_without_rendering_svg(self):
        self.assertIn("function smartViewportSelectionMinimapKind(node)", self.viewport)
        self.assertIn("if(role === 'frame') return 'frame'", self.viewport)
        self.assertIn("if(role === 'smart-group') return 'group'", self.viewport)
        self.assertIn("'prompt-generation'", self.viewport)
        self.assertIn("return 'media'", self.viewport)
        self.assertIn("function smartViewportSelectionMinimapFrameColors()", self.viewport)
        self.assertIn("smartContainer?.descendantIds?.(frame)", self.viewport)
        self.assertIn("frameColors.get(node.id) || ''", self.viewport)
        self.assertIn("minimap.scene = {", self.viewport)
        self.assertNotIn("minimapContent.innerHTML", self.viewport)
        self.assertNotIn("smartMinimapState", self.viewport)

    def test_component_owns_pointer_navigation_and_host_only_consumes_event(self):
        self.assertIn("this.setPointerCapture?.(event.pointerId)", self.module)
        self.assertIn("worldPointFromClient(clientX, clientY)", self.module)
        self.assertIn("new CustomEvent('ic-minimap-navigate'", self.module)
        self.assertIn("minimap?.addEventListener('ic-minimap-navigate'", self.host)
        self.assertNotIn("smartMinimapDrag", self.host)
        self.assertNotIn("minimapPoint", self.host)

    def test_component_library_exposes_a_real_interactive_preview(self):
        self.assertIn('data-target-review="smart-minimap"', self.library)
        self.assertIn("data-smart-minimap-matrix", self.library)
        self.assertIn("/static/design-system/infinite-canvas-ui/smart-minimap.html", self.library)
        self.assertIn('<ic-smart-minimap id="previewMinimap"', self.preview)
        self.assertIn("minimap.addEventListener('ic-minimap-navigate'", self.preview)
        self.assertIn("viewport = {", self.preview)
        self.assertIn("showSmartMinimap", self.surface_app)
        blocks = self.manifest["surfaces"]["target"]["blocks"]
        self.assertIn("ic-smart-minimap", blocks["components"])
        self.assertIn(
            "/static/design-system/infinite-canvas-ui/smart-minimap.html",
            blocks["caseFixtures"],
        )
        self.assertIn(
            "ic-smart-minimap",
            self.manifest["surfaces"]["migration"]["targetComponentIds"],
        )

    def test_projection_preserves_semantics_and_keeps_viewport_inside_map(self):
        script = f"""
            globalThis.HTMLElement = class {{}};
            const module = await import({json.dumps(MODULE.as_uri())});
            const result = module.projectSmartMinimapScene({{
                width:170,
                height:108,
                padding:200,
                viewport:{{x:0,y:0,width:800,height:600}},
                items:[
                    {{id:'frame',kind:'frame',frameColor:'violet',x:-100,y:-50,width:1200,height:800}},
                    {{id:'group',kind:'group',x:100,y:100,width:300,height:200}},
                    {{id:'text',kind:'text',x:150,y:150,width:200,height:100}},
                    {{id:'image',kind:'media',x:500,y:200,width:260,height:180}},
                    {{id:'member',kind:'media',frameColor:'violet',x:700,y:300,width:180,height:120}},
                    {{id:'tiny',kind:'media',x:900,y:700,width:1,height:1}}
                ]
            }});
            console.log(JSON.stringify(result));
        """
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(
            [item["kind"] for item in data["items"]],
            ["frame", "group", "text", "media", "media", "media"],
        )
        self.assertEqual(data["items"][0]["frameColor"], "violet")
        self.assertEqual(data["items"][3]["frameColor"], "")
        self.assertEqual(data["items"][4]["frameColor"], "violet")
        self.assertEqual(data["items"][5]["width"], 1.5)
        self.assertEqual(data["items"][5]["height"], 1.5)
        self.assertGreater(data["scale"], 0)
        self.assertGreaterEqual(data["viewport"]["x"], 0)
        self.assertGreaterEqual(data["viewport"]["y"], 0)
        self.assertLessEqual(
            data["viewport"]["x"] + data["viewport"]["width"],
            data["width"] + 4,
        )
        self.assertLessEqual(
            data["viewport"]["y"] + data["viewport"]["height"],
            data["height"] + 4,
        )

    def test_projection_focuses_a_small_viewport_without_unbounded_zoom(self):
        script = f"""
            globalThis.HTMLElement = class {{}};
            const module = await import({json.dumps(MODULE.as_uri())});
            const result = module.projectSmartMinimapScene({{
                width:170,
                height:108,
                padding:0,
                viewport:{{x:700,y:350,width:400,height:300}},
                items:[
                    {{id:'wide-frame',kind:'frame',frameColor:'blue',x:0,y:0,width:2200,height:1000}},
                    {{id:'member',kind:'media',frameColor:'blue',x:760,y:420,width:220,height:160}}
                ]
            }});
            console.log(JSON.stringify(result));
        """
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data["usesViewportFocus"])
        viewport_area = data["viewport"]["width"] * data["viewport"]["height"]
        minimap_area = data["width"] * data["height"]
        self.assertGreaterEqual(viewport_area, minimap_area * 0.1 - 1e-9)
        self.assertLessEqual(data["scale"], data["fitScale"] * 2 + 1e-9)


if __name__ == "__main__":
    unittest.main()
