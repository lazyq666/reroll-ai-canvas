import unittest
from types import SimpleNamespace

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

from main import _safe_canvas_run_diagnostics


class GenerationRunDiagnosticsTests(unittest.TestCase):
    def test_public_diagnostics_are_whitelisted_and_redacted(self):
        run = SimpleNamespace(
            id="run-local",
            request_hash="fingerprint",
            recoverable=True,
            provider_id="apimart",
            error=(
                "The provider account is temporarily restricted. "
                "token=top-secret /Users/demo/output.png https://example.com/raw"
            ),
            status_code=401,
            remote_refs=("remote-task-1", "https://example.com/task/2"),
            result={"cost": 0, "raw_response": {"api_key": "never-copy"}},
            request_data={
                "prompt": "a safe prompt",
                "settings": {
                    "provider_id": "apimart",
                    "model": "demo-model",
                    "size": "1024x1024",
                    "api_key": "secret-key",
                },
                "references": [
                    {
                        "name": "/Users/demo/reference.png",
                        "url": "https://example.com/reference.png",
                        "kind": "image",
                        "width": 640,
                        "height": 480,
                    }
                ],
            },
            child_attempts=(
                {
                    "index": 0,
                    "status": "failed",
                    "remote_ref": "remote-task-1",
                    "error": "The provider account is temporarily restricted.",
                    "raw": {"code": "account_restricted", "cost": 0},
                },
            ),
        )

        diagnostics = _safe_canvas_run_diagnostics(run)
        serialized = repr(diagnostics)

        self.assertEqual(diagnostics["generation_run_id"], "run-local")
        self.assertEqual(diagnostics["parameters"]["model"], "demo-model")
        self.assertEqual(diagnostics["billing_evidence"], {"cost": 0})
        self.assertEqual(diagnostics["references"][0]["name"], "reference.png")
        self.assertEqual(diagnostics["upstream_task_ids"], ["remote-task-1"])
        self.assertNotIn("secret-key", serialized)
        self.assertNotIn("never-copy", serialized)
        self.assertNotIn("top-secret", serialized)
        self.assertNotIn("/Users/demo", serialized)
        self.assertNotIn("https://example.com", serialized)


if __name__ == "__main__":
    unittest.main()
