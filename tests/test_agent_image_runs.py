"""Account-scoped HTTP acceptance for background CLI image generation."""
import asyncio
import copy
import io
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from infinite_canvas.auth_system import install_access_control
from infinite_canvas.generation_runs import GenerationRuns, ImageRun
from infinite_canvas.providers.core import Completed
from infinite_canvas.providers.runtime import ProviderOutput
from tests import test_agent_api as agent_api_fixture


class ImageAdapter:
    def __init__(self, url):
        self.url, self.calls = url, []
        self.block = False

    async def execute(self, request):
        self.calls.append(request)
        while self.block:
            await asyncio.sleep(.005)
        return Completed(ProviderOutput(media=(self.url,), legacy={"images": [self.url]}))


class ImageEffects:
    async def publish(self, run_id, request, output):
        return output.legacy


class AgentImageRunApiTests(unittest.TestCase):
    def setUp(self):
        fixture = agent_api_fixture.AgentApiTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture
        self.api, self.auth = fixture.api, fixture.auth
        self.root = Path(fixture.tmp.name)
        image = io.BytesIO()
        Image.new("RGB", (30, 40), "red").save(image, "PNG")
        self.png = image.getvalue()
        self.output = fixture.media.import_bytes(self.png, name="output.png").public()
        self.adapter = ImageAdapter(self.output["url"])
        self.runs = GenerationRuns(executor=self.adapter, effects=ImageEffects(),
                                   store_path=lambda: self.root / "runs.json")
        self.api.image_runs = lambda: self.runs
        self.api.compile_image = lambda value: ImageRun(
            value["prompt"], settings={"provider_id": value["provider_id"], "model": value["model"],
                "target_aspect_ratio": value.get("ratio"), "resolution_tier": value.get("resolution"),
                "operation": "image.edit" if value["references"] else "image.generate"},
            references=tuple(value["references"]))
        self.capabilities = {}
        for operation in ("image.generate", "image.edit"):
            self.capabilities[operation] = {
                "provider_id": "fixture", "model_id": "image", "operation": operation,
                "catalog_revision": self.api.catalog.revision,
                "capability_schema_version": 1, "support_state": "supported",
                "inputs": {"text": {"minimum": 1, "maximum": 1}, "image": {"minimum": int(operation == "image.edit"), "maximum": 2}},
                "parameters": {"aspect_ratio": {"type": "enum", "values": ["1:1", "3:4"], "default": "1:1"},
                    "resolution_tier": {"type": "enum", "values": ["1K", "2K"], "default": "1K"},
                    "count": {"type": "integer", "minimum": 1, "maximum": 1}},
                "input_rules": {}, "output": {"kind": "image"}}
        self.api.resolve_model = lambda p, m, op: copy.deepcopy(self.capabilities[op])
        self.api.models = lambda: [{"provider_id": "fixture", "model": "image", "kind": "image"}]
        app = FastAPI()
        self.api.install(app)
        install_access_control(app, self.auth)
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.client.headers["Authorization"] = "Bearer " + fixture.token["token"]

    def submit(self, **changes):
        body = {"request_id": "test-request", "provider_id": "fixture", "model": "image", "prompt": "  exact\nprompt  "}
        body.update(changes)
        return self.client.post("/api/agent/v1/image-runs", json=body)

    def wait(self, run_id):
        for _ in range(100):
            response = self.client.get("/api/agent/v1/image-runs/" + run_id)
            if response.json()["status"] != "pending":
                return response
            time.sleep(.005)
        self.fail("Run did not finish")

    def test_background_generate_and_owned_download(self):
        response = self.submit(ratio="3:4", resolution="2k")
        self.assertEqual(200, response.status_code, response.text)
        result = self.wait(response.json()["run_id"]).json()
        self.assertEqual("succeeded", result["status"])
        self.assertEqual("image.generate", result["operation"])
        self.assertEqual("2K", result["settings"]["resolution"])
        self.assertEqual("3:4", result["settings"]["ratio"])
        self.assertEqual("  exact\nprompt  ", self.adapter.calls[0].prompt)
        self.assertEqual([], result["inputs"])
        self.assertEqual((30, 40), (result["outputs"][0]["width"], result["outputs"][0]["height"]))
        download = self.client.get(result["outputs"][0]["download_url"])
        self.assertEqual(self.png, download.content)
        self.assertEqual(1, len(self.api.canvases(self.fixture.admin)))

    def upload(self, name="reference.png", data=None):
        response = self.client.post("/api/agent/v1/media", files={"file": (name, data or self.png, "image/png")},
                                    headers={"Idempotency-Key": "upload-" + name})
        self.assertEqual(200, response.status_code, response.text)
        return {"media_id": response.json()["media_id"], "name": name}

    def test_ordered_duplicate_references_auto_and_input_limits(self):
        one = self.upload()
        response = self.submit(images=[one], ratio="auto")
        self.assertEqual(200, response.status_code, response.text)
        result = self.wait(response.json()["run_id"]).json()
        self.assertEqual("image.edit", result["operation"])
        self.assertEqual("auto", result["settings"]["requested_ratio"])
        self.assertEqual("3:4", result["settings"]["ratio"])
        response = self.submit(request_id="duplicates", images=[one, one], ratio="3:4")
        self.assertEqual(200, response.status_code, response.text)
        result = self.wait(response.json()["run_id"]).json()
        self.assertEqual([1, 2], [item["index"] for item in result["inputs"]])
        self.assertEqual([one["media_id"], one["media_id"]], [ref["media_id"] for ref in self.adapter.calls[-1].references])
        for extra in ({"images": [one, one, one], "ratio": "3:4"}, {"images": [one, one]},
                      {"images": [one, one], "ratio": "auto"}, {"ratio": "auto"},
                      {"ratio": "16:9"}, {"resolution": "4K"}, {"model": "IMAGE"}, {"size": "100x100"}):
            response = self.submit(request_id="invalid", **extra)
            self.assertIn(response.status_code, (409, 422), response.text)
        self.assertEqual(2, len(self.adapter.calls))

    def test_retry_uses_original_run_after_catalog_and_defaults_change_and_restart(self):
        accepted = self.submit().json()
        run_id = accepted["run_id"]
        original = self.wait(run_id).json()
        self.capabilities["image.generate"]["parameters"]["aspect_ratio"]["default"] = "3:4"
        self.capabilities["image.generate"]["parameters"]["resolution_tier"]["default"] = "2K"
        self.api.models = lambda: []
        self.runs = GenerationRuns(executor=self.adapter, effects=ImageEffects(), store_path=lambda: self.root / "runs.json")
        repeated = self.submit()
        self.assertEqual(200, repeated.status_code, repeated.text)
        self.assertEqual(run_id, repeated.json()["run_id"])
        self.assertEqual(original["settings"], repeated.json()["settings"])
        self.assertEqual(409, self.submit(prompt="different").status_code)
        self.assertEqual(1, len(self.adapter.calls))
        response = self.client.get(original["outputs"][0]["download_url"])
        self.assertEqual(self.png, response.content)

    def test_authorization_confirmation_and_account_isolation(self):
        self.auth.save_agent_settings(self.fixture.admin, {"confirmation": True})
        self.assertEqual("confirmation_required", self.submit().json()["code"])
        self.auth.save_agent_settings(self.fixture.admin, {"confirmation": False, "concurrency": 1})
        authoring = self.auth.create_agent_token(self.fixture.admin, "authoring", ["authoring"])
        saved_token = self.client.headers["Authorization"]
        self.client.headers["Authorization"] = "Bearer " + authoring["token"]
        self.assertEqual("run_scope_required", self.submit().json()["code"])
        self.client.headers["Authorization"] = saved_token
        accepted = self.submit().json()
        self.assertEqual(accepted["run_id"], self.submit().json()["run_id"])
        result = self.wait(accepted["run_id"]).json()
        other_token = self.auth.create_agent_token(self.fixture.other, "other", ["authoring", "run"])
        self.client.headers["Authorization"] = "Bearer " + other_token["token"]
        self.assertEqual(404, self.client.get("/api/agent/v1/image-runs/" + accepted["run_id"]).status_code)
        self.assertEqual(404, self.client.get(result["outputs"][0]["download_url"]).status_code)
        self.client.headers["Authorization"] = saved_token
        self.auth.revoke_agent_token(self.fixture.admin, self.fixture.token["id"])
        self.assertEqual(401, self.client.get("/api/agent/v1/image-runs/" + accepted["run_id"]).status_code)

    def test_cli_runs_exceed_old_account_limit_across_clients_and_models(self):
        self.auth.save_agent_settings(self.fixture.admin, {"concurrency": 1})
        other_client = self.auth.create_agent_token(self.fixture.admin, "second-cli", ["authoring", "run"])
        tokens = [self.fixture.token["token"], other_client["token"]]
        models = [{"provider_id": "fixture", "model": "image"},
                  {"provider_id": "secondary", "model": "image-2"}]
        self.api.models = lambda: [{**model, "kind": "image"} for model in models]
        self.api.resolve_model = lambda provider, model, operation: {
            **copy.deepcopy(self.capabilities[operation]), "provider_id": provider, "model_id": model}

        def submit(index):
            return self.client.post("/api/agent/v1/image-runs",
                json={"request_id": f"parallel-{index}", "prompt": "Concurrent image", **models[index % 2]},
                headers={"Authorization": "Bearer " + tokens[index % 2]})

        self.adapter.block = True
        try:
            with ThreadPoolExecutor(max_workers=12) as pool:
                responses = list(pool.map(submit, [*range(12), 0, 0, 0]))
            for response in responses:
                self.assertEqual(200, response.status_code, response.text)
                self.assertEqual("pending", response.json()["status"])
            run_ids = [response.json()["run_id"] for response in responses]
            self.assertEqual(12, len(set(run_ids)))
            self.assertEqual([run_ids[0]] * 3, run_ids[-3:])
            for _ in range(100):
                if len(self.adapter.calls) == 12:
                    break
                time.sleep(.005)
            self.assertEqual(12, len(self.adapter.calls))
        finally:
            self.adapter.block = False
        for run_id in set(run_ids):
            self.assertEqual("succeeded", self.wait(run_id).json()["status"])

    def test_invalid_images_and_account_only_media_do_not_reach_provider(self):
        bad = self.upload("bad.png", b"not an image")
        self.assertEqual("invalid_image", self.submit(images=[bad], ratio="1:1").json()["code"])
        one = self.upload()
        token = self.auth.create_agent_token(self.fixture.other, "other", ["authoring", "run"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        self.assertEqual("media_unavailable", self.submit(images=[one], ratio="1:1").json()["code"])
        self.assertEqual([], self.adapter.calls)

    def test_defaults_required_and_nonapplicable_parameters(self):
        capability = self.capabilities["image.generate"]
        capability["parameters"].pop("resolution_tier")
        response = self.submit()
        self.assertEqual(200, response.status_code, response.text)
        result = self.wait(response.json()["run_id"]).json()
        self.assertIsNone(result["settings"]["resolution"])
        self.assertEqual("parameter_not_applicable", self.submit(request_id="unsupported", resolution="1K").json()["code"])
        capability["parameters"]["aspect_ratio"].pop("default")
        capability["parameters"]["aspect_ratio"]["required"] = True
        response = self.submit(request_id="missing")
        self.assertEqual("parameter_required", response.json()["code"])
        self.assertEqual(["1:1", "3:4"], response.json()["details"]["allowed"])
        self.assertEqual(1, len(self.adapter.calls))

    def test_request_lookup_frozen_settings_and_api_limits(self):
        accepted = self.submit().json()
        original = self.wait(accepted["run_id"]).json()
        lookup = self.client.get("/api/agent/v1/image-runs/by-request", params={"request_id": "test-request"})
        self.assertEqual(accepted["run_id"], lookup.json()["run_id"])
        self.api.image_prompt_maximum = 2
        self.assertEqual(original["run_id"], self.submit().json()["run_id"])
        response = self.submit(request_id="too-long")
        self.assertEqual("prompt_too_long", response.json()["code"])
        self.assertEqual(1, len(self.adapter.calls))
        self.auth.save_agent_settings(self.fixture.admin, {"enabled": False})
        response = self.client.get("/api/agent/v1/image-runs/" + accepted["run_id"])
        self.assertEqual(403, response.status_code)

    def test_request_lookup_preserves_printable_ids_without_path_interpretation(self):
        for request_id in ('.', '..', 'automation/run 1', 'job?one#two', 'percent%2Fvalue'):
            with self.subTest(request_id=request_id):
                accepted = self.submit(request_id=request_id).json()
                lookup = self.client.get('/api/agent/v1/image-runs/by-request', params={'request_id': request_id})
                self.assertEqual(200, lookup.status_code, lookup.text)
                self.assertEqual(accepted['run_id'], lookup.json()['run_id'])

    def test_editor_and_cli_runs_do_not_consume_each_others_concurrency(self):
        from infinite_canvas.canvas_sync import RealtimeSession
        actor = self.fixture.admin
        self.auth.save_agent_settings(actor, {"concurrency": 1})
        self.adapter.block = True
        accepted = self.submit().json()
        session = RealtimeSession(canvas_id="canvas-test", client_id="editor", websocket="editor",
                                  actor_id=actor["id"], access_epoch=0, access_scope={}, revision=0)
        recipe = {
            "kind": "image", "prompt": "editor", "model": {"provider_id": "fixture", "model": "image"},
            "params": {"aspect_ratio": "1:1", "resolution_tier": "1K"}}
        response = self.client.post("/api/agent/v1/canvases/canvas-test/submissions", json={"tasks": [recipe, recipe]},
            headers={"Idempotency-Key": "editor-draft"})
        self.assertEqual(200, response.status_code, response.text)
        response = self.client.post("/api/agent/v1/canvases/canvas-test/run-requests",
            json={"node_ids": response.json()["task_ids"]}, headers={"Idempotency-Key": "editor-run"})
        self.assertEqual(200, response.status_code, response.text)
        editor_requests = response.json()["requests"]
        # CLI work does not occupy the editor's one lease, in either direction.
        self.client.portal.call(self.api.handle_run_message, session, actor,
                                {"type": "agent_run_claim", "id": editor_requests[0]["id"]})
        self.assertTrue(self.fixture.notifier.sent[-1][1]["claimed"])
        another = self.submit(request_id="while-editor-claimed")
        self.assertEqual(200, another.status_code, another.text)
        # Canvas requests still share the existing account preference.
        self.client.portal.call(self.api.handle_run_message, session, actor,
                                {"type": "agent_run_claim", "id": editor_requests[1]["id"]})
        self.assertFalse(self.fixture.notifier.sent[-1][1]["claimed"])
        self.adapter.block = False
        for run_id in (accepted["run_id"], another.json()["run_id"]):
            self.assertEqual("succeeded", self.wait(run_id).json()["status"])

    def test_unconfirmed_capability_uses_existing_catalog_validation_and_request_ids_are_printable(self):
        self.capabilities["image.generate"]["support_state"] = "unknown"
        accepted = self.submit(ratio="3:4", resolution="2K")
        self.assertEqual(200, accepted.status_code, accepted.text)
        self.assertEqual("succeeded", self.wait(accepted.json()["run_id"]).json()["status"])
        response = self.submit(request_id="bad\nrequest")
        self.assertEqual("invalid_request_id", response.json()["code"])
        self.assertEqual(1, len(self.adapter.calls))

    def test_auto_ratio_uses_existing_seven_percent_reference_tolerance(self):
        self.capabilities["image.edit"]["parameters"]["aspect_ratio"]["values"] = ["16:9"]
        image = io.BytesIO()
        Image.new("RGB", (405, 240), "red").save(image, "PNG")
        reference = self.upload("within-tolerance.png", image.getvalue())
        accepted = self.submit(images=[reference], ratio="auto")
        self.assertEqual(200, accepted.status_code, accepted.text)
        result = self.wait(accepted.json()["run_id"]).json()
        self.assertEqual("auto", result["settings"]["requested_ratio"])
        self.assertEqual("16:9", result["settings"]["ratio"])
        self.assertEqual("16:9", self.adapter.calls[0].settings["target_aspect_ratio"])
        source = self.adapter.calls[0].references[0]
        self.assertEqual((405, 240), (source["natural_w"], source["natural_h"]))
        image = io.BytesIO()
        Image.new("RGB", (360, 240), "red").save(image, "PNG")
        reference = self.upload("outside-tolerance.png", image.getvalue())
        rejected = self.submit(request_id="outside-tolerance", images=[reference], ratio="auto")
        self.assertEqual(422, rejected.status_code, rejected.text)
        self.assertEqual("auto_ratio_unavailable", rejected.json()["code"])
        self.assertEqual(1, len(self.adapter.calls))
