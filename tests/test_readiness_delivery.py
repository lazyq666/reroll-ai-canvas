"""Behavioral delivery tests: real Git snapshots and child processes, no network."""
import copy
import io
from contextlib import redirect_stdout
from datetime import datetime
from zoneinfo import ZoneInfo
import importlib.util
import json
import os
import signal
import time
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
with patch.dict(sys.modules, {'public_readiness': readiness, 'readiness_version': versions}):
    publisher = load('readiness_publish')


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

    def test_failed_command_logs_safe_diagnostics_without_raw_output(self):
        name = 'tests.synthetic.Probe.test_failure'
        counts = {'tests': 1, 'skipped': 0, 'failures': 1, 'errors': 0,
                  'failed_tests': [name, 'private prompt\n::error::injected'],
                  'failure_locations': [
                      {'test': name, 'file': 'tests/test_probe.py', 'line': 42},
                      {'test': name, 'file': '/private/secret.py', 'line': 1},
                      {'test': name, 'file': 'tests/../secret.py', 'line': 1}]}
        command = "print('private raw application output'); print(" + repr('READINESS_COUNTS=' + json.dumps(counts)) + "); raise SystemExit(1)"
        result = self.command(self.root, command)
        output = io.StringIO()
        with redirect_stdout(output):
            readiness.show_check_result('python-tests', {'id': 'python-suite', 'argv': ['private argument'], **result})
        lines = output.getvalue().splitlines()
        self.assertEqual(lines[0], 'python-tests/python-suite: failure')
        details = json.loads(lines[1].removeprefix('READINESS_FAILURE='))
        self.assertEqual(details['exit_code'], 1)
        self.assertEqual(details['counts'][0]['failed_tests'], [name])
        self.assertEqual(details['counts'][0]['failure_locations'], [counts['failure_locations'][0]])
        self.assertNotIn('private', output.getvalue())
        self.assertNotIn('secret', output.getvalue())

    def test_failure_without_test_counts_still_logs_exit_code(self):
        result = self.command(self.root, 'raise SystemExit(7)')
        output = io.StringIO()
        with redirect_stdout(output):
            readiness.show_check_result('python-tests', {'id': 'python-suite', **result})
        details = json.loads(output.getvalue().split('READINESS_FAILURE=')[1])
        self.assertEqual(details['exit_code'], 7)
        self.assertEqual(details['counts'], [])

    def test_success_logs_only_status(self):
        output = io.StringIO()
        with redirect_stdout(output):
            readiness.show_check_result('python-tests', {'id': 'python-suite', 'result': 'success'})
        self.assertEqual(output.getvalue(), 'python-tests/python-suite: success\n')

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

    def test_deleted_ancestor_content_still_fails_real_history_audit(self):
        (self.root / 'scripts').mkdir()
        for name in ('audit_public_tree.py', 'audit_public_history.py'):
            shutil.copy(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        (self.root / '.scratch').mkdir()
        (self.root / '.scratch/synthetic.txt').write_text('synthetic historical marker\n')
        ancestor = self.commit()
        (self.root / '.scratch/synthetic.txt').unlink()
        current = self.commit()
        with readiness.materialize(self.root, current) as candidate:
            self.assertFalse((candidate / '.scratch/synthetic.txt').exists())
            result = self.command(candidate, "import subprocess,sys; result=subprocess.run([sys.executable,'scripts/audit_public_history.py','HEAD'],capture_output=True,text=True); assert result.returncode == 1 and 'forbidden historical surface' in result.stderr")
            self.assertEqual(result['result'], 'success')
            self.assertIn('synthetic historical marker', readiness.git(candidate, 'show', f'{ancestor}:.scratch/synthetic.txt'))

    def test_gitlink_candidate_is_rejected(self):
        self.git('update-index', '--add', '--cacheinfo', f'160000,{self.base},submodule')
        self.git('commit', '-qm', 'Synthetic gitlink')
        sha = self.git('rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'gitlinks'):
            with readiness.materialize(self.root, sha):
                self.fail('unsupported gitlink materialized')

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
        (self.root / '__pycache__').mkdir()
        (self.root / '__pycache__/迁移数据.cpython-312.pyc').write_bytes(b'cache')
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

    def test_successful_exit_without_required_suite_evidence_fails(self):
        sha = self.fixture_runner({'python-tests': [{'id': 'python-suite', 'argv': ['{python}', '-c', 'pass']}]})
        with readiness.materialize(self.root, sha, self.base) as candidate:
            report = readiness.run_group(candidate, 'python-tests', self.base)
        self.assertEqual(report['result'], 'failure')
        self.assertIn('empty', report['checks'][0]['reason'])

    def test_test_writing_source_fails_without_repairing_candidate(self):
        sha = self.fixture_runner({'node-tests': [{'id': 'write', 'argv': ['{python}', '-c', "open('source.py','w').write('changed')"]}]})
        with readiness.materialize(self.root, sha, self.base) as candidate:
            report = readiness.run_group(candidate, 'node-tests', self.base)
            self.assertEqual(report['result'], 'failure')
            self.assertFalse(report['source_unchanged'])
        self.assertEqual((self.root / 'source.py').read_text(), 'value = 0\n')

    def test_user_git_checkout_configuration_cannot_transform_candidate(self):
        config = Path(self.temp.name) / 'user.gitconfig'
        config.write_text('[core]\n autocrlf = true\n')
        with patch.dict(os.environ, {'GIT_CONFIG_GLOBAL': str(config)}):
            with readiness.materialize(self.root, self.base) as candidate:
                self.assertEqual((candidate / 'source.py').read_bytes(), b'value = 0\n')

    def test_uncommitted_symlink_cannot_influence_candidate(self):
        (self.root / 'link').symlink_to('source.py')
        sha = self.commit()
        (self.root / 'link').unlink()
        (self.root / 'link').symlink_to(Path(self.temp.name))
        with readiness.materialize(self.root, sha) as candidate:
            self.assertEqual((candidate / 'link').read_text(), 'value = 0\n')

    def test_later_restore_cannot_hide_earlier_source_write(self):
        sha = self.fixture_runner({'node-tests': [
            {'id': 'write', 'argv': ['{python}', '-c', "open('source.py','w').write('changed')"]},
            {'id': 'restore', 'argv': ['git', 'checkout', '--', 'source.py']}]})
        with readiness.materialize(self.root, sha, self.base) as candidate:
            report = readiness.run_group(candidate, 'node-tests', self.base)
            self.assertFalse(readiness.source_changed(candidate))
            self.assertFalse(report['source_unchanged'])
            self.assertEqual(report['checks'][0]['result'], 'failure')
            self.assertEqual(report['result'], 'failure')

    def test_nested_timeout_stops_child_and_cleans_temporary_state(self):
        script = Path(self.temp.name) / 'nested.py'
        marker = Path(self.temp.name) / 'child.json'
        child_code = f"import os,time,json; open({str(marker)!r}, 'w').write(json.dumps([os.getpid(), STATE])); time.sleep(60)"
        script.write_text(
            'import sys, signal, tempfile, json, pathlib\n'
            + f'sys.path.insert(0, {str(ROOT / "scripts")!r})\n'
            + 'import public_readiness as r\n'
            + 'signal.signal(signal.SIGTERM, r.interrupted)\n'
            + 'with tempfile.TemporaryDirectory() as state:\n'
            + ' root = pathlib.Path(state)\n'
            + f' code = {child_code!r}.replace("STATE", repr(state))\n'
            + ' r.execute([sys.executable,"-c",code],root,r.clean_environment(root/"env"),60)\n')
        result = readiness.execute([sys.executable, str(script)], self.root,
                                   readiness.clean_environment(Path(self.temp.name) / 'outer'), 2, shutdown_grace=15)
        self.assertEqual(result['exit_code'], 124)
        pid, state = json.loads(marker.read_text())
        self.assertFalse(Path(state).exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def publication_fixture(self):
        day = datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y.%m.%d')
        (self.root / 'static').mkdir()
        (self.root / 'VERSION').write_text(day + '.1\n')
        (self.root / 'static/update-notes.json').write_text(json.dumps({'version': day + '.1'}))
        base = self.commit()
        remote = Path(self.temp.name) / 'remote.git'
        subprocess.run(['git', 'init', '--bare', '-q', str(remote)], check=True)
        self.git('remote', 'add', 'publication', str(remote))
        self.git('push', '-q', 'publication', f'{base}:refs/heads/main')
        (self.root / 'VERSION').write_text(day + '.2\n')
        (self.root / 'static/update-notes.json').write_text(json.dumps({'version': day + '.2'}))
        candidate = self.commit()
        (self.root / 'VERSION').write_text(day + '.3\n')
        (self.root / 'static/update-notes.json').write_text(json.dumps({'version': day + '.3'}))
        competitor = self.commit()
        return candidate, competitor

    def test_publisher_blocks_main_and_version_reuse(self):
        candidate, _ = self.publication_fixture()
        report = Path(self.temp.name) / 'publish.json'
        with self.assertRaises(ValueError):
            publisher.publish(self.root, candidate, 'publication', 'main', report)
        with patch.object(publisher, 'snapshot', return_value={'result':'success'}):
            publisher.publish(self.root, candidate, 'publication', 'codex/fixture', report)
            with self.assertRaises(ValueError):
                publisher.publish(self.root, candidate, 'publication', 'codex/fixture', report)

    def test_main_advancing_during_validation_blocks_publication(self):
        candidate, competitor = self.publication_fixture()
        def advance(*args):
            self.git('push', '-q', 'publication', f'{competitor}:refs/heads/main')
            return {'result':'success'}
        with patch.object(publisher, 'snapshot', side_effect=advance):
            with self.assertRaisesRegex(ValueError, 'advanced'):
                publisher.publish(self.root, candidate, 'publication', 'codex/fixture', Path(self.temp.name) / 'publish.json')
        self.assertNotIn('refs/heads/codex/fixture', publisher.remote_refs(self.root, 'publication', 'codex/fixture'))

    def test_destination_race_is_rejected_by_real_git_lease(self):
        candidate, competitor = self.publication_fixture()
        original_git = readiness.git
        def race(root, *args):
            if args[0] == 'push':
                original_git(root, 'push', '-q', 'publication', f'{competitor}:refs/heads/codex/fixture')
            return original_git(root, *args)
        with patch.object(publisher, 'snapshot', return_value={'result':'success'}), patch.object(publisher, 'git', side_effect=race):
            with self.assertRaises(subprocess.CalledProcessError):
                publisher.publish(self.root, candidate, 'publication', 'codex/fixture', Path(self.temp.name) / 'publish.json')
        self.assertEqual(publisher.remote_refs(self.root, 'publication', 'codex/fixture')['refs/heads/codex/fixture'], competitor)

    def test_release_preparation_updates_existing_share_cache_contract(self):
        (self.root / 'static').mkdir()
        (self.root / 'VERSION').write_text('2026.09.07.1\n')
        (self.root / 'static/update-notes.json').write_text('{"version":"2026.09.07.1"}')
        (self.root / 'static/share.html').write_text('<link href="/static/css/canvas-share.css?v=old"><script src="/static/js/canvas-share.js?v=old"></script>')
        versions.prepare(self.root, '2026.09.07.2')
        self.assertEqual(json.loads((self.root / 'static/update-notes.json').read_text())['version'], '2026.09.07.2')
        self.assertEqual((self.root / 'static/share.html').read_text().count('?v=2026.09.07.2.'), 2)
        with self.assertRaises(ValueError):
            versions.prepare(self.root, '2026.09.07.2')

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

    def test_failure_location_keeps_only_public_relative_source(self):
        class Probe(unittest.TestCase):
            def id(self):
                return 'tests.synthetic.Probe.runTest'
            def runTest(self):
                self.fail('synthetic failure')
        result = unittest.TestResult()
        Probe().run(result)
        locations = test_runner.failure_locations(result)
        self.assertEqual(locations[0]['file'], 'tests/test_readiness_delivery.py')
        self.assertGreater(locations[0]['line'], 0)
        self.assertNotIn(str(ROOT), json.dumps(locations))

    def test_missing_chromium_fails_before_test_discovery(self):
        with patch.object(sys, 'argv', ['readiness_tests.py', 'browser']), patch.object(test_runner.subprocess, 'check_output', return_value='/nonexistent-readiness-chromium'):
            with self.assertRaisesRegex(RuntimeError, 'Chromium'):
                test_runner.main()

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
