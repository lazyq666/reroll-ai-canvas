"""Run every package-declared Node contract, collecting independent failures."""
import json
import shlex
import subprocess
import sys
from pathlib import Path


def main():
    script = json.loads(Path('package.json').read_text())['scripts']['test:node-contracts']
    commands = [shlex.split(command.strip()) for command in script.split('&&')]
    if not commands or any(len(command) != 2 or command[0] != 'node' for command in commands):
        raise ValueError('Node inventory must contain explicit node test entry points')
    failures = sum(subprocess.run(command, check=False).returncode != 0 for command in commands)
    print('READINESS_COUNTS=' + json.dumps({'tests': len(commands), 'skipped': 0, 'failures': failures, 'errors': 0}))
    return int(failures != 0)


if __name__ == '__main__':
    sys.exit(main())
