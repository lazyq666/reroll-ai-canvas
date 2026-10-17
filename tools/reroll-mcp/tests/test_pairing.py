import json
from pathlib import Path
import sys
import tempfile
import unittest
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import Bridge, BridgeError


class PairingTests(unittest.TestCase):
    def test_approval_persists_across_processes_and_revocation_requests_again(self):
        with tempfile.TemporaryDirectory() as directory:
            state = {'approved': False, 'starts': 0, 'token': None}
            def handle(request):
                if request.url.path.endswith('/pairing/start'):
                    state['starts'] += 1
                    return httpx.Response(200, json={'state':'pending','code':'ABC123','expires_at':9999999999})
                if state['approved']:
                    self.assertEqual(request.headers['Authorization'], state['token'])
                    return httpx.Response(200, json={'ok': True})
                return httpx.Response(401, json={'code':'unauthorized'})
            def bridge():
                return Bridge('http://test', client=httpx.Client(base_url='http://test/',transport=httpx.MockTransport(handle)), credential_directory=directory, client_name='Codex')
            first = bridge()
            with self.assertRaises(BridgeError) as error:
                first.request('POST','canvases',body={'title':'should not submit'})
            self.assertEqual(error.exception.code, 'authorization_required')
            self.assertNotIn(first.token, str(error.exception.details))
            state.update(approved=True, token='Bearer '+first.token)
            self.assertTrue(first.request('GET','info')['ok'])
            second = bridge()
            self.assertEqual(second.token, first.token)
            self.assertTrue(second.request('GET','info')['ok'])
            self.assertEqual(state['starts'],1)
            self.assertEqual(second.credentials.path.stat().st_mode & 0o777, 0o600)
            state['approved'] = False
            with self.assertRaisesRegex(BridgeError,'authorization_revoked'):
                second.request('GET','info')
            self.assertNotEqual(second.token, first.token)
            with self.assertRaisesRegex(BridgeError,'authorization_required'):
                second.request('GET','info')

    def test_client_and_server_isolation_and_denial(self):
        with tempfile.TemporaryDirectory() as directory:
            def handle(request):
                if request.url.path.endswith('/start'):
                    return httpx.Response(200,json={'state':'denied'})
                return httpx.Response(401,json={'code':'unauthorized'})
            a=Bridge('http://test',credential_directory=directory,client_name='Codex',client=httpx.Client(base_url='http://test/',transport=httpx.MockTransport(handle)))
            b=Bridge('http://test',credential_directory=directory,client_name='Claude')
            c=Bridge('http://other',credential_directory=directory,client_name='Codex')
            self.assertEqual(len({a.token,b.token,c.token}),3)
            with self.assertRaisesRegex(BridgeError,'authorization_denied'):
                a.request('GET','info')
