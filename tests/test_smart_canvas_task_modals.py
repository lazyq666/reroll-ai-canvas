import asyncio
import io
import json
import re
import unittest
import zipfile
from pathlib import Path

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

from main import (
    MAX_WORKFLOW_ARCHIVE_BYTES,
    canvas_workflow_limits,
    inspect_canvas_workflow_bytes,
)


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasTaskModalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas-task-modals.css").read_text(encoding="utf-8")
        cls.controller = (ROOT / "static/js/smart-canvas/task-modals.js").read_text(encoding="utf-8")
        cls.canvas_app = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.backend = (ROOT / "backend/main.py").read_text(encoding="utf-8")
        cls.env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
        cls.dialog = (ROOT / "static/js/infinite-canvas-ui/dialog/dialog.js").read_text(encoding="utf-8")
        cls.dialog_style = (ROOT / "static/js/infinite-canvas-ui/dialog/styles.js").read_text(encoding="utf-8")
        cls.dialog_case = (ROOT / "static/design-system/infinite-canvas-ui/dialog-case.html").read_text(encoding="utf-8")

    def test_component_library_registers_compact_modal_contract_before_product_use(self):
        self.assertIn('variant="compact"', self.dialog_case)
        self.assertIn('data-legal-combination="small-compact-light-inspection"', self.dialog_case)
        self.assertIn('data-legal-combination="small-compact-explicit-task"', self.dialog_case)
        self.assertIn('data-action-combination="medium-explicit-task"', self.dialog_case)
        self.assertIn('data-legal-combination="h2-with-subtitle"', self.dialog_case)
        self.assertIn("this.variant = 'standard'", self.dialog)
        self.assertIn("compact Dialogs require size=small", self.dialog)
        self.assertIn('var(--ic-dialog-compact-inline-size, 32rem)', self.dialog_style)
        compact = self.dialog_case.split('id="compact-shortcuts"', 1)[1].split('</ic-dialog>', 1)[0]
        self.assertIn('data-component-name="ic-form-field-search" data-component-name-tag="hidden"', compact)
        self.assertIn('padding-block-end:var(--ui-space-2)', self.dialog_case)

    def test_shortcut_dialog_is_new_scoped_structure_with_required_search_composition(self):
        self.assertNotIn('id="smartShortcutModal"', self.page)
        shortcut = self.page.split('id="smartShortcutDialog"', 1)[1].split('</ic-dialog>', 1)[0]
        self.assertIn('size="small" variant="compact" dismiss-policy="light"', shortcut)
        self.assertIn('data-component-name="ic-form-field-search"', shortcut)
        self.assertIn('type="search"', shortcut)
        self.assertIn('<ic-icon slot="start" name="search"', shortcut)
        self.assertIn('slot="end" background="ghost" hierarchy="quiet"', shortcut)
        self.assertEqual(shortcut.count('data-shortcut-group>'), 4)
        self.assertEqual(shortcut.count('data-shortcut-row>'), 21)
        self.assertIn('data-i18n="smart.shortcutZoomIn"', shortcut)
        self.assertIn('data-i18n="smart.shortcutZoomOut"', shortcut)
        self.assertIn('没有匹配的快捷键', shortcut)
        self.assertNotIn('.shortcut-modal', self.style)

    def test_import_dialog_uses_native_dialog_heading_and_three_step_actions(self):
        modal = self.page.split('id="smartNodePackageImportDialog"', 1)[1].split('</ic-dialog>', 1)[0]
        self.assertIn('size="small" variant="compact"', modal)
        self.assertIn('data-action-combination="medium-explicit-task"', modal)
        self.assertRegex(modal, r'<span slot="label"[^>]+data-legal-combination="h2-with-subtitle"')
        self.assertNotIn('<h2', modal)
        self.assertLess(modal.index('id="smartNodePackageCancel"'), modal.index('id="smartNodePackagePrimary"'))
        self.assertEqual(modal.count('data-node-package-step='), 3)
        for state in ("choose", "review", "done"):
            self.assertIn(f'data-node-package-step="{state}"', modal)
        self.assertNotIn("MAX_NODE_PACKAGE_BYTES = 100 * 1024 * 1024", self.controller)
        self.assertIn("loadNodePackageLimits", self.canvas_app)
        self.assertIn("/api/canvas-workflows/limits", self.canvas_app)
        self.assertIn("event.key !== 'Enter' && event.key !== ' '", self.controller)
        self.assertNotIn('id="smartNodePackageSample"', modal)
        self.assertNotIn("sampleNodePackageFile", self.controller)
        self.assertNotIn("sampleNodePackageWarning", self.controller)
        self.assertIn("/api/canvas-workflows/inspect", self.canvas_app)
        self.assertIn("/api/canvas-workflows/import", self.canvas_app)

    def test_shortcuts_live_in_settings_and_batch_import_lives_in_canvas_context_menu(self):
        dock = self.page.split('id="smartCanvasDock"', 1)[1].split('</ic-smart-canvas-dock>', 1)[0]
        panel = dock.split('id="smartSettingsPanel"', 1)[1]
        self.assertIn('id="smartShortcutSettingsAction"', panel)
        self.assertNotIn('id="smartNodeImportSettingsAction"', panel)
        create_menu = self.page.split('id="createMenu"', 1)[1].split('id="fileInput"', 1)[0]
        self.assertLess(create_menu.index('value="paste"'), create_menu.index('value="batch-import"'))
        self.assertIn('label="批量导入节点" data-i18n-label="smart.batchImportNodes"', create_menu)
        self.assertIn("if(type === 'batch-import')", self.canvas_app)
        self.assertIn('importLauncher:null', self.canvas_app)
        self.assertNotIn('id="smartShortcutToggle"', self.page)
        self.assertNotIn('id="smartNodeTransferToggle"', self.page)
        self.assertNotIn('id="smartNodeTransferPanel"', self.page)
        self.assertIn("smartContextMenuItem('export-resource-package'", self.canvas_app)
        self.assertIn("if(action === 'export-resource-package')", self.canvas_app)
        self.assertIn('exportSelectedSmartNodesAsResourcePackage()', self.canvas_app)
        menu_sections = self.canvas_app.split('function smartContextMenuSections(state){', 1)[1]
        multi_select = menu_sections.split('const node = nodes.find', 1)[0]
        self.assertIn("transfer.push(smartContextMenuItem('publish-workspace-assets'", multi_select)
        self.assertNotIn("content.push(smartContextMenuItem('publish-workspace-assets'", multi_select)
        self.assertIn('function smartCanvasTaskDialogOpen()', self.canvas_app)
        self.assertGreaterEqual(self.canvas_app.count('if(smartCanvasTaskDialogOpen()) return;'), 2)

    def test_node_package_limit_comes_from_backend_configuration(self):
        limits = asyncio.run(canvas_workflow_limits())
        self.assertEqual(limits["max_archive_bytes"], MAX_WORKFLOW_ARCHIVE_BYTES)
        self.assertIn(
            'os.getenv("INFINITE_CANVAS_MAX_WORKFLOW_ARCHIVE_BYTES", str(MAX_UPLOAD_BYTES))',
            self.backend,
        )
        self.assertIn("INFINITE_CANVAS_MAX_WORKFLOW_ARCHIVE_BYTES=524288000", self.env_example)

    def test_inspection_reads_json_without_importing(self):
        payload = {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "connections": [{"from": "a", "to": "b"}],
            "resources": [{"name": "one.png", "size": 256}],
        }
        summary = inspect_canvas_workflow_bytes(json.dumps(payload).encode(), "package.json")
        self.assertEqual(summary["node_count"], 2)
        self.assertEqual(summary["connection_count"], 1)
        self.assertEqual(summary["resource_count"], 1)
        self.assertEqual(summary["resource_bytes"], 256)
        self.assertEqual(summary["package_type"], "json")

    def test_inspection_reads_zip_summary_and_rejects_missing_nodes(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("resources/one.png", b"image-bytes")
            archive.writestr("workflow.json", json.dumps({
                "nodes": [{"id": "a"}],
                "connections": [],
                "resources": [{"archive": "resources/one.png", "size": 999}],
            }))
        summary = inspect_canvas_workflow_bytes(buffer.getvalue(), "package.zip")
        self.assertEqual(summary["node_count"], 1)
        self.assertEqual(summary["resource_bytes"], len(b"image-bytes"))
        self.assertEqual(summary["package_type"], "zip")
        with self.assertRaises(HTTPException) as raised:
            inspect_canvas_workflow_bytes(json.dumps({"connections": []}).encode(), "bad.json")
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
