"""Exact dimensions: persisted capability, request rejection, and transport fidelity."""
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException
from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
import main
from infinite_canvas.image_dimensions import CUSTOM_IMAGE_DIMENSIONS, validate_custom_image_size
from infinite_canvas.model_capability_matrix import ModelCapabilityMatrix
from infinite_canvas.model_capability_workbench import ModelCapabilityWorkbench
from infinite_canvas.providers import http_impl
from tests.test_model_capabilities import catalog

ROOT = Path(__file__).resolve().parents[1]


def custom_catalog(path, enabled=True):
    registry = catalog(published_path=path)
    inventory = lambda: {'image': [dict(model='gpt-image-2', provider_id=provider, name='GPT Image 2') for provider in ['exact', 'other']], 'video': [], 'text': []}
    matrix = ModelCapabilityMatrix(inventory=inventory, catalog=registry, workbench=ModelCapabilityWorkbench(path))
    operations = [dict(operation=operation, confirmed=True,
                       inputs={'text': 1, 'image': 3 if operation == 'image.edit' else 0},
                       resolutions=['1K', '2K'], aspect_ratios=['1:1', '16:9'],
                       output_count_maximum=4, options=['custom_resolution'] if enabled else [])
                  for operation in ['image.generate', 'image.edit']]
    matrix.apply(model_id='gpt-image-2', actor_id='test', operations=operations)
    return registry, matrix


class CustomImageDimensionTests(unittest.TestCase):
    def test_boundaries_and_no_server_rounding(self):
        cases = {
            '1920x1088':'', '640x1024':'', '3840x2160':'', '1536x512':'',
            '1920x1080':'multiple', '1920.5x1088':'integer', '0x1024':'positive',
            '3856x2160':'edge', '2048x512':'aspect', '512x512':'minimum_pixels',
            '3072x3072':'maximum_pixels', 'auto':'integer',
        }
        for value, code in cases.items():
            with self.subTest(value=value):
                self.assertEqual('custom_size_' + code if code else '', validate_custom_image_size(value))

    def test_switch_persists_for_generate_and_edit_across_providers(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'catalog.json'
            for enabled in [True, False]:
                custom_catalog(path, enabled)
                reopened = catalog(published_path=path)
                for provider in ['exact', 'other']:
                    for operation in ['image.generate', 'image.edit']:
                        resolved = reopened.resolve(provider, 'gpt-image-2', operation)
                        self.assertEqual(enabled, resolved['media_contract']['supports_custom_resolution'])
                        validation = reopened.validate(resolved, input_counts={'text': 1, 'image': int(operation == 'image.edit')}, parameters={'custom_size':'1920x1088'}, catalog_revision=reopened.revision)
                        self.assertEqual(enabled, validation['valid'])
                        if not enabled:
                            self.assertEqual('custom_size_unsupported', validation['errors'][0]['code'])

    def test_save_upgrades_published_profiles_without_custom_resolution_parameter(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'catalog.json'
            custom_catalog(path, False)
            legacy = json.loads(path.read_text())
            for record in legacy['published']['capabilities']:
                record['capability']['parameters'].pop('custom_resolution', None)
            path.write_text(json.dumps(legacy))
            registry, matrix = custom_catalog(path, True)
            reopened = catalog(published_path=path)
            for provider in ['exact', 'other']:
                for operation in ['image.generate', 'image.edit']:
                    capability = reopened.resolve(provider, 'gpt-image-2', operation)
                    self.assertIn(True, capability['parameters'].get('custom_resolution', {}).get('values', []))
                    self.assertTrue(reopened.validate(capability, input_counts={'text': 1, 'image': int(operation == 'image.edit')}, parameters={'custom_size': '1920x1088'}, catalog_revision=reopened.revision)['valid'])

    def test_unified_client_and_server_validate_same_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            registry, _ = custom_catalog(Path(temp) / 'catalog.json')
            capability = registry.resolve('exact', 'gpt-image-2', 'image.generate')
            requests = [{'custom_size': size} for size in ['1920x1088','640x1024','3840x2160','1920x1080','-1x1088','0x1088','4000x1088','3072x3072','512x512','2048x512']]
            requests.append({'custom_size':'1920x1088','aspect_ratio':'16:9'})
            script = """
const fs=require('fs'),vm=require('vm');
const sandbox={window:{SmartCanvasModules:{}}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/image-dimensions.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/model-capabilities.js','utf8'),sandbox);
const {capability,requests}=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(requests.map(parameters=>sandbox.window.SmartCanvasModules.modelCapabilities.validate(capability,{inputs:{text:1},parameters,catalogRevision:capability.catalog_revision}).errors.map(e=>e.code))));
"""
            result = subprocess.run(['node','-e',script],cwd=ROOT,input=json.dumps({'capability':capability,'requests':requests}),text=True,capture_output=True,check=True)
            expected = [registry.validate(capability,input_counts={'text':1},parameters=request,catalog_revision=registry.revision)['errors'] for request in requests]
            self.assertEqual([[error['code'] for error in errors] for errors in expected],json.loads(result.stdout))

    def test_request_preserves_exact_size_and_rejects_stale_disabled_or_mixed_modes(self):
        with tempfile.TemporaryDirectory() as temp:
            registry, _ = custom_catalog(Path(temp) / 'catalog.json')
            provider = dict(id='exact',name='Exact',protocol='openai',base_url='https://example.invalid',image_request_mode='openai',image_models=['gpt-image-2'])
            payload = dict(prompt='test',provider_id='exact',model='gpt-image-2',size='1920x1088',size_mode='custom',catalog_revision=registry.revision)
            with patch.object(main,'MODEL_CAPABILITY_CATALOG',registry), patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'load_api_providers',return_value=[provider]):
                for references in [[], [{'url':'https://example.invalid/reference.png','kind':'image'}]]:
                    run = main._online_image_run(main.OnlineImageRequest(**payload,reference_images=references))
                    self.assertEqual('1920x1088',run.settings['size'])
                    self.assertEqual('custom',run.settings['size_mode'])
                    self.assertFalse(run.settings['target_aspect_ratio'])
                for changes, expected in [({'size':'1920x1080'},'custom_size_multiple'),({'resolution_tier':'2K'},'custom_size_exclusive'),({'target_aspect_ratio':'16:9'},'custom_size_exclusive'),({'catalog_revision':'stale'},'catalog_changed')]:
                    with self.subTest(changes=changes), self.assertRaises(HTTPException) as caught:
                        main._online_image_run(main.OnlineImageRequest(**{**payload,**changes}))
                    self.assertEqual(expected,caught.exception.detail['code'])
                for protocol in ['apimart', 'openai']:
                    with patch.dict(provider, protocol=protocol, base_url='https://api.apimart.ai'):
                        for references in [[], [{'url':'https://example.invalid/ref.png','kind':'image'}]]:
                            run = main._online_image_run(main.OnlineImageRequest(**payload,reference_images=references))
                            self.assertEqual('1920x1088',run.settings['size'])
                            self.assertEqual('custom',run.settings['size_mode'])

    def test_composer_submits_exact_parameters_and_checks_edit_capability(self):
        with tempfile.TemporaryDirectory() as temp:
            registry, _ = custom_catalog(Path(temp) / 'catalog.json')
            capability = registry.resolve('exact', 'gpt-image-2', 'image.generate')
            script = """
const fs=require('fs'),vm=require('vm');
const capability=JSON.parse(fs.readFileSync(0,'utf8'));
const sent=[],operations=[];
const sandbox={window:{SmartCanvasModules:{}},tr:key=>key,
    isApiLikeEngine:()=>true,imageRefsOnly:refs=>refs,sizeForRun:()=>{throw new Error('preset conversion used')},
    fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({task_id:'test'}),text:async()=>''}}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/image-dimensions.js','utf8'),sandbox);
for(const file of ['image-capabilities','model-capabilities','generation-provider']) vm.runInContext(fs.readFileSync('static/js/smart-canvas/'+file+'.js','utf8'),sandbox);
const modules=sandbox.window.SmartCanvasModules;
const validator=modules.modelCapabilities;
modules.modelCapabilities={...validator,load:async(_p,_m,operation)=>{operations.push(operation);return {...capability,media_contract:{...capability.media_contract,supports_custom_resolution:operation==='image.generate'}}}};
modules.imageCapabilities={...modules.imageCapabilities,customMessage:code=>code};
const settings={engine:'api',apiKind:'image',provider_id:'exact',model:'gpt-image-2',ratio:'wide',resolution:'2k',pixelWidth:'1920',pixelHeight:'1088'};
(async()=>{
 await modules.generationProvider.submit({prompt:'test',refs:[],settings});
 let editError='';try{await modules.generationProvider.submit({prompt:'test',refs:[{url:'reference.png'}],settings});}catch(error){editError=error.message}
 console.log(JSON.stringify({sent,operations,editError}));
})().catch(error=>{console.error(error);process.exitCode=1});
"""
            result = subprocess.run(['node','-e',script],cwd=ROOT,input=json.dumps(capability),text=True,capture_output=True,check=True)
            output = json.loads(result.stdout)
            self.assertEqual(['image.generate','image.edit'],output['operations'])
            self.assertEqual('custom_size_unsupported',output['editError'])
            self.assertEqual(1,len(output['sent']))
            payload=output['sent'][0]
            self.assertEqual('1920x1088',payload['size'])
            self.assertEqual('custom',payload['size_mode'])
            self.assertEqual('',payload['target_aspect_ratio'])
            self.assertEqual('',payload['reference_aspect_ratio'])
            self.assertEqual('',payload['resolution_tier'])


class StopBeforeNetwork(Exception):
    pass


class CustomImageTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_size_reaches_json_multipart_and_responses(self):
        for mode, refs in [('openai',False),('openai',True),('openai-json',False),('openai-json',True),('openai-responses',False),('openai-responses',True)]:
            with self.subTest(mode=mode,refs=refs), tempfile.TemporaryDirectory() as temp:
                path=Path(temp)/'reference.png';path.write_bytes(b'fixture')
                provider=dict(id='exact',protocol='openai',base_url='https://example.invalid',image_request_mode=mode)
                captured=[]
                async def post(*args,**kwargs):
                    captured.append(kwargs)
                    raise StopBeforeNetwork()
                async def responses(_client,_url,_headers,body,**_kwargs):
                    captured.append({'json':body})
                    raise StopBeforeNetwork()
                client=Mock();client.post=post
                manager=AsyncMock();manager.__aenter__.return_value=client
                with http_impl.bind_ports(main._PROVIDER_PORTS.http_impl), patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'output_file_from_url',return_value=str(path)), patch.object(main,'reference_to_data_url',return_value='data:image/png;base64,AA=='), patch.object(http_impl,'api_headers',return_value={}), patch.object(http_impl,'responses_input_image_url',new=AsyncMock(return_value='data:image/png;base64,AA==')), patch.object(http_impl,'post_openai_responses',new=responses), patch.object(http_impl.httpx,'AsyncClient',return_value=manager), self.assertRaises(StopBeforeNetwork):
                    await http_impl.generate_http_provider_image('test','1920x1088','high','gpt-image-2',[{'url':'/assets/reference.png'}] if refs else [],'exact',custom_size=True)
                self.assertEqual(1,len(captured))
                request=captured[0]
                size=request['json']['tools'][0]['size'] if mode=='openai-responses' else (request.get('json') or request.get('data'))['size']
                self.assertEqual('1920x1088',size)

    async def test_apimart_exact_dimensions_bypass_ratio_and_tier_conversion(self):
        for custom in [True, False]:
            for refs in [False, True]:
                with self.subTest(custom=custom, refs=refs):
                    provider=dict(id='apimart',protocol='apimart',base_url='https://api.apimart.ai')
                    captured=[]
                    async def post(url, **kwargs):
                        captured.append((url, kwargs['json']))
                        raise StopBeforeNetwork()
                    client=Mock(); client.post=post
                    manager=AsyncMock(); manager.__aenter__.return_value=client
                    with http_impl.bind_ports(main._PROVIDER_PORTS.http_impl), patch.object(main,'get_api_provider',return_value=provider), patch.object(main,'reference_to_data_url',return_value='data:image/png;base64,AA=='), patch.object(http_impl,'api_headers',return_value={}), patch.object(http_impl.httpx,'AsyncClient',return_value=manager), self.assertRaises(StopBeforeNetwork):
                        await http_impl.generate_http_provider_image('test','1920x1088','high','gpt-image-2',[{'url':'/assets/reference.png'}] if refs else [],'apimart',custom_size=custom)
                    self.assertEqual(1,len(captured))
                    url, body=captured[0]
                    self.assertTrue(url.endswith('/v1/images/generations'))
                    self.assertEqual('1920x1088' if custom else '16:9',body['size'])
                    if custom:
                        self.assertNotIn('resolution',body)
                    else:
                        self.assertEqual('2k',body['resolution'])
                    self.assertEqual(refs, 'image_urls' in body)
                    self.assertFalse(body['official_fallback'])
