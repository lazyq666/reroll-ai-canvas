"""Validate the release pair against an explicitly identified previous main."""
import argparse
import datetime
import json
import re
import subprocess
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    args = parser.parse_args()
    verify(Path.cwd(), args.base)
