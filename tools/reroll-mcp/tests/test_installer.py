import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import tomlkit

spec = importlib.util.spec_from_file_location('reroll_install', Path(__file__).resolve().parents[1] / 'installer/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_codex_preserves_unrelated_settings_comments_and_same_server_credentials(self):
        original = b'''# personal settings\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.reroll]\ncommand = "old"\nargs = ["old.py"]\nenabled = false\n[mcp_servers.reroll.env]\nREROLL_URL = "http://localhost:3000"\nREROLL_AGENT_TOKEN = "fixture-secret"\nREROLL_ALLOWED_DIRS = '["/Pictures"]'\n'''
        updated = installer.merge_config(original, 'codex', Path('/new path/reroll-mcp'), 'http://localhost:3000')
        doc = tomlkit.parse(updated.decode())
        self.assertIn(b'# personal settings', updated)
        self.assertEqual(doc['model'], 'example')
        self.assertEqual(doc['mcp_servers']['other']['command'], 'other')
        entry = doc['mcp_servers']['reroll']
        self.assertEqual(entry['command'], '/new path/reroll-mcp')
        self.assertNotIn('args', entry)
        self.assertFalse(entry['enabled'])
        self.assertEqual(entry['env']['REROLL_AGENT_TOKEN'], 'fixture-secret')
        self.assertEqual(entry['env']['REROLL_ALLOWED_DIRS'], '["/Pictures"]')
        self.assertEqual(installer.merge_config(updated,'codex',Path('/new path/reroll-mcp'),'http://localhost:3000'),updated)
        switched = tomlkit.parse(installer.merge_config(updated,'codex',Path('/new path/reroll-mcp'),'http://192.168.1.3:3000').decode())
        self.assertNotIn('REROLL_AGENT_TOKEN', switched['mcp_servers']['reroll']['env'])
        self.assertEqual(switched['mcp_servers']['reroll']['env']['REROLL_ALLOWED_DIRS'], '[]')

    def test_claude_preserves_projects_and_other_mcp_entries(self):
        original = json.dumps({'mcpServers':{'other':{'command':'hello'}},'projects':{'/work':{'allowedTools':['test']}},'theme':'dark'}).encode()
        for client in ('claude-code','claude-desktop'):
            result = json.loads(installer.merge_config(original,client,Path('/program/reroll-mcp'),'http://localhost'))
            self.assertEqual(result['projects'],json.loads(original)['projects'])
            self.assertEqual(result['mcpServers']['other'],{'command':'hello'})
            self.assertEqual(result['theme'],'dark')
            self.assertNotIn('REROLL_AGENT_TOKEN',result['mcpServers']['reroll']['env'])
            if client=='claude-code':
                self.assertEqual(result['mcpServers']['reroll']['type'],'stdio')

    def test_config_paths_and_overrides(self):
        home=Path('/home/test')
        self.assertEqual(installer.config_path('codex',home,'macos',{}),home/'.codex/config.toml')
        self.assertEqual(installer.config_path('codex',home,'macos',{'CODEX_HOME':'/custom'}),Path('/custom/config.toml'))
        self.assertEqual(installer.config_path('claude-code',home,'windows',{}),home/'.claude.json')
        self.assertEqual(installer.config_path('claude-code',home,'macos',{'CLAUDE_CONFIG_DIR':'/custom'}),Path('/custom/.claude.json'))
        self.assertEqual(installer.config_path('claude-desktop',home,'windows',{'APPDATA':'/roaming'}),Path('/roaming/Claude/claude_desktop_config.json'))
        self.assertEqual(installer.config_path('claude-desktop',home,'macos',{}),home/'Library/Application Support/Claude/claude_desktop_config.json')

    def test_malformed_config_backup_and_concurrent_edit(self):
        for client, data in [('codex', b'[oops'),('codex', b'mcp_servers = 3'),('claude-code', b'{'),('claude-desktop', b'[]')]:
            with self.assertRaises(installer.InstallError):
                installer.merge_config(data,client,Path('/run'),'http://localhost')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'config.toml'
            path.write_bytes(b'original')
            backup=installer.write_config(path,b'original',b'updated')
            self.assertEqual(backup.read_bytes(),b'original')
            self.assertEqual(backup.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertIsNone(installer.write_config(path,b'updated',b'updated'))
            with self.assertRaisesRegex(installer.InstallError,'configChanged'):
                installer.write_config(path,b'original',b'overwrite')
            self.assertEqual(path.read_bytes(),b'updated')
            link=Path(directory)/'link';link.symlink_to(path)
            with self.assertRaises(installer.InstallError): installer.read_config(link)
            with patch.object(installer.os,'replace',side_effect=OSError('fixture')):
                with self.assertRaises(OSError): installer.write_config(path,b'updated',b'failed')
            self.assertEqual(path.read_bytes(),b'updated')

    def test_parallel_installer_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            with installer.installation_lock(Path(directory)):
                with self.assertRaisesRegex(installer.InstallError,'busy'):
                    with installer.installation_lock(Path(directory)): pass
