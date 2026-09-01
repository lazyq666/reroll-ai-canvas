import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
SETTINGS_MODULE = ROOT / "static/js/smart-canvas/generation-settings.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
PROMPT_MODULE = ROOT / "static/js/smart-canvas/prompt-authoring.js"


class SmartCanvasGenerationModuleTests(unittest.TestCase):
    def test_image_resolution_starts_at_1k(self):
        source = SETTINGS_MODULE.read_text(encoding="utf-8")
        initial = source[source.index("let settings = {"):source.index("function cloneSmartSettings")]
        default_resolution = source[
            source.index("function defaultSmartApiResolution"):
            source.index("const SMART_IMAGE_RATIO_KEYS")
        ]
        self.assertIn("resolution:'1k'", initial)
        self.assertNotIn("resolution:'4k'", initial)
        self.assertIn("return '1k';", default_resolution)

    def test_capability_warning_state_is_not_persisted(self):
        source = SETTINGS_MODULE.read_text(encoding="utf-8")
        storage = source[source.index("function settingsForStorage"):source.index("function normalizeSmartVideoModeSettings")]
        self.assertIn("delete clean._imageCapabilityWarning;", storage)
        self.assertIn("delete clean._imageCapabilityWarningKey;", storage)

    def test_generation_nodes_and_groups_exclude_plain_media_nodes(self):
        host = HOST.read_text(encoding="utf-8")
        run_source = RUN_MODULE.read_text(encoding="utf-8")

        self.assertIn("function isUploadedAttachmentImageNode(node)", host)
        self.assertIn("function isUpstreamUploadMediaNode(node)", host)
        runnable = host[
            host.index("function isSmartRunnableNode(node)"):
            host.index("function isHistoryGroupNode(node)")
        ]
        self.assertIn("return smartNodeGenerationEligibility(node).runnable", runnable)
        self.assertNotIn("!isUploadedAttachmentImageNode(node)", runnable)
        self.assertNotIn("!isUpstreamUploadMediaNode(node)", runnable)
        self.assertIn("? smartNodeGenerationEligibility(node)", run_source)
        self.assertIn("if(!nodeEligibility.runnable) return false;", run_source)
        self.assertIn("&& !nodeEligibility.imageAllowed", run_source)
        self.assertIn("if(!prompt && smartRunNeedsPrompt(runSettings))", run_source)
        self.assertIn("toast(tr('smart.toastNeedPrompt'))", run_source)

        classification = host[
            host.index("function isSmartImageNode(node)"):
            host.index("function isHistoryGroupNode(node)")
        ]
        script = textwrap.dedent(
            f"""
            const smartContainer = {{isGroup:(node) => node?.type === 'smart-group'}};
            const referenceGenerationKind = (node) => node?.referenceGenerationKind || '';
            const mediaKindForItem = (item) => item?.kind || 'image';
            const nodeKinds = {{
                isGeneration:(node) => node?.type === 'smart-image'
                    && ['image','video'].includes(node?.referenceGenerationKind)
            }};
            {classification}
            const cases = [
                [{{type:'smart-image', images:[]}}, false, 'blank image node'],
                [{{type:'smart-image', images:[{{url:'uploaded.png'}}], uploadedAttachment:true}}, false, 'uploaded attachment'],
                [{{type:'smart-image', images:[], uploadMediaKind:'image'}}, false, 'upstream upload node'],
                [{{type:'smart-image', images:[], referenceGenerationKind:'image'}}, true, 'generation image node'],
                [{{type:'smart-image', images:[], referenceGenerationKind:'video'}}, true, 'generation video node'],
                [{{type:'smart-group'}}, true, 'group node'],
                [{{type:'smart-frame'}}, false, 'unsupported frame'],
            ];
            for (const [node, expected, label] of cases) {{
                const actual = isSmartRunnableNode(node);
                if (actual !== expected) {{
                    throw new Error(`${{label}}: expected ${{expected}}, got ${{actual}}`);
                }}
            }}
            """
        )
        subprocess.run(["node", "-e", script], check=True)

    def test_generation_commands_are_routed_through_the_public_interface(self):
        host = HOST.read_text(encoding="utf-8")
        for implementation_name in (
            "runGeneration",
            "queryJimengNow",
            "querySmartImageTaskNow",
            "generateUrlsForCurrentSettings",
            "regenerateSmartNodeFromSnapshot",
            "smartCascadeIsLoopRunning",
            "smartCascadeAnyRunning",
            "smartPendingTasks",
            "buildPromptRequest",
            "buildPromptRequestForNode",
            "collectPromptParts",
            "originalPromptTextFromParts",
        ):
            with self.subTest(implementation=implementation_name):
                self.assertNotIn(implementation_name, host)

        run_source = RUN_MODULE.read_text(encoding="utf-8")
        self.assertIn("promptAuthoringModule.resolve", run_source)
        self.assertNotIn("function buildPromptRequest", run_source)
        self.assertIn(
            "requestNode.promptDraftText || request.displayPrompt",
            run_source,
        )
        self.assertNotIn("applySettingsToNode(", host)
        self.assertIn("generationSettings.saveForNode(", host)
        for interface_method in (
            "run(",
            "stop(",
            "resume(",
            "status(",
            "recover(",
            "regenerate(",
            "noteManualSelection(",
        ):
            with self.subTest(interface=interface_method):
                self.assertIn(interface_method, run_source)

    def test_disconnected_generation_is_queued_and_resumed_without_a_toast(self):
        run_source = RUN_MODULE.read_text(encoding="utf-8")
        self.assertIn("function generationRunQueueIntent(", run_source)
        self.assertIn("function generationRunResumeQueued(", run_source)
        self.assertIn("queuedGenerationRun", run_source)
        self.assertIn("window.sessionStorage", run_source)
        self.assertIn("generationRunStoreQueuedIntent", run_source)
        self.assertNotIn("toast(tr('smart.generationWaitForSync'))", run_source)
        public = run_source[run_source.index("window.SmartCanvasModules") :]
        self.assertNotIn("if(!generationRunCanSubmit())", public)

        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(RUN_MODULE))}, 'utf8');
            const stored = new Map();
            const cascades = [];
            let online = false;
            const node = {{id:'node-1', type:'smart-loop'}};
            const persistence = {{
                editable:() => true,
                online:() => online,
                synced:async () => true,
                save:async () => true,
                schedule:() => {{}},
            }};
            const sandbox = {{
                window:{{
                    sessionStorage:{{
                        getItem:key => stored.get(key) || null,
                        setItem:(key,value) => stored.set(key,String(value)),
                        removeItem:key => stored.delete(key),
                    }},
                    SmartCanvasModules:{{
                        generationSettings:{{}},
                        promptAuthoring:{{}},
                        generationProvider:{{}},
                        generationOutput:{{}},
                        canvasPersistence:persistence,
                        canvasMutation:{{}},
                        smartContainer:{{}},
                        generationRecovery:{{resume:() => null}},
                        generationCascade:{{run:async options => cascades.push(options.nodeId)}},
                        viewportSelection:{{selection:{{node:() => node}}}},
                    }},
                }},
                nodes:[node],
                canvasId:'canvas-1',
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                nowMs:() => 100,
                render:() => {{}},
                setTimeout,
                clearTimeout,
                Promise,
                JSON,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            (async () => {{
                const generationRun = sandbox.window.SmartCanvasModules.generationRun;
                await generationRun.run({{nodeId:'node-1',mode:'loop'}});
                if(!node.queuedGenerationRun || !node.queued) throw new Error('offline run was not queued');
                if(stored.size !== 1) throw new Error('queued intent was not stored in the tab');
                online = true;
                generationRun.resume();
                await new Promise(resolve => setTimeout(resolve, 0));
                process.stdout.write(JSON.stringify({{
                    cascades,
                    stored:stored.size,
                    queued:Boolean(node.queuedGenerationRun || node.queued),
                }}));
            }})().catch(error => {{
                process.stderr.write(error.stack || error.message);
                process.exitCode = 1;
            }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {"cascades": ["node-1"], "stored": 0, "queued": False},
        )

    def test_generation_settings_save_returns_a_clone_and_drops_transient_links(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const node = {{ id: 'node-1' }};
            const sandbox = {{
                window: {{ SmartCanvasModules: {{}} }},
                nodes: [node],
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const input = {{
                engine: 'api',
                videoTempShLinks: [
                    {{ url: 'https://manual.example/image.png', manual: true }},
                    {{ url: 'https://temporary.example/image.png', manual: false }},
                ],
            }};
            const saved = sandbox.window.SmartCanvasModules.generationSettings.saveForNode(
                'node-1',
                input,
                {{ remember: false }},
            );
            saved.engine = 'changed';
            if (node.runSettings.engine !== 'api') throw new Error('saveForNode leaked its stored object');
            if (node.runSettings.videoTempShLinks.length !== 1) throw new Error('transient link was persisted');
            if (node.runSettings.videoTempShLinks[0].url !== 'https://manual.example/image.png') {{
                throw new Error('manual link was not preserved');
            }}
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_generation_settings_builds_isolated_run_snapshots(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const imageNode = {{
                id: 'image-node',
                runSettings: {{
                    engine: 'api',
                    apiKind: 'image',
                    provider_id: 'provider',
                    model: 'model',
                    count: 7,
                    ratio: 'square',
                    resolution: '1k',
                }},
            }};
            const videoNode = {{
                id: 'video-node',
                runSettings: {{
                    engine: 'api',
                    apiKind: 'video',
                    count: 6,
                }},
            }};
            const sandbox = {{
                window: {{ SmartCanvasModules: {{}} }},
                nodes: [imageNode, videoNode],
                stripOutpaintDisplaySettings: value => ({{...(value || {{}})}}),
                withOutpaintDisplaySettings: (_node, value) => ({{...(value || {{}})}}),
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const generationSettings = sandbox.window.SmartCanvasModules.generationSettings;
            const loopRun = generationSettings.forRun({{
                nodeId: 'image-node',
                context: {{nodeId: 'loop-node'}},
                outpaintSize: {{width: 1536, height: 896}},
            }});
            const videoRun = generationSettings.forRun({{nodeId: 'video-node'}});
            const outpaintFromVideoRun = generationSettings.forRun({{
                nodeId: 'video-node',
                outpaintSize: {{width: 1280, height: 768}},
            }});
            loopRun.settings.model = 'mutated';
            const freshRun = generationSettings.forRun({{nodeId: 'image-node'}});
            process.stdout.write(JSON.stringify({{
                loopRun: {{
                    count: loopRun.settings.count,
                    expectedCount: loopRun.expectedCount,
                    outputKind: loopRun.outputKind,
                    concurrent: loopRun.concurrent,
                    resolution: loopRun.settings.resolution,
                    customSize: loopRun.settings.customSize,
                }},
                videoRun: {{
                    expectedCount: videoRun.expectedCount,
                    outputKind: videoRun.outputKind,
                }},
                outpaintFromVideoRun: {{
                    apiKind: outpaintFromVideoRun.settings.apiKind,
                    outputKind: outpaintFromVideoRun.outputKind,
                    resolution: outpaintFromVideoRun.settings.resolution,
                    customSize: outpaintFromVideoRun.settings.customSize,
                }},
                freshModel: freshRun.settings.model,
                activeModel: generationSettings.snapshot().model,
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
        self.assertEqual(payload["loopRun"]["count"], 1)
        self.assertEqual(payload["loopRun"]["expectedCount"], 1)
        self.assertEqual(payload["loopRun"]["outputKind"], "image")
        self.assertTrue(payload["loopRun"]["concurrent"])
        self.assertEqual(payload["loopRun"]["resolution"], "custom")
        self.assertEqual(payload["loopRun"]["customSize"], "1536x896")
        self.assertEqual(payload["videoRun"]["expectedCount"], 1)
        self.assertEqual(payload["videoRun"]["outputKind"], "video")
        self.assertEqual(payload["outpaintFromVideoRun"]["apiKind"], "image")
        self.assertEqual(payload["outpaintFromVideoRun"]["outputKind"], "image")
        self.assertEqual(payload["outpaintFromVideoRun"]["resolution"], "custom")
        self.assertEqual(payload["outpaintFromVideoRun"]["customSize"], "1280x768")
        self.assertEqual(payload["freshModel"], "model")
        self.assertEqual(payload["activeModel"], "")

    def test_generation_settings_reconciles_canvas_sync_through_its_interface(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const node = {{
                id:'active-node',
                runSettings:{{
                    engine:'api',
                    apiKind:'image',
                    provider_id:'alternate-provider',
                    model:'alternate-image-model',
                    ratio:'wide',
                    resolution:'2k',
                    quality:'high',
                    count:3,
                    videoModel:'alternate-video-model',
                    comfyWorkflow:'alternate-workflow',
                    rhConfigKey:'model:alternate-runninghub-model',
                }},
            }};
            const sandbox = {{
                window: {{SmartCanvasModules: {{}}}},
                nodes:[node],
                stripOutpaintDisplaySettings:value => ({{...(value || {{}})}}),
                withOutpaintDisplaySettings:(_node, value) => ({{...(value || {{}})}}),
                normalizeSmartVideoModeSettings:value => value,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const generationSettings = sandbox.window.SmartCanvasModules.generationSettings;
            const active = generationSettings.reconcileCanvasSync({{
                canvasSettings:{{
                    engine:'api',
                    provider_id:'default-provider',
                    model:'gemini-3.1-flash-image-preview',
                    ratio:'square',
                    resolution:'4k',
                    quality:'auto',
                    count:1,
                }},
                activeNodeId:'active-node',
            }});
            const defaults = generationSettings.reconcileCanvasSync({{
                canvasSettings:{{
                    engine:'api',
                    provider_id:'new-default-provider',
                    model:'new-default-model',
                    ratio:'portrait',
                    resolution:'1k',
                }},
                activeNodeId:'missing-node',
            }});
            active.model = 'mutated-outside-module';
            process.stdout.write(JSON.stringify({{
                active,
                activeSnapshot:generationSettings.forNode('active-node'),
                defaults,
                current:generationSettings.snapshot(),
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
        self.assertEqual(payload["activeSnapshot"]["model"], "alternate-image-model")
        self.assertEqual(payload["activeSnapshot"]["ratio"], "wide")
        self.assertEqual(payload["activeSnapshot"]["resolution"], "2k")
        self.assertEqual(payload["activeSnapshot"]["quality"], "high")
        self.assertEqual(payload["activeSnapshot"]["count"], 3)
        self.assertEqual(
            payload["activeSnapshot"]["videoModel"],
            "alternate-video-model",
        )
        self.assertEqual(
            payload["activeSnapshot"]["comfyWorkflow"],
            "alternate-workflow",
        )
        self.assertEqual(
            payload["activeSnapshot"]["rhConfigKey"],
            "model:alternate-runninghub-model",
        )
        self.assertEqual(payload["defaults"]["model"], "new-default-model")
        self.assertEqual(payload["current"]["model"], "new-default-model")

    def test_generation_settings_rejects_invalid_size_fallbacks(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const sandbox = {{
                window: {{SmartCanvasModules: {{}}}},
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const validate = sandbox.window.SmartCanvasModules.generationSettings.validateImageSize;
            process.stdout.write(JSON.stringify({{
                validPreset:validate({{ratio:'wide', resolution:'2k'}}),
                invalidRatio:validate({{ratio:'cinema', resolution:'2k'}}),
                invalidCustomSize:validate({{
                    ratio:'',
                    resolution:'custom',
                    customSize:'',
                }}),
                unsupportedAuto:validate({{
                    ratio:'square',
                    resolution:'auto',
                }}),
                validAuto:validate(
                    {{ratio:'square', resolution:'auto'}},
                    {{allowAuto:true}},
                ),
                invalidModelscopeRatio:validate(
                    {{
                        msRatio:'custom',
                        msResolution:'1k',
                        msCustomRatio:'',
                    }},
                    {{prefix:'ms'}},
                ),
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
        self.assertTrue(payload["validPreset"]["valid"])
        self.assertEqual(payload["invalidRatio"]["reason"], "invalid-ratio")
        self.assertEqual(
            payload["invalidCustomSize"]["reason"],
            "invalid-custom-size",
        )
        self.assertEqual(
            payload["unsupportedAuto"]["reason"],
            "unsupported-auto",
        )
        self.assertTrue(payload["validAuto"]["valid"])
        self.assertEqual(
            payload["invalidModelscopeRatio"]["reason"],
            "invalid-custom-ratio",
        )

    def test_model_catalog_fallback_does_not_cross_provider_boundary(self):
        host = HOST.read_text(encoding="utf-8")
        start = host.index("function smartCatalogEntry(")
        end = host.index("let smartSettingsFallbackNotice", start)
        source = host[start:end]
        script = textwrap.dedent(
            f"""
            const vm = require('vm');
            const catalog = [
                {{provider_id:'provider-a', model:'shared-model'}},
                {{provider_id:'provider-a', model:'replacement-model'}},
                {{provider_id:'provider-b', model:'shared-model'}},
            ];
            const sandbox = {{
                smartModelCatalog:() => catalog,
            }};
            vm.createContext(sandbox);
            vm.runInContext({json.dumps(source)}, sandbox);
            process.stdout.write(JSON.stringify({{
                exact:sandbox.smartCatalogEntry(
                    'image',
                    'provider-b',
                    'shared-model',
                ),
                sameProviderFallback:sandbox.smartCatalogEntry(
                    'image',
                    'provider-a',
                    'deleted-model',
                ),
                removedProvider:sandbox.smartCatalogEntry(
                    'image',
                    'deleted-provider',
                    'shared-model',
                ),
                blank:sandbox.smartCatalogEntry('image', '', ''),
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
        self.assertEqual(payload["exact"]["provider_id"], "provider-b")
        self.assertEqual(
            payload["sameProviderFallback"]["model"],
            "shared-model",
        )
        self.assertIsNone(payload["removedProvider"])
        self.assertEqual(payload["blank"]["provider_id"], "provider-a")

    def test_runninghub_only_defaults_for_blank_active_ui(self):
        host = HOST.read_text(encoding="utf-8")
        start = host.index("function selectedRunningHubRef(")
        end = host.index("function rhEntryFields(", start)
        source = host[start:end]
        script = textwrap.dedent(
            f"""
            const vm = require('vm');
            const entries = [{{
                kind:'model',
                id:'configured-model',
                entry:{{id:'configured-model'}},
            }}];
            const notices = [];
            const sandbox = {{
                settings:{{rhConfigKey:''}},
                runningHubAllEntries:() => entries,
                parseRunningHubEntryKey:value => {{
                    const match = String(value || '').match(
                        /^(app|workflow|model):(.+)$/
                    );
                    return match ? {{kind:match[1], id:match[2]}} : null;
                }},
                runningHubEntryKey:(kind, id) => `${{kind}}:${{id}}`,
                notifySmartSettingUnavailable:(setting, value) => {{
                    notices.push({{setting, value}});
                }},
                tr:key => key,
            }};
            vm.createContext(sandbox);
            vm.runInContext({json.dumps(source)}, sandbox);
            const blankRun = sandbox.selectedRunningHubRef({{
                rhConfigKey:'',
            }});
            const invalidRun = sandbox.selectedRunningHubRef({{
                rhConfigKey:'workflow:deleted',
            }});
            const activeDefault = sandbox.selectedRunningHubRef();
            sandbox.settings.rhConfigKey = 'workflow:deleted';
            const invalidActive = sandbox.selectedRunningHubRef();
            process.stdout.write(JSON.stringify({{
                blankRun,
                invalidRun,
                activeDefault,
                invalidActive,
                activeKey:sandbox.settings.rhConfigKey,
                notices,
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
        self.assertIsNone(payload["blankRun"])
        self.assertIsNone(payload["invalidRun"])
        self.assertEqual(payload["activeDefault"]["id"], "configured-model")
        self.assertIsNone(payload["invalidActive"])
        self.assertEqual(payload["activeKey"], "workflow:deleted")
        self.assertEqual(len(payload["notices"]), 1)

    def test_generation_settings_remembers_sanitized_mode_snapshot(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const stored = {{}};
            const node = {{id:'node-1'}};
            const sandbox = {{
                window: {{SmartCanvasModules: {{}}}},
                nodes: [node],
                localStorage: {{
                    getItem: key => stored[key] || null,
                    setItem: (key, value) => {{ stored[key] = value; }},
                }},
                stripOutpaintDisplaySettings: value => ({{...(value || {{}})}}),
                withOutpaintDisplaySettings: (_node, value) => ({{...(value || {{}})}}),
                sanitizeSmartApiSelection: value => value,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            sandbox.window.SmartCanvasModules.generationSettings.remember({{
                engine:'api',
                apiKind:'image',
                model:'remembered-model',
                videoTempShLinks:[
                    {{url:'manual.png', manual:true}},
                    {{url:'temporary.png', manual:false}},
                ],
            }}, {{nodeId:'node-1'}});
            process.stdout.write(stored.smart_canvas_recent_run_settings_v1);
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
        self.assertEqual(payload["__lastKey"], "api:image")
        self.assertEqual(payload["api:image"]["model"], "remembered-model")
        self.assertEqual(
            payload["api:image"]["videoTempShLinks"],
            [{"url": "manual.png", "manual": True}],
        )

    def test_transparent_png_recent_value_does_not_enable_fresh_nodes(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(SETTINGS_MODULE))}, 'utf8');
            const stored = {{}};
            const nodes = [
                {{id:'source'}},
                {{id:'fresh'}},
                {{id:'revisited', runSettings:{{transparentPng:true}}}},
            ];
            const sandbox = {{
                window: {{SmartCanvasModules: {{}}}},
                nodes,
                localStorage: {{
                    getItem: key => stored[key] || null,
                    setItem: (key, value) => {{ stored[key] = value; }},
                }},
                stripOutpaintDisplaySettings: value => ({{...(value || {{}})}}),
                withOutpaintDisplaySettings: (_node, value) => ({{...(value || {{}})}}),
                sanitizeSmartApiSelection: value => value,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const api = sandbox.window.SmartCanvasModules.generationSettings;
            api.remember({{
                engine:'api',
                apiKind:'image',
                model:'gpt-image-2',
                transparentPng:true,
            }}, {{nodeId:'source'}});
            process.stdout.write(JSON.stringify({{
                fresh:api.forNode('fresh').transparentPng,
                revisited:api.forNode('revisited').transparentPng,
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
        self.assertEqual(
            {"fresh": False, "revisited": True},
            json.loads(result.stdout),
        )

    def test_generation_run_does_not_mutate_global_settings(self):
        source = RUN_MODULE.read_text(encoding="utf-8")
        self.assertIn("generationSettingsModule.forRun", source)
        self.assertIn("generationSettingsModule.remember", source)
        self.assertIn("generationSettingsModule.snapshot", source)
        self.assertNotIn("smartSettingsForNode(", source)
        self.assertNotIn("rememberRecentSmartSettings(", source)
        self.assertNotIn("cloneSmartSettings(settings)", source)
        self.assertNotIn("settings.provider_id", source)
        self.assertNotRegex(source, r"(?m)^\\s*settings\\s*=")

    def test_prompt_authoring_plain_text_preserves_mentions_and_normalizes_blocks(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROMPT_MODULE))}, 'utf8');
            const sandbox = {{
                window: {{
                    SmartCanvasModules: {{
                        smartContainer:{{isGroup:() => false}},
                    }},
                }},
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const value = vm.runInContext(
                "promptAuthoringPlainText([" +
                "{{type:'text',text:'第一段  \\\\n\\\\n\\\\n'}}," +
                "{{type:'image',name:'参考图'}}," +
                "{{type:'text',text:'  第二段'}}" +
                "])",
                sandbox,
            );
            process.stdout.write(JSON.stringify(value));
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), "第一段\n\n@参考图  第二段")

    def test_prompt_authoring_restores_generation_snapshot_when_draft_is_empty(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROMPT_MODULE))}, 'utf8');
            const resultNode = {{
                id:'result-b',
                type:'smart-image',
                generationOutputNode:true,
                images:[{{url:'result-b.png',kind:'image',outputId:'result-output'}}],
                runInputRefs:[
                    {{url:'same.png',kind:'image',nodeId:'image-1',imageIndex:0,inputInstanceId:'instance-a',role:'first_frame'}},
                    {{url:'same.png',kind:'image',nodeId:'image-2',imageIndex:0,inputInstanceId:'instance-b',role:'last_frame'}},
                ],
                runPromptRefs:[
                    {{url:'same.png',kind:'image',nodeId:'image-1',imageIndex:0,inputInstanceId:'instance-a',role:'first_frame'}},
                    {{url:'same.png',kind:'image',nodeId:'image-2',imageIndex:0,inputInstanceId:'instance-b',role:'last_frame'}},
                ],
                runPrompt:'任务文本',
                promptDraftHtml:'',
                promptDraftText:'',
            }};
            const upstreamText = {{
                id:'text-1', type:'smart-prompt', title:'文本', text:'任务文本'
            }};
            let promptHtml = '';
            const promptInput = {{
                childNodes:[],
                get innerHTML() {{ return promptHtml; }},
                set innerHTML(value) {{
                    promptHtml = String(value || '');
                    this.childNodes = promptHtml
                        ? [{{nodeType:3,textContent:promptHtml}}]
                        : [];
                }},
            }};
            promptInput.innerHTML = '任务文本';
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    smartContainer:{{isGroup:() => false}},
                }}}},
                Node:{{TEXT_NODE:3,ELEMENT_NODE:1}},
                nodes:[resultNode,upstreamText],
                promptInput,
                settings:{{engine:'api',apiKind:'video',videoUseFrameRoles:true}},
                blockedInputRefKeys:() => new Set(),
                inputRefKey:ref => ref.inputInstanceId
                    ? `instance|${{ref.inputInstanceId}}`
                    : ref.outputId
                        ? `output|${{ref.outputId}}`
                        : `url|${{ref.url || ''}}`,
                defaultReferenceImagesFor:() => [{{
                    url:'result-b.png',kind:'image',nodeId:'result-b',outputId:'result-output'
                }}],
                activeInputImagesFor:() => [],
                manualReferenceImagesFor:() => [],
                uniqueReferenceImages:items => {{
                    const seen = new Set();
                    return items.filter(item => {{
                        const key = sandbox.inputRefKey(item);
                        return item?.url && !seen.has(key) && seen.add(key);
                    }});
                }},
                orderReferenceImagesForNode:(_node, items) => items,
                composerTextReferenceNodesFor:() => [upstreamText],
                textForNode:node => node?.text || '',
                mediaKindForItem:item => item?.kind || 'image',
                rhDefaultPromptSuggestion:() => '',
                promptHtmlWithMentionTokens:text => String(text || ''),
                setPromptText:text => {{ promptInput.innerHTML = String(text || ''); }},
                tr:key => key,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const authoring = sandbox.window.SmartCanvasModules.promptAuthoring;
            authoring.restore({{node:resultNode}});
            const restoredFromEmptyDraft = promptInput.innerHTML;
            const resolved = authoring.resolve({{node:resultNode}});
            resultNode.promptDraftText = '任务文本';
            authoring.restore({{node:resultNode}});
            const restoredFromResolvedDraft = promptInput.innerHTML;
            resultNode.promptDraftHtml = '用户修改';
            resultNode.promptDraftText = '用户修改';
            authoring.restore({{node:resultNode}});
            process.stdout.write(JSON.stringify({{
                restoredFromEmptyDraft,
                restoredFromResolvedDraft,
                restoredCustomDraft:promptInput.innerHTML,
                refUrls:resolved.refs.map(ref => ref.url),
                refInstanceIds:resolved.refs.map(ref => ref.inputInstanceId),
                refRoles:resolved.refs.map(ref => ref.role),
                textRefIds:(resolved.textRefs || []).map(ref => ref.id),
                prompt:resolved.prompt,
                promptOccurrences:resolved.prompt.split('任务文本').length - 1,
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
        self.assertEqual(payload["restoredFromEmptyDraft"], "任务文本")
        self.assertEqual(payload["restoredFromResolvedDraft"], "任务文本")
        self.assertEqual(payload["restoredCustomDraft"], "用户修改")
        self.assertEqual(payload["refUrls"], ["same.png", "same.png"])
        self.assertEqual(payload["refInstanceIds"], ["instance-a", "instance-b"])
        self.assertEqual(payload["refRoles"], ["first_frame", "last_frame"])
        self.assertEqual(payload["textRefIds"], ["text-1"])
        self.assertEqual(payload["prompt"], "任务文本")
        self.assertEqual(payload["promptOccurrences"], 1)

    def test_composer_migration_snapshot_matches_live_prompt_authoring(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(PROMPT_MODULE))}, 'utf8');
            const upstream = {{id:'prompt-a',type:'smart-prompt',text:'迁移当下的上游文本',images:[]}};
            const resultNode = {{
                id:'result-a',type:'smart-image',generationOutputNode:true,
                images:[{{url:'result.png',kind:'image',outputId:'result-output'}}],
                runPrompt:'原结果 Node 的冻结文本',
                runModelPrompt:'原结果 Node 的冻结文本',
                runSettings:{{engine:'api',apiKind:'image',model:'model-a'}}
            }};
            const canvas = {{
                nodes:[upstream,resultNode],
                connections:[{{from:'prompt-a',to:'result-a',kind:'input'}}]
            }};
            let promptHtml = '';
            const promptInput = {{
                childNodes:[],
                get innerHTML() {{ return promptHtml; }},
                set innerHTML(value) {{
                    promptHtml = String(value || '');
                    this.childNodes = promptHtml ? [{{nodeType:3,textContent:promptHtml}}] : [];
                }}
            }};
            const key = ref => ref.inputInstanceId
                ? `instance|${{ref.inputInstanceId}}`
                : ref.outputId ? `output|${{ref.outputId}}` : `url|${{ref.url || ''}}`;
            const sandbox = {{
                window:{{SmartCanvasModules:{{smartContainer:{{isGroup:() => false}}}}}},
                Node:{{TEXT_NODE:3,ELEMENT_NODE:1}},
                nodes:canvas.nodes,promptInput,
                settings:resultNode.runSettings,
                blockedInputRefKeys:() => new Set(),
                inputRefKey:key,
                activeInputImagesFor:() => [],
                manualReferenceImagesFor:() => [],
                defaultReferenceImagesFor:() => [{{
                    url:'result.png',kind:'image',nodeId:'result-a',
                    imageIndex:0,outputId:'result-output'
                }}],
                uniqueReferenceImages:items => {{
                    const seen = new Set();
                    return items.filter(item => {{
                        const value = key(item);
                        return item?.url && !seen.has(value) && seen.add(value);
                    }});
                }},
                orderReferenceImagesForNode:(_node,items) => items,
                composerTextReferenceNodesFor:() => [upstream],
                textForNode:node => node?.text || '',
                mediaKindForItem:item => item?.kind || 'image',
                rhDefaultPromptSuggestion:() => '',
                promptHtmlWithMentionTokens:text => String(text || ''),
                setPromptText:text => {{ promptInput.innerHTML = String(text || ''); }},
                tr:key => key,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const authoring = sandbox.window.SmartCanvasModules.promptAuthoring;
            const live = authoring.resolveFromNodeDraft({{node:resultNode}});
            const migration = authoring.migrationSnapshot({{canvas,node:resultNode}});
            process.stdout.write(JSON.stringify({{live,migration}}));
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
        self.assertEqual(payload["live"]["prompt"], payload["migration"]["prompt"])
        self.assertEqual(
            [ref["url"] for ref in payload["live"]["refs"]],
            [ref["url"] for ref in payload["migration"]["refs"]],
        )
        self.assertEqual("model-a", payload["migration"]["criticalSettings"]["model"])


if __name__ == "__main__":
    unittest.main()
