# ADR-0014: Optional cloud authority for Workspace SQLite records

- Status: Proposed
- Date: 2026-09-07
- Implementation: opt-in local pilot, 2026-09-08; broader acceptance remains pending.

## Context

Two trusted Reroll installations alternate between devices while OneDrive
replicates their Workspace media. Replicating a live SQLite database file
cannot establish one transaction order across those installations. The user
requests an optional cloud service for SQLite records, with media continuing
to use OneDrive and the existing local mode remaining the default.

ADR-0001 places shared content in Workspace Data; ADR-0003 makes Generation
History a Workspace SQLite responsibility. This proposal adds a placement
option for those responsibilities. It does not move Account, Session, Provider
credentials, or device configuration into Workspace Data. Neither earlier ADR
is superseded while this proposal remains unimplemented and unaccepted.

## Decision

Propose one remote Turso libSQL database per cloud Workspace, containing the
tables currently owned by CanvasStore, GenerationRunStore, and BatchGeneration.
All three SQLite responsibilities switch together. Their existing business
transactions, Canvas Revision, Operation ID receipts, and permissions remain
in force. Media bytes and existing non-SQLite Workspace files remain in the
OneDrive directory; the initial scope does not promise to remove conflicts
from shared JSON documents. Device rotation still requires those files to
finish syncing.

Each process acquires a remote, expiring Workspace write lease. Every business
transaction checks the binding and lease epoch under its remote write lock,
including a second check before commit. A lost or uncertain renewal revokes
all previously issued fences immediately. Before the conservative local
deadline, a transient renewal failure may be reconciled by a conditional
renewal of the same unexpired owner, epoch and active binding. Only a confirmed
commit issues a replacement fence for new connections; old fences stay revoked.
Reconciliation never acquires a lease or changes its epoch. Expiry, takeover,
binding changes and authentication failures require a launcher restart.
A timeout is an unknown outcome and must not start a local fallback writer
or automatically replay a business transaction. Normal rotation drains unfinished Generation Runs,
batch tasks and publication work before releasing the Workspace.

Runtime Store construction validates an existing cloud schema without creating
tables or relabeling Workspace identity. Migration is a separate operation:
stop both devices, take coordinated copies, inspect identities and unfinished
work, prepare and verify a staging target, then publish the binding. A second
device connects to that binding without uploading its old local databases.
Returning to local storage requires an export of the latest cloud state;
switching a boolean back to an old SQLite copy is insufficient.

Database-scoped credentials belong to Device State outside OneDrive. The
installations are trusted holders of those credentials; the lease is not a
database security boundary against a malicious SQL client. Account identities
must be explicitly bound between installations before private content or
background owner-specific recovery is enabled.

The existing media cleanup scanner reads local SQLite files and cannot safely
determine cloud references. Cloud mode must disable permanent media cleanup
until it has an authoritative cloud reference scan and protects delayed media.

## Alternatives considered

- Continue syncing SQLite files: does not provide one authority or prevent
  an older device copy from replacing newer records.
- Keep a writable local replica and upload it later: needs additional conflict
  and acknowledged-save semantics outside the requested alternating mode.
- Move all Workspace files to a cloud application server: changes the media
  and local Provider arrangement that the user wants to retain.
- Build a command gateway immediately: may reduce remote SQL round trips and
  enforce server-side permissions, but requires another hosted component.
  Direct SQL remains provisional until latency and recovery gates pass.

## Consequences

Existing local users retain their current mode. Cloud users gain one ordering
of SQLite changes, but require network access for confirmed saves. Free-tier
capacity depends on receipt volume and repeated background writes, not only
the number of visible nodes.

The transport, three Store adapters, lease, runtime composition, settings
switch, verified import and journaled return are implemented as an opt-in pilot.
The current shared-canvas Workspace has been migrated after full table digest
verification. Existing Account IDs and permissions are retained; no automatic
account merge is introduced. Private cross-installation account binding,
two-device acceptance and network performance remain required before this ADR
is accepted for general use. A snapshot with unresolved effects
cannot be treated as ready merely because all Generation Runs are terminal.

## References

- [Workspace data boundary](0001-workspace-data-boundary.md)
- [Generation History authority](0003-generation-history-sqlite-authority.md)
- [Manual media cleanup](0012-manual-workspace-media-cleanup.md)
- [Active cloud storage specification](../active/2026-09-07-optional-cloud-records-onedrive-media-spec.md)
- [Turso Store contract tests](../../tests/test_turso_stores.py)
- [Snapshot inspection tests](../../tests/test_turso_migration.py)
