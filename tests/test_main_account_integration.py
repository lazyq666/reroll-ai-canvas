import asyncio
import importlib
import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from infinite_canvas import auth_system
from infinite_canvas.canvas_list_index import CanvasListIndex
from infinite_canvas.canvas_store import CanvasIntent, SqliteCanvasStore
from infinite_canvas.canvas_sync import CanvasSync
from fastapi.testclient import TestClient
from PIL import Image
from tests.runtime_env import (
    configure_test_workspace,
    ensure_test_workspace,
    unload_main,
)

ensure_test_workspace()

ROOT = Path(__file__).resolve().parents[1]


class MainAccountIntegrationTests(unittest.TestCase):
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
    def _load_main(tmp, *, configured=True):
        root = Path(tmp)
        state = root / "state"
        workspace = root / "workspace"
        if configured:
            configure_test_workspace(workspace, state)
        else:
            state.mkdir(parents=True, exist_ok=True)
        os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
        unload_main()
        return importlib.import_module("main"), workspace

    def test_admin_assigns_multiple_projects_and_designer_cannot_manage_projects(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                designer = main.AUTH_SYSTEM.create_user(
                    username="designer",
                    password="designer-password",
                    role="designer",
                )
                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={"username": "admin", "password": "admin-password"},
                    )
                    project_a = client.post(
                        "/api/projects", json={"name": "Project A"}
                    ).json()["project"]
                    project_b = client.post(
                        "/api/projects", json={"name": "Project B"}
                    ).json()["project"]
                    assigned = client.put(
                        f"/api/admin/accounts/{designer['id']}/project-permissions",
                        json={"project_ids": [project_a["id"], project_b["id"]]},
                    )
                    self.assertEqual(assigned.status_code, 200)
                    self.assertEqual(
                        {project_a["id"], project_b["id"]},
                        set(assigned.json()["project_ids"]),
                    )

                    client.post("/api/auth/logout")
                    login = client.post(
                        "/api/auth/login",
                        json={
                            "username": "designer",
                            "password": "designer-password",
                        },
                    )
                    self.assertEqual(
                        {project_a["id"], project_b["id"]},
                        set(login.json()["user"]["project_ids"]),
                    )
                    visible = client.get("/api/projects").json()["projects"]
                    self.assertEqual(
                        {project_a["id"], project_b["id"]},
                        {project["id"] for project in visible},
                    )
                    self.assertEqual(
                        client.post(
                            "/api/projects", json={"name": "Forbidden"}
                        ).status_code,
                        403,
                    )
                    self.assertEqual(
                        client.post(
                            f"/api/projects/{project_a['id']}",
                            json={"name": "Forbidden rename"},
                        ).status_code,
                        403,
                    )
                    self.assertEqual(
                        client.delete(
                            f"/api/projects/{project_a['id']}"
                        ).status_code,
                        403,
                    )
                    self.assertEqual(
                        client.post(
                            "/api/canvases",
                            json={"title": "Allowed", "project": project_a["id"]},
                        ).status_code,
                        200,
                    )
                    self.assertEqual(
                        client.post(
                            "/api/canvases",
                            json={"title": "Denied", "project": "default"},
                        ).status_code,
                        403,
                    )
            finally:
                unload_main()

    def test_default_auth_database_uses_instance_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            unload_main()
            try:
                workspace = Path(tmp) / "workspace"
                workspace_data = workspace / "data"
                workspace_assets = workspace / "assets"
                state = Path(tmp) / "state"
                workspace_data.mkdir(parents=True)
                workspace_assets.mkdir()
                state.mkdir()
                configure_test_workspace(workspace, state)
                os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
                with patch(
                    "infinite_canvas.auth_system.auth_from_environment",
                    wraps=auth_system.auth_from_environment,
                ) as auth_factory:
                    main = importlib.import_module("main")

                configured_state = auth_factory.call_args.args[0]
                self.assertEqual(
                    (state / "instance-state").resolve(),
                    configured_state.directory,
                )
                self.assertEqual(
                    (state / "instance-state" / "auth.db").resolve(),
                    main.AUTH_SYSTEM.database_path.resolve(),
                )
                self.assertFalse((workspace_data / "auth.db").exists())
            finally:
                unload_main()

    def test_smart_canvas_view_state_routes_follow_account_not_shared_canvas(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
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
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "designer",
                            "password": "designer-password",
                        },
                    )
                    canvas = client.post(
                        "/api/canvases",
                        json={"title": "Remember me", "kind": "smart"},
                    ).json()["canvas"]
                    endpoint = (
                        f"/api/smart-canvas/{canvas['id']}/view-state"
                    )
                    self.assertIsNone(
                        client.get(endpoint).json()["view_state"]
                    )
                    saved = client.put(
                        endpoint,
                        json={
                            "center_x": 321.5,
                            "center_y": -88,
                            "scale": 1.4,
                        },
                    )
                    self.assertEqual(saved.status_code, 200)

                    client.post("/api/auth/logout")
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    self.assertIsNone(
                        client.get(endpoint).json()["view_state"]
                    )
                    self.assertEqual(
                        client.put(
                            endpoint,
                            json={
                                "center_x": 10,
                                "center_y": 20,
                                "scale": 0,
                            },
                        ).status_code,
                        422,
                    )

                    client.post("/api/auth/logout")
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "designer",
                            "password": "designer-password",
                        },
                    )
                    restored = client.get(endpoint).json()["view_state"]
                    self.assertEqual(restored["center_x"], 321.5)
                    self.assertEqual(restored["center_y"], -88)
                    self.assertEqual(restored["scale"], 1.4)

                    client.post("/api/auth/logout")
                    self.assertEqual(client.get(endpoint).status_code, 401)
            finally:
                unload_main()

    def test_first_startup_waits_for_explicit_admin_setup(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(
                    tmp,
                    configured=False,
                )
                with ExitStack() as stack:
                    migrate_access = stack.enter_context(
                        patch.object(main, "migrate_all_canvas_access")
                    )
                    asyncio.run(main.startup_event())
                    asyncio.run(main.startup_event())

                self.assertTrue(main.AUTH_SYSTEM.needs_initial_setup())
                self.assertEqual(main.AUTH_SYSTEM.list_users(), [])
                self.assertIsNone(main.AUTH_SYSTEM.authenticate("admin", "admin"))
                self.assertEqual(migrate_access.call_count, 0)
                with TestClient(main.app) as client:
                    response = client.get("/setup")
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(
                        'id="workspace-selection-step"',
                        response.text,
                    )
                    self.assertIn(
                        'id="initial-setup-form" hidden',
                        response.text,
                    )
            finally:
                unload_main()

    def test_startup_does_not_rewrite_static_html_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(
                    tmp,
                    configured=False,
                )
                static_dir = Path(tmp) / "static"
                script_dir = static_dir / "js"
                script_dir.mkdir(parents=True)
                (script_dir / "theme.js").write_text(
                    "window.theme = 'light';\n",
                    encoding="utf-8",
                )
                page = static_dir / "index.html"
                original = (
                    '<script src="/static/js/theme.js?v=committed"></script>\n'
                )
                page.write_text(original, encoding="utf-8")

                with patch.object(main, "STATIC_DIR", str(static_dir)):
                    main._prepare_startup_state()

                self.assertEqual(original, page.read_text(encoding="utf-8"))
            finally:
                unload_main()

    def test_static_html_versioning_preserves_existing_query_parameters(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                rendered = main.versioned_static_html(
                    '<iframe data-src="/static/smart-canvas.html'
                    '?componentReview=nodes&mode=review&v=stale#surface">'
                    "</iframe>"
                )
                match = re.search(r'data-src="([^"]+)"', rendered)
                self.assertIsNotNone(match)
                parsed = urlsplit(match.group(1))
                query = parse_qs(parsed.query)
                self.assertEqual(query.get("componentReview"), ["nodes"])
                self.assertEqual(query.get("mode"), ["review"])
                self.assertEqual(len(query.get("v", [])), 1)
                self.assertNotIn("?", query["v"][0])
                self.assertEqual(parsed.fragment, "surface")
            finally:
                unload_main()

    def test_static_html_versioning_is_independent_of_local_mtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                static_dir = Path(tmp) / "static"
                script_dir = static_dir / "js"
                script_dir.mkdir(parents=True)
                script = script_dir / "theme.js"
                script.write_text("window.theme = 'light';\n", encoding="utf-8")
                source = '<script src="/static/js/theme.js?v=stale"></script>'

                with (
                    patch.object(main, "STATIC_DIR", str(static_dir)),
                    patch.object(
                        main,
                        "current_app_version",
                        return_value="2026.09.04.1",
                    ),
                ):
                    os.utime(script, (100, 100))
                    first = main.versioned_static_html(source)
                    os.utime(script, (200, 200))
                    second = main.versioned_static_html(source)

                self.assertEqual(first, second)
                self.assertIn("?v=2026.09.04.1", first)
            finally:
                unload_main()

    def test_static_html_versioning_preserves_ui_content_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                source = (
                    '<script type="module" '
                    'src="/static/js/infinite-canvas-ui/core.js'
                    '?mode=review&v=ic-ui-0123456789ab"></script>'
                )

                self.assertEqual(source, main.versioned_static_html(source))
            finally:
                unload_main()

    def test_static_html_versioning_preserves_i18n_content_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                source = (
                    '<script src="/static/js/i18n.js'
                    '?mode=review&v=i18n-loader-0123456789ab"></script>'
                )

                self.assertEqual(source, main.versioned_static_html(source))
            finally:
                unload_main()

    def test_authenticated_designer_creates_owned_canvas_and_anonymous_is_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, workspace = self._load_main(tmp)
                main.AUTH_SYSTEM.create_user(
                    username="admin", password="admin-password", role="admin"
                )

                client = TestClient(main.app)
                self.assertEqual(client.get("/api/canvases").status_code, 401)
                login_page = client.get("/login")
                self.assertEqual(login_page.status_code, 200)
                login_csp = login_page.headers.get("content-security-policy", "")
                self.assertIn("style-src 'self' 'unsafe-inline'", login_csp)
                self.assertIn("script-src 'self'", login_csp)
                self.assertNotIn("script-src 'self' 'unsafe-inline'", login_csp)
                self.assertIn('id="register-form"', login_page.text)
                self.assertIn("创建账号", login_page.text)
                self.assertIn('/static/images/brand/logo.png', login_page.text)
                self.assertIn("提交账号申请", login_page.text)
                self.assertNotIn("创建账号并登录", login_page.text)
                self.assertIn('id="remember-password"', login_page.text)
                self.assertIn("记住密码", login_page.text)
                self.assertNotIn("申请角色为设计师", login_page.text)
                self.assertNotIn("还可提交", login_page.text)
                self.assertNotIn("新账号需由管理员审核", login_page.text)
                self.assertNotIn("游客通过画布分享链接访问", login_page.text)
                registration = client.post(
                    "/api/auth/register",
                    json={
                        "username": "designer",
                        "display_name": "Designer",
                        "password": "designer-pass",
                    },
                )
                self.assertEqual(registration.status_code, 202)
                application = registration.json()["application"]
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                designer = client.post(
                    f"/api/admin/account-applications/{application['id']}/approve"
                ).json()["user"]
                client.post("/api/auth/logout")
                login = client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                self.assertEqual(login.status_code, 200)

                created = client.post("/api/canvases", json={"title": "Owned"})
                self.assertEqual(created.status_code, 200)
                self.assertEqual(created.json()["canvas"]["owner_id"], designer["id"])
                self.assertEqual(
                    created.json()["canvas"]["owner_username"],
                    designer["username"],
                )
                self.assertEqual(created.json()["canvas"]["visibility"], "shared")
                canvas_id = created.json()["canvas"]["id"]
                client.post("/api/auth/logout")
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                workspace_page = client.get("/").text
                self.assertIn("account-management", workspace_page)
                shell_script = (
                    ROOT / "static" / "js" / "studio-shell.js"
                ).read_text(encoding="utf-8")
                self.assertRegex(
                    shell_script,
                    r"const PAGE_IDS = \[[^\]]*'account-management'",
                )
                self.assertRegex(
                    shell_script,
                    r"const SETTINGS_PAGE_IDS = \[[^\]]*'account-management'",
                )
                management_page = client.get("/static/account-management.html")
                self.assertEqual(management_page.status_code, 200)
                self.assertIn('id="account-applications"', management_page.text)
                self.assertIn('id="account-users"', management_page.text)
                self.assertIn("<ic-table", management_page.text)
                self.assertRegex(
                    management_page.text,
                    r"<th[^>]*>登录账号</th><th[^>]*>显示名称</th>",
                )
                deleted = client.delete(f"/api/admin/accounts/{designer['id']}")
                self.assertEqual(deleted.status_code, 200)
                reassigned = client.get(f"/api/canvases/{canvas_id}").json()["canvas"]
                self.assertEqual(
                    reassigned["owner_id"], main.AUTH_SYSTEM.first_admin()["id"]
                )
                client.close()
            finally:
                unload_main()

    def test_public_account_delete_transfers_sqlite_canvas_owner_without_legacy_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, workspace = self._load_main(tmp)
                admin = main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                designer = main.AUTH_SYSTEM.create_user(
                    username="designer",
                    password="designer-password",
                    role="designer",
                )
                store = SqliteCanvasStore(
                    Path(tmp) / "sqlite-account-delete" / "canvas-content.sqlite3",
                    workspace_id=main.current_workspace_id(),
                    now_ms=lambda: 1700,
                )
                canvas_id = "sqlite-owned-private-canvas"
                store.commit(
                    canvas_id,
                    designer,
                    CanvasIntent.import_canvas(
                        {
                            "id": canvas_id,
                            "kind": "smart",
                            "title": "Designer private work",
                            "icon": "layers",
                            "owner_id": designer["id"],
                            "owner_username": designer["username"],
                            "visibility": "private",
                            "created_by": designer["id"],
                            "updated_by": designer["id"],
                            "project": "default",
                            "created_at": 100,
                            "updated_at": 1600,
                            "revision": 3,
                            "nodes": [
                                {
                                    "id": "kept-node",
                                    "type": "smart-prompt",
                                    "text": "Keep this content",
                                }
                            ],
                            "connections": [],
                        },
                        operation_id="migration:sqlite-account-owner",
                    ),
                )
                sync = CanvasSync(
                    content=main.current_workspace_content,
                    now_ms=lambda: 1700,
                    workspace_id=main.current_workspace_id,
                    initial_admin=main.AUTH_SYSTEM.first_admin,
                    canvas_store=lambda: store,
                )
                main.CANVAS_SYNC = sync
                main.CANVAS_LIST_INDEX = CanvasListIndex(
                    lambda: Path(tmp) / "legacy-account-index-must-stay-absent",
                    index_file=lambda: Path(tmp) / "legacy-account-index.json",
                    record_loader=sync.list_canvas_items,
                )

                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    deleted = client.delete(
                        f"/api/admin/accounts/{designer['id']}"
                    )
                    read = client.get(f"/api/canvases/{canvas_id}")

                    self.assertEqual(deleted.status_code, 200)
                    self.assertEqual(read.status_code, 200)
                    canvas = read.json()["canvas"]
                    self.assertEqual(canvas["owner_id"], admin["id"])
                    self.assertEqual(canvas["owner_username"], admin["username"])
                    self.assertEqual(canvas["visibility"], "private")
                    self.assertEqual(
                        canvas["nodes"],
                        [
                            {
                                "id": "kept-node",
                                "type": "smart-prompt",
                                "text": "Keep this content",
                            }
                        ],
                    )
                    self.assertEqual(
                        [
                            item["id"]
                            for item in client.get("/api/canvases").json()["canvases"]
                        ],
                        [canvas_id],
                    )
                self.assertFalse(
                    Path(
                        main.current_workspace_content().smart_canvas(canvas_id)
                    ).exists()
                )
                self.assertFalse(
                    (workspace / "data" / "canvases" / f"{canvas_id}.json").exists()
                )
            finally:
                unload_main()

    def test_public_canvas_list_startup_ignores_legacy_json_with_sqlite_store(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                admin = main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                store = SqliteCanvasStore(
                    Path(tmp) / "sqlite-startup" / "canvas-content.sqlite3",
                    workspace_id=main.current_workspace_id(),
                    now_ms=lambda: 1800,
                )
                canvas_id = "sqlite-startup-canvas"
                store.commit(
                    canvas_id,
                    admin,
                    CanvasIntent.import_canvas(
                        {
                            "id": canvas_id,
                            "kind": "smart",
                            "title": "SQLite startup canvas",
                            "icon": "layers",
                            "owner_id": admin["id"],
                            "owner_username": admin["username"],
                            "visibility": "shared",
                            "created_by": admin["id"],
                            "updated_by": admin["id"],
                            "project": "default",
                            "created_at": 100,
                            "updated_at": 1700,
                            "revision": 1,
                            "nodes": [],
                            "connections": [],
                        },
                        operation_id="migration:sqlite-startup-canvas",
                    ),
                )
                legacy_path = Path(
                    main.current_workspace_content().smart_canvas("broken-legacy")
                )
                legacy_path.parent.mkdir(parents=True, exist_ok=True)
                legacy_path.write_text("{not-valid-json", encoding="utf-8")
                sync = CanvasSync(
                    content=main.current_workspace_content,
                    now_ms=lambda: 1800,
                    workspace_id=main.current_workspace_id,
                    initial_admin=main.AUTH_SYSTEM.first_admin,
                    canvas_store=lambda: store,
                )
                main.CANVAS_SYNC = sync
                main.CANVAS_LIST_INDEX = CanvasListIndex(
                    lambda: Path(tmp) / "legacy-startup-index-must-stay-absent",
                    index_file=lambda: Path(tmp) / "legacy-startup-index.json",
                    record_loader=sync.list_canvas_items,
                )

                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    response = client.get("/api/canvases")

                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(
                        [item["id"] for item in response.json()["canvases"]],
                        [canvas_id],
                    )
                self.assertEqual(
                    legacy_path.read_text(encoding="utf-8"),
                    "{not-valid-json",
                )
                self.assertFalse(
                    Path(
                        main.current_workspace_content().smart_canvas(canvas_id)
                    ).exists()
                )
            finally:
                unload_main()

    def test_public_canvas_list_composition_uses_sqlite_projection_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, _workspace = self._load_main(tmp)
                admin = main.AUTH_SYSTEM.create_user(
                    username="admin",
                    password="admin-password",
                    role="admin",
                )
                store = SqliteCanvasStore(
                    Path(tmp) / "sqlite-list-composition" / "canvas-content.sqlite3",
                    workspace_id=main.current_workspace_id(),
                    now_ms=lambda: 1900,
                )
                canvas_id = "sqlite-composed-list-canvas"
                store.commit(
                    canvas_id,
                    admin,
                    CanvasIntent.import_canvas(
                        {
                            "id": canvas_id,
                            "kind": "smart",
                            "title": "SQLite authority",
                            "icon": "layers",
                            "owner_id": admin["id"],
                            "owner_username": admin["username"],
                            "visibility": "shared",
                            "created_by": admin["id"],
                            "updated_by": admin["id"],
                            "project": "default",
                            "created_at": 100,
                            "updated_at": 1900,
                            "revision": 1,
                            "nodes": [],
                            "connections": [],
                        },
                        operation_id="migration:sqlite-composed-list",
                    ),
                )
                legacy_path = Path(
                    main.current_workspace_content().smart_canvas("legacy-decoy")
                )
                legacy_path.parent.mkdir(parents=True, exist_ok=True)
                legacy_path.write_text(
                    json.dumps(
                        {
                            "id": "legacy-decoy",
                            "kind": "smart",
                            "title": "Legacy decoy",
                            "owner_id": admin["id"],
                            "owner_username": admin["username"],
                            "visibility": "shared",
                            "project": "default",
                            "updated_at": 2000,
                            "nodes": [],
                            "connections": [],
                        }
                    ),
                    encoding="utf-8",
                )
                main.CANVAS_SYNC = CanvasSync(
                    content=main.current_workspace_content,
                    now_ms=lambda: 1900,
                    workspace_id=main.current_workspace_id,
                    initial_admin=main.AUTH_SYSTEM.first_admin,
                    canvas_store=lambda: store,
                )

                with TestClient(main.app) as client:
                    client.post(
                        "/api/auth/login",
                        json={
                            "username": "admin",
                            "password": "admin-password",
                        },
                    )
                    response = client.get("/api/canvases")

                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(
                        [item["id"] for item in response.json()["canvases"]],
                        [canvas_id],
                    )
                    self.assertFalse(response.json()["rebuilding"])
                    self.assertFalse(response.json()["index_error"])
            finally:
                unload_main()

    def test_designer_can_restore_trashed_canvas_but_only_admin_can_purge_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, workspace = self._load_main(tmp)
                canvas_dir = workspace / "data" / "canvases"
                main.AUTH_SYSTEM.create_user(
                    username="admin", password="admin-password", role="admin"
                )
                main.AUTH_SYSTEM.create_user(
                    username="designer", password="designer-pass", role="designer"
                )

                client = TestClient(main.app)
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                canvas = client.post(
                    "/api/canvases", json={"title": "Recoverable"}
                ).json()["canvas"]
                canvas_path = canvas_dir / f"{canvas['id']}.json"

                self.assertEqual(
                    client.delete(f"/api/canvases/{canvas['id']}").status_code,
                    200,
                )
                self.assertEqual(
                    client.post(f"/api/canvases/{canvas['id']}/restore").status_code,
                    200,
                )
                self.assertEqual(
                    client.delete(f"/api/canvases/{canvas['id']}").status_code,
                    200,
                )

                denied = client.delete(f"/api/canvases/{canvas['id']}/purge")
                self.assertEqual(denied.status_code, 403)
                self.assertTrue(canvas_path.exists())

                client.post("/api/auth/logout")
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                self.assertIn(
                    canvas["id"],
                    [
                        item["id"]
                        for item in client.get("/api/canvases/trash").json()["canvases"]
                    ],
                )
                self.assertEqual(
                    client.delete(f"/api/canvases/{canvas['id']}/purge").status_code,
                    200,
                )
                self.assertFalse(canvas_path.exists())
                client.close()
            finally:
                unload_main()

    def test_share_link_exposes_read_only_canvas_and_only_referenced_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, workspace = self._load_main(tmp)
                assets_dir = workspace / "assets"
                Image.new("RGB", (1024, 512), "blue").save(assets_dir / "visible.png")
                visible_media = (assets_dir / "visible.png").read_bytes()
                (assets_dir / "secret.png").write_bytes(b"not-referenced")
                main.AUTH_SYSTEM.create_user(
                    username="designer", password="designer-pass", role="designer"
                )

                client = TestClient(main.app)
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                canvas = client.post(
                    "/api/canvases", json={"title": "Shared canvas"}
                ).json()["canvas"]
                saved = client.put(
                    f"/api/canvases/{canvas['id']}",
                    json={
                        "title": canvas["title"],
                        "nodes": [
                            {"id": "image-1", "url": "/assets/visible.png"},
                            {
                                "id": "smart-image-1",
                                "type": "smart-image",
                                "images": [{"url": "/assets/visible.png", "name": "原始名称.png"}],
                                "promptDraftText": "private image prompt",
                            },
                            {"id": "smart-text-1", "type": "smart-text", "text": "观众可见文字"},
                            {
                                "id": "smart-prompt-1",
                                "type": "smart-prompt",
                                "text": "shared prompt node",
                                "prompt": "shared prompt value",
                                "apiKey": "must-not-leak",
                            },
                        ],
                        "connections": [
                            {"from": "smart-prompt-1", "to": "smart-image-1"},
                            {"from": "smart-image-1", "to": "smart-text-1"},
                        ],
                    },
                )
                self.assertEqual(saved.status_code, 200)

                share = client.post(f"/api/canvases/{canvas['id']}/share")
                self.assertEqual(share.status_code, 200)
                token = share.json()["token"]
                client.post("/api/auth/logout")

                share_page = client.get(f"/share/{token}")
                self.assertEqual(share_page.status_code, 200)
                self.assertIn("只读", share_page.text)
                self.assertIn('id="share-minimap"', share_page.text)
                self.assertIn('/static/images/brand/logo.png', share_page.text)
                self.assertNotIn('id="fit-button"', share_page.text)
                self.assertNotIn("只读分享 ·", share_page.text)
                share_css = client.get("/static/css/canvas-share.css")
                self.assertIn("[hidden]", share_css.text)
                self.assertIn("display: none !important", share_css.text)
                self.assertEqual(client.get("/share/not-a-token").status_code, 404)
                public = client.get(f"/api/shares/{token}")
                self.assertEqual(public.status_code, 200)
                public_canvas = public.json()["canvas"]
                media_url = public_canvas["nodes"][0]["url"]
                self.assertTrue(media_url.startswith(f"/api/shares/{token}/media/"))
                self.assertTrue(media_url.endswith("?name=visible.png"))
                self.assertNotIn("owner_id", public_canvas)
                self.assertEqual(
                    [node["id"] for node in public_canvas["nodes"]],
                    ["image-1", "smart-image-1", "smart-text-1", "smart-prompt-1"],
                )
                self.assertEqual(public_canvas["nodes"][1]["images"][0]["name"], "原始名称.png")
                self.assertEqual(public_canvas["nodes"][1]["promptDraftText"], "private image prompt")
                self.assertEqual(public_canvas["nodes"][2]["text"], "观众可见文字")
                self.assertEqual(public_canvas["nodes"][3]["text"], "shared prompt node")
                self.assertEqual(public_canvas["nodes"][3]["prompt"], "shared prompt value")
                self.assertNotIn("apiKey", public_canvas["nodes"][3])
                self.assertEqual(
                    public_canvas["connections"],
                    [
                        {"from": "smart-prompt-1", "to": "smart-image-1"},
                        {"from": "smart-image-1", "to": "smart-text-1"},
                    ],
                )
                self.assertNotIn("must-not-leak", json.dumps(public_canvas, ensure_ascii=False))
                self.assertEqual(
                    client.get("/assets/visible.png", follow_redirects=False).status_code,
                    303,
                )
                self.assertEqual(client.get(media_url).content, visible_media)
                preview = client.get(f"{media_url}&w=600")
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(preview.headers["cache-control"], "private, no-store")
                with Image.open(io.BytesIO(preview.content)) as preview_image:
                    self.assertEqual(preview_image.width, 1024)
                    self.assertEqual(preview_image.height, 512)
                self.assertEqual(
                    client.get(f"/api/shares/{token}/media/not-referenced").status_code,
                    404,
                )
                self.assertEqual(client.put(f"/api/shares/{token}", json={}).status_code, 405)

                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-pass"},
                )
                self.assertEqual(
                    client.delete(f"/api/canvases/{canvas['id']}/share").status_code,
                    200,
                )
                client.post("/api/auth/logout")
                self.assertEqual(client.get(f"/api/shares/{token}").status_code, 404)
                client.close()
            finally:
                unload_main()

    def test_admin_private_canvas_is_hidden_from_every_other_account(self):
        with tempfile.TemporaryDirectory() as tmp:
            try:
                main, workspace = self._load_main(tmp)
                canvas_dir = workspace / "data" / "canvases"
                owner = main.AUTH_SYSTEM.create_user(
                    username="owner", password="owner-pass", role="admin"
                )
                main.AUTH_SYSTEM.create_user(
                    username="other-admin", password="other-pass", role="admin"
                )
                main.AUTH_SYSTEM.create_user(
                    username="designer", password="designer-pass", role="designer"
                )
                (canvas_dir / "legacy.json").write_text(
                    '{"id":"legacy","title":"Legacy","nodes":[],"connections":[]}',
                    encoding="utf-8",
                )
                main.migrate_all_canvas_access()
                client = TestClient(main.app)

                client.post(
                    "/api/auth/login",
                    json={"username": "owner", "password": "owner-pass"},
                )
                migrated = client.get("/api/canvases").json()["canvases"]
                migrated_legacy = next(item for item in migrated if item["id"] == "legacy")
                self.assertEqual(migrated_legacy["owner_id"], owner["id"])
                self.assertEqual(
                    migrated_legacy["owner_username"], owner["username"]
                )
                self.assertTrue(
                    (
                        workspace
                        / "data"
                        / "recovery"
                        / "v0_canvas_permissions"
                        / "legacy.json"
                    ).exists()
                )
                masked_token = client.get("/api/config/token").json()
                self.assertNotIn("token", masked_token)
                canvas = client.post(
                    "/api/canvases", json={"title": "Private"}
                ).json()["canvas"]
                share = client.post(f"/api/canvases/{canvas['id']}/share").json()
                private = client.put(
                    f"/api/canvases/{canvas['id']}/visibility",
                    json={"visibility": "private"},
                )
                self.assertEqual(private.status_code, 200)
                self.assertEqual(private.json()["canvas"]["owner_id"], owner["id"])
                self.assertEqual(client.get(f"/api/shares/{share['token']}").status_code, 404)

                for username, password in (
                    ("other-admin", "other-pass"),
                    ("designer", "designer-pass"),
                ):
                    client.post("/api/auth/logout")
                    client.post(
                        "/api/auth/login",
                        json={"username": username, "password": password},
                    )
                    listed = client.get("/api/canvases").json()["canvases"]
                    self.assertNotIn(canvas["id"], [item["id"] for item in listed])
                    self.assertEqual(
                        client.get(f"/api/canvases/{canvas['id']}").status_code,
                        404,
                    )
                client.close()
            finally:
                unload_main()


if __name__ == "__main__":
    unittest.main()
