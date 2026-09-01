# Contributing

Thank you for helping improve Reroll. Contributions are accepted under the
repository's non-commercial derivative license. Read [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before submitting work.

## Before changing code

1. Search open and closed GitHub Issues. Discuss material behavior or
   architecture changes in an Issue before implementation.
2. Read [`CONTEXT.md`](CONTEXT.md), [`docs/PROJECT-MAP.md`](docs/PROJECT-MAP.md),
   and the relevant Current/Active specification and ADR.
3. Never commit credentials, `.env` files, Workspace data, generated user
   media, personal paths, screenshots containing private information, or local
   worktree/agent directories such as `.worktrees/`, `.codex/`, `.agents/`, and
   `.scratch/`. Configure Git to use a public `@users.noreply.github.com`
   author email before creating commits for this repository.
4. Do not add fonts, images, model output, vendor bundles, or copied code unless
   their exact source and redistribution license are recorded in
   `THIRD_PARTY_NOTICES.md` and the required license text is retained.

## Environment and dependencies

Python 3.12 is the supported development runtime.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.lock.txt
```

`requirements.txt` declares direct dependency ranges.
`requirements.lock.txt` is the reviewed, hash-pinned installation input. After
changing direct dependencies, regenerate it with the command recorded at the
top of the lock file and include the resulting diff.

Node.js 22 or newer is required for JavaScript contract and browser tests.
Install their locked development dependencies with `npm ci`. Browser tests are
targeted gates rather than one global suite; see [`tests/README.md`](tests/README.md)
for the runnable entry points and preview-server pairings.

## Verification

Run narrow tests while developing, then the repository checks appropriate to
the change:

```bash
.venv/bin/python -m compileall -q backend scripts tests
.venv/bin/python scripts/audit_public_tree.py
.venv/bin/python scripts/verify_webawesome_vendor.py
.venv/bin/python -m unittest tests.test_documentation_knowledge_map
.venv/bin/python -m unittest discover -s tests
npm test
git diff --check
```

Browser, live Provider, migration, multiplayer, performance, visual, and human
gates remain required when the relevant Feature Spec calls for them.

## Documentation and review

Follow [`docs/agents/change-documentation.md`](docs/agents/change-documentation.md):
update only the authorities whose facts changed, graduate verified Active
specifications, and remove implementation diaries that no longer carry unique
rationale. A completed change must reconcile code, tests, its GitHub Issue,
and authoritative documentation.

Keep pull requests focused, describe security and data-boundary effects, list
the exact verification performed, and identify every remaining gate.
