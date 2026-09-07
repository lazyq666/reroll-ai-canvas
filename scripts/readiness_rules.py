"""Read-only comparison of expected and effective GitHub main rules."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def api(repo, endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/{endpoint}'], text=True))


def differences(expected, actual):
    drift = []
    for key in ('name', 'target', 'enforcement', 'bypass_actors', 'conditions'):
        if actual.get(key) != expected[key]:
            drift.append(key)
    wanted = {rule['type']: rule for rule in expected['rules']}
    found = {rule['type']: rule for rule in actual.get('rules', [])}
    if set(found) != set(wanted):
        drift.append('rule types')
    for name, rule in wanted.items():
        if name not in found:
            continue
        for key, value in rule.get('parameters', {}).items():
            if found[name].get('parameters', {}).get(key) != value:
                drift.append(f'{name}.{key}')
    return drift


def verify(repo, declaration):
    expected = json.loads(declaration.read_text())
    listed = api(repo, 'rulesets?includes_parents=true&per_page=100')
    matching = [rule for rule in listed if rule['name'] == expected['name']]
    if len(matching) != 1:
        return ['expected exactly one named ruleset']
    actual = api(repo, f"rulesets/{matching[0]['id']}")
    drift = differences(expected, actual)
    # The effective branch endpoint verifies targeting and enforcement, not just
    # the saved document. Other active rules may tighten the required baseline.
    effective = api(repo, 'rules/branches/main')
    for wanted in expected['rules']:
        if not any(rule['type'] == wanted['type'] and
                   all(rule.get('parameters', {}).get(k) == v for k, v in wanted.get('parameters', {}).items())
                   for rule in effective):
            drift.append('effective.' + wanted['type'])
    return drift


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='lazyq666/reroll-ai-canvas')
    parser.add_argument('--declaration', type=Path, default=Path('.github/rulesets/main-readiness.json'))
    args = parser.parse_args()
    try:
        drift = verify(args.repo, args.declaration)
        print(json.dumps({'result': 'failure' if drift else 'success', 'drift': drift}))
        sys.exit(bool(drift))
    except (subprocess.SubprocessError, ValueError, KeyError, OSError):
        print('Rules could not be verified; release verification is incomplete', file=sys.stderr)
        sys.exit(1)
