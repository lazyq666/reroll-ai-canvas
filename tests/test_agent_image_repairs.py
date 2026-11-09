"""Real HTTP/SQLite acceptance for Agent authoring of existing repair drafts."""

import asyncio
import copy
import io
import time
import unittest

from PIL import Image

from infinite_canvas.canvas_sync import RealtimeSession
from infinite_canvas.canvas_store import CanvasIntent
from tests import test_agent_api as base


class AgentImageRepairTests(unittest.TestCase):
    def setUp(self):
        base.AgentApiTests.setUp(self)
        self.endpoint = "/api/agent/v1/canvases/canvas-test"
        self.path = self.endpoint + "/image-repairs/source-0"
        self.capability = {"inputs": {"image": {"maximum": 1}},
            "parameters": {"aspect_ratio": {"values": ["1:1", "3:2"]},
                           "resolution_tier": {"values": ["1K", "2K"]}, "count": {"maximum": 2}},
            "output": {"count": {"maximum": 2}}, "media_contract": {"supports_transparent_png": True}}
        self.api.resolve_model = lambda *args: copy.deepcopy(self.capability)
        self.api.models = lambda: [{"kind": "image", "provider_id": "fixture", "model": "image"}]
        buf = io.BytesIO()
        Image.new("RGB", (1000, 800), "wheat").save(buf, "PNG")
        self.original = self.media.import_bytes(buf.getvalue(), name="source.png", content_type="image/png").public()
        self.mutate({"node_updates": [{"id": "source-0", "path": ["images"], "value": [self.original]}]})
        self.changes = {"prompt": "修复两只眼睛，保留颜色和位置。", "strokes": [
            {"tool": "brush", "size": 30, "points": [{"x": 300, "y": 240}, {"x": 480, "y": 260}]},
            {"tool": "rectangle", "points": [{"x": 550, "y": 220}, {"x": 600, "y": 280}]}],
            "model": {"provider_id": "fixture", "model": "image"}}

    def document(self):
        return self.sync.read("canvas-test", self.admin, write=True)

    def mutate(self, changes):
        return asyncio.run(self.sync.commit_staged_operation("canvas-test", self.admin, {
            "operation_id": "fixture:" + str(time.time_ns()), "base_revision": self.document()["revision"], "changes": changes}))

    def detail(self):
        result = self.client.get(self.path)
        self.assertEqual(200, result.status_code, result.text)
        return result.json()

    def save(self, changes=None, revision=None, key="repair-save", dry_run=False):
        return self.client.patch(self.path, headers={"Idempotency-Key": key}, json={
            "changes": changes if changes is not None else self.changes,
            "expected_revision": revision or self.detail()["revision"], "image_index": 0, "dry_run": dry_run})

    def enqueue(self, revision=None, key="repair-run"):
        return self.client.post(self.endpoint + "/run-requests", headers={"Idempotency-Key": key}, json={
            "node_ids": ["source-0"], "image_repair": {"image_index": 0, "expected_revision": revision or self.detail()["revision"]}})

    def claim(self, row):
        session = RealtimeSession(canvas_id="canvas-test", client_id="editor-a", websocket="a",
                                  actor_id=self.admin["id"], access_epoch=0, access_scope={}, revision=0)
        asyncio.run(self.api.handle_run_message(session, self.admin, {"type": "agent_run_claim", "id": row["id"]}))
        return self.notifier.sent[-1][1]

    def test_dry_run_save_readback_retry_and_manual_draft_compatibility(self):
        initial, before = self.detail(), self.document()
        self.assertEqual((1000, 800), (initial["width"], initial["height"]))
        trial = self.save(revision=initial["revision"], dry_run=True)
        self.assertEqual(200, trial.status_code, trial.text)
        self.assertFalse(trial.json()["persisted"])
        self.assertEqual(before, self.document())
        saved = self.save(revision=initial["revision"])
        self.assertEqual(200, saved.status_code, saved.text)
        detail = self.detail()
        self.assertEqual(self.changes["prompt"], detail["draft"]["prompt"])
        self.assertEqual(self.changes["strokes"][0], detail["draft"]["strokes"][0])
        self.assertEqual(saved.json()["after"], {k: v for k, v in detail.items() if k != "run_requests"})
        source = self.document()["nodes"][0]
        self.assertEqual([self.original], source["images"])
        self.assertEqual(self.original["media_id"], next(iter(source["localRepairDrafts"])))
        self.assertEqual(3, len(self.document()["nodes"]))
        self.assertEqual([], self.api.run_items(self.admin, "canvas-test"))
        self.assertTrue(self.save(revision=initial["revision"]).json()["duplicate"])
        self.assertEqual("revision_conflict", self.save(revision=initial["revision"], key="stale").json()["code"])

    def test_partial_edit_preserves_other_media_drafts_and_manual_crop(self):
        self.save()
        source = self.document()["nodes"][0]
        key = self.original["media_id"]
        draft = source["localRepairDrafts"][key]
        draft["box"] = {"x": 240, "y": 160, "width": 480, "height": 320, "ratio": "3:2"}
        draft["promptHtml"] = "<span>Keep the old instruction</span>"
        draft["references"] = [{"url": self.original["url"], "kind": "image", "inputInstanceId": "reference-1"}]
        self.mutate({"node_updates": [{"id": "source-0", "path": ["localRepairDrafts"], "value": {key: draft, "other": {"prompt": "keep"}}}]})
        updated = self.save({"prompt": "Only the left eye"}, key="prompt-only")
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual(draft["box"], self.detail()["crop"])
        changed_draft = self.document()["nodes"][0]["localRepairDrafts"][key]
        self.assertNotIn("promptHtml", changed_draft)
        self.assertEqual(draft["references"], changed_draft["references"])
        self.assertEqual({"prompt": "keep"}, self.document()["nodes"][0]["localRepairDrafts"]["other"])
        self.save({"strokes": []}, key="clear")
        self.assertIsNone(self.detail()["crop"])
        self.assertEqual("repair_draft_incomplete", self.enqueue().json()["code"])

    def test_default_model_prefers_sunburst_over_gpt_image_2(self):
        self.api.models = lambda: [
            {"kind": "image", "provider_id": "fixture", "model": "gpt-image-2"},
            {"kind": "image", "provider_id": "fixture", "model": "gpt-image-2.5-sunburst"},
        ]
        changes = {key: value for key, value in self.changes.items() if key != "model"}
        result = self.save(changes)
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual("gpt-image-2.5-sunburst", self.detail()["draft"]["model"]["model"])

    def test_rejects_bad_coordinates_size_and_model_without_canvas_changes(self):
        before = self.document()
        bad = [({"strokes": [{"tool": "brush", "points": [{"x": 1001, "y": 2}]}]}, "repair_point_out_of_bounds"),
               ({"strokes": [{"tool": "brush", "size": 0, "points": [{"x": 2, "y": 2}]}]}, "invalid_brush_size"),
               ({"strokes": [{"tool": "rectangle", "points": [{"x": 1, "y": 1}, {"x": 1, "y": 2}]}]}, "empty_repair_selection"),
               ({"aspect_ratio": "21:9"}, "invalid_repair_ratio"),
               ({"count": 3}, "invalid_repair_count"),
               ({"resolution_tier": "4K"}, "invalid_repair_resolution"),
               ({"model": {"provider_id": "missing", "model": "image"}}, "repair_model_unavailable"),
               ({"mask": "unrelated"}, "invalid_repair_changes")]
        for index, (changes, code) in enumerate(bad):
            with self.subTest(code=code):
                self.assertEqual(code, self.save(changes, key=f"bad-{index}").json()["code"])
                self.assertEqual(before, self.document())

    def test_replaced_image_rejects_old_revision(self):
        revision = self.detail()["revision"]
        self.mutate({"node_updates": [{"id": "source-0", "path": ["images"], "value": [{**self.original, "name": "replacement"}]}]})
        self.assertEqual("revision_conflict", self.save(revision=revision).json()["code"])

    def test_old_panel_model_id_preserves_its_nondefault_selection(self):
        self.save()
        models = [{"id": "default", "kind": "image", "provider_id": "fixture", "model": "image"},
                  {"id": "old-hashed-option-id", "kind": "image", "provider_id": "fixture", "model": "second"}]
        self.api.models = lambda: models
        key = self.original["media_id"]
        old = self.document()["nodes"][0]["localRepairDrafts"][key]
        old.pop("modelIdentity")
        old["model"] = "old-hashed-option-id"
        self.mutate({"node_updates": [{"id": "source-0", "path": ["localRepairDrafts", key], "value": old}]})
        self.assertEqual("second", self.detail()["draft"]["model"]["model"])
        result = self.save({"prompt": "Keep the manually selected model"}, key="old-model")
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual("second", self.detail()["draft"]["model"]["model"])
        models.pop()
        self.assertEqual("repair_model_unavailable", self.save({"prompt": "Hidden model"}, key="hidden").json()["code"])

    def test_undo_and_run_confirmation_scope_and_duplicate(self):
        saved = self.save().json()
        undo = self.client.post(self.endpoint + "/submissions/" + saved["submission_id"] + "/undo", json={}, headers={"Idempotency-Key": "undo"})
        self.assertEqual(200, undo.status_code, undo.text)
        self.assertFalse(self.detail()["has_draft"])
        saved = self.save(key="again").json()
        self.auth.save_agent_settings(self.admin, {"confirmation": True})
        row = self.enqueue().json()["requests"][0]
        self.assertEqual("awaiting_confirmation", row["state"])
        self.assertFalse(self.claim(row)["claimed"])
        self.assertEqual(row["id"], self.enqueue().json()["requests"][0]["id"])
        undo = self.client.post(self.endpoint + "/submissions/" + saved["submission_id"] + "/undo", json={}, headers={"Idempotency-Key": "undo-running"})
        self.assertEqual("undo_blocked_by_run", undo.json()["code"])
        token = self.auth.create_agent_token(self.admin, "readonly-run", ["authoring"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        self.assertEqual("run_scope_required", self.enqueue(key="no-run-scope").json()["code"])

    def test_claim_rechecks_draft_and_recovers_persisted_output_without_rerunning(self):
        self.save()
        row = self.enqueue().json()["requests"][0]
        self.assertTrue(self.claim(row)["claimed"])
        # Lost ACK / closed editor: output slots were already saved before the
        # Provider call, so a recovered lease must not create a second set.
        node = {"id": "repair-output", "type": "smart-image", "x": 350, "y": 0, "w": 280, "h": 220,
                "images": [], "referenceGenerationKind": "image", "agentRepairRequestId": row["id"]}
        self.mutate({"node_creates": [self.api.creation(node)]})
        with self.api.data() as state:
            state["runs"][row["id"]]["lease_until"] = time.time() - 1
        claim = self.claim(row)
        self.assertFalse(claim["claimed"])
        self.assertEqual("submitted", claim["state"])
        self.assertEqual(["repair-output"], self.detail()["run_requests"][0]["output_node_ids"])
        row = self.enqueue(key="next-run").json()["requests"][0]
        self.save({"prompt": "Updated by a human"}, key="edit-after-enqueue")
        self.assertFalse(self.claim(row)["claimed"])
        self.assertEqual("revision_conflict", next(r for r in self.detail()["run_requests"] if r["id"] == row["id"])["error"])

    def test_forbidden_canvas_and_disabled_access(self):
        self.store.commit("private-test", self.admin, CanvasIntent.import_canvas(
            {**self.document(), "id": "private-test", "visibility": "private"}, operation_id="private:import"))
        token = self.auth.create_agent_token(self.other, "other", ["authoring", "run"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        self.assertEqual(403, self.client.get(self.path.replace("canvas-test", "private-test")).status_code)
        self.auth.save_agent_settings(self.admin, {"enabled": False})
        self.client.headers["Authorization"] = "Bearer " + self.token["token"]
        self.assertEqual(403, self.client.get(self.path).status_code)
