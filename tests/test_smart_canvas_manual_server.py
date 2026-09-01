import json
import os
import socket
import subprocess
import time
import unittest
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "tests/smart_canvas_manual_server.py"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class SmartCanvasManualServerTests(unittest.TestCase):
    def test_manual_environment_exposes_a_complete_mock_image_generation_lifecycle(self):
        port = free_port()
        environment = {**os.environ, "SMART_CANVAS_PORT": str(port)}
        server = subprocess.Popen(
            ["python3", str(SERVER)],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        base_url = f"http://127.0.0.1:{port}"
        try:
            for _attempt in range(50):
                try:
                    with urllib.request.urlopen(f"{base_url}/api/config", timeout=0.2) as response:
                        config = json.load(response)
                    break
                except Exception:
                    time.sleep(0.05)
            else:
                self.fail("manual server did not start")

            self.assertTrue(config["api_providers"])
            self.assertTrue(config["available_models"]["image"])
            with urllib.request.urlopen(
                f"{base_url}/static/smart-canvas.html?id=issue-148-complex&manual=1&fixture=issue-148-complex",
                timeout=1,
            ) as response:
                fixture_html = response.read().decode("utf-8")
            self.assertIn("generator-source", fixture_html)
            self.assertIn("mock-image-1", fixture_html)

            request = urllib.request.Request(
                f"{base_url}/api/canvas-image-tasks",
                data=json.dumps({"prompt": "复杂画布生成测试"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=1) as response:
                submission = json.load(response)
            self.assertTrue(submission["task_id"])

            with urllib.request.urlopen(
                f"{base_url}/api/canvas-image-tasks/{submission['task_id']}",
                timeout=1,
            ) as response:
                task = json.load(response)
            self.assertEqual(task["status"], "succeeded")
            self.assertTrue(task["result"]["images"][0]["url"].startswith("data:image/"))
        finally:
            server.terminate()
            try:
                server.wait(timeout=2)
            except subprocess.TimeoutExpired:
                server.kill()
            if server.stdout:
                server.stdout.close()
            if server.stderr:
                server.stderr.close()
