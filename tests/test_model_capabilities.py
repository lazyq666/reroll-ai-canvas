import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.image_capabilities import ImageCapabilityRegistry
from infinite_canvas.model_capabilities import (
    ModelCapabilityCatalog,
    ModelCapabilityContext,
)
from infinite_canvas.model_capability_workbench import ModelCapabilityWorkbench
from infinite_canvas.video_capabilities import VideoCapabilityRegistry


ROOT = Path(__file__).resolve().parents[1]


def catalog(*, published_path=None) -> ModelCapabilityCatalog:
    return ModelCapabilityCatalog(
        image_registry=ImageCapabilityRegistry(
            ROOT / "resources" / "image-model-capabilities.json"
        ),
        video_registry=VideoCapabilityRegistry(
            ROOT / "resources" / "video-model-capabilities.json"
        ),
        text_path=ROOT / "resources" / "text-model-capabilities.json",
        revision_paths=(
            ROOT / "resources" / "image-model-capabilities.json",
            ROOT / "resources" / "video-model-capabilities.json",
            ROOT / "resources" / "text-model-capabilities.json",
        ),
        published_path=published_path,
    )


class ModelCapabilityCatalogTests(unittest.TestCase):
    def test_exact_image_operation_has_unified_identity_and_typed_contract(self):
        capability = catalog().resolve(
            "apimart",
            "gpt-image-2-official",
            "image.edit",
            context=ModelCapabilityContext(image_reference_maximum=20),
        )

        self.assertEqual("apimart", capability["provider_id"])
        self.assertEqual("gpt-image-2-official", capability["model_id"])
        self.assertEqual("image.edit", capability["operation"])
        self.assertEqual(1, capability["capability_schema_version"])
        self.assertEqual("supported", capability["support_state"])
        self.assertTrue(capability["catalog_revision"])
        self.assertEqual(1, capability["inputs"]["image"]["minimum"])
        self.assertEqual(20, capability["inputs"]["image"]["maximum"])
        self.assertNotIn("support_state", capability["inputs"]["image"])
        self.assertNotIn("support_state", capability["parameters"]["transparent_png"])
        self.assertEqual("image", capability["output"]["kind"])
        self.assertEqual(4, capability["output"]["count"]["maximum"])

    def test_known_model_marks_unconfirmed_operation_unknown(self):
        capability = catalog().resolve(
            "apimart", "gpt-image-2", "image.layer_decomposition"
        )

        self.assertEqual("unknown", capability["support_state"])

    def test_seedream_layer_decomposition_has_a_dedicated_typed_contract(self):
        capability = catalog().resolve(
            "apimart", "seedream-5-0-pro", "image.layer_decomposition"
        )

        self.assertEqual("supported", capability["support_state"])
        self.assertEqual(
            {"minimum": 0, "maximum": 1, "required": False},
            capability["inputs"]["text"],
        )
        self.assertEqual(1, capability["inputs"]["image"]["minimum"])
        self.assertEqual(1, capability["inputs"]["image"]["maximum"])
        self.assertEqual(["source"], capability["inputs"]["image"]["roles"])
        self.assertEqual(
            {"resolution_tier", "count"}, set(capability["parameters"])
        )
        self.assertEqual(
            ["auto", "1K", "1.5K", "2K"],
            capability["parameters"]["resolution_tier"]["values"],
        )
        self.assertEqual(
            {"minimum": 1, "maximum": 1, "default": 1},
            {
                key: capability["parameters"]["count"][key]
                for key in ("minimum", "maximum", "default")
            },
        )

        output = capability["output"]
        self.assertEqual("image_layer_decomposition", output["kind"])
        self.assertEqual(
            {"minimum": 1, "maximum": 1, "default": 1}, output["count"]
        )
        manifest = output["manifest"]
        self.assertEqual(1, manifest["manifest_version"])
        self.assertEqual(
            [
                "manifest_version",
                "source_media_id",
                "provider_id",
                "model",
                "resolution_tier",
                "generation_run_id",
                "upstream_task_id",
                "created_at",
                "base_output_media_id",
                "canvas_width",
                "canvas_height",
                "layers",
            ],
            manifest["required_fields"],
        )
        layers = manifest["fields"]["layers"]
        self.assertEqual(1, layers["minimum"])
        self.assertEqual(16, layers["maximum"])
        self.assertEqual(
            [
                "output_media_id",
                "name",
                "description",
                "z_index",
                "absolute_bbox",
                "normalized_bbox",
                "pixel_width",
                "pixel_height",
                "output_format",
            ],
            layers["items"]["required_fields"],
        )
        normalized_bbox = layers["items"]["fields"]["normalized_bbox"]
        self.assertEqual(["left", "top", "right", "bottom"], normalized_bbox["order"])
        self.assertEqual(0, normalized_bbox["item_minimum"])
        self.assertEqual(1000, normalized_bbox["item_maximum"])

    def test_seedream_layer_decomposition_enforces_inputs_resolution_and_count(self):
        registry = catalog()
        capability = registry.resolve(
            "apimart", "seedream-5-0-pro", "image.layer_decomposition"
        )
        revision = capability["catalog_revision"]

        valid = registry.validate(
            capability,
            input_counts={"image": 1},
            parameters={"resolution_tier": "2K", "count": 1},
            catalog_revision=revision,
        )
        missing_image = registry.validate(
            capability,
            input_counts={},
            parameters={"resolution_tier": "2K", "count": 1},
            catalog_revision=revision,
        )
        extra_image = registry.validate(
            capability,
            input_counts={"image": 2},
            parameters={"resolution_tier": "2K", "count": 1},
            catalog_revision=revision,
        )
        unsupported_resolution = registry.validate(
            capability,
            input_counts={"image": 1},
            parameters={"resolution_tier": "4K", "count": 1},
            catalog_revision=revision,
        )
        extra_output = registry.validate(
            capability,
            input_counts={"image": 1},
            parameters={"resolution_tier": "2K", "count": 2},
            catalog_revision=revision,
        )
        irrelevant_parameter = registry.validate(
            capability,
            input_counts={"image": 1},
            parameters={
                "resolution_tier": "2K",
                "count": 1,
                "aspect_ratio": "1:1",
            },
            catalog_revision=revision,
        )

        self.assertTrue(valid["valid"])
        self.assertEqual("input_minimum", missing_image["errors"][0]["code"])
        self.assertEqual("input_maximum", extra_image["errors"][0]["code"])
        self.assertEqual(
            "parameter_value", unsupported_resolution["errors"][0]["code"]
        )
        self.assertEqual("parameter_maximum", extra_output["errors"][0]["code"])
        self.assertEqual(
            "parameter_unknown", irrelevant_parameter["errors"][0]["code"]
        )

    def test_unknown_model_is_explicit_and_keeps_only_compatibility_limits(self):
        capability = catalog().resolve("custom", "future-model", "image.edit")

        self.assertEqual("unknown", capability["support_state"])
        self.assertNotIn("support_state", capability["inputs"]["image"])
        self.assertEqual("fallback", capability["source"])

    def test_video_and_text_share_the_same_outer_contract(self):
        registry = catalog()
        video = registry.resolve("jimeng", "seedance2.5", "video.generate")
        text = registry.resolve(
            "codex",
            "gpt-5.5",
            "text.generate",
            context=ModelCapabilityContext(
                text_image_maximum=8,
                text_video_maximum=3,
                text_history_maximum=30,
            ),
        )

        self.assertEqual("supported", video["support_state"])
        self.assertIn("commands", video["media_contract"])
        self.assertEqual("unknown", text["support_state"])
        self.assertEqual(8, text["inputs"]["image"]["maximum"])
        self.assertEqual(3, text["inputs"]["video"]["maximum"])
        self.assertEqual(30, text["parameters"]["history"]["maximum"])
        self.assertNotIn("support_state", text["inputs"]["audio"])

        unknown_video = registry.resolve(
            "runninghub", "future-video", "video.generate"
        )
        self.assertEqual("unknown", unknown_video["support_state"])
        self.assertEqual(10, unknown_video["inputs"]["image"]["maximum"])
        self.assertEqual(60, unknown_video["parameters"]["duration_seconds"]["maximum"])

    def test_video_input_rules_validate_total_and_cross_media_dependency(self):
        registry = catalog()
        capability = registry.resolve(
            "jimeng", "seedance2.0", "video.generate"
        )

        audio_only = registry.validate(
            capability,
            input_counts={"text": 1, "audio": 1},
            parameters={"duration_seconds": 5, "resolution": "720p"},
            catalog_revision=capability["catalog_revision"],
        )
        total_overflow = registry.validate(
            capability,
            input_counts={"text": 1, "image": 9, "video": 3, "audio": 1},
            parameters={"duration_seconds": 5, "resolution": "720p"},
            catalog_revision=capability["catalog_revision"],
        )

        self.assertEqual(12, capability["input_rules"]["totals"][0]["maximum"])
        self.assertEqual("input_combination", audio_only["errors"][0]["code"])
        self.assertEqual("visual_reference", audio_only["errors"][0]["field"])
        self.assertEqual("input_total_maximum", total_overflow["errors"][0]["code"])
        self.assertEqual("reference_media", total_overflow["errors"][0]["field"])

    def test_video_input_rules_validate_first_last_frame_role_order(self):
        registry = catalog()
        capability = registry.resolve(
            "jimeng", "seedance2.0", "video.generate"
        )

        result = registry.validate(
            capability,
            input_counts={"text": 1, "image": 2},
            input_roles={"image": ["last_frame", "first_frame"]},
            parameters={"duration_seconds": 5, "resolution": "720p"},
            catalog_revision=capability["catalog_revision"],
        )

        self.assertEqual("input_role", result["errors"][0]["code"])
        self.assertEqual("image", result["errors"][0]["field"])

    def test_only_published_workbench_capabilities_change_the_runtime_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench_path = Path(directory) / "model-capability-workbench.json"
            workbench = ModelCapabilityWorkbench(workbench_path)
            registry = catalog(published_path=workbench_path)
            original_revision = registry.revision
            original = registry.resolve("codex", "gpt-5.5", "text.generate")
            evidence = workbench.record_evidence(
                provider_id="codex",
                model_id="gpt-5.5",
                operation="text.generate",
                source_type="official_docs",
                source_locator="https://example.test/models/gpt-5.5",
                fetched_at="2026-09-04T10:00:00+08:00",
                applicable_version="2026-09-04",
                content_location="Supported operations",
                excerpt="The model supports text generation.",
                actor_id="admin-1",
            )
            draft = workbench.save_draft(
                provider_id="codex",
                model_id="gpt-5.5",
                operation="text.generate",
                capability={
                    "support_state": "supported",
                    "inputs": {},
                    "output": {},
                    "parameters": {},
                },
                field_evidence={
                    "/support_state": {
                        "evidence_ids": [evidence["id"]],
                        "confidence": "high",
                    }
                },
                base_catalog_revision=original_revision,
                actor_id="admin-1",
            )

            draft_refresh = registry.refresh()
            workbench.submit_for_review(draft["id"], actor_id="admin-1")
            workbench.publish(
                draft["id"],
                actor_id="admin-2",
                active_catalog_revision=original_revision,
            )
            published_refresh = registry.refresh()
            published = registry.resolve("codex", "gpt-5.5", "text.generate")

            self.assertEqual("unknown", original["support_state"])
            self.assertEqual(original_revision, draft_refresh["catalog_revision"])
            self.assertNotEqual(
                original_revision, published_refresh["catalog_revision"]
            )
            self.assertEqual("supported", published["support_state"])
            self.assertTrue(published["inputs"])
            self.assertTrue(published["parameters"])

    def test_validation_rejects_catalog_change_and_input_overflow(self):
        registry = catalog()
        capability = registry.resolve(
            "codex",
            "gpt-5.5",
            "text.generate",
            context=ModelCapabilityContext(text_image_maximum=8),
        )

        changed = registry.validate(
            capability,
            input_counts={"text": 1},
            parameters={},
            catalog_revision="stale-client-revision",
        )
        overflow = registry.validate(
            capability,
            input_counts={"text": 1, "image": 9},
            parameters={},
            catalog_revision=capability["catalog_revision"],
        )

        self.assertFalse(changed["valid"])
        self.assertEqual("catalog_changed", changed["errors"][0]["code"])
        self.assertFalse(overflow["valid"])
        self.assertEqual("input_maximum", overflow["errors"][0]["code"])
        self.assertEqual("image", overflow["errors"][0]["field"])

    def test_validation_rejects_missing_catalog_revision_before_other_rules(self):
        registry = catalog()
        capability = registry.resolve(
            "apimart", "gpt-image-2", "image.generate"
        )

        result = registry.validate(
            capability,
            input_counts={"text": 1},
            parameters={"count": 1},
        )

        self.assertFalse(result["valid"])
        self.assertEqual("catalog_changed", result["errors"][0]["code"])
        self.assertEqual("", result["errors"][0]["actual"])

    def test_unknown_state_does_not_block_but_concrete_parameter_limits_do(self):
        registry = catalog()
        operation = registry.resolve(
            "apimart", "gpt-image-2", "image.layer_decomposition"
        )
        image = registry.resolve(
            "apimart", "gpt-image-2", "image.generate"
        )

        unknown_operation = registry.validate(
            operation,
            input_counts={"text": 1},
            parameters={},
            catalog_revision=operation["catalog_revision"],
        )
        invalid_parameter = registry.validate(
            image,
            input_counts={"text": 1},
            parameters={"transparent_png": True},
            catalog_revision=image["catalog_revision"],
        )

        self.assertTrue(unknown_operation["valid"])
        self.assertEqual("parameter_value", invalid_parameter["errors"][0]["code"])

    def test_public_contract_uses_only_supported_or_unknown_states(self):
        registry = catalog()
        capabilities = [
            registry.resolve("apimart", "gpt-image-2", "image.generate"),
            registry.resolve("jimeng", "seedance2.5", "video.generate"),
            registry.resolve("codex", "gpt-5.5", "text.generate"),
        ]
        states = []

        def collect(value):
            if isinstance(value, dict):
                if "support_state" in value:
                    states.append(value["support_state"])
                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        collect(capabilities)
        self.assertTrue(states)
        self.assertLessEqual(set(states), {"supported", "unknown"})

    def test_validation_rejects_fractional_input_counts(self):
        registry = catalog()
        capability = registry.resolve(
            "apimart", "gpt-image-2", "image.edit"
        )

        result = registry.validate(
            capability,
            input_counts={"text": 1, "image": 1.5},
            parameters={"count": 1},
            catalog_revision=capability["catalog_revision"],
        )

        self.assertFalse(result["valid"])
        self.assertEqual("input_invalid", result["errors"][0]["code"])

    def test_revision_changes_when_any_media_contract_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            image = directory / "image.json"
            video = directory / "video.json"
            text = directory / "text.json"
            image.write_text('{"version":1,"capabilities":[]}', encoding="utf-8")
            video.write_text('{"version":1}', encoding="utf-8")
            text.write_text('{"version":1,"capabilities":[]}', encoding="utf-8")
            first = ModelCapabilityCatalog(
                image_registry=ImageCapabilityRegistry(image),
                video_registry=VideoCapabilityRegistry(video),
                text_path=text,
                revision_paths=(image, video, text),
            )
            old_revision = first.revision
            text.write_text(
                json.dumps({"version": 2, "capabilities": []}), encoding="utf-8"
            )
            refreshed = first.refresh()

        self.assertTrue(refreshed["ok"])
        self.assertNotEqual(old_revision, refreshed["catalog_revision"])

    def test_failed_refresh_keeps_the_last_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            image = directory / "image.json"
            video = directory / "video.json"
            text = directory / "text.json"
            image.write_text(
                json.dumps({
                    "version": 1,
                    "capabilities": [{
                        "provider_id": "demo",
                        "model_id": "image-1",
                        "operations": ["image.generate"],
                        "aspect_ratios": ["1:1"],
                        "resolution_tiers": ["1K"],
                    }],
                }),
                encoding="utf-8",
            )
            video.write_text('{"version":1}', encoding="utf-8")
            text.write_text('{"version":1,"capabilities":[]}', encoding="utf-8")
            registry = ModelCapabilityCatalog(
                image_registry=ImageCapabilityRegistry(image),
                video_registry=VideoCapabilityRegistry(video),
                text_path=text,
                revision_paths=(image, video, text),
            )
            old_revision = registry.revision
            image.write_text('{"version":1,"capabilities":[', encoding="utf-8")
            failed = registry.refresh()
            capability = registry.resolve("demo", "image-1", "image.generate")

        self.assertFalse(failed["ok"])
        self.assertEqual(old_revision, failed["catalog_revision"])
        self.assertEqual(old_revision, capability["catalog_revision"])
        self.assertEqual("supported", capability["support_state"])

    def test_public_contract_contains_no_pricing_or_consumption_fields(self):
        capability = catalog().resolve(
            "apimart", "gpt-image-2-official", "image.generate"
        )
        serialized = json.dumps(capability, ensure_ascii=False).lower()

        for forbidden in (
            "price",
            "pricing",
            "billing",
            "charge",
            "credit",
            "cost",
            "currency",
            "fee",
            "quota_balance",
            "usage",
            "价格",
            "计价",
            "计费",
            "消耗",
            "积分",
            "费用",
            "金额",
            "货币",
            "余额",
        ):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
