import json
import tempfile
import unittest
from pathlib import Path
from dataclasses import replace
from unittest.mock import patch

from infinite_canvas.turso_runtime import TursoWorkspaceRuntime
from infinite_canvas.turso_sqlite import TursoError
from tests import test_turso_stores as store_fixtures
from tests import test_generation_run_store as run_fixtures


class TursoRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = store_fixtures.TursoStoreTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.lease.release()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.configuration = Path(self.temp.name) / "connection.json"
        self.configuration.write_text(json.dumps({"schema_version": 1, "workspace_id": "workspace", "url": "https://test.turso.io", "token": "private-test-token"}))

    def open(self, device="device-a", binding="binding"):
        return TursoWorkspaceRuntime(self.configuration, workspace_id="workspace", binding_id=binding, device_id=device, transport=self.fixture.remote)

    def test_rotation_reuses_cloud_records_and_keeps_credentials_out_of_status(self):
        first = self.open()
        with self.assertRaises(TursoError):
            self.open("device-b")
        self.assertEqual(first.public()["status"], "connected")
        self.assertNotIn("private-test-token", json.dumps(first.public()))
        first.close()
        first.close()
        second = self.open("device-b")
        self.addCleanup(second.close)
        self.assertEqual(second.public()["status"], "connected")

    def test_failed_renewal_stops_new_connections_until_restart(self):
        runtime = self.open()
        self.addCleanup(runtime.close)
        self.fixture.remote.database.execute("UPDATE reroll_workspace_lease SET expires_at=0")
        with self.assertRaises(TursoError):
            runtime.renew()
        self.assertEqual(runtime.public()["status"], "unavailable")
        with self.assertRaises(TursoError):
            runtime.connect()

    def test_unfinished_generation_cannot_resume_on_another_device(self):
        first = self.open()
        run = replace(run_fixtures.SqliteGenerationRunStoreContractTests().sample_run(), status="running")
        first.generation_run_store.save(run)
        first.close()
        with self.assertRaisesRegex(TursoError, "original_device_required"):
            self.open("device-b")
        resumed = self.open("device-a")
        self.addCleanup(resumed.close)
        self.assertEqual(resumed.generation_run_store.load(run.run_id).status, "running")

    def test_foreign_credentials_or_binding_cannot_open_a_fallback(self):
        with self.assertRaises(TursoError):
            self.open(binding="another-binding")
        self.configuration.write_text(json.dumps({"schema_version": 1, "workspace_id": "foreign"}))
        with self.assertRaisesRegex(TursoError, "configuration_required"):
            self.open()


if __name__ == "__main__":
    unittest.main()
