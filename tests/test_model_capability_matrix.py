import tempfile
import unittest
from pathlib import Path

from backend.infinite_canvas.model_capability_matrix import (
    ModelCapabilityImportInvalid,
    ModelCapabilityMatrix,
)
from backend.infinite_canvas.model_capability_workbench import (
    ModelCapabilityWorkbench,
    ModelCapabilityWorkbenchPublication,
)


class FakeCatalog:
    revision = "catalog-revision"

    def __init__(self, *, activation_ok=True):
        self.activation_ok = activation_ok
        self.activations = 0

    def resolve(self, provider_id, model_id, operation):
        return {
            "provider_id": provider_id,
            "model_id": model_id,
            "operation": operation,
            "capability_schema_version": 1,
            "catalog_revision": self.revision,
            "support_state": "supported" if operation == "image.generate" else "unknown",
            "source": "maintained",
            "inputs": {
                "text": {"minimum": 1, "maximum": 1, "required": True},
                "image": {"minimum": 0, "maximum": 0, "required": False},
                "video": {"minimum": 0, "maximum": 0},
                "audio": {"minimum": 0, "maximum": 0},
                "file": {"minimum": 0, "maximum": 0},
            },
            "output": {
                "kind": "image",
                "count": {"minimum": 1, "maximum": 4, "default": 1},
                "resolution_tiers": ["1K", "2K"],
                "aspect_ratios": ["1:1", "16:9"],
            },
            "parameters": {
                "resolution_tier": {
                    "type": "enum",
                    "values": ["1K", "2K"],
                    "default": "1K",
                },
                "count": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 4,
                    "default": 1,
                },
                "transparent_png": {
                    "type": "boolean",
                    "values": [False],
                    "default": False,
                },
            },
        }

    def refresh(self):
        self.activations += 1
        return {"ok": self.activation_ok, "catalog_revision": self.revision}


def inventory():
    return {
        "image": [
            {
                "model": "same-model",
                "name": "Same Model",
                "provider_id": "first",
                "provider_name": "First Platform",
            },
            {
                "model": "same-model",
                "name": "Same Model",
                "provider_id": "second",
                "provider_name": "Second Platform",
            },
        ],
        "video": [],
        "text": [],
    }


class ModelCapabilityMatrixTests(unittest.TestCase):
    def test_groups_the_same_model_id_across_providers(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=FakeCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            snapshot = matrix.snapshot()

        self.assertEqual(1, snapshot["summary"]["models"])
        row = snapshot["models"][0]
        self.assertEqual("same-model", row["model_id"])
        self.assertEqual(["First Platform", "Second Platform"], [item["name"] for item in row["providers"]])
        self.assertEqual(3, row["operation_count"])
        self.assertNotIn("provider_id", row)

    def test_cross_platform_row_uses_the_safe_common_capability(self):
        class DifferentCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                capability = super().resolve(provider_id, model_id, operation)
                if provider_id == "second" and operation == "image.generate":
                    capability["output"]["count"]["maximum"] = 2
                    capability["output"]["resolution_tiers"] = ["1K"]
                    capability["parameters"]["resolution_tier"]["values"] = ["1K"]
                return capability

        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=DifferentCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            operation = next(
                item
                for item in matrix.snapshot()["models"][0]["operations"]
                if item["operation"] == "image.generate"
            )

        self.assertEqual(2, operation["output_count_maximum"])
        self.assertEqual(["1K"], operation["resolutions"])

    def test_one_product_edit_publishes_all_provider_variants_once(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            catalog = FakeCatalog()
            matrix = ModelCapabilityMatrix(
                inventory=inventory, catalog=catalog, workbench=workbench
            )
            result = matrix.apply(
                model_id="same-model",
                name="Same Model",
                actor_id="admin-1",
                operations=[
                    {
                        "operation": "image.generate",
                        "confirmed": True,
                        "inputs": {"text": 1, "image": 2},
                        "resolutions": ["2K"],
                        "aspect_ratios": ["1:1"],
                        "output_count_maximum": 2,
                        "options": ["transparent_png"],
                    }
                ],
            )
            state = workbench.snapshot()

        self.assertEqual(2, result["published"])
        self.assertEqual(1, catalog.activations)
        self.assertEqual(2, len(state["published"]["capabilities"]))
        self.assertEqual(2, len(state["evidence"]))
        self.assertEqual({"first", "second"}, {item["provider_id"] for item in state["published"]["capabilities"]})
        for item in state["published"]["capabilities"]:
            capability = item["capability"]
            self.assertEqual(2, capability["inputs"]["image"]["maximum"])
            self.assertEqual(["2K"], capability["parameters"]["resolution_tier"]["values"])
            self.assertEqual([False, True], capability["parameters"]["transparent_png"]["values"])

    def test_failed_activation_rolls_back_the_whole_model_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=FakeCatalog(activation_ok=False),
                workbench=workbench,
            )
            with self.assertRaises(ModelCapabilityWorkbenchPublication):
                matrix.apply(
                    model_id="same-model",
                    name="Same Model",
                    actor_id="admin-1",
                    operations=[
                        {
                            "operation": "image.generate",
                            "confirmed": True,
                            "inputs": {"text": 1},
                            "output_count_maximum": 1,
                        }
                    ],
                )

            state = workbench.snapshot()
        self.assertEqual([], state["evidence"])
        self.assertEqual([], state["drafts"])
        self.assertEqual([], state["published"]["capabilities"])

    def test_external_import_previews_without_mutating_state(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            matrix = ModelCapabilityMatrix(
                inventory=inventory, catalog=FakeCatalog(), workbench=workbench
            )
            result = matrix.import_bundle(
                bundle=self.import_bundle(), actor_id="admin-1", apply=False
            )
            state = workbench.snapshot()

        self.assertFalse(result["applied"])
        self.assertEqual(1, result["preview"]["models"])
        self.assertEqual(1, result["preview"]["operations"])
        self.assertEqual(2, result["preview"]["platform_variants"])
        self.assertEqual([], state["evidence"])
        self.assertEqual([], state["published"]["capabilities"])

    def test_external_import_applies_to_all_platforms_with_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            catalog = FakeCatalog()
            matrix = ModelCapabilityMatrix(
                inventory=inventory, catalog=catalog, workbench=workbench
            )
            result = matrix.import_bundle(
                bundle=self.import_bundle(), actor_id="admin-1", apply=True
            )
            state = workbench.snapshot()

        self.assertTrue(result["applied"])
        self.assertEqual(2, result["published"])
        self.assertEqual(1, catalog.activations)
        self.assertEqual(2, len(state["evidence"]))
        self.assertEqual(
            {"first", "second"},
            {item["provider_id"] for item in state["evidence"]},
        )
        self.assertTrue(
            all(
                item["source_locator"] == "https://example.com/models/same-model"
                for item in state["evidence"]
            )
        )

    def test_external_import_cross_checks_the_current_model_name(self):
        package = self.import_bundle()
        package["models"][0]["name"] = "Another Model"
        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=FakeCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            with self.assertRaises(ModelCapabilityImportInvalid) as raised:
                matrix.import_bundle(
                    bundle=package, actor_id="admin-1", apply=False
                )

        self.assertEqual("name_mismatch", raised.exception.reason)
        self.assertEqual("same-model", raised.exception.model_id)

    @staticmethod
    def import_bundle():
        return {
            "schema_version": 1,
            "models": [
                {
                    "model_id": "same-model",
                    "name": "Same Model",
                    "operations": [
                        {
                            "operation": "image.generate",
                            "confirmed": True,
                            "inputs": {
                                "text": 1,
                                "image": 2,
                                "video": 0,
                                "audio": 0,
                                "file": 0,
                            },
                            "resolutions": ["1K", "2K"],
                            "aspect_ratios": ["1:1"],
                            "output_count_maximum": 2,
                            "options": ["transparent_png"],
                            "sources": [
                                {
                                    "type": "official_docs",
                                    "url": "https://example.com/models/same-model",
                                    "title": "Image generation",
                                    "excerpt": "The model accepts text and reference images.",
                                }
                            ],
                        }
                    ],
                }
            ],
        }

    def test_layer_decomposition_cannot_be_widened_by_product_choices(self):
        base = FakeCatalog().resolve(
            "first", "same-model", "image.layer_decomposition"
        )
        result = ModelCapabilityMatrix._apply_choice(
            base,
            {
                "confirmed": True,
                "inputs": {
                    "text": 12,
                    "image": 12,
                    "video": 12,
                    "audio": 12,
                    "file": 12,
                },
                "resolutions": ["1K", "2K", "4K"],
                "aspect_ratios": ["1:1", "16:9"],
                "output_count_maximum": 12,
                "options": ["transparent_png", "prompt_enhancement"],
            },
        )

        self.assertEqual(
            {"text": 1, "image": 1, "video": 0, "audio": 0, "file": 0},
            {
                input_type: contract["maximum"]
                for input_type, contract in result["inputs"].items()
            },
        )
        self.assertEqual(["1K", "2K"], result["output"]["resolution_tiers"])
        self.assertEqual([], result["output"]["aspect_ratios"])
        self.assertEqual(1, result["output"]["count"]["maximum"])
        self.assertEqual(1, result["parameters"]["count"]["maximum"])
        self.assertEqual(
            [False], result["parameters"]["transparent_png"]["values"]
        )


if __name__ == "__main__":
    unittest.main()
