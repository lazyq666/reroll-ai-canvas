import json
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.infinite_canvas.canvas_realtime import apply_operation
from backend.infinite_canvas.canvas_store import CanvasIntent, CanvasProjection, SqliteCanvasStore
from backend.infinite_canvas.generation_output import apply_generation_result_nodes
from backend.infinite_canvas.media_naming import generation_prefix

ROOT = Path(__file__).resolve().parents[1]
ACTOR = {'id': 'admin', 'role': 'admin', 'status': 'active', 'username': 'admin'}


def media(identity, prefix='t2i', **extra):
    return {'url': f'/assets/{identity}.png', 'kind': 'image', 'name': f'{prefix}-01.png',
            'autoName': {'id': identity, 'prefix': prefix, 'extension': '.png',
                         'name': f'{prefix}-01.png', 'pending': True, **extra}}


def operation(identity, changes, base=0):
    return {'operation_id': f'operation:{identity}', 'base_revision': base, 'changes': changes}


class CanvasMediaSequenceTests(unittest.TestCase):
    def test_two_stale_clients_receive_distinct_names_and_replay_is_idempotent(self):
        canvas = {'id': 'canvas', 'nodes': [], 'connections': []}
        first = operation('one', {'node_creates': [{'id': 'one', 'images': [media('one')]}]})
        second = operation('two', {'node_creates': [{'id': 'two', 'x': 1000, 'images': [media('two')]}]})
        apply_operation(canvas, first, 'a')
        result = apply_operation(canvas, second, 'b')
        self.assertEqual('t2i-02.png', result.changes['node_creates'][0]['images'][0]['name'])
        self.assertTrue(apply_operation(canvas, second, 'b').duplicate)
        self.assertEqual(2, canvas['_realtime']['media_names']['counters']['t2i'])

    def test_undo_redo_and_delete_do_not_recycle_names(self):
        canvas = {'id': 'canvas', 'nodes': [], 'connections': []}
        apply_operation(canvas, operation('one', {'node_creates': [{'id': 'one', 'images': [media('one')]}]}), 'a')
        apply_operation(canvas, {'operation_id': 'operation:undo', 'base_revision': 1, 'reverts_operation_id': 'operation:one'}, 'a')
        apply_operation(canvas, operation('two', {'node_creates': [{'id': 'two', 'images': [media('two')]}]}, 2), 'b')
        apply_operation(canvas, {'operation_id': 'operation:redo', 'base_revision': 3, 'reverts_operation_id': 'operation:undo'}, 'a')
        self.assertEqual(['t2i-02.png', 't2i-01.png'], [n['images'][0]['name'] for n in canvas['nodes']])

    def test_nested_group_existing_max_split_group_and_manual_name(self):
        canvas = {'nodes': [{'id': 'group', 'members': [{'media': {'url': '/old.png', 'name': 'split-09-r2-c3.png'}}]}]}
        images = [media('same-split', 'split', suffix=f'-r1-c{i}') for i in (1, 2)]
        result = apply_operation(canvas, operation('split', {'node_creates': [{'id': 'new', 'images': images}]}), 'a')
        named = result.changes['node_creates'][0]['images']
        self.assertEqual(['split-10-r1-c1.png', 'split-10-r1-c2.png'], [m['name'] for m in named])
        named[0]['name'] = '用户命名.png'
        result = apply_operation(canvas, operation('rename', {'node_updates': [{'id': 'new', 'path': ['images'], 'value': named}]}, 1), 'a')
        self.assertEqual('用户命名.png', result.changes['node_updates'][0]['value'][0]['name'])

    def test_generation_uses_all_canvas_nodes_and_preserves_replay_names(self):
        state = {}
        first = {'id': 'one', 'generationOperationId': 'gen-one', 'generationInputSnapshot': {'settings': {}, 'refs': []}, 'images': []}
        second = {**first, 'id': 'two', 'generationOperationId': 'gen-two'}
        changes = {'images': [{'url': '/first.webp'}]}
        first = apply_generation_result_nodes(first, changes, [first, second], run_id='run-one', naming_state=state)[0]
        second = apply_generation_result_nodes(second, {'images': [{'url': '/second.png'}]}, [first, second], run_id='run-two', naming_state=state)[0]
        self.assertEqual('t2i-01.webp', first['images'][0]['name'])
        self.assertEqual('t2i-02.png', second['images'][0]['name'])
        first['images'][0]['name'] = '角色.webp'
        replay = apply_generation_result_nodes(first, changes, [first, second], run_id='run-one', naming_state=state)[0]
        self.assertEqual('角色.webp', replay['images'][0]['name'])
        self.assertEqual(2, state['media_names']['counters']['t2i'])

    def test_frontend_and_backend_classify_existing_functions_identically(self):
        cases = [
            ({'generationInputSnapshot': {'settings': {}, 'refs': []}}, 'image', 't2i'),
            ({'generationInputSnapshot': {'refs': [{'kind': 'image'}]}}, 'image', 'i2i'),
            ({'aiProcessorKind': 'outpaint'}, 'image', 'outpaint'),
            ({'aiProcessorKind': 'angle-control'}, 'image', 'angle'),
            ({'localRepairRequest': {'version': 2}}, 'image', 'repair'),
            ({'mattingSourceNodeId': 'n'}, 'image', 'cutout'),
            ({'outputKind': 'depth-map'}, 'image', 'depth'),
            ({'lightingPrompt': {'en': 'light'}, 'metadata': {'lightingIntent': {'version': 1}}}, 'image', 'lighting'),
            ({'runSettings': {'engine': 'comfy', 'comfyMode': 'custom'}}, 'audio', 'workflow-audio'),
            ({'runSettings': {'engine': 'runninghub'}}, 'image', 'workflow-image'),
            ({'runSettings': {'engine': 'runninghub', 'rhConfigKey': 'model:seedream'}}, 'image', 't2i'),
            ({'runSettings': {'engine': 'comfy', 'comfyMode': 'text'}, 'runInputRefs': [{'kind': 'image'}]}, 'image', 't2i'),
            ({'generationInputSnapshot': {'namingPrefix': 'frames2video', 'refs': [{'kind': 'image'}]}}, 'video', 'frames2video'),
            ({'runSettings': {'videoMultimodal': True, 'videoTempShLinks': [{'manual': True, 'url': 'https://example.com/video'}]}}, 'video', 'multi2video'),
            ({'generationInputSnapshot': {'settings': {}, 'refs': []}}, 'video', 'txt2video'),
            ({'runSettings': {'videoReferenceMode': 'image_to_video'}, 'runInputRefs': [{'url': '/a.png'}]}, 'video', 'img2video'),
            ({'runSettings': {'videoUseFrameRoles': True}, 'runInputRefs': [{'url': '/a.png'}]}, 'video', 'frames2video'),
            ({'runSettings': {'videoMultimodal': True}, 'runInputRefs': [{'url': '/a.png'}]}, 'video', 'multi2video'),
        ]
        for node, kind, expected in cases:
            self.assertEqual(expected, generation_prefix(node, kind))
        source = (ROOT / 'static/js/smart-canvas/media-naming.js').read_text()
        script = 'const window={};\n' + source + '\nconst cases=' + json.dumps(cases) + ';console.log(JSON.stringify(cases.map(([node,kind])=>window.SmartCanvasModules.mediaNaming.generationPrefix(node,kind))));'
        result = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
        self.assertEqual([case[2] for case in cases], json.loads(result.stdout))

    def test_sqlite_concurrent_commits_restart_and_deleted_maximum(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'canvas.sqlite3'
            store = SqliteCanvasStore(path, workspace_id='workspace')
            store.commit('canvas', ACTOR, CanvasIntent.import_canvas({'id': 'canvas', 'kind': 'smart', 'owner_id': 'admin', 'nodes': [], 'connections': []}, operation_id='import:canvas'))
            def create(index):
                op = operation(str(index), {'node_creates': [{'id': str(index), 'x': index * 1000, 'images': [media(str(index))]}]})
                return SqliteCanvasStore(path, workspace_id='workspace').commit('canvas', ACTOR, CanvasIntent.canvas_mutation(op))
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(create, range(4)))
            names = {r.event['changes']['node_creates'][0]['images'][0]['name'] for r in results}
            self.assertEqual({f't2i-0{i}.png' for i in range(1, 5)}, names)
            store.commit('canvas', ACTOR, CanvasIntent.canvas_mutation(operation('delete', {'node_deletes': ['0', '1', '2', '3']}, 4)))
            created = create(5)
            self.assertEqual('t2i-05.png', created.event['changes']['node_creates'][0]['images'][0]['name'])

    def test_generation_and_local_edit_share_transactional_sequence_and_export(self):
        with tempfile.TemporaryDirectory() as temp:
            store = SqliteCanvasStore(Path(temp) / 'one.sqlite3', workspace_id='workspace')
            source = {'id': 'canvas', 'kind': 'smart', 'owner_id': 'admin', 'connections': [], 'nodes': [
                {'id': 'output', 'images': [], 'generationOperationId': 'generation:one',
                 'generationInputSnapshot': {'settings': {'engine': 'api'}, 'refs': []}}
            ]}
            store.commit('canvas', ACTOR, CanvasIntent.import_canvas(source, operation_id='import:canvas'))
            store.commit('canvas', ACTOR, CanvasIntent.generation_output_commit(
                effect_id='effect:one', run_id='run:one', node_id='output',
                generation_operation_id='generation:one', request_index=0,
                node_changes={'images': [{'url': '/assets/one.png'}]}, final_log=None))
            snapshot = store.read('canvas', ACTOR, CanvasProjection.public_snapshot()).canvas
            self.assertEqual('t2i-01.png', snapshot['nodes'][0]['images'][0]['name'])
            # A browser arriving before the server's completion notification has
            # an optimistic name and the same operation/media identity.
            item = media('generation:one:/assets/one.png')
            item['url'] = '/assets/one.png'
            store.commit('canvas', ACTOR, CanvasIntent.canvas_mutation(operation('replay', {'node_updates': [{'id': 'output', 'path': ['images'], 'value': [item]}]}, 1)))
            store.commit('canvas', ACTOR, CanvasIntent.canvas_mutation(operation('delete', {'node_deletes': ['output']}, 1)))
            exported = store.read('canvas', ACTOR, CanvasProjection.full_export()).canvas
            self.assertEqual(1, exported['_realtime']['media_names']['counters']['t2i'])
            migrated = SqliteCanvasStore(Path(temp) / 'two.sqlite3', workspace_id='workspace')
            migrated.commit('canvas', ACTOR, CanvasIntent.import_canvas(exported, operation_id='import:restored'))
            result = migrated.commit('canvas', ACTOR, CanvasIntent.canvas_mutation(operation('next', {'node_creates': [{'id': 'next', 'images': [media('next')]}]}, exported['revision'])))
            self.assertEqual('t2i-02.png', result.event['changes']['node_creates'][0]['images'][0]['name'])


if __name__ == '__main__':
    unittest.main()
