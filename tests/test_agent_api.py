import asyncio
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.testclient import TestClient
from infinite_canvas.auth_system import (
    AuthSystem,
    install_access_control,
    SESSION_COOKIE,
)
from infinite_canvas.agent_api import AgentAPI
from infinite_canvas.canvas_sync import CanvasSync
from infinite_canvas.canvas_store import SqliteCanvasStore, CanvasIntent
from infinite_canvas.model_capabilities import ModelCapabilityCatalog
from infinite_canvas.media import WorkspaceMediaService
from tests.test_model_capabilities import catalog
from tests.test_canvas_sync import FakeContent, StoreRealtimeNotifier

CAPABILITY = {
    "provider_id": "fixture",
    "model_id": "video",
    "operation": "video.generate",
    "catalog_revision": "fixture-v1",
    "inputs": {
        "text": {"minimum": 1, "maximum": 1},
        "image": {"maximum": 3},
        "audio": {"maximum": 1},
        "video": {"maximum": 0},
    },
    "parameters": {
        "duration_seconds": {"type": "integer", "minimum": 1, "maximum": 10},
        "aspect_ratio": {"type": "enum", "values": ["16:9"]},
    },
    "input_rules": {},
    "output": {"kind": "video"},
}


class AgentApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.auth = AuthSystem(root / "auth.db")
        self.admin = self.auth.create_user(
            username="admin", password="password-long", role="admin"
        )
        self.other = self.auth.create_user(
            username="other", password="password-long", role="designer"
        )
        self.auth.save_agent_settings(self.admin, {"enabled": True})
        self.token = self.auth.create_agent_token(
            self.admin, "test", ["authoring", "run"]
        )
        self.store = SqliteCanvasStore(root / "canvas.sqlite3", workspace_id="test")
        self.notifier = StoreRealtimeNotifier()
        self.sync = CanvasSync(
            now_ms=lambda: int(time.time() * 1000),
            content=lambda: FakeContent(root / "canvases"),
            initial_admin=lambda: self.admin,
            user_by_id=self.auth.get_user,
            canvas_store=lambda: self.store,
            notifier=self.notifier,
        )
        self.canvas = {
            "id": "canvas-test",
            "kind": "smart",
            "title": "Test",
            "owner_id": self.admin["id"],
            "owner_username": "admin",
            "created_by": self.admin["id"],
            "updated_by": self.admin["id"],
            "visibility": "shared",
            "project": "default",
            "created_at": 1,
            "updated_at": 1,
            "revision": 0,
            "nodes": [
                {
                    "id": f"source-{i}",
                    "type": "smart-image",
                    "title": f"Source {i}",
                    "x": 0,
                    "y": i * 320,
                    "w": 280,
                    "h": 220,
                    "images": [
                        {
                            "url": f"/assets/input/{i}.png",
                            "kind": "image",
                            "name": f"{i}.png",
                        }
                    ],
                }
                for i in range(3)
            ],
            "connections": [],
            "settings": {
                "engine": "api",
                "apiKind": "video",
                "videoProvider": "fixture",
                "videoModel": "video",
            },
        }
        self.store.commit(
            "canvas-test",
            self.admin,
            CanvasIntent.import_canvas(self.canvas, operation_id="fixture:import"),
        )
        self.media = WorkspaceMediaService(
            SimpleNamespace(imported_media=root / "media")
        )
        self.api = AgentAPI(
            auth=self.auth,
            sync=self.sync,
            catalog=catalog(),
            resolve_model=lambda *args: copy.deepcopy(CAPABILITY),
            list_models=lambda: [
                {"provider_id": "fixture", "model": "video", "kind": "video"}
            ],
            media=lambda: self.media,
            assets=lambda: SimpleNamespace(list=lambda *args, **kw: {"items": []}),
            database=lambda: root / "canvas.sqlite3",
            media_path=lambda u: self.media.resolve_reference(u),
            upload_extensions={".png", ".mp3"},
            max_upload_bytes=1024,
        )
        app = FastAPI()
        self.api.install(app)
        install_access_control(app, self.auth)

        @app.get("/api/private")
        def private():
            return {"ok": True}

        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.client.headers["Authorization"] = "Bearer " + self.token["token"]

    def post(self, body, key="test-key", path="/submissions"):
        return self.client.post(
            "/api/agent/v1/canvases/canvas-test" + path,
            json=body,
            headers={"Idempotency-Key": key},
        )

    def recipe(self):
        return {
            "kind": "video",
            "prompt": "@主角在@场景中 @未声明",
            "params": {"duration_seconds": 5, "aspect_ratio": "16:9"},
            "refs": {"主角": {"node": "source-0"}, "场景": {"node": "source-1"}},
        }

    def test_create_retry_after_rename_and_cross_endpoint_collision(self):
        response = self.client.post(
            "/api/agent/v1/canvases",
            json={"title": "Original"},
            headers={"Idempotency-Key": "create"},
        )
        self.assertEqual(200, response.status_code, response.text)
        cid = response.json()["canvas"]["id"]

        async def rename():
            await self.sync.commit_prepared_operation(
                cid,
                self.admin,
                "test:rename",
                lambda canvas, receipt: (
                    {
                        "operation_id": "test:rename",
                        "base_revision": canvas["revision"],
                        "changes": {
                            "canvas_updates": [{"path": ["title"], "value": "Renamed"}]
                        },
                    },
                    {},
                ),
            )

        asyncio.run(rename())
        retry = self.client.post(
            "/api/agent/v1/canvases",
            json={"title": "Original"},
            headers={"Idempotency-Key": "create"},
        )
        self.assertEqual({"id": cid, "name": "Renamed"}, retry.json()["canvas"])
        self.assertEqual(
            "operation_collision",
            self.post({"tasks": [self.recipe()]}, key="create").json()["code"],
        )
        invalid = self.client.post(
            "/api/agent/v1/canvases", json=[], headers={"Idempotency-Key": "bad"}
        )
        self.assertEqual("invalid_request", invalid.json()["code"])

    def test_image_catalog_defaults_and_custom_dimensions_match_composer(self):
        self.api.models = lambda: [
            {"provider_id": "apimart", "model": "gpt-image-2-official", "kind": "image"}
        ]
        self.api.resolve_model = self.api.catalog.resolve
        model = {"provider_id": "apimart", "model": "gpt-image-2-official"}
        result = self.post(
            {
                "tasks": [
                    {
                        "kind": "image",
                        "model": model,
                        "prompt": "A landscape",
                        "params": {"aspect_ratio": "16:9"},
                    }
                ]
            },
            key="image",
        )
        self.assertEqual(200, result.status_code, result.text)
        resolved = self.api.catalog.resolve(*model.values(), "image.generate")
        resolved["parameters"]["custom_resolution"]["values"] = [False, True]
        self.api.resolve_model = lambda *args: copy.deepcopy(resolved)
        result = self.post(
            {
                "tasks": [
                    {
                        "kind": "image",
                        "model": model,
                        "prompt": "A square",
                        "params": {"custom_size": "1024x1024"},
                    }
                ]
            },
            key="custom",
        )
        self.assertEqual(200, result.status_code, result.text)
        node = next(
            n
            for n in self.sync.read("canvas-test", self.admin)["nodes"]
            if n["id"] == result.json()["task_ids"][0]
        )
        self.assertEqual(
            (1024, 1024),
            (node["runSettings"]["pixelWidth"], node["runSettings"]["pixelHeight"]),
        )

    def test_catalog_only_defaults_do_not_reject_valid_recipes(self):
        # Real configured image capabilities include hidden provider defaults that
        # have no Composer authoring field (for example prompt_enhancement).
        capability = copy.deepcopy(CAPABILITY)
        capability["parameters"]["prompt_enhancement"] = {
            "type": "boolean",
            "default": False,
            "editable": False,
        }
        self.api.resolve_model = lambda *args: copy.deepcopy(capability)
        recipe = self.recipe()
        preview = self.post({"tasks": [recipe], "dry_run": True}, key="default-preview")
        self.assertEqual(200, preview.status_code, preview.text)
        created = self.post({"tasks": [recipe]}, key="default-create")
        self.assertEqual(200, created.status_code, created.text)
        recipe["params"]["prompt_enhancement"] = False
        rejected = self.post(
            {"tasks": [recipe], "dry_run": True}, key="explicit-hidden"
        )
        self.assertEqual(
            "parameter_not_authorable", rejected.json()["details"]["errors"][0]["code"]
        )

    def test_ten_multimodal_tasks_share_two_imports(self):
        imported = []
        for suffix, mime in [("png", "image/png"), ("mp3", "audio/mpeg")]:
            response = self.client.post(
                "/api/agent/v1/media",
                headers={"Idempotency-Key": suffix},
                files={"file": ("reference." + suffix, suffix.encode(), mime)},
            )
            self.assertEqual(200, response.status_code, response.text)
            imported.append(response.json()["media_id"])
        recipe = self.recipe()
        recipe["refs"].update(
            extra={"media": imported[0]}, music={"media": imported[1]}
        )
        response = self.post({"tasks": [recipe for _ in range(10)]})
        self.assertEqual(200, response.status_code, response.text)
        canvas = self.sync.read("canvas-test", self.admin)
        self.assertEqual(1, canvas["revision"])
        self.assertEqual(40, len(canvas["connections"]))
        self.assertEqual(2, len([n for n in canvas["nodes"] if ":media:" in n["id"]]))

    def test_draft_parameter_patch_uses_live_connections_after_source_removed(self):
        result = self.post({"tasks": [self.recipe()]}).json()
        nid = result["task_ids"][0]

        async def remove():
            await self.sync.commit_prepared_operation(
                "canvas-test",
                self.admin,
                "test:remove-source",
                lambda canvas, receipt: (
                    {
                        "operation_id": "test:remove-source",
                        "base_revision": canvas["revision"],
                        "changes": {"node_deletes": ["source-0"]},
                    },
                    {},
                ),
            )

        asyncio.run(remove())
        response = self.client.patch(
            "/api/agent/v1/canvases/canvas-test/tasks/" + nid,
            json={"params": {"duration_seconds": 6}},
            headers={"Idempotency-Key": "update-live"},
        )
        self.assertEqual(200, response.status_code, response.text)
        node = next(
            n
            for n in self.sync.read("canvas-test", self.admin)["nodes"]
            if n["id"] == nid
        )
        self.assertEqual(6, node["runSettings"]["videoDuration"])

    def test_prompt_nodes_keep_global_gap_and_existing_positions(self):
        from infinite_canvas.canvas_realtime import NODE_GAP

        response = self.post(
            {
                "type": "prompts",
                "tasks": [{"prompt": "Option " + str(i)} for i in range(6)],
            }
        )
        self.assertEqual(200, response.status_code, response.text)
        canvas = self.sync.read("canvas-test", self.admin)
        prompts = [n for n in canvas["nodes"] if n["id"] in response.json()["task_ids"]]
        prompts.sort(key=lambda n: response.json()["task_ids"].index(n["id"]))
        self.assertEqual(NODE_GAP, prompts[1]["x"] - prompts[0]["x"] - prompts[0]["w"])
        inside = self.client.get(
            "/api/agent/v1/canvases/canvas-test",
            params={"frame": response.json()["frame_id"]},
        ).json()["nodes"]
        self.assertEqual(6, len(inside))
        for source in self.canvas["nodes"]:
            current = next(n for n in canvas["nodes"] if n["id"] == source["id"])
            self.assertEqual((source["x"], source["y"]), (current["x"], current["y"]))

    def test_auth_disable_revoke_role_and_non_agent(self):
        self.assertEqual(200, self.client.get("/api/agent/v1/info").status_code)
        self.assertEqual(401, self.client.get("/api/private").status_code)
        self.auth.save_agent_settings(self.admin, {"enabled": False})
        self.assertEqual(
            "agent_access_disabled",
            self.client.get("/api/agent/v1/info").json()["code"],
        )
        self.auth.save_agent_settings(self.admin, {"enabled": True})
        self.auth.revoke_agent_token(self.admin, self.token["id"])
        self.assertEqual(
            "unauthorized", self.client.get("/api/agent/v1/info").json()["code"]
        )
        token = self.auth.create_agent_token(self.other, "role", ["authoring"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        self.auth.set_user_role(self.other["id"], "guest")
        self.assertEqual(
            "forbidden", self.client.get("/api/agent/v1/info").json()["code"]
        )

    def test_atomic_ten_tasks_retry_collision_undo(self):
        body = {"title": "Shots", "tasks": [self.recipe() for _ in range(10)]}
        response = self.post(body)
        self.assertEqual(200, response.status_code, response.text)
        result = response.json()
        canvas = self.sync.read("canvas-test", self.admin)
        self.assertEqual(1, canvas["revision"])
        self.assertEqual(14, len(canvas["nodes"]))
        self.assertEqual(20, len(canvas["connections"]))
        self.assertEqual(1, len(self.notifier.broadcasts))
        node = next(n for n in canvas["nodes"] if n["id"] == result["task_ids"][0])
        self.assertIn('data-node-id="source-0"', node["promptDraftHtml"])
        self.assertEqual([], node["manualInputRefs"])
        self.assertEqual(5, node["runSettings"]["videoDuration"])
        response = self.post(body)
        self.assertEqual(200, response.status_code, response.text)
        self.assertTrue(response.json()["duplicate"])
        changed = copy.deepcopy(body)
        changed["title"] = "Different"
        self.assertEqual("operation_collision", self.post(changed).json()["code"])
        response = self.post(
            {}, key="undo-key", path="/submissions/" + result["submission_id"] + "/undo"
        )
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(3, len(self.sync.read("canvas-test", self.admin)["nodes"]))

    def test_dry_run_missing_and_capability_reject_do_not_write(self):
        body = {"tasks": [self.recipe()], "dry_run": True}
        self.assertEqual("dry_run", self.post(body).json()["status"])
        body["tasks"][0]["refs"]["主角"] = {"node_name": "Unknown"}
        self.assertEqual("needs_input", self.post(body).json()["code"])
        body = {"tasks": [self.recipe()]}
        body["tasks"][0]["params"]["duration_seconds"] = 100
        self.assertEqual("rejected", self.post(body).json()["code"])
        self.assertEqual(0, self.sync.read("canvas-test", self.admin)["revision"])

    def test_seedance_capability_reports_default_audio_and_recipe_omits_toggle(self):
        self.api.resolve_model = self.api.catalog.resolve
        self.api.models = lambda: [
            {"provider_id": "jimeng", "model": "Seedance2.5", "kind": "video"}
        ]
        response = self.client.get(
            "/api/agent/v1/models/jimeng/Seedance2.5",
            params={"operation": "video.generate"},
        )
        self.assertEqual(200, response.status_code, response.text)
        capability = response.json()
        self.assertEqual({"default": True, "configurable": False}, capability["output"].get("audio"))
        self.assertNotIn("generate_audio", capability["parameters"])
        self.assertNotIn("generate_audio", capability["authoring"]["parameters"])

        body = {"tasks": [{
            "kind": "video", "prompt": "A bird sings",
            "model": {"provider_id": "jimeng", "model": "Seedance2.5"},
            "params": {"duration_seconds": 4, "resolution": "480p", "aspect_ratio": "16:9"},
        }]}
        response = self.post(body, key="seedance-audio")
        self.assertEqual(200, response.status_code, response.text)
        node = next(n for n in self.sync.read("canvas-test", self.admin)["nodes"]
                    if n["id"] == response.json()["task_ids"][0])
        self.assertNotIn("videoGenerateAudio", node["runSettings"])

        body["dry_run"] = True
        body["tasks"][0]["params"]["generate_audio"] = False
        response = self.post(body, key="seedance-unsupported-audio")
        self.assertEqual("rejected", response.json()["code"])
        self.assertTrue(any(error["field"] == "generate_audio" and error["code"] == "parameter_unknown"
                            for error in response.json()["details"]["errors"]))

    def test_private_canvas_forbidden(self):
        private = {**self.canvas, "id": "private-test", "visibility": "private"}
        self.store.commit(
            "private-test",
            self.admin,
            CanvasIntent.import_canvas(private, operation_id="private:import"),
        )
        token = self.auth.create_agent_token(self.other, "other", ["authoring"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        result = self.client.get("/api/agent/v1/canvases/private-test")
        self.assertEqual(403, result.status_code)

    def test_media_dedupe_and_dry_run_descriptor(self):
        def upload():
            return self.client.post(
                "/api/agent/v1/media",
                headers={"Idempotency-Key": "upload"},
                files={"file": ("ref.png", b"fake-image", "image/png")},
            )

        first = upload()
        self.assertEqual(200, first.status_code, first.text)
        self.assertEqual(first.json()["media_id"], upload().json()["media_id"])
        self.assertEqual(1, len(list(self.media.directory.iterdir())))
        recipe = self.recipe()
        recipe["refs"]["主角"] = {"media": first.json()["media_id"]}
        response = self.post({"tasks": [recipe, recipe, recipe]})
        self.assertEqual(200, response.status_code, response.text)
        nodes = self.sync.read("canvas-test", self.admin)["nodes"]
        self.assertEqual(1, len([n for n in nodes if ":media:" in n["id"]]))

    def test_run_request_scope_queue_idempotence_and_undo_block(self):
        authored = self.post({"tasks": [self.recipe()]}).json()
        result = self.post(
            {"node_ids": authored["task_ids"]}, key="run-key", path="/run-requests"
        )
        self.assertEqual(200, result.status_code, result.text)
        again = self.post(
            {"node_ids": authored["task_ids"]}, key="run-key", path="/run-requests"
        )
        self.assertEqual(
            result.json()["requests"][0]["id"], again.json()["requests"][0]["id"]
        )
        states = self.client.get("/api/agent/v1/canvases/canvas-test/tasks").json()[
            "tasks"
        ]
        self.assertEqual("waiting_for_editor", states[0]["state"])
        undo = self.post(
            {},
            key="undo-run",
            path="/submissions/" + authored["submission_id"] + "/undo",
        )
        self.assertEqual("undo_blocked_by_run", undo.json()["code"])

    def test_target_ambiguity_selection_and_privacy(self):
        now = time.monotonic()
        self.api.contexts["a"] = {
            "user_id": self.admin["id"],
            "canvas_id": "canvas-test",
            "seen": now,
            "focused": now,
            "selection": [
                {"node_id": "source-1", "indices": [0]},
                {"node_id": "source-0"},
            ],
            "viewport": {},
            "socket": "a",
        }
        self.assertEqual(
            "canvas-test",
            self.client.get("/api/agent/v1/context/target").json()["canvas"]["id"],
        )
        selection = self.client.get(
            "/api/agent/v1/canvases/canvas-test/selection"
        ).json()["selection"]
        self.assertEqual(["source-0", "source-1"], [s["node_id"] for s in selection])
        token = self.auth.create_agent_token(self.other, "other", ["authoring"])
        self.client.headers["Authorization"] = "Bearer " + token["token"]
        self.assertEqual(
            "no_editor_context",
            self.client.get("/api/agent/v1/canvases/canvas-test/selection").json()[
                "code"
            ],
        )

    def test_shared_node_contract_and_visual_order(self):
        from infinite_canvas.agent_api import visual_order

        sample = json.loads(
            (Path(__file__).parent / "fixtures/agent-authoring.json").read_text()
        )
        result = self.post({"tasks": [sample["recipe"]]}).json()
        node = next(
            n
            for n in self.sync.read("canvas-test", self.admin)["nodes"]
            if n["id"] == result["task_ids"][0]
        )
        self.assertEqual(sample["node"], {k: node[k] for k in sample["node"]})
        self.assertEqual(
            sample["settings"], {k: node["runSettings"][k] for k in sample["settings"]}
        )
        self.assertEqual(
            sample["visual_order"]["ids"],
            [n["id"] for n in visual_order(sample["visual_order"]["rectangles"])],
        )

    def test_updates_are_field_scoped_and_undo_conflicts(self):
        result = self.post({"tasks": [self.recipe()]}).json()
        nid = result["task_ids"][0]
        asyncio.run(
            self.sync.commit_staged_operation(
                "canvas-test",
                self.admin,
                {
                    "operation_id": "human:edit-prompt",
                    "base_revision": 1,
                    "changes": {
                        "node_updates": [
                            {
                                "id": nid,
                                "path": ["promptDraftText"],
                                "value": "Human draft",
                            },
                            {
                                "id": nid,
                                "path": ["promptDraftHtml"],
                                "value": "Human draft",
                            },
                        ]
                    },
                },
            )
        )
        response = self.client.patch(
            "/api/agent/v1/canvases/canvas-test/tasks/" + nid,
            json={"params": {"duration_seconds": 6}},
            headers={"Idempotency-Key": "update-key"},
        )
        self.assertEqual(200, response.status_code, response.text)
        node = next(
            n
            for n in self.sync.read("canvas-test", self.admin)["nodes"]
            if n["id"] == nid
        )
        self.assertEqual("Human draft", node["promptDraftText"])
        self.assertEqual(6, node["runSettings"]["videoDuration"])
        undo = self.post(
            {},
            key="undo-conflict",
            path="/submissions/" + result["submission_id"] + "/undo",
        )
        self.assertEqual("undo_conflict", undo.json()["code"])

    def test_upload_key_collision_and_cross_extension_dedup(self):
        def upload(name, content, key):
            return self.client.post(
                "/api/agent/v1/media",
                headers={"Idempotency-Key": key},
                files={"file": (name, content, "application/octet-stream")},
            )

        first = upload("a.png", b"one", "upload-a")
        self.assertEqual(200, first.status_code)
        self.assertEqual(
            "operation_collision", upload("a.png", b"two", "upload-a").json()["code"]
        )
        second = upload("b.mp3", b"one", "upload-b")
        self.assertEqual(200, second.status_code)
        self.assertEqual(first.json()["url"], second.json()["url"])

    def test_claim_concurrency_lease_recovery_confirmation_and_expiry(self):
        from infinite_canvas.canvas_sync import RealtimeSession

        result = self.post({"tasks": [self.recipe() for _ in range(3)]}).json()
        queued = self.post(
            {"node_ids": result["task_ids"]}, key="lease-run", path="/run-requests"
        ).json()["requests"]
        a = RealtimeSession(
            canvas_id="canvas-test",
            client_id="editor-a",
            websocket="a",
            actor_id=self.admin["id"],
            access_epoch=0,
            access_scope={},
            revision=0,
        )
        b = RealtimeSession(
            canvas_id="canvas-test",
            client_id="editor-b",
            websocket="b",
            actor_id=self.admin["id"],
            access_epoch=0,
            access_scope={},
            revision=0,
        )

        async def claim(session, rid):
            await self.api.handle_run_message(
                session, self.admin, {"type": "agent_run_claim", "id": rid}
            )

        for r in queued:
            asyncio.run(claim(a, r["id"]))
        rows = self.api.run_items(self.admin, "canvas-test")
        self.assertEqual(2, sum(r["state"] == "claimed" for r in rows))
        asyncio.run(claim(b, queued[0]["id"]))
        self.assertFalse(self.notifier.sent[-1][1]["claimed"])
        with self.api.data() as state:
            state["runs"][queued[0]["id"]]["lease_until"] = time.time() - 1
        asyncio.run(claim(b, queued[0]["id"]))
        self.assertTrue(self.notifier.sent[-1][1]["claimed"])
        with self.api.data() as state:
            state["runs"][queued[2]["id"]]["created_at"] = time.time() - 86401
        self.assertEqual(
            "expired", self.api.run_items(self.admin, "canvas-test")[-1]["state"]
        )
        self.auth.revoke_agent_token(self.admin, self.token["id"])
        asyncio.run(
            self.api.handle_run_message(
                b, self.admin, {"type": "agent_run_renew", "id": queued[0]["id"]}
            )
        )
        self.assertEqual(
            "cancelled", self.api.run_items(self.admin, "canvas-test")[0]["state"]
        )
