# ADR-0019: Erase failed music content with scoped media reclamation

- Status: Accepted
- Date: 2026-10-15
- Source: [LAZ-85](https://linear.app/lazyq/issue/LAZ-85), explicit request to delete failed records and local storage
- Scope: Supersedes ADR-0012's record-only deletion rule for explicitly confirmed failed Suno records; its other protections remain in force.

## Context

Suno history reads owned Generation Runs directly. Hiding a browser row would
leave its parameters, error, reference metadata and files in Workspace storage.
Erasing the paid-operation identity as well could allow an old request to submit
again. Files may also belong to other records, Canvases or an unsaved draft.

## Decision

An Administrator or Designer may explicitly confirm erasure of their own failed
Suno record. The endpoint coordinates through the existing media cleanup gate,
drains HTTP/Realtime work and rejects active generation. Physical deletion remains
owned by WorkspaceMediaCleanup, restricted to actual reference/output URLs from
that record. The authoritative reference scan excludes only this Run's content;
other records, recovery copies, session leases and new-file protection still apply.
It never scans for unrelated orphans to delete. Cloud authority remains unsupported
until an authoritative cloud media-reference scan exists.

Files are checked twice and identity-checked before unlinking. If any unlink fails,
the record remains available for retry; already removed files are not restored.
Only after file processing succeeds is the Run's user content erased from the
selected JSON/SQLite authority. A minimal receipt retains Run ID, owner, operation
key/hash, kind and timestamps, with a deleted-surface marker. It retains no prompt,
error, reference, result, remote-task or Provider content. History/detail/reference
access no longer exposes the record; an old operation key is rejected instead of
submitting again. Repeated deletion by the same owner succeeds without side effects.

The UI states the irreversible effect and that shared/in-use files are retained.
It reports uncertainty and supports retry, rather than claiming success before a
response. A completed deletion cannot be resurrected by an older polling response.

## Alternatives considered

- Browser-only hiding: leaves the local content and restores it after reload.
- Delete every associated path: can destroy shared media or unsaved work.
- Delete the entire paid-operation receipt: permits accidental paid replay.
- Introduce another media database or trash: duplicates existing authorities and
  adds recovery obligations beyond this explicit permanent-deletion feature.

## Consequences

Record erasure is durable; session-protected and shared files may remain until
their remaining protection ends and ordinary administrator cleanup is confirmed.
This is logical content deletion and file unlinking, not a secure erase of backups
or SQLite free pages. No upstream task or temporary-host deletion is implied.

## References

- [Suno music](../current/suno-music-lab.md)
- [Workspace media cleanup](../current/workspace-media-cleanup.md)
- [ADR-0012](0012-manual-workspace-media-cleanup.md)
- [Deletion persistence tests](../../tests/test_music_record_deletion.py)
- [Deletion HTTP tests](../../tests/test_music_record_deletion_http.py)
