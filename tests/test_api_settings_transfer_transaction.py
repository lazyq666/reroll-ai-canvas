import json
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path

from infinite_canvas.api_settings_transfer import (
    ApiSettingsPackage,
    _ApiSettingsStorageAdapter,
)


class InjectedWriteFailure(RuntimeError):
    pass


class TransactionalHarness:
    def __init__(self, root: str):
        self.root = Path(root)
        self.lock = threading.RLock()
        self.environment = {"RUNNINGHUB_API_KEY": "before-secret"}
        self.fail_at = ""
        self.failed_once = False
        self.pause_after_provider_write = None
        self.allow_provider_failure = None
        self.paths = {
            "providers": self.root / "api-providers.json",
            "connections": self.root / "provider-connections.json",
            "models": self.root / "available-models.json",
            "workflows": self.root / "runninghub-workflows.json",
            "env": self.root / "api.env",
        }
        self._write_json(
            "providers",
            [
                {
                    "id": "existing-api",
                    "name": "Existing API",
                    "protocol": "openai",
                    "image_models": ["existing-image"],
                }
            ],
        )
        self._write_json(
            "connections",
            {"version": 1, "connections": [{"id": "existing-api"}]},
        )
        self._write_json(
            "models",
            {
                "image": ["existing-api:existing-image"],
                "video": [],
                "text": [],
            },
        )
        self._write_json(
            "workflows",
            {"old": {"workflowId": "old"}},
        )
        self.paths["env"].write_bytes(
            b"RUNNINGHUB_API_KEY=before-secret\n"
        )
        self.paths["env"].chmod(0o600)

    def _write_json(self, name, payload):
        self.paths[name].write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _read_json(self, name):
        return json.loads(
            self.paths[name].read_text(encoding="utf-8")
        )

    def _fail(self, label):
        if self.fail_at == label:
            raise InjectedWriteFailure(label)

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

    def load_providers(self):
        return self._read_json("providers")

    def save_providers(self, providers):
        self._write_json(
            "connections",
            {
                "version": 1,
                "connections": [
                    {"id": provider["id"]}
                    for provider in providers
                ],
            },
        )
        self._fail("connections")
        self._write_json("providers", providers)
        if self.pause_after_provider_write is not None:
            self.pause_after_provider_write.set()
            self.allow_provider_failure.wait(timeout=5)
        self._fail("providers")

    def available_models(self, selected=None):
        selected = self.load_providers() if selected is None else selected
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

    def save_model_order(self, order):
        self._write_json("models", order)
        self._fail("models")

    def save_workflows(self, workflows):
        self._write_json("workflows", workflows)
        self._fail("workflows")

    def update_env_values(self, updates):
        self.environment.update(updates)
        lines = [
            f"{key}={value}"
            for key, value in sorted(self.environment.items())
        ]
        self.paths["env"].unlink()
        self.paths["env"].write_text(
            "\n".join(lines) + "\n",
            encoding="utf-8",
        )
        self.paths["env"].chmod(0o644)
        self._fail("env")

    def reload_env_globals(self):
        if self.fail_at == "reload" and not self.failed_once:
            self.failed_once = True
            raise InjectedWriteFailure("reload")

    def provider_api_key(self, provider_id):
        if provider_id == "runninghub":
            key = "RUNNINGHUB_API_KEY"
        else:
            normalized = re.sub(
                r"[^A-Za-z0-9]",
                "_",
                provider_id,
            ).upper()
            key = f"API_PROVIDER_{normalized}_KEY"
        return self.environment.get(key, "")

    def public_providers(self):
        self._fail("public")
        return self.load_providers()

    def adapter(self):
        return _ApiSettingsStorageAdapter(
            mutation_lock=self.lock,
            load_providers=self.load_providers,
            available_models=self.available_models,
            load_runninghub_workflows=lambda: self._read_json(
                "workflows"
            ),
            provider_api_key=self.provider_api_key,
            runninghub_wallet_key=lambda: "",
            volcengine_access_key=lambda: "",
            volcengine_secret_key=lambda: "",
            current_app_version=lambda: "test",
            now_ms=lambda: 123,
            normalize_provider=self.normalize_provider,
            save_providers=self.save_providers,
            load_model_order=lambda: self._read_json("models"),
            save_model_order=self.save_model_order,
            save_runninghub_workflows=self.save_workflows,
            update_env_values=self.update_env_values,
            reload_env_globals=self.reload_env_globals,
            public_providers=self.public_providers,
            transaction_paths=lambda: tuple(
                str(path) for path in self.paths.values()
            ),
            environment=self.environment,
        )

    def before_state(self):
        return {
            "files": {
                name: path.read_bytes()
                for name, path in self.paths.items()
            },
            "modes": {
                name: path.stat().st_mode & 0o777
                for name, path in self.paths.items()
            },
            "environment": dict(self.environment),
        }

    def assert_restored(self, testcase, before):
        testcase.assertEqual(
            before["files"],
            {
                name: path.read_bytes()
                for name, path in self.paths.items()
            },
        )
        testcase.assertEqual(
            before["environment"],
            dict(self.environment),
        )
        testcase.assertEqual(
            before["modes"],
            {
                name: path.stat().st_mode & 0o777
                for name, path in self.paths.items()
            },
        )

    def ordinary_provider_save(self, providers):
        with self.lock:
            self._write_json("providers", providers)


def import_package_bytes():
    providers = [
        {
            "id": "runninghub",
            "name": "RunningHub",
            "protocol": "runninghub",
            "image_models": ["rh-image"],
        }
    ]
    adapter = _ApiSettingsStorageAdapter(
        mutation_lock=threading.RLock(),
        load_providers=lambda: providers,
        available_models=lambda selected: {
            "image": [
                {
                    "id": "runninghub:rh-image",
                    "provider_id": "runninghub",
                    "model": "rh-image",
                }
            ],
            "video": [],
            "text": [],
        },
        load_runninghub_workflows=lambda: {
            "new": {"workflowId": "new"}
        },
        provider_api_key=lambda provider_id: (
            "after-secret" if provider_id == "runninghub" else ""
        ),
        runninghub_wallet_key=lambda: "",
        volcengine_access_key=lambda: "",
        volcengine_secret_key=lambda: "",
        current_app_version=lambda: "test",
        now_ms=lambda: 123,
    )
    return ApiSettingsPackage(adapter).export_encrypted(
        "strong-password"
    )


class ApiSettingsTransactionTests(unittest.TestCase):
    def test_every_write_failure_restores_files_and_process_environment(self):
        for failure in (
            "connections",
            "providers",
            "env",
            "reload",
            "workflows",
            "models",
            "public",
        ):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                harness = TransactionalHarness(root)
                before = harness.before_state()
                harness.fail_at = failure

                with self.assertRaises(InjectedWriteFailure):
                    ApiSettingsPackage(
                        harness.adapter()
                    ).import_encrypted(
                        import_package_bytes(),
                        "strong-password",
                    )

                harness.assert_restored(self, before)

    def test_failed_import_cannot_overwrite_a_concurrent_save(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TransactionalHarness(root)
            harness.fail_at = "providers"
            harness.pause_after_provider_write = threading.Event()
            harness.allow_provider_failure = threading.Event()
            import_errors = []
            external_provider = [
                {
                    "id": "concurrent-api",
                    "name": "Concurrent API",
                    "protocol": "openai",
                }
            ]

            def run_import():
                try:
                    ApiSettingsPackage(
                        harness.adapter()
                    ).import_encrypted(
                        import_package_bytes(),
                        "strong-password",
                    )
                except Exception as exc:
                    import_errors.append(exc)

            import_thread = threading.Thread(target=run_import)
            import_thread.start()
            self.assertTrue(
                harness.pause_after_provider_write.wait(timeout=5)
            )

            save_started = threading.Event()

            def run_save():
                save_started.set()
                harness.ordinary_provider_save(external_provider)

            save_thread = threading.Thread(target=run_save)
            save_thread.start()
            self.assertTrue(save_started.wait(timeout=5))
            harness.allow_provider_failure.set()
            import_thread.join(timeout=5)
            save_thread.join(timeout=5)

            self.assertFalse(import_thread.is_alive())
            self.assertFalse(save_thread.is_alive())
            self.assertEqual(1, len(import_errors))
            self.assertIsInstance(
                import_errors[0],
                InjectedWriteFailure,
            )
            self.assertEqual(
                external_provider,
                harness.load_providers(),
            )


if __name__ == "__main__":
    unittest.main()
