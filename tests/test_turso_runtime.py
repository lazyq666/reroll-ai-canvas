import json
import tempfile
import unittest
from pathlib import Path
from dataclasses import replace
from unittest.mock import patch

from infinite_canvas.turso_runtime import TursoWorkspaceRuntime
from infinite_canvas.turso_sqlite import TursoError
from infinite_canvas.canvas_store import CanvasIntent, CanvasProjection
from tests.test_canvas_store import ADMIN, sample_canvas
from tests import test_turso_stores as store_fixtures
from tests import test_generation_run_store as run_fixtures


class TursoRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = store_fixtures.TursoStoreTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.lease.release()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.configuration = Path(self.temp.name) / "connection.json"
        self.configuration.write_text(json.dumps({"schema_version": 1, "workspace_id": "workspace", "url": "https://test.turso.io", "token": "private-test-token"}))

    def open(self, device="device-a", binding="binding", **kwargs):
        return TursoWorkspaceRuntime(self.configuration, workspace_id="workspace", binding_id=binding, device_id=device, transport=self.fixture.remote, **kwargs)

    def test_restart_waits_for_unreleased_previous_process_lease(self):
        previous = self.open()
        self.addCleanup(previous.close)
        old_fence = previous.fence
        clock = [1000.0]

        def wait(seconds):
            clock[0] += seconds
            self.fixture.remote.database.execute('UPDATE reroll_workspace_lease SET expires_at=0')

        with patch('infinite_canvas.turso_runtime.time.monotonic', side_effect=lambda: clock[0]), patch('infinite_canvas.turso_runtime.time.sleep', side_effect=wait) as sleep:
            replacement = self.open()
            self.addCleanup(replacement.close)
            self.assertEqual(replacement.public()['status'], 'connected')
            self.assertEqual(sleep.call_count, 1)
            self.assertEqual(replacement._deadline, clock[0] + 110)
        self.assertNotEqual(replacement.fence.owner, old_fence.owner)
        self.assertGreater(replacement.fence.epoch, old_fence.epoch)
        with self.assertRaisesRegex(TursoError, 'lease_lost'):
            with old_fence.transaction(previous.raw_connect):
                self.fail('Previous process must remain fenced out')
        previous.close()
        with replacement.fence.transaction(replacement.raw_connect):
            pass

    def test_rotation_reuses_cloud_records_and_keeps_credentials_out_of_status(self):
        first = self.open()
        with self.assertRaises(TursoError):
            self.open("device-b", startup_wait_seconds=0)
        self.assertEqual(first.public()["status"], "connected")
        self.assertNotIn("private-test-token", json.dumps(first.public()))
        first.close()
        first.close()
        second = self.open("device-b")
        self.addCleanup(second.close)
        self.assertEqual(second.public()["status"], "connected")

    def test_device_local_submissions_block_rotation_even_without_cloud_runs(self):
        first = self.open()
        first.protect_local_submissions('device-a')
        self.assertTrue(first.local_submissions_protected)
        first.close()
        with self.assertRaisesRegex(TursoError, 'original_device_required'):
            self.open('device-b')
        restored = self.open('device-a')
        restored.protect_local_submissions('device-a')
        restored.finish_local_submissions('wrong-device')
        restored.close()
        with self.assertRaisesRegex(TursoError, 'original_device_required'):
            self.open('device-b')
        finished = self.open('device-a')
        finished.finish_local_submissions('device-a')
        finished.close()
        second = self.open('device-b')
        self.addCleanup(second.close)
        self.assertEqual(second.public()['status'], 'connected')

    def test_startup_wait_is_bounded_and_never_steals_active_lease(self):
        previous = self.open()
        self.addCleanup(previous.close)
        clock = [1000.0]
        def wait(seconds):
            clock[0] += seconds
        with patch('infinite_canvas.turso_runtime.time.monotonic', side_effect=lambda: clock[0]), patch('infinite_canvas.turso_runtime.time.sleep', side_effect=wait):
            with self.assertRaisesRegex(TursoError, 'workspace_busy'):
                self.open('device-b')
        self.assertEqual(clock[0], 1125.0)
        with previous.fence.transaction(previous.raw_connect):
            pass

    def test_startup_does_not_retry_network_failure_or_invalid_binding(self):
        with patch('infinite_canvas.turso_runtime.time.sleep') as sleep:
            with self.assertRaisesRegex(TursoError, 'workspace_busy'):
                self.open(binding='foreign')
            with patch('infinite_canvas.turso_runtime.WorkspaceLease.acquire', side_effect=TursoError('cloud_storage_outcome_unknown')):
                with self.assertRaisesRegex(TursoError, 'outcome_unknown'):
                    self.open()
            sleep.assert_not_called()

    def test_failed_renewal_stops_new_connections_until_restart(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        self.fixture.remote.database.execute("UPDATE reroll_workspace_lease SET expires_at=0")
        with self.assertRaises(TursoError):
            runtime.renew()
        self.assertEqual(runtime.public()["status"], "unavailable")
        with self.assertRaises(TursoError):
            runtime.connect()

    def test_transient_renewal_recovers_same_owner_without_reviving_old_connections(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        runtime.canvas_store.commit('canvas-1', ADMIN, CanvasIntent.import_canvas(sample_canvas(), operation_id='seed:canvas-0001'))
        old_connection = runtime.connect()
        self.addCleanup(old_connection.close)
        old_fence = runtime.fence
        with patch.object(runtime.lease, '_connect', side_effect=TursoError('cloud_storage_outcome_unknown')):
            with self.assertRaises(TursoError):
                runtime.renew()
        with self.assertRaises(TursoError):
            runtime.connect()
        with patch.object(runtime.lease, 'acquire', side_effect=AssertionError('Recovery must not acquire a new lease')):
            runtime.renew()
        self.assertEqual(runtime.public()['status'], 'connected')
        self.assertEqual((runtime.fence.owner, runtime.fence.epoch), (old_fence.owner, old_fence.epoch))
        self.assertTrue(old_fence._revoked.is_set())
        with self.assertRaises(TursoError):
            old_connection.execute('BEGIN IMMEDIATE')
        old_connection.rollback()
        self.assertEqual(len(runtime.canvas_store.list_items(ADMIN)), 1)
        operation = CanvasIntent.canvas_mutation({
            'operation_id': 'paste:image-0001', 'base_revision': 7,
            'changes': {'node_creates': [{'id': 'pasted-image', 'type': 'image', 'x': 1000, 'y': 1000, 'imageUrl': '/assets/uploads/test.png'}]},
        })
        committed = runtime.canvas_store.commit('canvas-1', ADMIN, operation)
        self.assertTrue(committed.changed)
        self.assertTrue(runtime.canvas_store.commit('canvas-1', ADMIN, operation).duplicate)
        canvas = runtime.canvas_store.read('canvas-1', ADMIN, CanvasProjection.public_snapshot()).canvas
        self.assertEqual(sum(node['id'] == 'pasted-image' for node in canvas['nodes']), 1)

    def test_uncertain_renewal_cannot_recover_after_local_deadline(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        with patch.object(runtime.lease, '_connect', side_effect=TursoError('cloud_storage_outcome_unknown')):
            with self.assertRaises(TursoError):
                runtime.renew()
        runtime._deadline = 0
        with self.assertRaises(TursoError):
            runtime.renew()
        self.assertEqual(runtime.public()['status'], 'unavailable')

    def test_lost_commit_response_reconciles_the_same_lease(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        old_fence = runtime.fence
        def lose_commit_response(url, payload):
            response = self.fixture.remote(url, payload)
            if any(request.get('stmt', {}).get('sql') == 'COMMIT' for request in payload['requests']):
                raise TursoError('cloud_storage_outcome_unknown')
            return response
        with patch.object(runtime, '_transport', lose_commit_response):
            with self.assertRaises(TursoError):
                runtime.renew()
        self.assertEqual(runtime.public()['status'], 'reconnecting')
        runtime.renew()
        self.assertEqual(runtime.public()['status'], 'connected')
        self.assertEqual(runtime.fence.epoch, old_fence.epoch)
        self.assertTrue(old_fence._revoked.is_set())

    def test_recovery_refuses_expired_changed_or_retired_remote_lease(self):
        for update in ("expires_at=0", "owner='another-process'", "epoch=epoch+1", "state='retired'", "binding_id='foreign'"):
            with self.subTest(update=update):
                runtime = self.open()
                try:
                    with patch.object(runtime.lease, '_connect', side_effect=TursoError('cloud_storage_outcome_unknown')):
                        with self.assertRaises(TursoError):
                            runtime.renew()
                    self.fixture.remote.database.execute('UPDATE reroll_workspace_lease SET ' + update)
                    with self.assertRaises(TursoError):
                        runtime.renew()
                    self.assertFalse(runtime.lease.can_reconcile)
                    self.assertEqual(runtime.public()['status'], 'unavailable')
                finally:
                    runtime.close()
                    self.fixture.remote.database.execute("UPDATE reroll_workspace_lease SET state='active', binding_id='binding', owner='', expires_at=0")

    def test_heartbeat_retries_uncertain_renewal_instead_of_exiting(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        delays = []
        renewals = []
        real_renew = runtime.renew
        def renew():
            renewals.append(1)
            if len(renewals) == 1:
                with patch.object(runtime.lease, '_connect', side_effect=TursoError('cloud_storage_outcome_unknown')):
                    return real_renew()
            return real_renew()
        def wait(delay):
            delays.append(delay)
            return len(delays) == 3
        with patch.object(runtime, 'renew', side_effect=renew), patch.object(runtime._stop, 'wait', side_effect=wait), patch('infinite_canvas.turso_runtime.threading.Thread') as thread:
            runtime.start()
            thread.call_args.kwargs['target']()
        self.assertEqual(delays, [20, 2, 20])
        self.assertEqual(len(renewals), 2)
        self.assertEqual(runtime.public()['status'], 'connected')

    def test_unfinished_generation_cannot_resume_on_another_device(self):
        first = self.open()
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), status="running")
        first.generation_run_store.save(run)
        first.close()
        with self.assertRaisesRegex(TursoError, "original_device_required"):
            self.open("device-b")
        resumed = self.open("device-a")
        self.addCleanup(resumed.close)
        self.assertEqual(resumed.generation_run_store.load(run.run_id).status, "running")

    def test_foreign_credentials_or_binding_cannot_open_a_fallback(self):
        with self.assertRaises(TursoError):
            self.open(binding="another-binding")
        self.configuration.write_text(json.dumps({"schema_version": 1, "workspace_id": "foreign"}))
        with self.assertRaisesRegex(TursoError, "configuration_required"):
            self.open()


if __name__ == "__main__":
    unittest.main()
