"""Real HTTP browser fixture for Batch Generation acceptance checks.

The application uses a temporary Workspace and a fake Generation Runs port, so
manual or automated browser checks never contact a real image provider.
"""

from __future__ import annotations

import asyncio

from PIL import Image

from tests.runtime_env import ROOT, ensure_test_workspace


ensure_test_workspace()

import main  # noqa: E402
from infinite_canvas.batch_generation import BatchGeneration  # noqa: E402


main.sync_static_html_versions = lambda: None


USERNAME = "batch-browser-designer"
PASSWORD = "batch-browser-password"


class FakeGenerationRuns:
    def __init__(self) -> None:
        self.count = 0

    async def submit(self, task, *, owner, batch_id):
        self.count += 1
        filename = f"browser-{self.count}.png"
        output_path = main.output_path_for(filename, "output")
        Image.new(
            "RGB", (128, 96), (220, 82, 82) if self.count == 1 else (82, 126, 220)
        ).save(output_path)
        return {
            "run_id": f"browser-fake-{self.count}",
            "status": "succeeded",
            "outputs": [main.output_url_for(filename, "output")],
        }


if not any(user.get("role") == "admin" for user in main.AUTH_SYSTEM.list_users()):
    main.AUTH_SYSTEM.create_user(
        username="batch-browser-admin",
        password=PASSWORD,
        role="admin",
    )

designer = main.AUTH_SYSTEM.create_user(
    username=USERNAME,
    password=PASSWORD,
    role="designer",
)
fake_runs = FakeGenerationRuns()
batch_generation = BatchGeneration(
    ROOT / "workspace" / "data" / "batch-generation-browser.sqlite3",
    submit=fake_runs.submit,
)
asyncio.run(batch_generation.start({
    "name": "浏览器验收批次",
    "prompt_modules": [{"name": "主体", "options": ["红狐", "雪豹"]}],
    "models": [{"provider_id": "fake", "model": "fake-image-v1"}],
    "ratios": ["1:1"],
    "settings": {"outputs_per_run": 1, "desired_concurrency": 2},
}, owner=designer["id"]))

main._BATCH_GENERATION = batch_generation
main.WORKSPACE_CONFIGURED = True
app = main.app
