import tempfile
import unittest
from pathlib import Path

from PIL import Image

from infinite_canvas.layer_decomposition import (
    LayerDecompositionError,
    inspect_layer_image,
    parse_apimart_layer_decomposition,
    sanitize_provider_metadata,
)


def apimart_result(*, width=2048, height=2048, layer_count=1):
    urls = ["https://cdn.example.test/base.png"]
    sizes = [f"{width}x{height}"]
    formats = ["png"]
    layers = [{"z_index": 0, "size": sizes[0], "output_format": "png"}]
    for index in range(layer_count):
        left = 10 + index
        top = 20 + index
        right = min(width, left + 100)
        bottom = min(height, top + 80)
        urls.append(f"https://cdn.example.test/layer-{index}.png")
        sizes.append(f"{right - left}x{bottom - top}")
        formats.append("png")
        layers.append(
            {
                "z_index": index + 1,
                "size": sizes[-1],
                "output_format": "png",
                "name": f"Layer {index + 1}",
                "description": f"Layer description {index + 1}",
                "bounding_box": {
                    "absolute": [left, top, right, bottom],
                    "normalized": [
                        round(left / width * 1000),
                        round(top / height * 1000),
                        round(right / width * 1000),
                        round(bottom / height * 1000),
                    ],
                },
            }
        )
    return {
        "id": "task-layer-1",
        "status": "success",
        "result": {
            "images": [
                {
                    "url": urls,
                    "sizes": sizes,
                    "output_formats": formats,
                    "layer_decomposition": True,
                    "layers": layers,
                }
            ]
        },
    }


class LayerDecompositionResponseTests(unittest.TestCase):
    def test_parses_non_square_base_and_preserves_layer_order_and_z_index(self):
        payload = apimart_result(width=1600, height=900, layer_count=2)
        payload["result"]["images"][0]["layers"][1]["z_index"] = 8
        payload["result"]["images"][0]["layers"][2]["z_index"] = 12

        result = parse_apimart_layer_decomposition(payload)

        self.assertEqual((1600, 900), (result.canvas_width, result.canvas_height))
        self.assertEqual("task-layer-1", result.upstream_task_id)
        self.assertEqual([8, 12], [layer.z_index for layer in result.layers])
        self.assertEqual(
            ["Layer 1", "Layer 2"], [layer.name for layer in result.layers]
        )

    def test_accepts_exactly_sixteen_layers(self):
        result = parse_apimart_layer_decomposition(
            apimart_result(layer_count=16)
        )
        self.assertEqual(16, len(result.layers))

    def test_rejects_structural_and_coordinate_errors_explicitly(self):
        cases = []
        too_many = apimart_result(layer_count=16)
        image = too_many["result"]["images"][0]
        image["url"].append("https://cdn.example.test/overflow.png")
        image["sizes"].append("10x10")
        image["output_formats"].append("png")
        image["layers"].append(
            {
                "z_index": 17,
                "size": "10x10",
                "output_format": "png",
                "bounding_box": {
                    "absolute": [0, 0, 10, 10],
                    "normalized": [0, 0, 5, 5],
                },
            }
        )
        cases.append((too_many, "layer_count"))

        for code, bbox in (
            ("bbox_negative", [-1, 0, 10, 10]),
            ("bbox_reversed", [10, 0, 5, 10]),
            ("bbox_out_of_bounds", [0, 0, 3000, 10]),
        ):
            invalid = apimart_result()
            invalid["result"]["images"][0]["layers"][1]["bounding_box"][
                "absolute"
            ] = bbox
            cases.append((invalid, code))

        duplicate_z = apimart_result(layer_count=2)
        duplicate_z["result"]["images"][0]["layers"][2]["z_index"] = 1
        cases.append((duplicate_z, "duplicate_z_index"))

        duplicate_base_z = apimart_result()
        duplicate_base_z["result"]["images"][0]["layers"][1]["z_index"] = 0
        cases.append((duplicate_base_z, "duplicate_z_index"))

        abnormal_order = apimart_result(layer_count=2)
        abnormal_order["result"]["images"][0]["layers"][1]["z_index"] = 3
        abnormal_order["result"]["images"][0]["layers"][2]["z_index"] = 2
        cases.append((abnormal_order, "z_index_order"))

        for payload, expected_code in cases:
            with self.subTest(code=expected_code):
                with self.assertRaises(LayerDecompositionError) as raised:
                    parse_apimart_layer_decomposition(payload)
                self.assertEqual(expected_code, raised.exception.code)

    def test_rejects_parallel_array_mismatch_and_non_png_layer(self):
        mismatched = apimart_result()
        mismatched["result"]["images"][0]["sizes"].pop()
        wrong_format = apimart_result()
        wrong_format["result"]["images"][0]["output_formats"][1] = "jpeg"

        for payload, code in (
            (mismatched, "parallel_arrays"),
            (wrong_format, "layer_format"),
        ):
            with self.subTest(code=code):
                with self.assertRaises(LayerDecompositionError) as raised:
                    parse_apimart_layer_decomposition(payload)
                self.assertEqual(code, raised.exception.code)

    def test_rejects_base_metadata_and_coordinate_mismatches(self):
        invalid_base = apimart_result()
        invalid_base["result"]["images"][0]["layers"][0]["z_index"] = 2
        inconsistent_normalized = apimart_result(width=1000, height=800)
        inconsistent_normalized["result"]["images"][0]["layers"][1][
            "bounding_box"
        ]["normalized"] = [400, 400, 500, 500]

        for payload, code in (
            (invalid_base, "base_metadata"),
            (inconsistent_normalized, "bbox_inconsistent"),
        ):
            with self.subTest(code=code):
                with self.assertRaises(LayerDecompositionError) as raised:
                    parse_apimart_layer_decomposition(payload)
                self.assertEqual(code, raised.exception.code)

    def test_accepts_layer_pixel_size_independent_from_placement_bbox(self):
        payload = apimart_result(width=1600, height=900)
        image = payload["result"]["images"][0]
        image["sizes"][1] = "400x300"
        image["layers"][1]["size"] = "400x300"
        image["layers"][1]["bounding_box"] = {
            "absolute": [100, 100, 500, 350],
            "normalized": [63, 111, 313, 389],
        }

        result = parse_apimart_layer_decomposition(payload)

        self.assertEqual(
            (400, 300), (result.layers[0].width, result.layers[0].height)
        )
        self.assertEqual((100, 100, 500, 350), result.layers[0].absolute_bbox)

    def test_provider_metadata_is_redacted_and_bounded(self):
        payload = {
            "task_id": "task-safe",
            "authorization": "Bearer secret-token",
            "nested": {
                "download_url": "https://cdn.example.test/layer.png?signature=secret",
                "api_key": "secret-key",
                "description": "x" * 20_000,
            },
        }

        result = sanitize_provider_metadata(payload, max_bytes=1024)
        encoded = __import__("json").dumps(result, ensure_ascii=False).encode()

        self.assertLessEqual(len(encoded), 1024)
        self.assertNotIn("secret-token", encoded.decode())
        self.assertNotIn("secret-key", encoded.decode())
        self.assertNotIn("signature=secret", encoded.decode())
        self.assertIn("task-safe", encoded.decode())


class LayerDecompositionImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def image(self, name, mode, color, image_format="PNG"):
        path = self.root / name
        Image.new(mode, (12, 8), color).save(path, format=image_format)
        return path

    def test_accepts_non_empty_rgba_png_layer(self):
        path = self.image("layer.png", "RGBA", (255, 0, 0, 128))
        inspection = inspect_layer_image(path, expected_width=12, expected_height=8)
        self.assertEqual((12, 8), (inspection.width, inspection.height))
        self.assertTrue(inspection.has_alpha)

    def test_rejects_empty_no_alpha_wrong_mime_wrong_size_and_corrupt_layers(self):
        empty = self.image("empty.png", "RGBA", (0, 0, 0, 0))
        no_alpha = self.image("opaque.png", "RGB", (255, 0, 0))
        opaque_alpha = self.image("opaque-alpha.png", "RGBA", (255, 0, 0, 255))
        jpeg = self.image("fake.png", "RGB", (255, 0, 0), "JPEG")
        wrong_size = self.image("wrong-size.png", "RGBA", (255, 0, 0, 128))
        corrupt = self.root / "corrupt.png"
        corrupt.write_bytes(b"not an image")

        cases = (
            (empty, 12, 8, "empty_layer"),
            (no_alpha, 12, 8, "alpha_required"),
            (opaque_alpha, 12, 8, "alpha_transparency_required"),
            (jpeg, 12, 8, "layer_mime"),
            (wrong_size, 7, 8, "layer_dimensions"),
            (corrupt, 12, 8, "corrupt_image"),
        )
        for path, width, height, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(LayerDecompositionError) as raised:
                    inspect_layer_image(
                        path, expected_width=width, expected_height=height
                    )
                self.assertEqual(code, raised.exception.code)


if __name__ == "__main__":
    unittest.main()
