"""Exact copied references through real stdio MCP, HTTP and persisted Canvas."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading
import unittest

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import uvicorn

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from tests import test_node_references as references


class NodeReferenceProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_whole_reference_without_changing_lock_and_read_after_restart(self):
        fixture=references.NodeReferenceTests()
        await asyncio.to_thread(fixture.setUp)
        fixture.sync._workspace_id=lambda:'reference-workspace'
        listener=socket.socket()
        try:
            await fixture.sync.create_agent_canvas(fixture.admin,'another-canvas','Another')
            listener.bind(('127.0.0.1',0))
            port=listener.getsockname()[1]
            server=uvicorn.Server(uvicorn.Config(fixture.client.app,log_level='error',lifespan='off'))
            thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
            for _ in range(500):
                if server.started:break
                await asyncio.sleep(.01)
            self.assertTrue(server.started)
            parameters=StdioServerParameters(command=sys.executable,args=[str(ROOT/'tools/reroll-mcp/reroll_mcp.py')],
                env={**os.environ,'REROLL_URL':f'http://127.0.0.1:{port}','REROLL_AGENT_TOKEN':fixture.token['token'],'REROLL_ALLOWED_DIRS':'[]'})
            text=references.reference(['source-1','draft','group','frame'])
            before=fixture.document()
            async with stdio_client(parameters) as (read,write), ClientSession(read,write) as session:
                await session.initialize()
                names=[tool.name for tool in (await session.list_tools()).tools]
                self.assertIn('read_node_reference',names)
                async def call(name,args):
                    result=await session.call_tool(name,args)
                    self.assertFalse(result.isError,result)
                    return json.loads(result.content[0].text)
                await call('use_canvas',{'canvas':'another-canvas'})
                result=await call('read_node_reference',{'reference':text})
                self.assertEqual(['source-1','draft','group','frame'],result['node_ids'])
                self.assertEqual(fixture.long_prompt,result['nodes'][1]['generation_task']['recipe']['prompt'])
                self.assertEqual('another-canvas',(await call('get_current_canvas',{}))['canvas']['id'])
                self.assertEqual(before,fixture.document())
                for invalid,code in [(text+' more words','invalid_node_reference'),
                                     (text.replace('reference-workspace','wrong'),'workspace_mismatch'),
                                     (text+',deleted','node_not_found')]:
                    failed=await call('read_node_reference',{'reference':invalid})
                    self.assertEqual(code,failed['code']);self.assertNotIn('nodes',failed)
                await asyncio.to_thread(fixture.mutate,{'node_updates':[{'id':'draft','path':['promptDraftText'],'value':'新中文\n最后一句'}]},'latest')
            async with stdio_client(parameters) as (read,write), ClientSession(read,write) as session:
                await session.initialize()
                result=await session.call_tool('read_node_reference',{'reference':text})
                data=json.loads(result.content[0].text)
                self.assertEqual('新中文\n最后一句',data['nodes'][1]['generation_task']['recipe']['prompt'])
            self.assertEqual({},fixture.api.contexts)
            with fixture.api.data() as state:self.assertEqual({},state['runs'])
        finally:
            if 'server' in locals():
                server.should_exit=True;await asyncio.to_thread(thread.join,5)
            listener.close();await asyncio.to_thread(fixture.doCleanups)
