"""Agent reads must not hold up the browser's local original-image requests."""
import asyncio
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

import httpx
from fastapi.staticfiles import StaticFiles
from infinite_canvas.auth_system import SESSION_COOKIE
from tests import test_agent_api as agent_fixture


class AgentImageResponsivenessTests(unittest.TestCase):
    def test_local_original_is_served_while_agent_reads_canvas(self):
        for endpoint in ('', '/tasks'):
            with self.subTest(endpoint=endpoint):
                fixture = agent_fixture.AgentApiTests()
                fixture.setUp()
                try:
                    self._assert_responsive(fixture, endpoint)
                finally:
                    fixture.doCleanups()

    def _assert_responsive(self, fixture, endpoint):
        media = Path(fixture.tmp.name) / 'originals'
        media.mkdir()
        image = b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'
        (media / 'image.svg').write_bytes(image)
        app = fixture.client.app
        app.mount('/assets', StaticFiles(directory=media), name='originals')
        cookie = fixture.auth.create_session(fixture.admin['id'])
        entered, release = threading.Event(), threading.Event()
        original_read = fixture.sync.read

        def slow_read(*args, **kwargs):
            entered.set()
            release.wait(1.5)
            return original_read(*args, **kwargs)

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver',
                                         cookies={SESSION_COOKIE: cookie}) as client:
                # Independent watchdog makes the old event-loop blocking path fail
                # deterministically instead of hanging the test runner.
                watchdog = threading.Timer(1, release.set)
                watchdog.start()
                read = asyncio.create_task(client.get('/api/agent/v1/canvases/canvas-test' + endpoint,
                    headers={'Authorization': 'Bearer ' + fixture.token['token']}))
                try:
                    started = await asyncio.to_thread(entered.wait, 1)
                    response = await client.get('/assets/image.svg')
                    responsive = not release.is_set()
                    self.assertTrue(started, 'Exercise the production authorized canvas read')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, image)
                finally:
                    release.set()
                    watchdog.cancel()
                    result = await read
                self.assertEqual(result.status_code, 200)
                self.assertTrue(responsive, 'Original image waited for the Agent canvas read to finish')

        with patch.object(fixture.sync, 'read', side_effect=slow_read):
            asyncio.run(exercise())
