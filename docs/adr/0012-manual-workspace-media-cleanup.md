# ADR-0012: Managed Media is reclaimed through explicit Workspace cleanup

- Status: Accepted
- Date: 2026-09-06
- Source: Issue #25

## Context

Deleting a Node or evicting its undo record leaves media on disk. Conversely,
deleting Global Generation History used to remove image bytes immediately,
although another Canvas or the Workspace Asset Library could still use them.
ADR-0004 intentionally left reclamation to a separate media lifecycle decision.

## Decision

Record deletion only removes that record's reference. An Administrator can
preview and confirm manual reclamation of unreferenced Workspace media in data
storage settings. Confirmation checks all supported persisted content again and
can only remove unchanged files from the preview. Content and generation history
continue to retain original media; no history downgrade or automatic expiry is
introduced.

Reclamation owns physical deletion. Its first implementation scans references
conservatively instead of maintaining reference counters across JSON and SQLite
writers. Unknown or unreadable records block cleanup. HTTP work and realtime
mutations drain before collection; active generation blocks it. Newly created,
imported or served media is protected for the service session so an upload can
await insertion into a Canvas. No persistent media registry, scheduled collector,
retention setting or media trash is added.

## Alternatives considered

- Delete bytes with each Node, history or asset entry: the deleting owner cannot
  prove that other owners have released their references.
- Reference counts: require every existing write, migration and recovery path to
  maintain a second authority correctly; unnecessary for this manual first version.
- Automatically expire history originals: changes the meaning of retained history
  and requires a separate product decision.

## Consequences

Some unused files stay longer because of session protection or retained recovery
records. Cleanup promises safe reclamation, not removal of every possible orphan.
The supported single-service Workspace boundary remains necessary; direct writes
by outside tools are not coordinated by the application.

## References

- [Manual media cleanup](../current/workspace-media-cleanup.md)
- [Asset publication boundary](0004-workspace-asset-library-publication-boundary.md)
- [Issue #25](https://github.com/lazyq666/reroll-ai-canvas/issues/25)
