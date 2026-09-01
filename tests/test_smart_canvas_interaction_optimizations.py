import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
VIEWPORT = ROOT / "static/js/smart-canvas/viewport-selection.js"
INTERACTION = ROOT / "static/js/smart-canvas/canvas-interaction.js"
GENERATION_RUN = ROOT / "static/js/smart-canvas/generation-run.js"
PAGE = ROOT / "static/smart-canvas.html"
STYLE = ROOT / "static/css/smart-canvas.css"
CORE = ROOT / "static/js/infinite-canvas-ui/core.js"
MULTI_SELECTION = ROOT / "static/js/infinite-canvas-ui/nodes/multi-selection.js"
SELECTION_ARRANGEMENT = ROOT / "static/js/smart-canvas/selection-arrangement.js"
CONNECTION_LAYER = ROOT / "static/js/smart-canvas/connection-layer.js"


class SmartCanvasInteractionOptimizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = HOST.read_text(encoding="utf-8")
        cls.viewport = VIEWPORT.read_text(encoding="utf-8")
        cls.interaction = INTERACTION.read_text(encoding="utf-8")
        cls.generation_run = GENERATION_RUN.read_text(encoding="utf-8")
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.style = STYLE.read_text(encoding="utf-8")
        cls.core = CORE.read_text(encoding="utf-8")
        cls.multi_selection = MULTI_SELECTION.read_text(encoding="utf-8")
        cls.selection_arrangement = SELECTION_ARRANGEMENT.read_text(encoding="utf-8")
        cls.connection_layer = CONNECTION_LAYER.read_text(encoding="utf-8")

    def test_regeneration_anchors_to_original_reference_node(self):
        start = self.generation_run.index("function regenerationAnchorNode")
        end = self.generation_run.index(
            "\nasync function regenerateGenerationRun", start
        )
        helper = self.generation_run[start:end]
        script = f"""
            let nodes = [
                {{id:'a'}},
                {{id:'b', sourceNodeId:'a'}},
                {{id:'c', runInputRefs:[{{nodeId:'a'}}]}},
                {{id:'d'}}
            ];
            let canvas = {{connections:[{{from:'a',to:'d',kind:'flow'}}]}};
            {helper}
            process.stdout.write(JSON.stringify([
                regenerationAnchorNode(nodes[1]).id,
                regenerationAnchorNode(nodes[2]).id,
                regenerationAnchorNode(nodes[3]).id
            ]));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["a", "a", "a"])
        regenerate = self.generation_run[
            self.generation_run.index("async function regenerateGenerationRun") :
        ]
        self.assertIn(
            "const inheritSourceConnections = generationRunHasIncomingSourceConnection("
            "\n        source\n    )",
            regenerate,
        )
        self.assertIn(
            "const outputParent = inheritSourceConnections ? source : anchor",
            regenerate,
        )
        self.assertIn(
            "const pending = batchNodes[0] || "
            "generationOutputModule.createPending({",
            regenerate,
        )
        self.assertIn("strategy:'pending'", regenerate)
        self.assertNotIn("strategy:'append'", regenerate)
        self.assertIn("sourceNodeId:anchor.id", regenerate)

    def test_multi_selection_has_one_overlay_toolbar_and_resize_gesture(self):
        self.assertIn('<ic-canvas-multi-selection id="smartMultiSelectionBox"', self.page)
        self.assertIn("define('ic-canvas-multi-selection', IcCanvasMultiSelection)", self.core)
        self.assertEqual(self.multi_selection.count('part="handle corner'), 4)
        self.assertIn(
            "border:var(--ui-border-width-strong) solid var(--ui-color-border-focus);",
            self.multi_selection,
        )
        self.assertIn(':host(:not([open])) { display:none; }', self.multi_selection)
        self.assertIn('[part~="corner-se"]', self.multi_selection)
        self.assertIn('isResizeEvent(event)', self.multi_selection)
        self.assertNotIn('class="smart-multi-selection-corner', self.page)
        self.assertNotIn('.smart-multi-selection-corner', self.style)
        self.assertIn(
            "border:var(--ui-border-width-thin) solid var(--ui-color-border-focus);",
            self.multi_selection,
        )
        self.assertIn("box-shadow:var(--ui-shadow-none);", self.multi_selection)
        self.assertIn(
            "scale(var(--smart-selection-handle-scale))",
            self.multi_selection,
        )
        self.assertIn(
            "--smart-selection-handle-inverse-scale",
            self.viewport,
        )
        self.assertIn("function smartMultiSelectionToolbarHtml", self.host)
        for mode in ("grid", "horizontal", "vertical"):
            self.assertIn(f'data-smart-multi-layout="{mode}"', self.host)
        self.assertIn("kind:'resize-selection'", self.host)
        self.assertIn("smartMultiSelectionBox.isResizeEvent?.(event)", self.host)
        self.assertIn(
            "function smartCanvasInteractionBeginSelectionResize",
            self.interaction,
        )
        self.assertIn(
            "function smartCanvasInteractionMoveSelectionResize",
            self.interaction,
        )

    def test_multi_selection_overlay_moves_the_whole_selection(self):
        start = self.host.index(
            "smartMultiSelectionBox?.addEventListener('mousedown'"
        )
        end = self.host.index(
            "\nfunction runSmartGroupToolbarAction", start
        )
        handlers = self.host[start:end]
        self.assertIn("kind:'move-nodes'", handlers)
        self.assertIn("kind:'resize-selection'", handlers)
        self.assertIn(
            "viewportSelection.selection.ids()[0]",
            handlers,
        )
        self.assertIn(
            "smartMultiSelectionBox?.addEventListener('contextmenu'",
            handlers,
        )
        self.assertIn("cursor:move;", self.multi_selection)
        self.assertIn("pointer-events:auto;", self.multi_selection)

    def test_prompt_and_audio_node_surfaces_share_the_surface_token(self):
        self.assertIn(
            ".theme-dark .image-node.prompt-smart-node { "
            "background:var(--ui-color-surface);",
            self.style,
        )
        self.assertIn(
            ".media-audio-card { min-width:260px; min-height:0; "
            "gap:var(--ui-space-2); padding:var(--ui-space-3); "
            "background:var(--ui-color-surface); }",
            self.style,
        )
        self.assertIn(
            ".theme-dark .media-audio-card { "
            "background:var(--ui-color-surface);",
            self.style,
        )

    def test_node_hover_uses_overlay_shadow_except_container_and_annotation_nodes(self):
        self.assertIn(
            ".image-node:hover:not(.smart-group-node):not(.smart-frame-node)"
            ":not(.smart-annotation-node) "
            "{ box-shadow:var(--ui-shadow-overlay); }",
            self.style,
        )
        self.assertIn(".smart-group-node:hover", self.style)
        self.assertIn(".image-node.smart-frame-node {", self.style)
        self.assertIn(
            ".image-node.smart-annotation-node:hover,",
            self.style,
        )

    def test_selection_frames_reuse_the_component_focus_tokens(self):
        self.assertIn(
            "border:var(--ui-border-width-strong) solid var(--ui-color-border-focus);",
            self.multi_selection,
        )
        start = self.style.index(".smart-annotation-selection { position:absolute")
        end = self.style.index("}", start)
        annotation_rule = self.style[start:end]
        self.assertIn("outline:var(--ui-focus-ring)", annotation_rule)
        self.assertIn("outline-offset:var(--ui-border-width-thin)", annotation_rule)
        self.assertIn("box-shadow:var(--ui-focus-ring-shadow)", annotation_rule)

    def test_drag_selection_is_translucent_and_dark_selection_is_blue(self):
        self.assertIn(
            "background:color-mix(in srgb, var(--ui-color-border-selected) 14%, transparent)",
            self.style,
        )
        self.assertNotIn(
            ".theme-dark .selection-box { background:var(--ui-color-surface); }",
            self.style,
        )
        self.assertNotIn(".smart-multi-selection-corner", self.style)
        self.assertIn("border-color:var(--ui-color-border-selected);", self.style)

    def test_connections_select_before_showing_scissor_disconnect_control(self):
        self.assertIn("let selectedConnectionKey = '';", self.host)
        self.assertIn("let selectedConnectionPoint = null;", self.host)
        self.assertIn(
            "const isSelected = view.snapshot.selectedConnectionKey === item.key;",
            self.connection_layer,
        )
        self.assertIn(
            "? 'var(--ui-color-text-success)'\n"
            "                : 'var(--ui-color-border-connections)'",
            self.connection_layer,
        )
        self.assertIn("icon.classList.add('conn-cut-icon')", self.connection_layer)
        self.assertIn("circle.setAttribute('r','18')", self.connection_layer)
        self.assertIn("icon.setAttribute('transform','scale(2)')", self.connection_layer)
        self.assertIn(
            "svg.dataset.connectionDelegationBound = '1';",
            self.connection_layer,
        )
        self.assertIn(
            "const key = control.closest('[data-connection-key]')",
            self.connection_layer,
        )
        self.assertIn(
            "const point = dependencies.screenToWorld?.(event)",
            self.connection_layer,
        )
        self.assertIn("dependencies.onSelect?.({key,x:point.x,y:point.y,event})", self.connection_layer)
        self.assertIn(
            "controlX:selectedPoint?.x ?? (geometry.fx + geometry.tx) / 2",
            self.connection_layer,
        )
        self.assertIn(
            "controlY:selectedPoint?.y ?? (geometry.fy + geometry.ty) / 2",
            self.connection_layer,
        )
        self.assertIn("const fromNode = nodeById.get(item.from)", self.connection_layer)
        self.assertIn("const toNode = nodeById.get(item.toId)", self.connection_layer)
        self.assertIn(
            "window.SmartCanvasModules.viewportSelection.selection.refresh();",
            self.host,
        )
        self.assertIn(
            "connectionHit:event.target?.closest?.('.conn-hit') || null",
            self.host,
        )
        self.assertNotIn("connectionPointerDiagnostic", self.host)
        self.assertNotIn("connectionDocumentTargetDiagnostic", self.host)
        self.assertNotIn("connectionTargetDiagnostic", self.host)
        self.assertNotIn("connectionSelectedKeyDiagnostic", self.host)
        self.assertIn(
            ".connection-layer { position:absolute; left:0; top:0; "
            "width:6000px; height:4000px; pointer-events:none;",
            self.style,
        )
        self.assertIn(
            ".connection-layer .conn-line,.connection-layer .conn-end "
            "{ pointer-events:none; }",
            self.style,
        )
        self.assertNotIn(
            "control.addEventListener('mousedown', event => {\n"
            "            event.preventDefault();",
            self.host,
        )
        self.assertNotIn("smartConnectionEventsBound", self.connection_layer)
        self.assertNotIn("conn-hit')){\n            el.addEventListener('dblclick'", self.host)
        self.assertIn(
            ".connection-layer .conn-selected { "
            "stroke:var(--ui-color-border-selected); stroke-width:2.5; opacity:1; }",
            self.style,
        )

    def test_connection_layer_uses_indexed_incremental_refresh_and_delegation(self):
        source = self.connection_layer
        self.assertIn("nodeById = new Map(nodes.map(node => [node.id,node]))", source)
        self.assertIn("materializationKeysByNodeId = new Map()", source)
        self.assertIn("function smartConnectionLayerRefreshNodes(nodeIds=[])", source)
        self.assertIn("materializationKeysByNodeId.get(nodeId)", source)
        self.assertIn("line.setAttribute('d',geometry.curve)", source)
        self.assertIn("hit.setAttribute('d',geometry.curve)", source)
        self.assertIn("svg.addEventListener('click', event =>", source)
        self.assertNotIn("document.createElement('template')", source)
        self.assertNotIn("querySelectorAll('.conn-hit,.conn-cut')", source)
        self.assertIn(
            ".connection-layer .connection-materialization.is-pointer-hover .conn-line "
            "{ stroke:var(--ui-color-border-focus); stroke-width:2.5; }",
            self.style,
        )

    def test_quick_add_uses_explicit_pointer_states_and_spatial_hysteresis(self):
        for state in (
            "is-preview",
            "is-active",
            "is-exit-grace",
            "is-menu-locked",
            "is-keyboard-locked",
        ):
            self.assertIn(state, self.host)
            self.assertIn(state, self.style)
        self.assertIn("const SMART_NODE_QUICK_ADD_EXIT_GRACE_MS = 80;", self.host)
        self.assertIn("const SMART_NODE_QUICK_ADD_SWITCH_HYSTERESIS_PX = 8;", self.host)
        update_start = self.host.index("function updateSmartNodeQuickAddFromPointer()")
        update_end = self.host.index("\nfunction queueSmartNodeQuickAddPointer", update_start)
        update = self.host[update_start:update_end]
        self.assertLess(
            update.index("smartNodeQuickAddCandidatesAtPointer"),
            update.index("pointer.connectionHit"),
        )
        self.assertIn("smartNodeQuickAddState.lock === 'menu'", update)
        self.assertIn("smartNodeQuickAddState.lock === 'keyboard'", update)
        self.assertIn("portDragState?.moved", update)
        self.assertIn("function scheduleSmartNodeQuickAddExitGrace(zone)", self.host)

    def test_connection_and_frame_hit_priority_is_explicit(self):
        self.assertIn(
            ".connection-layer { position:absolute; left:0; top:0; "
            "width:6000px; height:4000px; pointer-events:none;",
            self.style,
        )
        self.assertIn(
            ".connection-layer .conn-hit { pointer-events:stroke; cursor:pointer; }",
            self.style,
        )
        self.assertIn(
            ".connection-layer .conn-cut { pointer-events:auto; cursor:pointer; opacity:1; }",
            self.style,
        )
        self.assertIn("function smartCanvasPointerPriorityAt", self.host)
        self.assertIn(".smart-frame-node .node-head", self.host)
        self.assertIn(".smart-frame-node .node-resize-handle", self.host)
        self.assertIn("connection-hit-suppressed", self.host)
        self.assertIn("connection-cut-target", self.host)
        self.assertIn("quick-add-button-target", self.host)
        self.assertIn(".image-node.smart-frame-node { z-index:auto; }", self.style)
        self.assertIn(".image-node.smart-frame-node.selected { z-index:auto; }", self.style)
        self.assertIn(
            ".shell.connection-hit-suppressed .connection-layer .conn-hit",
            self.style,
        )
        self.assertIn(
            ".shell.connection-cut-target .smart-node-quick-add-zone",
            self.style,
        )
        self.assertIn(
            ".shell.connection-cut-target .smart-frame-node "
            ":is(.node-head,.node-resize-handle),.shell.quick-add-button-target .smart-frame-node "
            ":is(.node-head,.node-resize-handle) { pointer-events:none; }",
            self.style,
        )

    def test_connections_are_painted_below_smart_groups_and_other_nodes(self):
        self.assertIn("z-index:1; overflow:visible;", self.style)
        self.assertIn(".image-node { z-index:2; }", self.style)
        self.assertNotIn(".image-node.smart-group-node { z-index:0; }", self.style)

    def test_menu_keyboard_and_drag_states_recompute_from_latest_pointer(self):
        open_start = self.host.index("function openReferenceGenerateMenu(drag, event, options={})")
        open_end = self.host.index("\nfunction referenceGeneratePointForNode", open_start)
        self.assertIn(
            "lockSmartNodeQuickAdd(options.trigger, 'menu')",
            self.host[open_start:open_end],
        )
        close_start = self.host.index("function closeReferenceGenerateMenu(options={})")
        close_end = self.host.index("\nfunction openReferenceGenerateMenu", close_start)
        self.assertIn("unlockSmartNodeQuickAdd('menu')", self.host[close_start:close_end])
        self.assertIn("lockSmartNodeQuickAdd(quickAddTrigger, 'keyboard')", self.host)
        self.assertIn("unlockSmartNodeQuickAdd('keyboard')", self.host)
        self.assertIn("setSmartNodeQuickAddPortDragging(true)", self.host)
        self.assertIn("setSmartNodeQuickAddPortDragging(false)", self.host)
        self.assertIn(
            ".shell.port-dragging .connection-layer :is(.conn-hit,.conn-cut) "
            "{ pointer-events:none; }",
            self.style,
        )

    def test_multi_selection_bounds_are_projected_in_screen_space(self):
        script = f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(VIEWPORT))}, 'utf8');
            const overlay = {{
                style:{{}},
                classList:{{toggle(name,value){{ this.value = [name,value]; }}}},
                toggleAttribute(name,value){{ this[name] = value; }},
                setAttribute(name,value){{ this[name] = value; }}
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[
                    {{id:'a',x:10,y:20,width:100,height:60}},
                    {{id:'b',x:180,y:80,width:40,height:50}}
                ],
                selectedId:'',
                selectedIds:['a','b'],
                selectedImage:{{nodeId:'',index:-1}},
                viewport:{{x:50,y:30,scale:2}},
                smartMultiSelectionBox:overlay,
                nodeRect:node => node,
                world:{{style:{{setProperty(){{}}}},classList:{{toggle(){{}}}}}},
                shell:{{
                    clientWidth:800,
                    clientHeight:600,
                    style:{{}},
                    getBoundingClientRect(){{ return {{left:0,top:0}}; }}
                }},
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
            const selection = sandbox.window.SmartCanvasModules
                .viewportSelection.selection;
            sandbox.window.SmartCanvasModules.viewportSelection.viewport.apply();
            process.stdout.write(JSON.stringify({{
                bounds:selection.bounds(),
                overlay:overlay.style,
                open:overlay.classList.value
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
        self.assertEqual(
            data["bounds"],
            {"x": 10, "y": 20, "width": 210, "height": 110},
        )
        self.assertEqual(
            data["overlay"],
            {
                "left": "70px",
                "top": "70px",
                "width": "420px",
                "height": "220px",
            },
        )
        self.assertEqual(data["open"], ["open", True])

    def test_multi_selection_resize_scales_nodes_as_one_mutation(self):
        script = f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(INTERACTION))},
                'utf8'
            );
            const events = [];
            const nodes = [
                {{id:'a',type:'smart-image',x:0,y:0,w:100,h:100}},
                {{id:'b',type:'smart-image',x:200,y:0,w:100,h:100}}
            ];
            const elements = new Map(nodes.map(node => [
                node.id,
                {{style:{{}}}}
            ]));
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    viewportSelection:{{
                        selection:{{
                            ids:() => ['a','b'],
                            bounds:() => ({{x:0,y:0,width:300,height:100}}),
                            node:() => null
                        }},
                        viewport:{{refresh:() => events.push('refresh')}}
                    }},
                    canvasPersistence:{{
                        editable:() => true,
                        hold:options => events.push(`hold:${{options.scope}}`),
                        release:options => events.push(`release:${{options.scope}}`),
                        schedule:() => events.push('save')
                    }},
                    canvasMutation:{{
                        history:options => {{
                            events.push(`history:${{options.action}}`);
                            if(options.action === 'snapshot') return {{
                                nodes:JSON.parse(JSON.stringify(nodes)),
                                connections:[],
                                selectedId:'',
                                selectedIds:['a','b'],
                                selectedImage:{{nodeId:'',index:-1}}
                            }};
                        }}
                    }},
                    smartContainer:{{
                        isGroup:() => false,
                        isFrame:() => false,
                        reconcileFrames:() => {{
                            events.push('reconcile');
                            return true;
                        }}
                    }}
                }}}},
                canvas:{{connections:[]}},
                nodes,
                selectedId:'',
                selectedIds:['a','b'],
                selectedImage:{{nodeId:'',index:-1}},
                viewport:{{scale:1}},
                nodeRect:node => ({{
                    x:node.x,
                    y:node.y,
                    width:node.w,
                    height:node.h
                }}),
                world:{{
                    querySelector:selector => {{
                        const id = selector.match(/data-id="([^"]+)"/)?.[1];
                        return elements.get(id) || null;
                    }},
                    querySelectorAll:() => []
                }},
                document:{{
                    body:{{classList:{{add(){{}},remove(){{}}}}}}
                }},
                CSS:{{escape:value => value}},
                SMART_GROUP_MIN_WIDTH:180,
                SMART_GROUP_MIN_HEIGHT:120,
                SMART_FRAME_MIN_WIDTH:240,
                SMART_FRAME_MIN_HEIGHT:160,
                syncNodeElementLayout:() => events.push('layout'),
                scheduleConnectionLayerRefresh:() => events.push('connections'),
                render:() => events.push('render'),
                requestAnimationFrame:callback => {{
                    callback();
                    return 1;
                }},
                cancelAnimationFrame:() => null,
                console
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const interaction =
                sandbox.window.SmartCanvasModules.canvasInteraction;
            const event = x => ({{
                button:0,
                clientX:x,
                clientY:100,
                preventDefault(){{}},
                stopPropagation(){{}}
            }});
            interaction.begin({{
                kind:'resize-selection',
                event:event(300)
            }});
            interaction.move(event(600));
            interaction.end(event(600));
            process.stdout.write(JSON.stringify({{
                nodes,
                events,
                active:interaction.active()
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
        self.assertEqual(
            [
                {
                    key: node[key]
                    for key in ("id", "x", "y", "w", "h")
                }
                for node in data["nodes"]
            ],
            [
                {"id": "a", "x": 0, "y": 0, "w": 200, "h": 200},
                {"id": "b", "x": 400, "y": 0, "w": 200, "h": 200},
            ],
        )
        self.assertIn("hold:resize-selection", data["events"])
        self.assertIn("history:commit", data["events"])
        self.assertIn("release:resize-selection", data["events"])
        self.assertIn("save", data["events"])
        self.assertIsNone(data["active"])

    def test_frame_members_remain_independent_arrange_targets(self):
        start = self.host.index("function smartArrangeAtomicIds")
        end = self.host.index("\nfunction arrangeSelectedSmartNodes", start)
        helper = self.host[start:end]
        self.assertIn(
            "nodes.filter(node => smartContainer.isGroup(node))",
            helper,
        )
        self.assertNotIn("smartContainer.isFrame(node)", helper)
        self.assertIn("function arrangeSelectedSmartNodes", self.host)
        self.assertIn("smartContainer.frameFor(node.id)", self.host)

    def test_multi_selection_exposes_layouts_without_an_arrange_disclosure(self):
        start = self.host.index("function smartMultiSelectionToolbarHtml")
        end = self.host.index("\nfunction positionSmartNodeFloatingPortal", start)
        toolbar = self.host[start:end]
        for mode in ("grid", "horizontal", "vertical", "tree"):
            self.assertIn(f'data-smart-multi-layout="{mode}"', toolbar)
        self.assertNotIn('data-smart-multi-action="arrange"', toolbar)
        self.assertNotIn("smart-multi-layout-tooltip", toolbar)

    def test_arrange_is_only_available_for_explicit_multi_selection(self):
        start = self.host.index("function arrangeSelectedSmartNodes")
        end = self.host.index("\nfunction isSmartAnnotationNode", start)
        arrange = self.host[start:end]

        self.assertNotIn('id="smartArrangeBtn"', self.page)
        self.assertNotIn(".minimap-arrange-btn", self.style)
        self.assertNotIn("connectedSmartClusterIds", self.host)
        self.assertNotIn("'arrange-selection'", self.host)
        self.assertIn("if(explicit.length < 2) return;", arrange)
        self.assertIn("const ids = smartArrangeAtomicIds(explicit);", arrange)

    def test_floating_menu_clears_legacy_inline_visibility_when_reopened(self):
        start = self.host.index("function syncSmartNodeFloatingPortal")
        end = self.host.index("\nfunction smartMultiSelectionMediaItems", start)
        sync = self.host[start:end]

        self.assertIn("if(!html) smartNodeFloatingPortal.classList.add('viewport-hidden');", sync)
        self.assertNotIn("smartNodeFloatingPortal.style.visibility = 'hidden'", sync)
        self.assertIn(
            "if(html) smartNodeFloatingPortal.style.removeProperty('visibility');",
            sync,
        )
        self.assertLess(
            sync.index("style.removeProperty('visibility')"),
            sync.index("positionSmartNodeFloatingPortal(node,bounds)"),
        )

    def test_arrange_gap_uses_actual_gaps_before_applying_minimum(self):
        source = self.selection_arrangement
        self.assertIn("const gapCount = columnGaps + rowGaps", source)
        self.assertIn("const gap = totalGap / gapCount", source)
        self.assertNotIn("SMART_ARRANGE_DEFAULT_GAP", source)
        self.assertNotIn("averageGap >= 0", source)

    def test_tree_layout_uses_internal_projected_connections_and_forest_layers(self):
        source = self.selection_arrangement
        self.assertIn("function projectedConnections(", source)
        self.assertIn("const projection = groupProjection(allNodes,selectedIds)", source)
        self.assertIn("if(!selectedIds.has(from) || !selectedIds.has(to) || from === to) return", source)
        self.assertIn("layer.set(childId,Math.max", source)
        self.assertIn("cycleFallback", source)

    def test_arrangement_host_only_collects_selection_and_delegates_mutation(self):
        start = self.host.index("function arrangeSelectedSmartNodes")
        end = self.host.index("\nfunction isSmartAnnotationNode", start)
        arrange = self.host[start:end]
        self.assertIn("const plan = arrangement.plan({", arrange)
        self.assertIn("canvasMutation.arrange({placements:plan.placements,frameUpdates})", arrange)
        self.assertNotIn("arrangeSmartIdsByTree", self.host)
        self.assertNotIn("arrangeSmartIdsByLayout", self.host)

    def test_group_wheel_reaches_canvas_zoom(self):
        start = self.host.index("shell.addEventListener('wheel'")
        end = self.host.index("\nwindow.addEventListener('resize'", start)
        handler = self.host[start:end]
        self.assertNotIn("[data-thumb-scroll]", handler)
        self.assertIn("applySmartCanvasViewportZoom(factor, e)", handler)

    def test_overflowing_text_nodes_and_mention_picker_own_wheel_at_boundaries(self):
        priority_start = self.host.index("function promptNodeWheelPriorityActive")
        priority_end = self.host.index("\nfunction localEditorOwnsWheel", priority_start)
        priority = self.host[priority_start:priority_end]
        start = self.host.index("function localEditorOwnsWheel")
        end = self.host.index("\nwindow.addEventListener('resize'", start)
        handler = self.host[start:end]
        self.assertIn(".image-node.prompt-smart-node", priority)
        self.assertIn("viewportSelection.selection.has", priority)
        self.assertIn("function localScrollableHasOverflow", self.host)
        self.assertIn(".image-node.prompt-smart-node", handler)
        self.assertIn(".prompt-node-text", handler)
        self.assertIn("ic-mention-picker", handler)
        self.assertIn("localHasOverflow", handler)
        self.assertIn("if(!promptNodeWheelPriorityActive(element)) return false", handler)
        self.assertIn("const localCanScroll = promptNodeWheelPriorityActive(wheelTarget)", handler)
        self.assertIn("localEditorOwnsWheel(e.target, localHasOverflow)", handler)
        self.assertIn("localOwnsWheel", handler)
        self.assertIn("if(!localCanScroll) e.preventDefault()", handler)
        self.assertIn("e.stopPropagation()", handler)

    def test_modified_wheel_over_prompt_nodes_reaches_canvas_zoom(self):
        start = self.host.index("function bindScrollableText")
        end = self.host.index("\nfunction updatePortDragVisual", start)
        binding = self.host[start:end]
        self.assertIn(
            "if(e.metaKey || e.ctrlKey || canvasPanOwnsPointer()) return",
            binding,
        )
        self.assertIn("if(!promptNodeWheelPriorityActive(el)) return", binding)
        self.assertIn("if(!localScrollableHasOverflow(el)) return", binding)
        start = self.host.index("shell.addEventListener('wheel'")
        end = self.host.index("\nwindow.addEventListener('resize'", start)
        handler = self.host[start:end]
        self.assertIn("smartEffectiveTool() !== 'hand'", handler)
        self.assertIn("&& localEditorOwnsWheel(e.target, localHasOverflow)", handler)
        self.assertIn("applySmartCanvasViewportZoom(factor, e)", handler)

    def test_composer_and_nested_popovers_do_not_scroll_the_canvas(self):
        self.assertIn(
            "composer.addEventListener('wheel', event => "
            "event.stopPropagation(), {passive:false})",
            self.host,
        )
        self.assertIn("ic-generation-settings-picker", self.host)
        self.assertNotIn(".smart-popover { position:absolute", self.style)

    def test_composer_text_selection_cannot_clear_the_active_canvas_subject(self):
        self.assertIn(
            "function smartComposerEditingSessionActive()",
            self.host,
        )
        shell_click = self.host[
            self.host.index("shell.onclick = e => {") :
            self.host.index("\n};", self.host.index("shell.onclick = e => {"))
        ]
        self.assertIn("smartComposerEditingSessionActive()", shell_click)
        delete_shortcut = self.host[
            self.host.index("if((e.key === 'Delete' || e.key === 'Backspace')") :
            self.host.index("\n    }", self.host.index("if((e.key === 'Delete' || e.key === 'Backspace')"))
        ]
        self.assertIn("!smartComposerEditingSessionActive()", delete_shortcut)

    def test_canvas_selection_pointer_reclaims_keyboard_focus_from_composer(self):
        start = self.host.index("function smartCanvasSelectionPointerTarget")
        end = self.host.index("\nwindow.addEventListener('mousedown'", start)
        helper = self.host[start:end]
        script = f"""
            let focused = 'composer';
            const shell = {{
                focus(options) {{ focused = options?.preventScroll ? 'shell' : 'wrong'; }}
            }};
            const world = {{}};
            function isEditableTarget(target) {{ return Boolean(target?.editable); }}
            {helper}
            const image = {{
                editable:false,
                closest(selector) {{ return selector.includes('.image-node') ? {{}} : null; }}
            }};
            const inactiveText = {{
                editable:false,
                closest(selector) {{ return selector.includes('.image-node') ? {{}} : null; }}
            }};
            const activeEditor = {{
                editable:true,
                closest(selector) {{ return selector.includes('.image-node') ? {{}} : null; }}
            }};
            const imageClaimed = focusSmartCanvasFromSelectionPointer({{button:0,target:image}});
            focused = 'composer';
            const textClaimed = focusSmartCanvasFromSelectionPointer({{button:0,target:inactiveText}});
            focused = 'composer';
            const editorClaimed = focusSmartCanvasFromSelectionPointer({{button:0,target:activeEditor}});
            process.stdout.write(JSON.stringify({{
                imageClaimed,
                textClaimed,
                editorClaimed,
                editorFocus:focused
            }}));
        """
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
                "imageClaimed": True,
                "textClaimed": True,
                "editorClaimed": False,
                "editorFocus": "composer",
            },
        )
        pointer_handler = self.host[
            self.host.index("window.addEventListener('mousedown'", end) :
            self.host.index("\n}, true);", self.host.index("window.addEventListener('mousedown'", end))
        ]
        self.assertIn("focusSmartCanvasFromSelectionPointer(event)", pointer_handler)

    def test_open_composer_overlays_keep_delete_owned_by_composer(self):
        start = self.host.index("function smartComposerOwnedOverlayOpen")
        end = self.host.index("\nfunction scheduleComposerUpdate", start)
        helper = self.host[start:end]
        script = f"""
            let parameterPopoverOpen = false;
            let generationSettingsOpen = false;
            let mentionOpen = false;
            let templateOpen = false;
            const promptInput = {{id:'prompt'}};
            const shell = {{id:'shell'}};
            const composer = {{
                querySelector(selector) {{
                    if(!selector.includes('ic-generation-settings-picker')) return null;
                    return (generationSettingsOpen || parameterPopoverOpen) ? {{}} : null;
                }},
                contains() {{ return false; }}
            }};
            const mentionPicker = {{
                classList:{{contains() {{ return mentionOpen; }}}},
                hasAttribute(name) {{ return name === 'open' && mentionOpen; }},
                contains() {{ return false; }}
            }};
            const promptTemplatePanel = {{
                get open() {{ return templateOpen; }},
                dataset:{{target:'composer'}},
                contains() {{ return false; }}
            }};
            const document = {{activeElement:shell}};
            function promptQuickEditor() {{ return promptInput; }}
            function isPromptTemplatePanelOpen() {{ return templateOpen; }}
            let smartComposerPointerOwner = 'canvas';
            {helper}
            parameterPopoverOpen = true;
            const parameterProtected = smartComposerEditingSessionActive();
            parameterPopoverOpen = false;
            generationSettingsOpen = true;
            const generationSettingsProtected = smartComposerEditingSessionActive();
            generationSettingsOpen = false;
            mentionOpen = true;
            const mentionProtected = smartComposerEditingSessionActive();
            mentionOpen = false;
            templateOpen = true;
            const templateProtected = smartComposerEditingSessionActive();
            templateOpen = false;
            const plainCanvasOwned = smartComposerEditingSessionActive();
            process.stdout.write(JSON.stringify({{
                parameterProtected,
                generationSettingsProtected,
                mentionProtected,
                templateProtected,
                plainCanvasOwned
            }}));
        """
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
                "parameterProtected": True,
                "generationSettingsProtected": True,
                "mentionProtected": True,
                "templateProtected": True,
                "plainCanvasOwned": False,
            },
        )
        pointer_handler = self.host[
            self.host.index("window.addEventListener('mousedown'", end) :
            self.host.index("\n}, true);", self.host.index("window.addEventListener('mousedown'", end))
        ]
        self.assertIn("smartComposerInteractionTarget(event.target)", pointer_handler)

    def test_copy_as_image_and_session_scoped_cross_canvas_node_clipboard(self):
        self.assertIn("smartContextMenuItem('copy-image'", self.host)
        self.assertIn("function copySmartImageToClipboard", self.host)
        self.assertIn("new ClipboardItemType({'image/png':png})", self.host)
        self.assertIn(
            "const SMART_NODE_CLIPBOARD_KEY = "
            "'smart_canvas_node_clipboard_v1'",
            self.host,
        )
        self.assertIn("function storeSessionNodeClipboard", self.host)
        self.assertIn(
            "sessionStorage.setItem(\n            SMART_NODE_CLIPBOARD_KEY",
            self.host,
        )
        self.assertIn("localStorage.removeItem(SMART_NODE_CLIPBOARD_KEY)", self.host)
        self.assertNotIn(
            "localStorage.setItem(\n            SMART_NODE_CLIPBOARD_KEY",
            self.host,
        )
        self.assertIn("sourceCanvasId:canvasId", self.host)
        self.assertIn("availableNodeClipboard()", self.host)


if __name__ == "__main__":
    unittest.main()
