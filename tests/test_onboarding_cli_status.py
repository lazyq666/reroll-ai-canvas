import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from infinite_canvas.providers import cli_impl

class Process:
    def __init__(self,out=b'',err=b'',code=0,timeout=False):
        self.communicate=AsyncMock(side_effect=asyncio.TimeoutError if timeout else None,return_value=(out,err))
        self.returncode=code;self.killed=False
    def kill(self):self.killed=True
    async def wait(self):return self.returncode

class OnboardingCliStatusTests(unittest.TestCase):
    def codex(self,login):
        create=AsyncMock(side_effect=[Process(out=b'codex 1.0'),login])
        with patch.object(cli_impl,'_ports',SimpleNamespace(BASE_DIR='/tmp')),patch.object(cli_impl,'codex_cli_executable',return_value='/bin/codex'),patch.object(cli_impl,'gpt_image_2_skill_executable',return_value=''),patch.object(cli_impl.asyncio,'create_subprocess_exec',create):
            return asyncio.run(cli_impl.codex_status()),create

    def test_codex_login_is_verified_and_account_output_is_not_returned(self):
        result,create=self.codex(Process(err=b'Logged in using ChatGPT private-account@example.com'))
        self.assertTrue(result['logged_in']);self.assertNotIn('private-account',str(result))
        self.assertEqual(('/bin/codex','login','status'),create.await_args.args)

    def test_negative_and_unknown_are_not_treated_as_signed_in(self):
        for process,expected in [(Process(err=b'Not logged in'),False),(Process(err=b'unknown subcommand',code=1),None)]:
            self.assertIs(expected,self.codex(process)[0]['logged_in'])
        timed=Process(timeout=True)
        self.assertIsNone(self.codex(timed)[0]['logged_in']);self.assertTrue(timed.killed)

    def test_antigravity_uses_read_only_quota_report_without_model_generation(self):
        for output,expected in [(b'Model quota remaining: 80%',True),(b'authentication required',False),(b'unknown command',None)]:
            create=AsyncMock(side_effect=[Process(out=b'agy 1.2'),Process(out=output)])
            with patch.object(cli_impl,'_ports',SimpleNamespace(BASE_DIR='/tmp')),patch.object(cli_impl,'gemini_cli_executable',return_value='/bin/agy'),patch.object(cli_impl,'is_antigravity_cli',return_value=True),patch.object(cli_impl.asyncio,'create_subprocess_exec',create):
                result=asyncio.run(cli_impl.gemini_cli_status())
            self.assertIs(expected,result['logged_in'])
            self.assertEqual(('/bin/agy','--print','/usage'),create.await_args.args)
            self.assertNotIn('remaining',str(result))

if __name__=='__main__':unittest.main()
