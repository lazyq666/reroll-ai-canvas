import tempfile
import threading
import unittest
from pathlib import Path

from PIL import Image

from infinite_canvas.generation_runs import (
    GenerationEffectPorts,
    GenerationRunConflict,
    ImageRun,
    WorkspaceGenerationEffects,
)
from infinite_canvas.providers.runtime import ProviderOutput


class LayerDecompositionPublicationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sources = {}
        self.saved = []

    def tearDown(self):
        self.temporary.cleanup()

    def make_image(self, name, size, color, mode="RGBA", image_format="PNG"):
        path = self.root / name
        Image.new(mode, size, color).save(path, format=image_format)
        self.sources[f"https://provider.test/{name}"] = path
        return path

    async def save_image(self, value, *, stable_id="", **_options):
        self.saved.append((value["value"], stable_id))
        return f"/assets/output/{stable_id}.png"

    def output_file(self, local_url):
        stable_id = Path(local_url).stem
        provider_url = next(
            (url for url, saved_id in self.saved if saved_id == stable_id), None
        )
        return str(self.sources.get(provider_url, ""))

    def effects(self):
        return WorkspaceGenerationEffects(
            GenerationEffectPorts(
                history_path=lambda: self.root / "history.json",
                journal_path=lambda: self.root / "effects.json",
                history_lock=threading.RLock(),
                save_image=self.save_image,
                image_meta=lambda url, _source: {"url": url},
                extract_images=lambda _raw: [],
                notify=lambda _record: None,
                output_file_from_url=self.output_file,
                now=lambda: 1_788_474_600.0,
            )
        )

    def request(self):
        return ImageRun(
            prompt="separate title",
            settings={
                "provider_id": "apimart",
                "model": "seedream-5-0-pro",
                "resolution_tier": "2K",
                "operation": "image.layer_decomposition",
                "source_media_id": "media-source-1",
            },
            references=(
                {
                    "url": "/assets/input/source.png",
                    "role": "source",
                    "kind": "image",
                },
            ),
            publication="layer-decomposition",
        )

    def output(self, layers):
        return ProviderOutput(
            metadata={"kind": "image_layer_decomposition"},
            legacy={
                "kind": "image_layer_decomposition",
                "upstream_task_id": "task-layer-1",
                "canvas_width": 1000,
                "canvas_height": 800,
                "base": {
                    "url": "https://provider.test/base.png",
                    "width": 1000,
                    "height": 800,
                    "output_format": "png",
                },
                "layers": layers,
                "provider_raw_metadata": {
                    "id": "task-layer-1",
                    "status": "success",
                },
            },
        )

    async def test_materializes_all_outputs_and_builds_manifest_v1(self):
        self.make_image("base.png", (1000, 800), (255, 255, 255, 255))
        self.make_image("title.png", (200, 100), (255, 0, 0, 128))
        output = self.output(
            [
                {
                    "url": "https://provider.test/title.png",
                    "width": 200,
                    "height": 100,
                    "output_format": "png",
                    "name": "Title",
                    "description": "Title layer",
                    "z_index": 4,
                    "absolute_bbox": [100, 50, 300, 150],
                    "normalized_bbox": [100, 62, 300, 187],
                    "source_index": 1,
                }
            ]
        )

        prepared = await self.effects().prepare(
            "run-layer-1", self.request(), output
        )

        manifest = prepared.result["manifest"]
        self.assertEqual("image_layer_decomposition", prepared.result["kind"])
        self.assertEqual(1, manifest["manifest_version"])
        self.assertEqual("media-source-1", manifest["source_media_id"])
        self.assertEqual("run-layer-1", manifest["generation_run_id"])
        self.assertEqual("task-layer-1", manifest["upstream_task_id"])
        self.assertEqual(1000, manifest["canvas_width"])
        self.assertEqual(800, manifest["canvas_height"])
        self.assertEqual("/assets/output/run-layer-1_base.png", manifest["base_output_media_id"])
        self.assertEqual(4, manifest["layers"][0]["z_index"])
        self.assertEqual([100, 50, 300, 150], manifest["layers"][0]["absolute_bbox"])
        self.assertEqual(
            "/assets/output/run-layer-1_layer_1.png",
            manifest["layers"][0]["output_media_id"],
        )
        self.assertEqual(
            manifest, prepared.canvas["layer_decomposition_manifest"]
        )
        self.assertEqual(2, len(self.saved))

    async def test_partial_layer_failure_keeps_successful_materials_but_never_succeeds(self):
        self.make_image("base.png", (1000, 800), (255, 255, 255, 255))
        self.make_image("good.png", (200, 100), (255, 0, 0, 128))
        bad = self.root / "bad.png"
        bad.write_bytes(b"broken")
        self.sources["https://provider.test/bad.png"] = bad
        layers = []
        for index, name in enumerate(("good.png", "bad.png"), start=1):
            layers.append(
                {
                    "url": f"https://provider.test/{name}",
                    "width": 200,
                    "height": 100,
                    "output_format": "png",
                    "name": name,
                    "description": "",
                    "z_index": index,
                    "absolute_bbox": [100, 50, 300, 150],
                    "normalized_bbox": [100, 62, 300, 187],
                    "source_index": index,
                }
            )

        with self.assertRaises(GenerationRunConflict) as raised:
            await self.effects().prepare(
                "run-layer-1", self.request(), self.output(layers)
            )

        self.assertIn("第 2 个图层", str(raised.exception))
        self.assertEqual(
            [
                "run-layer-1_base",
                "run-layer-1_layer_1",
                "run-layer-1_layer_2",
            ],
            [stable_id for _url, stable_id in self.saved],
        )

    async def test_duplicate_layer_content_is_rejected_after_download(self):
        self.make_image("base.png", (1000, 800), (255, 255, 255, 255))
        first = self.make_image("first.png", (200, 100), (255, 0, 0, 128))
        duplicate = self.root / "duplicate.png"
        duplicate.write_bytes(first.read_bytes())
        self.sources["https://provider.test/duplicate.png"] = duplicate
        layers = []
        for index, name in enumerate(("first.png", "duplicate.png"), start=1):
            layers.append(
                {
                    "url": f"https://provider.test/{name}",
                    "width": 200,
                    "height": 100,
                    "output_format": "png",
                    "name": name,
                    "description": "",
                    "z_index": index,
                    "absolute_bbox": [100, 50, 300, 150],
                    "normalized_bbox": [100, 62, 300, 187],
                    "source_index": index,
                }
            )

        with self.assertRaises(GenerationRunConflict) as raised:
            await self.effects().prepare(
                "run-layer-1", self.request(), self.output(layers)
            )

        self.assertIn("duplicate_layer", str(raised.exception))

    async def test_missing_source_media_id_uses_redacted_stable_fingerprint(self):
        self.make_image("base.png", (1000, 800), (255, 255, 255, 255))
        self.make_image("title.png", (200, 100), (255, 0, 0, 128))
        request = self.request()
        request.settings["source_media_id"] = ""
        request.references[0]["url"] = (
            "https://input.test/source.png?token=do-not-persist"
        )
        prepared = await self.effects().prepare(
            "run-layer-1",
            request,
            self.output(
                [
                    {
                        "url": "https://provider.test/title.png",
                        "width": 200,
                        "height": 100,
                        "output_format": "png",
                        "name": "Title",
                        "description": "",
                        "z_index": 1,
                        "absolute_bbox": [100, 50, 300, 150],
                        "normalized_bbox": [100, 62, 300, 187],
                        "source_index": 1,
                    }
                ]
            ),
        )

        source_id = prepared.result["manifest"]["source_media_id"]
        self.assertTrue(source_id.startswith("source:"))
        self.assertNotIn("token", source_id)
        self.assertNotIn("do-not-persist", source_id)


if __name__ == "__main__":
    unittest.main()
