import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import sys
import subprocess
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sync_frontend_assets import AssetGraph, MANIFEST, POLICY, tree_digest

ROOT = Path(__file__).resolve().parents[1]


class FrontendAssetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.write(POLICY, json.dumps({"pinned_trees": [], "excluded_files": {},
                                      "excluded_directories": {}, "embedded_sources": [], "version_markers": {}}))
        self.write("static/index.html", '<script type="module" src="/static/js/main.js?v=old&mode=review#one"></script><link href="/static/css/main.css">')
        self.write("static/js/main.js", "import './child.js?v=old';\nimport('/static/js/worker.js');")
        self.write("static/js/child.js", "export const value = 'old';")
        self.write("static/js/worker.js", "new Worker(new URL('./child.js', import.meta.url), {type:'module'});")
        self.write("static/css/main.css", '@import url("./child.css");')
        self.write("static/css/child.css", "body { color: red }")
        self.write("static/js/unrelated.js", "window.unchanged = true;")

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_graph(self, check=False):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = AssetGraph(self.root).run(check)
        return result, output.getvalue()

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob('*') if p.is_file()}

    def versions(self):
        return json.loads((self.root / MANIFEST).read_text())["assets"]

    def test_stale_reference_fails_read_only_then_sync_is_idempotent(self):
        before = self.snapshot()
        result, output = self.run_graph(True)
        self.assertEqual(result, 1)
        self.assertIn('static/index.html:1: static/js/main.js', output)
        self.assertIn('python3 scripts/sync_frontend_assets.py', output)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.run_graph()[0], 0)
        self.assertIn('&mode=review#one', (self.root / 'static/index.html').read_text())
        after = self.snapshot()
        self.assertEqual(self.run_graph(True)[0], 0)
        self.assertEqual(self.run_graph()[0], 0)
        self.assertEqual(after, self.snapshot())

    def test_child_change_propagates_to_page_import_worker_but_not_unrelated(self):
        self.run_graph()
        previous = self.versions()
        self.write('static/js/child.js', "export const value = 'new';")
        self.assertEqual(self.run_graph(True)[0], 1)
        self.assertEqual(self.run_graph()[0], 0)
        current = self.versions()
        for name in ['static/js/main.js', 'static/js/worker.js', 'static/js/child.js', 'static/index.html']:
            self.assertNotEqual(previous[name]['version'], current[name]['version'], name)
        for name in ['static/css/main.css', 'static/js/unrelated.js']:
            self.assertEqual(previous[name], current[name])

    def test_new_unreferenced_business_module_cannot_escape_inventory(self):
        self.run_graph()
        self.write('static/js/new-business.js', 'window.newBusiness = true;')
        result, output = self.run_graph(True)
        self.assertEqual(result, 1)
        self.assertIn('unmanaged/new resource static/js/new-business.js', output)
        self.assertEqual(self.run_graph()[0], 0)
        self.assertIn('static/js/new-business.js', self.versions())

    def test_missing_reference_fails_without_partial_writes(self):
        self.write('static/js/main.js', "import './missing.js';")
        before = self.snapshot()
        result, output = self.run_graph()
        self.assertEqual(result, 1)
        self.assertIn('static/js/main.js:1: missing asset static/js/missing.js', output)
        self.assertEqual(before, self.snapshot())

    def test_bare_css_html_urls_and_node_filesystem_fallback(self):
        self.write('static/index.html', '<script src="js/main.js"></script><link href="css/main.css">')
        self.write('static/css/main.css', '@import "child.css";')
        self.write('static/js/main.js', "if (typeof require === 'function') require('./child.js');")
        self.assertEqual(self.run_graph()[0], 0)
        self.assertIn('js/main.js?v=asset-', (self.root / 'static/index.html').read_text())
        self.assertIn('child.css?v=asset-', (self.root / 'static/css/main.css').read_text())
        self.assertIn("require('./child.js')", (self.root / 'static/js/main.js').read_text())
        self.assertEqual(self.run_graph(True)[0], 0)

    def test_computed_module_and_worker_paths_fail_closed(self):
        for source in ["import('/static/js/' + name + '.js');", "import(`./${name}.js`);", 'new Worker(workerPath);']:
            with self.subTest(source=source):
                self.write('static/js/main.js', source)
                result, output = self.run_graph(True)
                self.assertEqual(result, 1)
                self.assertIn('computed module/Worker URL', output)

    def test_computed_script_loader_cannot_bypass_versioning(self):
        self.write('static/js/main.js', "script.src = '/static/js/' + name + '.js';")
        result, output = self.run_graph(True)
        self.assertEqual(result, 1)
        self.assertIn('computed/incomplete local code URL', output)

    def test_new_server_rendered_page_is_discovered(self):
        self.run_graph()
        self.write('backend/new_page.py', 'page = \'<script src="/static/js/child.js"></script>\'')
        result, output = self.run_graph(True)
        self.assertEqual(result, 1)
        self.assertIn('backend/new_page.py:1: static/js/child.js', output)
        self.assertEqual(self.run_graph()[0], 0)
        self.assertIn('?v=asset-', (self.root / 'backend/new_page.py').read_text())

    def test_json_escaped_markup_and_queries_remain_valid(self):
        self.write('static/fixture.json', json.dumps({'markup':'<script src="/static/js/child.js?mode=review&v=old#one"></script>'}))
        self.assertEqual(self.run_graph()[0], 0)
        data = json.loads((self.root / 'static/fixture.json').read_text())
        self.assertIn('&mode=review#one', data['markup'])
        self.assertEqual(self.run_graph(True)[0], 0)

    def test_avatar_dynamic_image_group_invalidates_loader_and_page(self):
        self.write('static/images/avatars/a.png', 'old image bytes')
        self.write('static/images/avatars/manifest.json', '{"assets":["a.png"]}')
        self.write('static/js/account-avatar.js', "const ASSET_VERSION = 'old';\nconst manifest = '/static/images/avatars/manifest.json';")
        self.write('static/avatar.html', '<script src="/static/js/account-avatar.js"></script>')
        self.assertEqual(self.run_graph()[0], 0)
        previous = self.versions()
        marker = (self.root / 'static/images/avatars/VERSION').read_text()
        self.write('static/images/avatars/a.png', 'new image bytes')
        self.assertEqual(self.run_graph(True)[0], 1)
        self.assertEqual(self.run_graph()[0], 0)
        for name in ['static/js/account-avatar.js', 'static/avatar.html']:
            self.assertNotEqual(previous[name], self.versions()[name])
        self.assertNotEqual(marker, (self.root / 'static/images/avatars/VERSION').read_text())
        self.assertEqual(self.run_graph(True)[0], 0)

    def test_cycle_propagates_and_converges_independent_of_mtime(self):
        self.write('static/js/child.js', "import './main.js'; export const value = 1;")
        self.assertEqual(self.run_graph()[0], 0)
        before = self.snapshot()
        for path in self.root.rglob('*'):
            if path.is_file():
                os.utime(path, (123, 456))
        self.assertEqual(self.run_graph(True)[0], 0)
        self.assertEqual(self.run_graph()[0], 0)
        self.assertEqual(before, self.snapshot())
        previous = self.versions()
        with (self.root / 'static/js/child.js').open('a') as stream:
            stream.write('\nexport const changed = true;')
        self.assertEqual(self.run_graph()[0], 0)
        current = self.versions()
        self.assertNotEqual(previous['static/js/main.js'], current['static/js/main.js'])
        self.assertEqual(self.run_graph(True)[0], 0)

    def test_pinned_vendor_exclusion_has_a_checked_content_lock(self):
        self.write('static/vendor/v1/library.js', 'export const version = 1;')
        self.write('static/js/main.js', "import '/static/vendor/v1/library.js';")
        policy = json.loads((self.root / POLICY).read_text())
        policy['pinned_trees'] = [{'path': 'static/vendor/v1', 'reason': 'fixed release',
                                   'sha256': tree_digest(self.root, 'static/vendor/v1')}]
        self.write(POLICY, json.dumps(policy))
        self.assertEqual(self.run_graph()[0], 0)
        self.assertNotIn('static/vendor/v1/library.js', self.versions())
        self.write('static/vendor/v1/library.js', 'export const version = 2;')
        result, output = self.run_graph(True)
        self.assertEqual(result, 1)
        self.assertIn('pinned vendor tree changed', output)


class RepositoryFrontendAssetsTests(unittest.TestCase):
    def test_repository_graph_is_current(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = AssetGraph(ROOT).run(check=True)
        self.assertEqual(result, 0, output.getvalue())


@unittest.skipUnless(os.environ.get('IC_RUN_BROWSER_TESTS') == '1',
                     'set IC_RUN_BROWSER_TESTS=1 for the retained-cache browser contract')
class FrontendAssetBrowserTests(unittest.TestCase):
    def test_retained_cache_upgrade_generation_save_sync_and_reopen(self):
        result = subprocess.run(['node', 'tests/frontend_cache_upgrade_browser.cjs'], cwd=ROOT,
                                env={**os.environ, 'ASSET_TEST_PYTHON': sys.executable},
                                capture_output=True, text=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class FrontendHttpCacheTests(unittest.TestCase):
    def test_revision_tracks_manifest_content_and_handles_missing_inventory(self):
        from infinite_canvas.frontend_assets import frontend_revision
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / 'frontend-assets.json'
            self.assertEqual(frontend_revision(manifest), '')
            manifest.write_text('{"release":"old"}')
            old = frontend_revision(manifest)
            self.assertEqual(len(old), 64)
            os.utime(manifest, ns=(1, 1))
            self.assertEqual(frontend_revision(manifest), old, 'mtime is not revision authority')
            manifest.write_text('{"release":"new"}')
            self.assertNotEqual(frontend_revision(manifest), old, 'Same-size live updates invalidate cache')

    def test_html_revalidates_and_fingerprinted_resources_remain_cacheable(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from infinite_canvas.frontend_assets import FrontendStaticFiles
        app = FastAPI()
        app.mount('/static', FrontendStaticFiles(directory=ROOT / 'static'))
        with TestClient(app) as client:
            page = client.get('/static/smart-canvas.html')
            self.assertEqual(page.headers['cache-control'], 'no-cache')
            manifest = json.loads((ROOT / MANIFEST).read_text())
            version = manifest['assets']['static/js/i18n.js']['version']
            url = '/static/js/i18n.js?v=' + version
            script = client.get(url)
            self.assertIn('immutable', script.headers['cache-control'])
            cached = client.get(url, headers={'If-None-Match': script.headers['etag']})
            self.assertEqual(cached.status_code, 304)
            self.assertIn('immutable', cached.headers['cache-control'])
            self.assertEqual(client.get('/static/js/i18n.js').headers['cache-control'], 'no-cache')


if __name__ == '__main__':
    unittest.main()
