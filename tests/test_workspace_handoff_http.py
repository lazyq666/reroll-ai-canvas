import asyncio
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from infinite_canvas.app import create_app
from infinite_canvas.runtime import ApplicationRuntime, RuntimeStage, RuntimeStartup
from infinite_canvas.workspace_handoff import HandoffError


class Authorization:
    def role_for_session(self, token):
        return {'admin': 'admin', 'designer': 'designer'}.get(token, '')


class Controller:
    error = None
    stopped = 0
    def check_handoff(self):
        if self.error: raise HandoffError(self.error)
    async def close_handoff_connections(self):
        pass
    async def prepare_handoff(self):
        self.stopped += 1
        return {'state': 'sealed', 'id': 'a' * 32}


class HandoffHttpTests(unittest.TestCase):
    def test_close_conflict_keeps_details_available_without_recovery_or_restart(self):
        class Conflicting(Controller):
            async def prepare_handoff(self):
                raise HandoffError('conflict')
            def handoff_conflicts(self):
                return {'files': [{'path': '.infinite-canvas-service/handoff-PC.json'}], 'can_archive': True}
        client, runtime, _ = self.setup_app(Conflicting())
        self.assertEqual(409, client.post('/api/runtime/handoff').status_code)
        details = client.post('/api/runtime/handoff/conflicts', json={})
        self.assertEqual(200, details.status_code)
        self.assertIn('handoff-PC.json', details.text)
        self.assertFalse(details.json()['can_archive'])
        self.assertEqual('handoff.conflict', client.get('/api/runtime/handoff').json()['code'])
        self.assertEqual(503, client.get('/api/content').status_code)
        client.cookies.clear()
        self.assertEqual(401, client.post('/api/runtime/handoff/conflicts', json={}).status_code)
        client.cookies.set('ic_session', 'designer')
        self.assertEqual(403, client.post('/api/runtime/handoff/conflicts', json={}).status_code)
        client.cookies.set('ic_session', 'admin')
        self.assertEqual(403, client.post('/api/runtime/handoff/conflicts', json={}, headers={'Origin': 'https://other.example'}).status_code)

    def test_cleanup_requires_confirmation_failed_state_and_admin(self):
        class Cleanup(Controller):
            calls = []
            async def cleanup_handoff_conflicts(self, snapshot, selected):
                self.calls.append((snapshot, selected))
                return {'removed':selected, 'backup_directory':'/device/backup'}
            async def prepare_handoff(self):
                raise HandoffError('conflict')
        client, runtime, controller = self.setup_app(Cleanup())
        url = '/api/runtime/handoff/conflicts/cleanup'
        body = {'conflict_snapshot':'snapshot','selected':['data/canvas-content-PC.sqlite3'],'confirmed':True}
        self.assertEqual(409, client.post(url, json=body).status_code)
        client.post('/api/runtime/handoff')
        self.assertEqual(409, client.post(url, json={**body,'confirmed':False}).status_code)
        client.cookies.clear()
        self.assertEqual(401, client.post(url, json=body).status_code)
        client.cookies.set('ic_session','designer')
        self.assertEqual(403, client.post(url, json=body).status_code)
        client.cookies.set('ic_session','admin')
        self.assertEqual(403, client.post(url, json=body, headers={'Origin':'https://other.example'}).status_code)
        self.assertEqual([], controller.calls)
        self.assertEqual(200, client.post(url, json=body).status_code)
        self.assertEqual([('snapshot', body['selected'])], controller.calls)
        self.assertEqual('failed', runtime.handoff_result['state'])
        self.assertEqual(503, client.get('/api/content').status_code)

    def setup_app(self, controller=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        legacy = FastAPI()
        @legacy.get('/api/content')
        async def content():
            return {'ok': True}
        async def initializer():
            return RuntimeStartup(application=legacy)
        runtime = ApplicationRuntime(initializer=initializer, local_state_dir=Path(temporary.name), version='test')
        controller = controller or Controller()
        client = TestClient(create_app(runtime, runtime_authorization=Authorization(), workspace_handoff=controller), client=('127.0.0.1', 1234))
        asyncio.run(runtime.start())
        client.cookies.set('ic_session', 'admin')
        return client, runtime, controller

    def test_close_is_idempotent_and_freezes_all_business_routes(self):
        client, runtime, controller = self.setup_app()
        self.assertEqual(200, client.get('/api/content').status_code)
        result = client.post('/api/runtime/handoff').json()
        self.assertEqual('sealed', result['state'])
        self.assertEqual(result, client.post('/api/runtime/handoff').json())
        self.assertEqual(1, controller.stopped)
        self.assertEqual(503, client.get('/api/content').status_code)
        self.assertEqual(409, client.post('/api/runtime/restart').status_code)
        self.assertIn('/workspace-handoff', client.get('/startup').text)
        self.assertEqual(result, client.get('/api/runtime/handoff').json())

    def test_editor_blocker_leaves_workspace_running(self):
        client, runtime, controller = self.setup_app()
        controller.error = 'editors'
        result = client.post('/api/runtime/handoff')
        self.assertEqual(409, result.status_code)
        self.assertEqual('handoff.editors', result.json()['code'])
        self.assertEqual(RuntimeStage.READY, runtime.status().stage)
        self.assertEqual(0, controller.stopped)
        self.assertEqual(200, client.get('/api/content').status_code)

    def test_failure_after_stop_keeps_writes_blocked_and_allows_retry(self):
        class Failing(Controller):
            async def prepare_handoff(self):
                self.stopped += 1
                if self.stopped == 1: raise OSError('disk full')
                return {'state': 'sealed', 'id': 'b' * 32}
        client, runtime, controller = self.setup_app(Failing())
        self.assertEqual(409, client.post('/api/runtime/handoff').status_code)
        self.assertEqual('failed', client.get('/api/runtime/handoff').json()['state'])
        self.assertEqual(503, client.get('/api/content').status_code)
        self.assertEqual('sealed', client.post('/api/runtime/handoff').json()['state'])

    def test_close_requires_local_admin_and_same_origin(self):
        client, _, controller = self.setup_app()
        client.cookies.clear()
        self.assertEqual(401, client.post('/api/runtime/handoff').status_code)
        client.cookies.set('ic_session', 'designer')
        self.assertEqual(403, client.post('/api/runtime/handoff').status_code)
        client.cookies.set('ic_session', 'admin')
        self.assertEqual(403, client.post('/api/runtime/handoff', headers={'Origin': 'https://other.example'}).status_code)
        self.assertEqual(0, controller.stopped)

    def test_recovery_page_exposes_code_entry_without_suggesting_synced_code(self):
        client, runtime, _ = self.setup_app()
        page = client.get('/workspace-handoff')
        self.assertEqual(200, page.status_code)
        self.assertIn('id="handoff-expected"', page.text)
        self.assertIn('handoff.boundary', page.text)
        from infinite_canvas.runtime import RuntimeStatus
        runtime._status = RuntimeStatus(RuntimeStage.RECOVERY_REQUIRED, '', message_code='handoff.required')
        client.cookies.clear()
        self.assertEqual({'state': 'recovery', 'code': 'handoff.required'}, client.get('/api/runtime/handoff').json())


class ConflictRecoveryHttpTests(unittest.TestCase):
    def test_details_and_archive_are_local_same_origin_recovery_only(self):
        from infinite_canvas.runtime import RuntimeStatus
        class Recovery:
            calls = []
            def handoff_conflicts(self):
                self.calls.append('inspect')
                return {'files': [{'path': '.infinite-canvas-service/handoff-PC.json'}], 'snapshot': 'token'}
            def stage_handoff(self, code, *, conflict_snapshot=''):
                self.calls.append((code, conflict_snapshot))
                raise HandoffError('conflictsChanged')
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize(): return RuntimeStartup(application=FastAPI())
            runtime = ApplicationRuntime(initializer=initialize, local_state_dir=Path(temporary), version='test')
            recovery = Recovery()
            app = create_app(runtime, workspace_recovery=recovery)
            client = TestClient(app, client=('127.0.0.1', 1234))
            url = '/api/runtime/recovery/handoff/conflicts'
            self.assertEqual(409, client.post(url, json={}).status_code)
            runtime._status = RuntimeStatus(RuntimeStage.RECOVERY_REQUIRED, '', message_code='handoff.conflict')
            self.assertEqual(403, client.post(url, json={}, headers={'Origin':'https://foreign.example'}).status_code)
            remote = TestClient(app, client=('192.0.2.1', 1234))
            self.assertEqual(403, remote.post(url, json={}).status_code)
            self.assertEqual([], recovery.calls)
            response = client.post(url, json={})
            self.assertEqual(200, response.status_code)
            self.assertEqual('no-store', response.headers['cache-control'])
            self.assertIn('handoff-PC.json', response.text)
            result = client.post('/api/runtime/recovery/handoff', json={'handoff_id':'previous-device', 'conflict_snapshot':'token'})
            self.assertEqual(409, result.status_code)
            self.assertEqual('handoff.conflictsChanged', result.json()['code'])
            self.assertEqual(('previous-device', 'token'), recovery.calls[-1])


class HandoffDrainTests(unittest.IsolatedAsyncioTestCase):
    async def test_cleanup_disconnect_and_stop_keep_occupation_until_backup_finishes(self):
        with tempfile.TemporaryDirectory() as temporary:
            entered, finish = asyncio.Event(), asyncio.Event()
            released = []
            async def stop(): released.append(True)
            async def initialize(): return RuntimeStartup(application=FastAPI(), stop=stop)
            runtime = ApplicationRuntime(initializer=initialize, local_state_dir=Path(temporary), version='test')
            await runtime.start()
            class Slow(Controller):
                async def prepare_handoff(self): raise HandoffError('conflict')
                async def cleanup_handoff_conflicts(self, snapshot, selected):
                    entered.set()
                    await finish.wait()
                    return {'removed': selected}
            controller = Slow()
            with self.assertRaises(HandoffError): await runtime.request_handoff(controller)
            request = asyncio.create_task(runtime.cleanup_handoff_conflicts(controller, 'snapshot', ['copy']))
            await entered.wait()
            with self.assertRaises(HandoffError): await runtime.request_handoff(controller)
            request.cancel()
            with self.assertRaises(asyncio.CancelledError): await request
            stopping = asyncio.create_task(runtime.stop())
            await asyncio.sleep(0)
            self.assertEqual([], released)
            finish.set()
            await stopping
            self.assertEqual([True], released)

    async def test_freeze_precedes_drain_and_seal_waits_for_connections(self):
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize(): return RuntimeStartup(application=FastAPI())
            runtime = ApplicationRuntime(initializer=initialize, local_state_dir=Path(temporary), version='test')
            await runtime.start()
            events = []
            async def drain():
                self.assertEqual(RuntimeStage.MAINTENANCE, runtime.status().stage)
                events.append('http')
            async def sockets(): events.append('sockets')
            class Ordered(Controller):
                def check_handoff(self): events.append('check')
                async def close_handoff_connections(self): events.append('close')
                async def prepare_handoff(self):
                    events.append('seal')
                    return {'state': 'sealed'}
            runtime.install_maintenance_drainer(drain)
            runtime.handoff_channel_drainers.append(sockets)
            await runtime.request_handoff(Ordered())
            self.assertEqual(['http', 'check', 'close', 'sockets', 'seal'], events)
            await runtime.stop()


    async def test_disconnected_request_and_shutdown_do_not_release_live_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            entered, finish = asyncio.Event(), asyncio.Event()
            events = []
            async def stop(): events.append('released')
            async def initialize(): return RuntimeStartup(application=FastAPI(), stop=stop)
            runtime = ApplicationRuntime(initializer=initialize, local_state_dir=Path(temporary), version='test')
            await runtime.start()
            class Slow(Controller):
                async def prepare_handoff(self):
                    entered.set()
                    await finish.wait()
                    events.append('sealed')
                    return {'state': 'sealed'}
            request = asyncio.create_task(runtime.request_handoff(Slow()))
            await entered.wait()
            request.cancel()
            with self.assertRaises(asyncio.CancelledError): await request
            stopping = asyncio.create_task(runtime.stop())
            await asyncio.sleep(0)
            self.assertEqual([], events)
            finish.set()
            await stopping
            self.assertEqual(['sealed', 'released'], events)


    async def test_competing_storage_operation_blocks_handoff_without_deadlock(self):
        import httpx
        with tempfile.TemporaryDirectory() as temporary:
            entered, finish = asyncio.Event(), asyncio.Event()
            legacy = FastAPI()
            @legacy.post('/api/workspace-storage-settings/cloud')
            async def cloud_switch():
                entered.set()
                await finish.wait()
                return {'finished': True}
            async def initialize(): return RuntimeStartup(application=legacy)
            runtime = ApplicationRuntime(initializer=initialize, local_state_dir=Path(temporary), version='test')
            controller = Controller()
            app = create_app(runtime, runtime_authorization=Authorization(), workspace_handoff=controller)
            await runtime.start()
            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 1234))
            async with httpx.AsyncClient(transport=transport, base_url='http://localhost', cookies={'ic_session':'admin'}) as client:
                switching = asyncio.create_task(client.post('/api/workspace-storage-settings/cloud'))
                await entered.wait()
                result = await client.post('/api/runtime/handoff')
                self.assertEqual(409, result.status_code)
                self.assertEqual('handoff.unavailable', result.json()['code'])
                self.assertEqual(RuntimeStage.READY, runtime.status().stage)
                self.assertEqual(0, controller.stopped)
                finish.set()
                await switching
                self.assertEqual(200, (await client.post('/api/runtime/handoff')).status_code)
            await runtime.stop()


class RealHandoffLifecycleTests(unittest.TestCase):
    def test_real_stores_shutdown_seal_and_recovery_gate(self):
        import importlib
        import os
        from unittest.mock import patch
        from tests.runtime_env import configure_test_workspace, unload_main
        from infinite_canvas.bootstrap import ExistingWorkspaceRecovery
        from infinite_canvas.content import WorkspaceContent
        from infinite_canvas.device_state import DeviceState
        from infinite_canvas.sqlite_workspace_bootstrap import bootstrap_fresh_workspace_sqlite
        from infinite_canvas.workspace import WorkspaceService
        from infinite_canvas.workspace_storage import WorkspaceStorage
        from infinite_canvas.workspace_handoff import WorkspaceHandoff
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state, workspace = root / 'state', root / 'workspace'
            environment = {
                'INFINITE_CANVAS_STATE_DIR': str(state),
                'INFINITE_CANVAS_INSTANCE_STATE_DIR': str(root / 'instance'),
                'INFINITE_CANVAS_CACHE_DIR': str(root / 'cache'),
            }
            unload_main()
            with patch.dict(os.environ, environment):
                configure_test_workspace(workspace, state)
                storage = WorkspaceStorage(root / 'installation', state_dir=state)
                service = WorkspaceService(storage)
                workspace_id = service.ensure_identity()
                bootstrap_fresh_workspace_sqlite(WorkspaceContent(service.current()), workspace_id=workspace_id)
                try:
                    main = importlib.import_module('main')
                    main.AUTH_SYSTEM.create_user(username='handoff-admin', password='test-password', role='admin')
                    async def exercise():
                        await main.startup_event()
                        main.MATTING_JOBS['probe'] = {'status': 'running'}
                        with self.assertRaisesRegex(HandoffError, 'tasks'):
                            main.check_workspace_handoff()
                        main.MATTING_JOBS.clear()
                        await main.ensure_matting_workers()  # idle workers are not active jobs
                        main.check_workspace_handoff()
                        conflict = workspace / '.infinite-canvas-service/.handoff.interrupted.tmp'
                        conflict.write_text('unfinished local record')
                        with self.assertRaisesRegex(HandoffError, 'conflict'):
                            await main.prepare_workspace_handoff()
                        from infinite_canvas.bootstrap import LegacyInitializer
                        controller = LegacyInitializer()
                        controller._main = main
                        report = controller.handoff_conflicts()
                        self.assertEqual('.infinite-canvas-service/.handoff.interrupted.tmp', report['files'][0]['path'])
                        self.assertTrue(main._WORKSPACE_BACKGROUND_STOPPED)
                        self.assertIsNotNone(main.WORKSPACE_OCCUPATION)
                        self.assertTrue(report['can_cleanup'])
                        cleaned = await controller.cleanup_handoff_conflicts(report['snapshot'], [report['files'][0]['path']])
                        self.assertFalse(conflict.exists())
                        self.assertTrue(Path(cleaned['backup_directory']).exists())
                        result = await main.prepare_workspace_handoff()
                        self.assertIsNone(main.WORKSPACE_OCCUPATION)
                        self.assertTrue(main._WORKSPACE_BACKGROUND_STOPPED)
                        await main.shutdown_event()  # must not write after publishing
                        return result
                    result = asyncio.run(exercise())
                    handoff = WorkspaceHandoff(workspace, state, workspace_id, DeviceState(state).server_identity())
                    self.assertEqual(handoff.read()['files'], handoff.inventory())
                    with self.assertRaisesRegex(HandoffError, 'required'):
                        service.acquire_occupation(DeviceState(state).server_identity())
                    recovery = ExistingWorkspaceRecovery(storage)
                    with self.assertRaisesRegex(HandoffError, 'code'):
                        recovery.stage_handoff('incorrect')
                    recovery.stage_handoff(result['id'])
                    recovery.prepare_restart()
                    recovery.release()
                    guard = service.acquire_occupation(DeviceState(state).server_identity())
                    guard.release()
                finally:
                    unload_main()
