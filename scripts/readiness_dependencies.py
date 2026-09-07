"""Re-resolve against the committed pins without editing the candidate lock."""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path


def pins(text):
    return dict(re.findall(r'^([\w.-]+)==([^\s\\]+)', text, re.M))


def verify(uv, root):
    committed = root / 'requirements.lock.txt'
    with tempfile.TemporaryDirectory() as scratch:
        output = Path(scratch) / 'requirements.lock.txt'
        subprocess.run([uv, 'pip', 'compile', 'requirements.txt', '--constraint', str(committed),
                        '--python-version', '3.12', '--generate-hashes', '--output-file', str(output)],
                       cwd=root, check=True)
        if pins(output.read_text()) != pins(committed.read_text()):
            raise ValueError('declarations and lock disagree; regenerate the lock')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--uv', required=True)
    verify(parser.parse_args().uv, Path.cwd())
