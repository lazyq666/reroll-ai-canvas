"""Exercise the browser's actual optimization request against backend validation."""
import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
import main

ROOT = Path(__file__).resolve().parents[1]

class PromptOptimizationRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_model_output_stays_empty_for_client_failure_handling(self):
        result = SimpleNamespace(text='  ', model='text-model', raw_usage={}, expose_raw=False)
        with (
            patch.object(main, '_canvas_llm_run', new=AsyncMock(return_value=object())),
            patch.object(main, '_run_generation_inline', new=AsyncMock(return_value=result)),
        ):
            response = await main.canvas_llm(main.CanvasLLMRequest(message='A sunset', model='text-model'))
        self.assertEqual(response['text'], '', 'An error explanation must not become an optimized prompt')

    async def test_optimization_request_passes_real_text_capability_validation(self):
        capability = await main.model_capability('codex', 'gpt-5.5', 'text.generate')
        script = r"""
const fs=require('node:fs'),vm=require('node:vm');
const capability=JSON.parse(fs.readFileSync(0,'utf8'));
const source=fs.readFileSync('static/js/smart-canvas.js','utf8');
const start=source.indexOf('async function requestPromptOptimization(context)');
const end=source.indexOf('\nvar composerPromptOptimizer',start);
let payload;
const context={AbortSignal,URLSearchParams,Map,window:{SmartCanvasModules:{}},
 smartCatalogEntry:()=>({model_id:'gpt-5.5'}),
 fetch:async(url,options)=>{
   if(url==='/api/prompt-optimization-settings') return {ok:true,json:async()=>({version:2,image:{provider:'codex',model:'gpt-5.5',default_preset:'visual',instructions:{smart:'Wrong rule',visual:'Selected visual rule'}}})};
   if(url.startsWith('/api/model-capabilities?')) return {ok:true,json:async()=>capability};
   if(url==='/api/canvas-llm'){payload=JSON.parse(options.body);return {ok:true,json:async()=>({text:'Optimized'})};}
   throw new Error('Unexpected endpoint '+url);
 }};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/model-capabilities.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/prompt-optimize.js','utf8'),context);
vm.runInContext(source.slice(start,end),context);
context.requestPromptOptimization({source:'A sunset',media:'image',preset:'smart',model:'image-model'})
 .then(()=>process.stdout.write(JSON.stringify(payload))).catch(error=>{console.error(error);process.exitCode=1});
"""
        result = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(capability), text=True, capture_output=True, check=True)
        payload = main.CanvasLLMRequest.model_validate_json(result.stdout)
        # No Provider call: this is the real route's validation/request assembly seam.
        run = await main._canvas_llm_run(payload)
        self.assertEqual(payload.catalog_revision, capability['catalog_revision'])
        self.assertIsNotNone(run)
        self.assertIn('Selected visual rule',payload.message)
        self.assertNotIn('Wrong rule',payload.message)

if __name__ == '__main__':
    unittest.main()
