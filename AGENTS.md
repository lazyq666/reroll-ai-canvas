# Agent instructions

Unless the user explicitly requests a new worktree and branch, perform development in the current local worktree and current local branch.

## Agent skills

### Issue tracker

Bugs, requirements, and development tasks are tracked as public GitHub Issues in `lazyq666/reroll-ai-canvas`. Maintainers may mirror them to a private planning board.

Project workflow: `Todo` → `In Progress` → `Review` → `Done`.

Before creating an issue, search existing open and closed issues to avoid duplicates. Maintainers who use the private planning board add each new tracked issue there with status `Todo`. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain layout. Read the root `CONTEXT.md` and any relevant ADRs under `docs/adr/` before changing domain terminology or architecture. See `docs/agents/domain.md`.

### Completion documentation

Before declaring a feature, bug fix, behavior removal, public configuration change, or responsibility-moving refactor complete, reconcile the delivered behavior with its tests, GitHub Issue, and authoritative documentation. Apply the change-type matrix and graduation gates in `docs/agents/change-documentation.md`; update only the authorities whose facts changed.

### Product copy and i18n

Put every user-facing string in the shared i18n resources and provide both Chinese and English in the same change. This includes visible text, placeholders, hints, titles, accessible names, empty states, confirmations, validation errors, toasts, runtime status messages, and dynamically generated labels. Bind static markup with the appropriate `data-i18n-*` attribute and generate runtime copy with the repository translation helpers such as `tr` and `trf`; a localized HTML fallback is acceptable only when the same element has an i18n binding.

Write English product copy for native English usage: prefer concise sentence case, preserve product names, and check that translated text fits every supported layout. Completion requires `node static/js/i18n/validate-i18n.js`, relevant i18n regression tests, and a language-switch check for any affected dynamic UI. User-facing literals in JavaScript or unbound visible HTML are incomplete implementation.

### Project release version

Before every push to any project remote, update the root `VERSION` using the existing `YYYY.MM.DD.daily-sequence` rule (for example, `2026.08.30.1`, then `2026.08.30.2` for another push on the same day). The new version must be strictly greater than the previously published version. Synchronize `static/update-notes.json` so its `version` exactly matches `VERSION`, and verify the pair with `python3 -m unittest tests.test_update_sources` before pushing.

### Infinite Canvas UI asset version

Whenever a change touches `static/js/infinite-canvas-ui/`, `static/css/design-tokens.css`, `static/css/webawesome-engine.css`, or a reference to an Infinite Canvas UI JavaScript module, run `python3 scripts/sync_infinite_canvas_ui_version.py` after the final content edit and include its generated `VERSION` and query-string updates. Completion requires `python3 scripts/sync_infinite_canvas_ui_version.py --check` to exit successfully.
