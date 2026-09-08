import asyncio
import sqlite3
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.batch_generation import BatchGeneration
from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection, SqliteCanvasStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.turso_sqlite import TursoConnection, TursoError
from infinite_canvas.turso_stores import (
    FencedTursoConnection, TursoBatchGeneration, TursoCanvasStore, TursoGenerationRunStore,
)
from infinite_canvas.turso_workspace_lease import LEASE_SCHEMA, WorkspaceLease
from tests import test_generation_run_store as run_fixtures
from tests.test_canvas_store import ADMIN, sample_canvas
from tests.test_turso_sqlite import SqlitePipeline


async def no_provider(*args, **kwargs):
    raise AssertionError('The storage contract must not submit a Provider request')


class TursoStoreTests(unittest.TestCase):
    def setUp(self):
        self.remote = SqlitePipeline()
        self.addCleanup(self.remote.database.close)
        self.remote.database.execute('PRAGMA foreign_keys=ON')
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            SqliteCanvasStore(directory/'canvas.db', workspace_id='workspace')
            SqliteGenerationRunStore(directory/'runs.db', workspace_id='workspace')
            BatchGeneration(directory/'batch.db', submit=no_provider)
            for path in directory.glob('*.db'):
                source = sqlite3.connect(path)
                try:
                    self.remote.database.executescript('\n'.join(source.iterdump()))
                finally:
                    source.close()
        self.remote.database.executescript(LEASE_SCHEMA)
        self.remote.database.execute(
            "INSERT INTO reroll_workspace_lease(workspace_id,binding_id,state) VALUES('workspace','binding','active')"
        )
        self.lease = WorkspaceLease(self.raw_connect, workspace_id='workspace', binding_id='binding')
        self.fence = self.lease.acquire()

    def raw_connect(self):
        return TursoConnection('https://test.turso.io', 'test-token', transport=self.remote)

    def connect(self):
        return FencedTursoConnection('https://test.turso.io', 'test-token', transport=self.remote, fence=self.fence)

    def test_canvas_and_run_adapters_preserve_the_existing_store_contract(self):
        canvases = TursoCanvasStore(self.connect, workspace_id='workspace')
        runs = TursoGenerationRunStore(self.connect, workspace_id='workspace')
        document = sample_canvas()
        intent = CanvasIntent.import_canvas(document, operation_id='cloud-import')
        commit = canvases.commit(document['id'], ADMIN, intent)
        self.assertTrue(commit.changed)
        self.assertTrue(canvases.commit(document['id'], ADMIN, intent).duplicate)
        self.assertEqual(canvases.read(document['id'], ADMIN, CanvasProjection.public_snapshot()).canvas['nodes'], document['nodes'])
        run = run_fixtures.SqliteGenerationRunStoreContractTests().sample_run()
        runs.save(run)
        self.assertEqual(runs.load(run.run_id), run)
        self.assertIsNone(canvases.database_path)
        self.assertIsNone(runs.database_path)

    def test_all_three_writers_are_blocked_after_lease_expiry(self):
        canvases = TursoCanvasStore(self.connect, workspace_id='workspace')
        runs = TursoGenerationRunStore(self.connect, workspace_id='workspace')
        batches = TursoBatchGeneration(self.connect, workspace_id='workspace', submit=no_provider)
        self.remote.database.execute('UPDATE reroll_workspace_lease SET expires_at=0')
        with self.assertRaises(TursoError):
            canvases.commit('canvas-1', ADMIN, CanvasIntent.import_canvas(sample_canvas(), operation_id='expired-import'))
        with self.assertRaises(TursoError):
            runs.save(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run())
        with self.assertRaises(TursoError):
            asyncio.run(batches.start({
                'name': 'Temporary batch',
                'prompt_modules': [{'name': 'Prompt', 'options': ['test']}],
                'models': [{'model': 'test-model'}],
                'ratios': ['1:1'],
                'settings': {'outputs_per_run': 1},
            }, owner=ADMIN['id']))
        for table in ['canvases', 'generation_runs', 'batches']:
            self.assertEqual(self.remote.database.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)

    def test_a_revoked_fence_between_write_and_commit_rolls_back(self):
        with self.assertRaises(TursoError):
            with self.connect() as connection:
                connection.execute("INSERT INTO batches VALUES('batch','owner','test','paused','{}',1,1)")
                self.fence._revoked.set()
        self.assertEqual(self.remote.database.execute('SELECT count(*) FROM batches').fetchone()[0], 0)

    def test_runtime_schema_changes_and_unfenced_stores_are_rejected(self):
        with self.assertRaises(TursoError):
            TursoCanvasStore(self.raw_connect, workspace_id='workspace')
        with self.connect() as connection:
            for sql in ['CREATE TABLE accidental(id)', 'DROP TABLE canvases', 'WITH c AS (SELECT 1) DELETE FROM canvases']:
                with self.subTest(sql=sql), self.assertRaises(TursoError):
                    connection.execute(sql)
            with self.assertRaises(TursoError):
                connection.executescript('CREATE TABLE accidental(id)')

    def test_wrong_workspace_or_newer_schema_does_not_initialize_or_relabel_it(self):
        with self.assertRaises(TursoError):
            TursoCanvasStore(self.connect, workspace_id='another-workspace')
        self.remote.database.execute("UPDATE store_metadata SET value='999' WHERE key='schema_version'")
        with self.assertRaises(TursoError):
            TursoCanvasStore(self.connect, workspace_id='workspace')
        self.assertEqual(self.remote.database.execute("SELECT value FROM store_metadata WHERE key='schema_version'").fetchone()[0], '999')


if __name__ == '__main__':
    unittest.main()
