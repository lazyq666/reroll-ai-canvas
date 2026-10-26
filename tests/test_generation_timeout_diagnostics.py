import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx
from fastapi import HTTPException

from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.generation_runs import (
    GenerationRuns,
    ImageRun,
    RecoveryRun,
    TextRun,
)
from infinite_canvas.providers.core import Capability, Completed, Pending
from infinite_canvas.providers.runtime import (
    TextExecutors,
    TextStreamEvent,
    TextStreamEventKind,
    TextStreamOutput,
    build_text_registry,
)


class UnusedEffects:
    async def publish(self, *_args):
        raise AssertionError("A failed request must not publish outputs")


class GenerationTimeoutDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_transport_timeouts_keep_type_without_inventing_http_status(self):
        for exception_type in (
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
        ):
            with self.subTest(exception_type=exception_type.__name__):
                with tempfile.TemporaryDirectory() as temporary:
                    error = exception_type("")
                    calls = []

                    class Executor:
                        async def execute(self, request):
                            calls.append(request)
                            raise error

                    path = Path(temporary) / "runs.json"
                    runs = GenerationRuns(
                        executor=Executor(), effects=UnusedEffects(),
                        store_path=lambda: path,
                    )
                    request = ImageRun(
                        prompt="keep input", settings={"provider_id": "apimart"}
                    )
                    with self.assertRaises(exception_type):
                        await runs.start(request, key="same-submission", owner="designer")
                    # Reading a repeated operation must not submit a paid request again.
                    failed = await runs.start(request, key="same-submission", owner="designer")
                    expected = f"provider_network_timeout: {exception_type.__name__}"
                    self.assertEqual("failed", failed.status)
                    self.assertEqual(expected, failed.error)
                    self.assertEqual(0, failed.status_code)
                    self.assertFalse(failed.recoverable)
                    self.assertEqual((), failed.remote_refs)
                    restarted = GenerationRuns(
                        executor=Executor(), effects=UnusedEffects(),
                        store_path=lambda: path,
                    )
                    restored = await restarted.query(failed.id, owner="designer")
                    self.assertEqual(expected, restored.error)
                    self.assertEqual(0, restored.status_code)
                    self.assertEqual(1, len(calls))

    async def test_real_upstream_500_takes_priority_over_earlier_timeout(self):
        response = httpx.Response(500, request=httpx.Request("POST", "https://provider.test/generate"))
        error = httpx.HTTPStatusError("provider rejected request", request=response.request, response=response)
        error.__cause__ = httpx.ConnectTimeout("")

        class Executor:
            async def execute(self, _request):
                raise error

        runs = GenerationRuns(executor=Executor(), effects=UnusedEffects())
        request = ImageRun(prompt="input", settings={})
        with self.assertRaises(httpx.HTTPStatusError):
            await runs.start(request, key="real-500", owner="designer")
        failed = await runs.start(request, key="real-500", owner="designer")
        self.assertEqual(500, failed.status_code)
        self.assertEqual("provider rejected request", failed.error)
        self.assertNotIn("provider_network_timeout", failed.error)

    async def test_cli_execution_timeout_keeps_explicit_failure_detail(self):
        error = HTTPException(status_code=504, detail="即梦 CLI 执行超时：dreamina generate")
        error.__cause__ = TimeoutError()

        class Executor:
            async def execute(self, _request):
                raise error

        runs = GenerationRuns(executor=Executor(), effects=UnusedEffects())
        request = ImageRun(prompt="input", settings={"provider_id": "jimeng"})
        with self.assertRaises(HTTPException):
            await runs.start(request, key="cli-timeout", owner="designer")
        failed = await runs.start(request, key="cli-timeout", owner="designer")
        self.assertEqual(504, failed.status_code)
        self.assertEqual(error.detail, failed.error)

    async def test_child_timeout_diagnostics_preserve_remote_recovery(self):
        for checkpoint_remote in (False, True):
            with self.subTest(checkpoint_remote=checkpoint_remote):
                calls = []

                class Executor:
                    async def execute(self, request, checkpoint=None):
                        calls.append(request)
                        if isinstance(request, RecoveryRun):
                            return Pending(request.remote_ref, status="running")
                        if checkpoint_remote:
                            checkpoint(Pending("paid-task-1", status="running"))
                        raise httpx.ReadTimeout("")

                runs = GenerationRuns(executor=Executor(), effects=UnusedEffects())
                request = ImageRun(prompt="input", settings={}, submission_count=2)
                with self.assertRaises(httpx.ReadTimeout):
                    await runs.start(request, key="child-timeout", owner="designer")
                failed = await runs.start(request, key="child-timeout", owner="designer")
                self.assertEqual("provider_network_timeout: ReadTimeout", failed.error)
                self.assertEqual(0, failed.status_code)
                self.assertEqual(checkpoint_remote, failed.recoverable)
                child = failed.child_attempts[0]
                self.assertEqual("provider_network_timeout: ReadTimeout", child["error"])
                self.assertEqual(0, child["raw"]["status_code"])
                self.assertEqual("running" if checkpoint_remote else "failed", child["status"])
                self.assertEqual(("paid-task-1",) if checkpoint_remote else (), failed.remote_refs)
                self.assertEqual(1, len(calls))
                resumed = await runs.resume(failed.id, owner="designer")
                if checkpoint_remote:
                    self.assertEqual("running", resumed.status)
                    self.assertEqual(2, len(calls))
                    self.assertIsInstance(calls[1], RecoveryRun)
                    self.assertEqual("paid-task-1", calls[1].remote_ref)
                else:
                    self.assertEqual("failed", resumed.status)
                    self.assertEqual(1, len(calls))

    async def test_sqlite_reload_and_public_diagnostics_keep_timeout_evidence(self):
        from tests.runtime_env import ensure_test_workspace
        ensure_test_workspace()
        from main import _safe_canvas_run_diagnostics

        with tempfile.TemporaryDirectory() as temporary:
            store = SqliteGenerationRunStore(Path(temporary) / "runs.sqlite3", workspace_id="timeout-workspace")
            executor = GenerationRunStoreExecutor(max_workers=1, max_pending=8)
            lifecycle = AsyncGenerationRunLifecycleStore(store=store, store_executor=executor)

            class TimeoutExecutor:
                async def execute(self, _request):
                    raise httpx.ConnectTimeout("token=secret https://private.example/path")

            runs = GenerationRuns(executor=TimeoutExecutor(), effects=UnusedEffects(), lifecycle_store=lifecycle)
            request = ImageRun(prompt="input", submission_count=2, settings={"provider_id": "apimart"})
            try:
                with self.assertRaises(httpx.ConnectTimeout):
                    await runs.start(request, key="persist-timeout", owner="designer")
                await runs.wait_for_lifecycle_projection()
                restarted = GenerationRuns(executor=TimeoutExecutor(), effects=UnusedEffects(), lifecycle_store=lifecycle)
                restored = await restarted.start(request, key="persist-timeout", owner="designer")
                diagnostics = _safe_canvas_run_diagnostics(restored)
                self.assertEqual("provider_network_timeout: ConnectTimeout", diagnostics["technical_error"])
                self.assertEqual(0, diagnostics["http_status"])
                self.assertEqual([], diagnostics["upstream_task_ids"])
                self.assertEqual({}, diagnostics["billing_evidence"])
                self.assertEqual("provider_network_timeout: ConnectTimeout", diagnostics["tasks"][0]["technical_error"])
                self.assertEqual(0, diagnostics["tasks"][0]["http_status"])
                self.assertNotIn("secret", str(diagnostics))
                self.assertNotIn("private.example", str(diagnostics))
            finally:
                await lifecycle.close()
                await executor.close()

    async def test_stream_read_timeout_is_not_saved_as_provider_500(self):
        class Executor:
            async def execute(self, _request):
                async def events():
                    yield TextStreamEvent(TextStreamEventKind.DELTA, delta="partial")
                    raise httpx.ReadTimeout("")
                return Completed(TextStreamOutput(model="text", events=events()))

        class StreamEffects(UnusedEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        runs = GenerationRuns(executor=Executor(), effects=StreamEffects())
        started = await runs.start(TextRun(payload={}, stream=True), owner="designer")
        with self.assertRaises(httpx.ReadTimeout):
            _ = [event async for event in started.result.events]
        failed = runs.get(started.id, owner="designer")
        self.assertEqual("failed", failed.status)
        self.assertEqual("provider_network_timeout: ReadTimeout", failed.error)
        self.assertEqual(0, failed.status_code)

    async def test_real_http_stream_adapter_keeps_read_timeout_type(self):
        from tests.runtime_env import ensure_test_workspace
        ensure_test_workspace()
        import main
        from infinite_canvas.providers import http_impl

        class TimeoutStream:
            async def __aenter__(self):
                raise httpx.ReadTimeout("")

            async def __aexit__(self, *_args):
                return False

        class Client:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            def stream(self, *_args, **_kwargs):
                return TimeoutStream()

        unused = mock.AsyncMock(side_effect=AssertionError("wrong adapter"))
        registry = build_text_registry(TextExecutors(
            http=unused, http_stream=http_impl.execute_http_text_stream,
            codex=unused, gemini_cli=unused,
            codex_default_model="", gemini_cli_default_model="",
        ))

        class Executor:
            async def execute(self, _request):
                return await registry.execute(
                    {"id": "apimart", "protocol": "apimart"},
                    Capability.TEXT_STREAM,
                    payload=SimpleNamespace(provider="apimart", model="text", ms_model=""),
                    history=[], messages=[],
                )

        class StreamEffects(UnusedEffects):
            async def publish_typed(self, _run_id, _request, output):
                return output

        runs = GenerationRuns(executor=Executor(), effects=StreamEffects())
        with (
            mock.patch.object(http_impl, "resolve_chat_provider", return_value=("https://provider.test/v1", {}, "text")),
            mock.patch.object(http_impl.httpx, "AsyncClient", Client),
            mock.patch.object(http_impl, "log_net_error"),
        ):
            started = await runs.start(TextRun(payload={}, stream=True), owner="designer")
            events = [event async for event in started.result.events]
        self.assertEqual("provider_network_timeout: ReadTimeout", events[0].detail)
        failed = runs.get(started.id, owner="designer")
        self.assertEqual("provider_network_timeout: ReadTimeout", failed.error)
        self.assertEqual(0, failed.status_code)


class GenerationTimeoutHttpBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from tests.runtime_env import ensure_test_workspace
        ensure_test_workspace()
        import main
        self.main = main

    async def invoke(self, entry):
        request = ImageRun(prompt="input", settings={})
        if entry == "inline":
            return await self.main._run_generation_inline(request)
        if entry == "online-image":
            return await self.main.build_online_image_result(SimpleNamespace())
        return await self.main._query_generation_remote(
            "paid-task-1", fallback_request=request, fallback_key="query-only"
        )

    async def test_sync_entrypoints_convert_transport_timeout_to_local_504(self):
        for entry in ("inline", "online-image", "query"):
            with self.subTest(entry=entry):
                runs = SimpleNamespace(
                    start=mock.AsyncMock(side_effect=httpx.ConnectTimeout("")),
                    find_by_remote_ref=mock.Mock(return_value=None),
                )
                with (
                    mock.patch.object(self.main, "_GENERATION_RUNS", runs),
                    mock.patch.object(self.main, "_generation_target", return_value=("", "", None)),
                    mock.patch.object(self.main, "_online_image_run", return_value=ImageRun(prompt="input", settings={})),
                ):
                    with self.assertRaises(HTTPException) as caught:
                        await self.invoke(entry)
                self.assertEqual(504, caught.exception.status_code)
                self.assertEqual("provider_network_timeout: ConnectTimeout", caught.exception.detail)

    async def test_failed_run_timeout_keeps_local_504_without_changing_real_500(self):
        for detail, stored_status, expected_status in (
            ("provider_network_timeout: ConnectTimeout", 0, 504),
            ("real upstream failure", 500, 500),
            ("unclassified failure", 0, 500),
        ):
            for entry in ("inline", "online-image", "query"):
                with self.subTest(entry=entry, detail=detail):
                    run = SimpleNamespace(status="failed", status_code=stored_status, error=detail, result=None)
                    runs = SimpleNamespace(
                        start=mock.AsyncMock(return_value=run),
                        find_by_remote_ref=mock.Mock(return_value=run),
                    )
                    with (
                        mock.patch.object(self.main, "_GENERATION_RUNS", runs),
                        mock.patch.object(self.main, "_generation_target", return_value=("", "", None)),
                        mock.patch.object(self.main, "_online_image_run", return_value=ImageRun(prompt="input", settings={})),
                    ):
                        with self.assertRaises(HTTPException) as caught:
                            await self.invoke(entry)
                    self.assertEqual(expected_status, caught.exception.status_code)
                    self.assertEqual(detail, caught.exception.detail)
                    self.assertEqual(stored_status, run.status_code)

    async def test_http_boundary_preserves_real_status_and_structured_http_exception(self):
        structured = HTTPException(status_code=422, detail={"code": "input_count"})
        real_response = httpx.Response(500, request=httpx.Request("POST", "https://provider.test/generate"))
        real_error = httpx.HTTPStatusError("real provider error", request=real_response.request, response=real_response)
        for error, status, detail in (
            (structured, 422, {"code": "input_count"}),
            (real_error, 500, "real provider error"),
        ):
            with self.subTest(status=status):
                with self.assertRaises(HTTPException) as caught:
                    self.main._raise_generation_http(error)
                self.assertEqual(status, caught.exception.status_code)
                self.assertEqual(detail, caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
