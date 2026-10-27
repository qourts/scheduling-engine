# ADR 0004: Event-sourced progression

Status: accepted (2026-10-27)

## Decision

Results and corrections are append-only events with caller-supplied IDs, timestamps and actors. State (standings, bracket participants, match status) is re-derived from the inventory and accepted results. Corrections require a reason and are rejected when they would change who played in another completed match.

## Consequences

One derivation path, full audit trail, deterministic replay. Completed matches are protected. A void-and-replay workflow for disputed downstream results is future work.
