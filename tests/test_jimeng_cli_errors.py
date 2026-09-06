import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main
from infinite_canvas.providers import cli_impl, http_impl


DENIED = '当前账号没有 dreamina_cli 使用权限: current account is not allowed to use dreamina_cli'


class JimengCliErrorTests(unittest.IsolatedAsyncioTestCase):
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
