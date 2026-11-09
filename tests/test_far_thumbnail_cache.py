import ast
import asyncio
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from threading import BoundedSemaphore

from fastapi import HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps


class FarThumbnailCacheTests(unittest.TestCase):
    def test_actual_preview_builder_preserves_alpha_ratio_and_reuses_cache(self):
        source = Path('backend/main.py').read_text()
        tree = ast.parse(source)
        names = {'media_preview_cache_paths', 'media_preview_file_response', '_share_media_preview_width'}
        widths = next(node for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'SHARE_MEDIA_PREVIEW_WIDTHS' for target in node.targets))
        nodes = [widths] + [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp) / 'cache'
            source_image = Path(temp) / 'source.png'
            Image.new('RGBA', (400, 200), (220, 10, 40, 80)).save(source_image)
            namespace = dict(os=os, hashlib=hashlib, asyncio=asyncio, Path=Path, Image=Image, ImageOps=ImageOps,
                FileResponse=FileResponse, HTTPException=HTTPException, media_preview_directory=lambda: str(cache),
                MEDIA_PREVIEW_BUILD_SEMAPHORE=BoundedSemaphore(2), is_video_preview_file=lambda path: False,
                image_has_alpha=lambda image: 'A' in image.getbands())
            exec(compile(ast.Module(body=nodes, type_ignores=[]), '<preview functions>', 'exec'), namespace)
            async def run():
                cold = await namespace['media_preview_file_response'](str(source_image), 64)
                output = Path(cold.path)
                with Image.open(output) as image:
                    self.assertEqual(image.size, (64, 32))
                    self.assertEqual(image.convert('RGBA').getpixel((10, 10))[3], 80)
                stamp = output.stat().st_mtime_ns
                warm = await namespace['media_preview_file_response'](str(source_image), 64)
                self.assertEqual(warm.path, str(output))
                self.assertEqual(output.stat().st_mtime_ns, stamp)
            asyncio.run(run())
            self.assertEqual(namespace['_share_media_preview_width'](64), 64)
            self.assertEqual(namespace['_share_media_preview_width'](65), 512)


if __name__ == '__main__':
    unittest.main()
