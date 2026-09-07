"""Behavioral delivery tests: real Git snapshots and child processes, no network."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


readiness = load('public_readiness')
rules = load('readiness_rules')
versions = load('readiness_version')
test_runner = load('readiness_tests')


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='readiness-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Readiness Test')
        self.git('config', 'user.email', 'test@users.noreply.github.com')
        (self.root / 'source.py').write_text('value = 0\n')
        self.base = self.commit()

    def git(self, *args):
        return readiness.git(self.root, *args)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'Synthetic fixture')
        return self.git('rev-parse', 'HEAD')

    def command(self, root, code):
        state = Path(self.temp.name) / 'state'
        return readiness.execute([sys.executable, '-c', code], root, readiness.clean_environment(state), 10)

    def test_uncommitted_staged_untracked_repairs_cannot_change_candidate(self):
        (self.root / 'source.py').write_text('value = 1\n')
        self.git('add', 'source.py')
        (self.root / 'source.py').write_text('value = 2\n')
        (self.root / 'repair.py').write_text('value = 3\n')
        before = (self.git('status', '--porcelain'), self.git('diff'), self.git('diff', '--cached'))
        with readiness.materialize(self.root, self.base) as candidate:
            result = self.command(candidate, 'from source import value; assert value == 1')
            self.assertEqual(result['result'], 'failure')
            self.assertFalse((candidate / 'repair.py').exists())
        self.assertEqual(before, (self.git('status', '--porcelain'), self.git('diff'), self.git('diff', '--cached')))
        fixed = self.commit()
        with readiness.materialize(self.root, fixed) as candidate:
            self.assertEqual(self.command(candidate, 'from source import value; assert value == 2')['result'], 'success')

    def test_fixed_sha_survives_branch_movement(self):
        with readiness.materialize(self.root, self.base) as candidate:
            (self.root / 'source.py').write_text('value = 99\n')
            moved = self.commit()
            self.assertNotEqual(moved, self.base)
            self.assertEqual(readiness.identity(candidate)['candidate_sha'], self.base)
            self.assertEqual(self.command(candidate, 'from source import value; assert value == 0')['result'], 'success')

    def test_missing_source_cannot_import_from_developer_pythonpath(self):
        (self.root / 'secret_repair.py').write_text('value = 1\n')
        with patch.dict(os.environ, {'PYTHONPATH': str(self.root), 'NODE_PATH': str(self.root),
                                    'IC_DATA_DIR': str(self.root), 'VIRTUAL_ENV': str(self.root)}):
            with readiness.materialize(self.root, self.base) as candidate:
                self.assertEqual(self.command(candidate, 'import secret_repair')['result'], 'failure')
                env = readiness.clean_environment(Path(self.temp.name) / 'env')
                for key in ('PYTHONPATH', 'NODE_PATH', 'IC_DATA_DIR', 'VIRTUAL_ENV'):
                    self.assertNotIn(key, env)

    def test_deleted_ancestor_content_remains_available(self):
        (self.root / 'historical-fixture.txt').write_text('synthetic historical marker\n')
        ancestor = self.commit()
        (self.root / 'historical-fixture.txt').unlink()
        current = self.commit()
        with readiness.materialize(self.root, current) as candidate:
            self.assertIn('synthetic historical marker', readiness.git(candidate, 'show', f'{ancestor}:historical-fixture.txt'))
            self.assertGreater(len(readiness.git(candidate, 'rev-list', 'HEAD').splitlines()), 1)

    def test_shallow_history_is_rejected(self):
        clone = Path(self.temp.name) / 'shallow'
        subprocess.run(['git', 'clone', '-q', '--depth', '1', self.root.as_uri(), str(clone)], check=True)
        with self.assertRaisesRegex(ValueError, 'complete'):
            with readiness.materialize(clone, self.base):
                self.fail('shallow materialized')

    def test_source_mutations_include_ignored_source_but_allow_caches(self):
        (self.root / '.gitignore').write_text('*.generated.py\n')
        self.commit()
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules/cache').write_text('cache')
        self.assertFalse(readiness.source_changed(self.root))
        (self.root / 'lost.generated.py').write_text('unexpected source')
        self.assertTrue(readiness.source_changed(self.root))
        (self.root / 'lost.generated.py').unlink()
        (self.root / 'source.py').write_text('mutated')
        self.assertTrue(readiness.source_changed(self.root))

    def fixture_runner(self, commands):
        (self.root / 'scripts/readiness').mkdir(parents=True)
        shutil.copy(ROOT / 'scripts/public_readiness.py', self.root / 'scripts/public_readiness.py')
        inventory = {'schema_version': 1, 'groups': {group: commands.get(group, [{'id': 'probe', 'argv': ['{python}', '-c', 'assert True']}]) for group in readiness.GROUPS}}
        (self.root / 'scripts/readiness/manifest.json').write_text(json.dumps(inventory))
        return self.commit()

    def test_snapshot_collects_independent_failures_and_all_groups(self):
        sha = self.fixture_runner({group: [{'id': 'probe', 'argv': ['{python}', '-c', 'raise SystemExit(1)']}] for group in ('public-audit', 'python-tests')})
        report = readiness.snapshot(self.root, sha, self.base, Path(self.temp.name) / 'report.json')
        self.assertEqual([r['result'] for r in report['groups']], ['failure', 'failure', 'success', 'success', 'success'])
        self.assertEqual(report['result'], 'failure')
        self.assertNotIn(self.temp.name, json.dumps(report))

    def test_group_runs_independent_checks_after_failure_and_blocks_dependents(self):
        sha = self.fixture_runner({'python-tests': [
            {'id': 'install', 'argv': ['{python}', '-c', 'raise SystemExit(1)']},
            {'id': 'dependent', 'needs': ['install'], 'argv': ['{python}', '-c', 'assert True']},
            {'id': 'independent', 'argv': ['{python}', '-c', 'assert True']}]})
        with readiness.materialize(self.root, sha, self.base) as candidate:
            report = readiness.run_group(candidate, 'python-tests', self.base)
        self.assertEqual([r['result'] for r in report['checks']], ['failure', 'blocked', 'success'])

    def test_test_writing_source_fails_without_repairing_candidate(self):
        sha = self.fixture_runner({'node-tests': [{'id': 'write', 'argv': ['{python}', '-c', "open('source.py','w').write('changed')"]}]})
        with readiness.materialize(self.root, sha, self.base) as candidate:
            report = readiness.run_group(candidate, 'node-tests', self.base)
            self.assertEqual(report['result'], 'failure')
            self.assertFalse(report['source_unchanged'])
        self.assertEqual((self.root / 'source.py').read_text(), 'value = 0\n')

    def test_release_pair_and_monotonic_base(self):
        (self.root / 'static').mkdir()
        (self.root / 'VERSION').write_text('2026.09.07.1\n')
        (self.root / 'static/update-notes.json').write_text('{"version":"2026.09.07.1"}')
        base = self.commit()
        with self.assertRaises(ValueError):
            versions.verify(self.root, base)
        (self.root / 'VERSION').write_text('2026.09.07.2\n')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            versions.verify(self.root, base)
        (self.root / 'static/update-notes.json').write_text('{"version":"2026.09.07.2"}')
        versions.verify(self.root, base)
        with self.assertRaises(ValueError):
            versions.verify(self.root, '0' * 40)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.expected = {'candidate_sha': 'candidate', 'tree_sha': 'tree', 'base_sha': 'base', 'head_sha': 'head', 'run_id': '1', 'run_attempt': '1'}
        self.reports = [{'schema_version': 1, 'group': group, 'result': 'success', 'source_unchanged': True,
                         'checks': [{'result': 'success'}], **self.expected} for group in readiness.GROUPS]
        self.needs = {group: {'result': 'success'} for group in readiness.GROUPS}

    def test_only_complete_success_passes(self):
        self.assertTrue(readiness.aggregate(self.reports, self.expected, self.needs))
        for status in ('failure', 'cancelled', 'skipped', None):
            with self.subTest(status=status):
                needs = copy.deepcopy(self.needs)
                needs['python-tests']['result'] = status
                self.assertFalse(readiness.aggregate(self.reports, self.expected, needs))
        self.assertFalse(readiness.aggregate(self.reports[:-1], self.expected, self.needs))
        self.assertFalse(readiness.aggregate(self.reports, self.expected, {}))
        self.assertFalse(readiness.aggregate(self.reports + [self.reports[0]], self.expected))

    def test_new_candidate_base_or_attempt_invalidates_old_evidence(self):
        for key in self.expected:
            with self.subTest(key=key):
                expected = {**self.expected, key: 'changed'}
                self.assertFalse(readiness.aggregate(self.reports, expected, self.needs))

    def test_failed_or_empty_internal_evidence_cannot_be_green(self):
        for checks in ([], [{'result': 'skipped'}], [{'result': 'failure'}]):
            self.reports[0]['checks'] = checks
            self.assertFalse(readiness.aggregate(self.reports, self.expected, self.needs))

    def test_empty_or_entirely_skipped_test_group_fails(self):
        result = unittest.TestResult()
        self.assertFalse(test_runner.successful(result))
        result.testsRun = 1
        result.skipped = [('synthetic', 'opt in')]
        self.assertFalse(test_runner.successful(result))
        result.testsRun = 2
        self.assertTrue(test_runner.successful(result))
        self.assertFalse(test_runner.successful(result, True))

    def test_rules_drift_detected_for_every_enforcement_boundary(self):
        expected = json.loads((ROOT / '.github/rulesets/main-readiness.json').read_text())
        self.assertEqual(rules.differences(expected, expected), [])
        variants = []
        for key, value in [('enforcement', 'disabled'), ('bypass_actors', [{'actor_id': 1}]), ('conditions', {})]:
            variants.append({**copy.deepcopy(expected), key: value})
        for key, value in [('strict_required_status_checks_policy', False), ('required_status_checks', [{'context':'wrong', 'integration_id':15368}]), ('required_status_checks', [{'context':'Public readiness gate', 'integration_id':None}])]:
            changed = copy.deepcopy(expected)
            changed['rules'][-1]['parameters'][key] = value
            variants.append(changed)
        for changed in variants:
            self.assertTrue(rules.differences(expected, changed))


if __name__ == '__main__':
    unittest.main()
