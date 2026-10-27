# ADR 0006: Echelon wildcard, tiebreaker and recovery decisions

Status: accepted (2026-10-27, with the Milestone 2 merge)

## Context

The Milestone 2 acceptance report includes a one-day Echelon-structure regression scenario. Three of its inputs are not general engine behaviour and must not be mistaken for approved operating rules.

## Decisions

### 1. The Echelon wildcard is seed #4

Under the approved seeding format, the wildcard (the best second-placed team) enters the knockout stage as seed #4, the lowest seed. This matches the engine's behaviour of giving the wildcard the lowest seed.

The engine does **not** re-draw the wildcard if it meets the winner of its own bracket. That is accepted for now and is a documented limitation, not an oversight. See requirement R2 in [future-requirements.md](../future-requirements.md).

### 2. A deterministic draw is not Echelon's tiebreaker

Echelon requires a **race-to-6 tiebreaker** to settle ties. The engine's configurable tiebreaker list must end in `draw` so that ranking is always total. That `draw` is a technical terminator that guarantees a result. It must **not** be used as, or described as, a substitute for the race-to-6 procedure.

Until tiebreaker matches are modelled (R1), an Echelon event must resolve ties outside the engine by playing the race-to-6, and must treat any engine result that depends on `draw` as unresolved.

### 3. The five-minute recovery assumption is experimental

The Echelon brief does not state a minimum recovery value. With the approved category windows:

- 10 minutes of recovery is proven infeasible.
- 5 minutes is the largest value for which a schedule is found, with **zero slack** in the final category.

The five-minute recovery value is classified as **experimental**. The zero-buffer Echelon schedule in the acceptance report demonstrates what the engine does when the rules are feasible. It is **not approved for live operations**. Using it live requires an explicit organiser decision on recovery, windows, courts, or contingency time.

## Consequences

- The acceptance report and this ADR are the record of these decisions; neither may be edited to imply approval.
- Milestone 3 must surface these classifications in the UI wherever Echelon-like configurations are shown (see [milestone-3-plan.md](../milestone-3-plan.md)).
