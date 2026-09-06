import importlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from infinite_canvas.media_cleanup import WorkspaceMediaCleanup
from tests.runtime_env import configure_test_workspace, unload_main


class MediaCleanupHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.workspace = root / 'workspace'
        state = root / 'state'
        self.environment = patch.dict(os.environ, {
            'INFINITE_CANVAS_STATE_DIR': str(state),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        configure_test_workspace(self.workspace, state)
        unload_main()
        self.main = importlib.import_module('main')
        self.addCleanup(unload_main)
        self.main.AUTH_SYSTEM.create_user(username='cleanup-admin', password='cleanup-password', role='admin')
        self.main.AUTH_SYSTEM.create_user(username='cleanup-designer', password='cleanup-password', role='designer')
        self.main.MEDIA_CLEANUP = WorkspaceMediaCleanup(now=lambda: time.time() + 60)
        self.client = TestClient(self.main.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.login('cleanup-admin')

    def login(self, name):
        self.assertEqual(200, self.client.post('/api/auth/login', json={
            'username': name, 'password': 'cleanup-password',
        }).status_code)

    def scan(self):
        return self.client.post('/api/workspace-storage-settings/cleanup/scan')

    def test_admin_preview_confirmation_and_no_internal_paths(self):
        media = self.workspace / 'assets/output/orphan.png'
        media.parent.mkdir(parents=True, exist_ok=True)
        media.write_bytes(b'unreferenced')
        scanned = self.scan()
        self.assertEqual(200, scanned.status_code, scanned.text)
        self.assertEqual(1, scanned.json()['file_count'])
        self.assertNotIn('orphan.png', scanned.text)
        self.assertTrue(media.exists())
        cleaned = self.client.post('/api/workspace-storage-settings/cleanup/confirm', json={'scan_id': scanned.json()['scan_id']})
        self.assertEqual(200, cleaned.status_code, cleaned.text)
        self.assertEqual(1, cleaned.json()['file_count'])
        self.assertFalse(media.exists())

    def test_generation_busy_and_invalid_plan_are_localizable(self):
        with patch.object(self.main, 'active_generation_run_count', return_value=1):
            response = self.scan()
        self.assertEqual(409, response.status_code)
        self.assertEqual('media_cleanup_busy', response.json()['detail']['code'])
        response = self.client.post('/api/workspace-storage-settings/cleanup/confirm', json={'scan_id': '0' * 32})
        self.assertEqual('media_cleanup_expired', response.json()['detail']['code'])

    def test_corrupt_references_fail_closed(self):
        (self.workspace / 'data/broken.json').write_text('{broken')
        response = self.scan()
        self.assertEqual(409, response.status_code)
        self.assertEqual('media_cleanup_unreadable', response.json()['detail']['code'])

    def test_only_admin_can_scan_or_confirm(self):
        self.login('cleanup-designer')
        self.assertEqual(403, self.scan().status_code)
        self.assertEqual(403, self.client.post('/api/workspace-storage-settings/cleanup/confirm', json={'scan_id': '0' * 32}).status_code)
        self.client.cookies.clear()
        self.assertEqual(401, self.scan().status_code)


if __name__ == '__main__':
    unittest.main()
