# Domain docs

This repository uses a single-context domain layout.

## Before exploring or changing domain code

- Read the root `CONTEXT.md`.
- Read ADRs under `docs/adr/` that affect the area being changed.
- If no relevant ADR exists, continue without requiring one upfront.

Use terminology defined in `CONTEXT.md` in code, tests, Issues, specifications, and proposals. Avoid synonyms that the glossary explicitly rejects.

If a proposed change conflicts with an accepted ADR, identify the conflict explicitly instead of silently overriding the earlier decision.

## Layout

- `CONTEXT.md`: canonical domain vocabulary and disallowed synonyms.
- `docs/adr/`: durable architectural decisions and their rationale.
- `docs/agents/`: instructions consumed by engineering agents.
