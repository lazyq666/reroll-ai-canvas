import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.sqlite_workspace_bootstrap import bootstrap_fresh_workspace_sqlite
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage
from infinite_canvas.workspace_handoff import HandoffError, WorkspaceHandoff


class WorkspaceHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.workspace = self.root / 'workspace'
        (self.workspace / 'data').mkdir(parents=True)
        (self.workspace / 'assets').mkdir()
        self.storage = WorkspaceStorage(self.root / 'app', state_dir=self.root / 'device-a')
        self.storage.save_parent(self.workspace)
        self.service = WorkspaceService(self.storage)
        self.identity = self.service.ensure_identity()
        bootstrap_fresh_workspace_sqlite(WorkspaceContent(self.service.current()), workspace_id=self.identity)
        (self.workspace / 'assets/image.png').write_bytes(b'example-media')
        self.a = WorkspaceHandoff(self.workspace, self.root / 'device-a', self.identity, 'a')
        self.b = WorkspaceHandoff(self.workspace, self.root / 'device-b', self.identity, 'b')

    def test_unenabled_workspace_is_unchanged(self):
        self.a.acquire()
        self.assertFalse(self.a.path.exists())

    def test_identical_database_copy_recommends_keep_current_and_select_copy(self):
        self.a.check_databases(checkpoint=True)
        current = self.workspace / 'data/canvas-content.sqlite3'
        duplicate = current.with_name('canvas-content-MacBook.sqlite3')
        shutil.copyfile(current, duplicate)
        report = self.a.conflict_report(for_cleanup=True)
        item = report['files'][0]
        self.assertEqual('data/canvas-content.sqlite3', item['retained']['path'])
        self.assertTrue(item['recommended_remove'])
        self.assertTrue(item['can_remove'])
        self.assertFalse(self.a.path.exists())

    def database_copy(self, different=False):
        current = self.workspace / 'data/canvas-content.sqlite3'
        if different:
            db = sqlite3.connect(current)
            columns = db.execute('PRAGMA table_info(canvases)').fetchall()
            values = [{'canvas_id':'canvas-1','kind':'smart','title':'Comparison canvas'}.get(row[1], 0 if row[2]=='INTEGER' else '') for row in columns]
            db.execute('INSERT INTO canvases VALUES (' + ','.join('?' for _ in values) + ')', values)
            db.execute("INSERT INTO canvas_nodes VALUES ('canvas-1','shared',0,'old')")
            db.execute("INSERT INTO canvas_nodes VALUES ('canvas-1','current-only',1,'current')")
            db.commit()
            db.close()
        self.a.check_databases(checkpoint=True)
        duplicate = current.with_name('canvas-content-MacBook.sqlite3')
        shutil.copyfile(current, duplicate)
        if different:
            db = sqlite3.connect(duplicate)
            db.execute("UPDATE canvas_nodes SET payload_json='new' WHERE node_id='shared'")
            db.execute("UPDATE canvas_nodes SET node_id='copy-only' WHERE node_id='current-only'")
            db.commit()
            db.close()
        return current, duplicate

    def test_different_database_shows_actual_node_differences_and_is_not_preselected(self):
        current, duplicate = self.database_copy(different=True)
        report = self.a.conflict_report(for_cleanup=True)
        entry = report['files'][0]
        self.assertTrue(entry['can_remove'])
        self.assertFalse(entry['recommended_remove'])
        diff = entry['comparison']
        self.assertEqual((2, 2, 1, 1, 1), (diff['current_nodes'], diff['copy_nodes'], diff['current_only'], diff['copy_only'], diff['changed']))
        before, copy_before = current.read_bytes(), duplicate.read_bytes()
        result = self.a.cleanup_conflicts(report['snapshot'], [entry['path']])
        backup = Path(result['backup_directory'])
        self.assertEqual(before, current.read_bytes())
        self.assertEqual(before, (backup / 'data/canvas-content.sqlite3').read_bytes())
        self.assertEqual(copy_before, (backup / entry['path']).read_bytes())
        self.assertFalse(duplicate.exists())
        self.a.seal()

    def test_cleanup_rejects_changed_confirmation_and_primary_path(self):
        current, duplicate = self.database_copy()
        report = self.a.conflict_report(for_cleanup=True)
        with self.assertRaisesRegex(HandoffError, 'conflictsManual'):
            self.a.cleanup_conflicts(report['snapshot'], ['data/canvas-content.sqlite3'])
        with self.assertRaisesRegex(HandoffError, 'conflictsManual'):
            self.a.cleanup_conflicts(report['snapshot'], ['../outside'])
        duplicate.touch()
        with self.assertRaisesRegex(HandoffError, 'conflictsChanged'):
            self.a.cleanup_conflicts(report['snapshot'], [report['files'][0]['path']])
        self.assertTrue(current.exists())
        self.assertTrue(duplicate.exists())

    def test_database_with_uncheckpointed_wal_cannot_be_selected(self):
        current, duplicate = self.database_copy()
        Path(str(duplicate) + '-wal').write_bytes(b'uncheckpointed')
        report = self.a.conflict_report(for_cleanup=True)
        self.assertFalse(report['files'][0]['can_remove'])
        self.assertFalse(report['files'][0]['recommended_remove'])
        with self.assertRaisesRegex(HandoffError, 'conflictsManual'):
            self.a.cleanup_conflicts(report['snapshot'], [report['files'][0]['path']])
        self.assertTrue(duplicate.exists())

    def test_cleanup_backup_failure_removes_nothing(self):
        current, duplicate = self.database_copy()
        report = self.a.conflict_report(for_cleanup=True)
        with patch('infinite_canvas.workspace_handoff.shutil.copyfile', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.a.cleanup_conflicts(report['snapshot'], [report['files'][0]['path']])
        self.assertTrue(current.exists())
        self.assertTrue(duplicate.exists())

    def test_cleanup_cannot_override_foreign_active_record(self):
        result = self.a.seal()
        self.b.acquire(result['id'])
        _, duplicate = self.database_copy()
        report = self.a.conflict_report(for_cleanup=True)
        with self.assertRaisesRegex(HandoffError, 'unclean'):
            self.a.cleanup_conflicts(report['snapshot'], [report['files'][0]['path']])
        self.assertTrue(duplicate.exists())

    def test_cleanup_preserves_sync_replacement_at_original_path(self):
        current, duplicate = self.database_copy()
        report = self.a.conflict_report(for_cleanup=True)
        rename = Path.rename
        def replace_during_move(source, target):
            result = rename(source, target)
            if source == duplicate:
                source.write_bytes(b'new sync copy')
            return result
        with patch.object(Path, 'rename', replace_during_move):
            self.a.cleanup_conflicts(report['snapshot'], [report['files'][0]['path']])
        self.assertEqual(b'new sync copy', duplicate.read_bytes())
        with self.assertRaisesRegex(HandoffError, 'conflict'):
            self.a.seal()

    def test_conflict_report_names_files_without_guessing_latest_code(self):
        self.a.seal()
        duplicate = self.a.control / 'handoff-PC.json'
        shutil.copyfile(self.a.path, duplicate)
        with self.assertRaisesRegex(HandoffError, 'conflict'):
            self.b.acquire()
        report = self.b.conflict_report()
        self.assertEqual(['.infinite-canvas-service/handoff-PC.json'],
                         [item['path'] for item in report['files']])
        self.assertTrue(report['files'][0]['same_as_current'])
        self.assertNotIn('id', report['current'])
        self.assertTrue(duplicate.exists())

    def duplicate_record(self):
        result = self.a.seal()
        duplicate = self.a.control / 'handoff-PC.json'
        shutil.copyfile(self.a.path, duplicate)
        return result, duplicate

    def test_archive_preserves_different_records_and_requires_full_verification(self):
        result, duplicate = self.duplicate_record()
        duplicate.write_text('{"different": "record"}')
        original = self.a.path.read_bytes()
        report = self.b.conflict_report()
        self.assertFalse(report['files'][0]['same_as_current'])
        backup = Path(self.b.archive_conflicts(result['id'], report['snapshot']))
        self.assertEqual(original, (backup / 'handoff.json').read_bytes())
        self.assertEqual('{"different": "record"}', (backup / duplicate.name).read_text())
        self.assertFalse(duplicate.exists())
        self.assertEqual(original, self.a.path.read_bytes())
        self.b.acquire(result['id'])

    def test_wrong_code_changed_list_or_changed_data_never_archives(self):
        result, duplicate = self.duplicate_record()
        snapshot = self.b.conflict_report()['snapshot']
        with self.assertRaisesRegex(HandoffError, 'code'):
            self.b.archive_conflicts('wrong', snapshot)
        duplicate.write_text('{}')
        with self.assertRaisesRegex(HandoffError, 'conflictsChanged'):
            self.b.archive_conflicts(result['id'], snapshot)
        snapshot = self.b.conflict_report()['snapshot']
        (self.workspace / 'assets/image.png').write_bytes(b'different')
        with self.assertRaisesRegex(HandoffError, 'changed'):
            self.b.archive_conflicts(result['id'], snapshot)
        self.assertEqual('{}', duplicate.read_text())
        self.assertFalse((self.b.local / 'conflicts').exists())

    def test_database_conflict_is_named_but_cannot_be_archived(self):
        result, _ = self.duplicate_record()
        database = self.workspace / 'data/canvas-content-PC.sqlite3'
        shutil.copyfile(self.workspace / 'data/canvas-content.sqlite3', database)
        report = self.b.conflict_report()
        self.assertIn('data/canvas-content-PC.sqlite3', [item['path'] for item in report['files']])
        self.assertFalse(report['can_archive'])
        with self.assertRaisesRegex(HandoffError, 'conflictsManual'):
            self.b.archive_conflicts(result['id'], report['snapshot'])
        self.assertTrue(database.exists())

    def test_unreadable_symlink_and_active_record_disable_archive(self):
        result, duplicate = self.duplicate_record()
        duplicate.unlink()
        duplicate.symlink_to(self.a.path)
        self.assertFalse(self.b.conflict_report()['can_archive'])
        duplicate.unlink()
        self.a.acquire(result['id'])
        shutil.copyfile(self.a.path, duplicate)
        self.assertFalse(self.a.conflict_report()['can_archive'])

    def test_failed_archive_keeps_detectable_staging_copy(self):
        result, duplicate = self.duplicate_record()
        original = duplicate.read_bytes()
        snapshot = self.b.conflict_report()['snapshot']
        copy = shutil.copyfile
        def fail_conflict(source, destination):
            if Path(source).name.startswith('.handoff-archive-'):
                raise OSError('disk full')
            return copy(source, destination)
        with patch('infinite_canvas.workspace_handoff.shutil.copyfile', side_effect=fail_conflict):
            with self.assertRaises(OSError):
                self.b.archive_conflicts(result['id'], snapshot)
        report = self.b.conflict_report()
        self.assertEqual(1, len(report['files']))
        staged = self.workspace / report['files'][0]['path']
        self.assertEqual(original, staged.read_bytes())
        with self.assertRaisesRegex(HandoffError, 'conflict'):
            self.b.acquire(result['id'])
        self.b.archive_conflicts(result['id'], report['snapshot'])
        self.b.acquire(result['id'])

    def test_sync_replacement_at_original_path_is_not_deleted(self):
        result, duplicate = self.duplicate_record()
        snapshot = self.b.conflict_report()['snapshot']
        rename = Path.rename
        def replace_during_move(source, target):
            moved = rename(source, target)
            if source == duplicate:
                source.write_text('new sync replacement')
            return moved
        with patch.object(Path, 'rename', replace_during_move):
            with self.assertRaisesRegex(HandoffError, 'conflict'):
                self.b.archive_conflicts(result['id'], snapshot)
        self.assertEqual('new sync replacement', duplicate.read_text())

    def test_recovery_archive_obeys_existing_occupation_lock(self):
        guard = self.service.acquire_occupation('a')
        self.addCleanup(guard.release)
        result, duplicate = self.duplicate_record()
        snapshot = self.a.conflict_report()['snapshot']
        from infinite_canvas.workspace_storage import WorkspaceStorageError
        with self.assertRaises(WorkspaceStorageError):
            self.service.acquire_occupation('a', handoff_id=result['id'], handoff_conflict_snapshot=snapshot)
        self.assertTrue(duplicate.exists())
        guard.release()
        opened = self.service.acquire_occupation('a', handoff_id=result['id'], handoff_conflict_snapshot=snapshot)
        opened.release()
        self.assertFalse(duplicate.exists())

    def test_seal_requires_out_of_band_code_and_preserves_backup(self):
        result = self.a.seal()
        with self.assertRaisesRegex(HandoffError, 'required'):
            self.b.acquire()
        with self.assertRaisesRegex(HandoffError, 'code'):
            self.b.acquire('wrong')
        self.b.acquire(result['id'])
        self.assertEqual('active', self.b.read()['state'])
        self.b.acquire()  # only this local installation may recover
        with self.assertRaisesRegex(HandoffError, 'unclean'):
            self.a.acquire()
        backup = self.a.local / 'backups' / result['id']
        self.assertTrue((backup / 'data/canvas-content.sqlite3').is_file())
        next_result = self.b.seal()
        self.assertEqual(result['id'], self.b.read()['parent'])
        self.a.acquire(next_result['id'])

    def test_partial_sync_and_extra_conflict_copy_preserve_all_files(self):
        result = self.a.seal()
        media = self.workspace / 'assets/image.png'
        media.write_bytes(b'old-device-media')
        with self.assertRaisesRegex(HandoffError, 'changed'):
            self.b.acquire(result['id'])
        self.assertEqual(b'old-device-media', media.read_bytes())
        media.write_bytes(b'example-media')
        conflict = self.workspace / 'data/canvas-content-PC.sqlite3'
        shutil.copyfile(self.workspace / 'data/canvas-content.sqlite3', conflict)
        with self.assertRaises(HandoffError):
            self.b.acquire(result['id'])
        self.assertTrue(conflict.exists())

    def test_stale_but_self_consistent_copy_rejected_by_expected_code(self):
        first = self.a.seal()
        old = self.a.path.read_bytes()
        self.a.acquire(first['id'])
        second = self.a.seal()
        self.a.path.write_bytes(old)
        with self.assertRaisesRegex(HandoffError, 'code'):
            self.b.acquire(second['id'])

    def test_consumed_seal_cannot_be_replayed_on_same_device(self):
        first = self.a.seal()
        old = self.a.path.read_bytes()
        self.b.acquire(first['id'])
        self.a.path.write_bytes(old)
        with self.assertRaisesRegex(HandoffError, 'stale'):
            self.b.acquire(first['id'])

    def test_missing_manifest_does_not_silently_disable_protection(self):
        self.a.seal()
        self.a.path.unlink()
        with self.assertRaisesRegex(HandoffError, 'missing'):
            self.a.acquire()

    def test_checkpoint_includes_committed_wal_in_backup(self):
        db_path = self.workspace / 'data/canvas-content.sqlite3'
        db = sqlite3.connect(db_path)
        self.addCleanup(db.close)
        db.execute('PRAGMA wal_autocheckpoint=0')
        db.execute('CREATE TABLE handoff_probe(value TEXT)')
        db.execute("INSERT INTO handoff_probe VALUES ('latest-node')")
        db.commit()
        result = self.a.seal()
        with sqlite3.connect(self.a.local / 'backups' / result['id'] / 'data/canvas-content.sqlite3') as backup:
            self.assertEqual('latest-node', backup.execute('SELECT value FROM handoff_probe').fetchone()[0])
        self.assertEqual(0, Path(str(db_path) + '-wal').stat().st_size)

    def test_busy_wal_is_not_deleted_or_published(self):
        db_path = self.workspace / 'data/canvas-content.sqlite3'
        reader = sqlite3.connect(db_path)
        writer = sqlite3.connect(db_path)
        self.addCleanup(reader.close)
        self.addCleanup(writer.close)
        reader.execute('BEGIN')
        reader.execute('SELECT * FROM canvases').fetchall()
        writer.execute('CREATE TABLE handoff_probe(value TEXT)')
        writer.commit()
        with self.assertRaisesRegex(HandoffError, 'wal'):
            self.a.seal()
        self.assertTrue(Path(str(db_path) + '-wal').stat().st_size)
        self.assertFalse(self.a.path.exists())

    def test_corruption_and_symlink_fail_closed(self):
        media = self.workspace / 'assets/image.png'
        media.unlink()
        media.symlink_to(self.root / 'outside')
        with self.assertRaises(HandoffError):
            self.a.seal()
        media.unlink()
        db = self.workspace / 'data/canvas-content.sqlite3'
        db.write_bytes(b'not-a-database')
        with self.assertRaises(HandoffError):
            self.a.seal()
        self.assertFalse(self.a.path.exists())

    def test_failed_backup_never_publishes_seal(self):
        with patch('infinite_canvas.workspace_handoff.shutil.copyfile', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.a.seal()
        self.assertFalse(self.a.path.exists())
        self.assertTrue((self.workspace / 'data/canvas-content.sqlite3').exists())

    def test_pending_generation_delivery_blocks_seal(self):
        path = self.workspace / 'data/generation-runs.sqlite3'
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS batch_tasks (status TEXT)")
            db.execute("INSERT INTO batch_tasks VALUES ('queued')")
        with self.assertRaisesRegex(HandoffError, 'tasks'):
            self.a.seal()
        self.assertFalse(self.a.path.exists())

    def test_service_gate_runs_before_occupation_publication(self):
        result = self.a.seal()
        with self.assertRaisesRegex(HandoffError, 'required'):
            self.service.acquire_occupation('a')
        self.assertFalse((self.a.control / 'occupation.json').exists())
        guard = self.service.acquire_occupation('a', handoff_id=result['id'])
        guard.release()
        guard = self.service.acquire_occupation('a')
        guard.release()

    def test_foreign_takeover_cannot_bypass_active_handoff(self):
        result = self.a.seal()
        guard = self.service.acquire_occupation('a', handoff_id=result['id'])
        guard.release()
        with self.assertRaisesRegex(HandoffError, 'unclean'):
            self.service.acquire_occupation('b', allow_foreign_takeover=True)

    def test_interrupted_accept_can_resume_but_never_edit_without_receipt(self):
        result = self.a.seal()
        original = self.b._write
        def fail_publish(path, value):
            if path == self.b.path:
                raise OSError('interrupted before active publication')
            original(path, value)
        with patch.object(self.b, '_write', side_effect=fail_publish):
            with self.assertRaises(OSError):
                self.b.acquire(result['id'])
        self.assertEqual('sealed', self.b.read()['state'])
        self.b.acquire(result['id'])
        self.assertEqual('active', self.b._read(self.b.receipt)['state'])

    def test_interrupted_seal_receipt_is_retryable_without_new_snapshot(self):
        original = self.a._write
        def fail_receipt(path, value):
            if path == self.a.receipt:
                raise OSError('interrupted after publishing')
            original(path, value)
        with patch.object(self.a, '_write', side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.a.seal()
        published = self.a.read()['id']
        self.assertEqual(published, self.a.seal()['id'])
        self.b.acquire(published)

    def test_foreign_active_session_cannot_be_sealed(self):
        result = self.a.seal()
        self.b.acquire(result['id'])
        with self.assertRaisesRegex(HandoffError, 'unclean'):
            self.a.seal()

    def test_same_count_different_node_content_fails_validation(self):
        database = self.workspace / 'data/canvas-content.sqlite3'
        with sqlite3.connect(database) as db:
            db.execute('CREATE TABLE handoff_probe (node_id TEXT, content TEXT)')
            db.execute("INSERT INTO handoff_probe VALUES ('node-1', 'new')")
        db.close()
        result = self.a.seal()
        with sqlite3.connect(database) as db:
            db.execute("UPDATE handoff_probe SET content='old'")
        db.close()
        with self.assertRaisesRegex(HandoffError, 'changed'):
            self.b.acquire(result['id'])

    def test_foreign_database_identity_fails_even_if_sqlite_is_valid(self):
        database = self.workspace / 'data/generation-runs.sqlite3'
        with sqlite3.connect(database) as db:
            db.execute("UPDATE generation_run_store_metadata SET value='other' WHERE key='workspace_id'")
        with self.assertRaisesRegex(HandoffError, 'invalid'):
            self.a.seal()
