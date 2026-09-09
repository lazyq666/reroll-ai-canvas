"""Guard the manifest boundary used by Dependabot's pip-compile updater."""
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


class DependencyAutomationTests(unittest.TestCase):
    def test_locked_requirements_have_a_paired_source_without_a_generated_header(self):
        # Dependabot may remove uv's header. A same-stem .in must remain so the
        # generated pins never become independently editable direct requirements.
        lock = ROOT / 'requirements.lock.txt'
        source = lock.with_suffix('.in')
        self.assertTrue(source.is_file(), 'compiled pins need a same-stem .in source')
        declarations = source.read_text().splitlines()
        self.assertIn('pydantic', declarations)
        self.assertFalse(any(line.startswith('pydantic-core') for line in declarations))
        self.assertFalse(any('--hash=' in line for line in declarations))

    def test_legacy_install_entry_point_forwards_to_the_single_source(self):
        lines = [line.strip() for line in (ROOT / 'requirements.txt').read_text().splitlines()
                 if line.strip() and not line.lstrip().startswith('#')]
        self.assertEqual(lines, ['-r requirements.lock.in'])
        # Avoid pairing this forwarding file with another compile source: that
        # would make Dependabot overwrite the forwarding entry with generated pins.
        self.assertFalse((ROOT / 'requirements.in').exists())

    def test_indirect_updates_remain_enabled_after_classification_is_fixed(self):
        config = yaml.safe_load((ROOT / '.github/dependabot.yml').read_text())
        pip = next(update for update in config['updates'] if update['package-ecosystem'] == 'pip')
        self.assertIn({'dependency-type': 'all'}, pip.get('allow', []))
        self.assertEqual(set(pip['groups']['pydantic-runtime']['patterns']),
                         {'pydantic', 'pydantic-core'})
        self.assertFalse(pip.get('ignore'), 'do not fix resolution by disabling updates')


if __name__ == '__main__':
    unittest.main()
