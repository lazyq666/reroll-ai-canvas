import base64
import json
from io import BytesIO
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()
import main
from infinite_canvas.generation_runs import (
    GenerationEffectPorts, GenerationRuns, ImageRun, Inline,
    ProviderGenerationExecutor, WorkspaceGenerationEffects,
)
from infinite_canvas.providers.core import Completed
from infinite_canvas.providers.runtime import ProviderOutput
from infinite_canvas.image_formats import validate_image_format
from infinite_canvas.model_capability_matrix import ModelCapabilityMatrix
from tests.test_model_capabilities import catalog
from infinite_canvas.model_capability_workbench import ModelCapabilityWorkbench
from infinite_canvas.providers import http_impl
from PIL import Image


MODELS = [
    "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
    "gpt-image-2.6-flare", "gpt-image-2.6-sunburst",
]
QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"]


def published_catalog(path):
    registry = catalog(published_path=path)
    matrix = ModelCapabilityMatrix(
        inventory=lambda: {"image": [
            {"model": model, "provider_id": "apimart"} for model in MODELS
        ]},
        catalog=registry, workbench=ModelCapabilityWorkbench(path),
    )
    for model in MODELS:
        matrix.apply(model_id=model, actor_id="test-admin", operations=[
            {
                "operation": operation, "confirmed": True,
                "inputs": {"text": 1, "image": 16 if operation == "image.edit" else 0},
                "resolutions": ["1K", "2K", "4K"], "aspect_ratios": ["1:1", "16:9"],
                "output_count_maximum": 4, "options": ["custom_resolution", "transparent_png"],
                "qualities": QUALITIES,
                "formats": ["png", "jpeg", "webp", "gif", "svg"] if "2.6" in model else [],
                "svg_model": "test-text-model",
            }
            for operation in ["image.generate", "image.edit"]
        ])
    return registry, matrix


class ApimartImageRequestTests(unittest.IsolatedAsyncioTestCase):
    async def capture(self, registry, model, quality, refs=False, **changes):
        provider = dict(
            id="apimart", name="APIMart", protocol="apimart",
            base_url="https://api.apimart.ai", image_models=MODELS,
            chat_models=["test-text-model"],
        )
        sent = []

        async def post(url, **kwargs):
            sent.append(kwargs["json"])
            return httpx.Response(200, request=httpx.Request("POST", url), json={
                "data": [{"b64_json": base64.b64encode(b"fixture").decode()}],
            })

        async def start(request, **kwargs):
            result = await ProviderGenerationExecutor(main._PROVIDER_RUNTIME).execute(request)
            return SimpleNamespace(status="succeeded", result=result)

        manager = AsyncMock()
        manager.__aenter__.return_value = SimpleNamespace(post=post)
        payload = main.OnlineImageRequest(**{
            "prompt": "a waving character", "provider_id": "apimart",
            "model": model, "quality": quality, "size": "1024x1024",
            "target_aspect_ratio": "1:1", "resolution_tier": "1K",
            "catalog_revision": registry.revision,
            "reference_images": [{"url": "/assets/input/reference.png", "kind": "image"}] if refs else [],
            **changes,
        })
        reference = BytesIO()
        Image.new("RGB", (32,32), "red").save(reference, format="PNG")
        with (
            patch.object(main, "MODEL_CAPABILITY_CATALOG", registry),
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "load_api_providers", return_value=[provider]),
            patch.object(main, "provider_env_key_value", return_value="fixture-key"),
            patch.object(main, "reference_to_data_url", return_value="data:image/png;base64," + base64.b64encode(reference.getvalue()).decode()),
            patch.object(main, "_generation_target", return_value=("", None, None)),
            patch.object(main, "_GENERATION_RUNS", SimpleNamespace(start=start)),
            patch.object(httpx, "AsyncClient", return_value=manager),
        ):
            await main.online_image(payload)
        self.assertEqual(1, len(sent))
        return sent[0]

    async def test_explicit_quality_reaches_apimart_for_generation_and_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            registry, _ = published_catalog(Path(directory) / "catalog.json")
            for model in MODELS:
                for quality in QUALITIES:
                    for refs in [False, True]:
                        with self.subTest(model=model, quality=quality, refs=refs):
                            body = await self.capture(registry, model, quality, refs)
                            self.assertEqual(quality, body.get("quality"))
                            self.assertEqual(refs, bool(body.get("image_urls")))

    async def test_gif_parameters_and_sheet_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            registry, _ = published_catalog(Path(directory) / "catalog.json")
            for model in MODELS[2:]:
                body = await self.capture(
                    registry, model, "low", True, output_format="gif",
                    size="512x512", target_aspect_ratio="", resolution_tier="",
                    frame_count=16, frame_duration_ms=200,
                )
                self.assertEqual("gif", body.get("output_format"))
                self.assertEqual("512x512", body["size"])
                self.assertEqual(16, body["frame_count"])
                self.assertNotIn("resolution", body)
            for size, frames in [("512x512", 1), ("512x512", 17), ("768x768", 13), ("1024x1024", 2)]:
                with self.subTest(size=size, frames=frames), self.assertRaises(HTTPException):
                    await self.capture(
                        registry, MODELS[2], "low", output_format="gif", size=size,
                        target_aspect_ratio="", resolution_tier="", frame_count=frames,
                    )

    async def test_svg_uses_configured_text_model_and_rejects_conflicts(self):
        with tempfile.TemporaryDirectory() as directory:
            registry, _ = published_catalog(Path(directory) / "catalog.json")
            body = await self.capture(registry, MODELS[2], "high", output_format="svg")
            self.assertEqual({"model": "test-text-model"}, body.get("svg"))
            self.assertNotIn("background", body)
            for changes in [
                {"n": 2}, {"refs": True}, {"transparent_png": True},
                {"frame_count": 2}, {"output_compression": 80},
                {"svg": {"model": "another-provider-model"}},
            ]:
                with self.subTest(changes=changes), self.assertRaises(HTTPException):
                    await self.capture(registry, MODELS[2], "high", output_format="svg", **changes)

    def test_extended_values_require_publication_and_exact_identity(self):
        registry = catalog()
        for provider, model in [
            ("apimart", MODELS[0]), ("other", MODELS[0]),
            ("apimart", "gpt-image-2.5-ext"),
        ]:
            capability = registry.resolve(provider, model, "image.generate")
            result = registry.validate(capability, input_counts={"text": 1},
                parameters={"quality": "max", "output_format": "gif"}, catalog_revision=registry.revision)
            self.assertFalse(result["valid"])

    def test_published_formats_roundtrip_keeps_svg_generate_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            registry, matrix = published_catalog(path)
            refreshed = catalog(published_path=path)
            for model in MODELS[2:]:
                generate = refreshed.resolve("apimart", model, "image.generate")
                edit = refreshed.resolve("apimart", model, "image.edit")
                self.assertIn("svg", generate["parameters"]["output_format"]["values"])
                self.assertNotIn("svg", edit["parameters"]["output_format"]["values"])
                self.assertEqual(QUALITIES, edit["parameters"]["quality"]["values"])
                self.assertEqual(registry.revision, refreshed.revision)

    def test_every_gif_layout_and_inactive_parameter_boundary(self):
        capability = {"parameters": {"output_format": {"default": "png"}}}
        for frames in range(2, 17):
            self.assertEqual([], validate_image_format(capability, {"output_format": "gif", "frame_count": frames}))
        for size in ("1024x256", "256x1024"):
            self.assertEqual([], validate_image_format(capability, {"output_format": "gif", "frame_count": 2, "frame_size": size}))
        for params in (
            {"frame_count": 9}, {"output_format": "gif", "count": 5},
            {"output_format": "gif", "frame_duration_ms": 21},
            {"output_format": "gif", "frame_size": "512x64"},
            {"output_format": "gif", "output_compression": 80},
        ):
            self.assertTrue(validate_image_format(capability, params), params)

    async def test_download_failure_restart_reuses_paid_output(self):
        for output_format in ("gif", "svg"):
            with self.subTest(output_format=output_format), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                remote_url = f"https://provider.test/paid.{output_format}"
                executor = SimpleNamespace(execute=AsyncMock(return_value=Completed(ProviderOutput(
                    media=(remote_url,), remote_refs=("paid-task-135",),
                    raw={"urls":[remote_url]}, legacy={"urls":[remote_url]},
                ))))
                save = AsyncMock(side_effect=OSError("download interrupted"))
                def effects():
                    return WorkspaceGenerationEffects(GenerationEffectPorts(
                        history_path=lambda: root / "history.json", journal_path=lambda: root / "effects.json",
                        history_lock=__import__("threading").RLock(), save_image=save,
                        image_meta=lambda url, source: {"url":url,"source":source},
                        extract_images=lambda raw: raw.get("urls", []), notify=AsyncMock(),
                    ))
                runs = GenerationRuns(executor=executor, effects=effects(), store_path=lambda: root / "runs.json")
                with self.assertRaises(OSError):
                    await runs.start(ImageRun(prompt="one paid request",settings={
                        "provider_id":"apimart","model":MODELS[2],"quality":"max","output_format":output_format,
                    },publication="online-image"),key="same-operation",owner="designer",delivery=Inline())
                stored = json.loads((root / "runs.json").read_text())["runs"][0]
                self.assertEqual("provider_completed", stored["phase"])
                self.assertEqual(["paid-task-135"], stored["remote_refs"])
                save.side_effect = None
                save.return_value = f"/assets/output/paid.{output_format}"
                restarted = GenerationRuns(executor=executor,effects=effects(),store_path=lambda: root / "runs.json")
                result = await restarted.resume(stored["id"],owner="designer")
                self.assertEqual("succeeded",result.status)
                self.assertEqual([save.return_value],result.result["images"])
                self.assertEqual(1,executor.execute.await_count)
                self.assertEqual([remote_url,remote_url],[call.args[0]["value"] for call in save.call_args_list])
                self.assertEqual(output_format,save.call_args.kwargs["expected_format"])


class ImageOriginalTests(unittest.IsolatedAsyncioTestCase):
    def test_managed_import_sniffs_svg_and_rejects_disguised_active_content(self):
        from infinite_canvas.media import WorkspaceMediaService
        from infinite_canvas.workspace import WorkspaceStorageError
        valid = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48"><path d="M0 0L20 30"/></svg>'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media = WorkspaceMediaService(SimpleNamespace(imported_media=root))
            result = media.import_bytes(valid,name="disguised.png",content_type="image/png")
            self.assertTrue(result.url.endswith(".svg"))
            self.assertTrue(result.name.endswith(".svg"))
            self.assertEqual(valid,(root / Path(result.url).name).read_bytes())
            with self.assertRaises(WorkspaceStorageError):
                media.import_bytes(b'<svg viewBox="0 0 10 10"><script/></svg>',name="unsafe.png",content_type="image/png")
            self.assertEqual(1,len(list(root.iterdir())))

    async def save(self, content, directory, **options):
        with (
            http_impl.bind_ports(main._PROVIDER_PORTS.http_impl),
            patch.object(main, "output_path_for", side_effect=lambda name, *_: str(Path(directory) / name)),
            patch.object(main, "output_url_for", side_effect=lambda name, *_: "/assets/" + name),
        ):
            return await http_impl.save_ai_image_to_output(
                {"type": "b64", "value": base64.b64encode(content).decode(), "mime_type": "image/png"},
                stable_id="original", **options,
            )

    async def test_gif_original_and_metadata_survive_incorrect_mime(self):
        buffer = BytesIO()
        Image.new("RGB", (32, 32), "red").save(buffer, format="GIF",
            save_all=True, append_images=[Image.new("RGB", (32, 32), "blue")], duration=[100, 200], loop=0)
        content = buffer.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            url = await self.save(content, directory)
            self.assertTrue(url.endswith(".gif"))
            path = Path(directory) / Path(url).name
            self.assertEqual(content, path.read_bytes())
            with http_impl.bind_ports(main._PROVIDER_PORTS.http_impl), patch.object(main, "output_file_from_url", return_value=str(path)):
                meta = http_impl.image_output_meta(url)
            self.assertEqual("image/gif", meta["mime"])
            self.assertEqual([100, 200], meta["frame_durations_ms"])
            self.assertEqual(0, meta["loop"])

    async def test_svg_original_is_validated_before_publication(self):
        valid = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0L100 100"/></svg>'
        with tempfile.TemporaryDirectory() as directory:
            url = await self.save(valid, directory)
            self.assertTrue(url.endswith(".svg"))
            self.assertEqual(valid, (Path(directory) / Path(url).name).read_bytes())
        for body in [
            b'<script>alert(1)</script>', b'<image href="data:image/png;base64,AA=="/>',
            b'<path onload="alert(1)"/>', b'<use href="https://evil.invalid/payload.svg#x"/>',
            b'<foreignObject/>', b'<style>@import "https://evil.invalid/x.css";</style>',
            b'<path fill="url(https://evil.invalid/paint)"/>',
            b'<path fill="url(&#10;//evil.invalid/paint&#10;)"/>',
            b'<path fill="url(//evil.invalid/paint"/>',
        ]:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    await self.save(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' + body + b"</svg>", directory)
                self.assertEqual([], list(Path(directory).iterdir()))

    async def test_unexpected_media_does_not_publish(self):
        content = BytesIO()
        Image.new("RGB",(32,32),"red").save(content,format="PNG")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                await self.save(content.getvalue(), directory, expected_format="gif")
            self.assertEqual([],list(Path(directory).iterdir()))

    def test_gif_inputs_reject_animated_webp_and_apng_data_urls(self):
        for image_format in ("WEBP", "PNG", "GIF"):
            stream = BytesIO()
            Image.new("RGB",(32,32),"red").save(stream,format=image_format,save_all=True,
                append_images=[Image.new("RGB",(32,32),"blue")],duration=100,loop=0)
            data_url = "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()
            with http_impl.bind_ports(main._PROVIDER_PORTS.http_impl), patch.object(main,"reference_to_data_url",return_value=data_url):
                with self.subTest(image_format=image_format), self.assertRaises(HTTPException):
                    http_impl.static_animation_reference({"url":data_url})
