import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.runtime_env import ensure_test_workspace

ensure_test_workspace()

import main


class GenerationSettingsIntegrationTests(unittest.TestCase):
    def test_jimeng_defaults_expose_lite_pro_and_latest_cli_models(self):
        providers = main.merge_default_api_providers(
            [{
                "id": "jimeng",
                "name": "即梦 CLI",
                "protocol": "jimeng",
                "image_models": ["5.0"],
                "video_models": [],
                "model_names": {},
            }],
            inject_missing=False,
        )

        jimeng = providers[0]
        self.assertEqual("5.0", jimeng["image_models"][0])
        self.assertIn("5.0Pro", jimeng["image_models"])
        self.assertIn("4.7", jimeng["image_models"])
        self.assertEqual("5.0 Lite", jimeng["model_names"]["5.0"])
        self.assertEqual("5.0 Pro", jimeng["model_names"]["5.0Pro"])
        self.assertIn("seedance2.0mini", jimeng["video_models"])
        self.assertIn("seedance2.5", jimeng["video_models"])

    def test_provider_save_keeps_models_in_workspace_and_credentials_on_device(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_settings = (
                root / "workspace" / "data" / "api_providers.json"
            )
            device_connections = (
                root / "device" / "provider-connections.json"
            )
            device_credentials = root / "device" / "api.env"
            payload = main.ApiProviderPayload(
                id="team-api",
                name="Team API",
                protocol="openai",
                base_url="http://127.0.0.1:9000/v1",
                primary=True,
                image_models=["image-v2"],
                chat_models=["chat-v3"],
                model_names={"image-v2": "Team Image"},
                api_key="device-only-secret",
            )

            with (
                patch.dict(os.environ, {}, clear=False),
                patch.object(
                    main,
                    "api_providers_file",
                    return_value=str(workspace_settings),
                ),
                patch.object(
                    main,
                    "PROVIDER_CONNECTIONS_FILE",
                    str(device_connections),
                ),
                patch.object(
                    main,
                    "API_ENV_FILE",
                    str(device_credentials),
                ),
            ):
                result = asyncio.run(main.save_providers([payload]))

            workspace_text = workspace_settings.read_text(encoding="utf-8")
            device_text = (
                device_connections.read_text(encoding="utf-8")
                + device_credentials.read_text(encoding="utf-8")
            )
            shared = json.loads(workspace_text)[0]
            self.assertEqual(["image-v2"], shared["image_models"])
            self.assertEqual("Team Image", shared["model_names"]["image-v2"])
            self.assertNotIn("127.0.0.1", workspace_text)
            self.assertNotIn("device-only-secret", workspace_text)
            self.assertIn("127.0.0.1", device_text)
            self.assertIn("device-only-secret", device_text)
            self.assertNotIn("IMAGE_MODELS=", device_credentials.read_text())
            self.assertNotIn("CHAT_MODELS=", device_credentials.read_text())
            self.assertEqual(
                "Team Image",
                result["providers"][0]["model_names"]["image-v2"],
            )

    def test_loading_legacy_mixed_settings_leaves_no_reusable_secret_in_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace_settings = (
                root / "workspace" / "data" / "api_providers.json"
            )
            device_connections = (
                root / "device" / "provider-connections.json"
            )
            device_credentials = root / "device" / "api.env"
            workspace_settings.parent.mkdir(parents=True)
            device_credentials.parent.mkdir(parents=True)
            device_credentials.write_text(
                "\n".join(
                    [
                        "API_PROVIDER_LEGACY_API_KEY=device-secret",
                        "COMFLY_BASE_URL=http://this-device.test",
                        "IMAGE_MODELS=old-image",
                        "CHAT_MODELS=old-chat",
                        "MODELSCOPE_CHAT_MODELS=old-ms-chat",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            workspace_settings.write_text(
                json.dumps(
                    [
                        {
                            "id": "legacy-api",
                            "name": "Legacy API",
                            "protocol": "openai",
                            "base_url": "http://localhost:8080",
                            "image_models": ["image-a"],
                            "api_key": "legacy-secret",
                        }
                    ]
                ),
                encoding="utf-8",
            )

            with (
                patch.object(
                    main,
                    "api_providers_file",
                    return_value=str(workspace_settings),
                ),
                patch.object(
                    main,
                    "PROVIDER_CONNECTIONS_FILE",
                    str(device_connections),
                ),
                patch.object(
                    main,
                    "API_ENV_FILE",
                    str(device_credentials),
                ),
            ):
                providers = main.load_api_providers()

            self.assertEqual("http://localhost:8080", providers[0]["base_url"])
            workspace_text = workspace_settings.read_text(encoding="utf-8")
            self.assertNotIn("localhost", workspace_text)
            self.assertNotIn("legacy-secret", workspace_text)
            self.assertIn(
                "legacy-secret",
                device_connections.read_text(encoding="utf-8"),
            )
            credentials_text = device_credentials.read_text(encoding="utf-8")
            self.assertIn("device-secret", credentials_text)
            self.assertIn("COMFLY_BASE_URL", credentials_text)
            self.assertNotIn("IMAGE_MODELS", credentials_text)
            self.assertNotIn("CHAT_MODELS", credentials_text)
            self.assertNotIn("MODELSCOPE_CHAT_MODELS", credentials_text)


if __name__ == "__main__":
    unittest.main()
