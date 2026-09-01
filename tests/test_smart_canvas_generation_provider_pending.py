import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROVIDER_MODULE = ROOT / "static/js/smart-canvas/generation-provider.js"
IMAGE_CAPABILITIES_MODULE = ROOT / "static/js/smart-canvas/image-capabilities.js"
PROMPT_AUTHORING_MODULE = ROOT / "static/js/smart-canvas/prompt-authoring.js"
PENDING_MODULE = ROOT / "static/js/smart-canvas/generation-pending.js"
OUTPUT_MODULE = ROOT / "static/js/smart-canvas/generation-output.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"


class SmartCanvasGenerationProviderPendingTests(unittest.TestCase):
    def run_node(self, script: str):
        result = subprocess.run(
            ["node", "-e", textwrap.dedent(script)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout) if result.stdout else None

    def test_api_image_route_returns_pending_tasks(self):
        result = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROVIDER_MODULE))}, 'utf8');
            const sandbox = {{
                window: {{ SmartCanvasModules: {{}} }},
                isApiLikeEngine: engine => engine === 'api' || engine === 'volcengine',
                imageRefsOnly: refs => refs.filter(ref => ref.kind !== 'video'),
                sizeForRun: () => '1024x1024',
                SMART_REFERENCE_IMAGE_MAX: 20,
                tr: key => key,
                fetch: async () => ({{
                    ok: true,
                    json: async () => ({{
                        task_id: 'task-1',
                        actor_id: 'owner-a',
                    }}),
                    text: async () => '',
                }}),
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.window.SmartCanvasModules.generationProvider.submit({{
                prompt: 'test',
                refs: [],
                settings: {{
                    engine: 'api',
                    apiKind: 'image',
                    provider_id: 'provider',
                    model: 'model',
                    count: 1,
                }},
            }}).then(result => process.stdout.write(JSON.stringify(result)));
            """
        )
        self.assertEqual(result["state"], "pending")
        self.assertEqual(result["kind"], "image")
        self.assertEqual(result["tasks"][0]["taskId"], "task-1")
        self.assertEqual(result["tasks"][0]["actorId"], "owner-a")
        self.assertEqual(result["tasks"][0]["providerId"], "provider")

    def test_transparent_png_submission_is_guarded_by_model_capability(self):
        result = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROVIDER_MODULE))}, 'utf8');
            const payloads = [];
            let supported = true;
            const sandbox = {{
                window: {{ SmartCanvasModules: {{
                    imageCapabilities: {{
                        current: () => ({{
                            supports_transparent_png:supported,
                            aspect_ratios:['1:1'],
                            resolution_tiers:['1K'],
                        }}),
                        resolveForSubmission: () => ({{valid:true,target_aspect_ratio:'1:1'}}),
                    }},
                }} }},
                isApiLikeEngine: engine => engine === 'api',
                imageRefsOnly: refs => refs,
                sizeForRun: () => '1024x1024',
                SMART_REFERENCE_IMAGE_MAX: 20,
                tr: key => key,
                fetch: async (_url, options) => {{
                    payloads.push(JSON.parse(options.body));
                    return {{
                        ok:true,
                        json:async () => ({{task_id:`task-${{payloads.length}}`}}),
                        text:async () => '',
                    }};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const submit = sandbox.window.SmartCanvasModules.generationProvider.submit;
            const settings = {{
                engine:'api', apiKind:'image', provider_id:'apimart',
                model:'gpt-image-2-official', ratio:'square', resolution:'1k',
                transparentPng:true, count:1,
            }};
            submit({{prompt:'supported',refs:[],settings}}).then(async () => {{
                supported = false;
                await submit({{prompt:'unsupported',refs:[],settings}});
                process.stdout.write(JSON.stringify(payloads));
            }});
            """
        )
        self.assertTrue(result[0]["transparent_png"])
        self.assertFalse(result[1]["transparent_png"])

    def test_auto_aspect_submits_resolved_reference_ratio(self):
        result = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const promptSource = fs.readFileSync({json.dumps(str(PROMPT_AUTHORING_MODULE))}, 'utf8');
            const capabilitySource = fs.readFileSync({json.dumps(str(IMAGE_CAPABILITIES_MODULE))}, 'utf8');
            const providerSource = fs.readFileSync({json.dumps(str(PROVIDER_MODULE))}, 'utf8');
            let submittedPayload = null;
            const promptInput = {{childNodes:[], innerHTML:''}};
            let sourceReference = {{
                url:'reference.png',
                name:'reference',
                kind:'image',
                natural_w:1500,
                natural_h:1000,
            }};
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    smartContainer:{{isGroup:() => false}},
                }}}},
                Node:{{TEXT_NODE:3,ELEMENT_NODE:1}},
                URLSearchParams,
                nodes:[],
                promptInput,
                settings:{{engine:'api'}},
                blockedInputRefKeys:() => new Set(),
                inputRefKey:ref => `url|${{ref?.url || ''}}`,
                defaultReferenceImagesFor:() => [sourceReference],
                activeInputImagesFor:() => [],
                manualReferenceImagesFor:() => [],
                uniqueReferenceImages:items => items,
                orderReferenceImagesForNode:(_node, items) => items,
                composerTextReferenceNodesFor:() => [],
                textForNode:() => '',
                mediaKindForItem:item => item?.kind || 'image',
                rhDefaultPromptSuggestion:() => '',
                promptHtmlWithMentionTokens:text => String(text || ''),
                setPromptText:() => {{}},
                isApiLikeEngine:engine => engine === 'api',
                imageRefsOnly:refs => refs.filter(ref => ref?.kind === 'image'),
                sizeForRun:(_settings, ratio) => ratio === '16:9' ? '3840x2160' : `size-for-${{ratio}}`,
                SMART_REFERENCE_IMAGE_MAX:20,
                tr:key => key,
                fetch:async (_url, options) => {{
                    submittedPayload = JSON.parse(options.body);
                    return {{
                        ok:true,
                        json:async () => ({{task_id:'task-auto-ratio'}}),
                        text:async () => '',
                    }};
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(promptSource, sandbox);
            vm.runInContext(capabilitySource, sandbox);
            vm.runInContext(providerSource, sandbox);
            const preservedRefs = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({{
                node:{{id:'composer'}},
            }}).refs;
            sourceReference = {{
                url:'issue-192.png',
                name:'reference',
                kind:'image',
                width:405,
                height:240,
            }};
            const refs = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({{
                node:{{id:'composer'}},
            }}).refs;
            sandbox.window.SmartCanvasModules.generationProvider.submit({{
                prompt:'test',
                refs,
                settings:{{
                    engine:'api',
                    apiKind:'image',
                    provider_id:'codex',
                    model:'gpt-image-2',
                    ratio:'source',
                    customRatio:'1:1',
                    resolution:'4k',
                    count:1,
                }},
            }}).then(() => process.stdout.write(JSON.stringify({{
                preservedWidth:preservedRefs[0]?.natural_w,
                preservedHeight:preservedRefs[0]?.natural_h,
                refWidth:refs[0]?.width || 0,
                refHeight:refs[0]?.height || 0,
                payload:submittedPayload,
            }})));
            """
        )
        self.assertEqual(result["preservedWidth"], 1500)
        self.assertEqual(result["preservedHeight"], 1000)
        self.assertEqual(result["refWidth"], 405)
        self.assertEqual(result["refHeight"], 240)
        self.assertEqual(result["payload"]["target_aspect_ratio"], "16:9")
        self.assertEqual(result["payload"]["reference_aspect_ratio"], "405:240")
        self.assertEqual(result["payload"]["reference_images"][0]["natural_w"], 405)
        self.assertEqual(result["payload"]["reference_images"][0]["natural_h"], 240)
        self.assertEqual(result["payload"]["size"], "3840x2160")

    def test_unavailable_explicit_selections_fail_closed(self):
        result = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROVIDER_MODULE))}, 'utf8');
            let fetchCalls = 0;
            const sandbox = {{
                window: {{
                    SmartCanvasModules: {{
                        generationSettings: {{
                            validateImageSize: () => ({{valid:true}}),
                        }},
                    }},
                }},
                isApiLikeEngine: engine => engine === 'api' || engine === 'volcengine',
                imageRefsOnly: () => [],
                runningHubSelectedModel: () => '',
                selectedRunningHubRef: () => null,
                smartCatalogHasSelection: () => false,
                comfyWorkflows: [{{name:'available.json'}}],
                MS_GEN_MODELS: {{
                    zimage: {{
                        supportsImage:false,
                        endpoint:'/generate',
                        modelId:'zimage',
                    }},
                }},
                modelscopeImageModels: () => ['configured-model'],
                SMART_REFERENCE_IMAGE_MAX: 20,
                tr: key => key,
                fetch: async () => {{
                    fetchCalls += 1;
                    throw new Error('fetch must not run');
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const submit = sandbox.window.SmartCanvasModules.generationProvider.submit;
            const capture = async settings => {{
                try {{
                    await submit({{prompt:'test', refs:[], settings}});
                    return 'ok';
                }} catch(error) {{
                    return error.message;
                }}
            }};
            Promise.all([
                capture({{
                    engine:'comfy',
                    comfyMode:'custom',
                    comfyWorkflow:'deleted.json',
                }}),
                capture({{
                    engine:'runninghub',
                    rhConfigKey:'workflow:deleted',
                }}),
                capture({{
                    engine:'modelscope',
                    msgenModel:'deleted-mode',
                }}),
                capture({{
                    engine:'api',
                    apiKind:'image',
                    provider_id:'deleted-provider',
                    model:'deleted-model',
                }}),
                capture({{
                    engine:'api',
                    apiKind:'video',
                    videoProvider:'',
                    videoModel:'video-model',
                }}),
            ]).then(errors => process.stdout.write(JSON.stringify({{
                errors,
                fetchCalls,
            }})));
            """
        )
        self.assertEqual(
            result["errors"],
            [
                "smart.errWorkflowUnavailable",
                "smart.errRhConfigUnavailable",
                "smart.errMsModelUnavailable",
                "smart.errNoApiModel",
                "smart.errNoVideoModel",
            ],
        )
        self.assertEqual(result["fetchCalls"], 0)

    def test_pending_node_reducer_handles_success_recovery_and_queue(self):
        result = self.run_node(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const sandbox = {{ window: {{ SmartCanvasModules: {{}} }} }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const pending = sandbox.window.SmartCanvasModules.generationPending;
            if (pending.tasks(null).length !== 0) throw new Error('null Node must have no pending tasks');
            let state = pending.transition({{
                images: [],
                generationRunFeedback:{{successfulCount:0,failedCount:1}},
            }}, {{
                type: 'submitted',
                tasks: [{{taskId:'a'}}, {{taskId:'b'}}],
                expectedCount: 2,
                startedAt: 100,
                now: 100,
            }});
            state = pending.transition(state, {{
                type: 'task-succeeded',
                taskId: 'a',
                outputs: [{{url:'one.png',kind:'image'}}],
                kind: 'image',
                now: 150,
            }});
            state = pending.transition(state, {{
                type: 'task-recoverable',
                taskId: 'b',
                recoverTaskId: 'upstream-b',
                providerId: 'provider',
                error: 'retry later',
                now: 160,
            }});
            const recoverable = state.pendingTasks[0];
            state = pending.transition(state, {{
                type: 'task-succeeded',
                taskId: 'b',
                outputs: [
                    {{url:'one.png',kind:'image'}},
                    {{url:'two.png',kind:'image'}},
                ],
                kind: 'image',
                now: 200,
            }});
            const completed = {{
                pending: state.pending,
                running: state.running,
                taskCount: (state.pendingTasks || []).length,
                outputs: state.images.map(item => item.url),
                elapsed: state.runElapsedMs,
                timerHidden: state.runTimerHidden,
                staleFeedback: state.generationRunFeedback || null,
                recoverable,
            }};
            let queued = pending.transition({{images:[]}}, {{
                type:'queued',
                signal:{{
                    submitId:'queue-1',
                    actorId:'owner-a',
                    kind:'video',
                    message:'queued',
                }},
                now:300,
            }});
            const queuedActorId = queued.jimengPending.actorId;
            queued = pending.transition(queued, {{
                type:'queue-succeeded',
                now:500,
            }});
            process.stdout.write(JSON.stringify({{
                completed,
                queued: {{
                    actorId: queuedActorId,
                    hasSignal: Boolean(queued.jimengPending),
                    finishedAt: queued.runFinishedAt,
                    elapsed: queued.runElapsedMs,
                    timerHidden: queued.runTimerHidden,
                }},
            }}));
            """
        )
        self.assertTrue(result["completed"]["recoverable"]["failed"])
        self.assertEqual(result["completed"]["recoverable"]["recoverTaskId"], "upstream-b")
        self.assertEqual(result["completed"]["pending"], 0)
        self.assertFalse(result["completed"]["running"])
        self.assertEqual(result["completed"]["taskCount"], 0)
        self.assertEqual(result["completed"]["outputs"], ["one.png", "two.png"])
        self.assertEqual(result["completed"]["elapsed"], 100)
        self.assertTrue(result["completed"]["timerHidden"])
        self.assertIsNone(result["completed"]["staleFeedback"])
        self.assertFalse(result["queued"]["hasSignal"])
        self.assertEqual(result["queued"]["actorId"], "owner-a")
        self.assertEqual(result["queued"]["finishedAt"], 500)
        self.assertEqual(result["queued"]["elapsed"], 200)
        self.assertTrue(result["queued"]["timerHidden"])

    def test_generation_run_uses_provider_and_pending_interfaces(self):
        run_source = RUN_MODULE.read_text(encoding="utf-8")
        output_source = OUTPUT_MODULE.read_text(encoding="utf-8")
        self.assertIn("generationProviderModule.submit", run_source)
        self.assertIn("generationOutputPendingModule.transition", output_source)
        for legacy_implementation in (
            "function runApiGeneration",
            "function runRunningHubGeneration",
            "function runApiVideoGeneration",
            "function runModelscopeGeneration",
            "function runComfyGeneration",
            "function generateUrlsForCurrentSettings",
        ):
            with self.subTest(implementation=legacy_implementation):
                self.assertNotIn(legacy_implementation, run_source)


if __name__ == "__main__":
    unittest.main()
