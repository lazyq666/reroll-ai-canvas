import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
RECOVERY_MODULE = ROOT / "static/js/smart-canvas/generation-recovery.js"
PENDING_MODULE = ROOT / "static/js/smart-canvas/generation-pending.js"
OUTPUT_MODULE = ROOT / "static/js/smart-canvas/generation-output.js"
PROVIDER_MODULE = ROOT / "static/js/smart-canvas/generation-provider.js"


class SmartCanvasGenerationRecoveryTests(unittest.TestCase):
    def test_text_tasks_use_the_recoverable_generation_run_path(self):
        host = HOST.read_text(encoding="utf-8")
        recovery = RECOVERY_MODULE.read_text(encoding="utf-8")

        self.assertIn("/api/canvas-llm-tasks", host)
        self.assertIn("generation_operation_id:outputNode.generationOperationId", host)
        self.assertIn("task.kind === 'text'", recovery)
        self.assertIn("'/api/canvas-llm-tasks/'", recovery)
        self.assertIn("currentNode.text = generatedText", recovery)
        self.assertIn("delete currentNode.textGenerationPending", recovery)
        self.assertIn("type:'task-succeeded'", recovery)

    def test_video_submission_uses_background_generation_run(self):
        provider = PROVIDER_MODULE.read_text(encoding="utf-8")
        recovery = RECOVERY_MODULE.read_text(encoding="utf-8")

        self.assertIn("post('/api/canvas-video-tasks'", provider)
        self.assertIn("taskId:result.task_id", provider)
        self.assertIn("generationProviderPending", provider)
        self.assertIn("'/api/canvas-video-tasks/'", recovery)

    def test_video_submission_falls_back_when_background_route_is_missing(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const providerSource = fs.readFileSync(
                {json.dumps(str(PROVIDER_MODULE))},
                'utf8',
            );
            const calls = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                tr:key=>key,
                smartResponseErrorMessage:async response=>await response.text(),
                fetch:async (url, options)=>{{
                    calls.push({{url,body:JSON.parse(options.body)}});
                    if(url === '/api/canvas-video-tasks') return {{
                        ok:false,
                        status:404,
                        text:async()=> 'Not Found',
                    }};
                    return {{
                        ok:true,
                        status:200,
                        json:async()=>({{
                            jimeng_pending:true,
                            submit_id:'legacy-submit',
                        }}),
                    }};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(providerSource, sandbox);
            vm.runInContext(
                "generationProviderPostVideoTask({{prompt:'compatibility-check'}})",
                sandbox,
            ).then(result=>{{
                process.stdout.write(JSON.stringify({{calls,result}}));
            }}).catch(error=>{{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            [call["url"] for call in payload["calls"]],
            ["/api/canvas-video-tasks", "/api/canvas-video"],
        )
        self.assertEqual(
            payload["calls"][0]["body"], payload["calls"][1]["body"]
        )
        self.assertTrue(payload["result"]["jimeng_pending"])
        self.assertEqual(payload["result"]["submit_id"], "legacy-submit")

    def test_video_submission_does_not_fallback_for_provider_failures(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const providerSource = fs.readFileSync(
                {json.dumps(str(PROVIDER_MODULE))},
                'utf8',
            );
            const calls = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                tr:key=>key,
                smartResponseErrorMessage:async response=>await response.text(),
                fetch:async url=>{{
                    calls.push(url);
                    return {{
                        ok:false,
                        status:429,
                        text:async()=> 'provider busy',
                    }};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(providerSource, sandbox);
            vm.runInContext(
                "generationProviderPostVideoTask({{prompt:'no-retry'}})",
                sandbox,
            ).then(()=>{{
                throw new Error('provider failure unexpectedly succeeded');
            }}).catch(error=>{{
                process.stdout.write(JSON.stringify({{calls,error:error.message}}));
            }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["calls"], ["/api/canvas-video-tasks"])
        self.assertEqual(payload["error"], "provider busy")

    def test_refresh_restores_active_video_runs_to_target_nodes(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            const matching = {{
                id:'smart-matching',type:'smart-image',images:[{{url:'old-result.mp4'}}],pending:0,running:false,
                generationOperationId:'operation-matching'
            }};
            const replacedByFailedSubmit = {{
                id:'smart-fallback',type:'smart-image',images:[],pending:0,running:false,
                generationOperationId:'operation-that-failed'
            }};
            const completed = {{
                id:'smart-completed',type:'smart-image',images:[{{url:'result.mp4'}}],
                pending:0,running:false,generationOperationId:'operation-newer'
            }};
            const persistenceEvents = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[matching,replacedByFailedSubmit,completed],
                nowMs:()=>9000,
                render:()=>persistenceEvents.push('render'),
                toast:()=>null,
                tr:key=>key,
                trf:key=>key,
                smartNodeHasDisplayResult:node=>(node.images || []).some(item=>item?.url),
                smartRecoverableImageTask:()=>null,
                setTimeout:()=>0,
                clearTimeout:()=>null,
                fetch:async()=>{{throw new Error('polling is outside this restore test');}},
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource,sandbox);
            sandbox.window.SmartCanvasModules.generationSettings={{snapshot:()=>({{}})}};
            sandbox.window.SmartCanvasModules.generationOutput={{apply:()=>[]}};
            sandbox.window.SmartCanvasModules.canvasPersistence={{
                schedule:()=>persistenceEvents.push('schedule'),
                save:async()=>true,
            }};
            vm.runInContext(recoverySource,sandbox);
            const restored = sandbox.window.SmartCanvasModules.generationRecovery.restoreActive({{
                runs:[
                    {{
                        id:'run-matching',kind:'video',status:'running',actor_id:'designer',
                        node_id:'smart-matching',generation_operation_id:'operation-matching',
                        provider_id:'jimeng',generation_request_index:0,created_at:1
                    }},
                    {{
                        id:'run-fallback',kind:'video',status:'running',actor_id:'designer',
                        node_id:'smart-fallback',generation_operation_id:'operation-before-failed-submit',
                        provider_id:'jimeng',generation_request_index:0,created_at:2
                    }},
                    {{
                        id:'run-completed',kind:'video',status:'running',actor_id:'designer',
                        node_id:'smart-completed',generation_operation_id:'operation-old',
                        provider_id:'jimeng',generation_request_index:0,created_at:3
                    }}
                ]
            }});
            process.stdout.write(JSON.stringify({{
                restored,
                matching:{{
                    operationId:matching.generationOperationId,
                    pending:matching.pending,
                    running:matching.running,
                    taskIds:(matching.pendingTasks || []).map(task=>task.taskId),
                    kinds:(matching.pendingTasks || []).map(task=>task.kind),
                }},
                fallback:{{
                    operationId:replacedByFailedSubmit.generationOperationId,
                    pending:replacedByFailedSubmit.pending,
                    taskIds:(replacedByFailedSubmit.pendingTasks || []).map(task=>task.taskId),
                }},
                completed:{{
                    operationId:completed.generationOperationId,
                    pending:completed.pending,
                    taskIds:(completed.pendingTasks || []).map(task=>task.taskId),
                }},
                persistenceEvents,
            }}));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["restored"])
        self.assertEqual(
            payload["matching"],
            {
                "operationId": "operation-matching",
                "pending": 1,
                "running": False,
                "taskIds": ["run-matching"],
                "kinds": ["video"],
            },
        )
        self.assertEqual(
            payload["fallback"],
            {
                "operationId": "operation-before-failed-submit",
                "pending": 1,
                "taskIds": ["run-fallback"],
            },
        )
        self.assertEqual(
            payload["completed"],
            {
                "operationId": "operation-newer",
                "pending": 0,
                "taskIds": [],
            },
        )
        self.assertEqual(payload["persistenceEvents"], ["render", "schedule"])

    def test_text_task_resume_writes_text_and_clears_source_busy_state(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            const source = {{id:'source',type:'smart-prompt',running:true}};
            const output = {{
                id:'output',type:'smart-prompt',text:'',running:false,pending:1,
                textGenerationOutput:true,textGenerationPending:true,
                pendingTasks:[{{
                    taskId:'text-task',kind:'text',actorId:'actor',sourceNodeId:'source'
                }}]
            }};
            const sandbox = {{
                window:{{__IC_USER:{{id:'actor'}},SmartCanvasModules:{{
                    canvasMutation:{{create:()=>null,connect:()=>true}},
                }}}},
                nodes:[source,output],canvas:{{connections:[]}},
                selectedId:'',selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null,lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                nowMs:()=>2000,
                render:()=>null,toast:()=>null,
                tr:key=>key,trf:(key)=>key,
                setTimeout:callback=>{{callback();return 0;}},
                fetch:async url=>({{
                    ok:true,
                    json:async()=>({{
                        status:'succeeded',
                        result:{{text:'Recovered answer'}},
                        created_at:1,
                        updated_at:2,
                    }})
                }}),
                markSmartNodeComplete:node=>{{
                    node.running=false;node.pending=0;
                    delete node.pendingTasks;
                    node.runFinishedAt=2000;
                    return node;
                }},
                clearSmartNodeBusyState:node=>{{node.running=false;node.pending=0;return node;}},
                smartRecoverableImageTask:()=>null,
                restoreGenerationPresentationSnapshot:()=>null,
                addSmartGenerationLog:()=>null,
                mediaKindForUrls:()=> 'image',
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource,sandbox);
            sandbox.window.SmartCanvasModules.generationSettings={{snapshot:()=>({{}})}};
            vm.runInContext(outputSource,sandbox);
            sandbox.window.SmartCanvasModules.canvasPersistence={{
                schedule:()=>null,save:async()=>true,
            }};
            vm.runInContext(recoverySource,sandbox);
            sandbox.window.SmartCanvasModules.generationRecovery.resume().then(()=>{{
                process.stdout.write(JSON.stringify({{
                    text:output.text,
                    textGenerationPending:output.textGenerationPending ?? null,
                    pendingTasks:output.pendingTasks || [],
                    outputRunning:output.running,
                    sourceRunning:source.running,
                }}));
            }}).catch(error=>{{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["text"], "Recovered answer")
        self.assertIsNone(payload["textGenerationPending"])
        self.assertEqual(payload["pendingTasks"], [])
        self.assertFalse(payload["outputRunning"])
        self.assertFalse(payload["sourceRunning"])

    def test_recovery_polling_is_owned_by_its_module(self):
        run_source = RUN_MODULE.read_text(encoding="utf-8")
        recovery_source = RECOVERY_MODULE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")

        for implementation in (
            "function generationRecoveryPollTask(",
            "function generationRecoveryStartQueuePoll(",
            "function generationRecoveryQueryQueue(",
            "function generationRecoveryQueryImageTask(",
            "function generationRecoveryResumeNode(",
            "function generationRecoverySettle(",
        ):
            with self.subTest(implementation=implementation):
                self.assertNotIn(implementation, run_source)
                self.assertIn(implementation, recovery_source)

        for endpoint in (
            "/api/jimeng/query-media",
            "/api/image-task-query",
            "/api/canvas-image-tasks/",
        ):
            with self.subTest(endpoint=endpoint):
                self.assertNotIn(endpoint, run_source)
                self.assertIn(endpoint, recovery_source)

        self.assertIn("activeGenerationRecoveryModule()?.resume", run_source)
        self.assertIn("activeGenerationRecoveryModule()?.recover", run_source)
        self.assertIn("activeGenerationRecoveryModule()?.status", run_source)
        self.assertIn("recovery.settle", run_source)
        self.assertNotIn("recoveryAdapter:Object.freeze", run_source)
        self.assertIn("generationRecoveryOutputModule.apply", recovery_source)
        self.assertNotIn("generationRecoveryRunAdapter", recovery_source)
        self.assertIn(
            "const generationRecovery = window.SmartCanvasModules?.generationRecovery",
            host,
        )

    def test_recovery_interface_reports_stable_status(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync(
                {json.dumps(str(PENDING_MODULE))},
                'utf8',
            );
            const recoverySource = fs.readFileSync(
                {json.dumps(str(RECOVERY_MODULE))},
                'utf8',
            );
            const outputSource = fs.readFileSync(
                {json.dumps(str(OUTPUT_MODULE))},
                'utf8',
            );
            const node = {{
                id:'pending-node',
                images:[],
                pending:1,
                pendingTasks:[{{
                    taskId:'local-task',
                    failed:true,
                    recoverTaskId:'remote-task',
                }}],
            }};
            const sandbox = {{
                window: {{SmartCanvasModules: {{
                    canvasMutation:{{
                        create:() => null,
                        connect:() => false,
                    }},
                }}}},
                nodes:[node],
                smartRecoverableImageTask: () => null,
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            sandbox.window.SmartCanvasModules.generationSettings = {{
                snapshot: () => ({{}}),
            }};
            vm.runInContext(outputSource, sandbox);
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                schedule: () => {{}},
                save: async () => true,
            }};
            vm.runInContext(recoverySource, sandbox);
            const recovery = sandbox.window.SmartCanvasModules.generationRecovery;
            const status = recovery.status({{nodeId:'pending-node'}});
            recovery.settle({{
                node,
                submission:{{state:'completed'}},
            }}).then(() => {{
                throw new Error('completed submission unexpectedly entered recovery');
            }}).catch(error => {{
                process.stdout.write(JSON.stringify({{
                    methods:['settle','resume','recover','status']
                        .filter(name => typeof recovery[name] === 'function'),
                    status,
                    error:error.message,
                }}));
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
            ["settle", "resume", "recover", "status"],
        )
        self.assertEqual(payload["status"]["pendingTasks"][0]["taskId"], "local-task")
        self.assertEqual(
            payload["status"]["recoverableTask"]["recoverTaskId"],
            "remote-task",
        )
        self.assertFalse(payload["status"]["queued"])
        self.assertIsNone(payload["status"]["queue"])
        self.assertIn("pending or queued", payload["error"])

    def test_queued_video_persists_recovery_anchor_before_settle_returns(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            const node = {{
                id:'issue-200-video-node',
                type:'smart-image',
                images:[],
                pending:1,
                running:true,
                generationOperationId:'issue-200-operation',
            }};
            let authoritativeNode = JSON.parse(JSON.stringify(node));
            const persistenceEvents = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                nodes:[node],
                nowMs:()=>2000,
                render:()=>null,
                toast:()=>null,
                tr:key=>key,
                trf:key=>key,
                smartRecoverableImageTask:()=>null,
                fetch:async()=>{{throw new Error('queue polling is outside this persistence test');}},
                setTimeout:()=>0,
                clearTimeout:()=>null,
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource,sandbox);
            sandbox.window.SmartCanvasModules.generationSettings={{snapshot:()=>({{}})}};
            sandbox.window.SmartCanvasModules.generationOutput={{apply:()=>[]}};
            sandbox.window.SmartCanvasModules.canvasPersistence={{
                schedule:()=>{{persistenceEvents.push('schedule');}},
                save:async()=>{{
                    persistenceEvents.push('save');
                    authoritativeNode=JSON.parse(JSON.stringify(node));
                    return true;
                }},
                synced:async()=>{{
                    persistenceEvents.push('synced');
                    return true;
                }},
            }};
            vm.runInContext(recoverySource,sandbox);
            (async()=>{{
                const result=await sandbox.window.SmartCanvasModules.generationRecovery.settle({{
                    node,
                    submission:{{
                        state:'queued',
                        kind:'video',
                        signal:{{
                            submitId:'dreamina-submit-200',
                            kind:'video',
                            actorId:'designer-200',
                            queueInfo:{{queue_idx:2,queue_length:5}},
                        }},
                    }},
                    submissionSnapshot:{{outputCount:0}},
                }});
                process.stdout.write(JSON.stringify({{
                    result,
                    persistenceEvents,
                    liveSubmitId:node.jimengPending?.submitId || '',
                    persistedSubmitId:authoritativeNode.jimengPending?.submitId || '',
                    images:authoritativeNode.images || [],
                }}));
            }})().catch(error=>{{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["result"]["state"], "queued")
        self.assertTrue(payload["result"]["deferred"])
        self.assertEqual(payload["images"], [])
        self.assertEqual(payload["liveSubmitId"], "dreamina-submit-200")
        self.assertEqual(payload["persistedSubmitId"], "dreamina-submit-200")
        self.assertEqual(
            payload["persistenceEvents"],
            ["schedule", "save", "synced"],
        )

    def test_recovery_tracks_partial_success_and_restores_all_failure(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            let nextId = 0;
            const restored = [];
            const taskResults = {{
                success:{{status:'succeeded',result:{{images:[{{url:'new.png',kind:'image'}}]}}}},
                failure:{{status:'failed',error:'simulated failure'}},
                failure2:{{status:'failed',error:'second simulated failure'}},
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{canvasMutation:{{
                    create:()=>null, connect:()=>true,
                }}}}}},
                nodes:[], canvas:{{connections:[]}},
                selectedId:'', selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null, lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                nowMs:() => 500,
                nodeRect:node => ({{x:node?.x||0,y:node?.y||0,width:200,height:120}}),
                pendingBoxSize:() => ({{w:260,h:180}}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:()=>false,
                attachRunMeta:()=>null, stripRunInputMeta:meta => meta,
                stripImageGenerationMeta:item => item,
                resultMediaUrls:value => Array.isArray(value) ? value : [value],
                copyMediaSizeFields:(source,target) => ({{...target}}),
                liveSmartNode:node => node,
                markSmartNodeComplete:node => {{node.pending=0;node.running=false;return node;}},
                downstreamNodesForId:()=>[], mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,
                smartRecoverableImageTask:()=>null,
                mediaKindForUrls:()=> 'image',
                restoreGenerationPresentationSnapshot:node => restored.push(node.id),
                addSmartGenerationLog:()=>null,
                render:()=>null, toast:()=>null,
                tr:key => key,
                setTimeout:callback => {{ callback(); return 0; }},
                fetch:async url => {{
                    const taskId = String(url).split('/').pop();
                    if(taskId === 'replaced'){{
                        const replaced = sandbox.nodes.find(item => item.id === 'replaced');
                        replaced.pendingTasks = [];
                        replaced.pending = 0;
                        return {{ok:true,json:async()=>({{status:'running'}})}};
                    }}
                    return {{ok:true,json:async()=>taskResults[taskId]}};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            vm.runInContext(outputSource, sandbox);
            sandbox.window.SmartCanvasModules.generationSettings = {{snapshot:()=>({{}})}};
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                schedule:()=>null, save:async()=>true,
            }};
            vm.runInContext(recoverySource, sandbox);
            const recovery = sandbox.window.SmartCanvasModules.generationRecovery;
            const partial = {{
                id:'partial',type:'smart-image',generationOutputNode:true,
                images:[{{url:'old.png',kind:'image',outputId:'old'}}],activeOutputId:'old',
            }};
            const failed = {{
                id:'failed',type:'smart-image',generationOutputNode:true,
                images:[{{url:'kept.png',kind:'image',outputId:'kept'}}],activeOutputId:'kept',
            }};
            const replaced = {{
                id:'replaced',type:'smart-image',generationOutputNode:true,
                images:[],
            }};
            sandbox.nodes.push(partial, failed, replaced);
            (async()=>{{
                await recovery.settle({{
                    node:partial,
                    submission:{{state:'pending',kind:'image',tasks:[
                        {{taskId:'success',kind:'image'}},
                        {{taskId:'failure',kind:'image'}},
                    ]}},
                    submissionSnapshot:{{activeOutputId:'old',outputCount:1}},
                }});
                await recovery.settle({{
                    node:failed,
                    submission:{{state:'pending',kind:'image',tasks:[
                        {{taskId:'failure2',kind:'image'}},
                    ]}},
                    submissionSnapshot:{{activeOutputId:'kept',outputCount:1}},
                }});
                const replacedResult = await recovery.settle({{
                    node:replaced,
                    submission:{{state:'pending',kind:'image',tasks:[
                        {{taskId:'replaced',kind:'image'}},
                    ]}},
                }});
                process.stdout.write(JSON.stringify({{
                    partialUrls:partial.images.map(item=>item.url),
                    partialFeedback:partial.generationRunFeedback,
                    failedUrls:failed.images.map(item=>item.url),
                    failedFeedback:failed.generationRunFeedback,
                    replacedResult,
                    restored,
                }}));
            }})().catch(error => {{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["partialUrls"], ["old.png", "new.png"])
        self.assertEqual(payload["partialFeedback"]["successfulCount"], 1)
        self.assertEqual(payload["partialFeedback"]["failedCount"], 1)
        self.assertEqual(payload["failedUrls"], ["kept.png"])
        self.assertEqual(payload["failedFeedback"]["successfulCount"], 0)
        self.assertEqual(payload["failedFeedback"]["failedCount"], 1)
        self.assertEqual(payload["replacedResult"]["state"], "pending")
        self.assertTrue(payload["replacedResult"]["deferred"])
        self.assertEqual(payload["replacedResult"]["urls"], [])
        self.assertEqual(payload["restored"], ["failed"])

    def test_concurrent_resume_reports_one_failure_for_the_same_node_run(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            const node = {{
                id:'output-node',
                type:'smart-image',
                generationOutputNode:true,
                generationOperationId:'operation-one',
                images:[],
            }};
            const logs = [];
            const toasts = [];
            const taskFetches = [];
            let markFirstFetchStarted;
            let releaseFirstFailure;
            const firstFetchStarted = new Promise(resolve => {{
                markFirstFetchStarted = resolve;
            }});
            const firstFailureGate = new Promise(resolve => {{
                releaseFirstFailure = resolve;
            }});
            const failedTask = taskId => ({{
                id:taskId,
                status:'failed',
                error:`${{taskId}} failed`,
                created_at:1,
                updated_at:2,
                diagnostics:{{
                    upstream_task_ids:[`${{taskId}}-upstream`],
                }},
            }});
            const sandbox = {{
                window:{{
                    __IC_USER:{{id:'actor'}},
                    SmartCanvasModules:{{
                        canvasMutation:{{create:()=>null,connect:()=>true}},
                    }},
                }},
                nodes:[node], canvas:{{connections:[]}},
                selectedId:'', selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null, lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                nowMs:()=>1000,
                nodeRect:()=>({{x:0,y:0,width:200,height:120}}),
                pendingBoxSize:()=>({{w:260,h:180}}),
                isSmartImageNode:value => value?.type === 'smart-image',
                isHistoryGroupNode:()=>false,
                attachRunMeta:()=>null, stripRunInputMeta:meta => meta,
                stripImageGenerationMeta:item => item,
                resultMediaUrls:value => Array.isArray(value) ? value : [value],
                copyMediaSizeFields:(source,target) => ({{...target}}),
                liveSmartNode:value => value,
                markSmartNodeComplete:value => value,
                downstreamNodesForId:()=>[], mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,
                smartRecoverableImageTask:()=>null,
                mediaKindForUrls:()=> 'image',
                restoreGenerationPresentationSnapshot:()=>false,
                addSmartGenerationLog:entry => {{
                    logs.push(entry);
                    return {{id:`log-${{logs.length}}`}};
                }},
                render:()=>null,
                toast:(message,options) => toasts.push({{message,options}}),
                tr:key => key,
                trf:key => key,
                setTimeout:callback => {{callback();return 0;}},
                fetch:async url => {{
                    const target = String(url);
                    const taskId = target.split('/').pop();
                    taskFetches.push(target);
                    if(taskId === 'child-task-one'){{
                        markFirstFetchStarted();
                        await firstFailureGate;
                    }}
                    return {{ok:true,json:async()=>failedTask(taskId)}};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            vm.runInContext(outputSource, sandbox);
            sandbox.window.SmartCanvasModules.generationSettings = {{snapshot:()=>({{}})}};
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                schedule:()=>null,
                save:async()=>true,
            }};
            vm.runInContext(recoverySource, sandbox);
            const recovery = sandbox.window.SmartCanvasModules.generationRecovery;
            const logSummary = () => logs.map(entry => ({{
                runId:entry.run?.generationRunId || '',
                taskIds:(entry.tasks || []).map(task => task.localTaskId),
            }}));
            (async()=>{{
                const settle = recovery.settle({{
                    node,
                    submission:{{state:'pending',kind:'image',tasks:[{{
                        taskId:'child-task-one',actorId:'actor',kind:'image',
                    }}]}},
                    logContext:{{
                        run:{{generationRunId:'parent-run-one'}},
                        runLogStart:900,
                    }},
                }});
                await firstFetchStarted;
                const resumeOne = recovery.resume();
                const resumeTwo = recovery.resume();
                releaseFirstFailure();
                await Promise.allSettled([settle,resumeOne,resumeTwo]);
                const firstRun = {{
                    taskFetchCount:taskFetches.length,
                    toastCount:toasts.length,
                    logs:logSummary(),
                    pendingTaskIds:(node.pendingTasks || []).map(task => task.taskId),
                }};

                node.generationOperationId = 'operation-two';
                await Promise.allSettled([recovery.settle({{
                    node,
                    submission:{{state:'pending',kind:'image',tasks:[{{
                        taskId:'child-task-two',actorId:'actor',kind:'image',
                    }}]}},
                    logContext:{{
                        run:{{generationRunId:'parent-run-two'}},
                        runLogStart:900,
                    }},
                }})]);
                process.stdout.write(JSON.stringify({{
                    firstRun,
                    finalTaskFetchCount:taskFetches.length,
                    finalToastCount:toasts.length,
                    finalLogs:logSummary(),
                }}));
            }})().catch(error => {{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["firstRun"]["taskFetchCount"], 1)
        self.assertEqual(payload["firstRun"]["toastCount"], 1)
        self.assertEqual(
            payload["firstRun"]["logs"],
            [{"runId": "parent-run-one", "taskIds": ["child-task-one"]}],
        )
        self.assertEqual(payload["firstRun"]["pendingTaskIds"], [])
        self.assertEqual(payload["finalTaskFetchCount"], 2)
        self.assertEqual(payload["finalToastCount"], 2)
        self.assertEqual(
            payload["finalLogs"],
            [
                {"runId": "parent-run-one", "taskIds": ["child-task-one"]},
                {"runId": "parent-run-two", "taskIds": ["child-task-two"]},
            ],
        )

    def test_collaborator_observes_foreign_generation_without_clearing_it(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            const recoverySource = fs.readFileSync({json.dumps(str(RECOVERY_MODULE))}, 'utf8');
            const task = {{
                taskId:'owner-a-task',
                actorId:'owner-a',
                kind:'image',
            }};
            const node = {{
                id:'shared-node',
                type:'smart-image',
                generationOutputNode:true,
                images:[],
                pending:1,
                pendingTasks:[task],
            }};
            const ownedNode = {{
                id:'owned-node',
                type:'smart-image',
                generationOutputNode:true,
                images:[],
                pending:1,
                pendingTasks:[{{
                    taskId:'owner-b-task',
                    actorId:'owner-b',
                    kind:'image',
                }}],
            }};
            const taskFetches = [];
            let schedules = 0;
            let saves = 0;
            let toasts = 0;
            const sandbox = {{
                window:{{
                    SmartCanvasModules:{{
                        canvasMutation:{{
                            create:()=>null, connect:()=>true,
                        }},
                    }},
                }},
                nodes:[node, ownedNode], canvas:{{connections:[]}},
                selectedId:'', selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null, lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                nowMs:()=>500,
                nodeRect:()=>({{x:0,y:0,width:200,height:120}}),
                pendingBoxSize:()=>({{w:260,h:180}}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:()=>false,
                attachRunMeta:()=>null, stripRunInputMeta:meta => meta,
                stripImageGenerationMeta:item => item,
                resultMediaUrls:value => Array.isArray(value) ? value : [value],
                copyMediaSizeFields:(source,target) => ({{...target}}),
                liveSmartNode:value => value,
                markSmartNodeComplete:value => value,
                downstreamNodesForId:()=>[], mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,
                smartRecoverableImageTask:()=>null,
                mediaKindForUrls:()=> 'image',
                restoreGenerationPresentationSnapshot:()=>false,
                addSmartGenerationLog:()=>null,
                render:()=>null,
                toast:()=>{{toasts += 1;}},
                tr:key => key,
                setTimeout:callback => {{callback();return 0;}},
                fetch:async url => {{
                    if(String(url) === '/api/auth/me'){{
                        return {{ok:true,json:async()=>({{user:{{id:'owner-b'}}}})}};
                    }}
                    taskFetches.push(String(url));
                    if(String(url).endsWith('/owner-b-task')){{
                        return {{
                            ok:true,
                            json:async()=>({{status:'discarded'}}),
                        }};
                    }}
                    return {{
                        ok:false,
                        status:404,
                        text:async()=> 'foreign task is owner-scoped',
                    }};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            vm.runInContext(outputSource, sandbox);
            sandbox.window.SmartCanvasModules.generationSettings = {{snapshot:()=>({{}})}};
            sandbox.window.SmartCanvasModules.canvasPersistence = {{
                schedule:()=>{{schedules += 1;}},
                save:async()=>{{saves += 1;return true;}},
            }};
            vm.runInContext(recoverySource, sandbox);
            (async()=>{{
                await sandbox.window.SmartCanvasModules.generationRecovery.resume();
                await Promise.resolve();
                process.stdout.write(JSON.stringify({{
                    taskFetches,
                    schedules,
                    saves,
                    toasts,
                    pending:node.pending,
                    taskIds:(node.pendingTasks || []).map(item=>item.taskId),
                    feedback:node.generationRunFeedback || null,
                }}));
            }})().catch(error => {{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(len(payload["taskFetches"]), 1)
        self.assertTrue(payload["taskFetches"][0].endswith("/owner-b-task"))
        self.assertEqual(payload["schedules"], 0)
        self.assertEqual(payload["saves"], 0)
        self.assertEqual(payload["toasts"], 0)
        self.assertEqual(payload["pending"], 1)
        self.assertEqual(payload["taskIds"], ["owner-a-task"])
        self.assertIsNone(payload["feedback"])


if __name__ == "__main__":
    unittest.main()
