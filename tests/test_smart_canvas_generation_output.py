import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
RECOVERY_MODULE = ROOT / "static/js/smart-canvas/generation-recovery.js"
OUTPUT_MODULE = ROOT / "static/js/smart-canvas/generation-output.js"
PENDING_MODULE = ROOT / "static/js/smart-canvas/generation-pending.js"
MATTING_MODULE = ROOT / "static/js/smart-canvas/smart-matting.js"


class SmartCanvasGenerationOutputTests(unittest.TestCase):
    def test_output_lifecycle_is_owned_by_its_module(self):
        host = HOST.read_text(encoding="utf-8")
        run_source = RUN_MODULE.read_text(encoding="utf-8")
        recovery_source = RECOVERY_MODULE.read_text(encoding="utf-8")
        output_source = OUTPUT_MODULE.read_text(encoding="utf-8")
        matting_source = MATTING_MODULE.read_text(encoding="utf-8")

        for implementation in (
            "function generationOutputCreatePending(",
            "function generationOutputNormalize(",
            "function generationOutputEnsureNodeState(",
            "function generationOutputReplace(",
            "function generationOutputAppend(",
            "function generationOutputCompleteQueued(",
            "function generationOutputCompleteTask(",
        ):
            with self.subTest(implementation=implementation):
                self.assertIn(implementation, output_source)
                self.assertNotIn(implementation, run_source)
                self.assertNotIn(implementation, host)

        for removed_implementation in (
            "function createPendingOutputFromSource(",
            "function finalizePendingNode(",
            "function replaceOutputsToNodeWithHistory(",
            "function appendOutputsToNode(",
            "function appendLoopOutputsToNode(",
        ):
            with self.subTest(implementation=removed_implementation):
                self.assertNotIn(removed_implementation, run_source)

        self.assertIn("generationOutputModule.createPending", run_source)
        self.assertIn("generationOutputModule.normalize", run_source)
        self.assertIn("generationOutputModule.apply", run_source)
        self.assertIn("generationRecoveryOutputModule.apply", recovery_source)
        self.assertIn("smartMattingOutputModule.createPending({", matting_source)
        self.assertIn("smartMattingOutputModule.apply({", matting_source)
        self.assertNotIn("generationOutput.createPending({", host)
        self.assertNotIn("generationOutput.apply({", host)
        self.assertNotIn("recoveryAdapter:Object.freeze", run_source)

    def test_output_interface_is_idempotent_and_completes_tasks(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync(
                {json.dumps(str(PENDING_MODULE))},
                'utf8',
            );
            const outputSource = fs.readFileSync(
                {json.dumps(str(OUTPUT_MODULE))},
                'utf8',
            );
            let nextId = 0;
            const source = {{
                id:'source',
                type:'smart-image',
                x:0,
                y:0,
                images:[{{url:'source.png',kind:'image'}}],
                referenceGenerationKind:'image',
            }};
            const videoSource = {{
                id:'video-source',
                type:'smart-image',
                x:0,
                y:400,
                images:[{{url:'source.mp4',kind:'video'}}],
                referenceGenerationKind:'video',
            }};
            const target = {{
                id:'target',
                type:'smart-image',
                x:400,
                y:0,
                w:300,
                h:200,
                images:[{{url:'old.png',kind:'image'}}],
            }};
            const taskNode = {{
                id:'task-node',
                type:'smart-image',
                x:800,
                y:0,
                images:[],
                pending:1,
                pendingTasks:[{{taskId:'task-1',kind:'image'}}],
                runStartedAt:100,
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    canvasMutation:{{
                        create({{data}}){{
                            sandbox.nodes.push(data.node);
                            return data.node;
                        }},
                        connect({{fromId,toId,kind='flow',input=false}}){{
                            const connectionKind = input ? 'input' : kind;
                            if(!sandbox.canvas.connections.some(item =>
                                item.from === fromId
                                && item.to === toId
                                && item.kind === connectionKind
                            )){{
                                sandbox.canvas.connections.push({{
                                    from:fromId,
                                    to:toId,
                                    kind:connectionKind,
                                }});
                            }}
                            if(input){{
                                const targetNode = sandbox.nodes.find(
                                    item => item.id === toId
                                );
                                if(targetNode){{
                                    targetNode.inputNodeIds = Array.from(
                                        new Set([
                                            ...(targetNode.inputNodeIds || []),
                                            fromId,
                                        ])
                                    );
                                }}
                            }}
                            return true;
                        }},
                        createBatch({{drafts=[],connections=[]}}){{
                            for(const draft of drafts){{
                                if(!sandbox.nodes.some(node => node.id === draft.id)){{
                                    sandbox.nodes.push(draft);
                                }}
                            }}
                            for(const connection of connections){{
                                this.connect({{
                                    fromId:connection.fromId,
                                    toId:connection.toId,
                                    kind:connection.kind,
                                    input:connection.input,
                                }});
                            }}
                            return drafts;
                        }},
                    }},
                }}}},
                nodes:[source, videoSource, target, taskNode],
                canvas:{{connections:[]}},
                selectedId:'',
                selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,
                lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                nowMs:() => 200,
                nodeRect:node => ({{
                    x:Number(node?.x || 0),
                    y:Number(node?.y || 0),
                    width:Number(node?.w || 200),
                    height:Number(node?.h || 120),
                }}),
                generationOutputMediaDisplaySize:node => ({{
                    width:Number(node?.generationMediaW || node?.w || 200),
                    height:Number(node?.generationMediaH || node?.h || 120),
                }}),
                preserveGenerationOutputMediaDisplaySize:(node,size) => {{
                    if(!node || !size) return false;
                    node.generationMediaW = Number(size.width);
                    node.generationMediaH = Number(size.height);
                    return true;
                }},
                pendingBoxSize:() => ({{w:260,h:180}}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:node => Boolean(node?.isHistoryGroup),
                attachRunMeta:(node, meta) => {{
                    if(meta) node.appliedMeta = meta.prompt || '';
                }},
                stripRunInputMeta:meta => meta,
                stripImageGenerationMeta:item => item,
                resultMediaUrls:result => {{
                    const list = Array.isArray(result) ? result : [result];
                    return list.map(item => typeof item === 'string'
                        ? item
                        : item?.url
                            ? {{...item}}
                            : null
                    ).filter(Boolean);
                }},
                copyMediaSizeFields:(sourceItem, targetItem) => {{
                    const targetCopy = {{...targetItem}};
                    for(const key of ['natural_w','natural_h','width','height']){{
                        if(Number(sourceItem?.[key]) > 0) targetCopy[key] = Number(sourceItem[key]);
                    }}
                    return targetCopy;
                }},
                liveSmartNode:node => sandbox.nodes.find(item => item.id === node?.id) || node,
                markSmartNodeComplete:node => {{
                    node.pending = 0;
                    node.running = false;
                    node.runFinishedAt = 200;
                    return node;
                }},
                downstreamNodesForId:() => [],
                mediaNodeDefaultScale:() => 1,
                clearSourceBusyStateIfDownstreamDone:() => false,
                tr:key => key,
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            vm.runInContext(outputSource, sandbox);
            const output = sandbox.window.SmartCanvasModules.generationOutput;
            const pending = output.createPending({{
                sourceNode:source,
                expectedCount:2,
                connectSource:false,
                outputKind:'image',
            }});
            const videoPending = output.createPending({{
                sourceNode:videoSource,
                expectedCount:1,
                connectSource:false,
                outputKind:'video',
            }});
            const batchPending = output.createPendingBatch({{
                sourceNode:source,
                expectedCount:2,
                connectSource:false,
                outputKind:'image',
            }});
            const replaced = output.apply({{
                node:target,
                outputs:[
                    {{url:'new.png',kind:'image'}},
                    {{url:'new.png',kind:'image'}},
                ],
                kind:'image',
                strategy:'replace',
                skipShift:true,
            }});
            const appended = output.apply({{
                node:target,
                outputs:[
                    {{url:'new.png',kind:'image'}},
                    {{url:'third.png',kind:'image'}},
                ],
                kind:'image',
                strategy:'append',
                skipShift:true,
            }});
            const taskOutputs = output.apply({{
                node:taskNode,
                taskId:'task-1',
                outputs:[{{url:'task.png',kind:'image'}}],
                kind:'image',
                strategy:'task',
            }});
            const legacyVideoOutput = {{
                id:'legacy-video-output',
                type:'smart-image',
                generationOutputNode:true,
                outputKind:'video',
                images:[{{url:'legacy.mp4',kind:'video',generatedResult:true}}],
                runSettings:{{engine:'api',apiKind:'video'}},
            }};
            const ambiguousUpload = {{
                id:'ambiguous-upload',
                type:'smart-image',
                generationOutputNode:true,
                images:[{{url:'upload.png',kind:'image'}}],
                uploadedAttachment:true,
                runSettings:{{engine:'api',apiKind:'image'}},
            }};
            sandbox.nodes.push(legacyVideoOutput, ambiguousUpload);
            const repairedLegacyKind = output.repairReferenceKind({{
                node:legacyVideoOutput,
            }});
            const repairedAmbiguousKind = output.repairReferenceKind({{
                node:ambiguousUpload,
            }});
            const history = sandbox.nodes.find(node => node.isHistoryGroup);
            process.stdout.write(JSON.stringify({{
                methods:['createPending','normalize','apply']
                    .filter(name => typeof output[name] === 'function'),
                pending:{{
                    id:pending.id,
                    count:pending.pending,
                    referenceKind:pending.referenceGenerationKind || '',
                    connected:sandbox.canvas.connections.some(connection =>
                        connection.from === source.id
                        && connection.to === pending.id
                        && connection.kind === 'flow'
                    ),
                }},
                videoPending:{{
                    outputKind:videoPending.outputKind,
                    referenceKind:videoPending.referenceGenerationKind || '',
                }},
                batchPending:batchPending.map(node => ({{
                    outputKind:node.outputKind,
                    referenceKind:node.referenceGenerationKind || '',
                }})),
                replaced:replaced.map(item => item.url),
                appended:appended.map(item => item.url),
                target:target.images.map(item => item.url),
                targetMediaSize:{{
                    width:target.generationMediaW,
                    height:target.generationMediaH,
                }},
                history:history?.images?.map(item => item.url) || [],
                task:{{
                    outputs:taskOutputs.map(item => item.url),
                    images:taskNode.images.map(item => item.url),
                    pending:taskNode.pending,
                    taskCount:(taskNode.pendingTasks || []).length,
                    finishedAt:taskNode.runFinishedAt,
                }},
                repair:{{
                    legacyResult:repairedLegacyKind,
                    ambiguousResult:repairedAmbiguousKind,
                    legacyKind:legacyVideoOutput.referenceGenerationKind || '',
                    ambiguousKind:ambiguousUpload.referenceGenerationKind || '',
                }},
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
            ["createPending", "normalize", "apply"],
        )
        self.assertEqual(payload["pending"]["count"], 2)
        self.assertEqual(payload["pending"]["referenceKind"], "image")
        self.assertTrue(payload["pending"]["connected"])
        self.assertEqual(
            payload["videoPending"],
            {"outputKind": "video", "referenceKind": "video"},
        )
        self.assertEqual(
            payload["batchPending"],
            [
                {"outputKind": "image", "referenceKind": "image"},
                {"outputKind": "image", "referenceKind": "image"},
            ],
        )
        self.assertEqual(payload["replaced"], ["new.png"])
        self.assertEqual(payload["appended"], ["third.png"])
        self.assertEqual(
            payload["target"],
            ["old.png", "new.png", "third.png"],
        )
        self.assertEqual(
            payload["targetMediaSize"],
            {"width": 300, "height": 200},
        )
        self.assertEqual(payload["history"], [])
        self.assertEqual(payload["task"]["outputs"], ["task.png"])
        self.assertEqual(payload["task"]["images"], ["task.png"])
        self.assertEqual(payload["task"]["pending"], 0)
        self.assertEqual(payload["task"]["taskCount"], 0)
        self.assertEqual(payload["task"]["finishedAt"], 200)
        self.assertEqual(
            payload["repair"],
            {
                "legacyResult": "video",
                "ambiguousResult": "",
                "legacyKind": "video",
                "ambiguousKind": "",
            },
        )


if __name__ == "__main__":
    unittest.main()
