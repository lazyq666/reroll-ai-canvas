import hashlib
import secrets
import unittest
from concurrent.futures import ThreadPoolExecutor
from tests import test_agent_api
from infinite_canvas.auth_system import SESSION_COOKIE


class PairingTests(unittest.TestCase):
    setUp = test_agent_api.AgentApiTests.setUp

    def start(self, token=None):
        token = token or 'reroll_agent_' + secrets.token_urlsafe(32)
        self.client.headers.pop('Authorization', None)
        response = self.client.post('/api/agent/pairing/start', json={'name': 'Codex', 'token_hash': hashlib.sha256(token.encode()).hexdigest()})
        return token, response

    def login(self, actor=None):
        self.client.headers.pop('Authorization', None)
        self.client.cookies.set(SESSION_COOKIE, self.auth.create_session((actor or self.admin)['id']))

    def test_approve_forever_bound_to_approving_account_and_revoke(self):
        token, response = self.start()
        self.assertEqual(response.status_code, 200)
        request = response.json()
        self.assertNotIn(token, response.text)
        with self.assertRaises(PermissionError):
            self.auth.authenticate_agent(token, '')
        self.login(self.other)
        pending = self.client.get('/api/account/agent-pairings').json()
        self.assertEqual(pending['account'], 'other')
        result = self.client.post('/api/account/agent-pairings/'+request['id'], json={'approve': True})
        self.assertEqual(result.status_code, 200)
        actor, grant = self.auth.authenticate_agent(token, '')
        self.assertEqual(actor['id'], self.other['id'])
        self.assertEqual(grant['scopes'], ['authoring', 'run'])
        issued = self.auth.list_agent_tokens(self.other)[0]
        self.assertEqual(issued['expires_at'], 0)
        self.auth.revoke_agent_token(self.other, issued['id'])
        with self.assertRaises(PermissionError):
            self.auth.authenticate_agent(token, '')

    def test_anonymous_cross_site_and_bearer_cannot_approve(self):
        token, response = self.start()
        path = '/api/account/agent-pairings/'+response.json()['id']
        self.assertEqual(self.client.post(path, json={'approve':True}).status_code, 401)
        self.login()
        self.assertEqual(self.client.post(path, json={'approve':True}, headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.post('/api/agent/pairing/start', json={'name':'X','token_hash':'a'*64}, headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.post(path, json={'approve':True}, headers={'Authorization':'Bearer '+self.token['token']}).status_code,401)

    def test_denial_expiry_and_limits(self):
        token, response = self.start()
        self.login()
        self.assertEqual(self.client.post('/api/account/agent-pairings/'+response.json()['id'], json={'approve':False}).json()['state'], 'denied')
        self.assertEqual(self.start(token)[1].json()['state'], 'denied')
        self.assertEqual(self.api.pairing.status(token)['state'], 'denied')
        self.assertEqual(self.api.pairing.status('wrong')['state'], 'expired')
        with self.auth._connect() as db:
            db.execute('UPDATE agent_pairings SET expires_at=0')
        with self.assertRaises(ValueError):
            self.api.pairing.decide(self.admin, response.json()['id'], True)
        for _ in range(5):
            self.assertEqual(self.start()[1].status_code, 200)
        self.assertEqual(self.start()[1].status_code, 429)

    def test_disabled_server_admin_approval_enables_but_designer_cannot(self):
        self.auth.save_agent_settings(self.admin, {'enabled': False})
        token, response = self.start()
        identifier = response.json()['id']
        with self.assertRaises(PermissionError):
            self.api.pairing.decide(self.other, identifier, True)
        self.assertFalse(self.auth.agent_settings()['enabled'])
        self.api.pairing.decide(self.admin, identifier, True)
        self.assertTrue(self.auth.agent_settings()['enabled'])
        self.assertEqual(self.auth.authenticate_agent(token, '')[0]['id'], self.admin['id'])

    def test_simultaneous_approval_only_one_account_gets_token(self):
        token, response = self.start()
        def approve(actor):
            try:
                return self.api.pairing.decide(actor, response.json()['id'], True)['state']
            except ValueError:
                return 'closed'
        with ThreadPoolExecutor() as pool:
            results = list(pool.map(approve, [self.admin, self.other]))
        self.assertEqual(sorted(results), ['approved', 'closed'])
        with self.auth._connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM agent_tokens WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()[0], 1)

    def test_validation_and_token_limit_rollback(self):
        self.client.headers.pop('Authorization')
        self.assertEqual(self.client.post('/api/agent/pairing/start', content='x'*2049).status_code,400)
        self.assertEqual(self.client.post('/api/agent/pairing/start', json={'name':'x','token_hash':{}}).status_code,400)
        token, response = self.start()
        for i in range(9):
            self.auth.create_agent_token(self.admin, str(i), ['authoring'])
        with self.assertRaisesRegex(ValueError, 'token_limit'):
            self.api.pairing.decide(self.admin, response.json()['id'], True)
        self.assertEqual(self.api.pairing.status(token)['state'], 'pending')
