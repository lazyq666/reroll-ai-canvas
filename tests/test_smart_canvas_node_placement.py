import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/node-placement.js"


def run_placement(body: str):
    script = textwrap.dedent(
        f"""
        const placement = require({json.dumps(str(MODULE))});
        const result = (() => {{ {body} }})();
        process.stdout.write(JSON.stringify(result));
        """
    )
    result = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class SmartCanvasNodePlacementTests(unittest.TestCase):
    def test_empty_canvas_honors_point_viewport_and_source_anchors(self):
        result = run_placement(
            """
            const draft = {id:'draft',type:'smart-prompt',w:316,h:180};
            const point = placement.plan({
                snapshot:{nodes:[]}, drafts:[draft],
                intent:{anchor:{kind:'point',x:1000,y:500},arrangement:'single'}
            });
            const viewport = placement.plan({
                snapshot:{nodes:[]}, drafts:[draft],
                intent:{anchor:{kind:'viewport',x:300,y:200},arrangement:'single'}
            });
            const source = {id:'source',type:'smart-image',x:0,y:0,w:200,h:100,images:[]};
            const downstream = placement.plan({
                snapshot:{nodes:[source]}, drafts:[draft],
                intent:{anchor:{kind:'source',sourceNodeId:'source'},relation:'downstream',arrangement:'single'}
            });
            const upstream = placement.plan({
                snapshot:{nodes:[source]}, drafts:[draft],
                intent:{anchor:{kind:'source',sourceNodeId:'source'},relation:'upstream',arrangement:'single'}
            });
            return {point,viewport,downstream,upstream};
            """
        )
        self.assertEqual(result["point"]["placements"][0], {"id": "draft", "x": 842, "y": 410})
        self.assertEqual(result["viewport"]["placements"][0], {"id": "draft", "x": 142, "y": 110})
        self.assertEqual(result["downstream"]["placements"][0], {"id": "draft", "x": 264, "y": 0})
        self.assertEqual(result["upstream"]["placements"][0], {"id": "draft", "x": -380, "y": 0})

    def test_point_anchor_wins_over_flow_direction_and_ignores_annotations(self):
        result = run_placement(
            """
            const nodes = [
                {id:'source',type:'smart-image',x:1000,y:0,w:200,h:100,images:[]},
                {id:'annotation',type:'smart-text',x:0,y:0,w:316,h:180},
                {id:'drawing',type:'smart-brush',x:0,y:0,w:316,h:180}
            ];
            return placement.plan({
                snapshot:{nodes},
                drafts:[{id:'draft',type:'smart-prompt',w:316,h:180}],
                intent:{
                    anchor:{kind:'point',x:158,y:90,sourceNodeId:'source'},
                    relation:'downstream',arrangement:'single'
                }
            });
            """
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["placements"][0], {"id": "draft", "x": 0, "y": 0})

    def test_short_brush_stroke_does_not_block_new_node_placement(self):
        result = run_placement(
            """
            return placement.plan({
                snapshot:{nodes:[{
                    id:'short-brush',type:'smart-brush',x:10,y:20,
                    w:18.5,h:18,brushSize:6,points:[[9,9],[9.5,9]]
                }]},
                drafts:[{
                    id:'uploaded-image',type:'smart-image',x:0,y:0,scale:2,
                    images:[{
                        url:'uploaded.png',kind:'image',natural_w:64,natural_h:64
                    }]
                }],
                intent:{
                    anchor:{kind:'point',x:500,y:300},
                    relation:'free',arrangement:'single'
                }
            });
            """
        )

        self.assertTrue(result["ok"], result["diagnostics"])
        self.assertEqual(
            result["placements"],
            [{"id": "uploaded-image", "x": 280, "y": 80}],
        )

    def test_collision_search_expands_without_overlap_fallback(self):
        result = run_placement(
            """
            const nodes = Array.from({length:80}, (_,index) => ({
                id:`wall-${index}`,type:'smart-image',x:index * 400,y:0,w:200,h:100,images:[]
            }));
            const plan = placement.plan({
                snapshot:{nodes},
                drafts:[{id:'draft',type:'smart-image',w:200,h:100,images:[]}],
                intent:{anchor:{kind:'source',sourceNodeId:'wall-0'},relation:'downstream',arrangement:'single'}
            });
            return {plan,nodes};
            """
        )
        self.assertTrue(result["plan"]["ok"])
        placed = result["plan"]["placements"][0]
        candidate = {
            "x": placed["x"] - 32,
            "y": placed["y"] - 32,
            "right": placed["x"] + 232,
            "bottom": placed["y"] + 132,
        }
        for node in result["nodes"]:
            obstacle = {
                "x": node["x"] - 32,
                "y": node["y"] - 32,
                "right": node["x"] + 232,
                "bottom": node["y"] + 132,
            }
            self.assertFalse(
                candidate["x"] < obstacle["right"]
                and candidate["right"] > obstacle["x"]
                and candidate["y"] < obstacle["bottom"]
                and candidate["bottom"] > obstacle["y"]
            )

    def test_legacy_multi_output_source_no_longer_reserves_gallery_chrome(self):
        result = run_placement(
            """
            const source = {
                id:'source',type:'smart-image',x:100,y:100,
                generationOutputNode:true,
                generationMediaW:512,generationMediaH:768,
                activeOutputId:'output-b',scale:0.8,
                images:[
                    {url:'a.png',outputId:'output-a',natural_w:1024,natural_h:1024},
                    {url:'b.png',outputId:'output-b',natural_w:1024,natural_h:1536}
                ]
            };
            return placement.plan({
                snapshot:{nodes:[source]},
                drafts:[{id:'draft',type:'smart-image',images:[],scale:2}],
                intent:{
                    anchor:{kind:'source',sourceNodeId:'source'},
                    relation:'downstream',arrangement:'single'
                }
            });
            """
        )

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["placements"][0],
            {"id": "draft", "x": 468, "y": 100},
        )

    def test_vertical_batch_is_atomic_stable_and_uses_64_gap(self):
        result = run_placement(
            """
            const drafts = Array.from({length:3}, (_,index) => ({
                id:`draft-${index}`,type:'smart-image',w:100,h:50,images:[]
            }));
            return placement.plan({
                snapshot:{nodes:[]},drafts,
                intent:{anchor:{kind:'point',x:50,y:171},arrangement:'vertical-batch'}
            });
            """
        )
        self.assertEqual(
            result["placements"],
            [
                {"id": "draft-0", "x": 0, "y": 32},
                {"id": "draft-1", "x": 0, "y": 146},
                {"id": "draft-2", "x": 0, "y": 260},
            ],
        )
        self.assertEqual(result["bounds"], {"x": 0, "y": 32, "width": 100, "height": 278})

    def test_horizontal_batch_is_atomic_stable_and_uses_64_gap(self):
        result = run_placement(
            """
            const drafts = Array.from({length:3}, (_,index) => ({
                id:`draft-${index}`,type:'smart-image',w:100,h:50,images:[]
            }));
            return placement.plan({
                snapshot:{nodes:[]},drafts,
                intent:{anchor:{kind:'point',x:246,y:25},arrangement:'horizontal-batch'}
            });
            """
        )
        self.assertEqual(
            result["placements"],
            [
                {"id": "draft-0", "x": 32, "y": 0},
                {"id": "draft-1", "x": 196, "y": 0},
                {"id": "draft-2", "x": 360, "y": 0},
            ],
        )
        self.assertEqual(result["bounds"], {"x": 32, "y": 0, "width": 428, "height": 50})

    def test_same_source_batches_may_break_old_alignment_to_stay_near_source(self):
        result = run_placement(
            """
            const source = {id:'source',type:'smart-image',x:0,y:0,w:100,h:100,images:[]};
            const horizontalPrevious = [0,1].map(index => ({
                id:`h-${index}`,type:'smart-image',x:300+index*148,y:0,w:100,h:50,images:[],
                generationBatchId:'h-old',generationBatchLayout:'horizontal',
                generationBatchSourceNodeId:'source',created_at:index+1
            }));
            const verticalPrevious = [0,1].map(index => ({
                id:`v-${index}`,type:'smart-image',x:300,y:index*98,w:100,h:50,images:[],
                generationBatchId:'v-old',generationBatchLayout:'vertical',
                generationBatchSourceNodeId:'source',created_at:index+1
            }));
            const drafts = layout => [0,1].map(index => ({
                id:`${layout}-${index}`,type:'smart-image',w:100,h:50,images:[],
                generationBatchId:`${layout}-new`,generationBatchLayout:layout,
                generationBatchSourceNodeId:'source',created_at:100+index
            }));
            return {
                horizontal:placement.plan({
                    snapshot:{nodes:[source,...horizontalPrevious]},drafts:drafts('horizontal'),
                    intent:{anchor:{kind:'source',sourceNodeId:'source'},relation:'downstream',arrangement:'horizontal-batch'}
                }),
                vertical:placement.plan({
                    snapshot:{nodes:[source,...verticalPrevious]},drafts:drafts('vertical'),
                    intent:{anchor:{kind:'source',sourceNodeId:'source'},relation:'downstream',arrangement:'vertical-batch'}
                })
            };
            """
        )
        horizontal = result["horizontal"]["placements"]
        self.assertEqual(horizontal[0]["x"], 164)
        self.assertEqual(horizontal[0]["y"], horizontal[1]["y"])
        self.assertEqual(abs(horizontal[0]["y"]), 114)
        vertical = result["vertical"]["placements"]
        self.assertLessEqual(abs(vertical[0]["y"]), 244)
        self.assertEqual(vertical[0]["x"], vertical[1]["x"])
        self.assertGreaterEqual(vertical[0]["x"], 164)

    def test_rigid_collection_preserves_relative_coordinates_and_internal_overlap(self):
        result = run_placement(
            """
            return placement.plan({
                snapshot:{nodes:[]},
                drafts:[
                    {id:'a',type:'smart-image',x:20,y:30,w:200,h:100,images:[]},
                    {id:'b',type:'smart-prompt',x:120,y:70,w:160,h:100}
                ],
                intent:{anchor:{kind:'point',x:500,y:500},arrangement:'rigid'}
            });
            """
        )
        a, b = result["placements"]
        self.assertEqual(b["x"] - a["x"], 100)
        self.assertEqual(b["y"] - a["y"], 40)

    def test_frame_expands_after_placement_without_constraining_the_search(self):
        result = run_placement(
            """
            const roomy = [
                {id:'frame',type:'smart-frame',x:0,y:0,w:1000,h:600,items:['source']},
                {id:'source',type:'smart-image',x:100,y:100,w:100,h:100,images:[]}
            ];
            const tight = [
                {id:'frame',type:'smart-frame',x:0,y:0,w:700,h:300,items:['source']},
                {id:'source',type:'smart-image',x:500,y:100,w:100,h:100,images:[]}
            ];
            const intent = {anchor:{kind:'source',sourceNodeId:'source'},relation:'downstream',arrangement:'vertical-batch'};
            const drafts = [
                {id:'a',type:'smart-image',w:100,h:100,images:[]},
                {id:'b',type:'smart-image',w:100,h:100,images:[]}
            ];
            return {
                inside:placement.plan({snapshot:{nodes:roomy},drafts,intent}),
                outside:placement.plan({snapshot:{nodes:tight},drafts,intent})
            };
            """
        )
        self.assertLessEqual(result["inside"]["bounds"]["x"] + 100, 1000)
        outside = result["outside"]["bounds"]
        self.assertEqual(outside["x"], 664)
        self.assertEqual(result["outside"]["frameUpdates"], [{"id":"frame","x":0,"y":0,"w":788,"h":388}])

    def test_invalid_geometry_fails_explicitly_and_equal_inputs_are_deterministic(self):
        result = run_placement(
            """
            const request = {
                snapshot:{nodes:[{id:'bad',type:'smart-image',x:Infinity,y:0,w:200,h:100,images:[]}]},
                drafts:[{id:'draft',type:'smart-prompt',w:316,h:180}],
                intent:{anchor:{kind:'viewport',x:0,y:0},arrangement:'single'}
            };
            const invalid = placement.plan(request);
            const validRequest = {...request,snapshot:{nodes:[]}};
            const first = placement.plan(validRequest);
            const second = placement.plan(validRequest);
            return {invalid,deterministic:JSON.stringify(first) === JSON.stringify(second)};
            """
        )
        self.assertFalse(result["invalid"]["ok"])
        self.assertIn("invalid-node-position", [item["code"] for item in result["invalid"]["diagnostics"]])
        self.assertTrue(result["deterministic"])


if __name__ == "__main__":
    unittest.main()
