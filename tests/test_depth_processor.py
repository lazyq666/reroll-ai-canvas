import tempfile
import unittest
import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

from infinite_canvas.depth_processor import (
    DEPTH_ANYTHING_V2_SMALL,
    DepthAnythingV2SmallProcessor,
    DepthProcessorInputError,
    DepthProcessorModelError,
    DepthModelSpec,
)


class FakeSession:
    def __init__(self, output):
        self.output = output
        self.feed = None

    def get_inputs(self):
        return [SimpleNamespace(name="pixel_values")]

    def run(self, _names, feed):
        self.feed = feed
        return [self.output]


class FakeResponse:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        del chunk_size
        return iter(self.chunks)


class DepthAnythingV2SmallProcessorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_manifest_is_the_approved_fp32_revision(self):
        self.assertEqual(
            "4472b7362082ad9968fee890ca0f1e5aca36b93d",
            DEPTH_ANYTHING_V2_SMALL.revision,
        )
        self.assertEqual(99_060_839, DEPTH_ANYTHING_V2_SMALL.size)
        self.assertEqual(
            "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
            DEPTH_ANYTHING_V2_SMALL.sha256,
        )
        self.assertEqual("Apache-2.0", DEPTH_ANYTHING_V2_SMALL.license)

    def test_process_preserves_source_size_and_maps_larger_depth_to_white(self):
        model_bytes = b"fake-onnx-model"
        spec = DepthModelSpec(
            processor_id="depth-anything-v2-small",
            revision="test-revision",
            filename="model.onnx",
            url="https://models.test/model.onnx",
            size=len(model_bytes),
            sha256=hashlib.sha256(model_bytes).hexdigest(),
            license="Apache-2.0",
        )
        model_dir = self.root / "models"
        model_dir.mkdir()
        (model_dir / spec.filename).write_bytes(model_bytes)
        source = self.root / "source.png"
        output = self.root / "depth.png"
        Image.new("RGB", (4, 2), (128, 64, 32)).save(source)
        session = FakeSession(
            np.asarray([[[0.0, 1.0], [2.0, 3.0]]], dtype=np.float32)
        )
        processor = DepthAnythingV2SmallProcessor(
            model_dir=model_dir,
            spec=spec,
            session_factory=lambda _model_path: session,
        )

        metadata = processor.process(source, output)

        result = Image.open(output)
        values = np.asarray(result)
        self.assertEqual("L", result.mode)
        self.assertEqual((4, 2), result.size)
        self.assertLess(int(values[0, 0]), int(values[-1, -1]))
        self.assertEqual("near_white", metadata["polarity"])
        self.assertEqual([4, 2], metadata["output_size"])
        tensor = session.feed["pixel_values"]
        self.assertEqual((1, 3), tensor.shape[:2])
        self.assertEqual(0, tensor.shape[-1] % 14)
        self.assertEqual(0, tensor.shape[-2] % 14)
        self.assertAlmostEqual(
            (128.0 / 255.0 - 0.485) / 0.229,
            float(tensor[0, 0, 0, 0]),
            places=5,
        )

    def test_oversized_source_is_rejected_before_model_download(self):
        source = self.root / "too-large.png"
        Image.new("RGB", (2, 2), (0, 0, 0)).save(source)

        def unexpected_download(*_args, **_kwargs):
            self.fail("invalid source must not trigger a model download")

        processor = DepthAnythingV2SmallProcessor(
            model_dir=self.root / "models",
            http_get=unexpected_download,
            max_source_pixels=3,
        )

        with self.assertRaises(DepthProcessorInputError):
            processor.process(source, self.root / "depth.png")

    def test_download_is_verified_and_reports_monotonic_progress(self):
        model_bytes = b"verified-model"
        spec = DepthModelSpec(
            processor_id="depth-anything-v2-small",
            revision="test-revision",
            filename="model.onnx",
            url="https://models.test/model.onnx",
            size=len(model_bytes),
            sha256=hashlib.sha256(model_bytes).hexdigest(),
            license="Apache-2.0",
        )
        source = self.root / "source.png"
        Image.new("RGB", (2, 2), (128, 128, 128)).save(source)
        events = []
        processor = DepthAnythingV2SmallProcessor(
            model_dir=self.root / "models",
            spec=spec,
            http_get=lambda *_args, **_kwargs: FakeResponse(
                [model_bytes[:4], model_bytes[4:9], model_bytes[9:]]
            ),
            session_factory=lambda _path: FakeSession(
                np.asarray([[[0.0, 1.0], [2.0, 3.0]]], dtype=np.float32)
            ),
        )

        processor.process(
            source,
            self.root / "depth.png",
            progress=events.append,
        )

        self.assertEqual(model_bytes, processor.model_path.read_bytes())
        download = [
            item["progress"]
            for item in events
            if item["phase"] == "downloading-model"
        ]
        self.assertEqual(0, download[0])
        self.assertEqual(100, download[-1])
        self.assertEqual(sorted(download), download)
        self.assertEqual("completed", events[-1]["phase"])

    def test_bad_download_is_removed(self):
        expected = b"expected-model"
        downloaded = b"tampered-model"
        self.assertEqual(len(expected), len(downloaded))
        spec = DepthModelSpec(
            processor_id="depth-anything-v2-small",
            revision="test-revision",
            filename="model.onnx",
            url="https://models.test/model.onnx",
            size=len(expected),
            sha256=hashlib.sha256(expected).hexdigest(),
            license="Apache-2.0",
        )
        source = self.root / "source.png"
        Image.new("RGB", (2, 2), (0, 0, 0)).save(source)
        processor = DepthAnythingV2SmallProcessor(
            model_dir=self.root / "models",
            spec=spec,
            http_get=lambda *_args, **_kwargs: FakeResponse([downloaded]),
        )

        with self.assertRaises(DepthProcessorModelError):
            processor.process(source, self.root / "depth.png")

        self.assertFalse(processor.model_path.exists())
        self.assertEqual([], list(processor.model_dir.glob("*.download")))

    def test_constant_or_invalid_depth_becomes_stable_black(self):
        model_bytes = b"fake-onnx-model"
        spec = DepthModelSpec(
            processor_id="depth-anything-v2-small",
            revision="test-revision",
            filename="model.onnx",
            url="https://models.test/model.onnx",
            size=len(model_bytes),
            sha256=hashlib.sha256(model_bytes).hexdigest(),
            license="Apache-2.0",
        )
        model_dir = self.root / "models"
        model_dir.mkdir()
        (model_dir / spec.filename).write_bytes(model_bytes)
        source = self.root / "source.png"
        output = self.root / "depth.png"
        Image.new("RGB", (3, 2), (255, 255, 255)).save(source)
        processor = DepthAnythingV2SmallProcessor(
            model_dir=model_dir,
            spec=spec,
            session_factory=lambda _path: FakeSession(
                np.asarray(
                    [[[np.nan, 7.0], [7.0, np.inf]]],
                    dtype=np.float32,
                )
            ),
        )

        processor.process(source, output)

        self.assertEqual(0, int(np.asarray(Image.open(output)).max()))


if __name__ == "__main__":
    unittest.main()
