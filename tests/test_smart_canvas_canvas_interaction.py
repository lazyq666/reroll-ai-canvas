import json
import re
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
MODULE = ROOT / "static/js/smart-canvas/canvas-interaction.js"
MUTATION = ROOT / "static/js/smart-canvas/canvas-mutation.js"
GEOMETRY = ROOT / "static/js/smart-canvas/node-geometry.js"
PLACEMENT = ROOT / "static/js/smart-canvas/node-placement.js"
PAGE = ROOT / "static/smart-canvas.html"
PERSISTENCE = ROOT / "static/js/smart-canvas/canvas-persistence.js"


class SmartCanvasInteractionModuleTests(unittest.TestCase):
    def test_module_owns_pointer_interactions_and_loads_after_dependencies(self):
        host = HOST.read_text(encoding="utf-8")
        source = MODULE.read_text(encoding="utf-8")
        page = PAGE.read_text(encoding="utf-8")
        persistence = PERSISTENCE.read_text(encoding="utf-8")

        for legacy_definition in (
            "let smartFrameDrawState",
            "let dragState",
            "let loopInsertPreview",
            "let resizeState",
            "let thumbDragState",
            "function startSmartFrameDraw(",
            "function updateSmartFrameDraw(",
            "function finishSmartFrameDraw(",
            "function cancelSmartFrameDraw(",
            "function beginSmartFramePointer(",
            "function moveNodeElementsDuringDrag(",
            "function dragConnectTargetFor(",
            "function restoreDraggedNodePosition(",
            "function updateLoopInsertPreview(",
        ):
            self.assertNotIn(legacy_definition, host)

        self.assertIn(
            "window.SmartCanvasModules.canvasInteraction",
            source,
        )
        self.assertIn(
            "function smartCanvasInteractionBegin(",
            source,
        )
        for implementation in (
            "function smartCanvasInteractionBeginResize(",
            "function smartCanvasInteractionBeginMove(",
            "function smartCanvasInteractionBeginDetach(",
            "function smartCanvasInteractionMoveResize(",
            "function smartCanvasInteractionMoveNodes(",
            "function smartCanvasInteractionEndMove(",
            "function smartCanvasInteractionCancel(",
        ):
            self.assertIn(implementation, source)
        self.assertIn(
            "const canvasInteraction = "
            "window.SmartCanvasModules?.canvasInteraction",
            host,
        )
        self.assertIn(
            "canvasPersistenceLocalInteractionActive()",
            persistence,
        )
        self.assertIn("let smartCanvasRenderInProgress = false", host)
        self.assertIn(
            "if(smartCanvasRenderInProgress){",
            host,
        )
        self.assertIn(
            "queueMicrotask(() => render({",
            host,
        )
        self.assertIn("state.aspectRatio", source)
        self.assertIn("height = width / state.aspectRatio", source)
        self.assertIn("width = height * state.aspectRatio", source)
        self.assertNotIn("mergeImageNodesIntoGroup", source)
        self.assertNotIn("function mergeImageNodesIntoGroup(", host)
        self.assertIn(
            "const smartGroupTarget = "
            "canvasInteractionContainerModule.dragTarget(",
            source,
        )
        self.assertIn("const target = smartGroupTarget || (", source)
        direct_group_drop = re.search(
            r"else if\(\s*smartGroupTarget\s*"
            r"&& canvasInteractionContainerModule\.add\("
            r"(?P<body>.*?)\n\s*\)\s*\{",
            source,
            re.S,
        )
        self.assertIsNotNone(direct_group_drop)
        self.assertNotIn("state.ctrlGroup", direct_group_drop.group("body"))
        self.assertIn("const ratio = explicitSize.width / explicitSize.height", host)
        self.assertIn("node.h = height", host)

        container_index = page.index(
            "/static/js/smart-canvas/smart-container.js"
        )
        interaction_index = page.index(
            "/static/js/smart-canvas/canvas-interaction.js"
        )
        host_index = page.index("/static/js/smart-canvas.js")
        self.assertLess(container_index, interaction_index)
        self.assertLess(interaction_index, host_index)

    def test_option_shift_drag_uses_plain_option_duplicate_connections(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT))}, 'utf8');
            const mutationSource = fs.readFileSync({json.dumps(str(MUTATION))}, 'utf8');
            const interactionSource = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            let nextId = 0;
            const parent = {{id:'a',type:'smart-image',x:0,y:0,w:200,h:120,images:[]}};
            const selected = {{
                id:'b',type:'smart-image',x:320,y:0,w:200,h:120,images:[],
                inputNodeIds:['a']
            }};
            const child = {{
                id:'c',type:'smart-image',x:640,y:0,w:200,h:120,images:[],
                inputNodeIds:['b']
            }};
            const sandbox = {{
                SmartCanvasModules:{{}},
                nodes:[parent,selected,child],
                canvas:{{connections:[
                    {{from:'a',to:'b',kind:'input'}},
                    {{from:'b',to:'c',kind:'input'}},
                ]}},
                selectedId:'b',selectedIds:[],selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                lastMouseWorld:{{x:0,y:0}},viewport:{{scale:1}},
                smartFrameToolActive:false,suppressNodeClickUntil:0,
                SMART_GROUP_MIN_WIDTH:120,SMART_GROUP_MIN_HEIGHT:90,
                SMART_GROUP_MAX_MEMBER_ZOOM:1,
                SMART_FRAME_MIN_WIDTH:120,SMART_FRAME_MIN_HEIGHT:80,
                document:{{
                    activeElement:{{blur:() => {{}}}},
                    body:{{classList:{{add:() => {{}},remove:() => {{}}}}}}
                }},
                world:{{querySelector:() => null,querySelectorAll:() => []}},
                isEditableTarget:() => false,
                nodeRect:node => ({{
                    x:node.x || 0,y:node.y || 0,
                    width:node.w || 200,height:node.h || 120
                }}),
                render:() => {{}},toast:() => {{}},tr:key => key,
                refreshConnectionLayer:() => {{}},
                positionComposerForNode:() => {{}},
                positionSmartNodeFloatingPortal:() => {{}},
                requestAnimationFrame:callback => {{ callback(); return 0; }},
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:() => false,
                clearSmartNodeTransientRunState:() => {{}},
                clearDetachedRunInputRefs:() => {{}},
                demoteHistoryGroupNode:() => {{}},
                imagesForNode:node => node.images || [],
                promptTextItemsForNode:() => [],
                fitSmartLoopNode:() => {{}},promptNodeExpandedHeight:() => 260,
                Date,console,
            }};
            sandbox.globalThis = sandbox;
            sandbox.window = sandbox;
            sandbox.window.getSelection = () => ({{removeAllRanges:() => {{}}}});
            sandbox.SmartCanvasModules.viewportSelection = {{
                viewport:{{refresh:() => {{}}}},
                selection:{{
                    has:id => sandbox.selectedId === id,
                    ids:() => sandbox.selectedId ? [sandbox.selectedId] : []
                }}
            }};
            sandbox.SmartCanvasModules.canvasPersistence = {{
                editable:() => true,hold:() => {{}},release:() => {{}},schedule:() => {{}}
            }};
            sandbox.SmartCanvasModules.smartContainer = {{
                isFrame:() => false,isGroup:() => false,expand:ids => [...ids]
            }};
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            vm.runInContext(mutationSource,sandbox);
            vm.runInContext(interactionSource,sandbox);
            const started = sandbox.SmartCanvasModules.canvasInteraction.begin({{
                kind:'move-nodes',
                nodeId:'b',
                event:{{
                    button:0,detail:1,clientX:320,clientY:0,
                    altKey:true,shiftKey:true,ctrlKey:false,
                    target:{{closest:() => null}},
                    preventDefault:() => {{}},stopPropagation:() => {{}}
                }}
            }});
            const duplicate = sandbox.nodes.find(node => !['a','b','c'].includes(node.id));
            process.stdout.write(JSON.stringify({{
                started,
                duplicateId:duplicate?.id || '',
                duplicateInputs:duplicate?.inputNodeIds || [],
                duplicateConnections:sandbox.canvas.connections.filter(connection =>
                    connection.from === duplicate?.id || connection.to === duplicate?.id
                ),
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["started"])
        self.assertTrue(payload["duplicateId"])
        self.assertEqual(payload["duplicateInputs"], [])
        self.assertEqual(payload["duplicateConnections"], [])

    def test_frame_interaction_commits_one_mutation_and_cancel_discards(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(MODULE))},
                'utf8'
            );
            const events = [];
            const nodes = [];
            const nodeElement = {{style:{{}}}};
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    viewportSelection:{{
                        viewport:{{
                            screenToWorld:event => event.world,
                            refresh:() => events.push('viewport-refresh')
                        }},
                        selection:{{node:() => null}}
                    }},
                    canvasPersistence:{{
                        hold:options => events.push(
                            `hold:${{options.scope}}`
                        ),
                        release:options => events.push(
                            `release:${{options.scope}}`
                        ),
                        schedule:() => events.push('save')
                    }},
                    canvasMutation:{{
                        history:options => events.push(
                            `history:${{options.action}}`
                        ),
                        create:options => {{
                            const node = {{
                                id:`frame-${{nodes.length + 1}}`,
                                type:'smart-frame',
                                ...options.data
                            }};
                            nodes.push(node);
                            events.push('create');
                            return node;
                        }},
                        remove:options => {{
                            const index = nodes.findIndex(
                                node => node.id === options.nodeIds[0]
                            );
                            if(index >= 0) nodes.splice(index, 1);
                            events.push('remove');
                            return index >= 0;
                        }}
                    }},
                    smartContainer:{{
                        reconcileFrames:() => {{
                            events.push('reconcile');
                            return true;
                        }}
                    }}
                }}}},
                canvas:{{}},
                nodes,
                smartFrameToolActive:true,
                smartBaseTool:'frame',
                didPan:true,
                suppressSmartAnnotationClickUntil:0,
                SMART_FRAME_MIN_WIDTH:120,
                SMART_FRAME_MIN_HEIGHT:80,
                SMART_FRAME_DEFAULT_WIDTH:360,
                SMART_FRAME_DEFAULT_HEIGHT:240,
                CSS:{{escape:value => value}},
                world:{{
                    querySelector:() => nodeElement,
                    querySelectorAll:() => []
                }},
                document:{{
                    body:{{classList:{{remove:() => null}}}}
                }},
                syncNodeElementLayout:() => events.push('resize-dom'),
                scheduleConnectionLayerRefresh:() => null,
                refreshSmartAnnotationToolbar:() => events.push('toolbar'),
                render:() => events.push('render'),
                beginCreatedSmartFrameTitleEdit:node => events.push(
                    `title:${{node.id}}`
                ),
                Date,
                console
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const interaction =
                sandbox.window.SmartCanvasModules.canvasInteraction;
            const target = {{closest:() => null}};
            const pointer = (clientX, clientY, world) => ({{
                button:0,
                clientX,
                clientY,
                world,
                target,
                preventDefault:() => events.push('prevent'),
                stopPropagation:() => events.push('stop'),
                stopImmediatePropagation:() => events.push('stop-immediate')
            }});

            interaction.begin({{
                kind:'draw-frame',
                event:pointer(100, 200, {{x:100,y:200}})
            }});
            const activeAfterBegin = interaction.active('draw-frame');
            interaction.move(pointer(50, 100, {{x:50,y:100}}));
            interaction.end();
            const committed = {{...nodes[0]}};

            sandbox.smartFrameToolActive = true;
            interaction.begin({{
                kind:'draw-frame',
                event:pointer(300, 400, {{x:300,y:400}})
            }});
            interaction.end();
            const defaultFrame = {{...nodes[1]}};

            sandbox.smartFrameToolActive = true;
            interaction.begin({{
                kind:'draw-frame',
                event:pointer(500, 600, {{x:500,y:600}})
            }});
            const activeBeforeCancel = interaction.active();
            interaction.cancel({{reason:'escape'}});

            process.stdout.write(JSON.stringify({{
                activeAfterBegin,
                activeBeforeCancel,
                activeAfterCancel:interaction.active(),
                committed,
                defaultFrame,
                remainingIds:nodes.map(node => node.id),
                nodeElement,
                smartFrameToolActive:sandbox.smartFrameToolActive,
                smartBaseTool:sandbox.smartBaseTool,
                events
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
        data = json.loads(result.stdout)
        self.assertTrue(data["activeAfterBegin"])
        self.assertTrue(data["activeBeforeCancel"])
        self.assertFalse(data["activeAfterCancel"])
        self.assertEqual(
            {
                key: data["committed"][key]
                for key in ("x", "y", "w", "h")
            },
            {"x": -20, "y": 100, "w": 120, "h": 100},
        )
        self.assertEqual(
            {
                key: data["defaultFrame"][key]
                for key in ("x", "y", "w", "h")
            },
            {"x": 120, "y": 280, "w": 360, "h": 240},
        )
        self.assertEqual(data["remainingIds"], ["frame-1", "frame-2"])
        self.assertEqual(
            data["nodeElement"]["style"],
            {"left": "-20px", "top": "100px"},
        )
        self.assertIn("history:capture", data["events"])
        self.assertIn("history:commit", data["events"])
        self.assertIn("history:discard", data["events"])
        self.assertEqual(data["events"].count("hold:draw-frame"), 3)
        self.assertEqual(data["events"].count("release:draw-frame"), 3)
        self.assertIn("reconcile", data["events"])
        self.assertIn("save", data["events"])
        self.assertIn("remove", data["events"])

    def test_resize_move_cancel_and_thumb_transition_are_atomic(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(MODULE))},
                'utf8'
            );
            const events = [];
            const nodes = [
                {{
                    id:'node-1',
                    type:'smart-image',
                    x:10,
                    y:20,
                    w:100,
                    h:80,
                    images:[{{url:'a.png'}},{{url:'b.png'}}]
                }}
            ];
            const historySnapshot = () => ({{
                nodes:JSON.parse(JSON.stringify(nodes)),
                connections:JSON.parse(JSON.stringify(canvas.connections)),
                selectedId,
                selectedIds:[...selectedIds],
                selectedImage:{{...selectedImage}}
            }});
            const viewportSelection = {{
                viewport:{{
                    screenToWorld:event => event.world || {{
                        x:event.clientX / 2,
                        y:event.clientY / 2
                    }},
                    refresh:() => events.push('viewport-refresh')
                }},
                selection:{{
                    node:() => null,
                    ids:() => selectedIds.length
                        ? [...selectedIds]
                        : selectedId
                            ? [selectedId]
                            : [],
                    has:id => selectedId === id || selectedIds.includes(id)
                }}
            }};
            const persistence = {{
                hold:options => events.push(`hold:${{options.scope}}`),
                release:options => events.push(`release:${{options.scope}}`),
                schedule:() => events.push('save')
            }};
            const mutation = {{
                history:options => {{
                    events.push(`history:${{options.action}}`);
                    return options.action === 'snapshot'
                        ? historySnapshot()
                        : true;
                }},
                duplicate:() => ({{nodes:[],anchor:null}}),
                connect:() => false,
                disconnect:() => false,
                create:() => null,
                remove:() => false
            }};
            let activeGroupTarget = true;
            const smartContainer = {{
                isGroup:node => node?.type === 'smart-group',
                isFrame:node => node?.type === 'smart-frame',
                expand:ids => [...ids],
                zoom:() => 1,
                groupMembers:() => [],
                imageRefs:node => (node?.images || []).map(item => ({{item}})),
                compactMembers:() => [],
                arrange:group => {{
                    events.push(`arrange:${{group.id}}`);
                    return true;
                }},
                dragTarget:node => activeGroupTarget && node?.id === 'prompt-1'
                    ? sandbox.nodes.find(
                        candidate => candidate.id === 'group-1'
                    )
                    : null,
                groupFor:id => sandbox.nodes.find(node =>
                    node.type === 'smart-group'
                    && (node.items || []).includes(id)
                ) || null,
                add:(groupId,ids) => {{
                    const group = sandbox.nodes.find(node => node.id === groupId);
                    if(!group) return false;
                    group.items = [...new Set([...(group.items || []),...ids])];
                    return true;
                }},
                release:(ids,groupId) => {{
                    const group = sandbox.nodes.find(node => node.id === groupId);
                    if(!group) return false;
                    group.items = (group.items || []).filter(
                        id => !ids.includes(id)
                    );
                    return true;
                }},
                prune:() => false,
                reconcileFrames:() => false
            }};
            const bodyClasses = new Set();
            const canvas = {{connections:[]}};
            let selectedId = 'node-1';
            let selectedIds = [];
            let selectedImage = {{nodeId:'',index:-1}};
            const sandbox = {{
                window:{{
                    SmartCanvasModules:{{
                        viewportSelection,
                        canvasPersistence:persistence,
                        canvasMutation:mutation,
                        smartContainer
                    }},
                    getSelection:() => ({{removeAllRanges:() => null}})
                }},
                canvas,
                nodes,
                selectedId,
                selectedIds,
                selectedImage,
                viewport:{{scale:2}},
                lastMouseWorld:{{x:0,y:0}},
                smartFrameToolActive:false,
                suppressNodeClickUntil:0,
                SMART_GROUP_MIN_WIDTH:120,
                SMART_GROUP_MIN_HEIGHT:90,
                SMART_GROUP_MAX_MEMBER_ZOOM:1,
                SMART_FRAME_MIN_WIDTH:120,
                SMART_FRAME_MIN_HEIGHT:80,
                CSS:{{escape:value => value}},
                document:{{
                    activeElement:{{blur:() => events.push('blur')}},
                    elementFromPoint:() => null,
                    body:{{classList:{{
                        add:name => bodyClasses.add(name),
                        remove:(...names) => names.forEach(
                            name => bodyClasses.delete(name)
                        )
                    }}}}
                }},
                world:{{
                    querySelector:() => null,
                    querySelectorAll:() => []
                }},
                nodeRect:node => ({{
                    x:Number(node.x) || 0,
                    y:Number(node.y) || 0,
                    width:Number(node.w) || 100,
                    height:Number(node.h) || 80
                }}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:() => false,
                syncNodeElementLayout:node => events.push(
                    `layout:${{node.id}}`
                ),
                positionComposerForNode:() => null,
                positionSmartNodeFloatingPortal:() => null,
                refreshConnectionLayer:() => events.push('connections'),
                scheduleConnectionLayerRefresh:() => events.push(
                    'connections-scheduled'
                ),
                requestAnimationFrame:callback => {{
                    callback();
                    return 0;
                }},
                render:() => events.push('render'),
                applyNodeMetaToImage:() => null,
                inheritNodeMetaFromImage:() => null,
                createImageNodeAt:(point,images) => {{
                    const node = {{
                        id:`detached-${{sandbox.nodes.length}}`,
                        type:'smart-image',
                        x:point.x,
                        y:point.y,
                        w:100,
                        h:80,
                        images:[...images]
                    }};
                    sandbox.nodes.push(node);
                    return node;
                }},
                Date,
                console
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const interaction =
                sandbox.window.SmartCanvasModules.canvasInteraction;
            const target = {{closest:() => null}};
            const pointer = (clientX,clientY,world) => ({{
                button:0,
                detail:1,
                clientX,
                clientY,
                world,
                ctrlKey:false,
                altKey:false,
                shiftKey:false,
                target,
                preventDefault:() => null,
                stopPropagation:() => null
            }});

            interaction.begin({{
                kind:'resize-node',
                event:pointer(0,0),
                nodeId:'node-1'
            }});
            interaction.move(pointer(40,20));
            interaction.end(pointer(40,20));
            const resized = {{w:nodes[0].w,h:nodes[0].h}};

            interaction.begin({{
                kind:'move-nodes',
                event:pointer(10,10),
                nodeId:'node-1'
            }});
            interaction.move(pointer(30,50));
            const moved = {{x:nodes[0].x,y:nodes[0].y}};
            interaction.cancel({{reason:'escape'}});
            const restored = {{
                x:sandbox.nodes[0].x,
                y:sandbox.nodes[0].y
            }};

            interaction.begin({{
                kind:'move-nodes',
                event:pointer(10,10),
                nodeId:'node-1'
            }});
            interaction.move(pointer(30,50));
            interaction.end(pointer(30,50));
            const committedMove = {{
                x:sandbox.nodes[0].x,
                y:sandbox.nodes[0].y
            }};

            const savesBeforeTinyMove = events.filter(
                item => item === 'save'
            ).length;
            interaction.begin({{
                kind:'move-nodes',
                event:pointer(10,10),
                nodeId:'node-1'
            }});
            interaction.move(pointer(12,11));
            const tinyMovePreview = {{
                x:sandbox.nodes[0].x,
                y:sandbox.nodes[0].y
            }};
            interaction.end(pointer(12,11));
            const tinyMoveResult = {{
                x:sandbox.nodes[0].x,
                y:sandbox.nodes[0].y
            }};
            const savesAfterTinyMove = events.filter(
                item => item === 'save'
            ).length;

            interaction.begin({{
                kind:'detach-media',
                event:pointer(0,0),
                nodeId:'node-1',
                mediaIndex:1
            }});
            interaction.move(pointer(3,2));
            const belowThresholdKind = interaction.active()?.kind;
            interaction.end(pointer(3,2));

            interaction.begin({{
                kind:'detach-media',
                event:pointer(0,0),
                nodeId:'node-1',
                mediaIndex:1
            }});
            interaction.move(pointer(20,0,{{x:500,y:500}}));
            const detachedKind = interaction.active()?.kind;
            interaction.end(pointer(20,0,{{x:500,y:500}}));

            sandbox.nodes.push(
                {{
                    id:'group-1',
                    type:'smart-group',
                    x:100,
                    y:100,
                    w:360,
                    h:300,
                    items:['prompt-1']
                }},
                {{
                    id:'prompt-1',
                    type:'smart-prompt',
                    x:140,
                    y:160,
                    w:96,
                    h:96
                }}
            );
            selectedId = 'prompt-1';
            sandbox.selectedId = 'prompt-1';
            interaction.begin({{
                kind:'move-nodes',
                event:pointer(0,0),
                nodeId:'prompt-1'
            }});
            interaction.move(pointer(50,40));
            const freeMemberPosition = {{
                x:sandbox.nodes.find(node => node.id === 'prompt-1').x,
                y:sandbox.nodes.find(node => node.id === 'prompt-1').y
            }};
            interaction.end(pointer(50,40));
            const snappedMemberPosition = {{
                x:sandbox.nodes.find(node => node.id === 'prompt-1').x,
                y:sandbox.nodes.find(node => node.id === 'prompt-1').y
            }};
            activeGroupTarget = false;
            interaction.begin({{
                kind:'move-nodes',
                event:pointer(0,0),
                nodeId:'prompt-1'
            }});
            interaction.move(pointer(80,60));
            interaction.end(pointer(80,60));
            const extractedMember = sandbox.nodes.find(
                node => node.id === 'prompt-1'
            );
            const extractedMemberState = {{
                id:extractedMember?.id,
                x:extractedMember?.x,
                y:extractedMember?.y,
                ownerItems:sandbox.nodes.find(
                    node => node.id === 'group-1'
                )?.items?.slice()
            }};

            process.stdout.write(JSON.stringify({{
                resized,
                moved,
                restored,
                committedMove,
                tinyMovePreview,
                tinyMoveResult,
                tinyMoveSaved:savesAfterTinyMove > savesBeforeTinyMove,
                belowThresholdKind,
                detachedKind,
                freeMemberPosition,
                snappedMemberPosition,
                extractedMemberState,
                nodeCount:sandbox.nodes.length,
                sourceImages:sandbox.nodes[0].images.length,
                active:interaction.active(),
                events
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
        data = json.loads(result.stdout)
        self.assertEqual(data["resized"], {"w": 120, "h": 90})
        self.assertEqual(data["moved"], {"x": 20, "y": 40})
        self.assertEqual(data["restored"], {"x": 10, "y": 20})
        self.assertEqual(data["committedMove"], {"x": 20, "y": 40})
        self.assertEqual(data["tinyMovePreview"], {"x": 21, "y": 40.5})
        self.assertEqual(data["tinyMoveResult"], {"x": 20, "y": 40})
        self.assertFalse(data["tinyMoveSaved"])
        self.assertEqual(data["belowThresholdKind"], "detach-media")
        self.assertEqual(data["detachedKind"], "move-nodes")
        self.assertEqual(
            data["snappedMemberPosition"],
            {"x": 25, "y": 20},
        )
        self.assertEqual(
            data["extractedMemberState"],
            {"id": "prompt-1", "x": 40, "y": 30, "ownerItems": []},
        )
        self.assertEqual(data["nodeCount"], 4)
        self.assertEqual(data["sourceImages"], 1)
        self.assertIsNone(data["active"])
        self.assertEqual(data["events"].count("history:capture"), 8)
        self.assertEqual(data["events"].count("history:commit"), 5)
        self.assertEqual(data["events"].count("history:discard"), 3)
        self.assertIn("hold:resize-node", data["events"])
        self.assertIn("release:resize-node", data["events"])
        self.assertIn("hold:move-nodes", data["events"])
        self.assertIn("release:move-nodes", data["events"])
        self.assertIn("hold:thumb-drag", data["events"])
        self.assertIn("release:thumb-drag", data["events"])

    def test_frame_movement_requires_an_existing_selection(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(MODULE))},
                'utf8'
            );
            const events = [];
            const frame = {{
                id:'frame-1',
                type:'smart-frame',
                x:10,
                y:20,
                w:360,
                h:240
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                canvas:{{connections:[]}},
                nodes:[frame],
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                viewport:{{scale:1}},
                smartFrameToolActive:false,
                suppressNodeClickUntil:0,
                SMART_GROUP_MIN_WIDTH:120,
                SMART_GROUP_MIN_HEIGHT:90,
                SMART_GROUP_MAX_MEMBER_ZOOM:1,
                SMART_FRAME_MIN_WIDTH:120,
                SMART_FRAME_MIN_HEIGHT:80,
                document:{{
                    activeElement:{{blur:() => events.push('blur')}},
                    body:{{classList:{{
                        add:name => events.push(`class:${{name}}`),
                        remove:() => null
                    }}}}
                }},
                world:{{
                    querySelector:() => null,
                    querySelectorAll:() => []
                }},
                render:() => null,
                Date,
                console
            }};
            sandbox.window.getSelection = () => ({{
                removeAllRanges:() => null
            }});
            sandbox.window.SmartCanvasModules.viewportSelection = {{
                viewport:{{refresh:() => null}},
                selection:{{
                    has:id => sandbox.selectedId === id,
                    ids:() => sandbox.selectedId
                        ? [sandbox.selectedId]
                        : []
                }}
            }};
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                hold:options => events.push(`hold:${{options.scope}}`),
                release:() => null,
                schedule:() => null
            }};
            sandbox.window.SmartCanvasModules.canvasMutation = {{
                history:options => {{
                    events.push(`history:${{options.action}}`);
                    if(options.action === 'snapshot'){{
                        return {{
                            nodes:[{{...frame}}],
                            connections:[],
                            selectedId:sandbox.selectedId,
                            selectedIds:[],
                            selectedImage:{{nodeId:'',index:-1}}
                        }};
                    }}
                    return true;
                }},
                duplicate:() => ({{nodes:[],anchor:null}})
            }};
            sandbox.window.SmartCanvasModules.smartContainer = {{
                isFrame:node => node?.type === 'smart-frame',
                isGroup:() => false,
                expand:ids => [...ids]
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const interaction =
                sandbox.window.SmartCanvasModules.canvasInteraction;
            const pointer = () => ({{
                button:0,
                clientX:100,
                clientY:100,
                altKey:false,
                shiftKey:false,
                ctrlKey:false,
                target:{{closest:() => null}},
                preventDefault:() => events.push('prevent'),
                stopPropagation:() => events.push('stop')
            }});

            const unselectedStarted = interaction.begin({{
                kind:'move-nodes',
                event:pointer(),
                nodeId:'frame-1'
            }});
            const activeWhileUnselected = interaction.active();

            sandbox.selectedId = 'frame-1';
            const selectedStarted = interaction.begin({{
                kind:'move-nodes',
                event:pointer(),
                nodeId:'frame-1'
            }});

            process.stdout.write(JSON.stringify({{
                unselectedStarted,
                activeWhileUnselected,
                selectedStarted,
                activeAfterSelection:interaction.active(),
                events
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
        data = json.loads(result.stdout)
        self.assertFalse(data["unselectedStarted"])
        self.assertIsNone(data["activeWhileUnselected"])
        self.assertTrue(data["selectedStarted"])
        self.assertEqual(
            data["activeAfterSelection"]["kind"],
            "move-nodes",
        )
        self.assertEqual(data["events"].count("prevent"), 1)
        self.assertEqual(data["events"].count("history:capture"), 1)
        self.assertIn("hold:move-nodes", data["events"])


if __name__ == "__main__":
    unittest.main()
