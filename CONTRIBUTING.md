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
.venv/bin/python scripts/audit_public_history.py HEAD
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

## Public readiness rollout and dependency upgrades

The [F14 specification](docs/active/2026-09-07-public-readiness-delivery-gates-spec.md)
tracks activation of the new release gates. During rollout, the local ruleset
file is a declaration, not evidence that GitHub enforces it. Read effective rules
with `python3.12 scripts/readiness_rules.py`; drift or missing permissions leave
release verification incomplete.

Prepare the release metadata before committing with
`python3.12 scripts/readiness_version.py --prepare YYYY.MM.DD.N`, using the
current Asia/Shanghai date and a sequence greater than every published version.
This updates VERSION, update notes and the paired share-page cache references;
snapshot verification never generates or repairs these files.
The candidate publisher runs isolated snapshot checks and pushes only that commit
to a PR reference without changing your local branch or worktree:

```bash
python3.12 scripts/readiness_publish.py HEAD --branch codex/my-change --report /tmp/readiness.json
```

If remote main or the destination advances, update the release version, commit
and revalidate. main moving during the final network push can leave the PR branch
published with an incomplete result; GitHub's strict PR gate enforces freshness
at merge time. Keep the Issue open until the final main check succeeds. Changes
to workflow, inventory or expected rules must be identified in the PR description.

Dependabot groups Pydantic and pydantic-core because their runtime versions are
coupled. Grouping alone is not compatibility proof. For any direct or transitive
Python update, regenerate the lock using uv 0.10.0, review the diff, and pass the
installation consistency, import and full readiness checks:

```bash
uv pip compile requirements.txt --generate-hashes --python-version 3.12 --output-file requirements.lock.txt
```

Use `--upgrade-package` for the intended compatible packages when regenerating;
retain unrelated pins. Routine dependency updates are not automatically labeled
as security findings. Missing or incompatible dependencies fail distinctly from
vulnerability audit findings. This governance applies only to this public
repository; other repositories' lifecycle and notifications are separate work.
