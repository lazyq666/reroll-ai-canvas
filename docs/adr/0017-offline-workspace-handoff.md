# ADR-0017: Offline Workspace handoff through a synced directory

- Status: Accepted
- Date: 2026-09-27
- Scope: Opt-in local SQLite workspaces; real two-device OneDrive acceptance pending.

Two devices alternate editing a Workspace. File replication cannot establish a
transaction order or prove that a self-consistent local copy is the latest copy.
Keep local SQLite editing and add an explicit, whole-Workspace handoff boundary:
freeze admission, drain HTTP work and realtime channels, stop background writers,
checkpoint and validate databases, preserve local recovery copies, and publish a
versioned file inventory. A receiving installation must supply the handoff code
obtained from the departing device, verify the exact inventory, and record its
active session before constructing writable Stores.

The synced record lives in Workspace Data; acceptance receipts and record backups
live in Device State, outside the sync directory. Only the original installation
with its matching local session receipt may recover an unclean active session.
The existing local OS lock and occupation metadata remain mandatory. Explicit
foreign takeover cannot bypass the handoff gate. No automatic merge, mtime winner,
WAL deletion, or restoration of a guessed database is permitted.

This extends ADR-0001 without introducing external coordination. It does not
replace the optional Turso pilot in ADR-0014, change Store ownership, or make one
SQLite file hold every responsibility. A local seal is not cloud acknowledgement.
Both devices must run this version and wait for OneDrive to finish before switching;
users must transfer the expected code independently. Simultaneous editing, obsolete
clients, and a completely stale first-use copy without the opt-in record remain
outside the guarantee. Browser unload cannot certify persistence; use the explicit
application handoff action. A normal exit without that action leaves an active
session for recovery on the same installation.

See [implementation and acceptance](../active/2026-09-27-workspace-handoff.md).
