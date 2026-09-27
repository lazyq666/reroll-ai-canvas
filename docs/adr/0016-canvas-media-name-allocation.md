# ADR-0016: Canvas commits own media name allocation

- Status: Accepted
- Date: 2026-09-26
- Source: Linear LAZ-67

Generation Output and local media edits share a Canvas-scoped sequence per function prefix. Both Generation Output commits and Canvas Mutation allocate names in their existing serialized write transaction. Browser names are optimistic; the accepted mutation returns the canonical media `name`. A browser-only maximum scan cannot distinguish simultaneous completions, and a separate reservation endpoint would introduce unused reservations and another write protocol.

The counter high-water marks and allocation receipts are Workspace Data stored in private Canvas realtime state (`media_names` in `canvas_realtime_state`, or `_realtime` in the legacy JSON adapter). They are not undoable content: deleting or undoing a medium must not reuse a number already downloaded by a user. Full export/import preserves this state, including numbers whose media have been deleted. Public snapshots omit the private receipts. No new database table, external API, physical file rename or migration is required.

Public media keep `name` as the only display/download name. `autoName` records the function, stable allocation identity, original assigned name and pending intent; it is provenance, not a second editable display name. A different current `name` is user content and must be preserved. Copies of accepted media keep their names. A new derived edit creates a new allocation identity; a retry retains its identity. Grid splits share one identity and use row/column suffixes. Ordinary imported/legacy media without an intent are never renamed automatically.

The sequence is local to one Canvas and promises unique new automatic allocations, not globally unique filenames: explicit user names, copied media and cross-Canvas downloads may still collide. Existing ZIP collision handling remains the final export safeguard.

References: [Media naming contract](../active/2026-09-20-smart-canvas-media-naming.md), [Workspace boundary](0001-workspace-data-boundary.md), `tests/test_canvas_media_sequences.py`.
