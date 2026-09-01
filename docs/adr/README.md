# Architecture Decision Records

This directory stores durable, repository-wide architecture decisions for Infinite Canvas.

Create an ADR when a decision constrains future implementation, establishes a system boundary, or chooses between meaningful alternatives. Routine implementation details belong in code, pull requests, or GitHub Issues instead.

## Naming

Use `NNNN-kebab-case-title.md`, with monotonically increasing four-digit numbers, for example `0001-canvas-mutation-as-write-authority.md`.

## Lifecycle

Use one of these statuses: `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNNN`.

Keep accepted ADRs as historical records. When a decision changes, add a new ADR and mark the earlier one as superseded rather than rewriting its history.

## Template

```markdown
# ADR-NNNN: Decision title

- Status: Proposed
- Date: YYYY-MM-DD

## Context

What problem or constraint requires a durable decision?

## Decision

What was chosen, and what boundaries does the choice establish?

## Alternatives considered

Which meaningful alternatives were rejected, and why?

## Consequences

What becomes easier, harder, required, or prohibited because of this decision?

## References

Link relevant Issues, pull requests, specifications, tests, and earlier ADRs.
```
