import re
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from backend.infinite_canvas.auth_system import (
    AuthSystem,
    install_access_control,
    install_auth_routes,
)


ROOT = Path(__file__).resolve().parents[1]
PAGE_PATH = ROOT / "static" / "ui-component-library.html"
STYLE_PATH = ROOT / "static" / "css" / "ui-component-library.css"
SURFACE_APP_PATH = (
    ROOT / "static" / "js" / "ui-component-library" / "surface-app.js"
)
BACKEND_MAIN_PATH = ROOT / "backend" / "main.py"
AUTH_SYSTEM_PATH = ROOT / "backend" / "infinite_canvas" / "auth_system.py"
SEMANTIC_BASELINE_ROUTE = (
    "/static/design-system/infinite-canvas-ui/semantic-baseline-v1.json"
)
FOUNDATIONS_ROUTES = (
    "/static/design-system/infinite-canvas-ui/foundations.html",
    "/static/design-system/infinite-canvas-ui/foundation-case.html",
    "/static/js/infinite-canvas-ui/foundation-matrix.js",
    "/static/js/infinite-canvas-ui/foundation-case.js",
    "/static/js/infinite-canvas-ui/theme-adapter.js",
    "/static/js/infinite-canvas-ui/icon.js",
)
ACTIONS_ROUTES = (
    "/static/design-system/infinite-canvas-ui/ic-actions-v1.json",
    "/static/design-system/infinite-canvas-ui/actions.html",
    "/static/design-system/infinite-canvas-ui/action-case.html",
    "/static/js/infinite-canvas-ui/actions.js",
    "/static/js/infinite-canvas-ui/actions/index.js",
    "/static/js/infinite-canvas-ui/actions/button.js",
    "/static/js/infinite-canvas-ui/actions/icon-button.js",
    "/static/js/infinite-canvas-ui/actions/button-group.js",
    "/static/js/infinite-canvas-ui/actions/shared.js",
    "/static/js/infinite-canvas-ui/actions/styles.js",
    "/static/js/infinite-canvas-ui/action-matrix.js",
    "/static/js/infinite-canvas-ui/action-case.js",
)
TEXT_ENTRY_ROUTES = (
    "/static/design-system/infinite-canvas-ui/ic-text-entry-v1.json",
    "/static/design-system/infinite-canvas-ui/text-entry.html",
    "/static/design-system/infinite-canvas-ui/text-entry-case.html",
    "/static/js/infinite-canvas-ui/text-entry.js",
    "/static/js/infinite-canvas-ui/text-entry/index.js",
    "/static/js/infinite-canvas-ui/text-entry/input.js",
    "/static/js/infinite-canvas-ui/text-entry/textarea.js",
    "/static/js/infinite-canvas-ui/text-entry/form-field.js",
    "/static/js/infinite-canvas-ui/text-entry/shared.js",
    "/static/js/infinite-canvas-ui/text-entry/styles.js",
    "/static/js/infinite-canvas-ui/text-entry-matrix.js",
    "/static/js/infinite-canvas-ui/text-entry-case.js",
)
SELECTION_ADJUSTMENT_ROUTES = (
    "/static/design-system/infinite-canvas-ui/ic-selection-adjustment-v1.json",
    "/static/design-system/infinite-canvas-ui/selection-adjustment.html",
    "/static/design-system/infinite-canvas-ui/selection-adjustment-case.html",
    "/static/js/infinite-canvas-ui/selection-adjustment.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/index.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/checkbox.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/radio.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/radio-group.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/switch.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/select.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/slider.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/number-input.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/color-field.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/shared.js",
    "/static/js/infinite-canvas-ui/selection-adjustment/styles.js",
    "/static/js/infinite-canvas-ui/selection-adjustment-matrix.js",
    "/static/js/infinite-canvas-ui/selection-adjustment-case.js",
)
DIALOG_ROUTES = (
    "/static/design-system/infinite-canvas-ui/ic-dialog-v1.json",
    "/static/design-system/infinite-canvas-ui/dialog.html",
    "/static/design-system/infinite-canvas-ui/dialog-case.html",
    "/static/js/infinite-canvas-ui/dialog.js",
    "/static/js/infinite-canvas-ui/dialog/index.js",
    "/static/js/infinite-canvas-ui/dialog/dialog.js",
    "/static/js/infinite-canvas-ui/dialog/confirmation-dialog.js",
    "/static/js/infinite-canvas-ui/dialog/shared.js",
    "/static/js/infinite-canvas-ui/dialog/styles.js",
    "/static/js/infinite-canvas-ui/ai-processor-dialog.js",
    "/static/js/infinite-canvas-ui/ai-processor-dialog/styles.js",
)
NAVIGATION_COMMAND_ROUTES = (
    "/static/design-system/infinite-canvas-ui/ic-navigation-command-v1.json",
    "/static/design-system/infinite-canvas-ui/navigation-command.html",
    "/static/design-system/infinite-canvas-ui/navigation-command-case.html",
    "/static/js/infinite-canvas-ui/navigation-command.js",
    "/static/js/infinite-canvas-ui/navigation-command/index.js",
    "/static/js/infinite-canvas-ui/navigation-command/shared.js",
    "/static/js/infinite-canvas-ui/navigation-command/composite.js",
    "/static/js/infinite-canvas-ui/navigation-command/tabs.js",
    "/static/js/infinite-canvas-ui/navigation-command/segmented-control.js",
    "/static/js/infinite-canvas-ui/navigation-command/toolbar.js",
    "/static/js/infinite-canvas-ui/navigation-command/floating-toolbar.js",
    "/static/js/infinite-canvas-ui/navigation-command/nav-item.js",
    "/static/js/infinite-canvas-ui/navigation-command/nav-disclosure.js",
    "/static/js/infinite-canvas-ui/navigation-command/breadcrumb.js",
    "/static/js/infinite-canvas-ui/navigation-command/pagination.js",
    "/static/js/infinite-canvas-ui/navigation-command/steps.js",
)


class UiComponentLibraryEntryTests(unittest.TestCase):
    def test_component_library_is_a_direct_admin_workbench(self):
        shell = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        shell_script = (ROOT / "static" / "js" / "studio-shell.js").read_text(
            encoding="utf-8"
        )
        backend_main = BACKEND_MAIN_PATH.read_text(encoding="utf-8")
        auth_system = AUTH_SYSTEM_PATH.read_text(encoding="utf-8")

        self.assertNotIn('id="ui-component-library-entry"', shell)
        self.assertNotIn("openUiComponentLibrary", shell_script)
        self.assertNotIn('id="frame-ui-component-library"', shell)
        self.assertNotRegex(
            shell,
            r"const PAGE_IDS = \[[^\]]*'ui-component-library'",
        )
        self.assertIn('@app.get("/ui-component-library")', backend_main)
        self.assertIn('static_html_response("ui-component-library.html")', backend_main)
        self.assertIn("(?:data-src|src|href)", backend_main)
        self.assertIn('"/ui-component-library"', auth_system)

    def test_catalog_runtime_assets_are_available_from_the_static_origin(self):
        page = PAGE_PATH.read_text(encoding="utf-8")
        asset_routes = set(
            re.findall(r'(?:src|href|data-src)="(/static/[^"?]+)', page)
        )
        asset_routes.update(
            {
                "/static/design-system/live-catalog/manifest.json",
                "/static/design-system/live-catalog/fixture-registry.json",
                "/static/design-system/live-catalog/sandbox.html",
            }
        )
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {route: client.get(route) for route in sorted(asset_routes)}

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {
                route: response.status_code
                for route, response in responses.items()
                if response.status_code != 200
            },
        )

    def test_catalog_page_exposes_three_component_surfaces(self):
        page = PAGE_PATH.read_text(encoding="utf-8")
        styles = STYLE_PATH.read_text(encoding="utf-8")

        for surface in ("legacy", "target", "migration"):
            self.assertIn(f'data-surface-tab="{surface}"', page)
            self.assertIn(f'data-surface-panel="{surface}"', page)
        self.assertIn("data-catalog-sidebar", page)
        self.assertIn("data-candidate-region", page)
        self.assertIn("data-decision-panel", page)
        self.assertIn("data-sidebar-toggle", page)
        self.assertIn("grid-template-columns: 210px minmax(0, 1fr)", styles)
        self.assertIn(".target-surface-grid", styles)
        self.assertIn(".migration-map-layout", styles)
        self.assertIn("@media (max-width: 980px)", styles)
        self.assertIn(".catalog-sidebar.is-open", styles)
        self.assertIn("grid-template-columns: minmax(0, 1fr)", styles)
        self.assertNotIn("component-workbench", page)

    def test_live_reviews_use_one_page_scroll_and_lazy_frames(self):
        page = PAGE_PATH.read_text(encoding="utf-8")
        styles = STYLE_PATH.read_text(encoding="utf-8")
        surface_app = SURFACE_APP_PATH.read_text(encoding="utf-8")

        self.assertIn('aria-label="按钮对比矩阵"', page)
        self.assertIn('class="target-component-matrix-table"', page)
        self.assertIn("flex-wrap: wrap", styles)
        self.assertIn('body[data-active-surface="target"] { overflow: auto; overflow-anchor: none; }', styles)
        self.assertIn("fitTargetFrame", surface_app)
        self.assertIn("fitNestedFrames", surface_app)
        self.assertIn("loadTargetFrame", surface_app)
        self.assertIn("frame.setAttribute('scrolling', 'no')", surface_app)
        self.assertIn("window.history.scrollRestoration = 'manual'", surface_app)
        self.assertIn("resetTargetReviewScroll", surface_app)
        self.assertIn("window.scrollTo({ top: 0, left: 0, behavior: 'auto' })", surface_app)

        hidden_reviews = re.findall(r"<iframe(?=[^>]*\bhidden\b)[^>]*>", page, re.S)
        self.assertGreater(len(hidden_reviews), 10)
        self.assertTrue(
            all("data-src=" in frame and " src=" not in frame for frame in hidden_reviews),
            "隐藏的 Live/Contract iframe 必须按需加载",
        )

    def test_semantic_baseline_is_available_from_the_runtime_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            response = client.get(SEMANTIC_BASELINE_ROUTE)

        self.assertEqual(response.status_code, 200)
        baseline = response.json()
        self.assertEqual(baseline["schemaVersion"], 1)
        self.assertEqual(
            baseline["review"]["status"], "pending-human-confirmation"
        )
        surface_app = SURFACE_APP_PATH.read_text(encoding="utf-8")
        self.assertIn(SEMANTIC_BASELINE_ROUTE, surface_app)
        self.assertNotIn(
            "/docs/design-system/classification/infinite-canvas-ui-semantic-baseline-v1.json",
            surface_app,
        )

    def test_foundations_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {route: client.get(route) for route in FOUNDATIONS_ROUTES}
            page = client.get("/static/ui-component-library.html")
            manifest = client.get(
                "/static/design-system/infinite-canvas-ui/surface-manifest.json"
            )

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )
        self.assertEqual(page.status_code, 200)
        self.assertIn("data-foundations-matrix", page.text)
        self.assertEqual(manifest.status_code, 200)
        foundations = manifest.json()["surfaces"]["target"]["foundations"]
        self.assertEqual(foundations["reviewStatus"], "confirmed")
        self.assertEqual(foundations["densities"], ["medium", "small", "large"])

    def test_actions_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {route: client.get(route) for route in ACTIONS_ROUTES}
            page = client.get("/static/ui-component-library.html")
            manifest = client.get(
                "/static/design-system/infinite-canvas-ui/surface-manifest.json"
            )

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )
        self.assertIn("data-actions-matrix", page.text)
        actions = manifest.json()["surfaces"]["target"]["actions"]
        self.assertEqual(actions["contractReviewStatus"], "confirmed")
        self.assertEqual(actions["implementationStatus"], "implemented")
        self.assertEqual(actions["liveReviewStatus"], "confirmed")
        self.assertEqual(actions["migrationEligible"], True)

    def test_text_entry_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {route: client.get(route) for route in TEXT_ENTRY_ROUTES}

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )

    def test_selection_adjustment_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {
                route: client.get(route) for route in SELECTION_ADJUSTMENT_ROUTES
            }
            page = client.get("/static/ui-component-library.html")
            manifest = client.get(
                "/static/design-system/infinite-canvas-ui/surface-manifest.json"
            )

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )
        self.assertIn("data-selection-adjustment-matrix", page.text)
        selection = manifest.json()["surfaces"]["target"][
            "selectionAdjustment"
        ]
        self.assertEqual(selection["contractReviewStatus"], "confirmed")
        self.assertEqual(selection["implementationStatus"], "implemented")
        self.assertEqual(selection["liveReviewStatus"], "confirmed")
        self.assertEqual(selection["migrationEligible"], True)

    def test_dialog_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {route: client.get(route) for route in DIALOG_ROUTES}

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )

    def test_navigation_command_assets_are_available_from_the_formal_static_origin(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

        with TestClient(app) as client:
            responses = {
                route: client.get(route) for route in NAVIGATION_COMMAND_ROUTES
            }

        self.assertTrue(
            all(response.status_code == 200 for response in responses.values()),
            {route: response.status_code for route, response in responses.items()},
        )


class UiComponentLibraryRoleGateTests(unittest.TestCase):
    def test_only_admin_can_open_catalog_by_direct_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            auth.create_user(
                username="admin", password="admin-password", role="admin"
            )
            auth.create_user(
                username="designer", password="designer-password", role="designer"
            )
            app = FastAPI()
            install_auth_routes(app, auth)

            @app.get("/static/ui-component-library.html")
            async def ui_component_library():
                return HTMLResponse("UI component library")

            @app.get("/ui-component-library")
            async def standalone_ui_component_library():
                return HTMLResponse("Standalone UI component library")

            install_access_control(app, auth)

            with TestClient(app, follow_redirects=False) as client:
                client.post(
                    "/api/auth/login",
                    json={"username": "designer", "password": "designer-password"},
                )
                designer_response = client.get(
                    "/static/ui-component-library.html"
                )
                self.assertEqual(designer_response.status_code, 303)
                self.assertEqual(designer_response.headers["location"], "/")
                standalone_designer_response = client.get("/ui-component-library")
                self.assertEqual(standalone_designer_response.status_code, 303)
                self.assertEqual(
                    standalone_designer_response.headers["location"], "/"
                )

                client.post("/api/auth/logout")
                client.post(
                    "/api/auth/login",
                    json={"username": "admin", "password": "admin-password"},
                )
                admin_response = client.get("/static/ui-component-library.html")
                self.assertEqual(admin_response.status_code, 200)
                standalone_admin_response = client.get("/ui-component-library")
                self.assertEqual(standalone_admin_response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
