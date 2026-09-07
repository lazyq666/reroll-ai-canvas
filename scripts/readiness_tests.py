"""Run unittest with machine-readable counts; an empty/skipped group is failure."""
import json
from collections import Counter
import os
import re
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def successful(result, require_no_skips=False):
    return (result.wasSuccessful() and result.testsRun > len(result.skipped)
            and (not require_no_skips or not result.skipped))


def failure_locations(result):
    locations = []
    for test, trace in result.failures + result.errors:
        if not re.fullmatch(r'[A-Za-z_][\w.]*', test.id()):
            continue
        frames = []
        for filename, line in re.findall(r'File "([^"]+)", line (\d+)', trace):
            path = Path(filename).resolve()
            if path.is_relative_to(ROOT) and path.is_file():
                frames.append({'test': test.id(), 'file': path.relative_to(ROOT).as_posix(), 'line': int(line)})
        if frames:
            locations.append(frames[-1])
    return locations


def main():
    targets = sys.argv[1:]
    browser = targets == ['browser']
    if browser:
        executable = subprocess.check_output(
            ['node', '-e', "process.stdout.write(require('playwright').chromium.executablePath())"], text=True).strip()
        if not Path(executable).is_file():
            raise RuntimeError('locked Chromium executable is missing')
        os.environ['IC_BROWSER_BIN'] = executable
        os.environ['IC_RUN_BROWSER_TESTS'] = '1'
        if sys.platform == 'linux':
            os.environ['IC_BROWSER_NO_SANDBOX'] = '1'
        targets = ['tests.test_infinite_canvas_ui_core']
    loader = unittest.TestLoader()
    suite = loader.discover('tests', top_level_dir='.') if targets == ['discover'] else loader.loadTestsFromNames(targets)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    skip_categories = Counter(
        'controlled performance environment required' if 'performance' in reason.lower() else
        'browser runs in dedicated required group' if 'IC_RUN_BROWSER_TESTS' in reason else
        'POSIX environment required' if 'POSIX' in reason else
        'other optional test; inspect its declared reason'
        for _, reason in result.skipped)
    print('READINESS_COUNTS=' + json.dumps({'tests': result.testsRun, 'skipped': len(result.skipped),
                                          'skip_categories': dict(skip_categories),
                                          'failure_locations': failure_locations(result),
                                          'failed_tests': [test.id() for test, _ in result.failures + result.errors if re.fullmatch(r'[A-Za-z_][\w.]*', test.id())],
                                          'failures': len(result.failures), 'errors': len(result.errors)}))
    return 0 if successful(result, browser) else 1


if __name__ == '__main__':
    sys.exit(main())
