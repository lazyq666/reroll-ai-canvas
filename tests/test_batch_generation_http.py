import asyncio
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient

from tests.runtime_env import ensure_test_workspace, import_fresh_main

ensure_test_workspace()

import main
from infinite_canvas.batch_generation import BatchGeneration


class FakeGenerationRuns:
    def __init__(self):
        self.count = 0
        self.submissions = []

    async def submit(self, task, *, owner, batch_id):
        self.count += 1
        self.submissions.append((task, owner, batch_id))
        return {
            "run_id": f"fake-run-{self.count}",
            "status": "succeeded",
            "outputs": [f"/assets/output/{self.count}.png"],
        }


class BatchGenerationHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global main
        main = import_fresh_main()

    def test_server_rejects_batch_options_outside_model_capability_intersection(self):
        providers = [
            {
                "id": "alpha",
                "image_capabilities": {
                    "one": {
                        "aspect_ratios": ["1:1", "16:9"],
                        "resolution_tiers": ["1K", "2K"],
                        "default_resolution_tier": "1K",
                    }
                },
            },
            {
                "id": "beta",
                "image_capabilities": {
                    "two": {
                        "aspect_ratios": ["1:1"],
                        "resolution_tiers": ["1K"],
                        "default_resolution_tier": "1K",
                    }
                },
            },
        ]
        payload = main.BatchGenerationPayload(
            models=[
                {"provider_id": "alpha", "model": "one"},
                {"provider_id": "beta", "model": "two"},
            ],
            ratios=["16:9"],
            settings={"resolution": "1k"},
        )
        with mock.patch.object(main, "load_api_providers", return_value=providers):
            with self.assertRaisesRegex(Exception, "不共同支持当前画幅"):
                main.validated_batch_capability_payload(payload)

    def test_http_rejects_long_dreamina_text_to_image_prompt_before_submit(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeGenerationRuns()
            facade = BatchGeneration(
                Path(temporary) / "batches.sqlite3",
                submit=fake.submit,
                task_validator=main.validate_batch_generation_task,
            )
            payload = {
                "name": "即梦超长提示词",
                "prompt_modules": [
                    {"name": "画面", "options": ["镜" * 1501]},
                ],
                "models": ["5.0"],
                "ratios": ["9:16"],
                "settings": {
                    "provider_id": "jimeng",
                    "outputs_per_run": 1,
                },
            }
            suffix = uuid.uuid4().hex[:8]
            if not any(
                user.get("role") == "admin"
                for user in main.AUTH_SYSTEM.list_users()
            ):
                main.AUTH_SYSTEM.create_user(
                    username=f"admin-{suffix}",
                    password="admin-password",
                    role="admin",
                )
            main.AUTH_SYSTEM.create_user(
                username=f"designer-{suffix}",
                password="designer-password",
                role="designer",
            )

            with (
                mock.patch.object(main, "_BATCH_GENERATION", facade),
                mock.patch.object(main, "WORKSPACE_CONFIGURED", True),
                TestClient(main.app) as client,
            ):
                login = client.post("/api/auth/login", json={
                    "username": f"designer-{suffix}",
                    "password": "designer-password",
                })
                self.assertEqual(200, login.status_code)

                preview = client.post(
                    "/api/batch-generation/preview", json=payload
                )
                self.assertEqual(400, preview.status_code)
                self.assertIn("1501", preview.json()["detail"])
                self.assertIn("1500", preview.json()["detail"])

                started = client.post(
                    "/api/batch-generation/batches", json=payload
                )
                self.assertEqual(400, started.status_code)
                self.assertEqual(0, fake.count)

    def test_batch_task_maps_submission_and_output_counts_to_generation_run(self):
        class CapturingRuns:
            def __init__(self):
                self.request = None

            async def start(self, request, **_kwargs):
                self.request = request
                return SimpleNamespace(id="run-counts", status="running")

        runs = CapturingRuns()
        with mock.patch.object(main, "_GENERATION_RUNS", runs):
            result = asyncio.run(main._submit_batch_generation_task(
                {
                    "index": 0,
                    "batch_name": "角色探索",
                    "prompt": "狐狸",
                    "model": "fake-image",
                    "model_name": "Fake Image 展示名",
                    "ratio": "1:1",
                    "outputs_per_submission": 2,
                    "submissions": 3,
                    "settings": {"provider_id": "fake"},
                },
                owner="designer-1",
                batch_id="batch-counts",
            ))

        self.assertEqual(2, runs.request.count)
        self.assertEqual(3, runs.request.submission_count)
        self.assertEqual(
            "角色探索",
            runs.request.effect_context["batch_name"],
        )
        self.assertEqual(0, runs.request.effect_context["task_index"])
        self.assertEqual(
            "Fake Image 展示名",
            runs.request.effect_context["model_name"],
        )
        self.assertEqual("run-counts", result["run_id"])

    def test_real_http_preview_start_and_owner_hidden_query(self):
        with tempfile.TemporaryDirectory() as temporary:
            fake = FakeGenerationRuns()
            facade = BatchGeneration(
                Path(temporary) / "batches.sqlite3", submit=fake.submit
            )
            payload = {
                "name": "",
                "name_prefix": "角色系列_",
                "prompt_modules": [
                    {"name": "主体", "options": ["狐狸", "雪豹"]},
                    {"name": "场景", "options": ["森林", "雪山"]},
                ],
                "models": ["fake-v1"],
                "ratios": ["1:1"],
                "settings": {"provider_id": "fake", "outputs_per_run": 1},
                "excluded": [2],
            }
            suffix = uuid.uuid4().hex[:8]
            if not any(
                user.get("role") == "admin"
                for user in main.AUTH_SYSTEM.list_users()
            ):
                main.AUTH_SYSTEM.create_user(
                    username=f"admin-{suffix}",
                    password="admin-password",
                    role="admin",
                )
            first = main.AUTH_SYSTEM.create_user(
                username=f"designer-{suffix}-1",
                password="designer-password",
                role="designer",
            )
            main.AUTH_SYSTEM.create_user(
                username=f"designer-{suffix}-2",
                password="designer-password",
                role="designer",
            )
            with (
                mock.patch.object(main, "_BATCH_GENERATION", facade),
                mock.patch.object(main, "WORKSPACE_CONFIGURED", True),
                TestClient(main.app) as client,
            ):
                login = client.post("/api/auth/login", json={
                    "username": f"designer-{suffix}-1",
                    "password": "designer-password",
                })
                self.assertEqual(200, login.status_code)
                preview = client.post(
                    "/api/batch-generation/preview", json=payload
                )
                self.assertEqual(200, preview.status_code)
                self.assertEqual(4, preview.json()["generation_run_count"])

                started = client.post(
                    "/api/batch-generation/batches", json=payload
                )
                self.assertEqual(200, started.status_code)
                batch_id = started.json()["id"]
                self.assertEqual("completed", started.json()["status"])
                self.assertEqual(3, fake.count)

                detail = client.get(
                    f"/api/batch-generation/batches/{batch_id}"
                )
                self.assertEqual(200, detail.status_code)
                self.assertTrue(
                    detail.json()["name"].startswith("角色系列_"),
                    detail.json()["name"],
                )
                self.assertEqual(
                    "角色系列_",
                    detail.json()["snapshot"]["name_prefix"],
                )
                self.assertEqual(
                    {detail.json()["name"]},
                    {task["batch_name"] for task, _, _ in fake.submissions},
                )

                history = client.get("/api/batch-generation/history")
                self.assertEqual(200, history.status_code)
                self.assertEqual([batch_id], [
                    batch["id"] for batch in history.json()["batches"]
                ])

                client.post("/api/auth/logout")
                second_login = client.post("/api/auth/login", json={
                    "username": f"designer-{suffix}-2",
                    "password": "designer-password",
                })
                self.assertEqual(200, second_login.status_code)
                hidden = client.get(
                    f"/api/batch-generation/batches/{batch_id}"
                )
                self.assertEqual(404, hidden.status_code)
                self.assertEqual(first["id"], started.json()["owner"])


if __name__ == "__main__":
    unittest.main()
