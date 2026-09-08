import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from infinite_canvas.turso_sqlite import TursoError
from infinite_canvas.turso_workspace_lease import LEASE_SCHEMA, WorkspaceLease


class WorkspaceLeaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'remote.sqlite3'
        with closing(self.connect()) as connection:
            connection.executescript(LEASE_SCHEMA + 'CREATE TABLE canvas (content TEXT);')
            with connection:
                connection.execute(
                    "INSERT INTO reroll_workspace_lease(workspace_id,binding_id,state) VALUES ('workspace','binding','active')"
                )
        self.a = self.device()
        self.b = self.device()

    def connect(self):
        return sqlite3.connect(self.path)

    def device(self, **kwargs):
        return WorkspaceLease(self.connect, workspace_id='workspace', binding_id='binding', **kwargs)

    def scalar(self, sql):
        with closing(self.connect()) as connection:
            return connection.execute(sql).fetchone()[0]

    def expire(self):
        with closing(self.connect()) as connection:
            with connection:
                connection.execute('UPDATE reroll_workspace_lease SET expires_at = 0')

    def test_alternating_devices_read_latest_and_stale_writer_is_fenced(self):
        old = self.a.acquire()
        with old.transaction(self.connect) as connection:
            connection.execute("INSERT INTO canvas VALUES ('saved by A')")
        with self.assertRaises(TursoError):
            self.b.acquire()
        self.a.release()
        new = self.b.acquire()
        self.assertGreater(new.epoch, old.epoch)
        with new.transaction(self.connect) as connection:
            self.assertEqual(connection.execute('SELECT content FROM canvas').fetchone()[0], 'saved by A')
            connection.execute("UPDATE canvas SET content = 'saved by B'")
        with self.assertRaises(TursoError):
            with old.transaction(self.connect) as connection:
                connection.execute("UPDATE canvas SET content = 'stale A'")
        self.assertEqual(self.scalar('SELECT content FROM canvas'), 'saved by B')

    def test_lost_device_cannot_renew_release_or_write_over_new_owner(self):
        old = self.a.acquire()
        self.expire()
        new = self.b.acquire()
        with self.assertRaises(TursoError):
            self.a.renew()
        with self.assertRaises(TursoError):
            self.a.acquire()
        self.a.release()
        with new.transaction(self.connect) as connection:
            connection.execute("INSERT INTO canvas VALUES ('new owner')")
        with self.assertRaises(TursoError):
            with old.transaction(self.connect):
                self.fail('Stale owner admitted')

    def test_expired_fence_before_commit_rolls_back_business_write(self):
        fence = self.a.acquire()
        with self.assertRaises(TursoError):
            with fence.transaction(self.connect) as connection:
                connection.execute("INSERT INTO canvas VALUES ('unconfirmed')")
                # Simulates the database clock crossing the lease deadline
                # while business logic is running in the same transaction.
                connection.execute('UPDATE reroll_workspace_lease SET expires_at = 0')
        self.assertEqual(self.scalar('SELECT count(*) FROM canvas'), 0)

    def test_repeated_acquire_retains_incarnation_and_epoch(self):
        first = self.a.acquire()
        second = self.a.acquire()
        self.assertEqual(first, second)
        self.a.renew()
        self.assertEqual(self.scalar('SELECT epoch FROM reroll_workspace_lease'), first.epoch)

    def test_uncertain_renewal_revokes_previously_issued_local_fence(self):
        fence = self.a.acquire()
        def unavailable():
            raise OSError('Network unavailable')
        self.a._connect = unavailable
        with self.assertRaises(OSError):
            self.a.renew()
        # The database lease is still valid, but this incarnation may not use
        # an old fence after it has lost confirmation of its renewal.
        with self.assertRaises(TursoError):
            with fence.transaction(self.connect):
                self.fail('Locally revoked fence admitted')

    def test_staging_retired_and_foreign_bindings_cannot_edit(self):
        foreign = WorkspaceLease(self.connect, workspace_id='workspace', binding_id='foreign')
        with self.assertRaises(TursoError):
            foreign.acquire()
        for state in ['staging', 'retired']:
            with closing(self.connect()) as connection:
                with connection:
                    connection.execute('UPDATE reroll_workspace_lease SET state = ?', (state,))
            with self.assertRaises(TursoError):
                self.device().acquire()


if __name__ == '__main__':
    unittest.main()
