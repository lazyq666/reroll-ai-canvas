import asyncio
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, Mock, patch

from infinite_canvas.local_generation_submissions import LocalGenerationSubmissions, LocalSubmissionJournal
from tests import test_media_cleanup_http as http_fixtures


class LocalGenerationHttpTests(TestCase):
    def setUp(self):
        fixture = http_fixtures.MediaCleanupHttpTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture, self.main, self.client = fixture, fixture.main, fixture.client
        created = self.client.post('/api/canvases', json={'title': 'Local submission fixture', 'kind': 'smart'})
        self.assertEqual(created.status_code, 200, created.text)
        self.canvas_id = created.json()['canvas']['id']
        self.cloud = Mock()
        self.cloud.public.return_value = {'status': 'connected'}
        self.cloud_patch = patch.object(self.main, 'CLOUD_WORKSPACE_RUNTIME', self.cloud)
        self.cloud_patch.start()
        self.addCleanup(self.cloud_patch.stop)
        self.prepare_started = self.client.portal.call(asyncio.Event)
        self.release = self.client.portal.call(asyncio.Event)
        self.submitted = []

        async def prepare(record):
            self.prepare_started.set()
            await self.release.wait()
            await self.main._prepare_local_generation(record)

        async def dispatch(record):
            actor = self.main._local_generation_actor(record)
            document = await asyncio.to_thread(self.main.CANVAS_SYNC.read, record['canvas_id'], actor, smart_snapshot=True)
            target = next(node for node in document['nodes'] if node['id'] == record['command']['payload']['node_id'])
            self.assertEqual(target['generationOperationId'], record['operation_id'])
            self.submitted.append(record['operation_id'])
            return {'task_id': 'run-' + record['operation_id'], 'status': 'queued'}

        self.service = LocalGenerationSubmissions(
            journal=LocalSubmissionJournal(Path(self.main.DEVICE_STATE_DIR) / 'test-submissions.sqlite3'),
            workspace_id=self.main.current_workspace_id(), prepare=prepare,
            dispatch=dispatch, reconcile=AsyncMock(return_value=None),
        )
        self.service_patch = patch.object(self.main, '_LOCAL_GENERATION_SUBMISSIONS', self.service)
        self.service_patch.start()
        self.addCleanup(self.service_patch.stop)
        self.main.generation_run_control.install_submissions(self.service)
        self.addCleanup(self.main.generation_run_control.install_submissions, None)
        self.addCleanup(self.client.portal.call, self.service.close)

    def command(self, operation='first', endpoint='/api/canvas-image-tasks'):
        target = {'id': operation, 'type': 'smart-image', 'x': 0 if operation == 'first' else 450, 'y': 0, 'images': [],
                  'generationOperationId': operation, 'generationInputSnapshot': {'prompt': operation}}
        return {
            'workspace_id': self.main.current_workspace_id(), 'canvas_id': self.canvas_id,
            'actor_id': self.client.get('/api/auth/me').json()['user']['id'],
            'operation_id': operation, 'target_ids': [operation], 'endpoint': endpoint,
            'payload': {'canvas_id': self.canvas_id, 'node_id': operation, 'generation_operation_id': operation,
                        'prompt': operation, 'model': 'test', 'provider_id': 'test'},
            'checkpoints': [{'operation_id': 'checkpoint-' + operation, 'base_revision': 0,
                             'changes': {'node_creates': [target]}}],
        }

    def stage(self, command):
        return self.client.post('/api/local-generation-submissions', json=command)

    def finish(self, record):
        self.client.portal.call(self.release.set)

        async def wait():
            await asyncio.wait_for(self.service._tasks[record['id']], 2)

        self.client.portal.call(wait)
        return self.client.get('/api/local-generation-submissions/' + record['id'])

    def test_local_receipt_precedes_actual_canvas_commit_for_image_and_video(self):
        first = self.stage(self.command())
        self.assertEqual(first.status_code, 200, first.text)
        second = self.stage(self.command('second', '/api/canvas-video-tasks'))
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(self.submitted, [])
        self.assertEqual(self.main.active_generation_run_count(), 2)
        document = self.client.get('/api/canvases/' + self.canvas_id).json()['canvas']
        self.assertEqual(document['nodes'], [])
        self.assertEqual(self.finish(first.json()).json()['status'], 'accepted')
        self.assertEqual(self.finish(second.json()).json()['status'], 'accepted')
        self.assertEqual(set(self.submitted), {'first', 'second'})
        self.assertEqual(self.main.active_generation_run_count(), 0)

    def test_immutable_canvas_operation_can_also_arrive_from_the_browser(self):
        body = self.command()
        first = self.stage(body).json()
        actor = self.main.AUTH_SYSTEM.get_user(self.main.AUTH_SYSTEM.list_users()[0]['id'])

        async def commit():
            return await self.main.CANVAS_SYNC.commit_staged_operation(self.canvas_id, actor, body['checkpoints'][0])

        self.client.portal.call(commit)
        self.assertEqual(self.finish(first).json()['status'], 'accepted')
        document = self.client.get('/api/canvases/' + self.canvas_id).json()['canvas']
        self.assertEqual(len(document['nodes']), 1)
        self.assertEqual(document['revision'], 1)

    def test_validation_and_identity_scope_do_not_leak_another_accounts_record(self):
        body = self.command()
        body['workspace_id'] = 'another-workspace'
        self.assertEqual(self.stage(body).status_code, 409)
        body = self.command()
        body['payload']['api_key'] = 'synthetic-secret'
        self.assertEqual(self.stage(body).status_code, 422)
        body = self.command()
        body['actor_id'] = 'another-account'
        self.assertEqual(self.stage(body).status_code, 403)
        body = self.command()
        body['endpoint'] = '/api/workspace-storage-settings/cloud'
        self.assertEqual(self.stage(body).status_code, 422)
        record = self.stage(self.command()).json()
        self.fixture.login('cleanup-designer')
        self.assertEqual(self.client.get('/api/local-generation-submissions/' + record['id']).status_code, 404)
        self.assertEqual(self.client.post('/api/local-generation-submissions/' + record['id'] + '/retry').status_code, 404)

    def test_permission_is_rechecked_after_local_acceptance(self):
        record = self.stage(self.command()).json()
        with patch.object(self.main.AUTH_SYSTEM, 'get_user', return_value=None):
            result = self.finish(record)
        self.assertEqual(result.json()['status'], 'failed')
        self.assertEqual(result.json()['error'], 'local_generation_permission_lost')
        self.assertEqual(self.submitted, [])

    def test_storage_switch_counts_the_local_pending_commands(self):
        self.stage(self.command())
        with patch.object(self.main, '_RUNTIME_ASYNC_RESTART_REQUESTER', AsyncMock()):
            response = self.client.post('/api/workspace-storage-settings/cloud', json={'enabled': False})
        self.assertEqual(response.json()['code'], 'cloud_storage_tasks_pending')
