import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
PERSISTENCE_MODULE = ROOT / "static/js/smart-canvas/canvas-persistence.js"
GEOMETRY_MODULE = ROOT / "static/js/smart-canvas/node-geometry.js"
PLACEMENT_MODULE = ROOT / "static/js/smart-canvas/node-placement.js"


class SmartCanvasPersistenceModuleTests(unittest.TestCase):
    def test_external_prompt_commit_deduplicates_http_and_websocket_in_either_order(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8'
            );
            const sent = [];
            let socketCloses = 0;
            const socket = {{
                readyState:1,
                send:value => sent.push(JSON.parse(value)),
                close:() => {{ socketCloses += 1; }},
            }};
            const localStorage = {{
                getItem:() => null,
                setItem:() => {{}},
                removeItem:() => {{}},
            }};
            const confirmed = {{
                title:'Canvas', icon:'sparkles', revision:4,
                nodes:[{{id:'node-a',type:'smart-image',x:10,y:20,images:[]}}],
                connections:[], settings:{{}}, logs:[],
            }};
            const sandbox = {{
                window:{{
                    WebSocket:{{OPEN:1}}, localStorage,
                    addEventListener:() => {{}},
                    SmartCanvasModules:{{
                        canvasMutation:{{history:() => {{}}}},
                    }},
                }},
                canvasId:'canvas-1', smartClientId:'client-1',
                socket,
                canvas:JSON.parse(JSON.stringify(confirmed)),
                nodes:[], settings:{{}}, canvasDefaultSmartSettings:{{}},
                initialSmartSettings:{{}}, selectionState:null,
                lastComposerNodeId:'',
                document:{{
                    title:'', activeElement:{{matches:() => false}},
                    addEventListener:() => {{}}, getElementById:() => null,
                }},
                normalizeLegacySmartNode:node => ({{...node}}),
                cloneSmartSettings:value => JSON.parse(JSON.stringify(value)),
                savePromptDraftForCurrent:() => {{}},
                stripImageGenerationMeta:item => ({{...item}}),
                mediaItemForStorage:item => ({{...item}}),
                settingsForStorage:value => ({{...(value || {{}})}}),
                render:() => {{}}, scheduleConnectionLayerRefresh:() => {{}},
                tr:key => key, toast:() => {{}},
                setTimeout:() => 1, clearTimeout:() => {{}},
                setInterval:() => 1, clearInterval:() => {{}},
                fetch:async () => ({{ok:true,json:async () => ({{canvas:confirmed}})}}),
                Date, JSON, Promise,
            }};
            sandbox.nodes = sandbox.canvas.nodes;
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            vm.runInContext(`
                canvasPersistenceConfirmedDocument =
                    canvasPersistenceCompactDocument(canvas);
                canvasPersistenceRevision = 4;
                canvasPersistenceStatusValue = 'ready';
                canvasPersistenceSocket = socket;
            `, sandbox);
            const persistence = sandbox.window.SmartCanvasModules.canvasPersistence;
            const applier = sandbox.window.SmartCanvasModules.canvasRealtimeApplier;
            const emptyChanges = {{
                node_creates:[],node_updates:[],node_unsets:[],node_deletes:[],
                connection_adds:[],connection_removes:[],
                canvas_updates:[],canvas_unsets:[],
            }};
            const httpFirst = persistence.observeExternalCommit({{
                operationId:'prompt:http-first', revision:5,
            }});
            const wsAfterHttp = applier.apply({{
                type:'canvas_mutation', canvas_id:'canvas-1',
                operation_id:'prompt:http-first', revision:5,
                changes:emptyChanges,
            }});
            const wsFirst = applier.apply({{
                type:'canvas_mutation', canvas_id:'canvas-1',
                operation_id:'prompt:ws-first', revision:6,
                changes:emptyChanges,
            }});
            const httpAfterWs = persistence.observeExternalCommit({{
                operationId:'prompt:ws-first', revision:6,
            }});
            persistence.hold({{scope:'active-edit'}});
            const interactionHttpFirst = persistence.observeExternalCommit({{
                operationId:'prompt:during-interaction', revision:7,
            }});
            const interactionWsAfterHttp = applier.apply({{
                type:'canvas_mutation', canvas_id:'canvas-1',
                operation_id:'prompt:during-interaction', revision:7,
                changes:emptyChanges,
            }});
            const interactionRevisionBeforeRelease = persistence.status().revision;
            persistence.release({{scope:'active-edit'}});
            sandbox.nodes[0].x = 30;
            persistence.schedule({{delay:450}});
            const pendingHttpFirst = persistence.observeExternalCommit({{
                operationId:'prompt:while-local-pending', revision:8,
            }});
            const pendingWsAfterHttp = applier.apply({{
                type:'canvas_mutation', canvas_id:'canvas-1',
                operation_id:'prompt:while-local-pending', revision:8,
                changes:emptyChanges,
            }});
            const mutation = sent.find(item => item.type === 'canvas_mutation');
            process.stdout.write(JSON.stringify({{
                httpFirst, wsAfterHttp, wsFirst, httpAfterWs,
                interactionHttpFirst, interactionWsAfterHttp,
                interactionRevisionBeforeRelease,
                pendingHttpFirst, pendingWsAfterHttp,
                revision:persistence.status().revision,
                socketCloses,
                nextBaseRevision:mutation?.operation?.base_revision,
                localX:sandbox.nodes[0].x,
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
        self.assertTrue(payload["httpFirst"])
        self.assertTrue(payload["wsAfterHttp"])
        self.assertTrue(payload["wsFirst"])
        self.assertTrue(payload["httpAfterWs"])
        self.assertTrue(payload["interactionHttpFirst"])
        self.assertTrue(payload["interactionWsAfterHttp"])
        self.assertEqual(payload["interactionRevisionBeforeRelease"], 6)
        self.assertTrue(payload["pendingHttpFirst"])
        self.assertTrue(payload["pendingWsAfterHttp"])
        self.assertEqual(payload["revision"], 8)
        self.assertEqual(payload["socketCloses"], 0)
        self.assertEqual(payload["nextBaseRevision"], 8)
        self.assertEqual(payload["localX"], 30)

    def test_position_only_mutation_render_hint_is_strictly_whitelisted(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8'
            );
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{}}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.cases = {{
                xy:{{node_updates:[
                    {{id:'node-a',path:['x'],value:120}},
                    {{id:'node-a',path:['y'],value:240}},
                ]}},
                xOnly:{{node_updates:[
                    {{id:'node-a',path:['x'],value:120}},
                ]}},
                title:{{node_updates:[
                    {{id:'node-a',path:['title'],value:'Remote'}},
                ]}},
                create:{{
                    node_updates:[{{id:'node-a',path:['x'],value:120}}],
                    node_creates:[{{id:'node-b',x:0,y:0}}],
                }},
                unset:{{node_unsets:[
                    {{id:'node-a',path:['x']}},
                ]}},
                canvas:{{canvas_updates:[
                    {{path:['title'],value:'Remote'}},
                ]}},
                empty:{{}},
                nested:{{node_updates:[
                    {{id:'node-a',path:['position','x'],value:120}},
                ]}},
                multiNode:{{node_updates:[
                    {{id:'node-a',path:['x'],value:120}},
                    {{id:'node-b',path:['y'],value:240}},
                ]}},
                duplicateField:{{node_updates:[
                    {{id:'node-a',path:['x'],value:120}},
                    {{id:'node-a',path:['x'],value:240}},
                ]}},
                nonFinite:{{node_updates:[
                    {{id:'node-a',path:['x'],value:NaN}},
                ]}},
                malformedOtherAction:{{
                    node_updates:[{{id:'node-a',path:['x'],value:120}}],
                    node_creates:{{id:'node-b',x:0,y:0}},
                }},
            }};
            vm.runInContext(`
                results = Object.fromEntries(
                    Object.entries(cases).map(([key, value]) => [
                        key,
                        canvasPersistenceChangesOnlyNodePositions(value)
                    ])
                );
            `, sandbox);
            process.stdout.write(JSON.stringify(sandbox.results));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "xy": True,
                "xOnly": True,
                "title": False,
                "create": False,
                "unset": False,
                "canvas": False,
                "empty": False,
                "nested": False,
                "multiNode": False,
                "duplicateField": False,
                "nonFinite": False,
                "malformedOtherAction": False,
            },
        )

    def test_generation_history_never_enters_canvas_mutations(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8'
            );
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{}}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.before = {{
                title:'Canvas',icon:'sparkles',nodes:[],connections:[],
                settings:{{}},logs:[]
            }};
            sandbox.after = {{
                ...sandbox.before,
                logs:[{{id:'final-log',status:'success'}}]
            }};
            vm.runInContext(`
                changes = canvasPersistenceDiff(before, after);
                compact = canvasPersistenceCompactDocument(after);
            `, sandbox);
            process.stdout.write(JSON.stringify({{
                updates:sandbox.changes.canvas_updates,
                compact:sandbox.compact,
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
        self.assertEqual(payload["updates"], [])
        self.assertNotIn("logs", payload["compact"])

    def test_log_ack_preserves_origin_state_without_entering_undo(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8'
            );
            const history = [];
            const sandbox = {{
                window:{{
                    addEventListener:() => {{}},
                    SmartCanvasModules:{{
                        canvasMutation:{{history:event => history.push(event)}}
                    }}
                }},
                document:{{addEventListener:() => {{}}}},
                history,
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            vm.runInContext(`
                canvasPersistenceInFlight = {{
                    changes:canvasPersistenceEmptyChanges()
                }};
                canvasPersistenceInFlight.changes.canvas_updates.push({{
                    path:['logs'],
                    value:[{{id:'final-log'}}]
                }});
                confirmed = canvasPersistenceConfirmedAckChanges(
                    {{non_undoable_canvas_roots:['logs']}},
                    canvasPersistenceEmptyChanges(),
                    true
                );
                recorded = canvasPersistenceRecordAccepted({{
                    operation_id:'client-a:log-only',
                    reverts_operation_id:'',
                    undoable:false
                }});
            `, sandbox);
            process.stdout.write(JSON.stringify({{
                confirmed:sandbox.confirmed,
                recorded:sandbox.recorded,
                history
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
            payload["confirmed"]["canvas_updates"],
            [{"path": ["logs"], "value": [{"id": "final-log"}]}],
        )
        self.assertFalse(payload["recorded"])
        self.assertEqual(payload["history"], [])

    def test_rejected_exact_created_node_keeps_the_user_drop_position(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const persistenceSource = fs.readFileSync({json.dumps(str(PERSISTENCE_MODULE))}, 'utf8');
            const sandbox = {{
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            sandbox.SmartCanvasModules = {{
                canvasMutation:{{
                    placementMode:({{nodeId}}) => nodeId === 'manual' ? 'exact' : 'auto'
                }}
            }};
            vm.createContext(sandbox);
            vm.runInContext(geometrySource, sandbox);
            vm.runInContext(placementSource, sandbox);
            vm.runInContext(persistenceSource, sandbox);
            sandbox.confirmed = {{
                nodes:[{{id:'occupant',type:'smart-prompt',x:400,y:0,w:316,h:180}}],
                connections:[]
            }};
            sandbox.pending = {{
                node_creates:[{{id:'manual',type:'smart-prompt',x:400,y:0,w:316,h:180}}],
                connection_adds:[]
            }};
            vm.runInContext('canvasPersistenceReplanCreatedNodes(pending, confirmed)', sandbox);
            process.stdout.write(JSON.stringify(sandbox.pending));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["node_creates"][0],
            {"id": "manual", "type": "smart-prompt", "x": 400, "y": 0, "w": 316, "h": 180},
        )

    def test_rejected_undo_restore_builds_placement_overrides_for_same_revert(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const persistenceSource = fs.readFileSync({json.dumps(str(PERSISTENCE_MODULE))}, 'utf8');
            const sent = [];
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{}}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                canvasId:'canvas-1',
                smartClientId:'client-a',
                sent,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource, sandbox);
            vm.runInContext(placementSource, sandbox);
            vm.runInContext(persistenceSource, sandbox);
            sandbox.confirmed = {{
                nodes:[{{id:'occupant',type:'smart-prompt',x:400,y:0,w:316,h:180}}],
                connections:[]
            }};
            sandbox.retryChanges = {{
                node_creates:[{{id:'restored',type:'smart-prompt',x:400,y:0,w:316,h:180}}],
                connection_adds:[]
            }};
            vm.runInContext(`
                replanned = canvasPersistenceClone(retryChanges);
                overrides = canvasPersistencePlacementOverridesForRetry(
                    replanned,
                    confirmed
                );
                canvasPersistenceRevision = 7;
                canvasPersistenceStatusValue = 'ready';
                canvasPersistenceSocket = {{readyState:1,send:value => sent.push(JSON.parse(value))}};
                canvasPersistenceSendOperation(canvasPersistenceEmptyChanges(), {{
                    operationId:'client-a:undo-retry',
                    revertsOperationId:'client-a:delete-source',
                    placementOverrides:overrides,
                    optimistic:false
                }});
            `, sandbox);
            process.stdout.write(JSON.stringify({{overrides:sandbox.overrides,sent}}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["overrides"], {"restored": {"x": 400, "y": 276}})
        operation_value = payload["sent"][0]["operation"]
        self.assertEqual(operation_value["reverts_operation_id"], "client-a:delete-source")
        self.assertEqual(operation_value["placement_overrides"], payload["overrides"])
        self.assertNotIn("changes", operation_value)

    def test_rejected_created_node_is_replanned_against_confirmed_snapshot(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const persistenceSource = fs.readFileSync({json.dumps(str(PERSISTENCE_MODULE))}, 'utf8');
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{}}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource, sandbox);
            vm.runInContext(placementSource, sandbox);
            vm.runInContext(persistenceSource, sandbox);
            sandbox.confirmed = {{
                nodes:[
                    {{id:'source',type:'smart-image',x:0,y:0,w:200,h:100,images:[]}},
                    {{id:'winner',type:'smart-prompt',x:400,y:0,w:316,h:180}}
                ],
                connections:[]
            }};
            sandbox.pending = {{
                node_creates:[{{id:'retry',type:'smart-prompt',x:400,y:0,w:316,h:180}}],
                connection_adds:[{{from:'source',to:'retry',kind:'input'}}]
            }};
            vm.runInContext('canvasPersistenceReplanCreatedNodes(pending, confirmed)', sandbox);
            process.stdout.write(JSON.stringify(sandbox.pending));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["node_creates"][0],
            {"id": "retry", "type": "smart-prompt", "x": 400, "y": 276, "w": 316, "h": 180},
        )

    def test_stale_revision_replan_uses_persisted_generation_batch_layout(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            const persistenceSource = fs.readFileSync({json.dumps(str(PERSISTENCE_MODULE))}, 'utf8');
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{
                    canvasMutation:{{placementMode:()=> 'auto'}}
                }}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource, sandbox);
            vm.runInContext(placementSource, sandbox);
            vm.runInContext(persistenceSource, sandbox);
            sandbox.confirmed = {{nodes:[{{
                id:'source',type:'smart-image',x:0,y:0,w:100,h:100,images:[]
            }}],connections:[]}};
            sandbox.horizontal = {{
                node_creates:[0,1].map(index => ({{
                    id:`horizontal-${{index}}`,type:'smart-image',x:400,y:0,w:100,h:50,images:[],
                    generationBatchId:'horizontal-batch',generationBatchLayout:'horizontal',
                    generationBatchSourceNodeId:'source',created_at:index
                }})),
                connection_adds:[{{from:'source',to:'horizontal-0',kind:'input'}}]
            }};
            sandbox.vertical = {{
                node_creates:[0,1].map(index => ({{
                    id:`vertical-${{index}}`,type:'smart-image',x:400,y:0,w:100,h:50,images:[],
                    generationBatchId:'vertical-batch',generationBatchLayout:'vertical',
                    generationBatchSourceNodeId:'source',created_at:index
                }})),
                connection_adds:[{{from:'source',to:'vertical-0',kind:'input'}}]
            }};
            vm.runInContext('canvasPersistenceReplanCreatedNodes(horizontal, confirmed)', sandbox);
            vm.runInContext('canvasPersistenceReplanCreatedNodes(vertical, confirmed)', sandbox);
            process.stdout.write(JSON.stringify({{
                horizontal:sandbox.horizontal.node_creates.map(node => ({{x:node.x,y:node.y}})),
                vertical:sandbox.vertical.node_creates.map(node => ({{x:node.x,y:node.y}}))
            }}));
            """
        )
        completed = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["horizontal"][0]["y"], payload["horizontal"][1]["y"])
        self.assertNotEqual(payload["horizontal"][0]["x"], payload["horizontal"][1]["x"])
        self.assertEqual(payload["vertical"][0]["x"], payload["vertical"][1]["x"])
        self.assertNotEqual(payload["vertical"][0]["y"], payload["vertical"][1]["y"])

    def test_realtime_sync_lifecycle_is_owned_by_its_module(self):
        host = HOST.read_text(encoding="utf-8")
        source = PERSISTENCE_MODULE.read_text(encoding="utf-8")

        for implementation in (
            "function canvasPersistenceDiff(",
            "function canvasPersistenceApplyChanges(",
            "function canvasPersistenceAssignDocument(",
            "function canvasPersistenceApplyMutationMessage(",
            "function canvasPersistenceApplySnapshot(",
            "function canvasPersistenceReconcileTerminalGenerationState(",
            "function canvasPersistenceConnect(",
            "function canvasPersistenceRequestResync(",
            "async function canvasPersistenceLoad(",
            "function canvasPersistenceSchedule(",
            "async function canvasPersistenceSave(",
            "function canvasPersistenceRevert(",
        ):
            with self.subTest(implementation=implementation):
                self.assertIn(implementation, source)
                self.assertNotIn(implementation, host)

        self.assertNotIn("base_updated_at", source)
        self.assertNotIn("method:'PUT'", source)
        self.assertIn("/ws/canvases/", source)
        self.assertIn("base_revision:canvasPersistenceRevision", source)
        self.assertIn("reverts_operation_id", source)
        self.assertIn("delete shared.queuedGenerationRun", source)
        self.assertIn("?.migrateLegacyGalleries?.()", source)
        self.assertIn("|| migratedGenerationOutputGalleries", source)
        self.assertIn("const canvasPersistence =", host)
        self.assertIn("await canvasPersistence.load()", host)
        self.assertIn("canvasPersistence.schedule()", host)

    def test_remote_delete_cascades_input_node_references(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8',
            );
            const sandbox = {{
                window:{{addEventListener:() => {{}},SmartCanvasModules:{{}}}},
                document:{{addEventListener:() => {{}}}},
                tr:key => key,
                JSON,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.documentValue = {{
                title:'Canvas',
                nodes:[
                    {{id:'source',type:'smart-image'}},
                    {{
                        id:'target',
                        type:'smart-prompt',
                        inputNodeIds:['source'],
                        items:['source'],
                        frameId:'source',
                    }},
                ],
                connections:[],
                settings:{{}},
                logs:[],
            }};
            vm.runInContext(`
                projected = canvasPersistenceApplyChanges(documentValue, {{
                    node_deletes:['source']
                }});
            `, sandbox);
            process.stdout.write(JSON.stringify(sandbox.projected));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual([node["id"] for node in projected["nodes"]], ["target"])
        target = projected["nodes"][0]
        self.assertEqual(target["inputNodeIds"], [])
        self.assertEqual(target["items"], [])
        self.assertNotIn("frameId", target)

    def test_snapshot_mutation_rebase_and_transient_disconnect_queue(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8',
            );
            const events = [];
            const sent = [];
            const accepted = [];
            const sockets = [];
            const timeoutDelays = [];
            const localValues = new Map();
            const fakeLocalStorage = {{
                getItem:key => localValues.has(key)
                    ? localValues.get(key)
                    : null,
                setItem:(key,value) => localValues.set(key,String(value)),
                removeItem:key => localValues.delete(key),
            }};
            const titleElement = {{textContent:''}};
            const statusElement = {{
                textContent:'',
                className:'',
                hidden:false,
                onclick:null,
            }};
            class FakeWebSocket {{
                static OPEN = 1;
                static CONNECTING = 0;
                static CLOSING = 2;
                constructor(url) {{
                    this.url = url;
                    this.readyState = FakeWebSocket.CONNECTING;
                    sockets.push(this);
                }}
                open() {{
                    this.readyState = FakeWebSocket.OPEN;
                    this.onopen?.();
                }}
                emit(message) {{
                    this.onmessage?.({{data:JSON.stringify(message)}});
                }}
                send(value) {{
                    sent.push(JSON.parse(value));
                }}
                close(code=1000) {{
                    this.readyState = 3;
                    this.onclose?.({{code}});
                }}
            }}
            const serverCanvas = {{
                id:'canvas-1',
                title:'Loaded Canvas',
                icon:'sparkles',
                project:'project-1',
                revision:0,
                nodes:[
                    {{id:'node-a',type:'smart-image',x:10,y:20,title:'A',images:[]}},
                    {{id:'node-b',type:'smart-prompt',x:40,y:50,title:'B',images:[]}},
                    {{
                        id:'node-stale',
                        type:'smart-image',
                        x:80,
                        y:90,
                        title:'Completed output',
                        images:[{{url:'result.png'}}],
                        queued:true,
                        running:true,
                        pending:1,
                    }},
                ],
                connections:[],
                settings:{{engine:'api'}},
                logs:[],
            }};
            let fetchedCanvas = serverCanvas;
            let timerId = 0;
            const sandbox = {{
                window:{{
                    WebSocket:FakeWebSocket,
                    localStorage:fakeLocalStorage,
                    addEventListener:() => {{}},
                    SmartCanvasModules:{{
                        generationRun:{{
                            status:() => ({{pendingTasks:[]}}),
                            resume:() => events.push('generation-resume'),
                        }},
                        smartMatting:{{
                            isActive:() => false,
                            resume:() => events.push('matting-resume'),
                        }},
                        smartContainer:{{
                            isGroup:() => false,
                            add:() => false,
                        }},
                        canvasMutation:{{
                            history:entry => accepted.push(entry),
                        }},
                        canvasInteraction:{{
                            active:() => null,
                            cancel:() => events.push('interaction-cancel'),
                        }},
                        viewportSelection:{{
                            viewport:{{
                                apply:() => events.push('viewport'),
                            }},
                        }},
                    }},
                }},
                location:{{protocol:'http:',host:'example.test'}},
                canvasId:'canvas-1',
                smartClientId:'client-1',
                canvas:null,
                canvasUsesConnections:false,
                nodes:[],
                viewport:{{x:0,y:0,scale:1}},
                settings:{{engine:'local'}},
                canvasDefaultSmartSettings:null,
                initialSmartSettings:{{engine:'local'}},
                selectionState:null,
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                fetch:async () => ({{
                    ok:true,
                    json:async () => ({{
                        canvas:JSON.parse(JSON.stringify(fetchedCanvas)),
                    }}),
                }}),
                document:{{
                    title:'',
                    activeElement:{{matches:() => false}},
                    addEventListener:() => {{}},
                    getElementById:id => {{
                        if(id === 'smartTitle') return titleElement;
                        if(id === 'canvasSyncStatus') return statusElement;
                        return null;
                    }},
                }},
                rememberCanvasListProject:id => events.push(`project:${{id}}`),
                normalizeLegacySmartNode:node => ({{...node}}),
                isSmartImageNode:node => node?.type === 'smart-image',
                smartNodeHasDisplayResult:node => (node?.images || []).some(item => item?.url),
                markSmartNodeComplete:node => {{
                    node.pending = 0;
                    node.running = false;
                    node.queued = false;
                    node.runTimerHidden = true;
                    delete node.pendingTasks;
                    return node;
                }},
                clearSmartNodeBusyState:node => node,
                clearCompletedNodeBusyStates:() => false,
                recoverStuckLoopOutputsFromLogs:() => false,
                hideCompletedRunTimers:() => false,
                cleanupDetachedRunInputRefs:() => false,
                normalizeSmartVideoModeSettings:() => {{}},
                cloneSmartSettings:value => ({{...value}}),
                loadRecentSmartSettings:() => events.push('settings-recent'),
                updateProviderModels:() => events.push('models'),
                render:() => events.push('render'),
                scheduleConnectionLayerRefresh:() => events.push('connections'),
                savePromptDraftForCurrent:() => {{}},
                stripImageGenerationMeta:item => ({{...item}}),
                mediaItemForStorage:item => ({{...item}}),
                settingsForStorage:value => ({{...(value || {{}})}}),
                tr:key => key,
                toast:message => events.push(`toast:${{message}}`),
                setTimeout:(callback, delay) => {{
                    timeoutDelays.push(delay);
                    timerId += 1;
                    return timerId;
                }},
                clearTimeout:() => {{}},
                setInterval:(_callback, _delay) => {{
                    timerId += 1;
                    return timerId;
                }},
                clearInterval:() => {{}},
                encodeURIComponent,
                Date,
                JSON,
                Promise,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            (async () => {{
                const persistence = sandbox.window.SmartCanvasModules.canvasPersistence;
                const loaded = await persistence.load();
                const socket = sockets[0];
                socket.open();
                socket.emit({{
                    type:'canvas_snapshot',
                    revision:0,
                    canvas:serverCanvas,
                }});
                sandbox.nodes.find(node => node.id === 'node-a').x = 120;
                sandbox.viewport.x = 999;
                await persistence.save();
                const localMutation = sent.find(item =>
                    item.type === 'canvas_mutation'
                );
                const operationId = localMutation.operation.operation_id;
                socket.emit({{
                    type:'canvas_mutation',
                    operation_id:operationId,
                    revision:1,
                    actor_id:'actor-a',
                    changes:localMutation.operation.changes,
                }});
                socket.emit({{
                    type:'canvas_mutation',
                    operation_id:'client-2:rename-1',
                    revision:2,
                    actor_id:'actor-b',
                    changes:{{
                        node_updates:[{{
                            id:'node-b',
                            path:['title'],
                            value:'Remote B',
                        }}],
                    }},
                }});
                const beforeDisconnect = {{
                    title:sandbox.nodes.find(node => node.id === 'node-b').title,
                    x:sandbox.nodes.find(node => node.id === 'node-a').x,
                }};
                socket.close(1006);
                const editableWhileReconnecting = persistence.editable();
                const onlineWhileReconnecting = persistence.online();
                sandbox.nodes.find(node => node.id === 'node-b').title = 'Offline edit';
                persistence.schedule();
                await persistence.save();
                const persistedWhileOffline = JSON.parse(
                    localValues.get('infiniteCanvasRealtimePending:v1:canvas-1')
                );
                const afterDisconnect = {{
                    title:sandbox.nodes.find(node => node.id === 'node-b').title,
                    x:sandbox.nodes.find(node => node.id === 'node-a').x,
                }};
                const reconnectingStatus = persistence.status();
                const reconnectingStatusHidden = statusElement.hidden;
                fetchedCanvas = {{
                    ...serverCanvas,
                    revision:2,
                    nodes:[
                        {{
                            ...serverCanvas.nodes[0],
                            x:120,
                        }},
                        {{
                            ...serverCanvas.nodes[1],
                            title:'Remote B',
                        }},
                    ],
                }};
                sandbox.canvas = null;
                sandbox.nodes = [];
                const reloaded = await persistence.load();
                const afterReload = {{
                    title:sandbox.nodes.find(node => node.id === 'node-b').title,
                    x:sandbox.nodes.find(node => node.id === 'node-a').x,
                }};
                const reconnectSocket = sockets[1];
                reconnectSocket.open();
                reconnectSocket.emit({{
                    type:'canvas_snapshot',
                    revision:2,
                    canvas:JSON.parse(JSON.stringify(fetchedCanvas)),
                }});
                await persistence.save();
                const mutations = sent.filter(item =>
                    item.type === 'canvas_mutation'
                );
                const queuedMutation = mutations[mutations.length - 1];
                reconnectSocket.emit({{
                    type:'canvas_mutation',
                    operation_id:queuedMutation.operation.operation_id,
                    revision:3,
                    actor_id:'actor-a',
                    changes:queuedMutation.operation.changes,
                }});
                const persistedAfterAck = localValues.get(
                    'infiniteCanvasRealtimePending:v1:canvas-1'
                ) || null;
                const statusAfterReconnect = persistence.status();
                const onlineAfterReconnect = persistence.online();
                const terminalNode = sandbox.nodes.find(node => node.id === 'node-a');
                Object.assign(terminalNode, {{
                    generationOperationId:'generation-1',
                    images:[{{url:'result.png'}}],
                    pending:1,
                    running:true,
                    pendingTasks:[{{taskId:'task-1'}}],
                    generationRunFeedback:{{successfulCount:0,failedCount:1}},
                    runTimerHidden:false,
                }});
                sandbox.authoritativeGenerationDocument = {{nodes:[{{
                    ...terminalNode,
                    pending:0,
                    running:false,
                }}]}};
                const reconciledTerminalGeneration = vm.runInContext(
                    'canvasPersistenceReconcileTerminalGenerationState(authoritativeGenerationDocument)',
                    sandbox,
                );
                const terminalGenerationState = {{
                    pending:terminalNode.pending,
                    running:terminalNode.running,
                    tasks:terminalNode.pendingTasks || null,
                    feedback:terminalNode.generationRunFeedback || null,
                    timerHidden:terminalNode.runTimerHidden,
                }};
                reconnectSocket.close(4403);
                const fatalStatus = persistence.status();
                localValues.set(
                    'infiniteCanvasRealtimePending:v1:canvas-1',
                    JSON.stringify({{
                        schema:1,
                        canvas_id:'canvas-1',
                        base_revision:3,
                        saved_at:Date.now(),
                        changes:{{
                            node_updates:[{{
                                id:'node-b',
                                path:['title'],
                                value:'Must not revive',
                            }}],
                        }},
                    }}),
                );
                sandbox.remoteDeletedCanvas = {{
                    ...fetchedCanvas,
                    revision:3,
                    nodes:[fetchedCanvas.nodes[0]],
                }};
                const deleteWinsDocument = vm.runInContext(
                    'canvasPersistenceRestoreLocal(remoteDeletedCanvas)',
                    sandbox,
                );
                const persistedAfterRemoteDelete = localValues.get(
                    'infiniteCanvasRealtimePending:v1:canvas-1'
                ) || null;
                process.stdout.write(JSON.stringify({{
                    methods:Object.keys(persistence).sort(),
                    loadedId:loaded?.id,
                    socketUrl:socket.url,
                    localMutation,
                    beforeDisconnect,
                    afterDisconnect,
                    editableWhileReconnecting,
                    onlineWhileReconnecting,
                    reconnectingStatus,
                    reconnectingStatusHidden,
                    reloadedId:reloaded?.id,
                    afterReload,
                    timeoutDelays,
                    persistedWhileOffline,
                    persistedAfterAck,
                    queuedMutation,
                    statusAfterReconnect,
                    onlineAfterReconnect,
                    reconciledTerminalGeneration,
                    terminalGenerationState,
                    fatalStatus,
                    editableAfterFatalClose:persistence.editable(),
                    fatalStatusHidden:statusElement.hidden,
                    fatalStatusText:statusElement.textContent,
                    deleteWinsNodeIds:deleteWinsDocument.nodes.map(
                        node => node.id
                    ),
                    persistedAfterRemoteDelete,
                    accepted,
                    viewport:sandbox.viewport,
                    syncClass:statusElement.className,
                    offlineToast:events.some(item =>
                        item.includes('已取消离线画布修改')
                    ),
                }}));
            }})().catch(error => {{
                process.stderr.write(error.stack || error.message);
                process.exitCode = 1;
            }});
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
            [
                "checkpoint",
                "editable",
                "hold",
                "load",
                "observeExternalCommit",
                "online",
                "receive",
                "release",
                "resync",
                "retry",
                "revert",
                "save",
                "schedule",
                "sendPresence",
                "startTransientSession",
                "status",
                "synced",
            ],
        )
        self.assertEqual(payload["loadedId"], "canvas-1")
        self.assertIn("/ws/canvases/canvas-1?client_id=client-1", payload["socketUrl"])
        changes = payload["localMutation"]["operation"]["changes"]
        self.assertEqual(
            changes["node_updates"],
            [{"id": "node-a", "path": ["x"], "value": 120}],
        )
        self.assertNotIn("viewport", json.dumps(changes))
        self.assertEqual(
            payload["beforeDisconnect"],
            {"title": "Remote B", "x": 120},
        )
        self.assertEqual(
            payload["afterDisconnect"],
            {"title": "Offline edit", "x": 120},
        )
        self.assertTrue(payload["editableWhileReconnecting"])
        self.assertFalse(payload["onlineWhileReconnecting"])
        self.assertEqual(payload["reconnectingStatus"]["state"], "reconnecting")
        self.assertTrue(payload["reconnectingStatusHidden"])
        self.assertEqual(payload["reloadedId"], "canvas-1")
        self.assertEqual(
            payload["afterReload"],
            {"title": "Offline edit", "x": 120},
        )
        self.assertIn(5000, payload["timeoutDelays"])
        persisted_changes = payload["persistedWhileOffline"]["changes"]
        self.assertEqual(
            persisted_changes["node_updates"],
            [{"id": "node-b", "path": ["title"], "value": "Offline edit"}],
        )
        queued_changes = payload["queuedMutation"]["operation"]["changes"]
        self.assertEqual(
            queued_changes["node_updates"],
            [{"id": "node-b", "path": ["title"], "value": "Offline edit"}],
        )
        self.assertIsNone(payload["persistedAfterAck"])
        self.assertEqual(payload["statusAfterReconnect"]["state"], "ready")
        self.assertEqual(payload["statusAfterReconnect"]["revision"], 3)
        self.assertTrue(payload["onlineAfterReconnect"])
        self.assertTrue(payload["reconciledTerminalGeneration"])
        self.assertEqual(
            payload["terminalGenerationState"],
            {
                "pending": 0,
                "running": False,
                "tasks": None,
                "feedback": None,
                "timerHidden": True,
            },
        )
        self.assertEqual(payload["fatalStatus"]["state"], "error")
        self.assertFalse(payload["editableAfterFatalClose"])
        self.assertFalse(payload["fatalStatusHidden"])
        self.assertIn("编辑权限", payload["fatalStatusText"])
        self.assertEqual(payload["deleteWinsNodeIds"], ["node-a"])
        self.assertIsNone(payload["persistedAfterRemoteDelete"])
        self.assertEqual(payload["accepted"][0]["action"], "accepted")
        self.assertEqual(payload["viewport"]["x"], 999)
        self.assertFalse(payload["offlineToast"])

    def test_heartbeat_accepts_revision_queued_while_text_editor_is_active(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8',
            );
            const sockets = [];
            const closeCalls = [];
            const renders = [];
            const sent = [];
            const intervalCallbacks = [];
            let editableActive = false;
            class FakeWebSocket {{
                static OPEN = 1;
                static CONNECTING = 0;
                static CLOSING = 2;
                constructor(url) {{
                    this.url = url;
                    this.readyState = FakeWebSocket.CONNECTING;
                    sockets.push(this);
                }}
                open() {{
                    this.readyState = FakeWebSocket.OPEN;
                    this.onopen?.();
                }}
                emit(message) {{
                    this.onmessage?.({{data:JSON.stringify(message)}});
                }}
                send(value) {{
                    sent.push(JSON.parse(value));
                }}
                close(code=1000, reason='') {{
                    closeCalls.push({{code,reason}});
                    this.readyState = 3;
                    this.onclose?.({{code}});
                }}
            }}
            const serverCanvas = {{
                id:'canvas-1',
                title:'Canvas',
                icon:'sparkles',
                project:'project-1',
                revision:0,
                nodes:[{{
                    id:'text-1',
                    type:'smart-text',
                    title:'Before',
                    text:'Before',
                }}],
                connections:[],
                settings:{{engine:'api'}},
                logs:[],
            }};
            const sandbox = {{
                window:{{
                    WebSocket:FakeWebSocket,
                    localStorage:{{
                        getItem:() => null,
                        setItem:() => {{}},
                        removeItem:() => {{}},
                    }},
                    addEventListener:() => {{}},
                    SmartCanvasModules:{{
                        generationRun:{{
                            status:() => ({{pendingTasks:[]}}),
                            resume:() => {{}},
                        }},
                        smartMatting:{{
                            isActive:() => false,
                            resume:() => {{}},
                        }},
                        smartContainer:{{
                            isGroup:() => false,
                        }},
                        canvasInteraction:{{
                            active:() => null,
                        }},
                        viewportSelection:{{
                            viewport:{{apply:() => {{}}}},
                        }},
                    }},
                }},
                location:{{protocol:'http:',host:'example.test'}},
                canvasId:'canvas-1',
                smartClientId:'client-1',
                canvas:null,
                nodes:[],
                settings:{{engine:'local'}},
                canvasDefaultSmartSettings:null,
                initialSmartSettings:{{engine:'local'}},
                selectionState:null,
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                fetch:async () => ({{
                    ok:true,
                    json:async () => ({{
                        canvas:JSON.parse(JSON.stringify(serverCanvas)),
                    }}),
                }}),
                document:{{
                    title:'',
                    activeElement:{{
                        matches:() => editableActive,
                    }},
                    addEventListener:() => {{}},
                    getElementById:() => null,
                }},
                rememberCanvasListProject:() => {{}},
                normalizeLegacySmartNode:node => ({{...node}}),
                isSmartImageNode:() => false,
                smartNodeHasDisplayResult:() => false,
                markSmartNodeComplete:node => node,
                clearSmartNodeBusyState:node => node,
                clearCompletedNodeBusyStates:() => false,
                recoverStuckLoopOutputsFromLogs:() => false,
                hideCompletedRunTimers:() => false,
                cleanupDetachedRunInputRefs:() => false,
                normalizeSmartVideoModeSettings:() => {{}},
                cloneSmartSettings:value => ({{...value}}),
                loadRecentSmartSettings:() => {{}},
                updateProviderModels:() => {{}},
                render:() => renders.push('render'),
                scheduleConnectionLayerRefresh:() => {{}},
                savePromptDraftForCurrent:() => {{}},
                stripImageGenerationMeta:item => ({{...item}}),
                mediaItemForStorage:item => ({{...item}}),
                settingsForStorage:value => ({{...(value || {{}})}}),
                tr:key => key,
                toast:() => {{}},
                setTimeout:() => 1,
                clearTimeout:() => {{}},
                setInterval:callback => {{
                    intervalCallbacks.push(callback);
                    return intervalCallbacks.length;
                }},
                clearInterval:() => {{}},
                encodeURIComponent,
                Date,
                JSON,
                Promise,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            (async () => {{
                const persistence = sandbox.window
                    .SmartCanvasModules.canvasPersistence;
                await persistence.load();
                const socket = sockets[0];
                socket.open();
                socket.emit({{
                    type:'canvas_snapshot',
                    revision:0,
                    canvas:serverCanvas,
                }});
                const rendersBeforeEditing = renders.length;
                editableActive = true;
                socket.emit({{
                    type:'canvas_mutation',
                    operation_id:'client-2:text-1',
                    revision:1,
                    actor_id:'actor-b',
                    changes:{{
                        node_updates:[{{
                            id:'text-1',
                            path:['text'],
                            value:'Remote text',
                        }}],
                    }},
                }});
                intervalCallbacks[0]();
                socket.emit({{type:'pong',revision:1}});
                process.stdout.write(JSON.stringify({{
                    closeCalls,
                    ping:sent.find(message => message.type === 'ping'),
                    status:persistence.status(),
                    text:sandbox.nodes[0].text,
                    rendersDuringEditing:renders.length - rendersBeforeEditing,
                    socketCount:sockets.length,
                }}));
            }})().catch(error => {{
                process.stderr.write(error.stack || error.message);
                process.exitCode = 1;
            }});
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
        self.assertEqual(payload["closeCalls"], [])
        self.assertEqual(payload["ping"]["revision"], 1)
        self.assertEqual(payload["status"]["state"], "ready")
        self.assertEqual(payload["status"]["revision"], 0)
        self.assertEqual(payload["text"], "Before")
        self.assertEqual(payload["rendersDuringEditing"], 0)
        self.assertEqual(payload["socketCount"], 1)

    def test_realtime_document_assignment_preserves_active_composer_settings(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8',
            );
            const reconcileCalls = [];
            const sandbox = {{
                window: {{
                    SmartCanvasModules: {{
                        generationSettings: {{
                            reconcileCanvasSync:({{canvasSettings}}) => {{
                                reconcileCalls.push(canvasSettings);
                                sandbox.canvasDefaultSmartSettings = {{
                                    ...sandbox.initialSmartSettings,
                                    ...canvasSettings,
                                }};
                                return sandbox.smartSettingsForNode(
                                    sandbox.nodes.find(
                                        node => node.id === 'node-a'
                                    ),
                                );
                            }},
                        }},
                    }},
                }},
                canvas: {{}},
                nodes: [{{
                    id:'node-a',
                    type:'smart-image',
                    runSettings:{{
                        engine:'api',
                        provider_id:'alternate-provider',
                        model:'alternate-image-model',
                        ratio:'wide',
                        resolution:'2k',
                    }},
                }}],
                settings:{{
                    engine:'api',
                    provider_id:'alternate-provider',
                    model:'alternate-image-model',
                    ratio:'wide',
                    resolution:'2k',
                }},
                initialSmartSettings:{{
                    engine:'api',
                    provider_id:'default-provider',
                    model:'gemini-3.1-flash-image-preview',
                    ratio:'square',
                    resolution:'4k',
                }},
                canvasDefaultSmartSettings:{{
                    engine:'api',
                    provider_id:'default-provider',
                    model:'gemini-3.1-flash-image-preview',
                    ratio:'square',
                    resolution:'4k',
                }},
                lastComposerNodeId:'node-a:node',
                normalizeLegacySmartNode:node => ({{...node}}),
                cloneSmartSettings:value => JSON.parse(JSON.stringify(value)),
                smartSettingsForNode:node => ({{
                    ...sandbox.canvasDefaultSmartSettings,
                    ...(node.runSettings || {{}}),
                }}),
                document:{{
                    title:'',
                    addEventListener:() => {{}},
                    getElementById:() => null,
                }},
                render:() => {{}},
                scheduleConnectionLayerRefresh:() => {{}},
                tr:key => key,
                JSON,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.sharedDocument = {{
                title:'Canvas',
                icon:'sparkles',
                nodes:[{{
                    id:'node-a',
                    type:'smart-image',
                    runSettings:{{
                        engine:'api',
                        provider_id:'alternate-provider',
                        model:'alternate-image-model',
                        ratio:'wide',
                        resolution:'2k',
                    }},
                }}],
                connections:[],
                settings:{{
                    engine:'api',
                    provider_id:'default-provider',
                    model:'gemini-3.1-flash-image-preview',
                    ratio:'square',
                    resolution:'4k',
                }},
                logs:[],
            }};
            vm.runInContext(
                'canvasPersistenceAssignDocument(sharedDocument, {{renderNow:false}})',
                sandbox,
            );
            process.stdout.write(JSON.stringify({{
                active:sandbox.settings,
                defaults:sandbox.canvasDefaultSmartSettings,
                reconcileCalls,
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
        self.assertEqual(payload["active"]["model"], "alternate-image-model")
        self.assertEqual(payload["active"]["ratio"], "wide")
        self.assertEqual(payload["active"]["resolution"], "2k")
        self.assertEqual(
            payload["defaults"]["model"],
            "gemini-3.1-flash-image-preview",
        )
        self.assertEqual(len(payload["reconcileCalls"]), 1)
        self.assertEqual(
            payload["reconcileCalls"][0]["resolution"],
            "4k",
        )

    def test_reconnect_snapshot_keeps_newer_local_edit_after_inflight_change(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(PERSISTENCE_MODULE))},
                'utf8',
            );
            const sent = [];
            const localValues = new Map();
            const socket = {{
                readyState:1,
                send:value => sent.push(JSON.parse(value)),
                close:() => {{}},
            }};
            const localStorage = {{
                getItem:key => localValues.get(key) || null,
                setItem:(key,value) => localValues.set(key,value),
                removeItem:key => localValues.delete(key),
            }};
            const confirmed = {{
                title:'Canvas',
                icon:'sparkles',
                nodes:[{{
                    id:'node-a',
                    type:'smart-image',
                    x:10,
                    y:20,
                    images:[],
                }}],
                connections:[],
                settings:{{engine:'api'}},
                logs:[],
            }};
            const sandbox = {{
                window:{{
                    WebSocket:{{OPEN:1}},
                    localStorage,
                    addEventListener:() => {{}},
                    SmartCanvasModules:{{
                        generationRun:{{
                            resume:() => {{}},
                        }},
                        smartMatting:{{
                            resume:() => {{}},
                        }},
                        canvasMutation:{{
                            history:() => {{}},
                        }},
                    }},
                }},
                canvasId:'canvas-1',
                smartClientId:'client-1',
                confirmed,
                socket,
                canvas:JSON.parse(JSON.stringify(confirmed)),
                nodes:[],
                settings:{{engine:'api'}},
                canvasDefaultSmartSettings:{{engine:'api'}},
                initialSmartSettings:{{engine:'api'}},
                selectionState:null,
                lastComposerNodeId:'',
                document:{{
                    title:'',
                    activeElement:{{matches:() => false}},
                    addEventListener:() => {{}},
                    getElementById:() => null,
                }},
                normalizeLegacySmartNode:node => ({{...node}}),
                cloneSmartSettings:value => JSON.parse(JSON.stringify(value)),
                savePromptDraftForCurrent:() => {{}},
                stripImageGenerationMeta:item => ({{...item}}),
                mediaItemForStorage:item => ({{...item}}),
                settingsForStorage:value => ({{...(value || {{}})}}),
                render:() => {{}},
                scheduleConnectionLayerRefresh:() => {{}},
                tr:key => key,
                toast:() => {{}},
                setTimeout:() => 1,
                clearTimeout:() => {{}},
                setInterval:() => 1,
                clearInterval:() => {{}},
                Date,
                JSON,
                Promise,
            }};
            sandbox.nodes = sandbox.canvas.nodes;
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            vm.runInContext(
                `
                canvasPersistenceConfirmedDocument =
                    canvasPersistenceCompactDocument(confirmed);
                canvasPersistenceRevision = 0;
                canvasPersistenceStatusValue = 'ready';
                canvasPersistenceSocket = socket;
                `,
                sandbox,
            );
            (async () => {{
                sandbox.nodes[0].x = 120;
                await sandbox.window.SmartCanvasModules.canvasPersistence.save();
                const firstOperation = sent.find(
                    message => message.type === 'canvas_mutation'
                );
                sandbox.nodes[0].x = 240;
                await sandbox.window.SmartCanvasModules.canvasPersistence.save();
                sandbox.serverSnapshot = {{
                    ...confirmed,
                    revision:1,
                    nodes:[{{...confirmed.nodes[0], x:120}}],
                }};
                vm.runInContext(
                    `
                    canvasPersistenceApplySnapshot({{
                        type:'canvas_snapshot',
                        revision:1,
                        canvas:serverSnapshot
                    }});
                    `,
                    sandbox,
                );
                sandbox.duplicateAck = {{
                    type:'canvas_mutation',
                    duplicate:true,
                    revision:1,
                    operation_id:firstOperation.operation.operation_id,
                    changes:{{}},
                }};
                vm.runInContext(
                    'canvasPersistenceApplyMutationMessage(duplicateAck)',
                    sandbox,
                );
                const followUpOperation = sent.find(
                    message =>
                        message.type === 'canvas_mutation'
                        && message.operation.operation_id
                            !== firstOperation.operation.operation_id
                );
                const localRecordValue = localValues.get(
                    'infiniteCanvasRealtimePending:v1:canvas-1'
                ) || '';
                const localRecord = localRecordValue
                    ? JSON.parse(localRecordValue)
                    : null;
                process.stdout.write(JSON.stringify({{
                    firstOperation,
                    followUpOperation,
                    x:sandbox.nodes[0].x,
                    localRecord,
                    sent,
                }}));
            }})();
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
        self.assertEqual(payload["firstOperation"]["operation"]["base_revision"], 0)
        self.assertEqual(payload["x"], 240)
        self.assertIsNotNone(payload["followUpOperation"])
        follow_up_updates = payload["followUpOperation"]["operation"][
            "changes"
        ]["node_updates"]
        self.assertTrue(
            any(
                update["id"] == "node-a"
                and update["path"] == ["x"]
                and update["value"] == 240
                for update in follow_up_updates
            )
        )
        self.assertIsNotNone(payload["localRecord"])
        pending_updates = payload["localRecord"]["changes"]["node_updates"]
        self.assertTrue(
            any(
                update["id"] == "node-a"
                and update["path"] == ["x"]
                and update["value"] == 240
                for update in pending_updates
            )
        )


if __name__ == "__main__":
    unittest.main()
