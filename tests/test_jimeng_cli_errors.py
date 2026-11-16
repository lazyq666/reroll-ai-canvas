import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import cli_impl, http_impl
from infinite_canvas.generation_runs import ProviderGenerationExecutor
from tests.test_model_capabilities import catalog


DENIED = '当前账号没有 dreamina_cli 使用权限: current account is not allowed to use dreamina_cli'


class JimengCliErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_high_quality_reaches_real_cli_command_builder(self):
        provider = {"id": "jimeng", "protocol": "jimeng", "image_models": ["5.0Pro"]}
        runtime = replace(main._PROVIDER_RUNTIME, provider_lookup=lambda _: provider)
        registry = catalog()
        run_cli = mock.AsyncMock(return_value={"data": {"status": "success"}})
        with (
            mock.patch.object(main, "MODEL_CAPABILITY_CATALOG", registry),
            mock.patch.object(main, "load_api_providers", return_value=[provider]),
            mock.patch.object(cli_impl, "run_jimeng_cli", run_cli),
            mock.patch.object(cli_impl, "jimeng_prepare_local_media", mock.AsyncMock(return_value=("/tmp/reference.png", []))),
            mock.patch.object(cli_impl, "jimeng_store_outputs", mock.AsyncMock(return_value=["/assets/generated.png"])),
        ):
            request = main._compile_flat_image_run(
                main.OnlineImageRequest(
                    prompt="Turn the subject into a 3D avatar", size="1536x2048",
                    quality="high", provider_id="jimeng", model="5.0Pro",
                    reference_images=[{"url": "/assets/reference.png"}],
                    target_aspect_ratio="3:4", resolution_tier="2K",
                    catalog_revision=registry.revision,
                ),
                provider=provider,
            )
            self.assertEqual("high", request.settings["quality"])
            self.assertEqual("image.edit", request.settings["operation"])
            await ProviderGenerationExecutor(runtime).execute(request)
        run_cli.assert_awaited_once()
        args = run_cli.call_args.args[0]
        self.assertEqual("image2image", args[0])
        self.assertIn("--model_version=5.0Pro", args)
        self.assertIn("--ratio=3:4", args)
        self.assertIn("--resolution_type=2k", args)
        self.assertIn("--images=/tmp/reference.png", args)
        self.assertFalse(any(argument.startswith("--quality") for argument in args))

    async def test_two_reference_generation_preserves_permission_denial_without_polling(self):
        proc = SimpleNamespace(
            returncode=1,
            communicate=mock.AsyncMock(return_value=(b'', DENIED.encode())),
        )
        remote = mock.Mock()
        with (
            mock.patch.object(http_impl, 'jimeng_cli_executable', return_value='/test/dreamina'),
            mock.patch.object(http_impl, 'jimeng_command', side_effect=lambda args, exe: [exe, *args]),
            mock.patch.object(http_impl.asyncio, 'create_subprocess_exec', new=mock.AsyncMock(return_value=proc)) as spawn,
            mock.patch.object(cli_impl, 'jimeng_prepare_local_media', new=mock.AsyncMock(side_effect=[('/tmp/ref1.png', []), ('/tmp/ref2.png', [])])),
        ):
            with self.assertRaises(HTTPException) as raised:
                await cli_impl.generate_jimeng_provider_image(
                    'draw a cat', '2048x2048', '5.0Pro',
                    [{'url':'data:image/png;base64,ref1'}, {'url':'data:image/png;base64,ref2'}],
                    {'id':'jimeng', 'protocol':'jimeng'}, on_remote=remote,
                )

        self.assertEqual(403, raised.exception.status_code)
        self.assertIn(DENIED, raised.exception.detail)
        remote.assert_not_called()
        spawn.assert_awaited_once()
        args = spawn.call_args.args
        self.assertEqual(('/test/dreamina', 'image2image'), args[:2])
        self.assertIn('--images=/tmp/ref1.png,/tmp/ref2.png', args)
        self.assertIn('--model_version=5.0Pro', args)
        self.assertIn('--resolution_type=2k', args)
        self.assertIn('--ratio=1:1', args)
        self.assertIn('--poll=0', args)

    async def test_unknown_cli_failure_remains_bad_gateway(self):
        proc = SimpleNamespace(
            returncode=1,
            communicate=mock.AsyncMock(return_value=(b'', b'unknown upstream failure')),
        )
        with (
            mock.patch.object(http_impl, 'jimeng_cli_executable', return_value='/test/dreamina'),
            mock.patch.object(http_impl, 'jimeng_command', side_effect=lambda args, exe: [exe, *args]),
            mock.patch.object(http_impl.asyncio, 'create_subprocess_exec', new=mock.AsyncMock(return_value=proc)),
        ):
            with self.assertRaises(HTTPException) as raised:
                await http_impl.run_jimeng_cli(['image2image'])
        self.assertEqual(502, raised.exception.status_code)


if __name__ == '__main__':
    unittest.main()
