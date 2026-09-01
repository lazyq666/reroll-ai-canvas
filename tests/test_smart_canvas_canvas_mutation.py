import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
MUTATION_MODULE = ROOT / "static/js/smart-canvas/canvas-mutation.js"
GEOMETRY_MODULE = ROOT / "static/js/smart-canvas/node-geometry.js"
PLACEMENT_MODULE = ROOT / "static/js/smart-canvas/node-placement.js"


class SmartCanvasMutationModuleTests(unittest.TestCase):
    def test_browser_undo_window_is_twenty_operations(self):
        source = MUTATION_MODULE.read_text(encoding="utf-8")
        self.assertIn("const CANVAS_MUTATION_UNDO_LIMIT = 20;", source)

    def test_prompt_creation_stabilizes_geometry_before_source_placement(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            const events = [];
            const source = {{id:'source',type:'smart-image',x:0,y:0,w:200,h:100,images:[]}};
            const sandbox = {{
                SmartCanvasModules:{{
                    canvasPersistence:{{schedule:() => events.push('save')}},
                    viewportSelection:{{viewport:{{
                        reveal:(bounds,options) => {{ events.push({{bounds,options}}); return true; }}
                    }}}}
                }},
                globalThis:null,
                nodes:[source],canvas:{{connections:[]}},
                selectedId:'source',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{x:node.x || 0,y:node.y || 0,width:node.w || 200,height:node.h || 100}}),
                render:() => events.push('render'),toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-id`,isSmartImageNode:() => true,
                isHistoryGroupNode:() => false,clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 323,
                selectedNodeIds:() => [],smartModelCatalog:() => [],
                resolveChatProviderId:() => 'provider-a',resolveChatModel:() => 'model-a',
                MEDIA_GROUP_DEFAULT_SCALE:0.8,mediaNodeDefaultScale:() => 2,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const created = sandbox.SmartCanvasModules.canvasMutation.create({{
                kind:'prompt',
                data:{{
                    title:'反推提示词',
                    llmEnabled:true,
                    llmInstruction:'describe image',
                    llmInputMedia:[{{url:'source.png',kind:'image'}}]
                }},
                options:{{
                    reveal:true,
                    placement:{{
                        anchor:{{kind:'source',sourceNodeId:'source'}},
                        relation:'downstream',
                        arrangement:'single'
                    }}
                }}
            }});
            process.stdout.write(JSON.stringify({{
                created,
                reveal:events.find(item => item?.bounds) || null
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        created = payload["created"]
        self.assertEqual(
            {key: created[key] for key in ("x", "y", "w", "h")},
            {"x": 400, "y": 0, "w": 316, "h": 323},
        )
        self.assertTrue(created["llmEnabled"])
        self.assertEqual(created["llmInputMedia"][0]["url"], "source.png")
        self.assertEqual(
            payload["reveal"]["bounds"],
            {"x": 400, "y": 0, "width": 316, "height": 323},
        )

    def test_auto_batch_plans_and_commits_nodes_and_connections_atomically(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            const events = [];
            const source = {{id:'source',type:'smart-image',x:0,y:0,w:200,h:100,images:[]}};
            const sandbox = {{
                SmartCanvasModules:{{canvasPersistence:{{schedule:() => events.push('save')}}}},
                globalThis:null,
                nodes:[source],canvas:{{connections:[]}},
                selectedId:'source',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{x:node.x || 0,y:node.y || 0,width:node.w || 200,height:node.h || 100}}),
                render:() => events.push('render'),toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-id`,isSmartImageNode:() => true,
                isHistoryGroupNode:() => false,clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
                selectedNodeIds:() => [],
                MEDIA_GROUP_DEFAULT_SCALE:0.8,mediaNodeDefaultScale:() => 2,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const mutation = sandbox.window.SmartCanvasModules.canvasMutation;
            const drafts = [
                {{id:'a',type:'smart-image',w:100,h:50,images:[]}},
                {{id:'b',type:'smart-image',w:100,h:50,images:[]}}
            ];
            const created = mutation.createBatch({{
                drafts,
                intent:{{anchor:{{kind:'source',sourceNodeId:'source'}},relation:'downstream',arrangement:'vertical-batch'}},
                connections:drafts.map(node => ({{fromId:'source',toId:node.id,input:true}}))
            }});
            const undone = mutation.history({{action:'undo'}});
            process.stdout.write(JSON.stringify({{
                created:created.map(node => ({{id:node.id,x:node.x,y:node.y}})),
                connectionCount:sandbox.canvas.connections.length,
                undone,
                remaining:sandbox.nodes.map(node => node.id),
                renders:events.filter(event => event === 'render').length,
                saves:events.filter(event => event === 'save').length
            }}));
            """
        )
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["created"], [
            {"id": "a", "x": 400, "y": 0},
            {"id": "b", "x": 400, "y": 98},
        ])
        self.assertEqual(payload["connectionCount"], 0)
        self.assertTrue(payload["undone"])
        self.assertEqual(payload["remaining"], ["source"])
        self.assertEqual(payload["renders"], 2)
        self.assertEqual(payload["saves"], 2)

    def test_batch_can_reposition_an_existing_first_slot_without_duplicating_it(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            const source = {{id:'source',type:'smart-image',x:0,y:0,w:200,h:100,images:[]}};
            const seed = {{id:'seed',type:'smart-image',x:400,y:20,w:100,h:50,images:[]}};
            const sibling = {{id:'sibling',type:'smart-image',x:0,y:0,w:100,h:50,images:[]}};
            const sandbox = {{
                SmartCanvasModules:{{canvasPersistence:{{schedule:() => {{}}}}}},
                globalThis:null,
                nodes:[source,seed],
                canvas:{{connections:[{{
                    from:'source',to:'seed',kind:'input',sourceOutputId:'output-1'
                }}]}},
                selectedId:'seed',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{
                    x:node.x || 0,y:node.y || 0,width:node.w || 200,height:node.h || 100
                }}),
                render:() => {{}},toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-id`,isSmartImageNode:() => true,
                isHistoryGroupNode:() => false,clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
                selectedNodeIds:() => [],
                MEDIA_GROUP_DEFAULT_SCALE:0.8,mediaNodeDefaultScale:() => 2,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const created = sandbox.SmartCanvasModules.canvasMutation.createBatch({{
                drafts:[seed,sibling],
                intent:{{
                    anchor:{{kind:'source',sourceNodeId:'source'}},
                    relation:'downstream',
                    arrangement:'vertical-batch'
                }},
                connections:[{{
                    fromId:'source',toId:'sibling',kind:'input',
                    sourceOutputId:'output-1',exact:true
                }}],
                options:{{
                    existingNodeIds:['seed'],skipUndo:true,
                    select:false,render:false,save:false
                }}
            }});
            process.stdout.write(JSON.stringify({{
                created:created.map(node => ({{id:node.id,x:node.x,y:node.y}})),
                nodeIds:sandbox.nodes.map(node => node.id),
                connections:sandbox.canvas.connections,
                siblingInputs:sibling.inputNodeIds || []
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["created"],
            [
                {"id": "seed", "x": 400, "y": 0},
                {"id": "sibling", "x": 400, "y": 98},
            ],
        )
        self.assertEqual(payload["nodeIds"], ["source", "seed", "sibling"])
        self.assertEqual(
            payload["connections"],
            [
                {
                    "from": "source",
                    "to": "seed",
                    "kind": "input",
                    "sourceOutputId": "output-1",
                },
                {
                    "from": "source",
                    "to": "sibling",
                    "kind": "input",
                    "sourceOutputId": "output-1",
                },
            ],
        )
        self.assertEqual(payload["siblingInputs"], ["source"])

    def test_canvas_mutation_implementation_is_owned_by_its_module(self):
        host = HOST.read_text(encoding="utf-8")
        source = MUTATION_MODULE.read_text(encoding="utf-8")

        for implementation in (
            "function canvasMutationHistory(",
            "function canvasMutationCreate(",
            "function canvasMutationDuplicate(",
            "function canvasMutationRemove(",
            "function canvasMutationConnect(",
            "function canvasMutationDisconnect(",
            "function canvasMutationArrange(",
        ):
            with self.subTest(implementation=implementation):
                self.assertIn(implementation, source)
                self.assertNotIn(implementation, host)

        for removed_host_implementation in (
            "function createNode(",
            "function createPromptNode(",
            "function createLoopNode(",
            "function createSmartGroupNode(",
            "function createSmartFrameNode(",
            "function duplicateSelectedNodes(",
            "function duplicateForAltDrag(",
            "function deleteSmartNodes(",
            "function addConnection(",
            "function connectInputNode(",
            "function disconnectConnections(",
        ):
            with self.subTest(implementation=removed_host_implementation):
                self.assertNotIn(removed_host_implementation, host)

        self.assertIn("window.SmartCanvasModules.canvasMutation", source)
        self.assertIn("canvasMutation.duplicate({", host)
        self.assertIn("canvasMutation.remove({", host)
        self.assertIn("canvasMutation.connect({", host)
        self.assertIn("canvasMutation.disconnect({", host)
        self.assertIn("canvasMutation.arrange({", host)
        self.assertIn("function smartPortDropTarget(", host)
        self.assertIn("smartContainer.isFrame(targetNode)", host)

    def test_selection_arrangement_commits_group_members_and_frame_once_and_undoes_once(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            const events = [];
            const sandbox = {{
                SmartCanvasModules:{{
                    canvasPersistence:{{schedule:() => events.push('save')}},
                    smartContainer:{{reconcileFrames:() => events.push('reconcile')}}
                }},
                nodes:[
                    {{id:'frame',type:'smart-frame',x:0,y:0,w:500,h:300,items:['group','plain']}},
                    {{id:'group',type:'smart-group',x:50,y:60,w:100,h:100,items:['member']}},
                    {{id:'member',type:'smart-image',x:60,y:70,w:20,h:20,images:[]}},
                    {{id:'plain',type:'smart-image',x:200,y:60,w:100,h:100,images:[]}}
                ],
                canvas:{{connections:[]}},
                selectedId:'',selectedIds:['group','plain'],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{x:node.x,y:node.y,width:node.w,height:node.h}}),
                render:() => events.push('render'),toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-id`,isSmartImageNode:() => true,
                isHistoryGroupNode:() => false,clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
                MEDIA_GROUP_DEFAULT_SCALE:0.8,mediaNodeDefaultScale:() => 1,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const mutation = sandbox.SmartCanvasModules.canvasMutation;
            const committed = mutation.arrange({{
                placements:[{{id:'group',x:100,y:120}},{{id:'plain',x:280,y:120}}],
                frameUpdates:[{{id:'frame',x:0,y:0,w:600,h:400}}]
            }});
            const arranged = sandbox.nodes.map(node => ({{
                id:node.id,x:node.x,y:node.y,w:node.w,h:node.h
            }}));
            const undone = mutation.history({{action:'undo'}});
            process.stdout.write(JSON.stringify({{
                committed,arranged,undone,
                restored:sandbox.nodes.map(node => ({{id:node.id,x:node.x,y:node.y,w:node.w,h:node.h}})),
                events
            }}));
            """
        )
        completed = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["committed"])
        arranged = {node["id"]: node for node in payload["arranged"]}
        self.assertEqual((arranged["group"]["x"], arranged["group"]["y"]), (100, 120))
        self.assertEqual((arranged["member"]["x"], arranged["member"]["y"]), (110, 130))
        self.assertEqual((arranged["frame"]["w"], arranged["frame"]["h"]), (600, 400))
        self.assertTrue(payload["undone"])
        restored = {node["id"]: node for node in payload["restored"]}
        self.assertEqual((restored["group"]["x"], restored["group"]["y"]), (50, 60))
        self.assertEqual((restored["member"]["x"], restored["member"]["y"]), (60, 70))
        self.assertEqual((restored["frame"]["w"], restored["frame"]["h"]), (500, 300))
        self.assertEqual(payload["events"].count("save"), 2)

    def test_duplicate_keeps_only_valid_external_inputs_without_external_output(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            let nextId = 0;
            const parent = {{id:'a',type:'smart-image',x:0,y:0,w:200,h:120,images:[]}};
            const selected = {{
                id:'b',type:'smart-image',x:320,y:0,w:200,h:120,images:[],
                inputNodeIds:['missing-parent','a']
            }};
            const child = {{
                id:'c',type:'smart-image',x:640,y:0,w:200,h:120,images:[],
                inputNodeIds:['b']
            }};
            const sandbox = {{
                SmartCanvasModules:{{canvasPersistence:{{schedule:() => {{}}}}}},
                globalThis:null,
                nodes:[parent,selected,child],
                canvas:{{connections:[
                    {{from:'a',to:'b',kind:'input',sourceOutputId:'a-output'}},
                    {{from:'missing-parent',to:'b',kind:'input'}},
                    {{from:'b',to:'c',kind:'input',sourceOutputId:'b-output'}},
                ]}},
                selectedId:'b',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{
                    x:node.x || 0,y:node.y || 0,
                    width:node.w || 200,height:node.h || 120
                }}),
                render:() => {{}},toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:() => false,
                clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},
                demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],
                promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const duplicate = sandbox.SmartCanvasModules.canvasMutation.duplicate({{
                nodeIds:['b'],mode:'offset',preserveConnections:true
            }}).nodes[0];
            process.stdout.write(JSON.stringify({{
                duplicateId:duplicate.id,
                duplicateInputs:duplicate.inputNodeIds || [],
                childInputs:child.inputNodeIds || [],
                hasParentInput:sandbox.canvas.connections.some(connection =>
                    connection.from === 'a'
                    && connection.to === duplicate.id
                    && connection.kind === 'input'
                ),
                hasCopiedOutput:sandbox.canvas.connections.some(connection =>
                    connection.from === duplicate.id
                    && connection.to === 'c'
                    && connection.kind === 'input'
                ),
                hasCopiedDanglingInput:sandbox.canvas.connections.some(connection =>
                    connection.from === 'missing-parent'
                    && connection.to === duplicate.id
                    && connection.kind === 'input'
                ),
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["hasParentInput"])
        self.assertFalse(payload["hasCopiedOutput"])
        self.assertFalse(payload["hasCopiedDanglingInput"])
        self.assertEqual(payload["duplicateInputs"], ["a"])
        self.assertEqual(payload["childInputs"], ["b"])

    def test_duplicate_selection_preserves_internal_matrix_and_direct_inputs(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION_MODULE))}, 'utf8');
            let nextId = 0;
            const nodes = [
                {{id:'a',type:'smart-image',x:0,y:0,w:160,h:100,images:[]}},
                {{id:'e',type:'smart-image',x:0,y:140,w:160,h:100,images:[]}},
                {{id:'x',type:'smart-image',x:0,y:280,w:160,h:100,images:[]}},
                {{
                    id:'b',type:'smart-image',x:320,y:0,w:160,h:100,images:[],
                    inputNodeIds:['e','a']
                }},
                {{
                    id:'c',type:'smart-image',x:560,y:0,w:160,h:100,images:[],
                    inputNodeIds:['b']
                }},
                {{
                    id:'d',type:'smart-image',x:800,y:0,w:160,h:100,images:[],
                    inputNodeIds:['c']
                }},
            ];
            const originalConnections = [
                {{from:'a',to:'b',kind:'input',sourceOutputId:'a-output',slot:'second'}},
                {{from:'e',to:'b',kind:'input',sourceOutputId:'e-output',slot:'first'}},
                {{from:'x',to:'b',kind:'flow'}},
                {{from:'x',to:'b',kind:'history'}},
                {{from:'b',to:'c',kind:'input',sourceOutputId:'b-output'}},
                {{from:'b',to:'c',kind:'flow',label:'internal-flow'}},
                {{from:'b',to:'c',kind:'history',label:'internal-history'}},
                {{from:'c',to:'d',kind:'input',sourceOutputId:'c-output'}},
                {{from:'c',to:'d',kind:'flow'}},
            ];
            const sandbox = {{
                SmartCanvasModules:{{canvasPersistence:{{schedule:() => {{}}}}}},
                globalThis:null,nodes,canvas:{{connections:originalConnections.slice()}},
                selectedId:'',selectedIds:['b','c'],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                document:{{activeElement:null}},isEditableTarget:() => false,
                nodeRect:node => ({{
                    x:node.x || 0,y:node.y || 0,
                    width:node.w || 160,height:node.h || 100
                }}),
                render:() => {{}},toast:() => {{}},tr:key => key,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:() => false,
                clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},
                demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],
                promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            const mutation = sandbox.SmartCanvasModules.canvasMutation;
            const duplicate = mutation.duplicate({{
                nodeIds:['b','c'],mode:'offset',preserveConnections:true
            }});
            const b1 = duplicate.nodes[0];
            const c1 = duplicate.nodes[1];
            const added = sandbox.canvas.connections.slice(originalConnections.length);
            const inputMeta = added
                .filter(connection => connection.to === b1.id && connection.kind === 'input')
                .map(connection => ({{
                    from:connection.from,
                    sourceOutputId:connection.sourceOutputId,
                    slot:connection.slot,
                }}));
            const internalKinds = added
                .filter(connection => connection.from === b1.id && connection.to === c1.id)
                .map(connection => connection.kind)
                .sort();
            const hasExternalNonInput = added.some(connection =>
                connection.from === 'x' && connection.to === b1.id
            );
            const hasExternalOutput = added.some(connection =>
                connection.from === c1.id && connection.to === 'd'
            );
            const undone = mutation.history({{action:'undo'}});
            process.stdout.write(JSON.stringify({{
                b1Inputs:b1.inputNodeIds || [],
                inputMeta,
                internalKinds,
                hasExternalNonInput,
                hasExternalOutput,
                undone,
                remainingNodeIds:sandbox.nodes.map(node => node.id),
                remainingConnections:sandbox.canvas.connections,
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["b1Inputs"], ["e", "a"])
        self.assertEqual(
            payload["inputMeta"],
            [
                {"from": "a", "sourceOutputId": "a-output", "slot": "second"},
                {"from": "e", "sourceOutputId": "e-output", "slot": "first"},
            ],
        )
        self.assertEqual(payload["internalKinds"], ["flow", "history", "input"])
        self.assertFalse(payload["hasExternalNonInput"])
        self.assertFalse(payload["hasExternalOutput"])
        self.assertTrue(payload["undone"])
        self.assertEqual(payload["remainingNodeIds"], ["a", "e", "x", "b", "c", "d"])
        self.assertEqual(payload["remainingConnections"], [
            {"from": "a", "to": "b", "kind": "input", "sourceOutputId": "a-output", "slot": "second"},
            {"from": "e", "to": "b", "kind": "input", "sourceOutputId": "e-output", "slot": "first"},
            {"from": "x", "to": "b", "kind": "flow"},
            {"from": "x", "to": "b", "kind": "history"},
            {"from": "b", "to": "c", "kind": "input", "sourceOutputId": "b-output"},
            {"from": "b", "to": "c", "kind": "flow", "label": "internal-flow"},
            {"from": "b", "to": "c", "kind": "history", "label": "internal-history"},
            {"from": "c", "to": "d", "kind": "input", "sourceOutputId": "c-output"},
            {"from": "c", "to": "d", "kind": "flow"},
        ])

    def test_interface_creates_duplicates_removes_connects_and_undoes(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(MUTATION_MODULE))},
                'utf8',
            );
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const events = [];
            let nextId = 0;
            const initial = {{
                id:'source',
                type:'smart-image',
                generationOutputNode:true,
                x:0,
                y:0,
                w:200,
                h:120,
                images:[
                    {{url:'source.png',outputId:'output-original'}},
                    {{url:'newer.png',outputId:'output-newer'}},
                ],
                activeOutputId:'output-original',
            }};
            const sandbox = {{
                window:{{
                    SmartCanvasModules:{{
                        canvasPersistence:{{
                            schedule:() => events.push('save'),
                        }},
                    }},
                }},
                nodes:[initial],
                canvas:{{connections:[]}},
                selectedId:'source',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,
                lastComposerNodeId:'',
                document:{{activeElement:null}},
                isEditableTarget:() => false,
                selectedNodeIds:() => sandbox.selectedIds.length
                    ? sandbox.selectedIds.slice()
                    : (sandbox.selectedId ? [sandbox.selectedId] : []),
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                nodeRect:node => ({{
                    x:Number(node?.x || 0),
                    y:Number(node?.y || 0),
                    width:Number(node?.w || 200),
                    height:Number(node?.h || 120),
                }}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:node => Boolean(node?.isHistoryGroup),
                clearSmartNodeTransientRunState:node => {{
                    delete node.running;
                    delete node.pending;
                }},
                clearDetachedRunInputRefs:() => {{}},
                demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node?.images || [],
                promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},
                promptNodeExpandedHeight:() => 260,
                render:() => events.push('render'),
                toast:message => events.push(`toast:${{message}}`),
                tr:key => key,
            }};
            sandbox.SmartCanvasModules = sandbox.window.SmartCanvasModules;
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource, sandbox);
            vm.runInContext(placementSource, sandbox);
            vm.runInContext(source, sandbox);
            const mutation = sandbox.window.SmartCanvasModules.canvasMutation;
            const target = {{
                id:'target',
                type:'smart-image',
                x:320,
                y:0,
                w:200,
                h:120,
                images:[],
            }};
            mutation.create({{
                kind:'prepared',
                data:{{node:target}},
                options:{{skipUndo:true,select:false,positionMode:'exact'}},
            }});
            const connected = mutation.connect({{
                fromId:'source',
                toId:'target',
                input:true,
            }});
            const textTarget = {{
                id:'text-target',
                type:'smart-prompt',
                x:640,
                y:0,
                w:316,
                h:180,
                text:'',
                llmEnabled:false,
            }};
            mutation.create({{
                kind:'prepared',
                data:{{node:textTarget}},
                options:{{skipUndo:true,select:false,positionMode:'exact'}},
            }});
            const textConnected = mutation.connect({{
                fromId:'source',
                toId:'text-target',
                input:true,
            }});
            const frame = {{
                id:'frame-target',
                type:'smart-frame',
                x:960,
                y:0,
                w:360,
                h:240,
                items:[],
            }};
            mutation.create({{
                kind:'prepared',
                data:{{node:frame}},
                options:{{skipUndo:true,select:false,positionMode:'exact'}},
            }});
            const inputToFrame = mutation.connect({{
                fromId:'source',
                toId:'frame-target',
                input:true,
            }});
            const inputFromFrame = mutation.connect({{
                fromId:'frame-target',
                toId:'target',
                input:true,
            }});
            const flowToFrame = mutation.connect({{
                fromId:'source',
                toId:'frame-target',
            }});
            sandbox.selectedId = '';
            sandbox.selectedIds = ['source', 'target'];
            const duplicated = mutation.duplicate({{
                nodeIds:['source', 'target'],
                mode:'offset',
                preserveConnections:true,
            }});
            const duplicateIds = duplicated.nodes.map(node => node.id);
            const duplicateExternalConnection = sandbox.canvas.connections.some(
                connection => duplicateIds.includes(connection.from)
                    && connection.to === 'text-target'
            );
            const duplicateExternalTargetInputs = textTarget.inputNodeIds.slice();
            const removed = mutation.remove({{
                nodeIds:duplicateIds,
            }});
            const undoRemove = mutation.history({{action:'undo'}});
            const disconnected = mutation.disconnect({{
                nodeIds:['target'],
                mode:'input',
            }});
            const connectedAfterDisconnect = sandbox.canvas.connections.some(
                connection => connection.from === 'source'
                    && connection.to === 'target'
            );
            const undoDisconnect = mutation.history({{action:'undo'}});
            const connectedAfterUndo = sandbox.canvas.connections.some(
                connection => connection.from === 'source'
                    && connection.to === 'target'
            );
            process.stdout.write(JSON.stringify({{
                methods:Object.keys(mutation).sort(),
                connected,
                targetInputs:target.inputNodeIds,
                pinnedOutputId:sandbox.canvas.connections.find(
                    connection => connection.from === 'source'
                        && connection.to === 'target'
                )?.sourceOutputId || '',
                textConnected,
                textTargetInputs:textTarget.inputNodeIds,
                textTargetLlmEnabled:textTarget.llmEnabled,
                textTargetTitle:textTarget.title,
                textTargetHeight:textTarget.h,
                inputToFrame,
                inputFromFrame,
                flowToFrame,
                frameInputs:frame.inputNodeIds || [],
                hasFrameConnection:sandbox.canvas.connections.some(
                    connection => connection.from === 'frame-target'
                        || connection.to === 'frame-target'
                ),
                duplicateCount:duplicateIds.length,
                duplicateConnection:sandbox.canvas.connections.some(
                    connection => duplicateIds.includes(connection.from)
                        && duplicateIds.includes(connection.to)
                ),
                duplicateExternalConnection,
                duplicateExternalTargetInputs,
                removed,
                undoRemove,
                restoredDuplicateCount:sandbox.nodes.filter(
                    node => duplicateIds.includes(node.id)
                ).length,
                disconnected,
                connectedAfterDisconnect,
                undoDisconnect,
                connectedAfterUndo,
                renders:events.filter(event => event === 'render').length,
                saves:events.filter(event => event === 'save').length,
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["methods"],
            ["arrange", "connect", "create", "createBatch", "disconnect", "duplicate", "history", "remove", "update"],
        )
        self.assertTrue(payload["connected"])
        self.assertEqual(payload["targetInputs"], ["source"])
        self.assertEqual(payload["pinnedOutputId"], "output-original")
        self.assertTrue(payload["textConnected"])
        self.assertEqual(payload["textTargetInputs"], ["source"])
        self.assertTrue(payload["textTargetLlmEnabled"])
        self.assertEqual(payload["textTargetTitle"], "提示词生成")
        self.assertEqual(payload["textTargetHeight"], 260)
        self.assertFalse(payload["inputToFrame"])
        self.assertFalse(payload["inputFromFrame"])
        self.assertFalse(payload["flowToFrame"])
        self.assertEqual(payload["frameInputs"], [])
        self.assertFalse(payload["hasFrameConnection"])
        self.assertEqual(payload["duplicateCount"], 2)
        self.assertTrue(payload["duplicateConnection"])
        self.assertFalse(payload["duplicateExternalConnection"])
        self.assertEqual(payload["duplicateExternalTargetInputs"], ["source"])
        self.assertTrue(payload["removed"])
        self.assertTrue(payload["undoRemove"])
        self.assertEqual(payload["restoredDuplicateCount"], 2)
        self.assertTrue(payload["disconnected"])
        self.assertFalse(payload["connectedAfterDisconnect"])
        self.assertTrue(payload["undoDisconnect"])
        self.assertTrue(payload["connectedAfterUndo"])
        self.assertGreaterEqual(payload["renders"], 5)
        self.assertGreaterEqual(payload["saves"], 5)


if __name__ == "__main__":
    unittest.main()
