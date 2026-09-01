import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ProjectLayoutTests(unittest.TestCase):
    def test_python_runtime_is_contained_by_backend(self):
        self.assertEqual([], list(ROOT.glob("*.py")))
        self.assertTrue((ROOT / "backend" / "launcher.py").is_file())
        self.assertTrue((ROOT / "backend" / "main.py").is_file())
        self.assertTrue(
            (ROOT / "backend" / "infinite_canvas" / "__init__.py").is_file()
        )

    def test_optional_browser_and_photoshop_plugins_are_removed(self):
        self.assertFalse((ROOT / "tools").exists())
        self.assertTrue(
            (
                ROOT
                / "backend"
                / "scripts"
                / "admin"
                / "manage_users.py"
            ).is_file()
        )

    def test_workflows_separate_resources_from_workspace_data(self):
        self.assertFalse((ROOT / "workflows").exists())
        self.assertTrue(
            (ROOT / "resources" / "workflows" / "Z-Image.json").is_file()
        )

    def test_assets_and_output_have_no_legacy_mapping_api(self):
        server = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        self.assertNotIn('app.mount("/output"', server)
        self.assertNotIn('"/api/storage-settings"', server)
        self.assertNotIn("STORAGE_SETTINGS_FILE", server)
        self.assertNotIn("_retarget_storage_dirs_for_assets", server)

    def test_docs_are_classified_and_indexed(self):
        self.assertTrue((ROOT / "docs" / "README.md").is_file())
        self.assertTrue(
            (ROOT / "docs" / "PROJECT-MAP.md").is_file()
        )
        self.assertFalse((ROOT / "docs" / "roadmap.md").exists())
        self.assertTrue(
            (
                ROOT
                / "docs"
                / "current"
                / "storage-layout-and-migration.md"
            ).is_file()
        )
        self.assertTrue((ROOT / "docs" / "active").is_dir())
        self.assertTrue((ROOT / "docs" / "current").is_dir())
        self.assertFalse((ROOT / "docs" / "reference").exists())
        self.assertFalse((ROOT / "docs" / "specifications").exists())
        self.assertFalse((ROOT / "docs" / "design-system").exists())
        self.assertTrue((ROOT / "docs" / "FEATURE-SPEC-TEMPLATE.md").is_file())
        self.assertTrue((ROOT / "docs" / "archive").is_dir())
        self.assertFalse(
            (ROOT / "docs" / "V1-realtime-smart-canvas-requirements-brief.md").exists()
        )

    def test_ui_component_workbench_is_a_direct_non_product_route(self):
        server = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        shell = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

        self.assertTrue((ROOT / "static" / "ui-component-library.html").is_file())
        self.assertTrue((ROOT / "static" / "js" / "ui-component-library").is_dir())
        self.assertIn('@app.get("/ui-component-library")', server)
        self.assertNotIn("ui-component-library-entry", shell)

    def test_workspace_data_boundary_is_documented(self):
        context = (ROOT / "CONTEXT.md").read_text(encoding="utf-8")
        adr = (
            ROOT
            / "docs"
            / "adr"
            / "0001-workspace-data-boundary.md"
        )

        self.assertTrue(adr.is_file())
        for term in (
            "**Workspace（工作区）**",
            "**Project（项目）**",
            "**Account（账号）**",
            "**Instance State（实例状态）**",
            "**Device State（设备状态）**",
            "**Volcengine Asset Library（火山引擎素材库）**",
            "**Realtime Collaborator（实时协作者）**",
            "**Realtime Client Connection（实时客户端连接）**",
            "**Realtime Connection Limit（实时连接上限）**",
        ):
            with self.subTest(term=term):
                self.assertIn(term, context)
        self.assertNotIn("**Asset Library**:", context)
        decision = adr.read_text(encoding="utf-8")
        self.assertIn("Workspace Data", decision)
        self.assertIn("Instance State", decision)
        self.assertIn("Device State", decision)
        self.assertIn("Device Cache", decision)


if __name__ == "__main__":
    unittest.main()
