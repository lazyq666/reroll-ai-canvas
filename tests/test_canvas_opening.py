import asyncio
import json
import math
import unittest

from infinite_canvas.artifacts import APPLICATION_UPDATE_RUNTIME_FILES
from infinite_canvas.canvas_opening import (
    canvas_outline,
    stream_canvas_opening,
)


class CanvasOpeningTests(unittest.TestCase):
    def test_outline_is_a_geometry_only_projection(self):
        canvas = {
            "id": "canvas-a",
            "revision": 7,
            "nodes": [
                {
                    "id": "node-a",
                    "type": "smart-prompt",
                    "x": 12,
                    "y": -4,
                    "w": 360,
                    "h": 220,
                    "text": "must not leak into outline",
                    "llmInputMedia": [{"url": "/assets/private.png"}],
                },
                {"id": "", "x": 99, "y": 99},
                "not-a-node",
            ],
        }

        outline = canvas_outline(canvas)

        self.assertEqual(outline["type"], "canvas_outline")
        self.assertEqual(outline["canvas_id"], "canvas-a")
        self.assertEqual(outline["revision"], 7)
        node = outline["nodes"][0]
        self.assertEqual(node["id"], "node-a")
        self.assertEqual(node["type"], "smart-prompt")
        self.assertEqual((node["x"], node["y"]), (12.0, -4.0))
        self.assertEqual((node["w"], node["h"]), (360.0, 220.0))
        self.assertTrue(node["promptHasInputMedia"])
        self.assertNotIn("text", node)
        self.assertNotIn("text_length", node)
        self.assertNotIn("llmInputMedia", node)
        self.assertNotIn("/assets/private.png", json.dumps(outline))

    def test_outline_projects_media_measurements_without_media_urls(self):
        outline = canvas_outline(
            {
                "id": "canvas-media",
                "nodes": [
                    {
                        "id": "wide-image",
                        "type": "smart-image",
                        "x": 20,
                        "y": 30,
                        "images": [
                            {
                                "url": "/assets/private-wide.png?token=secret",
                                "kind": "image",
                                "natural_w": 1200,
                                "natural_h": 400,
                            }
                        ],
                    }
                ],
            }
        )

        node = outline["nodes"][0]
        self.assertNotIn("w", node)
        self.assertNotIn("h", node)
        self.assertEqual(
            node["images"],
            [
                {
                    "kind": "image",
                    "is_still_image": True,
                    "natural_w": 1200.0,
                    "natural_h": 400.0,
                }
            ],
        )
        self.assertNotIn("private-wide", json.dumps(outline))

    def test_outline_omits_legacy_generation_gallery_that_hydration_splits(self):
        outline = canvas_outline(
            {
                "id": "canvas-generation-gallery",
                "nodes": [
                    {
                        "id": "legacy-gallery",
                        "type": "smart-image",
                        "generationOutputNode": True,
                        "images": [
                            {"url": "/media/a.png", "natural_w": 640, "natural_h": 480},
                            {"url": "/media/b.png", "natural_w": 480, "natural_h": 640},
                        ],
                    },
                    {
                        "id": "stable-generation-output",
                        "type": "smart-image",
                        "generationOutputNode": True,
                        "generationMediaW": 768,
                        "generationMediaH": 1024,
                        "images": [
                            {"url": "/media/stable.png", "natural_w": 768, "natural_h": 1024}
                        ],
                    },
                ],
            }
        )

        self.assertEqual(
            [node["id"] for node in outline["nodes"]],
            ["stable-generation-output"],
        )
        self.assertEqual(outline["nodes"][0]["generationMediaW"], 768.0)
        self.assertEqual(outline["nodes"][0]["generationMediaH"], 1024.0)

    def test_outline_keeps_multi_media_node_after_gallery_migration_version(self):
        outline = canvas_outline(
            {
                "id": "canvas-migrated-gallery",
                "migrationVersions": {"generationOutputGallerySplit": 1},
                "nodes": [
                    {
                        "id": "already-migrated-node",
                        "type": "smart-image",
                        "generationOutputNode": True,
                        "images": [
                            {"url": "/media/a.png"},
                            {"url": "/media/b.png"},
                        ],
                    }
                ],
            }
        )

        self.assertEqual(
            [node["id"] for node in outline["nodes"]],
            ["already-migrated-node"],
        )

    def test_outline_normalizes_invalid_coordinates_and_preserves_size_inputs(self):
        outline = canvas_outline(
            {
                "id": "canvas-b",
                "revision": -3,
                "nodes": [
                    {
                        "id": "node-b",
                        "x": math.inf,
                        "y": "bad",
                        "w": -10,
                        "h": 100_000,
                    }
                ],
            }
        )

        self.assertEqual(outline["revision"], 0)
        self.assertEqual(
            outline["nodes"][0],
            {
                "id": "node-b",
                "type": "smart-image",
                "x": 0.0,
                "y": 0.0,
                "w": -10.0,
                "h": 100000.0,
                "images": [],
            },
        )

    def test_stream_yields_outline_before_complete_snapshot(self):
        canvas = {
            "id": "canvas-c",
            "revision": 11,
            "nodes": [{"id": "node-c", "x": 1, "y": 2}],
            "connections": [],
        }

        async def collect():
            return [chunk async for chunk in stream_canvas_opening(canvas)]

        chunks = asyncio.run(collect())
        events = [json.loads(chunk) for chunk in chunks]

        self.assertEqual([event["type"] for event in events], [
            "canvas_outline",
            "canvas_document",
        ])
        self.assertEqual(events[0]["canvas_id"], canvas["id"])
        self.assertEqual(events[0]["revision"], canvas["revision"])
        self.assertEqual(events[1]["canvas"], canvas)

    def test_opening_module_is_in_application_update_manifest(self):
        self.assertIn(
            "backend/infinite_canvas/canvas_opening.py",
            APPLICATION_UPDATE_RUNTIME_FILES,
        )


if __name__ == "__main__":
    unittest.main()
