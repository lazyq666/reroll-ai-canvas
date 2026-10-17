"""Browser-approved Agent pairing; only credential hashes enter Instance State."""
import json
import re
import secrets
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse


class AgentPairing:
    def __init__(self, auth):
        self.auth = auth
        with auth._connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS agent_pairings (
                id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, code TEXT NOT NULL, ip TEXT NOT NULL,
                expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending'
            )''')

    @staticmethod
    def public(row):
        return {key: row[key] for key in ('id', 'name', 'code', 'ip', 'expires_at', 'state')}

    def start(self, digest, name, ip):
        if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('invalid_pairing')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError('invalid_name')
        now = int(time.time())
        with self.auth._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM agent_pairings WHERE expires_at<=?', (now,))
            row = db.execute('SELECT * FROM agent_pairings WHERE token_hash=?', (digest,)).fetchone()
            if row:
                return self.public(row)
            if db.execute('SELECT 1 FROM agent_tokens WHERE token_hash=?', (digest,)).fetchone():
                raise ValueError('credential_already_used')
            if db.execute('SELECT count(*) FROM agent_pairings').fetchone()[0] >= 32 or db.execute('SELECT count(*) FROM agent_pairings WHERE ip=?', (ip,)).fetchone()[0] >= 5:
                raise ValueError('pairing_rate_limited')
            identifier = uuid.uuid4().hex
            db.execute('INSERT INTO agent_pairings(id,token_hash,name,code,ip,expires_at) VALUES (?,?,?,?,?,?)',
                       (identifier, digest, name.strip(), secrets.token_hex(3).upper(), ip, now + 600))
            return self.public(db.execute('SELECT * FROM agent_pairings WHERE id=?', (identifier,)).fetchone())

    def status(self, token):
        if not isinstance(token, str) or len(token) > 200:
            raise ValueError('invalid_pairing')
        with self.auth._connect() as db:
            row = db.execute('SELECT * FROM agent_pairings WHERE token_hash=? AND expires_at>?',
                             (self.auth._token_hash(token), int(time.time()))).fetchone()
        return self.public(row) if row else {'state': 'expired'}

    def pending(self, actor):
        self.check_actor(actor)
        with self.auth._connect() as db:
            rows = db.execute("SELECT * FROM agent_pairings WHERE state='pending' AND expires_at>? ORDER BY expires_at", (int(time.time()),)).fetchall()
        return {'requests': [self.public(row) for row in rows], 'account': actor['username'],
                'enabled': self.auth.agent_settings()['enabled'], 'can_enable': actor['role'] == 'admin'}

    @staticmethod
    def check_actor(actor):
        if actor.get('role') not in {'admin', 'designer'} or actor.get('status') != 'active':
            raise PermissionError('forbidden')

    def decide(self, actor, identifier, approve):
        self.check_actor(actor)
        if type(approve) is not bool:
            raise ValueError('invalid_pairing')
        now = int(time.time())
        with self.auth._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM agent_pairings WHERE id=? AND expires_at>?', (identifier, now)).fetchone()
            if not row or row['state'] != 'pending':
                raise ValueError('pairing_closed')
            if approve:
                enabled = db.execute("SELECT value FROM agent_preferences WHERE key='enabled'").fetchone()
                if (not enabled or enabled[0] != 'true') and actor['role'] != 'admin':
                    raise PermissionError('agent_access_disabled')
                count = db.execute('SELECT count(*) FROM agent_tokens WHERE user_id=? AND revoked_at IS NULL AND (expires_at=0 OR expires_at>?)', (actor['id'], now)).fetchone()[0]
                if count >= 10:
                    raise ValueError('token_limit')
                db.execute('INSERT INTO agent_tokens(id,user_id,token_hash,name,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,0)',
                           (uuid.uuid4().hex, actor['id'], row['token_hash'], row['name'], '["authoring", "run"]', now))
                if not enabled or enabled[0] != 'true':
                    db.execute("INSERT OR REPLACE INTO agent_preferences VALUES ('enabled','true')")
            db.execute('UPDATE agent_pairings SET state=? WHERE id=?', ('approved' if approve else 'denied', identifier))
        return {'state': 'approved' if approve else 'denied'}

    def install(self, app):
        async def body(request):
            # Pairing never accepts uploads or unbounded client metadata.
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 2048:
                    raise ValueError('invalid_pairing')
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError('invalid_pairing')
            return value

        async def dispatch(request, action):
            try:
                return action(await body(request))
            except (ValueError, PermissionError) as error:
                code = str(error) if str(error) in {'invalid_pairing', 'invalid_name', 'credential_already_used', 'pairing_rate_limited', 'pairing_closed', 'forbidden', 'agent_access_disabled', 'token_limit'} else 'invalid_pairing'
                return JSONResponse(status_code=403 if isinstance(error, PermissionError) else (429 if code == 'pairing_rate_limited' else 400), content={'code': code})

        @app.post('/api/agent/pairing/start')
        async def start(request: Request):
            return await dispatch(request, lambda data: self.start(data.get('token_hash'), data.get('name'), request.client.host if request.client else ''))

        @app.post('/api/agent/pairing/status')
        async def status(request: Request):
            return await dispatch(request, lambda data: self.status(data.get('token')))

        @app.get('/api/account/agent-pairings')
        async def pending(request: Request):
            return self.pending(request.state.user)

        @app.post('/api/account/agent-pairings/{identifier}')
        async def decide(identifier: str, request: Request):
            return await dispatch(request, lambda data: self.decide(request.state.user, identifier, data.get('approve')))
