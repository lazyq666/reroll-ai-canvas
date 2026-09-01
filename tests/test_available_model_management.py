import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


ROOT = Path(__file__).resolve().parents[1]


class AvailableModelManagementTests(unittest.TestCase):
    def setUp(self):
        self.providers = [
            {
                "id": "alpha",
                "name": "Alpha API",
                "enabled": True,
                "image_models": ["shared-image", "alpha-image"],
                "video_models": ["alpha-video"],
                "chat_models": ["alpha-text"],
                "model_names": {"alpha-image": "Alpha Image"},
            },
            {
                "id": "beta",
                "name": "Beta API",
                "enabled": True,
                "image_models": ["shared-image", "beta-image"],
                "video_models": [],
                "chat_models": ["beta-text"],
                "model_names": {},
            },
        ]

    def test_inventory_keeps_duplicate_model_names_as_provider_specific_entries(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            main,
            "available_models_file",
            return_value=str(Path(tmp) / "available_models.json"),
        ):
            grouped = main.available_models(self.providers)

        shared = [entry for entry in grouped["image"] if entry["model"] == "shared-image"]
        self.assertEqual(["alpha", "beta"], [entry["provider_id"] for entry in shared])
        self.assertNotEqual(shared[0]["id"], shared[1]["id"])
        self.assertEqual("Alpha Image", grouped["image"][1]["name"])

    def test_saved_order_controls_public_order_and_new_models_append(self):
        with tempfile.TemporaryDirectory() as tmp:
            order_path = Path(tmp) / "available_models.json"
            with patch.object(
                main,
                "available_models_file",
                return_value=str(order_path),
            ), patch.object(
                main,
                "load_api_providers",
                return_value=self.providers,
            ):
                initial = main.available_models()
                beta_id = next(entry["id"] for entry in initial["image"] if entry["provider_id"] == "beta" and entry["model"] == "beta-image")
                reordered = main.save_available_model_order({"image": [beta_id], "video": [], "text": []})
                self.assertEqual("beta-image", reordered["image"][0]["model"])

                self.providers[0]["image_models"].append("new-image")
                refreshed = main.available_models()
                self.assertEqual("beta-image", refreshed["image"][0]["model"])
                self.assertEqual("new-image", refreshed["image"][-1]["model"])
                saved = json.loads(order_path.read_text(encoding="utf-8"))
                self.assertEqual(beta_id, saved["image"][0])

    def test_display_name_update_keeps_model_id_and_provider_routing_stable(self):
        providers = json.loads(json.dumps(self.providers))
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            main,
            "available_models_file",
            return_value=str(Path(tmp) / "available_models.json"),
        ), patch.object(
            main,
            "load_api_providers",
            return_value=providers,
        ), patch.object(main, "save_api_providers") as save_providers:
            inventory = main.available_models(providers)
            target = next(
                entry for entry in inventory["image"]
                if entry["provider_id"] == "alpha" and entry["model"] == "shared-image"
            )

            main.save_available_model_names({target["id"]: "团队主力生图"})

        saved = save_providers.call_args.args[0]
        alpha = next(provider for provider in saved if provider["id"] == "alpha")
        self.assertEqual(["shared-image", "alpha-image"], alpha["image_models"])
        self.assertEqual("团队主力生图", alpha["model_names"]["shared-image"])

    def test_display_name_update_survives_a_fresh_provider_reload(self):
        providers = json.loads(json.dumps(self.providers))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            providers_path = root / "api_providers.json"
            providers_path.write_text(
                json.dumps(providers, ensure_ascii=False),
                encoding="utf-8",
            )
            with patch.object(
                main,
                "api_providers_file",
                return_value=str(providers_path),
            ), patch.object(
                main,
                "available_models_file",
                return_value=str(root / "available_models.json"),
            ), patch.object(
                main,
                "PROVIDER_CONNECTIONS_FILE",
                str(root / "provider-connections.json"),
            ), patch.object(
                main,
                "API_ENV_FILE",
                str(root / "api.env"),
            ):
                target = next(
                    entry for entry in main.available_models()["image"]
                    if entry["provider_id"] == "alpha" and entry["model"] == "shared-image"
                )
                main.save_available_model_names({target["id"]: "刷新后仍保留"})
                reloaded = main.load_api_providers()

        alpha = next(provider for provider in reloaded if provider["id"] == "alpha")
        self.assertEqual("刷新后仍保留", alpha["model_names"]["shared-image"])
        self.assertEqual(["shared-image", "alpha-image"], alpha["image_models"])

    def test_display_name_update_rejects_blank_names(self):
        providers = json.loads(json.dumps(self.providers))
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            main,
            "available_models_file",
            return_value=str(Path(tmp) / "available_models.json"),
        ), patch.object(main, "load_api_providers", return_value=providers):
            target = main.available_models(providers)["image"][0]
            with self.assertRaisesRegex(main.HTTPException, "模型名称不能为空"):
                main.save_available_model_names({target["id"]: "   "})

    def test_models_are_visible_by_default_and_hidden_models_stay_manageable(self):
        providers = json.loads(json.dumps(self.providers))
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            main,
            "available_models_file",
            return_value=str(Path(tmp) / "available_models.json"),
        ), patch.object(main, "load_api_providers", return_value=providers):
            initial = main.available_models(include_hidden=True)
            target = initial["image"][0]
            self.assertTrue(target["visible"])

            visible = {
                kind: [entry["id"] for entry in entries if entry["id"] != target["id"]]
                for kind, entries in initial.items()
            }
            managed = main.save_available_model_order(
                {kind: [entry["id"] for entry in entries] for kind, entries in initial.items()},
                visible,
            )
            public = main.available_models(include_hidden=False)
            saved = json.loads((Path(tmp) / "available_models.json").read_text(encoding="utf-8"))

        managed_target = next(entry for entry in managed["image"] if entry["id"] == target["id"])
        self.assertFalse(managed_target["visible"])
        self.assertNotIn(target["id"], [entry["id"] for entry in public["image"]])
        self.assertIn(target["id"], saved["hidden"]["image"])

    def test_admin_page_and_user_model_first_controls_are_wired(self):
        shell = (ROOT / "static/index.html").read_text(encoding="utf-8")
        account_ui = (ROOT / "static/js/account-ui.js").read_text(encoding="utf-8")
        online = (ROOT / "static/online.html").read_text(encoding="utf-8")
        canvas = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")
        management = (ROOT / "static/available-model-management.html").read_text(encoding="utf-8")

        self.assertIn("switchUI(this, 'available-model-management')", shell)
        self.assertIn("frame-available-model-management", shell)
        self.assertIn("available-model-management", account_ui)
        self.assertIn('id="model-list"', management)
        self.assertIn("/api/admin/available-models", (ROOT / "static/js/available-model-management.js").read_text(encoding="utf-8"))
        self.assertNotIn('id="providerSelect"', online)
        self.assertIn("model-platform-tag", canvas)
        self.assertIn("catalogModelOptions('image'", canvas)


if __name__ == "__main__":
    unittest.main()
