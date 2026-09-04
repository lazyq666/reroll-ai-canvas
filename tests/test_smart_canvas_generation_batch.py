import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PENDING_MODULE = ROOT / "static/js/smart-canvas/generation-pending.js"
OUTPUT_MODULE = ROOT / "static/js/smart-canvas/generation-output.js"
PROVIDER_MODULE = ROOT / "static/js/smart-canvas/generation-provider.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
GEOMETRY_MODULE = ROOT / "static/js/smart-canvas/node-geometry.js"
PLACEMENT_MODULE = ROOT / "static/js/smart-canvas/node-placement.js"


class SmartCanvasGenerationBatchTests(unittest.TestCase):
    def run_node(self, script: str):
        result = subprocess.run(
            ["node", "-e", textwrap.dedent(script)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_four_slots_default_horizontal_collision_free_and_complete_in_slot_order(self):
        payload = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            const geometrySource = fs.readFileSync({json.dumps(str(GEOMETRY_MODULE))}, 'utf8');
            const placementSource = fs.readFileSync({json.dumps(str(PLACEMENT_MODULE))}, 'utf8');
            let nextId = 0;
            const source = {{id:'source',type:'smart-image',x:0,y:500,w:200,h:120,images:[]}};
            const obstacle = {{id:'obstacle',type:'smart-image',x:280,y:312,w:160,h:496,images:[]}};
            const sandbox = {{SmartCanvasModules:{{}},
                nodes:[source,obstacle],canvas:{{connections:[]}},
                selectedId:'source',selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,MEDIA_GROUP_DEFAULT_SCALE:.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:.8,
                uid:prefix => `${{prefix}}-${{++nextId}}`,nowMs:()=>100,
                nodeRect:node => ({{
                    x:Number(node?.x||0),y:Number(node?.y||0),
                    width:Number(node?.w||160),height:Number(node?.h||100),
                }}),
                pendingBoxSize:()=>({{w:160,h:100}}),
                isSmartImageNode:node=>node?.type==='smart-image',
                isHistoryGroupNode:()=>false,
                attachRunMeta:(node,meta)=>{{node.runSettings=meta?.settings||{{count:4}};}},
                stripRunInputMeta:meta=>meta,
                stripImageGenerationMeta:item=>item,
                resultMediaUrls:value => Array.isArray(value)?value:[value],
                copyMediaSizeFields:(_source,target)=>({{...target}}),
                liveSmartNode:node=>sandbox.nodes.find(item=>item.id===node?.id)||node,
                markSmartNodeComplete:node=>{{node.pending=0;node.running=false;return node;}},
                downstreamNodesForId:()=>[],mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,tr:key=>key,
            }};
            sandbox.window=sandbox;sandbox.globalThis=sandbox;
            vm.createContext(sandbox);
            vm.runInContext(geometrySource,sandbox);
            vm.runInContext(placementSource,sandbox);
            sandbox.SmartCanvasModules.canvasMutation={{
                create({{data,options={{}}}}){{
                    if(options.placement){{
                        const plan=sandbox.SmartCanvasModules.nodePlacement.plan({{
                            snapshot:{{nodes:sandbox.nodes}},drafts:[data.node],intent:options.placement
                        }});
                        Object.assign(data.node,plan.placements[0]);
                    }}
                    sandbox.nodes.push(data.node);return data.node;
                }},
                createBatch({{drafts,intent,connections}}){{
                    const plan=sandbox.SmartCanvasModules.nodePlacement.plan({{
                        snapshot:{{nodes:sandbox.nodes}},drafts,intent
                    }});
                    const byId=new Map(plan.placements.map(item=>[item.id,item]));
                    drafts.forEach(node=>Object.assign(node,byId.get(node.id)));
                    sandbox.nodes.push(...drafts);
                    connections.forEach(connection=>this.connect(connection));
                    return drafts;
                }},
                connect({{fromId,toId,kind='flow',input=false}}){{
                    sandbox.canvas.connections.push({{from:fromId,to:toId,kind:input?'input':kind}});
                    return true;
                }},
            }};
            vm.runInContext(pendingSource,sandbox);
            vm.runInContext(outputSource,sandbox);
            const output = sandbox.window.SmartCanvasModules.generationOutput;
            const slots = output.createPendingBatch({{
                sourceNode:source,expectedCount:4,meta:{{settings:{{count:4}}}},
            }});
            const single = output.createPending({{
                sourceNode:source,expectedCount:1,meta:{{settings:{{count:1}}}},
            }});
            slots.forEach((slot,index)=>{{
                slot.pendingTasks=[{{taskId:`task-${{index}}`,kind:'image'}}];
                slot.pending=1;
            }});
            [2,0,3,1].forEach(index=>output.apply({{
                node:slots[index],taskId:`task-${{index}}`,
                outputs:[{{url:`result-${{index}}.png`,kind:'image'}}],strategy:'task',kind:'image',
            }}));
            const removed = slots[3];
            sandbox.nodes = sandbox.nodes.filter(node=>node.id!==removed.id);
            const late = output.apply({{
                node:removed,taskId:'late-task',
                outputs:[{{url:'late.png',kind:'image'}}],strategy:'task',kind:'image',
            }});
            const slotRects = slots.map(sandbox.nodeRect);
            const overlaps = slotRects.some((left,index)=>slotRects.slice(index+1).some(right=>
                left.x < right.x+right.width && left.x+left.width > right.x
                && left.y < right.y+right.height && left.y+left.height > right.y
            ));
            const batchBounds={{
                x:slots[0].x,y:slots[0].y,width:160,
                height:slots.at(-1).y+100-slots[0].y,
            }};
            const batchObstacleOverlap=batchBounds.x < obstacle.x+obstacle.w
                && batchBounds.x+batchBounds.width > obstacle.x
                && batchBounds.y < obstacle.y+obstacle.h
                && batchBounds.y+batchBounds.height > obstacle.y;
            process.stdout.write(JSON.stringify({{
                slotIds:slots.map(slot=>slot.id),
                xs:slots.map(slot=>slot.x),ys:slots.map(slot=>slot.y),
                batchIds:slots.map(slot=>slot.generationBatchId),
                batchLayouts:slots.map(slot=>slot.generationBatchLayout),
                batchSources:slots.map(slot=>slot.generationBatchSourceNodeId),
                indexes:slots.map(slot=>slot.generationSlotIndex),
                imageCounts:slots.map(slot=>slot.images.length),
                urls:slots.map(slot=>slot.images[0]?.url||''),
                connectionTargets:sandbox.canvas.connections.slice(0,4).map(item=>item.to),
                overlaps,batchObstacleOverlap,
                single:{{pending:single.pending,batchId:single.generationBatchId||'',images:single.images.length}},
                lateCount:late.length,lateRecreated:sandbox.nodes.some(node=>node.id===removed.id),
            }}));
            """
        )
        self.assertEqual(payload["xs"], sorted(payload["xs"]))
        self.assertEqual(len(set(payload["xs"])), 4)
        self.assertEqual(len(set(payload["ys"])), 1)
        self.assertEqual(len(set(payload["batchIds"])), 1)
        self.assertEqual(set(payload["batchLayouts"]), {"horizontal"})
        self.assertEqual(set(payload["batchSources"]), {"source"})
        self.assertEqual(payload["indexes"], [0, 1, 2, 3])
        self.assertEqual(payload["imageCounts"], [1, 1, 1, 1])
        self.assertEqual(
            payload["urls"],
            ["result-0.png", "result-1.png", "result-2.png", "result-3.png"],
        )
        self.assertEqual(payload["connectionTargets"], payload["slotIds"])
        self.assertFalse(payload["overlaps"])
        self.assertFalse(payload["batchObstacleOverlap"])
        self.assertEqual(payload["single"], {"pending": 1, "batchId": "", "images": 0})
        self.assertEqual(payload["lateCount"], 0)
        self.assertFalse(payload["lateRecreated"])

    def test_pending_retry_refresh_and_legacy_multi_image_node_remain_compatible(self):
        payload = self.run_node(
            f"""
            const fs=require('fs');const vm=require('vm');
            const pendingSource=fs.readFileSync({json.dumps(str(PENDING_MODULE))},'utf8');
            const outputSource=fs.readFileSync({json.dumps(str(OUTPUT_MODULE))},'utf8');
            const legacy={{id:'legacy',type:'smart-image',images:[
                {{url:'old-a.png',kind:'image'}},{{url:'old-b.png',kind:'image'}},
            ],generationOutputNode:true,activeOutputId:''}};
            const slot={{id:'slot',type:'smart-image',images:[],pending:1,
                generationBatchId:'batch-1',generationSlotIndex:1,generationSlotCount:4,
                pendingTasks:[{{taskId:'task-1',kind:'image'}}]}};
            const sandbox={{window:{{SmartCanvasModules:{{canvasMutation:{{create:()=>null,connect:()=>true}}}}}},
                nodes:[legacy,slot],canvas:{{connections:[]}},selectedId:'',selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:.9,MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:.8,
                nowMs:()=>500,nodeRect:()=>({{x:0,y:0,width:200,height:120}}),pendingBoxSize:()=>({{w:160,h:100}}),
                isSmartImageNode:node=>node?.type==='smart-image',isHistoryGroupNode:()=>false,
                attachRunMeta:()=>null,stripRunInputMeta:value=>value,stripImageGenerationMeta:item=>item,
                resultMediaUrls:value=>Array.isArray(value)?value:[value],copyMediaSizeFields:(_a,b)=>({{...b}}),
                liveSmartNode:value=>value,markSmartNodeComplete:value=>{{value.pending=0;return value;}},
                downstreamNodesForId:()=>[],mediaNodeDefaultScale:()=>1,clearSourceBusyStateIfDownstreamDone:()=>false,tr:key=>key}};
            vm.createContext(sandbox);vm.runInContext(pendingSource,sandbox);vm.runInContext(outputSource,sandbox);
            const pending=sandbox.window.SmartCanvasModules.generationPending;
            const output=sandbox.window.SmartCanvasModules.generationOutput;
            const recoverable=pending.transition(slot,{{type:'task-recoverable',taskId:'task-1',recoverTaskId:'remote-1',error:'retry'}});
            const refreshed=JSON.parse(JSON.stringify({{...slot,...recoverable}}));
            sandbox.nodes[1]=refreshed;
            output.apply({{node:refreshed,taskId:'task-1',outputs:[{{url:'retried.png',kind:'image'}}],strategy:'task',kind:'image'}});
            output.apply({{node:legacy,outputs:[{{url:'old-c.png',kind:'image'}}],strategy:'append',kind:'image',skipShift:true}});
            process.stdout.write(JSON.stringify({{
                retryTask:recoverable.pendingTasks[0],
                refreshedBatch:[refreshed.generationBatchId,refreshed.generationSlotIndex,refreshed.generationSlotCount],
                refreshedImages:refreshed.images.map(item=>item.url),
                legacyImages:legacy.images.map(item=>item.url),
            }}));
            """
        )
        self.assertTrue(payload["retryTask"]["failed"])
        self.assertEqual(payload["retryTask"]["recoverTaskId"], "remote-1")
        self.assertEqual(payload["refreshedBatch"], ["batch-1", 1, 4])
        self.assertEqual(payload["refreshedImages"], ["retried.png"])
        self.assertEqual(
            payload["legacyImages"],
            ["old-a.png", "old-b.png", "old-c.png"],
        )

    def test_reference_generation_reuses_seed_then_branches_completed_results(self):
        payload = self.run_node(
            f"""
            const fs=require('fs');const vm=require('vm');
            const pendingSource=fs.readFileSync({json.dumps(str(PENDING_MODULE))},'utf8');
            const outputSource=fs.readFileSync({json.dumps(str(OUTPUT_MODULE))},'utf8');
            const runSource=fs.readFileSync({json.dumps(str(RUN_MODULE))},'utf8');
            let nextId=0;
            const upload={{id:'upload',type:'smart-image',x:0,y:0,w:160,h:100,
                images:[{{url:'upload.png',kind:'image',outputId:'upload-output'}}]}};
            const generator={{id:'generator',type:'smart-image',x:360,y:0,w:160,h:100,
                images:[],referenceGenerationKind:'image',runSettings:{{count:3}}}};
            const sandbox={{nodes:[upload,generator],canvas:{{connections:[
                    {{from:'upload',to:'generator',kind:'input',sourceOutputId:'upload-output'}},
                ]}},canvasId:'canvas-1',selectedId:'generator',selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},activeComposerSubject:null,
                lastComposerNodeId:'',smartClientId:'client-1',runBtn:null,
                MEDIA_NODE_DEFAULT_SCALE:1,MEDIA_GROUP_DEFAULT_SCALE:.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:.8,
                uid:prefix=>`${{prefix}}-${{++nextId}}`,nowMs:()=>200,
                referenceGenerationKind:node=>node?.referenceGenerationKind||'',
                nodeRect:node=>({{x:node?.x||0,y:node?.y||0,width:node?.w||160,height:node?.h||100}}),
                pendingBoxSize:()=>({{w:160,h:100}}),
                isSmartImageNode:node=>node?.type==='smart-image',
                isHistoryGroupNode:()=>false,isSmartRunnableNode:()=>true,
                smartNodeInFlight:()=>false,smartRunNeedsPrompt:()=>true,
                snapshotRunMeta:(prompt,sourceNodeId,displayPrompt,refs,settings)=>({{
                    prompt,displayPrompt,promptText:displayPrompt,promptRefs:refs,
                    inputRefs:refs,sourceNodeId,settings,createdAt:100,
                }}),
                smartRunSnapshot:()=>({{kind:'image'}}),stripRunInputMeta:meta=>({{
                    ...meta,promptRefs:[],sourceNodeId:'',
                }}),
                attachRunMeta:(node,meta)=>{{
                    node.runPrompt=meta?.displayPrompt||meta?.prompt||'';
                    node.runInputRefs=(meta?.inputRefs||[]).map(ref=>({{...ref}}));
                    node.runSettings={{...(meta?.settings||{{}})}};
                    if(meta?.sourceNodeId) node.sourceNodeId=meta.sourceNodeId;
                    else delete node.sourceNodeId;
                }},
                stripImageGenerationMeta:item=>item,
                resultMediaUrls:value=>Array.isArray(value)?value:[value],
                copyMediaSizeFields:(_source,target)=>({{...target}}),
                liveSmartNode:node=>sandbox.nodes.find(item=>item.id===node?.id)||node,
                markSmartNodeComplete:node=>{{node.pending=0;node.running=false;return node;}},
                downstreamNodesForId:()=>[],mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,
                imagesForNode:node=>node?.images||[],isApiLikeEngine:()=>true,
                resultKindForSettings:()=> 'image',render:()=>{{}},toast:()=>{{}},
                tr:key=>key,trf:key=>key,escapeHtml:value=>String(value),
                addSmartGenerationLog:()=>{{}},clearPromptInput:()=>{{}},
                syncRunButtonState:()=>{{}},smartNodeHasRegenerationSnapshot:()=>false,
            }};
            sandbox.window=sandbox;sandbox.globalThis=sandbox;
            sandbox.SmartCanvasModules={{canvasMutation:{{
                create({{data}}){{sandbox.nodes.push(data.node);return data.node;}},
                createBatch({{drafts,connections,options={{}}}}){{
                    const existingIds=new Set(options.existingNodeIds||[]);
                    drafts.forEach((node,index)=>{{
                        node.x=360;node.y=index*148;
                        if(!existingIds.has(node.id)) sandbox.nodes.push(node);
                    }});
                    connections.forEach(connection=>this.connect(connection));
                    return drafts;
                }},
                connect(connection){{
                    const from=connection.fromId||connection.from;
                    const to=connection.toId||connection.to;
                    const kind=connection.kind||(connection.input?'input':'flow');
                    if(sandbox.canvas.connections.some(item=>
                        item.from===from&&item.to===to&&(item.kind||'flow')===kind
                    )) return false;
                    const stored={{...connection,from,to,kind}};
                    delete stored.fromId;delete stored.toId;delete stored.input;
                    delete stored.exact;
                    sandbox.canvas.connections.push(stored);
                    if(kind==='input'){{
                        const target=sandbox.nodes.find(node=>node.id===to);
                        target.inputNodeIds=[...new Set([...(target.inputNodeIds||[]),from])];
                    }}
                    return true;
                }},
                remove({{nodeIds}}){{
                    sandbox.nodes=sandbox.nodes.filter(node=>!nodeIds.includes(node.id));
                    sandbox.canvas.connections=sandbox.canvas.connections.filter(connection=>
                        !nodeIds.includes(connection.from)&&!nodeIds.includes(connection.to));
                    return true;
                }},
            }}}};
            vm.createContext(sandbox);vm.runInContext(pendingSource,sandbox);
            vm.runInContext(outputSource,sandbox);
            Object.assign(sandbox.SmartCanvasModules,{{
                generationSettings:{{
                    forRun:()=>({{settings:{{engine:'api',apiKind:'image',count:3}},
                        outputKind:'image',expectedCount:3,concurrent:false}}),
                    remember:()=>{{}},snapshot:value=>({{...value}}),
                }},
                promptAuthoring:{{resolve:()=>({{prompt:'draw',displayPrompt:'draw',refs:[{{
                    url:'upload.png',kind:'image',nodeId:'upload',outputId:'upload-output',
                }}]}})}},
                generationProvider:{{submit:async()=>({{state:'completed',kind:'image',outputs:[
                    {{url:'one.png',kind:'image'}},{{url:'two.png',kind:'image'}},
                    {{url:'three.png',kind:'image'}},
                ]}})}},
                canvasPersistence:{{online:()=>true,editable:()=>true,save:async()=>{{}},
                    synced:async()=>true,schedule:()=>{{}}}},
                smartContainer:{{isGroup:()=>false,reconcileFrames:()=>{{}}}},
                viewportSelection:{{selection:{{node:()=>generator}}}},
                generationFailureFeedback:{{classify:()=>({{}}),actionName:()=>'',
                    aggregate:()=>({{title:'',message:''}})}},
            }});
            vm.runInContext(runSource,sandbox);
            (async()=>{{
                await sandbox.SmartCanvasModules.generationRun.run({{nodeId:'generator'}});
                const resultNodes=sandbox.nodes.filter(node=>node.id!=='upload');
                const success={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    resultIds:resultNodes.map(node=>node.id),
                    resultUrls:resultNodes.map(node=>node.images?.[0]?.url||''),
                    slotIndexes:resultNodes.map(node=>node.generationSlotIndex),
                    referenceKinds:resultNodes.map(node=>node.referenceGenerationKind||''),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,kind:connection.kind,
                        sourceOutputId:connection.sourceOutputId||'',
                    }})),
                }};
                const failedGenerator={{
                    id:'generator',type:'smart-image',x:360,y:24,w:160,h:100,
                    title:'Image generation',images:[],referenceGenerationKind:'image',
                    runSettings:{{count:3}}
                }};
                sandbox.nodes=[upload,failedGenerator];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'generator',kind:'input',sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>false;
                await sandbox.SmartCanvasModules.generationRun.run({{nodeId:'generator'}});
                const rollback={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    generator:{{
                        x:failedGenerator.x,y:failedGenerator.y,title:failedGenerator.title,
                        referenceGenerationKind:failedGenerator.referenceGenerationKind||'',
                        generationBatchId:failedGenerator.generationBatchId||'',
                        generationOutputNode:Boolean(failedGenerator.generationOutputNode),
                        queued:Boolean(failedGenerator.queued),
                    }},
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,kind:connection.kind,
                        sourceOutputId:connection.sourceOutputId||'',
                    }})),
                }};
                const resultA={{
                    id:'result-a',type:'smart-image',x:360,y:0,w:160,h:100,
                    title:'Image',images:[{{
                        url:'old-a.png',kind:'image',outputId:'result-a-output'
                    }}],generationOutputNode:true,referenceGenerationKind:'image',
                    runSettings:{{count:1}}
                }};
                sandbox.nodes=[upload,resultA];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'result-a',kind:'input',sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>true;
                sandbox.SmartCanvasModules.generationSettings.forRun=()=>({{
                    settings:{{engine:'api',apiKind:'image',count:1}},
                    outputKind:'image',expectedCount:1,concurrent:false
                }});
                let resultBranchPendingState=null;
                sandbox.SmartCanvasModules.generationProvider.submit=async()=>{{
                    resultBranchPendingState={{
                        resultAPending:Boolean(resultA.pending),
                        resultARunning:Boolean(resultA.running),
                        pendingNodeIds:sandbox.nodes.filter(node=>node.pending).map(node=>node.id),
                    }};
                    return {{
                        state:'completed',kind:'image',
                        outputs:[{{url:'new-b.png',kind:'image'}}]
                    }};
                }};
                await sandbox.SmartCanvasModules.generationRun.run({{nodeId:'result-a'}});
                const resultBranch={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    pendingState:resultBranchPendingState,
                    imageUrls:sandbox.nodes.filter(node=>node.id!=='upload').map(node=>
                        (node.images||[]).map(image=>image.url)
                    ),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,kind:connection.kind,
                        sourceOutputId:connection.sourceOutputId||'',
                    }})),
                }};
                sandbox.nodes=[upload,resultA];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'result-a',kind:'input',sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.generationSettings.forRun=()=>({{
                    settings:{{engine:'api',apiKind:'image',count:3}},
                    outputKind:'image',expectedCount:3,concurrent:false
                }});
                sandbox.SmartCanvasModules.generationProvider.submit=async()=>({{
                    state:'completed',kind:'image',outputs:[
                        {{url:'new-b1.png',kind:'image'}},
                        {{url:'new-b2.png',kind:'image'}},
                        {{url:'new-b3.png',kind:'image'}},
                    ]
                }});
                await sandbox.SmartCanvasModules.generationRun.run({{nodeId:'result-a'}});
                const resultBatchBranch={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    imageUrls:sandbox.nodes.filter(node=>node.id!=='upload').map(node=>
                        (node.images||[]).map(image=>image.url)
                    ),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,kind:connection.kind,
                        sourceOutputId:connection.sourceOutputId||'',
                    }})),
                }};
                sandbox.nodes=[upload,resultA];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'result-a',kind:'input',sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>false;
                sandbox.SmartCanvasModules.generationSettings.forRun=()=>({{
                    settings:{{engine:'api',apiKind:'image',count:1}},
                    outputKind:'image',expectedCount:1,concurrent:false
                }});
                await sandbox.SmartCanvasModules.generationRun.run({{nodeId:'result-a'}});
                const resultBranchRollback={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    resultAImages:resultA.images.map(image=>image.url),
                    queued:Boolean(resultA.queued),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,kind:connection.kind,
                        sourceOutputId:connection.sourceOutputId||'',
                    }})),
                }};
                const failedResultA={{
                    id:'failed-result-a',type:'smart-image',x:360,y:0,w:160,h:100,
                    title:'Image',images:[{{url:'kept-a.png',kind:'image'}}],
                    generationOutputNode:true,referenceGenerationKind:'image',
                    runSettings:{{count:1}}
                }};
                sandbox.nodes=[upload,failedResultA];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'failed-result-a',kind:'input',
                    sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>true;
                sandbox.SmartCanvasModules.generationProvider.submit=async()=>{{
                    const error=new Error('provider busy');
                    error.status=503;
                    throw error;
                }};
                await sandbox.SmartCanvasModules.generationRun.run({{
                    nodeId:'failed-result-a'
                }});
                const failedBranchNode=sandbox.nodes.find(node=>
                    !['upload','failed-result-a'].includes(node.id)
                );
                const resultBranchFailure={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    resultAImages:failedResultA.images.map(image=>image.url),
                    resultAFeedback:failedResultA.generationRunFeedback||null,
                    branch:failedBranchNode?{{
                        images:(failedBranchNode.images||[]).map(image=>image.url),
                        pending:Number(failedBranchNode.pending||0),
                        running:Boolean(failedBranchNode.running),
                        feedback:failedBranchNode.generationRunFeedback||null,
                    }}:null,
                }};
                const busyResult={{
                    id:'busy-result',type:'smart-image',x:360,y:0,w:160,h:100,
                    title:'Image',images:[],
                    referenceGenerationKind:'image',pending:1,running:true,
                    runPrompt:'first prompt',runModelPrompt:'first prompt',
                    runInputRefs:[{{
                        url:'upload.png',kind:'image',nodeId:'upload',
                        outputId:'upload-output'
                    }}],
                    runSettings:{{engine:'api',apiKind:'image',count:1}}
                }};
                sandbox.nodes=[upload,busyResult];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'busy-result',kind:'input',
                    sourceOutputId:'upload-output'
                }}];
                sandbox.smartNodeInFlight=node=>Boolean(
                    node?.running || node?.pending || node?.queued
                );
                sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>true;
                sandbox.SmartCanvasModules.generationSettings.forRun=()=>({{
                    settings:{{engine:'api',apiKind:'image',count:1}},
                    outputKind:'image',expectedCount:1,concurrent:false
                }});
                sandbox.SmartCanvasModules.generationProvider.submit=async()=>({{
                    state:'completed',kind:'image',outputs:[{{
                        url:'busy-parallel.png',kind:'image'
                    }}]
                }});
                await sandbox.SmartCanvasModules.generationRun.run({{
                    nodeId:'busy-result'
                }});
                const busyParallelNode=sandbox.nodes.find(node=>
                    !['upload','busy-result'].includes(node.id)
                );
                const busyParallel={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    sourcePending:Number(busyResult.pending||0),
                    sourceRunning:Boolean(busyResult.running),
                    sourceImages:(busyResult.images||[]).map(image=>image.url),
                    createdId:busyParallelNode?.id||'',
                    createdImages:(busyParallelNode?.images||[]).map(image=>image.url),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,
                        kind:connection.kind||'flow'
                    }})),
                }};
                sandbox.nodes=[upload,busyResult];
                sandbox.canvas.connections=[{{
                    from:'upload',to:'busy-result',kind:'input',
                    sourceOutputId:'upload-output'
                }}];
                sandbox.SmartCanvasModules.canvasPersistence.online=()=>false;
                sandbox.SmartCanvasModules.canvasPersistence.editable=()=>true;
                await sandbox.SmartCanvasModules.generationRun.run({{
                    nodeId:'busy-result'
                }});
                const busyQueuedNode=sandbox.nodes.find(node=>
                    !['upload','busy-result'].includes(node.id)
                );
                const busyOfflineQueue={{
                    nodeIds:sandbox.nodes.map(node=>node.id),
                    sourceRunning:Boolean(busyResult.running),
                    sourceQueued:Boolean(busyResult.queued),
                    createdId:busyQueuedNode?.id||'',
                    createdQueued:Boolean(busyQueuedNode?.queued),
                    createdPending:Number(busyQueuedNode?.pending||0),
                    connections:sandbox.canvas.connections.map(connection=>({{
                        from:connection.from,to:connection.to,
                        kind:connection.kind||'flow'
                    }})),
                }};
                sandbox.SmartCanvasModules.canvasPersistence.online=()=>true;
                const runRegenerationScenario=async(parentType,inFlight=false)=>{{
                    const parent={{
                        id:`parent-${{parentType}}`,type:parentType,x:0,y:0,
                        w:200,h:140,images:parentType==='smart-group' ? [] : [{{
                            url:`${{parentType}}-source.png`,kind:'image'
                        }}]
                    }};
                    const source={{
                        id:`result-${{parentType}}`,type:'smart-image',x:360,y:0,
                        w:160,h:100,title:'Image',generationOutputNode:true,
                        outputKind:'image',images:[{{
                            url:`${{parentType}}-old.png`,kind:'image',
                            outputId:`${{parentType}}-old-output`
                        }}],
                        runPrompt:'same recipe',runModelPrompt:'same recipe',
                        runInputRefs:[{{
                            url:`${{parentType}}-source.png`,kind:'image',
                            nodeId:parent.id
                        }}],
                        runSettings:{{engine:'api',apiKind:'image',count:1}},
                        sourceNodeId:parent.id
                    }};
                    if(inFlight){{
                        source.pending=1;
                        source.running=true;
                    }}
                    sandbox.nodes=[parent,source];
                    sandbox.canvas.connections=[{{
                        from:parent.id,to:source.id,kind:'input'
                    }}];
                    sandbox.smartNodeHasRegenerationSnapshot=()=>true;
                    sandbox.SmartCanvasModules.canvasPersistence.synced=async()=>true;
                    sandbox.SmartCanvasModules.generationSettings.forRun=()=>({{
                        settings:{{engine:'api',apiKind:'image',count:1}},
                        outputKind:'image',expectedCount:1,concurrent:false
                    }});
                    sandbox.SmartCanvasModules.generationProvider.submit=async()=>({{
                        state:'completed',kind:'image',outputs:[{{
                            url:`${{parentType}}-new.png`,kind:'image'
                        }}]
                    }});
                    await sandbox.SmartCanvasModules.generationRun.regenerate({{
                        nodeId:source.id
                    }});
                    const created=sandbox.nodes.find(node=>
                        node.id!==parent.id && node.id!==source.id
                    );
                    return {{
                        nodeIds:sandbox.nodes.map(node=>node.id),
                        sourceImages:source.images.map(image=>image.url),
                        createdImages:(created?.images||[]).map(image=>image.url),
                        connections:sandbox.canvas.connections.map(connection=>({{
                            from:connection.from,to:connection.to,
                            kind:connection.kind||'flow'
                        }})),
                        createdId:created?.id||''
                    }};
                }};
                const regenerateFromImage=await runRegenerationScenario('smart-image');
                const regenerateFromSmartGroup=await runRegenerationScenario('smart-group');
                const regenerateWhileBusy=await runRegenerationScenario('smart-image',true);
                process.stdout.write(JSON.stringify({{
                    ...success,rollback,resultBranch,resultBatchBranch,
                    resultBranchRollback,resultBranchFailure,busyParallel,
                    busyOfflineQueue,
                    regenerateFromImage,regenerateFromSmartGroup,
                    regenerateWhileBusy
                }}));
            }})().catch(error=>{{console.error(error);process.exit(1);}});
            """
        )
        self.assertEqual(len(payload["nodeIds"]), 4)
        self.assertEqual(payload["resultIds"][0], "generator")
        self.assertEqual(payload["resultUrls"], ["one.png", "two.png", "three.png"])
        self.assertEqual(payload["slotIndexes"], [0, 1, 2])
        self.assertEqual(payload["referenceKinds"], ["image", "image", "image"])
        self.assertEqual(
            payload["connections"],
            [
                {
                    "from": "upload",
                    "to": "generator",
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
                {
                    "from": "upload",
                    "to": payload["resultIds"][1],
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
                {
                    "from": "upload",
                    "to": payload["resultIds"][2],
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
            ],
        )
        self.assertEqual(payload["rollback"]["nodeIds"], ["upload", "generator"])
        self.assertEqual(
            payload["rollback"]["generator"],
            {
                "x": 360,
                "y": 24,
                "title": "Image generation",
                "referenceGenerationKind": "image",
                "generationBatchId": "",
                "generationOutputNode": False,
                "queued": True,
            },
        )
        self.assertEqual(
            payload["rollback"]["connections"],
            [
                {
                    "from": "upload",
                    "to": "generator",
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                }
            ],
        )
        self.assertEqual(len(payload["resultBranch"]["nodeIds"]), 3)
        self.assertEqual(payload["resultBranch"]["nodeIds"][:2], ["upload", "result-a"])
        result_b_id = payload["resultBranch"]["nodeIds"][2]
        self.assertEqual(
            payload["resultBranch"]["pendingState"],
            {
                "resultAPending": False,
                "resultARunning": False,
                "pendingNodeIds": [result_b_id],
            },
        )
        self.assertEqual(
            payload["resultBranch"]["imageUrls"],
            [["old-a.png"], ["new-b.png"]],
        )
        self.assertEqual(
            payload["resultBranch"]["connections"],
            [
                {
                    "from": "upload",
                    "to": "result-a",
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
                {
                    "from": "upload",
                    "to": result_b_id,
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
            ],
        )
        self.assertEqual(len(payload["resultBatchBranch"]["nodeIds"]), 5)
        self.assertEqual(
            payload["resultBatchBranch"]["imageUrls"],
            [
                ["old-a.png"],
                ["new-b1.png"],
                ["new-b2.png"],
                ["new-b3.png"],
            ],
        )
        batch_result_ids = payload["resultBatchBranch"]["nodeIds"][2:]
        self.assertEqual(
            payload["resultBatchBranch"]["connections"],
            [
                {
                    "from": "upload",
                    "to": "result-a",
                    "kind": "input",
                    "sourceOutputId": "upload-output",
                },
                *[
                    {
                        "from": "upload",
                        "to": node_id,
                        "kind": "input",
                        "sourceOutputId": "upload-output",
                    }
                    for node_id in batch_result_ids
                ],
            ],
        )
        self.assertEqual(
            payload["resultBranchRollback"],
            {
                "nodeIds": ["upload", "result-a"],
                "resultAImages": ["old-a.png"],
                "queued": True,
                "connections": [
                    {
                        "from": "upload",
                        "to": "result-a",
                        "kind": "input",
                        "sourceOutputId": "upload-output",
                    }
                ],
            },
        )
        self.assertEqual(
            payload["resultBranchFailure"]["nodeIds"][:2],
            ["upload", "failed-result-a"],
        )
        self.assertEqual(len(payload["resultBranchFailure"]["nodeIds"]), 3)
        self.assertEqual(payload["resultBranchFailure"]["resultAImages"], ["kept-a.png"])
        self.assertIsNone(payload["resultBranchFailure"]["resultAFeedback"])
        self.assertEqual(payload["resultBranchFailure"]["branch"]["images"], [])
        self.assertEqual(payload["resultBranchFailure"]["branch"]["pending"], 0)
        self.assertFalse(payload["resultBranchFailure"]["branch"]["running"])
        self.assertEqual(
            payload["resultBranchFailure"]["branch"]["feedback"]["failedCount"],
            1,
        )
        busy_parallel = payload["busyParallel"]
        self.assertEqual(len(busy_parallel["nodeIds"]), 3)
        self.assertEqual(busy_parallel["sourcePending"], 1)
        self.assertTrue(busy_parallel["sourceRunning"])
        self.assertEqual(busy_parallel["sourceImages"], [])
        self.assertEqual(busy_parallel["createdImages"], ["busy-parallel.png"])
        self.assertEqual(
            busy_parallel["connections"],
            [
                {"from": "upload", "to": "busy-result", "kind": "input"},
                {
                    "from": "upload",
                    "to": busy_parallel["createdId"],
                    "kind": "input",
                },
            ],
        )
        busy_offline = payload["busyOfflineQueue"]
        self.assertEqual(len(busy_offline["nodeIds"]), 3)
        self.assertTrue(busy_offline["sourceRunning"])
        self.assertFalse(busy_offline["sourceQueued"])
        self.assertTrue(busy_offline["createdQueued"])
        self.assertEqual(busy_offline["createdPending"], 0)
        self.assertEqual(
            busy_offline["connections"],
            [
                {"from": "upload", "to": "busy-result", "kind": "input"},
                {
                    "from": "upload",
                    "to": busy_offline["createdId"],
                    "kind": "input",
                },
            ],
        )
        for parent_type, key in (
            ("smart-image", "regenerateFromImage"),
            ("smart-group", "regenerateFromSmartGroup"),
        ):
            with self.subTest(parent_type=parent_type):
                regeneration = payload[key]
                parent_id = f"parent-{parent_type}"
                source_id = f"result-{parent_type}"
                self.assertEqual(len(regeneration["nodeIds"]), 3)
                self.assertEqual(
                    regeneration["sourceImages"],
                    [f"{parent_type}-old.png"],
                )
                self.assertEqual(
                    regeneration["createdImages"],
                    [f"{parent_type}-new.png"],
                )
                self.assertEqual(
                    regeneration["connections"],
                    [
                        {"from": parent_id, "to": source_id, "kind": "input"},
                        {
                            "from": parent_id,
                            "to": regeneration["createdId"],
                            "kind": "input",
                        },
                    ],
                )
                self.assertFalse(
                    any(
                        connection["from"] == source_id
                        and connection["to"] == regeneration["createdId"]
                        for connection in regeneration["connections"]
                    )
                )
        self.assertEqual(len(payload["regenerateWhileBusy"]["nodeIds"]), 3)
        self.assertEqual(
            payload["regenerateWhileBusy"]["createdImages"],
            ["smart-image-new.png"],
        )

    def test_provider_submits_one_run_for_all_precreated_slots(self):
        payload = self.run_node(
            f"""
            const fs=require('fs');const vm=require('vm');
            const source=fs.readFileSync({json.dumps(str(PROVIDER_MODULE))},'utf8');
            const bodies=[];let task=0;
            const sandbox={{window:{{SmartCanvasModules:{{}}}},canvasId:'canvas-1',
                isApiLikeEngine:engine=>engine==='api',imageRefsOnly:refs=>refs,
                sizeForRun:()=> '1024x1024',SMART_REFERENCE_IMAGE_MAX:20,tr:key=>key,
                fetch:async(_url,options)=>{{bodies.push(JSON.parse(options.body));task+=1;return{{ok:true,json:async()=>({{task_id:`task-${{task}}`}}),text:async()=>''}};}}}};
            vm.createContext(sandbox);vm.runInContext(source,sandbox);
            sandbox.window.SmartCanvasModules.generationProvider.submit({{
                prompt:'four',refs:[],settings:{{engine:'api',apiKind:'image',provider_id:'p',model:'m',count:4}},
                context:{{canvasId:'canvas-1',nodeId:'slot-0',nodeIds:['slot-0','slot-1','slot-2','slot-3'],operationId:'batch-op'}},
            }}).then(result=>process.stdout.write(JSON.stringify({{bodies,tasks:result.tasks}})));
            """
        )
        self.assertEqual(
            [body["node_id"] for body in payload["bodies"]],
            ["slot-0"],
        )
        self.assertEqual(
            [body["generation_request_index"] for body in payload["bodies"]],
            [0],
        )
        self.assertEqual(
            [task["generationSlotIndex"] for task in payload["tasks"]],
            [0],
        )
        self.assertEqual(
            [task["nodeId"] for task in payload["tasks"]],
            ["slot-0"],
        )


if __name__ == "__main__":
    unittest.main()
