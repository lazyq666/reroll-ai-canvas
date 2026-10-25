"""Whole-reference acceptance against the real Account/Canvas SQLite boundary."""
import copy
import json
import subprocess
import unittest
from urllib.parse import quote

from tests import test_agent_task_editing as editing
from infinite_canvas.node_references import parse_reference, NodeReferenceError
from infinite_canvas.canvas_store import CanvasIntent


def reference(ids, workspace='reference-workspace', canvas='canvas-test'):
    encode = lambda value: quote(value, safe="~()*!.'-_")
    return f'Reroll workspace={encode(workspace)} canvas={encode(canvas)} nodes={",".join(map(encode, ids))}'


class NodeReferenceTests(unittest.TestCase):
    setUp = editing.AgentTaskEditingTests.setUp
    mutate = editing.AgentTaskEditingTests.mutate
    document = editing.AgentTaskEditingTests.document
    node = editing.AgentTaskEditingTests.node

    def read(self, ids, **kwargs):
        self.sync._workspace_id = lambda: 'reference-workspace'
        return self.client.post('/api/agent/v1/node-references/read', json={'reference': reference(ids, **kwargs)})

    def test_all_types_full_content_versions_latest_and_read_only(self):
        text = '完整中文\n' * 600 + '最后一句。'
        self.mutate({'node_creates': [self.api.creation({'id':'text', 'type':'smart-prompt',
            'x':900, 'y':0, 'text':text})]}, 'text')
        ids = ['text', 'source-1', 'draft', 'group', 'frame']
        before = self.document()
        result = self.read(ids)
        self.assertEqual(200, result.status_code, result.text)
        data = result.json()
        self.assertEqual(ids, data['node_ids'])
        self.assertEqual(ids, [n['node_id'] for n in data['nodes']])
        self.assertEqual(text, data['nodes'][0]['content']['text'])
        self.assertEqual(self.long_prompt, data['nodes'][2]['generation_task']['recipe']['prompt'])
        self.assertEqual(self.client.get('/api/agent/v1/canvases/canvas-test/tasks/draft').json(), data['nodes'][2]['generation_task'])
        self.assertEqual(['source-2','source-0'], data['nodes'][3]['content']['items'])
        self.assertEqual(['draft'], data['nodes'][4]['content']['items'])
        self.assertEqual(before, self.document())
        old_revision = data['nodes'][0]['node_revision']
        self.mutate({'node_updates':[{'id':'text','path':['text'],'value':text+'追加'},
                                    {'id':'text','path':['title'],'value':'Renamed'}]}, 'edit')
        updated = self.read(ids).json()
        self.assertEqual(text+'追加', updated['nodes'][0]['content']['text'])
        self.assertNotEqual(old_revision, updated['nodes'][0]['node_revision'])
        with self.api.data() as state:
            self.assertEqual({}, state['runs'])

    def test_partial_missing_workspace_and_permission_fail_without_subset(self):
        self.mutate({'node_deletes':['source-1']}, 'delete')
        before = self.document()
        result = self.read(['source-2','source-1'])
        self.assertEqual(404, result.status_code)
        self.assertEqual({'node_ids':['source-1']}, result.json()['details'])
        self.assertNotIn('nodes', result.json())
        mismatch = self.read(['source-1'], workspace='another-workspace')
        self.assertEqual('workspace_mismatch', mismatch.json()['code'])
        unknown = self.read(['source-1'], canvas='deleted-canvas')
        self.assertEqual('forbidden', unknown.json()['code'])
        other_token = self.auth.create_agent_token(self.other, 'other', ['authoring'])
        self.store.commit('canvas-test', self.admin, CanvasIntent.set_visibility('private', operation_id='fixture:private'))
        self.client.headers['Authorization'] = 'Bearer '+other_token['token']
        forbidden = self.read(['source-2','source-1'])
        self.assertEqual(403, forbidden.status_code)
        self.assertEqual({}, forbidden.json()['details'])
        self.assertEqual(before['nodes'], self.document()['nodes'])

    def test_over_one_page_preserves_every_target_and_capacity_is_explicit(self):
        ids = [f'text-{i}' for i in range(205)]
        self.mutate({'node_creates':[self.api.creation({'id':i,'type':'smart-prompt','x':0,'y':0,'text':i}) for i in ids]}, 'large')
        result = self.read(ids)
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(ids, [node['node_id'] for node in result.json()['nodes']])
        self.assertEqual('node_reference_too_large', self.read([f'id-{i}' for i in range(1001)]).json()['code'])
        self.assertEqual('node_reference_too_large', self.read(['x'*131073]).json()['code'])

    def test_session_copy_confirmation_uses_same_authorization_and_no_content(self):
        self.sync._workspace_id = lambda: 'reference-workspace'
        self.client.headers.pop('Authorization')
        self.client.cookies.set('ic_session', self.auth.create_session(self.admin['id']))
        text = reference(['source-0','source-1'])
        url = '/api/canvases/canvas-test/node-reference'
        before = self.document()
        result = self.client.post(url, json={'reference':text})
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(['source-0','source-1'], result.json()['node_ids'])
        self.assertNotIn('nodes', result.json())
        self.assertEqual(before, self.document())
        self.assertEqual('canvas_mismatch', self.client.post(url, json={'reference':reference(['source-0'],canvas='other')}).json()['code'])

    def test_strict_escaping_shared_with_browser_encoder(self):
        value = {'workspace_id':'工作 区%=,', 'canvas_id':'画布/完整 id', 'node_ids':["node,= %/中文'",'other']}
        script = "const r=require('./static/js/smart-canvas/node-reference.js');process.stdout.write(r.format(JSON.parse(process.argv[1])));"
        encoded = subprocess.check_output(['node','-e',script,json.dumps(value)],text=True)
        self.assertEqual(value, parse_reference(encoded))
        self.assertEqual(['a','b'], parse_reference(reference(['a','b','a']))['node_ids'])
        for invalid in ['', ' '+reference(['a']), reference(['a'])+'\n', reference(['a'])+' extra=1',
                        reference(['a']).replace('Reroll','reroll'), reference(['a']).replace('nodes=a','nodes='),
                        reference(['a']).replace('nodes=a','nodes=a,,b'), reference(['a']).replace('nodes=a','nodes=%ZZ'),
                        reference(['a']).replace('nodes=a','nodes=%FF'), reference(['a']).replace('nodes=a','nodes=%00'),
                        reference(['a']).replace('nodes=a','nodes=a=b'), None]:
            with self.subTest(invalid=invalid), self.assertRaises(NodeReferenceError):
                parse_reference(invalid)
