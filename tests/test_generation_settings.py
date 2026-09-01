import json
import shutil
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.generation_settings import GenerationSettingsService


class GenerationSettingsServiceTests(unittest.TestCase):
    def test_save_splits_shared_choices_from_device_connection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "workspace" / "data" / "api_providers.json"
            local = root / "device" / "provider-connections.json"
            service = GenerationSettingsService(shared, local)
            provider = {
                "id": "studio",
                "name": "Studio Models",
                "protocol": "openai",
                "primary": True,
                "enabled": True,
                "image_models": ["image-v2"],
                "chat_models": ["chat-v3"],
                "video_models": [],
                "model_names": {"image-v2": "Team Image"},
                "ms_loras": [
                    {
                        "id": "team-style",
                        "target_model": "image-v2",
                        "strength": 0.7,
                    }
                ],
                "rh_workflows": [
                    {
                        "id": "workflow-1",
                        "workflowJson": {"1": {"class_type": "SaveImage"}},
                    }
                ],
                "base_url": "http://127.0.0.1:8188",
                "image_request_mode": "openai",
                "image_generation_endpoint": "/v1/images",
                "volcengine_region": "cn-local",
            }

            service.save([provider])

            shared_payload = json.loads(shared.read_text(encoding="utf-8"))
            local_payload = json.loads(local.read_text(encoding="utf-8"))
            self.assertEqual(["image-v2"], shared_payload[0]["image_models"])
            self.assertEqual(
                "Team Image",
                shared_payload[0]["model_names"]["image-v2"],
            )
            self.assertEqual(
                0.7,
                shared_payload[0]["ms_loras"][0]["strength"],
            )
            self.assertEqual(
                "SaveImage",
                shared_payload[0]["rh_workflows"][0][
                    "workflowJson"
                ]["1"]["class_type"],
            )
            self.assertNotIn("base_url", shared_payload[0])
            self.assertNotIn("image_generation_endpoint", shared_payload[0])
            self.assertNotIn("volcengine_region", shared_payload[0])
            self.assertEqual(
                "http://127.0.0.1:8188",
                local_payload["connections"][0]["base_url"],
            )
            self.assertEqual(provider, service.load()[0])

    def test_migration_sanitizes_mixed_workspace_file_and_quarantines_unknowns_locally(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "workspace" / "data" / "api_providers.json"
            local = root / "device" / "provider-connections.json"
            shared.parent.mkdir(parents=True)
            secret = "reusable-secret-value"
            nested_secret = "nested-reusable-secret"
            device_endpoint = "http://127.0.0.1:8188/internal"
            shared.write_text(
                json.dumps(
                    [
                        {
                            "id": "legacy",
                            "name": "Legacy",
                            "protocol": "openai",
                            "image_models": ["image-a"],
                            "base_url": "http://localhost:8080",
                            "api_key": secret,
                            "mystery_setting": "keep-local",
                            "rh_workflows": [
                                {
                                    "id": "workflow-1",
                                    "raw": {
                                        "access_token": nested_secret,
                                        "url": device_endpoint,
                                    },
                                }
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )
            service = GenerationSettingsService(shared, local)

            loaded = service.load()

            workspace_text = shared.read_text(encoding="utf-8")
            local_payload = json.loads(local.read_text(encoding="utf-8"))
            self.assertNotIn(secret, workspace_text)
            self.assertNotIn(nested_secret, workspace_text)
            self.assertNotIn(device_endpoint, workspace_text)
            self.assertNotIn("base_url", workspace_text)
            self.assertNotIn("mystery_setting", workspace_text)
            self.assertEqual(
                "http://localhost:8080",
                loaded[0]["base_url"],
            )
            self.assertEqual(
                secret,
                local_payload["unclassified"]["legacy"]["api_key"],
            )
            self.assertEqual(
                "keep-local",
                local_payload["unclassified"]["legacy"][
                    "mystery_setting"
                ],
            )
            local_text = local.read_text(encoding="utf-8")
            self.assertIn(nested_secret, local_text)
            self.assertIn(device_endpoint, local_text)

    def test_workspace_copy_keeps_shared_choices_and_uses_current_device_connection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first_shared = (
                root / "workspace-a" / "data" / "api_providers.json"
            )
            second_shared = (
                root / "workspace-b" / "data" / "api_providers.json"
            )
            local = root / "device" / "provider-connections.json"
            first = GenerationSettingsService(first_shared, local)
            first.save(
                [
                    {
                        "id": "team",
                        "name": "Team Provider",
                        "protocol": "openai",
                        "primary": True,
                        "image_models": ["shared-image"],
                        "model_names": {"shared-image": "Shared Alias"},
                        "base_url": "http://this-device.test/v1",
                    }
                ]
            )
            second_shared.parent.mkdir(parents=True)
            shutil.copy2(first_shared, second_shared)

            moved = GenerationSettingsService(second_shared, local).load()[0]

            self.assertEqual(["shared-image"], moved["image_models"])
            self.assertEqual(
                "Shared Alias",
                moved["model_names"]["shared-image"],
            )
            self.assertEqual(
                "http://this-device.test/v1",
                moved["base_url"],
            )
            copied_files = b"".join(
                path.read_bytes()
                for path in (root / "workspace-b").rglob("*")
                if path.is_file()
            )
            self.assertNotIn(b"this-device.test", copied_files)

    def test_device_connections_for_other_workspaces_survive_save(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            local = root / "device" / "provider-connections.json"
            first = GenerationSettingsService(
                root / "workspace-a" / "api_providers.json",
                local,
            )
            second = GenerationSettingsService(
                root / "workspace-b" / "api_providers.json",
                local,
            )
            first.save(
                [{"id": "alpha", "name": "Alpha", "base_url": "https://alpha"}]
            )
            second.save(
                [{"id": "beta", "name": "Beta", "base_url": "https://beta"}]
            )

            connections = {
                item["id"]: item["base_url"]
                for item in json.loads(
                    local.read_text(encoding="utf-8")
                )["connections"]
            }

            self.assertEqual(
                {"alpha": "https://alpha", "beta": "https://beta"},
                connections,
            )


if __name__ == "__main__":
    unittest.main()
