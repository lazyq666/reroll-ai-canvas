import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.workspace import Workspace
from infinite_canvas.turso_bundle import create_bundle, verify_staging_tables
from infinite_canvas.turso_migration import DATABASES, CloudMigrationError, _fingerprint
from infinite_canvas.turso_runtime import TursoWorkspaceRuntime
from infinite_canvas.turso_sqlite import TursoConnection, TursoError
from infinite_canvas.turso_switch import CloudStorageSwitch, atomic_json
from infinite_canvas.workspace_storage_composition import compose_workspace_storage, WorkspaceStorageCompositionError
from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection
from tests import test_turso_migration as migration_fixtures
from tests.test_turso_sqlite import SqlitePipeline
from tests.test_canvas_store import ADMIN, sample_canvas


class TursoSwitchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = migration_fixtures.TursoMigrationInspectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.data = self.fixture.directory
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.root = self.state / 'cloud-migrations' / 'initial'
        self.root.mkdir(parents=True)
        self.content = WorkspaceContent(Workspace(directory=self.data.parent, _records_directory=self.data, _media_directory=self.data.parent / 'assets'))
        self.local_authority = {'schema_version': 1, 'workspace_id': 'workspace', 'migration_id': 'initial', 'canvas': 'sqlite', 'generation_runs': 'sqlite'}
        atomic_json(self.content.storage_authority, self.local_authority)
        self.bundle = self.root / 'bundle.db'
        self.expected = create_bundle(self.data, self.bundle, workspace_id='workspace', binding_id='binding')
        atomic_json(self.root / 'migration.json', {
            'workspace_id': 'workspace', 'binding_id': 'binding',
            'sources': {name: {'fingerprint': _fingerprint(self.data / name)} for name in DATABASES},
        })
        atomic_json(self.root / 'bundle-verification.json', self.expected)
        self.remote = SqlitePipeline()
        self.addCleanup(self.remote.database.close)
        with closing(sqlite3.connect(self.bundle)) as source:
            self.remote.database.executescript('\n'.join(source.iterdump()))
        self.remote.database.execute('PRAGMA foreign_keys=ON')
        result = self.verify()
        atomic_json(self.root / 'cloud-verification.json', {
            **result, 'verified': True, 'workspace_id': 'workspace', 'binding_id': 'binding',
            'source_manifest_sha256': hashlib.sha256((self.root / 'bundle-verification.json').read_bytes()).hexdigest(),
        })
        atomic_json(self.state / 'turso-connection.json', {
            'schema_version': 1, 'workspace_id': 'workspace', 'url': 'https://test.turso.io',
            'token': 'private-test-token', 'migration_directory': str(self.root),
        })
        self.switch = CloudStorageSwitch(self.content, workspace_id='workspace', state_directory=self.state, connect=self.connect)

    def connect(self):
        return TursoConnection('https://test.turso.io', 'private-test-token', transport=self.remote)

    def verify(self):
        return verify_staging_tables(self.connect, self.bundle, workspace_id='workspace', binding_id='binding', expected=self.expected['tables'])

    def runtime(self):
        runtime = TursoWorkspaceRuntime(self.state / 'turso-connection.json', workspace_id='workspace', binding_id='binding', device_id='device', transport=self.remote)
        self.addCleanup(runtime.close)
        return runtime

    def test_round_trip_returns_latest_cloud_edit_and_blocks_stale_onedrive_copy(self):
        originals = {name: (self.data / name).read_bytes() for name in DATABASES}
        self.switch.enable()
        runtime = self.runtime()
        cloud = compose_workspace_storage(self.content, workspace_id='workspace', cloud_runtime=lambda _: runtime)
        cloud.canvas_store.commit('canvas-1', ADMIN, CanvasIntent.import_canvas(sample_canvas(), operation_id='after-import'))
        self.assertEqual(originals, {name: (self.data / name).read_bytes() for name in DATABASES})
        self.switch.disable(runtime)
        self.assertEqual(self.remote.database.execute('SELECT state FROM reroll_workspace_lease').fetchone(), ('retired',))
        local = compose_workspace_storage(self.content, workspace_id='workspace')
        self.assertEqual(local.mode, 'sqlite')
        self.assertEqual(local.canvas_store.read('canvas-1', ADMIN, CanvasProjection.public_snapshot()).canvas['nodes'], sample_canvas()['nodes'])
        (self.data / DATABASES[1]).write_bytes(originals[DATABASES[1]])
        with self.assertRaisesRegex(WorkspaceStorageCompositionError, 'local_copy_incomplete'):
            compose_workspace_storage(self.content, workspace_id='workspace')

    def test_changed_source_or_unverified_import_never_publishes_cloud(self):
        with sqlite3.connect(self.data / DATABASES[0]) as connection:
            connection.execute("INSERT INTO store_metadata VALUES('changed','yes')")
        connection.close()
        with self.assertRaisesRegex(TursoError, 'source_changed'):
            self.switch.enable()
        self.assertEqual(json.loads(self.content.storage_authority.read_text()), self.local_authority)
        self.assertEqual(self.remote.database.execute('SELECT state FROM reroll_workspace_lease').fetchone(), ('staging',))
        (self.root / 'cloud-verification.json').unlink()
        with self.assertRaisesRegex(TursoError, 'configuration_required'):
            self.switch.enable()

    def test_cloud_digest_rejects_changed_rows_and_binding(self):
        self.remote.database.execute("UPDATE store_metadata SET value='altered' WHERE key='workspace_id'")
        with self.assertRaisesRegex(CloudMigrationError, 'copy_mismatch'):
            self.verify()
        self.remote.database.execute("UPDATE reroll_workspace_lease SET binding_id='foreign'")
        with self.assertRaisesRegex(CloudMigrationError, 'binding_mismatch'):
            self.verify()

    def test_interrupted_return_retries_from_journal_without_reviving_cloud(self):
        self.switch.enable()
        runtime = self.runtime()
        runtime.canvas_store.commit('canvas-1', ADMIN, CanvasIntent.import_canvas(sample_canvas(), operation_id='latest-cloud-edit'))
        with patch.object(self.switch, '_publish_local', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.switch.disable(runtime)
        with self.assertRaises(TursoError):
            runtime.connect()
        self.assertEqual(json.loads(self.content.storage_authority.read_text())['canvas'], 'turso')
        self.switch.disable(runtime)
        local = compose_workspace_storage(self.content, workspace_id='workspace')
        self.assertEqual(local.canvas_store.read('canvas-1', ADMIN, CanvasProjection.public_snapshot()).canvas['nodes'], sample_canvas()['nodes'])
        before = (self.data / DATABASES[0]).read_bytes()
        self.switch.disable(runtime)
        self.assertEqual(before, (self.data / DATABASES[0]).read_bytes())


if __name__ == '__main__':
    unittest.main()
