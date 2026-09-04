# ADR-0010: Smart Group keeps Node authority and adds one ordered member projection

- Status: Accepted
- Date: 2026-09-04
- Source: [Issue #28](https://github.com/lazyq666/reroll-ai-canvas/issues/28)

## Context

Smart Group currently stores direct media in `images`, Node references in `items`, and implements compact presentation by rewriting or deleting the referenced Nodes. That makes the visible thumbnail layout an accidental write authority for Node identity and geometry. It also prevents one stable order across Node and media members. Existing Canvas documents and older clients still understand `items` and `images`, so replacing both fields in one incompatible step would make rollback and mixed-version editing unsafe.

## Decision

A Smart Group Node Member remains an ordinary authoritative Node. Its own persisted geometry is its Node Rest Geometry; Group Presentation is derived separately and never replaces that geometry. A Smart Group adds one versioned `memberOrder` containing stable references to both Node Members and Smart Group Media Members. `items` continues as the compatibility projection of ordered Node IDs, while `images` continues to contain direct media and gives each direct-media entry a stable group-member ID referenced by `memberOrder`.

The Smart Container module is the only writer of the three coordinated views. Readers use its resolved ordered-member interface instead of independently joining `items` and `images`. New writes must keep all projections consistent, and the authoritative Canvas validation rejects duplicate Node ownership or inconsistent projections. Legacy groups without `memberOrder` remain readable using their historical media-first projection and acquire the versioned order only through an explicit Canvas Edit or controlled migration. A client that cannot preserve the versioned model must not downgrade-save it.

## Considered options

- Store a second original-geometry map on the Smart Group while continuing to rewrite member Nodes: rejected because every resize, drag, copy, persistence and recovery path would need to keep two competing geometries synchronized.
- Replace `items` and `images` immediately with a single embedded `members` array: rejected for the first rollout because older clients and current read consumers would discard or ignore the new authority, making rollback unsafe.
- Recreate Image Nodes when a group is disbanded: rejected because a new ID cannot preserve Generation Run target identity, metadata or member-owned Connection.

## Consequences

- Group movement still moves owned Node geometry as a rigid set, while Group Resize and arrange only change the derived presentation.
- Direct media and Node Members have one deterministic order without pretending that direct media previously had a Node identity.
- Compatibility fields are intentionally redundant during the migration period, so validation and all mutations must pass through the Smart Container seam.
- Duplicate, Clipboard, Node Package and Canvas Sync paths must remap stable member references as one transaction.
- A future removal of `items` / `images` compatibility projections requires a separate migration decision after unsupported clients can no longer write Canvas documents.
