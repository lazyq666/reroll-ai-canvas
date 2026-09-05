"""Generate the browser's geometry constant from the shared code authority."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEOMETRY = ROOT / 'static/js/smart-canvas/node-geometry.js'
CONSTANTS = ROOT / 'static/js/smart-canvas/layout-constants.json'


def sync(check=False):
    gap = json.loads(CONSTANTS.read_text())['nodeGap']
    if not isinstance(gap, int) or isinstance(gap, bool) or gap <= 0:
        raise ValueError('nodeGap must be a positive integer')
    source = GEOMETRY.read_text()
    updated, count = re.subn(r'const NODE_GAP = \d+; // Generated from layout-constants.json',
                             f'const NODE_GAP = {gap}; // Generated from layout-constants.json', source)
    if count != 1:
        raise ValueError('Missing generated geometry constant')
    if check:
        return source == updated
    GEOMETRY.write_text(updated)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    raise SystemExit(0 if sync(parser.parse_args().check) else 1)
