import importlib
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

from infinite_canvas.canvas_store import (
    CanvasIntent,
    CanvasProjection,
    SqliteCanvasStore,
    prompt_template_item_version,
)
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)
from tests.websocket_helpers import receive_canvas_message


ensure_test_workspace()


class PromptLibraryScopeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")

    def tearDown(self):
        unload_main()
        if self._previous_state is None:
            os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
        else:
            os.environ["INFINITE_CANVAS_STATE_DIR"] = self._previous_state
        ensure_test_workspace()

    @staticmethod
    def _load_main(tmp):
        root = Path(tmp)
        state = root / "state"
        workspace = root / "workspace"
        configure_test_workspace(workspace, state)
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
        unload_main()
        return importlib.import_module("main"), workspace

    @staticmethod
    def _login(client, username, password):
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 200, response.text

    def test_prompt_template_normalization_discards_legacy_scene_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            legacy = {
                "id": "legacy-scene",
                "name": "旧模板",
                "positive": "保留内容",
                "scene": "旧适用场景",
                "scene_en": "Legacy usage",
                "cover": "/assets/cover.png",
            }
            for normalized in (
                main.normalize_prompt_library_item(legacy),
                main.normalize_canvas_prompt_template(legacy),
            ):
                self.assertNotIn("scene", normalized)
                self.assertNotIn("scene_en", normalized)
                self.assertEqual("/assets/cover.png", normalized["cover"])

    def test_seed_is_ordinary_common_content_and_deleted_seed_is_not_restored(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            main.AUTH_SYSTEM.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            with TestClient(main.app) as client:
                self._login(client, "designer", "designer-password")
                initial = client.get("/api/prompt-libraries")
                self.assertEqual(initial.status_code, 200)
                common = initial.json()["library"]["common"]
                self.assertEqual(common["name"], "通用")
                self.assertNotIn("system", common)
                self.assertFalse(
                    any(item.get("system") or item.get("builtin") for item in common["items"])
                )

                stored = main.load_prompt_libraries()
                for library in stored["libraries"]:
                    library["items"] = []
                    library["categories"] = []
                main.save_prompt_libraries(stored)

                reloaded = client.get("/api/prompt-libraries").json()["library"]["common"]
                self.assertEqual(reloaded["items"], [])
                self.assertEqual(reloaded["categories"], [])

    def test_prompt_cover_upload_uses_dedicated_library_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            main.AUTH_SYSTEM.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            main.AUTH_SYSTEM.create_user(
                username="guest",
                password="guest-password",
                role="guest",
            )
            with TestClient(main.app) as client:
                self._login(client, "designer", "designer-password")
                uploaded = client.post(
                    "/api/prompt-libraries/covers",
                    files={
                        "file": (
                            "template.png",
                            b"dedicated-cover",
                            "image/png",
                        )
                    },
                )
                self.assertEqual(200, uploaded.status_code, uploaded.text)
                cover_url = uploaded.json()["cover"]["url"]
                self.assertTrue(
                    cover_url.startswith("/api/prompt-libraries/covers/")
                )
                filename = cover_url.rsplit("/", 1)[-1]
                cover_path = (
                    workspace
                    / "data"
                    / "prompt-libraries"
                    / "covers"
                    / filename
                )
                self.assertEqual(b"dedicated-cover", cover_path.read_bytes())
                self.assertFalse(
                    (workspace / "assets" / "input" / "imported" / filename).exists()
                )

                downloaded = client.get(cover_url)
                self.assertEqual(200, downloaded.status_code, downloaded.text)
                self.assertEqual(b"dedicated-cover", downloaded.content)
                self.assertEqual("image/png", downloaded.headers["content-type"])

                self._login(client, "guest", "guest-password")
                self.assertEqual(403, client.get(cover_url).status_code)
                self.assertEqual(
                    403,
                    client.post(
                        "/api/prompt-libraries/covers",
                        files={
                            "file": ("guest.png", b"guest", "image/png")
                        },
                    ).status_code,
                )

    def test_deleted_group_moves_templates_to_managed_uncategorized_and_hides_it_when_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            main.AUTH_SYSTEM.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            main.save_prompt_libraries({
                "active_library_id": "system",
                "libraries": [{
                    "id": "system",
                    "name": "通用",
                    "type": "prompt",
                    "categories": [
                        {"id": "portrait", "name": "人物摄影"},
                        {"id": "product", "name": "产品设计"},
                    ],
                    "items": [
                        {"id": "portrait-one", "name": "人物一", "category": "portrait", "positive": "one"},
                        {"id": "portrait-two", "name": "人物二", "category": "portrait", "positive": "two"},
                        {"id": "product-one", "name": "产品一", "category": "product", "positive": "three"},
                    ],
                }],
            })
            with TestClient(main.app) as client:
                self._login(client, "designer", "designer-password")
                deleted = client.delete(
                    "/api/prompt-libraries/categories/portrait?library_id=system"
                )
                self.assertEqual(deleted.status_code, 200, deleted.text)
                common = deleted.json()["library"]["common"]
                uncategorized = next(
                    category
                    for category in common["categories"]
                    if category["category_id"] == main.PROMPT_UNCATEGORIZED_CATEGORY_ID
                )
                self.assertEqual(uncategorized["name"], "未分类")
                self.assertTrue(uncategorized["managed"])
                moved = [
                    item
                    for item in common["items"]
                    if item["source_id"] in {"portrait-one", "portrait-two"}
                ]
                self.assertEqual(
                    {item["category"] for item in moved},
                    {"system::uncategorized"},
                )
                self.assertEqual(
                    next(item for item in common["items"] if item["source_id"] == "product-one")["category"],
                    "system::product",
                )

                stored = main.load_prompt_libraries()["libraries"][0]
                self.assertEqual(
                    sum(category["id"] == "uncategorized" for category in stored["categories"]),
                    1,
                )
                self.assertFalse(any(category["id"] == "portrait" for category in stored["categories"]))

                for item_id in ("portrait-one", "portrait-two"):
                    removed = client.delete(
                        f"/api/prompt-libraries/items/{item_id}?library_id=system"
                    )
                    self.assertEqual(removed.status_code, 200, removed.text)
                after_removal = client.get("/api/prompt-libraries").json()["library"]["common"]
                self.assertFalse(
                    any(category["category_id"] == "uncategorized" for category in after_removal["categories"])
                )
                self.assertTrue(
                    any(category["id"] == "uncategorized" for category in main.load_prompt_libraries()["libraries"][0]["categories"])
                )

                protected_delete = client.delete(
                    "/api/prompt-libraries/categories/uncategorized?library_id=system"
                )
                self.assertEqual(protected_delete.status_code, 400)

    def test_canvas_templates_are_permission_scoped_idempotent_and_promotable(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            admin = main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            main.AUTH_SYSTEM.create_user(
                username="designer",
                password="designer-password",
                role="designer",
            )
            main.AUTH_SYSTEM.create_user(
                username="guest",
                password="guest-password",
                role="guest",
            )
            with TestClient(main.app) as client:
                self._login(client, "admin", "admin-password")
                canvas = client.post(
                    "/api/canvases",
                    json={"title": "Scoped prompts", "kind": "smart"},
                ).json()["canvas"]
                canvas_id = canvas["id"]
                operation_id = "prompt:create:one"
                created = client.post(
                    f"/api/canvases/{canvas_id}/prompt-templates",
                    json={
                        "operation_id": operation_id,
                        "base_revision": canvas["revision"],
                        "name": "角色规则",
                        "positive": "角色始终佩戴红色围巾",
                    },
                )
                self.assertEqual(created.status_code, 200, created.text)
                created_data = created.json()
                self.assertEqual(len(created_data["templates"]), 1)
                self.assertNotIn("category", created_data["item"])

                duplicate = client.post(
                    f"/api/canvases/{canvas_id}/prompt-templates",
                    json={
                        "operation_id": operation_id,
                        "base_revision": canvas["revision"],
                        "name": "角色规则",
                        "positive": "角色始终佩戴红色围巾",
                    },
                )
                self.assertEqual(duplicate.status_code, 200, duplicate.text)
                self.assertTrue(duplicate.json()["duplicate"])
                self.assertEqual(len(duplicate.json()["templates"]), 1)
                collision = client.post(
                    f"/api/canvases/{canvas_id}/prompt-templates",
                    json={
                        "operation_id": operation_id,
                        "base_revision": canvas["revision"],
                        "name": "不同逻辑动作",
                        "positive": "不得复用同一 operation_id",
                    },
                )
                self.assertEqual(collision.status_code, 409, collision.text)
                self.assertEqual(
                    collision.json()["detail"]["code"],
                    "operation_collision",
                )

                library = client.get("/api/prompt-libraries").json()["library"]
                category = library["common"]["categories"][0]
                promoted = client.post(
                    f"/api/canvases/{canvas_id}/prompt-templates/{created_data['item']['id']}/promote",
                    json={
                        "operation_id": "prompt:promote:one",
                        "base_revision": created_data["revision"],
                        "library_id": category["library_id"],
                        "category": category["category_id"],
                    },
                )
                self.assertEqual(promoted.status_code, 200, promoted.text)
                self.assertEqual(promoted.json()["templates"], [])
                promoted_common = promoted.json()["library"]["common"]["items"]
                self.assertTrue(
                    any(item["positive"] == "角色始终佩戴红色围巾" for item in promoted_common)
                )
                promoted_retry = client.post(
                    f"/api/canvases/{canvas_id}/prompt-templates/{created_data['item']['id']}/promote",
                    json={
                        "operation_id": "prompt:promote:one",
                        "base_revision": created_data["revision"],
                        "library_id": category["library_id"],
                        "category": category["category_id"],
                    },
                )
                self.assertEqual(promoted_retry.status_code, 200, promoted_retry.text)
                self.assertTrue(promoted_retry.json()["duplicate"])
                self.assertEqual(
                    sum(
                        item["positive"] == "角色始终佩戴红色围巾"
                        for item in promoted_retry.json()["library"]["common"]["items"]
                    ),
                    1,
                )

                private_canvas = client.post(
                    "/api/canvases",
                    json={"title": "Private", "kind": "classic"},
                ).json()["canvas"]
                visibility = client.put(
                    f"/api/canvases/{private_canvas['id']}/visibility",
                    json={"visibility": "private"},
                )
                self.assertEqual(visibility.status_code, 200)
                client.post("/api/auth/logout")
                self._login(client, "designer", "designer-password")
                self.assertEqual(
                    client.get(
                        f"/api/canvases/{private_canvas['id']}/prompt-templates"
                    ).status_code,
                    404,
                )
                client.post("/api/auth/logout")
                self._login(client, "guest", "guest-password")
                self.assertEqual(client.get("/api/prompt-libraries").status_code, 403)
                self.assertEqual(
                    client.get(
                        f"/api/canvases/{canvas_id}/prompt-templates"
                    ).status_code,
                    403,
                )
                client.post("/api/auth/logout")
                self.assertEqual(client.get("/api/prompt-libraries").status_code, 401)
                self.assertEqual(
                    client.get(
                        f"/api/canvases/{canvas_id}/prompt-templates"
                    ).status_code,
                    401,
                )
                self.assertEqual(admin["role"], "admin")

    def test_common_copy_is_independent_and_create_rebases_on_latest_canvas(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            with TestClient(main.app) as client:
                self._login(client, "admin", "admin-password")
                canvas = client.post(
                    "/api/canvases",
                    json={"title": "Independent copy", "kind": "smart"},
                ).json()["canvas"]
                library = client.get("/api/prompt-libraries").json()["library"]
                source = library["common"]["items"][0]
                copied = client.post(
                    f"/api/prompt-libraries/items/{source['source_id']}/copy-to-canvas",
                    json={
                        "canvas_id": canvas["id"],
                        "operation_id": "prompt:copy:independent",
                        "base_revision": canvas["revision"],
                        "library_id": source["library_id"],
                    },
                )
                self.assertEqual(copied.status_code, 200, copied.text)
                copied_data = copied.json()
                copied_positive = copied_data["item"]["positive"]

                updated_common = client.patch(
                    f"/api/prompt-libraries/items/{source['source_id']}",
                    json={
                        "library_id": source["library_id"],
                        "name": source["name"],
                        "category": source["category"].split("::", 1)[-1],
                        "positive": "通用原版已经改变",
                    },
                )
                self.assertEqual(updated_common.status_code, 200, updated_common.text)
                canvas_items = client.get(
                    f"/api/canvases/{canvas['id']}/prompt-templates"
                ).json()["templates"]
                self.assertEqual(canvas_items[0]["positive"], copied_positive)
                copy_retry = client.post(
                    f"/api/prompt-libraries/items/{source['source_id']}/copy-to-canvas",
                    json={
                        "canvas_id": canvas["id"],
                        "operation_id": "prompt:copy:independent",
                        "base_revision": canvas["revision"],
                        "library_id": source["library_id"],
                    },
                )
                self.assertEqual(copy_retry.status_code, 200, copy_retry.text)
                self.assertTrue(copy_retry.json()["duplicate"])
                self.assertEqual(len(copy_retry.json()["templates"]), 1)

                rebased = client.post(
                    f"/api/canvases/{canvas['id']}/prompt-templates",
                    json={
                        "operation_id": "prompt:create:stale",
                        "base_revision": canvas["revision"],
                        "name": "Rebased",
                        "positive": "应安全写入",
                    },
                )
                self.assertEqual(rebased.status_code, 200, rebased.text)
                self.assertEqual(rebased.json()["item"]["positive"], "应安全写入")

    def test_prompt_create_rebases_after_unrelated_smart_canvas_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            with TestClient(main.app) as client:
                self._login(client, "admin", "admin-password")
                canvas = client.post(
                    "/api/canvases",
                    json={"title": "Prompt commit rebase", "kind": "smart"},
                ).json()["canvas"]
                prompt_revision = client.get(
                    f"/api/canvases/{canvas['id']}/prompt-templates"
                ).json()["revision"]

                with client.websocket_connect(
                    f"/ws/canvases/{canvas['id']}?layout_gap=64&client_id=prompt-editor"
                ) as socket:
                    receive_canvas_message(socket, "canvas_snapshot")
                    socket.send_json(
                        {
                            "type": "canvas_mutation",
                            "canvas_id": canvas["id"],
                            "operation": {
                                "operation_id": "prompt-editor:node-edit-0001",
                                "base_revision": prompt_revision,
                                "changes": {
                                    "node_creates": [
                                        {
                                            "id": "prompt-node",
                                            "type": "smart-prompt",
                                            "text": "刚编辑的 Prompt Node",
                                        }
                                    ]
                                },
                            },
                        }
                    )
                    mutation = receive_canvas_message(socket, "canvas_mutation")
                    self.assertEqual(mutation["revision"], prompt_revision + 1)

                saved = client.post(
                    f"/api/canvases/{canvas['id']}/prompt-templates",
                    json={
                        "operation_id": "prompt:create:after-node-edit",
                        "base_revision": prompt_revision,
                        "client_id": "prompt-editor",
                        "name": "角色规则",
                        "positive": "角色始终佩戴红色围巾",
                    },
                )

                self.assertEqual(saved.status_code, 200, saved.text)
                body = saved.json()
                self.assertEqual(body["revision"], mutation["revision"] + 1)
                self.assertEqual(body["item"]["positive"], "角色始终佩戴红色围巾")

    def test_prompt_commit_and_unrelated_move_allow_stale_non_overlapping_node_create(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            with TestClient(main.app) as client:
                self._login(client, "admin", "admin-password")
                canvas = client.post(
                    "/api/canvases",
                    json={"title": "Prompt and placement rebase", "kind": "smart"},
                ).json()["canvas"]

                def receive_operation(socket, operation_id):
                    while True:
                        message = socket.receive_json()
                        if message.get("operation_id") == operation_id:
                            return message

                with client.websocket_connect(
                    f"/ws/canvases/{canvas['id']}?layout_gap=64&client_id=collaborator"
                ) as collaborator, client.websocket_connect(
                    f"/ws/canvases/{canvas['id']}?layout_gap=64&client_id=stale-creator"
                ) as stale_creator:
                    collaborator.receive_json()
                    stale_creator.receive_json()

                    anchor_operation_id = "collaborator:create-anchor-0001"
                    collaborator.send_json(
                        {
                            "type": "canvas_mutation",
                            "canvas_id": canvas["id"],
                            "operation": {
                                "operation_id": anchor_operation_id,
                                "base_revision": canvas["revision"],
                                "changes": {
                                    "node_creates": [
                                        {
                                            "id": "anchor-node",
                                            "type": "smart-image",
                                            "x": 0,
                                            "y": 0,
                                            "w": 200,
                                            "h": 100,
                                        }
                                    ]
                                },
                            },
                        }
                    )
                    anchor = receive_operation(collaborator, anchor_operation_id)
                    receive_operation(stale_creator, anchor_operation_id)
                    stale_revision = anchor["revision"]

                    move_operation_id = "collaborator:move-unrelated-0001"
                    collaborator.send_json(
                        {
                            "type": "canvas_mutation",
                            "canvas_id": canvas["id"],
                            "operation": {
                                "operation_id": move_operation_id,
                                "base_revision": stale_revision,
                                "changes": {
                                    "node_updates": [
                                        {
                                            "id": "anchor-node",
                                            "path": ["x"],
                                            "value": 1200,
                                        }
                                    ]
                                },
                            },
                        }
                    )
                    moved = receive_operation(collaborator, move_operation_id)
                    receive_operation(stale_creator, move_operation_id)

                    prompt_operation_id = "prompt:create:combined-96-117"
                    saved = client.post(
                        f"/api/canvases/{canvas['id']}/prompt-templates",
                        json={
                            "operation_id": prompt_operation_id,
                            "base_revision": stale_revision,
                            "client_id": "prompt-editor",
                            "name": "组合回归规则",
                            "positive": "无关移动后仍可保存并继续创建 Node",
                        },
                    )
                    self.assertEqual(saved.status_code, 200, saved.text)
                    self.assertEqual(saved.json()["revision"], moved["revision"] + 1)
                    prompt_commit = receive_operation(
                        stale_creator, prompt_operation_id
                    )
                    self.assertEqual(
                        prompt_commit["non_undoable_canvas_roots"],
                        ["prompt_templates"],
                    )

                    create_operation_id = "stale-creator:create-away-0001"
                    stale_creator.send_json(
                        {
                            "type": "canvas_mutation",
                            "canvas_id": canvas["id"],
                            "operation": {
                                "operation_id": create_operation_id,
                                "base_revision": stale_revision,
                                "changes": {
                                    "node_creates": [
                                        {
                                            "id": "created-after-prompt",
                                            "type": "smart-image",
                                            "x": 3000,
                                            "y": 3000,
                                            "w": 200,
                                            "h": 100,
                                        }
                                    ]
                                },
                            },
                        }
                    )
                    created = receive_operation(stale_creator, create_operation_id)

                self.assertEqual(created["type"], "canvas_mutation")
                self.assertEqual(created["revision"], saved.json()["revision"] + 1)
                stored_templates = client.get(
                    f"/api/canvases/{canvas['id']}/prompt-templates"
                ).json()["templates"]
                self.assertEqual(
                    [item["positive"] for item in stored_templates],
                    ["无关移动后仍可保存并继续创建 Node"],
                )
                stored_canvas = client.get(
                    f"/api/canvases/{canvas['id']}"
                ).json()["canvas"]
                nodes = {node["id"]: node for node in stored_canvas["nodes"]}
                self.assertEqual(nodes["anchor-node"]["x"], 1200)
                self.assertEqual(
                    (
                        nodes["created-after-prompt"]["x"],
                        nodes["created-after-prompt"]["y"],
                    ),
                    (3000, 3000),
                )

    def test_prompt_update_rebases_unrelated_changes_but_rejects_same_item_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            main.AUTH_SYSTEM.create_user(
                username="admin",
                password="admin-password",
                role="admin",
            )
            with TestClient(main.app) as client:
                self._login(client, "admin", "admin-password")
                canvas = client.post(
                    "/api/canvases",
                    json={"title": "Prompt item conflict", "kind": "smart"},
                ).json()["canvas"]
                created = client.post(
                    f"/api/canvases/{canvas['id']}/prompt-templates",
                    json={
                        "operation_id": "prompt:create:conflict-base",
                        "base_revision": canvas["revision"],
                        "name": "角色规则",
                        "positive": "初始内容",
                    },
                ).json()
                item = created["item"]

                with client.websocket_connect(
                    f"/ws/canvases/{canvas['id']}?layout_gap=64&client_id=collaborator"
                ) as socket:
                    snapshot = receive_canvas_message(socket, "canvas_snapshot")
                    socket.send_json(
                        {
                            "type": "canvas_mutation",
                            "canvas_id": canvas["id"],
                            "operation": {
                                "operation_id": "collaborator:other-node-0001",
                                "base_revision": snapshot["revision"],
                                "changes": {
                                    "node_creates": [
                                        {"id": "other-node", "type": "smart-image"}
                                    ]
                                },
                            },
                        }
                    )
                    unrelated = receive_canvas_message(socket, "canvas_mutation")

                rebased = client.patch(
                    f"/api/canvases/{canvas['id']}/prompt-templates/{item['id']}",
                    json={
                        "operation_id": "prompt:update:after-unrelated",
                        "base_revision": created["revision"],
                        "expected_item_version": item["item_version"],
                        "name": item["name"],
                        "positive": "无关变更后安全保存",
                    },
                )
                self.assertEqual(rebased.status_code, 200, rebased.text)
                self.assertEqual(rebased.json()["revision"], unrelated["revision"] + 1)
                rebased_item = rebased.json()["item"]

                collaborator = client.patch(
                    f"/api/canvases/{canvas['id']}/prompt-templates/{item['id']}",
                    json={
                        "operation_id": "prompt:update:collaborator",
                        "base_revision": rebased.json()["revision"],
                        "expected_item_version": rebased_item["item_version"],
                        "name": item["name"],
                        "positive": "协作者版本",
                    },
                )
                self.assertEqual(collaborator.status_code, 200, collaborator.text)
                conflict = client.patch(
                    f"/api/canvases/{canvas['id']}/prompt-templates/{item['id']}",
                    json={
                        "operation_id": "prompt:update:stale-draft",
                        "base_revision": rebased.json()["revision"],
                        "expected_item_version": rebased_item["item_version"],
                        "name": item["name"],
                        "positive": "不得覆盖协作者",
                    },
                )
                self.assertEqual(conflict.status_code, 409, conflict.text)
                self.assertEqual(
                    conflict.json()["detail"]["code"],
                    "prompt_template_conflict",
                )
                stored = client.get(
                    f"/api/canvases/{canvas['id']}/prompt-templates"
                ).json()["templates"][0]
                self.assertEqual(stored["positive"], "协作者版本")

                deleted = client.delete(
                    f"/api/canvases/{canvas['id']}/prompt-templates/{item['id']}",
                    params={
                        "operation_id": "prompt:delete:response-lost",
                        "base_revision": collaborator.json()["revision"],
                        "expected_item_version": collaborator.json()["item"]["item_version"],
                    },
                )
                self.assertEqual(deleted.status_code, 200, deleted.text)
                deleted_retry = client.delete(
                    f"/api/canvases/{canvas['id']}/prompt-templates/{item['id']}",
                    params={
                        "operation_id": "prompt:delete:response-lost",
                        "base_revision": collaborator.json()["revision"],
                        "expected_item_version": collaborator.json()["item"]["item_version"],
                    },
                )
                self.assertEqual(deleted_retry.status_code, 200, deleted_retry.text)
                self.assertEqual(deleted_retry.json()["templates"], [])

    def test_multiple_internal_libraries_and_unknown_fields_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            main, _workspace = self._load_main(tmp)
            data = {
                "version": 1,
                "active_library_id": "first",
                "libraries": [
                    {
                        "id": "first",
                        "name": "第一库",
                        "categories": [{"id": "shared-id", "name": "第一分类", "color": "red"}],
                        "items": [{
                            "id": "same-item",
                            "name": "第一模板",
                            "category": "shared-id",
                            "positive": "第一内容",
                            "cover": "cover-a",
                            "future_field": {"keep": True},
                        }],
                    },
                    {
                        "id": "second",
                        "name": "第二库",
                        "categories": [{"id": "shared-id", "name": "第二分类", "color": "blue"}],
                        "items": [{
                            "id": "same-item",
                            "name": "第二模板",
                            "category": "shared-id",
                            "positive": "第二内容",
                            "cover": "cover-b",
                        }],
                    },
                ],
            }
            main.save_prompt_libraries(data)
            reloaded = main.load_prompt_libraries()
            self.assertEqual([item["id"] for item in reloaded["libraries"]], ["first", "second"])
            self.assertEqual(
                reloaded["libraries"][0]["items"][0]["future_field"],
                {"keep": True},
            )
            public = main.public_prompt_libraries(reloaded)["common"]
            self.assertEqual(
                [item["id"] for item in public["items"]],
                ["first::same-item", "second::same-item"],
            )
            self.assertEqual(
                [category["id"] for category in public["categories"]],
                ["first::shared-id", "second::shared-id"],
            )


class CanvasPromptTemplateLifecycleTests(unittest.TestCase):
    def test_two_collaborators_racing_same_template_have_one_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteCanvasStore(
                Path(tmp) / "canvas.sqlite3",
                workspace_id="workspace-race",
            )
            actor = {"id": "admin", "role": "admin", "username": "admin"}
            canvas = {
                "id": "canvas-race",
                "kind": "smart",
                "title": "Race",
                "project": "default",
                "revision": 0,
                "nodes": [],
                "connections": [],
                "prompt_templates": [
                    {
                        "id": "ctpl-race",
                        "name": "角色规则",
                        "positive": "初始内容",
                        "cover": "",
                        "scope": "canvas",
                        "created_at": 1,
                        "updated_at": 1,
                    }
                ],
            }
            store.commit(
                canvas["id"],
                actor,
                CanvasIntent.import_canvas(
                    canvas,
                    operation_id="migration:prompt-race",
                ),
            )
            initial = store.read(
                canvas["id"], actor, CanvasProjection.public_snapshot()
            ).canvas["prompt_templates"][0]
            expected = prompt_template_item_version(initial)
            barrier = threading.Barrier(2)

            def update(operation_id, positive):
                barrier.wait()
                try:
                    result = store.commit(
                        canvas["id"],
                        actor,
                        CanvasIntent.commit_prompt(
                            {
                                "action": "update",
                                "item_id": initial["id"],
                                "expected_item_version": expected,
                                "patch": {"positive": positive},
                            },
                            operation_id=operation_id,
                        ),
                    )
                    return ("ok", result.revision)
                except Exception as exc:
                    return (getattr(exc, "code", type(exc).__name__), 0)

            with ThreadPoolExecutor(max_workers=2) as executor:
                outcomes = list(
                    executor.map(
                        lambda args: update(*args),
                        [
                            ("prompt:update:racer-a", "协作者 A"),
                            ("prompt:update:racer-b", "协作者 B"),
                        ],
                    )
                )
            self.assertEqual(sum(code == "ok" for code, _ in outcomes), 1)
            self.assertEqual(
                sum(code == "prompt_template_conflict" for code, _ in outcomes),
                1,
            )
            stored = store.read(
                canvas["id"], actor, CanvasProjection.public_snapshot()
            ).canvas["prompt_templates"][0]
            self.assertIn(stored["positive"], {"协作者 A", "协作者 B"})

    def test_canvas_export_and_copy_keep_independent_prompt_templates(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteCanvasStore(
                Path(tmp) / "canvas.db",
                workspace_id="workspace-a",
                now_ms=lambda: 1000,
            )
            actor = {
                "id": "admin-1",
                "username": "admin",
                "role": "admin",
                "status": "active",
            }
            source = {
                "id": "canvas-source",
                "kind": "smart",
                "title": "Source",
                "icon": "layers",
                "owner_id": actor["id"],
                "owner_username": actor["username"],
                "visibility": "shared",
                "created_by": actor["id"],
                "updated_by": actor["id"],
                "project": "default",
                "created_at": 1,
                "updated_at": 1,
                "revision": 0,
                "nodes": [],
                "connections": [],
                "prompt_templates": [
                    {
                        "id": "ctpl-one",
                        "name": "Canvas only",
                        "positive": "Keep this with the Canvas",
                    }
                ],
            }
            store.commit(
                source["id"],
                actor,
                CanvasIntent.import_canvas(
                    source,
                    operation_id="migration:source",
                ),
            )
            exported = store.read(
                source["id"], actor, CanvasProjection.full_export()
            ).canvas
            copied = dict(exported)
            copied["id"] = "canvas-copy"
            copied["title"] = "Copy"
            store.commit(
                copied["id"],
                actor,
                CanvasIntent.import_canvas(
                    copied,
                    operation_id="copy:canvas-copy",
                ),
            )
            copy_read = store.read(
                copied["id"], actor, CanvasProjection.public_snapshot()
            ).canvas
            self.assertEqual(copy_read["prompt_templates"], source["prompt_templates"])

            copy_templates = [dict(copy_read["prompt_templates"][0], positive="Changed")]
            store.commit(
                copied["id"],
                actor,
                CanvasIntent.update_prompt_templates(
                    copy_templates,
                    base_revision=copy_read["revision"],
                    operation_id="prompt:update:copy",
                ),
            )
            source_read = store.read(
                source["id"], actor, CanvasProjection.public_snapshot()
            ).canvas
            self.assertEqual(
                source_read["prompt_templates"][0]["positive"],
                "Keep this with the Canvas",
            )


if __name__ == "__main__":
    unittest.main()
