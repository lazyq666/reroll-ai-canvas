import asyncio
import importlib
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from infinite_canvas.generation_runs import Inline, WorkflowRun
from infinite_canvas.media_cleanup import WorkspaceMediaCleanup
from tests.runtime_env import configure_test_workspace, unload_main
from tests.test_music_record_deletion import FailedMusicExecutor


class MusicRecordDeletionHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.workspace, state = root / 'workspace', root / 'state'
        environment = patch.dict(os.environ, {'INFINITE_CANVAS_STATE_DIR': str(state)})
        environment.start()
        self.addCleanup(environment.stop)
        configure_test_workspace(self.workspace, state)
        unload_main()
        self.main = importlib.import_module('main')
        self.addCleanup(unload_main)
        for name, role in [('admin', 'admin'), ('owner', 'designer'), ('other', 'designer'), ('guest', 'guest')]:
            self.main.AUTH_SYSTEM.create_user(username='music-' + name, password='music-password', role=role)
        self.main.MEDIA_CLEANUP = WorkspaceMediaCleanup(now=lambda: time.time() + 60)
        self.executor = FailedMusicExecutor()
        self.main._GENERATION_RUNS._executor = self.executor
        self.client = TestClient(self.main.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.login('owner')
        owner = self.client.get('/api/auth/me').json()['user']['id']
        self.path = self.workspace / 'assets/input/private.wav'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(b'private audio')
        async def create():
            run = await self.main._GENERATION_RUNS.start(WorkflowRun('suno-cover', {'body': {'prompt': 'private prompt'}}, provider_id='test'),
                owner=str(owner), key='delete-fixture', delivery=Inline(), public_metadata={'surface': 'suno', 'operation': 'cover',
                    'params': {'title': 'private title'}, 'references': [{'url': '/assets/input/private.wav', 'name': 'private.wav'}]})
            await self.main._GENERATION_RUNS.wait_for_lifecycle_projection(through_current=True)
            return run.id
        self.run_id = self.client.portal.call(create)
        self.url = '/api/music/runs/' + self.run_id

    def login(self, user):
        self.assertEqual(self.client.post('/api/auth/login', json={'username': 'music-' + user, 'password': 'music-password'}).status_code, 200)

    def test_owner_deletes_through_real_gate_other_owners_and_guest_are_rejected(self):
        self.login('other')
        self.assertEqual(self.client.delete(self.url).status_code, 404)
        self.assertTrue(self.path.exists())
        self.login('guest')
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.client.cookies.clear()
        self.assertEqual(self.client.delete(self.url).status_code, 401)
        self.login('owner')
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['file_count'], 1)
        self.assertNotIn('private.wav', response.text)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.client.get('/api/music/history').json()['items'], [])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get(self.url + '/references/0').status_code, 404)
        self.assertEqual(self.client.delete(self.url).status_code, 200, 'A response lost after deletion can be retried')
        self.assertEqual(self.executor.calls, 1)

    def test_busy_and_unreadable_failures_keep_record_and_file(self):
        with patch.object(self.main, 'active_generation_run_count', return_value=1):
            response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail']['code'], 'music.deleteBusy')
        (self.workspace / 'data/broken.json').write_text('{broken')
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail']['code'], 'music.deleteCheckFailed')
        self.assertTrue(self.path.exists())
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_cloud_authority_cannot_run_local_only_reclamation(self):
        with patch.object(self.main, 'CLOUD_WORKSPACE_RUNTIME', SimpleNamespace(require_active=lambda: None)):
            response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail']['code'], 'music.deleteCloudUnsupported')
        self.assertTrue(self.path.exists())
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_cancelled_request_holds_gate_until_file_work_finishes(self):
        async def check():
            started, release, admitted = asyncio.Event(), asyncio.Event(), asyncio.Event()
            async def held_deletion(**options):
                started.set()
                await release.wait()
                return {'deleted': True}
            async def another_request():
                async with self.main.MEDIA_CLEANUP_GATE.activity():
                    admitted.set()
            with patch.object(self.main, 'delete_failed_music_record', held_deletion):
                task = asyncio.create_task(self.main._delete_music_record(self.run_id, 'fixture'))
                await started.wait()
                task.cancel()
                waiter = asyncio.create_task(another_request())
                await asyncio.sleep(0)
                self.assertFalse(admitted.is_set(), 'A disconnected client cannot reopen traffic during file deletion')
                self.assertFalse(task.done())
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                await waiter
                self.assertTrue(admitted.is_set())
        self.client.portal.call(check)


if __name__ == '__main__':
    unittest.main()
