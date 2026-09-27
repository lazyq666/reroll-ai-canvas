"""Retired tools cannot be opened or submitted through their former surfaces."""
import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.frontend_assets import FrontendStaticFiles

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ("zimage", "enhance", "klein", "angle")


class LocalToolsRetirementTests(unittest.TestCase):
    def test_old_page_urls_redirect_without_serving_retired_code(self):
        app = FastAPI()
        app.mount("/static", FrontendStaticFiles(directory=ROOT / "static"))
        client = TestClient(app)
        for tool in TOOLS:
            with self.subTest(tool=tool):
                response = client.get(f"/static/{tool}.html?v=old", follow_redirects=False)
                self.assertEqual(307, response.status_code)
                self.assertEqual("/", response.headers["location"])
                self.assertEqual("no-cache", response.headers["cache-control"])
                for resource in (f"{tool}.html", f"js/{tool}.js", f"css/{tool}.css"):
                    self.assertFalse((ROOT / "static" / resource).exists())

    def test_navigation_only_advertises_canvas_and_online(self):
        page = (ROOT / "static/index.html").read_text()
        self.assertEqual(["canvas", "online"], re.findall(r'<ic-nav-item data-page="([^"]+)"', page))
        self.assertNotIn("local-nav-disclosure", page)
        for tool in TOOLS:
            self.assertNotIn(f'frame-{tool}', page)

    def test_removed_http_routes_are_absent_but_shared_generation_remains(self):
        routes = {getattr(route, "path", "") for route in main.app.routes}
        self.assertTrue({"/api/generate", "/api/queue_status", "/api/angle/poll_status"}.isdisjoint(routes))
        self.assertTrue({"/generate", "/api/ms/generate", "/api/angle/generate", "/api/canvas-comfy-tasks"} <= routes)

    def test_defaults_no_longer_install_klein(self):
        self.assertFalse(any("klein" in model.lower() for model in main.MODELSCOPE_DEFAULT_IMAGE_MODELS))
        self.assertFalse(any("klein" in item["id"].lower() for item in main.MODELSCOPE_DEFAULT_LORAS))
        self.assertTrue(main.MsGenerateRequest.model_fields["model"].is_required())


class RetiredWorkflowSubmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_builtin_workflows_fail_before_starting_a_run(self):
        for name in ("Z-Image-Enhance.json", "Flux2-Klein.json", "klein-enhance.json"):
            with self.subTest(name=name), patch.object(main._GENERATION_RUNS, "start", new_callable=AsyncMock) as start:
                with self.assertRaises(HTTPException) as raised:
                    await main.create_canvas_comfy_task(main.GenerateRequest(workflow_json=name))
                self.assertEqual(404, raised.exception.status_code)
                start.assert_not_called()
