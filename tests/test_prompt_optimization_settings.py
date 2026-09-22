import tempfile
import unittest
from pathlib import Path
from pydantic import ValidationError
from infinite_canvas.prompt_optimization import PromptOptimizationSettings, load_settings, save_settings

class PromptOptimizationSettingsTests(unittest.TestCase):
    def test_workspace_settings_round_trip_and_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            first=root/'first'/'prompt-optimization.json'
            second=root/'second'/'prompt-optimization.json'
            self.assertEqual(load_settings(first).image.provider, '')
            settings=PromptOptimizationSettings(image={'default_preset':'visual','provider':'studio','model':'image-text','instructions':{'smart':'保留主体'}},video={'default_preset':'camera','provider':'video-studio','model':'video-text','instructions':{'smart':'保持动作连续'}})
            save_settings(first,settings)
            self.assertEqual(load_settings(first),settings)
            self.assertEqual(load_settings(second).image.instructions.smart,'')
            self.assertEqual(list(first.parent.glob('*.tmp')),[])
    def test_unknown_fields_and_oversized_instructions_rejected(self):
        for payload in ({'api_key':'secret'},{'image':{'default_preset':'camera'}},{'video':{'default_preset':'unknown'}},{'image':{'instructions':{'unknown':'x'}}},{'image':{'instructions':{'smart':'x'*6001}}}):
            with self.assertRaises(ValidationError): PromptOptimizationSettings.model_validate(payload)
    def test_legacy_settings_migrate_without_overwriting_file(self):
        import json
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'prompt-optimization.json'
            legacy={'version':1,'provider':'legacy','model':'text','instructions':{'smart':'Custom rule','camera':'Custom motion'}}
            path.write_text(json.dumps(legacy))
            settings=load_settings(path)
            self.assertEqual(settings.version,2)
            self.assertEqual(settings.image.default_preset,'smart')
            self.assertEqual(settings.video.default_preset,'smart')
            self.assertEqual(settings.image.instructions.smart,'Custom rule')
            self.assertEqual(settings.video.instructions.camera,'Custom motion')
            settings.image.instructions.smart='Image only'
            self.assertEqual(settings.video.instructions.smart,'Custom rule')
            self.assertEqual(json.loads(path.read_text()),legacy)
    def test_corruption_is_not_silently_replaced_with_defaults(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'prompt-optimization.json';path.write_text('{bad')
            with self.assertRaises(ValidationError):load_settings(path)

class PromptOptimizationRouteTests(unittest.TestCase):
    def test_admin_write_designer_read_and_validation(self):
        import importlib
        import os
        from fastapi.testclient import TestClient
        from tests.runtime_env import configure_test_workspace, ensure_test_workspace, unload_main
        previous = os.environ.get('INFINITE_CANVAS_STATE_DIR')
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                configure_test_workspace(root/'workspace',root/'state')
                os.environ['INFINITE_CANVAS_STATE_DIR']=str(root/'state')
                unload_main()
                main=importlib.import_module('main')
                main.AUTH_SYSTEM.create_user(username='admin',password='test-admin-password',role='admin')
                main.AUTH_SYSTEM.create_user(username='designer',password='test-designer-password',role='designer')
                with TestClient(main.app) as client:
                    self.assertEqual(client.get('/api/prompt-optimization-settings').status_code,401)
                    self.assertEqual(client.post('/api/auth/login',json={'username':'admin','password':'test-admin-password'}).status_code,200)
                    payload={'version':1,'provider':'configured-provider','model':'text-model','instructions':{'smart':'Keep intent'}}
                    response=client.put('/api/prompt-optimization-settings',json=payload)
                    self.assertEqual(response.status_code,200,response.text)
                    self.assertEqual(client.put('/api/prompt-optimization-settings',json={'image':{'instructions':{'smart':'x'*6001}}}).status_code,422)
                    client.post('/api/auth/logout')
                    client.post('/api/auth/login',json={'username':'designer','password':'test-designer-password'})
                    response=client.get('/api/prompt-optimization-settings')
                    self.assertEqual(response.status_code,200,response.text)
                    self.assertEqual(response.json()['image']['instructions']['smart'],'Keep intent')
                    self.assertEqual(client.put('/api/prompt-optimization-settings',json=payload).status_code,403)
                    self.assertIn(client.get('/static/prompt-optimization-settings.html',follow_redirects=False).status_code,(302,303,307))
                unload_main()
        finally:
            unload_main()
            if previous is None: os.environ.pop('INFINITE_CANVAS_STATE_DIR',None)
            else: os.environ['INFINITE_CANVAS_STATE_DIR']=previous
            ensure_test_workspace()
