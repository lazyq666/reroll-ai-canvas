"""The visible model list and Agent list share alias and administrator settings."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.runtime_env import ensure_test_workspace
ensure_test_workspace()
import main


class AvailableModelAliasTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "models.json"
        self.providers = [{"id": "jimeng", "name": "Dreamina", "video_models": [
            "seedance2.0_vip", "Seedance2.5", "seedance2.5"],
            "model_names": {"Seedance2.5": "My 2.5"}}]
        for name, value in (("available_models_file", str(self.path)),
                            ("load_api_providers", self.providers)):
            patcher = patch.object(main, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.upper_id = main.available_model_id("jimeng", "Seedance2.5")
        self.lower_id = main.available_model_id("jimeng", "seedance2.5")

    def test_alias_merge_keeps_saved_order_name_and_hidden_setting(self):
        self.path.write_text(json.dumps({"video": [self.upper_id],
            "hidden": {"video": [self.upper_id]}}))
        inventory = main.available_models()["video"]
        self.assertEqual(["seedance2.5", "seedance2.0_vip"], [e["model"] for e in inventory])
        self.assertEqual("My 2.5", inventory[0]["name"])
        self.assertFalse(inventory[0]["visible"])
        self.assertEqual(self.lower_id, inventory[0]["id"])
        self.assertIn(self.upper_id, inventory[0]["alias_ids"])
        self.assertEqual(["seedance2.0_vip"], [e["model"] for e in main.available_models(include_hidden=False)["video"]])
        self.assertEqual(["seedance2.0_vip"], [e["model"] for e in main.agent_available_models()])

    def test_legacy_ids_can_save_order_visibility_and_names(self):
        with patch.object(main, "save_api_providers"):
            main.save_available_model_order({"video": [self.upper_id]}, {"video": [self.upper_id]})
            main.save_available_model_names({self.upper_id: "Updated 2.5"})
        saved = json.loads(self.path.read_text())
        self.assertEqual(self.lower_id, saved["video"][0])
        inventory = main.available_models()["video"]
        self.assertTrue(inventory[0]["visible"])
        self.assertFalse(inventory[1]["visible"])
        self.assertEqual("Updated 2.5", inventory[0]["name"])

    def test_legacy_metadata_survives_removing_uppercase_from_provider_list(self):
        self.path.write_text(json.dumps({"video": [self.upper_id],
            "hidden": {"video": [self.upper_id]}}))
        self.providers[0]["video_models"].remove("Seedance2.5")
        inventory = main.available_models()["video"]
        self.assertEqual("seedance2.5", inventory[0]["model"])
        self.assertEqual("My 2.5", inventory[0]["name"])
        self.assertFalse(inventory[0]["visible"])
        del self.providers[0]["model_names"]["Seedance2.5"]
        self.assertFalse(main.available_models()["video"][0]["visible"], "hidden ID must not depend on a custom name")

    def test_legacy_page_visibility_conflict_keeps_model_hidden_until_explicit_show(self):
        self.path.write_text(json.dumps({"video": [self.upper_id, self.lower_id],
            "hidden": {"video": [self.upper_id]}}))
        vip_id = main.available_model_id("jimeng", "seedance2.0_vip")
        self.assertFalse(main.available_models()["video"][0]["visible"])
        # An already-open legacy page still has two rows. Saving its unchanged
        # visibility must not unhide the logical model during an unrelated edit.
        main.save_available_model_order({"video": [self.upper_id, self.lower_id, vip_id]},
                                       {"video": [self.lower_id, vip_id]})
        self.assertFalse(main.available_models()["video"][0]["visible"])
        self.assertEqual([self.lower_id], json.loads(self.path.read_text())["hidden"]["video"])

        # The current page has one canonical row and can explicitly show it.
        main.save_available_model_order({"video": [self.lower_id, vip_id]},
                                       {"video": [self.lower_id, vip_id]})
        self.assertTrue(main.available_models()["video"][0]["visible"])

        # A legacy page that explicitly shows both alias rows can also show it.
        main.save_available_model_order({"video": [self.upper_id, self.lower_id, vip_id]},
                                       {"video": [self.upper_id, self.lower_id, vip_id]})
        self.assertTrue(main.available_models()["video"][0]["visible"])

    def test_aliases_do_not_merge_provider_or_vip_or_unknown_identities(self):
        self.providers.extend([{"id": "custom", "video_models": ["Seedance2.5", "seedance2.5"]}])
        self.providers[0]["video_models"].extend(["Future", "future", "seedance2.0"])
        inventory = main.available_models()["video"]
        self.assertEqual(7, len(inventory))
        self.assertEqual(["Seedance2.5", "seedance2.5"], [e["model"] for e in inventory if e["provider_id"] == "custom"])
