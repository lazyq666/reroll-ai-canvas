import asyncio
import io
import json
from pathlib import Path
import tempfile
from threading import Lock
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from infinite_canvas.providers import comfyui_impl as provider
from infinite_canvas.providers import comfyui_transport as transport
from tests.test_comfyui_h3 import template, reference


class EventSocket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.closed = False
    def recv(self, timeout):
        value = next(self.messages)
        if isinstance(value, Exception):
            raise value
        return json.dumps(value)
    def close(self):
        self.closed = True


def message(kind, **data):
    return {"type": kind, "data": {"prompt_id": "job", **data}}


class AdvancingClock:
    """Only mocked polling advances time; every failure stays bounded."""
    def __init__(self):
        self.started = 100.0
        self.now = self.started

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        if self.now - self.started > 30:
            raise AssertionError("Monitor exceeded the bounded fake-clock window")

    @property
    def elapsed(self):
        return self.now - self.started


class ComfyTransportTests(unittest.TestCase):
    def test_queue_position_uses_priority_order_and_running_count(self):
        self.assertEqual(("queued", 1), transport.queue_position({
            "queue_running": [[1, "running"]],
            "queue_pending": [[9, "last"], [4, "job"], [7, "middle"]],
        }, "job"))
        self.assertEqual(("running", None), transport.queue_position({"queue_running": [[1, "job"]]}, "job"))

    def test_progress_is_scoped_and_stage_change_clears_step_percentage(self):
        events = []
        socket = EventSocket([
            message("progress", prompt_id="other-job", node="12", value=3, max=4),
            message("executing", node="12"),
            message("progress", node="12", value=4, max=4),
            message("executing", node="13"),
            message("executing", node="19"),
            message("executing", node="21"),
        ])
        history = Mock(side_effect=[{}] * 7 + [{"job": {"outputs": {"21": {"gifs": []}}}}])
        ticks = iter(range(100))
        with patch.object(transport.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(transport.requests, "get", return_value=SimpleNamespace(json=lambda: {"queue_running": [[0,"job"]]})):
            result = transport.wait_for_history("host:8188", "job", get_history=history, adapter="h3", on_progress=events.append, events=socket)
        self.assertIn("outputs", result)
        self.assertTrue(socket.closed)
        first_steps = [e for e in events if e["progress_percent"] is not None]
        self.assertEqual([100], [e["progress_percent"] for e in first_steps])
        upscale = next(e for e in events if e["stage"] == "comfy-upscaling")
        self.assertIsNone(upscale["progress_current"])
        self.assertIsNone(upscale["progress_percent"])
        self.assertEqual("comfy-encoding", transport.node_stage(
            "reroll_h3_create_video", {"reroll_h3_create_video": "CreateVideo"}, "h3",
        ))

    def test_disconnected_socket_uses_history_without_submission(self):
        history = Mock(side_effect=[{}, {"job": {"outputs": {"21": {"gifs": []}}}}])
        socket = EventSocket([ConnectionError("disconnected")])
        ticks = iter(range(100))
        with patch.object(transport.time, "monotonic", side_effect=lambda: next(ticks)), patch.object(transport.time, "sleep"), patch.object(transport.requests, "get", return_value=SimpleNamespace(json=lambda: {})):
            result = transport.wait_for_history("host:8188", "job", get_history=history, events=socket)
        self.assertIn("outputs", result)
        self.assertTrue(socket.closed)

    def test_long_queue_wait_does_not_consume_the_execution_budget(self):
        clock = AdvancingClock()
        events = []
        completed = {"status": {"status_str": "success"},
                     "outputs": {"21": {"gifs": [{"filename": "final.mp4"}]}}}

        def history(_backend, _prompt_id):
            return {"job": completed} if clock.elapsed >= 10 else {}

        def queue(*_args, **_kwargs):
            value = ({"queue_running": [[0, "job"]]} if clock.elapsed >= 6
                     else {"queue_pending": [[0, "job"]]})
            return SimpleNamespace(json=lambda: value)

        with patch.object(transport.time, "monotonic", side_effect=clock.monotonic), \
                patch.object(transport.time, "sleep", side_effect=clock.sleep), \
                patch.object(transport.requests, "get", side_effect=queue):
            result = transport.wait_for_history(
                "host:8188", "job", get_history=history,
                queue_timeout=8, timeout=4, on_progress=events.append,
            )
        self.assertIs(completed, result)
        self.assertEqual(10, clock.elapsed)
        self.assertEqual("comfy-preparing", events[-1]["stage"])

    def test_queue_timeout_uses_the_waiting_budget(self):
        clock = AdvancingClock()
        queue = SimpleNamespace(json=lambda: {"queue_pending": [[0, "job"]]})
        events = []
        with patch.object(transport.time, "monotonic", side_effect=clock.monotonic), \
                patch.object(transport.time, "sleep", side_effect=clock.sleep), \
                patch.object(transport.requests, "get", return_value=queue):
            with self.assertRaisesRegex(TimeoutError, "comfy.queue_timeout$"):
                transport.wait_for_history(
                    "host:8188", "job", get_history=lambda *_: {},
                    queue_timeout=5, timeout=10, on_progress=events.append,
                )
        # Queue polling is every two seconds, so the five-second limit is
        # first observed at six seconds, well before the execution budget.
        self.assertEqual(6, clock.elapsed)
        self.assertTrue(all(event["stage"] == "comfy-queued" for event in events))

    def test_execution_timeout_starts_when_the_queued_job_becomes_running(self):
        clock = AdvancingClock()

        def queue(*_args, **_kwargs):
            value = ({"queue_running": [[0, "job"]]} if clock.elapsed >= 6
                     else {"queue_pending": [[0, "job"]]})
            return SimpleNamespace(json=lambda: value)

        with patch.object(transport.time, "monotonic", side_effect=clock.monotonic), \
                patch.object(transport.time, "sleep", side_effect=clock.sleep), \
                patch.object(transport.requests, "get", side_effect=queue):
            with self.assertRaisesRegex(TimeoutError, "comfy.execution_timeout$"):
                transport.wait_for_history(
                    "host:8188", "job", get_history=lambda *_: {},
                    queue_timeout=8, timeout=3,
                )
        self.assertEqual(9.5, clock.elapsed)

    def test_execution_failure_cannot_be_mistaken_for_output(self):
        failure = {"status": {"status_str": "error", "messages": [["execution_error", {"exception_message": "out of memory"}]]}, "outputs": {"185": {"gifs": []}}}
        with self.assertRaisesRegex(RuntimeError, "out of memory"):
            transport.wait_for_history("host:8188", "job", get_history=lambda *_: {"job": failure})


class ComfyProviderIsolationTests(unittest.TestCase):
    def setUp(self):
        self.ports = SimpleNamespace(QUEUE_LOCK=Lock(), QUEUE=[], LOAD_LOCK=Lock(), COMFYUI_HISTORY_TIMEOUT=2, COMFY_PREVIEW_CLASS_HINTS=("preview",), COMFY_DEBUG_TEXT_CLASS_HINTS=("showtext",))
        self.history = {"outputs": {
            "185": {"gifs": [{"filename": "preview.mp4", "type": "temp"}]},
            "21": {"gifs": [{"filename": "final.mp4", "type": "output"}]},
        }}

    def request(self, **overrides):
        return SimpleNamespace(prompt="Animate <Picture 1>", workflow_json="custom/H3.json", params={}, workflow_inputs={"references": [reference()]}, type="workflow", client_id="client", convert_to_jpg=False, width=1024, height=1024, **overrides)

    def test_initial_and_recovery_select_same_final_node_and_no_resubmit(self):
        self._assert_initial_and_recovery_select_same_final_node()

    def test_native_save_video_in_images_is_recovered_as_video(self):
        self.history["outputs"]["21"] = {
            "images": [{"filename": "final.mp4", "type": "output"}], "animated": [True],
        }
        self._assert_initial_and_recovery_select_same_final_node()

    def _assert_initial_and_recovery_select_same_final_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "H3.json"
            path.write_text(json.dumps(template()))
            checkpoints = []
            with provider.bind_ports(self.ports), patch.object(provider, "workflow_path_from_name", return_value=str(path)), patch.object(provider, "read_workflow_config", return_value={}), patch.object(provider, "COMFYUI_INSTANCES", ["127.0.0.1:8188"]), patch.object(provider, "BACKEND_LOCAL_LOAD", {}), patch.object(provider, "probe_h3_references", side_effect=lambda refs, backend: refs), patch.object(provider, "connect_events", return_value=None), patch.object(provider, "wait_for_history", return_value=self.history), patch.object(provider.urllib.request, "urlopen", return_value=io.BytesIO(b'{"prompt_id":"job"}')) as submit:
                initial = provider.generate(self.request(), publish=False, on_remote=checkpoints.append)
                recovered = asyncio.run(provider.execute_comfyui_recovery(checkpoints[0].raw))
            self.assertNotIn("error", initial)
            self.assertEqual(1, submit.call_count)
            self.assertEqual(initial["videos"], recovered["videos"])
            self.assertEqual(["21"], [item["node_id"] for item in initial["items"]])
            self.assertEqual(["21"], checkpoints[0].raw["output_node_ids"])
            self.assertEqual("h3", checkpoints[0].raw["adapter"])
            self.assertEqual(4, checkpoints[0].raw["duration"])
            self.assertTrue(checkpoints[0].raw["client_id"])

    def test_h3_success_without_final_video_fails_initial_and_recovery_paths(self):
        histories = {
            "empty history": {},
            "preview only": {"185": {"gifs": [{"filename": "preview.mp4", "type": "temp"}]}},
            "empty final node": {"21": {"gifs": []}},
            "final node has only an image": {"21": {"images": [{"filename": "final.png", "type": "output"}]}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "H3.json"
            path.write_text(json.dumps(template()))
            for name, outputs in histories.items():
                with self.subTest(history=name):
                    checkpoints = []
                    history = {"status": {"status_str": "success"}, "outputs": outputs}
                    with provider.bind_ports(self.ports), \
                            patch.object(provider, "workflow_path_from_name", return_value=str(path)), \
                            patch.object(provider, "read_workflow_config", return_value={}), \
                            patch.object(provider, "COMFYUI_INSTANCES", ["127.0.0.1:8188"]), \
                            patch.object(provider, "BACKEND_LOCAL_LOAD", {}), \
                            patch.object(provider, "probe_h3_references", side_effect=lambda refs, backend: refs), \
                            patch.object(provider, "connect_events", return_value=None), \
                            patch.object(provider, "get_comfy_history", return_value={"job": history}) as queried, \
                            patch.object(provider.requests, "get", side_effect=AssertionError("Unexpected network request")), \
                            patch.object(provider.urllib.request, "urlopen", return_value=io.BytesIO(b'{"prompt_id":"job"}')) as submit:
                        initial = provider.generate(self.request(), publish=False, on_remote=checkpoints.append)
                        self.assertEqual("comfy.execution_no_outputs", initial["error"])
                        self.assertEqual(1, len(checkpoints))
                        with self.assertRaisesRegex(RuntimeError, "comfy.execution_no_outputs$"):
                            asyncio.run(provider.execute_comfyui_recovery(checkpoints[0].raw))
                    self.assertEqual(1, submit.call_count, "Recovery must not create another prompt")
                    self.assertEqual(2, queried.call_count)
                    self.assertTrue(all(call.args == ("127.0.0.1:8188", "job")
                                        for call in queried.call_args_list))

    def test_mismatched_media_backends_fail_before_submission(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "H3.json"
            path.write_text(json.dumps(template()))
            req = self.request()
            req.workflow_inputs["references"].append(reference(1, backend="other:8188"))
            with provider.bind_ports(self.ports), patch.object(provider, "workflow_path_from_name", return_value=str(path)), patch.object(provider, "read_workflow_config", return_value={}), patch.object(provider.urllib.request, "urlopen") as submit:
                result = provider.generate(req, publish=False)
            self.assertEqual("comfy.h3.backend_mismatch", result["error"])
            submit.assert_not_called()

    def test_generic_workflow_keeps_explicit_params_and_no_h3_overrides(self):
        graph = {"22": {"class_type": "PrimitiveInt", "inputs": {"seed": 55}}, "21": {"class_type": "SaveImage", "inputs": {"value": 1}}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "generic.json"
            path.write_text(json.dumps(graph))
            req = self.request()
            req.workflow_json = "custom/generic.json"
            req.workflow_inputs = {}
            req.params = {"21": {"value": 77}}
            with provider.bind_ports(self.ports), patch.object(provider, "workflow_path_from_name", return_value=str(path)), patch.object(provider, "read_workflow_config", return_value={}), patch.object(provider, "reserve_best_backend", return_value="host:8188"), patch.object(provider, "connect_events", return_value=None), patch.object(provider, "wait_for_history", return_value={"outputs": {"21": {"images": [{"filename": "final.png"}]}}}), patch.object(provider.urllib.request, "urlopen", return_value=io.BytesIO(b'{"prompt_id":"job"}')) as submit:
                result = provider.generate(req, publish=False)
            self.assertNotIn("error", result)
            sent = json.loads(submit.call_args.args[0].data)["prompt"]
            self.assertEqual(55, sent["22"]["inputs"]["seed"])
            self.assertEqual(77, sent["21"]["inputs"]["value"])
            self.assertNotIn("reroll_h3_trim_audio", sent)


class ComfyRecoveryFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_keeps_original_prompt_recoverable_then_delivers_once(self):
        from tests.test_comfy_workflow_progress import executor, Effects
        from infinite_canvas.generation_runs import GenerationRuns, WorkflowRun
        submitted = []
        recovered = []
        checkpoint = {"status": "running", "prompt_id": "existing-prompt", "backend": "machine:8188", "output_node_ids": ["21"], "adapter": "h3"}
        async def submit(payload, on_remote=None, on_progress=None):
            submitted.append(payload)
            return checkpoint
        async def recover(payload, on_progress=None):
            recovered.append(payload)
            return await provider.execute_comfyui_recovery(payload, on_progress=on_progress)
        runs = GenerationRuns(executor=executor(submit, recover), effects=Effects(), store_path=lambda: None)
        initial = await runs.start(WorkflowRun("comfyui", {}))
        history = {"outputs": {"21": {"gifs": [{"filename": "final.mp4", "type": "output"}]}}}
        with provider.bind_ports(SimpleNamespace(COMFYUI_HISTORY_TIMEOUT=1)), patch.object(provider, "connect_events", return_value=None), patch.object(provider, "wait_for_history", side_effect=[TimeoutError("comfy.execution_timeout"), history]):
            with self.assertRaises(TimeoutError):
                await runs.resume(initial.id)
            after_timeout = runs.get(initial.id)
            self.assertTrue(after_timeout.recoverable)
            self.assertEqual("running", after_timeout.status)
            completed = await runs.resume(initial.id)
        self.assertEqual("succeeded", completed.status)
        self.assertEqual(1, len(submitted))
        self.assertEqual(2, len(recovered))
        self.assertEqual([checkpoint, checkpoint], recovered)
        self.assertEqual(1, len(completed.result["videos"]))

    async def test_saved_workflow_error_is_not_success(self):
        from tests.test_comfy_workflow_progress import executor
        runtime = executor(provider.execute_comfyui_saved_workflow)._runtime
        with patch.object(provider, "run_workflow", return_value={"images": [], "error": "comfy.h3.prompt_reference_missing"}):
            with self.assertRaisesRegex(RuntimeError, "prompt_reference_missing"):
                await runtime.execute_workflow("comfyui-saved", {"name": "custom/H3.json", "payload": SimpleNamespace()})

    def test_real_monitor_timeout_uses_a_recoverable_exception(self):
        with patch.object(transport.time, "monotonic", side_effect=[0, 0, 2]), patch.object(transport.time, "sleep"), patch.object(transport.requests, "get", return_value=SimpleNamespace(json=lambda: {"queue_running": [[0, "job"]]})):
            with self.assertRaisesRegex(TimeoutError, "execution_timeout"):
                transport.wait_for_history("host:8188", "job", get_history=lambda *_: {}, timeout=1)
