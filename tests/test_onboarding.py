import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from infinite_canvas.auth_system import AuthSystem, install_auth_routes, install_access_control
from infinite_canvas.onboarding import OnboardingPorts, install_onboarding_routes


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.auth = AuthSystem(Path(self.tmp.name) / "accounts.sqlite")
        self.admin = self.auth.create_initial_admin(
            username="designer", password="sample-password", start_onboarding=True,
        )
        self.providers = {}
        self.calls = []
        self.valid = True
        self.empty_models = False
        self.unrecommended_models = False
        self.cli = {"installed": True, "logged_in": True, "image2_helper_installed": True}

        async def save(config, key, models, *, expected=None):
            provider = {**self.providers.get(config["id"], {}), **config}
            if key:
                provider["secret"] = key
            if models is not None:
                provider.update(models)
                provider["enabled"] = True
            else:
                provider.setdefault("enabled", False)
            self.providers[provider["id"]] = provider
            self.calls.append("save-models" if models is not None else "save-key")
            return provider

        async def test(config):
            self.calls.append("test")
            return {"ok": self.valid, "protocol": config["protocol"]}

        async def models(config):
            self.calls.append("models")
            return {"image_models": [] if self.empty_models else ["flux-2" if self.unrecommended_models else "gpt-image-2"],
                    "chat_models": [], "video_models": []}

        async def cli_status(service):
            return self.cli

        self.fingerprint = lambda provider: hashlib.sha256(json.dumps(provider, sort_keys=True).encode()).hexdigest()
        self.app = FastAPI()
        install_auth_routes(self.app, self.auth)
        install_access_control(self.app, self.auth)
        install_onboarding_routes(self.app, self.auth, OnboardingPorts(
            load=lambda: list(self.providers.values()), save=save, test=test, models=models,
            cli_status=cli_status, fingerprint=self.fingerprint,
            workspace=lambda: {"configured_workspace_directory": "/sample/workspace"},
        ))
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.client.post("/api/auth/login", json={"username":"designer","password":"sample-password"})

    def connect(self, service="apimart", **kwargs):
        response = self.client.post("/api/admin/onboarding/connect", json={
            "service":service, "api_key":"sample-secret-do-not-return", **kwargs,
        })
        self.assertEqual(200, response.status_code)
        self.assertNotIn("sample-secret", response.text)
        return [json.loads(line) for line in response.text.splitlines()]

    def test_order_and_completed_source_survive_restart(self):
        events = self.connect()
        self.assertEqual(["saving","verifying","fetching","complete"], [e["stage"] for e in events])
        self.assertEqual(["save-key","test","models","save-models"], self.calls)
        reopened = AuthSystem(self.auth.database_path)
        self.assertTrue(reopened.onboarding_status()["pending"])
        self.assertIn("apimart", reopened.onboarding_status()["services"])
        response = self.client.get("/api/admin/onboarding")
        self.assertEqual(1, response.json()["services"]["apimart"]["count"])
        self.assertNotIn("fingerprint", response.text)
        self.assertEqual(303, self.client.get("/", follow_redirects=False).status_code)
        self.assertEqual("/setup", self.client.get("/", follow_redirects=False).headers["location"])
        self.assertEqual("/static/canvas-list.html", self.client.post("/api/admin/onboarding/complete", json={}).json()["next_url"])
        self.assertFalse(reopened.onboarding_status()["pending"])

    def test_requires_verified_source_and_invalidates_changed_configuration(self):
        self.assertEqual(409, self.client.post("/api/admin/onboarding/complete", json={}).status_code)
        self.connect()
        self.providers["apimart"]["secret"]="changed-secret"
        self.assertEqual({}, self.client.get("/api/admin/onboarding").json()["services"])
        self.assertEqual(409, self.client.post("/api/admin/onboarding/complete", json={}).status_code)

    def test_failed_second_service_preserves_first(self):
        self.connect()
        before = dict(self.providers["apimart"])
        self.valid = False
        self.assertEqual("connection_failed", self.connect("modelscope")[-1]["code"])
        self.assertEqual(before, self.providers["apimart"])
        self.assertEqual({"apimart"}, set(self.client.get("/api/admin/onboarding").json()["services"]))
        self.assertEqual(200, self.client.post("/api/admin/onboarding/complete", json={}).status_code)

    def test_empty_model_result_does_not_complete(self):
        self.empty_models=True
        self.assertEqual("no_models",self.connect()[-1]["code"])
        self.assertFalse(self.providers["apimart"]["enabled"])
        self.assertEqual(409,self.client.post("/api/admin/onboarding/complete",json={}).status_code)

    def test_no_recommended_models_does_not_enable_unrelated_models(self):
        self.unrecommended_models=True
        self.assertEqual("no_recommended_models",self.connect()[-1]["code"])
        self.assertFalse(self.providers["apimart"]["enabled"])
        self.assertEqual(409,self.client.post("/api/admin/onboarding/complete",json={}).status_code)

    def test_cli_requires_verified_login_and_usable_version(self):
        self.cli["logged_in"]=None
        self.assertEqual("login_unverified",self.connect("codex")[-1]["code"])
        self.assertEqual({},self.providers)
        self.cli["logged_in"]=True
        self.cli["version_ok"]=False
        self.assertEqual("cli_outdated",self.connect("jimeng")[-1]["code"])
        self.cli["version_ok"]=True
        self.assertEqual("complete",self.connect("jimeng")[-1]["stage"])

    def test_cli_without_image_helper_cannot_claim_image_models(self):
        self.cli["image2_helper_installed"]=False
        self.assertEqual("no_models",self.connect("codex")[-1]["code"])

    def test_other_api_has_stable_identity_and_reveals_failed_detection(self):
        self.valid=False
        self.assertEqual("auto_failed",self.connect("other",name="Example",base_url="https://example.com/v1")[-1]["code"])
        self.valid=True
        self.assertEqual("complete",self.connect("other",name="Example",base_url="https://example.com/v1",protocol="gemini")[-1]["stage"])
        self.assertEqual(1,len(self.providers))
        self.assertEqual("gemini",next(iter(self.providers.values()))["protocol"])

    def test_mutations_are_admin_local_and_same_origin_only(self):
        response=self.client.post("/api/admin/onboarding/complete",json={},headers={"Origin":"https://external.example"})
        self.assertEqual(403,response.status_code)
        self.client.post("/api/auth/logout")
        self.assertEqual(401,self.client.get("/api/admin/onboarding").status_code)
        self.auth.create_user(username="viewer",password="sample-password",role="designer")
        self.client.post("/api/auth/login",json={"username":"viewer","password":"sample-password"})
        self.assertEqual(403,self.client.get("/api/admin/onboarding").status_code)

    def test_other_installation_sharing_accounts_is_not_redirected(self):
        other=AuthSystem(self.auth.database_path, onboarding_scope="another-installation")
        self.assertFalse(other.onboarding_status()["pending"])
        other.finish_onboarding()
        self.assertTrue(self.auth.onboarding_status()["pending"])

    def test_legacy_progress_schema_is_upgraded_without_losing_progress(self):
        import sqlite3
        path=Path(self.tmp.name)/"legacy.sqlite"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE onboarding_progress (id INTEGER PRIMARY KEY CHECK(id=1), pending INTEGER NOT NULL, services_json TEXT NOT NULL)")
            db.execute("INSERT INTO onboarding_progress VALUES (1,1,?)",(json.dumps({"apimart":{"fingerprint":"retained"}}),))
        migrated=AuthSystem(path,onboarding_scope="original-installation")
        self.assertTrue(migrated.onboarding_status()["pending"])
        self.assertEqual("retained",migrated.onboarding_status()["services"]["apimart"]["fingerprint"])
        self.assertFalse(AuthSystem(path,onboarding_scope="another-installation").onboarding_status()["pending"])
        self.assertTrue(AuthSystem(path,onboarding_scope="original-installation").onboarding_status()["pending"])

    def test_remote_admin_cannot_configure_local_services(self):
        with TestClient(self.app, client=("192.168.1.9", 1234)) as remote:
            remote.post("/api/auth/login",json={"username":"designer","password":"sample-password"})
            self.assertEqual(403,remote.get("/api/admin/onboarding").status_code)
            self.assertEqual(403,remote.post("/api/admin/onboarding/connect",json={"service":"apimart","api_key":"sample"}).status_code)
            self.assertEqual(403,remote.post("/api/admin/onboarding/complete",json={}).status_code)

    def test_existing_installations_are_not_forced_into_new_onboarding(self):
        other=AuthSystem(Path(self.tmp.name)/"existing.sqlite")
        other.create_initial_admin(username="existing",password="sample-password")
        self.assertFalse(other.onboarding_status()["pending"])

    def test_rejects_credentials_in_custom_urls(self):
        response=self.client.post("/api/admin/onboarding/connect",json={"service":"other","name":"Example","base_url":"https://secret@example.com","api_key":"sample"})
        self.assertEqual(400,response.status_code)
        self.assertEqual({},self.providers)


if __name__ == "__main__":
    unittest.main()
