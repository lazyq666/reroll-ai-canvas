import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import Bridge, BridgeError


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "allowed"
        self.root.mkdir()
        self.calls = []

        def handle(request):
            self.calls.append(request)
            if request.url.path.endswith("/context/target"):
                return httpx.Response(200, json={"canvas": {"id": "a", "name": "A"}})
            if request.url.path.endswith("/canvases"):
                return httpx.Response(
                    200,
                    json={
                        "canvases": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]
                    },
                )
            if request.url.path.endswith("/media"):
                return httpx.Response(200, json={"media_id": "digest"})
            return httpx.Response(200, json={"status": "success"})

        self.bridge = Bridge(
            "http://test",
            "secret",
            [self.root],
            Path(self.tmp.name) / "downloads",
            httpx.Client(
                base_url="http://test/", transport=httpx.MockTransport(handle)
            ),
        )

    def test_confined_search_and_paths(self):
        (self.root / "hero.png").write_bytes(b"png")
        (self.root / ".hidden.png").write_bytes(b"png")
        outside = Path(self.tmp.name) / "secret.png"
        outside.write_bytes(b"no")
        (self.root / "escape.png").symlink_to(outside)
        (self.root / "cycle").symlink_to(self.root, target_is_directory=True)
        result = self.bridge.find(kind="image", query="hero")["files"]
        self.assertEqual(["hero.png"], [x["name"] for x in result])
        for path in [
            outside,
            self.root / "escape.png",
            self.root / ".." / "secret.png",
        ]:
            with self.assertRaises(BridgeError):
                self.bridge.local_path(str(path))

    def test_lock_dry_run_no_upload_and_no_local_path(self):
        file = self.root / "hero.png"
        file.write_bytes(b"image")
        self.assertEqual("a", self.bridge.canvas())
        self.assertEqual("a", self.bridge.canvas())
        self.assertEqual(1, len(self.calls))
        self.bridge.submit(
            [{"prompt": "@hero", "refs": {"hero": {"file": str(file)}}}], dry_run=True
        )
        self.assertEqual(2, len(self.calls))
        body = json.loads(self.calls[-1].content)
        self.assertNotIn(str(self.root), json.dumps(body))
        self.assertEqual("hero.png", body["tasks"][0]["refs"]["hero"]["file"]["name"])
        self.bridge.submit([{"prompt": "@hero", "refs": {"hero": {"file": str(file)}}}])
        self.assertEqual(
            "digest",
            json.loads(self.calls[-1].content)["tasks"][0]["refs"]["hero"]["media"],
        )

    def test_transport_retry_reuses_key(self):
        keys = []

        def handle(request):
            keys.append(request.headers["Idempotency-Key"])
            if len(keys) == 1:
                raise httpx.ReadError("temporary")
            return httpx.Response(200, json={"ok": True})

        self.bridge.client = httpx.Client(
            base_url="http://test", transport=httpx.MockTransport(handle)
        )
        self.bridge.request("POST", "canvases", body={"title": "Test"})
        self.assertEqual(keys[0], keys[1])

    def test_download_does_not_escape_or_overwrite(self):
        self.bridge.client = httpx.Client(
            base_url="http://test",
            transport=httpx.MockTransport(
                lambda r: httpx.Response(200, content=b"output")
            ),
        )
        tasks = [
            {
                "outputs": [
                    {
                        "download_url": "/api/agent/v1/media/id/content",
                        "name": "../../hero.png",
                    }
                ]
            }
        ]
        one = self.bridge.download(tasks)["files"][0]
        two = self.bridge.download(tasks)["files"][0]
        self.assertNotEqual(one, two)
        self.assertEqual(Path(one).parent, self.bridge.download_directory)
        with self.assertRaises(BridgeError):
            self.bridge.download(
                [{"outputs": [{"download_url": "https://other/secret"}]}]
            )


if __name__ == "__main__":
    unittest.main()
