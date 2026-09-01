# ADR-0005: Global Generation publication shares the Generation Run SQLite authority

- Status: Accepted
- Date: 2026-08-28
- Source: Issue #179

## Context

Infinite Canvas has two different user-visible history responsibilities. A
Canvas final log belongs to one Canvas and must commit atomically with the
accepted Generation Output; ADR-0003 therefore keeps it in
`canvas-content.sqlite3`. Global Generation History is a cross-Canvas list used
for output browsing, filtering, pagination and deletion. Notification receipts
record whether a stable Generation Run effect has already been published.

The legacy runtime put Global History in `generation-history.json` and History /
Notification receipts in `generation-effects.json`. Reusing
`WorkspaceGenerationEffects` for SQLite authority would expose those paths to
the new runtime and allow an apparently migrated Workspace to keep rewriting
whole JSON files. The historical cutover also needs completed receipts to
survive even when an old Run was already compacted or is absent from the legacy
Run file.

## Decision

Global Generation publication uses a distinct interface backed by
`generation-runs.sqlite3`:

- `generation_history` owns Global Generation History. It stores one stable
  History ID, optional stable Run identity, media type, Provider, Model, primary
  output URL, timestamp, source and the lossless public payload. Indexed
  timestamp-plus-sequence cursors provide stable pagination.
- `generation_publication_receipts` owns History and Notification publication
  state. Its effect identity is `generation-run:<run-id>:<effect-kind>` and its
  pending/claimed/completed transition uses a lease.
- Completed receipts do not have a foreign key to `generation_runs`: migration
  must preserve “already delivered” evidence after a terminal Run was compacted
  or omitted by an older version. A pending receipt is valid only when its Run
  and reconstructable Managed Media output exist; integrity checks reject
  orphan pending receipts.
- The Canvas `generation_effect_outbox` remains separate. It owns atomic Canvas
  output plus final-log delivery, not cross-Canvas History or notification
  publication.
- `WorkspaceGenerationEffects` owns output materialization only, then delegates
  publication. JSON authority receives a compatibility publication adapter;
  SQLite authority receives a SQLite adapter and is not given any of the three
  legacy Generation JSON paths.
- Historical cutover imports and validates both global JSON sources in staging,
  publishes the two formal databases, commits `storage-authority.json` last,
  then archives exactly `generation-history.json`, `generation-effects.json`
  and `generation-runs.json`. Rollback restores exact legacy bytes before
  withdrawing the manifest.
- A Workspace published by an early SQLite cutover is upgraded in place under
  the same offline command. The current SQLite Run store remains authoritative;
  legacy Runs only fill missing identities, while Global History and receipts
  are imported into a staging copy. Publication replaces the Run database and
  updates the manifest last. Rollback restores the exact previous SQLite store
  and manifest rather than reviving stale Canvas JSON.
- A missing legacy Run may still contain an inline `data:` input that the
  SQLite store intentionally rejects. The offline upgrade validates and
  materializes that input under a migration-scoped Managed Media path named by
  its SHA-256, records the exact file audit, and stores only the Workspace
  relative URL. Publication, retry cleanup and rollback treat those bytes as
  part of the same manifest-last operation.
- Irrecoverable Global History media remains a hard failure by default. An
  operator may quarantine only explicitly enumerated stable History IDs with a
  second confirmation. The migration verifies that each enumerated record is
  actually missing media, hashes the durable resolution, preserves the exact
  source JSON in recovery and legacy archive, and records every omission for
  rollback. A valid, unknown, duplicated or unlisted record cannot be waived.

This decision complements ADR-0003; it does not move Canvas final logs out of
the Canvas database.

## Alternatives considered

- Put Global History in `canvas-content.sqlite3`: rejected because cross-Canvas
  browsing and notification receipts do not participate in the atomic Canvas
  output/final-log transaction or Canvas authorization boundary.
- Create a third SQLite database: rejected because publication state follows
  Generation Run recovery and would add another authority that must be
  atomically published and rolled back without providing an independent domain
  boundary.
- Keep whole-file JSON behind a SQLite manifest: rejected because the manifest
  would not identify the real writer, and normal History/notification traffic
  would retain the truncation, synchronization and lost-update risks of the
  legacy authority.
- Add foreign keys for every receipt: rejected because completed legacy
  receipts are durable deduplication evidence even when no reconstructable Run
  remains. Only pending work requires a durable Run.

## Consequences

- SQLite-authority image, video and text Runs cannot create, read or modify the
  three legacy Generation JSON files.
- Global History supports indexed query, media filtering, stable cursor paging,
  lookup by History ID and deletion without loading a whole Workspace file.
- Notification delivery remains at-least-once across a transport crash, but the
  stable effect ID and completed receipt prevent a completed restart replay.
- Offline migration must stop on ID collisions, corrupt JSON, missing Managed
  Media, non-terminal Runs, orphan pending effects or integrity failures; it
  cannot silently discard ambiguous work.
- Rollback export must include Global History and both completed and pending
  publication receipts, in addition to Canvas JSON and Generation Runs.
- The compatibility JSON adapter remains until missing-manifest enforcement is
  delivered, but it is no longer a possible dependency of SQLite composition.

## References

- [ADR-0003](0003-generation-history-sqlite-authority.md)
- [Workspace SQLite authority Active Spec](../active/2026-08-28-workspace-sqlite-authority.md)
- [Generation pipeline](../current/generation-pipeline.md)
- [Storage layout and migration](../current/storage-layout-and-migration.md)
- [Controlled cutover and live acceptance](../current/controlled-cutover-and-live-acceptance.md)
- `tests/test_generation_runs_sqlite_authority.py`
- `tests/test_offline_sqlite_migration.py`
