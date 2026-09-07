"""Validate the release pair against an explicitly identified previous main."""
import argparse
import datetime
import json
import re
import subprocess
import time
from zoneinfo import ZoneInfo
from pathlib import Path


def version(value):
    match = re.fullmatch(r"(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*)", value.strip())
    if not match:
        raise ValueError("invalid release version")
    parts = tuple(map(int, match.groups()))
    datetime.date(*parts[:3])
    return parts


def verify(root, base):
    current = (root / 'VERSION').read_text().strip()
    if json.loads((root / 'static/update-notes.json').read_text())['version'] != current:
        raise ValueError('VERSION/update-notes mismatch')
    if not base or set(base) == {'0'}:
        raise ValueError('previous main identity is required')
    previous = subprocess.check_output(['git', 'show', f'{base}:VERSION'], cwd=root, text=True).strip()
    if version(current) <= version(previous):
        raise ValueError('candidate version must exceed previous main')


def prepare(root, value):
    """Explicit pre-commit generation; never called by snapshot verification."""
    if version(value) <= version((root / 'VERSION').read_text()):
        raise ValueError('prepared version must increase')
    notes_path = root / 'static/update-notes.json'
    notes = json.loads(notes_path.read_text())
    notes['version'] = value
    notes['updated_at'] = datetime.datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    share_path = root / 'static/share.html'
    share, count = re.subn(r'(/static/(?:css/canvas-share\.css|js/canvas-share\.js)\?v=)[^"\s]+',
                           lambda match: match[1] + value + '.' + str(int(time.time())), share_path.read_text())
    if count != 2:
        raise ValueError('expected both paired share asset references')
    (root / 'VERSION').write_text(value + '\n')
    notes_path.write_text(json.dumps(notes, ensure_ascii=False, indent=2) + '\n')
    share_path.write_text(share)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--base')
    action.add_argument('--prepare', metavar='YYYY.MM.DD.N')
    args = parser.parse_args()
    if args.prepare:
        prepare(Path.cwd(), args.prepare)
    else:
        verify(Path.cwd(), args.base)
