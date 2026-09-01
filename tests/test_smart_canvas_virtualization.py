import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/canvas-virtualization.js"


def run_virtualization(script):
    program = (
        f"const virtualization = require({json.dumps(str(MODULE))});"
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


class SmartCanvasVirtualizationTests(unittest.TestCase):
    def test_browser_loads_virtualization_after_geometry_before_consumers(self):
        page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        geometry_index = page.index("/static/js/smart-canvas/node-geometry.js")
        virtualization_index = page.index(
            "/static/js/smart-canvas/canvas-virtualization.js"
        )
        persistence_index = page.index(
            "/static/js/smart-canvas/canvas-persistence.js"
        )

        self.assertLess(geometry_index, virtualization_index)
        self.assertLess(virtualization_index, persistence_index)

    def test_canvas_load_uses_narrow_pending_task_lookup(self):
        persistence = (
            ROOT / "static/js/smart-canvas/canvas-persistence.js"
        ).read_text(encoding="utf-8")
        generation_run = (
            ROOT / "static/js/smart-canvas/generation-run.js"
        ).read_text(encoding="utf-8")
        host = (
            ROOT / "static/js/smart-canvas.js"
        ).read_text(encoding="utf-8")

        self.assertIn("function generationRunPendingTasks(", generation_run)
        self.assertIn("pendingTasks(options={})", generation_run)
        self.assertIn("generationRunModule.pendingTasks({node})", persistence)
        self.assertIn("function smartNodePendingTasks(node)", host)
        self.assertIn("generationRun.pendingTasks({node})", host)

    def test_spatial_render_set_moves_incrementally_and_preserves_model(self):
        result = run_virtualization(
            """
            let nodes = Array.from({length:5000}, (_, index) => ({
                id:`node-${index}`,
                type:'smart-image',
                x:index * 5000,
                y:0,
                w:240,
                h:160,
                images:[]
            }));
            const before = JSON.stringify(nodes);
            const viewport = {x:0,y:0,scale:1};
            virtualization.reset();
            virtualization.configure({
                cellSize:512,
                overscanViewports:1,
                getNodes:() => nodes,
                measureNode:node => ({
                    x:node.x,
                    y:node.y,
                    width:node.w,
                    height:node.h
                }),
                getViewport:() => viewport,
                getShellSize:() => ({width:1000,height:800})
            });
            const initial = virtualization.reconcile({fullSync:true});
            viewport.x = -5000;
            const moved = virtualization.reconcile();
            nodes[2].x = 5100;
            const incrementallyMoved = virtualization.reconcile({
                nodeIds:['node-2']
            });
            const diagnostics = virtualization.diagnostics();
            process.stdout.write(JSON.stringify({
                initialIds:initial.ids,
                movedIds:moved.ids,
                incrementallyMovedIds:incrementallyMoved.ids,
                diagnostics,
                modelUnchangedExceptRequestedMove:
                    JSON.stringify(nodes.map((node,index) => (
                        index === 2 ? {...node,x:10000} : node
                    ))) === before
            }));
            """
        )

        self.assertEqual(result["initialIds"], ["node-0"])
        self.assertEqual(result["movedIds"], ["node-1"])
        self.assertEqual(
            set(result["incrementallyMovedIds"]),
            {"node-1", "node-2"},
        )
        self.assertEqual(result["diagnostics"]["totalNodeCount"], 5000)
        self.assertEqual(result["diagnostics"]["mountedNodeCount"], 2)
        self.assertLess(result["diagnostics"]["visibleCandidateCount"], 10)
        self.assertTrue(result["modelUnchangedExceptRequestedMove"])

    def test_pins_and_connection_visibility_use_world_geometry(self):
        result = run_virtualization(
            """
            const nodes = [
                {id:'near',x:100,y:100,w:200,h:100},
                {id:'far',x:20000,y:20000,w:200,h:100}
            ];
            virtualization.reset();
            virtualization.configure({
                getNodes:() => nodes,
                measureNode:node => ({
                    x:node.x,y:node.y,width:node.w,height:node.h
                }),
                getViewport:() => ({x:0,y:0,scale:1}),
                getShellSize:() => ({width:1000,height:800})
            });
            virtualization.reconcile({fullSync:true});
            const nearConnection = virtualization.connectionVisible({
                fromRect:{x:100,y:100,width:200,height:100},
                toRect:{x:700,y:300,width:200,height:100}
            });
            const farConnection = virtualization.connectionVisible({
                fromRect:{x:20000,y:20000,width:200,height:100},
                toRect:{x:21000,y:20500,width:200,height:100}
            });
            virtualization.pin('far','canvas-interaction');
            const pinned = virtualization.reconcile();
            virtualization.unpin('far','canvas-interaction');
            const unpinned = virtualization.reconcile();
            process.stdout.write(JSON.stringify({
                nearConnection,
                farConnection,
                pinnedIds:pinned.ids,
                unpinnedIds:unpinned.ids,
                forcedConnection:virtualization.connectionVisible({
                    fromRect:{x:20000,y:20000,width:200,height:100},
                    toRect:{x:21000,y:20500,width:200,height:100},
                    pinned:true
                })
            }));
            """
        )

        self.assertTrue(result["nearConnection"])
        self.assertFalse(result["farConnection"])
        self.assertEqual(set(result["pinnedIds"]), {"near", "far"})
        self.assertEqual(result["unpinnedIds"], ["near"])
        self.assertTrue(result["forcedConnection"])


if __name__ == "__main__":
    unittest.main()
