# ADR-0011: Placement intent belongs to Canvas Mutation

- Status: Accepted
- Date: 2026-09-05
- Source: [Issue #40](https://github.com/lazyq666/reroll-ai-canvas/issues/40) and [approved spatial rules R25–R27](../active/2026-09-05-smart-canvas-unified-spatial-layout-spec.md#77-异步恢复撤销与协作)

## Context

A user-selected location may intentionally overlap another Node, while automatic initial placement must avoid concurrent competitors. A browser-only set of exact Node IDs loses this distinction after reconnect or reload. Making it a permanent Node property would incorrectly carry one action's intent into future unrelated actions.

## Decision

Creation operations carry placement metadata separately from Node data: exact or automatic mode, the shared code gap, collection identity, and the frozen source, viewport and direct Frame context needed for a retry. Local pending operations preserve it across reload. Public snapshots and accepted broadcasts expose final geometry without the initiating viewport. Normal creation wrappers cannot carry server-only restoration lineage.

Only automatic initial creation is replanned on a spatial collision. History restoration uses its trusted inverse and exact known coordinates, including overlaps, while retaining authorization and subsequent-edit protection. A stale direct Frame requires reconciliation of its expansion and membership; this does not convert an exact placement to automatic placement. Clients negotiate the layout contract before editing, and the service validates the creation gap against the shared code authority.

## Alternatives considered

- Transient browser flags: rejected because reconnect and reload would change a user's location intent.
- A persistent `exact` Node field: rejected because location intent belongs to the operation, not to Node identity.
- Replanning Undo/Redo or accepting client-supplied history offsets: rejected because history should reproduce the approved coordinates and preserve the existing trusted-history boundary.

## Consequences

Operation persistence, retry projection and protocol compatibility now participate in spatial correctness. The viewport snapshot is operation context, never a shared camera. Old Canvas coordinates require no migration. Smart Group members retain their own Node Rest Geometry under [ADR-0010](0010-smart-group-member-authority.md).
