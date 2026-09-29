"""Opt-in live handoff probe: random synthetic Workspace IDs, no user data.

REROLL_HANDOFF_PROBE_CONFIG must point to a private database connection file.
Each test removes only its own generated Workspace row, preserving all others.
"""
import json
import os
import unittest
from pathlib import Path

from infinite_canvas.turso_sqlite import TursoConnection
from tests import test_handoff_coordinator as fixtures


@unittest.skipUnless(os.getenv('REROLL_HANDOFF_PROBE_CONFIG'), 'Explicit handoff probe configuration required')
class LiveHandoffTests(fixtures.OnlineHandoffTests):
    def connection_factory(self):
        credentials = json.loads(Path(os.environ['REROLL_HANDOFF_PROBE_CONFIG']).read_text())
        def connect():
            return TursoConnection(credentials['url'], credentials['token'], timeout=15)
        def cleanup():
            from infinite_canvas.handoff_coordinator import HandoffRegister
            with HandoffRegister(connect, self.identity).transaction() as db:
                db.execute('DELETE FROM reroll_handoff_register WHERE workspace_id = ?', (self.identity,))
        self.addCleanup(cleanup)
        return connect

    @unittest.skip('Local SQLite fixture mutation is covered by the unit suite')
    def test_deleted_remote_row_is_not_recreated(self):
        pass
