import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from infinite_canvas.turso_sqlite import TursoError
from tests import test_media_cleanup_http as http_fixtures


class CloudStorageHttpTests(unittest.TestCase):
    def setUp(self):
        self.fixture = http_fixtures.MediaCleanupHttpTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.main, self.client = self.fixture.main, self.fixture.client

    def select(self, enabled=True):
        return self.client.post('/api/workspace-storage-settings/cloud', json={'enabled': enabled})

    def test_local_default_and_admin_only_no_implicit_migration(self):
        result = self.client.get('/api/workspace-storage-settings').json()['cloud_records']
        self.assertFalse(result['enabled'])
        self.assertFalse(result['prepared'])
        self.assertEqual(self.select().json()['code'], 'cloud_storage_restart_required')
        self.fixture.login('cleanup-designer')
        self.assertEqual(self.select().status_code, 403)

    def test_active_work_is_not_cancelled_by_switch(self):
        requester = AsyncMock()
        with patch.object(self.main, '_RUNTIME_ASYNC_RESTART_REQUESTER', requester), patch.object(self.main, 'active_generation_run_count', return_value=1):
            response = self.select()
        self.assertEqual(response.json()['code'], 'cloud_storage_tasks_pending')
        requester.assert_not_awaited()

    def test_preparation_failure_leaves_original_admission_available(self):
        async def restart(**_):
            try:
                await self.main.prepare_controlled_restart()
            except TursoError:
                return {'stage': 'ready'}
        with patch.object(self.main, '_RUNTIME_ASYNC_RESTART_REQUESTER', restart):
            result = self.select()
        self.assertEqual(result.json()['code'], 'cloud_storage_configuration_required')
        self.assertFalse(self.main.CLOUD_TRANSITION_PUBLISHED)
        self.assertIsNone(self.main.PENDING_CLOUD_SWITCH)
        self.assertEqual(self.client.get('/api/workspace-storage-settings').status_code, 200)

    def test_published_transition_blocks_old_http_and_retains_login(self):
        self.main.CLOUD_TRANSITION_PUBLISHED = True
        self.assertEqual(self.client.get('/api/workspace-storage-settings').json()['code'], 'cloud_storage_restart_required')
        self.fixture.login('cleanup-admin')
        self.assertEqual(self.client.post('/api/workspace-storage-settings/cleanup/scan').json()['code'], 'cloud_storage_restart_required')


if __name__ == '__main__':
    unittest.main()
