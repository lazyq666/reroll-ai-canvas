import importlib
import os
import struct
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from infinite_canvas.layered_psd import (
    LayeredPsdError,
    build_layer_decomposition_psd,
)
from tests.runtime_env import configure_test_workspace, unload_main


def _u16(data: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from(">H", data, offset)[0], offset + 2


def _i16(data: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from(">h", data, offset)[0], offset + 2


def _u32(data: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from(">I", data, offset)[0], offset + 4


def _i32(data: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from(">i", data, offset)[0], offset + 4


def _parse_layer_records(data: bytes) -> tuple[dict, list[dict]]:
    if data[:4] != b"8BPS":
        raise AssertionError("not a PSD")
    version = struct.unpack_from(">H", data, 4)[0]
    channels = struct.unpack_from(">H", data, 12)[0]
    height, width = struct.unpack_from(">II", data, 14)
    depth, color_mode = struct.unpack_from(">HH", data, 22)
    offset = 26
    for _ in range(2):
        section_length, offset = _u32(data, offset)
        offset += section_length
    layer_and_mask_length, offset = _u32(data, offset)
    layer_and_mask_end = offset + layer_and_mask_length
    layer_info_length, offset = _u32(data, offset)
    layer_info_end = offset + layer_info_length
    layer_count, offset = _i16(data, offset)
    records = []
    for _ in range(abs(layer_count)):
        top, offset = _i32(data, offset)
        left, offset = _i32(data, offset)
        bottom, offset = _i32(data, offset)
        right, offset = _i32(data, offset)
        channel_count, offset = _u16(data, offset)
        channel_info = []
        for _ in range(channel_count):
            channel_id, offset = _i16(data, offset)
            channel_length, offset = _u32(data, offset)
            channel_info.append((channel_id, channel_length))
        self_signature = data[offset : offset + 4]
        blend_key = data[offset + 4 : offset + 8]
        opacity, clipping, flags, filler = data[offset + 8 : offset + 12]
        offset += 12
        extra_length, offset = _u32(data, offset)
        extra_end = offset + extra_length
        mask_length, offset = _u32(data, offset)
        offset += mask_length
        ranges_length, offset = _u32(data, offset)
        offset += ranges_length
        pascal_length = data[offset]
        offset += 1
        legacy_name = data[offset : offset + pascal_length].decode(
            "macroman", errors="replace"
        )
        offset += pascal_length
        offset += (4 - (1 + pascal_length) % 4) % 4
        unicode_name = ""
        while offset + 12 <= extra_end:
            signature = data[offset : offset + 4]
            key = data[offset + 4 : offset + 8]
            block_length = struct.unpack_from(">I", data, offset + 8)[0]
            offset += 12
            block = data[offset : offset + block_length]
            offset += block_length + block_length % 2
            if signature == b"8BIM" and key == b"luni":
                unit_count = struct.unpack_from(">I", block, 0)[0]
                unicode_name = block[4 : 4 + unit_count * 2].decode("utf-16-be")
        offset = extra_end
        records.append(
            {
                "bounds": (left, top, right, bottom),
                "channels": channel_info,
                "signature": self_signature,
                "blend_key": blend_key,
                "opacity": opacity,
                "clipping": clipping,
                "flags": flags,
                "filler": filler,
                "name": unicode_name or legacy_name,
            }
        )
    if offset > layer_info_end or layer_info_end > layer_and_mask_end:
        raise AssertionError("invalid layer section lengths")
    for record in records:
        record["channel_data"] = []
        for _channel_id, length in record["channels"]:
            record["channel_data"].append(data[offset:offset + length])
            offset += length
    return {
        "version": version,
        "channels": channels,
        "width": width,
        "height": height,
        "depth": depth,
        "color_mode": color_mode,
        }, records


class LayeredPsdContractTests(unittest.TestCase):
    def test_export_preserves_pixels_across_literal_packet_boundary(self):
        # A neutral textured strip followed by a flat background. A two-byte
        # repeat straddles the 128-byte literal limit on alternating rows.
        width, height = 832, 12
        source = Image.new("RGBA", (width, height), (245, 245, 245, 255))
        for y in range(1, height, 2):
            row = bytes(range(127)) + bytes([170, 170]) + bytes([245]) * (width - 129)
            for x, value in enumerate(row):
                source.putpixel((x, y), (value, value, value, 255))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "base.png"
            url = self._save(path, source)
            canvas = {"nodes": [{
                "id": "boundary", "type": "smart-layer-decomposition",
                "layerDecompositionManifest": {
                    "manifest_version": 1, "canvas_width": width, "canvas_height": height,
                },
                "layerDecompositionItems": [{
                    "role": "base", "absolute_bbox": [0, 0, width, height],
                    "media": {"url": url},
                }],
            }]}
            result = build_layer_decomposition_psd(
                canvas, "boundary", resolve_media=lambda _url: path,
            )
        # Independently decode each editable layer channel, respecting row lengths.
        _, records = _parse_layer_records(result.content)
        for channel, data in zip(source.split(), records[0]["channel_data"]):
            self.assertEqual(1, struct.unpack_from(">H", data)[0])
            lengths = struct.unpack_from(f">{height}H", data, 2)
            offset = 2 + height * 2
            pixels = bytearray()
            for length in lengths:
                row = data[offset:offset + length]
                offset += length
                decoded_row = bytearray()
                index = 0
                while index < len(row):
                    control = row[index]
                    index += 1
                    if control < 128:
                        count = control + 1
                        self.assertLessEqual(index + count, len(row))
                        decoded_row.extend(row[index:index + count])
                        index += count
                    elif control > 128:
                        self.assertLess(index, len(row))
                        decoded_row.extend(row[index:index + 1] * (257 - control))
                        index += 1
                self.assertEqual(width, len(decoded_row), "PSD channel scanline corrupted")
                pixels.extend(decoded_row)
            self.assertEqual(channel.tobytes(), bytes(pixels))
        # Pillow independently decodes the public export's merged image.
        with Image.open(BytesIO(result.content)) as decoded:
            actual = decoded.convert("RGB")
        mismatches = sum(a != b for a, b in zip(actual.tobytes(), source.convert("RGB").tobytes()))
        self.assertEqual(0, mismatches, "PSD introduced horizontal pixel corruption")

    @staticmethod
    def _save(path: Path, image: Image.Image) -> str:
        image.save(path, format="PNG")
        return f"/assets/output/{path.name}"

    def test_current_node_state_becomes_editable_psd_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base_url = self._save(
                root / "base.png",
                Image.new("RGBA", (4, 3), (20, 40, 200, 255)),
            )
            lower = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
            lower.putpixel((0, 0), (220, 20, 30, 128))
            lower.putpixel((1, 1), (220, 20, 30, 255))
            lower_url = self._save(root / "lower.png", lower)
            hidden_url = self._save(
                root / "hidden.png",
                Image.new("RGBA", (1, 1), (10, 240, 20, 255)),
            )
            deleted_url = self._save(
                root / "deleted.png",
                Image.new("RGBA", (1, 1), (255, 255, 0, 255)),
            )
            paths = {
                base_url: root / "base.png",
                lower_url: root / "lower.png",
                hidden_url: root / "hidden.png",
                deleted_url: root / "deleted.png",
            }
            canvas = {
                "id": "canvas-36",
                "nodes": [
                    {
                        "id": "layers-36",
                        "type": "smart-layer-decomposition",
                        "title": "海报 / 最终版",
                        "layerDecompositionManifest": {
                            "manifest_version": 1,
                            "canvas_width": 4,
                            "canvas_height": 3,
                            "base_output_media_id": base_url,
                            "layers": [
                                {"output_media_id": lower_url},
                                {"output_media_id": hidden_url},
                                # Deleting a layer edits the node, not the immutable manifest.
                                {"output_media_id": deleted_url},
                            ],
                        },
                        "layerDecompositionItems": [
                            {
                                "id": "base",
                                "role": "base",
                                "z_index": -1,
                                "absolute_bbox": [0, 0, 4, 3],
                                "hidden": False,
                                "media": {"url": base_url, "name": "合成底图"},
                            },
                            {
                                "id": "subject",
                                "role": "layer",
                                "z_index": 2,
                                "absolute_bbox": [1, 1, 3, 3],
                                "hidden": False,
                                "media": {"url": lower_url, "name": "人物（前景）"},
                            },
                            {
                                "id": "title",
                                "role": "layer",
                                "z_index": 8,
                                "absolute_bbox": [0, 0, 2, 1],
                                "hidden": True,
                                "media": {"url": hidden_url, "name": "Title ✨"},
                            },
                        ],
                    }
                ],
            }

            result = build_layer_decomposition_psd(
                canvas,
                "layers-36",
                resolve_media=lambda url: paths.get(url),
            )

        header, records = _parse_layer_records(result.content)
        self.assertEqual(
            {
                "version": 1,
                "channels": 4,
                "width": 4,
                "height": 3,
                "depth": 8,
                "color_mode": 3,
            },
            header,
        )
        # PSD records are topmost first; the deleted manifest-only layer is absent.
        self.assertEqual(["Title ✨", "人物（前景）", "合成底图"], [r["name"] for r in records])
        self.assertEqual([(0, 0, 2, 1), (1, 1, 3, 3), (0, 0, 4, 3)], [r["bounds"] for r in records])
        self.assertEqual([True, False, False], [bool(r["flags"] & 0x02) for r in records])
        self.assertTrue(all([channel[0] for channel in record["channels"]] == [0, 1, 2, -1] for record in records))
        self.assertEqual("海报-最终版.psd", result.filename)
        with Image.open(BytesIO(result.content)) as composite:
            self.assertEqual((4, 3), composite.size)
            flattened = composite.convert("RGBA")
            # Hidden green is not composited. The half-alpha red blends over blue.
            self.assertEqual((120, 30, 115, 255), flattened.getpixel((1, 1)))
            self.assertEqual((220, 20, 30, 255), flattened.getpixel((2, 2)))

    def test_missing_managed_media_fails_before_returning_a_download(self):
        canvas = {
            "nodes": [
                {
                    "id": "layers-36",
                    "type": "smart-layer-decomposition",
                    "layerDecompositionManifest": {
                        "manifest_version": 1,
                        "canvas_width": 4,
                        "canvas_height": 3,
                    },
                    "layerDecompositionItems": [
                        {
                            "role": "base",
                            "absolute_bbox": [0, 0, 4, 3],
                            "media": {"url": "/assets/output/missing.png"},
                        }
                    ],
                }
            ]
        }

        with self.assertRaisesRegex(LayeredPsdError, "media_unavailable"):
            build_layer_decomposition_psd(
                canvas,
                "layers-36",
                resolve_media=lambda _url: None,
            )

    def test_storage_io_failure_becomes_a_stable_export_failure(self):
        canvas = {
            "nodes": [
                {
                    "id": "layers-36",
                    "type": "smart-layer-decomposition",
                    "title": "Layered",
                    "layerDecompositionManifest": {
                        "manifest_version": 1,
                        "canvas_width": 4,
                        "canvas_height": 3,
                    },
                    "layerDecompositionItems": [
                        {
                            "role": "base",
                            "z_index": -1,
                            "absolute_bbox": [0, 0, 4, 3],
                            "media": {"url": "/assets/output/base.png"},
                        }
                    ],
                }
            ]
        }

        def failed_storage(_url):
            raise OSError("private workspace path")

        with self.assertRaisesRegex(LayeredPsdError, "export_failed"):
            build_layer_decomposition_psd(
                canvas,
                "layers-36",
                resolve_media=failed_storage,
            )

    def test_extreme_canvas_is_rejected_before_allocating_or_reading_media(self):
        canvas = {
            "nodes": [
                {
                    "id": "layers-36",
                    "type": "smart-layer-decomposition",
                    "layerDecompositionManifest": {
                        "manifest_version": 1,
                        "canvas_width": 30_000,
                        "canvas_height": 30_000,
                    },
                    "layerDecompositionItems": [
                        {
                            "role": "base",
                            "absolute_bbox": [0, 0, 30_000, 30_000],
                            "media": {"url": "/assets/output/base.png"},
                        }
                    ],
                }
            ]
        }
        resolved = []

        with self.assertRaisesRegex(LayeredPsdError, "node_invalid"):
            build_layer_decomposition_psd(
                canvas,
                "layers-36",
                resolve_media=lambda url: resolved.append(url),
            )
        self.assertEqual([], resolved)

    def test_legacy_smart_group_is_not_an_export_target(self):
        canvas = {
            "nodes": [
                {
                    "id": "legacy-layers",
                    "type": "smart-group",
                    "layerDecompositionManifest": {
                        "manifest_version": 1,
                        "canvas_width": 4,
                        "canvas_height": 3,
                    },
                    "items": ["legacy-base"],
                },
                {
                    "id": "legacy-base",
                    "type": "smart-image",
                    "images": [{"url": "/assets/output/base.png"}],
                    "layerDecomposition": {
                        "role": "base",
                        "z_index": 0,
                        "absolute_bbox": [0, 0, 4, 3],
                    },
                },
            ]
        }
        resolved = []

        with self.assertRaisesRegex(LayeredPsdError, "node_not_found"):
            build_layer_decomposition_psd(
                canvas,
                "legacy-layers",
                resolve_media=lambda url: resolved.append(url),
            )
        self.assertEqual([], resolved)


class LayeredPsdHttpContractTests(unittest.TestCase):
    @staticmethod
    def _login(client, username: str, password: str) -> None:
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        if response.status_code != 200:
            raise AssertionError(response.text)

    def test_export_rechecks_canvas_access_and_returns_only_a_complete_psd(self):
        from fastapi.testclient import TestClient

        previous_state = os.environ.get("INFINITE_CANVAS_STATE_DIR")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            state = root / "state"
            configure_test_workspace(workspace, state)
            os.environ["INFINITE_CANVAS_STATE_DIR"] = str(state)
            unload_main()
            try:
                main = importlib.import_module("main")
                for username, password, role in (
                    ("administrator", "admin-password", "admin"),
                    ("designer", "designer-password", "designer"),
                    ("visitor", "visitor-password", "guest"),
                ):
                    main.AUTH_SYSTEM.create_user(
                        username=username,
                        password=password,
                        role=role,
                    )
                output = workspace / "assets" / "output"
                output.mkdir(parents=True, exist_ok=True)
                base_path = output / "base.png"
                layer_path = output / "person.png"
                Image.new("RGBA", (3, 2), (30, 40, 50, 255)).save(base_path)
                Image.new("RGBA", (1, 1), (220, 20, 30, 180)).save(layer_path)
                base_url = "/assets/output/base.png"
                layer_url = "/assets/output/person.png"

                with TestClient(main.app) as designer:
                    self._login(designer, "designer", "designer-password")
                    created = designer.post(
                        "/api/canvases",
                        json={"title": "Issue 36", "kind": "smart"},
                    )
                    self.assertEqual(200, created.status_code, created.text)
                    canvas_id = created.json()["canvas"]["id"]
                    layer_node = {
                        "id": "layers-36",
                        "type": "smart-layer-decomposition",
                        "title": "角色分层",
                        "layerDecompositionManifest": {
                            "manifest_version": 1,
                            "canvas_width": 3,
                            "canvas_height": 2,
                        },
                        "layerDecompositionItems": [
                            {
                                "role": "base",
                                "z_index": -1,
                                "absolute_bbox": [0, 0, 3, 2],
                                "hidden": False,
                                "media": {"url": base_url, "name": "底图"},
                            },
                            {
                                "role": "layer",
                                "z_index": 1,
                                "absolute_bbox": [1, 0, 2, 1],
                                "hidden": False,
                                "media": {"url": layer_url, "name": "人物"},
                            },
                        ],
                    }
                    with designer.websocket_connect(
                        f"/ws/canvases/{canvas_id}?layout_gap=64&client_id=issue-36-fixture"
                    ) as socket:
                        snapshot = socket.receive_json()
                        self.assertEqual("canvas_snapshot", snapshot["type"])
                        socket.send_json(
                            {
                                "type": "canvas_mutation",
                                "canvas_id": canvas_id,
                                "operation": {
                                    "operation_id": "issue-36:create-layer-node",
                                    "base_revision": snapshot["revision"],
                                    "changes": {"node_creates": [layer_node]},
                                },
                            }
                        )
                        while True:
                            saved = socket.receive_json()
                            if saved.get("type") == "canvas_mutation":
                                break
                        self.assertEqual(1, saved["revision"])
                    exported = designer.post(
                        f"/api/canvases/{canvas_id}/layer-decompositions/layers-36/psd"
                    )
                    self.assertEqual(200, exported.status_code, exported.text)
                    self.assertEqual(
                        "image/vnd.adobe.photoshop",
                        exported.headers["content-type"],
                    )
                    self.assertIn("attachment", exported.headers["content-disposition"])
                    self.assertIn("%E8%A7%92%E8%89%B2%E5%88%86%E5%B1%82.psd", exported.headers["content-disposition"])
                    header, records = _parse_layer_records(exported.content)
                    self.assertEqual((3, 2), (header["width"], header["height"]))
                    self.assertEqual(["人物", "底图"], [record["name"] for record in records])

                with TestClient(main.app) as administrator:
                    self._login(administrator, "administrator", "admin-password")
                    exported = administrator.post(
                        f"/api/canvases/{canvas_id}/layer-decompositions/layers-36/psd"
                    )
                    self.assertEqual(200, exported.status_code, exported.text)

                with TestClient(main.app) as visitor:
                    self._login(visitor, "visitor", "visitor-password")
                    denied = visitor.post(
                        f"/api/canvases/{canvas_id}/layer-decompositions/layers-36/psd"
                    )
                    self.assertEqual(403, denied.status_code)

                with TestClient(main.app) as anonymous:
                    denied = anonymous.post(
                        f"/api/canvases/{canvas_id}/layer-decompositions/layers-36/psd"
                    )
                    self.assertEqual(401, denied.status_code)

                layer_path.unlink()
                with TestClient(main.app) as designer:
                    self._login(designer, "designer", "designer-password")
                    failed = designer.post(
                        f"/api/canvases/{canvas_id}/layer-decompositions/layers-36/psd"
                    )
                    self.assertEqual(409, failed.status_code)
                    self.assertEqual(
                        {"detail": {"code": "media_unavailable"}},
                        failed.json(),
                    )
                    self.assertTrue(failed.headers["content-type"].startswith("application/json"))
            finally:
                unload_main()
                if previous_state is None:
                    os.environ.pop("INFINITE_CANVAS_STATE_DIR", None)
                else:
                    os.environ["INFINITE_CANVAS_STATE_DIR"] = previous_state


if __name__ == "__main__":
    unittest.main()
