import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/node-geometry.js"


def run_node_geometry(script):
    program = (
        f"const geometry = require({json.dumps(str(MODULE))});"
        f"{script}"
    )
    result = subprocess.run(
        ["node", "-e", program],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class SmartCanvasNodeGeometryTests(unittest.TestCase):
    def test_prompt_drafts_receive_stable_geometry_from_semantic_content(self):
        result = run_node_geometry(
            """
            const nodes = [
                {
                    id:'reverse-prompt', type:'smart-prompt',
                    llmEnabled:true,
                    llmInputMedia:[{url:'source.png',kind:'image'}]
                },
                {
                    id:'context-prompt', type:'smart-prompt',
                    text:'x'.repeat(512)
                },
                {
                    id:'text-output', type:'smart-prompt',
                    textGenerationOutput:true,
                    textGenerationPending:true
                }
            ];
            const session = geometry.createSession({nodes,connections:[]});
            process.stdout.write(JSON.stringify(Object.fromEntries(
                nodes.map(node => [node.id, session.measure(node.id).footprint])
            )));
            """
        )

        self.assertEqual(
            result["reverse-prompt"],
            {"x": 0, "y": 0, "width": 316, "height": 323},
        )
        self.assertEqual(
            result["context-prompt"],
            {"x": 0, "y": 0, "width": 316, "height": 492},
        )
        self.assertEqual(
            result["text-output"],
            {"x": 0, "y": 0, "width": 316, "height": 180},
        )

    def test_function_nodes_expose_stable_visible_and_interaction_geometry(self):
        result = run_node_geometry(
            """
            const nodes = [
                {id:'prompt',type:'smart-prompt',x:10,y:20,w:316,h:180},
                {id:'splitter',type:'smart-splitter',x:400,y:20},
                {id:'loop',type:'smart-loop',x:800,y:20,w:340,h:168},
                {id:'group',type:'smart-group',x:1200,y:20},
                {id:'frame',type:'smart-frame',x:1600,y:20,w:680,h:420},
                {id:'annotation',type:'smart-text',x:40,y:500,w:240,h:120},
                {id:'brush',type:'smart-brush',x:320,y:500,w:240,h:120}
            ];
            const session = geometry.createSession({nodes,connections:[]});
            process.stdout.write(JSON.stringify(Object.fromEntries(
                nodes.map(node => [node.id, session.measure(node.id)])
            )));
            """
        )

        self.assertEqual(
            result["prompt"]["footprint"],
            {"x": 10, "y": 20, "width": 316, "height": 180},
        )
        self.assertEqual(
            result["prompt"]["interactionFootprint"],
            {"x": -90, "y": -28, "width": 516, "height": 276},
        )
        self.assertEqual(result["splitter"]["layout"]["width"], 316)
        self.assertEqual(result["splitter"]["layout"]["height"], 240)
        self.assertEqual(result["loop"]["layout"]["width"], 340)
        self.assertEqual(result["group"]["layout"]["height"], 286)
        self.assertTrue(result["group"]["placementObstacle"])
        self.assertFalse(result["frame"]["placementObstacle"])
        self.assertTrue(result["frame"]["spatialContainer"])
        self.assertFalse(result["annotation"]["placementObstacle"])
        self.assertFalse(result["brush"]["placementObstacle"])
        self.assertEqual(result["prompt"]["diagnostics"], [])

    def test_short_brush_stroke_preserves_its_persisted_geometry(self):
        result = run_node_geometry(
            """
            const node = {
                id:'short-brush',
                type:'smart-brush',
                x:10,
                y:20,
                w:18.5,
                h:18,
                brushSize:6,
                points:[[9,9],[9.5,9]]
            };
            process.stdout.write(JSON.stringify(
                geometry.createSession({nodes:[node],connections:[]}).measure(node.id)
            ));
            """
        )

        self.assertEqual(
            result["footprint"],
            {"x": 10, "y": 20, "width": 18.5, "height": 18},
        )
        self.assertEqual(result["diagnostics"], [])

    def test_non_positive_brush_dimensions_remain_invalid(self):
        result = run_node_geometry(
            """
            const node = {
                id:'broken-brush',
                type:'smart-brush',
                x:10,
                y:20,
                w:0,
                h:18,
                points:[[9,9],[9.5,9]]
            };
            process.stdout.write(JSON.stringify(
                geometry.createSession({nodes:[node],connections:[]}).measure(node.id)
            ));
            """
        )

        self.assertIn(
            "invalid-persisted-dimensions",
            [diagnostic["code"] for diagnostic in result["diagnostics"]],
        )

    def test_browser_loads_geometry_before_smart_canvas_consumers(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        geometry_index = page.index("/static/js/smart-canvas/node-geometry.js")
        first_consumer_index = page.index(
            "/static/js/smart-canvas/canvas-persistence.js"
        )
        host_index = page.index("/static/js/smart-canvas.js")

        self.assertLess(geometry_index, first_consumer_index)
        self.assertLess(geometry_index, host_index)

    def test_browser_registry_and_node_require_use_the_same_implementation(self):
        result = run_node_geometry(
            f"""
            const fs = require('node:fs');
            const vm = require('node:vm');
            const source = fs.readFileSync(
                {json.dumps(str(MODULE))},
                'utf8'
            );
            const browser = {{}};
            browser.window = browser;
            browser.globalThis = browser;
            vm.createContext(browser);
            vm.runInContext(source,browser);
            const snapshot = {{
                nodes:[{{
                    id:'shared-image',
                    type:'smart-image',
                    images:[{{
                        kind:'image',
                        url:'shared.png',
                        natural_w:900,
                        natural_h:600
                    }}]
                }}],
                connections:[]
            }};
            const directResult = geometry
                .createSession(snapshot)
                .measure('shared-image');
            const browserResult = browser.SmartCanvasModules.nodeGeometry
                .createSession(snapshot)
                .measure('shared-image');
            process.stdout.write(JSON.stringify({{
                browserInterface:Object.keys(
                    browser.SmartCanvasModules.nodeGeometry
                ),
                sameResult:
                    JSON.stringify(directResult)
                    === JSON.stringify(browserResult)
            }}));
            """
        )

        self.assertEqual(result["browserInterface"], ["createSession"])
        self.assertTrue(result["sameResult"])

    def test_direct_node_session_measures_single_image_with_complete_geometry(self):
        result = run_node_geometry(
            """
            const session = geometry.createSession({
                nodes:[{
                    id:'image-1',
                    type:'smart-image',
                    x:-40,
                    y:12,
                    images:[{
                        kind:'image',
                        url:'sample.png',
                        natural_w:1600,
                        natural_h:900
                    }]
                }],
                connections:[]
            });
            process.stdout.write(JSON.stringify(session.measure('image-1')));
            """
        )

        self.assertTrue(result["supported"])
        self.assertEqual(
            result["layout"],
            {
                "cols": 1,
                "rows": 1,
                "width": 520,
                "height": 293,
                "thumb": 192,
                "single": True,
            },
        )
        self.assertEqual(
            result["footprint"],
            {"x": -40, "y": 12, "width": 520, "height": 293},
        )
        self.assertEqual(
            result["constraints"]["minimum"],
            {"width": 48, "height": 48},
        )
        self.assertAlmostEqual(result["constraints"]["aspectRatio"], 16 / 9)
        self.assertEqual(
            result["anchors"],
            {
                "input": {"x": -40, "y": 158.5},
                "output": {"x": 480, "y": 158.5},
                "historyInput": {"x": 220, "y": 12},
                "historyOutput": {"x": 220, "y": 305},
            },
        )
        self.assertEqual(result["diagnostics"], [])

    def test_generated_image_fits_saved_preview_bounds_using_actual_aspect_ratio(self):
        for width, height in [(128, 1024), (1024, 128), (512, 512)]:
            with self.subTest(width=width, height=height):
                result = run_node_geometry(f"""
                    const node = {{id:'result', type:'smart-image',
                        generationOutputNode:true, generationMediaW:352, generationMediaH:352,
                        images:[{{url:'output.jpg',natural_w:{width},natural_h:{height}}}]}};
                    const measured = geometry.createSession({{nodes:[node]}}).measure(node.id);
                    process.stdout.write(JSON.stringify({{layout:measured.layout,
                        savedWidth:node.generationMediaW,savedHeight:node.generationMediaH}}));
                """)
                self.assertEqual(result['layout']['width'] / result['layout']['height'], width / height)
                self.assertEqual(max(result['layout']['width'], result['layout']['height']), 352)
                self.assertEqual((result['savedWidth'], result['savedHeight']), (352, 352))

    def test_generated_image_without_dimensions_keeps_saved_preview_bounds(self):
        result = run_node_geometry("""
            const node = {id:'result',type:'smart-image',generationMediaW:352,generationMediaH:264,
                images:[{url:'output.jpg'}]};
            process.stdout.write(JSON.stringify(geometry.createSession({nodes:[node]}).measure(node.id).layout));
        """)
        self.assertEqual((result['width'], result['height']), (352, 264))

    def test_layer_manifest_overrides_stale_square_preview_and_generation_size(self):
        result = run_node_geometry("""
            const node = {id:'layers', type:'smart-layer-decomposition', w:350, h:350,
                generationMediaW:350, generationMediaH:350,
                images:[{url:'base.png', natural_w:1024, natural_h:1024}],
                layerDecompositionManifest:{canvas_width:1000, canvas_height:1500}};
            const measured = geometry.createSession({nodes:[node]}).measure(node.id);
            process.stdout.write(JSON.stringify({layout:measured.layout,
                ratio:measured.constraints.aspectRatio, originalHeight:node.h}));
        """)
        self.assertEqual(result['layout']['width'], 350)
        self.assertEqual(result['layout']['height'], 525)
        self.assertAlmostEqual(result['ratio'], 2 / 3)
        self.assertEqual(result['originalHeight'], 350)

    def test_restored_layer_node_with_all_outputs_remains_one_composition(self):
        result = run_node_geometry("""
            const node = {id:'layers', type:'smart-layer-decomposition',
                generationMediaW:291, generationMediaH:437,
                images:[{url:'base.png', natural_w:832, natural_h:1248},
                    ...Array.from({length:14}, (_, i) => ({url:`layer-${i}.png`}))],
                layerDecompositionManifest:{canvas_width:832, canvas_height:1248}};
            const measured = geometry.createSession({nodes:[node]}).measure(node.id);
            process.stdout.write(JSON.stringify({layout:measured.layout,
                ratio:measured.constraints.aspectRatio}));
        """)
        self.assertTrue(result['layout']['single'])
        self.assertEqual(result['layout']['cols'], 1)
        self.assertEqual(result['layout']['width'], 291)
        self.assertEqual(result['layout']['height'], 437)
        self.assertAlmostEqual(result['layout']['width'] / result['layout']['height'], 2 / 3, places=2)
        self.assertAlmostEqual(result['ratio'], 2 / 3)

    def test_layer_decomposition_node_uses_single_image_geometry(self):
        result = run_node_geometry(
            """
            const node = {
                id:'layer-result',
                type:'smart-layer-decomposition',
                x:10,
                y:20,
                w:350,
                h:175,
                images:[{kind:'image',url:'base.png',natural_w:1000,natural_h:500}]
            };
            const session = geometry.createSession({nodes:[node],connections:[]});
            const measured = session.measure(node.id);
            process.stdout.write(JSON.stringify({
                supported:measured.supported,
                layout:measured.layout,
                footprint:measured.footprint,
                aspectRatio:measured.constraints.aspectRatio,
                diagnostics:measured.diagnostics
            }));
            """
        )

        self.assertTrue(result["supported"])
        self.assertTrue(result["layout"]["single"])
        self.assertEqual(result["layout"]["width"], 350)
        self.assertEqual(result["layout"]["height"], 175)
        self.assertEqual(
            result["footprint"],
            {"x": 10, "y": 20, "width": 350, "height": 175},
        )
        self.assertAlmostEqual(result["aspectRatio"], 2)
        self.assertEqual(result["diagnostics"], [])

    def test_legacy_multi_output_no_longer_reserves_gallery_chrome(self):
        result = run_node_geometry(
            """
            const node = {
                id:'multi-output',
                type:'smart-image',
                x:10,
                y:20,
                generationOutputNode:true,
                generationMediaW:512,
                generationMediaH:768,
                activeOutputId:'output-b',
                scale:0.8,
                images:[
                    {url:'a.png',outputId:'output-a',natural_w:1024,natural_h:1024},
                    {url:'b.png',outputId:'output-b',natural_w:1024,natural_h:1536}
                ]
            };
            process.stdout.write(JSON.stringify(
                geometry.createSession({nodes:[node],connections:[]}).measure(node.id)
            ));
            """
        )

        self.assertEqual(result["layout"]["width"], 304)
        self.assertEqual(result["layout"]["height"], 244)
        self.assertEqual(result["layout"]["cols"], 2)
        self.assertEqual(result["layout"]["rows"], 1)
        self.assertFalse(result["layout"]["single"])
        self.assertNotIn("generationOutput", result["layout"])
        self.assertEqual(
            result["footprint"],
            {"x": 10, "y": 20, "width": 304, "height": 244},
        )
        self.assertEqual(
            result["interactionFootprint"],
            {"x": -90, "y": -28, "width": 504, "height": 340},
        )

    def test_multi_image_geometry_matches_the_production_aspect_aware_grid(self):
        result = run_node_geometry(
            """
            const node = {
                id:'two-images', type:'smart-image',
                images:[
                    {url:'a.png',natural_w:1122,natural_h:1088},
                    {url:'b.png',natural_w:1124,natural_h:736}
                ]
            };
            process.stdout.write(JSON.stringify(
                geometry.createSession({nodes:[node],connections:[]}).measure(node.id).layout
            ));
            """
        )

        self.assertEqual(result["width"], 304)
        self.assertEqual(result["height"], 176)
        self.assertEqual(result["thumb"], 128)
        self.assertEqual(result["gridHeight"], 144)

    def test_persisted_dimensions_match_legacy_visible_geometry_without_mutation(self):
        result = run_node_geometry(
            """
            const node = {
                id:'persisted-image',
                type:'smart-image',
                x:30,
                y:40,
                w:301,
                h:999,
                images:[{
                    kind:'image',
                    url:'persisted.png',
                    natural_w:1200,
                    natural_h:800
                }]
            };
            const before = JSON.stringify(node);
            const measured = geometry
                .createSession({nodes:[node],connections:[]})
                .measure(node.id);
            process.stdout.write(JSON.stringify({
                before,
                after:JSON.stringify(node),
                measured,
                frozen:Object.isFrozen(measured)
                    && Object.isFrozen(measured.layout)
                    && Object.isFrozen(measured.anchors)
            }));
            """
        )

        self.assertEqual(result["after"], result["before"])
        self.assertEqual(
            result["measured"]["layout"],
            {
                "cols": 1,
                "rows": 1,
                "width": 301,
                "height": 201,
                "thumb": 192,
                "single": True,
            },
        )
        self.assertTrue(result["frozen"])

    def test_preview_overlay_replaces_effective_node_without_changing_snapshot(self):
        result = run_node_geometry(
            """
            const source = {
                id:'overlay-image',
                type:'smart-image',
                x:10,
                y:20,
                images:[{
                    kind:'image',
                    url:'source.png',
                    natural_w:1000,
                    natural_h:1000
                }]
            };
            const preview = {
                ...source,
                x:90,
                y:-30,
                w:360,
                h:120,
                images:[{
                    kind:'image',
                    url:'preview.png',
                    natural_w:1600,
                    natural_h:900
                }]
            };
            const before = JSON.stringify(source);
            const measured = geometry.createSession(
                {nodes:[source],connections:[]},
                {nodes:{'overlay-image':preview}}
            ).measure(source.id);
            process.stdout.write(JSON.stringify({
                sourceUnchanged:JSON.stringify(source) === before,
                measured
            }));
            """
        )

        self.assertTrue(result["sourceUnchanged"])
        self.assertEqual(
            result["measured"]["footprint"],
            {"x": 90, "y": -30, "width": 360, "height": 203},
        )

    def test_invalid_image_dimensions_return_safe_geometry_and_diagnostics(self):
        result = run_node_geometry(
            """
            const node = {
                id:'broken-image',
                type:'smart-image',
                x:Number.POSITIVE_INFINITY,
                y:'not-a-number',
                w:0,
                h:Number.NaN,
                scale:-3,
                images:[{
                    kind:'image',
                    url:'broken.png',
                    natural_w:Number.POSITIVE_INFINITY,
                    natural_h:-50
                }]
            };
            const before = {
                x:node.x,
                y:node.y,
                w:node.w,
                h:node.h,
                scale:node.scale,
                natural_w:node.images[0].natural_w,
                natural_h:node.images[0].natural_h
            };
            const measured = geometry
                .createSession({nodes:[node],connections:[]})
                .measure(node.id);
            process.stdout.write(JSON.stringify({
                measured,
                unchanged:Object.is(node.x,before.x)
                    && Object.is(node.y,before.y)
                    && Object.is(node.w,before.w)
                    && Object.is(node.h,before.h)
                    && Object.is(node.scale,before.scale)
                    && Object.is(node.images[0].natural_w,before.natural_w)
                    && Object.is(node.images[0].natural_h,before.natural_h)
            }));
            """
        )

        self.assertTrue(result["unchanged"])
        self.assertEqual(
            result["measured"]["footprint"],
            {"x": 0, "y": 0, "width": 520, "height": 360},
        )
        self.assertAlmostEqual(
            result["measured"]["constraints"]["aspectRatio"],
            520 / 360,
        )
        self.assertIn(
            "invalid-image-dimensions",
            [
                diagnostic["code"]
                for diagnostic in result["measured"]["diagnostics"]
            ],
        )
        for value in result["measured"]["footprint"].values():
            self.assertIsInstance(value, (int, float))

    def test_missing_image_dimensions_preserve_visible_layout_as_aspect_constraint(self):
        result = run_node_geometry(
            """
            const measured = geometry.createSession({
                nodes:[{
                    id:'persisted-without-metadata',
                    type:'smart-image',
                    w:300,
                    h:200,
                    images:[{
                        kind:'image',
                        url:'missing-metadata.png'
                    }]
                }],
                connections:[]
            }).measure('persisted-without-metadata');
            process.stdout.write(JSON.stringify(measured));
            """
        )

        self.assertEqual(
            result["footprint"],
            {"x": 0, "y": 0, "width": 300, "height": 200},
        )
        self.assertEqual(result["constraints"]["aspectRatio"], 1.5)
        self.assertIn(
            "missing-image-dimensions",
            [diagnostic["code"] for diagnostic in result["diagnostics"]],
        )

    def test_repeated_queries_are_stable_and_memoized_within_one_session(self):
        result = run_node_geometry(
            """
            const node = {
                id:'memo-image',
                type:'smart-image',
                x:5,
                y:6,
                images:[{
                    kind:'image',
                    url:'memo.png',
                    natural_w:400,
                    natural_h:200
                }]
            };
            const snapshot = {nodes:[node],connections:[]};
            const session = geometry.createSession(snapshot);
            const first = session.measure(node.id);
            node.x = 999;
            node.images[0].natural_w = 200;
            const second = session.measure(node.id);
            const fresh = geometry.createSession(snapshot).measure(node.id);
            process.stdout.write(JSON.stringify({
                reused:first === second,
                first:first.footprint,
                second:second.footprint,
                fresh:fresh.footprint
            }));
            """
        )

        self.assertTrue(result["reused"])
        self.assertEqual(result["second"], result["first"])
        self.assertNotEqual(result["fresh"], result["first"])


if __name__ == "__main__":
    unittest.main()
