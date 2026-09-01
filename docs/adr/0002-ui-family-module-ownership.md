# ADR-0002: UI family modules own component-specific implementation

- Status: Accepted
- Date: 2026-08-24
- Source: Issue #132

## Context

Infinite Canvas UI uses project-owned `ic-*` elements over a pinned WebAwesome engine. Design Tokens define product-wide visual decisions, a Theme Adapter translates project semantic variables into engine variables, and family runtime files implement public control behavior.

As the system grew, the Theme Adapter also accumulated concrete selectors for Button, Icon Button, Button Group and other controls. The same public family therefore had implementation spread across its runtime file and a global 1600-line adapter. A maintainer changing one control needed to understand unrelated families, and tests increasingly asserted private source locations instead of the public interface.

Contracts, examples and the UI component library have separate evidence responsibilities and should remain independent. The architecture problem is not the existence of those artifacts; it is the lack of one implementation owner for each public UI family.

## Decision

Each public UI family is a module with one stable external interface and one internal family directory.

- The stable entry exports the public classes used by `core.js`; callers do not depend on internal filenames.
- Each public custom element has an independently locatable implementation file inside its family.
- Component-specific behavior, validation, engine presentation mapping and Shadow DOM styles belong to the family module.
- Shared family helpers and styles are internal seams and are not public interfaces.
- `static/css/design-tokens.css` remains the only owner of product-wide palette, typography, spacing, radius, elevation, motion and layering values.
- `theme-adapter.js` owns the generic `--ui-*` to `--wa-*` translation and cross-family global contexts. It does not own a migrated family's base, Size, State or Variant implementation.
- A consumer family can style a composed child control while that consumer family is still awaiting migration; the composition rule belongs to the consumer and must move with that family rather than back into the child family.
- Versioned contracts, fixtures, cases and tests remain separate artifacts. They describe intent and evidence but do not duplicate production CSS or private runtime logic.
- Families migrate incrementally behind stable entries. Actions, Text Entry, Selection / Adjustment, Dialog / AI Processor and Navigation / Command are the first completed set; other families adopt the same structure when touched by an approved task.

## Alternatives considered

- Keep all concrete control styles in `theme-adapter.js`: rejected because the adapter becomes a second implementation owner and every family change expands a global conflict surface.
- Put all behavior, styles, contracts and examples in one file per control: rejected because these artifacts have different runtime and governance responsibilities; physical co-location would not create a useful interface.
- Create one global component stylesheet separate from the Adapter: rejected because it changes the filename but keeps cross-family implementation coupled.
- Move every UI family in one large refactor: rejected because stable entries allow incremental migration with smaller regression scope.
- Expose every internal file directly to `core.js` and tests: rejected because callers would learn the directory structure and make later internal changes expensive.

## Consequences

- A maintainer can find a migrated family's production behavior and visual implementation in one directory.
- The Theme Adapter becomes smaller and its responsibility can be enforced by static tests.
- Public imports and custom-element tags remain unchanged while internal files can evolve.
- Some family directories contain several files rather than one file; locality is measured by one ownership home, not minimum file count.
- Tests must prefer public browser behavior and stable entries. Static source tests may verify ownership rules but should not require an implementation string to remain in a former file.
- Until remaining families migrate, the Theme Adapter can still contain their concrete rules. New work must not add rules for any migrated family back to it.

## References

- [Design Tokens](../current/design-tokens.md)
- [UI design and interaction guidelines](../current/ui-design-guidelines.md)
- `tests/test_infinite_canvas_ui_actions_module.py`
- `tests/test_infinite_canvas_ui_family_modules.py`
- `tests/actions_browser_smoke.cjs`
