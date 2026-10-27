# What is guaranteed, and how

Playoff participants are unknown until results exist, so a schedule's safety for them rests on different kinds of evidence. This page says which kind covers what.

## Structural (holds for every outcome by construction)

- `validateSchedule` treats every team that **could** reach a match as present in it (the possible-participant model), so a schedule it accepts has no court, window, dependency or recovery violation for any outcome. For a wildcard seat the possible teams are every team of the stage, and a match containing a wildcard waits for every group of the stage.
- Mandatory instructions (time windows, court rules, blackouts, locks, minimum rest) are checked independently by `checkInstructions` and `validateScheduleWithInstructions`.
- Feasibility proofs (`proven_infeasible`) are necessary conditions: capacity, window fit, per-group capacity, and the **tail bound** (the last first-round match of a group of divisions cannot end before the courts have played all first-round work, and the longest dependent chain, with recovery, then still has to run). A proof means no schedule exists. Their failure to fire proves nothing.

## Exhaustive (every reachable outcome examined)

`verifyAllQualifierOutcomes(inventory, schedule)` enumerates, per division, every reachable combination of pool finishing orders, wildcard source and team, and semifinal result, derives who plays in each knockout match, and checks every pair of matches for a player collision or a gap below the larger minimum rest. It shares no code with the validator's participant model. For the Echelon structure it examines 22,528 outcomes and about 5.8 million match-pair checks in under a second. It assumes any ordering inside a pool is reachable (true for arbitrary results) and a single wildcard seat; divisions outside that are reported in `skipped`, not claimed.

## Sampled (regression evidence only)

Playing a complete tournament with random results and checking the real participants (`test/support/simulate.ts`, `bench/echelon.mjs: actualConflicts`) samples outcomes. Twenty outcomes do not prove safety for all of them; the structural and exhaustive checks do. The samples catch modelling mistakes in the other two.

## Provisional playoffs

`analyzeSchedule(...).playoffs` classifies every knockout match: `provisional` is true while its participants depend on results that do not exist yet, with the number of teams that could reach it (`possibleTeams`) and how many matches it waits for. A provisional match's feasibility rests on the structural and exhaustive guarantees above, never on an assumed result.

## Not covered

- **Tiebreaker matches.** The engine breaks ties without extra matches: wins, head-to-head among the tied teams, game difference, point difference, points for, then a deterministic draw. If an organizer would instead play tiebreakers, the plan is **not** an unconditional maximum. Worst cases for a four-team bracket: 1 extra match for a two-way tie, up to 3 for a three-way tie; for a wildcard seat, up to 3 more among the tied second-placed teams. For the Echelon structure that is up to 3 x 40 + 3 x 8 = 144 matches in the very unlikely worst case. A wildcard tie delays the semifinal that depends on all of the division's brackets. A zero-slack timetable cannot absorb any of them: reserve contingency time or fix the tie rule in advance.
- **A medal match running longer than its planning estimate** (see [Time allocation](time-allocation.md)).
- **Wildcard pairing.** The wildcard takes the lowest seed and meets the top seed. If the wildcard comes from that top seed's own pool the two meet again, because the engine does not re-draw the bracket once results are known. This does not affect scheduling, which already assumes any pairing.
