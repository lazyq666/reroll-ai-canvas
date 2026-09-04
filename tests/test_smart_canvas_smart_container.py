import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
CONTAINER_MODULE = ROOT / "static/js/smart-canvas/smart-container.js"
MUTATION_MODULE = ROOT / "static/js/smart-canvas/canvas-mutation.js"


class SmartCanvasSmartContainerModuleTests(unittest.TestCase):
    def test_container_implementation_is_owned_by_its_module(self):
        host = HOST.read_text(encoding="utf-8")
        source = CONTAINER_MODULE.read_text(encoding="utf-8")
        mutation = MUTATION_MODULE.read_text(encoding="utf-8")

        for implementation in (
            "function smartContainerGroupMembers(",
            "function smartContainerFrameMembers(",
            "function smartContainerDescendantIds(",
            "function smartContainerReconcileFrames(",
            "function smartContainerArrange(",
            "function smartContainerAdd(",
            "function smartContainerRelease(",
            "function smartContainerGroup(",
            "function smartContainerUngroup(",
            "function smartContainerRemove(",
        ):
            with self.subTest(implementation=implementation):
                self.assertIn(implementation, source)
                self.assertNotIn(implementation, host)

        for legacy_implementation in (
            "function smartGroupMembers(",
            "function smartFrameMembers(",
            "function expandedSmartNodeIds(",
            "function reconcileSmartFrameMembership(",
            "function addNodeToSmartGroup(",
            "function arrangeSmartGroupMembers(",
            "function groupSelectedNodes(",
            "function removeSmartNodesFromGroup(",
        ):
            with self.subTest(implementation=legacy_implementation):
                self.assertNotIn(legacy_implementation, host)

        self.assertIn("window.SmartCanvasModules.smartContainer", source)
        self.assertIn("const smartContainer =", host)
        self.assertIn("smartContainer.expand(", host)
        self.assertIn("smartContainer.remove(", host)
        self.assertNotIn("preserveFrameContents", mutation)
        self.assertNotIn("smartContainerDescendantIds", mutation)

    def test_interface_groups_ungroups_reconciles_and_cascades(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(CONTAINER_MODULE))},
                'utf8',
            );
            const events = [];
            let nextId = 0;
            let lastRemoved = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[],
                canvas:{{connections:[]}},
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                SMART_GROUP_MIN_WIDTH:150,
                SMART_GROUP_DEFAULT_WIDTH:340,
                SMART_GROUP_MIN_HEIGHT:130,
                SMART_GROUP_DEFAULT_HEIGHT:286,
                SMART_GROUP_LEGACY_HEIGHT:220,
                SMART_GROUP_MAX_VISIBLE_ROWS:3,
                SMART_FRAME_MIN_WIDTH:240,
                SMART_FRAME_DEFAULT_WIDTH:680,
                SMART_FRAME_MIN_HEIGHT:160,
                SMART_FRAME_DEFAULT_HEIGHT:420,
                MEDIA_GROUP_THUMB_BASE:96,
                MEDIA_NODE_DEFAULT_SCALE:0.72,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                nodeRect:node => ({{
                    x:Number(node?.x || 0),
                    y:Number(node?.y || 0),
                    width:Number(node?.w || 100),
                    height:Number(node?.h || 80),
                }}),
                isSmartImageNode:node => node?.type === 'smart-image',
                stripImageGenerationMeta:image => ({{...image}}),
                imageForDisplay:image => image,
                mediaNodeDefaultScale:node => Number(node?.scale) || 1,
                singleImageLayout:() => ({{
                    cols:1,
                    rows:1,
                    visibleRows:1,
                    width:96,
                    height:96,
                    thumb:96,
                    single:true,
                }}),
                groupImageGridLayout:count => ({{
                    cols:Math.min(2, count),
                    rows:Math.ceil(count / 2),
                    visibleRows:Math.ceil(count / 2),
                    width:220,
                    height:180,
                    thumb:80,
                }}),
                syncSmartGroupMemberElements:() => events.push('sync-dom'),
                imageLayout:() => ({{cols:2,thumb:80}}),
                nodeScale:() => 1,
                thumbDisplaySize:() => ({{width:80,height:80}}),
                inheritNodeMetaFromImage:() => {{}},
                clearDetachedRunInputRefs:() => {{}},
                render:() => events.push('render'),
                tr:key => key,
                toast:message => events.push(`toast:${{message}}`),
            }};
            const mutation = {{
                history:({{action='push'}}={{}}) => {{
                    events.push(`history:${{action}}`);
                    return true;
                }},
                create:({{kind='image',data={{}}}}={{}}) => {{
                    let node = data.node;
                    if(kind === 'group'){{
                        node = {{
                            id:sandbox.uid('group'),
                            type:'smart-group',
                            x:data.x || 0,
                            y:data.y || 0,
                            title:'编组',
                            items:[],
                            images:[],
                        }};
                    }}
                    sandbox.nodes.push(node);
                    return node;
                }},
                remove:({{nodeIds=[]}}={{}}) => {{
                    lastRemoved = nodeIds.slice();
                    const ids = new Set(nodeIds);
                    sandbox.nodes = sandbox.nodes.filter(node => !ids.has(node.id));
                    sandbox.nodes.forEach(node => {{
                        if(Array.isArray(node.items)){{
                            node.items = node.items.filter(id => !ids.has(id));
                        }}
                        if(Array.isArray(node.inputNodeIds)){{
                            node.inputNodeIds = node.inputNodeIds.filter(id => !ids.has(id));
                        }}
                    }});
                    sandbox.canvas.connections = sandbox.canvas.connections.filter(
                        connection => !ids.has(connection.from) && !ids.has(connection.to)
                    );
                    return Boolean(ids.size);
                }},
            }};
            sandbox.window.SmartCanvasModules.canvasMutation = mutation;
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                schedule:() => events.push('save'),
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const container = sandbox.window.SmartCanvasModules.smartContainer;

            const prompt = {{
                id:'prompt',
                type:'smart-prompt',
                x:40,
                y:60,
                w:120,
                h:80,
                inputNodeIds:['image'],
            }};
            const image = {{
                id:'image',
                type:'smart-image',
                x:220,
                y:60,
                w:100,
                h:80,
                images:[{{url:'source.png',kind:'image'}}],
            }};
            sandbox.nodes = [prompt,image];
            sandbox.canvas.connections = [
                {{from:'image',to:'prompt',kind:'input'}},
            ];
            const group = container.group(['prompt','image']);
            const grouped = {{
                type:group.type,
                memberIds:container.groupMembers(group).map(node => node.id),
                imageUrls:container.imageRefs(group).map(ref => ref.item.url),
                sourceRemoved:!sandbox.nodes.some(node => node.id === 'image'),
                connection:sandbox.canvas.connections[0],
                promptInputs:prompt.inputNodeIds.slice(),
                selectedId:sandbox.selectedId,
            }};

            const ungrouped = container.ungroup(group.id);
            const restoredImage = sandbox.nodes.find(node =>
                node.type === 'smart-image'
            );
            const released = {{
                ungrouped,
                groupRemoved:!sandbox.nodes.some(node => node.id === group.id),
                memberPreserved:sandbox.nodes.some(node => node.id === 'prompt'),
                restoredImageUrl:restoredImage?.images?.[0]?.url || '',
                restoredImageId:restoredImage?.id || '',
                restoredImageGeometry:[
                    restoredImage?.x,
                    restoredImage?.y,
                    restoredImage?.w,
                    restoredImage?.h,
                ],
                connection:sandbox.canvas.connections[0],
                selectedIds:sandbox.selectedIds.slice().sort(),
            }};

            const directGroup = {{
                id:'direct-group',
                type:'smart-group',
                x:20,
                y:30,
                w:340,
                h:220,
                items:[],
                images:[{{
                    url:'direct.png',
                    groupMemberId:'direct-media',
                }}],
                memberOrderVersion:1,
                memberOrder:[{{kind:'media',id:'direct-media'}}],
            }};
            sandbox.nodes = [directGroup];
            container.ungroup(directGroup.id);
            const detachedDirect = sandbox.nodes[0];
            const directRelease = {{
                idChanged:detachedDirect.id !== 'direct-media',
                geometry:[
                    detachedDirect.x,
                    detachedDirect.y,
                    detachedDirect.w,
                    detachedDirect.h,
                ],
                memberId:detachedDirect.images[0].groupMemberId || '',
            }};

            const mixedImage = {{
                id:'mixed-image',
                type:'smart-image',
                x:500,
                y:40,
                w:140,
                h:100,
                images:[{{url:'node-image.png'}}],
            }};
            const mixedPrompt = {{
                id:'mixed-prompt',
                type:'smart-prompt',
                x:660,
                y:40,
                w:120,
                h:80,
            }};
            const mixedGroup = {{
                id:'mixed-group',
                type:'smart-group',
                x:0,
                y:0,
                w:340,
                h:286,
                items:['mixed-image','mixed-prompt'],
                images:[
                    {{url:'direct-a.png',groupMemberId:'media-a'}},
                    {{url:'direct-b.png',groupMemberId:'media-b'}},
                ],
                memberOrderVersion:1,
                memberOrder:[
                    {{kind:'node',id:'mixed-image'}},
                    {{kind:'media',id:'media-a'}},
                    {{kind:'node',id:'mixed-prompt'}},
                    {{kind:'media',id:'media-b'}},
                ],
            }};
            sandbox.nodes = [mixedGroup,mixedImage,mixedPrompt];
            const mixedRefs = container.imageRefs(mixedGroup)
                .map(ref => [ref.item.url,ref.slotIndex]);
            container.ungroup(mixedGroup.id);
            const mixedReleaseOrder = sandbox.selectedIds.map(id => {{
                const node = sandbox.nodes.find(candidate => candidate.id === id);
                return node?.images?.[0]?.url || node?.id || '';
            }});

            const copySource = {{
                id:'copy-source',
                type:'smart-group',
                items:['copy-member'],
                images:[{{url:'copy-direct.png',groupMemberId:'copy-media'}}],
                memberOrderVersion:1,
                memberOrder:[
                    {{kind:'node',id:'copy-member'}},
                    {{kind:'media',id:'copy-media'}},
                ],
            }};
            const copyTarget = JSON.parse(JSON.stringify(copySource));
            copyTarget.id = 'copy-target';
            container.remapCopy(
                copyTarget,
                copySource,
                new Map([['copy-member','copy-member-clone']])
            );
            const remappedCopy = {{
                items:copyTarget.items.slice(),
                order:copyTarget.memberOrder.map(entry => [entry.kind,entry.id]),
                mediaIdChanged:
                    copyTarget.images[0].groupMemberId !== 'copy-media',
                mediaProjectionMatches:
                    copyTarget.memberOrder[1].id
                    === copyTarget.images[0].groupMemberId,
            }};

            const addGroup = {{
                id:'add-group',
                type:'smart-group',
                x:0,
                y:0,
                items:[],
                images:[],
            }};
            const addFrame = {{
                id:'add-frame',
                type:'smart-frame',
                x:0,
                y:0,
                w:300,
                h:200,
                items:[],
            }};
            const addPrompt = {{
                id:'add-prompt',
                type:'smart-prompt',
                x:40,
                y:40,
                w:120,
                h:80,
            }};
            sandbox.nodes = [addGroup,addFrame,addPrompt];
            const rejectedMixedAdd = container.add(
                'add-group',
                ['add-frame','add-prompt'],
                {{skipUndo:true}}
            );
            const acceptedAdd = container.add(
                'add-group',
                ['add-prompt'],
                {{skipUndo:true}}
            );
            const ownerAfterAdd = container.groupFor('add-prompt')?.id || '';
            const secondGroup = {{
                id:'second-group',
                type:'smart-group',
                x:300,
                y:0,
                items:[],
                images:[],
            }};
            sandbox.nodes.push(secondGroup);
            const transferredAdd = container.add(
                'second-group',
                ['add-prompt'],
                {{skipUndo:true}}
            );
            const ownerAfterTransfer = container.groupFor('add-prompt')?.id || '';
            const releasedAdd = container.release(
                ['add-prompt'],
                'second-group',
                {{
                    skipUndo:true,
                    select:false,
                    render:false,
                    save:false,
                    message:false,
                }}
            );

            const frame = {{
                id:'frame',
                type:'smart-frame',
                x:0,
                y:0,
                w:500,
                h:400,
                items:[],
            }};
            const inside = {{
                id:'inside',
                type:'smart-prompt',
                x:100,
                y:100,
                w:120,
                h:80,
            }};
            const outside = {{
                id:'outside',
                type:'smart-prompt',
                x:700,
                y:100,
                w:120,
                h:80,
            }};
            sandbox.nodes = [frame,inside,outside];
            const reconciled = container.reconcileFrames();
            const frameMembers = container.frameMembers(frame)
                .map(node => node.id);
            const expanded = container.expand(['frame']);
            const cascaded = container.remove(['frame']);
            const cascadeRemoved = lastRemoved.slice().sort();
            const remainingAfterCascade = sandbox.nodes.map(node => node.id);

            const preservedFrame = {{...frame,items:['inside']}};
            sandbox.nodes = [preservedFrame,inside,outside];
            const preserved = container.remove(
                ['frame'],
                {{preserveFrameContents:true}}
            );
            const preserveRemoved = lastRemoved.slice();
            const remainingAfterPreserve = sandbox.nodes.map(node => node.id);

            const portraitPrompt = {{
                id:'portrait-prompt',
                type:'smart-prompt',
                x:0,
                y:0,
                w:120,
                h:80,
            }};
            const portraitGroup = {{
                id:'portrait-group',
                type:'smart-group',
                x:0,
                y:0,
                images:Array.from({{length:7}}, (_,index) => ({{
                    url:`portrait-${{index}}.png`,
                    natural_w:100,
                    natural_h:200,
                }})),
                items:['portrait-prompt'],
            }};
            sandbox.nodes = [portraitGroup,portraitPrompt];
            const portraitLayout = container.thumbLayout(portraitGroup);
            const portraitArranged = container.arrange(
                portraitGroup,
                {{skipUndo:true}}
            );
            const portraitPromptPresentation =
                container.presentation(portraitPrompt);
            const imageOnlyLayouts = [6,7].map(count => {{
                const group = {{
                    id:`image-only-${{count}}`,
                    type:'smart-group',
                    x:0,
                    y:0,
                    images:Array.from({{length:count}}, (_,index) => ({{
                        url:`image-only-${{count}}-${{index}}.png`,
                        natural_w:100,
                        natural_h:200,
                    }})),
                    items:[],
                }};
                sandbox.nodes = [group];
                const layout = container.thumbLayout(group);
                return {{
                    count,
                    cols:layout.cols,
                    rows:layout.rows,
                    visibleRows:layout.visibleRows,
                    gridHeight:layout.gridHeight,
                    height:layout.height,
                }};
            }});

            const textMember = {{
                id:'text-member',
                type:'smart-text',
                x:20,
                y:20,
                w:180,
                h:90,
            }};
            const brushMember = {{
                id:'brush-member',
                type:'smart-brush',
                x:220,
                y:20,
                w:180,
                h:90,
            }};
            const annotationGroup = {{
                id:'annotation-group',
                type:'smart-group',
                x:0,
                y:0,
                images:[{{url:'image.png',natural_w:100,natural_h:100}}],
                items:['text-member','brush-member'],
            }};
            sandbox.nodes = [annotationGroup,textMember,brushMember];
            const annotationMembers = container.compactMembers(annotationGroup)
                .map(node => node.id);
            const annotationsArranged = container.arrange(
                annotationGroup,
                {{skipUndo:true}}
            );

            process.stdout.write(JSON.stringify({{
                methods:Object.keys(container).sort(),
                grouped,
                released,
                directRelease,
                mixedRefs,
                mixedReleaseOrder,
                remappedCopy,
                rejectedMixedAdd,
                acceptedAdd,
                ownerAfterAdd,
                transferredAdd,
                ownerAfterTransfer,
                releasedAdd,
                addGroupItems:addGroup.items.slice(),
                reconciled,
                frameMembers,
                expanded:expanded.slice().sort(),
                cascaded,
                cascadeRemoved,
                remainingAfterCascade,
                preserved,
                preserveRemoved,
                remainingAfterPreserve,
                portrait:{{
                    arranged:portraitArranged,
                    cols:portraitLayout.cols,
                    rows:portraitLayout.rows,
                    gridHeight:portraitLayout.gridHeight,
                    height:portraitLayout.height,
                    rowOffsets:portraitLayout.rowOffsets,
                    promptY:portraitPrompt.y,
                    promptW:portraitPrompt.w,
                    promptH:portraitPrompt.h,
                    promptPresentation:portraitPromptPresentation,
                }},
                imageOnlyLayouts,
                annotations:{{
                    arranged:annotationsArranged,
                    memberIds:annotationMembers,
                    textCompact:container.isCompactMember(textMember),
                    brushCompact:container.isCompactMember(brushMember),
                    textSize:[textMember.w,textMember.h],
                    brushSize:[brushMember.w,brushMember.h],
                    textPresentation:container.presentation(textMember),
                    brushPresentation:container.presentation(brushMember),
                }},
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
            [
                "add",
                "addMedia",
                "arrange",
                "compactMembers",
                "descendantIds",
                "dragTarget",
                "expand",
                "frameFor",
                "frameMembers",
                "group",
                "groupFor",
                "groupMembers",
                "imageRefs",
                "isCompactMember",
                "isFrame",
                "isGroup",
                "isImageMember",
                "layout",
                "presentation",
                "prune",
                "reconcileFrames",
                "release",
                "remapCopy",
                "remove",
                "reorderMedia",
                "takeMedia",
                "thumbLayout",
                "ungroup",
            ],
        )
        self.assertEqual(payload["grouped"]["type"], "smart-group")
        self.assertEqual(payload["grouped"]["memberIds"], ["prompt", "image"])
        self.assertEqual(payload["grouped"]["imageUrls"], ["source.png"])
        self.assertFalse(payload["grouped"]["sourceRemoved"])
        self.assertEqual(
            payload["grouped"]["connection"],
            {"from": "image", "to": "prompt", "kind": "input"},
        )
        self.assertEqual(payload["grouped"]["promptInputs"], ["image"])
        self.assertTrue(payload["released"]["ungrouped"])
        self.assertTrue(payload["released"]["groupRemoved"])
        self.assertTrue(payload["released"]["memberPreserved"])
        self.assertEqual(payload["released"]["restoredImageUrl"], "source.png")
        self.assertEqual(payload["released"]["restoredImageId"], "image")
        self.assertEqual(
            payload["released"]["restoredImageGeometry"],
            [220, 60, 100, 80],
        )
        self.assertEqual(
            payload["released"]["connection"],
            {"from": "image", "to": "prompt", "kind": "input"},
        )
        self.assertIn("prompt", payload["released"]["selectedIds"])
        self.assertTrue(payload["directRelease"]["idChanged"])
        self.assertEqual(payload["directRelease"]["geometry"], [20, 332, 96, 96])
        self.assertEqual(payload["directRelease"]["memberId"], "")
        self.assertEqual(
            payload["mixedRefs"],
            [["node-image.png", 0], ["direct-a.png", 1], ["direct-b.png", 3]],
        )
        self.assertEqual(
            payload["mixedReleaseOrder"],
            ["node-image.png", "direct-a.png", "mixed-prompt", "direct-b.png"],
        )
        self.assertEqual(payload["remappedCopy"]["items"], ["copy-member-clone"])
        self.assertEqual(payload["remappedCopy"]["order"][0], ["node", "copy-member-clone"])
        self.assertTrue(payload["remappedCopy"]["mediaIdChanged"])
        self.assertTrue(payload["remappedCopy"]["mediaProjectionMatches"])
        self.assertFalse(payload["rejectedMixedAdd"])
        self.assertTrue(payload["acceptedAdd"])
        self.assertEqual(payload["ownerAfterAdd"], "add-group")
        self.assertTrue(payload["transferredAdd"])
        self.assertEqual(payload["ownerAfterTransfer"], "second-group")
        self.assertTrue(payload["releasedAdd"])
        self.assertEqual(payload["addGroupItems"], [])
        self.assertTrue(payload["reconciled"])
        self.assertEqual(payload["frameMembers"], ["inside"])
        self.assertEqual(payload["expanded"], ["frame", "inside"])
        self.assertTrue(payload["cascaded"])
        self.assertEqual(payload["cascadeRemoved"], ["frame", "inside"])
        self.assertEqual(payload["remainingAfterCascade"], ["outside"])
        self.assertTrue(payload["preserved"])
        self.assertEqual(payload["preserveRemoved"], ["frame"])
        self.assertEqual(
            payload["remainingAfterPreserve"],
            ["inside", "outside"],
        )
        self.assertTrue(payload["portrait"]["arranged"])
        self.assertEqual(payload["portrait"]["cols"], 3)
        self.assertEqual(payload["portrait"]["rows"], 3)
        self.assertGreater(payload["portrait"]["gridHeight"], 600)
        self.assertEqual(
            payload["portrait"]["height"],
            payload["portrait"]["gridHeight"] + 60,
        )
        self.assertEqual(payload["portrait"]["promptY"], 0)
        self.assertEqual(payload["portrait"]["promptW"], 120)
        self.assertEqual(payload["portrait"]["promptH"], 80)
        self.assertGreater(
            payload["portrait"]["promptPresentation"]["y"],
            payload["portrait"]["promptY"],
        )
        self.assertEqual(
            payload["portrait"]["promptPresentation"]["width"],
            payload["portrait"]["promptPresentation"]["height"],
        )
        self.assertEqual(
            [layout["rows"] for layout in payload["imageOnlyLayouts"]],
            [2, 3],
        )
        for layout in payload["imageOnlyLayouts"]:
            self.assertEqual(layout["visibleRows"], layout["rows"])
            self.assertEqual(
                layout["height"],
                layout["gridHeight"] + 60,
            )
        self.assertTrue(payload["annotations"]["arranged"])
        self.assertEqual(
            payload["annotations"]["memberIds"],
            ["text-member", "brush-member"],
        )
        self.assertTrue(payload["annotations"]["textCompact"])
        self.assertTrue(payload["annotations"]["brushCompact"])
        self.assertEqual(payload["annotations"]["textSize"], [180, 90])
        self.assertEqual(payload["annotations"]["brushSize"], [180, 90])
        self.assertEqual(
            payload["annotations"]["textPresentation"]["width"],
            payload["annotations"]["brushPresentation"]["width"],
        )
        self.assertGreaterEqual(payload["renders"], 2)
        self.assertGreaterEqual(payload["saves"], 2)


if __name__ == "__main__":
    unittest.main()
