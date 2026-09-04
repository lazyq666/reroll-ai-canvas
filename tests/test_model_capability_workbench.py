import tempfile
import unittest
from pathlib import Path

from backend.infinite_canvas.model_capability_workbench import (
    ModelCapabilityWorkbench,
    ModelCapabilityWorkbenchConflict,
    ModelCapabilityWorkbenchPublication,
    ModelCapabilityWorkbenchValidation,
)


class ModelCapabilityWorkbenchTests(unittest.TestCase):
    @staticmethod
    def record_seedance_evidence(workbench):
        return workbench.record_evidence(
            provider_id="jimeng",
            model_id="seedance2.0",
            operation="video.generate",
            source_type="cli_help",
            source_locator="dreamina frames2video -h",
            fetched_at="2026-09-04T10:00:00+08:00",
            applicable_version="dreamina 1.2.3",
            content_location="image_count section",
            excerpt="Supports first and last frame inputs.",
            actor_id="admin-1",
        )

    def test_traceable_evidence_survives_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-capability-workbench.json"
            workbench = ModelCapabilityWorkbench(path)

            evidence = workbench.record_evidence(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
                source_type="cli_help",
                source_locator="dreamina frames2video -h",
                fetched_at="2026-09-04T10:00:00+08:00",
                applicable_version="dreamina 1.2.3",
                content_location="image_count section",
                excerpt="Supports first and last frame inputs.",
                actor_id="admin-1",
            )

            reopened = ModelCapabilityWorkbench(path).snapshot()

            self.assertEqual(evidence["id"], reopened["evidence"][0]["id"])
            self.assertEqual("jimeng", reopened["evidence"][0]["provider_id"])
            self.assertEqual("video.generate", reopened["evidence"][0]["operation"])

    def test_evidence_requires_a_traceable_content_location(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )

            with self.assertRaises(ModelCapabilityWorkbenchValidation):
                workbench.record_evidence(
                    provider_id="jimeng",
                    model_id="seedance2.0",
                    operation="video.generate",
                    source_type="cli_help",
                    source_locator="dreamina frames2video -h",
                    fetched_at="2026-09-04T10:00:00+08:00",
                    applicable_version="dreamina 1.2.3",
                    content_location="",
                    excerpt="Supports first and last frame inputs.",
                    actor_id="admin-1",
                )

    def test_draft_requires_field_level_evidence_from_the_same_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)
            capability = {
                "support_state": "supported",
                "inputs": {},
                "output": {},
                "parameters": {},
            }

            with self.assertRaises(ModelCapabilityWorkbenchValidation):
                workbench.save_draft(
                    provider_id="jimeng",
                    model_id="seedance2.0",
                    operation="video.generate",
                    capability=capability,
                    field_evidence={},
                    base_catalog_revision="catalog-before-edit",
                    actor_id="admin-1",
                )

            draft = workbench.save_draft(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
                capability=capability,
                field_evidence={
                    "/support_state": {
                        "evidence_ids": [evidence["id"]],
                        "confidence": "high",
                    }
                },
                base_catalog_revision="catalog-before-edit",
                actor_id="admin-1",
            )

            self.assertEqual("draft", draft["review_state"])
            self.assertEqual("catalog-before-edit", draft["base_catalog_revision"])
            self.assertEqual([], workbench.snapshot()["published"]["capabilities"])

    def test_reviewed_draft_publishes_one_atomic_catalog_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-capability-workbench.json"
            workbench = ModelCapabilityWorkbench(path)
            evidence = self.record_seedance_evidence(workbench)
            draft = workbench.save_draft(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
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
                base_catalog_revision="catalog-before-edit",
                actor_id="author-1",
            )

            with self.assertRaises(ModelCapabilityWorkbenchConflict):
                workbench.publish(
                    draft["id"],
                    actor_id="reviewer-1",
                    active_catalog_revision="catalog-before-edit",
                )

            submitted = workbench.submit_for_review(
                draft["id"], actor_id="author-1"
            )
            published = workbench.publish(
                submitted["id"],
                actor_id="reviewer-1",
                active_catalog_revision="catalog-before-edit",
            )
            reopened = ModelCapabilityWorkbench(path).snapshot()

            self.assertEqual("published", published["review_state"])
            self.assertEqual("reviewer-1", published["reviewed_by"])
            self.assertEqual(1, len(reopened["published"]["capabilities"]))
            self.assertEqual(
                draft["id"],
                reopened["published"]["capabilities"][0]["draft_id"],
            )

    def test_publish_rejects_a_draft_based_on_a_stale_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)
            draft = workbench.save_draft(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
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
                base_catalog_revision="old-catalog",
                actor_id="author-1",
            )
            workbench.submit_for_review(draft["id"], actor_id="author-1")

            with self.assertRaises(ModelCapabilityWorkbenchConflict):
                workbench.publish(
                    draft["id"],
                    actor_id="reviewer-1",
                    active_catalog_revision="new-catalog",
                )

            self.assertEqual([], workbench.snapshot()["published"]["capabilities"])

    def test_returned_draft_can_be_edited_and_submitted_again(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)
            binding = {
                "/support_state": {
                    "evidence_ids": [evidence["id"]],
                    "confidence": "high",
                }
            }
            draft = workbench.save_draft(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
                capability={
                    "support_state": "supported",
                    "inputs": {},
                    "output": {},
                    "parameters": {},
                },
                field_evidence=binding,
                base_catalog_revision="catalog-1",
                actor_id="author-1",
            )
            workbench.submit_for_review(draft["id"], actor_id="author-1")

            returned = workbench.return_for_changes(
                draft["id"], actor_id="reviewer-1", note="Evidence is incomplete."
            )
            edited = workbench.save_draft(
                draft_id=draft["id"],
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
                capability={
                    "support_state": "unknown",
                    "inputs": {},
                    "output": {},
                    "parameters": {},
                },
                field_evidence=binding,
                base_catalog_revision="catalog-1",
                actor_id="author-1",
            )
            resubmitted = workbench.submit_for_review(
                draft["id"], actor_id="author-1"
            )

            self.assertEqual("returned", returned["review_state"])
            self.assertEqual("Evidence is incomplete.", returned["review_note"])
            self.assertEqual(draft["id"], edited["id"])
            self.assertEqual("draft", edited["review_state"])
            self.assertEqual("in_review", resubmitted["review_state"])

    def test_draft_rejects_contradictory_capability_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)
            binding = {
                "evidence_ids": [evidence["id"]],
                "confidence": "high",
            }

            with self.assertRaises(ModelCapabilityWorkbenchValidation):
                workbench.save_draft(
                    provider_id="jimeng",
                    model_id="seedance2.0",
                    operation="video.generate",
                    capability={
                        "support_state": "supported",
                        "inputs": {},
                        "output": {},
                        "parameters": {
                            "duration_seconds": {
                                "type": "integer",
                                "minimum": 10,
                                "maximum": 5,
                            }
                        },
                    },
                    field_evidence={
                        "/support_state": binding,
                        "/parameters/duration_seconds/type": binding,
                        "/parameters/duration_seconds/minimum": binding,
                        "/parameters/duration_seconds/maximum": binding,
                    },
                    base_catalog_revision="catalog-1",
                    actor_id="admin-1",
                )

    def test_failed_catalog_activation_rolls_back_the_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)
            draft = workbench.save_draft(
                provider_id="jimeng",
                model_id="seedance2.0",
                operation="video.generate",
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
                base_catalog_revision="catalog-1",
                actor_id="author-1",
            )
            workbench.submit_for_review(draft["id"], actor_id="author-1")

            with self.assertRaises(ModelCapabilityWorkbenchPublication):
                workbench.publish(
                    draft["id"],
                    actor_id="reviewer-1",
                    active_catalog_revision="catalog-1",
                    activate=lambda: {"ok": False, "error": "invalid source"},
                )

            snapshot = workbench.snapshot()
            self.assertEqual("in_review", snapshot["drafts"][0]["review_state"])
            self.assertEqual([], snapshot["published"]["capabilities"])

    def test_field_evidence_rejects_unreviewed_extra_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            workbench = ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            )
            evidence = self.record_seedance_evidence(workbench)

            with self.assertRaises(ModelCapabilityWorkbenchValidation):
                workbench.save_draft(
                    provider_id="jimeng",
                    model_id="seedance2.0",
                    operation="video.generate",
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
                            "price": 1,
                        }
                    },
                    base_catalog_revision="catalog-1",
                    actor_id="admin-1",
                )


if __name__ == "__main__":
    unittest.main()
