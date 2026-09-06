import asyncio
import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.media_cleanup import (
    MediaCleanupError, MediaCleanupGate, WorkspaceMediaCleanup,
)
from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from tests.test_canvas_store import ADMIN, sample_canvas


class MediaCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / 'data').mkdir()
        for kind in ('input', 'output', 'uploads'):
            (self.root / 'assets' / kind).mkdir(parents=True)
        self.now = time.time() + 60
        self.service = WorkspaceMediaCleanup(now=lambda: self.now)

    def media(self, name='unused.png', kind='output'):
        path = self.root / 'assets' / kind / name
        path.write_bytes(b'media')
        return path

    def record(self, name, value):
        path = self.root / 'data' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def scan(self, sqlite=False):
        return self.service.scan(self.root, 'admin', sqlite_authority=sqlite)

    def confirm(self, plan, sqlite=False, owner='admin'):
        return self.service.confirm(self.root, owner, plan['scan_id'], sqlite_authority=sqlite)

    def test_manual_confirmation_only_removes_previewed_unreferenced_media(self):
        paths = [self.media(kind=kind) for kind in ('input', 'output', 'uploads')]
        plan = self.scan()
        self.assertEqual((3, 15), (plan['file_count'], plan['total_bytes']))
        self.assertTrue(all(path.exists() for path in paths))
        late = self.media('after-preview.mp4')
        result = self.confirm(plan)
        self.assertEqual((3, 15), (result['file_count'], result['total_bytes']))
        self.assertTrue(late.exists())
        self.assertTrue(all(not path.exists() for path in paths))

    def test_json_roots_cover_other_canvases_trash_undo_history_assets_and_drafts(self):
        roots = {
            'canvases/other.json': {'nodes': [{'url': '/assets/output/other.png'}]},
            'canvases/trash.json': {'deleted_at': 1, 'nodes': [{'url': '/assets/output/trash.png'}]},
            'canvases/undo.json': {'_realtime': {'history': [{'inverse': {'url': '/assets/output/undo.png'}}]}},
            'generation-history.json': [{'images': ['/assets/output/history.png']}],
            'generation-runs.json': {'pending': {'input': '/assets/input/task.png'}},
            'workspace_asset_library.json': {'entries': [{'url': '/assets/output/library.png'}]},
            'conversations/one.json': {'messages': ['![ref](/api/storage-files/output/chat.png?download=1)']},
            'canvases/draft.json': {'composer': {'images': ['/assets/output/draft.png']}},
            'prompt-libraries/prompt_libraries.json': [{'cover': '/assets/output/template.png'}],
            'workflows/one.json': {'reference': '/assets/output/workflow.png'},
            'recovery/old.json': {'url': '/assets/output/recovery.png'},
        }
        for name in ('other', 'trash', 'undo', 'history', 'library', 'chat', 'draft', 'template', 'workflow', 'recovery'):
            self.media(name + '.png')
        self.media('task.png', 'input')
        for name, value in roots.items():
            self.record(name, value)
        orphan = self.media()
        result = self.confirm(self.scan())
        self.assertEqual(1, result['file_count'])
        self.assertFalse(orphan.exists())

    def test_last_reference_removed_becomes_collectible(self):
        media = self.media()
        record = self.record('canvases/one.json', {'_realtime': {'history': [{'inverse': str(media)}]}})
        self.assertEqual(0, self.scan()['file_count'])
        record.write_text('{}')
        self.assertEqual(1, self.confirm(self.scan())['file_count'])

    def test_reference_added_after_scan_is_rechecked(self):
        path = self.media()
        plan = self.scan()
        self.record('canvases/new.json', {'url': '/assets/output/unused.png'})
        result = self.confirm(plan)
        self.assertEqual(0, result['file_count'])
        self.assertEqual(1, result['skipped_count'])
        self.assertTrue(path.exists())

    def test_changed_file_and_served_media_are_kept(self):
        changed, served = self.media('changed.png'), self.media('served.png')
        plan = self.scan()
        changed.write_bytes(b'new bytes')
        self.service.lease('/assets/output/served.png')
        self.assertEqual(2, self.confirm(plan)['skipped_count'])
        self.assertTrue(changed.exists() and served.exists())

    def test_new_uploads_and_results_are_protected_without_a_canvas(self):
        service = WorkspaceMediaCleanup(now=lambda: time.time() - 1)
        self.media()
        self.assertEqual(0, service.scan(self.root, 'admin', sqlite_authority=False)['file_count'])

    def test_reimport_of_existing_content_pins_it_until_saved(self):
        from infinite_canvas.media import WorkspaceMediaService
        from infinite_canvas.workspace import Workspace
        from infinite_canvas.workspace_storage import WorkspacePaths
        workspace = Workspace.from_paths(WorkspacePaths(self.root / 'data', self.root / 'assets', self.root / 'settings.json'))
        importer = WorkspaceMediaService(workspace)
        importer.import_bytes(b'old reference', name='image.png')
        plan = self.scan()
        self.assertEqual(1, plan['file_count'])
        importer = WorkspaceMediaService(workspace, lease=self.service.lease)
        importer.import_bytes(b'old reference', name='image.png')
        self.assertEqual(1, self.confirm(plan)['skipped_count'])

    def test_pending_publication_blocks_cleanup(self):
        self.record('generation-effects.json', {'pending': {'run-one': ['history']}})
        with self.assertRaises(MediaCleanupError) as raised:
            self.scan()
        self.assertEqual('busy', raised.exception.code)

    def test_url_aliases_encoded_names_absolute_paths_and_content_ids(self):
        for name in ('a b.png', 'absolute.png', 'a' * 64 + '.png'):
            self.media(name)
        self.record('references.json', {'urls': [
            '/assets/output/a%20b.png?download=1', str(self.root / 'assets/output/absolute.png'),
        ], 'media_id': 'a' * 64})
        self.assertEqual(0, self.scan()['file_count'])

    def test_damaged_or_unknown_reference_records_block_all_deletion(self):
        media = self.media()
        plan = self.scan()
        for name, content in [('bad.json', '{broken'), ('unknown.bin', 'anything')]:
            with self.subTest(name=name):
                record = self.root / 'data' / name
                record.write_text(content)
                with self.assertRaises(MediaCleanupError):
                    self.confirm(plan)
                self.assertTrue(media.exists())
                record.unlink()

    def test_symlinks_hardlinks_hidden_and_unknown_media_are_not_candidates(self):
        source = self.root / 'source.png'
        source.write_bytes(b'outside')
        (self.root / 'assets/output/link.png').symlink_to(source)
        (self.root / 'assets/input/external').symlink_to(self.root, target_is_directory=True)
        os.link(source, self.root / 'assets/output/hard.png')
        self.media('.upload.png')
        self.media('unknown.xyz')
        self.media('ambiguous#name.png')
        self.assertEqual(0, self.scan()['file_count'])

    def test_owner_expiry_and_replay_do_not_delete_files(self):
        media = self.media()
        plan = self.scan()
        with self.assertRaises(MediaCleanupError):
            self.confirm(plan, owner='other')
        self.now += 601
        with self.assertRaises(MediaCleanupError):
            self.confirm(plan)
        self.assertTrue(media.exists())
        plan = self.scan()
        self.confirm(plan)
        with self.assertRaises(MediaCleanupError):
            self.confirm(plan)

    def test_failed_unlink_reports_actual_freed_bytes(self):
        self.media()
        plan = self.scan()
        with patch.object(Path, 'unlink', side_effect=PermissionError):
            result = self.confirm(plan)
        self.assertEqual((0, 0, 1), (result['file_count'], result['total_bytes'], result['failed_count']))

    def test_sqlite_current_canvas_and_wal_history_are_roots(self):
        store = SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        runs = SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        document = sample_canvas()
        document['nodes'][0]['url'] = '/assets/output/canvas.png'
        store.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='cleanup:import'))
        self.media('canvas.png')
        self.media('history.mp4')
        self.media('orphan.png')
        runs.publish_history('run-one', 'history-one', {'id': 'history-one', 'timestamp': 1, 'videos': ['/assets/output/history.mp4']})
        self.assertEqual(1, self.scan(sqlite=True)['file_count'])
        runs.delete_history(history_id='history-one')
        self.assertEqual(2, self.scan(sqlite=True)['file_count'])

    def test_missing_sqlite_authority_stops_scan(self):
        self.media()
        with self.assertRaises(MediaCleanupError):
            self.scan(sqlite=True)

    def test_empty_publication_sidecars_do_not_block_sqlite_cleanup(self):
        SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        orphan = self.media()
        sidecars = []
        for database in ('canvas-content.sqlite3', 'generation-runs.sqlite3'):
            for phase in ('publish', 'resume'):
                base = self.root / 'data' / f'.{database}.{"a" * 32}.{phase}'
                for suffix, content in (('-wal', b''), ('-shm', b'index metadata')):
                    path = Path(str(base) + suffix)
                    path.write_bytes(content)
                    sidecars.append(path)
        plan = self.scan(sqlite=True)
        self.assertEqual(1, plan['file_count'])
        self.assertTrue(orphan.exists())
        self.assertEqual(1, self.confirm(plan, sqlite=True)['file_count'])
        self.assertTrue(all(path.exists() for path in sidecars))

    def test_unproven_publication_sidecars_still_block_deletion(self):
        SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        media = self.media()
        plan = self.scan(sqlite=True)
        base = self.root / 'data' / f'.canvas-content.sqlite3.{"a" * 32}.publish'
        cases = [
            {str(base) + '-wal': b'uncheckpointed data'},
            {str(base) + '-shm': b'index without WAL'},
            {str(base) + '-wal': b'', str(base): b'unpublished database'},
            {str(base).replace('.publish', '.unknown') + '-wal': b''},
            {str(base).replace('canvas-content', 'unknown') + '-wal': b''},
            {str(base).replace('a' * 32, 'unknown') + '-wal': b''},
        ]
        for files in cases:
            with self.subTest(files=list(files)):
                for name, content in files.items():
                    Path(name).write_bytes(content)
                with self.assertRaises(MediaCleanupError):
                    self.confirm(plan, sqlite=True)
                self.assertTrue(media.exists())
                for name in files:
                    Path(name).unlink()

    def test_publication_sidecar_exception_requires_sqlite_authority(self):
        for database in ('canvas-content.sqlite3', 'generation-runs.sqlite3'):
            with sqlite3.connect(self.root / 'data' / database):
                pass
        (self.root / 'data' / f'.canvas-content.sqlite3.{"a" * 32}.publish-wal').write_bytes(b'')
        with self.assertRaises(MediaCleanupError):
            self.scan()

    def test_pending_sqlite_effect_keeps_its_media_without_blocking_cleanup(self):
        from dataclasses import replace
        from infinite_canvas.generation_run_store import GenerationRunEffect
        from tests.test_generation_run_store import SqliteGenerationRunStoreContractTests
        SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        runs = SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        run = replace(SqliteGenerationRunStoreContractTests().sample_run(), status='succeeded')
        effect = GenerationRunEffect(
            effect_id='effect:run-1', run_id=run.run_id, canvas_id='canvas-1',
            payload={'images': ['/assets/output/pending-only.png']}, created_at=1000,
        )
        runs.save(run, effect=effect)
        pending = self.media('pending-only.png')
        orphan = self.media()
        plan = self.scan(sqlite=True)
        self.assertEqual(1, plan['file_count'])
        self.assertEqual(1, self.confirm(plan, sqlite=True)['file_count'])
        self.assertTrue(pending.exists())
        self.assertFalse(orphan.exists())
        orphan = self.media('another-orphan.png')
        plan = self.scan(sqlite=True)
        claim = runs.claim_effect('worker', lease_seconds=30)
        self.assertIsNotNone(claim)
        with self.assertRaises(MediaCleanupError) as raised:
            self.confirm(plan, sqlite=True)
        self.assertEqual('busy', raised.exception.code)
        self.assertTrue(pending.exists() and orphan.exists())

    def test_pending_sqlite_publication_keeps_its_payload_media(self):
        SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        runs = SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        claim = runs.claim_publication(
            'worker', lease_seconds=30, run_id='old-run', effect_kind='history',
            payload={'images': ['/assets/output/pending-history.png']},
        )
        pending = self.media('pending-history.png')
        orphan = self.media()
        with self.assertRaises(MediaCleanupError) as raised:
            self.scan(sqlite=True)
        self.assertEqual('busy', raised.exception.code)
        runs.settle_publication(claim, completed=False, detail='retry', retry_delay_seconds=60)
        self.assertEqual(1, self.confirm(self.scan(sqlite=True), sqlite=True)['file_count'])
        self.assertTrue(pending.exists())
        self.assertFalse(orphan.exists())

    def test_sqlite_undo_expiry_releases_media_without_event_cache_pinning(self):
        store = SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='test')
        SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='test')
        document = sample_canvas()
        document['nodes'][0]['url'] = '/assets/output/undo-source.png'
        media = self.media('undo-source.png')
        store.commit(document['id'], ADMIN, CanvasIntent.import_canvas(document, operation_id='cleanup:import'))
        deleted = store.commit(document['id'], ADMIN, CanvasIntent.canvas_mutation({
            'operation_id': 'cleanup:delete-node', 'base_revision': 7,
            'changes': {'node_deletes': ['node-a']},
        }))
        self.assertEqual(0, self.scan(sqlite=True)['file_count'])
        revision = deleted.revision
        for index in range(200):
            result = store.commit(document['id'], ADMIN, CanvasIntent.canvas_mutation({
                'operation_id': f'cleanup:edit-{index:04d}', 'base_revision': revision,
                'changes': {'node_updates': [{'id': 'node-b', 'path': ['x'], 'value': index + 100}]},
            }))
            revision = result.revision
        self.assertEqual(1, self.confirm(self.scan(sqlite=True), sqlite=True)['file_count'])
        self.assertFalse(media.exists())


class MediaCleanupGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_deletion_keeps_media_in_both_storage_modes(self):
        from infinite_canvas.generation_publication import (
            LegacyGenerationPublication, LegacyGenerationPublicationPorts, SqliteGenerationPublication,
        )
        from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
        async def notify(*_args, **_kwargs):
            pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / 'shared.png'
            media.write_bytes(b'shared by another canvas')
            history = root / 'history.json'
            history.write_text(json.dumps([{'id': 'one', 'timestamp': 1, 'images': ['/assets/output/shared.png']}]))
            legacy = LegacyGenerationPublication(LegacyGenerationPublicationPorts(
                history_path=lambda: history, journal_path=lambda: root / 'effects.json',
                history_lock=threading.RLock(), notify=notify,
                output_file_from_url=lambda _: str(media),
            ))
            self.assertEqual(1, len(await legacy.delete_history(history_id='one')))
            self.assertTrue(media.exists())
            store = SqliteGenerationRunStore(root / 'runs.sqlite3', workspace_id='test')
            store.publish_history('run-one', 'one', {'timestamp': 1, 'images': ['/assets/output/shared.png']})
            executor = GenerationRunStoreExecutor()
            try:
                publication = SqliteGenerationPublication(
                    store=store, store_executor=executor, notify=notify, worker_id='test',
                    output_file_from_url=lambda _: str(media),
                )
                self.assertEqual(1, len(await publication.delete_history(history_id='one')))
                self.assertTrue(media.exists())
            finally:
                await executor.close()

    async def test_cleanup_waits_for_existing_saves_and_blocks_new_mutations(self):
        gate = MediaCleanupGate()
        events = []
        entered, release = asyncio.Event(), asyncio.Event()
        async def existing_save():
            async with gate.activity():
                entered.set()
                await release.wait()
                events.append('saved')
        async def cleanup():
            async with gate.exclusive():
                events.append('cleaned')
        save = asyncio.create_task(existing_save())
        await entered.wait()
        clean = asyncio.create_task(cleanup())
        await asyncio.sleep(0)
        self.assertEqual([], events)
        async def new_mutation():
            async with gate.activity():
                events.append('mutated')
        mutation = asyncio.create_task(new_mutation())
        release.set()
        await asyncio.gather(save, clean, mutation)
        self.assertEqual(['saved', 'cleaned', 'mutated'], events)

    async def test_failure_releases_admission(self):
        gate = MediaCleanupGate()
        with self.assertRaises(RuntimeError):
            async with gate.exclusive():
                raise RuntimeError()
        async with gate.activity():
            pass


if __name__ == '__main__':
    unittest.main()
