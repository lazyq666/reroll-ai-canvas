import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi.testclient import TestClient
from tests import test_main_account_integration as integration
from tests.runtime_env import unload_main, ensure_test_workspace
from infinite_canvas.providers import cli_impl

class OnboardingAdapterTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(ensure_test_workspace)
        self.addCleanup(environment.stop)
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(unload_main)
        self.main,_=integration.MainAccountIntegrationTests._load_main(self.tmp.name)
        self.main.AUTH_SYSTEM.create_initial_admin(username='designer',password='sample-password',start_onboarding=True)
        self.client=TestClient(self.main.app)
        self.addCleanup(lambda: self.client.close())
        self.client.post('/api/auth/login',json={'username':'designer','password':'sample-password'})

    def connect(self,service):
        with patch.object(self.main,'test_provider_connection',AsyncMock(return_value={'ok':True})),patch.object(self.main,'fetch_upstream_models_from_payload',AsyncMock(return_value={'image_models':['gpt-image-2'],'chat_models':[],'video_models':[]})):
            return self.client.post('/api/admin/onboarding/connect',json={'service':service,'api_key':'fixture-key'})

    def test_production_adapter_merges_services_and_persists_keys(self):
        self.assertIn('"stage": "complete"',self.connect('apimart').text)
        first=self.main.get_api_provider_exact('apimart')
        self.assertIn('"stage": "complete"',self.connect('modelscope').text)
        self.assertEqual(first,self.main.get_api_provider_exact('apimart'))
        self.assertEqual('fixture-key',self.main.provider_env_key_value('apimart'))
        self.assertIn('gpt-image-2',self.main.get_api_provider_exact('modelscope')['image_models'])
        self.assertEqual(2,len(self.client.get('/api/admin/onboarding').json()['services']))

    def test_reconnection_replaces_old_enabled_models_for_this_service_only(self):
        self.connect('apimart')
        self.connect('modelscope')
        before=self.main.get_api_provider_exact('modelscope')
        providers=self.main.load_api_providers()
        for provider in providers:
            if provider['id']=='apimart':provider['image_models']=['flux-2']
        self.main.save_api_providers(providers)
        self.assertIn('"stage": "complete"',self.connect('apimart').text)
        self.assertEqual(['gpt-image-2'],self.main.get_api_provider_exact('apimart')['image_models'])
        self.assertEqual(before,self.main.get_api_provider_exact('modelscope'))

    def test_key_changed_during_validation_does_not_become_ready(self):
        async def changed(_payload):
            self.main.update_env_values({self.main.provider_key_env('apimart'):'new-key'})
            self.main.reload_env_globals()
            return {'image_models':['gpt-image-2'],'chat_models':[],'video_models':[]}
        with patch.object(self.main,'test_provider_connection',AsyncMock(return_value={'ok':True})),patch.object(self.main,'fetch_upstream_models_from_payload',changed):
            response=self.client.post('/api/admin/onboarding/connect',json={'service':'apimart','api_key':'old-key'})
        self.assertIn('"stage": "error"',response.text)
        self.assertEqual({},self.client.get('/api/admin/onboarding').json()['services'])
        self.assertEqual('new-key',self.main.provider_env_key_value('apimart'))

    def test_first_setup_endpoint_records_pending_before_restart(self):
        main,workspace=integration.MainAccountIntegrationTests._load_main(self.tmp.name+"/fresh",configured=False)
        with TestClient(main.app) as client:
            self.assertFalse(workspace.exists())
            created=client.post('/api/setup/prepare-directory',json={'workspace_directory':str(workspace)})
            self.assertEqual(200,created.status_code,created.text)
            self.assertTrue(workspace.is_dir())
            inspection=client.post('/api/setup/inspect-workspace',json={'workspace_directory':str(workspace)})
            self.assertEqual('create_admin',inspection.json()['next_step'])
            response=client.post('/api/setup',json={'username':'first-admin','password':'sample-password','workspace_directory':str(workspace)})
            self.assertEqual(200,response.status_code,response.text)
            self.assertTrue(main.AUTH_SYSTEM.onboarding_status()['pending'])
            self.assertEqual('/setup',client.get('/static/canvas-list.html',follow_redirects=False).headers['location'])

    def test_runninghub_validates_account_key_not_public_catalog(self):
        for payload,expected in [({'code':401,'msg':'invalid'},False),({'code':0,'data':{'remainCoins':'1'}},True)]:
            response=httpx.Response(200,json=payload)
            fake=AsyncMock();fake.__aenter__.return_value.post.return_value=response
            with patch.object(self.main.httpx,'AsyncClient',return_value=fake),patch.object(self.main,'provider_env_key_value',return_value='fixture-key'):
                result=asyncio.run(self.main._test_onboarding_provider({'id':'runninghub','base_url':'https://www.runninghub.cn'}))
            self.assertEqual(expected,result['ok'])
            self.assertEqual({'apikey':'fixture-key'},fake.__aenter__.return_value.post.call_args.kwargs['json'])

    def connection_events(self, key='fixture-valid', service='apimart'):
        response = self.client.post('/api/admin/onboarding/connect', json={'service':service,'api_key':key})
        self.assertEqual(200, response.status_code)
        self.assertNotIn(key,response.text)
        return [json.loads(line) for line in response.text.splitlines()]

    def test_wrong_key_then_correct_key(self):
        validate=AsyncMock(side_effect=[{'ok':False},{'ok':True}])
        discover=AsyncMock(return_value={'image_models':['gpt-image-2'],'video_models':[],'chat_models':[]})
        with patch.object(self.main,'test_provider_connection',validate),patch.object(self.main,'fetch_upstream_models_from_payload',discover):
            self.assertEqual('connection_failed',self.connection_events('fixture-invalid')[-1]['code'])
            self.assertEqual(0,discover.await_count)
            self.assertEqual({},self.client.get('/api/admin/onboarding').json()['services'])
            self.assertEqual(409,self.client.post('/api/admin/onboarding/complete',json={}).status_code)
            self.assertEqual('complete',self.connection_events('fixture-corrected')[-1]['stage'])
            self.assertEqual(1,discover.await_count)
            self.assertEqual('fixture-corrected',self.main.provider_env_key_value('apimart'))
            for call in validate.await_args_list:
                self.assertEqual('https://api.apimart.ai/v1',call.args[0].base_url)
                self.assertEqual('apimart',call.args[0].protocol)
            self.assertEqual(1,self.client.get('/api/admin/onboarding').json()['services']['apimart']['count'])

    def test_full_reload_preserves_ready_then_completion(self):
        self.connect('apimart')
        self.client.close()
        self.main,_=integration.MainAccountIntegrationTests._load_main(self.tmp.name)
        self.client=TestClient(self.main.app)
        self.client.post('/api/auth/login',json={'username':'designer','password':'sample-password'})
        status=self.client.get('/api/admin/onboarding').json()
        self.assertTrue(status['pending'])
        self.assertEqual(1,status['services']['apimart']['count'])
        self.assertEqual('fixture-key',self.main.provider_env_key_value('apimart'))
        response=self.client.post('/api/admin/onboarding/complete',json={})
        self.assertEqual(200,response.status_code)
        self.assertEqual('/static/canvas-list.html',response.json()['next_url'])
        self.client.close()
        self.main,_=integration.MainAccountIntegrationTests._load_main(self.tmp.name)
        self.client=TestClient(self.main.app)
        self.client.post('/api/auth/login',json={'username':'designer','password':'sample-password'})
        self.assertFalse(self.client.get('/api/admin/onboarding').json()['pending'])
        self.assertEqual(200,self.client.get('/static/canvas-list.html',follow_redirects=False).status_code)
        self.assertEqual(409,self.client.post('/api/admin/onboarding/connect',json={'service':'apimart','api_key':'fixture-key'}).status_code)

    def test_three_hundred_discovered_only_six_enabled(self):
        images=[f'flux-unrelated-{i}' for i in range(290)]+['gpt-image-2','nano-banana-pro']
        videos=['seedance-1.5-pro','seedance-2.0-pro']
        chats=['gpt-5.4','gpt-5.5','gemini-2.5-pro','gemini-3-flash','gemini-3.1-pro','gemini-3.1-pro-20260101']
        all_models=images+videos+chats
        self.assertEqual(300,len(all_models))
        catalog={'image_models':images,'video_models':videos,'chat_models':chats,'model_protocols':{model:'openai' for model in all_models}}
        with patch.object(self.main,'test_provider_connection',AsyncMock(return_value={'ok':True})),patch.object(self.main,'fetch_upstream_models_from_payload',AsyncMock(return_value=catalog)):
            result=self.connection_events()[-1]
        self.assertEqual('complete',result['stage'])
        self.assertEqual(6,result['count'])
        provider=self.main.get_api_provider_exact('apimart')
        self.assertEqual(['gpt-image-2','nano-banana-pro'],provider['image_models'])
        self.assertEqual(['seedance-2.0-pro'],provider['video_models'])
        self.assertEqual(['gpt-5.5','gemini-3.1-pro','gemini-3-flash'],provider['chat_models'])
        self.assertEqual(6,len(provider['model_protocols']))

    def test_failed_reconnect_invalidates_only_target(self):
        self.connect('apimart')
        self.connect('modelscope')
        before=self.main.get_api_provider_exact('modelscope')
        with patch.object(self.main,'test_provider_connection',AsyncMock(return_value={'ok':False})):
            self.assertEqual('connection_failed',self.connection_events('fixture-new-invalid')[-1]['code'])
        self.assertEqual(before,self.main.get_api_provider_exact('modelscope'))
        self.assertEqual({'modelscope'},set(self.client.get('/api/admin/onboarding').json()['services']))
        self.assertEqual(200,self.client.post('/api/admin/onboarding/complete',json={}).status_code)


    def test_antigravity_actual_auto_catalog_connects_and_completes(self):
        catalog = cli_impl.gemini_cli_models_payload()
        self.assertEqual(['auto'], catalog['image_models'])
        self.assertEqual(['auto'], catalog['chat_models'])
        with patch.object(self.main._PROVIDER_INSPECTORS, 'status', AsyncMock(return_value={
            'installed': True, 'logged_in': True, 'version_ok': True,
        })), patch.object(self.main, 'test_provider_connection', AsyncMock(return_value={'ok': True})), patch.object(
            self.main, 'fetch_upstream_models_from_payload', AsyncMock(return_value=catalog),
        ):
            response = self.client.post('/api/admin/onboarding/connect', json={'service': 'gemini-cli'})
        self.assertEqual(200, response.status_code)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual('complete', events[-1]['stage'])
        self.assertEqual(1, events[-1]['count'])
        provider = self.main.get_api_provider_exact('gemini-cli')
        self.assertEqual(['auto'], provider['image_models'])
        self.assertEqual(['auto'], provider['chat_models'])
        self.assertEqual([], provider['video_models'])
        self.assertTrue(provider['enabled'])
        self.assertEqual(200, self.client.post('/api/admin/onboarding/complete', json={}).status_code)

    def test_antigravity_auto_still_requires_installed_current_and_logged_in_cli(self):
        cases = [
            ({'installed': False, 'logged_in': True}, 'not_installed'),
            ({'installed': True, 'logged_in': True, 'version_ok': False}, 'cli_outdated'),
            ({'installed': True, 'logged_in': False}, 'login_required'),
            ({'installed': True, 'logged_in': None}, 'login_unverified'),
        ]
        for status, expected in cases:
            with self.subTest(expected=expected), patch.object(
                self.main._PROVIDER_INSPECTORS, 'status', AsyncMock(return_value=status),
            ), patch.object(self.main, 'test_provider_connection', AsyncMock(return_value={'ok': True})) as verify, patch.object(
                self.main, 'fetch_upstream_models_from_payload', AsyncMock(return_value=cli_impl.gemini_cli_models_payload()),
            ) as discover:
                response = self.client.post('/api/admin/onboarding/connect', json={'service': 'gemini-cli'})
                self.assertEqual(expected, json.loads(response.text.splitlines()[-1])['code'])
                verify.assert_not_awaited()
                discover.assert_not_awaited()
                self.assertEqual({}, self.client.get('/api/admin/onboarding').json()['services'])
                self.assertEqual(409, self.client.post('/api/admin/onboarding/complete', json={}).status_code)

    def test_http_auto_catalog_does_not_use_antigravity_exception(self):
        with patch.object(self.main, 'test_provider_connection', AsyncMock(return_value={'ok': True})), patch.object(
            self.main, 'fetch_upstream_models_from_payload', AsyncMock(return_value=cli_impl.gemini_cli_models_payload()),
        ):
            result = self.connection_events(service='apimart')[-1]
        self.assertEqual('no_recommended_models', result['code'])
        provider = next(provider for provider in self.main.load_api_providers() if provider['id'] == 'apimart')
        self.assertFalse(provider['enabled'])
        self.assertEqual(409, self.client.post('/api/admin/onboarding/complete', json={}).status_code)

if __name__=='__main__':unittest.main()
