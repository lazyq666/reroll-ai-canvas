"""P0 persisted editing acceptance, using only an isolated Workspace and fake catalog."""

import asyncio
import base64
import copy
import io
import json
import subprocess
import unittest
from pathlib import Path

from PIL import Image

from infinite_canvas.agent_api import mention_html
from infinite_canvas import agent_inputs
from infinite_canvas.canvas_store import CanvasIntent
from tests import test_agent_api as base


class AgentTaskEditingTests(unittest.TestCase):
    def setUp(self):
        base.AgentApiTests.setUp(self)
        self.endpoint = "/api/agent/v1/canvases/canvas-test"
        self.capability = copy.deepcopy(base.CAPABILITY)
        self.capability.update(support_state="supported")
        self.capability["inputs"]["image"]["maximum"] = 6
        self.capability["parameters"].update({
            "duration_seconds": {"type": "integer", "minimum": 1, "maximum": 15},
            "aspect_ratio": {"type": "enum", "values": ["3:4", "16:9"]},
            "resolution": {"type": "enum", "values": ["720p"]},
            "reference_mode": {"type": "enum", "values": ["multimodal_all_around"]},
        })
        self.api.resolve_model = lambda *args: copy.deepcopy(self.capability)
        self.images = []
        for index, color in enumerate(["red", "blue", "green", "yellow", "purple", "orange"]):
            image = Image.new("RGBA", (120, 60), color)
            image.putpixel((0, 0), (0, 0, 0, 0))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            self.images.append(self.media.import_bytes(buffer.getvalue(), name=f"参考 {index}.png", content_type="image/png").public())
        self.audio = self.media.import_bytes(b"fixture audio", name="voice.mp3", content_type="audio/mpeg").public()
        self.long_prompt = "完整中文分镜\n" * 500 + "最后限制：保留所有边缘。\n@人物 @横幅"
        mentions = {"人物": {**self.images[0], "nodeId": "source-0", "imageIndex": 0, "referenceMode": "connection"},
                    "横幅": {**self.images[5], "inputInstanceId": "mention-only"}}
        self.draft = {"id": "draft", "type": "smart-image", "referenceGenerationKind": "video",
            "x": 100, "y": 250, "w": 280, "h": 220, "images": [], "title": "UI draft",
            "promptDraftText": self.long_prompt, "promptDraftHtml": mention_html(self.long_prompt, mentions)[0],
            "manualInputRefs": [{**self.images[4], "inputInstanceId": "manual-banner"},
                                {**self.audio, "inputInstanceId": "manual-audio"}],
            "runSettings": {"engine": "api", "apiKind": "video", "videoProvider": "fixture", "videoModel": "video",
                "videoDuration": 12, "videoAspect": "3:4", "videoResolution": "720p",
                "videoReferenceMode": "multimodal_all_around", "videoMultimodal": True,
                "videoUseFrameRoles": False, "unrelatedSavedSetting": "keep"},
            "runInputRefs": [{"url": "/old/history.png"}],
            "inputRefOrder": ["source-0|0", "output|chosen", "source-2|0", "group|0",
                              "instance|manual-banner", "instance|mention-only", "instance|manual-audio"]}
        self.mutate({"node_updates": [
                {"id": "source-0", "path": ["images"], "value": [self.images[0]]},
                {"id": "source-1", "path": ["images"], "value": [
                    {**self.images[0], "outputId": "other"}, {**self.images[1], "outputId": "chosen"}]},
                {"id": "source-1", "path": ["generationOutputNode"], "value": True},
                {"id": "source-1", "path": ["activeOutputId"], "value": "other"},
                {"id": "source-2", "path": ["images"], "value": [self.images[2]]}],
            "node_creates": [self.api.creation(n) for n in [self.draft,
                {"id": "group", "type": "smart-group", "x": 0, "y": 0, "w": 400, "h": 300,
                 "items": ["source-2", "source-0"], "images": [{**self.images[3], "groupMemberId": "direct"}],
                 "memberOrderVersion": 1, "memberOrder": [{"kind": "node", "id": "source-2"},
                    {"kind": "media", "id": "direct"}, {"kind": "node", "id": "source-0"}]},
                {"id": "frame", "type": "smart-frame", "x": 80, "y": 200, "w": 500, "h": 500, "items": ["draft"]}]],
            "connection_adds": [{"from": "group", "to": "draft", "kind": "input"},
                                {"from": "source-1", "to": "draft", "kind": "input", "sourceOutputId": "chosen"}]}, "seed")

    def document(self):
        return self.sync.read("canvas-test", self.admin)

    def node(self, node_id="draft"):
        return next(n for n in self.document()["nodes"] if n["id"] == node_id)

    def mutate(self, changes, key):
        return asyncio.run(self.sync.commit_staged_operation("canvas-test", self.admin,
            {"operation_id": "fixture:" + key, "base_revision": self.document()["revision"], "changes": changes}))

    def detail(self):
        response = self.client.get(self.endpoint + "/tasks/draft")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def update(self, changes, *, revision=None, dry_run=False, key="save"):
        return self.client.patch(self.endpoint + "/tasks/draft", json={"changes": changes,
            "expected_node_revision": revision or self.detail()["node_revision"], "dry_run": dry_run,
            "refs_mode": "replace"}, headers={"Idempotency-Key": key})

    def test_full_legacy_detail_matches_ordered_effective_inputs(self):
        result = self.detail()
        self.assertEqual(self.long_prompt, result["recipe"]["prompt"])
        self.assertEqual("frame", result["frame_id"])
        self.assertTrue(result["editable"])
        self.assertTrue(result["validation"]["valid"], result["validation"])
        refs = result["resolved_inputs"]
        self.assertEqual(7, len(refs))
        self.assertEqual([1, 2, 3, 4, 5, 6, 1], [r["display_number"] for r in refs])
        self.assertEqual("chosen", refs[1]["output_id"])
        self.assertEqual("group", refs[0]["origin"])
        self.assertEqual(["group", "source-0"], refs[0]["source_path"])
        self.assertEqual("mention", refs[5]["origin"])
        self.assertEqual("manual-audio", refs[6]["input_instance_id"])
        self.assertEqual(12, result["recipe"]["params"]["duration_seconds"])
        summary = self.client.get(self.endpoint, params={"query": "UI draft"}).json()["nodes"][0]
        self.assertTrue(summary["prompt_truncated"])
        self.assertEqual(len(self.long_prompt), summary["prompt_length"])
        self.assertEqual(404, self.client.get(self.endpoint + "/tasks/missing").status_code)

    def test_preview_import_transparency_output_and_library_are_exact(self):
        for source, expected in [({"node_id": "source-1", "output_id": "chosen"}, self.images[1]),
                                 ({"media_id": self.images[4]["media_id"]}, self.images[4])]:
            result = self.client.post(self.endpoint + "/media/preview", json={"source": source, "max_edge": 64})
            self.assertEqual(200, result.status_code, result.text)
            body = result.json()
            self.assertEqual([120, 60], body["metadata"]["original_size"])
            self.assertEqual([64, 32], body["metadata"]["preview_size"])
            self.assertTrue(body["metadata"]["has_alpha"])
            self.assertEqual(expected["media_id"], body["metadata"]["content_sha256"])
            decoded = Image.open(io.BytesIO(base64.b64decode(body["image"]["data"])))
            self.assertEqual((64, 32), decoded.size)
            self.assertEqual("RGBA", decoded.mode)
        ambiguous = self.client.post(self.endpoint + "/media/preview", json={"source": {"node_id": "source-1"}})
        self.assertEqual("ambiguous_reference", ambiguous.json()["code"])
        self.assertEqual(2, len(ambiguous.json()["details"]["candidates"]))
        audio = self.client.post(self.endpoint + "/media/preview", json={"source": {"media_id": self.audio["media_id"]}})
        self.assertEqual("preview_type_unsupported", audio.json()["code"])
        from types import SimpleNamespace
        self.api.assets = lambda: SimpleNamespace(list=lambda *a, **k: {"items": [{**self.images[2], "id": "asset"}]})
        library = self.client.post(self.endpoint + "/media/preview", json={"source": {"asset_id": "asset"}})
        self.assertEqual(self.images[2]["media_id"], library.json()["metadata"]["content_sha256"])

    def test_atomic_replace_dry_run_readback_and_idempotent_retry(self):
        before, node = self.document(), self.node()
        version = self.detail()["node_revision"]
        prompt = self.long_prompt.replace("@人物 @横幅", "@图片1 @图片2 @音频1")
        changes = {"prompt": prompt, "refs": {"图片1": {"node": "source-2"},
            "图片2": {"node": "source-1", "output_id": "chosen"}, "音频1": {"media": self.audio["media_id"]}}}
        trial = self.update(changes, revision=version, dry_run=True)
        self.assertEqual(200, trial.status_code, trial.text)
        self.assertFalse(trial.json()["persisted"])
        self.assertEqual(before, self.document())
        saved = self.update(changes, revision=version)
        self.assertEqual(200, saved.status_code, saved.text)
        result = saved.json()
        self.assertTrue(result["persisted"])
        self.assertFalse(result["generation_started"])
        self.assertEqual(prompt, result["after"]["recipe"]["prompt"])
        self.assertEqual(3, len(result["after"]["resolved_inputs"]))
        current = self.detail()
        self.assertEqual(result["node_revision"], current["node_revision"])
        self.assertEqual(result["after"]["recipe"], current["recipe"])
        for key in ("runSettings", "title", "x", "y", "w", "h", "runInputRefs", "images"):
            self.assertEqual(node[key], self.node()[key], key)
        self.assertEqual("frame", current["frame_id"])
        self.assertEqual("draft", current["state"])
        with self.api.data() as state:
            self.assertEqual({}, state["runs"])
        revision = self.document()["revision"]
        again = self.update(changes, revision=version)
        self.assertEqual(200, again.status_code, again.text)
        self.assertEqual(result["after"], again.json()["after"])
        self.assertEqual(revision, self.document()["revision"])
        collision = self.update({"prompt": "different"}, revision=version)
        self.assertEqual("operation_collision", collision.json()["code"])
        self.mutate({"node_updates": [{"id": "draft", "path": ["title"], "value": "later"}]}, "later")
        self.assertEqual(result["after"], self.update(changes, revision=version).json()["after"])

    def test_conflict_guards_target_and_sources_but_not_unrelated_nodes(self):
        version = self.detail()["node_revision"]
        self.mutate({"node_updates": [{"id": "frame", "path": ["title"], "value": "unrelated"}]}, "other")
        self.assertEqual(version, self.detail()["node_revision"])
        self.assertEqual(200, self.update({"title": "renamed"}, revision=version, dry_run=True).status_code)
        self.mutate({"node_updates": [{"id": "draft", "path": ["title"], "value": "human"}]}, "human")
        before = self.document()
        for dry in (True, False):
            response = self.update({"prompt": "overwrite"}, revision=version, dry_run=dry)
            self.assertEqual("revision_conflict", response.json()["code"])
            self.assertEqual(before, self.document())

    def test_missing_unresolved_over_limit_and_unknown_are_non_mutating(self):
        invalid = [({"prompt": "new", "refs": {"x": {"node": "source-1", "output_id": "missing"}}}, "missing_reference"),
                   ({"prompt": "@图9 @6"}, "unresolved_reference"),
                   ({"params": {"duration_seconds": 200}}, "parameter_maximum")]
        before = self.document()
        for index, (changes, code) in enumerate(invalid):
            for dry in (True, False):
                response = self.update(changes, dry_run=dry, key=f"invalid-{index}")
                self.assertIn(response.status_code, (409, 422), response.text)
                details = response.json()["details"]
                self.assertIn(code, [e["code"] for e in details.get("errors", details.get("references", []))])
                self.assertEqual(before, self.document())
        self.capability["support_state"] = "unknown"
        self.assertFalse(self.detail()["validation"]["valid"])
        self.assertIn("capability_unknown", str(self.update({"title": "x"}, key="unknown").json()))
        self.assertEqual(before, self.document())

    def test_access_control_and_editability(self):
        self.mutate({"node_updates": [{"id": "draft", "path": ["running"], "value": True}]}, "running")
        self.assertFalse(self.detail()["editable"])
        self.assertEqual("node_not_editable", self.update({"title": "x"}).json()["code"])
        self.store.commit("canvas-test", self.admin, CanvasIntent.set_visibility("private", operation_id="fixture:private"))
        other_token = self.auth.create_agent_token(self.other, "other", ["authoring"])
        self.client.headers["Authorization"] = "Bearer " + other_token["token"]
        self.assertEqual(403, self.client.get(self.endpoint + "/tasks/draft").status_code)
        self.assertEqual(403, self.client.post(self.endpoint + "/media/preview", json={"source": {"node_id": "source-0"}}).status_code)

    def test_clearing_refs_does_not_resurrect_historical_inputs(self):
        history = self.node()["runInputRefs"]
        result = self.update({"prompt": "No reference. email@example.com @ordinary", "refs": {}})
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual([], self.detail()["resolved_inputs"])
        self.assertEqual(history, self.node()["runInputRefs"])
        self.assert_editor_projection()

    def assert_editor_projection(self):
        document, node = self.document(), self.node()
        tokens = agent_inputs.MentionParser(node.get("promptDraftHtml", "")).tokens
        fixture = {"canvas": document, "node": node,
                   "parts": [{"type": "image", **t} for t in tokens]}
        result = subprocess.run(["node", "tests/agent_input_projection_contract.cjs"],
            input=json.dumps(fixture), capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        actual = json.loads(result.stdout)
        expected = agent_inputs.effective_inputs(document, node)[0]
        self.assertEqual([agent_inputs.ref_key(r) for r in expected],
                         [agent_inputs.ref_key(r) for r in actual["refs"]])
        self.assertEqual([r["url"] for r in expected], [r["url"] for r in actual["refs"]])

    def test_projection_matches_existing_editor_resolver(self):
        self.assert_editor_projection()
        # Without explicit ordering, Smart Group's node/media order is authoritative.
        self.mutate({"node_updates": [{"id": "draft", "path": ["inputRefOrder"], "value": []}]}, "unordered")
        self.assert_editor_projection()

    def test_replacing_media_preserves_upstream_text_and_changes_its_version_guard(self):
        self.mutate({"node_creates": [self.api.creation({"id": "text", "type": "smart-prompt",
            "x": 0, "y": 0, "w": 280, "h": 180, "text": "完整上游文字\n末尾约束"})],
            "connection_adds": [{"from": "text", "to": "draft", "kind": "input"}]}, "text-input")
        before = self.detail()
        self.assertEqual("完整上游文字\n末尾约束", before["text_inputs"][0]["text"])
        result = self.update({"prompt": "New local prompt", "refs": {}})
        self.assertEqual(200, result.status_code, result.text)
        after = self.detail()
        self.assertEqual(before["text_inputs"], after["text_inputs"])
        self.assertEqual([], after["resolved_inputs"])
        self.mutate({"node_updates": [{"id": "text", "path": ["text"], "value": "Changed upstream text"}]}, "change-text")
        self.assertNotEqual(after["node_revision"], self.detail()["node_revision"])

    def test_multiple_outputs_from_one_node_keep_both_exact_inputs(self):
        result = self.update({"prompt": "@A @B", "refs": {
            "A": {"node": "source-1", "output_id": "other"},
            "B": {"node": "source-1", "output_id": "chosen"}}})
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(["other", "chosen"], [r["output_id"] for r in self.detail()["resolved_inputs"]])
        self.assert_editor_projection()

    def test_legacy_manual_instances_remain_distinct_and_round_trip(self):
        self.mutate({"connection_removes": self.document()["connections"], "node_updates": [
            {"id": "draft", "path": ["manualInputRefs"], "value": [self.images[0], self.images[0]]},
            {"id": "draft", "path": ["promptDraftHtml"], "value": "Two instances"},
            {"id": "draft", "path": ["promptDraftText"], "value": "Two instances"},
            {"id": "draft", "path": ["runInputRefs"], "value": []}]}, "legacy-instances")
        before = self.detail()
        self.assertEqual(2, len(before["resolved_inputs"]))
        self.assertNotEqual(before["resolved_inputs"][0]["reference_id"], before["resolved_inputs"][1]["reference_id"])
        result = self.update({"prompt": "两个：@图片1 @图片2"})
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(2, len(self.detail()["resolved_inputs"]))
        self.assert_editor_projection()
        result = self.update({"refs": self.detail()["recipe"]["refs"]}, key="round-trip")
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual(2, len(self.detail()["resolved_inputs"]))
        self.assert_editor_projection()

    def test_partial_parameter_edit_does_not_fill_unrequested_defaults(self):
        self.capability["parameters"]["generate_audio"] = {"type": "boolean", "default": True}
        settings = self.node()["runSettings"]
        result = self.update({"params": {"duration_seconds": 10}})
        self.assertEqual(200, result.status_code, result.text)
        after = self.node()["runSettings"]
        self.assertEqual({**settings, "videoDuration": 10, "catalog_revision": "fixture-v1"}, after)

    def test_missing_bytes_and_input_limits_reject_save_and_preview(self):
        self.capability["inputs"]["image"]["maximum"] = 5
        result = self.update({"title": "invalid count"})
        self.assertIn("input_maximum", str(result.json()))
        self.capability["inputs"]["image"]["maximum"] = 6
        path = self.media.resolve_reference(self.images[0]["url"])
        Path(path).unlink()
        before = self.document()
        result = self.update({"title": "missing image"}, key="missing-bytes")
        self.assertIn("reference_not_found", str(result.json()))
        self.assertEqual(before, self.document())
        preview = self.client.post(self.endpoint + "/media/preview", json={"source": {"node_id": "source-0", "media_index": 0}})
        self.assertEqual("media_unavailable", preview.json()["code"])

    def test_legacy_ids_and_numeric_reference_validation(self):
        self.mutate({"connection_removes": self.document()["connections"], "node_updates": [
            {"id": "draft", "path": ["inputNodeIds"], "value": ["group", "source-1"]}]}, "legacy-ids")
        self.assert_editor_projection()
        before = self.document()
        response = self.update({"prompt": "场景中使用@图20、@6"})
        self.assertIn("unresolved_reference", str(response.json()))
        self.assertEqual(before, self.document())


if __name__ == "__main__":
    unittest.main()
