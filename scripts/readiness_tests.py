"""Run unittest with machine-readable counts; an empty/skipped group is failure."""
import json
from collections import Counter
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def successful(result, require_no_skips=False):
    return (result.wasSuccessful() and result.testsRun > len(result.skipped)
            and (not require_no_skips or not result.skipped))


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
                                          'failures': len(result.failures), 'errors': len(result.errors)}))
    return 0 if successful(result, browser) else 1


if __name__ == '__main__':
    sys.exit(main())
