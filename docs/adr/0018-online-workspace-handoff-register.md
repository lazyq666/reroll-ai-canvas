# ADR-0018: Optional online Workspace handoff register

- Status: Accepted
- Date: 2026-09-29
- Scope: Local SQLite; real two-device OneDrive acceptance pending.

Extend [ADR-0017](0017-offline-workspace-handoff.md) with an explicitly paired Turso
register as the independent source of the latest handoff version and sole owner.
This replaces manual code transfer only for paired Workspaces. Ordinary offline
handoff remains supported. Turso stores Workspace identity, revision, owner,
session, handoff ID and a seal digest; databases, media and file inventories stay
in the Workspace. Credentials and operation receipts stay in Device State.

A closes admission, drains requests and channels, stops writers, backs up and
seals files, then publishes the seal in a primary transaction and exits normally.
B verifies the exact current seal and complete inventory before conditionally
claiming `receiving`, writes its local activation receipt, and promotes the claim
to `active` before any Store opens. The local OS lock remains mandatory. Once
paired, the register takes precedence over stale replicated occupation metadata.
Unknown responses are reconciled with durable local operation receipts. An
interrupted publication completes shutdown instead of reopening its writers.

We reject expiring leases or heartbeat takeover: losing network access cannot
prove another machine stopped writing local SQLite. We also reject reading a
synced code as independent evidence and reject migrating all records into Turso
for this feature. Missing credentials, missing register, conflicts, incomplete
files and foreign ownership fail closed. No automatic merge or manual-code
fallback bypasses the online gate. Pairing must happen with local servers stopped;
both machines must use the updated code. Old clients and an unpaired, completely
stale copy remain outside the guarantee. Unpairing or rebuilding a lost register
requires an explicit recovery procedure; deleting local files is not a rollback.

This feature is independent of the full cloud-record pilot in ADR-0014; a
Workspace cannot enable both. See the [spec and acceptance gates](../active/2026-09-29-online-workspace-handoff.md).
