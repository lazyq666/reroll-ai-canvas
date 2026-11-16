import copy
import asyncio
import tempfile
import unittest
from pathlib import Path

from backend.infinite_canvas.model_capability_matrix import ModelCapabilityMatrix
from backend.infinite_canvas.model_capability_workbench import (
    ModelCapabilityWorkbench,
    ModelCapabilityWorkbenchPublication,
)
from tests.test_model_capability_matrix import FakeCatalog, inventory
from backend.infinite_canvas.model_capability_discovery import ApiMartModelsCapabilitySource


class ProviderParameterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.workbench = ModelCapabilityWorkbench(Path(self.directory.name) / "capabilities.json")
        self.catalog = FakeCatalog()
        self.matrix = ModelCapabilityMatrix(
            inventory=inventory, catalog=self.catalog, workbench=self.workbench,
        )

    def record(self, maximum=8, provider="first"):
        return {
            "provider_id": provider, "model_id": "same-model", "operation": "image.generate",
            "capability": {"support_state": "supported", "output": {"count": {"maximum": maximum}}},
            "evidence": {
                "source_type": "structured_api", "source_locator": "https://example.test/models",
                "fetched_at": "2026-11-13T00:00:00Z", "applicable_version": "v1",
                "content_location": "models/same-model", "excerpt": "Explicit count limit",
            },
        }

    def publish_discovery(self, record=None):
        return self.workbench.apply_discovery(
            records=[record or self.record()], catalog=self.catalog, actor_id="admin",
        )

    def published(self):
        return next(record for record in self.workbench.snapshot()["published"]["capabilities"]
                    if record["operation"] == "image.generate")

    def test_first_application_overwrites_manual_values_and_preserves_missing_fields(self):
        self.workbench.publish_manual_capabilities(
            records=[{**self.record(), "capability": {
                "support_state": "supported", "inputs": {}, "parameters": {}, "output": {
                    "count": {"maximum": 2}, "aspect_ratios": ["3:2"],
                },
            }}],
            active_catalog_revision=self.catalog.revision, actor_id="admin",
        )
        self.publish_discovery()
        published = self.published()
        self.assertEqual(published["capability"]["output"]["count"]["maximum"], 8)
        self.assertEqual(published["capability"]["output"]["aspect_ratios"], ["3:2"])
        self.assertEqual(published["auto_fill"]["backup"]["output"]["count"]["maximum"], 2)
        self.assertEqual(self.publish_discovery()["published"], 0)

    def test_later_manual_fields_survive_refresh_and_original_backup_survives_restore(self):
        self.publish_discovery()
        published = self.published()
        changed = copy.deepcopy(published["capability"])
        changed["output"]["count"]["maximum"] = 3
        self.workbench.publish_manual_capabilities(
            records=[{**self.record(), "capability": changed}],
            active_catalog_revision=self.catalog.revision, actor_id="admin",
        )
        update = self.record(12)
        update["capability"]["output"]["aspect_ratios"] = ["9:16"]
        self.publish_discovery(update)
        result = self.published()
        self.assertEqual(result["capability"]["output"]["count"]["maximum"], 3)
        self.assertEqual(result["capability"]["output"]["aspect_ratios"], ["9:16"])
        self.workbench.restore_discovery_backup(
            provider_id="first", model_id="same-model", catalog=self.catalog, actor_id="admin",
        )
        restored = self.published()
        self.assertEqual(restored["capability"], published["auto_fill"]["backup"])
        self.assertEqual(restored["auto_fill"]["backup"], published["auto_fill"]["backup"])

    def test_failed_activation_rolls_back_backup_and_publication(self):
        before = self.workbench.snapshot()
        self.catalog.activation_ok = False
        with self.assertRaises(ModelCapabilityWorkbenchPublication):
            self.publish_discovery()
        self.assertEqual(self.workbench.snapshot(), before)

    def test_provider_scoped_editor_does_not_publish_to_other_provider(self):
        row = self.matrix.snapshot(provider_id="first")["models"][0]
        self.assertEqual([provider["id"] for provider in row["providers"]], ["first"])
        self.matrix.apply(
            provider_id="first", model_id="same-model", actor_id="admin",
            operations=[{"operation": "image.generate", "confirmed": True,
                         "inputs": {"text": 1}, "output_count_maximum": 2,
                         "resolutions": ["1K"], "aspect_ratios": ["1:1"], "options": []}],
        )
        self.assertEqual({record["provider_id"] for record in self.workbench.snapshot()["published"]["capabilities"]}, {"first"})
        self.assertFalse(self.matrix.snapshot(provider_id="second")["models"][0]["has_auto_fill_backup"])

    def test_expanded_schema_is_activated_in_real_catalog_and_restores_all_operations(self):
        from tests.test_model_capability_api import ModelCapabilityApiTests
        catalog = ModelCapabilityApiTests.workbench_catalog(self.workbench.path)
        before = {
            operation: catalog.resolve("apimart", "gpt-image-2", operation)
            for operation in ("image.generate", "image.edit", "image.layer_decomposition")
        }
        source = ApiMartModelsCapabilitySource(
            "apimart", "https://api.apimart.ai/v1/models?expand=parameters",
            [{
                "model_id": "gpt-image-2", "category": "image",
                "capability_tags": ["Text to Image", "Image to Image"],
                "parameters": {"input_schema": {"properties": {
                    "images": {"type": "array", "maxItems": 3},
                    "resolution": {"type": "string", "enum": ["1K", "2K"]},
                    "size": {"type": "string", "enum": ["1:1", "16:9"]},
                    "n": {"type": "integer", "minimum": 1, "maximum": 8, "default": 1},
                    "enhance_prompt": {"type": "boolean", "default": False},
                    "background": {"type": "string", "enum": ["auto", "transparent"]},
                    "output_format": {"type": "string", "enum": ["png", "jpeg"]},
                }}},
            }],
        )
        records = asyncio.run(source.collect()).records
        result = self.workbench.apply_discovery(records=records, catalog=catalog, actor_id="admin")
        self.assertEqual(result["published"], 2)
        capability = catalog.resolve("apimart", "gpt-image-2", "image.edit")
        self.assertEqual(capability["inputs"]["image"]["maximum"], 3)
        self.assertEqual(capability["parameters"]["resolution_tier"]["values"], ["1K", "2K"])
        self.assertEqual(capability["parameters"]["output_format"]["values"], ["png", "jpeg"])
        self.assertEqual(capability["parameters"]["prompt_enhancement"]["values"], [False, True])
        self.assertTrue(capability["media_contract"]["supports_transparent_png"])
        result = self.workbench.restore_discovery_backup(
            provider_id="apimart", model_id="gpt-image-2", catalog=catalog, actor_id="admin",
        )
        self.assertEqual(result["published"], 3)
        for operation, old in before.items():
            restored = catalog.resolve("apimart", "gpt-image-2", operation)
            for field in ("inputs", "output", "parameters"):
                self.assertEqual(restored[field], old[field])


if __name__ == "__main__":
    unittest.main()
