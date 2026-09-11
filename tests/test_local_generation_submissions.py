import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from infinite_canvas.local_generation_submissions import (
    LocalGenerationSubmissions, LocalSubmissionError, LocalSubmissionJournal,
)


def command(operation="first", *, prompt="First prompt"):
    return {
        "canvas_id": "canvas", "operation_id": operation, "request_index": 0,
        "endpoint": "/api/canvas-image-tasks",
        "payload": {"prompt": prompt},
        "checkpoints": [{"operation_id": "checkpoint-" + operation, "changes": {"node_creates": [{"id": operation}]}}],
        "target_ids": [operation],
    }


class LocalJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = LocalSubmissionJournal(Path(self.temp.name) / "journal.sqlite3")

    def test_durable_acceptance_is_idempotent_and_content_checked(self):
        first = self.journal.accept("workspace", "alice", command())
        reopened = LocalSubmissionJournal(self.journal.path)
        duplicate = reopened.accept("workspace", "alice", command())
        self.assertEqual(first["id"], duplicate["id"])
        with self.assertRaisesRegex(LocalSubmissionError, "collision"):
            reopened.accept("workspace", "alice", command(prompt="Changed"))
        self.assertEqual(reopened.read(first["id"], "workspace", "alice")["command"]["payload"]["prompt"], "First prompt")

    def test_workspace_and_account_isolation(self):
        first = self.journal.accept("workspace", "alice", command())
        for workspace, owner in (("other", "alice"), ("workspace", "bob")):
            with self.assertRaisesRegex(LocalSubmissionError, "not_found"):
                self.journal.read(first["id"], workspace, owner)
            self.assertEqual(self.journal.list(workspace, owner=owner), [])
        second = self.journal.accept("workspace", "bob", command())
        self.assertNotEqual(first["id"], second["id"])

    def test_local_write_failure_does_not_acknowledge(self):
        invalid = LocalSubmissionJournal(Path(self.temp.name))
        with self.assertRaises(Exception):
            invalid.accept("workspace", "alice", command())


class LocalWorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = LocalSubmissionJournal(Path(self.temp.name) / "journal.sqlite3")

    def service(self, **ports):
        result = LocalGenerationSubmissions(
            journal=self.journal, workspace_id="workspace",
            prepare=ports.get("prepare", AsyncMock()),
            dispatch=ports.get("dispatch", AsyncMock(return_value={"task_id": "run"})),
            reconcile=ports.get("reconcile", AsyncMock(return_value=None)),
        )
        self.addAsyncCleanup(result.close)
        return result

    async def settled(self, service, record):
        await asyncio.wait_for(service._tasks[record["id"]], 2)
        return self.journal.read(record["id"], "workspace", "alice")

    async def test_acceptance_and_independent_dispatch_do_not_wait_for_first_checkpoint(self):
        release = asyncio.Event()
        started = asyncio.Event()
        dispatched = []

        async def prepare(record):
            if record["operation_id"] == "first":
                started.set()
                await release.wait()

        async def dispatch(record):
            dispatched.append(record["operation_id"])
            return {"task_id": record["operation_id"]}

        service = self.service(prepare=prepare, dispatch=dispatch)
        first = await asyncio.wait_for(service.accept("alice", command()), 1)
        await asyncio.wait_for(started.wait(), 1)
        second = await asyncio.wait_for(service.accept("alice", command("second", prompt="Second prompt")), 1)
        self.assertEqual((await self.settled(service, second))["status"], "accepted")
        self.assertEqual(dispatched, ["second"])
        self.assertEqual(service.active_count(), 1)
        release.set()
        self.assertEqual((await self.settled(service, first))["status"], "accepted")
        self.assertEqual(dispatched, ["second", "first"])

    async def test_restart_replays_preparation_with_original_identity(self):
        started = asyncio.Event()

        async def prepare(_record):
            started.set()
            await asyncio.Event().wait()

        original = self.service(prepare=prepare)
        first = await original.accept("alice", command())
        await started.wait()
        await original.close()
        restored_prepare = AsyncMock()
        restored = self.service(prepare=restored_prepare)
        await restored.start()
        result = await self.settled(restored, first)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(restored_prepare.call_args.args[0]["command"], command())
        self.assertEqual(result["id"], first["id"])

    async def test_lost_dispatch_response_is_reconciled_without_resubmission(self):
        dispatch = AsyncMock(side_effect=ConnectionError("lost response"))
        original = self.service(dispatch=dispatch)
        first = await original.accept("alice", command())
        self.assertEqual((await self.settled(original, first))["status"], "uncertain")
        await original.close()
        reconcile = AsyncMock(return_value={"task_id": "existing"})
        restored = self.service(reconcile=reconcile)
        await restored.start()
        result = await self.settled(restored, first)
        self.assertEqual(result["result"]["task_id"], "existing")
        restored.dispatch.assert_not_awaited()
        reconcile.assert_awaited_once()

    async def test_unknown_without_receipt_stays_blocking_and_cannot_be_cancelled(self):
        first = self.journal.accept("workspace", "alice", command())
        first = self.journal.update(first, "submitting")
        service = self.service()
        await service.start()
        result = await self.settled(service, first)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(service.active_count(), 1)
        service.dispatch.assert_not_awaited()
        with self.assertRaisesRegex(LocalSubmissionError, "uncertain"):
            await service.cancel_active()

    async def test_failed_prerequisite_does_not_call_provider_and_retry_keeps_identity(self):
        prepare = AsyncMock(side_effect=LocalSubmissionError("local_generation_permission_lost", 403))
        service = self.service(prepare=prepare)
        first = await service.accept("alice", command())
        failed = await self.settled(service, first)
        self.assertEqual(failed["status"], "failed")
        service.dispatch.assert_not_awaited()
        prepare.side_effect = None
        retried = await service.retry(failed)
        self.assertEqual(retried["operation_id"], first["operation_id"])
        self.assertEqual((await self.settled(service, first))["status"], "accepted")

    async def test_stale_wake_does_not_dispatch_an_accepted_command_twice(self):
        service = self.service()
        first = await service.accept("alice", command())
        await self.settled(service, first)
        service.wake(first)
        await self.settled(service, first)
        service.dispatch.assert_awaited_once()

    async def test_cancel_waits_for_inflight_disk_write_before_terminal_state(self):
        started, release = threading.Event(), threading.Event()
        original_update = self.journal.update
        def slow_update(record, status, **values):
            if status == "syncing":
                started.set()
                release.wait(2)
            return original_update(record, status, **values)
        service = self.service()
        with patch.object(self.journal, "update", side_effect=slow_update):
            record = await service.accept("alice", command())
            await asyncio.to_thread(started.wait, 1)
            cancellation = asyncio.create_task(service.cancel_active())
            await asyncio.sleep(.02)
            self.assertFalse(cancellation.done())
            release.set()
            await cancellation
        self.assertEqual(self.journal.read(record["id"], "workspace", "alice")["status"], "cancelled")
        service.dispatch.assert_not_awaited()
        self.assertEqual(service.active_count(), 0)

    async def test_disconnected_admission_keeps_disk_write_counted_and_recoverable(self):
        started, release = threading.Event(), threading.Event()
        original_accept = self.journal.accept
        def slow_accept(*args):
            started.set()
            release.wait(2)
            return original_accept(*args)
        service = self.service(prepare=AsyncMock(side_effect=LocalSubmissionError("cloud_storage_reconnecting", 503)))
        with patch.object(self.journal, "accept", side_effect=slow_accept):
            admission = asyncio.create_task(service.accept("alice", command()))
            await asyncio.to_thread(started.wait, 1)
            admission.cancel()
            await asyncio.sleep(.02)
            self.assertEqual(service.active_count(), 1)
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await admission
        record = self.journal.list("workspace")[0]
        self.assertEqual((await self.settled(service, record))["status"], "syncing")
        self.assertEqual(service.active_count(), 1)

    async def test_revoked_access_during_unknown_receipt_lookup_never_enables_resubmit(self):
        record = self.journal.accept("workspace", "alice", command())
        record = self.journal.update(record, "uncertain")
        service = self.service(reconcile=AsyncMock(side_effect=LocalSubmissionError("local_generation_permission_lost", 403)))
        service.wake(record)
        unknown = await self.settled(service, record)
        self.assertEqual(unknown["status"], "uncertain")
        await service.retry(unknown)
        await self.settled(service, record)
        service.dispatch.assert_not_awaited()

    async def test_run_projection_wait_uses_captured_boundary(self):
        from infinite_canvas.generation_runs import GenerationRuns
        runs = GenerationRuns(executor=object(), effects=object(), store_path=lambda: None)
        first, later = asyncio.Event(), asyncio.Event()
        runs._lifecycle_projection_tail = asyncio.create_task(first.wait())
        waiting = asyncio.create_task(runs.wait_for_lifecycle_projection(through_current=True))
        await asyncio.sleep(0)
        later_task = asyncio.create_task(later.wait())
        runs._lifecycle_projection_tail = later_task
        first.set()
        await asyncio.wait_for(waiting, .5)
        self.assertFalse(later_task.done())
        later.set()
        await later_task


if __name__ == "__main__":
    unittest.main()
