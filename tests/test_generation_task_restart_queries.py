"""Task polling must see durable terminal Runs after a process restart."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from fastapi import HTTPException
from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import GenerationRunState, SqliteGenerationRunStore
from infinite_canvas.generation_runs import GenerationRuns, ImageRun, RecoveryRun
from infinite_canvas.providers.core import Completed, Pending
from infinite_canvas.providers.runtime import ProviderOutput


class GenerationTaskRestartQueryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = SqliteGenerationRunStore(
            Path(self.temporary.name) / "runs.sqlite3", workspace_id="restart-test"
        )
        self.worker = GenerationRunStoreExecutor(max_workers=1, max_pending=8)
        self.lifecycle = AsyncGenerationRunLifecycleStore(
            store=self.store, store_executor=self.worker
        )
        self.provider = mock.Mock(spec=["execute"], execute=mock.AsyncMock())
        self.effects = mock.Mock(spec=["publish"], publish=mock.AsyncMock())

    async def asyncTearDown(self):
        await self.worker.close()
        self.temporary.cleanup()

    def save_run(self, run_id, *, status="succeeded", kind="image"):
        result = {"kind": "image_layer_decomposition", "manifest": {"layers": []}}
        self.store.save(GenerationRunState(
            run_id=run_id, kind=kind, status=status,
            phase="published" if status == "succeeded" else "provider_submitted",
            owner="designer-1", key=run_id, request_hash=run_id,
            provider_id="apimart", created_at=1, updated_at=2,
            request={"prompt": "test", "settings": {"provider_id": "apimart"}},
            remote_refs=(("apimart", "upstream-1"),),
            result=result if status == "succeeded" else None,
            error="provider failure" if status == "failed" else "",
        ))
        return result

    async def restart(self):
        runs = GenerationRuns(
            executor=self.provider, effects=self.effects,
            store_path=lambda: None, lifecycle_store=self.lifecycle,
        )
        await runs.restore_lifecycle_authority()
        return runs

    async def test_completed_layer_task_remains_queryable_after_restart(self):
        expected = self.save_run("layer-run")
        runs = await self.restart()
        with (
            mock.patch.object(main, "_GENERATION_RUNS", runs),
            mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}),
        ):
            for _ in range(2):
                response = await main.get_canvas_layer_decomposition_task("layer-run")
                self.assertEqual("succeeded", response["status"])
                self.assertEqual(expected, response["result"])
        self.provider.execute.assert_not_called()
        self.effects.publish.assert_not_called()

    async def test_all_polling_routes_preserve_terminal_status_after_restart(self):
        routes = (
            (main.get_canvas_image_task, "image"),
            (main.get_canvas_layer_decomposition_task, "image"),
            (main.get_canvas_comfy_task, "workflow"),
            (main.get_canvas_video_task, "video"),
            (main.get_canvas_llm_task, "text"),
        )
        for route, kind in routes:
            for status in ("succeeded", "failed", "cancelled", "discarded"):
                with self.subTest(route=route.__name__, status=status):
                    run_id = route.__name__ + status
                    self.save_run(run_id, status=status, kind=kind)
                    runs = await self.restart()
                    with (
                        mock.patch.object(main, "_GENERATION_RUNS", runs),
                        mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}),
                    ):
                        response = await route(run_id)
                    self.assertEqual(status, response["status"])
        self.provider.execute.assert_not_called()
        self.effects.publish.assert_not_called()

    async def test_other_account_and_missing_task_still_return_404(self):
        self.save_run("private-run")
        runs = await self.restart()
        with mock.patch.object(main, "_GENERATION_RUNS", runs):
            for owner, run_id in (("designer-2", "private-run"), ("designer-1", "missing")):
                with (
                    self.subTest(owner=owner, run_id=run_id),
                    mock.patch.object(main, "require_current_user", return_value={"id": owner}),
                    self.assertRaises(HTTPException) as caught,
                ):
                    await main.get_canvas_layer_decomposition_task(run_id)
                self.assertEqual(404, caught.exception.status_code)
            with mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}):
                self.assertEqual("succeeded", (await main.get_canvas_layer_decomposition_task("private-run"))["status"])
            with (
                mock.patch.object(main, "require_current_user", return_value={"id": "designer-2"}),
                self.assertRaises(HTTPException) as caught,
            ):
                await main.get_canvas_layer_decomposition_task("private-run")
            self.assertEqual(404, caught.exception.status_code)

    async def test_real_completion_survives_restart_without_reexecution(self):
        expected = {"kind": "image_layer_decomposition", "manifest": {"layers": []}}
        self.provider.execute.return_value = Completed(ProviderOutput(legacy=expected))
        self.effects.publish.return_value = expected
        runs = await self.restart()
        completed = await runs.start(
            ImageRun(prompt="test", settings={"provider_id": "apimart"}),
            owner="designer-1", key="original-operation",
        )
        await runs.wait_for_lifecycle_projection()
        self.assertEqual("succeeded", self.store.load(completed.id).status)
        self.assertEqual((), self.store.load_unfinished())
        restarted = await self.restart()
        with (
            mock.patch.object(main, "_GENERATION_RUNS", restarted),
            mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}),
        ):
            response = await main.get_canvas_layer_decomposition_task(completed.id)
        self.assertEqual("succeeded", response["status"])
        self.assertEqual(expected, response["result"])
        self.provider.execute.assert_awaited_once()
        self.effects.publish.assert_awaited_once()

    async def test_unfinished_run_queries_original_upstream_until_complete(self):
        self.save_run("pending-run", status="pending")
        expected = {"kind": "image_layer_decomposition", "manifest": {"layers": []}}
        self.provider.execute.side_effect = [
            Pending("upstream-1", status="running"),
            Completed(ProviderOutput(legacy=expected)),
        ]
        self.effects.publish.return_value = expected
        runs = await self.restart()
        with (
            mock.patch.object(main, "_GENERATION_RUNS", runs),
            mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}),
        ):
            for _ in range(2):
                self.assertEqual("running", (await main.get_canvas_layer_decomposition_task("pending-run"))["status"])
                # Wait for the actual background execution, without sleeping.
                await runs.resume("pending-run", owner="designer-1")
            response = await main.get_canvas_layer_decomposition_task("pending-run")
        await runs.wait_for_lifecycle_projection()
        self.assertEqual("succeeded", response["status"])
        self.assertEqual(expected, response["result"])
        self.assertEqual(2, self.provider.execute.await_count)
        for call in self.provider.execute.await_args_list:
            request = call.args[0]
            self.assertIsInstance(request, RecoveryRun)
            self.assertEqual("upstream-1", request.remote_ref)
        self.effects.publish.assert_awaited_once()

    async def test_slow_database_read_does_not_overwrite_newer_query(self):
        self.save_run("race-run", status="failed")
        runs = await self.restart()
        entered = asyncio.Event()
        release = asyncio.Event()
        load = self.lifecycle.load

        async def delayed_load(run_id):
            state = await load(run_id)
            entered.set()
            await release.wait()
            return state

        with mock.patch.object(self.lifecycle, "load", side_effect=delayed_load):
            slow = asyncio.create_task(runs.query("race-run", owner="designer-1"))
            await asyncio.wait_for(entered.wait(), timeout=2)
        try:
            self.save_run("race-run", status="succeeded")
            current = await runs.query("race-run", owner="designer-1")
            self.assertEqual("succeeded", current.status)
        finally:
            release.set()
        self.assertEqual("succeeded", (await slow).status)

    async def test_upstream_completed_during_downtime_is_delivered_on_first_recovery(self):
        self.save_run("completed-upstream-run", status="pending")
        expected = {"kind": "image_layer_decomposition", "manifest": {"layers": []}}
        self.provider.execute.return_value = Completed(ProviderOutput(legacy=expected))
        self.effects.publish.return_value = expected
        runs = await self.restart()
        with (
            mock.patch.object(main, "_GENERATION_RUNS", runs),
            mock.patch.object(main, "require_current_user", return_value={"id": "designer-1"}),
        ):
            await main.get_canvas_layer_decomposition_task("completed-upstream-run")
            await runs.resume("completed-upstream-run", owner="designer-1")
            response = await main.get_canvas_layer_decomposition_task("completed-upstream-run")
        await runs.wait_for_lifecycle_projection()
        self.assertEqual("succeeded", response["status"])
        self.assertEqual(expected, response["result"])
        self.provider.execute.assert_awaited_once()
        request = self.provider.execute.await_args.args[0]
        self.assertIsInstance(request, RecoveryRun)
        self.assertEqual("upstream-1", request.remote_ref)
        self.effects.publish.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
