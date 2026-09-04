import asyncio
import gzip
import unittest
from unittest import mock

from infinite_canvas.cli_updates import (
    AntigravityAdapter,
    CliAdapter,
    CliUpdateError,
    CliUpdateManager,
    CodexAdapter,
    DreaminaAdapter,
    _default_fetch,
    compare_versions,
    parse_version,
)


class StaticAdapter(CliAdapter):
    def __init__(self, cli_id="codex", *, local="1.0.0", remote="1.1.0", channel="npm"):
        super().__init__(cli_id, cli_id.title(), lambda: "/tmp/fake", "https://example.test/release", "https://example.test")
        self.local_version = local
        self.remote_version = remote
        self.detected_channel = channel

    def local(self):
        return {
            "installed": True,
            "path": "/tmp/fake",
            "version": self.local_version,
            "raw_version": self.local_version,
        }

    def remote(self, channel=""):
        return {
            "version": self.remote_version,
            "release_date": "2026-09-04",
            "release_notes": "<script>bad()</script> Useful fixes",
        }

    def channel(self, executable):
        return self.detected_channel

class VersionComparisonTests(unittest.TestCase):
    def test_stable_and_prerelease_ordering(self):
        self.assertEqual(compare_versions("v1.2.3", "1.2.3"), 0)
        self.assertEqual(compare_versions("1.2.3-beta.2", "1.2.3"), -1)
        self.assertEqual(compare_versions("1.2.4", "1.2.3"), 1)
        self.assertTrue(parse_version("codex-cli 2.0.0-rc.1").is_prerelease)

    def test_unrecognized_build_is_not_guessed(self):
        self.assertIsNone(compare_versions("commit 34f0ca9", "1.2.3"))


class AdapterTests(unittest.TestCase):
    def test_default_fetch_decodes_gzip_response(self):
        class Response:
            headers = {"Content-Encoding": "gzip", "Content-Type": "text/html"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit):
                return gzip.compress(b"<h2>Antigravity CLI</h2>")

        with mock.patch("urllib.request.urlopen", return_value=Response()):
            body, _headers = _default_fetch("https://example.test/download")
        self.assertEqual(body, b"<h2>Antigravity CLI</h2>")

    def test_same_and_older_remote_versions_are_current(self):
        self.assertEqual(StaticAdapter(local="1.1.0", remote="1.1.0").check()["state"], "current")
        self.assertEqual(StaticAdapter(local="2.0.0", remote="1.9.9").check()["state"], "current")

    def test_network_timeout_and_rate_limit_are_failures_not_current(self):
        for error in (TimeoutError("offline"), RuntimeError("HTTP 429")):
            adapter = StaticAdapter()
            adapter.remote = mock.Mock(side_effect=error)
            result = adapter.check()
            self.assertEqual(result["state"], "check_failed")
            self.assertFalse(result["update_available"])

    def test_missing_release_notes_is_explicit(self):
        adapter = StaticAdapter()
        adapter.remote = lambda channel="": {"version": "1.1.0", "release_date": "", "release_notes": ""}
        result = adapter.check()
        self.assertEqual(result["state"], "update_available")
        self.assertFalse(result["release_notes_available"])

    def test_not_installed_never_fetches_remote(self):
        adapter = StaticAdapter()
        adapter.local = lambda: {"installed": False, "path": "", "version": "", "raw_version": ""}
        adapter.remote = mock.Mock(side_effect=AssertionError("must not fetch"))
        self.assertEqual(adapter.check()["state"], "not_installed")
        adapter.remote.assert_not_called()

    def test_detected_executable_with_failed_version_command_is_uncomparable(self):
        adapter = StaticAdapter()
        adapter.executable = lambda: __file__
        adapter.local = CliAdapter.local.__get__(adapter, StaticAdapter)
        with mock.patch(
            "infinite_canvas.cli_updates._run_version",
            return_value=(False, "version flag unsupported"),
        ):
            result = adapter.check()
        self.assertEqual(result["state"], "uncomparable")
        self.assertTrue(result["installed"])

    def test_dreamina_metadata_and_malicious_notes_are_plain_text(self):
        adapter = DreaminaAdapter(
            "jimeng",
            "Dreamina CLI",
            lambda: "/tmp/dreamina",
            "https://example.test/version.json",
            "https://example.test",
            fetch=lambda *_args, **_kwargs: (
                b'{"version":"1.2.0","release_date":"2026-09-04","release_notes":"<img src=x onerror=bad()>Fix"}',
                {},
            ),
        )
        adapter.local = lambda: {
            "installed": True,
            "path": "/tmp/dreamina",
            "version": "1.1.0",
            "raw_version": "dreamina 1.1.0",
        }
        result = adapter.check()
        self.assertEqual(result["state"], "update_available")
        self.assertNotIn("<img", result["release_notes"])

    def test_dreamina_uses_controlled_wsl_command_builder_and_keeps_commit_identity(self):
        adapter = DreaminaAdapter("jimeng", "Dreamina CLI", lambda: __file__, "", "")
        adapter.version_command = lambda flag: ["wsl.exe", "dreamina", flag]
        with mock.patch(
            "infinite_canvas.cli_updates._run_version_command",
            side_effect=[
                (True, '{"version":"34f0ca9","commit":"34f0ca9"}'),
                (False, "unsupported"),
                (False, "unsupported"),
            ],
        ) as run:
            local = adapter.local()
        self.assertTrue(local["installed"])
        self.assertEqual(local["version"], "")
        self.assertEqual(local["local_display_version"], "34f0ca9")
        self.assertIn("34f0ca9", local["raw_version"])
        self.assertEqual(run.call_args_list[0].args[0], ["wsl.exe", "dreamina", "--version"])

    def test_commit_only_version_is_uncomparable(self):
        adapter = StaticAdapter(local="", remote="1.1.0")
        adapter.local = lambda: {
            "installed": True,
            "path": "/tmp/fake",
            "version": "",
            "raw_version": "build 34f0ca9",
        }
        self.assertEqual(adapter.check()["state"], "uncomparable")

    def test_codex_rejects_prerelease_latest_payload(self):
        adapter = CodexAdapter(
            "codex",
            "Codex CLI",
            lambda: "/tmp/codex",
            "https://example.test/latest",
            "https://example.test",
            fetch=lambda *_args, **_kwargs: (
                b'{"tag_name":"v2.0.0-beta.1","prerelease":true}', {},
            ),
        )
        adapter.local = lambda: {
            "installed": True,
            "path": "/tmp/codex",
            "version": "1.0.0",
            "raw_version": "codex 1.0.0",
        }
        self.assertEqual(adapter.check()["state"], "check_failed")

    def test_codex_channel_detection_does_not_guess_custom_binary(self):
        adapter = CodexAdapter("codex", "Codex CLI", lambda: "", "", "")
        self.assertEqual(adapter.channel("/opt/homebrew/Caskroom/codex/1.2.3/codex"), "homebrew")
        self.assertEqual(adapter.channel("/usr/local/lib/node_modules/@openai/codex/bin/codex"), "npm")
        self.assertEqual(adapter.channel("/usr/local/bin/codex"), "standalone")

    def test_codex_uses_install_channel_version_before_notifying(self):
        payloads = {
            "github": b'{"tag_name":"rust-v2.0.0","prerelease":false,"published_at":"2026-09-04","body":"GitHub notes"}',
            "npm": b'{"version":"1.9.0"}',
        }

        def fetch(url, **_kwargs):
            return (payloads["npm"] if "npmjs" in url else payloads["github"], {})

        adapter = CodexAdapter("codex", "Codex CLI", lambda: "", "https://example.test/github", "https://example.test", fetch=fetch)
        result = adapter.remote("npm")
        self.assertEqual(result["version"], "1.9.0")
        self.assertEqual(result["release_notes"], "", "notes from a different release are not attached")

    def test_codex_channel_check_survives_release_notes_rate_limit(self):
        def fetch(url, **_kwargs):
            if "npmjs" in url:
                return b'{"version":"1.9.0"}', {}
            raise RuntimeError("HTTP 429")

        adapter = CodexAdapter("codex", "Codex CLI", lambda: "", "https://example.test/github", "https://example.test", fetch=fetch)
        self.assertEqual(adapter.remote("npm")["version"], "1.9.0")

    def test_antigravity_parses_cli_not_desktop_version(self):
        pages = {
            "download": (
                b'<nav><a href="/docs/cli">Antigravity CLI</a></nav>'
                b'<h2>Antigravity 2.0</h2><b>v2.12.2</b>'
                b'<section id="antigravity-cli"><h2>Antigravity CLI</h2>'
                b'<a href="/changelog?tab=cli">v1.1.25</a></section>'
            ),
            "changelog": b"<h2>v1.1.25</h2><time>September 4, 2026</time><p>CLI fixes</p>",
        }

        def fetch(url, **_kwargs):
            return (pages["changelog"] if "changelog" in url else pages["download"], {})

        adapter = AntigravityAdapter(
            "gemini-cli", "Antigravity CLI", lambda: "", "https://example.test/download", "https://example.test/changelog", fetch=fetch
        )
        remote = adapter.remote()
        self.assertEqual(remote["version"], "1.1.25")


class ManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_configuration_failure_is_reported_without_escaping_task(self):
        adapter = StaticAdapter()
        manager = CliUpdateManager(
            (adapter,),
            configured_ids=mock.Mock(side_effect=RuntimeError("workspace unavailable")),
        )
        result = await manager.check_all()
        self.assertFalse(result["checking"])
        self.assertEqual(result["items"][0]["state"], "check_failed")
        self.assertIn("workspace unavailable", result["items"][0]["error"])

    async def test_check_only_calls_configured_adapters_and_keeps_results(self):
        codex = StaticAdapter("codex")
        dreamina = StaticAdapter("jimeng")
        dreamina.remote = mock.Mock(side_effect=AssertionError("not configured"))
        manager = CliUpdateManager((codex, dreamina), configured_ids=lambda: {"codex"})
        result = await manager.check_all()
        self.assertEqual(result["items"][0]["state"], "update_available")
        self.assertEqual(result["items"][1]["state"], "not_configured")
        self.assertEqual(len(manager.snapshot()["notification_items"]), 1)

    async def test_dismiss_is_scoped_to_the_current_manager_session(self):
        adapter = StaticAdapter()
        manager = CliUpdateManager((adapter,), configured_ids=lambda: {"codex"})
        await manager.check_all()
        self.assertEqual(len(manager.dismiss(["codex"])["notification_items"]), 0)
        fresh = CliUpdateManager((adapter,), configured_ids=lambda: {"codex"})
        await fresh.check_all()
        self.assertEqual(len(fresh.snapshot()["notification_items"]), 1)

if __name__ == "__main__":
    unittest.main()
