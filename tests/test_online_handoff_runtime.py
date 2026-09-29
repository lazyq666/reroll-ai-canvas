import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from infinite_canvas.app import create_app
from infinite_canvas.runtime import ApplicationRuntime, RuntimeStage, RuntimeStartup
from infinite_canvas.workspace_handoff import HandoffError


class OnlineRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def runtime(self, initialize):
        return ApplicationRuntime(initializer=initialize, local_state_dir=Path(self.temp.name), version='test')

    async def test_success_exits_only_after_writers_and_publish_finish(self):
        entered, finish, exit_event = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def initialize(): return RuntimeStartup(application=FastAPI())
        runtime = self.runtime(initialize)
        runtime.shutdown_signal = exit_event.set
        await runtime.start()
        class Controller:
            def check_handoff(self): pass
            async def close_handoff_connections(self): pass
            async def prepare_handoff(self):
                entered.set()
                await finish.wait()
                return {'state':'sealed','automatic':True,'exit_server':True}
        closing = asyncio.create_task(runtime.request_handoff(Controller()))
        await entered.wait()
        self.assertEqual(RuntimeStage.MAINTENANCE, runtime.status().stage)
        self.assertFalse(exit_event.is_set())
        finish.set()
        self.assertTrue((await closing)['exit_server'])
        await asyncio.wait_for(exit_event.wait(), 2)
        await runtime.stop()

    async def test_failed_publish_keeps_service_locked_without_exit(self):
        async def initialize(): return RuntimeStartup(application=FastAPI())
        runtime = self.runtime(initialize)
        exits = []
        runtime.shutdown_signal = lambda: exits.append(True)
        await runtime.start()
        class Controller:
            def check_handoff(self): pass
            async def close_handoff_connections(self): pass
            async def prepare_handoff(self): raise HandoffError('onlineUnavailable')
        with self.assertRaises(HandoffError): await runtime.request_handoff(Controller())
        self.assertEqual(RuntimeStage.MAINTENANCE, runtime.status().stage)
        self.assertIsNone(runtime._handoff_exit_handle)
        self.assertEqual([], exits)
        await runtime.stop()

    async def test_startup_automatically_claims_and_requests_restart_without_code(self):
        called, restarted = threading.Event(), asyncio.Event()
        async def initialize(): raise HandoffError('onlineBusy')
        runtime = self.runtime(initialize)
        runtime._restart_signal = restarted.set
        class Recovery:
            def online_handoff_status(self): return True
            def stage_handoff(self, code):
                assert code == ''
                called.set()
        await runtime.start()
        app = create_app(runtime, workspace_recovery=Recovery())
        async with app.shell.router.lifespan_context(app.shell):
            await asyncio.wait_for(asyncio.to_thread(called.wait, 2), 3)
            self.assertTrue(called.is_set())
            await asyncio.wait_for(restarted.wait(), 2)
            self.assertEqual(RuntimeStage.STOPPING, runtime.status().stage)

    async def test_interrupted_publisher_exits_without_reclaiming_seal(self):
        closed = asyncio.Event()
        async def initialize(): raise HandoffError('onlinePublished')
        runtime = self.runtime(initialize)
        runtime.shutdown_signal = closed.set
        class Recovery:
            def online_handoff_status(self): return True
            def stage_handoff(self, code): raise AssertionError('Published source must never reclaim')
        await runtime.start()
        app = create_app(runtime, workspace_recovery=Recovery())
        async with app.shell.router.lifespan_context(app.shell):
            await asyncio.wait_for(closed.wait(), 2)

    async def test_server_exit_code_does_not_request_launcher_restart(self):
        from infinite_canvas import __main__ as entry
        event = threading.Event()
        restart = threading.Event()
        class Server:
            should_exit = False
            def __init__(self, config): pass
            async def serve(self):
                event.set()
                while not self.should_exit: await asyncio.sleep(.01)
        with patch.object(entry, 'create_default_application', return_value=(FastAPI(), SimpleNamespace(shutdown_event=event), restart)), \
             patch.object(entry.uvicorn, 'Server', Server), patch.object(entry, '_supervisor_fd', return_value=None), \
             patch.object(entry, '_supervisor_pid', return_value=None):
            self.assertEqual(0, await entry.serve())
        self.assertFalse(restart.is_set())
