# Change completion and documentation

Use this checklist before declaring any feature implementation, bug fix, behavior removal, public configuration change, migration, or responsibility-moving refactor complete.

The objective is reconciliation: implementation, tests, the tracked GitHub Issue, and authoritative documents must describe the same observable product. Updating every document is not the objective. Apply every relevant row below and leave unrelated authorities unchanged.

## 1. Establish the delivered contract

1. Read the tracked Issue and the relevant Active or Current specification.
2. Compare the implemented user-visible behavior, permissions, failure and recovery states, public API/WebSocket/Provider contracts, data ownership, limits, and configuration with those sources.
3. Resolve disagreement explicitly:
   - change the implementation when it violates the approved contract;
   - change the document when the approved target changed or the document was factually wrong;
   - mark the feature `drift` in `docs/PROJECT-MAP.md` when ownership cannot decide within the task.

Completion criterion: every changed observable contract is either reconciled or recorded as named drift; undocumented disagreement is not carried forward.

## 2. Apply the update matrix

| Change | Required authority update | Completion criterion |
| --- | --- | --- |
| New or changed user-visible behavior | Relevant Feature Spec in `docs/active/` or Current document in `docs/current/` | Goals, non-goals, actors, states, failure/recovery, constraints and acceptance describe the delivered behavior |
| Bug fix that restores an existing Current contract | Regression test and tracked Issue; keep the Current spec unchanged | The test goes red on the bug and passes on the fix; the Issue explains the corrected behavior |
| Bug reveals that the Current contract was wrong or incomplete | Current reference plus regression test | The corrected rule and its acceptance scenario are both recorded |
| New, renamed or removed domain concept | Root `CONTEXT.md` | One canonical term and any rejected ambiguous synonym are defined without implementation details |
| Durable architecture, data-boundary or security tradeoff | Relevant accepted ADR, or a new/superseding ADR under `docs/adr/` | Decision, alternatives, consequences and supersession are explicit |
| New/removed page, public API/WebSocket surface, Provider category, major module responsibility, feature domain or Current reference | `docs/PROJECT-MAP.md` | Diagrams, code responsibility and feature-registry links match the repository |
| Shared UI component, visual foundation, Focus or interaction-pattern changes | `docs/current/ui-design-guidelines.md`, `docs/current/design-tokens.md` when tokens change, and the affected public behavior tests | Human-readable rule, public `ic-*` interface and real-page behavior agree; no audit snapshot is required |
| Page-level visual or interaction changes | Relevant Feature Spec plus real-page browser/manual acceptance | Default, loading, empty, failure, recovery, Light/Dark, Pointer and Keyboard states are reconciled; isolated component previews do not substitute for the page |
| Operator-visible configuration, limit, startup or deployment behavior | `.env.example`, relevant Current reference, and root `README.md` when users operate it there | Default, scope, valid values, activation/restart behavior and failure mode are stated once and linked elsewhere |
| Storage path, migration or Workspace/Instance/Device/Cache ownership changes | Relevant ADR and `docs/current/storage-layout-and-migration.md` | Ownership, migration, rollback and secret/content boundaries agree with code and tests |
| Generation lifecycle, Provider recovery or output-delivery changes | `docs/current/generation-pipeline.md` or its Active replacement | Run states, idempotency, recovery and target guards match observable behavior |
| Removal or deprecation | Relevant map/Current links and regression tests preventing accidental restoration | Current navigation no longer advertises the removed behavior; unique rationale is archived only when still useful |
| Implementation-only refactor with no contract, terminology, architecture or responsibility change | No product-document edit | Existing contract tests pass; the Issue or PR records the implementation change |

## 3. Graduate development documents

When implementation finishes, update the Active Spec status and attach the actual verification result. `Implemented` does not mean `Current`.

Promote stable behavior to `docs/current/` only after:

1. implementation matches the approved specification;
2. risk-proportionate automated acceptance passes;
3. required browser, human visual/interaction, live Provider, migration, or multiplayer gates pass;
4. the Current document contains durable behavior rather than an implementation diary.

After promotion:

- update the corresponding `docs/PROJECT-MAP.md` registry row and any canonical link in `docs/README.md`;
- move unique historical rationale to `docs/archive/` only when future readers need it; otherwise rely on Git history;
- remove or archive the superseded Active plan;
- keep temporary handoffs, task-board mirrors, and a generic `docs/evidence/` out of the long-term document set.

Completion criterion: a reader can reach the Current behavior and representative verification seam from `docs/PROJECT-MAP.md`, while the superseded development document cannot be mistaken for current authority.

## 4. Verify and close the tracked work

1. Run the narrow regression tests for the changed behavior and the documentation knowledge-map tests. Add broader suites in proportion to risk.
2. Check changed Markdown links and remove references to deleted or moved documents.
3. Record the test commands, results, remaining gates and any known drift in the Issue or PR.
4. Follow `docs/agents/issue-tracker.md`: move ready work to `Review`; move it to `Done` and close the Issue only after merge and verification.

Completion criterion: the final handoff names the authoritative documents changed, tests run, gates still pending, and Issue/Project state. A task with stale Current documentation or an unrecorded required gate is not complete.
