import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/selection-arrangement.js"


def run_arrangement(body: str):
    script = textwrap.dedent(
        f"""
        const arrangement = require({json.dumps(str(MODULE))});
        const result = (() => {{ {body} }})();
        process.stdout.write(JSON.stringify(result));
        """
    )
    completed = subprocess.run(
        ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
    )
    if completed.returncode:
        raise AssertionError(completed.stderr)
    return json.loads(completed.stdout)


class SmartCanvasSelectionArrangementTests(unittest.TestCase):
    def test_horizontal_and_vertical_clamp_actual_gap_to_two_rem(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:100,h:50},
                {id:'b',type:'smart-image',x:40,y:80,w:100,h:50},
                {id:'c',type:'smart-image',x:80,y:160,w:100,h:50},
            ];
            return {
                horizontal:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'horizontal'}),
                vertical:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'vertical'}),
            };
            """
        )
        self.assertEqual(result["horizontal"]["gap"], 32)
        self.assertEqual(
            [item["x"] for item in result["horizontal"]["placements"]],
            [0, 132, 264],
        )
        self.assertEqual(result["vertical"]["gap"], 32)
        self.assertEqual(
            [item["y"] for item in result["vertical"]["placements"]],
            [0, 82, 164],
        )

    def test_horizontal_preserves_original_left_to_right_order_regardless_of_connections(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:300,w:80,h:40},
                {id:'b',type:'smart-image',x:200,y:0,w:80,h:40},
                {id:'c',type:'smart-image',x:400,y:150,w:80,h:40},
                {id:'outside',type:'smart-image',x:600,y:0,w:80,h:40},
            ];
            const request = {
                nodes,selectedIds:['a','b','c'],mode:'horizontal',
                connections:[
                    {from:'c',to:'a'},
                    {from:'outside',to:'b'},
                    {from:'b',to:'outside'},
                ]
            };
            return arrangement.plan(request);
            """
        )
        arranged_ids = [
            item["id"] for item in sorted(result["placements"], key=lambda item: item["x"])
        ]
        self.assertEqual(arranged_ids, ["a", "b", "c"])

    def test_grid_uses_actual_column_and_row_gaps_with_two_rem_minimum(self):
        result = run_arrangement(
            """
            const nodes = Array.from({length:4},(_,index) => ({
                id:String(index),type:'smart-image',x:index * 20,y:index * 10,w:100,h:100
            }));
            return arrangement.plan({nodes,selectedIds:nodes.map(node=>node.id),mode:'grid'});
            """
        )
        self.assertEqual(result["gap"], 32)
        self.assertEqual(result["bounds"]["width"], 232)
        self.assertEqual(result["bounds"]["height"], 232)

    def test_grid_preserves_existing_four_by_two_topology(self):
        result = run_arrangement(
            """
            const nodes = Array.from({length:8},(_,index) => ({
                id:String.fromCharCode(97 + index),
                type:'smart-image',
                x:(index % 4) * 132,
                y:Math.floor(index / 4) * 132,
                w:100,
                h:100,
            }));
            return arrangement.plan({
                nodes,
                selectedIds:nodes.map(node=>node.id),
                mode:'grid',
            });
            """
        )
        columns = {item["x"] for item in result["placements"]}
        rows = {item["y"] for item in result["placements"]}
        self.assertEqual(len(columns), 4)
        self.assertEqual(len(rows), 2)

    def test_grid_preserves_loose_visual_rows_and_slot_order(self):
        result = run_arrangement(
            """
            const coordinates = [
                [0,12],[140,0],[260,8],[400,4],
                [8,144],[132,132],[272,140],[392,136],
            ];
            const nodes = coordinates.map(([x,y],index) => ({
                id:String.fromCharCode(97 + index),
                type:'smart-image',x,y,w:100,h:100,
            }));
            return arrangement.plan({
                nodes,
                selectedIds:nodes.map(node=>node.id),
                mode:'grid',
            });
            """
        )
        arranged_ids = [
            item["id"]
            for item in sorted(
                result["placements"], key=lambda item: (item["y"], item["x"])
            )
        ]
        self.assertEqual(arranged_ids, list("abcdefgh"))
        self.assertEqual(len({item["x"] for item in result["placements"]}), 4)
        self.assertEqual(len({item["y"] for item in result["placements"]}), 2)

    def test_grid_falls_back_to_compact_shape_for_non_grid_scatter(self):
        result = run_arrangement(
            """
            const nodes = Array.from({length:8},(_,index) => ({
                id:String(index),
                type:'smart-image',
                x:index * 150,
                y:index * 150,
                w:100,
                h:100,
            }));
            return arrangement.plan({
                nodes,
                selectedIds:nodes.map(node=>node.id),
                mode:'grid',
            });
            """
        )
        self.assertEqual(len({item["x"] for item in result["placements"]}), 3)
        self.assertEqual(len({item["y"] for item in result["placements"]}), 3)

    def test_linear_modes_average_the_original_axis_gap(self):
        result = run_arrangement(
            """
            const horizontal = [
                {id:'a',type:'smart-image',x:0,y:0,w:100,h:50},
                {id:'b',type:'smart-image',x:140,y:0,w:100,h:50},
                {id:'c',type:'smart-image',x:320,y:0,w:100,h:50},
            ];
            const vertical = [
                {id:'a',type:'smart-image',x:0,y:0,w:50,h:100},
                {id:'b',type:'smart-image',x:0,y:150,w:50,h:100},
                {id:'c',type:'smart-image',x:0,y:350,w:50,h:100},
            ];
            return {
                horizontal:arrangement.plan({
                    nodes:horizontal,
                    selectedIds:horizontal.map(node=>node.id),
                    mode:'horizontal',
                }),
                vertical:arrangement.plan({
                    nodes:vertical,
                    selectedIds:vertical.map(node=>node.id),
                    mode:'vertical',
                }),
            };
            """
        )
        self.assertEqual(result["horizontal"]["gap"], 60)
        self.assertEqual(result["vertical"]["gap"], 75)

    def test_grid_keeps_the_shared_average_of_horizontal_and_vertical_gaps(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:100,h:100},
                {id:'b',type:'smart-image',x:140,y:0,w:100,h:100},
                {id:'c',type:'smart-image',x:0,y:180,w:100,h:100},
                {id:'d',type:'smart-image',x:140,y:180,w:100,h:100},
            ];
            return arrangement.plan({
                nodes,
                selectedIds:nodes.map(node=>node.id),
                mode:'grid',
            });
            """
        )
        self.assertEqual(result["gap"], 60)
        self.assertEqual(
            sorted({item["x"] for item in result["placements"]}), [0, 160]
        )
        self.assertEqual(
            sorted({item["y"] for item in result["placements"]}), [0, 160]
        )

    def test_tree_builds_one_forest_and_preserves_left_and_vertical_center(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:100,y:100,w:80,h:40},
                {id:'x',type:'smart-image',x:110,y:240,w:80,h:40},
                {id:'b',type:'smart-image',x:400,y:120,w:80,h:40},
                {id:'y',type:'smart-image',x:410,y:260,w:80,h:40},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-vertical',
                connections:[{from:'a',to:'b'},{from:'x',to:'y'}]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["a"]["x"], by_id["x"]["x"])
        self.assertEqual(by_id["b"]["x"], by_id["y"]["x"])
        self.assertLess(by_id["a"]["x"], by_id["b"]["x"])
        self.assertLess(by_id["a"]["y"], by_id["x"]["y"])
        self.assertLess(by_id["b"]["y"], by_id["y"]["y"])
        self.assertEqual(result["bounds"]["x"], 100)
        self.assertAlmostEqual(
            result["bounds"]["y"] + result["bounds"]["height"] / 2,
            200,
        )

    def test_horizontal_branches_keep_parent_left_and_put_siblings_in_a_row(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:120,y:100,w:80,h:60},
                {id:'b1',type:'smart-image',x:40,y:420,w:100,h:160},
                {id:'b2',type:'smart-image',x:260,y:420,w:100,h:160},
                {id:'b3',type:'smart-image',x:480,y:420,w:100,h:160},
                {id:'b4',type:'smart-image',x:700,y:420,w:100,h:160},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'a',to:'b1'},{from:'a',to:'b2'},
                    {from:'a',to:'b3'},{from:'a',to:'b4'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        child_x = [by_id[f"b{index}"]["x"] for index in range(1, 5)]
        child_y = {by_id[f"b{index}"]["y"] for index in range(1, 5)}
        self.assertEqual(child_x, sorted(child_x))
        self.assertEqual(len(child_y), 1)
        self.assertLess(by_id["a"]["x"], by_id["b1"]["x"])
        self.assertGreaterEqual(
            by_id["b1"]["x"] - (by_id["a"]["x"] + 80),
            32,
        )
        for left, right in zip(child_x, child_x[1:]):
            self.assertGreaterEqual(right - (left + 100), 32)
        self.assertAlmostEqual(
            by_id["a"]["y"] + 30,
            by_id["b1"]["y"] + 80,
            delta=1,
        )
        self.assertEqual(result["bounds"]["x"], 40)
        self.assertAlmostEqual(
            result["bounds"]["y"] + result["bounds"]["height"] / 2,
            340,
        )

    def test_horizontal_branches_keep_a_parent_chain_in_one_progressive_lane(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:80,h:60},
                {id:'b',type:'smart-image',x:200,y:0,w:80,h:60},
                {id:'c',type:'smart-image',x:400,y:0,w:80,h:60},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[{from:'a',to:'b'},{from:'b',to:'c'}]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["a"]["y"], by_id["b"]["y"])
        self.assertEqual(by_id["b"]["y"], by_id["c"]["y"])
        self.assertLess(by_id["a"]["x"], by_id["b"]["x"])
        self.assertLess(by_id["b"]["x"], by_id["c"]["x"])

    def test_horizontal_branches_indent_parent_lanes_by_graph_depth(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'group_a41xl6ruph9g',type:'smart-group',x:4500,y:-3764,w:432,h:698},
                {id:'smart_rfy6iw9pqvdn',type:'smart-image',x:5122,y:-3383,w:300,h:450,
                    generationBatchId:'batch-group'},
                {id:'smart_ie0hc0vjqvdn',type:'smart-image',x:5129,y:-3891,w:300,h:450,
                    generationBatchId:'batch-group'},
                {id:'smart_6qsmfbgegwx3',type:'smart-image',x:5116,y:-4446,w:300,h:450},
                {id:'smart_0cfymxn1h7f5',type:'smart-image',x:5576,y:-3869,w:300,h:450,
                    inputNodeIds:['smart_ie0hc0vjqvdn','smart_6qsmfbgegwx3']},
                {id:'smart_ceqtlh4hopn6',type:'smart-image',x:5995,y:-4384,w:300,h:450,
                    inputNodeIds:['smart_0cfymxn1h7f5']},
                {id:'smart_nov4knmarb4w',type:'smart-image',x:6006,y:-3869,w:300,h:450,
                    inputNodeIds:['smart_0cfymxn1h7f5']},
                {id:'smart_bmxxmtlropn6',type:'smart-image',x:6369,y:-3869,w:300,h:450,
                    inputNodeIds:['smart_0cfymxn1h7f5']},
                {id:'smart_22x01qvnvjgs',type:'smart-image',x:6352,y:-4381,w:300,h:450,
                    inputNodeIds:['smart_ceqtlh4hopn6']},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'group_a41xl6ruph9g',to:'smart_rfy6iw9pqvdn'},
                    {from:'group_a41xl6ruph9g',to:'smart_ie0hc0vjqvdn'},
                    {from:'smart_ie0hc0vjqvdn',to:'smart_0cfymxn1h7f5'},
                    {from:'smart_6qsmfbgegwx3',to:'smart_0cfymxn1h7f5'},
                    {from:'smart_0cfymxn1h7f5',to:'smart_ceqtlh4hopn6'},
                    {from:'smart_0cfymxn1h7f5',to:'smart_nov4knmarb4w'},
                    {from:'smart_0cfymxn1h7f5',to:'smart_bmxxmtlropn6'},
                    {from:'smart_ceqtlh4hopn6',to:'smart_22x01qvnvjgs'},
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        main_lane = [
            by_id["smart_ie0hc0vjqvdn"],
            by_id["smart_0cfymxn1h7f5"],
            by_id["smart_nov4knmarb4w"],
            by_id["smart_bmxxmtlropn6"],
        ]
        self.assertEqual(len({item["y"] for item in main_lane}), 1)
        self.assertEqual(
            [item["x"] for item in main_lane],
            sorted(item["x"] for item in main_lane),
        )
        self.assertEqual(
            by_id["smart_ceqtlh4hopn6"]["y"],
            by_id["smart_22x01qvnvjgs"]["y"],
        )
        self.assertLess(
            by_id["smart_ceqtlh4hopn6"]["x"],
            by_id["smart_22x01qvnvjgs"]["x"],
        )
        self.assertLess(
            by_id["group_a41xl6ruph9g"]["x"],
            by_id["smart_rfy6iw9pqvdn"]["x"],
        )
        self.assertEqual(
            by_id["smart_6qsmfbgegwx3"]["x"],
            by_id["smart_ie0hc0vjqvdn"]["x"],
        )

    def test_horizontal_branches_stack_multiple_parent_rows_vertically(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:180,y:120,w:80,h:60},
                {id:'a1',type:'smart-image',x:360,y:120,w:100,h:60},
                {id:'a2',type:'smart-image',x:500,y:120,w:100,h:60},
                {id:'a3',type:'smart-image',x:640,y:120,w:100,h:60},
                {id:'b',type:'smart-image',x:180,y:420,w:80,h:60},
                {id:'b1',type:'smart-image',x:360,y:420,w:100,h:60},
                {id:'b2',type:'smart-image',x:500,y:420,w:100,h:60},
                {id:'b3',type:'smart-image',x:640,y:420,w:100,h:60},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'a',to:'a1'},{from:'a',to:'a2'},{from:'a',to:'a3'},
                    {from:'b',to:'b1'},{from:'b',to:'b2'},{from:'b',to:'b3'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["a"]["x"], by_id["b"]["x"])
        self.assertLess(by_id["a"]["y"], by_id["b"]["y"])
        for parent in ("a", "b"):
            children = [by_id[f"{parent}{index}"] for index in range(1, 4)]
            self.assertTrue(all(child["y"] == by_id[parent]["y"] for child in children))
            self.assertEqual(
                [child["x"] for child in children],
                sorted(child["x"] for child in children),
            )
            self.assertLess(by_id[parent]["x"], children[0]["x"])

    def test_horizontal_branches_use_generation_source_to_recover_parent_rows(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:80,h:60},
                {id:'a1',type:'smart-image',x:200,y:0,w:100,h:60,generationBatchSourceNodeId:'a',generationBatchId:'batch-a'},
                {id:'a2',type:'smart-image',x:340,y:0,w:100,h:60,generationBatchSourceNodeId:'a',generationBatchId:'batch-a'},
                {id:'b',type:'smart-image',x:0,y:300,w:80,h:60},
                {id:'b1',type:'smart-image',x:200,y:300,w:100,h:60,generationBatchSourceNodeId:'b',generationBatchId:'batch-b'},
                {id:'b2',type:'smart-image',x:340,y:300,w:100,h:60,generationBatchSourceNodeId:'b',generationBatchId:'batch-b'},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'outside',to:'a'},{from:'outside',to:'a1'},{from:'outside',to:'a2'},
                    {from:'outside',to:'b'},{from:'outside',to:'b1'},{from:'outside',to:'b2'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["a"]["x"], by_id["b"]["x"])
        self.assertLess(by_id["a"]["y"], by_id["b"]["y"])
        self.assertEqual(by_id["a"]["y"], by_id["a1"]["y"])
        self.assertEqual(by_id["a1"]["y"], by_id["a2"]["y"])
        self.assertEqual(by_id["b"]["y"], by_id["b1"]["y"])
        self.assertEqual(by_id["b1"]["y"], by_id["b2"]["y"])

    def test_horizontal_branches_keep_parent_with_its_generation_batch(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:80,h:60,generationBatchSourceNodeId:'outside',generationBatchId:'batch-a'},
                {id:'a1',type:'smart-image',x:200,y:180,w:100,h:60,generationBatchSourceNodeId:'outside',generationBatchId:'batch-a'},
                {id:'a2',type:'smart-image',x:340,y:180,w:100,h:60,generationBatchSourceNodeId:'outside',generationBatchId:'batch-a'},
                {id:'next',type:'smart-image',x:600,y:0,w:100,h:60},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[{from:'a',to:'next'}]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["a"]["y"], by_id["a1"]["y"])
        self.assertEqual(by_id["a1"]["y"], by_id["a2"]["y"])
        self.assertLess(by_id["a"]["x"], by_id["a1"]["x"])
        self.assertLess(by_id["a1"]["x"], by_id["a2"]["x"])

    def test_horizontal_branches_keep_run_source_parent_with_its_batch(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'c',type:'smart-image',x:0,y:400,w:80,h:60},
                {id:'c1',type:'smart-image',x:200,y:100,w:100,h:60,sourceNodeId:'c',generationBatchId:'batch-c'},
                {id:'c2',type:'smart-image',x:340,y:100,w:100,h:60,sourceNodeId:'c',generationBatchId:'batch-c'},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["c"]["y"], by_id["c1"]["y"])
        self.assertEqual(by_id["c1"]["y"], by_id["c2"]["y"])
        self.assertLess(by_id["c"]["x"], by_id["c1"]["x"])
        self.assertLess(by_id["c1"]["x"], by_id["c2"]["x"])

    def test_horizontal_branches_order_rows_by_the_whole_parent_child_group(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:80,h:60},
                {id:'a1',type:'smart-image',x:200,y:0,w:100,h:60,generationBatchSourceNodeId:'a'},
                {id:'b',type:'smart-image',x:0,y:150,w:80,h:60},
                {id:'b1',type:'smart-image',x:200,y:150,w:100,h:60,generationBatchSourceNodeId:'b'},
                {id:'c1',type:'smart-image',x:200,y:300,w:100,h:60,sourceNodeId:'c',generationBatchId:'batch-c'},
                {id:'c2',type:'smart-image',x:340,y:300,w:100,h:60,sourceNodeId:'c',generationBatchId:'batch-c'},
                {id:'d',type:'smart-image',x:0,y:500,w:80,h:60},
                {id:'d1',type:'smart-image',x:200,y:500,w:100,h:60,generationBatchSourceNodeId:'d'},
                {id:'d2',type:'smart-image',x:340,y:500,w:100,h:60,generationBatchSourceNodeId:'d'},
                {id:'c',type:'smart-image',x:0,y:800,w:80,h:60},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertEqual(by_id["c"]["y"], by_id["c1"]["y"])
        self.assertEqual(by_id["c1"]["y"], by_id["c2"]["y"])
        self.assertLess(by_id["a"]["y"], by_id["b"]["y"])
        self.assertLess(by_id["b"]["y"], by_id["c"]["y"])
        self.assertLess(by_id["c"]["y"], by_id["d"]["y"])

    def test_horizontal_branches_do_not_treat_reused_batch_head_as_parent(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'smart_u6mqda172f5b',type:'smart-image',x:4245.864,y:-24981.084,w:296,h:442},
                {id:'smart_1e9uoedg7m7m',type:'smart-image',x:4264,y:-24304,w:292,h:440,
                    sourceNodeId:'smart_1e9uoedg7m7m',
                    generationBatchSourceNodeId:'smart_1e9uoedg7m7m',
                    generationBatchId:'generation-batch_zamvzl6p7qvn',
                    generationSlotIndex:0,generationSlotCount:2,
                    inputNodeIds:['smart_u6mqda172f5b']},
                {id:'smart_7b577fwk7qvo',type:'smart-image',x:4777,y:-24304,w:292,h:440,
                    sourceNodeId:'smart_7b577fwk7qvo',
                    generationBatchSourceNodeId:'smart_1e9uoedg7m7m',
                    generationBatchId:'generation-batch_zamvzl6p7qvn',
                    generationSlotIndex:1,generationSlotCount:2,
                    inputNodeIds:['smart_u6mqda172f5b']},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'smart_u6mqda172f5b',to:'smart_1e9uoedg7m7m',kind:'input'},
                    {from:'smart_u6mqda172f5b',to:'smart_7b577fwk7qvo',kind:'input'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        parent = by_id["smart_u6mqda172f5b"]
        first = by_id["smart_1e9uoedg7m7m"]
        second = by_id["smart_7b577fwk7qvo"]
        self.assertAlmostEqual(parent["y"] + 221, first["y"] + 220, delta=1)
        self.assertAlmostEqual(first["y"] + 220, second["y"] + 220, delta=1)
        self.assertLess(parent["x"], first["x"])
        self.assertLess(first["x"], second["x"])

    def test_horizontal_branches_prefer_explicit_parent_over_cross_batch_provenance(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'smart_bvn91r1u937s',type:'smart-image',x:4335,y:-13782,w:172,h:259},
                {id:'smart_ylu93qelafr0',type:'smart-image',x:4244,y:-14555,w:172,h:259,
                    sourceNodeId:'smart_ylu93qelafr0',
                    generationBatchSourceNodeId:'smart_e739igp3adty',
                    generationBatchId:'generation-batch_gap5t4gyafr0',
                    inputNodeIds:['smart_bvn91r1u937s']},
                {id:'smart_b5tlimh6d1yb',type:'smart-image',x:4745,y:-13938,w:172,h:259,
                    generationBatchSourceNodeId:'smart_ylu93qelafr0',
                    generationBatchId:'generation-batch_s1bcwi1td1yb',
                    inputNodeIds:['smart_bvn91r1u937s']},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-horizontal',
                connections:[
                    {from:'smart_bvn91r1u937s',to:'smart_ylu93qelafr0'},
                    {from:'smart_bvn91r1u937s',to:'smart_b5tlimh6d1yb'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        parent = by_id["smart_bvn91r1u937s"]
        first = by_id["smart_ylu93qelafr0"]
        second = by_id["smart_b5tlimh6d1yb"]
        self.assertAlmostEqual(parent["y"] + 129.5, first["y"] + 129.5, delta=1)
        self.assertAlmostEqual(first["y"] + 129.5, second["y"] + 129.5, delta=1)
        self.assertLess(parent["x"], first["x"])
        self.assertLess(first["x"], second["x"])

    def test_tree_projects_group_member_connections_and_ignores_external_edges(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'group',type:'smart-group',items:['member-a','member-b'],x:0,y:100,w:100,h:100},
                {id:'member-a',type:'smart-image',x:10,y:110,w:20,h:20},
                {id:'member-b',type:'smart-image',x:40,y:110,w:20,h:20},
                {id:'target',type:'smart-image',x:300,y:100,w:100,h:100},
                {id:'outside',type:'smart-image',x:-300,y:100,w:100,h:100},
            ];
            return arrangement.plan({
                nodes,selectedIds:['group','target'],mode:'tree-vertical',
                connections:[
                    {from:'member-a',to:'target'},
                    {from:'member-b',to:'target'},
                    {from:'outside',to:'target'}
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        self.assertLess(by_id["group"]["x"], by_id["target"]["x"])
        self.assertEqual(len(result["placements"]), 2)

    def test_multi_parent_node_appears_once_and_cycle_is_named_fallback(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:50,h:50},
                {id:'b',type:'smart-image',x:0,y:100,w:50,h:50},
                {id:'c',type:'smart-image',x:200,y:50,w:50,h:50},
            ];
            return {
                merge:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'tree-vertical',connections:[
                    {from:'a',to:'c'},{from:'b',to:'c'}
                ]}),
                cycle:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'tree-vertical',connections:[
                    {from:'a',to:'b'},{from:'b',to:'a'}
                ]})
            };
            """
        )
        self.assertEqual(
            len([item for item in result["merge"]["placements"] if item["id"] == "c"]),
            1,
        )
        self.assertEqual(result["cycle"]["diagnostics"], [{"code": "cycle-fallback"}])

    def test_tree_centers_merge_and_downstream_nodes_between_their_parents(self):
        result = run_arrangement(
            """
            const nodes = [
                {id:'a',type:'smart-image',x:0,y:0,w:80,h:40},
                {id:'b',type:'smart-image',x:0,y:240,w:80,h:40},
                {id:'merge',type:'smart-image',x:260,y:80,w:120,h:80},
                {id:'tail',type:'smart-image',x:520,y:100,w:80,h:40},
            ];
            return arrangement.plan({
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree-vertical',
                connections:[
                    {from:'a',to:'merge'},
                    {from:'b',to:'merge'},
                    {from:'merge',to:'tail'},
                ]
            });
            """
        )
        by_id = {item["id"]: item for item in result["placements"]}
        parent_midpoint = (
            by_id["a"]["y"] + 20 + by_id["b"]["y"] + 20
        ) / 2
        self.assertAlmostEqual(by_id["merge"]["y"] + 40, parent_midpoint, delta=1)
        self.assertAlmostEqual(by_id["tail"]["y"] + 20, parent_midpoint, delta=1)


if __name__ == "__main__":
    unittest.main()
