# Agent instructions

Unless the user explicitly requests a new worktree and branch, perform development in the current local worktree and current local branch.

## Agent skills

### Issue tracker

Bugs, requirements, investigations, and development tasks are tracked in Linear. Do not require a GitHub Issue for new work. Before creating a Linear issue, search existing work to avoid duplicates. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain layout. Read the root `CONTEXT.md` and any relevant ADRs under `docs/adr/` before changing domain terminology or architecture. See `docs/agents/domain.md`.

### Completion documentation

Before declaring a feature, bug fix, behavior removal, public configuration change, or responsibility-moving refactor complete, reconcile the delivered behavior with its tests, tracked Linear work when applicable, and authoritative documentation. Apply the change-type matrix and graduation gates in `docs/agents/change-documentation.md`; update only the authorities whose facts changed.

### Product copy and i18n

Put every user-facing string in the shared i18n resources and provide both Chinese and English in the same change. This includes visible text, placeholders, hints, titles, accessible names, empty states, confirmations, validation errors, toasts, runtime status messages, and dynamically generated labels. Bind static markup with the appropriate `data-i18n-*` attribute and generate runtime copy with the repository translation helpers such as `tr` and `trf`; a localized HTML fallback is acceptable only when the same element has an i18n binding.

Write English product copy for native English usage: prefer concise sentence case, preserve product names, and check that translated text fits every supported layout. Completion requires `node static/js/i18n/validate-i18n.js`, relevant i18n regression tests, and a language-switch check for any affected dynamic UI. User-facing literals in JavaScript or unbound visible HTML are incomplete implementation.

### Public readiness

Before pushing to a project remote, changing the readiness workflow, inventory or rules, or completing release verification, read and follow [the Public readiness contract](docs/current/public-readiness.md). Completion requires the final main checks and effective rule readback to succeed.

### Project release version

Before every push to any project remote, update the root `VERSION` using the existing `YYYY.MM.DD.daily-sequence` rule (for example, `2026.08.30.1`, then `2026.08.30.2` for another push on the same day). The new version must be strictly greater than the previously published version. Synchronize `static/update-notes.json` so its `version` exactly matches `VERSION`, and verify the pair with `python3 -m unittest tests.test_update_sources` before pushing.

### Frontend asset versions

After changing local frontend assets, their references, or embedded page markup, run `python3 scripts/sync_frontend_assets.py` after the final content edit and include every generated reference, marker and inventory update. Completion requires `python3 scripts/sync_frontend_assets.py --check`. Use complete literal local asset URLs so imports, dynamic loaders, Workers and CSS dependencies are discoverable. Read [Frontend asset versions](docs/current/frontend-asset-versions.md) when adding a loader, changing exclusions or debugging an upgrade. The former UI and avatar commands delegate to this same owner.
