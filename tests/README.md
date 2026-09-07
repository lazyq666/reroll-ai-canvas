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

## Committed-snapshot readiness

Use Python 3.12 and Node 24 for the release candidate and follow the
[Public readiness contract](../docs/current/public-readiness.md).
A working-directory test result does not verify a commit with omitted files.

```bash
python3.12 scripts/public_readiness.py snapshot HEAD --base origin/main --output /tmp/readiness.json
```

`--base` must identify the previous main commit. Commit the release version pair
before running this command. Each group gets a disposable full-history copy and
fresh locked dependencies. Staged, unstaged and untracked files stay in the
development directory. Only metadata reports survive; command IDs, exit codes and safe test/file/line
diagnostics identify which check needs a targeted local rerun. Remote reruns
must include all jobs so the final gate has evidence from the same attempt. Empty or wholly skipped suites fail;
the deterministic suite retains its documented optional gates. Functional
collaboration regressions use controlled measurement inputs to test latency
limits; live networking, timeouts and the separate performance gates use real clocks.
On macOS, the core browser uses a mock keychain like Playwright so an isolated
home directory does not stall navigation while initializing system credentials.

Local failure-injection tests run without GitHub or dependency downloads:

```bash
python3.12 -m unittest tests.test_readiness_delivery
```

The shared inventory is `scripts/readiness/manifest.json`. Changes to that
inventory, workflow, or ruleset require behavioral acceptance, including remote
cancellation/refusal experiments in an isolated acceptance repository. Production
completion also needs a green PR, the final main push result and effective rule
readback; local fixtures cannot substitute for those gates.
