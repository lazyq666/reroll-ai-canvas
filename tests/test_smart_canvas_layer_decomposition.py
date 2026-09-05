import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "static/js/smart-canvas/layer-decomposition.js"
HOST = ROOT / "static/js/smart-canvas.js"
PAGE = ROOT / "static/smart-canvas.html"
I18N = ROOT / "static/js/i18n/smart-canvas.js"
CONTAINER = ROOT / "static/js/smart-canvas/smart-container.js"
AI_PROCESSOR_DIALOG = ROOT / "static/js/infinite-canvas-ui/ai-processor-dialog.js"
ICON = ROOT / "static/js/infinite-canvas-ui/icon.js"


class SmartCanvasLayerDecompositionTests(unittest.TestCase):
    def test_entry_dialog_and_localized_copy_are_wired(self):
        host = HOST.read_text(encoding="utf-8")
        page = PAGE.read_text(encoding="utf-8")
        i18n = I18N.read_text(encoding="utf-8")
        self.assertIn("{key:'layer-decomposition', icon:'layers'", host)
        self.assertNotIn("id=\"layerDecompositionDialog\"", page)
        self.assertIn("openAiProcessorForSmartImage('layer-decomposition'", host)
        self.assertIn("smart.layerDecomposition", i18n)
        self.assertIn("smart.layerDecompositionPriceRange", i18n)
        self.assertNotIn("smart.layerDecompositionPriceEstimate", i18n)
        self.assertIn("supportedModels", MODULE.read_text(encoding="utf-8"))
        self.assertIn("reportFailure:reportLayerDecompositionFailure", host)
        self.assertNotIn("<ic-alert", MODULE.read_text(encoding="utf-8"))
        self.assertIn("id=\"layerDecompositionEditor\"", page)
        self.assertIn("id=\"layerDecompositionEditorList\"", page)
        self.assertIn("id=\"layerDecompositionPsdDownload\"", page)
        self.assertIn("layerDecompositionMarkup", AI_PROCESSOR_DIALOG.read_text(encoding="utf-8"))
        self.assertIn("layers: 'Layers'", ICON.read_text(encoding="utf-8"))
        container = CONTAINER.read_text(encoding="utf-8")
        self.assertIn("if(options.render !== false) render();", container)
        self.assertIn("if(options.save !== false)", container)
        self.assertIn("if(options.arrange !== false)", container)
        self.assertIn("image.layer_decomposition", MODULE.read_text(encoding="utf-8"))

    def test_composite_preview_is_passive_and_transparent(self):
        source = HOST.read_text(encoding="utf-8")
        css = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")

        self.assertNotIn('class="thumb-item layer-decomposition-item', source)
        self.assertIn(".layer-decomposition-stage", css)
        self.assertIn("pointer-events:none", css)
        self.assertIn("background:transparent", css)
        self.assertIn("width:100%; height:100%", css)
        self.assertIn("pendingNode.type = nodeKinds.LAYER_DECOMPOSITION", source)
        self.assertNotIn("smartContainer.group(\n        children", source)

    def test_controller_validates_capability_submits_once_and_resumes(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const assert = require('node:assert/strict');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const requests = [];
            const completed = [];
            const saved = [];
            const nodes = [{{
                id:'source', type:'smart-image', images:[{{
                    url:'/api/outputs/source.png', media_id:'media-source',
                    natural_w:1600, natural_h:900, kind:'image'
                }}]
            }}];
            let statusCalls = 0;
            const capabilityLoads = [];
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                setTimeout:fn => Promise.resolve().then(fn),
                clearTimeout:() => {{}},
                fetch:async (url, options={{}}) => {{
                    requests.push({{url, options}});
                    if(options.method === 'POST') return {{ok:true,json:async()=>({{task_id:'run-1',status:'queued'}})}};
                    statusCalls += 1;
                    return {{ok:true,json:async()=> statusCalls < 2
                        ? ({{id:'run-1',status:'running'}})
                        : ({{id:'run-1',status:'succeeded',result:{{manifest:{{manifest_version:1,layers:[]}}}}}})}};
                }},
                console,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const controller = sandbox.window.SmartCanvasModules.layerDecomposition.create({{
                nodes:() => nodes,
                canvasId:() => 'canvas-1',
                capability:{{
                    load:async(providerId, modelId, operation)=>{{
                        capabilityLoads.push({{providerId,modelId,operation}});
                        return {{
                            support_state:'supported', catalog_revision:'rev-1',
                            parameters:{{resolution_tier:{{values:['auto','1K','1.5K','2K']}},count:{{values:[1]}}}}
                        }};
                    }},
                    validate:(capability, request) => ({{
                        valid:request.catalogRevision === 'rev-1'
                            && request.inputs.image === 1
                            && request.parameters.resolution_tier === '2K'
                            && request.parameters.count === 1,
                        errors:[]
                    }}),
                }},
                createPending:sourceNode => {{
                    const node = {{id:'pending',type:'smart-image',images:[],sourceNodeId:sourceNode.id}};
                    nodes.push(node); return node;
                }},
                applyResult:(node, result) => completed.push({{node:node.id,result}}),
                save:node => saved.push(node.id),
                render:() => {{}},
                toast:() => {{}},
                text:key => key,
                responseError:async()=> 'failed',
                now:() => 100,
                sleep:async()=> {{}},
            }});
            (async()=>{{
                const pending = await controller.run({{
                    node:nodes[0],imageIndex:0,providerId:'apimart-secondary',
                    modelId:'seedream-layer-pro',resolutionTier:'2K',prompt:''
                }});
                await controller.waitForIdle();
                assert.equal(pending.id, 'pending');
                assert.equal(requests.filter(item => item.options.method === 'POST').length, 1);
                const body = JSON.parse(requests.find(item => item.options.method === 'POST').options.body);
                assert.deepEqual(body, {{
                    provider_id:'apimart-secondary', model:'seedream-layer-pro',
                    resolution_tier:'2K', prompt:'',
                    image:{{url:'/api/outputs/source.png',role:'source',natural_w:1600,natural_h:900}},
                    source_media_id:'media-source', catalog_revision:'rev-1',
                    canvas_id:'canvas-1', node_id:'pending',
                    generation_operation_id:pending.generationOperationId,
                    generation_request_index:0,
                }});
                assert.equal(pending.layerDecompositionJob.sourceReference.url, '/api/outputs/source.png');
                assert.equal(pending.layerDecompositionJob.sourceReference.role, 'source');
                assert.equal(completed.length, 1);
                assert.deepEqual(capabilityLoads[0], {{
                    providerId:'apimart-secondary', modelId:'seedream-layer-pro',
                    operation:'image.layer_decomposition'
                }});
                const postCount = requests.filter(item => item.options.method === 'POST').length;
                pending.layerDecompositionJob = {{taskId:'run-1',status:'running'}};
                controller.resume();
                await controller.waitForIdle();
                assert.equal(requests.filter(item => item.options.method === 'POST').length, postCount);
                assert.ok(saved.length > 0);
                console.log('ok');
            }})().catch(error => {{ console.error(error); process.exitCode=1; }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_supported_models_are_filtered_by_exact_capability(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const assert = require('node:assert/strict');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}},console}};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const controller = sandbox.window.SmartCanvasModules.layerDecomposition.create({{
                capability:{{load:async(providerId,modelId)=> modelId === 'supported'
                    ? {{support_state:'supported',catalog_revision:'rev-2',parameters:{{resolution_tier:{{values:['auto','1K'],default:'1K'}}}}}}
                    : {{support_state:'unknown',parameters:{{}}}}
                }}
            }});
            (async()=>{{
                const models = await controller.supportedModels([
                    {{id:'one',provider_id:'apimart-a',provider_name:'APIMart A',model:'supported'}},
                    {{id:'two',provider_id:'apimart-b',provider_name:'APIMart B',model:'unknown'}}
                ]);
                assert.equal(models.length, 1);
                assert.equal(models[0].id, 'one');
                assert.deepEqual(models[0].resolutionTiers, ['auto','1K']);
                assert.equal(models[0].defaultResolution, '1K');
                console.log('ok');
            }})().catch(error => {{ console.error(error); process.exitCode=1; }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_controller_persists_pending_node_before_submission(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const assert = require('node:assert/strict');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const nodes = [{{
                id:'source', type:'smart-image', images:[{{
                    url:'/api/outputs/source.png', media_id:'media-source',
                    natural_w:1600, natural_h:900, kind:'image'
                }}]
            }}];
            let pendingPersisted = false;
            let submittedBeforePersistence = false;
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                fetch:async (url, options={{}}) => {{
                    if(options.method === 'POST'){{
                        submittedBeforePersistence = !pendingPersisted;
                        return {{ok:true,json:async()=>({{task_id:'run-1',status:'queued'}})}};
                    }}
                    return {{ok:true,json:async()=>({{id:'run-1',status:'failed'}})}};
                }},
                console,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const controller = sandbox.window.SmartCanvasModules.layerDecomposition.create({{
                nodes:() => nodes,
                canvasId:() => 'canvas-1',
                capability:{{
                    load:async()=>({{support_state:'supported',catalog_revision:'rev-1'}}),
                    validate:()=>({{valid:true,errors:[]}}),
                }},
                createPending:sourceNode => {{
                    const pending = {{id:'pending',type:'smart-image',images:[],sourceNodeId:sourceNode.id}};
                    nodes.push(pending);
                    return pending;
                }},
                checkpoint:async()=>{{ pendingPersisted = true; }},
                save:()=>{{}}, render:()=>{{}}, toast:()=>{{}},
                text:key => key, now:()=>100, sleep:async()=>{{}},
            }});
            (async()=>{{
                await controller.run({{node:nodes[0],imageIndex:0,resolutionTier:'2K',prompt:''}});
                assert.equal(pendingPersisted, true);
                assert.equal(submittedBeforePersistence, false);
                console.log('ok');
            }})().catch(error => {{ console.error(error); process.exitCode=1; }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_invalid_completed_result_becomes_recoverable_without_requery_loop(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const assert = require('node:assert/strict');
            const source = fs.readFileSync({json.dumps(str(MODULE))}, 'utf8');
            const nodes = [{{
                id:'pending', type:'smart-image', images:[],
                layerDecompositionJob:{{taskId:'run-2',status:'running'}}
            }}];
            let queryCount = 0;
            const sandbox = {{
                window:{{SmartCanvasModules:{{}}}},
                fetch:async()=>{{
                    queryCount += 1;
                    return {{ok:true,json:async()=>({{id:'run-2',status:'succeeded',result:{{}}}})}};
                }},
                console,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const controller = sandbox.window.SmartCanvasModules.layerDecomposition.create({{
                nodes:() => nodes,
                applyResult:() => {{ throw new Error('unsafe provider detail'); }},
                save:() => {{}}, render:() => {{}}, toast:() => {{}},
                text:key => key, sleep:async()=>{{}}, now:()=>100,
            }});
            (async()=>{{
                controller.resume();
                await controller.waitForIdle();
                assert.equal(queryCount, 1);
                assert.equal(nodes[0].layerDecompositionJob.status, 'recoverable');
                assert.equal(nodes[0].layerDecompositionJob.message, 'smart.layerDecompositionRecoverable');
                assert.equal(nodes[0].layerDecompositionJob.error, 'smart.layerDecompositionInvalidResult');
                console.log('ok');
            }})().catch(error => {{ console.error(error); process.exitCode=1; }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
