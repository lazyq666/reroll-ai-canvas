import asyncio
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi.testclient import TestClient
from tests import test_main_account_integration as integration
from tests.runtime_env import unload_main, ensure_test_workspace

class OnboardingAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.main,_=integration.MainAccountIntegrationTests._load_main(self.tmp.name)
        self.main.AUTH_SYSTEM.create_initial_admin(username='designer',password='sample-password',start_onboarding=True)
        self.client=TestClient(self.main.app)
        self.client.post('/api/auth/login',json={'username':'designer','password':'sample-password'})

    def tearDown(self):
        self.client.close();unload_main();self.tmp.cleanup();ensure_test_workspace()

    def connect(self,service):
        with patch.object(self.main,'test_provider_connection',AsyncMock(return_value={'ok':True})),patch.object(self.main,'fetch_upstream_models_from_payload',AsyncMock(return_value={'image_models':['fixture-image'],'chat_models':[],'video_models':[]})):
            return self.client.post('/api/admin/onboarding/connect',json={'service':service,'api_key':'fixture-key'})

    def test_production_adapter_merges_services_and_persists_keys(self):
        self.assertIn('"stage": "complete"',self.connect('apimart').text)
        first=self.main.get_api_provider_exact('apimart')
        self.assertIn('"stage": "complete"',self.connect('modelscope').text)
        self.assertEqual(first,self.main.get_api_provider_exact('apimart'))
        self.assertEqual('fixture-key',self.main.provider_env_key_value('apimart'))
        self.assertIn('fixture-image',self.main.get_api_provider_exact('modelscope')['image_models'])
        self.assertEqual(2,len(self.client.get('/api/admin/onboarding').json()['services']))

    def test_key_changed_during_validation_does_not_become_ready(self):
        async def changed(_payload):
            self.main.update_env_values({self.main.provider_key_env('apimart'):'new-key'})
            self.main.reload_env_globals()
            return {'image_models':['fixture-image'],'chat_models':[],'video_models':[]}
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

if __name__=='__main__':unittest.main()
