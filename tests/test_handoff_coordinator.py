import json
import shutil
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from infinite_canvas.handoff_coordinator import OnlineHandoff, HandoffRegister, digest
from infinite_canvas.workspace_handoff import WorkspaceHandoff, HandoffError
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage
from infinite_canvas.sqlite_workspace_bootstrap import bootstrap_fresh_workspace_sqlite
from infinite_canvas.content import WorkspaceContent


class OnlineHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / "a"
        (self.workspace / "data").mkdir(parents=True)
        (self.workspace / "assets").mkdir()
        self.storage = WorkspaceStorage(self.root / "app", state_dir=self.root / "device-a")
        self.storage.save_parent(self.workspace)
        self.service = WorkspaceService(self.storage)
        self.identity = self.service.ensure_identity()
        bootstrap_fresh_workspace_sqlite(WorkspaceContent(self.service.current()), workspace_id=self.identity)
        (self.workspace / "assets/media.png").write_bytes(b"first")
        self.connect = self.connection_factory()
        self.a = WorkspaceHandoff(self.workspace, self.storage.state_dir, self.identity, "a")
        self.settings = dict(version=1, workspace_id=self.identity, url="libsql://handoff-test.turso.io", token="test-token")
        self.oa = OnlineHandoff(self.a, connect=self.connect, settings=self.settings)
        self.oa.register.prepare_schema()
        self.oa.enroll()
        self.patcher = patch("infinite_canvas.handoff_coordinator.TursoConnection", side_effect=lambda *a, **k: self.connect())
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def connection_factory(self):
        return lambda: sqlite3.connect(self.root / "cloud.sqlite3", timeout=10)

    def other(self, name="b"):
        root = self.root / name
        shutil.copytree(self.workspace, root)
        handoff = WorkspaceHandoff(root, self.root / ("device-" + name), self.identity, name)
        online = OnlineHandoff(handoff, connect=self.connect, settings=self.settings)
        online.install()
        return handoff, online

    def test_complete_rotation_and_old_owner_cannot_reopen(self):
        self.a.acquire()
        result = self.a.seal()
        self.assertTrue(result["exit_server"])
        b, ob = self.other()
        b.acquire()
        self.assertEqual("b", ob.register.read()["owner"])
        self.assertEqual("active", ob.register.read()["state"])
        with self.assertRaisesRegex(HandoffError, "onlineBusy"):
            self.a.acquire()
        (b.root / "assets/media.png").write_bytes(b"second")
        b.seal()
        shutil.rmtree(self.workspace)
        shutil.copytree(b.root, self.workspace)
        self.a.acquire()
        self.assertEqual("a", self.oa.register.read()["owner"])
        self.assertEqual(b"second", (self.workspace / "assets/media.png").read_bytes())

    def test_foreign_active_is_never_taken_over(self):
        b, _ = self.other()
        with self.assertRaisesRegex(HandoffError, "onlineBusy"):
            b.acquire("a" * 32)

    def test_partial_sync_does_not_claim(self):
        self.a.seal()
        b, ob = self.other()
        (b.root / "assets/media.png").unlink()
        with self.assertRaisesRegex(HandoffError, "changed"):
            b.acquire()
        self.assertEqual("sealed", ob.register.read()["state"])
        (b.root / "assets/media.png").write_bytes(b"first")
        b.acquire()
        self.assertEqual("active", ob.register.read()["state"])

    def test_complete_old_seal_is_not_latest(self):
        self.a.seal()
        b, _ = self.other()
        self.a.acquire()
        (self.a.root / "assets/media.png").write_bytes(b"new")
        self.a.seal()
        with self.assertRaisesRegex(HandoffError, "onlineWaiting"):
            b.acquire()

    def test_simultaneous_receivers_exactly_one_wins(self):
        self.a.seal()
        b, _ = self.other()
        c, _ = self.other("c")
        def run(h):
            try:
                h.acquire()
                return True
            except HandoffError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(1, sum(pool.map(run, (b, c))))

    def test_lost_claim_response_recovers_same_operation(self):
        self.a.seal()
        b, ob = self.other()
        original = HandoffRegister.change
        def lost(register, expected, **updates):
            result = original(register, expected, **updates)
            if updates.get("state") == "receiving":
                raise HandoffError("onlineUnavailable")
            return result
        with patch.object(HandoffRegister, "change", lost):
            with self.assertRaisesRegex(HandoffError, "onlineUnavailable"):
                b.acquire()
        session = ob.register.read()["session"]
        b.acquire()
        self.assertEqual(session, ob.register.read()["session"])
        self.assertEqual("active", ob.register.read()["state"])

    def test_lost_finalize_response_recovers_without_second_claim(self):
        self.a.seal()
        b, ob = self.other()
        original = HandoffRegister.change
        def lost(register, expected, **updates):
            result = original(register, expected, **updates)
            if updates.get("state") == "active":
                raise HandoffError("onlineUnavailable")
            return result
        with patch.object(HandoffRegister, "change", lost):
            with self.assertRaises(HandoffError):
                b.acquire()
        revision = ob.register.read()["revision"]
        b.acquire()
        self.assertEqual(revision, ob.register.read()["revision"])

    def test_lost_publish_response_can_retry(self):
        original = HandoffRegister.change
        def lost(register, expected, **updates):
            result = original(register, expected, **updates)
            if updates.get("state") == "sealed":
                raise HandoffError("onlineUnavailable")
            return result
        with patch.object(HandoffRegister, "change", lost):
            with self.assertRaises(HandoffError):
                self.a.seal()
        self.assertTrue(self.a.seal()["exit_server"])

    def test_restart_after_local_seal_finishes_publish_without_writers(self):
        self.oa.begin_seal()
        self.a._seal_local()
        with self.assertRaisesRegex(HandoffError, "onlinePublished"):
            self.a.acquire()
        self.assertEqual("sealed", self.oa.register.read()["state"])

    def test_missing_credentials_cannot_fall_back_to_manual_code(self):
        self.a.seal()
        b, ob = self.other()
        ob.config_path.unlink()
        with self.assertRaisesRegex(HandoffError, "onlineConfiguration"):
            b.acquire(self.a.read()["id"])

    def test_deleted_remote_row_is_not_recreated(self):
        with self.connect() as db:
            db.execute("DELETE FROM reroll_handoff_register")
        with self.assertRaisesRegex(HandoffError, "onlineUnregistered"):
            self.a.acquire()

    def test_connection_file_is_private_and_not_in_workspace(self):
        self.assertEqual(0o600, self.oa.config_path.stat().st_mode & 0o777)
        self.assertFalse(self.oa.config_path.is_relative_to(self.workspace))
        self.assertNotIn("token", self.oa.marker_path.read_text())

    def test_marker_binding_mismatch_fails_closed(self):
        self.a._write(self.oa.marker_path, {**self.oa.marker, "binding": "wrong"})
        with self.assertRaisesRegex(HandoffError, "onlineConfiguration"):
            self.a.acquire()

    def test_same_device_unclean_active_can_recover_but_other_device_cannot(self):
        self.a.seal()
        b, ob = self.other()
        b.acquire()
        b.acquire()
        ob.receipt_path.unlink()
        with self.assertRaisesRegex(HandoffError, "onlineBusy"):
            b.acquire()

    def test_conflict_file_does_not_claim(self):
        self.a.seal()
        b, ob = self.other()
        shutil.copyfile(b.path, b.path.with_name("handoff-conflict.json"))
        with self.assertRaisesRegex(HandoffError, "conflict"):
            b.acquire()
        self.assertEqual("sealed", ob.register.read()["state"])

    def test_os_lock_still_blocks_same_installation(self):
        occupation = self.service.acquire_occupation("a")
        try:
            with self.assertRaises(Exception):
                self.service.acquire_occupation("a")
        finally:
            occupation.release()

    def test_lost_publish_followed_by_receiver_still_confirms_source_close(self):
        self.oa.begin_seal()
        self.a._seal_local()
        record = self.a.read()
        remote = self.oa.register.read()
        self.oa.register.change(remote, state='sealed', handoff_id=record['id'], digest=digest(record))
        b, _ = self.other()
        b.acquire()
        self.assertTrue(self.a.seal()['exit_server'])
        with self.assertRaisesRegex(HandoffError, 'onlineBusy'):
            self.a.acquire()

    def test_restart_after_unknown_publish_never_reopens_writers(self):
        self.oa.begin_seal()
        self.a._seal_local()
        record = self.a.read()
        self.oa.register.change(self.oa.register.read(), state='sealed', handoff_id=record['id'], digest=digest(record))
        with self.assertRaisesRegex(HandoffError, 'onlinePublished'):
            self.a.acquire()
        self.assertEqual('sealed', self.oa.register.read()['state'])

    def test_network_error_cannot_admit_second_device(self):
        b, _ = self.other()
        with patch.object(HandoffRegister, 'read', side_effect=HandoffError('onlineUnavailable')):
            with self.assertRaisesRegex(HandoffError, 'onlineUnavailable'):
                b.acquire()
        self.assertIsNone(b.read())
        self.assertEqual('a', self.oa.register.read()['owner'])

    def test_pairing_refuses_to_change_running_installation(self):
        import runpy
        configure = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/configure_handoff.py"))["configure"]
        from infinite_canvas.device_state import DeviceState
        # Use the real installation identity for the held guard.
        occupation = self.service.acquire_occupation('a')
        try:
            with self.assertRaisesRegex(HandoffError, 'occupied'):
                configure(self.storage, self.settings)
        finally:
            occupation.release()

    def test_pairing_preserves_cloud_owner_and_remembers_workspace(self):
        import runpy
        configure = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/configure_handoff.py"))["configure"]
        from infinite_canvas.device_state import DeviceState
        b, ob = self.other()
        storage = WorkspaceStorage(self.root / 'app-b', state_dir=self.root / 'device-b')
        storage.save_parent(b.root)
        original = ob.register.read()
        configure(storage, self.settings)
        self.assertEqual(original, ob.register.read())
        self.assertEqual(self.identity, DeviceState(storage.state_dir).workspace_identity())

    def test_lost_finalize_still_checks_files_before_first_store_open(self):
        self.a.seal()
        b, ob = self.other()
        original = HandoffRegister.change
        def lost(register, expected, **updates):
            result = original(register, expected, **updates)
            if updates.get('state') == 'active': raise HandoffError('onlineUnavailable')
            return result
        with patch.object(HandoffRegister, 'change', lost):
            with self.assertRaises(HandoffError): b.acquire()
        (b.root / 'assets/media.png').write_bytes(b'late-sync')
        with self.assertRaisesRegex(HandoffError, 'changed'): b.acquire()
        (b.root / 'assets/media.png').write_bytes(b'first')
        b.acquire()
        self.assertEqual('active', ob.receipt()['phase'])
