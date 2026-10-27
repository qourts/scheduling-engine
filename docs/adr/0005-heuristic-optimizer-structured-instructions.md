# ADR 0005: Heuristic optimizer with structured instructions

Status: accepted (2026-10-27)

## Context

Milestone 2 delivers three schedule options for tournaments of up to roughly 500 matches and 20 courts, honouring organizer instructions ("Advanced Men's before noon", "reserve Court 5 for medal matches"). It must keep ADR 0001 (zero runtime dependencies) and the principle that the scheduler is never the authority on validity.

## Decision

- **Heuristic, not exact.** Constructive list scheduling followed by a seeded local search over relocate and swap moves, using the hard-rule feasibility test as a gate on every move. No solver library. The result is never described as optimal. An exact solver (for example CP-SAT behind a service) remains possible behind the same `ScheduleOption` contract.
- **The validator stays independent.** Every candidate passes `validateSchedule` on the compiled tournament and `checkInstructions` before it is returned. The scheduler's own feasibility test is a search aid, and a disagreement discards the candidate.
- **Instructions are typed data, not language.** `SchedulingInstruction` objects carry an explicit `mandatory` or `preference` strength. Mandatory instructions are hard (the engine reports `no_schedule` rather than bend them); preferences are measured and weighted. A natural-language interface will only produce these objects, through the `InstructionAdapter` boundary, after validation and organizer confirmation.
- **Three strategies are objective weightings, and distinctness is verified.** Different weights do not guarantee different schedules, so options are compared, equivalent ones are reworked, and a reworked option is accepted only as a genuine trade-off. When distinct options cannot be produced, the engine explains why from measurements.
- **Determinism.** A seeded PRNG and an iteration budget make runs reproducible. Wall-clock time is a safety cap only and results degrade gracefully when it is hit.

## Consequences

- Quality is bounded by the search moves and budget; an optimistic lower bound is reported for context, not as a gap to the optimum.
- Mandatory `consecutive_blocks` and preference `locked_placement` are rejected as unsupported rather than approximated.
- Instructions that map onto existing rules (court blackouts, minimum rest) are compiled into an effective configuration; the original is never mutated.
- Recovery metrics cover participants known with certainty; unresolved playoff participants remain protected by the hard rules but are not measured.
