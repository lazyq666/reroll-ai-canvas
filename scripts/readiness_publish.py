"""Publish a verified commit to a PR branch; never updates local/main branches."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from public_readiness import GROUPS, aggregate, git, snapshot
from readiness_version import version


def remote_refs(root, remote, branch):
    output = git(root, 'ls-remote', '--refs', remote, 'refs/heads/main', f'refs/heads/{branch}')
    refs = {line.split()[1]: line.split()[0] for line in output.splitlines()}
    if 'refs/heads/main' not in refs:
        raise ValueError('remote main is unavailable')
    return refs


def publish(root, ref, remote, branch, report_path):
    if branch == 'main' or not branch.startswith('codex/'):
        raise ValueError('publish destination must be a codex/ PR branch')
    git(root, 'check-ref-format', f'refs/heads/{branch}')
    sha = git(root, 'rev-parse', f'{ref}^{{commit}}')
    refs = remote_refs(root, remote, branch)
    base = refs['refs/heads/main']
    candidate_version = version(git(root, 'show', f'{sha}:VERSION'))
    if candidate_version[:3] != tuple(map(int, datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y.%m.%d').split('.'))):
        raise ValueError('candidate version must use the current Asia/Shanghai date')
    for baseline in refs.values():
        git(root, 'fetch', '--no-tags', remote, baseline)
        if candidate_version <= version(git(root, 'show', f'{baseline}:VERSION')):
            raise ValueError('version must exceed remote main and destination')
    previous_target = refs.get(f'refs/heads/{branch}')
    if previous_target:
        git(root, 'merge-base', '--is-ancestor', previous_target, sha)
    result = snapshot(root, sha, base, report_path)
    if result['result'] != 'success':
        raise ValueError('candidate snapshot failed')
    if remote_refs(root, remote, branch) != refs:
        raise ValueError('remote advanced during validation; create a new version and revalidate')
    target = f'refs/heads/{branch}'
    # A lease prevents overwriting a concurrent destination update. main is read
    # again after publication; only GitHub strict PR checks can atomically enforce
    # base freshness at merge time.
    git(root, 'push', f'--force-with-lease={target}:{refs.get(target, "")}', remote, f'{sha}:{target}')
    if remote_refs(root, remote, branch).get('refs/heads/main') != base:
        raise ValueError('main advanced during push; branch was published but is not verified for release')
    print(f'Published candidate {sha} to {branch}; Linux PR checks and effective rules are still required')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ref')
    parser.add_argument('--remote', default='origin')
    parser.add_argument('--branch', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    try:
        publish(Path.cwd(), args.ref, args.remote, args.branch, args.report.resolve())
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Publication incomplete: check snapshot, release version and remote freshness', file=sys.stderr)
        sys.exit(1)
