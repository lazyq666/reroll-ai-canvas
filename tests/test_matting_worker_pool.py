import asyncio
import threading
import unittest
from unittest import mock

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


class MattingWorkerPoolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.originals = {
            "queue": main.MATTING_QUEUE,
            "tasks": main.MATTING_WORKER_TASKS,
            "loop": main.MATTING_RUNTIME_LOOP,
            "jobs": main.MATTING_JOBS,
            "concurrency": main.MATTING_MAX_CONCURRENCY,
        }
        main.MATTING_QUEUE = None
        main.MATTING_WORKER_TASKS = []
        main.MATTING_RUNTIME_LOOP = None
        main.MATTING_JOBS = {}
        main.MATTING_MAX_CONCURRENCY = 2

    async def asyncTearDown(self):
        tasks = list(main.MATTING_WORKER_TASKS)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        main.MATTING_QUEUE = self.originals["queue"]
        main.MATTING_WORKER_TASKS = self.originals["tasks"]
        main.MATTING_RUNTIME_LOOP = self.originals["loop"]
        main.MATTING_JOBS = self.originals["jobs"]
        main.MATTING_MAX_CONCURRENCY = self.originals["concurrency"]

    async def test_configured_workers_execute_two_jobs_in_parallel(self):
        barrier = threading.Barrier(2, timeout=5)
        state_lock = threading.Lock()
        state = {"active": 0, "peak": 0}

        def run_job(source_path):
            with state_lock:
                state["active"] += 1
                state["peak"] = max(state["peak"], state["active"])
            try:
                barrier.wait()
                return {
                    "output_url": f"/assets/{source_path}.png",
                    "output_name": f"{source_path}.png",
                    "model": "test",
                    "width": 1,
                    "height": 1,
                    "cached": False,
                }
            finally:
                with state_lock:
                    state["active"] -= 1

        engine = mock.Mock()
        engine.model_ready.return_value = True
        for job_id in ("job-1", "job-2"):
            main.MATTING_JOBS[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "source_path": job_id,
                "submitted_at": 1,
            }

        with (
            mock.patch.object(main, "_get_matting_engine", return_value=engine),
            mock.patch.object(main, "run_matting_job_sync", side_effect=run_job),
        ):
            queue = await main.ensure_matting_workers()
            queue.put_nowait("job-1")
            queue.put_nowait("job-2")
            await asyncio.wait_for(queue.join(), timeout=10)

        self.assertEqual(2, len(main.MATTING_WORKER_TASKS))
        self.assertEqual(2, state["peak"])
        self.assertEqual(
            ["succeeded", "succeeded"],
            [main.MATTING_JOBS[job_id]["status"] for job_id in ("job-1", "job-2")],
        )

    async def test_worker_pool_replaces_finished_workers(self):
        queue = await main.ensure_matting_workers()
        first_tasks = list(main.MATTING_WORKER_TASKS)
        first_tasks[0].cancel()
        await asyncio.gather(first_tasks[0], return_exceptions=True)

        repeated_queue = await main.ensure_matting_workers()

        self.assertIs(queue, repeated_queue)
        self.assertEqual(2, len(main.MATTING_WORKER_TASKS))
        self.assertTrue(all(not task.done() for task in main.MATTING_WORKER_TASKS))


if __name__ == "__main__":
    unittest.main()
