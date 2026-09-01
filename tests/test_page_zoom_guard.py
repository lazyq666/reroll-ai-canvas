import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "static/js/page-zoom-guard.js"
STATIC = ROOT / "static"


class PageZoomGuardTests(unittest.TestCase):
    def test_every_static_page_loads_the_zoom_guard(self):
        pages = sorted(STATIC.glob("*.html"))
        self.assertTrue(pages)
        for page in pages:
            with self.subTest(page=page.name):
                source = page.read_text(encoding="utf-8")
                self.assertIn('/static/js/page-zoom-guard.js', source)

    def test_guard_blocks_page_zoom_without_swallowing_canvas_events(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(GUARD))}, 'utf8');
            const listeners = {{window: {{}}, document: {{}}}};
            const registrations = [];
            const viewport = {{
                content: 'width=device-width, initial-scale=1.0, maximum-scale=5',
                getAttribute(name) {{ return name === 'content' ? this.content : null; }},
                setAttribute(name, value) {{ if(name === 'content') this.content = value; }},
            }};
            const window = {{
                addEventListener(type, handler, options) {{
                    listeners.window[type] = handler;
                    registrations.push({{surface:'window', type, options}});
                }},
            }};
            const document = {{
                querySelector(selector) {{ return selector === 'meta[name="viewport"]' ? viewport : null; }},
                addEventListener(type, handler, options) {{
                    listeners.document[type] = handler;
                    registrations.push({{surface:'document', type, options}});
                }},
            }};
            const sandbox = {{window, document, Set}};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            vm.runInContext(source, sandbox);

            function fire(surface, type, init={{}}) {{
                const event = {{
                    ctrlKey:false, metaKey:false, altKey:false, key:'', code:'',
                    prevented:false, stopped:false,
                    preventDefault() {{ this.prevented = true; }},
                    stopPropagation() {{ this.stopped = true; }},
                    ...init,
                }};
                listeners[surface][type](event);
                return {{prevented:event.prevented, stopped:event.stopped}};
            }}

            const payload = {{
                ctrlWheel:fire('window', 'wheel', {{ctrlKey:true}}),
                metaWheel:fire('window', 'wheel', {{metaKey:true}}),
                plainWheel:fire('window', 'wheel'),
                plus:fire('document', 'keydown', {{metaKey:true, key:'='}}),
                minus:fire('document', 'keydown', {{ctrlKey:true, key:'-'}}),
                reset:fire('document', 'keydown', {{metaKey:true, key:'0'}}),
                gesture:fire('document', 'gesturechange'),
                viewport:viewport.content,
                registrations:registrations.map(item => ({{
                    surface:item.surface,
                    type:item.type,
                    capture:item.options?.capture,
                    passive:item.options?.passive,
                }})),
            }};
            process.stdout.write(JSON.stringify(payload));
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)

        self.assertEqual(payload["ctrlWheel"], {"prevented": True, "stopped": False})
        self.assertEqual(payload["metaWheel"], {"prevented": True, "stopped": False})
        self.assertEqual(payload["plainWheel"], {"prevented": False, "stopped": False})
        self.assertTrue(payload["plus"]["prevented"])
        self.assertTrue(payload["minus"]["prevented"])
        self.assertFalse(payload["reset"]["prevented"])
        self.assertTrue(payload["gesture"]["prevented"])
        self.assertIn("minimum-scale=1.0", payload["viewport"])
        self.assertIn("maximum-scale=1.0", payload["viewport"])
        self.assertIn("user-scalable=no", payload["viewport"])
        self.assertNotIn("maximum-scale=5", payload["viewport"])
        self.assertEqual(len(payload["registrations"]), 5)
        for registration in payload["registrations"]:
            self.assertTrue(registration["capture"])
            self.assertFalse(registration["passive"])


if __name__ == "__main__":
    unittest.main()
