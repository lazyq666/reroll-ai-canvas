import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from infinite_canvas.canvas_store import SqliteCanvasStore
from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.generation_runs import (
    GenerationRunConflict, GenerationRunNotFound, GenerationRuns, Inline, WorkflowRun,
)
from infinite_canvas.media_cleanup import MediaCleanupError, WorkspaceMediaCleanup
from infinite_canvas.music_lab import delete_failed_music_record
from infinite_canvas.providers.core import Failed, Pending


class FailedMusicExecutor:
    def __init__(self):
        self.calls = 0
        self.result = Failed('music.contentRejected')

    async def execute(self, request, **options):
        self.calls += 1
        return self.result


class MusicRecordDeletionTests(unittest.IsolatedAsyncioTestCase):
    sqlite = False

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'data').mkdir()
        (self.root / 'assets/input').mkdir(parents=True)
        (self.root / 'assets/output').mkdir(parents=True)
        self.executor = FailedMusicExecutor()
        self.lifecycle = self.worker = None
        if self.sqlite:
            SqliteCanvasStore(self.root / 'data/canvas-content.sqlite3', workspace_id='music-delete')
            self.store = SqliteGenerationRunStore(self.root / 'data/generation-runs.sqlite3', workspace_id='music-delete')
            self.worker = GenerationRunStoreExecutor(max_workers=1, max_pending=20)
            self.lifecycle = AsyncGenerationRunLifecycleStore(store=self.store, store_executor=self.worker)
        self.runs = self.make_runs()
        # Existing files from an earlier service session are eligible to reclaim.
        self.cleanup = WorkspaceMediaCleanup(now=lambda: time.time() + 60)
        self.request = WorkflowRun('suno-cover', {'operation': 'cover', 'body': {'prompt': 'private song description'}}, provider_id='apimart')

    def make_runs(self):
        return GenerationRuns(executor=self.executor, effects=object(), lifecycle_store=self.lifecycle,
                              store_path=None if self.sqlite else lambda: self.root / 'data/generation-runs.json')

    async def asyncTearDown(self):
        await self.runs.pause_active()
        await self.runs.wait_for_lifecycle_projection(through_current=True)
        if self.lifecycle:
            await self.lifecycle.close()
            await self.worker.close()
        self.temp.cleanup()

    def media(self, name):
        path = self.root / 'assets/input' / name
        path.write_bytes(b'local reference audio')
        return path

    async def record(self, refs=(), *, owner='alice', key='record', surface='suno'):
        run = await self.runs.start(self.request, owner=owner, key=key, delivery=Inline(), public_metadata={
            'surface': surface, 'operation': 'cover', 'params': {'title': 'private song title'},
            'references': [{'url': url, 'name': 'private reference'} for url in refs],
        })
        await self.runs.wait_for_lifecycle_projection(through_current=True)
        return run

    async def delete(self, run_id, *, owner='alice'):
        return await delete_failed_music_record(runs=self.runs, cleanup=self.cleanup, root=self.root,
                                               sqlite_authority=self.sqlite, run_id=run_id, owner=owner)

    async def test_erases_content_and_only_its_unused_file_survives_restart_and_retries(self):
        target = self.media('private-reference.wav')
        unrelated = self.media('unrelated-orphan.wav')
        record = await self.record(['/assets/input/private-reference.wav'])
        result = await self.delete(record.id)
        self.assertTrue(result['deleted'])
        self.assertEqual(result['file_count'], 1)
        self.assertFalse(target.exists())
        self.assertTrue(unrelated.exists(), 'This is not a whole-workspace cleanup')
        self.runs = self.make_runs()
        if self.sqlite:
            await self.runs.restore_lifecycle_authority()
            stored = self.store.load(record.id)
            self.assertEqual(stored.request, {})
            self.assertEqual(stored.remote_refs, ())
            self.assertEqual(stored.attempts, ())
            self.assertIsNone(stored.result)
            self.assertEqual(stored.error, '')
            persisted = repr(stored)
        else:
            persisted = (self.root / 'data/generation-runs.json').read_text()
        for content in ('private song', 'private-reference.wav', 'private reference', 'music.contentRejected'):
            self.assertNotIn(content, persisted)
        self.assertEqual((await self.runs.list_owned(owner='alice', surface='suno'))[0], [])
        self.assertEqual((await self.delete(record.id))['file_count'], 0)
        with self.assertRaises(GenerationRunConflict):
            await self.record(['/assets/input/private-reference.wav'])
        self.assertEqual(self.executor.calls, 1, 'An old paid operation cannot run again after deletion')

    async def test_other_records_canvas_recovery_and_session_use_keep_shared_files(self):
        names = ['other-run.wav', 'canvas.wav', 'recovery.wav', 'in-use.wav']
        paths = [self.media(name) for name in names]
        refs = ['/assets/input/' + name for name in names]
        await self.record(refs[:1], owner='bob', key='other')
        (self.root / 'data/templates.json').write_text(json.dumps({'canvas_reference': refs[1]}))
        (self.root / 'data/recovery').mkdir()
        (self.root / 'data/recovery/retained.json.bak').write_text(json.dumps({'url': refs[2]}))
        self.cleanup.lease(refs[3])
        record = await self.record(refs)
        result = await self.delete(record.id)
        self.assertEqual(result['file_count'], 0)
        self.assertEqual(result['retained_count'], 4)
        self.assertTrue(all(path.exists() for path in paths))
        self.assertEqual(len((await self.runs.list_owned(owner='bob', surface='suno'))[0]), 1)

    async def test_new_session_files_are_not_reclaimed_while_they_may_be_in_a_draft(self):
        self.cleanup = WorkspaceMediaCleanup(now=lambda: time.time() - 60)
        path = self.media('new.wav')
        record = await self.record(['/assets/input/new.wav'])
        self.assertEqual((await self.delete(record.id))['retained_count'], 1)
        self.assertTrue(path.exists())

    async def test_wrong_owner_other_surface_and_unfinished_record_cannot_delete(self):
        path = self.media('keep.wav')
        record = await self.record(['/assets/input/keep.wav'])
        with self.assertRaises(GenerationRunNotFound):
            await self.delete(record.id, owner='bob')
        other = await self.record(key='canvas', surface='canvas')
        with self.assertRaises(GenerationRunNotFound):
            await self.delete(other.id)
        self.executor.result = Pending('still-generating')
        running = await self.record(key='running')
        with self.assertRaises(GenerationRunConflict):
            await self.delete(running.id)
        self.assertTrue(path.exists())
        self.assertEqual(len((await self.runs.list_owned(owner='alice', surface='suno'))[0]), 2)

    async def test_unreadable_references_stop_before_deleting_anything(self):
        path = self.media('keep.wav')
        record = await self.record(['/assets/input/keep.wav'])
        (self.root / 'data/broken.json').write_text('{broken')
        with self.assertRaises(MediaCleanupError):
            await self.delete(record.id)
        self.assertTrue(path.exists())
        self.assertEqual((await self.runs.query(record.id, owner='alice')).public_metadata['surface'], 'suno')

    async def test_file_failure_keeps_record_and_retry_completes(self):
        path = self.media('retry.wav')
        record = await self.record(['/assets/input/retry.wav'])
        unlink = Path.unlink
        def fail_target(candidate, *args, **kwargs):
            if candidate == path:
                raise PermissionError('fixture failure')
            return unlink(candidate, *args, **kwargs)
        with mock.patch.object(Path, 'unlink', fail_target):
            with self.assertRaises(MediaCleanupError) as caught:
                await self.delete(record.id)
        self.assertEqual(caught.exception.code, 'delete_failed')
        self.assertTrue(path.exists())
        self.assertEqual(len((await self.runs.list_owned(owner='alice', surface='suno'))[0]), 1)
        self.assertEqual((await self.delete(record.id))['file_count'], 1)

    async def test_symlinks_traversal_remote_urls_and_original_files_are_not_deleted(self):
        original = self.root / 'original.wav'
        original.write_bytes(b'original')
        link = self.root / 'assets/input/link.wav'
        link.symlink_to(original)
        record = await self.record(['/assets/input/link.wav', '/assets/input/../../original.wav',
                                    str(original), 'https://example.test/original.wav'])
        self.assertEqual((await self.delete(record.id))['file_count'], 0)
        self.assertTrue(original.exists())
        self.assertTrue(link.is_symlink())

    async def test_failed_persistence_does_not_hide_record_and_can_retry(self):
        record = await self.record()
        if self.sqlite:
            patcher = mock.patch.object(self.lifecycle, 'persist', side_effect=OSError('fixture failure'))
        else:
            patcher = mock.patch('infinite_canvas.generation_runs.os.replace', side_effect=OSError('fixture failure'))
        with patcher, self.assertRaises(OSError):
            await self.delete(record.id)
        self.assertEqual(len((await self.runs.list_owned(owner='alice', surface='suno'))[0]), 1)
        self.assertTrue((await self.delete(record.id))['deleted'])


class SqliteMusicRecordDeletionTests(MusicRecordDeletionTests):
    sqlite = True


if __name__ == '__main__':
    unittest.main()
