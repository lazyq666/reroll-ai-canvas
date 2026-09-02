import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ModelVendorIconSurfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vendor_script = (ROOT / "static/js/model-vendor-icons.js").read_text(encoding="utf-8")
        cls.management_script = (ROOT / "static/js/available-model-management.js").read_text(encoding="utf-8")
        cls.online_page = (ROOT / "static/online.html").read_text(encoding="utf-8")
        cls.batch_script = (ROOT / "static/js/batch-generation.js").read_text(encoding="utf-8")
        cls.api_page = (ROOT / "static/api-settings.html").read_text(encoding="utf-8")
        cls.api_script = (ROOT / "static/js/api-settings.js").read_text(encoding="utf-8")
        cls.canvas_page = (ROOT / "static/canvas.html").read_text(encoding="utf-8")
        cls.canvas_script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")

    def test_shared_helper_can_render_vendor_or_generic_icon(self):
        self.assertIn("const markup = (model = '', providerId = '', providerName = '', requestedStyle = 'auto')", self.vendor_script)
        self.assertIn("model-vendor-icon--fallback", self.vendor_script)
        self.assertIn("genericOutlineIcon", self.vendor_script)
        self.assertIn("genericFilledIcon", self.vendor_script)
        self.assertIn("const outlineIcon = (icon) =>", self.vendor_script)
        self.assertIn("window.ModelVendorIcons = Object.freeze({ icons, styles, normalizeStyle, resolve, markup })", self.vendor_script)
        self.assertIn("window.ModelVendorIcons?.markup(", self.management_script)
        self.assertIn("model.provider_name,\n      'auto',", self.management_script)
        self.assertNotIn("model.provider_name,\n      'outline',", self.management_script)
        self.assertNotIn("state.iconStyle", self.management_script)
        self.assertNotIn("iconStyleControl", self.management_script)
        self.assertNotIn("fallback.setAttribute('name', 'models')", self.management_script)

    def test_batch_generation_shows_model_icons(self):
        self.assertIn('/static/css/model-vendor-icons.css', self.online_page)
        self.assertIn('/static/js/model-vendor-icons.js', self.online_page)
        self.assertNotIn('id="modelSelectIcon"', self.online_page)
        self.assertIn("modelVendorIconMarkup(entry)", self.batch_script)
        self.assertIn("renderTaskModel(task)", self.batch_script)
        self.assertIn("renderSnapshotModel(model)", self.batch_script)

    def test_api_settings_model_lists_and_picker_show_icons(self):
        self.assertIn('/static/css/model-vendor-icons.css', self.api_page)
        self.assertIn('/static/js/model-vendor-icons.js', self.api_page)
        self.assertIn("modelVendorIconMarkup(model, item)", self.api_script)
        self.assertIn("model-picker-name", self.api_script)

    def test_classic_canvas_selected_models_show_icons(self):
        self.assertIn('/static/css/model-vendor-icons.css', self.canvas_page)
        self.assertIn('/static/js/model-vendor-icons.js', self.canvas_page)
        self.assertIn("canvasModelVendorIconMarkup('text'", self.canvas_script)
        self.assertIn("canvasModelVendorIconMarkup('image'", self.canvas_script)
        self.assertIn("canvasModelVendorIconMarkup('video'", self.canvas_script)
        self.assertIn("syncCanvasModelVendorIcon", self.canvas_script)


if __name__ == "__main__":
    unittest.main()
