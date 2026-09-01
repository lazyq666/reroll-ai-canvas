import tempfile
import unittest
from pathlib import Path

from infinite_canvas.generation_runs import ImageRun
from infinite_canvas.local_image_processor import (
    LocalImageProcessorGenerationExecutor,
)
from infinite_canvas.providers.core import Completed
from infinite_canvas.providers.runtime import ProviderOutput


class FakeDelegate:
    def __init__(self):
        self.calls = []

    async def execute(self, request):
        self.calls.append(request)
        return Completed(ProviderOutput(legacy={"images": ["remote.png"]}))


class FakeDepthProcessor:
    def __init__(self):
        self.calls = []

    def process(self, source, output, *, progress=None):
        self.calls.append((Path(source), Path(output)))
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        Path(output).write_bytes(b"depth-png")
        if progress:
            progress(
                {
                    "phase": "completed",
                    "progress": 100,
                    "message": "深度图处理完成",
                }
            )
        return {
            "processor_id": "depth-anything-v2-small",
            "polarity": "near_white",
            "output_size": [64, 48],
        }


class LocalImageProcessorGenerationExecutorTests(
    unittest.IsolatedAsyncioTestCase
):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.png"
        self.source.write_bytes(b"source")
        self.delegate = FakeDelegate()
        self.processor = FakeDepthProcessor()
        self.executor = LocalImageProcessorGenerationExecutor(
            delegate=self.delegate,
            processor=self.processor,
            resolve_media=(
                lambda url: self.source
                if url == "/assets/source.png"
                else None
            ),
            result_path=lambda key: self.root / "results" / f"{key}.png",
        )

    def tearDown(self):
        self.temporary.cleanup()

    async def test_depth_run_resolves_source_and_returns_provider_output(self):
        progress = []

        result = await self.executor.execute(
            ImageRun(
                prompt="",
                settings={"processor_id": "depth-anything-v2-small"},
                references=({"url": "/assets/source.png"},),
                publication="image-processor",
            ),
            progress=progress.append,
        )

        self.assertIsInstance(result, Completed)
        self.assertEqual(
            "near_white",
            result.output.metadata["image_processor"]["polarity"],
        )
        self.assertEqual(1, len(self.processor.calls))
        self.assertEqual("completed", progress[-1]["phase"])

    async def test_non_processor_runs_delegate_unchanged(self):
        request = ImageRun(prompt="x", settings={"provider_id": "fake"})

        result = await self.executor.execute(request)

        self.assertIsInstance(result, Completed)
        self.assertEqual([request], self.delegate.calls)
        self.assertEqual([], self.processor.calls)


if __name__ == "__main__":
    unittest.main()
