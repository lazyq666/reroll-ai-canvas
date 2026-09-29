"""Real HTTP/process check with an isolated controller, never a user Workspace."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
import requests


class HandoffProcessTests(unittest.TestCase):
    def test_http_acknowledgement_then_normal_server_exit(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary, socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
            listener.close()
            script = textwrap.dedent('''
                import os, asyncio, threading
                from pathlib import Path
                from fastapi import FastAPI
                from infinite_canvas import __main__ as entry
                from infinite_canvas.app import create_app
                from infinite_canvas.runtime import ApplicationRuntime, RuntimeStartup
                async def initialize(): return RuntimeStartup(application=FastAPI())
                runtime = ApplicationRuntime(initializer=initialize,local_state_dir=Path(os.environ['PROBE_STATE']),version='test')
                runtime.shutdown_event = threading.Event()
                runtime.shutdown_signal = runtime.shutdown_event.set
                class Auth:
                    def role_for_session(self, token): return 'admin' if token == 'synthetic-admin' else ''
                class Controller:
                    def online_handoff_status(self): return True
                    def check_handoff(self): pass
                    async def close_handoff_connections(self): pass
                    async def prepare_handoff(self): return {'state':'sealed','automatic':True,'exit_server':True}
                app = create_app(runtime,runtime_authorization=Auth(),workspace_handoff=Controller())
                entry.create_default_application = lambda: (app,runtime,threading.Event())
                raise SystemExit(entry.main())
            ''')
            env = {**os.environ, 'PYTHONPATH':str(root / 'backend'), 'PROBE_STATE':temporary,
                   'INFINITE_CANVAS_HOST':'127.0.0.1','INFINITE_CANVAS_PORT':str(port)}
            env.pop('INFINITE_CANVAS_SUPERVISOR_PID', None)
            env.pop('INFINITE_CANVAS_SUPERVISOR_FD', None)
            with (Path(temporary)/'server.log').open('w+') as log:
                process = subprocess.Popen([sys.executable,'-c',script],cwd=root,env=env,stdout=log,stderr=log)
                try:
                    session = requests.Session(); session.trust_env = False
                    session.cookies.set('ic_session','synthetic-admin')
                    url = f'http://127.0.0.1:{port}/api/runtime/handoff'
                    deadline = time.monotonic()+12
                    while True:
                        try:
                            response = session.get(url,timeout=.5)
                            if response.ok and response.json()['state']=='ready': break
                        except requests.RequestException: pass
                        if process.poll() is not None or time.monotonic() > deadline:
                            log.seek(0); self.fail('Isolated server failed to start: '+log.read())
                        time.sleep(.05)
                    result = session.post(url,json={},timeout=2)
                    self.assertEqual(200,result.status_code)
                    self.assertEqual('sealed',result.json()['state'])
                    self.assertEqual(0,process.wait(timeout=5))
                finally:
                    if process.poll() is None:
                        process.terminate(); process.wait(timeout=5)
