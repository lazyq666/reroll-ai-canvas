"""Legacy model identities and completed video reads use persisted, isolated fixtures."""

import copy
import unittest

from tests import test_agent_task_editing as editing


class AgentModelIdentityTests(unittest.TestCase):
    setUp = editing.AgentTaskEditingTests.setUp
    document = editing.AgentTaskEditingTests.document
    node = editing.AgentTaskEditingTests.node
    mutate = editing.AgentTaskEditingTests.mutate
    detail = editing.AgentTaskEditingTests.detail
    update = editing.AgentTaskEditingTests.update

    def seed_model(self, provider="jimeng", model="Seedance2.5"):
        self.api.models = lambda: [{"provider_id": provider, "model": "seedance2.5", "kind": "video"}]
        self.api.resolve_model = self.api.catalog.resolve
        self.mutate({"node_updates": [
            {"id": "draft", "path": ["runSettings", key], "value": value}
            for key, value in (("videoProvider", provider), ("videoModel", model),
                               ("videoDuration", 22))
        ]}, "legacy-model")

    def test_legacy_uppercase_model_validates_and_partial_edits_preserve_settings(self):
        self.seed_model()
        settings = copy.deepcopy(self.node()["runSettings"])
        before = self.detail()
        self.assertTrue(before["validation"]["valid"], before["validation"])
        for index, changes in enumerate(({"title": "New title"}, {"prompt": "@人物 @横幅 新分镜"})):
            result = self.update(changes, key=f"alias-edit-{index}")
            self.assertEqual(200, result.status_code, result.text)
            self.assertEqual(settings, self.node()["runSettings"])
            self.assertEqual(22, self.detail()["recipe"]["params"]["duration_seconds"])

    def test_unknown_or_other_provider_alias_is_rejected_without_writes(self):
        for provider, model in (("custom", "Seedance2.5"), ("jimeng", "Seedance2.5future")):
            with self.subTest(provider=provider, model=model):
                self.api.models = lambda: [{"provider_id": provider, "model": model.lower(), "kind": "video"}]
                saved = self.document()
                response = self.update({"model": {"provider_id": provider, "model": model}}, key=provider)
                self.assertEqual(422, response.status_code)
                self.assertIn("model_unavailable", str(response.json()))
                self.assertEqual(saved, self.document())

    def test_unavailable_saved_model_blocks_partial_edit_without_substitution(self):
        self.seed_model()
        self.api.models = lambda: [{"provider_id": "jimeng", "model": "seedance2.0_vip", "kind": "video"}]
        saved = self.document()
        response = self.update({"title": "Must not substitute"})
        self.assertEqual(422, response.status_code)
        self.assertIn("model_unavailable", str(response.json()))
        self.assertEqual(saved, self.document())

    def test_legacy_completed_video_projects_video_recipe_without_rewriting_history(self):
        self.mutate({"node_updates": [
            {"id": "draft", "path": [key], "value": value}
            for key, value in (("referenceGenerationKind", "image"),
                ("generationOutputNode", True), ("outputKind", "video"),
                ("images", [{"url": "/assets/complete.mp4", "kind": "video"}]))
        ]}, "legacy-completed-video")
        saved = self.document()
        detail = self.detail()
        self.assertEqual("video", detail["recipe"]["kind"])
        self.assertEqual({"provider_id": "fixture", "model": "video"}, detail["recipe"]["model"])
        self.assertEqual(12, detail["recipe"]["params"]["duration_seconds"])
        self.assertEqual(saved, self.document())

    def test_published_legacy_capability_applies_to_canonical_alias(self):
        catalog = self.api.catalog
        catalog._published_capabilities[("jimeng", "Seedance2.5", "video.generate")] = {
            "parameters": {"duration_seconds": {"maximum": 24}}}
        for model in ("seedance2.5", "Seedance2.5"):
            self.assertEqual(24, catalog.resolve("jimeng", model, "video.generate")["parameters"]["duration_seconds"]["maximum"])
            self.assertEqual(24, catalog.backup_contract("jimeng", model, "video.generate")["parameters"]["duration_seconds"]["maximum"])
