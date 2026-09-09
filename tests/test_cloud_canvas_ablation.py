"""Cloud hot-path budgets and concurrent HTTP progress, using temporary data."""

import concurrent.futures
import sqlite3
import threading
import unittest
from unittest.mock import patch

from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection, CanvasStoreError
from infinite_canvas.generation_run_store import GenerationRunEffect
from infinite_canvas.turso_sqlite import TursoError
from infinite_canvas.turso_stores import TursoCanvasStore, TursoGenerationRunStore
from tests.test_canvas_store import ADMIN, DESIGNER, sample_canvas
from tests import test_turso_stores as cloud_fixtures
from tests import test_generation_run_store as run_fixtures


class CloudCanvasRoundTripTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cloud_fixtures.TursoStoreTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.remote = self.fixture.remote
        self.store = TursoCanvasStore(self.fixture.connect, workspace_id='workspace')
        self.document = sample_canvas()
        self.document['nodes'] = [
            {'id': f'node-{index}', 'type': 'smart-prompt', 'x': index * 400,
             'y': 0, 'prompt': 'Synthetic cloud performance fixture'}
            for index in range(25)
        ]
        self.document['connections'] = []
        self.document['revision'] = 0
        self.store.commit(self.document['id'], ADMIN, CanvasIntent.import_canvas(
            self.document, operation_id='ablation:import'))

    def move(self, operation_id, revision, count, offset):
        return self.store.commit(self.document['id'], ADMIN, CanvasIntent.canvas_mutation({
            'operation_id': operation_id, 'base_revision': revision,
            'changes': {'node_updates': [
                {'id': f'node-{index}', 'path': ['x'], 'value': index * 400 + offset}
                for index in range(count)
            ]},
        }))

    def test_move_confirmation_does_not_wait_for_individual_sql_writes(self):
        self.remote.calls.clear()
        moved = self.move('ablation:move-one', 0, 1, 15)
        single_count = len(self.remote.calls)
        self.assertTrue(moved.changed)
        self.assertLessEqual(single_count, 10, 'A single move must fit within ten remote waits')

        self.remote.calls.clear()
        many = self.move('ablation:move-many', 1, 25, 30)
        self.assertTrue(many.changed)
        self.assertLessEqual(len(self.remote.calls), single_count + 1,
                             'Moving a selection must not add a remote wait for every node')
        snapshot = self.store.read(self.document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas
        self.assertEqual([node['x'] for node in snapshot['nodes']],
                         [index * 400 + 30 for index in range(25)])

    def test_empty_result_queue_does_not_acquire_a_remote_write_transaction(self):
        runs = TursoGenerationRunStore(self.fixture.connect, workspace_id='workspace')
        self.remote.calls.clear()
        self.assertIsNone(runs.claim_effect('ablation-worker', lease_seconds=30))
        self.assertEqual(len(self.remote.calls), 1,
                         'An empty queue needs one read and no write-lease transaction')

    def test_metadata_access_reads_one_row_and_rechecks_current_permissions(self):
        self.remote.calls.clear()
        metadata = self.store.read(self.document['id'], DESIGNER, CanvasProjection.metadata()).canvas
        self.assertEqual(metadata['kind'], 'smart')
        self.assertNotIn('nodes', metadata)
        self.assertNotIn('connections', metadata)
        self.assertEqual(len(self.remote.calls), 1)
        self.remote.database.execute("UPDATE canvases SET visibility='private'")
        with self.assertRaises(CanvasStoreError):
            self.store.read(self.document['id'], DESIGNER, CanvasProjection.metadata())
        self.remote.database.execute("UPDATE canvases SET visibility='shared', deleted_at=1")
        with self.assertRaises(CanvasStoreError):
            self.store.read(self.document['id'], DESIGNER, CanvasProjection.metadata())

    def test_failed_batch_rolls_back_nodes_history_and_receipt_before_retry(self):
        execute = self.remote.execute

        def fail_history(statement):
            if 'INSERT INTO canvas_mutations' in statement['sql']:
                error = sqlite3.IntegrityError('Synthetic constraint failure')
                error.sqlite_errorname = 'SQLITE_CONSTRAINT_CHECK'
                raise error
            return execute(statement)

        with patch.object(self.remote, 'execute', side_effect=fail_history):
            with self.assertRaises(CanvasStoreError):
                self.move('ablation:failed-batch', 0, 25, 30)
        canvas = self.store.read(self.document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas
        self.assertEqual(canvas['revision'], 0)
        self.assertEqual(canvas['nodes'], self.document['nodes'])
        for table in ('canvas_mutations', 'canvas_events'):
            self.assertEqual(self.remote.database.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0], 0)
        self.assertEqual(self.remote.database.execute(
            "SELECT COUNT(*) FROM canvas_operation_receipts WHERE operation_id='ablation:failed-batch'"
        ).fetchone()[0], 0)
        self.assertTrue(self.move('ablation:failed-batch', 0, 25, 30).changed)
        self.assertTrue(self.move('ablation:failed-batch', 0, 25, 30).duplicate)

    def test_revoked_edit_lease_cannot_commit_a_completed_write_batch(self):
        execute_batch = self.store._write_statements

        def revoke_after_batch(connection, statements):
            execute_batch(connection, statements)
            self.fixture.fence._revoked.set()

        with patch.object(self.store, '_write_statements', side_effect=revoke_after_batch):
            with self.assertRaises(TursoError):
                self.move('ablation:revoked-batch', 0, 25, 30)
        self.assertEqual(self.remote.database.execute('SELECT revision FROM canvases').fetchone()[0], 0)
        self.assertEqual(self.remote.database.execute('SELECT COUNT(*) FROM canvas_events').fetchone()[0], 0)

    def test_queue_candidate_is_rechecked_after_another_worker_claims_it(self):
        runs = TursoGenerationRunStore(self.fixture.connect, workspace_id='workspace')
        runs.save(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), effect=GenerationRunEffect(
            effect_id='effect:run-1', run_id='run-1', canvas_id=self.document['id'],
            payload={'node_changes': {}}, created_at=1000,
        ))
        execute = self.remote.execute
        stolen = False

        def claim_between_read_and_lock(statement):
            nonlocal stolen
            result = execute(statement)
            if not stolen and 'FROM generation_effect_outbox AS effects' in statement['sql']:
                self.assertFalse(self.remote.database.in_transaction)
                stolen = True
                self.remote.database.execute("""
                    UPDATE generation_effect_outbox SET state='claimed', lease_owner='other-worker',
                    lease_token='other-token', lease_expires_at=1000000000000, attempt_count=1
                """)
            return result

        with patch.object(self.remote, 'execute', side_effect=claim_between_read_and_lock):
            self.assertIsNone(runs.claim_effect('late-worker', lease_seconds=30))
        self.assertTrue(stolen)
        self.assertEqual(self.remote.database.execute(
            'SELECT lease_owner, lease_token, attempt_count FROM generation_effect_outbox'
        ).fetchone(), ('other-worker', 'other-token', 1))


class CloudCanvasHttpProgressTests(unittest.TestCase):
    def setUp(self):
        from tests.test_media_cleanup_http import MediaCleanupHttpTests
        self.fixture = MediaCleanupHttpTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.main, self.client = self.fixture.main, self.fixture.client
        created = self.client.post('/api/canvases', json={'title': 'Slow read fixture', 'kind': 'smart'})
        self.assertEqual(created.status_code, 200, created.text)
        self.endpoint = f"/api/smart-canvas/{created.json()['canvas']['id']}/view-state"

    def test_slow_viewport_access_check_does_not_stop_other_http_requests(self):
        for method in ('GET', 'PUT'):
            with self.subTest(method=method):
                entered, release = threading.Event(), threading.Event()
                read = self.main.CANVAS_SYNC.read

                def slow_read(*args, **kwargs):
                    entered.set()
                    release.wait(timeout=3)
                    return read(*args, **kwargs)

                with patch.object(self.main.CANVAS_SYNC, 'read', side_effect=slow_read):
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                        viewport = pool.submit(self.client.request, method, self.endpoint,
                                               **({'json': {'center_x': 10, 'center_y': 20, 'scale': 1}}
                                                  if method == 'PUT' else {}))
                        self.assertTrue(entered.wait(timeout=2))
                        account = pool.submit(self.client.get, '/api/auth/me')
                        try:
                            independent = account.result(timeout=0.5)
                            progressed = independent.status_code == 200 and not viewport.done()
                        except concurrent.futures.TimeoutError:
                            progressed = False
                        finally:
                            release.set()
                        self.assertEqual(viewport.result(timeout=3).status_code, 200)
                        self.assertTrue(progressed,
                                        'A pending cloud permission read blocked the independent account request')


if __name__ == '__main__':
    unittest.main()
