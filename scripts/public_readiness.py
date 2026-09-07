"""Committed-snapshot readiness. Reports contain metadata only, never raw test logs.

The snapshot command never checks out, stages, cleans, or resets the source tree.
The group command is an internal entry point for disposable local/CI checkouts.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import venv

GROUPS = ('public-audit', 'python-tests', 'node-tests', 'browser-core', 'repository-contracts')
SCHEMA = 1


class ReadinessError(ValueError):
    """A bounded, public-safe operational failure explanation."""


def git(root, *args, env=None):
    if env is None:
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        env['GIT_NO_REPLACE_OBJECTS'] = '1'
    return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.PIPE, env=env).strip()


def identity(root, base=None, head=None):
    return {'candidate_sha': git(root, 'rev-parse', 'HEAD'),
            'tree_sha': git(root, 'rev-parse', 'HEAD^{tree}'),
            'base_sha': git(root, 'rev-parse', f'{base}^{{commit}}') if base else None,
            'head_sha': git(root, 'rev-parse', f'{head}^{{commit}}') if head else None,
            'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}


def clean_environment(scratch):
    """Only transport and OS essentials survive; no product/import/user settings."""
    allowed = ('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
               'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'SYSTEMROOT')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    bins = [str(Path(sys.executable).parent)]
    for command in ('node', 'npm', 'npx', 'git'):
        found = shutil.which(command)
        if found:
            bins.append(str(Path(found).parent))
    env.update(PATH=os.pathsep.join(dict.fromkeys(bins + os.defpath.split(os.pathsep))),
               HOME=str(scratch / 'home'), TMPDIR=str(scratch / 'tmp'),
               XDG_CONFIG_HOME=str(scratch / 'config'), XDG_DATA_HOME=str(scratch / 'data'),
               XDG_CACHE_HOME=str(scratch / 'cache'),
               PLAYWRIGHT_BROWSERS_PATH=str(scratch / 'browsers'),
               PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1',
               GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_NO_REPLACE_OBJECTS='1',
               PIP_CONFIG_FILE=os.devnull, PIP_DISABLE_PIP_VERSION_CHECK='1',
               UV_NO_CONFIG='1', IC_SKIP_PERFORMANCE_TESTS='1',
               READINESS_DOWNLOAD_CACHE=os.environ.get('READINESS_DOWNLOAD_CACHE', str(Path(tempfile.gettempdir()) / 'reroll-readiness-downloads')),
               CI='1', LANG='en_US.UTF-8')
    cache = Path(env['READINESS_DOWNLOAD_CACHE'])
    env.update(UV_CACHE_DIR=str(cache / 'uv'), PIP_CACHE_DIR=str(cache / 'pip'), npm_config_cache=str(cache / 'npm'))
    for key in ('HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'):
        Path(env[key]).mkdir(parents=True, exist_ok=True)
    return env


def stop_process(process, grace=5):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def interrupted(signum, frame):
    raise KeyboardInterrupt


def execute(argv, root, env, timeout, shutdown_grace=5):
    start = time.monotonic()
    # Raw output exists only in a temporary file. Public artifacts retain bounded,
    # structured counts, never excerpts from privacy scans or application logs.
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(argv, cwd=root, env=env, stdout=output,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=max(0.01, timeout))
            except subprocess.TimeoutExpired:
                stop_process(process, shutdown_grace)
                code = 124
            finally:
                stop_process(process, shutdown_grace)
            output.seek(0)
            counts = []
            browser_version = None
            for line in output:
                if line.startswith(b'READINESS_BROWSER='):
                    value = line.split(b'=', 1)[1].decode().strip()
                    if re.fullmatch(r'[0-9.]+', value):
                        browser_version = value
                if line.startswith(b'READINESS_COUNTS='):
                    try:
                        value = json.loads(line.split(b'=', 1)[1])
                        count = {key: int(value[key]) for key in ('tests', 'skipped', 'failures', 'errors')}
                        allowed_reasons = {'controlled performance environment required', 'browser runs in dedicated required group', 'POSIX environment required', 'other optional test; inspect its declared reason'}
                        count['skip_categories'] = {key: int(number) for key, number in value.get('skip_categories', {}).items() if key in allowed_reasons}
                        count['failed_tests'] = [name for name in value.get('failed_tests', []) if isinstance(name, str) and re.fullmatch(r'[A-Za-z_][\w.]*', name)]
                        counts.append(count)
                    except (ValueError, KeyError, TypeError):
                        code = 1
        except OSError:
            code, counts, browser_version = 127, [], None
    return {'result': 'success' if code == 0 else 'failure', 'exit_code': code,
            'duration_seconds': round(time.monotonic() - start, 3), 'counts': counts, 'browser_version': browser_version}


def require_history(root, ref='HEAD', check_links=True):
    if git(root, 'rev-parse', '--is-shallow-repository') != 'false':
        raise ReadinessError('complete candidate history is required')
    # Force traversal, including trees/blobs, so missing promisor objects cannot
    # silently masquerade as a complete offline snapshot.
    objects = git(root, 'rev-list', '--objects', '--missing=print', ref)
    if any(line.startswith('?') for line in objects.splitlines()):
        raise ReadinessError('candidate objects are missing; hydrate the partial clone before validation')
    entries = list(filter(None, git(root, 'ls-tree', '-rz', ref).split('\0')))
    if any(line.startswith('160000 ') for line in entries):
        raise ReadinessError('gitlinks are not supported')
    for line in entries:
        if check_links and line.startswith('120000 '):
            link = root / line.split('\t', 1)[1]
            if not link.resolve().is_relative_to(root.resolve()):
                raise ReadinessError('source symlink escapes the snapshot')


def source_changed(root):
    if git(root, 'diff', 'HEAD', '--'):
        return True
    # --others without exclude-standard deliberately includes ignored source.
    extra = filter(None, git(root, 'ls-files', '--others', '-z').split('\0'))
    return any(not (name.startswith('node_modules/') or
                    ('__pycache__' in Path(name).parts and name.endswith('.pyc')))
               for name in extra)


def run_group(root, group, base, head=None, timeout=1800):
    started = time.monotonic()
    report = {'schema_version': SCHEMA, 'group': group, 'result': 'failure', 'checks': []}
    report.update(identity(root, base, head))
    require_history(root)
    if source_changed(root):
        raise ReadinessError('group requires a clean disposable checkout')
    manifest = json.loads((root / 'scripts/readiness/manifest.json').read_text())
    if manifest.get('schema_version') != SCHEMA or set(manifest['groups']) != set(GROUPS):
        raise ReadinessError('invalid required group inventory')
    entries = manifest['groups'][group]
    if not entries or len({item['id'] for item in entries}) != len(entries):
        raise ReadinessError('empty or duplicate command inventory')
    with tempfile.TemporaryDirectory(prefix='readiness-state-') as temp:
        scratch = Path(temp)
        env = clean_environment(scratch)
        runtime, tooling = scratch / 'runtime', scratch / 'tooling'
        venv.EnvBuilder(with_pip=False).create(runtime)
        if any('{tools_python}' in item['argv'] for item in entries):
            venv.EnvBuilder(with_pip=True).create(tooling)
        values = {'python': str(runtime / 'bin/python'), 'tools_python': str(tooling / 'bin/python'),
                  'uv': str(tooling / 'bin/uv'), 'base': report['base_sha'] or ''}
        env['PATH'] = str(runtime / 'bin') + os.pathsep + env['PATH']
        report['environment'] = {'python': platform.python_version(), 'os': platform.system(),
                                 'node': subprocess.check_output(['node', '--version'], env=env, text=True).strip()}
        results = {}
        ever_changed = False
        for entry in entries:
            check = {'id': entry['id'], 'argv': entry['argv']}
            if any(results.get(key) != 'success' for key in entry.get('needs', [])):
                check.update(result='blocked', reason='required preparation failed', counts=[])
            else:
                argv = [values.get(arg[1:-1], arg) if arg.startswith('{') and arg.endswith('}') else arg
                        for arg in entry['argv']]
                check.update(execute(argv, root, env, timeout - (time.monotonic() - started)))
                check['category'] = ('preparation' if entry['id'] in ('uv', 'install', 'npm-ci', 'chromium-install') else 'validation')
            if entry['id'] in ('python-suite', 'node-contracts', 'browser-contract', 'knowledge-map', 'cache-versions') and check['result'] == 'success':
                counts = check.get('counts', [])
                if not counts or any(c['tests'] <= c['skipped'] for c in counts):
                    check.update(result='failure', reason='required test execution evidence is empty')
            if source_changed(root):
                ever_changed = True
                check.update(result='failure', reason='check changed candidate source')
            results[entry['id']] = check['result']
            report['checks'].append(check)
            print(f"{group}/{entry['id']}: {check['result']}", flush=True)
        if group == 'browser-core' and results.get('browser-contract') == 'success':
            probe = execute(['node', '-e', "const {chromium}=require('playwright'); (async()=>{const b=await chromium.launch({headless:true,args:process.platform==='linux'?['--no-sandbox']:[]}); console.log('READINESS_BROWSER='+b.version());await b.close()})().catch(()=>process.exit(1))"], root, env, 30)
            report['checks'].append({'id': 'browser-runtime', **probe})
            report['environment']['browser'] = probe['browser_version']
        changed = ever_changed or source_changed(root)
        report['source_unchanged'] = not changed
        report['result'] = ('success' if not changed and all(c['result'] == 'success' for c in report['checks']) else 'failure')
    report['duration_seconds'] = round(time.monotonic() - started, 3)
    return report


@contextlib.contextmanager
def materialize(source, sha, base=None, head=None):
    """Separate object database/index/config. Never share source working files."""
    require_history(source, sha, check_links=False)
    with tempfile.TemporaryDirectory(prefix='readiness-snapshot-') as temp:
        root = Path(temp) / 'source'
        root.mkdir()
        env = clean_environment(Path(temp) / 'git-state')
        git(root, 'init', '-q', env=env)
        for commit in dict.fromkeys(filter(None, (sha, base, head))):
            git(root, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', str(source), commit, env=env)
        git(root, '-c', 'core.autocrlf=false', 'checkout', '--detach', sha, env=env)
        require_history(root)
        yield root


def aggregate(reports, expected, needs=None):
    if len(reports) != len(GROUPS) or {r.get('group') for r in reports} != set(GROUPS):
        return False
    if needs is not None and (set(needs) != set(GROUPS) or
                              any(needs[g].get('result') != 'success' for g in GROUPS)):
        return False
    return all(r.get('schema_version') == SCHEMA and r.get('result') == 'success'
               and r.get('source_unchanged') is True and r.get('checks')
               and all(c.get('result') == 'success' for c in r['checks'])
               and all(r.get(key) == value for key, value in expected.items()) for r in reports)


def snapshot(source, ref, base, output):
    if output.resolve().is_relative_to(source.resolve()):
        raise ReadinessError('write reports outside the development tree')
    sha = git(source, 'rev-parse', f'{ref}^{{commit}}')
    base = git(source, 'rev-parse', f'{base}^{{commit}}')
    expected = {'candidate_sha': sha, 'tree_sha': git(source, 'rev-parse', f'{sha}^{{tree}}'),
                'base_sha': base, 'head_sha': None, 'run_id': None, 'run_attempt': None}
    reports = []
    dirty = bool(git(source, 'status', '--porcelain'))
    print(f'Candidate {sha}; local changes excluded: {dirty}', flush=True)
    for group in GROUPS:
        with materialize(source, sha, base) as root:
            # Execute the candidate's own versioned runner, not an uncommitted repair.
            with tempfile.TemporaryDirectory(prefix='readiness-report-') as temp:
                target = Path(temp) / 'group.json'
                command = [sys.executable, str(root / 'scripts/public_readiness.py'), 'group', group,
                           '--base', base, '--output', str(target)]
                env = clean_environment(Path(temp) / 'state')
                result = execute(command, root, env, 1800, shutdown_grace=15)
                report = json.loads(target.read_text()) if target.exists() else {'group': group, 'result': 'failure', 'reason': 'runner did not produce evidence'}
                if result['result'] != 'success':
                    report['result'] = 'failure'
                reports.append(report)
                output.write_text(json.dumps({'schema_version': SCHEMA, **expected, 'result': 'in_progress', 'groups': reports}, indent=2) + '\n')
                print(f"{group}: {report['result']}", flush=True)
    report = {'schema_version': SCHEMA, **expected, 'local_changes_excluded': dirty, 'groups': reports,
              'result': 'success' if aggregate(reports, expected) else 'failure'}
    output.write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    snap = sub.add_parser('snapshot')
    snap.add_argument('ref')
    snap.add_argument('--base', required=True)
    snap.add_argument('--output', type=Path, required=True)
    group = sub.add_parser('group')
    group.add_argument('group', choices=GROUPS)
    group.add_argument('--base', required=True)
    group.add_argument('--head')
    group.add_argument('--output', type=Path, required=True)
    gate = sub.add_parser('gate')
    gate.add_argument('--reports', type=Path, required=True)
    gate.add_argument('--needs', required=True)
    gate.add_argument('--base', required=True)
    gate.add_argument('--head')
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    root = Path.cwd()
    try:
        if args.command == 'snapshot':
            report = snapshot(root, args.ref, args.base, args.output.resolve())
        elif args.command == 'group':
            report = run_group(root, args.group, args.base, args.head)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
        else:
            reports = [json.loads(p.read_text()) for p in args.reports.rglob('*.json')]
            passed = aggregate(reports, identity(root, args.base, args.head), json.loads(args.needs))
            report = {'result': 'success' if passed else 'failure'}
        print('Public readiness: ' + report['result'])
        return int(report['result'] != 'success')
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, KeyboardInterrupt) as error:
        # Error types are safe to publish; raw exception values can include paths
        # or private audit output. Missing reports intentionally fail the gate.
        failure = {'schema_version': SCHEMA, 'result': 'failure', 'reason': str(error) if isinstance(error, ReadinessError) else type(error).__name__}
        if args.command == 'group':
            failure['group'] = args.group
            args.output.write_text(json.dumps(failure, indent=2) + '\n')
        elif args.command == 'snapshot':
            args.output.write_text(json.dumps(failure, indent=2) + '\n')
        print('Public readiness failed: ' + failure['reason'] + '; no complete evidence', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
