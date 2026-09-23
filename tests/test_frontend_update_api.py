import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()


class FrontendUpdateApiTests(unittest.TestCase):
    def test_app_info_keeps_version_and_returns_live_uncached_inventory_revision(self):
        main = importlib.import_module('main')
        with tempfile.TemporaryDirectory() as tmp, patch.object(main, 'STATIC_DIR', tmp):
            manifest = Path(tmp) / 'frontend-assets.json'
            manifest.write_text(json.dumps({'assets': {'test.js': 'old'}}))
            user = main.AUTH_SYSTEM.create_user(username='frontend-update-api', password='test-password', role='admin')
            with TestClient(main.app) as client:
                client.post('/api/auth/login', json={'username': user['username'], 'password': 'test-password'})
                first = client.get('/api/app-info')
                self.assertEqual(first.status_code, 200)
                self.assertEqual(first.headers['cache-control'], 'no-store')
                self.assertEqual(first.json()['version'], main.current_app_version())
                self.assertEqual(len(first.json()['frontend_revision']), 64)
                manifest.write_text(json.dumps({'assets': {'test.js': 'new'}}))
                second = client.get('/api/app-info')
                self.assertNotEqual(first.json()['frontend_revision'], second.json()['frontend_revision'])
                for index in range(2):
                    designer = main.AUTH_SYSTEM.create_user(username=f'frontend-update-designer-{index}', password='test-password', role='designer')
                    peer = TestClient(main.app)
                    try:
                        peer.post('/api/auth/login', json={'username': designer['username'], 'password': 'test-password'})
                        self.assertEqual(peer.get('/api/app-info').json(), second.json())
                    finally:
                        peer.close()
                manifest.unlink()
                self.assertEqual(client.get('/api/app-info').json()['frontend_revision'], '')


if __name__ == '__main__':
    unittest.main()
