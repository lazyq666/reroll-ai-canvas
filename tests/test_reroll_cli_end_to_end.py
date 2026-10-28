"""Real CLI processes against the Agent HTTP boundary with no browser editor."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

import uvicorn
from PIL import Image

from tests import test_agent_image_runs as fixtures
from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
import main


class CliHttpAcceptanceTests(unittest.TestCase):
    def test_generate_edit_retrieve_and_duplicate_replay_without_an_editor(self):
        fixture = fixtures.AgentImageRunApiTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        provider = {'id': 'fixture', 'name': 'Fixture', 'protocol': 'openai',
                    'image_models': ['image']}
        fixture.api.compile_image = main._compile_agent_image_run
        with (
            patch.object(main, 'get_api_provider_exact', return_value=provider),
            patch.object(main, 'resolved_model_capability',
                         side_effect=lambda _p, _m, op: fixture.capabilities[op]),
        ):
            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            address = 'http://127.0.0.1:' + str(listener.getsockname()[1])
            server = uvicorn.Server(uvicorn.Config(fixture.client.app, log_level='error', lifespan='off'))
            worker = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            worker.start()
            try:
                for _ in range(100):
                    if server.started:
                        break
                    time.sleep(.01)
                self.assertTrue(server.started)
                environment = {**os.environ, 'REROLL_URL': address,
                    'REROLL_AGENT_TOKEN': fixture.fixture.token['token'], 'REROLL_LANGUAGE': 'en'}
                command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'tools/reroll-mcp/reroll_cli.py')]

                def run(*arguments):
                    completed = subprocess.run([*command, *arguments, '--json'], env=environment,
                        text=True, capture_output=True, timeout=20, cwd=fixture.root)
                    self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
                    # json.loads rejects extra stdout progress or additional objects.
                    result = json.loads(completed.stdout)
                    self.assertNotIn(fixture.fixture.token['token'], completed.stdout + completed.stderr)
                    return result

                listing = run('models')
                self.assertEqual({'image.generate', 'image.edit'}, set(listing['models'][0]['operations']))
                generated = run('generate', 'Original\ntext', '--provider', 'fixture', '--model', 'image',
                    '--ratio', '3:4', '--resolution', '2K', '--request-id', 'cli-http-generate')
                self.assertEqual('image.generate', generated['operation'])
                with Image.open(generated['outputs'][0]['path']) as image:
                    self.assertEqual((30, 40), image.size)
                reference = fixture.root / 'character.png'
                reference.write_bytes(fixture.png)
                arguments = ('generate', 'Use image 1 and image 2.\nKeep identity.', '--provider', 'fixture',
                    '--model', 'image', '--ratio', '3:4', '--resolution', '2K',
                    '--image', str(reference), '--image', str(reference), '--request-id', 'cli-http-edit')
                edited = run(*arguments)
                replay = run(*arguments)
                self.assertEqual('image.edit', edited['operation'])
                self.assertEqual(edited['run_id'], replay['run_id'])
                self.assertEqual([1, 2], [row['index'] for row in edited['inputs']])
                self.assertEqual(2, len(fixture.adapter.calls))
                self.assertEqual(2, len(fixture.adapter.calls[1].references))
                retrieved = run('result', edited['run_id'])
                self.assertEqual(edited['run_id'], retrieved['run_id'])
                self.assertNotEqual(edited['outputs'][0]['path'], retrieved['outputs'][0]['path'])
                self.assertTrue(Path(retrieved['outputs'][0]['path']).is_file())
            finally:
                server.should_exit = True
                worker.join(5)
                listener.close()
                self.assertFalse(worker.is_alive())
