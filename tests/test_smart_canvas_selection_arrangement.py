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
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree',
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
                nodes,selectedIds:['group','target'],mode:'tree',
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
                merge:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'tree',connections:[
                    {from:'a',to:'c'},{from:'b',to:'c'}
                ]}),
                cycle:arrangement.plan({nodes,selectedIds:['a','b','c'],mode:'tree',connections:[
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
                nodes,selectedIds:nodes.map(node=>node.id),mode:'tree',
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
