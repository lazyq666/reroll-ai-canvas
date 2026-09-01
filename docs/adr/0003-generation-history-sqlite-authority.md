# ADR-0003: Generation History uses one SQLite-backed runtime interface

- Status: Accepted
- Date: 2026-08-27
- Source: Issue #165

## Context

Smart Canvas Generation History was represented in two places: final records in
SQLite tables after the Workspace cutover, and a `logs` array inside legacy
Canvas JSON documents. The browser understood both storage modes and sometimes
included `logs` in Canvas snapshots and realtime Mutation reconciliation.

Generation History is not undoable Canvas content. Mixing it into the shared
Canvas document allowed a realtime snapshot without logs to replace a newly
created page-local failure record. It also made image, video and text callers
depend on storage migration details.

## Decision

Smart Canvas uses one Generation History interface for image, video and text
Generation Runs:

- callers record a final entry through `POST /api/canvases/{canvas_id}/logs`;
- the log Modal reads through `GET /api/canvases/{canvas_id}/logs` and the detail
  route;
- the SQLite Canvas store owns final records in `canvas_logs`,
  `generation_log_payloads` and `generation_log_outputs`;
- a stable Generation Run ID is the reconciliation and idempotency identity;
- the browser may keep an immediate page-local cache for feedback, but that
  cache is never part of a Canvas snapshot, Canvas Mutation, Revision or undo
  history;
- browser callers do not inspect the Workspace storage authority.

Workspaces that have not completed the controlled SQLite cutover may use one
temporary server-side JSON adapter behind the same interface. The adapter exists
only to preserve data until migration; it is not a second browser contract.
Legacy JSON logs remain valid migration input and verified rollback-export data.
The controlled cutover imports a Canvas and its normalized legacy final logs in
one SQLite transaction, including deleted Canvases, and publishes authority only
after source, imported and stored log counts agree.

## Alternatives considered

- Keep the JSON/SQLite branch in the browser: rejected because storage details
  leak into every synchronization and feedback caller.
- Create a separate Generation History SQLite database: rejected because the
  existing Canvas SQLite store already provides atomic output-and-log commits,
  authorization and lifecycle cleanup.
- Remove all legacy JSON reads immediately: rejected because an uncutover
  Workspace would lose access to existing logs before a controlled migration.

## Consequences

- Image, video and text generation share one small interface and one persisted
  schema.
- Realtime Canvas reconciliation cannot clear Generation History.
- A final log can be written independently when a client-side failure is known,
  while duplicate writes for the same Generation Run are idempotent.
- New browser code must not add `logs` back to Canvas snapshots or Mutation
  payloads.
- The temporary JSON adapter can be deleted after supported Workspaces have
  completed the controlled SQLite cutover; migration and rollback tools remain.
- Legacy ID collisions are preserved for audit: conflicting log IDs are
  remapped deterministically, while duplicate Run IDs keep every source record
  and record the conflict in diagnostics.
- Workspaces cut over by an older release use a separate one-shot backfill. It
  verifies a SQLite backup and staging copy before one transactional live write,
  preserves device-conflict copies by exact-log deduplication, and stores a
  database marker that prevents a second backfill.

## References

- [Generation pipeline](../current/generation-pipeline.md)
- [Storage layout and migration](../current/storage-layout-and-migration.md)
- [Controlled cutover and live acceptance](../current/controlled-cutover-and-live-acceptance.md)
- `tests/test_issue_142_smart_canvas_generation_history.py`
- `tests/prompt_generation_failure_details_browser_smoke.cjs`
- `tests/test_canvas_sync.py`
