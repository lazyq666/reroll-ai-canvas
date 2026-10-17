import io
import json
import unittest
import zipfile
from infinite_canvas.agent_installer import build_bundle, catalog, PACKAGE_FILES
from infinite_canvas.auth_system import SESSION_COOKIE
from tests import test_agent_api


class BundleTests(unittest.TestCase):
    def test_all_clients_platforms_and_languages_are_portable_and_secret_free(self):
        for client in ('codex', 'claude-code', 'claude-desktop'):
            for platform in ('macos', 'windows'):
                for language in ('zh', 'en'):
                    with self.subTest(client=client, platform=platform, language=language):
                        archive = zipfile.ZipFile(io.BytesIO(build_bundle(dict(client=client, platform=platform, language=language, url='http://192.168.1.25:3000'))))
                        expected = {'Reroll-MCP/' + name for name in ['install.py', 'settings.json', 'messages.json', 'README.txt', *['mcp/' + name for name in PACKAGE_FILES], *(['Install.command'] if platform == 'macos' else ['Install.cmd', 'Install.ps1'])]}
                        self.assertEqual(set(archive.namelist()), expected)
                        settings = archive.read('Reroll-MCP/settings.json').decode()
                        self.assertNotIn('TOKEN', settings)
                        self.assertNotIn('/Users/', settings)
                        self.assertEqual(json.loads(settings)['url'], 'http://192.168.1.25:3000')
                        launcher = archive.read('Reroll-MCP/' + ('Install.command' if platform == 'macos' else 'Install.ps1'))
                        self.assertNotIn(b'@@', launcher)
                        self.assertIn(catalog(language)['agent.install.starting'].encode(), launcher)
                        if platform == 'macos':
                            self.assertTrue(archive.getinfo('Reroll-MCP/Install.command').external_attr >> 16 & 0o111)
                        else:
                            self.assertTrue(launcher.startswith(b'\xef\xbb\xbf'))

    def test_invalid_options_cannot_inject_scripts_or_package_paths(self):
        options = dict(client='codex', platform='macos', language='en', url='http://localhost:3000')
        for key, value in [('client','../../secret'),('platform','linux'),('language','fr'),('url','file:///etc/passwd'),('url','http://user:pass@localhost'),('url','http://localhost/$(touch foo)'),('url','http://localhost\nmalicious'),('url','http://localhost:bad')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                build_bundle({**options, key:value})


class DownloadTests(unittest.TestCase):
    setUp = test_agent_api.AgentApiTests.setUp

    def test_session_download_and_access_boundaries(self):
        path = '/api/account/agent-installer'
        options = dict(client='codex', platform='macos', language='zh', url='http://localhost:3000')
        self.assertEqual(self.client.post(path,json=options).status_code,401, 'Bearer does not replace browser session')
        self.client.headers.pop('Authorization', None)
        self.assertEqual(self.client.post(path,json=options).status_code,401)
        self.client.cookies.set(SESSION_COOKIE,self.auth.create_session(self.other['id']))
        response=self.client.post(path,json=options)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.headers['content-type'],'application/zip')
        self.assertNotIn(self.token['token'].encode(),response.content)
        self.assertEqual(self.client.post(path,json=options,headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.post(path,content=b'x'*4097).status_code,400)
        self.assertEqual(self.client.post(path,json=[]).status_code,400)
        guest=self.auth.create_user(username='guest',password='password-long',role='guest')
        self.client.cookies.set(SESSION_COOKIE,self.auth.create_session(guest['id']))
        self.assertEqual(self.client.post(path,json=options).status_code,403)
