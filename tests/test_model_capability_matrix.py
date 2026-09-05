import copy
import tempfile
import unittest
from pathlib import Path

from backend.infinite_canvas.image_capabilities import ImageCapabilityRegistry
from backend.infinite_canvas.model_capabilities import ModelCapabilityCatalog
from backend.infinite_canvas.model_capability_matrix import (
    ModelCapabilityImportInvalid,
    ModelCapabilityMatrix,
)
from backend.infinite_canvas.video_capabilities import VideoCapabilityRegistry


ROOT = Path(__file__).resolve().parents[1]
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
    @staticmethod
    def video_inventory():
        return {
            "image": [],
            "video": [
                {
                    "model": "shared-video",
                    "name": "Shared Video",
                    "provider_id": "first",
                    "provider_name": "First Platform",
                },
                {
                    "model": "shared-video",
                    "name": "Shared Video",
                    "provider_id": "second",
                    "provider_name": "Second Platform",
                },
            ],
            "text": [],
        }

    @staticmethod
    def video_capability(provider_id):
        latest = provider_id == "second"
        image_maximum, media_maximum, total_maximum = (
            (30, 10, 50) if latest else (9, 3, 12)
        )
        duration_maximum = 30 if latest else 15
        audio_only = latest
        return {
            "provider_id": provider_id,
            "model_id": "shared-video",
            "operation": "video.generate",
            "support_state": "supported",
            "inputs": {
                "text": {"minimum": 1, "maximum": 1, "required": True},
                "image": {"minimum": 0, "maximum": image_maximum},
                "video": {"minimum": 0, "maximum": media_maximum},
                "audio": {"minimum": 0, "maximum": media_maximum},
                "file": {"minimum": 0, "maximum": 0},
            },
            "input_rules": {
                "totals": [
                    {
                        "id": "reference_media",
                        "inputs": ["image", "video", "audio"],
                        "minimum": 1,
                        "maximum": total_maximum,
                        "active_when_any_present": True,
                    }
                ],
                "requirements": [] if audio_only else [
                    {
                        "id": "visual_reference",
                        "when": {"input": "audio", "minimum": 1},
                        "any_of": ["image", "video"],
                        "minimum": 1,
                    }
                ],
                "role_groups": [
                    {
                        "id": "first_last_frames",
                        "input": "image",
                        "roles": ["first_frame", "last_frame"],
                        "minimum": 1,
                        "maximum": 2,
                        "exclusive_inputs": ["video", "audio"],
                    }
                ],
            },
            "output": {
                "kind": "video",
                "count": {"minimum": 1, "maximum": 1, "default": 1},
                "duration_seconds": {"minimum": 4, "maximum": duration_maximum},
                "resolutions": ["720p", "1080p"] if latest else ["720p"],
                "aspect_ratios": ["16:9", "9:16"],
            },
            "parameters": {
                "duration_seconds": {
                    "type": "integer",
                    "minimum": 4,
                    "maximum": duration_maximum,
                    "default": 5,
                },
                "resolution": {
                    "type": "enum",
                    "values": ["720p", "1080p"] if latest else ["720p"],
                    "default": "720p",
                },
                "aspect_ratio": {
                    "type": "enum",
                    "values": ["16:9", "9:16"],
                    "default": "16:9",
                },
                "generate_audio": {
                    "type": "boolean",
                    "values": [False, True],
                    "default": False,
                },
            },
            "media_contract": {
                "commands": {
                    "frames2video": {
                        "image_count": {"minimum": 1, "maximum": 2},
                    },
                    "multimodal2video": {
                        "inputs": {
                            "image_count": {"minimum": 0, "maximum": image_maximum},
                            "video_count": {"minimum": 0, "maximum": media_maximum},
                            "audio_count": {"minimum": 0, "maximum": media_maximum},
                            "total_count": {"minimum": 1, "maximum": total_maximum},
                            "reference_media_duration_seconds": {
                                "each": {"minimum": 2, "maximum": duration_maximum},
                                "combined_total": {"minimum": 2, "maximum": duration_maximum},
                            },
                            "audio_only_supported": audio_only,
                        }
                    },
                }
            },
        }

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

    def test_video_capability_projects_the_safe_common_limits_and_modes(self):
        class VideoCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                return ModelCapabilityMatrixTests.video_capability(provider_id)

        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=self.video_inventory,
                catalog=VideoCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            operation = matrix.snapshot()["models"][0]["operations"][0]

        self.assertEqual(
            {"text": 1, "image": 9, "video": 3, "audio": 3, "file": 0},
            operation["inputs"],
        )
        self.assertEqual(12, operation["video"]["input_total_maximum"])
        self.assertEqual(
            {"minimum": 2, "maximum": 15},
            operation["video"]["reference_media_duration_seconds"]["each"],
        )
        self.assertEqual(
            {"minimum": 2, "maximum": 15},
            operation["video"]["reference_media_duration_seconds"]["combined_total"],
        )
        self.assertFalse(operation["video"]["audio_only_supported"])
        self.assertEqual(
            {"first_last_frames": True, "multimodal_all_around": True},
            operation["video"]["modes"],
        )
        self.assertEqual(
            {"minimum": 4, "maximum": 15},
            operation["video"]["output_duration_seconds"],
        )
        self.assertEqual(["720p"], operation["resolutions"])

    def test_seedance_profiles_project_the_maintained_reference_limits(self):
        resource_paths = (
            ROOT / "resources" / "image-model-capabilities.json",
            ROOT / "resources" / "video-model-capabilities.json",
            ROOT / "resources" / "text-model-capabilities.json",
        )
        catalog = ModelCapabilityCatalog(
            image_registry=ImageCapabilityRegistry(resource_paths[0]),
            video_registry=VideoCapabilityRegistry(resource_paths[1]),
            text_path=resource_paths[2],
            revision_paths=resource_paths,
        )
        inventory = lambda: {
            "image": [],
            "video": [
                {
                    "model": model_id,
                    "name": model_id,
                    "provider_id": "jimeng",
                    "provider_name": "Dreamina",
                }
                for model_id in ("seedance2.0", "seedance2.5")
            ],
            "text": [],
        }
        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=catalog,
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            profiles = {
                row["model_id"]: row["operations"][0]
                for row in matrix.snapshot()["models"]
            }

        seedance20 = profiles["seedance2.0"]
        seedance25 = profiles["seedance2.5"]
        self.assertEqual(
            {"image": 9, "video": 3, "audio": 3},
            {key: seedance20["inputs"][key] for key in ("image", "video", "audio")},
        )
        self.assertEqual(12, seedance20["video"]["input_total_maximum"])
        self.assertEqual(
            {"minimum": 2, "maximum": 15},
            seedance20["video"]["reference_media_duration_seconds"]["each"],
        )
        self.assertFalse(seedance20["video"]["audio_only_supported"])
        self.assertEqual(
            {"image": 30, "video": 10, "audio": 10},
            {key: seedance25["inputs"][key] for key in ("image", "video", "audio")},
        )
        self.assertEqual(50, seedance25["video"]["input_total_maximum"])
        self.assertEqual(
            {"minimum": 2, "maximum": 30},
            seedance25["video"]["reference_media_duration_seconds"]["combined_total"],
        )
        self.assertTrue(seedance25["video"]["audio_only_supported"])
        self.assertTrue(seedance25["video"]["modes"]["first_last_frames"])
        self.assertTrue(seedance25["video"]["modes"]["multimodal_all_around"])

    def test_saved_seedance25_profile_keeps_thirty_image_limit_on_reopen(self):
        resource_paths = (
            ROOT / "resources" / "image-model-capabilities.json",
            ROOT / "resources" / "video-model-capabilities.json",
            ROOT / "resources" / "text-model-capabilities.json",
        )
        inventory = lambda: {
            "image": [],
            "video": [
                {
                    "model": "seedance2.5",
                    "name": "Seedance 2.5",
                    "provider_id": "jimeng",
                    "provider_name": "Dreamina",
                }
            ],
            "text": [],
        }
        with tempfile.TemporaryDirectory() as directory:
            workbench_path = Path(directory) / "workbench.json"
            workbench = ModelCapabilityWorkbench(workbench_path)
            catalog = ModelCapabilityCatalog(
                image_registry=ImageCapabilityRegistry(resource_paths[0]),
                video_registry=VideoCapabilityRegistry(resource_paths[1]),
                text_path=resource_paths[2],
                revision_paths=resource_paths,
                published_path=workbench_path,
            )
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=catalog,
                workbench=workbench,
            )
            operation = matrix.snapshot()["models"][0]["operations"][0]
            matrix.apply(
                model_id="seedance2.5",
                name="Seedance 2.5",
                actor_id="admin-1",
                operations=[
                    {
                        **operation,
                        "options": [
                            key
                            for key, enabled in operation["options"].items()
                            if enabled
                        ],
                    }
                ],
            )
            reopened = matrix.snapshot()["models"][0]["operations"][0]

        self.assertEqual(30, reopened["inputs"]["image"])
        self.assertEqual(50, reopened["video"]["input_total_maximum"])
        self.assertEqual(
            {"minimum": 4, "maximum": 30},
            reopened["video"]["output_duration_seconds"],
        )

    def test_video_choices_publish_existing_runtime_contracts(self):
        class VideoCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                return ModelCapabilityMatrixTests.video_capability(provider_id)

        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            matrix = ModelCapabilityMatrix(
                inventory=self.video_inventory,
                catalog=VideoCatalog(),
                workbench=workbench,
            )
            matrix.apply(
                model_id="shared-video",
                name="Shared Video",
                actor_id="admin-1",
                operations=[
                    {
                        "operation": "video.generate",
                        "confirmed": True,
                        "inputs": {
                            "text": 1,
                            "image": 9,
                            "video": 3,
                            "audio": 3,
                            "file": 0,
                        },
                        "resolutions": ["720p"],
                        "aspect_ratios": ["16:9"],
                        "output_count_maximum": 1,
                        "options": ["generate_audio"],
                        "video": {
                            "input_total_maximum": 12,
                            "reference_media_duration_seconds": {
                                "each": {"minimum": 2, "maximum": 15},
                                "combined_total": {"minimum": 2, "maximum": 15},
                            },
                            "audio_only_supported": False,
                            "modes": {
                                "first_last_frames": True,
                                "multimodal_all_around": True,
                            },
                            "output_duration_seconds": {
                                "minimum": 4,
                                "maximum": 15,
                            },
                        },
                    }
                ],
            )
            capabilities = [
                item["capability"]
                for item in workbench.snapshot()["published"]["capabilities"]
            ]

        self.assertEqual(2, len(capabilities))
        for capability in capabilities:
            self.assertEqual(12, capability["input_rules"]["totals"][0]["maximum"])
            self.assertEqual("visual_reference", capability["input_rules"]["requirements"][0]["id"])
            self.assertEqual("first_last_frames", capability["input_rules"]["role_groups"][0]["id"])
            self.assertEqual(
                {"minimum": 4, "maximum": 15},
                capability["output"]["duration_seconds"],
            )
            self.assertEqual(15, capability["parameters"]["duration_seconds"]["maximum"])
            self.assertEqual(
                "user_toggle",
                capability["media_contract"]["composer_options"]["generate_audio"],
            )
            self.assertEqual(
                "unsupported",
                capability["media_contract"]["composer_options"]["watermark"],
            )
            commands = capability["media_contract"]["commands"]
            self.assertIn("frames2video", commands)
            self.assertIn("multimodal2video", commands)
            self.assertEqual(
                {"minimum": 2, "maximum": 15},
                commands["multimodal2video"]["inputs"][
                    "reference_media_duration_seconds"
                ]["each"],
            )

    def test_exposes_high_value_tags_from_the_runtime_catalog(self):
        class TaggedCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                capability = super().resolve(provider_id, model_id, operation)
                if operation == "image.generate":
                    capability["parameters"]["transparent_png"]["values"] = [
                        False,
                        True,
                    ]
                if operation == "image.layer_decomposition":
                    capability["support_state"] = "supported"
                return capability

        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(
                inventory=inventory,
                catalog=TaggedCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
            )
            row = matrix.snapshot()["models"][0]

        self.assertEqual(
            ["layer_decomposition", "transparent_png"], row["capability_tags"]
        )

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

    def test_pending_refresh_draft_does_not_prefill_a_saved_model(self):
        class PublishedCatalog(FakeCatalog):
            def __init__(self):
                super().__init__()
                self.saved = {}

            def resolve(self, provider_id, model_id, operation):
                identity = (provider_id, model_id, operation)
                if identity in self.saved:
                    return copy.deepcopy(self.saved[identity])
                return super().resolve(provider_id, model_id, operation)

        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            catalog = PublishedCatalog()
            matrix = ModelCapabilityMatrix(
                inventory=inventory, catalog=catalog, workbench=workbench
            )
            matrix.apply(
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
                        "options": [],
                    }
                ],
            )
            published = workbench.snapshot()["published"]["capabilities"]
            catalog.saved = {
                (item["provider_id"], item["model_id"], item["operation"]): item[
                    "capability"
                ]
                for item in published
            }

            for provider_id in ("first", "second"):
                for operation in ("image.generate", "image.edit"):
                    identity = {
                        "provider_id": provider_id,
                        "model_id": "same-model",
                        "operation": operation,
                    }
                    candidate = (
                        copy.deepcopy(
                            catalog.saved[
                                (provider_id, "same-model", "image.generate")
                            ]
                        )
                        if operation == "image.generate"
                        else ModelCapabilityMatrix._apply_choice(
                            catalog.resolve(provider_id, "same-model", operation),
                            {
                                "confirmed": True,
                                "inputs": {"text": 1, "image": 8},
                                "resolutions": ["1K"],
                                "aspect_ratios": ["1:1"],
                                "output_count_maximum": 1,
                                "options": [],
                            },
                        )
                    )
                    candidate["support_state"] = "supported"
                    candidate["inputs"]["image"]["maximum"] = 8
                    candidate["output"]["count"]["maximum"] = 1
                    candidate["parameters"]["count"]["maximum"] = 1
                    candidate["parameters"]["transparent_png"]["values"] = [
                        False,
                        True,
                    ]
                    evidence = workbench.record_evidence(
                        **identity,
                        source_type="structured_api",
                        source_locator="https://example.com/models",
                        fetched_at="2026-09-04T00:00:00Z",
                        applicable_version="latest",
                        content_location="model response",
                        excerpt="The fetched response suggests different limits.",
                        actor_id="model-capability-refresh",
                    )
                    workbench.save_draft(
                        **identity,
                        capability=candidate,
                        field_evidence={
                            path: {
                                "evidence_ids": [evidence["id"]],
                                "confidence": "medium",
                            }
                            for path in workbench._leaf_paths(candidate)
                        },
                        base_catalog_revision=catalog.revision,
                        actor_id="model-capability-refresh",
                    )

            snapshot = matrix.snapshot()

        operation = next(
            item
            for item in snapshot["models"][0]["operations"]
            if item["operation"] == "image.generate"
        )
        self.assertEqual(2, operation["inputs"]["image"])
        self.assertEqual(2, operation["output_count_maximum"])
        unconfigured_operation = next(
            item
            for item in snapshot["models"][0]["operations"]
            if item["operation"] == "image.edit"
        )
        self.assertFalse(unconfigured_operation["confirmed"])
        self.assertEqual(0, unconfigured_operation["inputs"]["image"])
        self.assertEqual(4, unconfigured_operation["output_count_maximum"])
        self.assertEqual(4, snapshot["models"][0]["review"]["draft"])
        self.assertEqual([], snapshot["models"][0]["capability_tags"])

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

    def test_external_video_import_updates_the_runtime_commands(self):
        class VideoCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                return ModelCapabilityMatrixTests.video_capability(provider_id)

        bundle = {
            "schema_version": 1,
            "models": [
                {
                    "model_id": "shared-video",
                    "name": "Shared Video",
                    "operations": [
                        {
                            "operation": "video.generate",
                            "confirmed": True,
                            "inputs": {
                                "text": 1,
                                "image": 9,
                                "video": 3,
                                "audio": 3,
                                "file": 0,
                            },
                            "resolutions": ["720p"],
                            "aspect_ratios": ["16:9"],
                            "output_count_maximum": 1,
                            "options": ["generate_audio"],
                            "video": {
                                "input_total_maximum": 12,
                                "reference_media_duration_seconds": {
                                    "each": {"minimum": 2, "maximum": 15},
                                    "combined_total": {"minimum": 2, "maximum": 15},
                                },
                                "audio_only_supported": False,
                                "modes": {
                                    "first_last_frames": True,
                                    "multimodal_all_around": True,
                                },
                                "output_duration_seconds": {
                                    "minimum": 4,
                                    "maximum": 15,
                                },
                            },
                            "sources": [
                                {
                                    "type": "official_docs",
                                    "url": "https://example.com/shared-video",
                                    "title": "Video limits",
                                    "excerpt": "The model supports the listed reference limits.",
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            matrix = ModelCapabilityMatrix(
                inventory=self.video_inventory,
                catalog=VideoCatalog(),
                workbench=workbench,
            )
            for invalid_profile in (
                {"audio_only_supported": True},
                {"output_duration_seconds": {"minimum": 15, "maximum": 4}},
                {"input_total_maximum": 0},
                {"output_duration_seconds": {"minimum": 4, "maximum": 15.5}},
            ):
                invalid = copy.deepcopy(bundle)
                invalid_choice = invalid["models"][0]["operations"][0]
                invalid_choice["video"].update(invalid_profile)
                if invalid_profile.get("audio_only_supported"):
                    invalid_choice["inputs"]["audio"] = 0
                with self.subTest(profile=invalid_profile), self.assertRaises(ModelCapabilityImportInvalid):
                    matrix.import_bundle(bundle=invalid, actor_id="admin-1", apply=True)
                self.assertEqual([], workbench.snapshot()["published"]["capabilities"])
            result = matrix.import_bundle(
                bundle=bundle, actor_id="admin-1", apply=True
            )
            saved = workbench.snapshot()["published"]["capabilities"]

        self.assertTrue(result["applied"])
        self.assertEqual(2, len(saved))
        self.assertTrue(all(
            {"frames2video", "multimodal2video"}.issubset(
                item["capability"]["media_contract"]["commands"]
            )
            for item in saved
        ))

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

    def test_import_rejects_values_outside_editor_contract_without_writes(self):
        for patch in (
            {"resolutions": ["potato"]},
            {"operation": "image.edit", "inputs": {"text": 1, "image": 21, "video": 0, "audio": 0, "file": 0}}, {"aspect_ratios": ["16/9"]},
            {"resolutions": ["1K", "1K"]}, {"output_count_maximum": 101},
            {"inputs": {"text": 1, "image": 0, "video": 3, "audio": 0, "file": 0}},
            {"operation": "image.layer_decomposition", "resolutions": ["4K"]},
        ):
            with self.subTest(patch=patch), tempfile.TemporaryDirectory() as directory:
                workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
                matrix = ModelCapabilityMatrix(inventory=inventory, catalog=FakeCatalog(), workbench=workbench)
                bundle = self.import_bundle()
                bundle["models"][0]["operations"][0].update(patch)
                before = workbench.snapshot()
                with self.assertRaises(ModelCapabilityImportInvalid):
                    matrix.import_bundle(bundle=bundle, actor_id="admin", apply=True)
                self.assertEqual(before, workbench.snapshot())

    def test_imported_large_counts_and_new_options_round_trip_to_editor(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            catalog = FakeCatalog()
            matrix = ModelCapabilityMatrix(inventory=inventory, catalog=catalog, workbench=workbench)
            bundle = self.import_bundle()
            choice = bundle["models"][0]["operations"][0]
            choice.update(output_count_maximum=37, resolutions=["0.5K", "4K"],
                          aspect_ratios=["1:8", "5:4"], options=["prompt_enhancement"])
            matrix.import_bundle(bundle=bundle, actor_id="admin", apply=True)
            saved = workbench.snapshot()["published"]["capabilities"][0]["capability"]
            projected = matrix._operation_projection("image.generate", [saved])
            for key in ("inputs", "resolutions", "aspect_ratios", "output_count_maximum"):
                self.assertEqual(choice[key], projected[key])
            self.assertTrue(projected["options"]["prompt_enhancement"])
            self.assertFalse(projected["options"]["transparent_png"])

    def test_import_rejects_image_fields_that_the_shared_editor_cannot_represent(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(inventory=inventory, catalog=FakeCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"))
            bundle = self.import_bundle()
            edit = copy.deepcopy(bundle["models"][0]["operations"][0])
            edit.update(operation="image.edit", output_count_maximum=9)
            edit["inputs"]["image"] = 2
            bundle["models"][0]["operations"].append(edit)
            with self.assertRaisesRegex(ModelCapabilityImportInvalid, "field_values"):
                matrix.import_bundle(bundle=bundle, actor_id="admin", apply=True)

    def test_partial_image_import_cannot_disappear_in_existing_editor_intersection(self):
        class EditingCatalog(FakeCatalog):
            def resolve(self, provider_id, model_id, operation):
                value = super().resolve(provider_id, model_id, operation)
                value["support_state"] = "supported"
                if operation == "image.edit":
                    value["inputs"]["image"]["maximum"] = 2
                return value
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(Path(directory) / "workbench.json")
            matrix = ModelCapabilityMatrix(inventory=inventory, catalog=EditingCatalog(), workbench=workbench)
            bundle = self.import_bundle()
            choice = bundle["models"][0]["operations"][0]
            choice["output_count_maximum"] = 37
            with self.assertRaisesRegex(ModelCapabilityImportInvalid, "image_profile_conflict"):
                matrix.import_bundle(bundle=bundle, actor_id="admin", apply=True)
            self.assertEqual([], workbench.snapshot()["published"]["capabilities"])
            edit = copy.deepcopy(choice)
            edit["operation"] = "image.edit"
            edit["inputs"]["image"] = 2
            bundle["models"][0]["operations"].append(edit)
            result = matrix.import_bundle(bundle=bundle, actor_id="admin", apply=True)
            self.assertTrue(result["applied"])

    def test_research_context_exposes_only_host_and_keeps_route_media_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix = ModelCapabilityMatrix(inventory=inventory, catalog=FakeCatalog(),
                workbench=ModelCapabilityWorkbench(Path(directory) / "workbench.json"),
                providers=lambda: [{"id": "first", "protocol": "apimart",
                    "base_url": "https://user:secret@api.example.org/private?key=secret", "api_key": "secret"}])
            row = matrix.snapshot()["models"][0]
            self.assertEqual("api.example.org", row["providers"][0]["service_host"])
            self.assertNotIn("secret", str(row))
            self.assertEqual("image", row["variants"][0]["type"])
            schema = row["import_schemas"]["image.generate"]["properties"]
            self.assertIn("0.5K", schema["resolutions"]["items"]["enum"])
            self.assertEqual(100, schema["output_count_maximum"]["maximum"])

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
                                "image": 0,
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
