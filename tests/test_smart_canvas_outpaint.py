import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "static/smart-canvas.html"
HOST = ROOT / "static/js/smart-canvas.js"
STUDIO = ROOT / "static/js/smart-canvas/image-studio.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
GEOMETRY = ROOT / "static/js/smart-canvas/ai-processor-geometry.js"


class SmartCanvasOutpaintTests(unittest.TestCase):
    def test_legacy_image_studio_outpaint_is_removed(self):
        page = PAGE.read_text(encoding="utf-8")
        studio = STUDIO.read_text(encoding="utf-8")
        self.assertNotIn('data-image-edit-mode="outpaint"', page)
        self.assertNotIn("applyImageOutpaint", studio)
        self.assertNotIn("imageEditMode === 'outpaint'", studio)
        self.assertNotIn("generationRunModule.outpaint", studio)

    def test_closest_model_canvas_contains_target_and_never_exceeds_4096(self):
        script = textwrap.dedent(
            f"""
            const fs=require('fs'); const vm=require('vm');
            const source=fs.readFileSync({json.dumps(str(GEOMETRY))},'utf8');
            const sandbox={{window:{{SmartCanvasModules:{{}}}}}};
            vm.createContext(sandbox); vm.runInContext(source,sandbox);
            const geometry=sandbox.window.SmartCanvasModules.aiProcessorGeometry;
            const ordinary=geometry.closestContainingCanvas({{width:400,height:235,supportedRatios:['16:9'],maxLongEdge:4096}});
            const large=geometry.closestContainingCanvas({{width:8192,height:6000,supportedRatios:['4:3'],maxLongEdge:4096}});
            const reported=geometry.resolutionTier({{inputWidth:2636,inputHeight:3954,resolutionTiers:['1K','2K','4K']}});
            const explicit=geometry.resolutionTier({{inputWidth:2636,inputHeight:3954,resolutionTiers:['1K','2K','4K'],requested:'2k'}});
            process.stdout.write(JSON.stringify({{ordinary,large,reported,explicit}}));
            """
        )
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        ordinary = payload["ordinary"]
        self.assertGreaterEqual(ordinary["containerWidth"], 400)
        self.assertGreaterEqual(ordinary["containerHeight"], 235)
        self.assertNotEqual(
            [ordinary["containerWidth"], ordinary["containerHeight"]],
            [400, 230],
        )
        large = payload["large"]
        self.assertLessEqual(max(large["inputWidth"], large["inputHeight"]), 4096)
        self.assertGreaterEqual(large["containerWidth"], 8192)
        self.assertGreaterEqual(large["containerHeight"], 6000)
        self.assertEqual(payload["reported"], "4k")
        self.assertEqual(payload["explicit"], "2k")

    def test_outpaint_host_builds_three_node_graph_as_one_undo(self):
        source = HOST.read_text(encoding="utf-8")
        start = source.index("async function submitOutpaintProcessor")
        end = source.index("async function submitAngleProcessor", start)
        body = source[start:end]
        self.assertIn("canvasMutation.history({action:'capture'})", body)
        self.assertIn("const paddedNode=canvasMutation.create({", body)
        self.assertIn("canvasMutation.connect({fromId:source.id,toId:paddedNode.id,input:true})", body)
        self.assertIn("nodeId:paddedNode.id", body)
        self.assertIn("width:working.plan.inputWidth,height:working.plan.inputHeight", body)
        self.assertIn("{resolution:detail.outpaintResolution}", body)
        self.assertIn("node.aiProcessorPostprocess={width:target.width,height:target.height}", body)
        self.assertIn("canvasMutation.history({action:'commit'})", body)
        self.assertNotIn("canvasMutation.history({action:'discard'})", body)
        self.assertNotIn("canvasMutation.remove({nodeIds:[paddedNode.id]", body)
        self.assertNotIn("nodeId:source.id", body)

    def test_processor_uses_intrinsic_image_dimensions_before_saved_layout_metadata(self):
        source = HOST.read_text(encoding="utf-8")
        start = source.index("async function aiProcessorSourceSize")
        end = source.index("async function aiProcessorImagePlan", start)
        body = source[start:end]
        self.assertIn("const fallback=mediaLayoutSize(image)", body)
        self.assertIn("probe.onload=()=>resolve({width:Math.max(1,probe.naturalWidth),height:Math.max(1,probe.naturalHeight)})", body)
        self.assertIn("probe.onerror=()=>resolve(fallbackSize)", body)
        self.assertNotIn("if(fallback.width>0&&fallback.height>0) return", body)

    def test_generic_processor_submits_working_input_and_creates_pending_result(self):
        script = textwrap.dedent(
            f"""
            const fs=require('fs'); const vm=require('vm');
            const source=fs.readFileSync({json.dumps(str(RUN_MODULE))},'utf8');
            const sourceNode={{id:'padded',type:'smart-image',images:[{{url:'padded.png',kind:'image'}}],promptDraftHtml:'Source prompt A',promptDraftText:'Source prompt A'}};
            const nodes=[sourceNode]; let submitted=null,pendingRequest=null,accepted=false,applied=null,forRunOptions=null;
            const sandbox={{
              window:{{SmartCanvasModules:{{
                generationSettings:{{forRun(options){{forRunOptions=options;const settings={{...options.overrides}};if(options.outpaintSize){{settings.resolution='custom';settings.customSize=`${{options.outpaintSize.width}}x${{options.outpaintSize.height}}`;}}return {{settings,expectedCount:1,outputKind:'image',concurrent:false}};}},snapshot:value=>({{...value}}),remember(){{}}}},
                promptAuthoring:{{resolve(){{throw new Error('must use explicit processor request')}}}},
                generationProvider:{{async submit(options){{submitted=options;return {{state:'completed',kind:'image',outputs:[{{url:'generated.png',kind:'image'}}]}};}}}},
                generationOutput:{{submissionSnapshot(){{return {{}};}},createPending(options){{pendingRequest=options;const node={{id:'result',type:'smart-image',images:[],pending:1,runPrompt:options.meta.displayPrompt,promptDraftText:options.meta.promptText}};nodes.push(node);return node;}},apply(options){{applied=options;options.node.images=options.outputs;}}}},
                canvasPersistence:{{online:()=>true,async save(){{}},async synced(){{return true;}},schedule(){{}}}},
                canvasMutation:{{remove(){{}}}},smartContainer:{{isGroup:()=>false}}
              }}}},
              nodes,canvas:{{connections:[]}},canvasId:'canvas',selectedId:'padded',selectedIds:[],selectedImage:{{nodeId:'padded',index:0}},smartClientId:'client',runBtn:null,
              isSmartRunnableNode:()=>false,isSmartImageNode:node=>node?.type==='smart-image',smartNodeInFlight:()=>false,smartRunNeedsPrompt:()=>true,
              snapshotRunMeta:(prompt,sourceNodeId,displayPrompt,refs,settings)=>({{prompt,displayPrompt,sourceNodeId,settings,promptHtml:sourceNode.promptDraftHtml,promptText:sourceNode.promptDraftText}}),stripRunInputMeta:meta=>{{const cleanPrompt=meta.promptText||meta.displayPrompt||meta.prompt||'';return {{...meta,promptHtml:cleanPrompt,promptText:cleanPrompt,promptRefs:[],inputRefs:meta.inputRefs||meta.promptRefs||[],sourceNodeId:''}};}},smartRunSnapshot:()=>({{}}),
              nowMs:()=>100,resultMediaUrls:outputs=>outputs,render(){{}},syncRunButtonState(){{}},clearPromptInput(){{}},addSmartGenerationLog(){{}},toast(){{}},tr:key=>key,escapeHtml:value=>String(value),setTimeout,clearTimeout,console
            }};
            vm.createContext(sandbox);vm.runInContext(source,sandbox);
            sandbox.window.SmartCanvasModules.generationRun.processor({{
              nodeId:'padded',input:{{url:'working.png',kind:'image'}},width:1536,height:896,prompt:'Fill scene',
              runSettings:{{engine:'api',apiKind:'image',provider_id:'provider',model:'model',ratio:'wide',resolution:'2k'}},
              onAccepted:()=>{{accepted=true;}}
            }}).then(()=>process.stdout.write(JSON.stringify({{
              accepted,pendingSourceId:pendingRequest?.sourceNode?.id,submittedPrompt:submitted?.prompt,
              submittedRefs:(submitted?.refs||[]).map(item=>item.url),submittedRatio:submitted?.settings?.ratio,
              submittedResolution:submitted?.settings?.resolution,submittedSize:submitted?.settings?.customSize||'',
              forwardedOutpaintSize:forRunOptions?.outpaintSize||null,
              outputImages:(nodes.find(node=>node.id==='result')?.images||[]).map(item=>item.url),applyStrategy:applied?.strategy,
              resultRunPrompt:nodes.find(node=>node.id==='result')?.runPrompt,
              resultPromptDraftText:nodes.find(node=>node.id==='result')?.promptDraftText
            }}))).catch(error=>{{console.error(error);process.exit(1);}});
            """
        )
        result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["accepted"])
        self.assertEqual(payload["pendingSourceId"], "padded")
        self.assertEqual(payload["submittedPrompt"], "Fill scene")
        self.assertEqual(payload["submittedRefs"], ["working.png"])
        self.assertEqual(payload["submittedRatio"], "wide")
        self.assertEqual(payload["submittedResolution"], "2k")
        self.assertEqual(payload["submittedSize"], "")
        self.assertIsNone(payload["forwardedOutpaintSize"])
        self.assertEqual(payload["outputImages"], ["generated.png"])
        self.assertEqual(payload["applyStrategy"], "pending")
        self.assertEqual(payload["resultRunPrompt"], "Fill scene")
        self.assertEqual(payload["resultPromptDraftText"], "Fill scene")


if __name__ == "__main__":
    unittest.main()
