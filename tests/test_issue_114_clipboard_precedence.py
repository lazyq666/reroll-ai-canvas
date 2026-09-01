import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Issue114ClipboardPrecedenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = (ROOT / "static" / "js" / "smart-canvas.js").read_text(
            encoding="utf-8"
        )
        cls.module = (
            ROOT / "static" / "js" / "smart-canvas" / "clipboard-ownership.js"
        ).read_text(encoding="utf-8")
        cls.page = (ROOT / "static" / "smart-canvas.html").read_text(
            encoding="utf-8"
        )

    def test_page_loads_clipboard_ownership_before_the_smart_canvas_host(self):
        module_index = self.page.index(
            "/static/js/smart-canvas/clipboard-ownership.js"
        )
        host_index = self.page.index("/static/js/smart-canvas.js")
        self.assertLess(module_index, host_index)

    def test_host_requires_a_matching_marker_and_has_no_delayed_node_fallback(self):
        self.assertIn("copyId:clipboard.copyId", self.host)
        self.assertIn("smartClipboardOwnership.writeMarker", self.host)
        self.assertIn(
            "smartClipboardOwnership.matches(marker, clipboard)", self.host
        )
        self.assertIn("function invalidateNodeClipboard", self.host)
        self.assertNotIn("lastImagePasteAt", self.host)
        self.assertNotIn("lastNodePasteAt", self.host)
        self.assertNotIn("}, 90);\n    }\n    if(e.key === 'Escape'", self.host)

    def test_marker_contract_matches_only_the_current_version_and_copy_id(self):
        script = f"""
            const vm = require('node:vm');
            const source = {json.dumps(self.module)};
            const window = {{
                crypto:{{randomUUID:() => 'copy-114'}},
                SmartCanvasModules:{{}}
            }};
            vm.runInNewContext(source, {{window,Uint8Array,Date,Math,JSON,String,Number,Boolean,Object}});
            const ownership = window.SmartCanvasModules.clipboardOwnership;
            const values = new Map();
            const transfer = {{
                setData(type,value){{ values.set(type,value); }},
                getData(type){{ return values.get(type) || ''; }}
            }};
            const copyId = ownership.newCopyId();
            const written = ownership.writeMarker(transfer,copyId);
            const marker = ownership.readMarker(transfer);
            process.stdout.write(JSON.stringify({{
                written,
                copyId,
                matches:ownership.matches(marker,{{version:ownership.VERSION,copyId}}),
                mismatches:ownership.matches(marker,{{version:ownership.VERSION,copyId:'old-copy'}}),
                markerKeys:Object.keys(marker).sort()
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "written": True,
                "copyId": "copy-114",
                "matches": True,
                "mismatches": False,
                "markerKeys": ["copyId", "version"],
            },
        )


if __name__ == "__main__":
    unittest.main()
