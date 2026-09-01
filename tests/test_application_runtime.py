import asyncio
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.runtime import ApplicationRuntime, RuntimeStage, RuntimeStartup
from infinite_canvas.workspace_storage import WorkspaceStorageError


class ApplicationRuntimeLifecycleTests(unittest.TestCase):
    def test_event_loop_snapshot_discloses_bounded_retention(self):
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            for sequence in range(1, 5001):
                runtime._event_loop_lag_samples.append((sequence, 1.0))
            runtime._event_loop_lag_sequence = 5000

            snapshot = runtime.event_loop_lag_snapshot(after_sequence=0)

            self.assertEqual(4096, snapshot["retention_capacity"])
            self.assertEqual(905, snapshot["oldest_sequence"])
            self.assertEqual(5000, snapshot["latest_sequence"])
            self.assertEqual(4096, len(snapshot["samples"]))

    def test_multiple_runtime_instances_keep_lifecycle_state_isolated(self):
        with tempfile.TemporaryDirectory() as temporary:
            events = []

            def build(name):
                async def initialize():
                    events.append(f"start-{name}")
                    return RuntimeStartup(
                        application={"name": name},
                        stop=lambda: events.append(f"stop-{name}"),
                    )

                return ApplicationRuntime(
                    initializer=initialize,
                    local_state_dir=Path(temporary) / name / "local-state",
                    version="test",
                )

            first = build("first")
            second = build("second")
            asyncio.run(first.start())

            self.assertEqual(first.status().stage, RuntimeStage.READY)
            self.assertEqual(second.status().stage, RuntimeStage.STARTING)

            asyncio.run(second.start())
            asyncio.run(first.stop())
            self.assertEqual(
                events,
                ["start-first", "start-second", "stop-first"],
            )

    def test_start_and_stop_are_idempotent_through_the_runtime_interface(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []

            async def initialize():
                calls.append("start")
                return RuntimeStartup(
                    application=object(),
                    stop=lambda: calls.append("stop"),
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )

            self.assertEqual(runtime.status().stage, RuntimeStage.STARTING)
            self.assertFalse((Path(temporary) / "local-state").exists())

            asyncio.run(runtime.start())
            asyncio.run(runtime.start())
            self.assertEqual(runtime.status().stage, RuntimeStage.READY)

            asyncio.run(runtime.stop())
            asyncio.run(runtime.stop())
            self.assertEqual(runtime.status().stage, RuntimeStage.STOPPING)
            self.assertEqual(calls, ["start", "stop"])

    def test_missing_workspace_enters_recovery_without_creating_a_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            missing_workspace = Path(temporary) / "synced" / "data"

            async def initialize():
                raise WorkspaceStorageError(
                    f"已配置的 Workspace Data 不存在：{missing_workspace}"
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )

            status = asyncio.run(runtime.start())

            self.assertEqual(status.stage, RuntimeStage.RECOVERY_REQUIRED)
            self.assertIn("工作区", status.message)
            self.assertIn("重新连接工作区", status.message)
            self.assertNotIn("Workspace Data", status.message)
            self.assertFalse(missing_workspace.exists())

    def test_optional_generation_provider_failure_does_not_block_readiness(self):
        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(
                    application=object(),
                    unavailable_features=("ComfyUI 暂时无法连接，可稍后重试。",),
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )

            status = asyncio.run(runtime.start())

            self.assertEqual(status.stage, RuntimeStage.READY)
            self.assertEqual(
                status.unavailable_features,
                ("ComfyUI 暂时无法连接，可稍后重试。",),
            )

    def test_restart_waits_and_reports_active_generation_runs(self):
        class GenerationRuns:
            def active_count(self):
                return 2

            def cancel_active(self):
                raise AssertionError("默认重启不应取消 Generation Run")

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                generation_runs=GenerationRuns(),
            )
            asyncio.run(runtime.start())

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(status.stage, RuntimeStage.RESTART_WAITING)
            self.assertEqual(status.blocking_generation_runs, 2)

    def test_user_can_cancel_active_work_and_restart_immediately(self):
        events = []

        class GenerationRuns:
            def active_count(self):
                return 1

            def cancel_active(self):
                events.append("cancel")

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                generation_runs=GenerationRuns(),
                restart_signal=lambda: events.append("restart"),
            )
            runtime.install_restart_preparer(
                lambda: events.append("prepare-workspace")
            )
            asyncio.run(runtime.start())

            status = asyncio.run(
                runtime.request_restart(cancel_active=True)
            )

            self.assertEqual(status.stage, RuntimeStage.STOPPING)
            self.assertEqual(
                events,
                ["cancel", "prepare-workspace", "restart"],
            )

    def test_waiting_restart_continues_automatically_after_runs_finish(self):
        active = {"count": 1}
        events = []

        class GenerationRuns:
            def active_count(self):
                return active["count"]

            def cancel_active(self):
                raise AssertionError("完成等待不应取消 Generation Run")

        with tempfile.TemporaryDirectory() as temporary:
            async def scenario():
                async def initialize():
                    return RuntimeStartup(application=object())

                runtime = ApplicationRuntime(
                    initializer=initialize,
                    local_state_dir=Path(temporary) / "local-state",
                    version="test",
                    generation_runs=GenerationRuns(),
                    restart_signal=lambda: events.append("restart"),
                )
                await runtime.start()
                waiting = await runtime.request_restart()
                active["count"] = 0
                await asyncio.sleep(0.3)
                return waiting, runtime.status()

            waiting, finished = asyncio.run(scenario())

            self.assertEqual(waiting.stage, RuntimeStage.RESTART_WAITING)
            self.assertEqual(finished.stage, RuntimeStage.STOPPING)
            self.assertEqual(events, ["restart"])

    def test_restart_preparation_waits_for_generation_runs_before_switching(self):
        active = {"count": 1}
        events = []

        class GenerationRuns:
            def active_count(self):
                return active["count"]

            def cancel_active(self):
                raise AssertionError("默认等待不应取消生成任务")

        with tempfile.TemporaryDirectory() as temporary:
            async def scenario():
                async def initialize():
                    return RuntimeStartup(application=object())

                runtime = ApplicationRuntime(
                    initializer=initialize,
                    local_state_dir=Path(temporary) / "local-state",
                    version="test",
                    generation_runs=GenerationRuns(),
                    restart_signal=lambda: events.append("restart"),
                )
                runtime.install_restart_preparer(
                    lambda: events.append("prepare-workspace")
                )
                await runtime.start()
                waiting = await runtime.request_restart()
                before_safe_point = list(events)
                active["count"] = 0
                await asyncio.sleep(0.3)
                return waiting, before_safe_point, runtime.status()

            waiting, before_safe_point, finished = asyncio.run(scenario())

            self.assertEqual(waiting.stage, RuntimeStage.RESTART_WAITING)
            self.assertEqual(before_safe_point, [])
            self.assertEqual(finished.stage, RuntimeStage.STOPPING)
            self.assertEqual(events, ["prepare-workspace", "restart"])

    def test_restart_preparation_failure_keeps_current_runtime_ready(self):
        events = []

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: events.append("restart"),
            )

            def fail_preparation():
                raise WorkspaceStorageError(
                    "目标工作区无法打开，当前工作区继续可用"
                )

            runtime.install_restart_preparer(fail_preparation)
            asyncio.run(runtime.start())

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(status.stage, RuntimeStage.READY)
            self.assertIn("当前工作区继续可用", status.message)
            self.assertEqual(events, [])

    def test_restart_enters_maintenance_before_draining_and_preparing(self):
        events = []

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=lambda: events.append("restart"),
            )

            async def drain_writes():
                events.append(
                    f"drain:{runtime.status().stage.value}"
                )

            async def prepare_workspace():
                events.append(
                    f"prepare:{runtime.status().stage.value}"
                )

            runtime.install_maintenance_drainer(drain_writes)
            runtime.install_restart_preparer(prepare_workspace)
            asyncio.run(runtime.start())

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(status.stage, RuntimeStage.STOPPING)
            self.assertEqual(
                events,
                [
                    "drain:maintenance",
                    "prepare:maintenance",
                    "restart",
                ],
            )

    def test_restart_signal_failure_rolls_back_prepared_workspace(self):
        events = []

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(application=object())

            def fail_restart():
                events.append("restart")
                raise RuntimeError("launcher unavailable")

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
                restart_signal=fail_restart,
            )

            def prepare_workspace():
                events.append("prepare")
                return lambda: events.append("rollback")

            runtime.install_restart_preparer(prepare_workspace)
            asyncio.run(runtime.start())

            status = asyncio.run(runtime.request_restart())

            self.assertEqual(status.stage, RuntimeStage.READY)
            self.assertIn("当前工作区继续可用", status.message)
            self.assertEqual(
                events,
                ["prepare", "restart", "rollback"],
            )

    def test_failed_startup_produces_safe_copyable_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "Users" / "alice"
            secret_message = (
                f"database failed at {home}/private/auth.db "
                "api_key=sk-secret password=hunter2 "
                "Cookie: ic_session=session-secret "
                'Authorization: Bearer bearer-secret '
                '"api_key":"quoted-secret" '
                '"canvas": {"nodes":[{"prompt":"private Smart Canvas idea"}]}'
            )

            async def initialize():
                raise RuntimeError(secret_message)

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="9.8.7",
                home_dir=home,
                operating_system="TestOS arm64",
                timestamp=lambda: "2026-07-28T12:00:00+08:00",
            )

            status = asyncio.run(runtime.start())
            diagnostic = runtime.copyable_diagnostic(status.error_id)

            self.assertEqual(status.stage, RuntimeStage.FAILED)
            self.assertIn("错误编号", diagnostic)
            self.assertIn(status.error_id, diagnostic)
            self.assertIn("阶段：starting", diagnostic)
            self.assertIn("时间：2026-07-28T12:00:00+08:00", diagnostic)
            self.assertIn("版本：9.8.7", diagnostic)
            self.assertIn("系统：TestOS arm64", diagnostic)
            self.assertIn("~/private/auth.db", diagnostic)
            for private_text in (
                "sk-secret",
                "hunter2",
                "session-secret",
                "bearer-secret",
                "quoted-secret",
                str(home),
                "private Smart Canvas idea",
            ):
                self.assertNotIn(private_text, diagnostic)

    def test_stop_respects_the_grace_period_when_cleanup_is_stuck(self):
        cleanup_cancelled = []

        async def stuck_cleanup():
            try:
                await asyncio.Event().wait()
            finally:
                cleanup_cancelled.append(True)

        with tempfile.TemporaryDirectory() as temporary:
            async def initialize():
                return RuntimeStartup(
                    application=object(),
                    stop=stuck_cleanup,
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=Path(temporary) / "local-state",
                version="test",
            )
            asyncio.run(runtime.start())

            status = asyncio.run(runtime.stop(grace_period_seconds=0.01))

            self.assertEqual(status.stage, RuntimeStage.STOPPING)
            self.assertEqual(cleanup_cancelled, [True])

    def test_restart_then_stop_still_runs_cleanup_exactly_once(self):
        cleanup_calls = []

        async def cleanup():
            cleanup_calls.append("stopped")

        async def scenario(local_state_dir):
            async def initialize():
                return RuntimeStartup(
                    application=object(),
                    stop=cleanup,
                )

            runtime = ApplicationRuntime(
                initializer=initialize,
                local_state_dir=local_state_dir,
                version="test",
            )
            await runtime.start()
            await runtime.request_restart()
            await runtime.stop()
            await runtime.stop()

        with tempfile.TemporaryDirectory() as temporary:
            asyncio.run(
                scenario(Path(temporary) / "local-state")
            )

        self.assertEqual(cleanup_calls, ["stopped"])


if __name__ == "__main__":
    unittest.main()
