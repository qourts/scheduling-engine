# ADR 0003: Conservative handling of unresolved playoff participants

Status: accepted (2026-10-27)

## Decision

A schedule must be valid for every possible tournament outcome. Each slot has a set of possible teams; conflicts are evaluated on possible players. Two structural exclusions avoid impossible conflicts: non-ordered knockout matches of the same bracket never share a team, and group matches share a team only through a common entry position. Recorded results narrow the sets.

## Consequences

No false guarantees: a validated schedule cannot break because a particular team advances (verified by simulation). The cost is that multi-division players can make provisional schedules tighter than needed; reports mark these as `possible` so operators can see why.
