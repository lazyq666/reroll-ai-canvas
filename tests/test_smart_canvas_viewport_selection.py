import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
MODULE = ROOT / "static/js/smart-canvas/viewport-selection.js"


class SmartCanvasViewportSelectionModuleTests(unittest.TestCase):
    def test_reveal_uses_the_minimum_world_pan_and_is_zoom_invariant(self):
        script = f"""
            const vm = require('vm');
            const fs = require('fs');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const world = {{style:{{setProperty(){{}}}},classList:{{toggle(){{}}}}}};
            const shell = {{clientWidth:800,clientHeight:600,style:{{}},getBoundingClientRect(){{return {{left:0,top:0}};}}}};
            const sandbox = {{window:{{SmartCanvasModules:{{}},addEventListener(){{}}}},nodes:[],selectedId:'',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},viewport:{{x:0,y:0,scale:2}},world,shell,smartAnnotationStroke:null,minimap:null,positionCanvasFloatingOverlays(){{}},scheduleSmartAdaptiveImageResolution(){{}},savePromptDraftForCurrent(){{}},Set,console}};
            vm.createContext(sandbox);vm.runInContext(source,sandbox);
            const camera=sandbox.window.SmartCanvasModules.viewportSelection.viewport;
            const moved=camera.reveal({{x:390,y:100,width:100,height:100}},{{padding:10,smooth:false}});
            process.stdout.write(JSON.stringify({{moved,viewport:sandbox.viewport}}));
        """
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "moved": True,
            "viewport": {"x": -200, "y": 0, "scale": 2},
        })

    def test_module_owns_viewport_and_selection_implementation(self):
        host = HOST.read_text(encoding="utf-8")
        source = MODULE.read_text(encoding="utf-8")
        persistence = (
            ROOT / "static/js/smart-canvas/canvas-persistence.js"
        ).read_text(encoding="utf-8")

        for legacy_definition in (
            "function selectedNode(",
            "function clearSelection(",
            "function syncSelectionUi(",
            "function isNodeSelected(",
            "function selectedNodeIds(",
            "function applyViewport(",
            "function screenToWorld(",
            "function viewportCenter(",
            "function renderMinimap(",
            "function minimapEventToWorld(",
            "function centerViewportOnWorldPoint(",
            "function fitAllNodesViewport(",
            "function enterZoomPreview(",
            "function exitZoomPreview(",
            "function exitZoomPreviewToNode(",
            "function toggleZoomPreview(",
            "function updateSelectionBox(",
            "function finishSelection(",
        ):
            self.assertNotIn(legacy_definition, host)

        for owned_implementation in (
            "function smartViewportSelectionNode(",
            "function smartViewportSelectionSync(",
            "function smartViewportSelectionApply(",
            "function smartViewportSelectionScreenToWorld(",
            "function smartViewportSelectionSyncMinimapScene(",
            "function smartViewportSelectionZoomPreview(",
            "function smartViewportSelectionFinishBox(",
        ):
            self.assertIn(owned_implementation, source)

        self.assertIn("window.SmartCanvasModules.viewportSelection", source)
        self.assertIn("selection:Object.freeze({", source)
        self.assertIn("viewport:Object.freeze({", source)
        self.assertIn("minimap.scene = {", source)
        self.assertNotIn("minimapContent.innerHTML", source)
        self.assertNotIn("minimapPoint:", source)
        self.assertIn("ic-minimap-navigate", host)
        self.assertNotIn("canvasPersistence.schedule()", source)
        self.assertNotIn("canvas.viewport = {...viewport}", persistence)
        self.assertNotIn("...(canvas.viewport || {})", persistence)
        self.assertIn("function canvasPersistenceCompactDocument(", persistence)
        self.assertNotIn("viewport:{}", persistence)

    def test_selection_queries_return_copies_and_clear_local_state(self):
        script = f"""
            const vm = require('vm');
            const fs = require('fs');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[{{id:'a'}},{{id:'b'}}],
                selectedId:'',
                selectedIds:['a','b'],
                selectedImage:{{nodeId:'a',index:0}},
                saveCount:0,
                Set,
                console
            }};
            sandbox.savePromptDraftForCurrent = () => {{ sandbox.saveCount += 1; }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const selection = sandbox.window.SmartCanvasModules.viewportSelection.selection;
            const ids = selection.ids();
            ids.pop();
            const before = {{
                ids:selection.ids(),
                hasA:selection.has('a'),
                node:selection.node()
            }};
            selection.clear();
            process.stdout.write(JSON.stringify({{
                before,
                afterIds:selection.ids(),
                selectedImage:sandbox.selectedImage,
                saveCount:sandbox.saveCount
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["before"]["ids"], ["a", "b"])
        self.assertTrue(data["before"]["hasA"])
        self.assertIsNone(data["before"]["node"])
        self.assertEqual(data["afterIds"], [])
        self.assertEqual(data["selectedImage"], {"nodeId": "", "index": -1})
        self.assertEqual(data["saveCount"], 1)

    def test_viewport_projection_and_apply_are_client_local(self):
        script = f"""
            const vm = require('vm');
            const fs = require('fs');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const world = {{
                style:{{
                    properties:{{}},
                    setProperty(name,value){{ this.properties[name] = value; }}
                }},
                classList:{{toggle(name, value){{ this.last = [name, value]; }}}}
            }};
            const shell = {{
                clientWidth:800,
                clientHeight:600,
                style:{{setProperty(){{}}}},
                getBoundingClientRect(){{ return {{left:20,top:30}}; }}
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[],
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                viewport:{{x:100,y:50,scale:2}},
                world,
                shell,
                smartAnnotationStroke:null,
                minimap:null,
                positionCanvasFloatingOverlays(){{}},
                scheduleSmartAdaptiveImageResolution(){{}},
                savePromptDraftForCurrent(){{}},
                Set,
                console
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const viewport = sandbox.window.SmartCanvasModules.viewportSelection.viewport;
            const point = viewport.screenToWorld({{clientX:220,clientY:180}});
            viewport.apply();
            process.stdout.write(JSON.stringify({{
                point,
                center:viewport.center(),
                transform:world.style.transform,
                styleProperties:world.style.properties,
                scaled:world.classList.last
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["point"], {"x": 50, "y": 50})
        self.assertEqual(data["center"], {"x": 150, "y": 125})
        self.assertEqual(data["transform"], "translate(100px, 50px) scale(2)")
        self.assertEqual(
            data["styleProperties"]["--smart-selection-handle-inverse-scale"],
            "0.5",
        )
        self.assertEqual(data["scaled"], ["canvas-scaled", True])

    def test_viewport_restores_world_center_and_saves_minimap_state(self):
        script = f"""
            const vm = require('vm');
            const fs = require('fs');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const requests = [];
            const world = {{
                style:{{setProperty(){{}}}},
                classList:{{toggle(){{}}}}
            }};
            const shell = {{
                clientWidth:1000,
                clientHeight:600,
                style:{{}},
                getBoundingClientRect(){{ return {{left:0,top:0}}; }}
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{}},addEventListener(){{}}}},
                canvasId:'canvas-7',
                nodes:[],
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                viewport:{{x:0,y:0,scale:1}},
                world,
                shell,
                smartAnnotationStroke:null,
                minimap:null,
                positionCanvasFloatingOverlays(){{}},
                scheduleSmartAdaptiveImageResolution(){{}},
                savePromptDraftForCurrent(){{}},
                setTimeout,
                clearTimeout,
                Set,
                console,
                fetch:async (url, options={{}}) => {{
                    requests.push({{url,options}});
                    if(!options.method){{
                        return {{
                            ok:true,
                            json:async () => ({{
                                view_state:{{center_x:400,center_y:200,scale:2}}
                            }})
                        }};
                    }}
                    return {{ok:true,json:async () => ({{}})}};
                }}
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            (async () => {{
                const camera = sandbox.window.SmartCanvasModules
                    .viewportSelection.viewport;
                const restored = await camera.restore();
                const restoredViewport = {{...sandbox.viewport}};
                const restoredCenter = camera.center();
                sandbox.viewport.x = -100;
                sandbox.viewport.y = 50;
                sandbox.viewport.scale = 2;
                camera.apply();
                await camera.save();
                const put = requests.find(request => request.options.method === 'PUT');
                process.stdout.write(JSON.stringify({{
                    restored,
                    restoredViewport,
                    restoredCenter,
                    getUrl:requests[0].url,
                    putUrl:put.url,
                    saved:JSON.parse(put.options.body)
                }}));
            }})().catch(error => {{
                console.error(error);
                process.exitCode = 1;
            }});
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data["restored"])
        self.assertEqual(
            data["restoredViewport"],
            {"x": -300, "y": -100, "scale": 2},
        )
        self.assertEqual(data["restoredCenter"], {"x": 400, "y": 200})
        self.assertEqual(
            data["getUrl"],
            "/api/smart-canvas/canvas-7/view-state",
        )
        self.assertEqual(data["putUrl"], data["getUrl"])
        self.assertEqual(
            data["saved"],
            {"center_x": 300, "center_y": 125, "scale": 2},
        )

    def test_marquee_intersects_nodes_but_fully_contains_frames(self):
        script = f"""
            const vm = require('vm');
            const fs = require('fs');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    smartContainer:{{isFrame:node => node.type === 'smart-frame'}}
                }}}},
                nodes:[
                    {{id:'node-hit',x:90,y:90,width:30,height:30}},
                    {{id:'frame-cut',type:'smart-frame',x:90,y:90,width:30,height:30}},
                    {{id:'frame-inside',type:'smart-frame',x:10,y:10,width:30,height:30}}
                ],
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                selectionState:{{
                    startScreen:{{x:0,y:0}},
                    startWorld:{{x:0,y:0}}
                }},
                selectionJustFinished:false,
                selectionBox:{{style:{{display:'block'}}}},
                viewport:{{x:0,y:0,scale:1}},
                shell:{{getBoundingClientRect(){{return {{left:0,top:0}};}}}},
                nodeRect:node => node,
                renderCount:0,
                savePromptDraftForCurrent(){{}},
                setTimeout(fn){{ fn(); }},
                Set,
                console
            }};
            sandbox.render = () => {{ sandbox.renderCount += 1; }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.window.SmartCanvasModules.viewportSelection.selection.box.finish({{
                clientX:100,
                clientY:100
            }});
            process.stdout.write(JSON.stringify({{
                ids:sandbox.selectedIds,
                selectedId:sandbox.selectedId,
                display:sandbox.selectionBox.style.display,
                renderCount:sandbox.renderCount
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["ids"], ["node-hit", "frame-inside"])
        self.assertEqual(data["selectedId"], "")
        self.assertEqual(data["display"], "none")
        self.assertEqual(data["renderCount"], 1)


if __name__ == "__main__":
    unittest.main()
