"""Opt-in synthetic-data probe; refuses ordinary application database URLs.

REROLL_TURSO_PROBE_CREDENTIALS points to a private JSON file with url and token.
The database hostname must start with reroll-cloud-probe-. Never supply a user
Workspace database: this suite initializes synthetic schema and records.
"""

import json
import os
import sqlite3
import unittest
from contextlib import closing, contextmanager
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection, SqliteCanvasStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.turso_sqlite import TursoConnection, TursoError, database_url
from infinite_canvas.turso_workspace_lease import LEASE_SCHEMA, WorkspaceLease
from infinite_canvas.turso_stores import FencedTursoConnection, TursoCanvasStore, TursoGenerationRunStore
from tests.test_canvas_store import ADMIN, sample_canvas
from tests import test_generation_run_store as run_fixtures


class ProbeConnection(TursoConnection):
    def execute(self, sql, parameters=()):
        # Local WAL configuration is not a writable cloud PRAGMA. This probe
        # explicitly replaces only that initialization statement; production
        # composition is not changed by importing this test.
        if sql == 'PRAGMA journal_mode = WAL':
            sql = 'PRAGMA journal_mode'
        return super().execute(sql, parameters)


class RemoteMixin:
    @contextmanager
    def _connect(self):
        with closing(self._probe_connect()) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA foreign_keys = ON')
            yield connection


class RemoteCanvas(RemoteMixin, SqliteCanvasStore):
    pass


class RemoteRuns(RemoteMixin, SqliteGenerationRunStore):
    pass


@unittest.skipUnless(os.getenv('REROLL_TURSO_PROBE_CREDENTIALS'), 'Explicit disposable Turso probe credentials required')
class TursoLiveProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = json.loads(Path(os.environ['REROLL_TURSO_PROBE_CREDENTIALS']).read_text())
        cls.url = database_url(config['url'])
        if not urlsplit(cls.url).hostname.startswith('reroll-cloud-probe-'):
            raise ValueError('This test only accepts a disposable reroll-cloud-probe database')
        cls.token = config['token']
        with closing(cls.connect()) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for metadata in ['store_metadata', 'generation_run_store_metadata']:
                if metadata in tables:
                    row = connection.execute(f"SELECT value FROM {metadata} WHERE key='workspace_id'").fetchone()
                    if row and row[0] != 'probe-workspace':
                        raise ValueError('The target contains another Workspace; probe refused')

    @classmethod
    def connect(cls):
        return ProbeConnection(cls.url, cls.token)

    def setUp(self):
        self.identity = uuid4().hex

    def store(self, store_type):
        store = store_type.__new__(store_type)
        store._probe_connect = self.connect
        store_type.__init__(store, '/unused/probe', workspace_id='probe-workspace')
        return store

    def test_import_move_duplicate_receipt_and_independent_device_read(self):
        first_device = self.store(RemoteCanvas)
        second_device = self.store(RemoteCanvas)
        document = sample_canvas('probe-canvas-' + self.identity)
        first_device.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='import:' + self.identity))
        mutation = CanvasIntent.canvas_mutation({
            'operation_id': 'move:' + self.identity,
            'base_revision': 7,
            'changes': {'node_updates': [{'id': 'node-a', 'path': ['x'], 'value': 987}]},
        })
        commit = first_device.commit(document['id'], ADMIN, mutation)
        self.assertTrue(commit.changed)
        self.assertEqual(commit.revision, 8)
        duplicate = first_device.commit(document['id'], ADMIN, mutation)
        self.assertTrue(duplicate.duplicate)
        readback = second_device.read(document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas
        self.assertEqual(readback['nodes'][0]['x'], 987)
        self.assertEqual(readback['revision'], 8)
        self.assertEqual(readback['connections'], document['connections'])

    def test_generation_run_round_trip_from_another_connection(self):
        runs = self.store(RemoteRuns)
        expected = replace(
            run_fixtures.SqliteGenerationRunStoreContractTests().sample_run('probe-run-' + self.identity),
            key='probe-key-' + self.identity,
        )
        runs.save(expected)
        second_device = self.store(RemoteRuns)
        self.assertEqual(second_device.load(expected.run_id), expected)

    def test_remote_expiry_and_successor_fence(self):
        workspace = 'lease-probe-' + self.identity
        with closing(self.connect()) as connection:
            connection.executescript(LEASE_SCHEMA)
            with connection:
                connection.execute(
                    "INSERT INTO reroll_workspace_lease(workspace_id,binding_id,state) VALUES (?,?,'active')",
                    (workspace, self.identity),
                )
        a = WorkspaceLease(self.connect, workspace_id=workspace, binding_id=self.identity)
        b = WorkspaceLease(self.connect, workspace_id=workspace, binding_id=self.identity)
        old = a.acquire()
        with self.assertRaises(TursoError):
            b.acquire()
        with closing(self.connect()) as connection:
            with connection:
                connection.execute('UPDATE reroll_workspace_lease SET expires_at=0 WHERE workspace_id=?', (workspace,))
        new = b.acquire()
        self.assertGreater(new.epoch, old.epoch)
        with self.assertRaises(TursoError):
            with old.transaction(self.connect):
                self.fail('Stale device admitted')
        a.release()
        with new.transaction(self.connect) as connection:
            self.assertEqual(connection.execute('SELECT 1').fetchone(), (1,))
        b.release()

    def test_chunked_statement_failure_rolls_back_previous_chunks(self):
        with closing(self.connect()) as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS batch_transport_probe (test_id TEXT, value INTEGER, PRIMARY KEY(test_id,value))')
            with self.assertRaises(sqlite3.IntegrityError):
                with connection:
                    connection.executemany(
                        'INSERT INTO batch_transport_probe VALUES (?,?)',
                        ((self.identity, i % 280) for i in range(300)),
                    )
            self.assertEqual(connection.execute('SELECT count(*) FROM batch_transport_probe WHERE test_id=?', (self.identity,)).fetchone()[0], 0)

    def test_runtime_store_adapters_enforce_the_remote_fence(self):
        self.store(RemoteCanvas)
        self.store(RemoteRuns)
        with closing(self.connect()) as connection:
            connection.executescript(LEASE_SCHEMA)
            with connection:
                connection.execute(
                    "INSERT INTO reroll_workspace_lease(workspace_id,binding_id,state) VALUES('probe-workspace','runtime-probe','active') ON CONFLICT(workspace_id) DO NOTHING"
                )
        lease = WorkspaceLease(self.connect, workspace_id='probe-workspace', binding_id='runtime-probe')
        fence = lease.acquire()
        self.addCleanup(lease.release)
        def guarded():
            return FencedTursoConnection(self.url, self.token, fence=fence)
        canvases = TursoCanvasStore(guarded, workspace_id='probe-workspace')
        runs = TursoGenerationRunStore(guarded, workspace_id='probe-workspace')
        document = sample_canvas('fenced-' + self.identity)
        commit = canvases.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='fenced-import:' + self.identity))
        self.assertTrue(commit.changed)
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run('fenced-run-' + self.identity), key='fenced-key-' + self.identity)
        runs.save(run)
        self.assertEqual(runs.load(run.run_id), run)
        with closing(self.connect()) as connection:
            with connection:
                connection.execute("UPDATE reroll_workspace_lease SET expires_at=0 WHERE workspace_id='probe-workspace'")
        with self.assertRaises(TursoError):
            canvases.commit(document['id'], ADMIN, CanvasIntent.canvas_mutation({
                'operation_id': 'fenced-rejected:' + self.identity,
                'base_revision': commit.revision,
                'changes': {'node_updates': [{'id':'node-a','path':['x'],'value':900}]},
            }))
        self.assertEqual(canvases.read(document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas['nodes'][0]['x'], document['nodes'][0]['x'])


if __name__ == '__main__':
    unittest.main()
