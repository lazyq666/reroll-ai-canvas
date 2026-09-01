import tempfile
import unittest
from pathlib import Path

from PIL import Image

from infinite_canvas.image_materialization import materialize_image_cover


class ImageMaterializationTests(unittest.TestCase):
    def test_cover_center_crops_real_file_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "provider.png"
            output = root / "materialized.png"
            image = Image.new("RGB", (400, 300), "red")
            for x in range(100, 300):
                for y in range(300):
                    image.putpixel((x, y), (0, 255, 0))
            image.save(source)

            result = materialize_image_cover(source, "16:9", output)

            self.assertTrue(result.cropped)
            self.assertEqual((400, 225), result.output_size)
            with Image.open(source) as source_image:
                self.assertEqual((400, 300), source_image.size)
            with Image.open(output) as output_image:
                self.assertEqual((400, 225), output_image.size)
                self.assertEqual((0, 255, 0), output_image.getpixel((200, 100)))

    def test_matching_ratio_is_not_reencoded_or_cropped(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "provider.png"
            output = root / "unused.png"
            Image.new("RGB", (1919, 1080), "blue").save(source)

            result = materialize_image_cover(source, "16:9", output)

            self.assertFalse(result.cropped)
            self.assertEqual(source, result.output_path)
            self.assertFalse(output.exists())

    def test_issue_192_provider_output_is_cropped_back_to_the_reference_ratio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "issue-192-provider.png"
            output = root / "issue-192-materialized.png"
            Image.new("RGB", (3840, 2160), "blue").save(source)

            result = materialize_image_cover(source, "405:240", output)

            self.assertTrue(result.cropped)
            self.assertEqual((3840, 2160), result.source_size)
            self.assertEqual((3645, 2160), result.output_size)
            with Image.open(source) as source_image:
                self.assertEqual((3840, 2160), source_image.size)
            with Image.open(output) as output_image:
                self.assertEqual((3645, 2160), output_image.size)


if __name__ == "__main__":
    unittest.main()
