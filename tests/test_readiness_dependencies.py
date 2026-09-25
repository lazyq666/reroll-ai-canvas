"""Dependabot extras and uv's normalized lock must describe the same pins."""
from pathlib import Path
import importlib.util
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'readiness_dependencies', Path(__file__).resolve().parents[1] / 'scripts/readiness_dependencies.py')
dependencies = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dependencies)


class DependencyLockTests(unittest.TestCase):
    def verify_lock(self, committed, resolved):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'requirements.lock.txt'
            lock.write_text(committed)

            def compile_lock(argv, **kwargs):
                Path(argv[argv.index('--output-file') + 1]).write_text(resolved)

            with patch.object(dependencies.subprocess, 'run', side_effect=compile_lock):
                dependencies.verify('uv', root)
            self.assertEqual(lock.read_text(), committed)

    def test_dependabot_extras_match_uv_pins(self):
        self.verify_lock('httpx[socks]==0.28.1\nuvicorn[standard]==0.53.0\n',
                         'httpx==0.28.1\nuvicorn==0.53.0\n')

    def test_changed_extra_package_version_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify_lock('uvicorn[standard]==0.53.0\n', 'uvicorn==0.52.4\n')

    def test_missing_transitive_dependency_is_rejected(self):
        with self.assertRaises(ValueError):
            self.verify_lock('httpx[socks]==0.28.1\n',
                             'httpx==0.28.1\nsocksio==1.0.0\n')
