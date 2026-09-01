import json
import re
import threading
import unittest

from infinite_canvas.api_settings_transfer import (
    ApiSettingsPackage,
    ApiSettingsTransferError,
    _ApiSettingsStorageAdapter,
)


class PackageHarness:
    def __init__(self, providers=None):
        self.providers = [dict(item) for item in providers or []]
        self.environment = {}
        self.model_order = {"image": [], "video": [], "text": []}
        self.workflows = {}
        self.lock = threading.RLock()

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

    def provider_api_key(self, provider_id):
        special = {
            "comfly": "COMFLY_API_KEY",
            "modelscope": "MODELSCOPE_API_KEY",
            "runninghub": "RUNNINGHUB_API_KEY",
            "volcengine": "ARK_API_KEY",
        }
        key = special.get(provider_id)
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
            mutation_lock=self.lock,
            load_providers=lambda: [
                dict(provider) for provider in self.providers
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
            save_providers=lambda providers: setattr(
                self,
                "providers",
                [dict(provider) for provider in providers],
            ),
            load_model_order=lambda: {
                kind: list(values)
                for kind, values in self.model_order.items()
            },
            save_model_order=lambda order: setattr(
                self,
                "model_order",
                {
                    kind: list(values)
                    for kind, values in order.items()
                },
            ),
            save_runninghub_workflows=lambda workflows: setattr(
                self,
                "workflows",
                dict(workflows),
            ),
            update_env_values=lambda updates: self.environment.update(
                updates
            ),
            reload_env_globals=lambda: None,
            public_providers=lambda: [
                dict(provider) for provider in self.providers
            ],
            transaction_paths=lambda: (),
            environment=self.environment,
        )

    def package(self):
        return ApiSettingsPackage(self.adapter())


class ApiSettingsTransferTests(unittest.TestCase):
    def test_complete_actions_round_trip_without_plaintext_secrets(self):
        source = PackageHarness(
            [
                {
                    "id": "modelscope",
                    "name": "ModelScope",
                    "protocol": "openai",
                }
            ]
        )
        source.environment["MODELSCOPE_API_KEY"] = "secret-token-value"

        encrypted = source.package().export_encrypted(
            "strong-password"
        )

        self.assertNotIn(b"secret-token-value", encrypted)
        self.assertNotIn(b"modelscope", encrypted)
        destination = PackageHarness()
        result = destination.package().import_encrypted(
            encrypted,
            "strong-password",
        )
        self.assertEqual(
            ["modelscope"],
            [provider["id"] for provider in destination.providers],
        )
        self.assertEqual(
            "secret-token-value",
            destination.environment["MODELSCOPE_API_KEY"],
        )
        self.assertEqual(
            [{"id": "modelscope", "name": "ModelScope"}],
            result["added"],
        )

    def test_wrong_password_and_modified_ciphertext_are_rejected(self):
        source = PackageHarness(
            [
                {
                    "id": "modelscope",
                    "name": "ModelScope",
                    "protocol": "openai",
                }
            ]
        )
        encrypted = source.package().export_encrypted(
            "correct-password"
        )
        destination = PackageHarness()

        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "密码错误|已损坏",
        ):
            destination.package().import_encrypted(
                encrypted,
                "wrong-password",
            )

        envelope = json.loads(encrypted)
        ciphertext = envelope["ciphertext"]
        envelope["ciphertext"] = (
            ("A" if ciphertext[0] != "A" else "B") + ciphertext[1:]
        )
        modified = json.dumps(envelope).encode("utf-8")
        with self.assertRaises(ApiSettingsTransferError):
            destination.package().import_encrypted(
                modified,
                "correct-password",
            )

    def test_export_excludes_every_cli_protocol(self):
        source = PackageHarness(
            [
                {"id": "modelscope", "protocol": "openai"},
                {"id": "runninghub", "protocol": "runninghub"},
                {"id": "volcengine", "protocol": "volcengine"},
                {"id": "custom-api", "protocol": "gemini"},
                {"id": "apimart", "protocol": "apimart"},
                {"id": "jimeng", "protocol": "jimeng"},
                {"id": "codex", "protocol": "codex"},
                {"id": "gemini-cli", "protocol": "gemini-cli"},
                {"id": "custom-cli", "protocol": "codex"},
            ]
        )

        encrypted = source.package().export_encrypted(
            "strong-password"
        )
        destination = PackageHarness()
        destination.package().import_encrypted(
            encrypted,
            "strong-password",
        )

        self.assertEqual(
            [
                "modelscope",
                "runninghub",
                "volcengine",
                "custom-api",
                "apimart",
            ],
            [provider["id"] for provider in destination.providers],
        )

    def test_password_is_bounded_at_the_complete_interface(self):
        package = PackageHarness().package()
        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "至少需要 8",
        ):
            package.export_encrypted("short")
        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "不能超过 256",
        ):
            package.export_encrypted("x" * 257)

    def test_malformed_envelope_is_rejected_at_import_interface(self):
        malformed = json.dumps(
            {
                "format": "infinite-canvas-api-settings",
                "version": 1,
                "kdf": [],
                "cipher": [],
                "ciphertext": "",
            }
        ).encode("utf-8")
        with self.assertRaisesRegex(
            ApiSettingsTransferError,
            "不支持的加密参数",
        ):
            PackageHarness().package().import_encrypted(
                malformed,
                "strong-password",
            )


if __name__ == "__main__":
    unittest.main()
