"""Exercise the shipped process using the official MCP client over stdio."""

import os
from pathlib import Path
import sys
import unittest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_tool_and_prompt_contracts(self):
        parameters = StdioServerParameters(
            command=sys.executable,
            args=[str(Path(__file__).resolve().parents[1] / "reroll_mcp.py")],
            env={
                **os.environ,
                "REROLL_URL": "http://127.0.0.1:1",
                "REROLL_AGENT_TOKEN": "fixture",
                "REROLL_ALLOWED_DIRS": "[]",
            },
        )
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                self.assertEqual(19, len(tools.tools))
                names = {t.name for t in tools.tools}
                self.assertTrue(
                    {"create_generation_tasks", "run_tasks", "download_outputs"}
                    <= names
                )
                prompt = await session.get_prompt("author_canvas")
                self.assertIn("dry_run", prompt.messages[0].content.text)
                result = await session.call_tool("find_local_files", {})
                self.assertFalse(result.isError)


    async def test_tokenless_stdio_pairing_and_restart(self):
        import json
        import tempfile
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        state = {'approved': False, 'name': None, 'requests': 0}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def respond(self, status, body):
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())
            def do_GET(self):
                self.respond(200 if state['approved'] else 401,
                             {'models': []} if state['approved'] else {'code':'unauthorized'})
            def do_POST(self):
                payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                state['name']=payload['name']; state['requests']+=1
                self.respond(200, {'state':'pending','code':'ABC123','expires_at':9999999999})
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                environment={**os.environ,'REROLL_URL':f'http://127.0.0.1:{server.server_port}',
                             'REROLL_CREDENTIAL_DIR':directory,'REROLL_ALLOWED_DIRS':'[]'}
                environment.pop('REROLL_AGENT_TOKEN',None)
                environment.pop('REROLL_CLIENT_NAME',None)
                parameters=StdioServerParameters(command=sys.executable,
                    args=[str(Path(__file__).resolve().parents[1] / 'reroll_mcp.py')],env=environment)
                for run in range(2):
                    async with stdio_client(parameters) as (read,write):
                        async with ClientSession(read,write) as session:
                            await session.initialize()
                            result=await session.call_tool('list_models',{})
                            payload=json.loads(result.content[0].text)
                            if run == 0:
                                self.assertEqual(payload['code'],'authorization_required')
                                self.assertIsNotNone(state['name'])
                                state['approved']=True
                                result=await session.call_tool('list_models',{})
                                payload=json.loads(result.content[0].text)
                            self.assertEqual(payload,{'models':[]})
                self.assertEqual(state['requests'],1)
        finally:
            server.shutdown(); server.server_close()


if __name__ == "__main__":
    unittest.main()
