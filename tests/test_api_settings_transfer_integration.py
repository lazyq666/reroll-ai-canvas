import asyncio
import os
import re
import unittest
from io import BytesIO
from threading import RLock

from fastapi import HTTPException, UploadFile

from infinite_canvas.api_settings_transfer import (
    ApiSettingsPackage,
    ApiSettingsTransferError,
    _ApiSettingsStorageAdapter,
    _encrypt_payload,
)
from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
for _key in list(os.environ):
    if _key.startswith("API_PROVIDER_") and _key.endswith("_KEY"):
        os.environ[_key] = ""
for _key in (
    "COMFLY_API_KEY",
    "MODELSCOPE_API_KEY",
    "RUNNINGHUB_API_KEY",
    "RUNNINGHUB_WALLET_API_KEY",
    "ARK_API_KEY",
    "VOLCENGINE_ACCESS_KEY_ID",
    "VOLCENGINE_SECRET_ACCESS_KEY",
):
    os.environ[_key] = ""

import main


class TransferHarness:
    def __init__(self, providers=None):
        self.providers = [dict(item) for item in providers or []]
        self.model_order = {"image": [], "video": [], "text": []}
        self.workflows = {}
        self.environment = {}

    def normalize_provider(self, raw):
        provider = dict(raw)
        provider["id"] = str(provider.get("id") or "").strip().lower()
        provider["name"] = (
            str(provider.get("name") or provider["id"]).strip()
            or provider["id"]
        )
        provider["protocol"] = str(
            provider.get("protocol") or "openai"
        ).strip().lower()
        provider["primary"] = bool(provider.get("primary", False))
        for field in ("image_models", "chat_models", "video_models"):
            provider[field] = list(provider.get(field) or [])
        return provider

    def available_models(self, selected=None):
        selected = self.providers if selected is None else selected
        grouped = {"image": [], "video": [], "text": []}
        fields = {
            "image": "image_models",
            "video": "video_models",
            "text": "chat_models",
        }
        for provider in selected:
            for kind, field in fields.items():
                for model in provider.get(field, []):
                    grouped[kind].append(
                        {
                            "id": f"{provider['id']}:{model}",
                            "provider_id": provider["id"],
                            "model": model,
                        }
                    )
        return grouped

    def save_providers(self, providers):
        self.providers = [dict(item) for item in providers]

    def save_model_order(self, order):
        self.model_order = {
            kind: list(values)
            for kind, values in order.items()
        }

    def update_env_values(self, updates):
        self.environment.update(updates)

    def provider_api_key(self, provider_id):
        key = {
            "comfly": "COMFLY_API_KEY",
            "modelscope": "MODELSCOPE_API_KEY",
            "runninghub": "RUNNINGHUB_API_KEY",
            "volcengine": "ARK_API_KEY",
        }.get(provider_id)
        if key is None:
            normalized = re.sub(
                r"[^A-Za-z0-9]",
                "_",
                provider_id,
            ).upper()
            key = f"API_PROVIDER_{normalized}_KEY"
        return self.environment.get(key, "")

    def adapter(self):
        return _ApiSettingsStorageAdapter(
            mutation_lock=RLock(),
            load_providers=lambda: [
                dict(item) for item in self.providers
            ],
            available_models=self.available_models,
            load_runninghub_workflows=lambda: dict(self.workflows),
            provider_api_key=self.provider_api_key,
            runninghub_wallet_key=lambda: self.environment.get(
                "RUNNINGHUB_WALLET_API_KEY",
                "",
            ),
            volcengine_access_key=lambda: self.environment.get(
                "VOLCENGINE_ACCESS_KEY_ID",
                "",
            ),
            volcengine_secret_key=lambda: self.environment.get(
                "VOLCENGINE_SECRET_ACCESS_KEY",
                "",
            ),
            current_app_version=lambda: "test",
            now_ms=lambda: 123,
            normalize_provider=self.normalize_provider,
            save_providers=self.save_providers,
            load_model_order=lambda: {
                kind: list(values)
                for kind, values in self.model_order.items()
            },
            save_model_order=self.save_model_order,
            save_runninghub_workflows=lambda store: setattr(
                self,
                "workflows",
                dict(store),
            ),
            update_env_values=self.update_env_values,
            reload_env_globals=lambda: None,
            public_providers=lambda: [
                dict(item) for item in self.providers
            ],
            transaction_paths=lambda: (),
            environment=self.environment,
        )


def encrypted_import(payload):
    return _encrypt_payload(payload, "strong-password")


class ApiSettingsTransferIntegrationTests(unittest.TestCase):
    def test_generated_storage_is_fixed_under_selected_assets(self):
        artifacts = main.current_workspace_artifacts()
        self.assertEqual(
            main.generation_output_directory(),
            str(artifacts.generation_outputs),
        )
        self.assertEqual(
            main.generation_input_directory(),
            str(artifacts.generation_inputs),
        )
        self.assertEqual(
            main.local_upload_directory(),
            str(artifacts.local_uploads),
        )

    def test_export_payload_contains_non_cli_providers_and_expected_secrets(self):
        providers = [
            {
                "id": "modelscope",
                "name": "ModelScope",
                "protocol": "openai",
                "image_models": ["image-a"],
                "chat_models": [],
                "video_models": [],
                "enabled": True,
            },
            {
                "id": "runninghub",
                "name": "RunningHub",
                "protocol": "runninghub",
                "image_models": [],
                "chat_models": [],
                "video_models": [],
                "enabled": True,
            },
            {
                "id": "volcengine",
                "name": "Volcengine",
                "protocol": "volcengine",
                "image_models": [],
                "chat_models": [],
                "video_models": ["video-a"],
                "enabled": True,
            },
            {
                "id": "custom-api",
                "name": "Custom",
                "protocol": "gemini",
                "image_models": [],
                "chat_models": ["text-a"],
                "video_models": [],
                "enabled": True,
            },
            {
                "id": "codex",
                "name": "GPT CLI",
                "protocol": "codex",
                "image_models": [],
                "chat_models": ["gpt-image-2"],
                "video_models": [],
                "enabled": True,
            },
        ]
        keys = {
            "modelscope": "ms-secret",
            "runninghub": "rh-secret",
            "volcengine": "ark-secret",
            "custom-api": "custom-secret",
            "codex": "must-not-export",
        }
        harness = TransferHarness(providers)
        harness.workflows = {
            "workflow-a": {"workflowId": "workflow-a"}
        }
        harness.environment.update(
            {
                "MODELSCOPE_API_KEY": keys["modelscope"],
                "RUNNINGHUB_API_KEY": keys["runninghub"],
                "ARK_API_KEY": keys["volcengine"],
                "API_PROVIDER_CUSTOM_API_KEY": keys["custom-api"],
                "RUNNINGHUB_WALLET_API_KEY": "wallet-secret",
                "VOLCENGINE_ACCESS_KEY_ID": "access-secret",
                "VOLCENGINE_SECRET_ACCESS_KEY": "asset-secret",
            }
        )

        package = ApiSettingsPackage(
            harness.adapter()
        ).export_encrypted("strong-password")
        destination = TransferHarness()
        result = ApiSettingsPackage(
            destination.adapter()
        ).import_encrypted(package, "strong-password")

        self.assertEqual(
            ["modelscope", "runninghub", "volcengine", "custom-api"],
            [provider["id"] for provider in destination.providers],
        )
        self.assertNotIn(
            "codex",
            [provider["id"] for provider in destination.providers],
        )
        self.assertEqual(
            "wallet-secret",
            destination.environment["RUNNINGHUB_WALLET_API_KEY"],
        )
        self.assertEqual(
            "access-secret",
            destination.environment["VOLCENGINE_ACCESS_KEY_ID"],
        )
        self.assertEqual(
            "asset-secret",
            destination.environment["VOLCENGINE_SECRET_ACCESS_KEY"],
        )
        self.assertEqual(
            {"workflow-a": {"workflowId": "workflow-a"}},
            destination.workflows,
        )
        self.assertEqual(
            ["modelscope", "runninghub", "volcengine", "custom-api"],
            [item["id"] for item in result["imported"]],
        )

    def test_import_merge_updates_non_cli_and_preserves_cli(self):
        current = [
            {
                "id": "modelscope",
                "name": "Old ModelScope",
                "protocol": "openai",
            },
            {
                "id": "codex",
                "name": "GPT CLI",
                "protocol": "codex",
                "primary": True,
            },
        ]
        imported = [
            {
                "id": "modelscope",
                "name": "New ModelScope",
                "protocol": "openai",
                "primary": True,
            },
            {
                "id": "custom-api",
                "name": "Custom",
                "protocol": "gemini",
                "primary": False,
            },
        ]

        harness = TransferHarness(current)
        payload = {
            "schema": "infinite-canvas.api-settings",
            "version": 1,
            "providers": imported,
        }
        ApiSettingsPackage(harness.adapter()).import_encrypted(
            encrypted_import(payload),
            "strong-password",
        )
        merged = harness.providers

        self.assertEqual(
            ["modelscope", "codex", "custom-api"],
            [provider["id"] for provider in merged],
        )
        self.assertEqual("New ModelScope", merged[0]["name"])
        self.assertFalse(merged[0]["primary"])
        self.assertEqual("GPT CLI", merged[1]["name"])
        self.assertTrue(merged[1]["primary"])

    def test_secret_import_allowlist_does_not_clear_or_import_cli(self):
        providers = [
            {"id": "modelscope", "name": "ModelScope", "protocol": "openai"},
            {"id": "runninghub", "name": "RunningHub", "protocol": "runninghub"},
            {"id": "volcengine", "name": "Volcengine", "protocol": "volcengine"},
        ]
        harness = TransferHarness()
        ApiSettingsPackage(harness.adapter()).import_encrypted(
            encrypted_import(
                {
                    "schema": "infinite-canvas.api-settings",
                    "version": 1,
                    "providers": providers,
                    "secrets": {
                        "modelscope": {"api_key": "ms-secret"},
                        "runninghub": {
                            "api_key": "rh-secret",
                            "wallet_api_key": "wallet-secret",
                        },
                        "volcengine": {
                            "api_key": "ark-secret",
                            "access_key_id": "access-secret",
                            "secret_access_key": "asset-secret",
                        },
                        "codex": {"api_key": "cli-secret"},
                        "unknown": {"api_key": "unknown-secret"},
                    },
                }
            ),
            "strong-password",
        )
        updates = harness.environment

        self.assertEqual("ms-secret", updates["MODELSCOPE_API_KEY"])
        self.assertEqual("rh-secret", updates["RUNNINGHUB_API_KEY"])
        self.assertEqual(
            "wallet-secret", updates["RUNNINGHUB_WALLET_API_KEY"]
        )
        self.assertEqual("ark-secret", updates["ARK_API_KEY"])
        self.assertEqual(
            "access-secret", updates["VOLCENGINE_ACCESS_KEY_ID"]
        )
        self.assertEqual(
            "asset-secret", updates["VOLCENGINE_SECRET_ACCESS_KEY"]
        )
        self.assertNotIn("API_PROVIDER_CODEX_KEY", updates)
        self.assertNotIn("API_PROVIDER_UNKNOWN_KEY", updates)

    def test_import_cannot_replace_cli_provider_by_reusing_its_id(self):
        current = [
            {
                "id": "codex",
                "name": "GPT CLI",
                "protocol": "codex",
                "primary": True,
            }
        ]
        imported = [
            {
                "id": "codex",
                "name": "Pretend API",
                "protocol": "openai",
                "primary": False,
            }
        ]

        harness = TransferHarness(current)
        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "CLI 平台 ID 冲突",
        ):
            ApiSettingsPackage(harness.adapter()).import_encrypted(
                encrypted_import(
                    {
                        "schema": "infinite-canvas.api-settings",
                        "version": 1,
                        "providers": imported,
                    }
                ),
                "strong-password",
            )

        self.assertEqual(current, harness.providers)

    def test_secret_import_rejects_control_characters(self):
        harness = TransferHarness()
        with self.assertRaises(ApiSettingsTransferError):
            ApiSettingsPackage(harness.adapter()).import_encrypted(
                encrypted_import(
                    {
                        "schema": "infinite-canvas.api-settings",
                        "version": 1,
                        "providers": [
                            {
                                "id": "modelscope",
                                "name": "ModelScope",
                                "protocol": "openai",
                            }
                        ],
                        "secrets": {
                            "modelscope": {
                                "api_key": "first-line\nsecond-line"
                            }
                        },
                    }
                ),
                "strong-password",
            )

    def test_import_replaces_workflows_and_validates_model_order(self):
        harness = TransferHarness(
            [
                {
                    "id": "local-api",
                    "name": "Local API",
                    "protocol": "openai",
                    "image_models": ["local-image"],
                }
            ]
        )
        harness.model_order["image"] = ["local-api:local-image"]
        harness.workflows = {"old": {"workflowId": "old"}}
        harness.environment["RUNNINGHUB_API_KEY"] = "keep-existing-key"
        payload = {
            "schema": "infinite-canvas.api-settings",
            "version": 1,
            "providers": [
                {
                    "id": "runninghub",
                    "name": "RunningHub",
                    "protocol": "runninghub",
                    "image_models": ["rh-a", "rh-b"],
                }
            ],
            "model_order": {
                "image": [
                    {
                        "provider_id": "runninghub",
                        "model": "rh-b",
                    },
                    {
                        "provider_id": "runninghub",
                        "model": "missing",
                    },
                    {
                        "provider_id": "unknown",
                        "model": "ignored",
                    },
                ]
            },
            "runninghub_workflows": {
                "new": {"workflowId": "new"}
            },
            "secrets": {"runninghub": {"api_key": ""}},
        }

        ApiSettingsPackage(harness.adapter()).import_encrypted(
            encrypted_import(payload),
            "strong-password",
        )

        self.assertEqual(
            {"new": {"workflowId": "new"}},
            harness.workflows,
        )
        self.assertEqual(
            [
                "runninghub:rh-b",
                "local-api:local-image",
            ],
            harness.model_order["image"],
        )
        self.assertEqual(
            "keep-existing-key",
            harness.environment["RUNNINGHUB_API_KEY"],
        )

    def test_duplicate_imported_provider_id_is_rejected(self):
        harness = TransferHarness()
        provider = {
            "id": "same-api",
            "name": "Same API",
            "protocol": "openai",
        }
        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "ID 重复",
        ):
            ApiSettingsPackage(harness.adapter()).import_encrypted(
                encrypted_import(
                    {
                        "schema": "infinite-canvas.api-settings",
                        "version": 1,
                        "providers": [provider, dict(provider)],
                    }
                ),
                "strong-password",
            )

    def test_import_result_distinguishes_added_and_updated_providers(self):
        current = [
            {
                "id": "existing-api",
                "name": "Existing API",
                "protocol": "openai",
            }
        ]
        payload = {
            "schema": "infinite-canvas.api-settings",
            "version": 1,
            "providers": [
                {
                    "id": "existing-api",
                    "name": "Existing API Updated",
                    "protocol": "openai",
                },
                {
                    "id": "new-api",
                    "name": "New API",
                    "protocol": "gemini",
                },
            ],
        }
        harness = TransferHarness(current)
        result = ApiSettingsPackage(harness.adapter()).import_encrypted(
            encrypted_import(payload),
            "strong-password",
        )

        self.assertEqual(
            [{"id": "new-api", "name": "New API"}],
            result["added"],
        )
        self.assertEqual(
            [{"id": "existing-api", "name": "Existing API Updated"}],
            result["updated"],
        )
        self.assertEqual(
            ["existing-api", "new-api"],
            [provider["id"] for provider in harness.providers],
        )

    def test_http_adapter_preserves_download_and_error_contracts(self):
        response = asyncio.run(
            main.export_encrypted_api_settings(
                main.ApiSettingsEncryptedExportPayload(
                    password="strong-password"
                )
            )
        )

        self.assertEqual(
            "application/vnd.infinite-canvas.api-settings",
            response.media_type,
        )
        self.assertEqual("no-store", response.headers["cache-control"])
        self.assertRegex(
            response.headers["content-disposition"],
            (
                r'^attachment; filename="'
                r'infinite-canvas-api-settings-\d{8}-\d{6}\.icapi"$'
            ),
        )
        upload = UploadFile(
            filename="settings.icapi",
            file=BytesIO(response.body),
        )
        imported = asyncio.run(
            main.import_encrypted_api_settings(
                file=upload,
                password="strong-password",
            )
        )
        self.assertEqual(
            {"imported", "added", "updated", "providers"},
            set(imported),
        )

        bad_upload = UploadFile(
            filename="settings.icapi",
            file=BytesIO(response.body),
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                main.import_encrypted_api_settings(
                    file=bad_upload,
                    password="wrong-password",
                )
            )
        self.assertEqual(400, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
