import asyncio
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.infinite_canvas.model_capability_refresh import (
    ApiMartSeedreamDocsSource,
    CapabilitySourceSnapshot,
    DreaminaCliCapabilitySource,
    JsonUrlCapabilitySource,
    ModelCapabilityRefreshManager,
    sources_from_environment,
)
from backend.infinite_canvas.model_capability_workbench import (
    ModelCapabilityWorkbench,
)


NOW = datetime(2026, 9, 4, 8, 0, tzinfo=timezone.utc)


class FakeCatalog:
    def __init__(self):
        self.revision = "catalog-before-refresh"
        self.refresh_calls = 0
        self.ok = True
        self.error = None

    def refresh(self):
        self.refresh_calls += 1
        if self.error is not None:
            raise self.error
        return {
            "ok": self.ok,
            "catalog_revision": self.revision,
            "error": None if self.ok else "invalid maintained catalog",
        }


def source_record(capability=None):
    return {
        "provider_id": "apimart",
        "model_id": "seedream-5-0-pro",
        "operation": "image.layer_decomposition",
        "capability": capability
        or {
            "support_state": "supported",
            "inputs": {"image": {"minimum": 1, "maximum": 1}},
            "output": {"kind": "image_layer_decomposition"},
            "parameters": {"count": {"type": "integer", "minimum": 1, "maximum": 1}},
        },
        "confidence": "high",
        "evidence": {
            "source_type": "official_docs",
            "source_locator": "https://docs.apimart.ai/model",
            "fetched_at": "2026-09-04T08:00:00+00:00",
            "applicable_version": "2026-09-04",
            "content_location": "Layer decomposition parameters",
            "excerpt": "One input image and one structured layer result.",
        },
    }


class FakeSource:
    name = "apimart-docs"

    def __init__(self, records=None, error=None, gate=None):
        self.records = tuple(records or ())
        self.error = error
        self.gate = gate
        self.calls = 0

    async def collect(self, cached=None):
        self.calls += 1
        if self.gate is not None:
            await self.gate.wait()
        if self.error is not None:
            raise self.error
        return CapabilitySourceSnapshot(self.name, self.records, etag='"revision-1"')


class JsonUrlCapabilitySourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_structured_source_uses_conditional_cache_headers(self):
        calls = []
        payload = json.dumps({"version": 1, "records": [source_record()]}).encode()

        async def fetcher(url, headers):
            calls.append((url, dict(headers)))
            if len(calls) == 1:
                return 200, {"ETag": '"revision-1"'}, payload
            return 304, {}, b""

        source = JsonUrlCapabilitySource(
            "apimart-docs", "https://docs.apimart.ai/capabilities.json", fetcher=fetcher
        )
        first = await source.collect()
        second = await source.collect(
            {"etag": first.etag, "records": list(first.records)}
        )

        self.assertEqual(1, len(first.records))
        self.assertTrue(second.not_modified)
        self.assertEqual('"revision-1"', calls[1][1]["If-None-Match"])

    async def test_structured_source_rejects_unbounded_or_invalid_payloads(self):
        async def fetcher(_url, _headers):
            return 200, {}, json.dumps({"version": 2, "records": []}).encode()

        source = JsonUrlCapabilitySource(
            "invalid", "https://example.com/capabilities.json", fetcher=fetcher
        )
        with self.assertRaisesRegex(ValueError, "unsupported capability source schema"):
            await source.collect()


APIMART_MARKDOWN = b'''\
<ParamField body="layer_decomposition" type="boolean" default="false">
Whether to decompose the image into layers. When enabled, the model returns one base image and up to 16 PNG layers with alpha channels.
Exactly one PNG or JPEG image is required. It must contain `[262144, 36000000]` total pixels and be no larger than 30 MB. `size` accepts only `1K`, `1.5K`, `2K`, or `auto`.
</ParamField>
<ParamField body="n" type="integer" default="1">
Number of images to generate. Only `1` is supported.
</ParamField>
## Layer-decomposition response and reconstruction
The arrays correspond by index; index `0` is always the base image.
{"layers":[{"z_index":1,"bounding_box":{"absolute":[0,0,1,1],"normalized":[0,0,1,1]}}]}
'''


class ApiMartSeedreamDocsSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_official_markdown_becomes_exact_layer_decomposition_candidate(self):
        calls = []

        async def fetcher(url, headers):
            calls.append((url, dict(headers)))
            return 200, {"Content-Type": "text/markdown; charset=utf-8"}, APIMART_MARKDOWN

        source = ApiMartSeedreamDocsSource(fetcher=fetcher, clock=lambda: NOW)
        snapshot = await source.collect()
        record = snapshot.records[0]
        capability = record["capability"]

        self.assertEqual("text/markdown", calls[0][1]["Accept"])
        self.assertEqual("apimart", record["provider_id"])
        self.assertEqual("seedream-5-0-pro", record["model_id"])
        self.assertEqual("image.layer_decomposition", record["operation"])
        self.assertEqual(1, capability["inputs"]["image"]["minimum"])
        self.assertEqual(1, capability["inputs"]["image"]["maximum"])
        self.assertEqual(
            ["auto", "1K", "1.5K", "2K"],
            capability["parameters"]["resolution_tier"]["values"],
        )
        self.assertEqual(1, capability["parameters"]["count"]["maximum"])
        self.assertEqual(
            16,
            capability["output"]["manifest"]["fields"]["layers"]["maximum"],
        )
        self.assertTrue(
            record["evidence"]["applicable_version"].startswith("semantic-sha256:")
        )

    async def test_changed_official_markdown_fails_closed(self):
        async def fetcher(_url, _headers):
            return 200, {"Content-Type": "text/markdown"}, b"# changed"

        source = ApiMartSeedreamDocsSource(fetcher=fetcher, clock=lambda: NOW)
        with self.assertRaisesRegex(ValueError, "documentation changed"):
            await source.collect()

    def test_official_source_is_enabled_by_default_and_can_be_disabled(self):
        with patch.dict(
            "os.environ",
            {
                "INFINITE_CANVAS_MODEL_CAPABILITY_APIMART_DOCS": "1",
                "INFINITE_CANVAS_MODEL_CAPABILITY_LOCAL_CLI": "0",
                "INFINITE_CANVAS_MODEL_CAPABILITY_SOURCE_URLS": "",
            },
            clear=False,
        ):
            sources = sources_from_environment()
        self.assertEqual(["apimart-seedream-5-0-pro-docs"], [item.name for item in sources])

        with patch.dict(
            "os.environ",
            {
                "INFINITE_CANVAS_MODEL_CAPABILITY_APIMART_DOCS": "0",
                "INFINITE_CANVAS_MODEL_CAPABILITY_LOCAL_CLI": "0",
                "INFINITE_CANVAS_MODEL_CAPABILITY_SOURCE_URLS": "",
            },
            clear=False,
        ):
            self.assertEqual((), sources_from_environment())


class DreaminaCliCapabilitySourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_cli_help_extracts_only_explicit_exact_model_limits(self):
        async def runner(command):
            if command[-1] == "--version":
                return 0, '{"version":"1.4.2"}', ""
            return 0, """Supported combinations:
- model_version: seedance2.0, seedance2.0_vip, seedance2.5
- ratio: 1:1, 3:4, 16:9, 4:3, 9:16, 21:9
- seedance2.5 -> video_resolution 480p, 720p, or 1080p; duration 4-30s
- seedance2.0_vip -> video_resolution 720p, 1080p, or 4k; duration 4-15s
- all other models -> video_resolution 720p; duration 4-15s
""", ""

        source = DreaminaCliCapabilitySource(
            "/opt/tools/dreamina", runner=runner, clock=lambda: NOW
        )
        snapshot = await source.collect()

        self.assertEqual(3, len(snapshot.records))
        by_model = {record["model_id"]: record for record in snapshot.records}
        self.assertEqual(
            ["480p", "720p", "1080p"],
            by_model["seedance2.5"]["capability"]["parameters"]["resolution"]["values"],
        )
        self.assertEqual(
            30,
            by_model["seedance2.5"]["capability"]["parameters"]["duration_seconds"]["maximum"],
        )
        self.assertEqual("dreamina 1.4.2", by_model["seedance2.0"]["evidence"]["applicable_version"])
        self.assertIn("text2video -h", by_model["seedance2.0"]["evidence"]["source_locator"])

    async def test_cancelled_cli_check_reaps_the_child_process(self):
        task = asyncio.create_task(
            DreaminaCliCapabilitySource._run(
                (sys.executable, "-c", "import time; time.sleep(60)")
            )
        )
        await asyncio.sleep(0.02)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task


class ModelCapabilityRefreshManagerTests(unittest.IsolatedAsyncioTestCase):
    def manager(self, directory, source, catalog=None, **kwargs):
        return ModelCapabilityRefreshManager(
            workbench=ModelCapabilityWorkbench(
                Path(directory) / "model-capability-workbench.json"
            ),
            catalog=catalog or FakeCatalog(),
            sources=[source],
            cache_path=Path(directory) / "cache" / "model-capability-sources.json",
            clock=lambda: NOW,
            random_value=lambda: 0.5,
            **kwargs,
        )

    async def test_changed_source_creates_evidence_and_draft_without_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = FakeCatalog()
            manager = self.manager(directory, FakeSource([source_record()]), catalog)

            result = await manager.refresh(force=True)
            snapshot = manager.workbench.snapshot()

            self.assertTrue(result["ok"])
            self.assertEqual(1, result["evidence_created"])
            self.assertEqual(1, result["drafts_created"])
            self.assertEqual("draft", snapshot["drafts"][0]["review_state"])
            self.assertEqual(catalog.revision, snapshot["drafts"][0]["base_catalog_revision"])
            self.assertEqual([], snapshot["published"]["capabilities"])
            self.assertEqual("high", snapshot["drafts"][0]["field_evidence"]["/support_state"]["confidence"])
            self.assertTrue(manager.cache_path.exists())

    async def test_repeated_source_snapshot_does_not_duplicate_review_work(self):
        with tempfile.TemporaryDirectory() as directory:
            source = FakeSource([source_record()])
            manager = self.manager(directory, source)

            await manager.refresh()
            second = await manager.refresh()
            snapshot = manager.workbench.snapshot()

            self.assertEqual(0, second["drafts_created"])
            self.assertEqual(0, second["evidence_created"])
            self.assertEqual(1, len(snapshot["drafts"]))
            self.assertEqual(1, len(snapshot["evidence"]))

    async def test_new_fetch_time_alone_does_not_create_duplicate_review_work(self):
        with tempfile.TemporaryDirectory() as directory:
            first_record = source_record()
            source = FakeSource([first_record])
            manager = self.manager(directory, source)

            await manager.refresh()
            second_record = source_record()
            second_record["evidence"]["fetched_at"] = "2026-09-05T08:00:00+00:00"
            source.records = (second_record,)
            second = await manager.refresh()

            self.assertEqual(0, second["drafts_created"])
            self.assertEqual(0, second["evidence_created"])

    async def test_forbidden_candidate_is_rejected_before_evidence_is_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            invalid = source_record(
                {
                    "support_state": "supported",
                    "inputs": {},
                    "output": {},
                    "parameters": {"price": {"type": "number"}},
                }
            )
            manager = self.manager(directory, FakeSource([invalid]))

            result = await manager.refresh()
            snapshot = manager.workbench.snapshot()

            self.assertFalse(result["ok"])
            self.assertIn("unsupported catalog field", result["last_error"])
            self.assertEqual([], snapshot["evidence"])
            self.assertEqual([], snapshot["drafts"])

    async def test_commercial_source_excerpt_is_not_cached_or_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            invalid = source_record()
            invalid["evidence"]["excerpt"] = "Pricing and credit usage are listed here."
            manager = self.manager(directory, FakeSource([invalid]))

            result = await manager.refresh()

            self.assertFalse(result["ok"])
            self.assertIn("forbidden commercial", result["last_error"])
            self.assertEqual([], manager.workbench.snapshot()["evidence"])
            cached = json.loads(manager.cache_path.read_text(encoding="utf-8"))
            self.assertEqual({}, cached["sources"])

    async def test_cache_write_failure_clears_checking_state_and_preserves_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.manager(directory, FakeSource([source_record()]))

            def fail_cache(_value):
                raise OSError("cache is read only")

            manager._write_cache = fail_cache
            result = await manager.refresh()

            self.assertFalse(result["ok"])
            self.assertFalse(result["checking"])
            self.assertIn("cache is read only", result["last_error"])
            self.assertEqual(1, len(manager.workbench.snapshot()["drafts"]))

    async def test_unexpected_catalog_failure_clears_checking_state(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = FakeCatalog()
            catalog.error = RuntimeError("catalog exploded")
            source = FakeSource([source_record()])
            manager = self.manager(directory, source, catalog)

            result = await manager.refresh()

            self.assertFalse(result["ok"])
            self.assertFalse(result["checking"])
            self.assertIn("catalog exploded", result["last_error"])
            self.assertEqual(0, source.calls)
            self.assertEqual([], manager.workbench.snapshot()["drafts"])

    async def test_failed_source_keeps_existing_review_state_and_uses_backoff(self):
        with tempfile.TemporaryDirectory() as directory:
            source = FakeSource(error=RuntimeError("provider unavailable"))
            manager = self.manager(
                directory,
                source,
                interval_seconds=86400,
                backoff_seconds=300,
                maximum_backoff_seconds=1200,
            )

            first = await manager.refresh()
            second = await manager.refresh()

            self.assertFalse(first["ok"])
            self.assertFalse(second["ok"])
            self.assertEqual(2, second["consecutive_failures"])
            self.assertIn("provider unavailable", second["last_error"])
            self.assertEqual(600, manager._next_delay())
            self.assertEqual([], manager.workbench.snapshot()["drafts"])

    async def test_concurrent_manual_refreshes_share_one_source_check(self):
        with tempfile.TemporaryDirectory() as directory:
            gate = asyncio.Event()
            source = FakeSource([source_record()], gate=gate)
            manager = self.manager(directory, source)

            first = asyncio.create_task(manager.refresh(force=True))
            await asyncio.sleep(0)
            second = asyncio.create_task(manager.refresh(force=True))
            await asyncio.sleep(0)
            gate.set()
            first_result, second_result = await asyncio.gather(first, second)

            self.assertEqual(1, source.calls)
            self.assertEqual(first_result, second_result)

    async def test_start_returns_before_the_initial_source_check_finishes(self):
        with tempfile.TemporaryDirectory() as directory:
            gate = asyncio.Event()
            source = FakeSource([source_record()], gate=gate)
            manager = self.manager(directory, source)

            scheduler = manager.start()
            await asyncio.sleep(0)

            self.assertIsNotNone(scheduler)
            self.assertFalse(scheduler.done())
            gate.set()
            await asyncio.sleep(0.02)
            await manager.stop()


if __name__ == "__main__":
    unittest.main()
