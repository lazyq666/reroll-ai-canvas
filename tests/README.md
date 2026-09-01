# Tests

The default deterministic suite is Python `unittest`:

```bash
.venv/bin/python -m unittest discover -s tests
```

JavaScript state and contract tests use the pinned Node.js development
dependencies:

```bash
npm ci
npm test
```

## Browser tests

Files ending in `_browser_smoke.cjs` are targeted acceptance gates rather than
one globally runnable suite. Many start their own temporary server. Tests that
exercise a complete page may instead use a paired preview server in another
terminal:

| Preview server | Browser test |
| --- | --- |
| `angle_workbench_browser_app.cjs` | `angle_workbench_browser_smoke.cjs` |
| `canvas_list_content_management_browser_app.cjs` | `canvas_list_content_management_browser_smoke.cjs` |
| `enhance_workbench_browser_app.cjs` | `enhance_workbench_browser_smoke.cjs` |
| `t21_canvas_list_browser_app.cjs` | `t21_canvas_list_browser_smoke.cjs`, `canvas_list_viewport_interaction_browser_smoke.cjs` |
| `t30_studio_shell_browser_app.cjs` | `t30_studio_shell_browser_smoke.cjs` and the Studio Shell issue regressions |
| `zimage_workbench_browser_app.cjs` | `zimage_workbench_browser_smoke.cjs` |

For example:

```bash
npx playwright install chromium
node tests/angle_workbench_browser_app.cjs
```

Then, in another terminal:

```bash
SMART_CANVAS_BROWSER="$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")" \
  node tests/angle_workbench_browser_smoke.cjs
```

The core public-component browser contract is automated in GitHub Actions. Run
it locally with:

```bash
IC_BROWSER_BIN="$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")" \
  IC_RUN_BROWSER_TESTS=1 \
  .venv/bin/python -m unittest tests.test_infinite_canvas_ui_core
```

Live Provider, migration, multiplayer, performance, visual, and human gates
remain opt-in because they require credentials, existing data, controlled
hardware, or visual judgment. The relevant Current or Active specification
defines when one of those gates is required.
