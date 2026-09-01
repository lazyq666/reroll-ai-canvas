import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static" / "js" / "smart-canvas.js"
PERSISTENCE = ROOT / "static" / "js" / "smart-canvas" / "canvas-persistence.js"


class Issue142SmartCanvasGenerationHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = HOST.read_text()
        cls.persistence = PERSISTENCE.read_text()

    def test_persisted_failed_log_is_normalized_for_existing_log_renderer(self):
        start = self.host.index("let smartCanvasLogsHydrated = false;")
        end = self.host.index("\nfunction addSmartGenerationLog", start)
        helpers = self.host[start:end]
        script = f"""
let canvasId = 'canvas-142';
let canvas = {{logs:[]}};
let requests = [];
const fetch = async url => {{
    requests.push(url);
    return {{
        ok:true,
        status:200,
        json:async () => ({{logs:[{{
            id:'failed-log',
            runId:'failed-run',
            status:'failed',
            createdAt:850,
            durationMs:1200,
            errorSummary:'provider rejected the request',
            prompt:'keep this prompt',
            outputs:[],
        }}]}}),
    }};
}};
{helpers}
(async () => {{
    await loadSmartCanvasLogs();
    process.stdout.write(JSON.stringify({{requests, log:canvas.logs[0]}}));
}})();
"""
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["requests"],
            ["/api/canvases/canvas-142/logs?limit=50"],
        )
        self.assertEqual(payload["log"]["generationRunId"], "failed-run")
        self.assertEqual(payload["log"]["runMs"], 1200)
        self.assertEqual(
            payload["log"]["error"],
            "provider rejected the request",
        )

    def test_frontend_generation_history_has_one_http_path_without_storage_mode_branch(self):
        start = self.host.index("let smartCanvasLogsHydrated = false;")
        end = self.host.index("\nfunction addSmartGenerationLog", start)
        helpers = self.host[start:end]

        self.assertNotIn("canvasStorageAuthority", helpers)
        self.assertIn("/api/canvases/${encodeURIComponent(canvasId)}/logs", helpers)

    def test_canvas_load_does_not_fetch_history_until_log_modal_opens(self):
        self.assertNotIn("loadSmartCanvasLogs", self.persistence)
        modal_start = self.host.index("async function openSmartCanvasLog")
        modal_end = self.host.index("\nfunction closeSmartCanvasLog", modal_start)
        modal = self.host[modal_start:modal_end]
        self.assertIn("await loadSmartCanvasLogs();", modal)
        self.assertLess(
            modal.index("await loadSmartCanvasLogs();"),
            modal.index("await smartLogModal.show();"),
        )


if __name__ == "__main__":
    unittest.main()
