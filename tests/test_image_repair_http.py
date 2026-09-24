import importlib
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from PIL import Image
from fastapi.testclient import TestClient
from tests.runtime_env import configure_test_workspace, unload_main
from tests.test_layered_psd import _parse_layer_records


class ImageRepairHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_state = os.environ.get('INFINITE_CANVAS_STATE_DIR')
        root = Path(self.temp.name)
        self.workspace, state = root / 'workspace', root / 'state'
        configure_test_workspace(self.workspace, state)
        os.environ['INFINITE_CANVAS_STATE_DIR'] = str(state)
        unload_main()
        self.main = importlib.import_module('main')
        for username, role in [('administrator', 'admin'), ('designer', 'designer'), ('visitor', 'guest')]:
            self.main.AUTH_SYSTEM.create_user(username=username, password='test-password', role=role)
        output = self.workspace / 'assets' / 'output'
        output.mkdir(parents=True, exist_ok=True)
        Image.new('RGBA', (100, 80), (0, 0, 255, 255)).save(output / 'source.png')
        Image.new('RGBA', (20, 20), (255, 0, 0, 255)).save(output / 'patch.png')
        self.recipe = dict(version=1, width=100, height=80,
                           source={'url': '/assets/output/source.png'}, patch={'url': '/assets/output/patch.png'},
                           crop=dict(x=20, y=20, width=20, height=20),
                           transform=dict(x=20, y=20, width=20, height=20), feather=5)
        self.client = TestClient(self.main.app).__enter__()
        self.login('designer')
        created = self.client.post('/api/canvases', json={'title': 'Repair', 'kind': 'smart'})
        self.assertEqual(200, created.status_code, created.text)
        self.canvas_id = created.json()['canvas']['id']
        self.base = f'/api/canvases/{self.canvas_id}/image-repairs/result'
        with self.client.websocket_connect(f'/ws/canvases/{self.canvas_id}?layout_gap=64&client_id=repair-test') as socket:
            snapshot = socket.receive_json()
            socket.send_json({'type': 'canvas_mutation', 'canvas_id': self.canvas_id, 'operation': {
                'operation_id': 'repair:create', 'base_revision': snapshot['revision'],
                'changes': {'node_creates': [{'id': 'result', 'type': 'smart-image', 'images': [{
                    'url': '/assets/output/composite.png', 'kind': 'image', 'local_repair': self.recipe,
                }]}]},
            }})
            while socket.receive_json().get('type') != 'canvas_mutation':
                pass
        self.body = dict(image_index=0, expected_url='/assets/output/composite.png',
                         transform=dict(x=30, y=25, width=40, height=40), feather=8)

    def login(self, username):
        self.client.cookies.clear()
        response = self.client.post('/api/auth/login', json={'username': username, 'password': 'test-password'})
        self.assertEqual(200, response.status_code, response.text)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        unload_main()
        if self.previous_state is None:
            os.environ.pop('INFINITE_CANVAS_STATE_DIR', None)
        else:
            os.environ['INFINITE_CANVAS_STATE_DIR'] = self.previous_state
        self.temp.cleanup()

    def test_render_uses_saved_sources_and_does_not_overwrite_canvas(self):
        before = self.client.get(f'/api/canvases/{self.canvas_id}').json()
        response = self.client.post(self.base + '/render', json={**self.body, 'source': {'url': '/assets/wrong.png'}})
        self.assertEqual(200, response.status_code, response.text)
        media = response.json()['image']
        self.assertEqual(self.recipe['source'], media['local_repair']['source'])
        self.assertEqual(self.body['transform'], media['local_repair']['transform'])
        with Image.open(self.main.output_file_from_url(media['url'])) as image:
            self.assertEqual((100, 80), image.size)
            self.assertEqual((0, 0, 255, 255), image.getpixel((0, 0)))
            self.assertEqual((255, 0, 0, 255), image.getpixel((50, 45)))
        self.assertEqual(before, self.client.get(f'/api/canvases/{self.canvas_id}').json())

    def test_export_has_original_and_feathered_patch_and_no_canvas_changes(self):
        before = self.client.get(f'/api/canvases/{self.canvas_id}').json()
        response = self.client.post(self.base + '/psd', json={'source_name': '原图', 'patch_name': '修复图'})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual('image/vnd.adobe.photoshop', response.headers['content-type'])
        header, records = _parse_layer_records(response.content)
        self.assertEqual((100, 80), (header['width'], header['height']))
        self.assertEqual(['原图', '修复图'], [record['name'] for record in records])
        self.assertEqual((20, 20, 40, 40), records[1]['bounds'])
        with Image.open(BytesIO(response.content)) as image:
            self.assertEqual((26, 0, 229, 255), image.convert('RGBA').getpixel((20, 20)))
        self.assertEqual(before, self.client.get(f'/api/canvases/{self.canvas_id}').json())

    def test_conflict_invalid_geometry_and_missing_media_fail_cleanly(self):
        response = self.client.post(self.base + '/render', json={**self.body, 'expected_url': '/assets/stale.png'})
        self.assertEqual(409, response.status_code)
        response = self.client.post(self.base + '/render', json={**self.body, 'transform': {**self.body['transform'], 'width': 999999}})
        self.assertEqual(422, response.status_code)
        self.assertEqual(404, self.client.post(self.base + '/psd', json={'image_index': 20}).status_code)
        (self.workspace / 'assets/output/patch.png').unlink()
        response = self.client.post(self.base + '/psd', json={})
        self.assertEqual(422, response.status_code)
        self.assertTrue(response.headers['content-type'].startswith('application/json'))

    def test_both_endpoints_recheck_edit_access(self):
        for username, status in [('visitor', 403), (None, 401)]:
            if username:
                self.login(username)
            else:
                self.client.cookies.clear()
            for suffix, body in [('/render', self.body), ('/psd', {})]:
                with self.subTest(username=username, endpoint=suffix):
                    response = self.client.post(self.base + suffix, json=body)
                    self.assertEqual(status, response.status_code, response.text)

    def test_generation_freezes_repair_and_rejects_multiple_outputs(self):
        provider = dict(id='apimart', name='APIMart', base_url='https://api.apimart.ai',
                        protocol='apimart', image_request_mode='openai', image_models=['gpt-image-2'])
        payload = self.main.OnlineImageRequest(
            prompt='repair', provider_id='apimart', model='gpt-image-2',
            target_aspect_ratio='1:1', resolution_tier='1K', canvas_id=self.canvas_id,
            reference_images=[{'url': '/assets/output/patch.png', 'kind': 'image'}],
            catalog_revision=self.main.MODEL_CAPABILITY_CATALOG.revision, local_repair=self.recipe,
        )
        with (patch.object(self.main, 'get_api_provider', return_value=provider),
              patch.object(self.main, 'load_api_providers', return_value=[provider]),
              patch.object(self.main, 'require_current_user', return_value={'id': 'designer', 'role': 'designer'}),
              patch.object(self.main, 'load_canvas', return_value={'id': self.canvas_id})):
            run = self.main._online_image_run(payload)
            self.assertEqual('image.edit', run.settings['operation'])
            self.assertEqual(1, run.count)
            self.assertEqual(self.recipe['source'], run.settings['local_repair']['source'])
            self.assertNotIn('patch', run.settings['local_repair'])
            payload.local_repair['crop']['x'] = 99
            self.assertEqual(20, run.settings['local_repair']['crop']['x'])
            payload.n = 2
            with self.assertRaises(HTTPException) as rejected:
                self.main._online_image_run(payload)
            self.assertEqual(422, rejected.exception.status_code)
