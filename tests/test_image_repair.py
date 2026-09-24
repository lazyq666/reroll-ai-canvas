import copy
import tempfile
import unittest
from unittest.mock import Mock
from pathlib import Path

from PIL import Image

from infinite_canvas.image_repair import ImageRepairError, compose_repair, repair_layers, validate_recipe
from infinite_canvas.layered_psd import build_rgba_psd
from infinite_canvas.generation_runs import GenerationOutputPorts, ImageRun, WorkspaceGenerationEffects
from infinite_canvas.providers.runtime import ProviderOutput
from tests.test_layered_psd import _parse_layer_records


class ImageRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        Image.new('RGBA', (100, 80), (0, 0, 255, 255)).save(self.root / 'source.png')
        Image.new('RGBA', (20, 20), (255, 0, 0, 255)).save(self.root / 'patch.png')
        self.recipe = dict(version=1, width=100, height=80,
                           source={'url': '/assets/source.png'}, patch={'url': '/assets/patch.png'},
                           crop=dict(x=20, y=20, width=20, height=20),
                           transform=dict(x=20, y=20, width=20, height=20), feather=5)

    def tearDown(self):
        self.temp.cleanup()

    def resolve(self, url):
        path = self.root / Path(url).name
        return path if path.exists() else None

    def test_composition_leaves_outside_pixels_and_original_untouched(self):
        result, recipe = compose_repair(self.recipe, self.resolve)
        self.assertEqual((100, 80), result.size)
        self.assertEqual((0, 0, 255, 255), result.getpixel((0, 0)))
        self.assertEqual((255, 0, 0, 255), result.getpixel((30, 30)))
        self.assertEqual((26, 0, 229, 255), result.getpixel((20, 20)))
        with Image.open(self.root / 'source.png') as original:
            self.assertEqual((0, 0, 255, 255), original.getpixel((30, 30)))
        self.assertEqual(self.recipe, recipe)

    def test_feather_preserves_transparency_and_color(self):
        Image.new('RGBA', (20, 20), (255, 0, 0, 128)).save(self.root / 'patch.png')
        _recipe, _source, patch, _bounds = repair_layers(self.recipe, self.resolve)
        self.assertEqual((255, 0, 0, 13), patch.getpixel((0, 0)))
        self.assertEqual((255, 0, 0, 128), patch.getpixel((10, 10)))

    def test_soft_edge_brush_preserves_center_and_matches_browser(self):
        import json
        import subprocess
        from infinite_canvas.image_repair import feather_alpha
        width, height, diameter = 100, 80, 40
        image = Image.new('RGBA', (width, height), (120, 80, 40, 255))
        result = feather_alpha(image, diameter)
        self.assertLess(result.getpixel((0, 40))[3], 2)
        self.assertEqual(result.getpixel((20, 40)), (120, 80, 40, 255))
        self.assertEqual(result.getpixel((50, 40)), (120, 80, 40, 255))
        script = "require('./static/js/smart-canvas/image-repair-geometry.js');console.log(JSON.stringify([...globalThis.SmartCanvasModules.imageRepairGeometry.featherAlpha(100,80,40)]))"
        browser = json.loads(subprocess.check_output(['node', '-e', script], cwd=Path(__file__).resolve().parents[1]))
        self.assertEqual(list(result.getchannel('A').tobytes()), browser)
        self.recipe.update(version=2, feather=10)
        Image.new('RGBA', (20, 20), (255, 0, 0, 128)).save(self.root / 'patch.png')
        _, _, patch, _ = repair_layers(self.recipe, self.resolve)
        self.assertEqual(patch.getpixel((10, 10)), (255, 0, 0, 128))
        self.assertEqual(patch.getpixel((5, 10)), (255, 0, 0, 128))
        self.assertEqual(patch.getpixel((0, 0))[3], 0)

    def test_shift_scale_and_clip_use_original_pixels(self):
        self.recipe['transform'] = dict(x=-10, y=60, width=40, height=40)
        self.recipe['feather'] = 0
        _recipe, source, patch, bounds = repair_layers(self.recipe, self.resolve)
        self.assertEqual((0, 60, 30, 80), bounds)
        self.assertEqual((30, 20), patch.size)
        psd = build_rgba_psd(100, 80, [
            dict(name='原图', image=source, bounds=(0, 0, 100, 80)),
            dict(name='修复图', image=patch, bounds=bounds),
        ])
        header, records = _parse_layer_records(psd.content)
        self.assertEqual(2, len(records))
        self.assertEqual(b'8BPS', psd.content[:4])
        self.assertIn('修复图'.encode('utf-16-be'), psd.content)

    def test_missing_or_changed_media_and_invalid_geometry_rejected(self):
        cases = [
            {'width': 101}, {'version': 3}, {'feather': float('nan')},
            {'source': {'url': 'https://elsewhere/image.png'}},
            {'patch': {'url': '/assets/missing.png'}},
            {'transform': dict(x=100, y=0, width=20, height=20)},
            {'transform': dict(x=0, y=0, width=30000, height=30000)},
        ]
        for patch in cases:
            with self.subTest(patch=patch), self.assertRaises(ImageRepairError):
                compose_repair({**self.recipe, **patch}, self.resolve)

    def test_request_validation_does_not_require_generated_patch(self):
        value = copy.deepcopy(self.recipe)
        del value['patch']
        self.assertNotIn('patch', validate_recipe(value, require_patch=False))


class ImageRepairPublicationTests(unittest.IsolatedAsyncioTestCase):
    async def test_multiple_outputs_keep_separate_patches_and_composites(self):
        recipe = {'version': 2, 'source': {'url': '/assets/source.png'}}
        frozen = copy.deepcopy(recipe)
        async def save(value, **kwargs):
            return value['value']
        async def compose(url, value, *, stable_id):
            return f'/assets/composite-{stable_id}.png', {**copy.deepcopy(value), 'patch': {'url': url}}
        effects = WorkspaceGenerationEffects(GenerationOutputPorts(
            save_image=save, image_meta=lambda url, _: {'url': url}, extract_images=lambda _: [],
            compose_image_repair=compose,
        ), publication=Mock())
        patches = tuple(f'/assets/patch-{i}.png' for i in range(3))
        result = await effects.prepare('repair-multiple', ImageRun(
            prompt='fix', count=3, settings={'local_repair': recipe}, publication='online-image',
        ), ProviderOutput(media=patches, raw={}))
        items = result.result['image_items']
        self.assertEqual(3, len({item['url'] for item in items}))
        self.assertEqual(list(patches), [item['local_repair']['patch']['url'] for item in items])
        self.assertEqual(frozen, recipe)
        items[0]['local_repair']['source']['url'] = '/assets/changed.png'
        self.assertEqual('/assets/source.png', items[1]['local_repair']['source']['url'])

    async def test_history_canvas_and_result_publish_composite_with_editable_recipe(self):
        calls = []
        recipe = {'version': 1, 'source': {'url': '/assets/source.png'}}
        async def save(*args, **kwargs):
            return '/assets/patch.png'
        async def compose(url, value, *, stable_id):
            calls.append((url, value, stable_id))
            return '/assets/composite.png', {**value, 'patch': {'url': url}}
        effects = WorkspaceGenerationEffects(GenerationOutputPorts(
            save_image=save, image_meta=lambda url, _: {'url': url}, extract_images=lambda _: [],
            compose_image_repair=compose,
        ), publication=Mock())
        result = await effects.prepare('repair-run', ImageRun(prompt='fix', settings={'local_repair': recipe}, publication='online-image'), ProviderOutput(media=('/assets/patch.png',)))
        self.assertEqual('/assets/composite.png', result.canvas['image_items'][0]['url'])
        self.assertEqual('/assets/patch.png', result.result['image_items'][0]['local_repair']['patch']['url'])
        self.assertEqual(['/assets/composite.png'], result.result['images'])
        self.assertEqual(1, len(calls))


if __name__ == '__main__':
    unittest.main()
