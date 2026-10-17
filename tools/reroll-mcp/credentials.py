"""Private, per-server/client credential cache for browser pairing."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile


class Credentials:
    def __init__(self, url, name, directory=None):
        self.name = name
        directory = Path(directory or Path.home() / '.config' / 'reroll' / 'mcp').expanduser().resolve()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        identity = hashlib.sha256((url.rstrip('/') + '\n' + name).encode()).hexdigest()
        self.path = directory / (identity + '.json')
        try:
            self.data = json.loads(self.path.read_text())
            if not isinstance(self.data.get('token'), str) or not self.data['token'].startswith('reroll_agent_') or type(self.data.get('approved')) is not bool:
                raise ValueError('invalid credential')
        except FileNotFoundError:
            self.data = {'token': 'reroll_agent_' + secrets.token_urlsafe(32), 'approved': False}
            self.save(create=True)
            self.data = json.loads(self.path.read_text())

    def save(self, create=False):
        fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix='.credential-')
        try:
            with os.fdopen(fd, 'w') as output:
                json.dump(self.data, output)
                output.flush()
                os.fsync(output.fileno())
            if create:
                try:
                    os.link(temporary, self.path)
                except FileExistsError:
                    pass  # Another MCP process created the same identity first.
            else:
                os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def reset(self):
        self.data = {'token': 'reroll_agent_' + secrets.token_urlsafe(32), 'approved': False}
        self.save()
