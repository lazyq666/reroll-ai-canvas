import copy
import json
import os
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
import main
from infinite_canvas.api_settings_transfer import ApiSettingsTransferError, _decrypt_payload, _encrypt_payload
from infinite_canvas.model_capability_workbench import ModelCapabilityWorkbench
from infinite_canvas.model_capabilities import ModelCapabilityCatalog
from infinite_canvas.image_capabilities import ImageCapabilityRegistry
from infinite_canvas.video_capabilities import VideoCapabilityRegistry


class CompleteApiSettingsBackupTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.paths = {
            "api_providers_file": "providers.json", "available_models_file": "models.json",
            "runninghub_workflow_file": "workflows.json",
        }
        for function, name in self.paths.items():
            self.stack.enter_context(patch.object(main, function, return_value=str(self.root / name)))
        for name, filename in (("API_ENV_FILE", "api.env"), ("PROVIDER_CONNECTIONS_FILE", "connections.json")):
            self.stack.enter_context(patch.object(main, name, str(self.root / filename)))
        self.stack.enter_context(patch.dict(os.environ))
        self.stack.enter_context(patch.object(main, "retire_legacy_shared_generation_env"))
        self.stack.enter_context(patch.object(main, "reload_env_globals"))
        self.stack.enter_context(patch.object(main, "provider_env_key_value", return_value="backup-test-key"))
        self.workbench = ModelCapabilityWorkbench(self.root / "capabilities.json")
        resources = Path(main.BASE_DIR) / "resources"
        self.catalog = ModelCapabilityCatalog(
            image_registry=ImageCapabilityRegistry(resources / "image-model-capabilities.json"),
            video_registry=VideoCapabilityRegistry(resources / "video-model-capabilities.json"),
            text_path=resources / "text-model-capabilities.json",
            revision_paths=[resources / f"{kind}-model-capabilities.json" for kind in ("image", "video", "text")],
            published_path=self.workbench.path,
        )
        self.stack.enter_context(patch.object(main, "MODEL_CAPABILITY_WORKBENCH", self.workbench))
        self.stack.enter_context(patch.object(main, "MODEL_CAPABILITY_CATALOG", self.catalog))
        main._configured_api_settings_package.cache_clear()
        self.addCleanup(main._configured_api_settings_package.cache_clear)
        self.package = main._configured_api_settings_package()
        self.providers = [
            {"id": "alpha", "name": "Alpha", "protocol": "openai", "base_url": "https://example.com/v1",
             "image_models": ["image-a", "image-b"], "model_names": {"image-a": "团队主力"}},
            {"id": "disabled", "name": "Disabled", "protocol": "openai", "enabled": False,
             "video_models": ["video-a"], "model_names": {"video-a": "停用模型"}},
            {"id": "codex", "name": "GPT CLI", "protocol": "codex", "primary": True,
             "image_models": ["gpt-image-2"], "chat_models": ["gpt-5.5"],
             "model_names": {"gpt-image-2": "本机生图"}, "executable_path": "/private/test/codex"},
        ]
        main.save_api_providers([main.normalize_provider(p) for p in self.providers])
        main.save_imported_model_settings({
            "image": [main.available_model_id("alpha", "image-b"), main.available_model_id("alpha", "image-a")],
            "video": [main.available_model_id("disabled", "video-a")], "text": [],
            "hidden": {"image": [main.available_model_id("alpha", "image-a")],
                       "video": [main.available_model_id("disabled", "video-a")], "text": []},
        })

    def export(self):
        return self.package.export_encrypted("test-password", complete=True)

    def files(self):
        return {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file()}

    def test_complete_round_trip_preserves_all_models_and_effective_capabilities(self):
        records = _decrypt_payload(self.export(), "test-password")["capabilities"]
        configured = next(r for r in records if r["provider_id"] == "alpha"
                          and r["model_id"] == "image-a" and r["operation"] == "image.generate")
        configured["capability"]["inputs"]["image"]["maximum"] = 50
        self.workbench.publish_manual_capabilities(
            records=[configured], model_name="团队主力", actor_id="test-admin",
            active_catalog_revision=self.catalog.revision, activate=self.catalog.refresh,
        )
        package = self.export()
        original = _decrypt_payload(package, "test-password")
        self.assertEqual(2, original["version"])
        self.assertEqual(3, len(original["providers"]))
        backed_up = next(r for r in original["capabilities"] if r["provider_id"] == "alpha"
                         and r["model_id"] == "image-a" and r["operation"] == "image.generate")
        self.assertEqual(50, backed_up["capability"]["inputs"]["image"]["maximum"])
        self.assertEqual(20, self.catalog.resolve("alpha", "image-a", "image.generate")["inputs"]["image"]["maximum"])
        self.assertNotIn("codex", original["secrets"])
        self.assertNotIn(b"backup-test-key", package)
        cli = next(p for p in original["providers"] if p["id"] == "codex")
        self.assertNotIn("base_url", cli)
        self.assertNotIn("executable_path", cli)
        # A different installation has one unrelated provider, which survives merge.
        main.save_api_providers([main.normalize_provider({
            "id": "local", "name": "Local", "image_models": ["local-image"]
        })])
        main.save_imported_model_settings({"hidden": {}})
        before = self.files()
        preview = self.package.preview_encrypted(package, "test-password")
        self.assertEqual(3, preview["added"])
        self.assertEqual(5, preview["models"])
        self.assertEqual(before, self.files())
        self.package.import_encrypted(package, "test-password")
        restored = _decrypt_payload(self.export(), "test-password")
        by_id = {p["id"]: p for p in restored["providers"]}
        self.assertIn("local", by_id)
        self.assertEqual("团队主力", by_id["alpha"]["model_names"]["image-a"])
        self.assertEqual("本机生图", by_id["codex"]["model_names"]["gpt-image-2"])
        self.assertFalse(by_id["disabled"]["enabled"])
        for kind in original["model_order"]:
            self.assertEqual(original["model_order"][kind], [e for e in restored["model_order"][kind] if e["provider_id"] != "local"])
        self.assertEqual(original["capabilities"], [e for e in restored["capabilities"] if e["provider_id"] != "local"])

    def test_invalid_capabilities_missing_models_and_protocol_conflicts_do_not_write(self):
        original = _decrypt_payload(self.export(), "test-password")
        for failure in ("capability", "missing", "protocol"):
            payload = copy.deepcopy(original)
            if failure == "capability":
                payload["capabilities"][0]["capability"]["support_state"] = "invalid"
            elif failure == "missing":
                payload["model_order"]["image"].pop()
            else:
                payload["providers"][0]["protocol"] = "gemini"
            package = _encrypt_payload(payload, "test-password")
            before = self.files()
            with self.assertRaises(ApiSettingsTransferError):
                self.package.import_encrypted(package, "test-password")
            self.assertEqual(before, self.files())

    def test_failed_capability_activation_rolls_back_every_file_and_environment(self):
        package = self.export()
        main.save_api_providers([main.normalize_provider({"id": "local", "image_models": ["local-image"]})])
        before = self.files()
        environment = dict(os.environ)
        revision = self.catalog.revision
        original_refresh = self.catalog.refresh
        calls = []
        def fail_once():
            calls.append(True)
            return {"ok": False} if len(calls) == 1 else original_refresh()
        with patch.object(self.catalog, "refresh", side_effect=fail_once):
            with self.assertRaises(Exception):
                self.package.import_encrypted(package, "test-password")
        self.assertEqual(before, self.files())
        self.assertEqual(environment, dict(os.environ))
        self.assertEqual(revision, self.catalog.revision)

    def test_wrong_password_and_legacy_package(self):
        before = self.files()
        with self.assertRaises(ApiSettingsTransferError):
            self.package.preview_encrypted(self.export(), "wrong-password")
        self.assertEqual(before, self.files())
        legacy = self.package.export_encrypted("test-password")
        self.assertEqual(1, self.package.preview_encrypted(legacy, "test-password")["version"])
        self.package.import_encrypted(legacy, "test-password")
        self.assertTrue(any(p["id"] == "codex" for p in main.load_api_providers()))


if __name__ == "__main__":
    unittest.main()
