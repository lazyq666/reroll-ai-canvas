"""Build a credential-free, portable MCP installer from an explicit file allowlist."""
import io
import json
from pathlib import Path
import re
import shlex
from urllib.parse import urlsplit
import zipfile

from fastapi import Request
from fastapi.responses import JSONResponse, Response

ROOT = Path(__file__).resolve().parents[2]
CLIENTS = {'codex', 'claude-code', 'claude-desktop'}
PLATFORMS = {'macos', 'windows'}
PACKAGE_FILES = ('pyproject.toml', 'reroll_mcp.py', 'bridge.py', 'credentials.py')


def catalog(language):
    # Installer copy shares the browser's bilingual authority; only literal JSON
    # entries in the reserved agent.install namespace are exported.
    source = (ROOT / 'static/js/i18n/preferences.js').read_text('utf-8')
    entries = re.findall(r'^\s*"(agent\.install\.[\w]+)":\s*(\{[^\n]+\}),?\s*$', source, re.M)
    return {key: json.loads(value)[language] for key, value in entries}


def build_bundle(options):
    client, platform, language = (options.get(key) for key in ('client', 'platform', 'language'))
    url = options.get('url', '')
    if client not in CLIENTS or platform not in PLATFORMS or language not in {'zh', 'en'} or not isinstance(url, str) or len(url) > 2048:
        raise ValueError('invalid_installer')
    parsed = urlsplit(url)
    if (parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in {'', '/'} or any(ord(c) < 33 for c in url)
            or (not parsed.port and parsed.netloc.endswith(':'))):
        raise ValueError('invalid_installer')
    parsed.port
    messages = catalog(language)
    package = ROOT / 'tools/reroll-mcp'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        def add(name, content, mode=0o644):
            info = zipfile.ZipInfo('Reroll-MCP/' + name)
            info.create_system = 3
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content.encode('utf-8') if isinstance(content, str) else content)
        for filename in PACKAGE_FILES:
            add('mcp/' + filename, (package / filename).read_bytes())
        add('install.py', (package / 'installer/install.py').read_bytes())
        add('settings.json', json.dumps({'client': client, 'platform': platform, 'url': url.rstrip('/'), 'language': language}, ensure_ascii=False))
        add('messages.json', json.dumps(messages, ensure_ascii=False))
        add('README.txt', messages['agent.install.readme'] + '\n\n' + messages['agent.install.address'] + ': ' + url + '\n')
        launchers = ('Install.command',) if platform == 'macos' else ('Install.cmd', 'Install.ps1')
        for filename in launchers:
            script = (package / 'installer' / filename).read_text('utf-8')
            for marker, key in [('START', 'starting'), ('FAIL', 'failed'), ('CLOSE', 'close')]:
                text = messages['agent.install.' + key]
                quoted = shlex.quote(text) if platform == 'macos' else "'" + text.replace("'", "''") + "'"
                script = script.replace('@@' + marker + '@@', quoted)
            if platform == 'windows':
                script = script.replace('\n', '\r\n')
                if filename.endswith('.ps1'):
                    script = '\ufeff' + script  # Windows PowerShell 5.1 UTF-8 detection.
            add(filename, script, 0o755 if platform == 'macos' else 0o644)
    return buffer.getvalue()


def install_routes(app):
    @app.post('/api/account/agent-installer')
    async def download(request: Request):
        actor = getattr(request.state, 'user', None)
        if not actor or actor.get('status') != 'active' or actor.get('role') not in {'admin', 'designer'}:
            return JSONResponse({'code': 'forbidden'}, status_code=403)
        try:
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 4096:
                    raise ValueError()
            options = json.loads(body)
            if not isinstance(options, dict):
                raise ValueError()
            data = build_bundle(options)
        except (ValueError, TypeError):
            return JSONResponse({'code': 'invalid_installer'}, status_code=400)
        return Response(data, media_type='application/zip', headers={
            'Content-Disposition': f'attachment; filename="Reroll-MCP-{options["client"]}-{options["platform"]}.zip"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        })
