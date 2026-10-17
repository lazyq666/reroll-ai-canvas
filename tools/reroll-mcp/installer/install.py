"""Portable per-user installation. Messages come from Reroll's shared i18n catalog."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
from urllib.parse import urlsplit

import tomlkit


class InstallError(Exception):
    pass


def config_path(client, home, platform, environ):
    if client == 'codex':
        return Path(environ.get('CODEX_HOME') or home / '.codex').expanduser() / 'config.toml'
    if client == 'claude-code':
        return Path(environ.get('CLAUDE_CONFIG_DIR') or home).expanduser() / '.claude.json'
    if client == 'claude-desktop':
        base = Path(environ.get('APPDATA') or home / 'AppData/Roaming') if platform == 'windows' else home / 'Library/Application Support'
        return base / 'Claude/claude_desktop_config.json'
    raise InstallError('invalid')


def validate(settings):
    if settings.get('client') not in {'codex', 'claude-code', 'claude-desktop'} or settings.get('platform') not in {'macos', 'windows'}:
        raise InstallError('invalid')
    url = settings.get('url', '')
    try:
        parts = urlsplit(url)
        if (parts.scheme not in {'http', 'https'} or not parts.hostname or parts.username or parts.password
                or parts.query or parts.fragment or parts.path not in {'', '/'} or not parts.port and parts.netloc.endswith(':')
                or any(ord(c) < 33 for c in url)):
            raise ValueError()
        parts.port
    except (ValueError, TypeError):
        raise InstallError('invalid') from None
    return url.rstrip('/')


def merge_config(original, client, command, url):
    try:
        doc = tomlkit.parse(original.decode('utf-8')) if client == 'codex' else json.loads(original.decode('utf-8-sig') or '{}')
        key = 'mcp_servers' if client == 'codex' else 'mcpServers'
        if not isinstance(doc, dict) or not isinstance(doc.get(key, {}), dict):
            raise ValueError()
        servers = doc.setdefault(key, {})
        old = servers.get('reroll', {})
        if not isinstance(old, dict) or not isinstance(old.get('env', {}), dict):
            raise ValueError()
        env = dict(old.get('env', {})) if old.get('env', {}).get('REROLL_URL', '').rstrip('/') == url else {}
        env.update(REROLL_URL=url)
        env.setdefault('REROLL_ALLOWED_DIRS', '[]')
        # Preserve client-specific approval/timeout settings, not an obsolete transport.
        entry = {k: v for k, v in old.items() if k not in {'command', 'args', 'env', 'url', 'type', 'headers', 'http_headers', 'bearer_token_env_var'}}
        entry.update(command=str(command), env=env)
        if client == 'claude-code':
            entry['type'] = 'stdio'
        servers['reroll'] = entry
        return (tomlkit.dumps(doc) if client == 'codex' else json.dumps(doc, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    except (ValueError, TypeError, AttributeError, UnicodeError):
        raise InstallError('configInvalid') from None


def read_config(path):
    if path.is_symlink():
        raise InstallError('configInvalid')
    return path.read_bytes() if path.exists() else None


def write_config(path, original, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if read_config(path) != original:
        raise InstallError('configChanged')
    if content == original:
        return None
    backup = None
    if original is not None:
        backup = path.with_name(path.name + '.reroll-backup-' + uuid.uuid4().hex)
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
    fd, temporary = tempfile.mkstemp(prefix='.reroll-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if read_config(path) != original:
            raise InstallError('configChanged')
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return backup


@contextlib.contextmanager
def installation_lock(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / '.install.lock').open('a+b') as lock:
        try:
            if os.name == 'nt':
                import msvcrt
                lock.write(b'0'); lock.flush(); lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise InstallError('busy') from None
        yield


def install(bundle, root, uv, home=None, environ=None, platform=None, report=print):
    settings = json.loads((bundle / 'settings.json').read_text('utf-8'))
    url = validate(settings)
    platform = platform or ('windows' if sys.platform == 'win32' else 'macos' if sys.platform == 'darwin' else 'unsupported')
    if platform != settings['platform']:
        raise InstallError('platformMismatch')
    path = config_path(settings['client'], home or Path.home(), platform, os.environ if environ is None else environ)
    messages = json.loads((bundle / 'messages.json').read_text('utf-8'))
    def say(key, **values):
        report(messages['agent.install.' + key].format(**values))
    with installation_lock(root):
        original = read_config(path)
        # Validate before downloading/installing, without modifying the original.
        merge_config(original or b'', settings['client'], Path('reroll-mcp'), url)
        package = bundle / 'mcp'
        digest = hashlib.sha256()
        digest.update(str(Path(sys.base_prefix).resolve()).encode())
        digest.update(sys.version.encode())
        for file in sorted(package.iterdir()):
            if file.is_file():
                digest.update(file.name.encode()); digest.update(file.read_bytes())
        release = root / 'releases' / digest.hexdigest()[:20]
        python = release / ('Scripts/python.exe' if platform == 'windows' else 'bin/python')
        command = release / ('Scripts/reroll-mcp.exe' if platform == 'windows' else 'bin/reroll-mcp')
        ready = release / '.ready'
        say('installing')
        if not ready.exists():
            if release.exists():
                shutil.rmtree(release)
            try:
                subprocess.run([str(uv), 'venv', '--python', sys.executable, str(release)], check=True)
                subprocess.run([str(uv), 'pip', 'install', '--python', str(python), str(package)], check=True)
                subprocess.run([str(python), '-c', 'import reroll_mcp, mcp, httpx'], check=True)
                if not command.is_file():
                    raise InstallError('failed')
                ready.touch()
            except BaseException:
                shutil.rmtree(release, ignore_errors=True)
                raise
        subprocess.run([str(python), '-c', 'import reroll_mcp, mcp, httpx'], check=True)
        updated = merge_config(original or b'', settings['client'], command, url)
        backup = write_config(path, original, updated)
        say('configured', path=path)
        if backup:
            say('backup', path=backup)
        say('success', url=url)
        return path


def main():
    parser = argparse.ArgumentParser(description='Reroll MCP')
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--uv', type=Path, required=True)
    args = parser.parse_args()
    bundle = Path(__file__).resolve().parent
    messages = json.loads((bundle / 'messages.json').read_text('utf-8'))
    try:
        install(bundle, args.root, args.uv)
    except (InstallError, OSError, ValueError, subprocess.SubprocessError) as error:
        key = str(error) if isinstance(error, InstallError) else 'failed'
        print(messages.get('agent.install.' + key, messages['agent.install.failed']), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
